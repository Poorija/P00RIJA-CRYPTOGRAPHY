/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Carrying a message through a messenger that is working but watched.
 *
 * When the relays cannot be reached, the apps that still work are the ones
 * permitted to work — permitted because they can be read. Tunnelling through
 * one starts a detection race the user loses, and loses personally. Sending
 * something the carrier cannot read does not: everybody sends photographs, so
 * there is no fingerprint to find.
 *
 * The pieces were already here. What is tested is the join: that a message
 * sealed to a contact fits inside a photograph, comes back out the other side,
 * and — the one that decides whether any of this is real — survives the
 * photograph being re-encoded as JPEG, which is what every messenger does to
 * a picture without being asked.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const stego = require(join(ROOT, 'js', 'stego.js'));
const carrierSource = readFileSync(join(ROOT, 'js', 'chat', '38-carrier.js'), 'utf8');
const managerSource = readFileSync(join(ROOT, 'js', 'chat', '17-file-manager.js'), 'utf8');

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}
async function rejects(promise, label) {
  let threw = false;
  try { await promise; } catch (_error) { threw = true; }
  ok(threw, label);
}

function extract(source, name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`${name} is gone`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error(`${name} is not closed`);
}
function extractConst(source, name) {
  const match = source.match(new RegExp(`^const ${name} = .*;$`, 'm'));
  if (!match) throw new Error(`${name} is gone`);
  return match[0];
}

const b64 = {
  toBase64: (buffer) => Buffer.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)).toString('base64'),
  toBytes: (text) => new Uint8Array(Buffer.from(String(text || ''), 'base64')),
};

/* Two real identities, so the sealing is against real RSA rather than a mock:
   whether a 3072-bit wrapped key fits in a small photograph is the question. */
async function identity() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']);
  const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey));
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', spki));
  return {
    pair,
    publicKeyData: b64.toBase64(spki),
    fingerprint: Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

/* The carrier's own functions, with the two things they reach outside for —
   the identity keys and the app's base64 helpers — supplied here. */
function carrierFor(me, theirPrivate) {
  const chatState = { identity: { fingerprint: me.fingerprint }, peers: [] };
  return new Function('crypto', 'chatState', 'app', 'window', 'TextEncoder', 'TextDecoder',
    'importIdentityPublicKey', 'openOfflineSeal', 'hexToBytes', 'bytesToHex', `
    ${extractConst(carrierSource, 'CARRIER_VERSION')}
    ${extractConst(carrierSource, 'CARRIER_FINGERPRINT_BYTES')}
    ${extract(carrierSource, 'carrierPackFields')}
    ${extract(carrierSource, 'carrierUnpackFields')}
    ${extract(carrierSource, 'sealForCarrier')}
    ${extract(carrierSource, 'buildCarrierPayload')}
    ${extract(carrierSource, 'openCarrierPayload')}
    ${extract(carrierSource, 'carrierTextRoom')}
    return { carrierPackFields, carrierUnpackFields, buildCarrierPayload,
      openCarrierPayload, carrierTextRoom, CARRIER_VERSION };
  `)(
    webcrypto, chatState,
    /* app() is a function in the app, so it is a function here too. */
    () => ({
      generateSecureRandomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
      arrayBufferToBase64: b64.toBase64,
      base64ToArrayBuffer: b64.toBytes,
    }),
    { PoorijaStego: stego }, TextEncoder, TextDecoder,
    (data) => webcrypto.subtle.importKey('spki', b64.toBytes(data),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']),
    async (seal) => {
      if (!theirPrivate) return null;
      const raw = await webcrypto.subtle.decrypt({ name: 'RSA-OAEP' }, theirPrivate, b64.toBytes(seal));
      return webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    },
    new Function(`return ${extract(managerSource, 'hexToBytes')}`)(),
    new Function(`return ${extract(managerSource, 'bytesToHex')}`)(),
  );
}

const alice = await identity();
const bob = await identity();
const MESSAGE = 'این پیام باید از یک پیام‌رسان تحت نظر رد شود و خوانده نشود. 🔐';

console.log('\nThe wire format');

{
  const c = carrierFor(alice, null);
  const packed = c.carrierPackFields([new Uint8Array([1, 2]), new Uint8Array(400).fill(7),
    new Uint8Array(12).fill(3), new Uint8Array([9])]);
  const back = c.carrierUnpackFields(packed);
  ok(back?.length === 4 && back[1].length === 400 && back[3][0] === 9,
    'four fields go in and four come back, whatever their sizes');
  ok(c.carrierUnpackFields(new Uint8Array([99, 0, 0])) === null,
    'a version this build does not know is refused rather than guessed at');
  ok(c.carrierUnpackFields(packed.subarray(0, packed.length - 5)) === null,
    'and a truncated one is refused rather than half-read');
  ok(c.carrierUnpackFields(new Uint8Array([1])) === null, 'as is one with no fields at all');
}

console.log('\nSealed to the contact, and to nobody else');

{
  const fromAlice = carrierFor(alice, null);
  const payload = await fromAlice.buildCarrierPayload({ publicKeyData: bob.publicKeyData }, MESSAGE);
  ok(payload.length > 400, `the wrapped key dominates a short message (${payload.length} bytes)`);
  ok(!Buffer.from(payload).toString('utf8').includes('پیام'),
    'and the message is not sitting in it in the clear');

  const asBob = carrierFor(bob, bob.pair.privateKey);
  const opened = await asBob.openCarrierPayload(payload);
  ok(opened?.text === MESSAGE, 'the contact it was sealed to reads it back exactly');
  ok(opened?.fromFingerprint === alice.fingerprint,
    'and learns who wrote it, which is how it lands in the right conversation');

  /* Somebody else's copy of the same photograph. */
  const asStranger = carrierFor(await identity(), (await identity()).pair.privateKey);
  await rejects(asStranger.openCarrierPayload(payload),
    'anybody else holding the same photograph cannot open it');
}

{
  const c = carrierFor(alice, alice.pair.privateKey);
  ok(await c.openCarrierPayload(new Uint8Array([2, 0, 1, 5])) === null,
    'bytes that are not one of these at all are reported as foreign, not as a failure to decrypt');
  await rejects(c.buildCarrierPayload({ publicKeyData: '' }, MESSAGE),
    'and a contact with no key cannot be written to');
}

console.log('\nHow much a photograph holds');

{
  const c = carrierFor(alice, null);
  const small = c.carrierTextRoom(1024, 768);
  const phone = c.carrierTextRoom(3024, 4032);
  ok(small > 2000, `a small photograph still holds a few thousand characters (${small})`);
  ok(phone > small * 5, `a phone photograph holds far more (${phone})`);
  ok(c.carrierTextRoom(64, 64) === 0,
    'and a thumbnail holds nothing, which is said before anybody types');
  /* The room quoted has to be room that really exists, or the promise is a
     message retyped. */
  const payload = await c.buildCarrierPayload({ publicKeyData: bob.publicKeyData }, 'x'.repeat(small));
  ok(payload.length <= stego.capacityBytes(1024, 768, stego.ALGO_DCT),
    'a message exactly as long as the quoted room still fits');
}

/* The real quantisation table, at the quality a messenger would use.
   Borrowed from tests/e2e/stego.mjs, where the same round trip is already
   used to prove the codec survives it — restating it differently here would
   be testing a different re-encode than the one the codec was measured
   against. */
const JPEG_LUMA_Q50 = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];
function qualityTable(quality) {
  const q = Math.max(1, Math.min(100, Math.round(quality * 100)));
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  return JPEG_LUMA_Q50.map((value) => {
    const scaled = Math.floor((scale * value + 50) / 100);
    return Math.max(1, Math.min(255, scaled));
  });
}
function jpegRoundTrip(image, quality) {
  const out = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  const table = qualityTable(quality);
  const { toYCbCr, fromYCbCr, dct8x8, idct8x8 } = stego.__internals;
  const planes = toYCbCr(out);
  const { width, height } = out;
  const blocksX = Math.floor(width / 8);
  const blocksY = Math.floor(height / 8);
  const block = new Float64Array(64);
  const coefficients = new Float64Array(64);
  for (let b = 0; b < blocksX * blocksY; b += 1) {
    const ox = (b % blocksX) * 8;
    const oy = Math.floor(b / blocksX) * 8;
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) block[y * 8 + x] = planes.Y[(oy + y) * width + ox + x] - 128;
    }
    dct8x8(block, coefficients);
    for (let i = 0; i < 64; i += 1) {
      coefficients[i] = Math.round(coefficients[i] / table[i]) * table[i];
    }
    idct8x8(coefficients, block);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const value = block[y * 8 + x] + 128;
        planes.Y[(oy + y) * width + ox + x] = value < 0 ? 0 : value > 255 ? 255 : value;
      }
    }
  }
  return fromYCbCr(planes, out);
}

