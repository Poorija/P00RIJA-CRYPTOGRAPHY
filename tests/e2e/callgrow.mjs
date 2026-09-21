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

   A call between two people, growing to three.

   Adding somebody used to look, from the far end, like being hung up on and
   immediately called back: the upgrade invitation went out and then the plain
   teardown sent "the call ended" right behind it. The person already on the
   line saw their call drop and a new three-way call arrive.

   What should happen: the third person's phone rings, everybody else stays in
   the call they were already in, and nobody is told anything ended. */
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


console.log('\n===== two people, on a call =====');
await A.evaluate(() => document.querySelector('[data-chat-view="chats"]')?.click());
await A.waitForTimeout(800);
await A.evaluate((fp) => {
  const card = [...document.querySelectorAll('#chatPeerList .chat-peer-card')]
    .find((x) => x.outerHTML.includes(fp.slice(0, 16)));
  card?.click();
}, fpB);
await A.waitForTimeout(1500);
await A.evaluate(() => document.getElementById('chatThreadMenuBtn')?.click());
await A.waitForTimeout(400);
await A.evaluate(() => document.getElementById('chatVoiceCallBtn')?.click());
await B.waitForTimeout(3500);
const answered = await (async () => {
  for (let i = 0; i < 20; i += 1) {
    const done = await B.evaluate(() => {
      const visible = (el) => el && !el.classList.contains('hidden') && el.offsetParent !== null;
      const a = document.getElementById('chatAcceptCallBtn');
      const m = document.getElementById('chatModalAcceptBtn');
      if (visible(a)) { a.click(); return 'sheet'; }
      if (visible(m)) { m.click(); return 'modal'; }
      return '';
    });
    if (done) return done;
    await B.waitForTimeout(500);
  }
  return '';
})();
await A.waitForTimeout(5000);
const pairUp = await A.evaluate(() => window.__callStateProbe?.() || {});
console.log('  B answered via: ' + answered + '   A: ' + JSON.stringify(pairUp));
check('the pair call is up', Boolean(answered) && pairUp.live === true, JSON.stringify(pairUp));

console.log('\n===== a third person is added =====');
/* Everything B is told from here on. If "the call ended" is in it, the bug is
   back however healthy the call looks afterwards. */
const bBefore = await B.evaluate(() => ({
  toasts: (window.__toasts || []).length,
  logRows: (window.__callLogProbe?.rows?.() || []).length,
}));
await A.evaluate(() => document.getElementById('chatCallAddPeopleBtn')?.click());
await A.waitForTimeout(900);
const picked = await A.evaluate((fp) => {
  const rows = [...document.querySelectorAll('#chatCallPickerList input[type="checkbox"]')];
  const wanted = rows.find((box) => String(box.value).includes(fp.slice(0, 16)));
  if (!wanted) return { rows: rows.length, found: false };
  wanted.checked = true;
  wanted.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('[data-call-picker-go]')?.click();
  return { rows: rows.length, found: true };
}, fpC);
console.log('  picker: ' + JSON.stringify(picked));
check('the picker offers somebody to add', picked.found === true, JSON.stringify(picked));

await C.waitForTimeout(7000);
const cRing = await C.evaluate(() => ({
  invited: Boolean(document.querySelector('[data-gcall-accept]')),
  ringing: !document.getElementById('chatGroupCallInvite')?.classList.contains('hidden'),
}));
console.log('  C: ' + JSON.stringify(cRing));
check('the third person is rung', cRing.invited === true, JSON.stringify(cRing));

await B.waitForTimeout(3000);
const bAfter = await B.evaluate(() => ({
  newToasts: (window.__toasts || []).slice(-6),
  stageOpen: !document.getElementById('chatGroupCall')?.classList.contains('hidden'),
  logRows: (window.__callLogProbe?.rows?.() || []).length,
  lastLog: (window.__callLogProbe?.rows?.() || [])[0] || null,
}));
console.log('  B: ' + JSON.stringify(bAfter));
check('the person already on the line is moved across, not hung up on',
  bAfter.stageOpen === true, JSON.stringify(bAfter));
check('and is never told the call ended',
  !bAfter.newToasts.some((line) => /پایان|ended|قطع/i.test(String(line))),
  JSON.stringify(bAfter.newToasts));
check('nor gains a finished call in their log',
  bAfter.logRows === bBefore.logRows, `${bBefore.logRows} -> ${bAfter.logRows}`);

console.log('\n===== everybody can see everybody =====');
/* The stage looking right proves nothing: the mesh is the part that fails
   quietly, and when it does every screen shows the right names and not one
   picture moves. Ask each device who it is actually receiving from. */
await C.evaluate(() => document.querySelector('[data-gcall-accept]')?.click());
await Promise.all([A, B, C].map((p) => p.waitForTimeout(12000)));
const mesh = {
  A: await A.evaluate(() => window.__gcallMeshProbe?.() || null),
  B: await B.evaluate(() => window.__gcallMeshProbe?.() || null),
  C: await C.evaluate(() => window.__gcallMeshProbe?.() || null),
};
for (const [who, m] of Object.entries(mesh)) {
  console.log(`  ${who}: ` + JSON.stringify(m));
}
check('all three are in a call', Object.values(mesh).every((m) => m?.active === true),
  JSON.stringify(Object.entries(mesh).map(([k, m]) => `${k}:${m?.active}`)));
check('and in the SAME call', new Set(Object.values(mesh).map((m) => m?.callId)).size === 1,
  JSON.stringify(Object.entries(mesh).map(([k, m]) => `${k}:${String(m?.callId).slice(0, 14)}`)));
check('each of them sees the other two',
  Object.values(mesh).every((m) => (m?.participants || []).length === 2),
  JSON.stringify(Object.entries(mesh).map(([k, m]) => `${k}:${(m?.participants || []).length}`)));
check('and is receiving a live picture from both',
  Object.values(mesh).every((m) => (m?.participants || []).length === 2
    && m.participants.every((entry) => entry.hasStream && entry.live)),
  JSON.stringify(Object.entries(mesh).map(([k, m]) => `${k}:${(m?.participants || []).map((e) => e.live).join(',')}`)));

const errs = await Promise.all([A, B, C].map((p) => p.evaluate(() => (window.__err || []).slice(-3))));
check('nothing threw on any of the three', errs.every((list) => list.length === 0), JSON.stringify(errs));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
