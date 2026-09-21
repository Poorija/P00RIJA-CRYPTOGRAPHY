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

   This one runs in plain node rather than a browser, because what it checks is
   arithmetic, not behaviour. Every expected value below is copied from a
   published document, not from a previous run of this code — a self-consistent
   cipher that agrees only with itself is exactly the failure mode a home-grown
   implementation produces.

   Sources:
     RFC 8439 §2.3.2  ChaCha20 block function
     RFC 8439 §2.4.2  ChaCha20 encryption
     RFC 8439 §2.5.2  Poly1305
     RFC 8439 §2.8.2  AEAD_CHACHA20_POLY1305
     draft-irtf-cfrg-xchacha-03 §2.2.1  HChaCha20
     draft-irtf-cfrg-xchacha-03 §A.3    AEAD_XCHACHA20_POLY1305                */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../js/crypto-core.js');

const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const hex = (s) => C.fromHex(s);
const unhex = (b) => C.toHex(b);
const seq = (n, from = 0) => Uint8Array.from({ length: n }, (_, i) => from + i);
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

const SUNSCREEN = ascii(
  "Ladies and Gentlemen of the class of '99: If I could offer you only one " +
  'tip for the future, sunscreen would be it.'
);

/* ===== RFC 8439 §2.3.2 — the block function ============================== */

console.log('\n===== ChaCha20 block function (RFC 8439 §2.3.2) =====');
{
  const key = seq(32);
  const nonce = hex('000000090000004a00000000');
  const got = C.chacha20Block(key, 1, nonce);
  const want =
    '10f1e7e4d13b5915500fdd1fa32071c4' +
    'c7d1f4c733c0680304 22aa9ac3d46c4e'.replace(/ /g, '') +
    'd2826446079faa0914c2d705d98b02a2' +
    'b5129cd1de164eb9cbd083e8a2503c4e';
  check('block(counter=1) matches the RFC keystream', unhex(got) === want, unhex(got));
}

/* ===== RFC 8439 §2.4.2 — encryption ====================================== */

console.log('\n===== ChaCha20 encryption (RFC 8439 §2.4.2) =====');
{
  const key = seq(32);
  const nonce = hex('000000000000004a00000000');
  const got = C.chacha20(key, 1, nonce, SUNSCREEN);
  const want =
    '6e2e359a2568f98041ba0728dd0d6981' +
    'e97e7aec1d4360c20a27afccfd9fae0b' +
    'f91b65c5524733ab8f593dabcd62b357' +
    '1639d624e65152ab8f530c359f0861d8' +
    '07ca0dbf500d6a6156a38e088a22b65e' +
    '52bc514d16ccf806818ce91ab7793736' +
    '5af90bbf74a35be6b40b8eedf27 85e42'.replace(/ /g, '') +
    '874d';
  check('the sunscreen paragraph encrypts to the RFC ciphertext',
    unhex(got) === want, unhex(got).slice(0, 32) + '…');

  const back = C.chacha20(key, 1, nonce, got);
  check('and decrypts back to the original text',
    unhex(back) === unhex(SUNSCREEN));
}

/* ===== RFC 8439 §2.5.2 — Poly1305 ======================================== */

console.log('\n===== Poly1305 (RFC 8439 §2.5.2) =====');
{
  const key = hex('85d6be7857556d337f4452fe42d506a8' +
                  '0103808afb0db2fd4abff6af4149f51b');
  const msg = ascii('Cryptographic Forum Research Group');
  const tag = C.poly1305(msg, key);
  check('the RFC message authenticates to the RFC tag',
    unhex(tag) === 'a8061dc1305136c6c22b8baf0c0127a9', unhex(tag));
}

/* A one-time authenticator whose tag does not change when the message does is
   not an authenticator. Cheap to check, catastrophic to miss. */
{
  const key = hex('85d6be7857556d337f4452fe42d506a8' +
                  '0103808afb0db2fd4abff6af4149f51b');
  const a = C.poly1305(ascii('Cryptographic Forum Research Group'), key);
  const b = C.poly1305(ascii('Cryptographic Forum Research GrouP'), key);
  check('a one-byte change moves the tag', unhex(a) !== unhex(b));
}

