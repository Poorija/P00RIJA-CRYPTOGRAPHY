/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What two linked relays answer besides carrying mail, and what one of them
 * does when the link between them blinks.
 *
 *   - an envelope sent while the link is redialling is carried once the link
 *     is back, not refused (the park path once called send on a null link and
 *     turned every such envelope into "transit-failed");
 *   - a far relay answers "does this person live here?" (route-query) for one
 *     fingerprint, and mints a short-lived TURN credential (turn-query) that
 *     coturn's REST scheme accepts;
 *   - GET /transit-peers lists the linked relays with the key to seal to;
 *   - a queued reply says whether the recipient is known where it was queued;
 *   - the device beacon store: owner-only, size-capped, and it tells the
 *     account's other live devices that something changed.
 *
 * Both relays are scripts/server.js, started for real on loopback.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
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

const children = new Set();
process.on('exit', () => {
  for (const child of children) { try { child.kill('SIGKILL'); } catch (_error) { /* gone */ } }
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
async function relayPorts(count) {
  const ports = [];
  while (ports.length < count * 2) {
    const port = await freePort();
    if (!ports.includes(port)) ports.push(port);
  }
  return Array.from({ length: count }, (_unused, index) => ({ signal: ports[index * 2], presence: ports[index * 2 + 1] }));
}
async function fetchJson(url, ms = 4000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}
function seed(identity) {
  const dir = mkdtempSync(join(tmpdir(), 'poorija-tq-'));
  writeFileSync(join(dir, 'relay-identity.json'), JSON.stringify(identity, null, 2), { mode: 0o600 });
  return dir;
}

const TURN_SECRET = 'a'.repeat(64);

async function start(dir, ports, transitPeers, extraEnv = {}) {
  const child = spawn(process.execPath, ['scripts/server.js'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CHAT_SIGNAL_HOST: '127.0.0.1',
      /* The origin a route answer names is only learned for this deployment's
         own DOMAIN, so the loopback host the suite reaches it at is that. */
      DOMAIN: '127.0.0.1',
      CHAT_SIGNAL_PORT: String(ports.signal),
      CHAT_PRESENCE_PORT: String(ports.presence),
      CHAT_BOOTSTRAP_PORT: '0',
      PORT: String(ports.signal),
      MONITOR_PASSWORD: 'Local-Test-Only-Password-36',
      TURN_USER: 'local-test',
      TURN_PASSWORD: 'Local-Test-Only-Turn-36',
      CHAT_TURN_URL: 'turn:127.0.0.1:3478?transport=udp,turns:127.0.0.1:5349?transport=tcp',
      CHAT_OFFLINE_STORE_PATH: join(dir, 'offline-messages.json'),
      CHAT_PUSH_STORE_PATH: join(dir, 'push.json'),
      CHAT_VAPID_STORE_PATH: join(dir, 'vapid.json'),
      CHAT_POLICY_STORE_PATH: join(dir, 'policy.json'),
      CHAT_SELF_DESTRUCT_STORE_PATH: join(dir, 'self-destruct.json'),
      CHAT_EXPIRY_LOG_PATH: join(dir, 'expiry.json'),
      CHAT_TRANSIT_PEERS: transitPeers,
      ...extraEnv,
    },
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`relay exited early:\n${output}`);
    try {
      await fetchJson(`http://127.0.0.1:${ports.signal}/chat-health`, 1000);
      return { child, ports, log: () => output };
    } catch (_error) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`relay never answered:\n${output}`);
}
async function stop(relay) {
  if (!relay?.child || relay.child.exitCode !== null) return;
  const gone = new Promise((resolve) => relay.child.once('exit', resolve));
  relay.child.kill('SIGTERM');
  await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))]);
}

