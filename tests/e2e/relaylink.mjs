/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Two relays that know which relay they are talking to.
 *
 * TLS says which hostname answered. An id in a frame says which id somebody
 * was willing to type. Neither is the question. The question is whether the
 * far end holds the private half of the key its name is the hash of, and the
 * answer has to survive a machine sitting in the middle — which is not
 * hypothetical between two relays whose operator signed their own
 * certificates.
 *
 * So the handshake is checked for what it proves, and then two real relays
 * are started and pointed at each other, because a protocol that is correct
 * in a unit test and never links up is worth nothing.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createRequire } from 'node:module';
import { mirrorRelayLib } from './_relay-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const link = require(join(ROOT, 'scripts', 'lib', 'relay-link.js'));
const peers = require(join(ROOT, 'scripts', 'lib', 'relay-peers.js'));
const ids = require(join(ROOT, 'scripts', 'lib', 'relay-identity.js'));

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}
function throws(fn, label) {
  let threw = false;
  try { fn(); } catch (_error) { threw = true; }
  ok(threw, label);
}

const identityOf = (record) => ({ id: record.id, publicKey: record.keys.p256.publicKey });

/* ---- what the handshake proves --------------------------------------- */

console.log('\nThe handshake');

const A = ids.generateRelayIdentity();
const B = ids.generateRelayIdentity();
const M = ids.generateRelayIdentity();
const privA = ids.relayPrivateKey(A);
const privB = ids.relayPrivateKey(B);
const privM = ids.relayPrivateKey(M);

/* `pq` off drives the classical path a relay built before ML-KEM would take:
   no key published, nothing to encapsulate to, and both ends have to notice
   rather than half-negotiate. */
function shake(dialer, dialerPriv, answerer, answererPriv, expectedId = answerer.id, pq = true) {
  const dialerBundle = { ...identityOf(dialer), pqPublicKey: pq ? dialer.keys.mlkem768.publicKey : '' };
  const answererBundle = { ...identityOf(answerer), pqPublicKey: pq ? answerer.keys.mlkem768.publicKey : '' };
  const dialerPq = pq ? ids.relayPqPrivateKey(dialer) : null;
  const answererPq = pq ? ids.relayPqPrivateKey(answerer) : null;
  const started = link.startLink(dialerBundle, answerer.keys.p256.publicKey,
    pq ? answerer.keys.mlkem768.publicKey : '');
  const answered = link.answerLink(answererBundle, answererPriv, started.hello, answererPq);
  const finished = link.finishLink(dialerBundle, dialerPriv, started.state, answered.proof,
    expectedId, dialerPq);
  const confirmed = link.confirmLink(answered.state, finished.answer);
  return { started, answered, finished, answererKey: confirmed.key, answererHybrid: confirmed.hybrid };
}

{
  const { finished, answererKey, answererHybrid } = shake(A, privA, B, privB);
  ok(finished.key.equals(answererKey), 'both ends derive the same key');
  ok(finished.peerId === B.id, 'and the dialler learns which relay it reached');
  ok(finished.hybrid === true && answererHybrid === true,
    'and both know the post-quantum half was in play');
}

/* The point of a hybrid: it falls only if BOTH halves fall. An adversary
   recording today and breaking P-256 in twenty years still needs the ML-KEM
   secrets; one breaking ML-KEM still needs the ECDH ones. */
{
  const hybrid = shake(A, privA, B, privB, B.id, true);
  const classical = shake(A, privA, B, privB, B.id, false);
  ok(classical.finished.hybrid === false && classical.finished.key.equals(classical.answererKey),
    'a relay with no post-quantum key still links, classically — an older build is not a broken one');
  ok(!hybrid.finished.key.equals(classical.finished.key),
    'and the two modes derive different keys, so one can never be mistaken for the other');
  ok(link.linkCipher(classical.finished.key, 'dialer') && (() => {
    const mine = link.linkCipher(hybrid.finished.key, 'dialer');
    const theirs = link.linkCipher(classical.answererKey, 'answerer');
    try { theirs.open(mine.seal({ x: 1 })); return false; } catch (_error) { return true; }
  })(), 'a frame from a hybrid link does not open on a classical one');
}

