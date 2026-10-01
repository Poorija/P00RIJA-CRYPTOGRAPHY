/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Frames a relay must survive, from sockets that owe it nothing.
 *
 * Two of them need no cleverness at all, which is exactly why they worked.
 * `null` and `42` are valid JSON, so the parse accepted them and the handler
 * read `.type` off them — and the throw travelled past everything that could
 * have caught it to the process-level handler, whose answer is to flush and
 * exit. Four bytes from a socket that had not even said hello took the whole
 * relay down, and with it every rate bucket, every monitor session and every
 * transit link.
 *
 * The other two are a sender choosing a filename. A mailbox key reaches
 * path.join, which resolves '..', so a queued message addressed to
 * ../relay-identity was a write beside the mailboxes, and a hello claiming
 * the same shape followed by purge-me was a delete. The queue, the wipe and
 * the store itself now all refuse a key that is not a fingerprint, and this
 * suite holds them to it — against the deployed relay and the distribution
 * both, because the parse guard lives in each and the drift between the two
 * is where fixes have gone missing before.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { mirrorRelayLib } from './_relay-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const restoreRelayLib = mirrorRelayLib();
const children = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checks = 0;
let failures = 0;
function ok(name, condition, detail = '') {
  checks += 1;
  console.log(`  ${condition ? 'ok' : 'NOT OK'}    ${name}${detail ? ` (${detail})` : ''}`);
  if (!condition) failures += 1;
}

async function start(file, dir, port) {
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
  children.push(child);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${file} exited early:\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/chat-health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return { child, dir };
    } catch (_error) { /* not up yet */ }
    await sleep(100);
  }
  throw new Error(`${file} never answered:\n${output}`);
}

async function healthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/chat-health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch (_error) { return false; }
}

