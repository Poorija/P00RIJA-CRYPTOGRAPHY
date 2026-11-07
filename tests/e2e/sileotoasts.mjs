/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */
/* The toasts, drawn by sileo (vendor/sileo, built by tools/vendor-sileo).
 *
 *   npm run test:local -- sileotoasts
 *   PKG_URL=https://localhost:8585 node tests/e2e/sileotoasts.mjs
 *
 * Measured, not trusted: where each toast lands, what is on top at that
 * point, which way Persian runs, that the text is centred and heavy enough,
 * that the filter rounding the shape's corners resolves, that two notices are
 * two toasts, that the app's switch still silences them, that the log the
 * other suites read says what the page said, and that a page without the
 * bundle still shows the plain toast instead of nothing.
 */
import { chromium, webkit } from 'playwright';
import { settle } from './_settle.mjs';

const BASE = process.env.PKG_URL || 'http://localhost:8241';
const engine = process.env.E2E_ENGINE === 'webkit' ? webkit : chromium;
let checks = 0;
let failures = 0;
const check = (name, ok, detail = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await engine.launch();

async function open({ width = 1280, height = 800, blockSileo = false } = {}) {
  /* No service worker: it would serve the bundle from its cache whatever the
     route below says. */
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, serviceWorkers: 'block' });
  if (blockSileo) await context.route('**/vendor/sileo/**', (route) => route.abort());
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`   [page] ${error.message.slice(0, 130)}`));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await settle(page, () => typeof window.PoorijaApp?.showNotification === 'function'
    && (window.PoorijaSileo || document.readyState === 'complete'));
  await page.evaluate(() => {
    window.PoorijaApp.state.settings.notifications = true;
    window.PoorijaApp.toasts.clear();
  });
  return { context, page };
}

/* Every drawn toast: its box, its state and its text. */
const readToasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toastStack [data-sileo-toast]')]
  .map((toast) => {
    const box = toast.getBoundingClientRect();
    const description = toast.querySelector('[data-sileo-description]');
    return {
      left: box.left, top: box.top, width: box.width, height: box.height,
      state: toast.querySelector('[data-sileo-title]')?.dataset.state || '',
      title: toast.querySelector('[data-sileo-title]')?.textContent || '',
      text: description?.textContent || '',
      direction: description ? getComputedStyle(description).direction : '',
      align: description ? getComputedStyle(description).textAlign : '',
      weight: description ? Number(getComputedStyle(description).fontWeight) : 0,
      /* The shape's corners are rounded by an SVG filter the shape names with
         url(#id); a url() the browser cannot parse leaves the filter "none". */
      filter: getComputedStyle(toast.querySelector('[data-sileo-svg] g') || toast).filter,
    };
  }));

