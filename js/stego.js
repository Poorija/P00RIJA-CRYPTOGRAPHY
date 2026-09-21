/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* ============================================================================
   stego.js — hiding a message in a picture, and knowing when it did not work.
   ============================================================================

   THE PROBLEM THIS FILE EXISTS FOR
   --------------------------------
   The intended use is carrying an encrypted message through a messenger that
   is assumed to be reading everything: write the text, encrypt it, hide the
   ciphertext in an ordinary photograph, send the photograph. A base64 blob in
   a chat window does not hide that you are encrypting; a picture of a cat does.

   The previous implementation wrote the message into the low bit of the red
   channel and terminated it with a zero byte. Three things were wrong with
   that, and the third is the serious one:

     1. A payload containing a zero byte truncated silently. Ciphertext contains
        zero bytes roughly every 256 bytes.
     2. There was no way to tell "this image has no message" from "this image
        had a message and it was destroyed". Both produced an empty string and
        the same shrug of a warning.
     3. Every messenger re-encodes an image sent as a *photo* into JPEG. That
        re-encode annihilates low bits. So the feature worked perfectly in
        testing, where the file moves as a file, and failed silently in the one
        situation it was built for.

   WHAT IS HERE
   ------------
   A container with a magic number, a length and a CRC, so extraction can say
   which of the three things happened. Two codecs behind it:

     LSB   — one bit per colour channel. Maximum capacity, perfect fidelity,
             destroyed by any re-encode. Correct when the image travels as a
             file, which is what the app now tells the user to do.

     DCT   — quantisation index modulation on mid-frequency DCT coefficients,
             the same 8x8 transform JPEG itself uses. Survives being re-encoded
             as JPEG, because it writes where JPEG keeps information rather than
             where JPEG throws it away. Costs capacity and a little image
             quality, and cannot survive being cropped or resized.

   Neither is steganography in the academic sense: a determined analyst with
   the original image, or with a good statistical model, can detect that
   something was embedded. What they cannot do is read it, because what goes in
   here is already ciphertext. The purpose is to avoid *looking* like
   encryption to an automated filter, not to defeat a forensics lab.
   ============================================================================ */

