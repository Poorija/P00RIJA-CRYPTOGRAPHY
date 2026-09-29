/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* An authenticated link between two relays.
 *
 * Two jobs, and the second is the one that is easy to skip:
 *
 *   1. each end learns WHICH relay it is talking to — not which hostname
 *      answered, which is all TLS can say, and not which id was claimed,
 *      which is free to claim.
 *   2. the frames that follow are bound to that handshake. Without this a
 *      machine in the middle can pass the whole challenge and response
 *      through untouched, let both ends conclude they authenticated each
 *      other — which they did, through the middle — and then inject frames
 *      of its own. TLS between relays is often a certificate one of the
 *      operators signed themselves, so this is not a hypothetical.
 *
 * The shape is a two-pass challenge over the relays' static keys — P-256,
 * see relay-identity.js for why — which is the ceremony the relay already
 * runs against clients, one algorithm along:
 *
 *   A -> B   hello   idA, pubA, ephA, sealed(nonceA -> pubB)
 *   B -> A   proof   idB, pubB, ephB, nonceA, sealed(nonceB -> pubA)
 *   A -> B   proof   nonceB
 *
 * Returning nonceA proves B holds the private half of pubB, because nothing
 * else can derive the key it was sealed under. Returning nonceB proves the
 * same of A. Both ends then derive
 *
 *   link = HKDF( ss_A || ss_B, salt = nonceA || nonceB, info = v1 | idA | idB )
 *
 * from BOTH exchanges, so the key depends on both static keys. A machine in
 * the middle holds neither and can drop frames but cannot read or forge one.
 *
 * sealTo/openSealed below are the same primitive a transit envelope is sealed
 * with. One construction, used twice, rather than two that have to be audited
 * separately.
 */
const crypto = require('node:crypto');

const LINK_VERSION = 1;
const SEAL_INFO = 'poorija-relay-seal-v1';
const LINK_INFO = 'poorija-relay-link-v1';
const NONCE_BYTES = 32;
const KEY_BYTES = 32;
const IV_BYTES = 12;

function hkdf(secret, salt, info, length = KEY_BYTES) {
  return Buffer.from(crypto.hkdfSync('sha256', secret, salt, Buffer.from(info, 'utf8'), length));
}

