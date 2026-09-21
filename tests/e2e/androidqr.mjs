/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The QR code as a phone sees it.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/androidqr.mjs
 *
 * Two bugs were reported from an Android handset and neither could be seen on a
 * desktop, because both came from the encoder's own Android-era DOM handling:
 * it draws a <canvas>, then LATER sets an <img> to that canvas's data URL,
 * shows the image and hides the canvas.
 *
 *   THE CODE SAT WRONG IN ITS CARD. This app's stylesheet said
 *   `.qr-plate img, .qr-plate canvas { display: block }`, which overrode the
 *   display:none the encoder had just set — so both elements stayed in the
 *   plate, one of them empty, and the white card looked crooked.
 *
 *   "BIGGER AND BRIGHTER" SHOWED A CODE THAT WOULD NOT CONNECT. The image's
 *   src is set from a callback. Render the next code before that callback
 *   lands and the visible image still carries the PREVIOUS code's pixels: it
 *   scans perfectly and means nothing.
 *
 * The kit now reads the matrix out and draws it itself — one element, nothing
 * asynchronous, the quiet zone inside the bitmap. This asserts that from a
 * viewport, pixel ratio and user agent that match the phone it was reported
 * from, because the whole point is that a desktop could not see it.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
const BASE = process.env.PKG_URL || 'http://localhost:8123';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 576, height: 1280 },
  deviceScaleFactor: 2.75,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
});
const page = await ctx.newPage();
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await settle(page, () => typeof window.PoorijaQR?.render === 'function');

const out = await page.evaluate(async () => {
  const kit = window.PoorijaQR;
  const text = 'poorija-chat-v3:' + 'A'.repeat(400);
  const box = document.createElement('div');
  box.style.cssText = 'width:320px';
  document.body.appendChild(box);
  const inline = kit.render(box, text, { px: 280 });
  await new Promise((r) => setTimeout(r, 1500));   // long enough for any async swap
  const plate = box.querySelector('.qr-plate').getBoundingClientRect();
  const cv = inline.canvas.getBoundingClientRect();
  const inlineRead = await kit.decode(inline.canvas, inline.canvas.width, inline.canvas.height);

  const shown = await kit.present(text, { title: 'x', note: 'y' });
  await new Promise((r) => setTimeout(r, 1500));
  const big = document.querySelector('.qr-boost-code canvas');
  const bigRead = big ? await kit.decode(big, big.width, big.height) : null;
  const bigBox = big ? big.getBoundingClientRect() : null;
  shown.close();
  box.remove();
  return {
    dpr: window.devicePixelRatio,
    elements: { canvases: 1, extra: document.querySelectorAll('.qr-plate img').length },
    centred: {
      left: Math.round(cv.left - plate.left),
      right: Math.round(plate.right - cv.right),
      top: Math.round(cv.top - plate.top),
      bottom: Math.round(plate.bottom - cv.bottom),
    },
    fitsInside: cv.width <= plate.width + 1 && cv.height <= plate.height + 1,
    inlineRead: inlineRead === text,
    bigRead: bigRead === text,
    identical: inlineRead === bigRead,
    bigFitsScreen: bigBox ? (bigBox.width <= 576 && bigBox.height <= 1280) : false,
  };
});
await browser.close();

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

console.log(`\n===== a 2.75x phone screen, 576 CSS pixels wide =====`);
console.log(`  ${JSON.stringify(out)}`);

check('the encoder leaves no second element behind',
  out.elements.extra === 0, `${out.elements.extra} stray image(s)`);
check('the code sits square in its card',
  Math.abs(out.centred.left - out.centred.right) <= 1
  && Math.abs(out.centred.top - out.centred.bottom) <= 1, JSON.stringify(out.centred));
check('and inside it, rather than over the edge', out.fitsInside, String(out.fitsInside));
check('the code in the dialog reads back as what it was given', out.inlineRead);
check('so does the one in the bright view', out.bigRead);
check('and they are the SAME code, not two', out.identical, String(out.identical));
check('the bright view fits the screen it is shown on', out.bigFitsScreen);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((r) => console.log(`  - ${r.name}`));
  process.exit(1);
}
