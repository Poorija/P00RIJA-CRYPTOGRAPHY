/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.

   How the relay's storage cost grows.

   Every queued message used to rewrite the whole store, so storing message N
   cost the size of messages 1..N-1. That is fine for a while and then it is
   not: a relay here reached 328 MB, at which point a file transfer that
   normally takes three minutes could not finish in ten. This measures the
   shape of the curve rather than trusting the reasoning. */
import fs from 'fs';
import crypto from 'node:crypto';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';

const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-scale-'));
const PORT = 9421;
const relay = spawn(process.execPath, ['scripts/server.js'], {
  env: {
    ...process.env,
    CHAT_RETENTION_SWEEP_MS: '600000',
    CHAT_SIGNAL_PORT: String(PORT),
    CHAT_PRESENCE_PORT: String(PORT + 1),
    MONITOR_PASSWORD: 'scale-harness-password',
    TURN_PASSWORD: 'scale-harness',
    CHAT_OFFLINE_STORE_PATH: path.join(dir, 'offline-messages.json'),
    CHAT_EXPIRY_LOG_PATH: path.join(dir, 'expiry-log.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
relay.stdout.on('data', () => {});
relay.stderr.on('data', (b) => { const s = String(b); if (/Error|error/.test(s)) console.log('  relay!! ' + s.slice(0, 200)); });
relay.stdout.removeAllListeners('data');
relay.stdout.on('data', (b) => { const s = String(b); if (/listen|Signal|Presence|ready/i.test(s)) console.log('  relay: ' + s.trim().slice(0, 140)); });
await new Promise((r) => setTimeout(r, 2500));

// Exercise the authenticated relay protocol: invented fingerprints and 'x'
// public keys are correctly rejected by the production relay.
const identities = new Map([7, 99].map(n => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const spki = pair.publicKey.export({ type:'spki', format:'der' });
  return [n, { privateKey: pair.privateKey, publicKeyData: spki.toString('base64'), fingerprint: crypto.createHash('sha256').update(spki).digest('hex') }];
}));
const fp = (n) => identities.get(n)?.fingerprint || String(n).padStart(2, '0').repeat(32).slice(0, 64);
const open = (index = 99) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://localhost:${PORT + 1}/chat-signal`);
  ws.on('message', raw => {
    const message = JSON.parse(String(raw));
    if (message.type !== 'id-challenge') return;
    const nonce = crypto.privateDecrypt({ key: identities.get(index).privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256' }, Buffer.from(message.cipher, 'base64'));
    ws.send(JSON.stringify({ type:'id-proof', nonce: nonce.toString('base64') }));
  });
  ws.on('open', () => resolve(ws));
  ws.on('error', reject);
});

/* One sender, many recipients, a decent payload each. The interesting number
   is how long the LAST message takes compared with the first. */
const ws = await open();
ws.send(JSON.stringify({ type: 'hello', username: 'sender', peerId: 'sender', fingerprint: fp(99), publicKeyData: identities.get(99).publicKeyData }));
await new Promise((r) => setTimeout(r, 600));

const body = 'x'.repeat(24 * 1024);
const timeFor = async (index) => {
  const started = process.hrtime.bigint();
  ws.send(JSON.stringify({
    type: 'relay',
    persist: true,
    toFingerprint: fp(index % 40),
    payload: { type: 'offline-chat', inner: 'text', ciphertext: body },
  }));
  await new Promise((r) => setTimeout(r, 2));
  return Number(process.hrtime.bigint() - started) / 1e6;
};

console.log('\n===== the cost of storing one more message =====');
const early = [];
for (let i = 0; i < 60; i += 1) early.push(await timeFor(i));
for (let i = 60; i < 900; i += 1) await timeFor(i);
const late = [];
for (let i = 900; i < 960; i += 1) late.push(await timeFor(i));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const first = mean(early);
const last = mean(late);
console.log(`  first 60: ${first.toFixed(1)}ms   after 900 more: ${last.toFixed(1)}ms   ratio ${(last / first).toFixed(2)}x`);
check('storing a message does not get slower as the relay fills up',
  last < first * 2.5, `${first.toFixed(1)}ms -> ${last.toFixed(1)}ms`);

console.log('\n===== what is on disk =====');
const boxDir = path.join(dir, 'mailboxes');
const files = fs.existsSync(boxDir) ? fs.readdirSync(boxDir) : [];
const sizes = files.map((f) => fs.statSync(path.join(boxDir, f)).size);
const total = sizes.reduce((a, b) => a + b, 0);
const biggest = Math.max(0, ...sizes);
console.log(`  ${files.length} mailbox file(s), ${(total / 1e6).toFixed(1)} MB total, largest ${(biggest / 1e6).toFixed(2)} MB`);
check('each mailbox is its own file', files.length >= 20, `${files.length} file(s)`);
check('no single file holds the whole relay', biggest < total * 0.35, `largest is ${((biggest / total) * 100).toFixed(0)}% of the store`);
check('the old single-file store is not being written', !fs.existsSync(path.join(dir, 'offline-messages.json')), 'absent');

console.log('\n===== it all comes back on a restart =====');
ws.close();
relay.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 1800));
const again = spawn(process.execPath, ['scripts/server.js'], {
  env: {
    ...process.env,
    CHAT_RETENTION_SWEEP_MS: '600000',
    CHAT_SIGNAL_PORT: String(PORT),
    CHAT_PRESENCE_PORT: String(PORT + 1),
    MONITOR_PASSWORD: 'scale-harness-password',
    TURN_PASSWORD: 'scale-harness',
    CHAT_OFFLINE_STORE_PATH: path.join(dir, 'offline-messages.json'),
    CHAT_EXPIRY_LOG_PATH: path.join(dir, 'expiry-log.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
again.stdout.on('data', () => {});
await new Promise((r) => setTimeout(r, 2500));
const reader = await open(7);
const got = await new Promise((resolve) => {
  let count = 0;
  reader.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      /* Queued envelopes come back exactly as they were stored. */
      if (msg.type === 'relay') count += 1;
    } catch (_e) { /* not for us */ }
  });
  reader.send(JSON.stringify({ type: 'hello', username: 'reader', peerId: 'reader', fingerprint: fp(7), publicKeyData: identities.get(7).publicKeyData }));
  setTimeout(() => resolve(count), 3500);
});
console.log(`  the reader collected ${got} envelope(s) after the restart`);
check('a restarted relay still has the queue', got > 0, `${got} envelope(s)`);

reader.close();
again.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 800));
fs.rmSync(dir, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
