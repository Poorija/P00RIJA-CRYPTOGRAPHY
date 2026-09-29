/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Two things a call could not say about itself, and both of them decide how
 * good it sounds.
 *
 * The first is WHICH WAY the media went. Call media never touches the
 * signalling relay — it is peer to peer, or it goes through a TURN server —
 * and the panel reported neither, so a call that quietly fell back to a TURN
 * on another continent looked exactly like a direct call that happened to be
 * slow. The remedies are opposites: one is a link you cannot fix, the other is
 * a server in the wrong place.
 *
 * The second is WHOSE TURN the client is holding. The credentials were fetched
 * from a relay once and then kept for good, so a client that moved to a nearer
 * relay went on relaying its calls through the far one — the exact thing a
 * nearer TURN exists to stop. `hydrateRelayTurnConfig` was already being
 * called when the relay changed; the guard inside it returned early because
 * the old credentials were still there.
 *
 * Both are read out of the real functions rather than re-implemented here.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const callSource = readFileSync(join(ROOT, 'js', 'chat', '31-file-transfer-3.js'), 'utf8');
const relaySource = readFileSync(join(ROOT, 'js', 'chat', '17-file-manager.js'), 'utf8');

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

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

/* ---- the route a call actually took ---------------------------------- */

/* A getStats result is a Map of reports that also answers get(). Building one
   by hand is the only way to put a chosen candidate pair in front of the
   reader, since a real pair depends on a real network. */
function statsOf(reports) {
  const map = new Map(reports.map((report) => [report.id, report]));
  return map;
}

/* The minimum a reading needs to not be discarded, plus the pair and its two
   candidates. `kind` of local/remote is what getStats calls the two ends. */
