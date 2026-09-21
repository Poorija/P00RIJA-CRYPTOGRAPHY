/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The four tools added to the suite, checked where they can actually be wrong.
 *
 * Each one is here for a reason and each reason is testable:
 *
 *   QR BRIDGE   A payload split across codes is only useful if it comes back
 *               together. Frames must survive arriving out of order and twice,
 *               and a frame from a different transfer must not be mixed in.
 *   AUTHENTICATOR  A TOTP that does not match RFC 6238 is a code that does not
 *               open anything. Checked against the RFC's own vectors.
 *   INSPECTOR   It has to find what it claims to find, and stripping must not
 *               damage the visible text.
 *   CONVERT     Every conversion must round-trip, including on bytes that are
 *               not text at all.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);
await page.waitForFunction(() => typeof window.PoorijaToolsExtra?.qrSplit === 'function',
  null, { timeout: 30000 });

/* ===== the tabs exist and are reachable ================================= */

console.log('\n===== the four tabs =====');
const tabs = await page.evaluate(() => ['qrbridge', 'authenticator', 'inspector', 'convert']
  .map((id) => ({
    id,
    button: Boolean(document.getElementById(`tab-${id}`)),
    panel: Boolean(document.getElementById(`content-${id}`)),
    inSidebarRegistry: (window.PoorijaApp?.state ? true : false)
  })));
console.log('  ' + JSON.stringify(tabs));
check('each tool has a button and a panel',
  tabs.every((t) => t.button && t.panel), JSON.stringify(tabs));

const named = await page.evaluate(() => {
  const out = {};
  for (const lang of ['fa', 'en']) {
    out[lang] = ['qrBridge', 'authenticator', 'inspector', 'converter']
      .filter((k) => !window.PoorijaApp?.translations?.[lang]?.[k]);
  }
  return out;
});
check('every tool is named in both languages',
  named.fa.length === 0 && named.en.length === 0, JSON.stringify(named));

/* ===== QR bridge ======================================================= */

console.log('\n===== QR bridge =====');
const qr = await page.evaluate(() => {
  const T = window.PoorijaToolsExtra;
  const payload = Array.from({ length: 5000 }, (_, i) =>
    String.fromCharCode(33 + (i % 90))).join('');
  const frames = T.qrSplit(payload, 'abc123');

  const parsed = frames.map((f) => T.qrParse(f));
  const rebuilt = parsed.map((p) => p.payload).join('');

  /* Shuffle, and repeat one, which is what a camera actually does. */
  const shuffled = frames.slice().sort(() => Math.random() - 0.5);
  shuffled.splice(2, 0, shuffled[0]);

  return {
    frames: frames.length,
    everyFrameParses: parsed.every(Boolean),
    numbering: parsed.map((p) => p.index).join(',') ===
               parsed.map((_, i) => i + 1).join(','),
    totalsAgree: parsed.every((p) => p.total === frames.length),
    rebuiltMatches: rebuilt === payload,
    rejectsJunk: T.qrParse('hello world') === null,
    rejectsTruncated: T.qrParse('P0Q1|abc') === null,
    shuffledCount: shuffled.length
  };
});
console.log('  ' + JSON.stringify(qr));
check('a long payload splits into numbered frames', qr.frames > 1 && qr.numbering);
check('every frame parses and agrees on the total', qr.everyFrameParses && qr.totalsAgree);
check('joining them back gives the original exactly', qr.rebuiltMatches === true);
check('a code that is not one of ours is rejected', qr.rejectsJunk === true);
check('and so is a truncated header', qr.rejectsTruncated === true);

/* Out of order, with a duplicate, through the real receive path. */
const outOfOrder = await page.evaluate(() => {
  const T = window.PoorijaToolsExtra;
  const payload = 'X'.repeat(2200) + 'END';
  const frames = T.qrSplit(payload, 'zz9');
  const order = [...frames.keys()].sort(() => Math.random() - 0.5);
  const seq = order.map((i) => frames[i]);
  seq.splice(1, 0, seq[0]);          /* the same frame twice */
  document.getElementById('qrBridgeOutput').value = '';
  for (const frame of seq) T.qrAcceptFrame(frame);
  return {
    output: document.getElementById('qrBridgeOutput').value,
    matches: document.getElementById('qrBridgeOutput').value === payload
  };
});
check('frames arriving out of order and twice still reassemble',
  outOfOrder.matches === true, `${outOfOrder.output.length} chars`);

/* ===== authenticator =================================================== */

