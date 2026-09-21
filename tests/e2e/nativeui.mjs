/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist', 'tauri');
const CONF = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
const PORT = Number(process.env.NATIVE_SHELL_PORT || 8127);
const engineName = process.argv[2] === 'webkit' ? 'webkit' : 'chromium';

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/tauri is missing — run `npm run native:prepare` first.');
  process.exit(2);
}
const security = JSON.parse(fs.readFileSync(CONF, 'utf8')).app.security;

/* Reproduce what Tauri actually serves, not what the config file says.
 *
 * Tauri injects a nonce into `script[src^='http']` and every `<style>`, and
 * hashes each inline <script>, then appends those sources to script-src and
 * style-src. Per the CSP spec a nonce or hash in a directive makes the browser
 * ignore 'unsafe-inline' in that same directive — which silently kills all 262
 * inline onclick/onchange handlers this UI is built on. The app then loads
 * perfectly, defines every global, and responds to nothing.
 *
 * `dangerousDisableAssetCspModification` is what tells Tauri to leave a
 * directive alone. Emulating both cases here is the only way this test can
 * fail when the real app would. */
const disabled = security.dangerousDisableAssetCspModification;
const modifies = (directive) => {
  if (disabled === true) return false;
  if (Array.isArray(disabled)) return !disabled.includes(directive);
  return true;
};
const FAKE_HASH = "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='";
const FAKE_NONCE = "'nonce-1234567890'";
const CSP = security.csp
  .split(';')
  .map((part) => {
    const directive = part.trim().split(/\s+/)[0];
    if (directive === 'script-src' && modifies('script-src')) return `${part} ${FAKE_HASH}`;
    if (directive === 'style-src' && modifies('style-src')) return `${part} ${FAKE_NONCE}`;
    return part;
  })
  .join(';');
console.log(`  script-src modified by Tauri: ${modifies('script-src')}   style-src: ${modifies('style-src')}`);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let requested = decodeURIComponent(req.url.split('?')[0]);
  if (requested === '/') requested = '/index.html';
  const file = path.join(DIST, requested);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'content-security-policy': CSP,
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(PORT, resolve));


const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const PASS = 'Harness#Pass2026!';
const browser = await (engineName === 'webkit' ? webkit : chromium).launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
/* A language is chosen before the app is of any use; without it the chooser
   sits over everything and every later check measures that instead. */
