/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* QR codes for text that is not English.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/qrtext.mjs
 *
 * The QR bridge could not encode Persian at all. Two separate defects, and the
 * second one hid the first:
 *
 *   THE SPLITTER COUNTED CHARACTERS. QR capacity is bytes. Persian is two
 *   bytes a letter, so a frame sized to 700 "characters" was a 1400-byte
 *   payload.
 *
 *   THE ENCODER MISCOUNTED ITS OWN OUTPUT. vendor/qrcodejs reused one scratch
 *   array across the character loop without ever shortening it, so after the
 *   first two-byte character every ASCII character was written as two bytes.
 *   The function that PICKS the QR version measures with encodeURI, which is
 *   correct — so picker and encoder disagreed by the number of spaces in the
 *   sentence, and the code died with "code length overflow" on a payload the
 *   picker had just declared small enough.
 *
 * That second one is why the failure looked random and why sizing the frames
 * by trial produced nonsense: 891 bytes passed while 500 failed, because the
 * two payloads had different amounts of punctuation in them. Any test that
 * only asserts "a Persian message encodes" would pass again the day someone
 * re-vendors the library from upstream and quietly reintroduces it. So the
 * agreement between picker and encoder is asserted directly, on the shape that
 * triggers it: non-ASCII with ASCII behind it.
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
  await settle(page, () => typeof window.QRCode === 'function'
    && Boolean(window.PoorijaToolsExtra?.qrSplit)
    && Boolean(window.PoorijaQR?.decode));

  /* ===== the encoder agrees with the version picker ===================== */

  console.log('\n===== what the encoder writes is what the picker reserved =====');

  const agreement = await page.evaluate(() => {
    /* `s()` from qrcode.min.js, copied verbatim: the length the library uses
       to choose a version. It is encodeURI-based and therefore correct. */
    const reserved = (text) => {
      const escaped = encodeURI(text).toString().replace(/%[0-9a-fA-F]{2}/g, 'a');
      return escaped.length + (escaped.length !== text ? 3 : 0);
    };
    /* What the encoder actually emits, read off the model rather than
       inferred from whether it threw. */
    const written = (text) => {
      const box = document.createElement('div');
      const code = new window.QRCode(box, { text, width: 64, height: 64,
        correctLevel: window.QRCode.CorrectLevel.L });
      return code._oQRCode.dataList[0].parsedData.length;
    };
    const cases = {
      /* One Persian word then nothing but ASCII — the maximum inflation the
         stale-buffer bug could produce, and a no-op when it is fixed. */
      worst: 'س' + 'a'.repeat(200),
      /* The realistic shape: a Persian sentence, spaces and all. */
      sentence: 'سلام، این یک متن آزمایشی فارسی است که برای بررسی تولید کد QR نوشته شده.',
      /* Pure ASCII never tripped the bug, which is why it went unseen. */
      ascii: 'a'.repeat(200),
      /* An emoji is one code point over two UTF-16 units; the encoder used to
         write it as two 3-byte surrogates where encodeURI counts 4. */
      emoji: 'پیام 😀 با ایموجی 🔐 و متن فارسی.',
    };
    const out = {};
    for (const [name, text] of Object.entries(cases)) {
      out[name] = { reserved: reserved(text), written: written(text) };
    }
    return out;
  });
  console.log(`  ${JSON.stringify(agreement)}`);
  for (const [name, { reserved, written }] of Object.entries(agreement)) {
    check(`the encoder writes no more than the picker reserved (${name})`,
      written <= reserved, `wrote ${written}, reserved ${reserved}`);
  }

  /* ===== frames encode, and rejoin byte-exact =========================== */

  console.log('\n===== every frame of a long message encodes =====');

  const split = await page.evaluate(() => {
    const T = window.PoorijaToolsExtra;
    const box = document.createElement('div');
    document.body.appendChild(box);
    const encoder = new TextEncoder();
    const samples = {
      persian: 'سلام، این یک متن آزمایشی فارسی است که برای بررسی تولید کد QR نوشته شده. '.repeat(30),
      mixed: 'رمزنگاری P00RIJA — AES-256-GCM با کلید ECDH P-256، نسخهٔ 2.100. '.repeat(30),
      emoji: 'پیام 😀 با ایموجی 🔐 و متن فارسی 🇮🇷 ترکیبی. '.repeat(25),
      ascii: 'The quick brown fox jumps over the lazy dog. '.repeat(40),
    };
    const out = {};
    for (const [name, text] of Object.entries(samples)) {
      const frames = T.qrSplit(text, 'ab12cd');
      const failed = [];
      let widest = 0;
      for (const frame of frames) {
        widest = Math.max(widest, encoder.encode(frame).length);
        box.innerHTML = '';
        try {
          new window.QRCode(box, { text: frame, width: 288, height: 288,
            correctLevel: window.QRCode.CorrectLevel.L });
        } catch (error) { failed.push(error.message); }
      }
      /* Rejoined through the app's own parser, not by slicing strings here —
         a reassembly test that reimplements the parser tests nothing. */
      const rejoined = frames
        .map((frame) => T.qrParse(frame))
        .sort((a, b) => a.index - b.index)
        .map((piece) => piece.payload)
        .join('');
      out[name] = { frames: frames.length, widest, failed, exact: rejoined === text };
    }
    box.remove();
    return out;
  });
  console.log(`  ${JSON.stringify(split)}`);
  for (const [name, row] of Object.entries(split)) {
    check(`every frame encodes (${name})`, row.failed.length === 0,
      row.failed[0] || `${row.frames} frames`);
    check(`the frames rejoin to the original, exactly (${name})`, row.exact);
    /* The budget is a promise about the whole frame, header included. */
    check(`no frame overruns the byte budget (${name})`, row.widest <= 500,
      `widest ${row.widest}`);
  }

  /* ===== a code point is never cut in half ============================== */

  console.log('\n===== characters survive the split =====');

  const surrogates = await page.evaluate(() => {
    const T = window.PoorijaToolsExtra;
    /* Emoji are 4 bytes each, so a budget that is not a multiple of 4 lands
       mid-character unless the splitter walks code points. */
    const text = '😀'.repeat(400);
    const frames = T.qrSplit(text, 'sur', 130);
    const payloads = frames.map((frame) => T.qrParse(frame).payload);
    return {
      frames: frames.length,
      /* A lone surrogate in any payload means one got cut. */
      lone: payloads.some((piece) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(piece)),
      exact: payloads.join('') === text,
    };
  });
  console.log(`  ${JSON.stringify(surrogates)}`);
  check('an emoji is never split across two frames', !surrogates.lone);
  check('and the emoji text rejoins exactly', surrogates.exact);

  /* ===== a scanner can read it back ===================================== */

  console.log('\n===== what a scanner gets back =====');

  const roundTrip = await page.evaluate(async () => {
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:0;top:0;z-index:-1';
    document.body.appendChild(stage);
    const out = {};
    /* Encoding correctly is only half of it: the bytes have to be the UTF-8 a
       decoder expects, or Persian comes back as mojibake and emoji as two
       broken halves. Reading it back is the only way to know. */
    for (const [name, text] of Object.entries({
      persian: 'سلام، این یک متن آزمایشی فارسی است.',
      emoji: 'پیام 😀 رمز 🔐',
    })) {
      stage.innerHTML = '';
      window.PoorijaQR.render(stage, text, { px: 512 });
      const canvas = stage.querySelector('canvas');
      const got = await window.PoorijaQR.decode(canvas, canvas.width, canvas.height);
      out[name] = { got, same: got === text };
    }
    stage.remove();
    return out;
  });
  console.log(`  ${JSON.stringify(roundTrip)}`);
  for (const [name, row] of Object.entries(roundTrip)) {
    check(`a rendered code decodes back to the same text (${name})`, row.same,
      JSON.stringify(row.got));
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
