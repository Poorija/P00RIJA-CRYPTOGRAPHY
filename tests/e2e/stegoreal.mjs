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

   tests/e2e/stego.mjs proves the DCT codec survives a JPEG round trip that the
   test itself performs: RGB to YCbCr, 8x8 DCT, quantise with the standard
   luminance table, back again. That simulation is faithful to what an encoder
   does to the luma plane, and it runs in a second, which is why it is the one
   that gates every commit.

   It is still a simulation. It uses the quantisation table the test believes a
   browser uses, at a quality the test chooses, with no chroma subsampling and
   no rounding differences between implementations. A codec tuned against a
   model of an encoder and never tried against a real one is a codec with an
   unexamined assumption in it — and the claim being made to users is not "it
   survives my model of JPEG", it is "you can send this as a photo".

   So this file does it for real: canvas.toBlob('image/jpeg', q) in Chromium,
   decoded back through the same browser, extracted, compared. Slower, needs a
   browser, and the only thing that actually answers the question.            */

import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const URL_BASE = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.log('  PAGEERROR ' + e.message.slice(0, 140)));

/* app.js registers a service worker and reloads the page once when the cache
   name changes. Evaluating during that window dies with "Execution context was
   destroyed", so settle first: wait for the document to finish, give the
   reload its chance, then confirm the module is there in whatever context
   ended up winning. */
