/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Every tab, one at a time, in both languages.
 *
 *   npm run relay ; PORT=8123 npm run dev ; node tests/e2e/tabsweep.mjs
 *
 * The other suites each drive one feature deeply. Nothing walked the whole
 * surface, so a tab could throw on open, render empty, or ship a control that
 * says nothing to a screen reader, and every suite would still be green — the
 * smoke test counts that 28 tabs EXIST, which is not the same as 28 tabs that
 * work.
 *
 * Four questions per tab, each one a defect class that has actually happened
 * in this codebase:
 *
 *   1. Does opening it throw? Including an unhandled promise rejection, which
 *      leaves no trace in the interface at all.
 *   2. Does it render anything? A panel that is present but empty looks like a
 *      loading state forever.
 *   3. Does every control have a name? Icon-only buttons are the house style
 *      here, and an icon with no aria-label, title or text is silent to a
 *      screen reader and unlabelled under a long-press on mobile.
 *   4. Does it survive the other language? Switching languages re-renders
 *      everything; a key with no table entry leaves Persian on an English
 *      screen, which an audit found forty of.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Harness#Pass2026!';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 960 },
  permissions: ['microphone', 'camera'],
});
await context.addInitScript(() => {
  try { localStorage.setItem('poorija_lang', 'fa'); } catch (error) { /* private mode */ }
});
const page = await context.newPage();

/* Three separate channels, because they fail differently: a thrown error, a
   rejected promise nobody awaited, and console.error from a catch block that
   decided to keep going. */
const errors = [];
const rejections = [];
const consoleErrors = [];
page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
/* Console records that something 404'd; only the response tells you what. */
const notFound = [];
page.on('response', (response) => {
  if (response.status() < 400) return;
  const url = response.url();
  if (/chat-health|turn-config|peerjs|favicon/.test(url)) return;
  notFound.push(`${response.status()} ${url.replace(BASE, '')}`);
});
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  /* "Failed to load resource: … 404" carries no URL, so there is nothing here
     to filter a relay probe out by — the response listener above sees the URL
     and is the right place to judge those. Counting them here as well reported
     the same expected 404 twice and called it a defect. */
  if (/Failed to load resource/.test(text)) return;
  if (/chat-health|turn-config|peerjs|favicon|ERR_CONNECTION/.test(text)) return;
  consoleErrors.push(text.slice(0, 160));
});

