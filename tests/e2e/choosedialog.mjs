/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A question with answers shows one way back out, not two.
 *
 *   PoorijaDialogs.choose relabelled its OK button "Cancel" and left the real
 *   Cancel showing, so deleting a conversation offered two buttons that both
 *   said انصراف. Here, on a phone and on a desktop:
 *
 *   - the answers and exactly one visible Cancel, carrying the caller's label;
 *   - Cancel, Escape and the backdrop each resolve to null, an answer to its
 *     value;
 *   - Cancel has the focus, so Enter on a destructive question backs out;
 *   - confirm and prompt still show OK and Cancel.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 240) : ''}`);
};

const browser = await chromium.launch();
try {
  for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
    console.log(`\n===== ${label} =====`);
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setContent('<!doctype html><html lang="fa" dir="rtl"><head></head><body></body></html>');
    await page.addStyleTag({ path: path.join(root, 'css/styles.css') });
    await page.addScriptTag({ path: path.join(root, 'js/dialogs.js') });

    const ask = () => page.evaluate(() => {
      window.__answer = 'pending';
      PoorijaDialogs.choose('گفتگو پاک شود؟', [
        { value: 'keep', label: 'حذف گفتگو — مخاطب می‌ماند' },
        { value: 'remove', label: 'حذف گفتگو و مخاطب' },
      ], { cancelLabel: 'انصراف' }).then((value) => { window.__answer = value; });
    });
    const answer = async () => {
      await page.waitForFunction(() => window.__answer !== 'pending', null, { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(220);
      return page.evaluate(() => window.__answer);
    };
    const shown = () => page.evaluate(() => {
      const visible = (node) => Boolean(node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      const buttons = [...document.querySelectorAll('.poorija-dialog button')].filter(visible);
      return {
        choices: buttons.filter((b) => b.classList.contains('poorija-dialog-choice')).map((b) => b.textContent.trim()),
        actions: buttons.filter((b) => b.classList.contains('poorija-dialog-btn')).map((b) => b.textContent.trim()),
        cancels: buttons.filter((b) => b.textContent.trim() === 'انصراف').length,
        focused: document.activeElement?.className || '',
      };
    });

    await ask();
    await page.waitForTimeout(120);
    const first = await shown();
    check('both answers are shown', first.choices.length === 2, JSON.stringify(first.choices));
    check('with exactly one Cancel, carrying the caller\'s label', first.actions.length === 1 && first.cancels === 1, JSON.stringify(first.actions));
    check('Cancel has the focus', first.focused.includes('poorija-dialog-cancel'), first.focused);
    await page.click('.poorija-dialog-cancel');
    check('Cancel backs out', (await answer()) === null);

    await ask();
    await page.waitForTimeout(120);
    await page.keyboard.press('Enter');
    check('Enter on the opened question backs out', (await answer()) === null);

    await ask();
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape');
    check('Escape backs out', (await answer()) === null);

    await ask();
    await page.waitForTimeout(120);
    await page.mouse.click(4, 4);
    check('the backdrop backs out', (await answer()) === null);

    await ask();
    await page.waitForTimeout(120);
    await page.click('.poorija-dialog-choice[data-choice-value="remove"]');
    check('an answer resolves to its value', (await answer()) === 'remove');

    await page.evaluate(() => { window.__answer = 'pending'; PoorijaDialogs.confirm('مطمئنید؟').then((v) => { window.__answer = v; }); });
    await page.waitForTimeout(120);
    const confirm = await shown();
    check('confirm still shows OK and Cancel', confirm.actions.length === 2 && confirm.actions.includes('تأیید') && confirm.cancels === 1, JSON.stringify(confirm.actions));
    await page.click('.poorija-dialog-ok');
    check('and OK still confirms', (await answer()) === true);

    await page.evaluate(() => { window.__answer = 'pending'; PoorijaDialogs.prompt('نام؟', { defaultValue: 'x' }).then((v) => { window.__answer = v; }); });
    await page.waitForTimeout(120);
    const prompt = await shown();
    check('prompt still shows OK and Cancel', prompt.actions.length === 2, JSON.stringify(prompt.actions));
    await page.click('.poorija-dialog-ok');
    check('and OK still answers', (await answer()) === 'x');

    check('no page errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
