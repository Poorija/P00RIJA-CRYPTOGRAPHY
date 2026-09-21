/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Production UI regression: no debug probes. Run with E2E_ENGINE=webkit too. */
import { chromium, webkit } from 'playwright';
import fs from 'node:fs/promises';
const engine = process.env.E2E_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  localStorage.setItem('poorija_lang', 'en');
  try { delete Navigator.prototype.serviceWorker; } catch (_) {}
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
function check(name, ok, detail = '') { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); }
try {
  await page.goto(process.env.PKG_URL || 'http://localhost:8123');
  await page.evaluate(() => {
    selectLanguage('en');
    const set = (id, value) => { const e = document.getElementById(id); e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('setupPassword', 'Release37#Password!'); set('confirmPassword', 'Release37#Password!');
    const taken = new Set();
    document.querySelectorAll('#initialSetup select').forEach(s => { const o = [...s.options].find(o => o.value && !taken.has(o.value)); if (o) { taken.add(o.value); set(s.id, o.value); } });
    document.querySelectorAll('#initialSetup input[type=text]').forEach((e,i) => set(e.id, `answer${i}`));
    const terms = document.getElementById('acceptTermsCheckbox'); terms.checked = true; terms.dispatchEvent(new Event('change', { bubbles:true }));
    document.getElementById('setupBtn').click();
  });
  await page.waitForFunction(() => window.PoorijaApp?.state?.isLocked === false, { timeout: 90000 });
  check('group presence dots overlay avatars with online and offline colors', await page.evaluate(() => {
    const fixture=document.createElement('div');
    fixture.innerHTML='<div class="chat-space-member is-online"><span class="chat-space-member-avatar">A</span></div><div class="chat-space-member"><span class="chat-space-member-avatar">B</span></div>';
    document.body.append(fixture);
    const avatars=[...fixture.querySelectorAll('.chat-space-member-avatar')];
    const dots=avatars.map(el=>getComputedStyle(el,'::after'));
    const ok=dots.every(s=>s.position==='absolute' && s.bottom==='0px' && Number(s.zIndex)>0) && dots[0].backgroundColor==='rgb(52, 211, 153)' && dots[1].backgroundColor==='rgb(248, 113, 113)' && avatars.every(el=>getComputedStyle(el).overflow==='visible');
    fixture.remove();return ok;
  }));
  const gate = tab => page.locator('#sharedSectionGate-' + tab);
  const password = 'Shared37#Password!';
  await page.evaluate(() => switchTab('vault'));
  await gate('vault').locator('[data-shared-set]').click();
  const dialog = page.locator('.poorija-dialog-backdrop.is-open');
  if (process.env.E2E_SCREENSHOT) { await dialog.waitFor(); await page.waitForTimeout(250); await page.screenshot({path:process.env.E2E_SCREENSHOT.replace('.png','-setup.png')}); }
  await dialog.locator('.poorija-dialog-input').first().fill(password);
  await dialog.locator('.poorija-dialog-confirm-input').fill('different');
  await dialog.locator('.poorija-dialog-ok').click();
  check('mismatch stays in setup without enabling the lock', await dialog.locator('.poorija-dialog-error').isVisible() && !await page.evaluate(() => vaultLockState().enabled));
  check('setup warns about all-data erasure after three wrong passwords', (await dialog.innerText()).includes('3 consecutive'));
  await dialog.locator('.poorija-dialog-confirm-input').fill(password);
  await dialog.locator('.poorija-dialog-reveal').click();
  check('setup eye reveals only its own password field', await dialog.locator('input[type=text]').count() === 1);
  await dialog.locator('[data-password-keyboard]').last().click();
  for (const mode of ['pwa-standalone', 'native-mobile']) {
    await page.evaluate(mode => document.documentElement.classList.add(mode), mode);
    for (const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(150);
      check('keyboard actions remain visible '+mode+' '+size.width, await page.locator('#virtualKeyboardContainer').evaluate(el=>{
        const box=el.getBoundingClientRect(), row=el.querySelector('.virtual-keyboard-actions').getBoundingClientRect();
        return box.left>=0 && box.right<=innerWidth+1 && box.bottom<=innerHeight && row.bottom<=box.bottom && row.top>=box.top && el.scrollWidth<=el.clientWidth;
      }));
    }
    await page.evaluate(mode => document.documentElement.classList.remove(mode), mode);
  }
  await page.setViewportSize({width:390,height:844});
  if(process.env.E2E_SCREENSHOT) await page.screenshot({path:process.env.E2E_SCREENSHOT.replace('.png','-keyboard.png')});
  await page.locator('#virtualKeyboard button').filter({hasText:/^a$/}).click();
  check('confirmation virtual keyboard edits its own field', await dialog.locator('.poorija-dialog-confirm-input').inputValue() === password + 'a');
  await page.locator('#virtualKeyboardContainer').getByRole('button', {name:'Close',exact:true}).click();
  await dialog.locator('.poorija-dialog-confirm-input').fill(password);
  check('eye icon switches to eye slash', await dialog.locator('.poorija-dialog-reveal .fa-eye-slash').count() === 1);
  await dialog.locator('.poorija-dialog-ok').click();
  await page.waitForFunction(() => vaultLockState().enabled && !vaultLockState().unlocked);
  check('setting the shared password locks immediately', true);
  await page.evaluate(() => switchLanguage());
  check('Persian gate labels the field as password', await gate('vault').locator('input').getAttribute('placeholder') === 'رمز عبور');
  await page.evaluate(() => switchLanguage());
  if (process.env.E2E_SCREENSHOT) { await page.evaluate(() => toggleSidebar(false)); await page.waitForTimeout(300); await page.screenshot({path:process.env.E2E_SCREENSHOT}); }
  for (const tab of ['vault','chat','settings']) {
    await page.evaluate(tab => switchTab(tab), tab);
    await gate(tab).waitFor();
    check(tab + ' is protected by the shared gate', await page.locator('#content-'+tab).evaluate(el => el.classList.contains('shared-section-locked') && [...el.children].filter(c => !c.classList.contains('shared-section-lock')).every(c => c.inert && getComputedStyle(c).display === 'none')));
    check(tab + ' has password, eye and biometric controls', await gate(tab).locator('input').getAttribute('placeholder') === 'Password' && await gate(tab).locator('[data-shared-eye]').isVisible() && await gate(tab).locator('[data-shared-bio]').isVisible());
  }
  await page.evaluate(() => switchLanguage());
  for (const width of [390, 1440, 2168]) {
    await page.setViewportSize({width,height:900});
    const frames=[];
    for (const tab of ['vault','chat','settings']) {
      await page.evaluate(tab=>switchTab(tab),tab);
      await page.waitForTimeout(300);
      frames.push(await gate(tab).evaluate(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
      if(process.env.E2E_SCREENSHOT) await page.screenshot({path:process.env.E2E_SCREENSHOT.replace('.png', '-frame-'+width+'-'+tab+'.png')});
    }
    check('all three locked frames match at width '+width, frames.every(r=>r.every((v,i)=>Math.abs(v-frames[0][i])<2)), JSON.stringify(frames));
    await page.setViewportSize({width, height:900});
    await page.waitForTimeout(200);
    const layout = await gate('settings').evaluate(el => {
      const box=el.getBoundingClientRect(), input=el.querySelector('input').getBoundingClientRect();
      const a=el.querySelector('[data-shared-open]').getBoundingClientRect(), b=el.querySelector('[data-shared-bio]').getBoundingClientRect();
      return Math.abs((input.left+input.right)/2-(box.left+box.right)/2)<3 && Math.abs(a.top-b.top)<3 && input.width<=482 && a.width < box.width*.6;
    });
    check('centered bounded password and adjacent actions at width '+width, layout);
    if (process.env.E2E_SCREENSHOT) await page.screenshot({path:process.env.E2E_SCREENSHOT.replace('.png', '-'+width+'.png')});
  }
  await page.setViewportSize({width:390,height:844});
  for (const mode of ['pwa-standalone','native-mobile']) {
    await page.evaluate(mode=>document.documentElement.classList.add('mobile-browser-context',mode),mode);
    const frames=[];
    for (const tab of ['vault','chat','settings']) {
      await page.evaluate(tab=>switchTab(tab),tab); await page.waitForTimeout(250);
      frames.push(await gate(tab).evaluate(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
    }
    check('all locked frames match in '+mode,frames.every(r=>r.every((v,i)=>Math.abs(v-frames[0][i])<2)),JSON.stringify(frames));
    await page.evaluate(mode=>document.documentElement.classList.remove('mobile-browser-context',mode),mode);
  }
  await page.evaluate(() => switchLanguage());
  await page.waitForTimeout(350);
  await gate('settings').locator('input').fill(password);
  await gate('settings').locator('[data-shared-eye]').click();
  check('locked gate eye reveals the typed password', await gate('settings').locator('input').getAttribute('type') === 'text');
  await gate('settings').locator('[data-shared-open]').click();
  await page.waitForFunction(() => vaultLockState().unlocked);
  check('quick lock icon updates immediately after shared unlock', await page.locator('#chatQuickLockBtn.fa-lock-open, #chatQuickLockBtn .fa-lock-open').count() === 1);
  for (const tab of ['vault','chat','settings']) {
    await page.evaluate(tab => switchTab(tab), tab);
    if (tab === 'chat') { await page.evaluate(() => { document.querySelector('[data-chat-view=connection]')?.click(); document.querySelector('[data-settings-tab=lock]')?.click(); }); await page.waitForTimeout(200); }
    check(tab + ' shares unlock and hides the password field', !await gate(tab).locator('input').isVisible() && await gate(tab).locator('[data-shared-now]').isVisible() && await gate(tab).locator('[data-shared-remove]').isVisible());
  }
  await gate('settings').locator('[data-shared-remove]').click();
  await dialog.locator('.poorija-dialog-input').first().fill('wrong-removal');
  await dialog.locator('.poorija-dialog-ok').click();
  await page.waitForFunction(() => vaultLockState().attempts === 1);
  check('removal requires fresh authentication and counts incorrect passwords', await page.evaluate(() => vaultLockState().enabled));
  await gate('settings').locator('[data-shared-now]').click();
  await page.waitForFunction(() => !vaultLockState().unlocked);
  check('lock now immediately conceals all protected panes', true);
  await page.reload();
  await page.waitForFunction(() => typeof window.PoorijaApp === 'object');
  await page.locator('[onclick="toggleVirtualKeyboard(\'unlockPassword\')"]').click();
  await page.locator('#virtualKeyboard button').filter({hasText:/^a$/}).click();
  check('login virtual keyboard enters the password field', await page.locator('#unlockPassword').inputValue() === 'a');
  await page.locator('#virtualKeyboardContainer').getByRole('button',{name:'Clear',exact:true}).click();
  await page.locator('#virtualKeyboardContainer').getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(() => { document.getElementById('unlockPassword').value = 'Release37#Password!'; document.querySelector('[onclick="unlockApp()"]').click(); });
  await page.waitForFunction(() => PoorijaApp.state.isLocked === false);
  await page.evaluate(() => switchTab('vault'));
  check('failed-attempt count survives a restart', await page.evaluate(() => vaultLockState().attempts === 1));
  await gate('vault').locator('input').fill(password);
  await gate('vault').locator('[data-shared-open]').click();
  await page.waitForFunction(() => vaultLockState().unlocked);
  check('correct password resets consecutive failures', await page.evaluate(() => vaultLockState().attempts === 0));
  await gate('vault').locator('[data-shared-remove]').click();
  await dialog.locator('.poorija-dialog-input').first().fill(password);
  await dialog.locator('.poorija-dialog-ok').click();
  await page.waitForFunction(() => !vaultLockState().enabled);
  check('password-confirmed removal removes the lock from every section', true);
  const migration = await page.evaluate(async () => {
    const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    saveEncrypted(VAULT_LOCK_STORAGE_KEY, {enabled:false});
    saveEncrypted(CHAT_LOCK_STORAGE_KEY, {enabled:true,salt,digest:await derivePinDigest('2468',salt),iterations:CHAT_LOCK_ITERATIONS});
    lockVaultNow();
    const before = vaultLockState();
    const opened = await tryUnlockVault('۲۴۶۸');
    const activated = await PoorijaChat.vaultLock().activatePolicy('2468');
    const after = vaultLockState();
    await disableVaultLock('2468');
    return {before,opened,activated,after};
  });
  check('legacy chat PIN migrates to shared protection without silent destructive policy', migration.before.enabled && !migration.before.wipeAfterThree && migration.opened);
  check('existing lock can explicitly enable three-failure erasure after authentication', migration.activated && migration.after.wipeAfterThree);
  await page.evaluate(password => PoorijaChat.vaultLock().enable(password), password);
  const bio = await page.evaluate(async () => {
    const original = unlockWithBiometric;
    unlockWithBiometric = async () => false;
    const refused = await tryUnlockVaultBiometric();
    const count = vaultLockState().attempts;
    let resolve;
    unlockWithBiometric = () => new Promise(r => { resolve = r; });
    const pending = tryUnlockVaultBiometric();
    lockVaultNow(); resolve(true);
    const stale = await pending;
    unlockWithBiometric = async () => true;
    const opened = await tryUnlockVaultBiometric();
    unlockWithBiometric = original;
    return { refused, count, stale, opened };
  });
  check('cancelled biometrics cost no password attempts', !bio.refused && bio.count === 0);
  check('late biometric success cannot undo a newer lock', !bio.stale);
  check('accepted biometric result opens the shared gate', bio.opened);
  const nativeBio = await page.evaluate(async () => {
    lockVaultNow();
    const oldRuntime = window.__POORIJA_DESKTOP__;
    const oldEnabled = PoorijaApp.state.desktopAuth.enabled;
    const oldInvoke = PoorijaApp.invokeDesktopCommand;
    window.__POORIJA_DESKTOP__ = true;
    PoorijaApp.state.desktopAuth.enabled = true;
    PoorijaApp.invokeDesktopCommand = async () => 'wrong-native-secret';
    const wrong = await tryUnlockVaultBiometric();
    PoorijaApp.invokeDesktopCommand = async () => 'Release37#Password!';
    const right = await tryUnlockVaultBiometric();
    PoorijaApp.invokeDesktopCommand = oldInvoke;
    PoorijaApp.state.desktopAuth.enabled = oldEnabled;
    window.__POORIJA_DESKTOP__ = oldRuntime;
    return {wrong,right,count:vaultLockState().attempts};
  });
  check('native biometric bridge must recover this profile’s valid secret', !nativeBio.wrong && nativeBio.right && nativeBio.count === 0);
  await page.evaluate(() => { switchTab('encrypt'); switchTab('vault'); });
  check('leaving all protected sections locks them again', await page.evaluate(() => !vaultLockState().unlocked));
  const late = await page.evaluate(async password => {
    const attempt = tryUnlockVault(password); lockVaultNow(); return await attempt;
  }, password);
  check('late password result cannot undo a newer lock', !late);
  // Real destructive path, exclusively in this test's disposable browser profile.
  await page.evaluate(async () => {
    localStorage.setItem('v37-wipe-marker', 'fixture-secret');
    localStorage.setItem('poorija_p_fixture-other-profile_history', 'other-profile-secret');
    sessionStorage.setItem('v37-session-marker', 'fixture-secret');
    await new Promise((resolve,reject) => {
      const r = indexedDB.open('v37-wipe-fixture',1);
      r.onupgradeneeded = () => r.result.createObjectStore('test');
      r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = () => reject(r.error);
    });
  });
  const second = await context.newPage();
  await second.goto(process.env.PKG_URL || 'http://localhost:8123');
  await second.waitForFunction(() => typeof window.PoorijaApp === 'object');
  await second.evaluate(() => {
    document.getElementById('unlockPassword').value = 'Release37#Password!';
    document.querySelector('[onclick="unlockApp()"]').click();
  });
  await second.waitForFunction(() => PoorijaApp.state.isLocked === false);
  await second.evaluate(async () => { switchTab('vault'); await openMediaDb(); });
  await second.fill('#sharedSectionGate-vault input', 'wrong-window-one');
  await second.click('#sharedSectionGate-vault [data-shared-open]');
  await page.waitForFunction(() => vaultLockState().attempts === 1);
  check('failed attempts propagate between windows sharing the profile', true);
  await gate('vault').locator('input').fill('wrong-window-two');
  await gate('vault').locator('[data-shared-open]').click();
  await page.waitForFunction(() => vaultLockState().attempts === 2);
  check('two failures preserve app and other-profile data', await page.evaluate(() => localStorage.getItem('v37-wipe-marker') === 'fixture-secret' && !!localStorage.getItem('poorija_vault')));
  const nativeWipe = [];
  await page.exposeFunction('__recordNativeWipe', (command, payload) => nativeWipe.push({command,payload}));
  await page.evaluate(() => {
    window.PoorijaDesktop = { available:true };
    window.__POORIJA_DESKTOP_INVOKE__ = async (command,payload) => {
      await window.__recordNativeWipe(command,payload);
      return command === 'desktop_list_app_files' ? [{name:'vault-snapshot.poorija-backup'}] : true;
    };
  });
  await gate('vault').locator('input').fill('wrong-third');
  await gate('vault').locator('[data-shared-open]').click();
  await page.waitForFunction(() => !localStorage.getItem('poorija_vault'), {timeout:30000});
  await page.waitForTimeout(1200);
  const wiped = await page.evaluate(async () => ({
    vault:localStorage.getItem('poorija_vault'), marker:localStorage.getItem('v37-wipe-marker'),
    other:localStorage.getItem('poorija_p_fixture-other-profile_history'), session:sessionStorage.getItem('v37-session-marker'),
    db:(await indexedDB.databases()).some(db => db.name === 'v37-wipe-fixture'),
  }));
  check('third consecutive failure erases every profile, browser storage and IndexedDB', !wiped.vault && !wiped.marker && !wiped.other && !wiped.session && !wiped.db, JSON.stringify(wiped));
  await second.waitForFunction(() => !localStorage.getItem('poorija_vault') && !PoorijaApp.state.masterPassword);
  check('wipe also clears the other open window and releases its media database', true);
  await second.close();
  check('wipe clears native app-owned snapshots and quick-unlock credentials through the bridge', nativeWipe.some(x => x.command === 'desktop_delete_app_file' && x.payload.name === 'vault-snapshot.poorija-backup') && nativeWipe.some(x => x.command === 'desktop_clear_quick_unlock'));
  check('no page errors', errors.length === 0, errors.join('; '));
} finally { await browser.close(); }
console.log(`\n===== ${results.filter(x => !x).length} failed of ${results.length} =====`);
process.exitCode = results.some(x => !x) ? 1 : 0;
