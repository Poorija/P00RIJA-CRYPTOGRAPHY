/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Does the payload that goes into the native bundle actually run?
 *
 *   node tests/e2e/native-shell.mjs            # chromium
 *   node tests/e2e/native-shell.mjs webkit     # the engine macOS/Linux use
 *
 * It serves dist/tauri with the production Content-Security-Policy applied as
 * a response header — the same way the tauri:// protocol does — because a CSP
 * that blocks the app's inline handlers turns the window blank and nothing
 * else in the suite would notice. Run `npm run native:prepare` first.
 *
 * WebKit is the engine that matters: WKWebView on macOS and WebKitGTK on
 * Linux. Chromium passing proves nothing about either.
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

/* Static check, before the browser even starts.
 *
 * wry implements none of WKWebView's JavaScript dialog delegates, so inside
 * the native app window.confirm() returns false without asking, prompt()
 * returns null, and alert() shows nothing — silently. Every destructive
 * confirmation in the suite answered "no" and the chat lock could not be
 * switched on at all. js/dialogs.js replaces them; this makes sure nothing
 * reintroduces a call to the originals. */
const shipped = ['app.js', 'chat.js', 'ssh-keys.js', 'backup.js', 'advanced-crypto.js', 'crypto-config.js'];
const nativeDialogCalls = [];
for (const file of shipped) {
  const full = path.join(DIST, 'js', file);
  if (!fs.existsSync(full)) continue;
  fs.readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    const match = /(?<![\w.$])(?:window\.)?(confirm|prompt|alert)\s*\(/.exec(line);
    if (match && !/PoorijaDialogs/.test(line)) {
      nativeDialogCalls.push(`${file}:${index + 1} ${match[1]}()`);
    }
  });
}

