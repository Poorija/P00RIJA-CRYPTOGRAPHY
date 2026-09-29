/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A message crossing two relays, and the carrier learning nothing from it.
 *
 * The envelope is sealed to the RECIPIENT'S relay before it is handed over,
 * so the relay that carries it cannot open it and cannot know who it is for.
 * That is easy to assert about a function and easy to get wrong in a running
 * system, where the carrier also has a mailbox, a push sender and a disk.
 *
 * So both relays are started for real, a real client socket connects to each,
 * and the questions asked afterwards are the ones that matter: did it arrive,
 * and what did the carrier end up holding? The second is checked against the
 * carrier's actual mailbox and its actual data directory, not against an
 * intention.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createRequire } from 'node:module';
import { mirrorRelayLib } from './_relay-lib.mjs';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { WebSocket } = require('ws');
const ids = require(join(ROOT, 'scripts', 'lib', 'relay-identity.js'));
const transit = require(join(ROOT, 'scripts', 'lib', 'relay-transit.js'));

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

const restoreRelayLib = mirrorRelayLib();
const children = [];
process.on('exit', () => {
  for (const child of children) { try { child.kill('SIGKILL'); } catch (_error) { /* gone */ } }
  restoreRelayLib();
});

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

/* Distinct ports for everything: the presence server answers no HTTP at all,
   so a health check that lands on one by collision waits for ever. */
async function relayPorts(count) {
  const ports = [];
  while (ports.length < count * 2) {
    const port = await freePort();
    if (!ports.includes(port)) ports.push(port);
  }
  return Array.from({ length: count }, (_unused, index) => ({
    signal: ports[index * 2], presence: ports[index * 2 + 1],
  }));
}

async function fetchJson(url, ms = 4000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

function seed(identity) {
  const dir = mkdtempSync(join(tmpdir(), 'poorija-transit-'));
  writeFileSync(join(dir, 'relay-identity.json'), JSON.stringify(identity, null, 2), { mode: 0o600 });
  return dir;
}

async function start(file, dir, ports, transitPeers) {
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CHAT_SIGNAL_HOST: '127.0.0.1',
      CHAT_SIGNAL_PORT: String(ports.signal),
      CHAT_PRESENCE_PORT: String(ports.presence),
      PORT: String(ports.signal),
      MONITOR_PASSWORD: 'Local-Test-Only-Password-36',
      TURN_USER: 'local-test',
      TURN_PASSWORD: 'Local-Test-Only-Turn-36',
      CHAT_OFFLINE_STORE_PATH: join(dir, 'offline-messages.json'),
      CHAT_PUSH_STORE_PATH: join(dir, 'push.json'),
      CHAT_VAPID_STORE_PATH: join(dir, 'vapid.json'),
      CHAT_POLICY_STORE_PATH: join(dir, 'policy.json'),
      CHAT_SELF_DESTRUCT_STORE_PATH: join(dir, 'self-destruct.json'),
      CHAT_TRANSIT_PEERS: transitPeers,
    },
  });
  children.push(child);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${file} exited early:\n${output}`);
    try {
      await fetchJson(`http://127.0.0.1:${ports.signal}/chat-health`, 1000);
      return { child, ports, log: () => output };
    } catch (_error) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${file} never answered:\n${output}`);
}

/* A client socket that proves the identity it claims, the way a real one
   does — a fingerprint the relay has not challenged cannot be delivered to. */
function connectClient(presencePort, name) {
  const identity = relayTestIdentity();
  const socket = new WebSocket(`ws://127.0.0.1:${presencePort}/chat-signal`);
  const inbox = [];
  const waiters = [];
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
    if (answerRelayChallenge(message, identity, socket)) return;
    inbox.push(message);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].match(message)) { waiters.splice(i, 1)[0].resolve(message); }
    }
  });
  const ready = new Promise((resolve, reject) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'hello',
        clientId: name,
        username: name,
        peerId: name,
        publicKeyData: identity.publicKeyData,
        fingerprint: identity.fingerprint,
      }));
      resolve();
    });
    socket.on('error', reject);
  });
  return {
    identity,
    socket,
    ready,
    send: (payload) => socket.send(JSON.stringify(payload)),
    waitFor(match, ms = 8000) {
      const found = inbox.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error(`nothing matched within ${ms}ms; saw ${JSON.stringify(inbox).slice(0, 300)}`));
        }, ms);
      });
    },
    close: () => { try { socket.close(); } catch (_error) { /* gone */ } },
  };
}

