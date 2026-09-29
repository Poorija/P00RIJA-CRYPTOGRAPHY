/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Where a contact lives, and what that claim is worth.
 *
 * Routing across relays is the client's job. The relay a message is handed to
 * cannot be told who it is for — that is the whole point of blind transit —
 * so it cannot work out where to pass it on. Only the sender can, and only if
 * each contact record says where that person's messages have to end up.
 *
 * Which makes the claim worth attacking. A hello is NOT signed: the client
 * checks that the fingerprint matches the key it came with, and nothing else
 * in the record is checked at all, so a relay can write whatever it likes
 * into the rest. A wrong home relay does not expose a message — it stays
 * end-to-end encrypted — but it hands the metadata to a relay of somebody
 * else's choosing, and withholding exactly that metadata is what the design
 * is for.
 *
 * So the claim is ranked by the channel it arrived on, the ladder only goes
 * up, and routing takes only the top two ranks. These tests are about that
 * rule and about the card format that carries it.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const peers = readFileSync(join(ROOT, 'js', 'chat', '18-file-manager-2.js'), 'utf8');
const manager = readFileSync(join(ROOT, 'js', 'chat', '17-file-manager.js'), 'utf8');
const vault = readFileSync(join(ROOT, 'js', 'chat', '02-media-vault.js'), 'utf8');
const contacts = readFileSync(join(ROOT, 'js', 'chat', '26-contacts.js'), 'utf8');

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

/* The origin helpers are stubbed, not extracted: what is under test is which
   claim wins, and URL normalisation is a different question with its own
   coverage. The stub is strict in the one way that matters — it rejects
   anything that is not an http(s) origin — so a test cannot pass by feeding
   in something the real one would have thrown out. */
const originStub = (value) => {
  try {
    const parsed = new URL(String(value || ''));
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.origin : '';
  } catch (_error) { return ''; }
};

/* The ranks themselves come from the source too, so renaming a channel or
   reordering the ladder breaks this rather than passing against a copy. */
function extractConst(source, name) {
  const match = source.match(new RegExp(`^const ${name} = .*;$`, 'm'));
  if (!match) throw new Error(`${name} is gone`);
  return match[0];
}

const rules = new Function('isUsableRelayOrigin', 'normalizeRelayOrigin', `
  ${extractConst(peers, 'HOME_RELAY_TRUST')}
  ${extract(peers, 'normalizeHomeRelay')}
  ${extract(peers, 'betterHomeRelay')}
  ${extract(peers, 'routableHomeRelay')}
  return { normalizeHomeRelay, betterHomeRelay, routableHomeRelay };
`)((value) => Boolean(originStub(value)), (value) => originStub(value));

const { normalizeHomeRelay, betterHomeRelay, routableHomeRelay } = rules;

const RELAY_IR = 'https://relay.example.ir';
const RELAY_DE = 'https://relay.example.de';
const ID_IR = 'a'.repeat(64);
const ID_DE = 'b'.repeat(64);
/* A stand-in for a relay's P-256 SPKI. What matters to these rules is that a
   key is present and plausible; that it hashes to the id is checked at seal
   time, and tests/e2e/transitseal.mjs is where that lives. */
const KEY = Buffer.alloc(91, 3).toString('base64');
const from = (origin, id, source, key = KEY) => ({ origin, id, key, source });

console.log('\nWhat a home relay claim has to be');

{
  ok(normalizeHomeRelay(from(RELAY_IR, ID_IR, 'card')) !== null, 'an origin, an id and a channel is a claim');
  ok(normalizeHomeRelay({ origin: RELAY_IR, id: ID_IR }) === null,
    'a claim that does not say where it came from is discarded, not assumed');
  ok(normalizeHomeRelay(from(RELAY_IR, ID_IR, 'gossip')) === null,
    'and a channel nobody defined is not a channel');
  ok(normalizeHomeRelay(from('not a url', ID_IR, 'card')) === null, 'the origin has to be one');
  ok(normalizeHomeRelay(from('ftp://relay.example.ir', ID_IR, 'card')) === null,
    'and has to be reachable over http');
}

/* The id may be absent — a relay too old to have one — and the claim is still
   worth keeping. It simply is not routable, which the last block checks. */
{
  const noId = normalizeHomeRelay({ origin: RELAY_IR, id: '', source: 'card' });
  ok(noId !== null && noId.id === '', 'a relay with no identity yet still gives a usable address');
  ok(normalizeHomeRelay({ origin: RELAY_IR, id: ID_IR, key: 'not base64 !!', source: 'card' }).key === '',
    'and something that is not a key is dropped rather than carried as one');
  ok(normalizeHomeRelay(from(RELAY_IR, 'not-hex', 'card')).id === '',
    'and something that is not a fingerprint is dropped rather than stored as one');
  ok(normalizeHomeRelay(from(RELAY_IR, ID_IR.toUpperCase(), 'card')).id === ID_IR,
    'case does not make it a different relay');
}