const browser = await (engineName === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage();
const errors = [];
const failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + (e.message || '').slice(0, 200)));
page.on('requestfailed', (r) => failed.push(r.url().split('/').pop() + ' ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (r.status() >= 400) failed.push(r.url().split('/').pop() + ' HTTP ' + r.status()); });

console.log(`\n===== the native payload runs under the production CSP (${engineName}) =====`);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

/* Drive the replacement dialogs for real: open one, click its button, and
   see what the promise resolves to. A module that loads but never resolves
   would leave every caller awaiting forever. */
const dialogProbe = await page.evaluate(async () => {
  const press = (selector) => new Promise((resolve) => {
    setTimeout(() => {
      document.querySelector(selector)?.click();
      resolve();
    }, 60);
  });
  const okPromise = window.PoorijaDialogs.confirm('regression check');
  await press('.poorija-dialog-ok');
  const confirmOk = await okPromise;

  const cancelPromise = window.PoorijaDialogs.confirm('regression check');
  await press('.poorija-dialog-cancel');
  const confirmCancel = await cancelPromise;

  const promptPromise = window.PoorijaDialogs.prompt('regression check', { password: true });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const input = document.querySelector('.poorija-dialog-input');
  const masked = input?.type === 'password';
  if (input) input.value = 'secret-1234';
  await press('.poorija-dialog-ok');
  const promptValue = await promptPromise;

  return { confirmOk, confirmCancel, promptValue: masked ? promptValue : 'NOT-MASKED' };
});

const probe = await page.evaluate(() => ({
  readyState: document.readyState,
  app: typeof window.PoorijaApp,
  bridge: typeof window.PoorijaDesktop,
  initFn: typeof window.initializeDesktopShell,
  inlineHandler: typeof window.switchTab,
  bootstrap: window.__POORIJA_NATIVE_SHELL__ === true,
  serviceWorkerGone: !('serviceWorker' in navigator),
  setup: !!document.getElementById('initialSetup'),
  desktopCard: !!document.getElementById('desktopShellCard'),
  vaultToggle: !!document.getElementById('desktopVaultSyncToggle'),
  keepRunning: !!document.getElementById('desktopKeepRunningToggle'),
  webCrypto: typeof crypto?.subtle?.encrypt === 'function',
  dialogs: typeof window.PoorijaDialogs,
  /* The check that matters: does an inline handler attribute actually run?
     `typeof window.switchTab === 'function'` passes even when CSP has blocked
     every onclick in the document, because the function is declared in an
     external script. Only firing one proves the UI is alive. */
  inlineAttrFires: (() => {
    const probe = document.createElement('button');
    probe.setAttribute('onclick', 'window.__inlineHandlerFired = true;');
    document.body.appendChild(probe);
    probe.click();
    probe.remove();
    return window.__inlineHandlerFired === true;
  })(),
  /* And a real one from the shipped markup, clicked for real. */
  realButtonFires: (() => {
    const button = document.querySelector('#langScreen [onclick], #initialSetup [onclick], [onclick*="selectLanguage"]');
    if (!button) return 'no-button-found';
    return typeof button.onclick === 'function';
  })(),
}));

Object.assign(probe, dialogProbe);
check('every script executes under the CSP', probe.app === 'object' && probe.initFn === 'function', JSON.stringify({ app: probe.app, initFn: probe.initFn }));
check('the global functions handlers call exist', probe.inlineHandler === 'function', probe.inlineHandler);
check('an inline onclick attribute actually fires', probe.inlineAttrFires === true, String(probe.inlineAttrFires));
check('a shipped button carries a live handler', probe.realButtonFires === true, String(probe.realButtonFires));
check('the desktop bridge loads', probe.bridge === 'object', probe.bridge);
check('the native bootstrap was injected', probe.bootstrap, String(probe.bootstrap));
check('the service worker API is gone', probe.serviceWorkerGone, String(probe.serviceWorkerGone));
check('the lock/setup screen is present', probe.setup, String(probe.setup));
check('the desktop settings card exists', probe.desktopCard && probe.keepRunning && probe.vaultToggle, JSON.stringify(probe));
check('WebCrypto is available', probe.webCrypto, String(probe.webCrypto));
check('no code calls the browser dialogs the native shell cannot show',
  nativeDialogCalls.length === 0, nativeDialogCalls.slice(0, 5).join(', '));
check('the dialog replacement module loaded', probe.dialogs === 'object', probe.dialogs);
check('confirm() resolves true when OK is pressed', probe.confirmOk === true, String(probe.confirmOk));
check('prompt() returns the typed value and can mask it', probe.promptValue === 'secret-1234', String(probe.promptValue));
check('cancel resolves false, not undefined', probe.confirmCancel === false, String(probe.confirmCancel));
check('no script threw', errors.length === 0, JSON.stringify(errors.slice(0, 4)));
/* A relay is not running here, so its probes are the expected failure. */
const realMisses = failed.filter((u) => !/chat-health|turn-config|peerjs/.test(u));
check('every asset in the bundle resolves', realMisses.length === 0, JSON.stringify(realMisses.slice(0, 6)));

/* The offline pane matters more in the packaged app than anywhere else: the
   desktop build is what somebody has on a laptop when the relay it normally
   talks to has become unreachable. A bundle that shipped without it would look
   perfectly healthy in every check above. */
const offline = await page.evaluate(() => ({
  pane: Boolean(document.getElementById('content-locallink')),
  tab: Boolean(document.getElementById('tab-locallink')),
  module: typeof window.PoorijaLocalLink?.startAsHost,
  lanPairing: Boolean(document.getElementById('lanPairShowBtn')),
  qrLibrary: typeof window.QRCode,
  scanner: typeof window.jsQR,
}));
check('the serverless pane is in the bundle and wired up',
  offline.pane && offline.tab && offline.module === 'function' && offline.lanPairing,
  JSON.stringify(offline));
check('the QR libraries it depends on are bundled too',
  offline.qrLibrary === 'function' && offline.scanner === 'function',
  `QRCode ${offline.qrLibrary}, jsQR ${offline.scanner}`);

await browser.close();
server.close();

const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