const attempt = async (promise) => promise.then((value) => value).catch((error) => ({ error: error.message }));

/* ---- two relays, one message, across ---------------------------------- */

console.log('\nAcross two relays');

const A = ids.generateRelayIdentity();
const B = ids.generateRelayIdentity();
const [portsA, portsB] = await relayPorts(2);
const dirA = seed(A);
const dirB = seed(B);

const relayA = await start('scripts/server.js', dirA, portsA, `${B.id}@http://127.0.0.1:${portsB.signal}`);
const relayB = await start('standalone-relay/server.js', dirB, portsB, A.id);

for (let i = 0; i < 100; i += 1) {
  const body = await fetchJson(`http://127.0.0.1:${portsA.signal}/chat-health`).catch(() => null);
  if (body?.transit?.up >= 1) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const sender = connectClient(portsA.presence, 'sender-on-a');
const recipient = connectClient(portsB.presence, 'recipient-on-b');
await sender.ready;
await recipient.ready;
await recipient.waitFor((message) => message.type === 'welcome');
await sender.waitFor((message) => message.type === 'welcome');
/* The relay only routes to a fingerprint it has challenged, so wait until the
   proof has been exchanged rather than racing it. */
await new Promise((resolve) => setTimeout(resolve, 600));

const INNER_BODY = 'this text is sealed to the recipient, not to the carrier';

{
  const inner = {
    type: 'relay',
    toFingerprint: recipient.identity.fingerprint,
    persist: false,
    tag: 'inner-tag',
    payload: { type: 'text', inner: 'text', body: INNER_BODY, fromFingerprint: sender.identity.fingerprint },
  };
  const envelope = transit.sealTransit(B.id, B.keys.p256.publicKey, inner);
  sender.send({ ...envelope, tag: 'outer-tag' });

  const arrived = await attempt(recipient.waitFor((message) => message.type === 'relay'));
  ok(arrived?.payload?.body === INNER_BODY,
    'a message sealed to the far relay arrives at somebody connected to it');
  ok(arrived?.fromFingerprint === '',
    'and the relay does not vouch for a sender it never challenged');
  ok(arrived?.payload?.fromFingerprint === sender.identity.fingerprint,
    'while the sender the recipient can verify is the one inside the payload');
}

/* What the carrier is holding afterwards. Asked of the running relay and of
   its data directory, because an intention is not an answer. */
{
  /* Asked of the disk rather than of a status field, because what a relay
     could be made to hand over is what is on its disk. */
  const wrote = readdirSync(dirA)
    .filter((name) => name !== 'relay-identity.json')
    .map((name) => readFileSync(join(dirA, name), 'utf8'))
    .join('');
  ok(!wrote.includes(recipient.identity.fingerprint),
    'the recipient the carrier carried for is nowhere in anything it wrote down');
  ok(!wrote.includes(INNER_BODY), 'nor is anything that was inside the envelope');
  ok(!wrote.includes(B.id), 'nor even which relay it went to');
  const mailbox = join(dirA, 'offline-messages.json');
  ok(!existsSync(mailbox) || readFileSync(mailbox, 'utf8').replace(/[\s{}\[\]]/g, '') === '',
    'and its mailbox is empty — a relay that stores nothing has nothing to hand over');
}

console.log('\nWhen it cannot be carried');

/* A sender who believes they are going through a carrier and is not would
   make a different decision about what to send, so the refusal is explicit
   rather than a silent fallback. */
{
  const other = ids.generateRelayIdentity();
  const envelope = transit.sealTransit(other.id, other.keys.p256.publicKey, { type: 'relay', toFingerprint: 'x' });
  sender.send({ ...envelope, tag: 'no-link' });
  const answer = await attempt(sender.waitFor((message) => message.tag === 'no-link'));
  ok(answer?.reason === 'transit-unavailable',
    `a relay with no link to the named one says so (${answer?.reason || answer?.error})`);
}

{
  const envelope = transit.sealTransit(A.id, A.keys.p256.publicKey, { type: 'relay', toFingerprint: 'x' });
  sender.send({ ...envelope, tag: 'loop' });
  const answer = await attempt(sender.waitFor((message) => message.tag === 'loop'));
  ok(answer?.reason === 'transit-loop',
    `an envelope addressed to the carrier itself is refused rather than quietly opened (${answer?.reason || answer?.error})`);
}

/* An envelope the far relay cannot open. Every refusal reads the same from
   here: saying WHY would tell a carrier something about what was inside. */
{
  const wrong = ids.generateRelayIdentity();
  const envelope = transit.sealTransit(B.id, wrong.keys.p256.publicKey, { type: 'relay', toFingerprint: 'x' });
  sender.send({ ...envelope, tag: 'unopenable' });
  const answer = await attempt(sender.waitFor((message) => message.tag === 'unopenable'));
  ok(answer?.reason === 'transit-rejected',
    `an envelope the far relay cannot open comes back refused (${answer?.reason || answer?.error})`);
}

{
  sender.send({ type: 'transit', v: 1, tag: 'no-relay', eph: '', iv: '', ct: '' });
  const answer = await attempt(sender.waitFor((message) => message.tag === 'no-relay'));
  ok(answer?.reason === 'transit-no-relay', 'and an envelope that names no relay goes nowhere');
}

/* The recipient's mailbox, for somebody who is not connected: the far relay
   runs its ordinary delivery on what it opened, which is the point of the
   envelope being byte for byte an ordinary one. */
{
  const absent = relayTestIdentity();
  const inner = {
    type: 'relay',
    toFingerprint: absent.fingerprint,
    persist: true,
    tag: 'stored',
    payload: { type: 'text', inner: 'text', body: 'for somebody who is away' },
  };
  const envelope = transit.sealTransit(B.id, B.keys.p256.publicKey, inner);
  sender.send({ ...envelope, tag: 'queued-outer' });
  const answer = await attempt(sender.waitFor((message) => message.tag === 'queued-outer'));
  ok(answer?.type === 'queued',
    `a carried message for an absent recipient is queued at the far end (${answer?.type || answer?.error})`);

  /* Where it was queued, asked the way it actually matters: the person walks
     in, and it is waiting for them. */
  const late = new WebSocket(`ws://127.0.0.1:${portsB.presence}/chat-signal`);
  const held = await attempt(new Promise((resolve, reject) => {
    late.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (answerRelayChallenge(message, absent, late)) return;
      if (message.type === 'relay' && message.payload?.body === 'for somebody who is away') resolve(message);
    });
    late.on('open', () => late.send(JSON.stringify({
      type: 'hello',
      clientId: 'late-arrival',
      username: 'late-arrival',
      peerId: 'late-arrival',
      publicKeyData: absent.publicKeyData,
      fingerprint: absent.fingerprint,
    })));
    late.on('error', reject);
    setTimeout(() => reject(new Error('nothing was waiting')), 8000);
  }));
  ok(held?.payload?.body === 'for somebody who is away',
    'and it is waiting in the RECIPIENT relay when they connect to it');
  try { late.close(); } catch (_error) { /* gone */ }

  const carrierMailbox = join(dirA, 'offline-messages.json');
  ok(!existsSync(carrierMailbox)
    || !readFileSync(carrierMailbox, 'utf8').includes(absent.fingerprint),
    'while the carrier still holds nothing for them');
}

