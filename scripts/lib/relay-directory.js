/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The directory of a relay family: the relays one operator runs, signed by
 * that operator's key (docs/RELAY-NETWORK.md, "Relay families").
 *
 * A relay that trusts an operator links by itself with every relay that
 * operator's newest directory names, and drops what a newer one leaves out or
 * revokes. Nothing here touches the network: this file says whether a
 * directory may be believed and what believing it changes; the relay does the
 * rest.
 *
 * The key is P-256, the curve the relays' own identities and the browsers
 * already use, and the operator is named the way a relay is: the SHA-256 of
 * the key's SPKI bytes. A signature covers one exact serialisation of the
 * body — keys sorted at every level, no whitespace — so the operator's tool,
 * every relay, and later the apps all sign and check the same bytes.
 */
'use strict';

const crypto = require('crypto');
const { relayIdFor } = require('./relay-identity.js');

const HEX64 = /^[a-f0-9]{64}$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const operatorIdFor = (spkiBase64) => relayIdFor(spkiBase64);

function signDirectory(body, privateKey) {
  const sig = crypto.sign('sha256', Buffer.from(canonicalJson(body), 'utf8'), privateKey).toString('base64');
  return { body, sig };
}

function wellFormed(doc) {
  const body = doc?.body;
  if (!body || typeof body !== 'object' || typeof doc.sig !== 'string' || !doc.sig) return false;
  if (body.v !== 1 || !Number.isSafeInteger(body.serial) || body.serial < 1) return false;
  if (typeof body.operator?.key !== 'string' || !HEX64.test(String(body.operator?.id || ''))) return false;
  if (!Array.isArray(body.relays) || !Array.isArray(body.revoked)) return false;
  if (!body.relays.every((relay) => relay && HEX64.test(String(relay.id || '')) && (relay.origins === undefined || Array.isArray(relay.origins)))) return false;
  return body.revoked.every((id) => HEX64.test(String(id || '')));
}

function signatureHolds(doc, operatorKey) {
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.from(operatorKey, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify('sha256', Buffer.from(canonicalJson(doc.body), 'utf8'), publicKey, Buffer.from(doc.sig, 'base64'));
  } catch (_error) {
    return false;
  }
}

/* In this order: shape, whose, signature, contradiction, age, membership. A
   rival body is only "the operator's mistake" once its signature is known to
   be the operator's. */
function verifyDirectory(doc, { operatorKey, selfId, heldSerial = 0, heldBody = null } = {}) {
  if (!wellFormed(doc)) return { ok: false, reason: 'malformed' };
  const body = doc.body;
  if (body.operator.key !== operatorKey || body.operator.id !== operatorIdFor(operatorKey)) return { ok: false, reason: 'wrong-operator' };
  if (!signatureHolds(doc, operatorKey)) return { ok: false, reason: 'bad-signature' };
  const revoked = new Set(body.revoked);
  if (body.relays.some((relay) => revoked.has(relay.id))) return { ok: false, reason: 'revoked-and-listed' };
  if (body.serial < heldSerial) return { ok: false, reason: 'stale' };
  if (body.serial === heldSerial) {
    const differs = heldBody && canonicalJson(heldBody) !== canonicalJson(body);
    return { ok: false, reason: differs ? 'same-serial-different-body' : 'stale' };
  }
  if (!body.relays.some((relay) => relay.id === selfId)) return { ok: false, reason: 'not-a-member' };
  return { ok: true, directory: body };
}

/* What believing a directory changes for one relay: every other member is
   allowed (and dialled where it has an address); whatever an earlier
   directory added and this one no longer names, and every revoked id, goes. */
function planChanges(directory, selfId, previouslyAdded = new Set()) {
  const allow = directory.relays
    .filter((relay) => relay.id !== selfId)
    .map((relay) => ({ id: relay.id, origins: (relay.origins || []).map(String).join('|') }));
  const named = new Set(directory.relays.map((relay) => relay.id));
  const drop = new Set(directory.revoked);
  for (const id of previouslyAdded) if (!named.has(id)) drop.add(id);
  drop.delete(selfId);
  return { allow, drop: Array.from(drop) };
}

module.exports = { canonicalJson, operatorIdFor, signDirectory, verifyDirectory, planChanges };