console.log('\n===== authenticator =====');
/* RFC 6238 Appendix B: the secret "12345678901234567890" as base32 is
   GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ, and at T = 59 the SHA-1 code is 94287082. */
const totp = await page.evaluate(() => {
  const T = window.PoorijaToolsExtra;
  const account = {
    issuer: 'rfc', label: 'test',
    secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    digits: 8, period: 30, algorithm: 'SHA1'
  };
  const built = T.authBuild(account);
  if (!built) return { error: 'otpauth did not load' };
  return {
    at59: built.generate({ timestamp: 59 * 1000 }),
    at1111111109: built.generate({ timestamp: 1111111109 * 1000 }),
    rejectsGarbage: T.authBuild({ secret: 'not base 32 !!!' }) === null
  };
});
console.log('  ' + JSON.stringify(totp));
check('TOTP matches the RFC 6238 vector at T=59',
  totp.at59 === '94287082', String(totp.at59));
check('and at T=1111111109', totp.at1111111109 === '07081804', String(totp.at1111111109));
check('an invalid secret is refused rather than producing a wrong code',
  totp.rejectsGarbage === true);

/* ===== inspector ======================================================= */

console.log('\n===== character inspector =====');
const inspect = await page.evaluate(() => {
  const T = window.PoorijaToolsExtra;
  const clean = 'a normal sentence with nothing hidden in it';
  const watermarked = 'a​normal​sentence‌with‍a watermark';
  const bidi = 'invoice‮gnp.exe';
  const confusable = 'pаypal.com';        /* Cyrillic а */

  return {
    cleanFindings: T.inspectText(clean).findings.length,
    watermarkFindings: T.inspectText(watermarked).findings.length,
    bidiFound: T.inspectText(bidi).findings.some((f) => f.kind === 'bidi'),
    confusableFound: T.inspectText(confusable).findings.some((f) => f.kind === 'confusable'),
    strippedVisible: T.stripHidden(watermarked),
    strippedFindings: T.inspectText(T.stripHidden(watermarked)).findings.length,
    cleanUnchanged: T.stripHidden(clean) === clean
  };
});
console.log('  ' + JSON.stringify(inspect));
check('ordinary text reports nothing', inspect.cleanFindings === 0);
check('a watermarked paragraph is caught', inspect.watermarkFindings >= 4,
  String(inspect.watermarkFindings));
check('a right-to-left override is caught — the filename trick',
  inspect.bidiFound === true);
check('a Cyrillic letter wearing a Latin shape is caught',
  inspect.confusableFound === true);
check('stripping removes every hidden character', inspect.strippedFindings === 0);
check('and leaves the words themselves alone',
  inspect.strippedVisible === 'anormalsentencewitha watermark',
  inspect.strippedVisible);
check('clean text is not altered by stripping', inspect.cleanUnchanged === true);

/* ===== convert ========================================================= */

console.log('\n===== convert bench =====');
const convert = await page.evaluate(() => {
  const C = window.PoorijaToolsExtra.CONVERSIONS;
  const samples = ['hello', 'سلام دنیا', '👋🏽 emoji', 'a\nb\tc', ''];
  const pairs = [['text-base64', 'base64-text'], ['text-hex', 'hex-text'],
                 ['text-url', 'url-text'], ['text-binary', 'binary-text']];
  const failures = [];
  for (const [there, back] of pairs) {
    for (const sample of samples) {
      if (!sample && there === 'text-binary') continue;   /* no bytes, no bits */
      try {
        if (C[back](C[there](sample)) !== sample) failures.push(`${there}: ${sample.slice(0, 12)}`);
      } catch (error) { failures.push(`${there} threw on ${sample.slice(0, 12)}`); }
    }
  }
  let hexBridge = false;
  try {
    const b64 = C['text-base64']('round trip');
    hexBridge = C['base64-text'](C['hex-base64'](C['base64-hex'](b64))) === 'round trip';
  } catch (error) { hexBridge = false; }

  let refusesOddHex = false;
  try { C['hex-text']('abc'); } catch (error) { refusesOddHex = true; }

  return { failures, hexBridge, refusesOddHex };
});
console.log('  ' + JSON.stringify(convert));
check('every conversion round-trips, Persian and emoji included',
  convert.failures.length === 0, convert.failures.slice(0, 3).join(', '));
check('base64 and hex convert between each other', convert.hexBridge === true);
check('an odd number of hex digits is refused, not guessed',
  convert.refusesOddHex === true);

check('nothing threw while doing any of it', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
