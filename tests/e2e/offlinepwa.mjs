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

   The question this answers: once the app has been opened once, does it still
   need the server? Measured rather than reasoned about - the network is cut at
   the browser and the app is reloaded, then every tab is opened in turn and
   the console is read for anything that failed to load. */
import { chromium } from 'playwright';
import { chatPartNames } from './_chat-source.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const netLog = [];
page.on('requestfailed', (r) => netLog.push({ url: r.url(), err: r.failure()?.errorText || '' }));
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

console.log('\n===== first load, online =====');
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
const reg = await page.evaluate(async () => {
  /* Raced against a timeout, because serviceWorker.ready never rejects — it
     simply never settles when registration cannot happen, and .catch() does
     nothing for a promise that does not reject. Against an origin whose
     certificate the browser will not accept, this awaited for three hours
     and blocked every suite queued behind it. */
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 20000)),
  ]);
  const r = ready;
  return { registered: Boolean(r), scope: r?.scope || '' };
});
check('the service worker registers', reg.registered === true, reg.scope);

/* activate fires the background fetch of LAZY_ASSETS; give it room. */
await page.waitForTimeout(6000);
const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const out = {};
  for (const name of names) {
    const keys = await (await caches.open(name)).keys();
    out[name] = keys.map((k) => new URL(k.url).pathname);
  }
  return out;
});
const [cacheName] = Object.keys(cached);
const paths = cached[cacheName] || [];
console.log(`  cache "${cacheName}" holds ${paths.length} entries`);
check('one cache only, no stale generations left behind', Object.keys(cached).length === 1, Object.keys(cached).join(', '));

const wanted = ['/js/app.js', '/js/crypto-core.js', '/js/vault-profiles.js', '/js/stego.js',
  '/js/metadata.js', '/js/voice-changer.js', '/js/help-content.js',
  '/js/dialogs.js', '/css/styles.css', '/index.html', '/vendor/peerjs/peerjs.min.js'];
const absent = wanted.filter((w) => !paths.some((p) => p.endsWith(w)));
check('every module the app loads is in the cache', absent.length === 0, absent.join(', ') || 'all present');

/* The chat module is 36 ordered scripts. Half of them cached is not "mostly
   working" offline — the parts share one scope, so a missing part takes out
   every function defined in it while the rest of the app loads clean. Checking
   for one file, as this did, could not see that. */
const chatParts = chatPartNames();
const cachedParts = chatParts.filter((f) => paths.some((p) => p.endsWith('/js/chat/' + f)));
check('every one of the chat parts is cached',
  cachedParts.length === chatParts.length,
  `${cachedParts.length}/${chatParts.length} cached`);

console.log('\n===== now cut the network =====');
await ctx.setOffline(true);
netLog.length = 0; consoleErrors.length = 0;
await page.reload({ waitUntil: 'load' }).catch((e) => console.log('  reload threw: ' + e.message));
await page.waitForTimeout(3000);

const offline = await page.evaluate(() => ({
  title: document.title,
  hasSetup: Boolean(document.getElementById('initialSetup') || document.getElementById('lockScreen')),
  tabs: document.querySelectorAll('.tab-content').length,
  appReady: Boolean(window.PoorijaApp),
  scripts: [...document.querySelectorAll('script[src]')].length,
}));
console.log('  ' + JSON.stringify(offline));
check('the app still boots with no network at all', offline.appReady === true && offline.tabs > 0, JSON.stringify(offline));

console.log('\n===== every tab, offline =====');
const tabIds = await page.evaluate(() => [...document.querySelectorAll('.tab-content')].map((t) => t.id.replace('content-', '')));
const broken = [];
for (const id of tabIds) {
  await page.evaluate((t) => window.switchTab?.(t), id);
  await page.waitForTimeout(120);
  const ok = await page.evaluate((t) => {
    const el = document.getElementById(`content-${t}`);
    return Boolean(el) && !el.classList.contains('hidden') && el.innerText.trim().length > 0;
  }, id);
  if (!ok) broken.push(id);
}
check(`all ${tabIds.length} tabs render offline`, broken.length === 0, broken.join(', ') || 'none blank');

const appFailures = netLog.filter((r) => !/\/(chat-signal|peerjs|turn-config|chat-health|push|healthz|Monitor_Server)/.test(r.url));
console.log(`  ${netLog.length} requests failed offline; ${appFailures.length} of them were app assets`);
appFailures.slice(0, 8).forEach((f) => console.log(`    ${f.err}  ${f.url}`));
check('nothing the app itself needs went to the network', appFailures.length === 0, appFailures.slice(0, 3).map((f) => f.url).join(' '));

console.log('\n===== back online: does a fix reach an installed PWA? =====');
await ctx.setOffline(false);
const shellPolicy = await page.evaluate(async () => {
  const started = performance.now();
  const res = await fetch('./js/app.js', { cache: 'no-store' });
  return { ok: res.ok, ms: Math.round(performance.now() - started) };
});
console.log('  ' + JSON.stringify(shellPolicy));
check('the shell is re-fetched when the network is back', shellPolicy.ok === true, JSON.stringify(shellPolicy));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
