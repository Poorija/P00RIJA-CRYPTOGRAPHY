/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.

   This checks the property the duress vault exists for: that someone holding
   the device cannot tell an installation with a hidden second profile from one
   without.

   Most assertions here are about what is NOT observable, which is exactly the
   kind of claim that passes vacuously if written carelessly. So each one names
   the observation an adversary would actually make — how many slots, how long
   the ciphertext is, which key names exist, how many profile namespaces are
   present — and asserts the two cases give the same answer.

   Runs in node with a localStorage shim. Argon2id is stubbed with a fast
   derivation: what is under test is the slot machinery, not the KDF. The real
   Argon2id path is walked once in the browser suite.                          */

import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);

const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

/* ---- environment -------------------------------------------------------- */

class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  keys() { return Array.from(this.map.keys()); }
}

globalThis.localStorage = new FakeStorage();
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const C = require('../../js/crypto-core.js');

/* A fast stand-in for Argon2id. Still a real KDF — distinct passwords give
   distinct keys — just without the memory cost, so this file can build a few
   hundred vaults in a second. */
globalThis.hashwasm = {
  async argon2id({ password, salt, hashLength }) {
    const pw = typeof password === 'string' ? C.utf8(password) : password;
    const sl = typeof salt === 'string' ? C.utf8(salt) : salt;
    const joined = new Uint8Array(pw.length + sl.length);
    joined.set(pw, 0);
    joined.set(sl, pw.length);
    const digest = await webcrypto.subtle.digest('SHA-256', joined);
    return new Uint8Array(digest).slice(0, hashLength || 32);
  }
};

require('../../js/vault-profiles.js');
const V = globalThis.PoorijaVault;

const REAL_PW = 'the-real-one-9134';
const DECOY_PW = 'what-i-would-say-4471';

const reset = () => { globalThis.localStorage.clear(); };
const shape = (keys) => keys.map((k) => k.replace(/[0-9a-f]{32}/g, '<pid>')).sort().join('\n');
const pidsIn = (keys) => new Set(keys
  .filter((k) => k.startsWith(V.PROFILE_PREFIX))
  .map((k) => k.slice(V.PROFILE_PREFIX.length).split('_')[0]));

/* ===== what an adversary sees on disk =================================== */

console.log('\n===== what is visible on disk =====');

reset();
await V.createVault(REAL_PW);                       /* duress never configured */
const soloRecord = JSON.parse(localStorage.getItem(V.VAULT_STORAGE_KEY));
const soloKeys = localStorage.keys().slice().sort();

reset();
const pairProfile = await V.createVault(REAL_PW);
await V.setAlternatePassword(pairProfile, DECOY_PW);  /* duress configured */
const pairRecord = JSON.parse(localStorage.getItem(V.VAULT_STORAGE_KEY));
const pairKeys = localStorage.keys().slice().sort();

check('an installation with no duress password holds two slots',
  soloRecord.slots.length === 2, `${soloRecord.slots.length}`);
check('one with a duress password holds two slots as well',
  pairRecord.slots.length === 2, `${pairRecord.slots.length}`);

const ctLengths = (rec) => rec.slots.map((s) => C.fromBase64(s.ct).length);
check('every slot ciphertext is the same fixed length in both cases',
  [...ctLengths(soloRecord), ...ctLengths(pairRecord)]
    .every((n) => n === V.SLOT_CIPHERTEXT_BYTES),
  JSON.stringify([ctLengths(soloRecord), ctLengths(pairRecord)]));

check('every slot nonce is the same fixed length',
  [...soloRecord.slots, ...pairRecord.slots]
    .every((s) => C.fromBase64(s.n).length === C.NONCE_BYTES));

/* The property the always-two design exists for. Creating the alternate only
   when duress was configured would have left a simpler tell than the one being
   fixed: one profile means one poorija_p_<pid>_* namespace and two means two,
   so counting prefixes would answer the question the slots refuse to. */
check('THE TWO CASES STORE IDENTICALLY SHAPED KEY SETS',
  shape(soloKeys) === shape(pairKeys),
  `${soloKeys.length} keys vs ${pairKeys.length}`);
check('both cases show exactly two profile namespaces',
  pidsIn(soloKeys).size === 2 && pidsIn(pairKeys).size === 2,
  `${pidsIn(soloKeys).size} vs ${pidsIn(pairKeys).size}`);