function publicKeyFrom(data) {
  return crypto.createPublicKey({
    key: Buffer.isBuffer(data) ? data : Buffer.from(String(data || ''), 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function exportPublic(key) {
  return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

/* The post-quantum half of the handshake.
 *
 * Each side encapsulates a secret to the other's ML-KEM key and both secrets
 * join the two ECDH ones in a single HKDF. An adversary recording today and
 * breaking P-256 in twenty years still needs the ML-KEM secrets, and one
 * breaking ML-KEM still needs the ECDH ones: the key falls only if BOTH do.
 *
 * Absent on either side means the link is classical, which is not an error —
 * a relay built before this still has to be able to link — but it is
 * reported rather than assumed, and the two modes derive different keys so
 * one can never be mistaken for the other. */
function encapsulateTo(pqPublicKeyData) {
  if (!pqPublicKeyData) return null;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(String(pqPublicKeyData), 'base64'), format: 'der', type: 'spki',
    });
    const { sharedKey, ciphertext } = crypto.encapsulate(key);
    return { secret: Buffer.from(sharedKey), ct: Buffer.from(ciphertext).toString('base64') };
  } catch (_error) {
    /* A key this build cannot use is the same as no key: the link goes
       classical rather than failing. */
    return null;
  }
}

/* Note what this does NOT tell you. ML-KEM answers a ciphertext it cannot
   really open with a different secret rather than an error — implicit
   rejection is part of the design — so a wrong key here is silent. It
   surfaces one step later: the two ends derive different link keys and the
   link carries nothing. That is the honest reading of the `hybrid` flag too.
   It says both ends had post-quantum material in play, not that they agreed;
   if they did not, no frame opens and the link is useless rather than
   quietly weak. */
function decapsulateWith(pqPrivateKey, ciphertextBase64) {
  if (!pqPrivateKey || !ciphertextBase64) return null;
  try {
    return Buffer.from(crypto.decapsulate(pqPrivateKey, Buffer.from(String(ciphertextBase64), 'base64')));
  } catch (_error) {
    return null;
  }
}

/* One-shot seal to a relay's static key. An ephemeral key per seal is what
   makes it forward-secret against a later compromise of the static private
   half: the shared secret exists only inside this call.
   `aad` binds the ciphertext to context that is NOT secret but must not be
   swapped — the recipient id on a transit envelope, so an envelope cannot be
   replayed at a different relay. */
function sealTo(recipientPublicKeyData, plaintext, aad = '') {
  const recipient = publicKeyFrom(recipientPublicKeyData);
  const ephemeral = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const shared = crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const ephemeralPublic = exportPublic(ephemeral.publicKey);
  /* The ephemeral public key is the salt, so two seals with the same shared
     secret — which cannot happen, but this costs nothing — cannot collide. */
  const key = hkdf(shared, Buffer.from(ephemeralPublic, 'base64'), SEAL_INFO);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    eph: ephemeralPublic,
    iv: iv.toString('base64'),
    ct: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
  };
}

/* Throws on a seal that does not open. Callers drop the frame rather than
   answering differently: a distinguishable refusal is an oracle. */
function openSealed(privateKey, sealed, aad = '') {
  const ephemeral = publicKeyFrom(sealed?.eph);
  const shared = crypto.diffieHellman({ privateKey, publicKey: ephemeral });
  const key = hkdf(shared, Buffer.from(String(sealed.eph), 'base64'), SEAL_INFO);
  const raw = Buffer.from(String(sealed.ct || ''), 'base64');
  if (raw.length < 16) throw new Error('sealed payload is too short to carry a tag');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(sealed.iv || ''), 'base64'));
  if (aad) cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  cipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([cipher.update(raw.subarray(0, raw.length - 16)), cipher.final()]);
}

/* ---- the handshake --------------------------------------------------- */

/** Step 1, on the dialling relay. `peerPublicKeyData` is the key it fetched
    from the relay it means to reach, already checked against the id it
    dialled — an unchecked key here would authenticate whoever answered. */
function startLink(identity, peerPublicKeyData, peerPqPublicKeyData = '') {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const pq = encapsulateTo(peerPqPublicKeyData);
  const ephemeral = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ephemeralPublic = exportPublic(ephemeral.publicKey);
  const shared = crypto.diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: publicKeyFrom(peerPublicKeyData),
  });
  const key = hkdf(shared, Buffer.from(ephemeralPublic, 'base64'), SEAL_INFO);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(nonce), cipher.final()]);
  return {
    state: {
      nonce, shared, ephemeralPublic, peerPublicKeyData: String(peerPublicKeyData),
      pqSecret: pq?.secret || null,
    },
    hello: {
      v: LINK_VERSION,
      from: identity.id,
      fromKey: identity.publicKey,
      /* Unauthenticated by the id on purpose — see generatePqKeys in
         relay-identity.js for why that is safe in a hybrid. */
      fromPqKey: identity.pqPublicKey || '',
      eph: ephemeralPublic,
      ...(pq ? { kem: pq.ct } : {}),
      challenge: {
        iv: iv.toString('base64'),
        ct: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
      },
    },
  };
}

/** The id a key produces. The only name a relay cannot choose for itself. */
function idForKey(publicKeyData) {
  return crypto.createHash('sha256')
    .update(Buffer.from(String(publicKeyData || ''), 'base64')).digest('hex');
}

/** Step 2, on the answering relay: open the challenge, answer it, ask its
    own. Throws if the hello is malformed or the challenge does not open. */