function callWith(localType, remoteType, extra = {}) {
  return statsOf([
    { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
    {
      id: 'P', type: 'candidate-pair', state: 'succeeded', nominated: true,
      currentRoundTripTime: 0.05, availableOutgoingBitrate: 2000000,
      localCandidateId: 'L', remoteCandidateId: 'R',
    },
    { id: 'L', type: 'local-candidate', candidateType: localType, ...extra },
    { id: 'R', type: 'remote-candidate', candidateType: remoteType },
  ]);
}

const readCallQuality = new Function('callIntervalLoss', 'callAdaptationState', 'turnServerLabel',
  `return ${extract(callSource, 'readCallQuality')}`)(
  () => null, new WeakMap(),
  new Function(`return ${extract(callSource, 'turnServerLabel')}`)());

const read = (stats) => readCallQuality({ getStats: async () => stats });

console.log('\nCall route');

{
  const reading = await read(callWith('host', 'host'));
  ok(reading.route === 'direct', 'two host candidates read as a direct call');
  ok(reading.relayServer === '', 'and name no TURN, because none was used');
}

{
  const reading = await read(callWith('srflx', 'srflx'));
  ok(reading.route === 'direct',
    'a call punched through two NATs is still direct — reflexive is not relayed');
}

{
  const reading = await read(callWith('relay', 'host',
    { url: 'turn:relay.example.com:3478?transport=udp', relayProtocol: 'udp' }));
  ok(reading.route === 'local', 'this side on a TURN and the other direct reads as ours alone');
  ok(reading.relayServer === 'turn:relay.example.com:3478',
    `and names the server without the query string (${reading.relayServer})`);
  ok(reading.relayProtocol === 'udp', 'and says how this device reached it');
}

{
  const reading = await read(callWith('host', 'relay'));
  ok(reading.route === 'remote', 'the other side relaying is not the same as this side relaying');
  ok(reading.relayServer === '',
    'and no TURN is named, because the one in use is theirs and this device cannot see it');
}

/* The two-hop path, and the whole reason the route is worth reporting: each
   end reaches its own nearby TURN and the long leg runs server to server. It
   is ordinary ICE and needs no new code — but nothing could say whether it had
   happened, which made a second TURN impossible to evaluate. */
{
  const reading = await read(callWith('relay', 'relay',
    { url: 'turns:relay.example.ir:5349?transport=tcp', relayProtocol: 'tls' }));
  ok(reading.route === 'both', 'both ends relayed reads as the two-hop path');
  ok(reading.relayServer === 'turns:relay.example.ir:5349' && reading.relayProtocol === 'tls',
    'and the near end of it is named, which is the half this device chose');
}

/* Firefox does not put the ICE server on the candidate. The relayed address
   belongs to the TURN, so it names the server just as well. */
{
  const reading = await read(callWith('relay', 'host', { address: '203.0.113.9' }));
  ok(reading.relayServer === '203.0.113.9',
    'a browser that omits the server URL still names the TURN by its address');
}

/* Before ICE settles there is no pair, and a guess would be worse than a
   blank: the panel prints nothing rather than claiming "direct". */
{
  const reading = await read(statsOf([
    { id: 'T', type: 'transport' },
    { id: 'I', type: 'inbound-rtp', kind: 'audio', packetsReceived: 10, bytesReceived: 900 },
  ]));
  ok(reading.route === '', 'a call that has not settled claims no route at all');
}

/* ---- whose TURN the client is holding -------------------------------- */

console.log('\nTURN credentials follow the relay');

function relayHarness(profile = {}, origin = 'https://relay.example.ir') {
  const chatState = {
    profile: {
      turnUrl: '', turnUsername: '', turnCredential: '', turnOrigin: '', ...profile,
    },
  };
  const scope = new Function('chatState', 'chatServerOrigin', 'formatIceServerUrlsForInput', `
    const TURN_ORIGIN_MANUAL = 'manual';
    ${extract(relaySource, 'turnConfigIsUserOwned')}
    ${extract(relaySource, 'adoptRelayTurnConfig')}
    ${extract(relaySource, 'importedTurnOrigin')}
    ${extract(relaySource, 'turnConfigIsForAnotherRelay')}
    return { turnConfigIsUserOwned, adoptRelayTurnConfig, importedTurnOrigin,
      turnConfigIsForAnotherRelay };
  `)(chatState, () => origin, (value) => (Array.isArray(value) ? value.join(',') : String(value || '')));
  return { chatState, ...scope };
}

const turnFrom = (origin) => ({
  enabled: true, urls: [`turn:${new URL(origin).hostname}:3478?transport=udp`],
  username: 'u', credential: 'p',
});

/* The bug, in the shape it shipped in: credentials from one relay, a client
   now pointed at another, and nothing to notice. */
{
  const { turnConfigIsForAnotherRelay } = relayHarness({
    turnUrl: 'turn:relay.example.de:3478', turnUsername: 'u', turnCredential: 'p',
    turnOrigin: 'https://relay.example.de',
  });
  ok(turnConfigIsForAnotherRelay() === true,
    'credentials fetched from one relay are recognised as stale at another');
}

{
  const { turnConfigIsForAnotherRelay } = relayHarness({
    turnUrl: 'turn:relay.example.ir:3478', turnUsername: 'u', turnCredential: 'p',
    turnOrigin: 'https://relay.example.ir',
  });
  ok(turnConfigIsForAnotherRelay() === false,
    'credentials from the relay in use are left alone');
}

/* Every profile written before this existed has no origin recorded, and its
   credentials could be from anywhere. Refetching once is the safe reading. */
{
  const { turnConfigIsForAnotherRelay } = relayHarness({
    turnUrl: 'turn:somewhere:3478', turnUsername: 'u', turnCredential: 'p',
  });
  ok(turnConfigIsForAnotherRelay() === true,
    'an older profile with no origin recorded is refreshed once rather than trusted');
}

/* A TURN somebody typed in full is theirs. The app used to overwrite it on
   any discovery run, which is how a hand-configured server disappeared. */
{
  const harness = relayHarness({
    turnUrl: 'turn:mine.example.net:3478', turnUsername: 'me', turnCredential: 'secret',
    turnOrigin: 'manual',
  });
  ok(harness.turnConfigIsForAnotherRelay() === false, 'a TURN entered by hand is never stale');
  ok(harness.adoptRelayTurnConfig(turnFrom('https://relay.example.ir'), 'https://relay.example.ir') === false,
    'and the relay cannot replace it');
  ok(harness.chatState.profile.turnUsername === 'me', 'so what was typed is still there');
}

/* Half a TURN is not a TURN: peerOptions() drops an entry missing a username
   or a credential, so emptying the fields is how somebody asks for the
   relay's own back. */
{
  const harness = relayHarness({ turnUrl: 'turn:mine.example.net:3478', turnOrigin: 'manual' });
  ok(harness.adoptRelayTurnConfig(turnFrom('https://relay.example.ir'), 'https://relay.example.ir') === true,
    'an incomplete hand-entered TURN does not block the relay from supplying a working one');
  ok(harness.chatState.profile.turnOrigin === 'https://relay.example.ir',
    'and the relay it came from is recorded with it');
}

/* Adopting records the source, which is the whole mechanism: without it the
   next relay change cannot be noticed. */
{
  const harness = relayHarness();
  harness.adoptRelayTurnConfig(turnFrom('https://relay.example.ir'), 'https://relay.example.ir');
  ok(harness.chatState.profile.turnUrl === 'turn:relay.example.ir:3478?transport=udp'
    && harness.chatState.profile.turnOrigin === 'https://relay.example.ir',
    'a fresh client takes the relay TURN and remembers which relay gave it');
  ok(harness.turnConfigIsForAnotherRelay() === false, 'and is then settled');
}

{
  const harness = relayHarness();
  ok(harness.adoptRelayTurnConfig({ enabled: true, urls: [] }, 'https://relay.example.ir') === false,
    'a relay with no TURN of its own changes nothing');
  ok(harness.chatState.profile.turnOrigin === '',
    'and is not recorded as the source, so the next connect asks again');
}

/* ---- a config file whose TURN is not its relay's ---------------------- */

/* The arrangement this is for: signalling stays on the relay every contact is
   already on, while the media goes through a TURN nearer the user. One person
   sets it up, exports the config file, and everyone else imports it.
   Recording the relay as the source would undo it — the background refresh
   would fetch the relay's own TURN and replace the near one within minutes. */
{
  const { importedTurnOrigin } = relayHarness();
  const chosen = importedTurnOrigin(
    'turn:turn.tehran.example:3478?transport=udp',
    { urls: ['turn:relay.example.de:3478?transport=udp'] },
    'https://relay.example.de');
  ok(chosen === 'manual',
    'a config file pointing at a TURN other than its relay\'s is a choice, and is kept');
}

/* The ordinary case is the opposite, and there recording the relay is what
   lets a rotated password reach everyone who imported the file. */
{
  const { importedTurnOrigin } = relayHarness();
  const chosen = importedTurnOrigin(
    'turn:relay.example.de:3478?transport=udp',
    { urls: ['turn:relay.example.de:3478?transport=udp'] },
    'https://relay.example.de');
  ok(chosen === 'https://relay.example.de',
    'a config carrying its own relay\'s TURN is filed under that relay, so rotation still reaches it');
}

/* A relay with no TURN of its own cannot have supplied the one in the file. */
{
  const { importedTurnOrigin } = relayHarness();
  ok(importedTurnOrigin('turn:turn.tehran.example:3478', { urls: [] }, 'https://relay.example.de') === 'manual',
    'and a relay serving no TURN cannot be the source of the one imported');
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