(function (global) {
  'use strict';

  const MAGIC = [0x50, 0x30, 0x53, 0x32];   /* "P0S2" */
  const HEADER_BYTES = 16;
  const VERSION = 2;

  const ALGO_LSB = 1;
  const ALGO_DCT = 2;

  const FLAG_TEXT = 1;

  function crc32(bytes) {
    const core = global.PoorijaCryptoCore;
    if (core && core.crc32) return core.crc32(bytes);
    /* stego.js is also loaded by tests that do not pull in crypto-core. */
    let c, table = crc32._t;
    if (!table) {
      table = crc32._t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
    }
    c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ---- the container ----------------------------------------------------- */

  function buildContainer(payload, algo, isText) {
    const out = new Uint8Array(HEADER_BYTES + payload.length);
    out.set(MAGIC, 0);
    out[4] = VERSION;
    out[5] = algo;
    out[6] = isText ? FLAG_TEXT : 0;
    out[7] = 0;
    const n = payload.length;
    out[8] = (n >>> 24) & 0xff; out[9] = (n >>> 16) & 0xff;
    out[10] = (n >>> 8) & 0xff; out[11] = n & 0xff;
    const c = crc32(payload);
    out[12] = (c >>> 24) & 0xff; out[13] = (c >>> 16) & 0xff;
    out[14] = (c >>> 8) & 0xff; out[15] = c & 0xff;
    out.set(payload, HEADER_BYTES);
    return out;
  }

  /* Returns a verdict, never a bare string. Callers must look at `status`:
     an empty payload with status 'ok' is a real empty message, and an empty
     payload with status 'absent' is a picture of a cat. */
  function parseContainer(bytes) {
    if (!bytes || bytes.length < HEADER_BYTES) {
      return { status: 'absent' };
    }
    for (let i = 0; i < 4; i++) {
      if (bytes[i] !== MAGIC[i]) return { status: 'absent' };
    }
    if (bytes[4] !== VERSION) {
      return { status: 'version', version: bytes[4] };
    }
    const length = (bytes[8] << 24 | bytes[9] << 16 | bytes[10] << 8 | bytes[11]) >>> 0;
    const wantCrc = (bytes[12] << 24 | bytes[13] << 16 | bytes[14] << 8 | bytes[15]) >>> 0;
    if (HEADER_BYTES + length > bytes.length) {
      return { status: 'truncated', expected: length, available: bytes.length - HEADER_BYTES };
    }
    const payload = bytes.subarray(HEADER_BYTES, HEADER_BYTES + length);
    if (crc32(payload) !== wantCrc) {
      return { status: 'damaged', length };
    }
    return {
      status: 'ok',
      algo: bytes[5],
      isText: Boolean(bytes[6] & FLAG_TEXT),
      payload: payload.slice()
    };
  }

  /* ---- LSB --------------------------------------------------------------- */

  /* One bit per colour channel, alpha left alone. Touching alpha is both more
     visible and more fragile: several pipelines premultiply it, which destroys
     the low bits of the colour channels as a side effect. */
  function lsbCapacityBytes(width, height) {
    return Math.floor((width * height * 3) / 8) - HEADER_BYTES;
  }

  function lsbEmbed(imageData, container) {
    const data = imageData.data;
    const totalBits = container.length * 8;
    if (totalBits > (imageData.width * imageData.height * 3)) {
      throw new Error('CAPACITY');
    }
    let bit = 0;
    for (let i = 0; i < data.length && bit < totalBits; i += 4) {
      for (let ch = 0; ch < 3 && bit < totalBits; ch++) {
        const b = (container[bit >> 3] >> (7 - (bit & 7))) & 1;
        data[i + ch] = (data[i + ch] & 0xfe) | b;
        bit++;
      }
    }
    return imageData;
  }

  function lsbExtract(imageData, maxBytes) {
    const data = imageData.data;
    const capacity = Math.floor((imageData.width * imageData.height * 3) / 8);
    const limit = Math.min(capacity, maxBytes || capacity);
    const out = new Uint8Array(limit);
    let bit = 0;
    const totalBits = limit * 8;
    for (let i = 0; i < data.length && bit < totalBits; i += 4) {
      for (let ch = 0; ch < 3 && bit < totalBits; ch++) {
        out[bit >> 3] = (out[bit >> 3] << 1) | (data[i + ch] & 1);
        bit++;
      }
    }
    return out;
  }

  /* ---- colour ------------------------------------------------------------ */

  /* JPEG works in YCbCr and keeps far more of Y than of the chroma planes, so
     everything below embeds in Y only. */
  function toYCbCr(imageData) {
    const { width, height, data } = imageData;
    const n = width * height;
    const Y = new Float64Array(n), Cb = new Float64Array(n), Cr = new Float64Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
      Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
    }
    return { Y, Cb, Cr, width, height };
  }

  function fromYCbCr(planes, imageData) {
    const { Y, Cb, Cr } = planes;
    const data = imageData.data;
    const n = imageData.width * imageData.height;
    const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const y = Y[i], cb = Cb[i] - 128, cr = Cr[i] - 128;
      data[p] = clamp(y + 1.402 * cr);
      data[p + 1] = clamp(y - 0.344136 * cb - 0.714136 * cr);
      data[p + 2] = clamp(y + 1.772 * cb);
    }
    return imageData;
  }

  /* ---- the 8x8 transform ------------------------------------------------- */

  const COS = (() => {
    const t = new Float64Array(64);
    for (let x = 0; x < 8; x++) {
      for (let u = 0; u < 8; u++) {
        t[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
      }
    }
    return t;
  })();
  const C0 = 1 / Math.SQRT2;

  function dct8x8(block, out) {
    for (let v = 0; v < 8; v++) {
      for (let u = 0; u < 8; u++) {
        let sum = 0;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            sum += block[y * 8 + x] * COS[x * 8 + u] * COS[y * 8 + v];
          }
        }
        out[v * 8 + u] = 0.25 * (u === 0 ? C0 : 1) * (v === 0 ? C0 : 1) * sum;
      }
    }
    return out;
  }

  function idct8x8(coef, out) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let v = 0; v < 8; v++) {
          for (let u = 0; u < 8; u++) {
            sum += (u === 0 ? C0 : 1) * (v === 0 ? C0 : 1) *
                   coef[v * 8 + u] * COS[x * 8 + u] * COS[y * 8 + v];
          }
        }
        out[y * 8 + x] = 0.25 * sum;
      }
    }
    return out;
  }

  const ZIGZAG = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
  ];

  /* Mid frequencies only.

     Low frequencies carry the visible structure of the block: changing them
     shows. High frequencies are what JPEG discards first: changing them
     achieves nothing. The band in between is where a change is both survivable
     and invisible, which is the entire trick. */
  const BAND_START = 6;
  const BAND_END = 22;
  const CARRIERS = ZIGZAG.slice(BAND_START, BAND_END);

  /* Quantisation step.

     This has to be coarser than the step JPEG will apply to the same
     coefficient, or requantisation moves the value into a neighbouring bin and
     the bit flips. Coarser also means a larger change to the picture, so the
     number wants measuring rather than guessing.

     It was first set to 56 by reasoning about the luminance table alone, which
     turned out to be far too conservative: the sweep in tests/e2e/stego.mjs
     shows 56 costs 6 dB of image quality and buys nothing, because every step
     from 14 upward already survives quality 0.45. 16 sits just above the point
     where recovery starts to fail and holds 43 dB, which is invisible.

           step   PSNR    survives down to
             8    49 dB   q 0.65
            10    47 dB   q 0.55
            14    45 dB   q 0.45
            16    43 dB   q 0.45     <- chosen
            56    32 dB   q 0.45

     Messengers re-encode photographs somewhere around quality 0.70 to 0.87, so
     0.45 is a wide margin. */
  const QIM_STEP = 16;

  /* Each bit is written into REPEAT separate coefficients and recovered by
     majority vote. Requantisation does not fail uniformly — it damages some
     coefficients badly and leaves others untouched — so spreading a bit across
     several is worth far more than making any single one more robust. Seven
     tolerates three bad votes per bit. */
  const REPEAT = 7;

  function dctCapacityBits(width, height) {
    const blocks = Math.floor(width / 8) * Math.floor(height / 8);
    return Math.floor((blocks * CARRIERS.length) / REPEAT);
  }

  function dctCapacityBytes(width, height) {
    return Math.floor(dctCapacityBits(width, height) / 8) - HEADER_BYTES;
  }

  /* Walks (block, carrier) pairs in a fixed order. Interleaved by carrier
     rather than by block so a bit's REPEAT copies land in different blocks —
     local damage to one part of the picture then costs one vote, not a byte. */
  function* carrierSlots(width, height) {
    const bx = Math.floor(width / 8);
    const by = Math.floor(height / 8);
    for (let c = 0; c < CARRIERS.length; c++) {
      for (let b = 0; b < bx * by; b++) {
        yield { block: b, coef: CARRIERS[c] };
      }
    }
  }

  function forEachBlock(plane, width, height, fn) {
    const bx = Math.floor(width / 8);
    const by = Math.floor(height / 8);
    const block = new Float64Array(64);
    const coef = new Float64Array(64);
    for (let b = 0; b < bx * by; b++) {
      const ox = (b % bx) * 8;
      const oy = Math.floor(b / bx) * 8;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) block[y * 8 + x] = plane[(oy + y) * width + ox + x] - 128;
      }
      dct8x8(block, coef);
      const changed = fn(b, coef);
      if (changed) {
        idct8x8(coef, block);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            plane[(oy + y) * width + ox + x] = block[y * 8 + x] + 128;
          }
        }
      }
    }
  }

  function dctEmbed(imageData, container) {
    const { width, height } = imageData;
    const totalBits = container.length * 8;
    if (totalBits * REPEAT > Math.floor(width / 8) * Math.floor(height / 8) * CARRIERS.length) {
      throw new Error('CAPACITY');
    }

    /* Plan first: which coefficient of which block carries which bit. */
    const plan = new Map();
    const slots = carrierSlots(width, height);
    for (let bit = 0; bit < totalBits; bit++) {
      const value = (container[bit >> 3] >> (7 - (bit & 7))) & 1;
      for (let r = 0; r < REPEAT; r++) {
        const slot = slots.next().value;
        if (!slot) throw new Error('CAPACITY');
        if (!plan.has(slot.block)) plan.set(slot.block, []);
        plan.get(slot.block).push({ coef: slot.coef, value });
      }
    }

    const planes = toYCbCr(imageData);
    forEachBlock(planes.Y, width, height, (b, coef) => {
      const writes = plan.get(b);
      if (!writes) return false;
      for (const w of writes) {
        coef[w.coef] = quantiseTo(coef[w.coef], w.value);
      }
      return true;
    });
    return fromYCbCr(planes, imageData);
  }

  /* Move the coefficient to the nearest multiple of QIM_STEP whose index has
     the wanted parity. Nearest, not next: a coefficient should travel at most
     one step, or the change becomes visible. */
  function quantiseTo(value, bit) {
    const q = Math.round(value / QIM_STEP);
    if (((q % 2) + 2) % 2 === bit) return q * QIM_STEP;
    const up = (q + 1) * QIM_STEP;
    const down = (q - 1) * QIM_STEP;
    return Math.abs(up - value) <= Math.abs(value - down) ? up : down;
  }

  function readParity(value) {
    const q = Math.round(value / QIM_STEP);
    return ((q % 2) + 2) % 2;
  }

  function dctExtract(imageData, maxBytes) {
    const { width, height } = imageData;
    const capacityBits = dctCapacityBits(width, height);
    const wantBits = Math.min(capacityBits, (maxBytes || 4096) * 8);

    const reads = new Map();
    const slots = carrierSlots(width, height);
    for (let bit = 0; bit < wantBits; bit++) {
      for (let r = 0; r < REPEAT; r++) {
        const slot = slots.next().value;
        if (!slot) break;
        if (!reads.has(slot.block)) reads.set(slot.block, []);
        reads.get(slot.block).push({ coef: slot.coef, bit });
      }
    }

    const votes = new Int32Array(wantBits);
    const planes = toYCbCr(imageData);
    forEachBlock(planes.Y, width, height, (b, coef) => {
      const list = reads.get(b);
      if (!list) return false;
      for (const r of list) {
        votes[r.bit] += readParity(coef[r.coef]) ? 1 : -1;
      }
      return false;      /* read-only pass; do not write the block back */
    });

    const out = new Uint8Array(Math.floor(wantBits / 8));
    for (let bit = 0; bit < out.length * 8; bit++) {
      if (votes[bit] > 0) out[bit >> 3] |= 1 << (7 - (bit & 7));
    }
    return out;
  }

  /* ---- the operations the app calls -------------------------------------- */

  function capacityBytes(width, height, algo) {
    return algo === ALGO_DCT
      ? Math.max(0, dctCapacityBytes(width, height))
      : Math.max(0, lsbCapacityBytes(width, height));
  }

  /* Embeds and then reads its own output back before returning. A hide that
     cannot be un-hidden must never reach the user as a downloadable file —
     that is the failure the old code shipped, and it only showed up on the
     other person's phone. */
  function hide(imageData, payload, options) {
    const opts = options || {};
    const algo = opts.algo === ALGO_DCT ? ALGO_DCT : ALGO_LSB;
    const container = buildContainer(payload, algo, Boolean(opts.isText));

    const capacity = capacityBytes(imageData.width, imageData.height, algo);
    if (payload.length > capacity) {
      return { ok: false, reason: 'CAPACITY', capacity, needed: payload.length };
    }

    const embedded = algo === ALGO_DCT
      ? dctEmbed(imageData, container)
      : lsbEmbed(imageData, container);

    const verified = extract(embedded, { algo });
    if (verified.status !== 'ok') {
      return { ok: false, reason: 'VERIFY_FAILED', verdict: verified };
    }
    return { ok: true, imageData: embedded, algo, containerBytes: container.length };
  }

  /* Tries both codecs unless told which to use, and reports what it found.
     `sourceType` lets the caller say the file was a JPEG, which turns "nothing
     here" into the far more useful "this was re-compressed". */
  function extract(imageData, options) {
    const opts = options || {};
    const order = opts.algo
      ? [opts.algo]
      : [ALGO_LSB, ALGO_DCT];

    let best = { status: 'absent' };
    for (const algo of order) {
      const head = algo === ALGO_DCT
        ? dctExtract(imageData, HEADER_BYTES)
        : lsbExtract(imageData, HEADER_BYTES);
      const peek = parseContainer(head);
      if (peek.status === 'absent') continue;
      if (peek.status === 'truncated') {
        const want = HEADER_BYTES + peek.expected;
        const full = algo === ALGO_DCT
          ? dctExtract(imageData, want)
          : lsbExtract(imageData, want);
        const verdict = parseContainer(full);
        if (verdict.status === 'ok') return Object.assign(verdict, { algo });
        best = Object.assign(verdict, { algo });
        continue;
      }
      if (peek.status === 'ok') return Object.assign(peek, { algo });
      best = Object.assign(peek, { algo });
    }
    return best;
  }

  /* Turns a verdict into something a person can act on. This is the whole
     point of the container: "no hidden text found" was true for a destroyed
     message and for a holiday snapshot, and the difference is the only thing
     the user actually needs to know. */
  function explain(verdict, sourceType, language) {
    const fa = language === 'fa';
    const isJpeg = /jpe?g/i.test(sourceType || '');

    switch (verdict.status) {
      case 'ok':
        return {
          tone: 'success',
          title: fa ? 'پیام پیدا شد' : 'Message recovered',
          detail: fa
            ? `${verdict.payload.length} بایت سالم استخراج شد.`
            : `${verdict.payload.length} bytes recovered intact.`
        };

      case 'damaged':
        return {
          tone: 'error',
          title: fa ? 'پیام هست، ولی آسیب دیده' : 'A message is here, but it is damaged',
          detail: fa
            ? 'سرآیند پیدا شد و آزمون صحت رد شد. تصویر پس از ساخته‌شدن دوباره فشرده یا ویرایش شده. از فرستنده بخواهید همان فایل را دوباره و این بار به‌صورت «فایل» بفرستد.'
            : 'The header is there but the checksum failed. The image was re-compressed or edited after it was made. Ask the sender to send the same file again, this time as a file rather than as a photo.'
        };

      case 'truncated':
        return {
          tone: 'error',
          title: fa ? 'پیام ناقص است' : 'The message is incomplete',
          detail: fa
            ? `پیام ${verdict.expected} بایت اعلام کرده ولی تصویر جا برای این مقدار ندارد. احتمالاً تصویر برش خورده یا کوچک شده است.`
            : `The message declares ${verdict.expected} bytes but the image cannot hold that. It was probably cropped or resized.`
        };

      case 'version':
        return {
          tone: 'warning',
          title: fa ? 'ساخته‌شده با نسخهٔ دیگری' : 'Made by a different version',
          detail: fa
            ? `قالب نسخهٔ ${verdict.version} است و این نسخه آن را نمی‌شناسد.`
            : `The container is version ${verdict.version}, which this build does not read.`
        };

      default:
        return isJpeg ? {
          tone: 'error',
          title: fa ? 'چیزی پیدا نشد — و تصویر JPEG است' : 'Nothing found — and this is a JPEG',
          detail: fa
            ? 'اگر انتظار پیام داشتید، محتمل‌ترین علت این است که تصویر به‌صورت «عکس» فرستاده شده و پیام‌رسان آن را دوباره فشرده کرده. فشرده‌سازی مجدد، پیام پنهان‌شده با روش LSB را کامل نابود می‌کند. راه‌حل: ارسال دوباره به‌صورت «فایل»، یا استفاده از حالت مقاوم هنگام ساخت.'
            : 'If you were expecting a message, the likely cause is that the image was sent as a photo and the messenger re-compressed it. Re-compression destroys an LSB-hidden message completely. The fix is to send it again as a file, or to use the resilient mode when creating it.'
        } : {
          tone: 'info',
          title: fa ? 'پیام پنهانی در این تصویر نیست' : 'No hidden message in this image',
          detail: fa
            ? 'سرآیند پیدا نشد. این تصویر با این برنامه ساخته نشده است.'
            : 'No container header was found. This image was not made by this application.'
        };
    }
  }

  global.PoorijaStego = {
    ALGO_LSB,
    ALGO_DCT,
    HEADER_BYTES,
    QIM_STEP,
    REPEAT,
    CARRIERS,
    hide,
    extract,
    explain,
    capacityBytes,
    buildContainer,
    parseContainer,
    /* exported for the test that simulates a JPEG round trip */
    __internals: { toYCbCr, fromYCbCr, dct8x8, idct8x8, ZIGZAG, crc32 }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.PoorijaStego;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
