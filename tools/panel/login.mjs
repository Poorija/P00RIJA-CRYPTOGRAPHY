/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The web panel's login (docs/CONTROL-PANEL.md, "Logging in").
 *
 * A name, a password and a six-digit code from an authenticator app. The
 * password is kept only as a scrypt hash; the code is RFC 6238 TOTP (SHA-1,
 * 30 seconds, six digits, one step either side for a clock that drifts),
 * and a code once taken is spent: the last step used is written down, and a
 * code from that step or an earlier one is refused.
 */
import crypto from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const STEP_MS = 30000;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of String(text || '').toUpperCase().replace(/[\s=-]/g, '')) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/* The code for one 30-second step. */
export function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const at = mac[mac.length - 1] & 15;
  const number = (mac.readUInt32BE(at) & 0x7fffffff) % 1000000;
  return String(number).padStart(6, '0');
}

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* The step a code belongs to, if it is good now and newer than lastStep; -1 if not. */
export function checkCode(secret, code, { now = Date.now(), lastStep = 0 } = {}) {
  const given = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return -1;
  const current = Math.floor(now / STEP_MS);
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && same(totp(secret, step), given)) return step;
  }
  return -1;
}

const hashOf = (password, salt, params) => crypto.scryptSync(String(password), salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem });

export function makeLogin({ username, password }) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9._@-]{1,64}$/.test(name)) throw new Error('a name of letters, digits and . _ @ - (up to 64)');
  if (String(password || '').length < 12) throw new Error('the password needs at least 12 characters');
  const salt = crypto.randomBytes(16);
  return {
    v: 1,
    username: name,
    kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
    hash: hashOf(password, salt, SCRYPT).toString('base64'),
    totp: base32Encode(crypto.randomBytes(20)),
    lastStep: 0,
    createdAt: new Date().toISOString(),
  };
}

/* Whether a name and password are this login's. The hash is worked out even
   for a wrong name, so a wrong name takes as long as a wrong password. */
export function checkPassword(record, username, password) {
  const params = record?.kdf || SCRYPT;
  const salt = record?.kdf?.salt ? Buffer.from(record.kdf.salt, 'base64') : Buffer.alloc(16);
  const got = hashOf(password, salt, params);
  const want = record?.hash ? Buffer.from(record.hash, 'base64') : Buffer.alloc(32);
  const passwordOk = got.length === want.length && crypto.timingSafeEqual(got, want);
  return passwordOk && Boolean(record?.username) && same(String(username || ''), record.username);
}

/* What an authenticator app reads from a QR code or takes typed in. */
export const otpauthUri = (record, issuer = 'P00RIJA Panel') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(record.username)}?secret=${record.totp}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
