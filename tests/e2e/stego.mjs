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

   The claim under test is a robustness claim, so it is tested by actually
   damaging the image rather than by asserting that the code was written.

   The damage is a JPEG round trip, simulated here rather than performed by a
   real encoder: RGB to YCbCr, 8x8 DCT, quantise with the standard luminance
   table scaled to a quality factor, dequantise, inverse transform, back to
   RGB. That is precisely what a JPEG encoder does to the luma plane; what it
   leaves out — chroma subsampling, Huffman coding — is either lossless or does
   not touch the plane being used. Running it in node means the whole quality
   sweep takes a second and reruns on every commit.

   A real encoder round trip through canvas.toBlob('image/jpeg') runs in the
   browser suite. This file is the one that has to stay honest about where the
   robustness ends, so it also asserts that LSB *fails* at the same qualities.
   Two codecs both described as robust, when only one is, would be a worse lie
   than the silent truncation this work replaced.                              */

import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const S = require('../../js/stego.js');

const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

/* ---- a picture to hide things in ---------------------------------------- */

/* Smooth gradients plus a little structure. A flat colour field would be the
   easy case for both codecs and would flatter the results. */
function makeImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 90 + 100 * Math.sin(x / 23) * Math.cos(y / 31);
      data[i + 1] = 120 + 80 * Math.sin((x + y) / 17);
      data[i + 2] = 140 + 70 * Math.cos(x / 13) * Math.sin(y / 29);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const clone = (img) => ({
  width: img.width, height: img.height, data: new Uint8ClampedArray(img.data)
});

/* ---- the JPEG round trip ------------------------------------------------- */

const JPEG_LUMA_Q50 = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99
];

function qualityTable(quality) {
  const q = Math.max(1, Math.min(100, Math.round(quality * 100)));
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  return JPEG_LUMA_Q50.map((v) => {
    const s = Math.floor((scale * v + 50) / 100);
    return Math.max(1, Math.min(255, s));
  });
}

/* Quantise and dequantise the luma plane exactly as JPEG would. */
function jpegRoundTrip(img, quality) {
  const out = clone(img);
  const table = qualityTable(quality);
  const { toYCbCr, fromYCbCr, dct8x8, idct8x8 } = S.__internals;
  const planes = toYCbCr(out);
  const { width, height } = out;
  const bx = Math.floor(width / 8), by = Math.floor(height / 8);
  const block = new Float64Array(64), coef = new Float64Array(64);

  for (let b = 0; b < bx * by; b++) {
    const ox = (b % bx) * 8, oy = Math.floor(b / bx) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) block[y * 8 + x] = planes.Y[(oy + y) * width + ox + x] - 128;
    }
    dct8x8(block, coef);
    for (let i = 0; i < 64; i++) coef[i] = Math.round(coef[i] / table[i]) * table[i];
    idct8x8(coef, block);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const v = block[y * 8 + x] + 128;
        planes.Y[(oy + y) * width + ox + x] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return fromYCbCr(planes, out);
}

/* ---- the container ------------------------------------------------------- */

console.log('\n===== the container =====');
{
  const payload = new Uint8Array([1, 2, 3, 0, 0, 0, 250, 251]);
  const c = S.buildContainer(payload, S.ALGO_LSB, false);
  const parsed = S.parseContainer(c);
  check('a payload full of zero bytes survives the container',
    parsed.status === 'ok' && parsed.payload.length === 8,
    `${parsed.status} ${parsed.payload?.length}`);

  /* The bug this replaced: a zero byte was the terminator, so ciphertext —
     which contains one roughly every 256 bytes — truncated silently. */
  check('and its zero bytes come back as data, not as an ending',
    parsed.payload && parsed.payload[3] === 0 && parsed.payload[6] === 250);

  check('an unrelated buffer reads as absent, not as an empty message',
    S.parseContainer(new Uint8Array(64)).status === 'absent');
  check('a buffer shorter than the header reads as absent',
    S.parseContainer(new Uint8Array([1, 2, 3])).status === 'absent');

  const corrupt = c.slice();
  corrupt[HEADER_OFFSET_PAYLOAD()] ^= 0xff;
  check('a flipped payload byte reads as damaged, not as absent',
    S.parseContainer(corrupt).status === 'damaged');

  const truncated = c.slice(0, c.length - 3);
  check('a cut-short container says so', S.parseContainer(truncated).status === 'truncated');
}
function HEADER_OFFSET_PAYLOAD() { return S.HEADER_BYTES; }

