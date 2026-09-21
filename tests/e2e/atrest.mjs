/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Nothing secret is left readable in localStorage.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   PORT=8123 npm run dev                 # terminal 1
 *   node tests/e2e/atrest.mjs            # no relay needed: this is about storage
 *
 * Every chat store goes through encryptStorageData — tools/store-formats.cjs
 * prints that, key by key, and they are all "encrypted". Three did not:
 *
 *   poorija_passwords   the generated-password list, {password, created, id}
 *                       rows written with a bare JSON.stringify
 * poorija_2fa also holds a secret in the clear and is left alone on purpose:
 * verifySecondFactor() runs before adoptProfile(), so there is no profile key
 * in existence at the moment that secret has to be read. Reversing the order to
 * encrypt it would restore the bug that order was chosen to fix. poorija_keys'
 * plain write is a backup-restore path handing back bytes that arrived already
 * encrypted, so re-wrapping them would corrupt them.
 *
 * For a product whose claim is that plaintext does not leave the device, a
 * browser profile directory that hands over the user's generated passwords is
 * the wrong shape of failure. This reads the raw strings back out of
 * localStorage and looks for the secret in them. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'AtRest#Harness2026!';
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('dialog', (d) => d.accept());
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. On a fresh profile the service worker reloads the page
   once, and a form filled before that lands is wiped by it — which reads as
   "setup silently refused" and cost an hour the first time. */
await settle(page);

/* The language screen comes FIRST on a genuinely fresh profile, and the
   security-question selects are not populated until it is answered —
   initSecQuestionsUI() runs from the branch that shows the setup form, not on
   load. Skip it and all three selects hold zero options, the setup button stays
   disabled, and the click that follows does nothing at all: no toast, no error,
   no profile. The older suites never hit this because a container that has run
   before already has poorija_lang set. */
await page.evaluate(() => {
  (window.selectLanguage || window.PoorijaApp?.selectLanguage)?.('en');
});
await page.waitForTimeout(1500);

/* Same setup the chat harness uses: a real profile, because encryptStorageData
   refuses to run before unlock and testing it locked would test nothing. */
await page.evaluate((pass) => {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('setupPassword', pass); set('confirmPassword', pass);
  const taken = new Set();
  document.querySelectorAll('#initialSetup select').forEach((select) => {
    const option = [...select.options].find((o) => o.value !== '' && !taken.has(o.value));
    if (!option) return;
    taken.add(option.value);
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((input, i) => {
    input.value = `answer${i}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const terms = document.getElementById('acceptTermsCheckbox');
  if (terms && !terms.checked) { terms.checked = true; terms.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(600);
const ready = await page.evaluate(() => document.getElementById('setupBtn')?.disabled === false);
check('the setup form is complete enough to submit', ready,
  'a disabled setupBtn swallows .click() without a toast or an error');
await page.evaluate(() => document.getElementById('setupBtn')?.click());

let unlocked = false;
for (let tries = 0; tries < 90 && !unlocked; tries += 1) {
  unlocked = await page.evaluate(() => window.PoorijaApp?.state?.isLocked === false);
  if (!unlocked) await page.waitForTimeout(1000);
}
check('a real profile is unlocked, so the encrypted path is reachable', unlocked,
  'encryptStorageData throws before unlock, and a locked run would prove nothing');
if (!unlocked) {
  console.log(`\n===== ${results.filter((ok) => !ok).length} failed of ${results.length} =====`);
  await browser.close();
  process.exit(1);
}

/* Written through the app's own save functions, not by poking localStorage, so
   this measures the code paths a user actually takes. */
const SECRET_PASSWORD = 'Zx9-SentinelPassword-Qw4';

const wrote = await page.evaluate(([password]) => {
  const app = window.PoorijaApp;
  const out = { password: false, totp: false };
  try {
    app.state.generatedPasswords.push({ password, created: new Date().toISOString(), id: Date.now() });
    (window.savePasswords || app.savePasswords)?.();
    out.password = true;
  } catch (_error) { /* reported by the assertion below */ }
  return out;
}, [SECRET_PASSWORD]);
check('the app saved a generated password through its own path', wrote.password);

/* The question is not what the app can read back — it is what somebody with
   the profile directory can read without the master password. */
const raw = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    out[key] = String(localStorage.getItem(key) || '');
  }
  return out;
});
const everything = Object.entries(raw);
const holding = (needle) => everything.filter(([, value]) => value.includes(needle)).map(([key]) => key);

const passwordLeaks = holding(SECRET_PASSWORD);
check('THE GENERATED PASSWORD IS NOT READABLE ON DISK — the bug this suite exists for',
  passwordLeaks.length === 0,
  passwordLeaks.length ? `found in ${passwordLeaks.join(', ')}` : 'not in any localStorage value');

/* poorija_2fa is NOT asserted here, and that is the finding rather than a gap.
   verifySecondFactor() runs before adoptProfile() on purpose — the reverse
   order returned from a wrong code with the vault already open in memory — so
   the TOTP secret has to be readable at a moment when no profile key exists to
   encrypt it with. What can be checked is that the exemption stays deliberate
   and narrow: the 2FA record holds the secret and the enabled flag, nothing
   else, so a plaintext read yields no more than the second factor itself. */
const twoFactorShape = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.endsWith('poorija_2fa'));
  if (!key) return { absent: true };
  try { return { keys: Object.keys(JSON.parse(localStorage.getItem(key) || '{}')).sort() }; }
  catch (_error) { return { unreadable: true }; }
});
check('the one store left in the clear carries nothing but the second factor',
  twoFactorShape.absent || JSON.stringify(twoFactorShape.keys) === JSON.stringify(['enabled', 'secret']),
  twoFactorShape.absent ? 'no 2FA record on this profile' : JSON.stringify(twoFactorShape));

/* A store that encrypts is no use if the app can no longer read it. */
const readBack = await page.evaluate(() => {
  const app = window.PoorijaApp;
  try {
    (window.loadPasswords || app.loadPasswords)?.();
    return (app.state.generatedPasswords || []).map((row) => row.password);
  } catch (error) {
    return { error: String(error?.message || error) };
  }
});
check('the app still reads its own passwords back',
  Array.isArray(readBack) && readBack.includes(SECRET_PASSWORD),
  Array.isArray(readBack) ? `${readBack.length} row(s)` : JSON.stringify(readBack));

/* Legacy plaintext has to keep opening, or upgrading silently loses a list
   somebody depends on. */
const migrated = await page.evaluate((password) => {
  const app = window.PoorijaApp;
  const key = Object.keys(localStorage).find((k) => k.endsWith('poorija_passwords')) || 'poorija_passwords';
  localStorage.setItem(key, JSON.stringify([{ password, created: new Date().toISOString(), id: 1 }]));
  app.state.generatedPasswords = [];
  (window.loadPasswords || app.loadPasswords)?.();
  const read = (app.state.generatedPasswords || []).map((row) => row.password);
  (window.savePasswords || app.savePasswords)?.();
  return { read, afterRewrite: String(localStorage.getItem(key) || '').includes(password) };
}, 'Legacy-Plaintext-Row-77');
check('a list written before this change is still readable',
  Array.isArray(migrated.read) && migrated.read.includes('Legacy-Plaintext-Row-77'),
  JSON.stringify(migrated.read || []).slice(0, 60));
check('and is re-written encrypted rather than left in the clear',
  migrated.afterRewrite === false,
  migrated.afterRewrite ? 'still plaintext after a save' : 'no longer readable');

await browser.close();
const bad = results.filter((ok) => !ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
