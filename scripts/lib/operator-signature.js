/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Signed dashboard requests (docs/MONITOR-SERVER.md, "Managing all your
 * servers from one place").
 *
 * The actions on a relay's dashboard that can do harm (kick people, change
 * the password, approve a partner, restore a backup, apply a release) may
 * carry a signature from a key on the admin's own computer: the operator key,
 * or an admin key the operator listed in the family's signed directory. A
 * relay that is locked takes those actions only signed, so a dashboard
 * password that leaks no longer reaches them.
 *
 * The signature covers the method, the path, a hash of the body, the time, a
 * nonce and the relay it is for, so it cannot be moved to another action,
 * another relay, or another moment. Nothing here touches the network.
 */
'use strict';

const crypto = require('crypto');
const { canonicalJson } = require('./relay-directory.js');
const { relayIdFor } = require('./relay-identity.js');

const HEX64 = /^[a-f0-9]{64}$/;
const WINDOW_MS = 2 * 60 * 1000;

/* What a locked relay refuses unsigned. Reading is never on it. */
const DANGEROUS_PATHS = new Set([
  '/admin/kick-peer', '/admin/suspend-peer', '/admin/resume-peer', '/admin/unkick-peer',
  '/admin/broadcast', '/admin/change-password', '/admin/clear-offline', '/admin/clear-memory',
  '/admin/allowlist-mode', '/admin/allowlist-add', '/admin/allowlist-remove',
  '/Monitor_Server/queue-drop', '/Monitor_Server/queue-flush', '/Monitor_Server/announce',
  '/Monitor_Server/transit-add', '/Monitor_Server/transit-remove',
  '/Monitor_Server/partners/request', '/Monitor_Server/partners/approve', '/Monitor_Server/partners/reject',
  '/Monitor_Server/partners/remove', '/Monitor_Server/partners/carry', '/Monitor_Server/gateways',
  '/Monitor_Server/ops-memory-set', '/Monitor_Server/ops-cleanup', '/Monitor_Server/ops-image-update',
  /* Making a backup also prunes the oldest ones. */
  '/Monitor_Server/ops-backup-create',
  '/Monitor_Server/ops-stack-restart', '/Monitor_Server/ops-backup-delete', '/Monitor_Server/ops-backup-restore',
  '/Monitor_Server/ops-backup-download', '/Monitor_Server/ops-image-export', '/Monitor_Server/ops-bundle',
  '/Monitor_Server/ops-github-apply', '/Monitor_Server/ops-github-rollback', '/Monitor_Server/bootstrap-token',
]);

/* The router matches paths without regard to case and with or without a
   trailing slash, so the list is consulted, and paths are signed, in one
   spelling: lower case, single slashes, no slash at the end. Any other
   spelling of a dangerous path is still the dangerous path. */
function normalizePath(path) {
  const cleaned = String(path || '').toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return cleaned || '/';
}
const NORMALIZED = new Set(Array.from(DANGEROUS_PATHS, normalizePath));
const isDangerous = (path) => NORMALIZED.has(normalizePath(path));

const bodyHash = (body) => crypto.createHash('sha256').update(canonicalJson(body ?? {}), 'utf8').digest('hex');

const signedFields = ({ method, path, body, relay, at, nonce }) => ({
  v: 1,
  method: String(method || '').toUpperCase(),
  path: normalizePath(path),
  body: bodyHash(body),
  at,
  nonce,
  relay,
});

/* The exact text a signature covers. A browser builds the same text and signs
   it with WebCrypto (tools/panel/web/sign.js). */
const requestText = (fields) => canonicalJson(signedFields(fields));

/* `v1.<keyId>.<at>.<nonce>.<signature>`, for the X-Operator-Signature header. */
function signRequest({ method, path, body, relay, at = Date.now(), nonce = crypto.randomBytes(16).toString('hex') }, { keyId, privateKey }) {
  const fields = signedFields({ method, path, body, relay, at, nonce });
  const signature = crypto.sign('sha256', Buffer.from(canonicalJson(fields), 'utf8'), privateKey).toString('base64');
  return `v1.${keyId}.${at}.${nonce}.${signature}`;
}

/* In this order: shape, whose key, signature, age, and whether it was heard
   before. The relay is part of what is signed, so a signature made for
   another relay simply does not hold here. */
function verifyRequest(header, { method, path, body, relay, now = Date.now(), keys = new Map(), nonceSeen = () => false } = {}) {
  const parts = String(header || '').split('.');
  if (parts.length !== 5 || parts[0] !== 'v1' || !HEX64.test(parts[1]) || !/^\d{10,16}$/.test(parts[2])
    || !/^[a-f0-9]{32}$/.test(parts[3]) || !/^[A-Za-z0-9+/]+=*$/.test(parts[4])) {
    return { ok: false, reason: 'malformed' };
  }
  const [, keyId, atText, nonce, signature] = parts;
  const signer = keys.get(keyId);
  if (!signer) return { ok: false, reason: 'unknown-key' };
  const at = Number(atText);
  let holds = false;
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.from(signer.key, 'base64'), format: 'der', type: 'spki' });
    const raw = Buffer.from(signature, 'base64');
    /* 64 bytes is the raw r||s WebCrypto gives; anything else is DER. */
    holds = crypto.verify('sha256', Buffer.from(requestText({ method, path, body, relay, at, nonce }), 'utf8'),
      raw.length === 64 ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey, raw);
  } catch (_error) {
    holds = false;
  }
  if (!holds) return { ok: false, reason: 'bad-signature' };
  if (Math.abs(now - at) > WINDOW_MS) return { ok: false, reason: 'stale' };
  if (nonceSeen(nonce)) return { ok: false, reason: 'replayed' };
  return { ok: true, keyId, name: signer.name, nonce };
}

/* The keys a relay takes signatures from: its operator key, and the admin
   keys that key listed in the directory — each only when its id is the hash
   of its key, as every id in this project is. */
function signingKeys(directoryBody, operatorKey) {
  const keys = new Map();
  if (operatorKey) keys.set(relayIdFor(operatorKey), { key: operatorKey, name: 'operator' });
  for (const admin of Array.isArray(directoryBody?.admins) ? directoryBody.admins : []) {
    const key = String(admin?.key || '');
    const id = String(admin?.id || '');
    if (!key || !HEX64.test(id) || relayIdFor(key) !== id) continue;
    keys.set(id, { key, name: String(admin.name || '').slice(0, 64) || id.slice(0, 12) });
  }
  return keys;
}

module.exports = { DANGEROUS_PATHS, WINDOW_MS, normalizePath, isDangerous, bodyHash, requestText, signRequest, verifyRequest, signingKeys };