/* Stated as an exact key set rather than a substring search. The first version
   of this scanned the serialised JSON for /alt/ and failed on the `salt` field
   — a test bug, but the fix is the stronger assertion anyway: enumerate what
   the record may contain, so a field added later has to be looked at rather
   than slipping past a regex. */
{
  const fields = (obj) => Object.keys(obj).sort().join(',');
  const forbidden = /real|decoy|panic|duress|primary|alternate/i;
  const shapeOk = (rec) =>
    fields(rec) === 'kdf,slots,v' &&
    fields(rec.kdf) === 'alg,m,p,salt,t' &&
    rec.slots.every((s) => fields(s) === 'ct,n');
  const namesClean = (rec) =>
    ![...Object.keys(rec), ...Object.keys(rec.kdf),
      ...rec.slots.flatMap((s) => Object.keys(s))].some((k) => forbidden.test(k));

  check('the record holds exactly the fields it is allowed to hold',
    shapeOk(soloRecord) && shapeOk(pairRecord),
    `${fields(soloRecord)} | ${fields(soloRecord.kdf)}`);
  check('no field name marks a slot as real or as a decoy',
    namesClean(soloRecord) && namesClean(pairRecord));
  check('no stored key name marks a namespace as real or as a decoy',
    !soloKeys.some((k) => forbidden.test(k)) &&
    !pairKeys.some((k) => forbidden.test(k)));
}

check('no password hash of any kind is stored',
  !localStorage.getItem('poorija_master_hash') &&
  !localStorage.getItem('poorija_panic_hash'));

{
  const zeroRun = (b) => {
    let best = 0, cur = 0;
    for (const x of b) { cur = x === 0 ? cur + 1 : 0; if (cur > best) best = cur; }
    return best;
  };
  const runs = [...soloRecord.slots, ...pairRecord.slots]
    .map((s) => zeroRun(C.fromBase64(s.ct)));
  check('no slot contains a long run of zero bytes', runs.every((r) => r < 6),
    JSON.stringify(runs));
}

/* ===== the alternate is furnished from the first minute ================= */

console.log('\n===== the alternate at install =====');
{
  reset();
  const p = await V.createVault(REAL_PW);
  const meta = V.__internals.readMeta(p);

  check('setup records an alternate profile', Boolean(meta.alt && meta.alt.pid));
  check('the alternate has a different id', meta.alt && meta.alt.pid !== p.pid);

  const altHandle = V.__internals.attach(meta.alt, p.__key);
  const notes = V.decryptForProfile(altHandle,
    localStorage.getItem(V.profileKey(altHandle, 'secure_notes')));
  /* secure_notes, not notes: the decoy is written under the exact key the
     application reads, because a decoy whose notes tab is empty is a decoy
     that fails. */
  check('the alternate already holds notes at install',
    Array.isArray(notes) && notes.length >= 6, `${notes ? notes.length : 'null'}`);
  const keys = V.decryptForProfile(altHandle,
    localStorage.getItem(V.profileKey(altHandle, 'keys')));
  check('and keypairs', Array.isArray(keys) && keys.length >= 2);

  check('the alternate is unreachable until a password is set for it',
    (await V.openVault(DECOY_PW)) === null);

  /* Content written at install must survive the re-key. This is the whole
     reason the data key lives in the envelope instead of being derived from
     the vault key — deriving it would orphan every byte on a password change. */
  const before = JSON.stringify(notes);
  const d = await V.setAlternatePassword(p, DECOY_PW);
  const opened = await V.openVault(DECOY_PW);
  const after = JSON.stringify(V.decryptForProfile(opened,
    localStorage.getItem(V.profileKey(opened, 'secure_notes'))));
  check('setting the duress password keeps the content already there',
    before === after && before.length > 50);
  check('and it opens the profile that has existed since install',
    opened.pid === d.pid && opened.pid === meta.alt.pid);
}

/* The alternate must not be stamped with the moment duress was configured. */
{
  reset();
  const p = await V.createVault(REAL_PW);
  const meta = V.__internals.readMeta(p);
  check('the alternate is born with the vault, not when duress is set',
    Math.abs(meta.alt.born - p.born) < 1000, `${meta.alt.born - p.born}ms apart`);
  const d = await V.setAlternatePassword(p, DECOY_PW);
  check('and setting the password later does not restamp it',
    d.born === meta.alt.born);
}

/* Only the real profile knows about the alternate. The leak must run one way:
   holding the real password reveals an alternate exists; holding the
   alternate's reveals nothing. */
{
  reset();
  const p = await V.createVault(REAL_PW);
  await V.setAlternatePassword(p, DECOY_PW);
  const d = await V.openVault(DECOY_PW);
  const dMeta = V.__internals.readMeta(d);
  check('the alternate profile does not know about any other profile',
    !dMeta.alt, JSON.stringify(Object.keys(dMeta)));
  check('but it holds a meta entry of its own, so the shape matches',
    localStorage.getItem(V.profileKey(d, 'meta')) !== null);
}

