/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Choosing between two TURN servers, per contact.
 *
 * ICE measures every candidate pair for real and then picks by a priority
 * formula rather than by what it measured — so there is a number in front of
 * it that it does not use, and with two TURN servers it can settle on the
 * slower one for this particular contact.
 *
 * What is tested is the decision, not the plumbing: what gets remembered,
 * which server wins, and — the part that costs a gap in the audio and so has
 * to be right — when the call is moved and when it is left alone.
 *
 * One check here matters more than it looks. The measured server address and
 * the configured server url are produced by two different functions, and if
 * they ever disagree about the same server then nothing matches, no memory is
 * ever used, and every other test in this file still passes.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'js', 'chat', '31-file-transfer-3.js'), 'utf8');

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

function extract(name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`${name} is gone`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error(`${name} is not closed`);
}
function extractConst(name) {
  const match = source.match(new RegExp(`^const ${name} = .*;$`, 'm'));
  if (!match) throw new Error(`${name} is gone`);
  return match[0];
}

const CONSTS = ['TURN_MEMORY_CONTACTS', 'TURN_MEMORY_SERVERS', 'TURN_SWITCH_AFTER_BAD',
  'TURN_LOSS_WEIGHT', 'TURN_MEMORY_WEIGHT'].map(extractConst).join('\n  ');

/* The whole decision layer, driven with a chatState of our own and with the
   two things it reaches outside for — the peer on the call, and saving —
   replaced so they can be observed. */
function harness({ prefs = {}, fingerprint = 'contact-1', quality = () => 'good' } = {}) {
  const chatState = { prefs, peer: { options: { config: { iceServers: [] } } } };
  /* Held in a box so a test can change the verdict mid-run: the hysteresis is
     about a RUN of poor samples, and proving a good one breaks the run needs
     both verdicts inside one harness — the state that counts them lives in a
     WeakMap here. */
  const grade = { of: quality };
  const saves = [];
  const notices = [];
  const configured = { iceServers: [] };
  const api = new Function('chatState', 'saveChatPrefs', 'activeCallPeerRecord',
    'callQualityLevel', 'notify', 't', 'console', 'peerOptions', `
    ${CONSTS}
    ${extract('turnServerLabel')}
    ${extract('turnMemory')}
    ${extract('turnScore')}
    ${extract('newestTurnEntry')}
    ${extract('pruneTurnMemory')}
    ${extract('rememberTurnResult')}
    ${extract('bestTurnLabelFor')}
    ${extract('turnUrlLabel')}
    ${extract('orderIceServersFor')}
    ${extract('prepareIceForContact')}
    const callRouteState = new WeakMap();
    ${extract('adaptCallRoute')}
    return { turnServerLabel, turnMemory, turnScore, rememberTurnResult, bestTurnLabelFor,
      turnUrlLabel, orderIceServersFor, prepareIceForContact, adaptCallRoute,
      TURN_SWITCH_AFTER_BAD, TURN_LOSS_WEIGHT, TURN_MEMORY_SERVERS, TURN_MEMORY_CONTACTS };
  `)(chatState, () => saves.push(1), () => ({ fingerprint }), (reading) => grade.of(reading),
    (message) => notices.push(message), (fa) => fa,
    { log() {}, warn() {} }, () => ({ config: configured }));
  return { chatState, saves, notices, grade, configured, ...api };
}

const IR = 'turn:turn.tehran.example:3478';
const DE = 'turn:turn.berlin.example:3478';

console.log('\nThe two halves have to agree about a server');

/* turnServerLabel names a server from a measured ICE candidate; turnUrlLabel
   names it from a configured url. If they ever disagree, nothing matches and
   the whole feature is silently off. */
{
  const h = harness();
  const cases = [
    ['turn:turn.tehran.example:3478?transport=udp', IR],
    ['turn:turn.tehran.example:3478?transport=tcp', IR],
    ['TURNS:relay.example.ir:5349?transport=tcp', 'turns:relay.example.ir:5349'],
  ];
  const agree = cases.every(([url, want]) =>
    h.turnUrlLabel(url) === want && h.turnServerLabel({ url }) === want);
  ok(agree, 'a measured candidate and a configured url reduce to the same name');
  ok(h.turnUrlLabel('stun:stun.example.com:3478') === '',
    'and a STUN url is not a TURN server');
  ok(h.turnUrlLabel('') === '' && h.turnUrlLabel(undefined) === '', 'nothing names nothing');
}

console.log('\nWhat gets remembered');

