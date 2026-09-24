# Duress vault, crypto modernisation, robust steganography, chat modularisation

**Goal:** Make the duress feature actually protect someone under coercion, remove
every broken cipher from the product, make a hidden message survive (or honestly
report) the trip through a messenger, and break `js/chat.js` into modules that a
person can hold in their head.

**Threat model this serves:** a person outside Iran talking to family inside it,
carrying encrypted payloads over messengers that are assumed to be monitored
(Bale, Soroush, Eitaa, Rubika), with the possibility of device seizure and
compelled disclosure at either end.

---

## Global constraints

- No back-compatibility burden: the app has never been publicly released, so old
  ciphertext does not need to keep opening. Legacy paths are deleted, not hidden.
- No new runtime dependency may be fetched from a CDN. Everything ships vendored.
- Every cryptographic primitive that is not `crypto.subtle` must pass published
  test vectors in `tests/e2e/` before it is used anywhere.
- The browser payload keeps working offline after one load.
- Bilingual (fa/en) for every string that reaches a user.

---

## Phase 1 — Crypto core (`js/crypto-core.js`, new)

`encryptStorageData()` is synchronous and currently uses CryptoJS
(AES-256-CBC + HMAC-SHA256). WebCrypto is async, so replacing it in place would
force an async refactor through every caller. A synchronous, audited-by-vector
AEAD removes that problem and removes CryptoJS at the same time.

**Deliverables**

- `XChaCha20-Poly1305` (RFC 8439 ChaCha20 + Poly1305, HChaCha20 extension),
  synchronous, constant-time tag compare.
- `argon2id` wrapper over the vendored `hash-wasm` build.
- `crc32`, constant-time compare, base64url helpers.

**Gate:** `tests/e2e/cryptocore.mjs` must pass RFC 8439 §2.8.2 and
draft-irtf-cfrg-xchacha test vectors **before** Phase 2 uses any of it.

**Why XChaCha20 and not AES-GCM here:** 192-bit nonces can be drawn at random
without a counter, so a vault that is re-encrypted thousands of times never
approaches the birthday bound that a 96-bit GCM nonce would. AES-256-GCM stays
the default for file and message encryption, where WebCrypto's hardware path is
worth having.

---

## Phase 2 — Duress vault (`js/vault-profiles.js`, new)

**The defect.** `poorija_panic_hash` sits in `localStorage` beside
`poorija_master_hash`, and the two have different shapes: the master is
`{v:2,kdf:'argon2id',phc:…}`, the panic is a bare hex digest. Anyone who opens
the profile directory sees a second credential and learns a duress password
exists. The feature announces itself at exactly the moment it must not.

**The replacement.** No stored password hash of any kind. A fixed array of two
opaque slots:

```
poorija_vault_slots = [
  { s: <16B salt>, n: <24B nonce>, ct: <XChaCha20-Poly1305 ciphertext> },
  { s: <16B salt>, n: <24B nonce>, ct: <…> }
]
```

- **Always exactly two slots**, always the same shape and length. With no decoy
  configured, the spare slot holds indistinguishable random bytes.
- Slot order is randomised on every write, so slot 0 is not "the real one".
- A slot's plaintext is a profile envelope carrying its own `pid` and its own
  storage salt. Profiles are cryptographically independent.
- Unlock derives an Argon2id key per slot and attempts AEAD decryption of each.
  Whichever authenticates is the profile that opens. Both failing is a wrong
  password. **Nothing on disk says which slot is which.**
- Per-profile data is namespaced `poorija_p_<pid>_<key>`, so both profiles
  produce identically shaped key sets.

**Decoy content.** A decoy that is empty is a decoy that is obvious. Setting a
duress password generates a working profile: 4–7 contacts, 8–20 notes and
history entries with timestamps spread over months, 2–4 *real* keypairs, a few
saved passwords, plausible settings and a plausible last-backup date. The app is
fully functional inside it.

**Nuclear wipe stays.** The login-screen wipe button and `wipeAllData()` are
untouched — they are a different tool for a different moment.

---

## Phase 3 — Algorithm purge

**Delete** from `js/crypto-config.js` and `js/app.js`: `RC4 *`, `3DES *`,
`Rabbit *`, `AES-256-CFB *`, `AES-256-OFB *`, bare `RSA-OAEP`, and the whole
`LEGACY_ALGORITHMS` array with its `isCryptoJs` branch.

