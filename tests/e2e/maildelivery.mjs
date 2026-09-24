/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* That a mailbox is delivered completely, and once.
 *
 * The relay hands a returning recipient a window of envelopes and tops it up
 * as they are acknowledged. Two things were wrong with how it did that, and
 * together they made a file sent to somebody offline almost undeliverable.
 *
 * The top-up sliced the front of the queue rather than tracking what had
 * already gone out, so every one of them re-sent envelopes the recipient
 * already had. And it only ran when an ACK actually removed something: the app
 * acknowledges each envelope as it handles it, including the duplicates, and
 * an ACK for an envelope already gone changed nothing and so triggered
 * nothing. Once the recipient had acknowledged everything it held, neither
 * side had any reason to speak next.
 *
 * Delivery stopped there -- around fifty envelopes in, whatever the size of
 * the mailbox. A file is one envelope per chunk, thousands of them for
 * anything large, so it advanced a few megabytes per reconnection and looked
 * for all the world like a slow connection. Nothing logged, nothing failed.
 *
 * This queues a file's worth of chunks for an absent recipient, brings them
 * back, and acknowledges exactly as the app does: one at a time, duplicates
 * included. Everything queued must arrive, and nothing twice.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIGNAL_PORT = 9821;
const PRESENCE_PORT = 9822;
const PASSWORD = 'mail-delivery-suite-2026';

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

/* Comfortably past the window, which is where the old behaviour stopped. */
const QUEUED = 400;

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

const work = mkdtempSync(join(tmpdir(), 'poorija-mail-'));
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
      type: 'hello', username: 'mail', peerId: `p-${identity.fingerprint.slice(0, 8)}`,
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

console.log('\nMail delivery');

const sender = relayTestIdentity();
const recipient = relayTestIdentity();
const body = Buffer.alloc(8 * 1024, 0x41).toString('base64');

const senderSocket = await connect(sender);
for (let index = 0; index < QUEUED; index += 1) {
  await new Promise((resolve) => {
    const onMessage = (raw) => {
      let message; try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (message.type === 'queued' && message.tag === `chunk-${index}`) {
        senderSocket.off('message', onMessage);
        resolve();
      }
    };
    senderSocket.on('message', onMessage);
    senderSocket.send(JSON.stringify({
      type: 'relay', toFingerprint: recipient.fingerprint, persist: true,
      payload: { type: 'file-chunk', class: 'media', index, data: body }, tag: `chunk-${index}`,
    }));
  });
}

/* Back online, acknowledging one envelope at a time exactly as the app does --
   duplicates included, which is what used to stop delivery dead. */
let sent = 0;
const seen = new Set();
const recipientSocket = await connect(recipient);
await new Promise((resolve) => {
  let idle = null;
  const settle = () => {
    clearTimeout(idle);
    /* Delivery is finished when the relay has been quiet for a while. A stall
       and a completion look the same from here, which is the point: the
       assertions below decide which it was. */
    idle = setTimeout(resolve, 3000);
  };
  recipientSocket.on('message', (raw) => {
    let message; try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
    if (message.type !== 'relay' || !message.relayId) return;
    sent += 1;
    seen.add(message.relayId);
    settle();
    recipientSocket.send(JSON.stringify({ type: 'relay-ack', ids: [message.relayId] }));
  });
  settle();
});

ok(seen.size === QUEUED,
  `all ${QUEUED} queued envelopes arrive (${seen.size} did) — delivery does not stop at the window`);
ok(sent === seen.size,
  `none of them arrives twice (${sent} sent for ${seen.size} distinct)`);

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
