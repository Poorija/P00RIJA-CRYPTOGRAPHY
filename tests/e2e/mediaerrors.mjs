/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the app says when the camera or the microphone will not open.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/mediaerrors.mjs
 *
 * The macOS build could not use either. The cause was one missing entitlement:
 * bundle.macOS.hardenedRuntime is on, and the hardened runtime spells the
 * microphone com.apple.security.device.audio-input, while the entitlements
 * file carried only the App Sandbox spelling, device.microphone. The runtime
 * therefore denied the microphone before TCC was ever consulted — and since
 * every call path asks for { audio: true, video }, one blocked microphone took
 * the camera down with it, which is why it was reported as both.
 *
 * That took far longer to find than it should have, and this suite is about
 * the reason why: every call site caught the rejection, discarded it, and said
 * "access was denied". A missing entitlement, a webcam another app already
 * holds, and a laptop with no camera all produced one identical sentence. The
 * error's own name is the whole diagnosis, and it was being thrown away.
 *
 * So what is asserted is not the entitlement — a browser cannot see it — but
 * that the four distinct failures are told apart and that each says something
 * a person could act on.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const browser = await chromium.launch();

try {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await settle(page, () => typeof window.describeMediaError === 'function');

  check('the app has a way to read a getUserMedia rejection',
    await page.evaluate(() => typeof window.describeMediaError === 'function'));

  const said = await page.evaluate(async () => {
    /* Read the English wording deliberately. The app starts in whichever
       language was saved, so asserting on English text without asking for it
       is a test that passes or fails by accident. */
    if (document.documentElement.lang !== 'en') window.switchLanguage();
    await new Promise((r) => setTimeout(r, 300));
    const make = (name) => Object.assign(new Error(name), { name });
    const out = {};
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError',
      'SecurityError', 'AbortError']) {
      out[name] = {
        both: window.describeMediaError(make(name), 'both'),
        audio: window.describeMediaError(make(name), 'audio'),
        video: window.describeMediaError(make(name), 'video'),
      };
    }
    return out;
  });
  for (const [name, row] of Object.entries(said)) {
    console.log(`  ${name}: ${row.both}`);
  }

  /* Four causes, four different sentences. If any two collide the message has
     stopped carrying information, which is the state this suite exists to
     prevent returning to. */
  const distinct = new Set(Object.values(said).map((row) => row.both));
  check('each cause gets its own sentence',
    distinct.size === Object.keys(said).length,
    `${distinct.size} distinct of ${Object.keys(said).length}`);

  check('a refusal points at the system settings, where the fix is',
    /system settings/i.test(said.NotAllowedError.both), said.NotAllowedError.both);
  check('a missing device does not read as a refusal',
    !/refused|denied/i.test(said.NotFoundError.both), said.NotFoundError.both);
  check('a device another app is holding says so',
    /another application/i.test(said.NotReadableError.both), said.NotReadableError.both);
  /* An error nobody anticipated must still carry its name out, or it lands in
     the same bucket the old code had. */
  check('an unforeseen error carries its own name',
    said.AbortError.both.includes('AbortError'), said.AbortError.both);

  check('it names the microphone and the camera separately when it knows which',
    said.NotAllowedError.audio !== said.NotAllowedError.video
    && /microphone/i.test(said.NotAllowedError.audio)
    && /camera/i.test(said.NotAllowedError.video),
    `${said.NotAllowedError.audio} | ${said.NotAllowedError.video}`);

  /* And it has to follow the language like everything else. */
  const persian = await page.evaluate(async () => {
    if (document.documentElement.lang !== 'fa') window.switchLanguage();
    await new Promise((r) => setTimeout(r, 300));
    const error = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    return window.describeMediaError(error, 'audio');
  });
  console.log(`  fa: ${persian}`);
  check('and it speaks Persian in Persian', /[؀-ۿ]/.test(persian), persian);

  /* The call path must actually reach it rather than keeping its own copy of
     the old sentence. */
  const wiring = await page.evaluate(async () => {
    window.switchTab?.('chat');
    await new Promise((r) => setTimeout(r, 900));
    return typeof window.mediaFailureText === 'function'
      ? window.mediaFailureText(Object.assign(new Error('x'), { name: 'NotReadableError' }), 'audio')
      : '(mediaFailureText not exposed)';
  });
  console.log(`  call path: ${wiring}`);
  check('the call path reports the cause too, not a fixed sentence',
    /(استفاده|another application)/i.test(wiring), wiring);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((r) => console.log(`  - ${r.name}`));
  process.exit(1);
}
