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

   Does the desktop have everything the phone has?

   Four separate group bugs shipped because nobody compared the two layouts
   control by control - the dissolve buttons were in a <footer> that mobile
   hides, the group rules listed four of twelve, the "some of us are here"
   ring had no display rule. Each was invisible to a reading of the code and
   obvious to a count.

   So: count. Open the same group panel at a phone width and a desktop width,
   enumerate every control in it, and diff the two sets. A control that exists
   on one and not the other is either a deliberate difference or a bug, and
   this file is where that decision has to be written down. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

/* Differences that are meant to be there. Anything else the diff finds is a
   finding, not a footnote. */
const ALLOWED = new Set([]);

const browser = await chromium.launch();
const initScript = () => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} };

const setup = async (page, name) => {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate(({ pass, tag }) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('setupPassword', pass); set('confirmPassword', pass); set('setupUsername', tag);
    document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => { if (!inp.value) { inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); } });
    const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  }, { pass: PASS, tag: name });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(2600);
  await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(6000);
};

const idOf = (page) => page.evaluate(() => window.PoorijaChat?.identityFingerprint?.() || '');
const mk = async (tag) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
  await setup(page, tag);
  return { page, ctx };
};

const A = await mk('OWNER');
const B = await mk('MEMBER');
const fpB = await idOf(B.page);

console.log('\n===== a group to look at =====');
await A.page.evaluate(() => document.querySelector('[data-chat-view="groups"]')?.click());
await A.page.waitForTimeout(1000);
await A.page.evaluate(() => document.getElementById('chatStartChatBtn')?.click());
await A.page.waitForTimeout(900);
const made = await A.page.evaluate(async (fp) => {
  const name = document.getElementById('chatGroupNameInput');
  if (!name) return false;
  name.value = 'ParityRoom'; name.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelectorAll('#chatGroupMembersPanel input[type=checkbox]').forEach((box) => {
    box.checked = box.value === fp; box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 400));
  document.getElementById('chatCreateGroupBtn')?.click();
  return true;
}, fpB);
await A.page.waitForTimeout(4000);
check('a group exists to compare', made === true, String(made));

const openPanel = async (page) => {
  await page.evaluate(() => {
    document.querySelector('[data-chat-view="groups"]')?.click();
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#chatPeerList .chat-peer-card')].find((x) => x.textContent.includes('ParityRoom'));
    card?.click();
  });
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    document.getElementById('chatThreadMenuBtn')?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('chatSpaceInfoBtn')?.click());
  await page.waitForTimeout(1200);
};

/* Every control the panel offers, named by what it does rather than by where
   it sits, plus whether a person could actually press it. */
const inventory = async (page) => page.evaluate(() => {
  const named = (el) => {
    for (const attr of el.getAttributeNames()) {
      if (attr.startsWith('data-space') || attr.startsWith('data-perms')) return attr;
    }
    return el.id ? `#${el.id}` : '';
  };
  const usable = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0.05 && box.width > 0 && box.height > 0;
  };
  const panel = document.getElementById('chatSpaceInfo');
  if (!panel || panel.classList.contains('hidden')) return { open: false, controls: [] };
  const found = new Map();
  panel.querySelectorAll('button, input, [data-space-desc], [data-space-avatar]').forEach((el) => {
    const key = named(el);
    if (!key) return;
    if (!found.has(key) || usable(el)) found.set(key, usable(el));
  });
  return { open: true, controls: [...found.entries()].filter(([, ok]) => ok).map(([key]) => key).sort() };
});

console.log('\n===== the panel on a desktop =====');
await openPanel(A.page);
const desktop = await inventory(A.page);
console.log('  ' + JSON.stringify(desktop.controls));
check('the panel opens on a desktop at all', desktop.open === true, String(desktop.open));
check('and it is not empty', desktop.controls.length >= 5, `${desktop.controls.length} control(s)`);