/* ===== slot order carries no information ================================ */

console.log('\n===== slot ordering =====');
{
  let atZero = 0;
  const rounds = 200;
  for (let i = 0; i < rounds; i++) {
    reset();
    const p = await V.createVault(REAL_PW);
    const rec = V.__internals.readVaultRecord();
    const key = await globalThis.hashwasm.argon2id({
      password: REAL_PW, salt: C.fromBase64(rec.kdf.salt), hashLength: 32
    });
    const env = V.__internals.tryOpenSlot(key, rec.slots[0]);
    if (env && env.pid === p.pid) atZero++;
  }
  const ratio = atZero / rounds;
  check('the user\'s own slot lands in either position about half the time',
    ratio > 0.35 && ratio < 0.65, `${atZero}/${rounds} = ${ratio.toFixed(2)}`);
}

/* ===== opening ========================================================== */

console.log('\n===== opening =====');
reset();
const realProfile = await V.createVault(REAL_PW);
const decoyProfile = await V.setAlternatePassword(realProfile, DECOY_PW);
{
  check('the real password opens the real profile',
    (await V.openVault(REAL_PW))?.pid === realProfile.pid);
  check('the duress password opens the alternate profile',
    (await V.openVault(DECOY_PW))?.pid === decoyProfile.pid);
  check('the two profiles have different ids',
    realProfile.pid !== decoyProfile.pid);
  check('a wrong password opens neither',
    (await V.openVault('not-either-of-them')) === null);
  check('an empty password opens neither', (await V.openVault('')) === null);
}

/* A vault where duress was never configured must not open for guesses — the
   alternate slot is sealed under a discarded random password. */
{
  reset();
  await V.createVault(REAL_PW);
  let anyOpened = false;
  for (const guess of ['', 'x', REAL_PW + '1', DECOY_PW, 'password', '0000']) {
    if (await V.openVault(guess)) anyOpened = true;
  }
  check('an unconfigured alternate opens for nothing', !anyOpened);
}

/* ===== the two profiles are cryptographically separate ================== */

console.log('\n===== separation =====');
reset();
const A = await V.createVault(REAL_PW);
const B = await V.setAlternatePassword(A, DECOY_PW);
{
  const secret = { note: 'the thing that must not be readable', n: 42 };
  const sealedByA = V.encryptForProfile(A, secret);

  check('a profile reads back its own data',
    V.decryptForProfile(A, sealedByA)?.note === secret.note);
  check('the other profile cannot read it',
    V.decryptForProfile(B, sealedByA) === null);
  check('the profiles hold different data keys',
    C.toHex(A.__data) !== C.toHex(B.__data));
  check('storage keys are namespaced per profile',
    V.profileKey(A, 'notes') !== V.profileKey(B, 'notes') &&
    V.profileKey(A, 'notes').startsWith(V.PROFILE_PREFIX));
  check('the namespaced keys are identically shaped',
    V.profileKey(A, 'notes').replace(/[0-9a-f]{32}/, '<pid>') ===
    V.profileKey(B, 'notes').replace(/[0-9a-f]{32}/, '<pid>'));

  /* The profile id is the AAD, so a blob moved between profiles fails to open
     rather than decrypting to something. */
  check('a blob copied into the other profile does not open',
    V.decryptForProfile(B, sealedByA) === null);
}

/* ===== refusing a password that already works =========================== */

console.log('\n===== duplicate passwords =====');
{
  reset();
  const p = await V.createVault(REAL_PW);
  let threw = '';
  try { await V.setAlternatePassword(p, REAL_PW); }
  catch (error) { threw = error.message; }
  check('the duress password cannot be the one already in use',
    threw === 'DUPLICATE_PASSWORD', threw || 'no error thrown');
  check('and the real vault is untouched by the refusal',
    (await V.openVault(REAL_PW))?.pid === p.pid);
}

/* ===== clearing ========================================================= */

console.log('\n===== clearing =====');
{
  reset();
  const p = await V.createVault(REAL_PW);
  const d = await V.setAlternatePassword(p, DECOY_PW);
  const beforeKeys = localStorage.keys().slice().sort();

  check('clearing reports success', (await V.clearAlternate(p)) === true);
  check('the duress password no longer opens anything',
    (await V.openVault(DECOY_PW)) === null);
  check('the real password still opens the real profile',
    (await V.openVault(REAL_PW))?.pid === p.pid);
  check('clearing changes nothing about which keys exist',
    JSON.stringify(localStorage.keys().slice().sort()) === JSON.stringify(beforeKeys),
    `${beforeKeys.length} keys`);

  const rec = V.__internals.readVaultRecord();
  check('two slots of the standard length remain after clearing',
    rec.slots.length === 2 &&
    rec.slots.every((s) => C.fromBase64(s.ct).length === V.SLOT_CIPHERTEXT_BYTES));

  /* Deliberately left in place. Deleting it would shrink the key set and tell
     anyone who had seen the device before that something was removed. */
  check('the alternate profile\'s content is left where it was',
    localStorage.getItem(V.profileKey(d, 'secure_notes')) !== null);
}

