/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* One identity, several machines, one relay that must not get in the way.
 *
 * An account is a key pair, and a person is not limited to one place that
 * holds it. The relay used to enforce the opposite: a second verified
 * connection for a fingerprint replaced the first — the duplicate-close that
 * protected a reconnect also made a second device impossible — and delivery
 * addressed by fingerprint reached one socket, whichever a lookup happened to
 * return.
 *
 * The three properties this pins down, all on the wire with real RSA proofs:
 *
 *   1. coexistence — the second verified device does not close the first
 *   2. fan-out — a frame addressed to the identity reaches every device
 *   3. addressing — a frame addressed to one clientId reaches that one only
 *
 * Plus the deviceId: the field the devices panel reads to tell its own socket
 * from a sibling's, carried in hello and echoed in the peers table.
 *
 * The relay is chosen the way the other relay suites choose it, so this runs
 * against both programs: the deployed one and the distribution.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';
import { mirrorRelayLib } from './_relay-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIGNAL_PORT = 9841;
const PRESENCE_PORT = 9842;
const PASSWORD = 'device-sync-suite-2026';

const RELAY_SERVER = process.env.RELAY_SERVER
  ? join(ROOT, process.env.RELAY_SERVER)
  : join(ROOT, 'standalone-relay', 'server.js');

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

const work = mkdtempSync(join(tmpdir(), 'poorija-devsync-'));
const restoreRelayLib = mirrorRelayLib();

const relay = spawn(process.execPath, [RELAY_SERVER], {
  env: {
    ...process.env,
    MONITOR_PASSWORD: PASSWORD,
    CHAT_SIGNAL_HOST: '127.0.0.1',
    CHAT_SIGNAL_PORT: String(SIGNAL_PORT),
    CHAT_PRESENCE_PORT: String(PRESENCE_PORT),
    CHAT_POLICY_STORE_PATH: join(work, 'policy.json'),
    CHAT_OFFLINE_STORE_PATH: join(work, 'offline.json'),
    CHAT_PUSH_STORE_PATH: join(work, 'push.json'),
  },
  stdio: 'ignore',
});
process.on('exit', () => {
  try { relay.kill(); } catch (_error) { /* gone */ }
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_error) { /* ignore */ }
  restoreRelayLib();
});

