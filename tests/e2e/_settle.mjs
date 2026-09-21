/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Waiting for the page to stop moving, rather than guessing how long it takes.
 *
 * A fresh profile registers the service worker, the worker takes control, and
 * `js/app.js` reloads the page once for that version (guarded by
 * sessionStorage, so exactly once). Every `page.evaluate` in flight when that
 * happens dies with "Execution context was destroyed, most likely because of a
 * navigation" — and the suite reads as a crash rather than a failure.
 *
 * `await page.waitForTimeout(1500)` is the usual stand-in, and it works right
 * up until it does not: on a slow machine, or the first load after a deploy
 * puts a new version in front of the worker, the reload lands at 1 600 ms and
 * the suite explodes somewhere unrelated. The number is a guess about a race,
 * and a guess is what makes a suite flaky rather than wrong.
 *
 * So: wait for a condition to hold CONTINUOUSLY. A reload cannot happen inside
 * a window where the globals stayed present the whole time, which is the actual
 * property wanted — "the page has finished arranging itself" — instead of a
 * duration that stands in for it.
 *
 *   import { settle } from './_settle.mjs';
 *   await settle(page);                                  // the app is wired up
 *   await settle(page, () => Boolean(window.PoorijaQR)); // and this too
 */

const DEFAULT_READY = () => typeof window.PoorijaApp === 'object'
  && typeof document.getElementById === 'function'
  && document.readyState === 'complete';

export async function settle(page, ready = DEFAULT_READY, {
  hold = 3000,      /* how long the condition must stay true */
  timeout = 90000,  /* how long to keep trying before giving up */
} = {}) {
  const deadline = Date.now() + timeout;
  let since = 0;
  while (Date.now() < deadline) {
    /* The evaluate itself can be destroyed by the very reload being waited
       out, so a throw here is a "not yet", not a failure. */
    const ok = await page.evaluate(ready).catch(() => false);
    if (!ok) since = 0;
    else if (!since) since = Date.now();
    else if (Date.now() - since >= hold) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

export default settle;