await context.addInitScript(() => {
  try { localStorage.setItem('poorija_lang', 'fa'); } catch (error) { /* blocked */ }
  /* Stand in for the Tauri runtime so the desktop code paths are the ones under
     test: js/desktop-bridge.js keys off window.__TAURI__.core.invoke, and
     without it every native branch is skipped and the run proves nothing about
     the packaged app. Each call is recorded rather than performed. */
  window.__nativeCalls = { invoke: [], notifications: [], permissionAsked: 0 };
  window.__TAURI__ = {
    core: {
      invoke: (command, payload) => {
        window.__nativeCalls.invoke.push(command);
        if (command === 'desktop_status') return Promise.resolve({ platform: 'macos', version: 'test' });
        return Promise.resolve(null);
      },
    },
    dialog: {},
    notification: {
      isPermissionGranted: () => Promise.resolve(true),
      requestPermission: () => { window.__nativeCalls.permissionAsked += 1; return Promise.resolve('granted'); },
      sendNotification: (options) => { window.__nativeCalls.notifications.push(options); return Promise.resolve(); },
    },
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push((e.message || '').slice(0, 160)));
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

/* First run, the way a person does it. */
await page.evaluate((pass) => {
  const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => {
    if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => {
    inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const cb = document.getElementById('acceptTermsCheckbox');
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('setupBtn')?.click());
await page.waitForTimeout(4000);
await page.evaluate(() => { window.__toasts = [];
  const original = window.PoorijaApp.showNotification?.bind(window.PoorijaApp);
  window.PoorijaApp.showNotification = (m, t) => { window.__toasts.push(`${t}: ${m}`); return original?.(m, t); };
  document.getElementById('mobileInstallGate')?.classList.add('hidden'); });

console.log(`\n===== one confirmation per click, however often a tab is opened (${engineName}) =====`);
/* initSshModule() runs on every switch to the tab. It used to re-bind the
   delegated click listener each time, so one press of Delete opened as many
   confirmations as the tab had been visited — confirm the first and an
   identical one is already there, which is indistinguishable from a dialog
   that will not close. */
await page.evaluate(async () => {
  for (const tab of ['sshkeys', 'encrypt', 'sshkeys', 'notes', 'sshkeys']) {
    window.switchTab?.(tab);
    await new Promise((r) => setTimeout(r, 250));
  }
});
await page.waitForTimeout(600);
const generation = await page.evaluate(async () => {
  window.__toasts = [];
  document.getElementById('sshGenerateBtn')?.click();
  await new Promise((r) => setTimeout(r, 5000));
  const madeToasts = (window.__toasts || []).filter((line) => /ساخته شد|generated/i.test(line)).length;
  /* A generated key is offered before it is kept; saving is a second press. */
  document.getElementById('sshGenSave')?.click();
  await new Promise((r) => setTimeout(r, 600));
  return { madeToasts, rows: document.querySelectorAll('[data-ssh-action="delete"]').length };
});
console.log('  ' + JSON.stringify(generation));
check('a key can be generated and kept in the native payload', generation.rows >= 1, JSON.stringify(generation));
/* One press, one generation. Re-binding on every visit to the tab made the
   button fire once per visit — the same fault that queued the confirmations. */
check('one press of Generate runs once, not once per tab visit',
  generation.madeToasts === 1, `${generation.madeToasts} generation toast(s)`);

const dialogRun = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = document.querySelectorAll('[data-ssh-action="delete"]').length;
  document.querySelector('[data-ssh-action="delete"]')?.click();
  await sleep(300);
  const backdrop = document.querySelector('.poorija-dialog-backdrop');
  const openedOnce = backdrop && !backdrop.classList.contains('hidden');
  document.querySelector('.poorija-dialog-ok')?.click();
  await sleep(500);
  /* If a second confirmation was queued it is on screen by now. */
  const stillOpen = backdrop && !backdrop.classList.contains('hidden');
  const after = document.querySelectorAll('[data-ssh-action="delete"]').length;
  /* And whatever happened, the page must be clickable again. */
  const probe = document.getElementById('sshGenerateBtn');
  const box = probe?.getBoundingClientRect();
  const hit = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
  return { before, after, openedOnce, stillOpen,
    hitsButton: Boolean(probe && hit && probe.contains(hit)),
    hitTag: hit ? (hit.className || hit.tagName) : 'none' };
});
console.log('  ' + JSON.stringify(dialogRun));
check('one click opens one confirmation', dialogRun.openedOnce === true, JSON.stringify(dialogRun));
check('confirming it removes the key', dialogRun.after === dialogRun.before - 1, `${dialogRun.before} → ${dialogRun.after}`);
check('and the dialog goes away instead of reappearing', dialogRun.stillOpen === false, String(dialogRun.stillOpen));
check('nothing invisible is left covering the page', dialogRun.hitsButton === true, String(dialogRun.hitTag));

console.log('\n===== the chat profile sheet is usable, not just visible =====');
await page.evaluate(async () => { window.switchTab?.('chat'); await new Promise((r) => setTimeout(r, 1200)); });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('[data-choice-value="no"]')?.click());
await page.evaluate(() => document.getElementById('chatProfileMenuBtn')?.click());
await page.waitForTimeout(900);
const sheet = await page.evaluate(() => {
  const input = document.getElementById('chatProfileName');
  const save = document.getElementById('chatSaveProfileBtn');
  input?.scrollIntoView({ block: 'center' });
  const box = input?.getBoundingClientRect();
  const hit = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
  return {
    sheetOpen: Boolean(document.getElementById('chatFullSheet') && !document.getElementById('chatFullSheet').classList.contains('hidden')),
    inputInSheet: Boolean(input && document.getElementById('chatFullSheet')?.contains(input)),
    disabled: Boolean(input?.disabled), readOnly: Boolean(input?.readOnly),
    pointerEvents: input ? getComputedStyle(input).pointerEvents : 'missing',
    reachable: Boolean(input && hit && (input === hit || input.contains(hit))),
    blockedBy: hit && input && hit !== input ? (hit.className || hit.tagName) : '',
    rect: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    sheetScroll: (() => { const b = document.querySelector('#chatFullSheet .chat-fullsheet-body');
      return b ? `${Math.round(b.scrollTop)}/${Math.round(b.scrollHeight)} h${Math.round(b.clientHeight)}` : 'none'; })(),
    saveDisabled: Boolean(save?.disabled),
    activeTab: window.PoorijaApp?.state?.activeTab || '(unknown)',
    chatHidden: document.getElementById('content-chat')?.classList.contains('hidden'),
    sheetParent: document.getElementById('chatFullSheet')?.parentElement?.id || '(none)',
    chatVisibility: (() => { const el = document.getElementById('content-chat');
      return el ? `${getComputedStyle(el).display}/${getComputedStyle(el).visibility}` : 'missing'; })(),
  };
});
console.log('  ' + JSON.stringify(sheet));
check('the sheet opens with the live controls inside it',
  sheet.sheetOpen && sheet.inputInSheet, JSON.stringify(sheet));
check('the name field is editable and nothing covers it',
  sheet.disabled === false && sheet.readOnly === false && sheet.pointerEvents !== 'none' && sheet.reachable === true,
  sheet.blockedBy || JSON.stringify(sheet));

/* The packaged payload has to give the same centred dialog the browser does:
   the tab-canvas rule (an id in its selector) beat the sheet's own width, and
   #content-chat kept an identity transform from its entry animation, which
   made it the containing block for the sheet's position: fixed. */
const sheetShape = await page.evaluate(() => {
  const el = document.getElementById('chatFullSheet');
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), vw: window.innerWidth,
    centred: Math.abs((r.x + r.width / 2) - window.innerWidth / 2) <= 2,
    panelTransform: getComputedStyle(document.getElementById('content-chat')).transform };
});
console.log('  ' + JSON.stringify(sheetShape));
check('the sheet is a centred dialog in the packaged build too',
  sheetShape.w <= 620 && sheetShape.w < sheetShape.vw * 0.7 && sheetShape.centred,
  JSON.stringify(sheetShape));
