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

   A passphrase on the file manager. What it is, and what it is not, both have
   to be true: the files were already encrypted under the master password, so
   this hides the list on a device that is already unlocked - a curtain, not a
   second wall. These checks pin the behaviour and the wording, because a lock
   that is described as more than it is would be worse than no lock. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
/* Exercise the same API as the shipping UI, without enabling debug probes. */
await ctx.addInitScript(() => { localStorage.setItem('poorija_lang', 'en'); });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
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
await page.waitForTimeout(2600);
await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); });
await page.waitForTimeout(800);

console.log('\n===== the lock itself =====');
const api = await page.evaluate(() => (window.PoorijaChat.vaultLock() ? Object.keys(window.PoorijaChat.vaultLock()).sort() : null));
check('the file manager has a lock to set', Boolean(api), JSON.stringify(api));

const flow = await page.evaluate(async () => {
  const lock = window.PoorijaChat.vaultLock();
  if (!lock) return { missing: true };
  const tooShort = await lock.enable('abc');
  const set = await lock.enable('a-good-passphrase');
  const state1 = lock.state();
  const wrong = await lock.tryUnlock('not-it');
  const right = await lock.tryUnlock('a-good-passphrase');
  const state2 = lock.state();
  await lock.disable('a-good-passphrase');
  return { tooShort, set, enabledAfterSet: state1.enabled, wrong, right, unlockedAfter: state2.unlocked, offAfterDisable: lock.state().enabled };
});
console.log('  ' + JSON.stringify(flow));
check('a passphrase that is too short is refused', flow.tooShort === false, String(flow.tooShort));
check('a real one is accepted and turns the lock on', flow.set === true && flow.enabledAfterSet === true, JSON.stringify(flow));
check('the wrong passphrase does not open it', flow.wrong === false, String(flow.wrong));
check('the right one does', flow.right === true && flow.unlockedAfter === true, JSON.stringify(flow));
check('and it can be turned off again', flow.offAfterDisable === false, String(flow.offAfterDisable));

console.log('\n===== the passphrase is not stored =====');
const stored = await page.evaluate(() => {
  let raw = '';
  try { raw = String(localStorage.getItem('poorija_vault_lock') || ''); } catch (e) { raw = 'unreadable'; }
  return { raw: raw.slice(0, 60), holdsIt: raw.includes('a-good-passphrase') };
});
console.log('  ' + JSON.stringify(stored));
check('what is written down is not the passphrase', stored.holdsIt === false, stored.raw.slice(0, 40));

console.log('\n===== the tab, and what it claims =====');
const ui = await page.evaluate(async () => {
  window.switchTab?.('vault');
  await new Promise((r) => setTimeout(r, 900));
  const panel = document.getElementById('content-vault');
  const text = panel?.innerText || '';
  return {
    open: Boolean(panel) && !panel.classList.contains('hidden'),
    hasManager: Boolean(document.querySelector('#content-vault #vaultFileList, #content-vault [data-vault-files]')),
    saysWhatItIs: /رمزگذاری|encrypted/i.test(text),
    saysWhatItIsNot: /روی همین دستگاه|on this device|رمز مستر|master password/i.test(text),
  };
});
console.log('  ' + JSON.stringify(ui));
check('the file manager has a place of its own', ui.open === true && ui.hasManager === true, JSON.stringify(ui));
check('and says plainly what the passphrase does and does not do',
  ui.saysWhatItIs === true && ui.saysWhatItIsNot === true, JSON.stringify(ui));

console.log('\n===== the same manager in both places =====');
const mounts = await page.evaluate(async () => {
  window.switchTab?.('vault');
  await new Promise((r) => setTimeout(r, 1800));
  const tabMount = document.getElementById('vaultFileManager');
  const rich = Boolean(tabMount && tabMount.querySelector('.chat-files-head') && tabMount.querySelector('.chat-files-list'));
  window.switchTab?.('chat');
  await new Promise((r) => setTimeout(r, 1200));
  document.getElementById('chatFileManagerToggle')?.click();
  await new Promise((r) => setTimeout(r, 1400));
  const chatMount = document.getElementById('chatFileManager');
  const chatRich = Boolean(chatMount && !chatMount.classList.contains('hidden') && chatMount.querySelector('.chat-files-list'));
  return { rich, chatRich, mounts: document.querySelectorAll('[data-file-manager]').length };
});
console.log('  ' + JSON.stringify(mounts));
check('the tab shows the real file manager, not a stub', mounts.rich === true, JSON.stringify(mounts));
check('and Secure Chat still shows its own copy', mounts.chatRich === true, JSON.stringify(mounts));

console.log('\n===== locking hides the listing =====');
const hidden = await page.evaluate(async () => {
  const lock = window.PoorijaChat?.vaultLock?.();
  await lock.enable('a-good-passphrase');
  lock.lock();
  window.switchTab?.('vault');
  await new Promise((r) => setTimeout(r, 1500));
  const manager = document.getElementById('vaultFileManager');
  const out = {
    managerHidden: Boolean(manager?.classList.contains('hidden')) && !manager?.innerHTML.trim(),
    curtain: /قفل|Locked/i.test(document.querySelector('#content-vault > .shared-section-lock')?.innerText || ''),
  };
  await lock.tryUnlock('a-good-passphrase');
  await lock.disable('a-good-passphrase');
  return out;
});
console.log('  ' + JSON.stringify(hidden));
check('a locked vault renders no file names at all', hidden.managerHidden === true, JSON.stringify(hidden));
check('and says why it is empty', hidden.curtain === true, JSON.stringify(hidden));

console.log('\n===== sizes read the right way round in Persian =====');
const sizes = await page.evaluate(async () => {
  const f = window.PoorijaApp?.formatBytes || window.formatBytes;
  const samples = [0, 1024, 9050030, 4083130368, 1.5e13, 1e16].map((n) => f(n));
  window.switchTab?.('vault');
  await new Promise((r) => setTimeout(r, 1500));
  const donut = document.querySelector('#vaultFileManager .chat-files-donut-total')?.textContent || '';
  return { samples, donut, raw: samples.map((s) => [...s].map((ch) => ch.codePointAt(0)).slice(0, 1)) };
});
console.log('  ' + JSON.stringify(sizes.samples));
/* U+2066 opens a left-to-right isolate. Without it the bidi algorithm puts
   the Latin unit first and a Persian reader sees "Bytes 0". */
check('every size is wrapped so the unit stays after the number',
  sizes.samples.every((s) => s.startsWith('\u2066') && s.endsWith('\u2069')),
  JSON.stringify(sizes.samples.map((s) => s.codePointAt(0))));
check('and none of them falls off the end of the unit table',
  sizes.samples.every((s) => !/undefined/.test(s)), sizes.samples.join(' | '));
check('the file manager shows one of them', /Bytes|KB|MB|GB/.test(sizes.donut), sizes.donut || '(empty)');

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
