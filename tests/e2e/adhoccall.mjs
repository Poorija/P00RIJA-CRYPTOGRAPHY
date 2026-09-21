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

   A group call that belongs to no group. The call protocol never needed one -
   people announce themselves and answer each other - but joining used to
   insist on finding a stored group record, so an invitation to a call put
   together by hand did nothing when it was accepted. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function app(tag) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} window.__clip = []; window.__err = [];
    window.addEventListener('error', (e) => window.__err.push('ERR ' + e.message));
    window.addEventListener('unhandledrejection', (e) => window.__err.push('REJ ' + (e.reason?.message || e.reason))); });
  const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((pass) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('setupPassword', pass); set('confirmPassword', pass);
    document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => { inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); });
    const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  }, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(2500);
  await page.evaluate((name) => {
    const w = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__clip.push(t); return w(t).catch(() => {}); };
    const n = document.getElementById('chatDisplayName'); if (n) { n.value = name; n.dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('chatSaveProfileBtn')?.click();
    document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');
  }, tag);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(6500);
  return page;
}
const imp = (p, x) => p.evaluate(async (t) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-chat-manual-json]').value = t;
  document.querySelector('[data-chat-manual-submit]')?.click();
}, x);
const idOf = (p) => p.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });

const A = await app('ALPHA'); const B = await app('BETA'); const C = await app('GAMMA');
const idA = await idOf(A); const idB = await idOf(B); const idC = await idOf(C);
const fpOf = (x) => JSON.parse(atob(x.replace('poorija-chat-v1:', '')))?.fingerprint;
const fpB = fpOf(idB); const fpC = fpOf(idC);
await imp(A, idB); await imp(A, idC); await imp(B, idA); await imp(B, idC); await imp(C, idA); await imp(C, idB);
await A.waitForTimeout(4000);

console.log('\n===== the Calls tab can start one =====');
await A.evaluate(() => document.querySelector('[data-chat-view="calls"]')?.click());
await A.waitForTimeout(1200);
/* Addressed by data attribute, not id: the calls list is drawn into the rail
   on a phone and the facing panel on a desktop, so on a wide screen the same
   markup exists twice and an id would be a lie. */
const entry = await A.evaluate(() => ({
  voice: document.querySelectorAll('[data-adhoc-call="voice"]').length > 0,
  video: document.querySelectorAll('[data-adhoc-call="video"]').length > 0,
  groupsExist: (window.__spacesDeepProbe?.() || []).length,
}));
console.log('  ' + JSON.stringify(entry));
check('the Calls tab offers a group call without any group existing',
  entry.voice && entry.video && entry.groupsExist === 0, JSON.stringify(entry));

await A.evaluate(() => document.querySelector('[data-adhoc-call="voice"]')?.click());
await A.waitForTimeout(900);
const picker = await A.evaluate(() => ({
  open: !document.getElementById('chatCallPicker')?.classList.contains('hidden'),
  rows: document.querySelectorAll('#chatCallPickerList input[type="checkbox"]').length,
}));
console.log('  ' + JSON.stringify(picker));
check('it opens a picker listing the contacts', picker.open && picker.rows >= 2, JSON.stringify(picker));

/* By fingerprint, not "all of them": the relay also advertises real devices,
   so a picker on a shared relay lists more than this harness created. */
await A.evaluate(({ b, c }) => {
  document.querySelectorAll('#chatCallPickerList input[type="checkbox"]').forEach((box) => {
    box.checked = (box.value === b || box.value === c);
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
}, { b: fpB, c: fpC });
await A.waitForTimeout(400);
const counted = await A.evaluate(() => document.getElementById('chatCallPickerCount')?.textContent || '');
check('and says how many were picked', /2/.test(counted), counted);

await A.evaluate(() => document.querySelector('[data-call-picker-go]')?.click());
await A.waitForTimeout(7000);
const ringing = async (p) => p.evaluate(() => ({
  invited: !document.getElementById('chatGroupCallInvite')?.classList.contains('hidden'),
  heading: document.querySelector('.chat-gcall-invite-body strong')?.textContent?.trim() || '',
  roster: (() => { try { return JSON.parse(document.getElementById('chatGroupCallInvite')?.dataset.roster || '[]').length; } catch (e) { return -1; } })(),
}));
const bRing = await ringing(B); const cRing = await ringing(C);
console.log('  B: ' + JSON.stringify(bRing));
console.log('  C: ' + JSON.stringify(cRing));
check('both contacts are rung', bRing.invited && cRing.invited, JSON.stringify({ b: bRing.invited, c: cRing.invited }));
check('the invitation carries who else was asked', bRing.roster >= 2 && bRing.roster <= 3, `${bRing.roster} on the roster`);
check('and it is not presented as a group', !/گروه$/.test(bRing.heading) || /تماس/.test(bRing.heading), bRing.heading);
check('no group was created by calling', (await A.evaluate(() => (window.__spacesDeepProbe?.() || []).length)) === 0, 'still 0 groups');

console.log('\n===== accepting works without a stored group =====');
await B.evaluate(() => document.querySelector('[data-gcall-accept]')?.click());
await B.waitForTimeout(6000);
const bIn = await B.evaluate(() => ({
  stageOpen: !document.getElementById('chatGroupCall')?.classList.contains('hidden'),
  errs: (window.__err || []).slice(-3),
}));
console.log('  B: ' + JSON.stringify(bIn));
check('the invited contact actually joins', bIn.stageOpen, JSON.stringify(bIn));
check('and nothing threw on the way', bIn.errs.length === 0, JSON.stringify(bIn.errs));

console.log('\n===== a two-person call can grow =====');
const addBtn = await A.evaluate(() => Boolean(document.getElementById('chatCallAddPeopleBtn')));
check('a call in progress offers a way to add people', addBtn, String(addBtn));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