console.log('\n===== the same panel on a phone =====');
await A.page.setViewportSize({ width: 390, height: 844 });
await A.page.waitForTimeout(1400);
await openPanel(A.page);
const phone = await inventory(A.page);
console.log('  ' + JSON.stringify(phone.controls));
check('the panel opens on a phone', phone.open === true, String(phone.open));

console.log('\n===== what one has and the other does not =====');
const onlyPhone = phone.controls.filter((c) => !desktop.controls.includes(c) && !ALLOWED.has(c));
const onlyDesktop = desktop.controls.filter((c) => !phone.controls.includes(c) && !ALLOWED.has(c));
console.log(`  only on the phone  : ${JSON.stringify(onlyPhone)}`);
console.log(`  only on the desktop: ${JSON.stringify(onlyDesktop)}`);
check('the desktop is missing nothing the phone offers', onlyPhone.length === 0, onlyPhone.join(', ') || 'nothing missing');
check('and the phone is missing nothing the desktop offers', onlyDesktop.length === 0, onlyDesktop.join(', ') || 'nothing missing');

console.log('\n===== the rules dialog, both ways =====');
const rulesAt = async (page, label) => {
  await page.evaluate(() => document.querySelector('[data-space-perms-open]')?.click());
  await page.waitForTimeout(700);
  const out = await page.evaluate(() => {
    const dialog = document.getElementById('chatPermsDialog');
    const card = dialog?.querySelector('.chat-perms-card');
    const box = card?.getBoundingClientRect();
    return {
      rows: dialog ? dialog.querySelectorAll('[data-space-perm]').length : 0,
      onBody: dialog?.parentElement === document.body,
      fits: box ? (box.width <= window.innerWidth + 1 && box.height <= window.innerHeight + 1) : false,
      clipped: box ? (box.top < -1 || box.left < -1) : true,
    };
  });
  console.log(`  ${label}: ${JSON.stringify(out)}`);
  await page.evaluate(() => document.querySelector('[data-perms-close]')?.click());
  await page.waitForTimeout(300);
  return out;
};
const expected = await A.page.evaluate(() => window.__spacePermsProbe?.().length || 0);
const rulesPhone = await rulesAt(A.page, 'phone  ');
await A.page.setViewportSize({ width: 1440, height: 900 });
await A.page.waitForTimeout(1200);
await openPanel(A.page);
const rulesDesktop = await rulesAt(A.page, 'desktop');

check('every rule is listed on both', expected > 0 && rulesPhone.rows === expected && rulesDesktop.rows === expected,
  `phone ${rulesPhone.rows}, desktop ${rulesDesktop.rows}, of ${expected}`);
check('the dialog escapes the clipped shell on both', rulesPhone.onBody && rulesDesktop.onBody,
  `${rulesPhone.onBody} / ${rulesDesktop.onBody}`);
check('and fits the screen on both, unclipped',
  rulesPhone.fits && rulesDesktop.fits && !rulesPhone.clipped && !rulesDesktop.clipped,
  JSON.stringify({ phone: rulesPhone, desktop: rulesDesktop }));

console.log('\n===== a group is not offered a one-to-one session =====');
const groupMenu = await A.page.evaluate(async () => {
  document.getElementById('chatThreadMenuBtn')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const session = document.getElementById('chatStartSessionBtn');
  const verify = document.getElementById('chatVerifyKeyBtn');
  return {
    sessionHidden: Boolean(session?.classList.contains('hidden')),
    verifyHidden: Boolean(verify?.classList.contains('hidden')),
    infoShown: !document.getElementById('chatSpaceInfoBtn')?.classList.contains('hidden'),
  };
});
console.log('  ' + JSON.stringify(groupMenu));
check('a group hides the controls that only make sense one-to-one',
  groupMenu.sessionHidden && groupMenu.verifyHidden, JSON.stringify(groupMenu));
check('and keeps the one that is its own', groupMenu.infoShown === true, String(groupMenu.infoShown));

const errs = await A.page.evaluate(() => window.__parityErrors || []);
check('no script threw during any of it', errs.length === 0, errs.join(' | ') || 'clean');

await A.ctx.close(); await B.ctx.close(); await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
