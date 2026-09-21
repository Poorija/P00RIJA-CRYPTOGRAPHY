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
   crypto-core.js — the primitives WebCrypto does not give us.
   ============================================================================

   Two things forced this file into existence.

   The first is synchronous authenticated encryption. `encryptStorageData()` is
   called from ordinary synchronous code all over app.js; `crypto.subtle` is
   async, so swapping the vault cipher for AES-GCM would have meant threading
   promises through every caller. CryptoJS was filling that gap with
   AES-256-CBC + HMAC-SHA256 — sound enough as Encrypt-then-MAC, but from an
   unmaintained library that also carried RC4 and TripleDES into the payload.

   The second is nonce headroom. The vault is re-encrypted on nearly every
   state change. AES-GCM's 96-bit nonce wants a counter, and a counter that
   resets — a restored backup, a copied profile directory — repeats a nonce and
   loses everything GCM was protecting. XChaCha20's 192-bit nonce can be drawn
   at random forever: at 2^80 messages the collision probability is still
   negligible, so there is no counter to get wrong.

   AES-256-GCM through WebCrypto remains the default for files and messages,
   where the hardware path matters. This is for the vault and for anyone who
   would rather not depend on AES-NI.

   ON THE POLY1305 IMPLEMENTATION
   ------------------------------
   The fast reference implementation (poly1305-donna-32) accumulates into
   64-bit integers. JavaScript numbers are doubles: exact only to 2^53, and
   donna's intermediate products reach roughly 2^54.3. Porting it directly
   produces code that passes small tests and silently corrupts tags on some
   inputs — the worst possible failure for an authenticator.

   So this uses the 17-limb, 8-bits-per-limb structure from TweetNaCl instead.
   Every product stays under 2^29, which doubles represent exactly. It costs
   roughly eighteen multiplications per byte where donna costs one, and that is
   the right trade for a vault measured in kilobytes.

   Nothing here is used anywhere until tests/e2e/cryptocore.mjs has run the
   published vectors — RFC 8439 §2.3.2, §2.5.2, §2.6.2, §2.8.2, and the
   XChaCha20-Poly1305 vector from draft-irtf-cfrg-xchacha-03 §A.3.
   ============================================================================ */

