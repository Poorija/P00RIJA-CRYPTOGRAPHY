/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The screen guard's page half, in a browser (the native halves are the
 * platform's own switches and are compiled, not driven, here).
 *
 *   - off by default, and nothing is covered;
 *   - on: the app covers itself when it loses focus or is hidden, and
 *     uncovers when it is used again;
 *   - in a browser it says plainly that a screenshot cannot be stopped;
 *   - the choice survives a reload and covers the lock screen too.
 */
import { openApp, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const covered = (page) => page.evaluate(() => document.documentElement.classList.contains('screen-shield'));

const stacks = await startTwoStacks();
try {
  const PAGE = await openApp('GUARD', { origin: stacks.a.url, relay: stacks.a.url });
  check('the switch is in Settings', await PAGE.evaluate(() => Boolean(document.getElementById('screenGuardToggle'))));
  await PAGE.evaluate(() => window.dispatchEvent(new Event('blur')));
  check('off by default: losing focus covers nothing', (await covered(PAGE)) === false);

  await PAGE.evaluate(() => {
    const toggle = document.getElementById('screenGuardToggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitFor(PAGE, () => window.PoorijaScreenGuard?.enabled() === true, { timeoutMs: 5000 });
  await PAGE.evaluate(() => window.dispatchEvent(new Event('blur')));
  check('on: losing focus covers the app', (await covered(PAGE)) === true);
  await PAGE.evaluate(() => window.dispatchEvent(new Event('focus')));
  check('and coming back uncovers it', (await covered(PAGE)) === false);
  const status = await PAGE.evaluate(() => document.getElementById('screenGuardStatus')?.textContent || '');
  check('in a browser it says a screenshot cannot be stopped there', /cannot be stopped/.test(status), status);
  const layer = await PAGE.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    const style = getComputedStyle(document.body, '::after');
    const result = { position: style.position, z: style.zIndex };
    window.dispatchEvent(new Event('focus'));
    return result;
  });
  check('the cover sits over everything', layer.position === 'fixed' && Number(layer.z) > 1000000, JSON.stringify(layer));

  await PAGE.reload({ waitUntil: 'load' });
  await PAGE.waitForTimeout(1500);
  const afterReload = await PAGE.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    return { remembered: window.PoorijaScreenGuard?.enabled(), locked: window.PoorijaApp?.state?.isLocked, covered: document.documentElement.classList.contains('screen-shield') };
  });
  check('the choice survives a reload, and covers the lock screen too', afterReload.remembered === true && afterReload.covered === true, JSON.stringify(afterReload));

  check('no page errors', !(PAGE.__errors || []).length, (PAGE.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