console.log('\nThe ladder only goes up');

{
  const hint = from(RELAY_DE, ID_DE, 'presence');
  const card = from(RELAY_IR, ID_IR, 'card');
  ok(betterHomeRelay(card, hint).origin === RELAY_IR,
    'a hello cannot move a contact that was added from a card');
  ok(betterHomeRelay(hint, card).origin === RELAY_IR,
    'and a card replaces a hello');
  ok(betterHomeRelay(from(RELAY_DE, ID_DE, 'session'), hint).origin === RELAY_DE,
    'a hello cannot move one established inside a session either');
  ok(betterHomeRelay(hint, from(RELAY_DE, ID_DE, 'session')).source === 'session',
    'while a session beats a hello');
}

/* The attack this ladder is against is an attacker who can rewrite presence.
   Repetition is free for them, so it must buy nothing. */
{
  let record = from(RELAY_IR, ID_IR, 'card');
  for (let i = 0; i < 50; i += 1) record = betterHomeRelay(record, from(RELAY_DE, ID_DE, 'presence'));
  ok(record.origin === RELAY_IR && record.source === 'card',
    'fifty repeats of the same hint still do not promote it');
}

{
  const first = from(RELAY_IR, ID_IR, 'card');
  const moved = from(RELAY_DE, ID_DE, 'card');
  ok(betterHomeRelay(first, moved).origin === RELAY_DE,
    'a newer card at the same rank wins — which is how somebody moves relays');
  ok(betterHomeRelay(first, null).origin === RELAY_IR,
    'and a record arriving without one does not blank what is there');
  ok(betterHomeRelay(null, null) === null, 'nothing plus nothing is still nothing');
}

console.log('\nWhat may be routed on');

{
  ok(routableHomeRelay({ homeRelay: from(RELAY_IR, ID_IR, 'card') })?.origin === RELAY_IR,
    'a card is an address');
  ok(routableHomeRelay({ homeRelay: from(RELAY_IR, ID_IR, 'card') })?.key === KEY,
    'and it carries the key to seal to, so the far relay never has to be reached first');
  ok(routableHomeRelay({ homeRelay: from(RELAY_IR, ID_IR, 'card', '') }) === null,
    'an address with nothing to seal to is not one');
  ok(routableHomeRelay({ homeRelay: from(RELAY_IR, ID_IR, 'session') })?.origin === RELAY_IR,
    'so is something said inside a session');
  ok(routableHomeRelay({ homeRelay: from(RELAY_IR, ID_IR, 'presence') }) === null,
    'a hello is NOT an address, however convenient that would be');
  ok(routableHomeRelay({ homeRelay: { origin: RELAY_IR, id: '', source: 'card' } }) === null,
    'and neither is an origin with no relay identity to seal to');
  ok(routableHomeRelay({}) === null, 'a contact with nothing recorded is not routable');
}

/* Sharing somebody else's card must not launder a hint into one. */
{
  const share = new Function('routableHomeRelay', 'utf8_to_b64', `
    ${extract(contacts, 'contactShareText')}
    return contactShareText;
  `)(routableHomeRelay, (text) => Buffer.from(text, 'utf8').toString('base64'));
  const read = (peer) => JSON.parse(Buffer.from(share(peer).slice('poorija-chat-v1:'.length), 'base64').toString('utf8'));
  ok(read({ peerId: 'p', homeRelay: from(RELAY_IR, ID_IR, 'card') }).homeRelay?.origin === RELAY_IR,
    'passing on a contact passes on the address you were given out of band');
  ok(read({ peerId: 'p', homeRelay: from(RELAY_IR, ID_IR, 'presence') }).homeRelay === null,
    'but a hint is not forwarded as though it were one');
}

console.log('\nA reply can find its way back');