(function (global) {
  'use strict';

  /* ---- little helpers ---------------------------------------------------- */

  function u32le(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) |
            (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function rotl32(v, n) {
    return ((v << n) | (v >>> (32 - n))) >>> 0;
  }

  /* ---- ChaCha20 (RFC 8439 §2.3) ------------------------------------------ */

  const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

  /* Twenty rounds over the 16-word state. `out` receives the working state
     WITHOUT the final addition of the input state, because HChaCha20 wants it
     that way and the block function adds it back itself. */
  function chachaRounds(state, out) {
    let x0 = state[0], x1 = state[1], x2 = state[2], x3 = state[3],
        x4 = state[4], x5 = state[5], x6 = state[6], x7 = state[7],
        x8 = state[8], x9 = state[9], x10 = state[10], x11 = state[11],
        x12 = state[12], x13 = state[13], x14 = state[14], x15 = state[15];

    for (let i = 0; i < 10; i++) {
      /* column round */
      x0 = (x0 + x4) >>> 0; x12 = rotl32(x12 ^ x0, 16);
      x8 = (x8 + x12) >>> 0; x4 = rotl32(x4 ^ x8, 12);
      x0 = (x0 + x4) >>> 0; x12 = rotl32(x12 ^ x0, 8);
      x8 = (x8 + x12) >>> 0; x4 = rotl32(x4 ^ x8, 7);

      x1 = (x1 + x5) >>> 0; x13 = rotl32(x13 ^ x1, 16);
      x9 = (x9 + x13) >>> 0; x5 = rotl32(x5 ^ x9, 12);
      x1 = (x1 + x5) >>> 0; x13 = rotl32(x13 ^ x1, 8);
      x9 = (x9 + x13) >>> 0; x5 = rotl32(x5 ^ x9, 7);

      x2 = (x2 + x6) >>> 0; x14 = rotl32(x14 ^ x2, 16);
      x10 = (x10 + x14) >>> 0; x6 = rotl32(x6 ^ x10, 12);
      x2 = (x2 + x6) >>> 0; x14 = rotl32(x14 ^ x2, 8);
      x10 = (x10 + x14) >>> 0; x6 = rotl32(x6 ^ x10, 7);

      x3 = (x3 + x7) >>> 0; x15 = rotl32(x15 ^ x3, 16);
      x11 = (x11 + x15) >>> 0; x7 = rotl32(x7 ^ x11, 12);
      x3 = (x3 + x7) >>> 0; x15 = rotl32(x15 ^ x3, 8);
      x11 = (x11 + x15) >>> 0; x7 = rotl32(x7 ^ x11, 7);

      /* diagonal round */
      x0 = (x0 + x5) >>> 0; x15 = rotl32(x15 ^ x0, 16);
      x10 = (x10 + x15) >>> 0; x5 = rotl32(x5 ^ x10, 12);
      x0 = (x0 + x5) >>> 0; x15 = rotl32(x15 ^ x0, 8);
      x10 = (x10 + x15) >>> 0; x5 = rotl32(x5 ^ x10, 7);

      x1 = (x1 + x6) >>> 0; x12 = rotl32(x12 ^ x1, 16);
      x11 = (x11 + x12) >>> 0; x6 = rotl32(x6 ^ x11, 12);
      x1 = (x1 + x6) >>> 0; x12 = rotl32(x12 ^ x1, 8);
      x11 = (x11 + x12) >>> 0; x6 = rotl32(x6 ^ x11, 7);

      x2 = (x2 + x7) >>> 0; x13 = rotl32(x13 ^ x2, 16);
      x8 = (x8 + x13) >>> 0; x7 = rotl32(x7 ^ x8, 12);
      x2 = (x2 + x7) >>> 0; x13 = rotl32(x13 ^ x2, 8);
      x8 = (x8 + x13) >>> 0; x7 = rotl32(x7 ^ x8, 7);

      x3 = (x3 + x4) >>> 0; x14 = rotl32(x14 ^ x3, 16);
      x9 = (x9 + x14) >>> 0; x4 = rotl32(x4 ^ x9, 12);
      x3 = (x3 + x4) >>> 0; x14 = rotl32(x14 ^ x3, 8);
      x9 = (x9 + x14) >>> 0; x4 = rotl32(x4 ^ x9, 7);
    }

    out[0] = x0; out[1] = x1; out[2] = x2; out[3] = x3;
    out[4] = x4; out[5] = x5; out[6] = x6; out[7] = x7;
    out[8] = x8; out[9] = x9; out[10] = x10; out[11] = x11;
    out[12] = x12; out[13] = x13; out[14] = x14; out[15] = x15;
  }

  function chachaInit(key, counter, nonce) {
    const s = new Uint32Array(16);
    s[0] = SIGMA[0]; s[1] = SIGMA[1]; s[2] = SIGMA[2]; s[3] = SIGMA[3];
    for (let i = 0; i < 8; i++) s[4 + i] = u32le(key, i * 4);
    s[12] = counter >>> 0;
    s[13] = u32le(nonce, 0);
    s[14] = u32le(nonce, 4);
    s[15] = u32le(nonce, 8);
    return s;
  }

  /* One 64-byte keystream block. */
  function chacha20Block(key, counter, nonce) {
    const state = chachaInit(key, counter, nonce);
    const work = new Uint32Array(16);
    chachaRounds(state, work);
    const out = new Uint8Array(64);
    for (let i = 0; i < 16; i++) {
      const v = (work[i] + state[i]) >>> 0;
      out[i * 4] = v & 0xff;
      out[i * 4 + 1] = (v >>> 8) & 0xff;
      out[i * 4 + 2] = (v >>> 16) & 0xff;
      out[i * 4 + 3] = (v >>> 24) & 0xff;
    }
    return out;
  }

  /* XOR `data` with the keystream starting at `counter`. */
  function chacha20(key, counter, nonce, data) {
    const out = new Uint8Array(data.length);
    let block = null;
    let blockCounter = counter >>> 0;
    for (let i = 0; i < data.length; i++) {
      const pos = i & 63;
      if (pos === 0) {
        block = chacha20Block(key, blockCounter, nonce);
        blockCounter = (blockCounter + 1) >>> 0;
      }
      out[i] = data[i] ^ block[pos];
    }
    return out;
  }

  /* HChaCha20 (draft-irtf-cfrg-xchacha §2.2): same permutation, 16-byte nonce,
     and the *unadded* working state's first and last four words become the
     subkey. Dropping the addition is what makes it a PRF rather than a stream. */
  function hchacha20(key, nonce16) {
    const s = new Uint32Array(16);
    s[0] = SIGMA[0]; s[1] = SIGMA[1]; s[2] = SIGMA[2]; s[3] = SIGMA[3];
    for (let i = 0; i < 8; i++) s[4 + i] = u32le(key, i * 4);
    for (let i = 0; i < 4; i++) s[12 + i] = u32le(nonce16, i * 4);

    const w = new Uint32Array(16);
    chachaRounds(s, w);

    const out = new Uint8Array(32);
    const pick = [w[0], w[1], w[2], w[3], w[12], w[13], w[14], w[15]];
    for (let i = 0; i < 8; i++) {
      out[i * 4] = pick[i] & 0xff;
      out[i * 4 + 1] = (pick[i] >>> 8) & 0xff;
      out[i * 4 + 2] = (pick[i] >>> 16) & 0xff;
      out[i * 4 + 3] = (pick[i] >>> 24) & 0xff;
    }
    return out;
  }

  /* ---- Poly1305 (RFC 8439 §2.5) ------------------------------------------ */

  /* 2^130 - 5 in the two's-complement form the final reduction adds. */
  const MINUSP = new Uint32Array([5, 0, 0, 0, 0, 0, 0, 0, 0,
                                  0, 0, 0, 0, 0, 0, 0, 252]);

  function add1305(h, c) {
    let u = 0;
    for (let j = 0; j < 17; j++) {
      u = u + h[j] + c[j];
      h[j] = u & 255;
      u >>>= 8;
    }
  }

  /* 17 limbs of 8 bits. See the header note for why this and not donna.

     The limbs live in Uint32Array, not Uint8Array: between the multiply and
     the carry pass an element holds a full column sum, up to about 3.5 * 10^8.
     Storing that in bytes truncates it and produces a tag that is stable,
     plausible, and wrong — which the RFC vectors caught and nothing else
     would have. */
  function poly1305(msg, key) {
    const r = new Uint32Array(17);
    const h = new Uint32Array(17);
    const c = new Uint32Array(17);
    const g = new Uint32Array(17);
    const x = new Float64Array(17);

    /* r, clamped per RFC 8439 §2.5: the top four bits of bytes 3, 7, 11, 15
       are cleared and the low two bits of bytes 4, 8, 12 are cleared. */
    for (let j = 0; j < 16; j++) r[j] = key[j];
    r[3] &= 15; r[4] &= 252;
    r[7] &= 15; r[8] &= 252;
    r[11] &= 15; r[12] &= 252;
    r[15] &= 15;

    let offset = 0;
    let n = msg.length;

    while (n > 0) {
      for (let j = 0; j < 17; j++) c[j] = 0;
      let j = 0;
      for (; j < 16 && j < n; j++) c[j] = msg[offset + j];
      c[j] = 1;                       /* the appended 1 bit */
      offset += j;
      n -= j;

      add1305(h, c);

      /* h *= r  (mod 2^130 - 5); 320 == 5 * 64 folds the overflow back in */
      for (let i = 0; i < 17; i++) {
        let acc = 0;
        for (let k = 0; k < 17; k++) {
          acc += h[k] * (k <= i ? r[i - k] : 320 * r[i + 17 - k]);
        }
        x[i] = acc;
      }
      for (let i = 0; i < 17; i++) h[i] = x[i];

      /* carry, then fold the bits above 2^130 back in at weight 5 */
      let u = 0;
      for (let i = 0; i < 16; i++) { u += h[i]; h[i] = u & 255; u >>>= 8; }
      u += h[16]; h[16] = u & 3; u = 5 * (u >>> 2);
      for (let i = 0; i < 16; i++) { u += h[i]; h[i] = u & 255; u >>>= 8; }
      u += h[16]; h[16] = u;
    }

    /* Final reduction, branch-free: compute h - (2^130 - 5) and keep it only
       if that did not borrow. The borrow shows up as the top bit of limb 16. */
    for (let j = 0; j < 17; j++) g[j] = h[j];
    add1305(h, MINUSP);
    const mask = -((h[16] >>> 7) & 1);
    for (let j = 0; j < 17; j++) h[j] ^= mask & (g[j] ^ h[j]);

    /* tag = (h + s) mod 2^128 */
    for (let j = 0; j < 16; j++) c[j] = key[j + 16];
    c[16] = 0;
    add1305(h, c);

    const out = new Uint8Array(16);
    for (let j = 0; j < 16; j++) out[j] = h[j];
    return out;
  }

  /* Constant-time comparison. Never short-circuits: a timing signal on a tag
     comparison is a forgery oracle. */
  function ctEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  /* ---- ChaCha20-Poly1305 AEAD (RFC 8439 §2.8) ---------------------------- */

  function poly1305KeyGen(key, nonce) {
    return chacha20Block(key, 0, nonce).slice(0, 32);
  }

  function u64le(value) {
    const out = new Uint8Array(8);
    let v = value;
    for (let i = 0; i < 8; i++) { out[i] = v & 0xff; v = Math.floor(v / 256); }
    return out;
  }

  /* AAD || pad16 || ciphertext || pad16 || len(AAD) || len(ct) */
  function macData(aad, ciphertext) {
    const aadPad = (16 - (aad.length % 16)) % 16;
    const ctPad = (16 - (ciphertext.length % 16)) % 16;
    const total = aad.length + aadPad + ciphertext.length + ctPad + 16;
    const out = new Uint8Array(total);
    let o = 0;
    out.set(aad, o); o += aad.length + aadPad;
    out.set(ciphertext, o); o += ciphertext.length + ctPad;
    out.set(u64le(aad.length), o); o += 8;
    out.set(u64le(ciphertext.length), o);
    return out;
  }

  function chacha20Poly1305Encrypt(key, nonce12, plaintext, aad) {
    const ad = aad || new Uint8Array(0);
    const otk = poly1305KeyGen(key, nonce12);
    const ciphertext = chacha20(key, 1, nonce12, plaintext);
    const tag = poly1305(macData(ad, ciphertext), otk);
    return { ciphertext, tag };
  }

  function chacha20Poly1305Decrypt(key, nonce12, ciphertext, tag, aad) {
    const ad = aad || new Uint8Array(0);
    const otk = poly1305KeyGen(key, nonce12);
    const expected = poly1305(macData(ad, ciphertext), otk);
    if (!ctEqual(expected, tag)) return null;
    return chacha20(key, 1, nonce12, ciphertext);
  }

  /* ---- XChaCha20-Poly1305 ------------------------------------------------ */

  /* The 24-byte nonce splits: the first 16 bytes derive a subkey through
     HChaCha20, the last 8 become the low half of a 12-byte ChaCha nonce whose
     first four bytes are zero. */
  function xchachaSplit(key, nonce24) {
    const subkey = hchacha20(key, nonce24.subarray(0, 16));
    const nonce12 = new Uint8Array(12);
    nonce12.set(nonce24.subarray(16, 24), 4);
    return { subkey, nonce12 };
  }

  function xchacha20Poly1305Encrypt(key, nonce24, plaintext, aad) {
    const { subkey, nonce12 } = xchachaSplit(key, nonce24);
    return chacha20Poly1305Encrypt(subkey, nonce12, plaintext, aad);
  }

  function xchacha20Poly1305Decrypt(key, nonce24, ciphertext, tag, aad) {
    const { subkey, nonce12 } = xchachaSplit(key, nonce24);
    return chacha20Poly1305Decrypt(subkey, nonce12, ciphertext, tag, aad);
  }

  /* Sealed form: ciphertext with the tag appended, which is what callers that
     just want "one opaque blob" should use. */
  function seal(key, nonce24, plaintext, aad) {
    const { ciphertext, tag } = xchacha20Poly1305Encrypt(key, nonce24, plaintext, aad);
    const out = new Uint8Array(ciphertext.length + 16);
    out.set(ciphertext, 0);
    out.set(tag, ciphertext.length);
    return out;
  }

  function open(key, nonce24, sealed, aad) {
    if (!sealed || sealed.length < 16) return null;
    const ciphertext = sealed.subarray(0, sealed.length - 16);
    const tag = sealed.subarray(sealed.length - 16);
    return xchacha20Poly1305Decrypt(key, nonce24, ciphertext, tag, aad);
  }

  /* ---- CRC-32 (IEEE) ----------------------------------------------------- */

  /* Not a security primitive. It exists so steganographic extraction can tell
     "damaged" apart from "absent" — see js/stego.js. */
  let CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
    return CRC_TABLE;
  }

  function crc32(bytes) {
    const table = crcTable();
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ---- randomness -------------------------------------------------------- */

  function randomBytes(length) {
    const out = new Uint8Array(length);
    const webcrypto = (global.crypto && global.crypto.getRandomValues)
      ? global.crypto
      : null;
    if (!webcrypto) {
      /* No silent Math.random fallback. A key that looks random but is not is
         worse than a refusal, because nothing downstream can detect it. */
      throw new Error('No cryptographically secure random source available.');
    }
    /* getRandomValues refuses more than 65536 bytes per call, so fill in
       chunks. Asking for a large buffer used to throw QuotaExceededError. */
    const MAX_DRAW = 65536;
    for (let offset = 0; offset < length; offset += MAX_DRAW) {
      webcrypto.getRandomValues(out.subarray(offset, Math.min(offset + MAX_DRAW, length)));
    }
    return out;
  }

  /* ---- byte / text plumbing ---------------------------------------------- */

  const textEncoder = new global.TextEncoder();
  const textDecoder = new global.TextDecoder();

  function utf8(str) { return textEncoder.encode(str); }
  function fromUtf8(bytes) { return textDecoder.decode(bytes); }

  function toBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return global.btoa(binary);
  }

  function fromBase64(str) {
    const binary = global.atob(str);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function toHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }

  function fromHex(hex) {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    const out = new Uint8Array(clean.length >> 1);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
  }

  /* ---- Argon2id ---------------------------------------------------------- */

  /* Over the vendored hash-wasm build. Async, because the WASM module is.
     Parameters follow RFC 9106's second recommended option (64 MiB, t=3, p=1),
     which is the sensible ceiling for a browser that also has to render. */
  const ARGON2_DEFAULTS = Object.freeze({
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,   /* KiB */
    hashLength: 32
  });

  async function argon2id(password, salt, options) {
    const opts = Object.assign({}, ARGON2_DEFAULTS, options || {});
    const impl = global.hashwasm;
    if (!impl || typeof impl.argon2id !== 'function') {
      throw new Error('argon2id is unavailable: vendor/hash-wasm did not load.');
    }
    const raw = await impl.argon2id({
      password: typeof password === 'string' ? utf8(password) : password,
      salt: typeof salt === 'string' ? utf8(salt) : salt,
      parallelism: opts.parallelism,
      iterations: opts.iterations,
      memorySize: opts.memorySize,
      hashLength: opts.hashLength,
      outputType: 'binary'
    });
    return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  }

  /* ---- export ------------------------------------------------------------ */

  const api = {
    chacha20,
    chacha20Block,
    hchacha20,
    poly1305,
    chacha20Poly1305Encrypt,
    chacha20Poly1305Decrypt,
    xchacha20Poly1305Encrypt,
    xchacha20Poly1305Decrypt,
    seal,
    open,
    ctEqual,
    crc32,
    randomBytes,
    utf8,
    fromUtf8,
    toBase64,
    fromBase64,
    toHex,
    fromHex,
    argon2id,
    ARGON2_DEFAULTS,
    NONCE_BYTES: 24,
    KEY_BYTES: 32,
    TAG_BYTES: 16
  };

  global.PoorijaCryptoCore = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