function answerLink(identity, privateKey, hello, pqPrivateKey = null) {
  if (Number(hello?.v) !== LINK_VERSION) throw new Error('unsupported link version');
  const peerKey = String(hello?.fromKey || '');
  if (!peerKey) throw new Error('hello carries no key');
  if (idForKey(peerKey) !== String(hello?.from || '')) {
    throw new Error('hello claims an id its key does not produce');
  }
  const theirNonce = openSealed(privateKey, { ...hello.challenge, eph: hello.eph });
  if (theirNonce.length !== NONCE_BYTES) throw new Error('challenge is the wrong size');

  /* Their secret to us, and ours to them. Both must be present for the link
     to count as hybrid; one alone would be a mode neither end agreed to. */
  const theirPq = decapsulateWith(pqPrivateKey, hello?.kem);
  const ourPq = encapsulateTo(hello?.fromPqKey);

  const nonce = crypto.randomBytes(NONCE_BYTES);
  const ephemeral = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ephemeralPublic = exportPublic(ephemeral.publicKey);
  const shared = crypto.diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: publicKeyFrom(peerKey),
  });
  const key = hkdf(shared, Buffer.from(ephemeralPublic, 'base64'), SEAL_INFO);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(nonce), cipher.final()]);

  const theirShared = crypto.diffieHellman({ privateKey, publicKey: publicKeyFrom(hello.eph) });
  return {
    peerId: String(hello.from),
    peerPublicKeyData: peerKey,
    state: {
      nonce, shared, theirShared, theirNonce, peerId: String(hello.from), ownId: identity.id,
      pqSecret: ourPq?.secret || null, theirPqSecret: theirPq || null,
    },
    proof: {
      v: LINK_VERSION,
      from: identity.id,
      fromKey: identity.publicKey,
      fromPqKey: identity.pqPublicKey || '',
      eph: ephemeralPublic,
      ...(ourPq ? { kem: ourPq.ct } : {}),
      answer: theirNonce.toString('base64'),
      challenge: {
        iv: iv.toString('base64'),
        ct: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
      },
    },
  };
}

/** Step 3, back on the dialling relay: check the answer, answer theirs, and
    derive the key. `expectedPeerId` is the relay it MEANT to reach — without
    it, a relay that answers is authenticated as itself rather than as the one
    that was wanted, which is not the same thing at all. */
function finishLink(identity, privateKey, state, proof, expectedPeerId, pqPrivateKey = null) {
  if (Number(proof?.v) !== LINK_VERSION) throw new Error('unsupported link version');
  const peerKey = String(proof?.fromKey || '');
  if (idForKey(peerKey) !== String(proof?.from || '')) {
    throw new Error('proof claims an id its key does not produce');
  }
  if (String(expectedPeerId || '') !== String(proof.from)) {
    throw new Error('a different relay answered than the one that was dialled');
  }
  if (peerKey !== state.peerPublicKeyData) {
    throw new Error('the answering relay presented a different key than the one dialled');
  }
  const answered = Buffer.from(String(proof.answer || ''), 'base64');
  if (answered.length !== state.nonce.length || !crypto.timingSafeEqual(answered, state.nonce)) {
    throw new Error('the answering relay did not open the challenge');
  }
  const theirNonce = openSealed(privateKey, { ...proof.challenge, eph: proof.eph });
  if (theirNonce.length !== NONCE_BYTES) throw new Error('challenge is the wrong size');
  const theirShared = crypto.diffieHellman({ privateKey, publicKey: publicKeyFrom(proof.eph) });
  const theirPq = decapsulateWith(pqPrivateKey, proof?.kem);
  const hybrid = Boolean(state.pqSecret && theirPq);
  return {
    peerId: String(proof.from),
    peerPublicKeyData: peerKey,
    hybrid,
    answer: { v: LINK_VERSION, answer: theirNonce.toString('base64') },
    key: linkKey({
      dialerId: identity.id,
      answererId: String(proof.from),
      dialerShared: state.shared,
      answererShared: theirShared,
      dialerNonce: state.nonce,
      answererNonce: theirNonce,
      dialerPq: state.pqSecret,
      answererPq: theirPq,
    }),
  };
}

