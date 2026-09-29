/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A relay has a name it cannot lie about, and a client that checks it.
 *
 * Until now a relay was an origin. A hostname can be taken over, a
 * certificate can be issued, a DNS record can be changed, and a client had no
 * way to ask whether the server answering today is the one that answered
 * yesterday. Every other address in this app is the hash of a public key;
 * relays were the exception, and they are the part that is about to start
 * handing traffic to each other — where sealing to a hostname means sealing
 * to whoever holds the hostname.
 *
 * Both relays are started for real, because the whole reason this repository
 * has a parity checker is that a feature once went into one of them and not
 * the other, and every suite tested the one nobody runs.
 *
 * The client half is run from the shipped source rather than restated here,
 * so that a change to the rules breaks this instead of passing it.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import net from 'node:net';
import { createRequire } from 'node:module';
import { mirrorRelayLib } from './_relay-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ids = createRequire(import.meta.url)(join(ROOT, 'scripts', 'lib', 'relay-identity.js'));
const relaySource = readFileSync(join(ROOT, 'js', 'chat', '17-file-manager.js'), 'utf8');

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
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

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/* Started the way a deployment starts it: no flags, only the environment. */
async function startRelay(file, dir, port) {
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CHAT_SIGNAL_HOST: '127.0.0.1',
      CHAT_SIGNAL_PORT: String(port),
      CHAT_PRESENCE_PORT: String(port + 1),
      PORT: String(port),
      MONITOR_PASSWORD: 'Local-Test-Only-Password-36',
      TURN_USER: 'local-test',
      TURN_PASSWORD: 'Local-Test-Only-Turn-36',
      CHAT_OFFLINE_STORE_PATH: join(dir, 'offline-messages.json'),
      CHAT_PUSH_STORE_PATH: join(dir, 'push.json'),
      CHAT_VAPID_STORE_PATH: join(dir, 'vapid.json'),
      CHAT_POLICY_STORE_PATH: join(dir, 'policy.json'),
      CHAT_SELF_DESTRUCT_STORE_PATH: join(dir, 'self-destruct.json'),
    },
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${file} exited early:\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/chat-health`);
      if (response.ok) return { child, port, output: () => output };
    } catch (_error) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGKILL');
  throw new Error(`${file} never answered:\n${output}`);
}

function stop(relay) {
  return new Promise((resolve) => {
    if (!relay?.child || relay.child.exitCode !== null) return resolve();
    relay.child.once('exit', resolve);
    relay.child.kill('SIGTERM');
    setTimeout(() => { relay.child.kill('SIGKILL'); resolve(); }, 3000);
  });
}

const get = async (port, path) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();

/* ---- both relays, for real ------------------------------------------- */

/* The distribution reads its shared modules from ./lib, which only its image
   has; see tests/e2e/_relay-lib.mjs. */
const restoreRelayLib = mirrorRelayLib();
process.on('exit', restoreRelayLib);

for (const file of ['scripts/server.js', 'standalone-relay/server.js']) {
  console.log(`\n${file}`);
  const dir = mkdtempSync(join(tmpdir(), 'poorija-relayid-'));
  const port = await freePort();
  let relay = await startRelay(file, dir, port);
  try {
    const identity = await get(port, '/relay-identity');
    ok(identity.ok === true && typeof identity.publicKey === 'string' && identity.publicKey.length > 0,
      'it publishes an identity at all');
    /* P-256 and not a better curve, on purpose: the client is the one that
       seals a transit envelope, so this key has to be usable from a browser.
       See relay-identity.js. */
    ok(identity.algorithm === 'p-256',
      'as a P-256 key — the one curve every browser can seal to');

    /* The property the whole thing rests on: the name is DERIVED from the
       key, so a relay cannot claim a name it does not hold the key for. */
    const derived = crypto.createHash('sha256')
      .update(Buffer.from(identity.publicKey, 'base64')).digest('hex');
    ok(derived === identity.id, 'and its id is the hash of that key, not a label it chose');

    const health = await get(port, '/chat-health');
    ok(health.relayId === identity.id,
      'the health endpoint names the same relay, so a client learns it in the probe it already makes');

    ok(!JSON.stringify(identity).includes('privateKey'),
      'and the private half never leaves the server');

    const file600 = join(dir, 'relay-identity.json');
    ok(existsSync(file600), 'the identity is written beside the rest of the relay state');
    ok((statSync(file600).mode & 0o777) === 0o600, 'readable by its owner and nobody else');

    /* A relay that renamed itself on every restart could not be pinned by a
       client or sealed to by another relay, which is the entire point. */
    await stop(relay);
    relay = await startRelay(file, dir, port);
    const again = await get(port, '/relay-identity');
    ok(again.id === identity.id, 'and it is the same relay after a restart');
    ok(again.publicKey === identity.publicKey, 'holding the same key');
  } finally {
    await stop(relay);
  }
}

/* ---- growing a post-quantum key without changing the name ------------- */

/* The whole reason the id covers the classical key alone. A relay that has
   been running since before ML-KEM has clients that pinned its fingerprint;
   gaining a second key must not rename it, or every one of them reports a
   change that never happened. */
{
  console.log('\nAdding the post-quantum half to a relay that was already running');
  const dir = mkdtempSync(join(tmpdir(), 'poorija-relaypq-'));
  const file = join(dir, 'relay-identity.json');
  const before = ids.generateRelayIdentity();
  const oldShape = { ...before, keys: { p256: before.keys.p256 } };
  writeFileSync(file, JSON.stringify(oldShape, null, 2), { mode: 0o600 });

  const loaded = ids.loadOrCreateRelayIdentity(file, { log: { warn() {}, log() {} } });
  ok(loaded.id === before.id, 'the relay keeps the name its clients pinned');
  ok(loaded.keys.p256.publicKey === before.keys.p256.publicKey, 'and the key that name is the hash of');
  ok(Boolean(loaded.keys.mlkem768?.publicKey && loaded.keys.mlkem768?.privateKey),
    'while a post-quantum key appears beside it');
  ok(ids.publicRelayIdentity(loaded).pqAlgorithm === 'ml-kem-768',
    'and is published for peers to encapsulate to');

  const reread = ids.loadOrCreateRelayIdentity(file, { log: { warn() {}, log() {} } });
  ok(reread.keys.mlkem768.publicKey === loaded.keys.mlkem768.publicKey,
    'it was written back, so the next start does not generate another');
  ok((statSync(file).mode & 0o777) === 0o600, 'with the file still readable by its owner alone');
  ok(!JSON.stringify(ids.publicRelayIdentity(reread)).includes(reread.keys.mlkem768.privateKey),
    'and the private half of it stays put as well');
}

/* ---- the client half, from the shipped source ------------------------- */

console.log('\nWhat the client does with it');

const scope = new Function('chatState', 'notify', 't', 'saveEncrypted', 'renderStaticUi',
  'CHAT_PROFILE_STORAGE_KEY', 'promptRelayPinChange', `
  ${extract(relaySource, 'relayIdFromPublicKey')}
  ${extract(relaySource, 'formatRelayId')}
  ${extract(relaySource, 'verifiedRelayIdentity')}
  ${extract(relaySource, 'relayPinFor')}
  ${extract(relaySource, 'recordRelayPin')}
  ${extract(relaySource, 'acceptRelayPin')}
  ${extract(relaySource, 'applyRelayIdentity')}
  return { relayIdFromPublicKey, formatRelayId, verifiedRelayIdentity, relayPinFor,
    recordRelayPin, acceptRelayPin, applyRelayIdentity };
