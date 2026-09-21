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

   The guide used to be a wall of markup with every entry written twice, once
   per language, and no way to look anything up. It is a list now, so the
   things worth pinning are that both languages are complete, that searching
   and filtering actually narrow it, and that a screen can ask for its own
   entries. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

console.log('\n===== the content itself =====');
const source = readFileSync(path.resolve(process.cwd(), 'js/help-content.js'), 'utf8');
const sandbox = { window: {} };
// eslint-disable-next-line no-new-func
new Function('window', source)(sandbox.window);
const data = sandbox.window.PoorijaHelp;
check('the guide loads as data', Boolean(data?.ENTRIES?.length), `${data?.ENTRIES?.length || 0} entries`);
const incomplete = (data?.ENTRIES || []).filter((e) => !e.fa?.t || !e.fa?.b || !e.en?.t || !e.en?.b);
check('every entry exists in both languages', incomplete.length === 0, incomplete.map((e) => e.id).join(', ') || 'all complete');
const badCat = (data?.ENTRIES || []).filter((e) => !data.CATEGORIES.some((c) => c.id === e.cat));
check('every entry is filed under a real category', badCat.length === 0, badCat.map((e) => e.id).join(', ') || 'all filed');
const ids = (data?.ENTRIES || []).map((e) => e.id);
check('no entry id is used twice', new Set(ids).size === ids.length, `${ids.length} ids`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);
await page.evaluate(() => window.switchTab?.('help'));
await page.waitForTimeout(1500);

console.log('\n===== looking something up =====');
const shown = await page.evaluate(() => ({
  cats: document.querySelectorAll('[data-help-cat]').length,
  rows: document.querySelectorAll('.poorija-help-entry').length,
}));
check('it renders every entry with a chip per category',
  shown.rows === (data?.ENTRIES?.length || -1) && shown.cats === (data?.CATEGORIES?.length || 0) + 1,
  JSON.stringify(shown));

