/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* chat-v44. Three things that shipped broken, each asserted on measured
   geometry rather than on a screenshot:
     - the locked Settings entry frame sat at viewport x=0 instead of where the
       Files and Secure Chat frames sit;
     - the header lock button threw before it ever showed the lock screen;
     - the in-app keyboard covered the password field it exists to type into,
       on the lock screen and in all three section gates.
   Run with E2E_ENGINE=webkit too: the native mobile shell is WKWebView. */
import { chromium, webkit } from 'playwright';
const engine = process.env.E2E_ENGINE === 'webkit' ? webkit : chromium;
const URL = (process.env.PKG_URL || 'http://localhost:8099') + '/index.html';
const browser = await engine.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.addInitScript(() => {
  localStorage.setItem('poorija_lang', 'en');
  try { delete Navigator.prototype.serviceWorker; } catch (_) {}
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok]); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

await page.goto(URL.replace('//index.html','/index.html'));
await page.evaluate(() => {
  selectLanguage('en');
  const set = (id, value) => { const e = document.getElementById(id); e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
  set('setupPassword', 'Release43#Password!'); set('confirmPassword', 'Release43#Password!');
  const taken = new Set();
  document.querySelectorAll('#initialSetup select').forEach(s => { const o = [...s.options].find(o => o.value && !taken.has(o.value)); if (o) { taken.add(o.value); set(s.id, o.value); } });
  document.querySelectorAll('#initialSetup input[type=text]').forEach((e, i) => set(e.id, `answer${i}`));
  const terms = document.getElementById('acceptTermsCheckbox'); terms.checked = true; terms.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('setupBtn').click();
});
await page.waitForFunction(() => window.PoorijaApp?.state?.isLocked === false, { timeout: 90000 });

/* ---- BUG 2: header lock button ---- */
const lockOutcome = await page.evaluate(() => {
  try { lockApp(); return { threw: false }; }
  catch (e) { return { threw: true, message: String(e && e.message || e) }; }
});
check('lockApp() does not throw', !lockOutcome.threw, lockOutcome.message || '');
await page.waitForTimeout(800);
check('header lock shows the lock screen', await page.evaluate(() =>
  !document.getElementById('lockScreen').classList.contains('hidden') &&
  document.getElementById('mainApp').classList.contains('hidden')));

/* back in */
await page.evaluate(() => {
  const e = document.getElementById('unlockPassword');
  e.value = 'Release43#Password!'; e.dispatchEvent(new Event('input', { bubbles: true }));
  unlockApp();
});
await page.waitForFunction(() => window.PoorijaApp?.state?.isLocked === false, { timeout: 60000 });

/* ---- set the shared section lock ---- */
const password = 'Shared43#Password!';
await page.evaluate(() => switchTab('vault'));
await page.locator('#sharedSectionGate-vault [data-shared-set]').click();
const dialog = page.locator('.poorija-dialog-backdrop.is-open');
await dialog.waitFor();
await dialog.locator('.poorija-dialog-input').first().fill(password);
await dialog.locator('.poorija-dialog-confirm-input').fill(password);
await dialog.locator('.poorija-dialog-ok').click();
await page.waitForFunction(() => vaultLockState().enabled && !vaultLockState().unlocked);

/* ---- BUG 1: settings gate geometry vs files/chat ---- */
for (const width of [1280, 1600, 1920, 2168]) {
  for (const dir of ['rtl', 'ltr']) {
    await page.setViewportSize({ width, height: 1080 });
    await page.evaluate(d => { if (document.documentElement.dir !== d) switchLanguage(); }, dir);
    await page.waitForTimeout(250);
    const geo = {};
    for (const tab of ['vault', 'chat', 'settings']) {
      await page.evaluate(t => switchTab(t), tab);
      await page.waitForTimeout(250);
      geo[tab] = await page.locator('#sharedSectionGate-' + tab).evaluate(el => {
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), width: Math.round(r.width) };
      });
    }
    const same = Math.abs(geo.settings.left - geo.vault.left) <= 1 && Math.abs(geo.settings.width - geo.vault.width) <= 1;
    const chatSame = Math.abs(geo.chat.left - geo.vault.left) <= 1 && Math.abs(geo.chat.width - geo.vault.width) <= 1;
    check(`settings gate matches files gate @${width} ${dir}`, same, JSON.stringify(geo));
    check(`chat gate matches files gate @${width} ${dir}`, chatSame, '');
  }
}

/* ---- BUG 3: mobile virtual keyboard covers the password field ---- */
await page.evaluate(() => { if (document.documentElement.dir !== 'ltr') switchLanguage(); });
for (const mode of ['pwa-standalone', 'native-mobile']) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(m => document.documentElement.classList.add(m), mode);
  for (const tab of ['vault', 'chat', 'settings']) {
    await page.evaluate(t => switchTab(t), tab);
    await page.waitForTimeout(200);
    await page.locator(`#sharedSectionGate-${tab} [data-shared-keyboard]`).click();
    await page.waitForTimeout(500);
    const seen = await page.evaluate(t => {
      const input = document.querySelector(`#sharedSectionGate-${t} input`);
      const vk = document.getElementById('virtualKeyboardContainer');
      const i = input.getBoundingClientRect(), k = vk.getBoundingClientRect();
      return { inputTop: Math.round(i.top), inputBottom: Math.round(i.bottom), vkTop: Math.round(k.top), h: innerHeight };
    }, tab);
    const visible = seen.inputBottom <= seen.vkTop + 1 && seen.inputTop >= 0;
    check(`${mode}: ${tab} password field clear of the keyboard`, visible, JSON.stringify(seen));
    await page.locator('#virtualKeyboardContainer').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForTimeout(200);
  }
  await page.evaluate(m => document.documentElement.classList.remove(m), mode);
}

/* also the app lock screen itself */
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => document.documentElement.classList.add('pwa-standalone'));
await page.evaluate(() => lockApp());
await page.waitForTimeout(800);
await page.evaluate(() => toggleVirtualKeyboard('unlockPassword'));
await page.waitForTimeout(500);
const lockSeen = await page.evaluate(() => {
  const i = document.getElementById('unlockPassword').getBoundingClientRect();
  const k = document.getElementById('virtualKeyboardContainer').getBoundingClientRect();
  return { inputTop: Math.round(i.top), inputBottom: Math.round(i.bottom), vkTop: Math.round(k.top), h: innerHeight };
});
check('pwa-standalone: unlock field clear of the keyboard', lockSeen.inputBottom <= lockSeen.vkTop + 1 && lockSeen.inputTop >= 0, JSON.stringify(lockSeen));

console.log('\n  page errors:', errors.length ? errors.slice(0, 5) : 'none');
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
await browser.close();
process.exit(failed ? 1 : 0);