/* A substituted post-quantum key buys nothing, which is why the relay id does
   not have to cover it — and why adding one cannot rename a pinned relay. */
{
  const impostorPq = ids.generateRelayIdentity();
  const dialerBundle = { ...identityOf(A), pqPublicKey: A.keys.mlkem768.publicKey };
  const answererBundle = { ...identityOf(B), pqPublicKey: B.keys.mlkem768.publicKey };
  const started = link.startLink(dialerBundle, B.keys.p256.publicKey, B.keys.mlkem768.publicKey);
  /* Someone in the middle swaps the post-quantum key the dialler advertised
     for one they hold the private half of. */
  const tampered = { ...started.hello, fromPqKey: impostorPq.keys.mlkem768.publicKey };
  const answered = link.answerLink(answererBundle, privB, tampered, ids.relayPqPrivateKey(B));
  const finished = link.finishLink(dialerBundle, privA, started.state, answered.proof,
    B.id, ids.relayPqPrivateKey(A));
  /* ML-KEM decapsulation with the wrong private key does not fail — implicit
     rejection is part of its design, and it returns a different secret
     instead. So the swap does not show up as an error; it shows up as two
     ends that no longer agree, and a link that cannot carry a single frame. */
  ok(!finished.key.equals(link.confirmLink(answered.state, finished.answer).key),
    'swapping the post-quantum key leaves the two ends with different keys');
  const mine = link.linkCipher(finished.key, 'dialer');
  const theirs = link.linkCipher(link.confirmLink(answered.state, finished.answer).key, 'answerer');
  let carried = true;
  try { theirs.open(mine.seal({ x: 1 })); } catch (_error) { carried = false; }
  ok(!carried,
    'so the link carries nothing at all rather than carrying it under a key an attacker influenced');
}

/* The point of the challenge: only the holder of the private half can open
   it, so an impostor that merely knows the public key gets nowhere. */
{
  const started = link.startLink(identityOf(A), B.keys.p256.publicKey);
  throws(() => link.answerLink(identityOf(M), privM, started.hello),
    'a relay that does not hold the key cannot open a challenge sealed to it');
}

/* Claiming somebody else's name. The id is the hash of the key in the same
   frame, so the two cannot be mixed and matched. */
{
  const started = link.startLink(identityOf(A), B.keys.p256.publicKey);
  const lying = { ...started.hello, from: M.id };
  throws(() => link.answerLink(identityOf(B), privB, lying),
    'a hello whose id is not the hash of its key is refused');
}

/* Dialling one relay and being answered by another. Without the expected id
   the answerer is authenticated as itself, which is not what was asked. */
{
  const started = link.startLink(identityOf(A), M.keys.p256.publicKey);
  const answered = link.answerLink(identityOf(M), privM, started.hello);
  throws(() => link.finishLink(identityOf(A), privA, started.state, answered.proof, B.id),
    'a different relay answering than the one dialled is refused');
}

{
  const { started, answered } = shake(A, privA, B, privB);
  const forged = { ...answered.proof, answer: Buffer.alloc(32).toString('base64') };
  throws(() => link.finishLink(identityOf(A), privA, started.state, forged, B.id),
    'a wrong answer to the challenge is refused');
}

/* The dialler must prove itself too, or the link is authenticated one way. */
{
  const { answered } = shake(A, privA, B, privB);
  throws(() => link.confirmLink(answered.state, { answer: Buffer.alloc(32).toString('base64') }),
    'and a dialler that cannot answer the return challenge is refused');
}

