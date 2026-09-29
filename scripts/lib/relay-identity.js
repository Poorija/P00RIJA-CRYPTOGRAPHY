/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A name a relay cannot lie about.
 *
 * Every address in this app is already self-certifying: a contact is named by
 * the hash of its public key, so the name and the proof are the same object
 * and no directory has to be trusted to connect them. Relays had no such
 * thing. A relay was an origin — a hostname somebody could take over, a
 * certificate somebody could issue, a DNS record somebody could change — and
 * a client had no way to say "the server I am talking to today is the one I
 * talked to yesterday".
 *
 * That is tolerable while a relay is only a socket a client already chose,
 * and it stops being tolerable the moment one relay hands traffic to another:
 * a transit envelope has to be sealed TO a particular relay, and sealing to a
 * hostname seals to whoever holds the hostname.
 *
 * So a relay gets the same kind of name its users have: the hash of a public
 * key it holds the private half of.
 *
 * ECDH rather than a signing key, because every job this key has to do is key
 * agreement. Sealing an envelope to a relay is ECDH. Proving identity is the
 * same ECDH run backwards — seal a random nonce to the claimed key and see
 * whether it comes back — which is the ceremony the relay already runs
 * against clients, one algorithm along. One key, no signature scheme, and
 * nothing to get wrong about which key signs what.
 *
 * P-256 rather than X25519, and the reason is not cryptographic. The client
 * is the one that seals a transit envelope, because the relay it hands that
 * envelope to must not be able to read it — so this key has to be usable from
 * a browser, and the rule for that was already written down in
 * js/chat/19-forward-secrecy.js: P-256, "because that is what every browser's
 * WebCrypto actually has". A key the relay could use and half the clients
 * could not would be a transit path those clients could not take.
 *
 * The id covers this key alone and never changes. A post-quantum key will be
 * added beside it, and adding it must not rename a relay that clients have
 * pinned. That is safe because the hybrid construction combines both shared
 * secrets: an attacker who substitutes the post-quantum key still cannot
 * derive the transit key without the classical private half, which is the
 * half the pinned id covers. That property is the reason the standards bodies
 * recommend hybrids, and it is what lets the classical key carry the name.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const IDENTITY_VERSION = 1;

/** The public half as it travels and as it is hashed: SPKI DER, base64. */
function publicKeyData(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

/** The name. sha256 over the DER, not over the base64, so that a difference
    in padding or line breaks cannot produce two names for one key. */
function relayIdFor(publicKeyDataBase64) {
  return crypto.createHash('sha256')
    .update(Buffer.from(String(publicKeyDataBase64 || ''), 'base64'))
    .digest('hex');
}

/* Sixteen groups of four, which is what a person can actually read aloud to
   somebody on the phone — the point of showing a fingerprint at all. The
   whole 64 characters are shown rather than a prefix: a truncated fingerprint
   is a fingerprint an attacker only has to match part of. */
function formatRelayId(id) {
  return String(id || '').replace(/(.{4})(?=.)/g, '$1 ').trim();
}

/* The post-quantum half, beside the classical one rather than instead of it.
 *
 * The id does NOT cover this key, on purpose: adding it must not rename a
 * relay that clients have already pinned. That is safe because both shared
 * secrets go into one HKDF, so an attacker who substitutes this key still
 * cannot derive anything without the classical private half — the half the
 * pinned id does cover. It is the reason the standards bodies recommend
 * hybrids and the reason the classical key carries the name.
 *
 * Generated even on a relay that will only ever talk to peers without one:
 * a key that exists costs 86 bytes on disk, and a key that does not exist
 * cannot be used the day the other end gains one. */
function generatePqKeys() {
  /* Null on a runtime that does not have ML-KEM, never a throw.
   *
   * This cost a live relay. The key generates on a development machine running
   * Node 26 and the relay image runs Node 20, where the algorithm does not
   * exist — so the first deployment after this was added crash-looped on
   * startup with ERR_INVALID_ARG_VALUE and the relay never came up. A
   * capability checked on the machine that writes the code is not a capability
   * the machine that runs it has.
   *
   * The design already accepts a relay without this key: the link between two
   * relays falls back to classical, says so, and derives a different key so
   * the two modes cannot be confused. That path simply has to be reachable,
   * which means the absence has to be a value rather than an exception. */
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ml-kem-768');
    return {
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    };
  } catch (_error) {
    return null;
  }
}

function generateRelayIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const data = publicKeyData(publicKey);
  const pq = generatePqKeys();
  return {
    version: IDENTITY_VERSION,
    id: relayIdFor(data),
    createdAt: new Date().toISOString(),
    keys: {
      p256: {
        publicKey: data,
        privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      },
      /* Omitted entirely rather than stored as null, so the file says what it
         has rather than what it lacks. */
      ...(pq ? { mlkem768: pq } : {}),
    },
  };
}