/* The 17-limb reduction has its interesting cases at the modulus boundary, so
   exercise lengths that straddle block edges rather than only nice ones. */
{
  const key = seq(32, 7);
  const lengths = [0, 1, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129];
  let allDistinct = true;
  const seen = new Set();
  for (const n of lengths) {
    const tag = unhex(C.poly1305(seq(n, 3), key));
    if (seen.has(tag)) allDistinct = false;
    seen.add(tag);
    if (tag.length !== 32) allDistinct = false;
  }
  check('tags across block-boundary lengths are 16 bytes and all distinct',
    allDistinct, `${seen.size} of ${lengths.length}`);
}

/* ===== RFC 8439 §2.8.2 — the AEAD ======================================== */

console.log('\n===== ChaCha20-Poly1305 AEAD (RFC 8439 §2.8.2) =====');
{
  const key = seq(32, 0x80);
  const nonce = hex('070000004041424344454647');
  const aad = hex('50515253c0c1c2c3c4c5c6c7');
  const { ciphertext, tag } = C.chacha20Poly1305Encrypt(key, nonce, SUNSCREEN, aad);

  const wantCt =
    'd31a8d34648e60db7b86afbc53ef7ec2' +
    'a4aded51296e08fea9e2b5a736ee62d6' +
    '3dbea45e8ca9671282fafb69da92728b' +
    '1a71de0a9e060b2905d6a5b67ecd3b36' +
    '92ddbd7f2d778b8c9803aee328091b58' +
    'fab324e4fad675945585808b4831d7bc' +
    '3ff4def08e4b7a9de576d26586cec64b' +
    '6116';
  check('AEAD ciphertext matches the RFC', unhex(ciphertext) === wantCt,
    unhex(ciphertext).slice(0, 32) + '…');
  check('AEAD tag matches the RFC',
    unhex(tag) === '1ae10b594f09e26a7e902ecbd0600691', unhex(tag));

  const back = C.chacha20Poly1305Decrypt(key, nonce, ciphertext, tag, aad);
  check('and it opens again', back && unhex(back) === unhex(SUNSCREEN));
}

/* ===== draft-irtf-cfrg-xchacha-03 §2.2.1 — HChaCha20 ===================== */

console.log('\n===== HChaCha20 (draft-irtf-cfrg-xchacha-03 §2.2.1) =====');
{
  const key = seq(32);
  const nonce = hex('000000090000004a0000000031415927');
  const got = C.hchacha20(key, nonce);
  check('the subkey matches the draft',
    unhex(got) === '82413b4227b27bfed30e42508a877d73' +
                   'a0f9e4d58a74a853c12ec41326d3ecdc', unhex(got));
}

/* ===== draft-irtf-cfrg-xchacha-03 §A.3 — XChaCha20-Poly1305 ============== */

console.log('\n===== XChaCha20-Poly1305 AEAD (draft §A.3) =====');
{
  const key = seq(32, 0x80);
  const nonce = hex('404142434445464748494a4b4c4d4e4f5051525354555657');
  const aad = hex('50515253c0c1c2c3c4c5c6c7');
  const { ciphertext, tag } = C.xchacha20Poly1305Encrypt(key, nonce, SUNSCREEN, aad);

  const wantCt =
    'bd6d179d3e83d43b9576579493c0e939' +
    '572a1700252bfaccbed2902c21396cbb' +
    '731c7f1b0b4aa6440bf3a82f4eda7e39' +
    'ae64c6708c54c216cb96b72e1213b452' +
    '2f8c9ba40db5d945b11b69b982c1bb9e' +
    '3f3fac2bc369488f76b2383565d3fff9' +
    '21f9664c97637da9768812f615c68b13' +
    'b52e';
  check('XChaCha20 ciphertext matches the draft', unhex(ciphertext) === wantCt,
    unhex(ciphertext).slice(0, 32) + '…');
  check('XChaCha20 tag matches the draft',
    unhex(tag) === 'c0875924c1c7987947deafd8780acf49', unhex(tag));
}

/* ===== seal / open, which is what the rest of the app actually calls ===== */