{
  const h = harness();
  h.rememberTurnResult('c1', IR, { rtt: 60, lossPercent: 0 });
  const entry = h.turnMemory().c1[IR];
  ok(entry.rtt === 60 && entry.loss === 0 && entry.samples === 1, 'the first call is taken as it came');
  ok(h.saves.length === 1, 'and written down, or it would not survive the app closing');

  h.rememberTurnResult('c1', IR, { rtt: 260, lossPercent: 0 });
  const after = h.turnMemory().c1[IR];
  ok(after.rtt > 60 && after.rtt < 260,
    `a second call moves it rather than replacing it (${after.rtt} ms)`);
  ok(after.samples === 2, 'and the count grows');
}

{
  const h = harness();
  h.rememberTurnResult('c1', IR, { rtt: null });
  ok(Object.keys(h.turnMemory()).length === 0, 'a reading with no round trip says nothing');
  h.rememberTurnResult('', IR, { rtt: 60 });
  ok(Object.keys(h.turnMemory()).length === 0, 'and neither does one with no contact');
}

console.log('\nWhich server wins');

{
  const h = harness();
  h.rememberTurnResult('c1', IR, { rtt: 60, lossPercent: 0 });
  h.rememberTurnResult('c1', DE, { rtt: 190, lossPercent: 0 });
  ok(h.bestTurnLabelFor('c1') === IR, 'the lower round trip wins when the loss is equal');
}

/* Loss is weighted the way callQualityLevel already weighs it against round
   trip, so a nearer server that drops packets does not win on distance alone. */
{
  const h = harness();
  h.rememberTurnResult('c1', IR, { rtt: 60, lossPercent: 3 });
  h.rememberTurnResult('c1', DE, { rtt: 190, lossPercent: 0 });
  ok(h.bestTurnLabelFor('c1') === DE,
    `three percent of loss outweighs 130 ms of distance at ${h.TURN_LOSS_WEIGHT} ms per percent`);
  ok(h.bestTurnLabelFor('nobody') === '', 'a contact never called has no answer, not a guess');
}

/* Per contact, which is the whole reason for this rather than one global
   choice: a device with a near TURN and a far one has two right answers. */
{
  const h = harness();
  h.rememberTurnResult('tehran', IR, { rtt: 40, lossPercent: 0 });
  h.rememberTurnResult('tehran', DE, { rtt: 200, lossPercent: 0 });
  h.rememberTurnResult('berlin', IR, { rtt: 300, lossPercent: 0 });
  h.rememberTurnResult('berlin', DE, { rtt: 30, lossPercent: 0 });
  ok(h.bestTurnLabelFor('tehran') === IR && h.bestTurnLabelFor('berlin') === DE,
    'two contacts get two different answers from the same device');
}

{
  const h = harness();
  for (let i = 0; i < h.TURN_MEMORY_CONTACTS + 10; i += 1) {
    h.rememberTurnResult(`c${i}`, IR, { rtt: 50 + i, lossPercent: 0 });
  }
  ok(Object.keys(h.turnMemory()).length === h.TURN_MEMORY_CONTACTS,
    `a long address book does not grow this without bound (${h.TURN_MEMORY_CONTACTS} kept)`);
  ok(Boolean(h.turnMemory()[`c${h.TURN_MEMORY_CONTACTS + 9}`]),
    'and what it keeps is the most recent, not the first it happened to see');
}

console.log('\nThe nudge at the start');

const serversFor = (...labels) => [{
  urls: labels.map((label) => `${label}?transport=udp`), username: 'u', credential: 'p',
}, { urls: 'stun:stun.example.com:3478' }];

{
  const h = harness();
  h.rememberTurnResult('c1', DE, { rtt: 40, lossPercent: 0 });
  const ordered = h.orderIceServersFor('c1', serversFor(IR, DE));
  ok(h.turnUrlLabel(ordered[0].urls[0]) === DE, 'the remembered server goes first');
  ok(ordered[0].urls.length === 2, 'and nothing is removed — a slow server beats no call');
  ok(ordered[1].urls === 'stun:stun.example.com:3478', 'entries with no TURN in them are untouched');
}

{
  const h = harness();
  const servers = serversFor(IR, DE);
  ok(h.orderIceServersFor('never-called', servers) === servers,
    'with nothing remembered the list is handed back exactly as it was');
  h.rememberTurnResult('c1', 'turn:somewhere.else:3478', { rtt: 10 });
  ok(h.orderIceServersFor('c1', servers) === servers,
    'and a memory of a server that is no longer configured changes nothing');
}

