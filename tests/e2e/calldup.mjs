/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* One call, one row.
 *
 * A call that was answered and hung up normally was also being logged as a
 * missed call. The second row arrives from the other side: when a peer tears
 * down with its own answered-at clock still zero — the call was up on the
 * signalling layer but its media `stream` event never fired, which is ordinary
 * on a relayed or one-way-media link — endCurrentCall() sends `call-cancel`,
 * and the handler for it wrote a missed row unconditionally. The completed row
 * is closed and carries a duration, so the de-duplication refused to absorb
 * the late notice (correctly: that guard stops an answered call being
 * rewritten) and opened a fresh row instead.
 *
 * Driving two real browsers cannot produce it: on localhost with fake devices
 * the `stream` event always fires, so answered-at is never zero. The protocol
 * events are replayed through window.__callLogProbe instead, which is what
 * that hook exists for.
 *
 *   PORT=8099 npm run dev ; node tests/e2e/calldup.mjs
 */
import { chromium, webkit } from 'playwright';
import { settle } from './_settle.mjs';
const engine = process.env.E2E_ENGINE === 'webkit' ? webkit : chromium;
const BASE = process.env.PKG_URL || 'http://localhost:8099';
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await engine.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await context.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'en'); } catch (_e) {} try { delete Navigator.prototype.serviceWorker; } catch (_e) {} });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await settle(page);
await page.evaluate((pass) => {
  const set = (id, v) => { const el = document.getElementById(id); if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((el, i) => { el.value = 'answer' + i; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const terms = document.getElementById('acceptTermsCheckbox'); if (terms && !terms.checked) { terms.checked = true; terms.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('setupBtn')?.click());
await page.waitForFunction(() => window.PoorijaApp?.state?.isLocked === false, { timeout: 90000 });
await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
await page.waitForTimeout(1000);

const replay = (events) => page.evaluate((list) => {
  window.__callLogProbe.clear();
  for (const e of list) window.__callLogProbe.append(e);
  return window.__callLogProbe.rows().map((r) => r.status);
}, events);

const P = { name: 'Sara', peerId: 'peer-sara', mode: 'voice' };
const answered = [
  { ...P, status: 'ringing', direction: 'in', logToChat: false },
  { ...P, status: 'answered', direction: 'in', logToChat: false },
  { ...P, status: 'ended', direction: 'in', durationMs: 42000 },
];

check('an answered call that ends is one row',
  JSON.stringify(await replay(answered)) === '["ended"]');

/* The two envelopes that arrive from the other side after it tore down. */
for (const kind of ['call-cancel', 'call-missed']) {
  const got = await replay([...answered, { ...P, status: 'missed', direction: 'in' }]);
  check(`a late ${kind} does not invent a missed call`,
    JSON.stringify(got) === '["ended"]', JSON.stringify(got));
}

/* The shapes a late notice actually arrives in. Each carries the SENDER'S
   clock, which is not the moment the call started. */
const CALL_AT = '2026-09-21T10:00:00.000Z';
const answeredAt = (minutes) => ([
  { ...P, status: 'ringing', direction: 'in', logToChat: false, createdAt: CALL_AT },
  { ...P, status: 'answered', direction: 'in', logToChat: false, createdAt: CALL_AT },
  { ...P, status: 'ended', direction: 'in', durationMs: minutes * 60000, createdAt: CALL_AT },
]);
const lateNotice = (at) => ({ ...P, status: 'missed', direction: 'in', createdAt: at });

check('a queued notice delivered later, stamped at the call itself, is dropped',
  JSON.stringify(await replay([...answeredAt(1), lateNotice(CALL_AT)])) === '["ended"]',
  JSON.stringify(await replay([...answeredAt(1), lateNotice(CALL_AT)])));

check('a ring-timeout notice stamped forty seconds in is dropped',
  JSON.stringify(await replay([...answeredAt(5), lateNotice('2026-09-21T10:00:40.000Z')])) === '["ended"]',
  JSON.stringify(await replay([...answeredAt(5), lateNotice('2026-09-21T10:00:40.000Z')])));

check('a hang-up notice for an hour-long call is dropped',
  JSON.stringify(await replay([...answeredAt(60), lateNotice('2026-09-21T11:00:00.000Z')])) === '["ended"]',
  JSON.stringify(await replay([...answeredAt(60), lateNotice('2026-09-21T11:00:00.000Z')])));

/* Two hours later is not the same call. The timestamp on these notices is the
   SENDER'S — the moment it gave up ringing — so one stamped two hours after a
   finished call is a second attempt that nobody answered, and it has to be
   logged. The window is what separates the two; without it the guard would
   swallow every later missed call from anyone you had ever spoken to. */
check('a SECOND call two hours later, unanswered, is a missed call of its own',
  JSON.stringify(await replay([...answeredAt(1), lateNotice('2026-09-21T12:00:00.000Z')])) === '["missed","ended"]',
  JSON.stringify(await replay([...answeredAt(1), lateNotice('2026-09-21T12:00:00.000Z')])));

check('a genuine missed call is still logged',
  JSON.stringify(await replay([{ ...P, status: 'missed', direction: 'in' }])) === '["missed"]');

check('a second attempt an hour after a completed call is its own row',
  JSON.stringify(await replay([
    { ...P, status: 'ringing', direction: 'in', logToChat: false, createdAt: '2026-09-21T10:00:00.000Z' },
    { ...P, status: 'ended', direction: 'in', durationMs: 42000, createdAt: '2026-09-21T10:00:00.000Z' },
    { ...P, status: 'missed', direction: 'in', createdAt: '2026-09-21T11:00:00.000Z' },
  ])) === '["missed","ended"]');

/* The other half of the same call. The side whose media never arrived learns
   the call ended from the far end's call-ended envelope, which closes its row
   with a real duration — and THEN its own endCurrentCall runs with its
   answered-at clock still zero and logs a missed call for the call it just
   finished. No envelope involved; this row is written locally. */
check('the side whose media never arrived does not log its own call twice',
  JSON.stringify(await replay([
    { ...P, status: 'outgoing', direction: 'out', logToChat: false, createdAt: CALL_AT },
    { ...P, status: 'ended', direction: 'out', durationMs: 60000, createdAt: CALL_AT, updateOnly: true },
    { ...P, status: 'missed', direction: 'out', createdAt: '2026-09-21T10:01:00.000Z' },
  ])) === '["ended"]',
  JSON.stringify(await replay([
    { ...P, status: 'outgoing', direction: 'out', logToChat: false, createdAt: CALL_AT },
    { ...P, status: 'ended', direction: 'out', durationMs: 60000, createdAt: CALL_AT, updateOnly: true },
    { ...P, status: 'missed', direction: 'out', createdAt: '2026-09-21T10:01:00.000Z' },
  ])));

check('a later no-answer, outside any completed call, is its own row',
  JSON.stringify(await replay([...answeredAt(1), { ...P, status: 'missed', direction: 'in', createdAt: '2026-09-21T12:00:00.000Z' }])) === '["missed","ended"]');

check('the caller whose media never arrived still records its own no-answer',
  JSON.stringify(await replay([
    { ...P, status: 'outgoing', direction: 'out', logToChat: false },
    { ...P, status: 'missed', direction: 'out' },
  ])) === '["missed"]');

/* The de-duplication this sits next to still has to work. */
check('the several notices of one unanswered call stay one row',
  JSON.stringify(await replay([
    { ...P, status: 'ringing', direction: 'in', logToChat: false },
    { ...P, status: 'missed', direction: 'in' },
    { ...P, status: 'missed', direction: 'in' },
    { ...P, status: 'ended', direction: 'in' },
  ])) === '["missed"]');

console.log('\n  page errors:', errors.length ? errors.slice(0, 3) : 'none');
check('no script threw', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====\n`);
process.exit(failed ? 1 : 0);