sender.close();
recipient.close();
relayA.child.kill('SIGTERM');
relayB.child.kill('SIGTERM');
await new Promise((resolve) => setTimeout(resolve, 400));

/* ---- what a peer relay may say to somebody else's client --------------- */

/* The answer to a carried envelope is written by the OTHER relay and lands on
   this relay's socket to its own client. Passing it through unchanged would
   hand a peer relay a frame injector into every client that uses it. */
{
  const source = readFileSync(join(ROOT, 'scripts', 'server.js'), 'utf8');
  const start = source.indexOf('function transitAnswerForClient(');
  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (!depth) { end = i + 1; break; } }
  }
  const forClient = new Function(`${source.slice(start, end)}\nreturn transitAnswerForClient;`)();

  ok(forClient({ type: 'server-kicked', permanent: true }).type === 'error',
    'a peer cannot tell this relay\'s client it has been kicked');
  ok(forClient({ type: 'id-challenge', cipher: 'x' }).type === 'error',
    'nor challenge it for its identity key');
  ok(forClient({ type: 'relay', payload: { body: 'injected' } }).type === 'error',
    'nor deliver a message of its own invention');
  ok(JSON.stringify(forClient({ type: 'queued', toFingerprint: 'a'.repeat(64), count: 2, extra: 'x' }))
    === JSON.stringify({ type: 'queued', toFingerprint: 'a'.repeat(64), count: 2 }),
    'a queue confirmation is rebuilt field by field, and anything extra is dropped');
  ok(forClient({ type: 'error', reason: 'target-offline' }).reason === 'target-offline',
    'a refusal this relay would have sent itself is passed on as itself');
  ok(forClient({ type: 'error', reason: 'identity-unverified' }).reason === 'transit-rejected',
    'and one it would not is flattened rather than invented');
}