for (let i = 0; i < 80; i += 1) {
  try { if ((await fetch(`http://127.0.0.1:${SIGNAL_PORT}/chat-health`)).ok) break; } catch (_error) { /* not yet */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/* Connects and answers the identity challenge. The relay confirms a proof
   with no frame of its own — verification lands silently — so this resolves
   once the socket is known (welcome) and the suite lets the proof settle.
   The fan-out check below is what proves the proofs landed: an unverified
   socket is never a delivery target. */
function connect(identity, deviceId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PRESENCE_PORT}/chat-signal`, { maxPayload: 64 * 1024 * 1024 });
    const state = { socket, clientId: '', closed: null, frames: [], peers: [] };
    const timer = setTimeout(() => reject(new Error('handshake timed out')), 15000);
    socket.on('close', (code, reason) => { state.closed = { code, reason: String(reason) }; });
    socket.on('message', (raw) => {
      let message; try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (answerRelayChallenge(message, identity, socket)) return;
      if (message.type === 'welcome') { state.clientId = message.clientId || ''; clearTimeout(timer); resolve(state); }
      if (message.type === 'peers') state.peers = message.peers || [];
      if (message.type === 'relay') state.frames.push(message);
    });
    socket.on('error', reject);
    socket.on('open', () => socket.send(JSON.stringify({
      type: 'hello', username: 'device', peerId: `p-${deviceId}`,
      publicKeyData: identity.publicKeyData, fingerprint: identity.fingerprint, deviceId,
    })));
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* One round trip for the challenge and its answer, all on localhost. */
const PROOF_SETTLE = 800;

console.log('\nDevice sync');

/* The account: one key pair. The devices: two sockets, two device ids. */
const account = relayTestIdentity();
const stranger = relayTestIdentity();

const phone = await connect(account, 'device-phone-0001');
await wait(PROOF_SETTLE);
const desktop = await connect(account, 'device-desktop-02');
/* The peers broadcast that follows the second hello is what would have said
   which sockets survived it. */
await wait(1500);

ok(phone.socket.readyState === WebSocket.OPEN && phone.closed === null,
  'the first device is still connected after the second one proved the same identity');
ok(desktop.socket.readyState === WebSocket.OPEN && desktop.closed === null,
  'and the second device is connected too — coexistence, not replacement');
ok(phone.clientId && desktop.clientId && phone.clientId !== desktop.clientId,
  'each device has its own connection id on the relay');

/* The deviceId echo: the panel marks "this device" by it, so a relay that
   drops the field marks nobody. The latest broadcast each socket saw is from
   after both hellos. */
const bothInTable = [phone, desktop].every((state) => {
  const table = state.peers;
  const mine = table.find((peer) => peer.deviceId === 'device-phone-0001');
  const other = table.find((peer) => peer.deviceId === 'device-desktop-02');
  return Boolean(mine && other && mine.clientId !== other.clientId);
});
ok(bothInTable,
  'the peers table lists both devices, each under its own deviceId');

/* Fan-out: a stranger writes to the identity, not to a socket. Both machines
   hold the private key, so both must see the frame — one live copy for the
   phone and nothing for the desktop is a message half-delivered. This is
   also the suite's proof that both proofs landed: only a verified socket is
   ever a delivery target for a fingerprint. */
const strangerSocket = await connect(stranger, 'device-stranger-99');
await wait(PROOF_SETTLE);
strangerSocket.socket.send(JSON.stringify({
  type: 'relay', toFingerprint: account.fingerprint,
  payload: { type: 'offline-chat', body: 'for the account' }, tag: 'fanout-1',
}));
await wait(1200);
ok(phone.frames.some((frame) => frame.payload?.body === 'for the account'),
  'a frame addressed to the fingerprint reaches the first device');
ok(desktop.frames.some((frame) => frame.payload?.body === 'for the account'),
  'and the second device — every machine holding the key gets it');

/* Addressing: ephemeral signalling names one socket, and that must stay
   exact — a call offer aimed at the desktop has no business ringing the
   phone. clientId routing is positional and untouched by fan-out. */
phone.frames.length = 0;
desktop.frames.length = 0;
strangerSocket.socket.send(JSON.stringify({
  type: 'relay', toClientId: desktop.clientId,
  payload: { type: 'call-offer', body: 'only the desktop' }, tag: 'direct-1',
}));
await wait(1200);
ok(desktop.frames.some((frame) => frame.payload?.body === 'only the desktop')
  && !phone.frames.some((frame) => frame.payload?.body === 'only the desktop'),
  'a frame addressed to one clientId reaches that device and not its sibling');

/* Coexistence is for two PROVEN devices, not for a socket that never finished
   its proof. The unproven hello below claims the fingerprint the phone holds
   verified — it must not kick the phone (that was the claim-based kick this
   relay never allowed again), and it must not become a delivery target
   either: an impostor who cannot open the challenge is present, but nothing
   is routed to them and nothing of the account's is interrupted. */
phone.frames.length = 0;
desktop.frames.length = 0;
const claimant = new WebSocket(`ws://127.0.0.1:${PRESENCE_PORT}/chat-signal`, { maxPayload: 64 * 1024 * 1024 });
await new Promise((resolve) => { claimant.on('open', resolve); });
claimant.send(JSON.stringify({
  type: 'hello', username: 'claimant', peerId: 'p-claim',
  publicKeyData: account.publicKeyData, fingerprint: account.fingerprint, deviceId: 'device-claim-03',
}));
/* The challenge arrives and is deliberately left unanswered, which is exactly
   what an impostor cannot help but do. */
await wait(1500);
strangerSocket.socket.send(JSON.stringify({
  type: 'relay', toFingerprint: account.fingerprint,
  payload: { type: 'offline-chat', body: 'still only the real devices' }, tag: 'fanout-2',
}));
await wait(1200);
ok(phone.socket.readyState === WebSocket.OPEN,
  'the verified device survives an unproven claim on its fingerprint');
let claimantSawMail = false;
claimant.on('message', (raw) => {
  let message; try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
  if (message.type === 'relay' && message.payload?.body === 'still only the real devices') claimantSawMail = true;
});
ok(phone.frames.some((frame) => frame.payload?.body === 'still only the real devices')
  && desktop.frames.some((frame) => frame.payload?.body === 'still only the real devices'),
  'the real devices still receive what is addressed to the account');
ok(!claimantSawMail,
  'and the unproven claimant receives none of it — presence without proof routes nothing');

try { phone.socket.close(); desktop.socket.close(); strangerSocket.socket.close(); claimant.close(); } catch (_error) { /* already gone */ }
await wait(300);

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
