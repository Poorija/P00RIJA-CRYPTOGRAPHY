/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* ============================================================================
   vault-profiles.js — two vaults that cannot be told apart.
   ============================================================================

   WHAT WAS WRONG
   --------------
   The old duress feature stored `poorija_panic_hash` in localStorage, beside
   `poorija_master_hash`. Two problems, either one fatal:

     1. Two credentials are visible where there should be one. Anyone who opens
        the profile directory learns a duress password exists.
     2. They did not even look alike. The master was
        {"v":2,"kdf":"argon2id","phc":"$argon2id$..."} and the panic was a bare
        hex digest. You did not need to understand the app to spot the odd one.

   And entering it wiped the device. Under compulsion, a wipe is not an escape:
   the absence of data is itself an answer, and a visibly destroyed vault
   invites the next question rather than ending the conversation.

   WHAT REPLACES IT
   ----------------
   Two slots, always both present, always the same size, holding ciphertext
   that is indistinguishable from random. No password hash is stored at all.

     poorija_vault = {
       v: 4,
       kdf: { alg, t, m, p, salt },      one salt, one derivation per attempt
       slots: [ {n, ct}, {n, ct} ]       272 bytes of ciphertext each, always
     }

   Unlocking derives one key from the password and tries to open both slots.
   Whichever authenticates is the vault you get. Nothing on disk marks one as
   real, and slot order is reshuffled on every write.

   BOTH PROFILES ARE CREATED AT INSTALL, ALWAYS.
   Creating the alternate only when a duress password is set would have left a
   simpler tell than the one being fixed: with one profile there is one
   `poorija_p_<pid>_*` namespace and with two there are two, so counting key
   prefixes would answer the question that the slots refuse to. So setup builds
   the real profile and an alternate together, fills the alternate with
   generated content, and seals it under a random password that is then thrown
   away. An installation where the user never configures duress is byte-for-byte
   the same shape as one where they did.

   Setting a duress password later does not create anything — it re-seals the
   alternate's existing envelope under the chosen password. Which is why the
   envelope carries a stored data key rather than one derived from the vault
   key: re-keying the slot must not orphan the content already written under it.

   The alternate's envelope is kept inside the real profile's own encrypted
   data so it can be re-sealed later. That leak runs one way only — holding the
   real password reveals that an alternate exists, holding the alternate's
   reveals nothing — and by the time someone has the real vault, the decoy has
   already failed at its job.

   WHAT THIS DOES AND DOES NOT BUY
   -------------------------------
   It defeats inspection of the stored data. Someone imaging the device and
   reading localStorage cannot show that a second vault exists, and cannot show
   that it does not.

   It does not defeat someone who watched you type, who has the device
   unlocked and running, or who has a recording of an earlier session. It does
   not hide that this application is installed. And a decoy that is empty is a
   decoy that fails, which is why setting one generates a working profile with
   real keys, real contacts and plausible history rather than a blank shell.

   Deliberately, the app will not tell you whether a decoy is configured. There
   is nowhere to record that fact which is not also a place an adversary can
   read it. Entering the password is how you find out.
   ============================================================================ */

