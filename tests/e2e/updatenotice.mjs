/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What a person sees when their server is about to update: a banner that
 * says so and asks for a few minutes, in their language, on a phone too,
 * staying until the relay is back (its welcome), then gone.
 *
 *   npm run test:local -- updatenotice
 *   PKG_URL=https://localhost:8585 node tests/e2e/updatenotice.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.PKG_URL || 'http://localhost:8241';
let checks = 0;
let failures = 0;
const check = (name, ok, detail = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.PoorijaServerUpdateNotice?.show === 'function', null, { timeout: 15000 });
  const lang = async (code) => page.evaluate((value) => { if (window.PoorijaApp?.state) window.PoorijaApp.state.language = value; }, code);
  await lang('fa');
  await page.evaluate(() => window.PoorijaServerUpdateNotice.handleFrame({ type: 'server-update', version: '2.98.88', inSeconds: 120, minutes: 5 }));
  const fa = await page.evaluate(() => {
    const banner = document.getElementById('serverUpdateBanner');
    const box = banner?.getBoundingClientRect();
    return { shown: Boolean(banner && !banner.hidden && box.width > 0), text: banner?.textContent || '', role: banner?.getAttribute('role'), right: box?.right || 0, left: box?.left || 0, width: window.innerWidth };
  });
  check('the frame raises a banner saying the server is updating', fa.shown && /به‌روزرسانی/.test(fa.text) && /دقیقه/.test(fa.text), fa.text);
  check('read out to a screen reader as it changes', fa.role === 'status');
  check('within a phone’s width', fa.left >= 0 && fa.right <= fa.width, JSON.stringify(fa));
  await lang('en');
  await page.evaluate(() => window.PoorijaServerUpdateNotice.handleFrame({ type: 'server-update', minutes: 5 }));
  const en = await page.evaluate(() => document.getElementById('serverUpdateBanner')?.textContent || '');
  check('and in English for an English reader', /updating/i.test(en) && /few minutes/i.test(en), en);
  await page.evaluate(() => window.PoorijaServerUpdateNotice.handleFrame({ type: 'welcome', clientId: 'x' }));
  const gone = await page.evaluate(() => document.getElementById('serverUpdateBanner')?.hidden !== false);
  check('the relay’s welcome, once it is back, takes it away', gone);
  check('no page error along the way', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack?.split('\n').slice(0, 3).join(' ') || String(error));
} finally {
  await browser.close();
}
console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}`);
process.exit(failures ? 1 : 0);