`);

function clientHarness() {
  const chatState = { profile: { relayPins: {} }, relayPinAlert: null };
  const warnings = [];
  const api = scope(chatState, (message, kind) => warnings.push(kind), (fa) => fa,
    () => {}, () => {}, 'profile', async () => {});
  return { chatState, warnings, ...api };
}

const keyPair = crypto.generateKeyPairSync('x25519');
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const trueId = crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
const ORIGIN = 'https://relay.example.ir';

{
  const { relayIdFromPublicKey } = clientHarness();
  ok(await relayIdFromPublicKey(publicKey) === trueId,
    'the client derives the same id the relay did, from the key alone');
  ok(await relayIdFromPublicKey('not base64 at all !!') === '',
    'and rubbish in place of a key produces no id rather than a wrong one');
}

/* The reason the id is recomputed instead of read: an id the server merely
   asserts is a label, and a label is exactly what an attacker would supply. */
{
  const { verifiedRelayIdentity } = clientHarness();
  ok(await verifiedRelayIdentity({ id: trueId, publicKey }, {}) !== null,
    'an honest bundle is accepted');
  ok(await verifiedRelayIdentity({ id: 'a'.repeat(64), publicKey }, {}) === null,
    'a relay naming itself after a key it did not publish is rejected');
  ok(await verifiedRelayIdentity({ id: trueId, publicKey }, { relayId: 'b'.repeat(64) }) === null,
    'and so is one whose two endpoints disagree about who it is');
  ok(await verifiedRelayIdentity({ id: trueId, publicKey: '' }, {}) === null,
    'an id with no key behind it cannot be checked, so it is not taken');
}

const identityOf = (id) => ({ id, publicKey, algorithm: 'x25519' });

{
  const harness = clientHarness();
  ok(harness.applyRelayIdentity(ORIGIN, identityOf(trueId)) === 'new', 'first sight pins it');
  ok(harness.applyRelayIdentity(ORIGIN, identityOf(trueId)) === 'same', 'and it matches next time');
  ok(harness.chatState.relayPinAlert === null, 'with nothing to report');
}

/* The case this exists for -- and the rule that makes it worth anything:
   a changed identity is REPORTED and the old pin is kept. Adopting whatever
   answered most recently would be the same as having no pin. */
{
  const harness = clientHarness();
  harness.applyRelayIdentity(ORIGIN, identityOf(trueId));
  const verdict = harness.applyRelayIdentity(ORIGIN, identityOf('c'.repeat(64)));
  ok(verdict === 'changed', 'a different identity at a pinned address is noticed');
  ok(harness.chatState.profile.relayPins[ORIGIN].id === trueId,
    'and the pin is NOT replaced by it');
  ok(harness.chatState.relayPinAlert?.expected === trueId
    && harness.chatState.relayPinAlert?.seen === 'c'.repeat(64),
    'both fingerprints are kept so a person can compare them');
  ok(harness.warnings.includes('warning'), 'and the person is told, not only the console');
}

/* Replacing a pin is possible, and only ever as an answer to that question. */
{
  const harness = clientHarness();
  harness.applyRelayIdentity(ORIGIN, identityOf(trueId));
  harness.applyRelayIdentity(ORIGIN, identityOf('d'.repeat(64)));
  ok(harness.acceptRelayPin(ORIGIN, identityOf('d'.repeat(64))) === true, 'accepting replaces it');
  ok(harness.chatState.profile.relayPins[ORIGIN].id === 'd'.repeat(64), 'with the one that was seen');
  ok(harness.chatState.relayPinAlert === null, 'and clears the warning');
  ok(harness.applyRelayIdentity(ORIGIN, identityOf('d'.repeat(64))) === 'same',
    'after which that relay is the pinned one');
}

/* An older relay has no identity to give. That is not a failure and must not
   be treated as one, or upgrading the app would break every existing relay. */
{
  const harness = clientHarness();
  ok(harness.applyRelayIdentity(ORIGIN, null) === 'unknown', 'a relay too old to have one is not an alarm');
  ok(Object.keys(harness.chatState.profile.relayPins).length === 0, 'and nothing is pinned for it');
}

/* Pins are per origin: two relays are two relays. */
{
  const harness = clientHarness();
  harness.applyRelayIdentity(ORIGIN, identityOf(trueId));
  ok(harness.applyRelayIdentity('https://relay.example.de', identityOf('e'.repeat(64))) === 'new',
    'a second relay pins separately rather than colliding with the first');
  ok(harness.relayPinFor(ORIGIN).id === trueId, 'and the first is untouched');
}

{
  const { formatRelayId } = clientHarness();
  const shown = formatRelayId(trueId);
  ok(shown.split(' ').length === 16 && shown.replace(/ /g, '') === trueId,
    'the fingerprint is shown in full, in groups somebody can read aloud');
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
