/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The envelope a relay carries without knowing who it is for — and the two
 * implementations of it agreeing.
 *
 * The client seals, in a browser, with WebCrypto. The recipient's relay
 * opens, in Node. They are separate code in separate languages' idioms, and
 * the format has a length prefix, a padding rule, an HKDF salt, an AAD string
 * and a tag placement that all have to match exactly. Every one of those is
 * somewhere the two could drift apart and still each look right on its own.
 *
 * So neither is checked against a description of the format. Each is checked
 * against the other: seal with one, open with the other, both ways round.
 * That is the only assertion that cannot pass while the two disagree.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const ids = require(join(ROOT, 'scripts', 'lib', 'relay-identity.js'));
const node = require(join(ROOT, 'scripts', 'lib', 'relay-transit.js'));
const manager = readFileSync(join(ROOT, 'js', 'chat', '17-file-manager.js'), 'utf8');
const vault = readFileSync(join(ROOT, 'js', 'chat', '02-media-vault.js'), 'utf8');

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}
async function rejects(promise, label) {
  let threw = false;
  try { await promise; } catch (_error) { threw = true; }
  ok(threw, label);
}

function extract(source, name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`${name} is gone`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error(`${name} is not closed`);
}
function extractConst(source, name) {
  const match = source.match(new RegExp(`^const ${name} = .*;$`, 'm'));
  if (!match) throw new Error(`${name} is gone`);
  return match[0];
}

/* The client half, run exactly as shipped. Everything it needs from the rest
   of the app is the two base64 helpers and the id derivation, all three taken
   from source as well. */