{
  const h = harness();
  h.rememberTurnResult('c1', DE, { rtt: 40 });
  h.configured.iceServers = serversFor(IR, DE);
  h.chatState.peer.options.config.iceServers = h.configured.iceServers;
  ok(h.prepareIceForContact({ fingerprint: 'c1' }) === true,
    'the list PeerJS is about to read is the one that gets reordered');
  ok(h.turnUrlLabel(h.chatState.peer.options.config.iceServers[0].urls[0]) === DE,
    'and it really was written there');

  /* The peer object is shared by every call. Preparing for somebody with no
     history has to put the configured order back, or "per contact" is really
     "whatever the last call left behind". */
  ok(h.prepareIceForContact({ fingerprint: 'never-called' }) === false,
    'a contact with no history is not reported as a change');
  ok(h.turnUrlLabel(h.chatState.peer.options.config.iceServers[0].urls[0]) === IR,
    'and the configured order is put back rather than the previous contact kept');

  h.chatState.peer = {};
  ok(h.prepareIceForContact({ fingerprint: 'c1' }) === false,
    'a library that no longer exposes it loses the nudge and keeps the call');
}

console.log('\nMoving a call that is already bad');

function pcFor(labels) {
  const config = { iceServers: serversFor(...labels) };
  const applied = [];
  let restarts = 0;
  return {
    getConfiguration: () => config,
    setConfiguration: (next) => applied.push(next),
    restartIce: () => { restarts += 1; },
    applied,
    restarts: () => restarts,
  };
}
const badReading = { route: 'local', relayServer: IR, rtt: 900, lossPercent: 12 };

{
  const h = harness({ quality: () => 'bad' });
  const pc = pcFor([IR, DE]);
  for (let i = 0; i < h.TURN_SWITCH_AFTER_BAD - 1; i += 1) await h.adaptCallRoute(pc, badReading);
  ok(pc.restarts() === 0,
    `${h.TURN_SWITCH_AFTER_BAD - 1} poor samples are not enough — one hiccup must not cost a gap in the audio`);
  await h.adaptCallRoute(pc, badReading);
  ok(pc.restarts() === 1, `the ${h.TURN_SWITCH_AFTER_BAD}th is`);
  ok(h.turnUrlLabel(pc.applied[0].iceServers[0].urls[0]) === DE,
    'and the other server is put in front before ICE is restarted');
  for (let i = 0; i < h.TURN_SWITCH_AFTER_BAD * 2; i += 1) await h.adaptCallRoute(pc, badReading);
  ok(pc.restarts() === 1, 'it happens at most once in a call — two gaps are worse than a poor call');
}

{
  const h = harness({ quality: () => 'bad' });
  const pc = pcFor([IR]);
  for (let i = 0; i < h.TURN_SWITCH_AFTER_BAD * 2; i += 1) await h.adaptCallRoute(pc, badReading);
  ok(pc.restarts() === 0, 'with only one TURN configured there is nowhere to go, so nothing moves');
}

{
  const h = harness({ quality: () => 'bad' });
  const pc = pcFor([IR, DE]);
  const direct = { route: 'direct', relayServer: '', rtt: 900, lossPercent: 12 };
  for (let i = 0; i < h.TURN_SWITCH_AFTER_BAD * 2; i += 1) await h.adaptCallRoute(pc, direct);
  ok(pc.restarts() === 0,
    'a bad call that is not going through a TURN at all is not a TURN problem');
}

/* A run of poor samples broken by a good one starts again: what this is for is
   a path that is persistently bad, not one that stumbled. */
{
  const h = harness({ quality: () => 'bad' });
  const pc = pcFor([IR, DE]);
  for (let i = 0; i < h.TURN_SWITCH_AFTER_BAD - 1; i += 1) await h.adaptCallRoute(pc, badReading);
  h.grade.of = () => 'good';
  await h.adaptCallRoute(pc, { route: 'local', relayServer: IR, rtt: 40, lossPercent: 0 });
  h.grade.of = () => 'bad';
  await h.adaptCallRoute(pc, badReading);
  ok(pc.restarts() === 0, 'a good sample in between resets the count');
  for (let i = 0; i < h.TURN_SWITCH_AFTER_BAD - 1; i += 1) await h.adaptCallRoute(pc, badReading);
  ok(pc.restarts() === 1, 'and a fresh run of poor ones still moves it');
}

{
  const h = harness({ quality: () => 'bad' });
  const pc = pcFor([IR, DE]);
  for (let i = 0; i < h.TURN_SWITCH_AFTER_BAD; i += 1) await h.adaptCallRoute(pc, badReading);
  ok(h.notices.length === 1,
    'and the person is told once, because the audio is about to stop for a moment');
  ok(Number.isFinite(h.turnMemory()['contact-1'][IR].rtt),
    'while what the poor path measured is remembered, so the next call starts elsewhere');
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