check('and the chat panel does not trap fixed children',
  sheetShape.panelTransform === 'none', sheetShape.panelTransform);

/* The window is dragged around in a native shell far more than a tab is, and
   the layout class has to follow it. */
const resizeFollow = await page.evaluate(async () => {
  const read = () => document.documentElement.classList.contains('mobile-browser-context');
  const before = read();
  window.dispatchEvent(new Event('resize'));
  await new Promise((r) => setTimeout(r, 200));
  return { wide: before, afterEvent: read() };
});
await page.setViewportSize({ width: 900, height: 800 });
await page.waitForTimeout(600);
const narrowClass = await page.evaluate(() => document.documentElement.classList.contains('mobile-browser-context'));
await page.setViewportSize({ width: 1440, height: 940 });
await page.waitForTimeout(600);
const wideAgain = await page.evaluate(() => document.documentElement.classList.contains('mobile-browser-context'));
console.log('  ' + JSON.stringify({ ...resizeFollow, narrowClass, wideAgain }));
check('the packaged app re-reads its own window size as it changes',
  resizeFollow.wide === false && narrowClass === true && wideAgain === false,
  JSON.stringify({ ...resizeFollow, narrowClass, wideAgain }));

/* Type into it the way a person does, then save. */
await page.click('#chatProfileName', { timeout: 5000 }).catch(() => {});
await page.fill('#chatProfileName', 'Native Tester').catch(() => {});
await page.waitForTimeout(200);
await page.evaluate(() => document.getElementById('chatSaveProfileBtn')?.click());
await page.waitForTimeout(900);
const saved = await page.evaluate(() => ({
  value: document.getElementById('chatProfileName')?.value || '',
  toasts: (window.__toasts || []).slice(-3),
}));
console.log('  ' + JSON.stringify(saved));
check('typing reaches the field', saved.value === 'Native Tester', saved.value);
check('and saving the profile answers', saved.toasts.some((line) => /ذخیره|saved/i.test(line)), JSON.stringify(saved.toasts));

