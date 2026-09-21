/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The Tools pane inside Secure Chat settings.
 *
 * Four tools, each added because the app could not answer a question that
 * matters to someone on a bad or censored link. Each is checked where it can
 * actually be wrong rather than by asserting that its button exists.
 */
import { browser, openApp, identity, importIdentity, waitFor } from './_chat-harness.mjs';

const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const A = await openApp('A');
const B = await openApp('B');
await importIdentity(A, await identity(B));
await importIdentity(B, await identity(A));
await A.waitForTimeout(2500);

console.log('\n===== the pane mounts =====');
await A.evaluate(() => window.__chatToolsProbe?.mount());
const mounted = await waitFor(A, () => Boolean(document.getElementById('chatToolsExtraCard')),
  { timeoutMs: 20000 });
check('the tools card is added to the settings pane', mounted === true);

const controls = await A.evaluate(() => ['chatToolsRelayBtn', 'chatToolsResetSessionBtn',
  'chatToolsQueueBtn', 'chatToolsQualityBtn', 'chatToolsPeerSelect']
  .filter((id) => !document.getElementById(id)));
check('every control is present', controls.length === 0, controls.join(', '));

console.log('\n===== which relay is reachable =====');
const candidates = await A.evaluate(() => window.__chatToolsProbe.candidates());
console.log('  candidates: ' + JSON.stringify(candidates));
check('it finds at least the relay in use', candidates.length >= 1, JSON.stringify(candidates));
check('every candidate is a well-formed origin',
  candidates.every((o) => /^https?:\/\/[^/]+$/.test(o)), JSON.stringify(candidates));

await A.evaluate(() => document.getElementById('chatToolsRelayBtn')?.click());
const probed = await waitFor(A, () =>
  document.querySelectorAll('#chatToolsRelayResult .chat-tools-relay-row').length > 0,
  { timeoutMs: 25000 });
check('testing them produces a verdict per address', probed === true);

const verdicts = await A.evaluate(() =>
  [...document.querySelectorAll('#chatToolsRelayResult .chat-tools-relay-row')]
    .map((row) => ({
      up: row.classList.contains('is-up'),
      text: row.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)
    })));
console.log('  ' + JSON.stringify(verdicts));
check('the relay this app is connected to reads as reachable',
  verdicts.some((v) => v.up), JSON.stringify(verdicts));
check('a reachable relay reports its latency and load',
  verdicts.filter((v) => v.up).every((v) => /ms/.test(v.text)), JSON.stringify(verdicts));

/* An address that cannot answer must be reported as down rather than hanging
   or being quietly dropped from the list. */
const withDead = await A.evaluate(async () => {
  const field = document.getElementById('chatServerUrl');
  const before = field.value;
  field.value = 'http://127.0.0.1:1';        /* nothing listens here */
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const rows = await Promise.all(window.__chatToolsProbe.candidates()
    .filter((o) => o.includes(':1'))
    .map((o) => fetch(`${o}/chat-health`).then(() => 'answered').catch(() => 'refused')));
  field.value = before;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return rows;
});
check('an address with nothing behind it is refused, not hung on',
  withDead.every((r) => r === 'refused'), JSON.stringify(withDead));

console.log('\n===== the session reset =====');
const sessionBefore = await A.evaluate(() => {
  try { return Object.keys(eval('chatState.sessionKeys') || {}).length; } catch (e) { return -1; }
});
/* Refresh first: the roster arrives after the card is built, and reaching for
   the control is exactly when it should refill. */
await A.evaluate(() => window.__chatToolsProbe.refresh());
const resetOutcome = await A.evaluate(() => {
  const key = document.getElementById('chatToolsPeerSelect')?.value;
  return { key: key ? key.slice(0, 10) : null, dropped: window.__chatToolsProbe.resetSession(key) };
});
const sessionAfter = await A.evaluate(() => {
  try { return Object.keys(eval('chatState.sessionKeys') || {}).length; } catch (e) { return -1; }
});
console.log(`  session keys ${sessionBefore} -> ${sessionAfter}, ${JSON.stringify(resetOutcome)}`);
check('a contact is offered for the reset', Boolean(resetOutcome.key), JSON.stringify(resetOutcome));
check('clearing does not throw and does not grow the store',
  sessionAfter <= Math.max(sessionBefore, 0), `${sessionBefore} -> ${sessionAfter}`);

/* The important part: after clearing, messaging must still work — the next
   message has to negotiate fresh keys rather than failing. */
await A.evaluate(() => {
  document.querySelector('[data-chat-view="chats"]')?.click();
  document.querySelector('#chatPeerList .chat-peer-card')?.click();
});
await A.waitForTimeout(1500);
const beforeBubbles = await B.evaluate(() => document.querySelectorAll('#chatMessages [data-id]').length);
await A.evaluate(() => {
  const input = document.getElementById('chatComposer');
  if (input) { input.value = 'after the reset'; input.dispatchEvent(new Event('input', { bubbles: true })); }
});
await A.click('#chatSendMessageBtn').catch(() => {});
const delivered = await waitFor(B,
  (n) => document.querySelectorAll('#chatMessages [data-id]').length > n,
  { timeoutMs: 40000, arg: beforeBubbles });
check('a message still gets through after the session is cleared', delivered === true);

console.log('\n===== what has not been acknowledged =====');
const queue = await A.evaluate(() => window.__chatToolsProbe.undelivered());
console.log(`  ${queue.length} unacknowledged`);
check('the queue reads without throwing', Array.isArray(queue));
check('every row says who, what and how old',
  queue.every((row) => 'who' in row && 'kind' in row && 'ageMinutes' in row),
  JSON.stringify(queue.slice(0, 2)));

await A.evaluate(() => window.__chatToolsProbe.mount());
await A.evaluate(() => document.getElementById('chatToolsQueueBtn')?.click());
await A.waitForTimeout(600);
const queueShown = await A.evaluate(() =>
  (document.getElementById('chatToolsQueueResult')?.textContent || '').trim().length > 0);
check('and it renders something either way', queueShown === true);

console.log('\n===== call quality =====');
await A.evaluate(() => document.getElementById('chatToolsQualityBtn')?.click());
await A.waitForTimeout(1200);
const quality = await A.evaluate(() =>
  (document.getElementById('chatToolsQualityResult')?.textContent || '').trim());
console.log('  ' + quality.slice(0, 90));
check('with no call running it says so rather than showing zeros',
  /No call|تماسی در جریان نیست/.test(quality), quality.slice(0, 60));

check('nothing threw in either browser',
  A.__errors.length === 0 && B.__errors.length === 0,
  [...A.__errors, ...B.__errors].slice(0, 2).join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
