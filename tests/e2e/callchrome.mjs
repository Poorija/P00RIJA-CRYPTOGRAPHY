/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A call is activity, an hour is an hour, and a call log says what it moved.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   PORT=8123 npm run dev         # terminal 1
 *   PKG_URL=http://localhost:8123 node tests/e2e/callchrome.mjs
 *
 * Three reports, all from using the thing:
 *
 *   - auto-lock counts inactivity from the last input event, and a call is
 *     exactly when there is none. Locking tears the media down, so a five
 *     minute timer ended a longer call mid-sentence.
 *   - formatDuration had no ceiling on minutes, so ninety minutes of talking
 *     read as "90:45" — a number nobody converts in their head.
 *   - the call log recorded how long a call lasted and nothing about what it
 *     cost, which is the figure people are asked about on a metered plan.
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('dialog', (d) => d.accept());
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

console.log('\n===== an hour reads as an hour =====');
const durations = await page.evaluate(() => {
  if (typeof formatDuration !== 'function') return { missing: true };
  return {
    short: formatDuration(45000),
    minutes: formatDuration(90000),
    justUnder: formatDuration(3599000),
    hour: formatDuration(3600000),
    reported: formatDuration(5445000),
    long: formatDuration(36000000),
  };
});
check('the chat module exposes formatDuration', !durations.missing);
check('under an hour still reads m:ss', durations.minutes === '1:30', String(durations.minutes));
check('and the last second before an hour does too', durations.justUnder === '59:59', String(durations.justUnder));
check('AN HOUR AND A HALF READS 1:30:45, NOT 90:45 — the report',
  durations.reported === '1:30:45', String(durations.reported));
check('and double figures of hours keep working', durations.long === '10:00:00', String(durations.long));

console.log('\n===== a live call is activity =====');
const lock = await page.evaluate(async () => {
  const app = window.PoorijaApp;
  if (typeof callIsLive !== 'function') return { missing: true };
  /* Drive the guard rather than the five-minute timer: the question is whether
     a live call is seen as activity, not how long the timer is. */
  const before = callIsLive();
  chatState.currentCall = { peer: 'probe' };
  const duringDirect = callIsLive();
  chatState.currentCall = null;
  const afterDirect = callIsLive();
  chatState.groupCall = { callId: 'probe-group' };
  const duringGroup = callIsLive();
  chatState.groupCall = null;
  return { before, duringDirect, afterDirect, duringGroup, app: Boolean(app) };
});
check('the app exposes the guard auto-lock consults', !lock.missing,
  'without it the timer cannot tell a call from an idle window');
check('nothing live reads as idle', lock.before === false, String(lock.before));
check('A ONE-TO-ONE CALL COUNTS AS ACTIVITY — the report',
  lock.duringDirect === true, String(lock.duringDirect));
check('a group call counts too', lock.duringGroup === true, String(lock.duringGroup));
check('and the guard lets go when the call ends', lock.afterDirect === false, String(lock.afterDirect));

console.log('\n===== a call log says what it moved =====');
const traffic = await page.evaluate(() => {
  if (typeof formatCallTraffic !== 'function') return { missing: true };
  return {
    none: formatCallTraffic({ durationMs: 1000 }),
    both: formatCallTraffic({ bytesIn: 5_242_880, bytesOut: 1_048_576 }),
    inOnly: formatCallTraffic({ bytesIn: 2048, bytesOut: 0 }),
  };
});
check('the calls list can format traffic', !traffic.missing);
check('a call with no figures says nothing', traffic.none === '', JSON.stringify(traffic.none));
check('DOWNLOAD AND UPLOAD BOTH APPEAR — the report',
  /5 MB/.test(traffic.both) && /1 MB/.test(traffic.both), traffic.both);
check('and one direction alone still reads', /2 KB/.test(traffic.inOnly), traffic.inOnly);

/* The counters have to survive a reload or the list is empty after a restart.
   Asserted against the record builder itself rather than a round trip, because
   writing a call log needs a peer and a connection that a headless run has
   neither of — and an assertion that returns true unconditionally is worse
   than no assertion, which is what an earlier draft of this block was. */
const recordShape = await page.evaluate(() => {
  if (typeof appendCallLogEntry !== 'function' && typeof appendCall !== 'function') return { missing: true };
  const source = String((typeof appendCall === 'function' ? appendCall : appendCallLogEntry));
  return { keepsIn: source.includes('bytesIn'), keepsOut: source.includes('bytesOut') };
});
check('the record that is written keeps both counts',
  recordShape.missing ? false : (recordShape.keepsIn && recordShape.keepsOut),
  JSON.stringify(recordShape));

await browser.close();
const bad = results.filter((ok) => !ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