await page.evaluate(() => { const s = document.getElementById('helpSearch'); s.value = 'گروه'; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(500);
const searched = await page.evaluate(() => document.querySelectorAll('.poorija-help-entry').length);
check('searching narrows it', searched > 0 && searched < shown.rows, `${searched} of ${shown.rows}`);

await page.evaluate(() => { const s = document.getElementById('helpSearch'); s.value = 'زززز'; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(500);
const nothing = await page.evaluate(() => ({
  rows: document.querySelectorAll('.poorija-help-entry').length,
  empty: Boolean(document.querySelector('.poorija-help-empty')),
}));
check('and says so when nothing matches', nothing.rows === 0 && nothing.empty, JSON.stringify(nothing));

await page.evaluate(() => {
  const s = document.getElementById('helpSearch'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-help-cat="groups"]')?.click();
});
await page.waitForTimeout(500);
const byCat = await page.evaluate(() => document.querySelectorAll('.poorija-help-entry').length);
check('a category shows only its own entries',
  byCat === (data?.ENTRIES || []).filter((e) => e.cat === 'groups').length && byCat > 0, `${byCat} in "groups"`);

console.log('\n===== help for the screen you are on =====');
await page.evaluate(() => window.openHelpForTab('encrypt'));
await page.waitForTimeout(700);
const byTab = await page.evaluate(() => [...document.querySelectorAll('.poorija-help-title')].map((t) => t.textContent.trim()));
check('a screen can ask for its own entries',
  byTab.length === (data?.ENTRIES || []).filter((e) => e.tab === 'encrypt').length && byTab.length > 0,
  byTab.join(' | '));

/* There is deliberately no button on the screen itself: the guide belongs in
   the Help tab, whole, rather than in fragments scattered over the app. What
   has to work is asking for one screen's entries from inside the guide. */
const fromGuide = await page.evaluate(async () => {
  window.openHelpForTab?.('encrypt');
  await new Promise((r) => setTimeout(r, 900));
  return {
    onHelp: !document.getElementById('content-help')?.classList.contains('hidden'),
    rows: document.querySelectorAll('#helpResults .poorija-help-entry').length,
  };
});
console.log('  ' + JSON.stringify(fromGuide));
check('and the guide can be narrowed to one screen', fromGuide.onHelp && fromGuide.rows > 0, JSON.stringify(fromGuide));

console.log('\n===== it follows the language =====');
/* Through the app's own switch, not by poking at its state: what matters is
   that the guide follows the language the reader actually chose. */
const en = await page.evaluate(() => {
  window.switchLanguage?.();
  window.switchTab?.('help');
  return new Promise((r) => setTimeout(() => r([...document.querySelectorAll('.poorija-help-title')].slice(0, 3).map((t) => t.textContent.trim())), 1500));
});
check('switching to English switches the guide',
  en.length > 0 && en.every((title) => !/[؀-ۿ]/.test(title)), en.join(' | ').slice(0, 60));

console.log('\n===== the guide lives in one place =====');
const scattered = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('.tab-content')].map((el) => el.id.replace('content-', ''));
  return {
    hints: document.querySelectorAll('[data-help-hint], .poorija-help-hint').length,
    panels,
  };
});
console.log('  ' + JSON.stringify({ hints: scattered.hints, panels: scattered.panels.length }));
check('no screen carries a help button of its own', scattered.hints === 0, `${scattered.hints} found`);

const coverage = await page.evaluate((panels) => {
  const entries = window.PoorijaHelp?.ENTRIES || [];
  const covered = new Set(entries.map((e) => e.tab));
  const cats = new Set((window.PoorijaHelp?.CATEGORIES || []).map((c) => c.id));
  return {
    total: entries.length,
    missing: panels.filter((p) => !covered.has(p)),
    orphans: [...covered].filter((t) => !panels.includes(t)),
    bad: entries.filter((e) => !cats.has(e.cat) || !e.fa?.t || !e.fa?.b || !e.en?.t || !e.en?.b).map((e) => e.id),
  };
}, scattered.panels);
console.log('  ' + JSON.stringify(coverage));
check('every screen in the app is written up in the guide', coverage.missing.length === 0, coverage.missing.join(', ') || 'all covered');
check('and no entry points at a screen that does not exist', coverage.orphans.length === 0, coverage.orphans.join(', ') || 'none');
check('every entry is complete and in both languages', coverage.bad.length === 0, coverage.bad.join(', ') || 'all complete');

/* The guide has to be reachable and readable, not merely present in a list. */
const rendered = await page.evaluate(async () => {
  window.switchTab?.('help');
  await new Promise((r) => setTimeout(r, 800));
  const panel = document.getElementById('content-help');
  /* An earlier section leaves the app in English; search a word the guide
     carries in whichever language is showing. */
  const fa = document.documentElement.getAttribute('lang') !== 'en';
  const term = fa ? 'متادیتا' : 'metadata';
  const search = document.getElementById('helpSearch');
  if (search) { search.value = term; search.dispatchEvent(new Event('input', { bubbles: true })); }
  await new Promise((r) => setTimeout(r, 500));
  window.__helpTerm = term;
  return {
    open: Boolean(panel) && !panel.classList.contains('hidden'),
    cats: document.querySelectorAll('#helpCategories [data-help-cat]').length,
    hits: document.querySelectorAll('#helpResults .poorija-help-entry').length,
    term: window.__helpTerm,
    text: (document.getElementById('helpResults')?.innerText || '').slice(0, 120),
  };
});
console.log('  ' + JSON.stringify(rendered));
check('the guide opens with its categories', rendered.open === true && rendered.cats >= 5, JSON.stringify({ open: rendered.open, cats: rendered.cats }));
check('and searching it finds the entry',
  rendered.hits >= 1 && new RegExp(rendered.term, 'i').test(rendered.text),
  JSON.stringify(rendered).slice(0, 160));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