function connectClient(presencePort, name, identity = relayTestIdentity()) {
  const socket = new WebSocket(`ws://127.0.0.1:${presencePort}/chat-signal`);
  const inbox = [];
  const waiters = [];
  let proven = false;
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
    if (answerRelayChallenge(message, identity, socket)) { proven = true; return; }
    inbox.push(message);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].match(message)) waiters.splice(i, 1)[0].resolve(message);
    }
  });
  const ready = new Promise((resolve, reject) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'hello', clientId: name, username: name, peerId: name, deviceId: name,
        publicKeyData: identity.publicKeyData, fingerprint: identity.fingerprint,
      }));
      resolve();
    });
    socket.on('error', reject);
  });
  return {
    identity,
    ready,
    proven: () => proven,
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
          reject(new Error(`nothing matched within ${ms}ms; saw ${JSON.stringify(inbox.slice(-4)).slice(0, 300)}`));
        }, ms);
      });
    },
    close: () => { try { socket.close(); } catch (_error) { /* gone */ } },
  };
}
const attempt = async (promise) => promise.then((value) => value).catch((error) => ({ error: error.message }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForLink(port, want = 1) {
  for (let i = 0; i < 150; i += 1) {
    const body = await fetchJson(`http://127.0.0.1:${port}/chat-health`).catch(() => null);
    if ((body?.transit?.up || 0) >= want) return true;
    await sleep(100);
  }
  return false;
}

const A = ids.generateRelayIdentity();
const B = ids.generateRelayIdentity();
const [portsA, portsB] = await relayPorts(2);
const dirA = seed(A);
const dirB = seed(B);

/* A dials B; B only answers — the same shape as Iran dialling Finland. */
let relayA = await start(dirA, portsA, `${B.id}@http://127.0.0.1:${portsB.signal}`);
let relayB = await start(dirB, portsB, A.id, { TURN_SECRET });
ok(await waitForLink(portsA.signal), 'the two relays link');

const recipient = connectClient(portsB.presence, 'recipient-on-b');
const sender = connectClient(portsA.presence, 'sender-on-a');
await recipient.ready;
await sender.ready;
await sleep(700);

console.log('\nThe far relay answers questions about one fingerprint');
{
  const health = await fetchJson(`http://127.0.0.1:${portsB.signal}/chat-health`);
  const envelope = transit.sealTransit(B.id, B.keys.p256.publicKey,
    { type: 'route-query', toFingerprint: recipient.identity.fingerprint });
  sender.send({ ...envelope, tag: 'route-home' });
  const answer = await attempt(sender.waitFor((message) => message.tag === 'route-home'));
  ok(answer?.type === 'route' && answer.home === true && answer.up === true,
    `a proven, connected recipient lives there (${JSON.stringify(answer).slice(0, 120)})`);
  ok(answer?.origin === health.peerOrigin, `and the answer names the origin to file the route under (${answer?.origin})`);

  /* A request naming some other host must not become what the relay tells
     a linked relay's clients. */
  await new Promise((resolve) => {
    const req = require('node:http').request({ host: '127.0.0.1', port: portsB.signal, path: '/chat-health', headers: { Host: 'attacker.example:443' } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.end();
  });
  sender.send({ ...envelope, tag: 'route-home-2' });
  const again = await attempt(sender.waitFor((message) => message.tag === 'route-home-2'));
  ok(again?.origin === health.peerOrigin, `a spoofed Host header does not change the origin it names (${again?.origin})`);

  const stranger = relayTestIdentity();
  const askStranger = transit.sealTransit(B.id, B.keys.p256.publicKey,
    { type: 'route-query', toFingerprint: stranger.fingerprint });
  sender.send({ ...askStranger, tag: 'route-stranger' });
  const no = await attempt(sender.waitFor((message) => message.tag === 'route-stranger'));
  ok(no?.type === 'route' && no.home === false && no.origin === '',
    'somebody who never proved a key there does not, and no origin is offered');
}

{
  const envelope = transit.sealTransit(B.id, B.keys.p256.publicKey, { type: 'turn-query' });
  sender.send({ ...envelope, tag: 'turn' });
  const answer = await attempt(sender.waitFor((message) => message.tag === 'turn'));
  ok(answer?.type === 'turn' && answer.enabled === true && Array.isArray(answer.urls) && answer.urls.length === 2,
    `a TURN credential for the far relay comes back (${answer?.urls?.length || 0} urls)`);
  const [expiry] = String(answer?.username || '').split(':');
  ok(Number(expiry) > Date.now() / 1000 + 600, 'its username is an expiry in the future, the TURN REST shape');
  const expected = crypto.createHmac('sha1', TURN_SECRET).update(String(answer?.username || '')).digest('base64');
  ok(answer?.credential === expected, 'and its credential is the HMAC coturn will check');
  ok(answer?.credential !== 'Local-Test-Only-Turn-36', 'the static coturn password is never what is handed out');

  const direct = await fetchJson(`http://127.0.0.1:${portsB.signal}/turn-config`);
  ok(direct.username !== 'local-test' && /^\d+:[0-9a-f]+$/.test(direct.username),
    '/turn-config itself mints an expiring credential when the secret is set');
  const legacy = await fetchJson(`http://127.0.0.1:${portsA.signal}/turn-config`);
  ok(legacy.username === 'local-test', 'and a relay without a secret still serves its static pair');
}

{
  const peers = await fetchJson(`http://127.0.0.1:${portsA.signal}/transit-peers`);
  ok(peers?.self === A.id && peers.peers?.length === 1 && peers.peers[0].id === B.id,
    'GET /transit-peers lists the linked relay');
  ok(peers.peers[0].key === B.keys.p256.publicKey, 'with the key that seals to it, as proven in the handshake');
  const peersB = await fetchJson(`http://127.0.0.1:${portsB.signal}/transit-peers`);
  ok(peersB.peers?.[0]?.key === A.keys.p256.publicKey, 'and the answering side learned the dialler\'s key the same way');
}

console.log('\nWhat a queued reply says about the recipient');
{
  const absentKnown = recipient.identity.fingerprint;
  const inner = { type: 'relay', toFingerprint: relayTestIdentity().fingerprint, persist: true, tag: 'unknown', payload: { type: 'offline-chat', inner: 'text' } };
  sender.send({ ...transit.sealTransit(B.id, B.keys.p256.publicKey, inner), tag: 'unknown' });
  const answer = await attempt(sender.waitFor((message) => message.tag === 'unknown'));
  ok(answer?.type === 'queued' && answer.known === false,
    `mail for somebody the far relay has never met is queued and flagged unknown (${answer?.known})`);
  const live = { type: 'relay', toFingerprint: absentKnown, persist: true, tag: 'known', payload: { type: 'offline-chat', inner: 'text' } };
  sender.send({ ...transit.sealTransit(B.id, B.keys.p256.publicKey, live), tag: 'known' });
  const known = await attempt(sender.waitFor((message) => message.tag === 'known'));
  ok(known?.type === 'queued' && known.known === true, 'and for somebody who lives there it is flagged known');
}

console.log('\nThe device beacon');
{
  const sibling = connectClient(portsB.presence, 'sibling-on-b', recipient.identity);
  await sibling.ready;
  await sleep(500);
  const blob = Buffer.alloc(2048, 7).toString('base64');
  recipient.send({ type: 'beacon-put', deviceId: 'device-one', blob });
  const stored = await attempt(recipient.waitFor((message) => message.type === 'beacon-stored'));
  ok(stored?.deviceId === 'device-one', 'a verified device stores its beacon');
  const nudge = await attempt(sibling.waitFor((message) => message.type === 'beacon-changed'));
  ok(nudge?.deviceId === 'device-one', 'and the account\'s other live device is told it changed');
  sibling.send({ type: 'beacon-get' });
  const got = await attempt(sibling.waitFor((message) => message.type === 'beacons'));
  ok(got?.items?.length === 1 && got.items[0].blob === blob, 'the sibling reads it back intact');

  recipient.send({ type: 'beacon-put', deviceId: 'device-one', blob: 'A'.repeat(20000) });
  const refused = await attempt(recipient.waitFor((message) => message.reason === 'beacon-refused'));
  ok(refused?.reason === 'beacon-refused', 'a beacon over the size cap is refused — it can never become a mailbox');

  const stranger = connectClient(portsB.presence, 'someone-else');
  await stranger.ready;
  await sleep(500);
  stranger.send({ type: 'beacon-get' });
  const theirs = await attempt(stranger.waitFor((message) => message.type === 'beacons'));
  ok(theirs?.items?.length === 0, 'another account sees none of them');

  const onDisk = readdirSync(join(dirB, 'beacons')).map((name) => readFileSync(join(dirB, 'beacons', name), 'utf8')).join('');
  ok(onDisk.includes(blob) && !onDisk.includes('device-two'), 'what is on disk is the opaque blob the device sent');
  sibling.close();
  stranger.close();
}

console.log('\nAn envelope sent while the link redials');
{
  /* B goes away and comes back on the same port and identity, the way a
     deployment restarts it. A redials on its own; an envelope handed over in
     the gap must wait for the link and then go, not fail. */
  await stop(relayB);
  await sleep(300);
  const late = relayTestIdentity();
  const inner = { type: 'relay', toFingerprint: late.fingerprint, persist: true, tag: 'parked', payload: { type: 'offline-chat', inner: 'text', body: 'sent during the redial' } };
  sender.send({ ...transit.sealTransit(B.id, B.keys.p256.publicKey, inner), tag: 'parked' });
  await sleep(1200);
  relayB = await start(dirB, portsB, A.id, { TURN_SECRET });
  const answer = await attempt(sender.waitFor((message) => message.tag === 'parked', 20000));
  ok(answer?.type === 'queued', `the parked envelope is carried once the link is back (${answer?.type || answer?.reason || answer?.error})`);
  ok(!relayA.log().includes("Cannot read properties of null"), 'and the carrier logged no null-link failure');

  const arrived = connectClient(portsB.presence, 'late-arrival', late);
  await arrived.ready;
  const held = await attempt(arrived.waitFor((message) => message.type === 'relay' && message.payload?.body === 'sent during the redial', 10000));
  ok(held?.payload?.body === 'sent during the redial', 'and it is waiting at the far relay for its recipient');
  arrived.close();
}

console.log('\nWhat the carrier and the store keep on disk');
{
  const config = existsSync(join(dirB, 'server-config.json')) ? readFileSync(join(dirB, 'server-config.json'), 'utf8') : '';
  ok(!config.includes('Local-Test-Only-Password-36'), 'the monitor password is not written to disk in the clear');
  const wrote = readdirSync(dirA).filter((name) => name !== 'relay-identity.json' && !name.startsWith('.'))
    .map((name) => { try { return readFileSync(join(dirA, name), 'utf8'); } catch (_error) { return ''; } }).join('');
  ok(!wrote.includes('sent during the redial'), 'the carrier wrote down nothing it carried');
}

sender.close();
recipient.close();
await stop(relayA);
await stop(relayB);

console.log(`\n${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