/** Rejects anything whose stored id does not match its stored key, because a
    record that names itself after a key it does not hold is the one shape
    that would let a tampered file rename a relay quietly. */
function readRelayIdentity(file) {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stored = saved?.keys?.p256;
  if (!stored?.publicKey || !stored?.privateKey) throw new Error('identity file has no P-256 key');
  if (relayIdFor(stored.publicKey) !== String(saved.id || '')) {
    throw new Error('identity file id does not match its own public key');
  }
  /* A relay that predates the post-quantum half grows one, and keeps its
     name: the id is the hash of the classical key alone, so nothing that was
     pinned changes. The caller writes it back. */
  if (!saved.keys?.mlkem768?.publicKey || !saved.keys?.mlkem768?.privateKey) {
    const pq = generatePqKeys();
    if (pq) {
      saved.keys = { ...saved.keys, mlkem768: pq };
      saved.grewPqKey = true;
    }
  }
  return saved;
}

/* Loaded once at start and kept for the life of the process.
 *
 * A relay that generated a new identity on every restart would be a relay no
 * client could ever pin and no other relay could ever seal to, so failing to
 * persist is reported loudly rather than swallowed: the process still runs —
 * a relay that refuses to start because it cannot write a file is worse for
 * its users than one that runs with a name that will change — but nobody
 * finds out by accident. */
function loadOrCreateRelayIdentity(file, { log = console } = {}) {
  try {
    if (fs.existsSync(file)) {
      const saved = readRelayIdentity(file);
      if (saved.grewPqKey) {
        delete saved.grewPqKey;
        try {
          fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
          fs.chmodSync(file, 0o600);
          log.log?.('[Relay] Added a post-quantum key beside the existing identity; the relay keeps its name.');
        } catch (writeError) {
          log.warn?.(`[Relay] Could not store the new post-quantum key (${writeError?.message || writeError}); `
            + 'it will be generated again on the next restart.');
        }
      }
      return { ...saved, source: 'file' };
    }
  } catch (error) {
    log.warn?.(`[Relay] The stored relay identity could not be used (${error?.message || error}). `
      + 'Generating a new one — clients that pinned the old one will report a change.');
  }
  const identity = generateRelayIdentity();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 });
    /* An earlier run, a different umask or a restored backup can leave the
       file readable by more than the owner, and writeFileSync's mode applies
       only when it creates the file. */
    fs.chmodSync(file, 0o600);
  } catch (error) {
    log.warn?.(`[Relay] The relay identity could not be stored at ${file} (${error?.message || error}). `
      + 'It will change on the next restart.');
    return { ...identity, source: 'ephemeral' };
  }
  return { ...identity, source: 'generated' };
}

/** What a relay tells anybody who asks. Never the private half. */
function publicRelayIdentity(identity) {
  return {
    version: IDENTITY_VERSION,
    id: String(identity?.id || ''),
    algorithm: 'p-256',
    publicKey: String(identity?.keys?.p256?.publicKey || ''),
    /* Published beside the name rather than inside it. A peer that has no use
       for it ignores the field; one that does mixes it in. */
    pqAlgorithm: identity?.keys?.mlkem768?.publicKey ? 'ml-kem-768' : '',
    pqPublicKey: String(identity?.keys?.mlkem768?.publicKey || ''),
    createdAt: String(identity?.createdAt || ''),
  };
}

/** The post-quantum private half, for decapsulating what a peer sent. */
function relayPqPrivateKey(identity) {
  const stored = String(identity?.keys?.mlkem768?.privateKey || '');
  if (!stored) return null;
  return crypto.createPrivateKey({ key: Buffer.from(stored, 'base64'), format: 'der', type: 'pkcs8' });
}

/** A peer's post-quantum public half, for encapsulating to them. */
function relayPqPublicKeyFrom(publicKeyDataBase64) {
  if (!publicKeyDataBase64) return null;
  return crypto.createPublicKey({
    key: Buffer.from(String(publicKeyDataBase64), 'base64'), format: 'der', type: 'spki',
  });
}

/** The private half as a KeyObject, for the ECDH this identity exists to do. */
function relayPrivateKey(identity) {
  return crypto.createPrivateKey({
    key: Buffer.from(String(identity?.keys?.p256?.privateKey || ''), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Somebody else's public half, from the bundle they published. */
function relayPublicKeyFrom(publicKeyDataBase64) {
  return crypto.createPublicKey({
    key: Buffer.from(String(publicKeyDataBase64 || ''), 'base64'),
    format: 'der',
    type: 'spki',
  });
}

module.exports = {
  IDENTITY_VERSION,
  relayIdFor,
  formatRelayId,
  generateRelayIdentity,
  loadOrCreateRelayIdentity,
  publicRelayIdentity,
  relayPrivateKey,
  relayPublicKeyFrom,
  relayPqPrivateKey,
  relayPqPublicKeyFrom,
};