/** On the answering relay, once the dialler returns the second nonce. */
function confirmLink(state, answer) {
  const returned = Buffer.from(String(answer?.answer || ''), 'base64');
  if (returned.length !== state.nonce.length || !crypto.timingSafeEqual(returned, state.nonce)) {
    throw new Error('the dialling relay did not open the challenge');
  }
  return {
    hybrid: Boolean(state.pqSecret && state.theirPqSecret),
    key: linkKey({
      dialerId: state.peerId,
      answererId: state.ownId,
      dialerShared: state.theirShared,
      answererShared: state.shared,
      dialerNonce: state.theirNonce,
      answererNonce: state.nonce,
      dialerPq: state.theirPqSecret,
      answererPq: state.pqSecret,
    }),
  };
}

/* Both exchanges and both nonces, in an order both ends agree on without
   having to negotiate one: the dialler is always first. */
function linkKey({
  dialerId, answererId, dialerShared, answererShared, dialerNonce, answererNonce,
  dialerPq = null, answererPq = null,
}) {
  const hybrid = Boolean(dialerPq && answererPq);
  /* The mode is in the info string, so a classical handshake and a hybrid one
     can never derive the same key even from the same ECDH secrets. */
  return hkdf(
    hybrid
      ? Buffer.concat([dialerShared, answererShared, dialerPq, answererPq])
      : Buffer.concat([dialerShared, answererShared]),
    Buffer.concat([dialerNonce, answererNonce]),
    `${LINK_INFO}|${hybrid ? 'hybrid' : 'classical'}|${dialerId}|${answererId}`,
  );
}

/* ---- the record layer ------------------------------------------------ */

/* One key per direction and a counter per frame, so a frame cannot be
   replayed back at its sender or reordered inside the link. The counter is
   the IV, which is safe precisely because it never repeats under one key. */
function linkCipher(key, role) {
  const outgoing = hkdf(key, Buffer.alloc(0), `${LINK_INFO}:${role === 'dialer' ? 'a2b' : 'b2a'}`);
  const incoming = hkdf(key, Buffer.alloc(0), `${LINK_INFO}:${role === 'dialer' ? 'b2a' : 'a2b'}`);
  let sent = 0n;
  let received = -1n;

  const ivFor = (counter) => {
    const iv = Buffer.alloc(IV_BYTES);
    iv.writeBigUInt64BE(counter, IV_BYTES - 8);
    return iv;
  };

  return {
    seal(payload) {
      const counter = sent;
      sent += 1n;
      const cipher = crypto.createCipheriv('aes-256-gcm', outgoing, ivFor(counter));
      const body = Buffer.concat([
        cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
        cipher.final(),
      ]);
      return {
        n: counter.toString(),
        ct: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
      };
    },
    open(frame) {
      const counter = BigInt(String(frame?.n ?? '-1'));
      /* Strictly increasing rather than merely unseen: a link is one ordered
         stream, so an out-of-order frame is either an attack or a broken
         peer, and neither is worth a buffer to hold it in. */
      if (counter <= received) throw new Error('link frame is out of order or replayed');
      const raw = Buffer.from(String(frame?.ct || ''), 'base64');
      if (raw.length < 16) throw new Error('link frame is too short to carry a tag');
      const cipher = crypto.createDecipheriv('aes-256-gcm', incoming, ivFor(counter));
      cipher.setAuthTag(raw.subarray(raw.length - 16));
      const plain = Buffer.concat([cipher.update(raw.subarray(0, raw.length - 16)), cipher.final()]);
      received = counter;
      return JSON.parse(plain.toString('utf8'));
    },
  };
}

module.exports = {
  LINK_VERSION,
  sealTo,
  openSealed,
  idForKey,
  startLink,
  answerLink,
  finishLink,
  confirmLink,
  linkCipher,
};