console.log('\n===== the desktop runtime: permissions and Notification Centre =====');
const nativeRuntime = await page.evaluate(() => ({
  desktopFlag: window.__POORIJA_DESKTOP__ === true,
  runtimeClass: document.documentElement.classList.contains('desktop-runtime'),
  bridge: typeof window.PoorijaDesktop === 'object' && window.PoorijaDesktop.available !== false,
  notificationApi: typeof window.__POORIJA_DESKTOP_NOTIFICATION__?.sendNotification === 'function',
  invoked: (window.__nativeCalls?.invoke || []).length,
}));
console.log('  ' + JSON.stringify(nativeRuntime));
check('the app recognises the native shell and exposes its bridge',
  nativeRuntime.desktopFlag && nativeRuntime.runtimeClass && nativeRuntime.bridge && nativeRuntime.notificationApi,
  JSON.stringify(nativeRuntime));

const notified = await page.evaluate(async () => {
  window.PoorijaApp.state.settings.notifications = true;
  window.__nativeCalls.notifications = [];
  window.PoorijaApp.showNotification('پیام آزمایشی سیستم', 'info');
  await new Promise((r) => setTimeout(r, 900));
  return { sent: window.__nativeCalls.notifications.slice(-2), asked: window.__nativeCalls.permissionAsked };
});
console.log('  ' + JSON.stringify(notified));
check('a toast is handed to the OS Notification Centre as well',
  notified.sent.length >= 1 && /آزمایشی/.test(notified.sent[0]?.body || ''), JSON.stringify(notified.sent));

/* The permission the app must never assume it has. */
const permissionFlow = await page.evaluate(async () => {
  window.__nativeCalls.permissionAsked = 0;
  const granted = await window.__POORIJA_DESKTOP_NOTIFICATION__.isPermissionGranted();
  const asked = await window.__POORIJA_DESKTOP_NOTIFICATION__.requestPermission();
  return { granted, asked, times: window.__nativeCalls.permissionAsked };
});
console.log('  ' + JSON.stringify(permissionFlow));
check('notification permission is asked through the plugin, not the web API',
  permissionFlow.granted === true && permissionFlow.asked === 'granted' && permissionFlow.times === 1,
  JSON.stringify(permissionFlow));

/* Camera and microphone are declared in Info.plist and entitlements; what the
   page must do is ask for them through getUserMedia rather than assume. */
const mediaAsk = await page.evaluate(() => ({
  getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
  enumerate: typeof navigator.mediaDevices?.enumerateDevices === 'function',
  secure: window.isSecureContext === true,
}));
check('the media APIs the call code needs are present in the shell',
  mediaAsk.getUserMedia && mediaAsk.enumerate, JSON.stringify(mediaAsk));

/* The packaged app has no Push API. What matters is that it says so plainly
   rather than offering a switch that can never work, and that its own
   system-notification path is the one in use. */
const pushInNative = await page.evaluate(async () => {
  window.switchTab?.('settings');
  await new Promise((r) => setTimeout(r, 900));
  window.syncPushSettingsUi?.();
  return {
    hasPushApi: typeof PushManager !== 'undefined',
    toggleDisabled: Boolean(document.getElementById('pushBackgroundToggle')?.disabled),
    hint: document.getElementById('pushStatusHint')?.textContent.trim() || '',
  };
});
console.log('  ' + JSON.stringify(pushInNative));
check('the packaged build explains its own notification story',
  pushInNative.hint.length > 0, pushInNative.hint.slice(0, 70));

check('no script threw during any of it', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} (${engineName}) =====`);
process.exit(bad.length ? 1 : 0);