/* ===== legacy migration removes the leak ================================ */

console.log('\n===== migrating off the old format =====');
{
  reset();
  localStorage.setItem('poorija_master_hash',
    JSON.stringify({ v: 2, kdf: 'argon2id', phc: '$argon2id$v=19$m=65536,t=3,p=1$abc$def' }));
  localStorage.setItem('poorija_panic_hash', 'a'.repeat(64));
  localStorage.setItem('poorija_storage_salt', 'c2FsdHNhbHRzYWx0c2E=');

  check('the old format is detected', V.hasLegacyVault() === true);

  const migrated = await V.migrateLegacy(REAL_PW, async () => true);
  check('migration produces a profile', Boolean(migrated?.pid));
  check('the old master hash is deleted',
    localStorage.getItem('poorija_master_hash') === null);
  check('THE OLD PANIC HASH IS DELETED — this is the leak being closed',
    localStorage.getItem('poorija_panic_hash') === null);
  check('the migrated password opens the new vault',
    (await V.openVault(REAL_PW))?.pid === migrated.pid);
  check('the migrated vault gets an alternate like any other',
    Boolean(V.__internals.readMeta(migrated).alt));

  const leftovers = localStorage.keys().filter((k) => /hash|panic/i.test(k));
  check('nothing hash-shaped is left behind', leftovers.length === 0,
    leftovers.join(','));
}

{
  reset();
  localStorage.setItem('poorija_master_hash', JSON.stringify({ v: 2 }));
  localStorage.setItem('poorija_panic_hash', 'b'.repeat(64));
  check('a failed migration returns null',
    (await V.migrateLegacy('wrong', async () => false)) === null);
  check('and leaves the old data in place for the next attempt',
    localStorage.getItem('poorija_master_hash') !== null);
}

/* ===== the decoy has to look lived-in =================================== */

console.log('\n===== decoy content =====');
{
  const content = await V.generateDecoyContent();

  check('it has several contacts',
    content.contacts.length >= 4 && content.contacts.length <= 7,
    `${content.contacts.length}`);
  check('it has notes with real text',
    content.notes.length >= 6 && content.notes.every((n) => n.content.length > 10),
    `${content.notes.length}`);
  check('it has saved logins', content.passwords.length >= 3);
  check('it has history entries', content.history.length >= 5);
  check('it has keypairs', content.keys.length >= 2, `${content.keys.length}`);

  /* A key that does not verify is the first thing that would betray a decoy. */
  if (content.keys.length) {
    const k = content.keys[0];
    let usable = false;
    try {
      const pub = await webcrypto.subtle.importKey('spki', C.fromBase64(k.publicKey),
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
      const priv = await webcrypto.subtle.importKey('pkcs8', C.fromBase64(k.privateKey),
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
      const msg = C.utf8('probe');
      const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, msg);
      usable = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, msg);
    } catch (error) { usable = false; }
    check('the decoy keys are real and actually sign and verify', usable);
  }

  const now = Date.now();
  const stamps = [
    ...content.notes.map((n) => n.createdAt),
    ...content.contacts.map((c) => c.addedAt),
    ...content.history.map((h) => h.at)
  ];
  check('nothing in the decoy is dated in the future', stamps.every((t) => t <= now));
  const oldest = Math.min(...stamps);
  check('the decoy stretches back months, not minutes',
    (now - oldest) > 90 * 86400000, `${Math.round((now - oldest) / 86400000)} days`);
  check('its timestamps are spread out rather than clustered',
    (Math.max(...stamps) - oldest) / 86400000 > 30);
  check('two decoys are not identical',
    JSON.stringify((await V.generateDecoyContent()).contacts) !==
    JSON.stringify(content.contacts));
}

/* ===== the profile handle does not leak keys ============================ */

console.log('\n===== key handling =====');
{
  reset();
  const p = await V.createVault(REAL_PW);
  const serialised = JSON.stringify(p);
  check('serialising a profile does not write its keys out',
    !serialised.includes('__key') && !serialised.includes('__data') &&
    !serialised.includes(C.toHex(p.__key)));
  check('but the keys are there for the code that needs them',
    p.__key instanceof Uint8Array && p.__data instanceof Uint8Array);
}

const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
