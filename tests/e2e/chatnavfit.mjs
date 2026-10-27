/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Secure Chat's section tabs fit their labels on a phone. On an iPhone the
 * bar read "تماس…" and "تنظیما…": Font Awesome 7 gives every icon a fixed
 * 1.25em box, and the bar split its width into five equal columns although
 * the fifth (search) is a lone icon. Measured in WebKit, Safari's engine, at
 * the widths phones report, in Persian and in English.
 *
 *   node tests/e2e/chatnavfit.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await webkit.launch();
try {
  for (const lang of ['fa', 'en']) {
    for (const width of [360, 375, 390, 393, 402, 414, 430, 440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      await ctx.addInitScript((language) => { try { localStorage.setItem('poorija_lang', language); localStorage.setItem('poorija_theme', 'midnight'); } catch (_e) { /* private mode */ } }, lang);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      /* The bar is laid out for real only where it is visible: show the app
         shell and the chat tab the way switchTab leaves them, without the
         first-run setup in front. */
      const fit = await page.evaluate(() => {
        for (const id of ['initialSetup', 'lockScreen', 'mobileInstallGate']) document.getElementById(id)?.classList.add('hidden');
        const main = document.getElementById('mainApp');
        main?.classList.remove('hidden');
        if (main) main.style.display = 'block';
        document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.add('hidden'));
        const chat = document.getElementById('content-chat');
        chat?.classList.remove('hidden');
        if (chat) chat.style.display = 'block';
        const items = [...document.querySelectorAll('#content-chat .chat-nav-bar .chat-nav-item[data-chat-view]')];
        return items.map((item) => {
          const label = item.querySelector('span');
          return { text: label?.textContent.trim(), scroll: label?.scrollWidth || 0, client: label?.clientWidth || 0 };
        });
      });
      const cut = fit.filter((item) => item.client === 0 || item.scroll > item.client + 0.5);
      check(`${lang} at ${width}px: every tab label is shown whole`, fit.length === 4 && cut.length === 0,
        cut.map((item) => `${item.text} ${item.client}/${item.scroll}`).join(', ') || fit.map((item) => item.text).join(' · '));
      if (lang === 'fa' && width === 390) {
        /* Anywhere in the app, not only in this strip: every layout here was
           written for Font Awesome 6, which drew each icon at its own width. */
        const icon = await page.evaluate(() => {
          const i = document.createElement('i');
          i.className = 'fas fa-phone';
          i.style.fontSize = '20px';
          document.body.appendChild(i);
          const width = i.getBoundingClientRect().width;
          i.remove();
          return width;
        });
        check('an icon anywhere is drawn at its own width, as before Font Awesome 7', icon > 0 && icon < 24, `${icon.toFixed(1)}px for a 20px phone icon (fixed would be 25px)`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