console.log('\nThrough a photograph, and through a messenger re-encoding it');

/* A picture with real structure rather than flat colour: a flat image gives
   the codec nowhere to hide and is not what anybody sends. */
function photograph(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      data[at] = (x * 7 + y * 3) % 256;
      data[at + 1] = (x * 3 + y * 11) % 256;
      data[at + 2] = (x * 13 + y * 5) % 256;
      data[at + 3] = 255;
    }
  }
  return { data, width, height };
}

{
  const fromAlice = carrierFor(alice, null);
  const asBob = carrierFor(bob, bob.pair.privateKey);
  const payload = await fromAlice.buildCarrierPayload({ publicKeyData: bob.publicKeyData }, MESSAGE);
  const image = photograph(1024, 768);
  const hidden = stego.hide(image, payload, { algo: stego.ALGO_DCT, isText: false });
  ok(hidden.ok === true, `the photograph takes it (${payload.length} bytes)`);

  const found = stego.extract(hidden.imageData, { algo: stego.ALGO_DCT });
  ok(found.status === 'ok', 'and gives it back');
  const opened = await asBob.openCarrierPayload(found.payload);
  ok(opened?.text === MESSAGE, 'with the message intact through both layers');
}

/* The one that decides whether this is real. Every messenger re-encodes a
   picture sent as a photo, and the LSB codec dies the moment it does — which
   is why this flow never offers LSB. */
{
  const fromAlice = carrierFor(alice, null);
  const asBob = carrierFor(bob, bob.pair.privateKey);
  const payload = await fromAlice.buildCarrierPayload({ publicKeyData: bob.publicKeyData }, MESSAGE);
  const image = photograph(1024, 768);
  const hidden = stego.hide(image, payload, { algo: stego.ALGO_DCT, isText: false });

  /* The re-encode, done the way stego.js's own suite does it: push the pixels
     through the same 8x8 transform JPEG uses and quantise them. */
  const squeezed = jpegRoundTrip(hidden.imageData, 0.85);
  const found = stego.extract(squeezed, { algo: stego.ALGO_DCT, sourceType: 'jpeg' });
  ok(found.status === 'ok', `it survives being re-compressed (${found.status})`);
  if (found.status === 'ok') {
    const opened = await asBob.openCarrierPayload(found.payload);
    ok(opened?.text === MESSAGE, 'and still decrypts to the same message');
  } else {
    ok(false, 'and still decrypts to the same message');
  }
}

console.log(`\n${failures ? 'FAILED' : 'passed'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