try {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate(() => {
    window.__rejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      window.__rejections.push(String(event.reason).slice(0, 160));
    });
    if (typeof continueInBrowserExperience === 'function') continueInBrowserExperience();
  });
  await page.waitForTimeout(600);

  await page.evaluate((pass) => {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('setupPassword', pass);
    set('confirmPassword', pass);
    document.querySelectorAll('#initialSetup select').forEach((select, index) => {
      if (select.options.length > index + 1) {
        select.selectedIndex = index + 1;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((input, index) => {
      input.value = 'answer' + index;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const terms = document.getElementById('acceptTermsCheckbox');
    if (terms && !terms.checked) { terms.checked = true; terms.dispatchEvent(new Event('change', { bubbles: true })); }
  }, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.getElementById('mobileInstallGate')?.classList.add('hidden'));

  const unlocked = await page.evaluate(() => Boolean(window.PoorijaApp?.state?.activeProfile));
  check('the app unlocked, so the tabs can be reached at all', unlocked, String(unlocked));

  /* Read the tab list from the sidebar rather than hard-coding it, so a tab
     added later is swept without anyone remembering to add it here. */
  const tabs = await page.evaluate(() => Array.from(
    document.querySelectorAll('#sidebarNav button[id^="tab-"]'))
    .map((button) => button.id.replace(/^tab-/, '')));
  console.log(`\n  ${tabs.length} tabs to sweep: ${tabs.join(' ')}`);
  check('every tab in the sidebar was discovered', tabs.length >= 25, `${tabs.length} tabs`);

  const broken = [];
  const empty = [];
  const unnamed = [];

  for (const tab of tabs) {
    const before = { errors: errors.length, console: consoleErrors.length };
    await page.evaluate((name) => window.switchTab?.(name), tab);
    await page.waitForTimeout(450);

    const state = await page.evaluate((name) => {
      const panel = document.getElementById(`content-${name}`);
      if (!panel) return { missing: true };
      const visible = !panel.classList.contains('hidden');
      const text = (panel.innerText || '').trim();
      /* Content inside a collapsed <details> is hidden from a screen reader as
         well as from the eye, so it is not a "visible control" — offsetParent
         alone says otherwise and flagged buttons nobody can reach yet. */
      const controls = Array.from(panel.querySelectorAll('button, [role="button"], a[href]'))
        .filter((el) => el.offsetParent !== null)
        .filter((el) => {
          const details = el.closest('details');
          return !details || details.open || el.closest('summary');
        });
      /* A control is "named" if a screen reader has anything to read: its own
         text, an aria-label, a title, or a labelled child. */
      const nameless = controls.filter((el) => {
        const own = (el.innerText || '').trim();
        const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        const title = el.getAttribute('title');
        return !own && !aria && !title;
      }).map((el) => (el.id || el.className || el.tagName).toString().slice(0, 42));
      return {
        visible,
        chars: text.length,
        controls: controls.length,
        nameless: nameless.slice(0, 6),
        namelessCount: nameless.length,
      };
    }, tab);

    const rejectionsNow = await page.evaluate(() => window.__rejections.length);
    const newErrors = errors.length - before.errors;
    const newConsole = consoleErrors.length - before.console;

    if (state.missing || !state.visible || newErrors > 0) {
      broken.push(`${tab}${state.missing ? ' (no panel)' : ''}${newErrors ? ` (${newErrors} error)` : ''}`);
    }
    /* Some panels are legitimately thin until used, but a handful of characters
       means nothing rendered. */
    if (!state.missing && state.chars < 40) empty.push(`${tab}:${state.chars}ch`);
    if (state.namelessCount > 0) unnamed.push(`${tab}: ${state.namelessCount} (${state.nameless.join(', ')})`);

    console.log(`   ${tab.padEnd(16)} ${String(state.chars).padStart(6)} chars`
      + `  ${String(state.controls).padStart(3)} controls`
      + `  ${newErrors || newConsole ? `ERR ${newErrors}/${newConsole}` : 'clean'}`
      + `  ${state.namelessCount ? `${state.namelessCount} unnamed` : ''}`);
  }

  console.log('');
  check('no tab throws when it is opened', broken.length === 0, broken.join(', ') || 'all clean');
  check('no tab renders empty', empty.length === 0, empty.join(', ') || 'all have content');
  check('every visible control has a name a screen reader can read',
    unnamed.length === 0, unnamed.slice(0, 4).join(' | ') || 'all named');

  /* ===== the other language ============================================= */

  console.log('\n===== switching to English and back =====');

  const beforeSwitch = errors.length;
  /* The language control is a toggle button calling switchLanguage(), not a
     select — an earlier version of this file guessed a <select> that does not
     exist, found nothing, and then reported the 39 Persian labels it had
     failed to translate as if the app were at fault. */
  await page.evaluate(() => {
    if (typeof switchLanguage === 'function') switchLanguage();
    else document.getElementById('langBtn')?.click();
  });
  await page.waitForTimeout(1200);

  const english = await page.evaluate(() => {
    const persian = /[؀-ۿ]/;
    const leftovers = [];
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      if (el.offsetParent === null) return;
      const text = (el.textContent || '').trim();
      if (text && persian.test(text)) leftovers.push(`${el.getAttribute('data-i18n')}="${text.slice(0, 26)}"`);
    });
    return { language: window.PoorijaApp?.state?.language, leftovers: leftovers.slice(0, 10), total: leftovers.length };
  });
  console.log(`  language now: ${english.language}, untranslated visible labels: ${english.total}`);
  if (english.total) console.log('   ' + english.leftovers.join('\n   '));
  check('the language actually changed', english.language === 'en', String(english.language));
  /* This is the check that found forty keys with no table entry: a data-i18n
     element still showing Persian after the switch has no English to show. */
  check('no visible label is left in Persian after switching to English',
    english.total === 0, `${english.total} left`);

  /* Sweep every tab again in English — a translation table can be complete and
     a renderer can still write Persian into the DOM itself. */
  const englishBroken = [];
  for (const tab of tabs) {
    const before = errors.length;
    await page.evaluate((name) => window.switchTab?.(name), tab);
    await page.waitForTimeout(250);
    if (errors.length > before) englishBroken.push(tab);
  }
  check('no tab throws in English either', englishBroken.length === 0,
    englishBroken.join(', ') || 'all clean');
  check('switching language threw nothing', errors.length === beforeSwitch + englishBroken.length,
    `${errors.length - beforeSwitch} errors`);

  /* ===== what leaked out of the whole run ============================== */

  console.log('\n===== everything the run raised =====');
  const finalRejections = await page.evaluate(() => window.__rejections);
  console.log(`  page errors ${errors.length}, unhandled rejections ${finalRejections.length}, console errors ${consoleErrors.length}`);
  errors.slice(0, 5).forEach((error) => console.log(`   throw:  ${error}`));
  finalRejections.slice(0, 5).forEach((reason) => console.log(`   reject: ${reason}`));
  consoleErrors.slice(0, 5).forEach((text) => console.log(`   console:${text}`));
  notFound.slice(0, 8).forEach((line) => console.log(`   http:   ${line}`));

  check('nothing threw across the whole sweep', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('no promise was rejected without a handler', finalRejections.length === 0,
    finalRejections.slice(0, 3).join(' | '));
  check('nothing was written to console.error', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));
  check('every request the app made was answered',
    notFound.length === 0, notFound.slice(0, 4).join(' | ') || 'none failed');
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((result) => console.log(`  - ${result.name}`));
  process.exit(1);
}
