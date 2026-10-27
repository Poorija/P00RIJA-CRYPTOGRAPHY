/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The panel's own account, changed from the page (tools/panel/server.mjs):
 * the step-up every change asks for, a new password, a new authenticator
 * that only replaces the old one once a code from it is entered, and the
 * sign-ins read back from the audit log. Records are the login file's
 * (tools/panel/login.mjs); nothing here keeps a password or a secret anywhere
 * else.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { makeLogin, checkPassword, checkCode, base32Encode } from './login.mjs';

/* A current code, single-use: one already taken — to sign in or for an
   earlier change — is refused as used, not as wrong, so the page can say
   "wait for the next code". */
export function stepUp(record, code, now = Date.now()) {
  if (!record?.totp) return { ok: false, reason: 'bad-code' };
  const step = checkCode(record.totp, code, { now, lastStep: Number(record.lastStep) || 0 });
  if (step >= 0) return { ok: true, step };
  const anyStep = checkCode(record.totp, code, { now, lastStep: 0 });
  return { ok: false, reason: anyStep >= 0 ? 'code-used' : 'bad-code' };
}

export function changePassword(record, { current, next }) {
  if (!checkPassword(record, record.username, current)) throw new Error('bad-password');
  if (String(next || '').length < 12) throw new Error('too-short');
  const fresh = makeLogin({ username: record.username, password: next });
  return { ...record, v: fresh.v, kdf: fresh.kdf, hash: fresh.hash, passwordChangedAt: new Date().toISOString() };
}

/* The new secret waits beside the old one until a code from it is entered. */
export function beginTotp(record) {
  const secret = base32Encode(crypto.randomBytes(20));
  return { record: { ...record, pendingTotp: secret }, secret };
}

export function confirmTotp(record, code, now = Date.now()) {
  if (!record?.pendingTotp) throw new Error('nothing-pending');
  const step = checkCode(record.pendingTotp, code, { now, lastStep: 0 });
  if (step < 0) throw new Error('bad-code');
  const { pendingTotp, ...rest } = record;
  return { ...rest, totp: pendingTotp, lastStep: step, totpChangedAt: new Date().toISOString() };
}

/* Sign-ins and failures from the audit log, newest first. */
export function history(auditFile, n = 50) {
  let text = '';
  try { text = fs.readFileSync(auditFile, 'utf8'); } catch (_error) { return []; }
  return text.split('\n')
    .map((line) => /^(\S+) (.*)$/.exec(line))
    .filter((match) => match && /^login (\S+ ok from|failed from)/.test(match[2]))
    .slice(-n)
    .reverse()
    .map((match) => ({ at: match[1], line: match[2].slice(0, 200) }));
}