(function (global) {
  'use strict';

  const C = global.PoorijaCryptoCore;
  if (!C) throw new Error('vault-profiles.js requires crypto-core.js to load first.');

  const VAULT_STORAGE_KEY = 'poorija_vault';
  const LEGACY_MASTER_KEY = 'poorija_master_hash';
  const LEGACY_PANIC_KEY = 'poorija_panic_hash';
  const LEGACY_STORAGE_SALT_KEY = 'poorija_storage_key_salt_v3';

  const SLOT_COUNT = 2;
  const VAULT_VERSION = 4;

  /* The envelope is padded to a fixed size so ciphertext length says nothing.
     256 bytes is comfortably more than the envelope needs and leaves room to
     add a field later without changing the on-disk shape. */
  const ENVELOPE_BYTES = 256;
  const SLOT_CIPHERTEXT_BYTES = ENVELOPE_BYTES + C.TAG_BYTES;

  const SLOT_AAD = C.utf8('poorija-vault-slot-v4');

  /* RFC 9106's second recommended profile, with one pass traded for the fact
     that a browser has to stay responsive and we derive once per unlock. */
  const KDF_PARAMS = Object.freeze({
    alg: 'argon2id',
    t: 3,
    m: 65536,   /* KiB */
    p: 1
  });

  /* ---- storage plumbing -------------------------------------------------- */

  function readVaultRecord() {
    try {
      const raw = global.localStorage.getItem(VAULT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== VAULT_VERSION) return null;
      if (!Array.isArray(parsed.slots) || parsed.slots.length !== SLOT_COUNT) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function writeVaultRecord(record) {
    global.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));
  }

  function hasVault() {
    return readVaultRecord() !== null;
  }

  function hasLegacyVault() {
    return !hasVault() && Boolean(global.localStorage.getItem(LEGACY_MASTER_KEY));
  }

  /* ---- the envelope ------------------------------------------------------ */

  /* A profile envelope is JSON, length-prefixed, then zero-padded to exactly
     ENVELOPE_BYTES. The length prefix is what lets the reader find the end of
     the JSON without trusting the padding. */
  function packEnvelope(profile) {
    const json = C.utf8(JSON.stringify({
      pid: profile.pid,
      dkey: profile.dkey,
      born: profile.born
    }));
    if (json.length + 2 > ENVELOPE_BYTES) {
      throw new Error('Profile envelope does not fit its fixed size.');
    }
    const out = new Uint8Array(ENVELOPE_BYTES);
    out[0] = (json.length >> 8) & 0xff;
    out[1] = json.length & 0xff;
    out.set(json, 2);
    /* Pad with random rather than zeroes. Zero padding is still invisible
       inside the ciphertext, but random costs nothing and removes any question
       about whether a compression side channel could exist later. */
    const pad = C.randomBytes(ENVELOPE_BYTES - 2 - json.length);
    out.set(pad, 2 + json.length);
    return out;
  }

  function unpackEnvelope(bytes) {
    if (!bytes || bytes.length !== ENVELOPE_BYTES) return null;
    const length = (bytes[0] << 8) | bytes[1];
    if (length < 2 || length + 2 > ENVELOPE_BYTES) return null;
    try {
      const parsed = JSON.parse(C.fromUtf8(bytes.subarray(2, 2 + length)));
      if (!parsed || typeof parsed.pid !== 'string' || typeof parsed.dkey !== 'string') {
        return null;
      }
      return parsed;
    } catch (error) {
      return null;
    }
  }

  /* ---- key derivation ---------------------------------------------------- */

  /* One Argon2id derivation per unlock attempt, not one per slot: the salt is
     shared across slots, so the same derived key is tried against both. Two
     derivations would double the unlock cost and buy nothing — a salt exists
     to stop precomputation, and one random 16-byte salt per installation does
     that for every password stored under it. */
  async function deriveVaultKey(password, saltB64, params) {
    const p = params || KDF_PARAMS;
    return C.argon2id(password, C.fromBase64(saltB64), {
      iterations: p.t,
      memorySize: p.m,
      parallelism: p.p,
      hashLength: C.KEY_BYTES
    });
  }

  /* The data key is generated once and carried inside the envelope, wrapped by
     the slot's AEAD — it is NOT derived from the vault key.

     That distinction is load-bearing. Changing a slot's password re-seals its
     envelope under a new vault key; if the data key were derived from the
     vault key, every byte the profile had written would become unreadable at
     that moment. Storing it means the password protects the key, and the key
     protects the data, which is what lets the alternate profile be created at
     install time and given its password months later. */
  function profileDataKey(envelope) {
    return C.fromBase64(envelope.dkey);
  }

  /* ---- slots ------------------------------------------------------------- */

  function sealSlot(vaultKey, profile) {
    const nonce = C.randomBytes(C.NONCE_BYTES);
    const ct = C.seal(vaultKey, nonce, packEnvelope(profile), SLOT_AAD);
    return { n: C.toBase64(nonce), ct: C.toBase64(ct) };
  }

  /* Random bytes at exactly the length a real slot has. No longer used by any
     write path — every installation now carries two genuine slots — but kept
     because the indistinguishability tests assert that a real slot and this are
     the same size and equally free of structure. */
  function fillerSlot() {
    return {
      n: C.toBase64(C.randomBytes(C.NONCE_BYTES)),
      ct: C.toBase64(C.randomBytes(SLOT_CIPHERTEXT_BYTES))
    };
  }

  function tryOpenSlot(vaultKey, slot) {
    try {
      const opened = C.open(vaultKey, C.fromBase64(slot.n), C.fromBase64(slot.ct), SLOT_AAD);
      if (!opened) return null;
      return unpackEnvelope(opened);
    } catch (error) {
      return null;
    }
  }

  /* Fisher-Yates over two elements is a coin flip, but writing it this way
     keeps the intent obvious and survives SLOT_COUNT changing. */
  function shuffled(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = C.randomBytes(1)[0] % (i + 1);
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  function newProfile(bornMs) {
    return {
      pid: C.toHex(C.randomBytes(16)),
      dkey: C.toBase64(C.randomBytes(C.KEY_BYTES)),
      born: bornMs || Date.now()
    };
  }

  /* ---- the public operations --------------------------------------------- */

  /* First run. Two profiles, both real, order randomised. The alternate is
     sealed under a password nobody keeps — it exists so the installation has
     the shape it would have if a duress password were already set. */
  async function createVault(password, options) {
    const opts = options || {};

    /* Any profile namespace already on disk belongs to a vault that is about
       to be replaced, and its data key lived inside that vault's slots — so it
       is provably unopenable from here on. Leaving it would grow the namespace
       count on every reset, and an observer counting prefixes would be able to
       say how many times the vault had been rebuilt. */
    forEachProfilePrefix((pid) => purgeProfile(pid));

    const salt = C.toBase64(C.randomBytes(16));
    const vaultKey = await deriveVaultKey(password, salt);

    const born = Date.now();
    const real = newProfile(born);
    const alternate = newProfile(born);

    const throwaway = C.toHex(C.randomBytes(32));
    const altKey = await deriveVaultKey(throwaway, salt);

    writeVaultRecord({
      v: VAULT_VERSION,
      kdf: Object.assign({ salt }, KDF_PARAMS),
      slots: shuffled([sealSlot(vaultKey, real), sealSlot(altKey, alternate)])
    });

    const realHandle = attach(real, vaultKey);
    const altHandle = attach(alternate, altKey);

    /* The real profile remembers the alternate's envelope; the alternate
       remembers a blob of the same size that decrypts to nothing meaningful,
       so the two namespaces hold the same set of key names. */
    writeMeta(realHandle, { alt: { pid: alternate.pid, dkey: alternate.dkey, born: alternate.born } });
    writeMeta(altHandle, { pad: C.toBase64(C.randomBytes(48)) });

    if (opts.seedAlternate !== false) {
      try {
        await seedAlternateContent(altHandle);
      } catch (error) {
        /* A decoy without content is worse than none, but failing setup over it
           would be worse still. Surface it; do not abort. */
        console.warn('[Vault] alternate content could not be generated:', error);
      }
    }

    return realHandle;
  }

  const META_NAME = 'meta';

  function writeMeta(profile, value) {
    global.localStorage.setItem(profileKey(profile, META_NAME),
      encryptForProfile(profile, value));
  }

  function readMeta(profile) {
    return decryptForProfile(profile,
      global.localStorage.getItem(profileKey(profile, META_NAME))) || {};
  }

  /* Writes the generated decoy into the alternate profile's namespace.

     Each store is written in the SAME shape the application writes it, which
     is not uniform: js/app.js keeps keys and notes under encryptStorageData
     but passwords and history as plain JSON. Getting that wrong is not a
     cosmetic bug — seeding poorija_passwords encrypted made loadPasswords()
     JSON.parse an envelope object, so state.generatedPasswords became an
     object and the app threw "state.generatedPasswords.map is not a function"
     the moment the decoy was opened. A space that throws errors the real one
     does not is a space that announces itself.

     The key names have to be exact for the same reason: the decoy's notes were
     written to `notes` while the app reads `secure_notes`, so the decoy opened
     with an empty notes tab. tools/store-formats.cjs prints the current map;
     re-run it if a store is added. */
  async function seedAlternateContent(altHandle) {
    const content = await generateDecoyContent(altHandle.born);

    const sealed = (name, value) => global.localStorage.setItem(
      profileKey(altHandle, name), encryptForProfile(altHandle, value));
    const plain = (name, value) => global.localStorage.setItem(
      profileKey(altHandle, name), JSON.stringify(value));

    /* encryptStorageData in app.js */
    sealed('keys', content.keys);
    sealed('secure_notes', content.notes);

    /* plain JSON in app.js */
    plain('passwords', content.passwords);
    plain('history', content.history);

    /* saveEncrypted in the chat module */
    sealed('chat_contacts', content.contacts);
    sealed('chat_profile', {
      displayName: content.contacts[0]?.name?.split(' ')[0] || 'کاربر',
      about: '',
      avatar: ''
    });

    return content;
  }

  /* Try every slot, always. Returning as soon as one opens would leak, through
     timing, which slot matched — and the whole design rests on slot order
     carrying no information. Two AEAD attempts over 272 bytes cost nothing
     next to the Argon2id derivation that precedes them. */
  async function openVault(password) {
    const record = readVaultRecord();
    if (!record) return null;

    const vaultKey = await deriveVaultKey(password, record.kdf.salt, record.kdf);

    let found = null;
    for (const slot of record.slots) {
      const envelope = tryOpenSlot(vaultKey, slot);
      if (envelope && !found) found = envelope;
    }
    if (!found) return null;
    return attach(found, vaultKey);
  }

  /* Change the password on the OPEN profile's own slot.

     This has to re-seal the existing envelope, not build a new one. The
     envelope carries the profile id and the data key, so re-sealing keeps both
     — every note, key, contact and message stays readable, and the storage
     namespace does not move.

     Creating a fresh vault instead, which is what the app used to do here,
     produced a new profile id and therefore a new empty namespace: changing
     your master password silently orphaned everything you had. The old data
     was still on disk under the previous id, unreachable, and the count of
     namespaces went from two to four, which also gave away that a vault had
     been replaced.

     The KDF salt is deliberately reused: the other slot's password derives
     through it too, and rotating it would make that slot unopenable. */
  async function changePassword(currentProfile, newPassword) {
    const record = readVaultRecord();
    if (!record) throw new Error('No vault to change.');
    if (!currentProfile || !currentProfile.__key) throw new Error('No open profile.');

    const mine = record.slots.find((slot) => {
      const env = tryOpenSlot(currentProfile.__key, slot);
      return env && env.pid === currentProfile.pid;
    });
    if (!mine) throw new Error('Could not locate the open profile\'s own slot.');
    const envelope = tryOpenSlot(currentProfile.__key, mine);
    const other = record.slots.find((slot) => slot !== mine);

    const newKey = await deriveVaultKey(newPassword, record.kdf.salt, record.kdf);

    /* If the new password opens the other slot, the two would collapse into
       one and the alternate would become unreachable — or worse, the duress
       password would start opening the real vault. */
    if (other && tryOpenSlot(newKey, other)) throw new Error('DUPLICATE_PASSWORD');

    writeVaultRecord({
      v: VAULT_VERSION,
      kdf: record.kdf,
      slots: shuffled([sealSlot(newKey, envelope), other].filter(Boolean))
    });

    return attach(envelope, newKey);
  }

  /* Re-seal the alternate slot under a chosen password.

     Nothing is created here. The alternate profile and its contents have
     existed since setup; this only changes which password opens them, which is
     what keeps the decoy's history older than the moment it became reachable. */
  async function setAlternatePassword(currentProfile, password) {
    const record = readVaultRecord();
    if (!record) throw new Error('No vault to write into.');
    if (!currentProfile || !currentProfile.__key) throw new Error('No open profile.');

    const meta = readMeta(currentProfile);
    if (!meta.alt || !meta.alt.pid) throw new Error('NO_ALTERNATE');

    const altKey = await deriveVaultKey(password, record.kdf.salt, record.kdf);

    /* Refuse a password that already opens something. Two slots answering to
       one password would make the alternate unreachable and, worse, would hand
       over the real vault to the password given up under duress. */
    for (const slot of record.slots) {
      if (tryOpenSlot(altKey, slot)) throw new Error('DUPLICATE_PASSWORD');
    }

    const mine = record.slots.find((slot) => {
      const env = tryOpenSlot(currentProfile.__key, slot);
      return env && env.pid === currentProfile.pid;
    });
    if (!mine) throw new Error('Could not locate the open profile\'s own slot.');

    writeVaultRecord({
      v: VAULT_VERSION,
      kdf: record.kdf,
      slots: shuffled([mine, sealSlot(altKey, meta.alt)])
    });

    return attach(meta.alt, altKey);
  }

  /* Make the alternate unreachable again without changing the installation's
     shape. It is re-sealed under a fresh random password that is discarded, so
     the slot stays a real slot holding real content — exactly as it was before
     any duress password was chosen. Blanking it to filler would have been
     simpler and would have announced, to anyone who had seen the vault before,
     that something was removed. */
  async function clearAlternate(currentProfile) {
    const record = readVaultRecord();
    if (!record || !currentProfile || !currentProfile.__key) return false;

    const meta = readMeta(currentProfile);
    if (!meta.alt || !meta.alt.pid) return false;

    const mine = record.slots.find((slot) => {
      const env = tryOpenSlot(currentProfile.__key, slot);
      return env && env.pid === currentProfile.pid;
    });
    if (!mine) return false;

    const throwaway = C.toHex(C.randomBytes(32));
    const altKey = await deriveVaultKey(throwaway, record.kdf.salt, record.kdf);

    writeVaultRecord({
      v: VAULT_VERSION,
      kdf: record.kdf,
      slots: shuffled([mine, sealSlot(altKey, meta.alt)])
    });
    return true;
  }

  /* ---- profile handle ---------------------------------------------------- */

  /* The handle carries the derived keys in memory only. `__key` and `__data`
     are non-enumerable so a stray JSON.stringify of application state cannot
     write them to disk. */
  function attach(envelope, vaultKey) {
    const profile = {
      pid: envelope.pid,
      dkey: envelope.dkey,
      born: envelope.born
    };
    Object.defineProperty(profile, '__key', {
      value: vaultKey, enumerable: false, writable: false
    });
    Object.defineProperty(profile, '__data', {
      value: profileDataKey(envelope),
      enumerable: false, writable: false
    });
    return profile;
  }

  /* ---- per-profile storage ----------------------------------------------- */

  const PROFILE_PREFIX = 'poorija_p_';

  function profileKey(profile, name) {
    return `${PROFILE_PREFIX}${profile.pid}_${name}`;
  }

  function forEachProfilePrefix(fn) {
    const seen = new Set();
    for (let i = 0; i < global.localStorage.length; i++) {
      const key = global.localStorage.key(i);
      if (!key || !key.startsWith(PROFILE_PREFIX)) continue;
      const rest = key.slice(PROFILE_PREFIX.length);
      const underscore = rest.indexOf('_');
      if (underscore <= 0) continue;
      const pid = rest.slice(0, underscore);
      if (!seen.has(pid)) { seen.add(pid); fn(pid); }
    }
  }

  function purgeProfile(pid) {
    const doomed = [];
    for (let i = 0; i < global.localStorage.length; i++) {
      const key = global.localStorage.key(i);
      if (key && key.startsWith(`${PROFILE_PREFIX}${pid}_`)) doomed.push(key);
    }
    doomed.forEach((key) => global.localStorage.removeItem(key));
  }

  /* Synchronous, which is the whole reason crypto-core exists: the callers in
     app.js are ordinary synchronous state writes. A fresh 24-byte random nonce
     per write needs no counter and cannot repeat in any practical lifetime. */
  function encryptForProfile(profile, data) {
    if (!profile || !profile.__data) {
      throw new Error('Cannot encrypt profile data before unlock.');
    }
    const nonce = C.randomBytes(C.NONCE_BYTES);
    const plaintext = C.utf8(JSON.stringify(data));
    const sealed = C.seal(profile.__data, nonce, plaintext, C.utf8(profile.pid));
    return JSON.stringify({
      v: 4,
      alg: 'xchacha20-poly1305',
      n: C.toBase64(nonce),
      ct: C.toBase64(sealed)
    });
  }

  function decryptForProfile(profile, encryptedStr) {
    if (!encryptedStr || !profile || !profile.__data) return null;
    try {
      const parsed = JSON.parse(encryptedStr);
      if (!parsed || parsed.v !== 4 || !parsed.n || !parsed.ct) return null;
      const opened = C.open(
        profile.__data,
        C.fromBase64(parsed.n),
        C.fromBase64(parsed.ct),
        C.utf8(profile.pid)
      );
      if (!opened) return null;
      return JSON.parse(C.fromUtf8(opened));
    } catch (error) {
      return null;
    }
  }

  /* ---- legacy migration -------------------------------------------------- */

  /* The old format stored a verifier, so migration cannot happen until someone
     proves the password by entering it. `verify` is app.js's existing
     verifyMasterPassword; on success the old keys go away for good — including
     poorija_panic_hash, which is the leak this whole file exists to close. */
  async function migrateLegacy(password, verify) {
    if (!hasLegacyVault()) return null;
    const ok = await verify(password);
    if (!ok) return null;

    const profile = await createVault(password);

    /* The two credentials go now — poorija_panic_hash is the leak this whole
       file exists to close, and leaving it for later means leaving it. */
    global.localStorage.removeItem(LEGACY_MASTER_KEY);
    global.localStorage.removeItem(LEGACY_PANIC_KEY);

    /* The storage salt does NOT go here. It is the only thing that can still
       derive the key for the v2/v3 envelopes holding the user's notes, keys
       and chat identity, and those are migrated later in the unlock — by
       app.js's migrateLegacyStorageIntoProfile, which deletes the salt itself
       once it is finished with it.

       Deleting it here made every one of those envelopes permanently
       unreadable, which the upgrade test caught as "skipped: 4". */

    return profile;
  }

  /* ---- decoy content ----------------------------------------------------- */

  /* An empty decoy is a decoy that fails. What follows builds a vault that
     looks like somebody has been using it for months: correspondents with
     ordinary names, notes about ordinary things, a handful of saved logins,
     and real working keypairs. Everything is generated fresh per installation,
     so two decoys never match. */

  const DECOY_PEOPLE_FA = ['مریم', 'حسین', 'زهرا', 'علی', 'نگار', 'رضا', 'سارا',
                           'امیر', 'الهام', 'بابک', 'شیرین', 'کاوه'];
  const DECOY_SURNAMES_FA = ['احمدی', 'رضایی', 'موسوی', 'کریمی', 'صادقی',
                             'نوری', 'حسینی', 'جعفری'];
  const DECOY_PEOPLE_EN = ['Daniel', 'Hannah', 'Marco', 'Priya', 'Tomas',
                           'Leila', 'Jonas', 'Aisha'];

  const DECOY_NOTES = [
    ['فهرست خرید', 'شیر، نان، تخم‌مرغ، پنیر\nشارژ موبایل\nقبض برق تا پنجشنبه'],
    ['قرار دندانپزشکی', 'سه‌شنبه ساعت ۱۰:۳۰ — خیابان شریعتی، ساختمان آرین'],
    ['رمز وای‌فای خانه', 'اسم شبکه: HomeNet_5G\nرمز روی خود مودم نوشته شده'],
    ['کتاب‌هایی که باید بخرم', 'ملت عشق\nسمفونی مردگان\nچشم‌هایش'],
    ['شماره پرواز', 'IR-۷۲۲ — ساعت ۶:۱۵ صبح، ترمینال ۲'],
    ['Gym schedule', 'Mon / Wed / Sat — 18:00\nLocker 214'],
    ['Recipe — lentil soup', 'Lentils, onion, turmeric, lemon.\nSimmer 40 min.'],
    ['اندازه‌های اتاق', 'طول ۴.۲ متر، عرض ۳.۱ متر\nپرده: ۲.۶ متر'],
    ['Car service', 'Oil change due at 84,000 km\nGarage on 5th street'],
    ['یادآوری', 'تولد مامان — ۱۲ آذر\nکادو: شال یا کتاب'],
    ['Passwords to change', 'old email, old forum account — someday'],
    ['لیست فیلم', 'جدایی نادر از سیمین\nفروشنده\nبچه‌های آسمان']
  ];

  const DECOY_LOGINS = [
    ['ایمیل شخصی', 'mail.example.com'],
    ['فروشگاه آنلاین', 'shop.example.com'],
    ['Wi-Fi کافه', 'guest network'],
    ['حساب کاربری انجمن', 'forum.example.org'],
    ['اشتراک موسیقی', 'music.example.net'],
    ['پنل مودم', '192.168.1.1']
  ];

  function pick(list, rng) { return list[Math.floor(rng() * list.length)]; }

  function makeRng() {
    /* Seeded from the CSPRNG so decoys differ between installations, but a
       plain PRNG afterwards because nothing here is a secret — it just must
       not repeat. */
    let s = 0;
    C.randomBytes(4).forEach((b) => { s = ((s << 8) | b) >>> 0; });
    return function rng() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  const DAY = 86400000;

  async function generateDecoyContent(nowMs) {
    const rng = makeRng();
    const now = nowMs || Date.now();

    /* Spread the whole decoy over the past four to fourteen months. */
    const ageDays = 120 + Math.floor(rng() * 300);
    const start = now - ageDays * DAY;
    const between = () => start + Math.floor(rng() * (now - start));

    const contactCount = 4 + Math.floor(rng() * 4);
    const contacts = [];
    for (let i = 0; i < contactCount; i++) {
      const persian = rng() > 0.35;
      const name = persian
        ? `${pick(DECOY_PEOPLE_FA, rng)} ${pick(DECOY_SURNAMES_FA, rng)}`
        : pick(DECOY_PEOPLE_EN, rng);
      /* The field names matter. chat's saveContacts() runs on every boot and
         keeps only records that pass isStoredContact(), which needs `peerId`
         and some sign the user engaged with them — `manual` is the one that
         fits a decoy: contacts added by hand. Seeded with `id` instead of
         `peerId`, all six were silently dropped the first time the decoy was
         opened, leaving an empty address book, which is the single most
         obvious way for a decoy to fail.

         No message history is seeded with them. The stored message shape is
         not documented anywhere in this codebase and guessing it risks a
         render error inside the decoy — the exact tell this is trying to
         avoid. Contacts added but not yet talked to is a coherent story; a
         chat thread that throws is not. */
      contacts.push({
        peerId: C.toHex(C.randomBytes(10)),
        clientId: C.toHex(C.randomBytes(10)),
        name,
        username: name,
        fingerprint: C.toHex(C.randomBytes(32)),
        manual: true,
        status: 'offline',
        lastSeenAt: new Date(between()).toISOString(),
        addedAt: between()
      });
    }

    const noteCount = 6 + Math.floor(rng() * 6);
    const chosen = DECOY_NOTES.slice().sort(() => rng() - 0.5).slice(0, noteCount);
    const notes = chosen.map(([title, body]) => ({
      id: C.toHex(C.randomBytes(8)),
      title,
      content: body,
      createdAt: between(),
      updatedAt: between()
    }));

    const loginCount = 3 + Math.floor(rng() * 4);
    const passwords = DECOY_LOGINS.slice().sort(() => rng() - 0.5)
      .slice(0, loginCount).map(([label, site]) => ({
        id: C.toHex(C.randomBytes(8)),
        label,
        site,
        /* Plausible generated passwords, not memorable ones — a decoy full of
           obviously fake strings is not a decoy. */
        value: C.toBase64(C.randomBytes(9)).replace(/[+/=]/g, ''),
        createdAt: between()
      }));

    /* Real keypairs. The decoy has to be a working app: a key that does not
       verify is the first thing that would give it away. */
    const keys = [];
    const keyCount = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < keyCount; i++) {
      try {
        const pair = await global.crypto.subtle.generateKey(
          { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
        );
        const pub = await global.crypto.subtle.exportKey('spki', pair.publicKey);
        const priv = await global.crypto.subtle.exportKey('pkcs8', pair.privateKey);
        keys.push({
          id: C.toHex(C.randomBytes(8)),
          name: i === 0 ? 'کلید اصلی' : `کلید ${i + 1}`,
          algorithm: 'ECDSA-P256',
          publicKey: C.toBase64(new Uint8Array(pub)),
          privateKey: C.toBase64(new Uint8Array(priv)),
          createdAt: between()
        });
      } catch (error) {
        /* If key generation is unavailable the decoy is still usable; it just
           has fewer keys. Never let this throw and abort the whole setup. */
        break;
      }
    }

    const history = [];
    const historyCount = 5 + Math.floor(rng() * 8);
    for (let i = 0; i < historyCount; i++) {
      history.push({
        id: C.toHex(C.randomBytes(8)),
        type: pick(['encrypt', 'decrypt', 'sign', 'hash'], rng),
        name: pick(['سند.pdf', 'عکس.jpg', 'notes.txt', 'قرارداد.docx',
                    'backup.zip', 'رسید.png'], rng),
        at: between()
      });
    }
    history.sort((a, b) => b.at - a.at);

    return {
      contacts,
      notes,
      passwords,
      keys,
      history,
      settings: {
        language: rng() > 0.3 ? 'fa' : 'en',
        theme: pick(['default', 'midnight', 'linen'], rng),
        lastBackupAt: between()
      }
    };
  }

  /* ---- namespacing every other module's storage ---------------------------

     There are eighty-odd localStorage call sites in app.js and thirty more in
     chat.js, all of them writing flat names like `poorija_keys`. Rewriting each
     one would work until the next one is added without the wrapper, and the
     failure mode of a missed call site is the worst available: the decoy
     profile silently reading or, worse, overwriting the real profile's data.

     So the redirection happens once, here, at the storage object itself. A
     name is namespaced unless it is on the global list — the vault record, the
     things that belong to the device rather than to a profile, and the legacy
     keys migration still has to reach. Keys already carrying the profile prefix
     pass through untouched, which is what keeps this module's own writes from
     being namespaced twice. */

  /* Anything the lock screen reads, or that belongs to the device rather than
     to a profile, must NOT be redirected — there is no profile open yet, so a
     redirected read would silently return nothing and a later write would land
     somewhere the reader never looks.

     This list was not written from memory. tools/prelock-audit.cjs walks both
     payloads with Babel and reports every key touched from a code path that
     runs while locked; ten of them were also written after unlock, which is
     exactly the shape of the bug that reset the chat identity. Re-run it after
     adding any localStorage call:

         node tools/prelock-audit.cjs
  */
  const GLOBAL_KEYS = new Set([
    VAULT_STORAGE_KEY,
    LEGACY_MASTER_KEY,
    LEGACY_PANIC_KEY,
    LEGACY_STORAGE_SALT_KEY,
    'poorija_storage_key_salt_v3',

    /* read by the lock screen, before any profile exists */
    'poorija_lang',
    'poorija_theme',
    'poorija_2fa',                        /* decides whether to show the code field */
    'poorija_sq',                         /* security questions: the reset path */
    'poorija_sq_failed',
    'poorija_passkey_quick_unlock',
    /* the presence strategy's local wrap key must live exactly where the
       record lives: enrollment writes it with a profile open, the lock
       screen reads it with none. Namespaced, the locked reader misses it
       and biometric unlock dies right after the fingerprint succeeds. */
    'poorija_passkey_local_wrap',
    'poorija_desktop_biometric_prompted',

    /* Push belongs to the INSTALLATION, not to a profile: there is one service
       worker, one endpoint and one subscription for the whole browser. Two
       profiles each remembering their own application server key under the
       same endpoint would make the "is this subscription still for the relay's
       current key" comparison answer differently depending on who was signed
       in, and re-subscribe for no reason. Neither of these holds anything a
       profile owns — a public VAPID key, an endpoint the relay already has,
       and which step of the registration last failed. */
    'poorija_push_server_key',
    'poorija_push_last_error',

    /* properties of the device, not of a profile */
    'poorija_failed_logins',              /* lockout survives which vault opens */
    'poorija_lock_until',
    'poorija_installation_secret',        /* per-install id; per-profile ids would
                                             give the two profiles distinguishable
                                             identities on the wire */
    'poorija_desktop_vault_bytes',        /* read at startup to restore the shell */
    'poorija_desktop_vault_saved_at',

    /* Read at startup for the theme and language, written from settings later.
       Kept global so the two sides agree; it holds interface preferences, not
       anything that says a second profile exists. */
    'poorija_settings'
  ]);

  let namespacingInstalled = false;

  function installNamespacing(getActiveProfile) {
    if (namespacingInstalled) return;
    const store = global.localStorage;
    const nativeGet = store.getItem.bind(store);
    const nativeSet = store.setItem.bind(store);
    const nativeRemove = store.removeItem.bind(store);

    const resolve = (key) => {
      if (typeof key !== 'string') return key;
      if (!key.startsWith('poorija_')) return key;
      if (key.startsWith(PROFILE_PREFIX)) return key;
      if (GLOBAL_KEYS.has(key)) return key;
      const profile = getActiveProfile();
      if (!profile || !profile.pid) return key;
      return `${PROFILE_PREFIX}${profile.pid}_${key.slice('poorija_'.length)}`;
    };

    // WebKit treats defineProperty on a Storage INSTANCE as a stored string,
    // silently leaving the native methods in place. Wrap the prototype and
    // restrict redirection to this localStorage instance; sessionStorage keeps
    // its native semantics. Do not create getItem/setItem/removeItem data keys.
    const proto = Object.getPrototypeOf(store);
    const methods = {
      getItem: proto.getItem,
      setItem: proto.setItem,
      removeItem: proto.removeItem,
    };
    for (const name of Object.keys(methods)) {
      Object.defineProperty(proto, name, {
        configurable: true, writable: true, enumerable: false,
        value: function (key, ...args) {
          return methods[name].call(this, this === store ? resolve(String(key)) : key, ...args);
        }
      });
      // Artifacts left by the old WebKit instance wrapper, not user data.
      const artifact = nativeGet(name);
      if (artifact && /native(Get|Set|Remove)\(resolve\(key\)/.test(artifact)) nativeRemove(name);
    }

    /* Exposed so migration can reach past the redirection deliberately. */
    global.PoorijaVault.__native = {
      getItem: nativeGet, setItem: nativeSet, removeItem: nativeRemove, resolve
    };
    namespacingInstalled = true;
  }

  /* ---- export ------------------------------------------------------------ */

  global.PoorijaVault = {
    VAULT_STORAGE_KEY,
    LEGACY_MASTER_KEY,
    LEGACY_PANIC_KEY,
    PROFILE_PREFIX,
    SLOT_COUNT,
    SLOT_CIPHERTEXT_BYTES,
    ENVELOPE_BYTES,
    KDF_PARAMS,

    installNamespacing,
    GLOBAL_KEYS,

    hasVault,
    hasLegacyVault,
    createVault,
    openVault,
    changePassword,
    setAlternatePassword,
    clearAlternate,
    migrateLegacy,

    profileKey,
    purgeProfile,
    forEachProfilePrefix,
    encryptForProfile,
    decryptForProfile,
    generateDecoyContent,

    /* exposed for tests, which need to build vaults without paying for
       Argon2id on every case */
    __internals: {
      packEnvelope,
      unpackEnvelope,
      sealSlot,
      fillerSlot,
      tryOpenSlot,
      shuffled,
      newProfile,
      attach,
      profileDataKey,
      readVaultRecord,
      writeVaultRecord,
      writeMeta,
      readMeta,
      seedAlternateContent
    }
  };
  /* Every exported name must resolve to something. An earlier edit removed
     openVault while leaving it on this object, and the only symptom was a
     ReferenceError deep inside a browser test — which then aborted app.js
     partway through and produced a second, unrelated-looking TDZ error
     somewhere else entirely. One assertion at load makes that impossible. */
  for (const [name, value] of Object.entries(global.PoorijaVault)) {
    if (value === undefined) {
      throw new Error(`vault-profiles.js exports "${name}" but never defines it.`);
    }
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