const client = new Function('crypto', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', `
  ${['TRANSIT_VERSION', 'TRANSIT_AAD', 'TRANSIT_PAD_BUCKET', 'TRANSIT_LENGTH_PREFIX',
     'TRANSIT_DEFAULT_TTL_MS', 'TRANSIT_SEAL_INFO', 'TRANSIT_MAX_INNER_BYTES']
    .map((name) => extractConst(manager, name)).join('\n  ')}
  ${extract(vault, 'base64ToBytes')}
  ${extract(vault, 'bytesToBase64')}
  ${extract(manager, 'relayIdFromPublicKey')}
  ${extract(manager, 'transitAadFor')}
  ${extract(manager, 'padTransitBody')}
  ${extract(manager, 'unpadTransitBody')}
  ${extract(manager, 'transitSealKey')}
  ${extract(manager, 'relayKeyMatchesId')}
  ${extract(manager, 'sealTransitEnvelope')}
  ${extract(manager, 'openTransitEnvelope')}
  return { sealTransitEnvelope, openTransitEnvelope, padTransitBody, TRANSIT_PAD_BUCKET };
`)(webcrypto, TextEncoder, TextDecoder,
  (text) => Buffer.from(text, 'base64').toString('binary'),
  (binary) => Buffer.from(binary, 'binary').toString('base64'));

const relay = ids.generateRelayIdentity();
const other = ids.generateRelayIdentity();
const relayPublic = relay.keys.p256.publicKey;
const relayPrivateData = relay.keys.p256.privateKey;
const relayPrivate = ids.relayPrivateKey(relay);

const INNER = {
  toFingerprint: 'f'.repeat(64),
  payload: { type: 'offline-chat', inner: 'text', body: 'sealed to the recipient, not to us' },
  persist: true,
  tag: 'tag-1',
};

console.log('\nThe two implementations agree');

{
  const sealed = await client.sealTransitEnvelope(relay.id, relayPublic, INNER);
  const opened = node.openTransit(relayPrivate, relay.id, sealed);
  ok(JSON.stringify(opened) === JSON.stringify(INNER),
    'what a browser seals, the recipient relay opens');
}

{
  const sealed = node.sealTransit(relay.id, relayPublic, INNER);
  const opened = await client.openTransitEnvelope(relayPrivateData, relay.id, sealed);
  ok(JSON.stringify(opened) === JSON.stringify(INNER),
    'and what the relay seals, a browser opens');
}

/* The same lengths out of both, which is the padding rule agreeing rather
   than each being self-consistently wrong. */
{
  const sizes = [0, 1, 100, 507, 508, 509, 1000, 5000];
  const fromClient = sizes.map((size) => client.padTransitBody(JSON.stringify({ x: 'y'.repeat(size) })).length);
  const fromRelay = await Promise.all(sizes.map(async (size) => {
    const sealed = node.sealTransit(relay.id, relayPublic, { x: 'y'.repeat(size) });
    return Buffer.from(sealed.ct, 'base64').length - 16;
  }));
  const clientSealed = await Promise.all(sizes.map(async (size) => {
    const sealed = await client.sealTransitEnvelope(relay.id, relayPublic, { x: 'y'.repeat(size) });
    return Buffer.from(sealed.ct, 'base64').length - 16;
  }));
  ok(clientSealed.join() === fromRelay.join(),
    `both pad to the same lengths (${fromRelay.slice(0, 5).join(', ')}, …)`);
  ok(fromRelay.every((length) => length % client.TRANSIT_PAD_BUCKET === 0),
    'and every one of them is a whole number of buckets');
  ok(new Set(fromClient).size < sizes.length,
    'so different messages come out the same size — which is the point of padding at all');
}

console.log('\nWhat the envelope refuses');

{
  const sealed = node.sealTransit(relay.id, relayPublic, INNER);
  ok(Object.keys(sealed).sort().join() === 'ct,eph,iv,toRelay,type,v',
    'a carrying relay is handed a relay id and some bytes, and nothing else');
  ok(!JSON.stringify(sealed).includes(INNER.toFingerprint),
    'the recipient is not in it');
  ok(!JSON.stringify(sealed).includes('offline-chat'),
    'nor is the kind of message it is');
  const facts = node.transitFacts(sealed);
  ok(facts.toRelay === relay.id && typeof facts.bytes === 'number'
    && Object.keys(facts).length === 2,
    'and what it may know is one function, not an audit of every call site');
}

/* Re-addressing. The recipient relay's id is the AAD, so an envelope cannot
   be pointed at a different relay — and it fails as "this did not open"
   rather than "this was not for you", which would be an oracle. */
{
  const sealed = node.sealTransit(relay.id, relayPublic, INNER);
  await rejects(Promise.resolve().then(() =>
    node.openTransit(ids.relayPrivateKey(other), other.id, { ...sealed, toRelay: other.id })),
    'an envelope cannot be re-addressed to another relay');
  await rejects(client.openTransitEnvelope(other.keys.p256.privateKey, other.id, { ...sealed, toRelay: other.id }),
    'and the browser refuses the same thing the same way');
}

{
  const sealed = node.sealTransit(relay.id, relayPublic, INNER);
  await rejects(Promise.resolve().then(() =>
    node.openTransit(ids.relayPrivateKey(other), relay.id, sealed)),
    'a relay that is not the recipient cannot open it even addressed correctly');
}

/* A carrying relay that held envelopes back and released them weeks later
   would be replaying traffic into a conversation, and the recipient's relay
   has no other way to notice. */
{
  const sealed = node.sealTransit(relay.id, relayPublic, INNER, { ttlMs: 1000 });
  ok(node.openTransit(relayPrivate, relay.id, sealed) !== null, 'a fresh envelope opens');
  await rejects(Promise.resolve().then(() =>
    node.openTransit(relayPrivate, relay.id, sealed, { now: () => Date.now() + 5000 })),
    'and the same one, held back and released later, does not');
}

/* Sealing to an unchecked key seals to whoever supplied it. The id is the
   hash of the key, so the check is always available and is always made. */
{
  await rejects(client.sealTransitEnvelope(relay.id, other.keys.p256.publicKey, INNER),
    'the client refuses to seal to a key that is not the named relay\'s');
  await rejects(client.sealTransitEnvelope('not-a-relay-id', relayPublic, INNER),
    'and refuses to seal to something that is not a relay id at all');
}

{
  const sealed = node.sealTransit(relay.id, relayPublic, INNER);
  const tampered = { ...sealed, ct: Buffer.concat([
    Buffer.from(sealed.ct, 'base64').subarray(0, 10),
    Buffer.from([0xff]),
    Buffer.from(sealed.ct, 'base64').subarray(11),
  ]).toString('base64') };
  await rejects(Promise.resolve().then(() => node.openTransit(relayPrivate, relay.id, tampered)),
    'a single flipped byte makes the whole envelope refuse to open');
}

{
  await rejects(Promise.resolve().then(() =>
    node.openTransit(relayPrivate, relay.id, { ...node.sealTransit(relay.id, relayPublic, INNER), v: 99 })),
    'and a version this relay does not know is refused rather than guessed at');
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