**Also delete** the unauthenticated modes on offer — `AES-*-CTR`, `AES-256-CBC`.
An unauthenticated cipher in a chooser is a footgun with a label on it.

**Offered afterwards, all authenticated:**

| id | why |
|---|---|
| `AES-256-GCM` | default; hardware-accelerated via WebCrypto |
| `AES-192-GCM`, `AES-128-GCM` | policy variants |
| `XCHACHA20-POLY1305` | no AES-NI dependence, random 192-bit nonces |
| `RSA-OAEP-3072`, `RSA-OAEP-4096` | hybrid public-key path |

**Then delete `vendor/crypto-js/` from the tree and from `sw.js`.**

**KDF:** Argon2id everywhere a password becomes a key. PBKDF2 remains only where
WebCrypto requires it.

---

## Phase 4 — Steganography integrity (`js/stego.js`, new)

Payloads gain a container so extraction can tell *why* it failed:

```
"P0S2" | ver u8 | algo u8 | flags u8 | length u32 | crc32 u32 | payload
```

Extraction outcomes, each with its own bilingual message:

| condition | verdict |
|---|---|
| magic + CRC ok | message recovered |
| magic, CRC bad | present but damaged |
| no magic, source is JPEG | **re-compressed — sent as a photo, not a file** |
| no magic, source is PNG | no hidden message |

**Verify-after-hide:** every produced image is re-parsed before download. If the
round-trip fails, the download does not happen.

**Health check tool:** drop a received image, get the verdict without needing
the password.

---

## Phase 5 — Robust embedding (`js/stego-dct.js`, new)

LSB dies to any re-encode. The transport re-encodes whenever the user sends the
image as a *photo*, which is the default gesture in every one of these
messengers. So a second algorithm, embedding where JPEG keeps information:

- RGB → YCbCr, work on Y.
- 8×8 block DCT.
- Embed with **quantisation index modulation** on mid-frequency coefficients
  (zigzag 6…20): quantise to a multiple of Δ, choose the even or odd multiple
  according to the bit.
- Δ tuned so the decision survives requantisation at JPEG quality ≥ 0.75.
- **Repetition coding** across blocks with majority vote, plus the Phase 4 CRC.
- Emit JPEG at high quality.

**Gate:** `tests/e2e/stego.mjs` round-trips a real image through canvas JPEG
re-encoding at q = 0.95 / 0.90 / 0.85 / 0.80 / 0.75 and asserts exact recovery,
and asserts LSB fails at the same qualities (so the two algorithms are honestly
differentiated rather than both claimed robust).

---

## Phase 6 — `chat.js` modularisation

22,078 lines in one IIFE. It parses clean under `"use strict"`, and `defer`
already gives it deferred timing, so `<script type="module">` preserves both
scoping and ordering semantics.

Split by responsibility, not by layer, into `js/chat/`:

| module | contents |
|---|---|
| `constants.js` | storage keys, limits, timeouts |
| `state.js` | `chatState` and accessors |
| `wire.js` | envelope shapes, signalling payloads |
| `crypto-sessions.js` | prekeys, ECDH/KEX, session keys, trust |
| `transport.js` | PeerJS, relay socket, backpressure, reconnect |
| `files.js` | chunked transfer, progress, media vault |
| `messages.js` | send/receive, retention, self-destruct |
| `groups.js` | spaces, membership, permissions, sync |
| `calls.js` | 1:1 signalling, ring timers |
| `calls-group.js` | mesh, grid fitting, pinning |
| `ui-*.js` | render layers |
| `index.js` | wiring and lazy init |

`sw.js` asset lists and `index.html` script tags updated together.

---

## Phase 7 — Audit and release

- `tests/e2e/duress.mjs` — indistinguishability: byte-shape of both slots, no
  distinguishing key names, decoy opens a working app, real vault unaffected,
  wrong password opens neither.
- `tests/e2e/cryptocore.mjs` — published vectors.
- `tests/e2e/stego.mjs` — recompression survival matrix.
- `tests/e2e/legacypurge.mjs` — greps the shipped payload and fails if RC4,
  TripleDES, Rabbit, CFB, OFB or CryptoJS appear anywhere.
- Full sweep `npm run test:e2e`, then `bash scripts/sync-to-server.sh`.