function open(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port + 1}/chat-signal`);
    socket.on('open', () => resolve(socket));
    socket.on('error', reject);
  });
}

function collected(socket) {
  const replies = [];
  socket.on('message', (raw) => {
    try { replies.push(JSON.parse(raw.toString())); } catch (_error) { /* not ours */ }
  });
  return replies;
}

async function stopAll() {
  for (const child of children) {
    try { child.kill('SIGKILL'); } catch (_error) { /* gone */ }
  }
  restoreRelayLib();
}

process.on('exit', stopAll);

/* The frames that parse but are not messages, against each relay in turn.
   The bar is the same for both: the relay answers the frame and is still
   answering everybody else afterwards. */
async function survivesNonObjectFrames(label, file) {
  console.log(`\n${label}`);
  const dir = mkdtempSync(join(tmpdir(), 'poorija-hostile-'));
  const { child } = await start(file, dir, 9461);
  for (const frame of ['null', 'true', '42', '"hello"', '[]']) {
    const socket = await open(9461);
    const replies = collected(socket);
    socket.send(frame);
    await sleep(300);
    ok(`${frame} is answered, not obeyed`,
      replies.some((reply) => reply?.type === 'error' && reply.reason === 'invalid-json'),
      `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}`);
    try { socket.close(); } catch (_error) { /* gone */ }
  }
  await sleep(200);
  ok('the relay is still standing after all of them', await healthy(9461));
  try { child.kill('SIGKILL'); } catch (_error) { /* gone */ }
  await sleep(150);
}

await survivesNonObjectFrames('scripts/server.js — frames that are not messages', join(ROOT, 'scripts', 'server.js'));
await survivesNonObjectFrames('standalone-relay/server.js — the same frames, the same answer', join(ROOT, 'standalone-relay', 'server.js'));

/* A sender choosing a filename. Only the deployed relay keeps a file per
   mailbox, so only it can be asked what it did with the name. */
{
  console.log('\nscripts/server.js — a mailbox key that is not a fingerprint');
  const dir = mkdtempSync(join(tmpdir(), 'poorija-hostile-'));
  const { child } = await start(join(ROOT, 'scripts', 'server.js'), dir, 9463);

  {
    const socket = await open(9463);
    const replies = collected(socket);
    socket.send(JSON.stringify({
      type: 'relay', toFingerprint: '../pwned', persist: true, tag: 't1',
      payload: { type: 'offline-chat', body: 'should never become a file' },
    }));
    await sleep(800);
    const answer = replies.find((reply) => reply?.tag === 't1');
    ok('the queue refuses the name outright', answer?.type === 'error' && answer.reason === 'invalid-target',
      answer ? `${answer.type}/${answer.reason}` : 'no reply');
    try { socket.close(); } catch (_error) { /* gone */ }
  }
  /* Long enough for any mailbox debounce to have fired had the envelope
     been queued: the write is deferred, so the absence has to outlast it. */
  await sleep(4500);
  ok('nothing was written outside the mailboxes directory',
    !existsSync(join(dir, 'pwned.json')) && !existsSync(join(dir, 'pwned')),
    existsSync(join(dir, 'pwned.json')) ? 'pwned.json exists' : 'absent');
  ok('and the relay is still healthy', await healthy(9463));

  /* A hello that claims a path, followed by the wipe. Before the fix the
     claim survived the failed challenge and purge-me unlinked with it. */
  writeFileSync(join(dir, 'victim.json'), '{"kept":"by this suite"}');
  {
    const socket = await open(9463);
    const replies = collected(socket);
    socket.send(JSON.stringify({ type: 'hello', username: 'hostile', fingerprint: '../victim' }));
    await sleep(400);
    socket.send(JSON.stringify({ type: 'purge-me' }));
    await sleep(800);
    const purged = replies.find((reply) => reply?.type === 'purged');
    ok('the wipe still answers the socket that asked', Boolean(purged),
      purged ? `removed ${purged.removed}` : 'no reply');
    ok('and the file beside the mailboxes survives it', existsSync(join(dir, 'victim.json')));
    try { socket.close(); } catch (_error) { /* gone */ }
  }

  /* A real fingerprint still queues and still purges: the gate must narrow
     the door, not close it. */
  const goodKey = 'a'.repeat(64);
  {
    const socket = await open(9463);
    const replies = collected(socket);
    socket.send(JSON.stringify({
      type: 'relay', toFingerprint: goodKey, persist: true, tag: 't2',
      payload: { type: 'offline-chat', body: 'a legitimate envelope' },
    }));
    await sleep(800);
    const answer = replies.find((reply) => reply?.tag === 't2');
    ok('a fingerprint-shaped key is still queued', answer?.type === 'queued',
      answer ? `${answer.type}/${answer.reason || answer.count}` : 'no reply');
    socket.send(JSON.stringify({ type: 'hello', username: 'hostile', fingerprint: goodKey }));
    await sleep(300);
    socket.send(JSON.stringify({ type: 'purge-me' }));
    await sleep(800);
    ok('and still wiped by the name that owns it',
      replies.some((reply) => reply?.type === 'purged'));
    try { socket.close(); } catch (_error) { /* gone */ }
  }

  try { child.kill('SIGKILL'); } catch (_error) { /* gone */ }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/* A socket that talks faster than any client talks. HTTP has had rate
   buckets since the beginning; the socket never did, and every expensive
   thing a relay does is one frame away on a path nobody counted. The frame
   is priced, not punished: the socket is answered and left connected. */
{
  console.log('\nscripts/server.js — a socket with no pauses');
  const dir = mkdtempSync(join(tmpdir(), 'poorija-hostile-'));
  const { child } = await start(join(ROOT, 'scripts', 'server.js'), dir, 9465);
  const socket = await open(9465);
  const replies = collected(socket);
  /* Well past the burst: an honest client never sends this many frames
     without waiting for a single answer, and a loop cannot help itself. */
  for (let i = 0; i < 1600; i += 1) {
    socket.send(JSON.stringify({ type: 'get-peers' }));
    /* Small yields so the socket's own buffers are not the thing measured. */
    if (i % 50 === 49) await sleep(5);
  }
  await sleep(1200);
  const slowed = replies.filter((reply) => reply?.reason === 'slow-down').length;
  ok('a flood meets the answer', slowed > 0, `${slowed} slow-down replies`);
  ok('and the socket stays connected', socket.readyState === WebSocket.OPEN);
  await sleep(600);
  socket.send(JSON.stringify({ type: 'get-peers' }));
  await sleep(400);
  ok('and an ordinary frame after it still works',
    replies.some((reply) => reply?.type === 'peers' && reply !== replies[0]));
  try { socket.close(); } catch (_error) { /* gone */ }
  ok('the relay is still healthy afterwards', await healthy(9465));
  try { child.kill('SIGKILL'); } catch (_error) { /* gone */ }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
