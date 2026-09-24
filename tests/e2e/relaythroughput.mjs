/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* That queuing a file for an absent peer costs the same per chunk from the
 * first chunk to the last.
 *
 * It did not. The retention sweep runs every time mail lands, and it derived
 * each waiting envelope's size by stringifying its payload -- so chunk N
 * re-measured the N-1 chunks already in the box, and a file cost the square
 * of its own size in JSON work. Nothing errored and nothing logged; transfers
 * simply got slower the longer they ran, which reads as a bad network rather
 * than as a bug. Small files hid it completely, because the curve only opens
 * up once there are hundreds of chunks in one mailbox.
 *
 * A flat per-chunk cost is the property worth defending, so that is what this
 * measures: the same relay, one mailbox, a file's worth of chunks, and the
 * last of them must not cost meaningfully more than the first. Throughput
 * numbers vary by machine and are only reported; the shape of the curve is
 * what is asserted.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIGNAL_PORT = 9811;
const PRESENCE_PORT = 9812;
const PASSWORD = 'throughput-suite-2026';

/* A 30 MB file at the app's own chunk size. Enough chunks for a quadratic to
   be unmistakable, few enough to stay a few seconds on a slow machine. */
const CHUNK_KB = 64;
const CHUNKS = 480;
/* Generous. The regression this guards was a 6.8x spread and climbing; normal
   run-to-run noise on a loaded machine is well under two. */
const MAX_SPREAD = 2.5;

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

const work = mkdtempSync(join(tmpdir(), 'poorija-throughput-'));
const libDir = join(ROOT, 'standalone-relay', 'lib');
const libWasMissing = !existsSync(join(libDir, 'push-wording.js'));
if (libWasMissing) {
  mkdirSync(libDir, { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'lib', 'push-wording.js'), join(libDir, 'push-wording.js'));
}

const relay = spawn(process.execPath, [join(ROOT, 'standalone-relay', 'server.js')], {
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
  if (libWasMissing) { try { rmSync(libDir, { recursive: true, force: true }); } catch (_error) { /* ignore */ } }
});

for (let i = 0; i < 80; i += 1) {
  try { if ((await fetch(`http://127.0.0.1:${SIGNAL_PORT}/chat-health`)).ok) break; } catch (_error) { /* not yet */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

function connect(identity) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PRESENCE_PORT}/chat-signal`, { maxPayload: 64 * 1024 * 1024 });
    const timer = setTimeout(() => reject(new Error('handshake timed out')), 15000);
    socket.on('open', () => socket.send(JSON.stringify({
      type: 'hello', username: 'throughput', peerId: `p-${identity.fingerprint.slice(0, 8)}`,
      publicKeyData: identity.publicKeyData, fingerprint: identity.fingerprint,
    })));
    socket.on('message', (raw) => {
      let message; try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (answerRelayChallenge(message, identity, socket)) return;
      if (['welcome', 'peers', 'registered'].includes(message.type)) { clearTimeout(timer); resolve(socket); }
    });
    socket.on('error', reject);
  });
}

/* One chunk, sent and acknowledged before the next goes out. Sending them in
   a burst would measure the socket's buffer rather than the relay's work. */
function sendChunk(socket, recipient, body, index) {
  const tag = `chunk-${index}`;
  return new Promise((resolve) => {
    const onMessage = (raw) => {
      let message; try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (message.type === 'queued' && message.tag === tag) { socket.off('message', onMessage); resolve(); }
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify({
      type: 'relay', toFingerprint: recipient.fingerprint, persist: true,
      payload: { type: 'file-chunk', class: 'media', index, data: body }, tag,
    }));
  });
}

console.log('\nRelay throughput');

const sender = relayTestIdentity();
const recipient = relayTestIdentity();
const socket = await connect(sender);
const body = Buffer.alloc(CHUNK_KB * 1024, 0x41).toString('base64');

const timings = [];
for (let i = 0; i < CHUNKS; i += 1) {
  const started = process.hrtime.bigint();
  await sendChunk(socket, recipient, body, i);
  timings.push(Number(process.hrtime.bigint() - started) / 1e6);
}

const band = Math.floor(CHUNKS / 8);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const first = mean(timings.slice(0, band));
const last = mean(timings.slice(-band));
const spread = last / first;
const seconds = timings.reduce((sum, value) => sum + value, 0) / 1000;

console.log(`  ${CHUNKS} x ${CHUNK_KB} KB queued in ${seconds.toFixed(1)}s `
  + `(${((CHUNKS * CHUNK_KB / 1024) / seconds).toFixed(1)} MB/s), `
  + `first ${first.toFixed(2)} ms/chunk, last ${last.toFixed(2)} ms/chunk`);

ok(spread < MAX_SPREAD,
  `the last chunks cost ${spread.toFixed(1)}x the first, under ${MAX_SPREAD}x — the cost per chunk does not grow with the mailbox`);

/* The same property stated the other way round, so a change that slows every
   chunk equally cannot pass by flattening the curve. */
ok(seconds < 30,
  `a 30 MB file queues in ${seconds.toFixed(1)}s`);

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