/* ---- the client deciding which way to send ---------------------------- */

console.log('\nWhich way the client sends');

{
  const source = readFileSync(join(ROOT, 'js', 'chat', '29-file-transfer.js'), 'utf8');
  const peersSource = readFileSync(join(ROOT, 'js', 'chat', '18-file-manager-2.js'), 'utf8');
  const extract = (text, name) => {
    const start = text.search(new RegExp(`(async )?function ${name}\\(`));
    if (start < 0) throw new Error(`${name} is gone`);
    let depth = 0;
    for (let i = text.indexOf('{', text.indexOf(')', start)); i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') { depth -= 1; if (!depth) return text.slice(start, i + 1); }
    }
    throw new Error(`${name} is not closed`);
  };
  const ranks = peersSource.match(/^const HOME_RELAY_TRUST = .*;$/m)[0];
  const route = (pinnedId) => new Function('routableHomeRelay', 'relayPinFor', 'chatServerOrigin', `
    ${extract(source, 'transitRouteFor')}
    return transitRouteFor;
  `)(
    new Function('isUsableRelayOrigin', 'normalizeRelayOrigin', `
      ${ranks}
      ${extract(peersSource, 'normalizeHomeRelay')}
      ${extract(peersSource, 'routableHomeRelay')}
      return routableHomeRelay;
    `)(() => true, (value) => value),
    () => ({ id: pinnedId }),
    () => 'https://mine.example',
  );

  const KEY = Buffer.alloc(91, 3).toString('base64');
  const HERE = 'a'.repeat(64);
  const THERE = 'b'.repeat(64);
  const card = (id) => ({ homeRelay: { origin: 'https://theirs.example', id, key: KEY, source: 'card' } });

  ok(route(HERE)(card(THERE))?.id === THERE,
    'a contact on another relay is sent through it');
  ok(route(HERE)(card(HERE)) === null,
    'a contact on this same relay goes the ordinary way — nothing to carry');
  ok(route(HERE)({}) === null, 'and so does one with no home relay recorded');
  ok(route(HERE)({ homeRelay: { origin: 'https://theirs.example', id: THERE, key: KEY, source: 'presence' } }) === null,
    'a home relay that only a hello claimed is not routed on');
  ok(route(HERE)({ homeRelay: { origin: 'https://theirs.example', id: THERE, source: 'card' } }) === null,
    'nor is one with no key to seal to');
  /* Without a pinned id for the relay in hand there is nothing to compare
     against, and guessing wrong sends every message the long way round. */
  ok(route('')(card(THERE)) === null,
    'and a device that has not pinned its own relay yet does not guess');
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