/* ---- LSB ---------------------------------------------------------------- */

console.log('\n===== LSB: perfect when the file arrives intact =====');
{
  const img = makeImage(256, 256);
  const payload = new Uint8Array(600);
  webcrypto.getRandomValues(payload);

  const hidden = S.hide(clone(img), payload, { algo: S.ALGO_LSB });
  check('it hides', hidden.ok === true, hidden.reason || '');

  const verdict = S.extract(hidden.imageData);
  check('and comes back byte for byte',
    verdict.status === 'ok' &&
    Buffer.from(verdict.payload).equals(Buffer.from(payload)),
    verdict.status);

  const clean = S.extract(img);
  check('an untouched image reports absent', clean.status === 'absent', clean.status);

  const tooBig = S.hide(clone(makeImage(32, 32)), new Uint8Array(9000), { algo: S.ALGO_LSB });
  check('an oversized payload is refused rather than truncated',
    tooBig.ok === false && tooBig.reason === 'CAPACITY',
    `${tooBig.reason} capacity=${tooBig.capacity}`);
}

/* ---- DCT ---------------------------------------------------------------- */

console.log('\n===== DCT: the point of the exercise =====');
{
  const img = makeImage(320, 320);
  const payload = new Uint8Array(96);
  webcrypto.getRandomValues(payload);

  const hidden = S.hide(clone(img), payload, { algo: S.ALGO_DCT });
  check('it hides', hidden.ok === true, hidden.reason || JSON.stringify(hidden.verdict || {}));

  if (hidden.ok) {
    const verdict = S.extract(hidden.imageData, { algo: S.ALGO_DCT });
    check('and comes back with no damage at all',
      verdict.status === 'ok' &&
      Buffer.from(verdict.payload).equals(Buffer.from(payload)),
      verdict.status);

    /* How far the image moved. A hiding place nobody would notice is the
       requirement; a number is the only honest way to state it. */
    let sum = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const d = img.data[i + c] - hidden.imageData.data[i + c];
        sum += d * d;
      }
    }
    const rmse = Math.sqrt(sum / (img.width * img.height * 3));
    const psnr = 20 * Math.log10(255 / rmse);
    /* 40 dB is the threshold below which JPEG artefacts become describable.
       The first parameter choice landed at 29 dB and passed every robustness
       check, which is exactly why a quality floor belongs in the suite: the
       codec was working and the picture was visibly worse for no gain.

       The floor asserted is 39.5, not 40. The payload above is random, so the
       measurement lands between 40.0 and 40.3 dB from run to run, and a
       threshold of exactly 40 fails roughly one run in five — it did, once, in
       a full sweep. A test that flips on noise teaches you to disregard it,
       which costs more than the tenth of a decibel it was defending. Half a
       decibel of margin still catches the failure this exists for: the 29 dB
       version would miss it by ten. */
    check('the picture is barely changed (PSNR above 39.5 dB)', psnr > 39.5,
      `PSNR ${psnr.toFixed(1)} dB, RMSE ${rmse.toFixed(2)}`);
  }
}

