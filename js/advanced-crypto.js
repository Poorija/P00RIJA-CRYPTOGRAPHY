/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* =====================================================================
   Advanced client-side primitives
   ---------------------------------------------------------------------
   Two things WebCrypto does not give you and that this app needs:

   1. Argon2id — a memory-hard KDF. PBKDF2 (what WebCrypto offers) is
      cheap to attack on a GPU because it needs almost no memory; Argon2id
      forces an attacker to buy RAM per guess. Loaded from WASM on first
      use so the 29 KB never lands on the critical path.

   2. Shamir Secret Sharing — split a secret into n pieces of which any k
      reconstruct it, and k-1 reveal literally nothing. Pure arithmetic
      over GF(2^8), no dependency, no network.

   Everything here runs in the browser. Nothing is transmitted.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------------- GF(2^8) ----------------------------------------
     The AES field: x^8 + x^4 + x^3 + x + 1 (0x11b), generator 3. Log and
     antilog tables turn multiplication and division into table lookups,
     which keeps the interpolation loop free of branches on secret data. */
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function buildTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      /* multiply by the generator 3 = x + 1 */
      let next = x << 1;
      if (x & 0x80) next ^= 0x11b;
      x = (next ^ x) & 0xff;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  }());

  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);
  const gfDiv = (a, b) => {
    if (b === 0) throw new Error('GF division by zero');
    return a === 0 ? 0 : GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255];
  };

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function bytesToBase64(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  function base64ToBytes(text) {
    const binary = atob(String(text || '').replace(/\s+/g, ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  async function checksum4(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(digest).slice(0, 4);
  }

  const SHARE_PREFIX = 'P00RIJA-SSS-v1';

  /* Splits `secret` into `total` shares, any `threshold` of which rebuild it.
     A 4-byte digest of the secret rides along inside the shared payload, so
     combining the wrong shares fails loudly instead of returning garbage. */
  async function splitSecret(secret, threshold, total) {
    const bytes = secret instanceof Uint8Array ? secret : textEncoder.encode(String(secret));
    if (!bytes.length) throw new Error('Secret is empty');
    if (!Number.isInteger(threshold) || !Number.isInteger(total)) throw new Error('Threshold and total must be whole numbers');
    if (threshold < 2) throw new Error('Threshold must be at least 2');
    if (total < threshold) throw new Error('Total shares cannot be fewer than the threshold');
    if (total > 255) throw new Error('At most 255 shares are supported');

    const tagged = new Uint8Array(4 + bytes.length);
    tagged.set(await checksum4(bytes), 0);
    tagged.set(bytes, 4);

    /* One random polynomial per byte, constant term = the byte itself.
       Coefficients come from the CSPRNG, never from a counter or the clock. */
    const shares = [];
    for (let x = 1; x <= total; x++) shares.push({ x, bytes: new Uint8Array(tagged.length) });
    const coefficients = new Uint8Array(threshold - 1);
    for (let position = 0; position < tagged.length; position++) {
      crypto.getRandomValues(coefficients);
      for (const share of shares) {
        /* Horner's method from the top coefficient down to the secret byte. */
        let acc = 0;
        for (let degree = threshold - 2; degree >= 0; degree--) {
          acc = gfMul(acc, share.x) ^ coefficients[degree];
        }
        share.bytes[position] = gfMul(acc, share.x) ^ tagged[position];
      }
    }
    return shares.map((share) => `${SHARE_PREFIX}.${threshold}.${share.x}.${bytesToBase64(share.bytes)}`);
  }

  function parseShare(text) {
    const parts = String(text || '').trim().split('.');
    if (parts.length !== 4 || parts[0] !== SHARE_PREFIX) throw new Error('Not a valid share');
    const threshold = Number(parts[1]);
    const x = Number(parts[2]);
    if (!Number.isInteger(threshold) || threshold < 2) throw new Error('Share carries a bad threshold');
    if (!Number.isInteger(x) || x < 1 || x > 255) throw new Error('Share carries a bad index');
    return { threshold, x, bytes: base64ToBytes(parts[3]) };
  }

  async function combineShares(shareTexts) {
    const parsed = shareTexts
      .map((text) => String(text || '').trim())
      .filter(Boolean)
      .map(parseShare);
    if (!parsed.length) throw new Error('No shares supplied');
    const threshold = parsed[0].threshold;
    const length = parsed[0].bytes.length;
    if (parsed.some((share) => share.bytes.length !== length)) throw new Error('Shares are from different secrets');
    /* Duplicate x values collapse the interpolation, so reject them rather
       than silently producing a wrong answer. */
    const seen = new Set();
    parsed.forEach((share) => {
      if (seen.has(share.x)) throw new Error(`Share ${share.x} was supplied twice`);
      seen.add(share.x);
    });
    if (parsed.length < threshold) throw new Error(`${threshold} shares are required, ${parsed.length} supplied`);

    const used = parsed.slice(0, threshold);
    const out = new Uint8Array(length);
    for (let position = 0; position < length; position++) {
      let value = 0;
      for (let i = 0; i < used.length; i++) {
        /* Lagrange basis evaluated at x = 0. */
        let basis = 1;
        for (let j = 0; j < used.length; j++) {
          if (i === j) continue;
          basis = gfMul(basis, gfDiv(used[j].x, used[i].x ^ used[j].x));
        }
        value ^= gfMul(used[i].bytes[position], basis);
      }
      out[position] = value;
    }
    const secret = out.slice(4);
    const expected = out.slice(0, 4);
    const actual = await checksum4(secret);
    if (expected.some((byte, index) => byte !== actual[index])) {
      throw new Error('Those shares do not belong together — the recovered secret failed its checksum');
    }
    return secret;
  }

  /* ---------------- Argon2id ---------------------------------------- */
  const ARGON2_SCRIPT = 'vendor/hash-wasm/argon2.umd.min.js';
  const ARGON2_PRESETS = {
    interactive: { iterations: 2, memorySize: 19 * 1024, parallelism: 1 },
    moderate: { iterations: 3, memorySize: 64 * 1024, parallelism: 1 },
    sensitive: { iterations: 4, memorySize: 256 * 1024, parallelism: 1 },
  };
  let argon2Promise = null;
  function loadArgon2() {
    if (global.hashwasm?.argon2id) return Promise.resolve(global.hashwasm);
    if (argon2Promise) return argon2Promise;
    argon2Promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ARGON2_SCRIPT;
      script.async = true;
      script.onload = () => (global.hashwasm?.argon2id ? resolve(global.hashwasm) : reject(new Error('argon2 missing after load')));
      script.onerror = () => reject(new Error('argon2 failed to load'));
      document.head.appendChild(script);
    }).catch((error) => {
      argon2Promise = null;
      throw error;
    });
    return argon2Promise;
  }

  /* Returns raw key material. Callers that want a storable string should use
     hashPassword, which emits the standard PHC encoding with its own salt. */
  async function deriveKeyArgon2id(password, salt, {
    preset = 'moderate', hashLength = 32, iterations, memorySize, parallelism,
  } = {}) {
    const wasm = await loadArgon2();
    const base = ARGON2_PRESETS[preset] || ARGON2_PRESETS.moderate;
    const result = await wasm.argon2id({
      password,
      salt: salt instanceof Uint8Array ? salt : textEncoder.encode(String(salt)),
      iterations: iterations || base.iterations,
      memorySize: memorySize || base.memorySize,
      parallelism: parallelism || base.parallelism,
      hashLength,
      outputType: 'binary',
    });
    return result instanceof Uint8Array ? result : new Uint8Array(result);
  }

  async function hashPassword(password, options = {}) {
    const wasm = await loadArgon2();
    const base = ARGON2_PRESETS[options.preset] || ARGON2_PRESETS.moderate;
    const salt = options.salt instanceof Uint8Array ? options.salt : crypto.getRandomValues(new Uint8Array(16));
    return wasm.argon2id({
      password,
      salt,
      iterations: options.iterations || base.iterations,
      memorySize: options.memorySize || base.memorySize,
      parallelism: options.parallelism || base.parallelism,
      hashLength: options.hashLength || 32,
      outputType: 'encoded',
    });
  }

  async function verifyPassword(password, encoded) {
    const wasm = await loadArgon2();
    return wasm.argon2Verify({ password, hash: encoded });
  }

  /* ---------------- UI wiring --------------------------------------
     Kept in this file rather than app.js so the whole feature — maths, WASM
     loader and screen — lives in one place and can be removed in one piece. */
  const t = (fa, en) => (global.PoorijaApp?.state?.language === 'en' ? en : fa);
  const notify = (message, type) => global.PoorijaApp?.showNotification?.(message, type);
  /* The maths layer throws in English so it stays usable on its own; the screen
     is the right place to turn those into the user's language. */
  function localiseError(error) {
    const message = String(error?.message || error);
    const table = [
      [/^Secret is empty/, 'رازی وارد نشده است.'],
      [/^Threshold must be at least 2/, 'آستانه باید حداقل ۲ باشد.'],
      [/^Total shares cannot be fewer/, 'تعداد سهم‌ها نمی‌تواند از آستانه کمتر باشد.'],
      [/^At most 255 shares/, 'حداکثر ۲۵۵ سهم پشتیبانی می‌شود.'],
      [/^Threshold and total must be whole numbers/, 'آستانه و تعداد سهم باید عدد صحیح باشند.'],
      [/^Not a valid share/, 'این متن یک سهم معتبر نیست.'],
      [/^Share carries a bad threshold/, 'آستانهٔ این سهم نامعتبر است.'],
      [/^Share carries a bad index/, 'شمارهٔ این سهم نامعتبر است.'],
      [/^No shares supplied/, 'هیچ سهمی وارد نشده است.'],
      [/^Shares are from different secrets/, 'این سهم‌ها به یک راز تعلق ندارند.'],
      [/^Share (\d+) was supplied twice/, 'یک سهم دو بار وارد شده است.'],
      [/^(\d+) shares are required, (\d+) supplied/, null],
      [/failed its checksum/, 'این سهم‌ها با هم جور نیستند — راز بازسازی‌شده از بررسی صحت رد شد.'],
    ];
    if (global.PoorijaApp?.state?.language === 'en') return message;
    const counts = message.match(/^(\d+) shares are required, (\d+) supplied/);
    if (counts) return `برای بازسازی ${counts[1]} سهم لازم است؛ ${counts[2]} سهم وارد شده.`;
    const hit = table.find(([pattern, fa]) => fa && pattern.test(message));
    return hit ? hit[1] : message;
  }
  const escapeHTML = (value) => global.PoorijaApp?.escapeHTML?.(value)
    ?? String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderShares(shares) {
    const target = document.getElementById('sssShares');
    if (!target) return;
    if (!shares.length) {
      target.innerHTML = '';
      return;
    }
    target.innerHTML = `
      <p class="text-xs opacity-60 pt-1">${escapeHTML(t(
        'هر سهم را جداگانه و در جای متفاوتی نگه دارید. سهم‌ها را کنار هم ذخیره نکنید.',
        'Keep each share separately, in a different place. Storing them together defeats the point.',
      ))}</p>
      ${shares.map((share, index) => `
        <div class="flex items-center gap-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800/70">
          <span class="shrink-0 w-6 h-6 grid place-items-center rounded-md bg-violet-500/20 text-violet-400 text-xs font-bold">${index + 1}</span>
          <code class="flex-1 min-w-0 text-[10px] break-all font-mono opacity-80">${escapeHTML(share)}</code>
          <button type="button" data-sss-copy="${index}" class="shrink-0 w-7 h-7 grid place-items-center rounded-md bg-slate-200 dark:bg-slate-700 hover:bg-brand-500 hover:text-white transition-colors" title="${escapeHTML(t('کپی', 'Copy'))}"><i class="fas fa-copy text-xs"></i></button>
          <button type="button" data-sss-save="${index}" class="shrink-0 w-7 h-7 grid place-items-center rounded-md bg-slate-200 dark:bg-slate-700 hover:bg-brand-500 hover:text-white transition-colors" title="${escapeHTML(t('ذخیره', 'Save'))}"><i class="fas fa-download text-xs"></i></button>
        </div>`).join('')}`;
    target.dataset.shares = JSON.stringify(shares);
  }

  function bindAdvancedCryptoUi() {
    const splitBtn = document.getElementById('sssSplitBtn');
    if (splitBtn && !splitBtn.dataset.bound) {
      splitBtn.dataset.bound = '1';
      splitBtn.addEventListener('click', async () => {
        const secret = document.getElementById('sssSecret')?.value || '';
        const threshold = Number(document.getElementById('sssThreshold')?.value || 0);
        const total = Number(document.getElementById('sssTotal')?.value || 0);
        try {
          const shares = await splitSecret(secret, threshold, total);
          renderShares(shares);
          notify(t(`${total} سهم ساخته شد؛ برای بازسازی ${threshold} سهم لازم است.`,
            `${total} shares created; ${threshold} of them rebuild the secret.`), 'success');
        } catch (error) {
          renderShares([]);
          notify(localiseError(error), 'error');
        }
      });
    }

    const sharesBox = document.getElementById('sssShares');
    if (sharesBox && !sharesBox.dataset.bound) {
      sharesBox.dataset.bound = '1';
      sharesBox.addEventListener('click', (event) => {
        const list = JSON.parse(sharesBox.dataset.shares || '[]');
        const copy = event.target.closest('[data-sss-copy]');
        if (copy) {
          navigator.clipboard?.writeText(list[Number(copy.dataset.sssCopy)] || '')
            .then(() => notify(t('سهم کپی شد.', 'Share copied.'), 'success'))
            .catch(() => notify(t('کپی ناموفق بود.', 'Copy failed.'), 'warning'));
          return;
        }
        const save = event.target.closest('[data-sss-save]');
        if (!save) return;
        const index = Number(save.dataset.sssSave);
        const blob = new Blob([list[index] || ''], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `poorija-share-${index + 1}.txt`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      });
    }

    const combineBtn = document.getElementById('sssCombineBtn');
    if (combineBtn && !combineBtn.dataset.bound) {
      combineBtn.dataset.bound = '1';
      combineBtn.addEventListener('click', async () => {
        const lines = (document.getElementById('sssCombineInput')?.value || '')
          .split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
        const panel = document.getElementById('sssResult');
        const output = document.getElementById('sssResultText');
        try {
          const bytes = await combineShares(lines);
          if (output) output.textContent = textDecoder.decode(bytes);
          panel?.classList.remove('hidden');
          notify(t('راز بازسازی شد.', 'Secret recovered.'), 'success');
        } catch (error) {
          panel?.classList.add('hidden');
          notify(localiseError(error), 'error');
        }
      });
    }

    const hashBtn = document.getElementById('argon2HashBtn');
    if (hashBtn && !hashBtn.dataset.bound) {
      hashBtn.dataset.bound = '1';
      hashBtn.addEventListener('click', async () => {
        const password = document.getElementById('argon2Password')?.value || '';
        if (!password) {
          notify(t('اول یک رمز وارد کنید.', 'Enter a password first.'), 'warning');
          return;
        }
        const preset = document.getElementById('argon2Preset')?.value || 'moderate';
        const output = document.getElementById('argon2Output');
        const timing = document.getElementById('argon2Timing');
        hashBtn.disabled = true;
        if (timing) timing.textContent = t('در حال محاسبه…', 'Computing…');
        try {
          const started = performance.now();
          const encoded = await hashPassword(password, { preset });
          const elapsed = Math.round(performance.now() - started);
          if (output) output.value = encoded;
          if (timing) {
            const params = ARGON2_PRESETS[preset];
            timing.textContent = t(
              `${elapsed} میلی‌ثانیه — ${Math.round(params.memorySize / 1024)} مگابایت حافظه، ${params.iterations} دور`,
              `${elapsed} ms — ${Math.round(params.memorySize / 1024)} MB of memory, ${params.iterations} passes`,
            );
          }
        } catch (error) {
          if (timing) timing.textContent = '';
          notify(t('محاسبهٔ Argon2 ناموفق بود.', 'Argon2 hashing failed.'), 'error');
          console.error('[Argon2]', error);
        } finally {
          hashBtn.disabled = false;
        }
      });
    }

    const verifyBtn = document.getElementById('argon2VerifyBtn');
    if (verifyBtn && !verifyBtn.dataset.bound) {
      verifyBtn.dataset.bound = '1';
      verifyBtn.addEventListener('click', async () => {
        const password = document.getElementById('argon2Password')?.value || '';
        const encoded = (document.getElementById('argon2Verify')?.value || '').trim();
        const result = document.getElementById('argon2VerifyResult');
        if (!password || !encoded) {
          notify(t('هم رمز و هم هش لازم است.', 'Both the password and the hash are required.'), 'warning');
          return;
        }
        verifyBtn.disabled = true;
        try {
          const ok = await verifyPassword(password, encoded);
          if (result) {
            result.textContent = ok ? t('✓ رمز با این هش می‌خواند.', '✓ The password matches this hash.')
              : t('✗ رمز با این هش نمی‌خواند.', '✗ The password does not match this hash.');
            result.className = `text-sm mt-2 font-bold ${ok ? 'text-emerald-400' : 'text-rose-400'}`;
          }
        } catch (error) {
          if (result) {
            result.textContent = t('این هش خوانا نیست.', 'That hash could not be read.');
            result.className = 'text-sm mt-2 font-bold text-rose-400';
          }
        } finally {
          verifyBtn.disabled = false;
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAdvancedCryptoUi);
  } else {
    bindAdvancedCryptoUi();
  }
  global.addEventListener('poorija:tab-switched', bindAdvancedCryptoUi);
  global.addEventListener('poorija:unlock', bindAdvancedCryptoUi);

  global.PoorijaAdvancedCrypto = {
    bindUi: bindAdvancedCryptoUi,
    splitSecret,
    combineShares,
    parseShare,
    deriveKeyArgon2id,
    hashPassword,
    verifyPassword,
    argon2Presets: ARGON2_PRESETS,
    bytesToBase64,
    base64ToBytes,
    utf8: { encode: (t) => textEncoder.encode(t), decode: (b) => textDecoder.decode(b) },
  };
}(typeof globalThis !== 'undefined' ? globalThis : window));