/* Without this, two people who met through one person's code could talk in
   one direction only: the side that never scanned a card has nowhere to send
   to. The sender puts their own relay inside the sealed body, where no relay
   on the way can read it or write it. */
{
  const transfer = readFileSync(join(ROOT, 'js', 'chat', '29-file-transfer.js'), 'utf8');
  const harness = (peers) => {
    const chatState = { peers };
    let saved = 0;
    const note = new Function('chatState', 'betterHomeRelay', 'saveContacts', `
      ${extract(transfer, 'noteSenderHomeRelay')}
      return noteSenderHomeRelay;
    `)(chatState, betterHomeRelay, () => { saved += 1; });
    return { chatState, note, saves: () => saved };
  };

  const theirs = { origin: RELAY_DE, id: ID_DE, key: KEY };
  {
    const h = harness([{ peerId: 'p1', fingerprint: 'f1', homeRelay: null }]);
    h.note({ fromFingerprint: 'f1' }, theirs);
    ok(h.chatState.peers[0].homeRelay?.origin === RELAY_DE
      && h.chatState.peers[0].homeRelay?.source === 'session',
      'a contact with no address recorded gains one from the message itself');
    ok(h.saves() === 1, 'and it is written down rather than kept for this session only');
  }
  {
    const h = harness([{ peerId: 'p1', fingerprint: 'f1', homeRelay: from(RELAY_IR, ID_IR, 'card') }]);
    h.note({ fromFingerprint: 'f1' }, theirs);
    ok(h.chatState.peers[0].homeRelay.origin === RELAY_IR,
      'but it cannot move somebody whose card said otherwise — which is what stops an envelope somebody else sealed from redirecting replies');
    ok(h.saves() === 0, 'and a claim that changes nothing writes nothing');
  }
  {
    const h = harness([{ peerId: 'p1', fingerprint: 'f1', homeRelay: null }]);
    h.note({ fromFingerprint: 'nobody-here' }, theirs);
    ok(h.chatState.peers[0].homeRelay === null,
      'a sender who is not in the address book leaves nothing behind');
  }
  {
    const h = harness([{ peerId: 'p1', fingerprint: '', homeRelay: null }]);
    h.note({ fromPeerId: 'p1' }, theirs);
    ok(h.chatState.peers[0].homeRelay?.source === 'session',
      'and a contact known only by peer id is still found');
  }
}

console.log('\nThe card format carries it');

/* The compact QR, round-tripped through the real encoder and parser. */
const qr = new Function('identityPayload', 'identityText', 'window', 'atob', `
  ${extract(vault, 'base64ToBytes')}
  ${extract(vault, 'bytesToBase64')}
  ${extract(manager, 'hexToBytes')}
  ${extract(manager, 'bytesToHex')}
  const IDENTITY_QR_PREFIX = 'poorija-chat-v3:';
  ${extract(manager, 'identityQrText')}
  ${extract(manager, 'parseIdentityQrText')}
  return { identityQrText, parseIdentityQrText, IDENTITY_QR_PREFIX };
`);

function qrFor(payload) {
  return qr(() => payload, () => 'x'.repeat(4096), { btoa }, atob);
}

const card = {
  name: 'Someone', peerId: 'peer-1',
  fingerprint: 'c'.repeat(64),
  publicKeyData: Buffer.alloc(398, 7).toString('base64'),
  createdAt: '2026-09-25T00:00:00.000Z',
  homeRelay: { origin: RELAY_IR, id: ID_IR, key: KEY },
};

{
  const { identityQrText, parseIdentityQrText } = qrFor(card);
  const packed = identityQrText();
  ok(packed.startsWith('poorija-chat-v3:'), 'the compact card is produced');
  const parsed = JSON.parse(parseIdentityQrText(packed));
  ok(parsed.fingerprint === card.fingerprint && parsed.publicKeyData === card.publicKeyData,
    'and what was already in it survives the round trip');
  ok(parsed.homeRelay?.origin === RELAY_IR && parsed.homeRelay?.id === ID_IR
    && parsed.homeRelay?.key === KEY,
    'along with the home relay: origin, id and the key to seal to it');
}

{
  const { identityQrText, parseIdentityQrText } = qrFor({ ...card, homeRelay: null });
  const parsed = JSON.parse(parseIdentityQrText(identityQrText()));
  ok(parsed.homeRelay === null,
    'somebody whose relay has no identity yet still produces a readable card');
}

/* The fields were appended rather than inserted, so a reader that predates
   them stops after the fifth and ignores the rest. Checked by reading a new
   card with the old five-field limit. */
{
  const { identityQrText } = qrFor(card);
  const packed = identityQrText();
  const oldReader = new Function('atob', `
    ${extract(vault, 'base64ToBytes')}
    ${extract(vault, 'bytesToBase64')}
    ${extract(manager, 'bytesToHex')}
    const IDENTITY_QR_PREFIX = 'poorija-chat-v3:';
    ${extract(manager, 'parseIdentityQrText').replace('fields.length < 7', 'fields.length < 5')
      .replace(/\n\s*homeRelay: fields\[5\][\s\S]*?: null,/, '')}
    return parseIdentityQrText;
  `)(atob);
  const asOldBuildSeesIt = JSON.parse(oldReader(packed));
  ok(asOldBuildSeesIt.fingerprint === card.fingerprint
    && asOldBuildSeesIt.publicKeyData === card.publicKeyData,
    'a build that predates home relays still scans the new card');
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
