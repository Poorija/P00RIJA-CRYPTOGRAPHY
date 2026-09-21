/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The retention rules, exercised directly against the relay's own store.
 *
 *   node tests/e2e/retention.mjs
 *
 * No browser: this is about what the server keeps and throws away, and the
 * fastest honest way to test "eight days old" is to write a mailbox with an
 * eight-day-old timestamp and start the relay on it.
 *
 * The rules under test:
 *   text   — kept until collected, however long that takes
 *   media  — dropped after seven days, or when the mailbox passes its quota
 *   log    — one note per dropped item, kept thirty days, then gone
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const DAY = 24 * 60 * 60 * 1000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-retention-'));
const storePath = path.join(dir, 'offline-messages.json');
const logPath = path.join(dir, 'expiry-log.json');
const RECIPIENT = 'a'.repeat(64);

const envelope = (kind, ageDays, bytes = 64) => ({
  type: 'relay',
  relayId: `${kind}-${ageDays}-${Math.random().toString(36).slice(2, 8)}`,
  fromClientId: 'sender-client',
  fromFingerprint: 'b'.repeat(64),
  payload: {
    type: 'offline-chat',
    class: kind,
    seal: 'x'.repeat(512),
    message: { type: kind === 'media' ? 'file-start' : 'text', payload: { iv: [], cipher: 'y'.repeat(bytes) } },
  },
  queuedAt: new Date(Date.now() - ageDays * DAY).toISOString(),
});

fs.writeFileSync(storePath, JSON.stringify({
  [RECIPIENT]: [
    envelope('text', 40),           // ancient text: must survive
    envelope('text', 0),
    envelope('media', 8),           // over the seven-day line: must go
    envelope('media', 1),           // recent: must survive
  ],
}, null, 2));

console.log('\n===== what the relay keeps =====');
console.log(`  store: ${storePath}`);

const relay = spawn(process.execPath, [path.resolve('scripts/server.js')], {
  env: {
    ...process.env,
    // The relay reads CHAT_SIGNAL_PORT / CHAT_PRESENCE_PORT, not PORT — with
    // the wrong names it binds 9000 and collides with a relay already running.
    CHAT_SIGNAL_PORT: '9310',
    CHAT_PRESENCE_PORT: '9311',
    MONITOR_PASSWORD: 'retention-harness-password',
    TURN_PASSWORD: 'retention-harness',
    CHAT_OFFLINE_STORE_PATH: storePath,
    CHAT_EXPIRY_LOG_PATH: logPath,
    // Sweep straight away rather than waiting a quarter of an hour.
    CHAT_RETENTION_SWEEP_MS: '1000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const relayOut = [];
relay.stdout.on('data', (d) => relayOut.push(String(d)));
relay.stderr.on('data', (d) => relayOut.push(String(d)));

await new Promise((resolve) => setTimeout(resolve, 6000));

/* The relay keeps one file per mailbox now, so a write costs one recipient's
   queue instead of the whole server's. The fixture above is still written as
   the old single file on purpose - that also exercises the one-time import. */
const readStore = () => {
  const dir = path.join(path.dirname(storePath), 'mailboxes');
  if (!fs.existsSync(dir)) {
    try { return JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch (error) { return {}; }
  }
  const out = {};
  fs.readdirSync(dir).forEach((name) => {
    if (!name.endsWith('.json')) return;
    try { out[name.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
    catch (error) { /* an unreadable mailbox reads as absent */ }
  });
  return out;
};
const readLog = () => {
  try { return JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (error) { return []; }
};

const mailbox = readStore()[RECIPIENT] || [];
const kinds = mailbox.map((item) => `${item.payload.class}@${Math.round((Date.now() - Date.parse(item.queuedAt)) / DAY)}d`);
console.log('  remaining: ' + JSON.stringify(kinds));

const texts = mailbox.filter((i) => i.payload.class === 'text');
const media = mailbox.filter((i) => i.payload.class === 'media');

check('text is kept no matter how old it is', texts.length === 2, `${texts.length} text item(s)`);
check('media past seven days is gone', media.length === 1, `${media.length} media item(s)`);
check('media inside the window is untouched',
  media.every((i) => (Date.now() - Date.parse(i.queuedAt)) < 7 * DAY), JSON.stringify(kinds));

const log = readLog();
console.log('  log: ' + JSON.stringify(log.map((e) => `${e.class}/${e.reason}`)));
check('the expiry left a note behind', log.length === 1 && log[0].class === 'media' && log[0].reason === 'retention',
  JSON.stringify(log[0] || null));
check('the note says who it was from, and nothing about the body',
  Boolean(log[0]?.from) && !JSON.stringify(log[0] || {}).includes('cipher'),
  Object.keys(log[0] || {}).join(','));
check('the note is not marked delivered until the recipient connects',
  log[0]?.delivered === false, String(log[0]?.delivered));

relay.kill('SIGTERM');
await new Promise((resolve) => setTimeout(resolve, 500));

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('\n  relay output:\n' + relayOut.join('').split('\n').slice(-12).map((l) => '    ' + l).join('\n'));
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n===== ${failed.length} failed of ${results.length} =====`);
process.exit(failed.length ? 1 : 0);