await page.goto(`${URL_BASE}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);
await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30000 });
await page.waitForFunction(() => typeof window.PoorijaStego?.hide === 'function',
  null, { timeout: 30000 });

/* Everything below runs in the page, because the encoder under test is the
   browser's. */
const helpers = () => {
  window.__stegoReal = {
    /* A picture with real structure: gradients, edges and a noisy patch. A
       smooth field is the easy case and would flatter the result. */
    makeImage(width, height) {
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#2b4a6f'); g.addColorStop(0.5, '#8fb3c7'); g.addColorStop(1, '#3d2f22');
      ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(240,220,180,0.85)';
      for (let i = 0; i < 14; i++) {
        ctx.fillRect((i * 53) % width, (i * 91) % height, 40 + (i % 5) * 12, 26 + (i % 3) * 18);
      }
      const noisy = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < noisy.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 26;
        noisy.data[i] += n; noisy.data[i + 1] += n; noisy.data[i + 2] += n;
      }
      ctx.putImageData(noisy, 0, 0);
      return ctx.getImageData(0, 0, width, height);
    },

    /* The real thing: encode with the browser's JPEG encoder, decode with the
       browser's JPEG decoder, hand back pixels. */
    async throughJpeg(imageData, quality) {
      const c = document.createElement('canvas');
      c.width = imageData.width; c.height = imageData.height;
      /* js/stego.js works on a plain {width,height,data} object, which is what
         its callers pass and what it returns. putImageData wants a real
         ImageData, so rebuild one here rather than making the module depend on
         a DOM type it does not need. */
      const real = new ImageData(
        new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
      c.getContext('2d').putImageData(real, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
      const bitmap = await createImageBitmap(blob);
      const out = document.createElement('canvas');
      out.width = bitmap.width; out.height = bitmap.height;
      const octx = out.getContext('2d');
      octx.drawImage(bitmap, 0, 0);
      return { pixels: octx.getImageData(0, 0, out.width, out.height), bytes: blob.size };
    },

    same(a, b) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }
  };
};
await page.evaluate(helpers);

/* ===== the round trip, at the qualities a messenger actually uses ======== */

console.log('\n===== DCT through the browser\'s own JPEG encoder =====');

const sweep = await page.evaluate(async () => {
  const S = window.PoorijaStego;
  const H = window.__stegoReal;
  const img = H.makeImage(512, 512);
  const payload = crypto.getRandomValues(new Uint8Array(64));

  const hidden = S.hide({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) },
    payload, { algo: S.ALGO_DCT });
  if (!hidden.ok) return { error: hidden.reason || 'hide failed' };

  const rows = [];
  for (const q of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5]) {
    const { pixels, bytes } = await H.throughJpeg(hidden.imageData, q);
    const verdict = S.extract(pixels, { algo: S.ALGO_DCT });
    rows.push({
      q,
      status: verdict.status,
      exact: verdict.status === 'ok' && H.same(verdict.payload, payload),
      kb: Math.round(bytes / 1024)
    });
  }
  return { rows, payloadLength: payload.length };
});

if (sweep.error) {
  check('the DCT codec hides at all', false, sweep.error);
} else {
  sweep.rows.forEach((r) => console.log(
    `    q=${r.q.toFixed(2)}  ${r.exact ? 'recovered' : r.status.padEnd(9)}  (${r.kb} KB)`));

  const downTo = (q) => sweep.rows.filter((r) => r.q >= q).every((r) => r.exact);

  /* Telegram, WhatsApp and the Iranian messengers re-encode photographs
     somewhere in the 0.70–0.87 band. That is the range the claim rests on. */
  check('it survives the band messengers actually re-encode in (0.75–0.95)',
    downTo(0.75), sweep.rows.filter((r) => r.q >= 0.75 && !r.exact).map((r) => r.q).join(', '));

  check('and keeps going below it, down to 0.70',
    downTo(0.70), sweep.rows.filter((r) => r.q >= 0.70 && !r.exact).map((r) => r.q).join(', '));

  /* Where it stops is worth recording rather than hiding. A limit that is
     known is a limit that can be told to the user. */
  const lowest = sweep.rows.filter((r) => r.exact).map((r) => r.q).sort((a, b) => a - b)[0];
  console.log(`    lowest quality that still recovered: ${lowest ?? 'none'}`);
  check('the failure, when it comes, is reported and not silent',
    sweep.rows.filter((r) => !r.exact).every((r) => r.status !== 'ok'),
    sweep.rows.filter((r) => !r.exact).map((r) => `${r.q}:${r.status}`).join(' '));
}

/* ===== the honest comparison: LSB in the same encoder ==================== */

console.log('\n===== LSB through the same encoder =====');
const lsb = await page.evaluate(async () => {
  const S = window.PoorijaStego;
  const H = window.__stegoReal;
  const img = H.makeImage(512, 512);
  const payload = crypto.getRandomValues(new Uint8Array(64));
  const hidden = S.hide({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) },
    payload, { algo: S.ALGO_LSB });
  const rows = [];
  for (const q of [0.95, 0.9, 0.8]) {
    const { pixels } = await H.throughJpeg(hidden.imageData, q);
    const verdict = S.extract(pixels, { algo: S.ALGO_LSB });
    rows.push({ q, exact: verdict.status === 'ok' && H.same(verdict.payload, payload) });
  }
  /* And the case LSB is actually for: a file that arrives unmodified. */
  const intact = S.extract(hidden.imageData, { algo: S.ALGO_LSB });
  return { rows, intact: intact.status === 'ok' && H.same(intact.payload, payload) };
});

lsb.rows.forEach((r) => console.log(`    q=${r.q}  ${r.exact ? 'recovered' : 'lost'}`));
check('LSB is destroyed by a real JPEG encode, at every quality',
  lsb.rows.every((r) => !r.exact),
  lsb.rows.filter((r) => r.exact).map((r) => r.q).join(', '));
check('but LSB is perfect when the file arrives untouched, which is its job',
  lsb.intact === true);

/* ===== what a user is told when it does not work ======================== */

console.log('\n===== the diagnosis a user would see =====');
const diagnosis = await page.evaluate(async () => {
  const S = window.PoorijaStego;
  const H = window.__stegoReal;
  const img = H.makeImage(256, 256);
  const payload = crypto.getRandomValues(new Uint8Array(48));
  const hidden = S.hide({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) },
    payload, { algo: S.ALGO_LSB });
  const { pixels } = await H.throughJpeg(hidden.imageData, 0.85);
  const verdict = S.extract(pixels);
  const fa = S.explain(verdict, 'image/jpeg', 'fa');
  const en = S.explain(verdict, 'image/jpeg', 'en');
  return { status: verdict.status, faTitle: fa.title, enDetail: en.detail, tone: en.tone };
});
console.log('    ' + JSON.stringify(diagnosis).slice(0, 220));
check('a wrecked LSB image is not reported as "no message"',
  /re-compress|photo/i.test(diagnosis.enDetail),
  diagnosis.enDetail.slice(0, 90));
check('and the Persian wording says the same thing',
  /[؀-ۿ]/.test(diagnosis.faTitle), diagnosis.faTitle);

/* ===== the picture is still worth looking at ============================ */

console.log('\n===== visible cost =====');
const quality = await page.evaluate(() => {
  const S = window.PoorijaStego;
  const H = window.__stegoReal;
  const img = H.makeImage(320, 320);
  const payload = crypto.getRandomValues(new Uint8Array(64));
  const hidden = S.hide({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) },
    payload, { algo: S.ALGO_DCT });
  let sum = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = img.data[i + c] - hidden.imageData.data[i + c];
      sum += d * d;
    }
  }
  const rmse = Math.sqrt(sum / (img.width * img.height * 3));
  return { psnr: 20 * Math.log10(255 / rmse), rmse };
});
console.log(`    PSNR ${quality.psnr.toFixed(1)} dB, RMSE ${quality.rmse.toFixed(2)}`);
check('the change to the picture stays invisible (PSNR above 38 dB)',
  quality.psnr > 38, `${quality.psnr.toFixed(1)} dB`);

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