console.log('\n===== surviving the messenger =====');
{
  const img = makeImage(384, 384);
  const payload = new Uint8Array(64);
  webcrypto.getRandomValues(payload);

  const dctHidden = S.hide(clone(img), payload, { algo: S.ALGO_DCT });
  const lsbHidden = S.hide(clone(img), payload, { algo: S.ALGO_LSB });

  const qualities = [0.95, 0.9, 0.85, 0.8, 0.75, 0.65, 0.55];
  const dctSurvived = [];
  const lsbSurvived = [];

  for (const q of qualities) {
    const dctAfter = S.extract(jpegRoundTrip(dctHidden.imageData, q), { algo: S.ALGO_DCT });
    const ok = dctAfter.status === 'ok' &&
      Buffer.from(dctAfter.payload).equals(Buffer.from(payload));
    dctSurvived.push(ok);
    console.log(`    q=${q}  DCT: ${ok ? 'recovered' : dctAfter.status}`);

    const lsbAfter = S.extract(jpegRoundTrip(lsbHidden.imageData, q), { algo: S.ALGO_LSB });
    lsbSurvived.push(lsbAfter.status === 'ok');
  }

  check('DCT survives JPEG re-encoding at every quality down to 0.55',
    dctSurvived.every(Boolean),
    qualities.map((q, i) => `${q}:${dctSurvived[i] ? 'ok' : 'lost'}`).join(' '));

  /* Stated as a failure on purpose. LSB is offered as the high-capacity,
     send-as-a-file option; if this ever started passing, the two modes would
     be the same thing and the UI would be telling the user a distinction that
     did not exist. */
  check('LSB does NOT survive it — which is why the second codec exists',
    lsbSurvived.every((ok) => !ok),
    qualities.map((q, i) => `${q}:${lsbSurvived[i] ? 'ok' : 'lost'}`).join(' '));
}

/* ---- the diagnosis ------------------------------------------------------- */

console.log('\n===== telling the user what went wrong =====');
{
  const img = makeImage(256, 256);
  const payload = new Uint8Array(200);
  webcrypto.getRandomValues(payload);
  const lsbHidden = S.hide(clone(img), payload, { algo: S.ALGO_LSB });
  const wrecked = jpegRoundTrip(lsbHidden.imageData, 0.85);

  const verdict = S.extract(wrecked);
  const asJpeg = S.explain(verdict, 'image/jpeg', 'en');
  const asPng = S.explain(verdict, 'image/png', 'en');

  check('a wrecked LSB image plus a JPEG source names re-compression',
    /re-compress/i.test(asJpeg.detail) && /as a file/i.test(asJpeg.detail),
    asJpeg.title);
  check('the same verdict on a PNG says something different',
    asJpeg.detail !== asPng.detail, asPng.title);

  const good = S.extract(S.hide(clone(img), payload, { algo: S.ALGO_LSB }).imageData);
  check('a recovered message is reported as success',
    S.explain(good, 'image/png', 'en').tone === 'success');

  check('every verdict has a Persian rendering too',
    ['ok', 'damaged', 'truncated', 'version', 'absent'].every((status) => {
      const e = S.explain({ status, payload: new Uint8Array(1), expected: 5, version: 9 }, 'image/jpeg', 'fa');
      return e.title && e.detail && /[؀-ۿ]/.test(e.title);
    }));
}

/* ---- verify-after-hide --------------------------------------------------- */

console.log('\n===== refusing to hand over a broken image =====');
{
  /* An image with too little room for the repetition coding must fail at hide
     time, not produce a file that silently contains nothing. */
  const tiny = makeImage(64, 64);
  const result = S.hide(clone(tiny), new Uint8Array(400), { algo: S.ALGO_DCT });
  check('an impossible DCT hide is refused up front',
    result.ok === false && result.reason === 'CAPACITY',
    `${result.reason} capacity=${result.capacity}`);

  const fits = S.hide(clone(makeImage(256, 256)), new Uint8Array(24), { algo: S.ALGO_DCT });
  check('a hide that succeeds has already been read back once',
    fits.ok === true, fits.reason || '');
}

console.log('\n===== capacity =====');
{
  const lsb = S.capacityBytes(1000, 1000, S.ALGO_LSB);
  const dct = S.capacityBytes(1000, 1000, S.ALGO_DCT);
  check('a 1000x1000 image holds hundreds of kilobytes by LSB',
    lsb > 300000, `${lsb} bytes`);
  check('and a few kilobytes by DCT — the price of surviving',
    dct > 1500 && dct < lsb / 10, `${dct} bytes`);
}

const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