console.log('\n===== seal / open =====');
{
  const key = C.randomBytes(32);
  const nonce = C.randomBytes(24);
  const plain = C.utf8('یک یادداشت فارسی با متن طولانی‌تر برای اطمینان از UTF-8');
  const sealed = C.seal(key, nonce, plain);

  check('sealed output is the plaintext length plus a 16-byte tag',
    sealed.length === plain.length + 16, `${sealed.length} vs ${plain.length}+16`);

  const opened = C.open(key, nonce, sealed);
  check('it opens to the same UTF-8 text',
    opened && C.fromUtf8(opened) === C.fromUtf8(plain));

  /* Every one of these must return null rather than throw or return garbage.
     A caller that gets bytes back from a failed open will happily use them. */
  const wrongKey = C.randomBytes(32);
  check('a wrong key opens nothing', C.open(wrongKey, nonce, sealed) === null);

  const wrongNonce = C.randomBytes(24);
  check('a wrong nonce opens nothing', C.open(key, wrongNonce, sealed) === null);

  const flipped = sealed.slice();
  flipped[3] ^= 0x01;
  check('a flipped ciphertext bit opens nothing', C.open(key, nonce, flipped) === null);

  const flippedTag = sealed.slice();
  flippedTag[flippedTag.length - 1] ^= 0x80;
  check('a flipped tag bit opens nothing', C.open(key, nonce, flippedTag) === null);

  const truncated = sealed.slice(0, 8);
  check('a truncated blob opens nothing', C.open(key, nonce, truncated) === null);

  check('an empty blob opens nothing', C.open(key, nonce, new Uint8Array(0)) === null);
}

/* AAD is what binds a ciphertext to its context. If it is not actually
   authenticated, a slot from one profile could be replayed into another. */
{
  const key = C.randomBytes(32);
  const nonce = C.randomBytes(24);
  const plain = C.utf8('bound to a context');
  const sealed = C.seal(key, nonce, plain, C.utf8('context-A'));
  check('the right AAD opens it',
    C.open(key, nonce, sealed, C.utf8('context-A')) !== null);
  check('a different AAD does not',
    C.open(key, nonce, sealed, C.utf8('context-B')) === null);
  check('a missing AAD does not',
    C.open(key, nonce, sealed) === null);
}

/* ===== sizes that cross the 64-byte keystream block ====================== */

console.log('\n===== lengths around the keystream block boundary =====');
{
  const key = C.randomBytes(32);
  const nonce = C.randomBytes(24);
  let allOk = true;
  const failures = [];
  for (const n of [0, 1, 63, 64, 65, 127, 128, 129, 255, 256, 1023, 4096]) {
    const plain = C.randomBytes(n);
    const opened = C.open(key, nonce, C.seal(key, nonce, plain));
    const ok = opened && opened.length === n && C.toHex(opened) === C.toHex(plain);
    if (!ok) { allOk = false; failures.push(n); }
  }
  check('every length round-trips exactly', allOk,
    failures.length ? `failed at ${failures.join(', ')}` : '0…4096 bytes');
}

/* ===== CRC-32, used by the steganography container ====================== */

console.log('\n===== CRC-32 =====');
{
  /* "123456789" => 0xCBF43926 is the standard IEEE check value. */
  check('the standard check value is produced',
    C.crc32(ascii('123456789')) === 0xcbf43926,
    '0x' + C.crc32(ascii('123456789')).toString(16));
  check('an empty input is zero', C.crc32(new Uint8Array(0)) === 0);
  check('a one-bit change moves it',
    C.crc32(ascii('hello')) !== C.crc32(ascii('hellp')));
}

/* ===== randomness is real ================================================ */

console.log('\n===== randomness =====');
{
  const a = C.toHex(C.randomBytes(32));
  const b = C.toHex(C.randomBytes(32));
  check('two draws differ', a !== b);
  check('a draw is not all zeroes', !/^0+$/.test(a));
}

/* ===== base64 / hex plumbing ============================================= */

console.log('\n===== encoding helpers =====');
{
  const bytes = C.randomBytes(1000);
  check('base64 round-trips', C.toHex(C.fromBase64(C.toBase64(bytes))) === C.toHex(bytes));
  check('hex round-trips', C.toHex(C.fromHex(C.toHex(bytes))) === C.toHex(bytes));
  /* 1000 bytes is past the 0x8000 chunking guard's first step only for larger
     inputs, so push one that definitely crosses it. */
  const big = C.randomBytes(100000);
  check('base64 round-trips past the chunking boundary',
    C.toHex(C.fromBase64(C.toBase64(big))) === C.toHex(big));
}

const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
