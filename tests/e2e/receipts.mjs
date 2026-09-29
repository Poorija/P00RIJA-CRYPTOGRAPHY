/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A read receipt can be turned off, and turning it off stops the reply.
 *
 * A receipt is a guaranteed, immediate answer to every message that arrives,
 * and that is exactly what makes it useful to somebody watching the outside
 * of the traffic. Published work on Signal's sealed sender recovers who is
 * talking to whom by statistical disclosure from that answer alone — the
 * content stays sealed and the shape of the conversation does not. Signal has
 * no way to switch it off, which is what makes it so dependable as a signal.
 *
 * Two things are checked, and the second matters more than it looks:
 *
 *   that the switch stops the message going out, rather than sending it and
 *   hiding the tick — a hidden tick is a privacy setting that protects
 *   nobody;
 *
 *   that EVERY place which sends a receipt is behind the switch. There were
 *   four when this was written, in three files, and a fifth added later
 *   without the guard would defeat the whole setting while every other test
 *   here still passed. So the sites are counted from the source.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = {
  'js/chat/17-file-manager.js': readFileSync(join(ROOT, 'js', 'chat', '17-file-manager.js'), 'utf8'),
  'js/chat/27-message-render.js': readFileSync(join(ROOT, 'js', 'chat', '27-message-render.js'), 'utf8'),
  'js/chat/29-file-transfer.js': readFileSync(join(ROOT, 'js', 'chat', '29-file-transfer.js'), 'utf8'),
};

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

function extract(source, name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`${name} is gone`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error(`${name} is not closed`);
}

console.log('\nWhat the switch means');

const enabledFor = (prefs) => new Function('chatState', `
  ${extract(files['js/chat/17-file-manager.js'], 'receiptsEnabled')}
  return receiptsEnabled;
`)({ prefs })();

{
  ok(enabledFor({}) === true,
    'a device that has never seen the switch sends receipts, as it always did');
  ok(enabledFor(undefined) === true, 'and so does one with no preferences at all');
  ok(enabledFor({ sendReceipts: false }) === false, 'off means off');
  ok(enabledFor({ sendReceipts: true }) === true, 'on means on');
}

console.log('\nOff stops the reply rather than hiding the tick');

function extractConst(source, name) {
  const match = source.match(new RegExp(`^const ${name} = .*;$`, 'm'));
  if (!match) throw new Error(`${name} is gone`);
  return match[0];
}

/* setTimeout is handed in so the jitter can be run rather than waited for. */
function ackHarness(prefs, { runTimers = true } = {}) {
  const wire = [];
  const pending = [];
  const chatState = { prefs, peers: [] };
  const scope = new Function('chatState', 'receiptsEnabled', 'safeConnectionSend',
    'findPeerBySession', 'relaySessionEvent', 'setTimeout', 'Math', `
    ${extractConst(files['js/chat/29-file-transfer.js'], 'DELIVERED_RECEIPT_JITTER_MS')}
    ${extract(files['js/chat/29-file-transfer.js'], 'sendDeliveryAck')}
    return { sendDeliveryAck, DELIVERED_RECEIPT_JITTER_MS };
  `)(chatState, () => enabledFor(chatState.prefs),
    (connection, payload) => { wire.push(payload); return true; },
    () => null, () => true,
    (fn, ms) => { pending.push({ fn, ms }); },
    Math);
  return {
    send: scope.sendDeliveryAck,
    jitter: scope.DELIVERED_RECEIPT_JITTER_MS,
    wire,
    pending,
    flush: () => { while (pending.length) pending.shift().fn(); },
    chatState,
  };
}

{
  const on = ackHarness({ sendReceipts: true });
  const sent = on.send({ connection: { open: true } }, 'm1', 'seen');
  ok(sent === true && on.wire.length === 1 && on.wire[0].type === 'receipt',
    'with the switch on, a receipt goes out');
}

{
  const off = ackHarness({ sendReceipts: false });
  const sent = off.send({ connection: { open: true } }, 'm1', 'seen');
  ok(off.wire.length === 0, 'with it off, nothing is put on the wire at all');
  ok(sent === true,
    'and the caller is told it is done, so it does not retry on every render — the point is that nothing was sent, not that sending failed');
}

console.log('\nAnd the one that would otherwise be instant is not');

/* The attack works on the answer being immediate and guaranteed. Jitter does
   not defeat somebody watching both ends — nothing here does — but it stops
   the pairing being free. */
{
  const h = ackHarness({ sendReceipts: true });
  const sent = h.send({ connection: { open: true } }, 'm1', 'delivered');
  ok(sent === true && h.wire.length === 0,
    'a delivered receipt does not leave the moment the message lands');
  ok(h.pending.length === 1 && h.pending[0].ms >= 0 && h.pending[0].ms < h.jitter,
    `it waits a random part of ${h.jitter}ms first`);
  h.flush();
  ok(h.wire.length === 1 && h.wire[0].status === 'delivered', 'and then it goes');
}

{
  const h = ackHarness({ sendReceipts: true });
  h.send({ connection: { open: true } }, 'm1', 'seen');
  ok(h.pending.length === 0 && h.wire.length === 1,
    'a seen receipt is not delayed: its timing is already loose, and its caller reads the answer to decide whether to try again');
}

/* Turned off while one was waiting. A receipt that went out after that would
   make the setting a lie. */
{
  const h = ackHarness({ sendReceipts: true });
  h.send({ connection: { open: true } }, 'm1', 'delivered');
  h.chatState.prefs.sendReceipts = false;
  h.flush();
  ok(h.wire.length === 0,
    'and one already waiting is dropped if the switch is turned off before it goes');
}

console.log('\nEvery place that sends one is behind the switch');

/* Each `type: 'receipt'` in the source is a place a receipt leaves this
   device. For every one of them, the guard has to be somewhere above it in
   the same function — so the window looked at is generous rather than tight,
   and a site with no guard anywhere near it is what this catches. */
{
  let sites = 0;
  let guarded = 0;
  const unguarded = [];
  for (const [name, source] of Object.entries(files)) {
    /* The dictionary entries and the preference itself are not send sites. */
    if (name.endsWith('17-file-manager.js')) continue;
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (!/type:\s*'receipt'/.test(line)) return;
      sites += 1;
      const window = lines.slice(Math.max(0, index - 12), index + 1).join('\n');
      if (/receiptsEnabled\(\)/.test(window)) guarded += 1;
      else unguarded.push(`${name}:${index + 1}`);
    });
  }
  ok(sites >= 4, `there are at least the four known send sites (${sites} found)`);
  ok(guarded === sites,
    unguarded.length
      ? `a receipt is sent without checking the switch at ${unguarded.join(', ')}`
      : `all ${sites} of them check the switch first`);
}

/* The preference has to survive a restart, or it is a setting that forgets. */
{
  const source = files['js/chat/17-file-manager.js'];
  ok(/sendReceipts: receiptsEnabled\(\)/.test(source),
    'the switch is written to the preference store');
  const boot = readFileSync(join(ROOT, 'js', 'chat', '20-call-rows.js'), 'utf8');
  ok(/chatState\.prefs\.sendReceipts = savedPrefs\.sendReceipts !== false/.test(boot),
    'and read back on boot as on unless it was explicitly turned off');
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