/* The reason the key is derived from BOTH exchanges. A machine in the middle
   can pass every frame through untouched and both ends authenticate — each
   other, through it — but it holds neither private half, so the key it would
   need to read or forge a frame is one it cannot compute. */
{
  const left = shake(A, privA, M, privM);
  const right = shake(M, privM, B, privB);
  ok(!left.finished.key.equals(right.finished.key),
    'a machine in the middle ends up with two different keys and can bridge neither');
}

console.log('\nThe frames that follow');

{
  const { finished, answererKey } = shake(A, privA, B, privB);
  const dialer = link.linkCipher(finished.key, 'dialer');
  const answerer = link.linkCipher(answererKey, 'answerer');
  const frame = dialer.seal({ kind: 'transit', body: 'x' });
  ok(answerer.open(frame).body === 'x', 'a frame opens at the other end');
  throws(() => answerer.open(frame), 'and the same frame cannot be played again');
  const back = answerer.seal({ kind: 'ack' });
  ok(dialer.open(back).kind === 'ack', 'the answer comes back the other way');
  throws(() => dialer.open(dialer.seal({ kind: 'mine' })),
    'a frame cannot be reflected at the relay that sent it');
}

{
  const { finished } = shake(A, privA, B, privB);
  const other = shake(A, privA, B, privB);
  const dialer = link.linkCipher(finished.key, 'dialer');
  const foreign = link.linkCipher(other.answererKey, 'answerer');
  throws(() => foreign.open(dialer.seal({ kind: 'transit' })),
    'a frame from one link does not open on another');
}

console.log('\nWho is allowed to link at all');

{
  const id = 'a'.repeat(64);
  const parsed = peers.parseTransitPeers(`${id}@https://relay.example.ir`);
  ok(parsed.length === 1 && parsed[0].origin === 'https://relay.example.ir',
    'a peer is named by identity with an address attached');
  ok(peers.parseTransitPeers(`${'b'.repeat(64)}`)[0]?.origin === '',
    'and an id with no address is one to answer but never dial');
  ok(peers.parseTransitPeers('https://relay.example.ir').length === 0,
    'an address with no identity names nobody — which is the thing relay ids exist to stop');
  ok(peers.parseTransitPeers(`${'c'.repeat(63)}@https://x.example`).length === 0,
    'and a mistyped fingerprint is dropped rather than half-accepted');
  ok(peers.parseTransitPeers('').length === 0, 'nothing configured is nobody allowed');
}

/* ---- two real relays ------------------------------------------------- */

console.log('\nTwo relays, started for real');

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

/* Every port a relay uses, allocated explicitly and kept distinct.
 *
 * Asking for one port and using port+1 for presence is what the single-relay
 * suites do and it is fine there. With two relays it is a trap: the operating
 * system hands out consecutive ports, so one relay's signal port lands on the
 * other's presence port — and the presence server is an http.createServer()
 * with no request listener, which accepts the connection and answers nothing.
 * A health check against it hangs for ever rather than failing, so the suite
 * hung with no output at all. */
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

