/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the relay can actually carry for somebody who is offline.
 *
 * The relay accepts WebSocket frames up to 12 MB and closes the connection
 * with 1009 on anything larger. That is a limit on ONE ENVELOPE, and it is
 * worth being exact about what that does and does not constrain.
 *
 * It does not constrain the size of a file. A file never travels as one
 * envelope: sendBlobChunks cuts it into FILE_CHUNK_BYTES pieces and decides
 * the route for each piece separately, so what reaches the relay is a long
 * run of small envelopes, whoever the recipient is and whether or not they
 * are there. What bounds a file is the recipient's mailbox, not the frame.
 *
 * It does constrain the chunk. If FILE_CHUNK_BYTES ever grew past what a
 * frame holds once base64 has added its third, every offline transfer would
 * break, and not politely: the relay closes the socket, so the file is lost
 * and so is whatever else was in flight, and the app spends the next moments
 * reconnecting. The chunk size and the frame limit live in different files
 * and have no other reason to agree, which is exactly the pair that drifts.
 *
 * So this measures where the frame limit really bites, then checks the chunk
 * sits well inside it and that the declared file ceiling is the mailbox's.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIGNAL_PORT = 9711;
const PRESENCE_PORT = 9712;
const PASSWORD = 'offline-size-suite-2026';

/* Which relay to exercise. Two of them live in this repository: the one the
   Dockerfile builds and deploys (scripts/server.js) and the self-contained
   distribution (standalone-relay/server.js). They drifted, and the drift was
   invisible because every suite only ever spawned the second one -- so fixes
   were proven against a program nobody runs. RELAY_SERVER points this at
   either, and tools/check-relay-parity.cjs refuses a release where the two
   disagree about which routes they answer. */
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

const work = mkdtempSync(join(tmpdir(), 'poorija-size-'));
const libDir = join(ROOT, 'standalone-relay', 'lib');
const libWasMissing = !existsSync(join(libDir, 'push-wording.js'));
if (libWasMissing) {
  mkdirSync(libDir, { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'lib', 'push-wording.js'), join(libDir, 'push-wording.js'));
}

const relay = spawn(process.execPath, [RELAY_SERVER], {
  env: {
    ...process.env,
    MONITOR_PASSWORD: PASSWORD,
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

for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(`http://127.0.0.1:${SIGNAL_PORT}/chat-health`)).ok) break; } catch (_error) { /* not yet */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

function connect(identity) {
  return new Promise((resolve, reject) => {
    // A generous client-side cap, so anything that fails fails at the relay --
    // which is the limit under test.
    const socket = new WebSocket(`ws://127.0.0.1:${PRESENCE_PORT}/chat-signal`, { maxPayload: 64 * 1024 * 1024 });
    const timer = setTimeout(() => reject(new Error('handshake timed out')), 15000);
    socket.on('open', () => socket.send(JSON.stringify({
      type: 'hello', username: 'probe', peerId: `p-${identity.fingerprint.slice(0, 8)}`,
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

/** Sends a file of `megabytes` to an absent peer and reports what came back. */
function trySize(socket, recipient, megabytes) {
  const body = Buffer.alloc(Math.round(megabytes * 1024 * 1024), 0x41).toString('base64');
  const tag = `probe-${megabytes}`;
  const frame = JSON.stringify({
    type: 'relay', toFingerprint: recipient.fingerprint, persist: true,
    payload: { type: 'offline-chat', inner: 'file', data: body }, tag,
  });
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.off('message', onMessage);
      socket.off('close', onClose);
      resolve(value);
    };
    const onMessage = (raw) => {
      let message; try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (message.tag === tag) done(message.type === 'queued' ? 'queued' : `refused:${message.type}`);
    };
    const onClose = (code) => done(`closed:${code}`);
    socket.on('message', onMessage);
    socket.on('close', onClose);
    try { socket.send(frame); } catch (error) { done(`threw:${error.message}`); }
    setTimeout(() => done('no-answer'), 8000);
  });
}

console.log('\nOffline file size');

const sender = relayTestIdentity();
const recipient = relayTestIdentity();
const socket = await connect(sender);

ok(await trySize(socket, recipient, 1) === 'queued', 'a 1 MB file queues for an absent peer');
ok(await trySize(socket, recipient, 8) === 'queued', 'an 8 MB envelope still queues — just inside the frame');

/* The failure that made this worth finding. It is not a refusal: the relay
   closes the connection, so the file is lost AND so is whatever else was in
   flight, and the app spends the next moments reconnecting. */
const over = await trySize(socket, recipient, 9);
ok(over.startsWith('closed:1009'),
  `9 MB drops the connection rather than being refused (${over}) — which is why the app must never send one`);

/* A file is not sent that way, so the ceiling above is not the file's. What
   must stay under the frame limit is one chunk. */
const constants = readFileSync(join(ROOT, 'js', 'chat', '01-constants.js'), 'utf8');

const chunkDeclared = /const FILE_CHUNK_BYTES = ([0-9]+) \* 1024;/.exec(constants);
ok(Boolean(chunkDeclared), 'the chunk size is declared where the app can read it');
if (chunkDeclared) {
  const chunkBytes = Number(chunkDeclared[1]) * 1024;
  const onTheWire = Math.ceil(chunkBytes / 3) * 4;
  ok(onTheWire < 12 * 1024 * 1024,
    `a ${chunkBytes / 1024} KB chunk is ${Math.round(onTheWire / 1024)} KB base64'd, inside the 12 MB frame`);
}

const declared = /const MAX_OFFLINE_FILE_BYTES = ([0-9]+) \* 1024 \* 1024;/.exec(constants);
ok(Boolean(declared), 'the offline ceiling is declared where the app can read it');
if (declared) {
  const megabytes = Number(declared[1]);
  /* Base64 inflates by a third on the way into the mailbox, and the mailbox
     must hold a whole file at once or the eviction sweep starts dropping the
     early chunks of a transfer whose later chunks are still arriving. */
  const inMailbox = megabytes * (4 / 3);
  ok(inMailbox <= 512,
    `a ${megabytes} MB file is ${Math.round(inMailbox)} MB in the mailbox, inside its 512 MB quota`);
}

/* The claim the rewritten file ceiling rests on: a file arrives as chunks, so
   many small envelopes go through where one large one would have been closed
   out. Sending more than a frame's worth in pieces must simply work. */
const pieces = 220;
/* The 9 MB probe above closed this socket, which is the whole point of it.
   The app reconnects after that too; so does this. */
const resumed = await connect(sender);
let allQueued = true;
for (let i = 0; i < pieces; i += 1) {
  if (await trySize(resumed, recipient, 0.0625) !== 'queued') { allQueued = false; break; }
}
ok(allQueued,
  `${pieces} chunks of 64 KB — ${Math.round(pieces * 64 / 1024)} MB, past the frame limit — all queue`);

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
