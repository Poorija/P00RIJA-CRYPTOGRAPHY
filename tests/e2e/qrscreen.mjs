/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Every QR the app puts on a screen, read back off the screen.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/qrscreen.mjs
 *
 * The kit has its own suites and they pass; a code kept failing on a phone
 * anyway, and the reason is the gap this file closes.
 *
 * tests/e2e/qrkit.mjs and tests/e2e/qraudit.mjs call the kit directly and
 * decode `canvas.toDataURL()`. That reads the BITMAP. A camera does not see a
 * bitmap — it sees a rendered page, after the browser has applied every
 * stylesheet, resized the element to fit its container, scaled it for the
 * device's pixel ratio, and painted whatever else the page put on top. A code
 * can be perfect in the buffer and unreadable on the glass, and no amount of
 * decoding the buffer will ever say so.
 *
 * So this drives the app's own buttons — the identity dialog, "bigger and
 * brighter", the pairing card — takes a SCREENSHOT of the region a person
 * would point a camera at, and decodes that. What is asserted is what the
 * screen shows.
 *
 * It runs at a phone's viewport and pixel ratio as well as a desktop's,
 * because both reported failures were invisible on a desktop.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { settle } from './_settle.mjs';

let lastShot = null;

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Screen#Harness2026!';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const DEVICES = [
  {
    name: 'a phone',
    viewport: { width: 576, height: 1280 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  },
  {
    name: 'a small phone',
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
      + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  { name: 'a desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];

const browser = await chromium.launch();

/* Decoding a picture of the screen rather than the buffer behind it.
 *
 * The screenshot comes back as PNG bytes; it goes into the page as a data URL,
 * is drawn to a canvas there, and the app's own decoder reads it — the same
 * BarcodeDetector-then-jsQR path a camera frame goes through, so a pass here
 * means the code survives the reader that ships. */
/* A failed read keeps its picture. Guessing at why a code did not scan, from a
   boolean, sends you looking at the encoder when the answer turns out to be
   that the screenshot was of something else entirely. */
const SHOTS = process.env.PKG_SHOTS
  || fileURLToPath(new URL('./screenshots', import.meta.url));
function keep(name, bytes) {
  try {
    mkdirSync(SHOTS, { recursive: true });
    const file = join(SHOTS, `qrscreen-${name.replace(/[^a-z0-9]+/gi, '-')}.png`);
    writeFileSync(file, bytes);
    return file;
  } catch (error) { return ''; }
}

async function decodeOnScreen(page, locator, label = '') {
  const shot = await locator.screenshot({ type: 'png' });
  if (label) lastShot = { label, bytes: shot };
  return page.evaluate(async (base64) => {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = `data:image/png;base64,${base64}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const text = await window.PoorijaQR.decode(canvas, canvas.width, canvas.height);
    return { text, width: canvas.width, height: canvas.height };
  }, shot.toString('base64'));
}

async function open(device) {
  const { name, ...options } = device;
  const context = await browser.newContext({ ignoreHTTPSErrors: true, ...options });

  /* Measured as an INSTALLED app, because that is what the people reporting
     these bugs are running.
   *
   * A phone browser that has not installed the app opens with "add this to
   * your home screen" over everything at z-index 9999 — deliberately, because
   * registration comes first and the installed copy is the supported way to
   * use it. That gate also covers the setup form, so a harness that fills the
   * form in and presses the button changes nothing at all; the pairing code
   * further down the page was then photographed THROUGH the gate's own
   * instructions and reported as a code that would not scan.
   *
   * Rather than tearing the gate out of the page — which would be testing an
   * app nobody runs — this tells the page what an installed copy tells it:
   * navigator.standalone, and the display-mode media query. The app's own
   * check then decides there is nothing to gate, exactly as it does on a real
   * home-screen launch. */
  await context.addInitScript(() => {
    /* Chosen before the page loads, because the language screen is shown first
       and covers the registration form behind it. Setting it afterwards is too
       late — the form is already unreachable, and its button stays disabled
       because nothing it needs was ever filled in. */
    try { localStorage.setItem('poorija_lang', 'fa'); } catch (error) { /* private mode */ }
    try {
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    } catch (error) { /* already defined; the media query below still answers */ }
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => (/display-mode:\s*standalone/.test(query)
      ? { matches: true, media: query, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
        onchange: null }
      : realMatchMedia(query));
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`   [${name}] ${error.message.slice(0, 120)}`));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await settle(page, () => document.readyState === 'complete'
    && Boolean(document.getElementById('setupPassword') || document.getElementById('chatTab')));

  /* Registration, filled to satisfy what the form actually checks.
   *
   * isSetupFormReady() wants a password scoring 4 out of 4, a matching
   * confirmation, THREE DIFFERENT security questions each with an answer, and
   * the terms ticked — and it keeps the button disabled until all of that
   * holds. Filling the fields approximately and pressing a disabled button
   * changes nothing, which is how this suite spent its time measuring the
   * registration screen instead of the app behind it. */
  await page.evaluate((pass) => {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('setupPassword', pass);
    set('confirmPassword', pass);
    /* Three distinct questions: the check counts a Set of the values. */
    ['secQ1', 'secQ2', 'secQ3'].forEach((id, i) => {
      const select = document.getElementById(id);
      if (!select) return;
      const taken = ['secQ1', 'secQ2', 'secQ3']
        .filter((other) => other !== id)
        .map((other) => document.getElementById(other)?.value);
      const option = Array.from(select.options)
        .find((o) => o.value && !taken.includes(o.value) && o.index >= i + 1)
        || Array.from(select.options).find((o) => o.value && !taken.includes(o.value));
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    ['secA1', 'secA2', 'secA3'].forEach((id, i) => set(id, `answer number ${i + 1}`));
    const terms = document.getElementById('acceptTermsCheckbox');
    if (terms && !terms.checked) {
      terms.checked = true;
      terms.dispatchEvent(new Event('change', { bubbles: true }));
    }
    window.updateSetupButtonState?.();
  }, PASS);
  await page.waitForTimeout(600);

  /* The button says whether the form was accepted. Asserted, because a silent
     no here is what sent every later measurement at the wrong screen. */
  const canRegister = await page.evaluate(() => {
    const button = document.getElementById('setupBtn');
    return { present: Boolean(button), disabled: button ? button.disabled : true };
  });
  if (!canRegister.present || canRegister.disabled) {
    throw new Error(`the registration form was not accepted: ${JSON.stringify(canRegister)}`);
  }

  await page.evaluate(() => document.getElementById('setupBtn').click());
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.switchTab?.('chat'));

  /* Wait for the registration screen to GO, not for something that was in the
     markup all along. `#chatTab` exists before setup has finished, so settling
     on it let this carry on with the setup screen still covering the page: the
     identity dialog worked anyway, because a modal appends to the body above
     everything, while the pairing code was photographed through an overlay. */
  /* Wait for the app to be UP, not for the setup markup to disappear.
     Registration succeeds and leaves #initialSetup sitting there at
     display:block underneath — so "the setup element is gone" is never true,
     and waiting for it timed out on a session that had registered perfectly
     well thirty seconds earlier. What matters is that #mainApp is on screen
     and the gate and the lock are not. */
  const ready = await settle(page, () => {
    const gone = (el) => !el || el.classList.contains('hidden')
      || getComputedStyle(el).display === 'none';
    const main = document.getElementById('mainApp');
    return Boolean(main) && !gone(main)
      && gone(document.getElementById('mobileInstallGate'))
      && gone(document.getElementById('lockScreen'))
      && document.readyState === 'complete';
  }, { hold: 1500 });
  if (!ready) {
    /* What is on screen, not a guess about it. Every wrong turn in this file
       was solved by looking rather than reasoning: the install gate, the
       language screen, the disabled button — each was invisible from a boolean
       and obvious in a picture. */
    const stuck = await page.evaluate(() => {
      const describe = (id) => {
        const el = document.getElementById(id);
        if (!el) return 'absent';
        return `${getComputedStyle(el).display}${el.classList.contains('hidden') ? '/hidden' : ''}`;
      };
      const button = document.getElementById('setupBtn');
      return {
        gate: describe('mobileInstallGate'),
        language: describe('langScreen'),
        setup: describe('initialSetup'),
        lock: describe('lockScreen'),
        main: describe('mainApp'),
        setupBtn: button ? `disabled=${button.disabled}` : 'absent',
      };
    });
    keep('stuck-at-registration', await page.screenshot({ fullPage: false }));
    throw new Error(`the app never came up after registration: ${JSON.stringify(stuck)}`);
  }
  return page;
}

try {
  for (const device of DEVICES) {
    console.log(`\n===== ${device.name}: `
      + `${device.viewport.width}x${device.viewport.height} at ${device.deviceScaleFactor}x =====`);
    const page = await open(device);

    /* ---- the identity card, as the app opens it -------------------------- */

    const opened = await page.evaluate(async () => {
      if (typeof window.showChatIdentityQr !== 'function') return 'no opener';
      await window.showChatIdentityQr();
      await new Promise((resolve) => setTimeout(resolve, 800));
      const box = document.getElementById('chatIdentityQrBox');
      return box && box.querySelector('canvas') ? 'ok' : 'no canvas';
    });
    check(`${device.name}: the identity dialog draws a code`, opened === 'ok', opened);
    if (opened !== 'ok') continue;

    const expected = await page.evaluate(() => (typeof window.identityQrText === 'function'
      ? window.identityQrText() : null));
    check(`${device.name}: and the app can say what that code should contain`,
      typeof expected === 'string' && expected.length > 0,
      expected ? `${expected.length} chars` : String(expected));

    const inline = await decodeOnScreen(page, page.locator('#chatIdentityQrBox canvas'));
    console.log(`  dialog on screen: ${inline.width}x${inline.height}px`);
    const dialogShape = await page.evaluate(() => {
      const canvas = document.querySelector('#chatIdentityQrBox canvas');
      const box = canvas.getBoundingClientRect();
      return {
        bitmapWidth: canvas.width,
        devicePixels: +(box.width * window.devicePixelRatio).toFixed(1),
      };
    });
    check(`${device.name}: the dialog's code is painted without resampling`,
      Math.abs(dialogShape.devicePixels - dialogShape.bitmapWidth) <= 1,
      `${dialogShape.bitmapWidth} bitmap px into ${dialogShape.devicePixels} device px`);
    check(`${device.name}: THE DIALOG'S CODE READS OFF THE SCREEN`,
      inline.text === expected,
      inline.text === expected ? 'exact' : `got ${inline.text ? `${inline.text.length} chars` : 'nothing'}`);

    /* ---- "bigger and brighter", through its own button ------------------- */

    await page.evaluate(() => document.getElementById('chatQrBoostBtn')?.click());
    await page.waitForTimeout(1200);
    const boostThere = await page.evaluate(() => Boolean(document.querySelector('.qr-boost-code canvas')));
    check(`${device.name}: the bright view opens with a code in it`, boostThere);

    if (boostThere) {
      const boost = await decodeOnScreen(page, page.locator('.qr-boost-code canvas'),
        `boost-${device.name}`);
      if (boost.text !== expected && lastShot) {
        const file = keep(lastShot.label, lastShot.bytes);
        if (file) console.log(`  kept the bright code that would not read: ${file}`);
      }
      console.log(`  bright view on screen: ${boost.width}x${boost.height}px`);
      check(`${device.name}: THE BRIGHT VIEW'S CODE READS OFF THE SCREEN`,
        boost.text === expected,
        boost.text === expected ? 'exact' : `got ${boost.text ? `${boost.text.length} chars` : 'nothing'}`);
      check(`${device.name}: and it is the same code as the dialog's`,
        boost.text === inline.text, boost.text === inline.text ? 'identical' : 'DIFFERENT');

      /* What a camera actually frames is the whole bright screen, not a
         rectangle cropped to the code. If the surroundings stop a reader
         locking on — no margin, something painted over a corner — only this
         catches it. */
      const whole = await decodeOnScreen(page, page.locator('.qr-boost'));
      check(`${device.name}: and reads from a photo of the whole screen`,
        whole.text === expected,
        whole.text === expected ? 'exact' : `got ${whole.text ? `${whole.text.length} chars` : 'nothing'}`);

      /* The geometry a reader has to work with, reported either way: it is
         what turns "it did not scan" into a number somebody can act on. */
      const shape = await page.evaluate(() => {
        const canvas = document.querySelector('.qr-boost-code canvas');
        const box = canvas.getBoundingClientRect();
        return {
          cssWidth: +box.width.toFixed(1),
          bitmapWidth: canvas.width,
          dpr: window.devicePixelRatio,
          devicePixels: +(box.width * window.devicePixelRatio).toFixed(1),
          viewport: window.innerWidth,
          overflows: box.width > window.innerWidth || box.height > window.innerHeight,
        };
      });
      console.log(`  bright geometry: ${JSON.stringify(shape)}`);
      check(`${device.name}: the bright code fits the screen it is shown on`,
        !shape.overflows, JSON.stringify(shape));

      /* The assertion that would have caught this from a desktop.
       *
       * A bitmap wider than the device pixels it is painted into is resampled
       * DOWN, and every module edge lands on a fraction of a pixel and blends
       * to grey. A screenshot still decodes it — a screenshot IS the resampled
       * image — so every buffer-reading test passed while a camera pointed at
       * the glass saw soft edges and gave up. Only fractional pixel ratios hit
       * it: 2.75 and 3 on real phones, 1 on the desktops this was written on. */
      check(`${device.name}: one bitmap pixel per screen pixel, nothing resampled`,
        Math.abs(shape.devicePixels - shape.bitmapWidth) <= 1,
        `${shape.bitmapWidth} bitmap px painted into ${shape.devicePixels} device px`);

      await page.evaluate(() => document.querySelector('.qr-boost-close')?.click());
      await page.waitForTimeout(400);
    }

    /* Both dialogs shut before the next code is photographed. Left open, the
       identity modal sat over the pairing card and the screenshot decoded the
       identity code instead — a test reporting the wrong element rather than a
       wrong code. */
    await page.evaluate(() => {
      document.querySelector('.qr-boost')?.remove();
      document.getElementById('chatIdentityQrModal')?.classList.add('hidden');
      document.body.classList.remove('chat-identity-open');
    });
    await page.waitForTimeout(500);

    /* ---- the pairing code, which is the biggest thing anyone scans ------- */

    const pairing = await page.evaluate(async () => {
      if (!window.PoorijaLocalLink?.startAsHost) return 'no link module';
      /* The tab has to be open. A canvas on a hidden pane still exists and
         still holds the right pixels, but nobody can point a camera at it —
         and screenshotting it is a thirty-second wait for an element that will
         never become visible. */
      window.PoorijaApp?.switchTab?.('locallink');
      await new Promise((resolve) => setTimeout(resolve, 600));
      await window.PoorijaLocalLink.startAsHost();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const canvas = document.querySelector('#linkQrStage canvas');
      if (!canvas) return 'no canvas';
      return canvas.getBoundingClientRect().width > 0 ? 'ok' : 'not visible';
    });
    if (pairing === 'ok') {
      const frame = await page.evaluate(() => window.PoorijaLocalLink.state.frames[0] || '');
      /* Into view first. elementFromPoint reads viewport coordinates, and a
         code sitting below the fold has a box whose coordinates land on
         whatever happens to be on screen instead — which reads as "something
         is covering it" when nothing is. */
      await page.evaluate(() => {
        document.querySelector('#linkQrStage canvas')
          ?.scrollIntoView({ block: 'center', behavior: 'instant' });
      });
      await page.waitForTimeout(400);
      const geom = await page.evaluate(() => {
        const canvas = document.querySelector('#linkQrStage canvas');
        const box = canvas.getBoundingClientRect();
        /* A code nothing is painted over. Laid out, sized and decoding
           perfectly in its own buffer means nothing if another panel is
           sitting on top of it — the camera photographs the panel. This asks
           the page what is actually at the middle of the code. */
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          onTop: top === canvas,
          coveredBy: top === canvas ? '' : `${top?.tagName || '?'}#${top?.id || ''}.${(top?.className || '').toString().slice(0, 30)}`,
          frames: window.PoorijaLocalLink.state.frames.length,
          chars: (window.PoorijaLocalLink.state.frames[0] || '').length,
          bitmap: canvas.width,
          css: +box.width.toFixed(1),
          devicePixels: +(box.width * window.devicePixelRatio).toFixed(1),
        };
      });
      console.log(`  pairing geometry: ${JSON.stringify(geom)}`);
      check(`${device.name}: the pairing code is painted without resampling`,
        Math.abs(geom.devicePixels - geom.bitmap) <= 1,
        `${geom.bitmap} bitmap px into ${geom.devicePixels} device px`);
      check(`${device.name}: and nothing is painted over the pairing code`,
        geom.onTop, geom.coveredBy || 'clear');
      /* Buffer and screen, side by side. When they disagree, the answer is in
         how the page paints the code, not in the code — and that distinction
         is the whole reason this file exists. */
      const fromBuffer = await page.evaluate(async () => {
        const canvas = document.querySelector('#linkQrStage canvas');
        return window.PoorijaQR.decode(canvas, canvas.width, canvas.height);
      });
      check(`${device.name}: the pairing code decodes from its own buffer`,
        fromBuffer === frame, fromBuffer === frame ? 'exact' : 'no');
      const shown = await decodeOnScreen(page, page.locator('#linkQrStage canvas'),
        `pairing-${device.name}`);
      console.log(`  pairing on screen: ${shown.width}x${shown.height}px, `
        + `buffer=${fromBuffer === frame ? 'reads' : 'no'}, screen=${shown.text === frame ? 'reads' : 'no'}`);
      if (shown.text !== frame && lastShot) {
        const file = keep(lastShot.label, lastShot.bytes);
        if (file) console.log(`  kept the picture that would not read: ${file}`);
      }
      check(`${device.name}: THE PAIRING CODE READS OFF THE SCREEN`,
        shown.text === frame,
        shown.text === frame ? 'exact' : `got ${shown.text ? `${shown.text.length} chars` : 'nothing'}`);
    } else {
      console.log(`  pairing code: ${pairing} — skipped`);
    }

    await page.context().close();
  }
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
