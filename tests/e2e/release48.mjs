/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* chat-v48.
 *   - the phone's quick-access bar survives a lock and a quick-unlock;
 *   - Secure Chat's search is visible on a 360px Android and a 375px iPhone;
 *   - the shared lock covers the tabs the user ticks, and refuses to let go of
 *     Files, Secure Chat and Settings.
 * No relay needed. Run with E2E_ENGINE=webkit too — that is the iOS shell.
 */
import { chromium, webkit } from 'playwright';
import { settle } from './_settle.mjs';
const engine = process.env.E2E_ENGINE === 'webkit' ? webkit : chromium;
const BASE = process.env.PKG_URL || 'http://localhost:8099';
const PASS = 'Release48#Password!';
const LOCK = 'Shared48#Password!';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await engine.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (_e) {} try { delete Navigator.prototype.serviceWorker; } catch (_e) {} });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await settle(page);
await page.evaluate((pass) => {
  const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((e, i) => { e.value = 'answer' + i; e.dispatchEvent(new Event('input', { bubbles: true })); });
  const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('setupBtn')?.click());
await page.waitForFunction(() => window.PoorijaApp?.state?.isLocked === false, { timeout: 90000 });
await page.evaluate(() => document.getElementById('mobileInstallGate')?.classList.add('hidden'));

/* ---- 1. the quick-access bar after each way back in ---- */
const barState = () => page.evaluate(() => {
  const el = document.getElementById('mobileTabBar');
  const r = el.getBoundingClientRect();
  return { shown: getComputedStyle(el).display !== 'none' && r.height > 0,
    stale: document.body.classList.contains('app-locked'),
    unlocked: window.PoorijaApp?.state?.isLocked === false };
});
for (const shell of ['pwa-standalone', 'native-mobile']) {
  await page.evaluate((s) => { document.documentElement.classList.remove('pwa-standalone', 'native-mobile'); document.documentElement.classList.add(s); }, shell);
  await page.waitForTimeout(250);
  await page.evaluate(() => lockApp()); await page.waitForTimeout(900);
  const locked = await barState();
  check(`${shell}: the bar is gone while the lock screen is up`, !locked.shown && locked.stale, JSON.stringify(locked));
  /* The passkey and biometric routes do not go through unlockApp(); they land
     here, which is where the lock class used to survive the unlock. */
  await page.evaluate((p) => adoptFromPassword(p).then(() => unlockUI()), PASS);
  await page.waitForTimeout(1300);
  const back = await barState();
  check(`${shell}: the bar comes back after a quick-unlock`, back.shown && !back.stale && back.unlocked, JSON.stringify(back));
}
await page.evaluate(() => { document.documentElement.classList.remove('native-mobile'); document.documentElement.classList.add('pwa-standalone'); });

/* ---- 2. Secure Chat's search on the small phones ---- */
await page.evaluate(() => switchTab('chat'));
await page.waitForTimeout(700);
for (const [w, h, who] of [[360, 800, 'Android 360'], [375, 812, 'iPhone 375'], [412, 915, 'Android 412']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(350);
  const seen = await page.evaluate(() => {
    const btn = document.getElementById('chatSearchOpenBtn');
    const icon = btn?.querySelector('i');
    const br = btn.getBoundingClientRect(); const ir = icon.getBoundingClientRect();
    return { button: br.width > 0 && br.height > 0, icon: ir.width > 0 && ir.height > 0,
      inView: br.left >= 0 && br.right <= innerWidth, label: (btn.textContent || '').trim() };
  });
  check(`${who}: Secure Chat search has something to see and tap`, seen.button && seen.icon && seen.inView, JSON.stringify(seen));
}
await page.setViewportSize({ width: 390, height: 844 });

/* ---- 3. the shared lock covers what is ticked ---- */
await page.evaluate(() => switchTab('vault'));
await page.waitForTimeout(400);
check('the lock card offers a tab picker before any lock exists',
  await page.locator('#sharedSectionGate-vault [data-shared-tabs]').isVisible());

await page.locator('#sharedSectionGate-vault [data-shared-tabs]').click();
await page.waitForTimeout(400);
const fixedRows = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#sharedLockTabPicker .slock-row')];
  const byTab = (id) => rows.find((r) => r.querySelector(`[data-slock-tab="${id}"]`));
  return {
    total: rows.length,
    fixed: ['vault', 'chat', 'settings'].map((id) => {
      const box = byTab(id)?.querySelector('input');
      return { id, checked: !!box?.checked, disabled: !!box?.disabled };
    }),
    noteShown: (document.querySelector('#sharedLockTabPicker .slock-picker-fixed')?.textContent || '').length > 40,
    notesPasswords: !!byTab('passwords'),
  };
});
check('the three defaults are ticked and cannot be unticked',
  fixedRows.fixed.every((r) => r.checked && r.disabled), JSON.stringify(fixedRows.fixed));
check('and the picker says why they cannot be removed', fixedRows.noteShown);

/* Both languages, every visible string: the picker is built in code rather
   than from the data-i18n tables, so nothing else checks that its English
   exists. A string that stayed Persian under English, or came back empty, is
   the failure this catches. */