/* Nothing in this suite may wait for ever. */
async function fetchJson(url, ms = 4000) {
  const stop = AbortSignal.timeout(ms);
  const response = await fetch(url, { signal: stop });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/* The identity is written before the relay starts rather than read after it,
   so each relay can be told the other's id in the same breath. */
function seed(identity) {
  const dir = mkdtempSync(join(tmpdir(), 'poorija-link-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'relay-identity.json'), JSON.stringify(identity, null, 2), { mode: 0o600 });
  return dir;
}

async function start(file, dir, ports, transitPeers) {
  const port = ports.signal;
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CHAT_SIGNAL_HOST: '127.0.0.1',
      CHAT_SIGNAL_PORT: String(port),
      CHAT_PRESENCE_PORT: String(ports.presence),
      PORT: String(port),
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${file} exited early:\n${output}`);
    try {
      await fetchJson(`http://127.0.0.1:${port}/chat-health`, 1000);
      return { child, port, log: () => output };
    } catch (_error) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${file} never answered:\n${output}`);
}

const health = (port) => fetchJson(`http://127.0.0.1:${port}/chat-health`);

function peerJsStillUpgrades(port) {
  const { WebSocket } = require('ws');
  return new Promise((resolve) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/peerjs/peerjs?key=peerjs&id=link-suite&token=link-suite`);
    const settle = (value) => { try { socket.close(); } catch (_error) { /* gone */ } resolve(value); };
    socket.on('open', () => settle(true));
    socket.on('error', () => settle(false));
    setTimeout(() => settle(false), 5000);
  });
}

async function waitForTransit(port, want, tries = 100) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const body = await health(port).catch(() => null);
    if (body?.transit?.up >= want) return body.transit;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return (await health(port).catch(() => ({})))?.transit || null;
}

{
  const [portsA, portsB] = await relayPorts(2);
  const portA = portsA.signal;
  const portB = portsB.signal;
  const dirA = seed(A);
  const dirB = seed(B);

  /* Each names the other. Only A is given an address, so A dials and B only
     answers — the arrangement for a relay that cannot be reached from
     outside. */
  const relayA = await start('scripts/server.js', dirA, portsA, `${B.id}@http://127.0.0.1:${portB}`);
  const relayB = await start('standalone-relay/server.js', dirB, portsB, A.id);

  const upA = await waitForTransit(portA, 1);
  const upB = await waitForTransit(portB, 1);

  ok(upA?.up === 1, `the dialling relay reports the link up (${JSON.stringify(upA)})`);
  ok(upB?.up === 1, `and so does the one that only answers (${JSON.stringify(upB)})`);
  ok(upA?.enabled === true && upA?.allowed === 1, 'with transit enabled for exactly who was named');
  ok(upA?.hybrid === 1 && upB?.hybrid === 1,
    'and the link between two real relays negotiated the post-quantum half');

  /* PeerJS installs its own upgrade listener on the distribution's server and
     answers 400 to any path it does not know, which is what the relay link
     was until its listeners were taken off and routed by hand. Checked here
     because the symptom was a link that never came up with nothing in either
     log to say why. */
  ok(await peerJsStillUpgrades(portB), 'and PeerJS still upgrades beside it');

  relayA.child.kill('SIGTERM');
  relayB.child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/* A relay nobody configured carries for nobody, and says so by refusing the
   socket rather than by letting it hang. */
{
  const [ports] = await relayPorts(1);
  const port = ports.signal;
  const dir = seed(M);
  const relay = await start('standalone-relay/server.js', dir, ports, '');
  const body = await health(port);
  ok(body.transit?.enabled === false, 'a relay with no peers configured has transit off');

  const { WebSocket } = require('ws');
  const refused = await new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/relay-link`);
    socket.on('open', () => { socket.close(); resolve('opened'); });
    socket.on('error', () => resolve('refused'));
  });
  ok(refused === 'refused', 'and refuses a link socket outright rather than leaving it open');
  relay.child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/* Configured, but not for this caller. */
{
  const [ports] = await relayPorts(1);
  const port = ports.signal;
  const dir = seed(B);
  const relay = await start('standalone-relay/server.js', dir, ports, A.id);

  const { WebSocket } = require('ws');
  const outcome = await new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/relay-link`);
    const started = link.startLink(identityOf(M), B.keys.p256.publicKey);
    socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', ...started.hello })));
    socket.on('message', () => resolve('answered'));
    socket.on('close', (code) => resolve(`closed ${code}`));
    socket.on('error', () => resolve('error'));
    setTimeout(() => resolve('hung'), 5000);
  });
  ok(outcome.startsWith('closed'),
    `a relay that is not in the allowlist is turned away (${outcome})`);
  relay.child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/* A link that drops, and whether it comes back on its own.
 *
 * This is the durability question, and the answer used to be no. dial() ran once
 * at start-up and the only retry lived inside its own catch, so a link that
 * succeeded and then dropped was never remade: the far relay restarting for a
 * deployment took transit down until somebody restarted THIS relay as well. It
 * stayed hidden because deploying both servers in turn restarts the second one,
 * which runs the start-up dial again and makes it look like recovery.
 *
 * So the relay that DIALLED is left alone here, and only the one that answered is
 * restarted. If nothing re-dials, up stays at zero for ever. */
console.log('\nA link that drops');
{
  const [portsA, portsB] = await relayPorts(2);
  const dirA = seed(A);
  const dirB = seed(B);
  const relayB = await start('standalone-relay/server.js', dirB, portsB, A.id);
  const relayA = await start('scripts/server.js', dirA, portsA, `${B.id}@http://127.0.0.1:${portsB.signal}`);

  const first = await waitForTransit(portsA.signal, 1);
  ok(first?.up >= 1, `the link comes up to begin with (${JSON.stringify(first)})`);

  /* Only the answering relay goes away. The dialling one is not touched. */
  relayB.child.kill('SIGKILL');
  const dropped = await (async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const body = await health(portsA.signal).catch(() => null);
      if (body && body.transit?.up === 0) return body.transit;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  })();
  ok(dropped?.up === 0, `and the dialling relay notices it went (${JSON.stringify(dropped)})`);

  /* Back on the same port, with the same identity, as a restarted container is. */
  await start('standalone-relay/server.js', dirB, portsB, A.id);
  const again = await waitForTransit(portsA.signal, 1, 200);
  ok(again?.up >= 1,
    `and the dialling relay links again without being restarted itself (${JSON.stringify(again)})`);

  relayA.child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/* A link that is up and says nothing — the death that closes no socket.
 *
 * A relay that goes away cleanly sends a close frame and the link is rebuilt
 * from the close event. A relay that goes away DIRTY — the NAT table expired,
 * the machine was paused, the cable left — sends nothing, and TCP will hold
 * a dead connection open for as long as it takes somebody to notice. Nobody
 * did: the heartbeat fired pings into it and never once asked where the
 * pongs were, so a black-holed link answered as up, took envelopes it could
 * not deliver, and kept the dial from ever being remade.
 *
 * The peer here completes a real handshake and then goes silent with pongs
 * switched off — the closest a test can come to a cable pull. The answering
 * relay must drop it inside three heartbeats and stop counting it as up. */
console.log('\nA link that stops answering');
{
  const [portsB] = await relayPorts(1);
  const dirB = seed(B);
  const relayB = await start('standalone-relay/server.js', dirB, portsB, M.id);

  const { WebSocket } = require('ws');
  const privM = ids.relayPrivateKey(M);
  const outcome = await new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${portsB.signal}/relay-link`, { autoPong: false });
    const started = link.startLink(identityOf(M), B.keys.p256.publicKey);
    let confirmed = false;
    const timer = setTimeout(() => resolve(confirmed ? 'hung' : 'handshake never finished'), 110000);
    socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', ...started.hello })));
    socket.on('message', (raw) => {
      if (confirmed) return;
      let message; try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (message?.t !== 'proof') return;
      const finished = link.finishLink(identityOf(M), privM, started.state, message, B.id);
      socket.send(JSON.stringify({ t: 'confirm', ...finished.answer }));
      confirmed = true;
    });
    socket.on('close', () => { clearTimeout(timer); resolve(confirmed ? 'dropped' : 'closed mid-handshake'); });
    socket.on('error', () => { clearTimeout(timer); resolve('error'); });
  });
  ok(outcome === 'dropped',
    `a silent peer loses its link rather than keeping it (${outcome})`);

  const transit = await (async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const body = await health(portsB.signal).catch(() => null);
      if (body && body.transit?.up === 0) return body.transit;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  })();
  ok(transit?.up === 0, `and the answerer stops counting it as up (${JSON.stringify(transit)})`);

  relayB.child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
