/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The envelope a relay carries without knowing who it is for.
 *
 * A client that wants to reach somebody on another relay could simply ask its
 * own relay to pass the message along. Then the relay it asked knows the
 * recipient, and the whole point is gone: the social graph is exactly what a
 * relay inside one jurisdiction must not be able to assemble.
 *
 * So the client seals the real envelope to the RECIPIENT'S relay, and hands
 * its own relay something it cannot open:
 *
 *     { type: 'transit', v: 1, toRelay, eph, iv, ct }
 *
 * That is the whole of what the carrying relay learns — which relay to pass
 * it to, how big it is, and when. Not the recipient, not the content, not
 * even whether the two ends have spoken before.
 *
 * Three things the format does deliberately:
 *
 *   The recipient relay's id is the AAD. An envelope sealed for one relay
 *   cannot be replayed at another: the tag will not verify, and it fails as
 *   "this did not open" rather than "this was not for you", which would be an
 *   oracle.
 *
 *   The plaintext is padded to a multiple of 512 bytes before sealing. Length
 *   is the cheapest thing to measure on the wire and the easiest to hide.
 *   Honestly: this hides SIZE and not TIMING, and an adversary watching both
 *   relays can still correlate. The design does not claim otherwise.
 *
 *   An expiry travels inside the seal. A carrying relay that held envelopes
 *   back and released them later would otherwise be replaying traffic into a
 *   conversation weeks after the fact, and the recipient's relay has no other
 *   way to notice.
 *
 * The inner envelope is byte for byte the message the recipient's relay
 * already knows how to deliver. This layer is a shell around code that is
 * already exercised, not a second delivery path — a second one is where the
 * difference between them becomes the bug.
 */
const crypto = require('node:crypto');
const { sealTo, openSealed } = require('./relay-link.js');

const TRANSIT_VERSION = 1;
const TRANSIT_AAD = 'poorija-transit-v1';
/* Small enough that a short message does not pay much for it, large enough
   that lengths bunch into few buckets. */
const PAD_BUCKET = 512;
const LENGTH_PREFIX = 4;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/* Above the link's own ceiling, so a refusal here is about this envelope and
   not about the frame that carried it. */
const MAX_INNER_BYTES = 24 * 1024 * 1024;

function aadFor(relayId) {
  return `${TRANSIT_AAD}|${String(relayId || '').toLowerCase()}`;
}

/* [4-byte big-endian length][json][zeros]. The length prefix is what makes
   the padding removable without guessing, and zeros are as good as anything
   because nothing reads them. */
function padded(json) {
  const body = Buffer.from(json, 'utf8');
  if (body.length > MAX_INNER_BYTES) throw new Error('transit payload is too large');
  const total = Math.ceil((LENGTH_PREFIX + body.length) / PAD_BUCKET) * PAD_BUCKET;
  const out = Buffer.alloc(total);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, LENGTH_PREFIX);
  return out;
}

function unpadded(buffer) {
  if (buffer.length < LENGTH_PREFIX) throw new Error('transit payload is truncated');
  const length = buffer.readUInt32BE(0);
  if (length > MAX_INNER_BYTES || LENGTH_PREFIX + length > buffer.length) {
    throw new Error('transit payload claims a length it does not have');
  }
  return buffer.subarray(LENGTH_PREFIX, LENGTH_PREFIX + length).toString('utf8');
}

/** Seals `inner` to the relay named by `toRelay`, whose public key is
    `relayPublicKeyData`. The caller is responsible for having checked that
    the key really is that relay's — the id is the hash of the key, so it can
    always be checked, and sealing to an unchecked key seals to whoever
    supplied it. */
function sealTransit(toRelay, relayPublicKeyData, inner, { ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const relayId = String(toRelay || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(relayId)) throw new Error('transit needs a relay id to seal to');
  const body = padded(JSON.stringify({ exp: now() + ttlMs, inner }));
  const sealed = sealTo(relayPublicKeyData, body, aadFor(relayId));
  return { type: 'transit', v: TRANSIT_VERSION, toRelay: relayId, ...sealed };
}

/** Opens an envelope addressed to this relay. Throws on anything wrong, and
    every throw looks the same from outside on purpose. */
function openTransit(privateKey, relayId, envelope, { now = Date.now } = {}) {
  if (Number(envelope?.v) !== TRANSIT_VERSION) throw new Error('unsupported transit version');
  const mine = String(relayId || '').toLowerCase();
  if (String(envelope?.toRelay || '').toLowerCase() !== mine) {
    throw new Error('transit envelope is addressed elsewhere');
  }
  const body = openSealed(privateKey, envelope, aadFor(mine));
  const parsed = JSON.parse(unpadded(body));
  if (!Number.isFinite(parsed?.exp)) throw new Error('transit envelope has no expiry');
  if (parsed.exp < now()) throw new Error('transit envelope has expired');
  if (!parsed.inner || typeof parsed.inner !== 'object') throw new Error('transit envelope is empty');
  return parsed.inner;
}

/** Everything a carrying relay is entitled to know, and the shape it needs to
    decide whether to pass this on. Used where an envelope is logged or
    counted, so that the answer to "what did the ingress relay see?" is one
    function rather than an audit of every call site. */
function transitFacts(envelope) {
  return {
    toRelay: String(envelope?.toRelay || '').toLowerCase(),
    bytes: Buffer.byteLength(String(envelope?.ct || ''), 'utf8'),
  };
}

module.exports = {
  TRANSIT_VERSION,
  PAD_BUCKET,
  DEFAULT_TTL_MS,
  MAX_INNER_BYTES,
  sealTransit,
  openTransit,
  transitFacts,
  aadFor,
};
