/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the profile card says about the connection, against a real relay.
 *
 *   - connected, the pill and the line under the name say so, in the
 *     language in force;
 *   - after a language switch they say the same thing in the other language —
 *     they used to read "disconnected" beside a green dot, because the
 *     element's data-i18n reset them and nothing said the state again;
 *   - and back again, and for a state other than connected;
 *   - the line under the name follows the pill at once, not one state late.
 */
import { openApp, browser } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const persian = /[؀-ۿ]/;

const read = (page) => page.evaluate(() => ({
  lang: document.documentElement.lang,
  pill: document.getElementById('chatConnectionStatus')?.textContent.trim() || '',
  line: document.getElementById('chatProfileSummaryStatus')?.textContent.trim() || '',
  tone: document.getElementById('chatProfileSummaryStatus')?.dataset.tone || '',
  dot: document.getElementById('chatConnectionDot')?.className || '',
  connected: chatState.connected === true,
}));
const flip = (page) => page.evaluate(async () => {
  window.switchLanguage();
  await new Promise((r) => setTimeout(r, 500));
});
const says = (view, connected) => (view.lang === 'fa'
  ? persian.test(view.pill) && (connected ? view.pill.includes('متصل') : true)
  : !persian.test(view.pill) && (connected ? /connected/i.test(view.pill) && !/disconnected/i.test(view.pill) : true));

const stacks = await startTwoStacks();
try {
  const page = await openApp('LABEL', { origin: stacks.a.url, relay: stacks.a.url });
  await page.waitForTimeout(1500);

  console.log('\n===== connected =====');
  const first = await read(page);
  check('connected, and the pill says so in the language in force', first.connected && says(first, true), JSON.stringify(first));
  check('the line under the name says the same', first.line === first.pill && first.tone === 'online', JSON.stringify(first));

  console.log('\n===== after a language switch =====');
  await flip(page);
  const flipped = await read(page);
  check('the language changed', flipped.lang !== first.lang, `${first.lang} → ${flipped.lang}`);
  check('the pill still says connected, now in that language', says(flipped, true) && flipped.pill !== first.pill, JSON.stringify(flipped));
  check('and so does the line under the name, beside the same green dot',
    flipped.line === flipped.pill && flipped.tone === 'online' && /\bonline\b/.test(flipped.dot), JSON.stringify(flipped));
  await flip(page);
  const back = await read(page);
  check('and back again', back.lang === first.lang && back.pill === first.pill && back.line === first.pill, JSON.stringify(back));

  console.log('\n===== another state =====');
  const connecting = await page.evaluate(async () => {
    setConnectionState(false, ['در حال اتصال...', 'Connecting...']);
    const now = {
      pill: document.getElementById('chatConnectionStatus').textContent.trim(),
      line: document.getElementById('chatProfileSummaryStatus').textContent.trim(),
      tone: document.getElementById('chatProfileSummaryStatus').dataset.tone,
    };
    window.switchLanguage();
    await new Promise((r) => setTimeout(r, 500));
    return {
      now,
      after: {
        pill: document.getElementById('chatConnectionStatus').textContent.trim(),
        line: document.getElementById('chatProfileSummaryStatus').textContent.trim(),
        tone: document.getElementById('chatProfileSummaryStatus').dataset.tone,
      },
    };
  });
  check('the line under the name follows the pill at once, not one state late',
    connecting.now.line === connecting.now.pill && connecting.now.tone === 'connecting', JSON.stringify(connecting.now));
  check('"connecting" is said again in the other language, still amber',
    connecting.after.pill !== connecting.now.pill && /در حال اتصال|Connecting/.test(connecting.after.pill)
    && connecting.after.line === connecting.after.pill && connecting.after.tone === 'connecting', JSON.stringify(connecting.after));
  check('no page errors', !(page.__errors || []).length, (page.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