const strings = () => page.evaluate(() => {
  const root = document.getElementById('sharedLockTabPicker');
  const pill = root.querySelector('.slock-row.is-fixed .slock-row-pill');
  return {
    title: root.querySelector('[data-slock-title]').textContent.trim(),
    note: root.querySelector('[data-slock-note]').textContent.trim(),
    fixed: root.querySelector('[data-slock-fixed]').textContent.trim(),
    done: root.querySelector('.slock-picker-done').textContent.trim(),
    pill: (pill?.textContent || '').trim(),
    rows: [...root.querySelectorAll('.slock-row-label')].map((e) => e.textContent.trim()),
  };
});
const persian = await strings();
await page.evaluate(() => switchLanguage());
await page.waitForTimeout(500);
const english = await strings();
const persianScript = /[\u0600-\u06FF]/;
const keys = ['title', 'note', 'fixed', 'done', 'pill'];
check('every picker string has an English form', keys.every((k) => english[k] && !persianScript.test(english[k])),
  JSON.stringify(keys.filter((k) => !english[k] || persianScript.test(english[k]))));
check('and it is a different string from the Persian one', keys.every((k) => english[k] !== persian[k]),
  JSON.stringify(keys.filter((k) => english[k] === persian[k])));
check('the fixed-tab note keeps its full text in both languages',
  persian.fixed.length > 120 && english.fixed.length > 120 && persian.fixed.includes('\u{1F605}') && english.fixed.includes('\u{1F605}'),
  JSON.stringify({ fa: persian.fixed.length, en: english.fixed.length }));
check('every tab row is labelled in English too',
  english.rows.length === persian.rows.length && english.rows.every((r) => r && !persianScript.test(r)),
  JSON.stringify(english.rows.filter((r) => !r || persianScript.test(r)).slice(0, 4)));
await page.evaluate(() => switchLanguage());
await page.waitForTimeout(500);
check('other tabs are offered', fixedRows.total > 10 && fixedRows.notesPasswords, `${fixedRows.total} row(s)`);

await page.locator('#sharedLockTabPicker input[data-slock-tab="passwords"]').check();
await page.waitForTimeout(400);
check('ticking a tab is stored on the lock record',
  await page.evaluate(() => (window.PoorijaChat.vaultLock().extraTabs() || []).includes('passwords')));
await page.locator('#sharedLockTabPicker .slock-picker-done').click();
await page.waitForTimeout(300);
check('the picker closes', await page.locator('#sharedLockTabPicker').isHidden());

/* now set the password and confirm the extra tab is actually gated */
await page.locator('#sharedSectionGate-vault [data-shared-set]').click();
const dialog = page.locator('.poorija-dialog-backdrop.is-open');
await dialog.waitFor();
await dialog.locator('.poorija-dialog-input').first().fill(LOCK);
await dialog.locator('.poorija-dialog-confirm-input').fill(LOCK);
await dialog.locator('.poorija-dialog-ok').click();
await page.waitForFunction(() => vaultLockState().enabled && !vaultLockState().unlocked);

for (const tab of ['vault', 'chat', 'settings', 'passwords']) {
  await page.evaluate((t) => switchTab(t), tab);
  await page.waitForTimeout(350);
  check(`${tab} is behind the shared lock`, await page.evaluate((t) => {
    const pane = document.getElementById('content-' + t);
    const gate = document.getElementById('sharedSectionGate-' + t);
    return Boolean(gate) && pane.classList.contains('shared-section-locked')
      && [...pane.children].filter((c) => c !== gate).every((c) => c.inert && getComputedStyle(c).display === 'none');
  }, tab));
}
await page.evaluate(() => switchTab('notes'));
await page.waitForTimeout(350);
check('a tab that was not ticked is left alone',
  await page.evaluate(() => !document.getElementById('sharedSectionGate-notes')
    && !document.getElementById('content-notes').classList.contains('shared-section-locked')));

/* unlock, untick, and the tab has to be handed back */
await page.evaluate((p) => switchTab('vault') || p, LOCK);
await page.waitForTimeout(300);
await page.fill('#sharedSectionGate-vault input', LOCK);
await page.locator('#sharedSectionGate-vault [data-shared-open]').click();
await page.waitForFunction(() => vaultLockState().unlocked, { timeout: 20000 });
await page.locator('#sharedSectionGate-vault [data-shared-tabs]').click();
await page.waitForTimeout(400);
await page.locator('#sharedLockTabPicker input[data-slock-tab="passwords"]').uncheck();
await page.waitForTimeout(500);
await page.locator('#sharedLockTabPicker .slock-picker-done').click();
await page.waitForTimeout(300);
await page.evaluate(() => switchTab('passwords'));
await page.waitForTimeout(400);
check('unticking hands the tab back, gate removed and content restored',
  await page.evaluate(() => {
    const pane = document.getElementById('content-passwords');
    return !document.getElementById('sharedSectionGate-passwords')
      && !pane.classList.contains('shared-section-locked')
      && [...pane.children].every((c) => !c.inert && getComputedStyle(c).display !== 'none');
  }));
/* And it stays handed back the next time the lock actually closes. */
await page.evaluate(() => window.PoorijaChat.vaultLock().lock());
await page.waitForTimeout(500);
await page.evaluate(() => switchTab('passwords'));
await page.waitForTimeout(400);
check('an unticked tab is not gated when the lock closes again',
  await page.evaluate(() => !document.getElementById('sharedSectionGate-passwords')
    && !document.getElementById('content-passwords').classList.contains('shared-section-locked')
    && vaultLockState().enabled && !vaultLockState().unlocked));
check('while a default tab still is',
  await page.evaluate(() => { switchTab('vault'); return true; }) && (await page.waitForTimeout(400), true)
  && await page.evaluate(() => Boolean(document.getElementById('sharedSectionGate-vault'))
    && document.getElementById('content-vault').classList.contains('shared-section-locked')));

console.log('\n  page errors:', errors.length ? errors.slice(0, 4) : 'none');
check('no script threw', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====\n`);
process.exit(failed ? 1 : 0);