try {
  console.log('\n===== sileo draws the toasts =====');
  {
    const { context, page } = await open();
    const loaded = await page.evaluate(() => ({
      version: window.PoorijaSileo?.version || '',
      frozen: Object.isFrozen(window.PoorijaSileo || {}),
    }));
    check('the bundle is loaded and exposes one frozen global', loaded.version === '0.1.6' && loaded.frozen,
      JSON.stringify(loaded));

    await page.evaluate(() => {
      window.PoorijaApp.state.language = 'fa';
      window.PoorijaApp.showNotification('کلید کپی شد', 'success');
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.PoorijaApp.showNotification('فایل باز نشد (NotReadableError). دوباره تلاش کنید.', 'error'));
    await page.waitForTimeout(1200);
    const drawn = await readToasts(page);
    check('two notices are two toasts, not one replacing the other', drawn.length === 2, `${drawn.length} drawn`);
    const centre = 1280 / 2;
    check('every toast is centred at the top', drawn.every((t) => Math.abs(t.left + t.width / 2 - centre) < 4 && t.top < 140),
      drawn.map((t) => `${Math.round(t.left)},${Math.round(t.top)}`).join(' '));
    const error = drawn.find((t) => t.state === 'error');
    check('the error carries its state, a Persian title and the whole message',
      Boolean(error) && error.title === 'خطا' && error.text.includes('NotReadableError'),
      error ? `${error.title} / ${error.text.slice(0, 40)}` : 'no error toast');
    check('Persian runs right to left inside the toast', error?.direction === 'rtl', error?.direction);
    check('its text is centred and drawn heavier than sileo\'s default',
      error?.align === 'center' && error?.weight >= 600, error ? `${error.align} / ${error.weight}` : 'no error toast');
    check('the corners where the pill meets the body are rounded: every shape\'s filter resolves',
      drawn.length > 0 && drawn.every((t) => t.filter.startsWith('url(')), drawn.map((t) => t.filter.slice(0, 40)).join(' | '));

    const stacking = await page.evaluate(() => {
      const cover = document.createElement('div');
      cover.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000';
      document.body.appendChild(cover);
      const toast = document.querySelector('#toastStack [data-sileo-toast]');
      const box = toast.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      cover.remove();
      return { onTop: Boolean(hit?.closest('#toastStack')), last: document.getElementById('toastStack') === document.body.lastElementChild };
    });
    check('a toast is drawn above the highest dialog layer', stacking.onTop && stacking.last, JSON.stringify(stacking));

    await page.evaluate(() => {
      window.PoorijaApp.toasts.clear();
      window.PoorijaApp.showNotification('same notice', 'info');
      window.PoorijaApp.showNotification('same notice', 'info');
    });
    await page.waitForTimeout(900);
    const repeated = (await readToasts(page)).filter((t) => t.text === 'same notice').length;
    check('the same notice raised twice refreshes one toast', repeated === 1, `${repeated} drawn`);

    const log = await page.evaluate(() => window.PoorijaApp.toasts.recent());
    check('the log the suites read records what the page said, in order',
      log.length === 2 && log.every((entry) => entry.type === 'info' && entry.message === 'same notice'),
      JSON.stringify(log).slice(0, 120));

    await page.evaluate(() => {
      window.PoorijaApp.toasts.clear();
      window.PoorijaApp.state.settings.notifications = false;
      window.PoorijaApp.showNotification('must stay silent', 'warning');
    });
    await page.waitForTimeout(700);
    const silenced = await page.evaluate(() => ({
      drawn: [...document.querySelectorAll('#toastStack [data-sileo-toast]')].some((t) => t.textContent.includes('must stay silent')),
      logged: window.PoorijaApp.toasts.recent().length,
    }));
    check("the app's notification switch still silences every toast", !silenced.drawn && silenced.logged === 0,
      JSON.stringify(silenced));

    await page.evaluate(() => {
      window.PoorijaApp.state.settings.notifications = true;
      window.PoorijaApp.state.language = 'en';
      window.PoorijaApp.showNotification('Relay connection restored', 'info');
    });
    await page.waitForTimeout(900);
    const english = (await readToasts(page)).find((t) => t.text === 'Relay connection restored');
    check('English reads left to right under an English title', english?.direction === 'ltr' && english?.title === 'Notice',
      english ? `${english.direction} / ${english.title}` : 'not drawn');
    check('and is centred too', english?.align === 'center', english?.align);
    await context.close();
  }

  console.log('\n===== a phone =====');
  {
    const { context, page } = await open({ width: 360, height: 740 });
    await page.evaluate(() => window.PoorijaApp.showNotification('یک پیام نسبتاً بلند که باید روی صفحهٔ کوچک تلفن کامل دیده شود و بیرون نزند.', 'warning'));
    await page.waitForTimeout(1200);
    const [toast] = await readToasts(page);
    check('the toast fits inside a 360-pixel screen', Boolean(toast) && toast.left >= 0 && toast.left + toast.width <= 360,
      toast ? `${Math.round(toast.left)}..${Math.round(toast.left + toast.width)}` : 'not drawn');
    check('and starts below the phone header', Boolean(toast) && toast.top >= 60, toast ? String(Math.round(toast.top)) : '');
    await context.close();
  }

  console.log('\n===== without the bundle =====');
  {
    const { context, page } = await open({ blockSileo: true });
    await page.evaluate(() => window.PoorijaApp.showNotification('the plain toast still shows', 'error'));
    await page.waitForTimeout(300);
    const plain = await page.evaluate(() => ({
      sileo: Boolean(window.PoorijaSileo),
      text: document.querySelector('#toastStack .app-toast')?.textContent || '',
      logged: window.PoorijaApp.toasts.recent().at(-1)?.message || '',
    }));
    check('a page that could not load sileo falls back to the plain toast',
      !plain.sileo && plain.text.includes('the plain toast still shows') && plain.logged === 'the plain toast still shows',
      JSON.stringify(plain).slice(0, 120));
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
