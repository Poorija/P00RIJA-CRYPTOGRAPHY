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

   Does an existing installation survive being upgraded, and does a profile's
   data survive a reload?

   These two questions used to have the same answer — yes — because everything
   lived under flat `poorija_*` names. Introducing per-profile namespacing for
   the duress vault split that in two, and got both wrong:

     - The legacy migration read the old flat keys through the very redirection
       it was supposed to be migrating them out of, so it looked up
       `poorija_p_<pid>_chat_identity` while trying to read
       `poorija_chat_identity`. It found nothing, moved nothing, and reported
       success. Every upgrading user's chat identity, contacts, keys and notes
       were orphaned — not deleted, but under names the app no longer read.
       The visible symptom was a chat identity that reset at every login.

     - The same redirection applied to the *delete* pass, so a migration that
       had worked would have deleted the freshly written copy. Two bugs that
       cancelled out, which is the worst way for a bug to hide.

   Both are cheap to test and expensive to miss, so they are tested here
   against the real unlock path rather than against a mock of it.             */

import { chromium } from 'playwright';

const URL = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 160)));

/* domcontentloaded then wait for the modules: `load` waits on fonts and every
   image, which on a remote host takes long enough that a probe written against
   it times out and reports the app as broken when it is merely slow. */
async function boot() {
  await page.goto(`${URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.PoorijaVault?.openVault === 'function' &&
          typeof window.migrateLegacyStorageIntoProfile === 'function',
    null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

/* ===== a profile's data survives a reload =============================== */

console.log('\n===== a fresh install, across a reload =====');
const PW_A = 'fresh-install-password-42';
await boot();
await page.evaluate(() => localStorage.clear());
await boot();

const created = await page.evaluate(async (pw) => {
  await window.writeMasterPasswordRecord(pw);
  const app = window.PoorijaApp;
  localStorage.setItem('poorija_chat_identity',
    app.encryptStorageData({ fingerprint: 'FP-STABLE-12345' }));
  localStorage.setItem('poorija_chat_settings',
    app.encryptStorageData({ lockPin: '4321' }));
  return {
    pid: app.state.activeProfile?.pid,
    namespaced: Object.keys(localStorage).some((k) => k.includes('_chat_identity') &&
                                                     k.startsWith('poorija_p_'))
  };
}, PW_A);

check('setup opens a profile', Boolean(created.pid), created.pid);
check('chat data is written into that profile\'s namespace', created.namespaced === true);

await boot();   /* a full reload is what "logging in again" actually is */
const reopened = await page.evaluate(async (pw) => {
  const opened = await window.PoorijaVault.openVault(pw);
  const app = window.PoorijaApp;
  app.state.activeProfile = opened;
  app.state.masterPassword = pw;
  app.state.isLocked = false;
  return {
    pid: opened?.pid,
    identity: app.decryptStorageData(localStorage.getItem('poorija_chat_identity'))?.fingerprint ?? null,
    settings: app.decryptStorageData(localStorage.getItem('poorija_chat_settings'))?.lockPin ?? null
  };
}, PW_A);

check('the profile id is the same after a reload',
  reopened.pid === created.pid, `${created.pid} -> ${reopened.pid}`);
check('THE CHAT IDENTITY SURVIVES THE RELOAD',
  reopened.identity === 'FP-STABLE-12345', reopened.identity ?? 'null');
check('the chat lock settings survive the reload',
  reopened.settings === '4321', reopened.settings ?? 'null');

/* ===== an existing 2.99.90 install, upgraded ============================ */

console.log('\n===== upgrading an install that already had data =====');
const PW_B = 'the-existing-user-password';
await boot();

/* Write exactly what the CryptoJS build wrote: a bare SHA-256 master record
   and v3 envelopes (PBKDF2-SHA256 -> AES-256-CBC, HMAC-SHA256 over the
   envelope string). Building them here rather than committing a fixture means
   the test proves the reader against the format, not against a blob whose
   provenance nobody remembers. */
const planted = await page.evaluate(async (pw) => {
  localStorage.clear();
  const enc = new TextEncoder();
  const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));

  const digest = await crypto.subtle.digest('SHA-256', enc.encode(pw));
  localStorage.setItem('poorija_master_hash',
    [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''));

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = b64(saltBytes);
  localStorage.setItem('poorija_storage_key_salt_v3', salt);

  const material = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' }, material, 512));
  const encKey = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-CBC' }, false, ['encrypt']);
  const macKey = await crypto.subtle.importKey('raw', bits.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const write = async (key, value) => {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const ct = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, encKey, enc.encode(JSON.stringify(value)));
    const env = { v: 3, alg: 'AES-256-CBC-HMAC-SHA256', kdf: 'PBKDF2-SHA256', it: 250000,
                  s: salt, iv: b64(iv), ct: b64(ct) };
    env.mac = b64(await crypto.subtle.sign('HMAC', macKey,
      enc.encode(`${env.v}.${env.alg}.${env.it}.${env.s}.${env.iv}.${env.ct}`)));
    localStorage.setItem(key, JSON.stringify(env));
  };

  await write('poorija_chat_identity', { fingerprint: 'OLD-USER-FP-777' });
  await write('poorija_chat_settings', { lockPin: '1379' });
  await write('poorija_chat_contacts', [{ id: 'c1', name: 'a contact from before' }]);
  await write('poorija_keys', [{ id: 1, tag: 'my old key' }]);
  await write('poorija_notes', [{ id: 9, title: 'note from before' }]);
  await write('poorija_passwords', [{ id: 3, label: 'old login' }]);

  return Object.keys(localStorage).filter((k) => k.startsWith('poorija_')).length;
}, PW_B);
check('a 2.99.90-shaped install is in place', planted >= 8, `${planted} keys`);

const upgraded = await page.evaluate(async (pw) => {
  const app = window.PoorijaApp;
  const opened = await window.openVaultForUnlock(pw);
  if (!opened) return { error: 'the old password did not open anything' };
  window.adoptProfile(opened, pw);
  app.state.isLocked = false;
  const report = await window.migrateLegacyStorageIntoProfile(opened, pw);
  const read = (k) => app.decryptStorageData(localStorage.getItem(k));
  return {
    pid: opened.pid,
    moved: report.moved,
    skipped: report.skipped,
    identity: read('poorija_chat_identity')?.fingerprint ?? null,
    settings: read('poorija_chat_settings')?.lockPin ?? null,
    contact: read('poorija_chat_contacts')?.[0]?.name ?? null,
    note: read('poorija_notes')?.[0]?.title ?? null,
    key: read('poorija_keys')?.[0]?.tag ?? null,
    password: read('poorija_passwords')?.[0]?.label ?? null,
    orphans: Object.keys(localStorage)
      .filter((k) => /^poorija_(chat_identity|chat_settings|chat_contacts|keys|notes|passwords)$/.test(k)),
    masterHashGone: localStorage.getItem('poorija_master_hash') === null,
    saltGone: localStorage.getItem('poorija_storage_key_salt_v3') === null
  };
}, PW_B);

check('the old password still opens the vault', !upgraded.error, upgraded.error || '');
check('nothing was skipped as unreadable',
  (upgraded.skipped || []).length === 0, JSON.stringify(upgraded.skipped));
check('no entry was migrated twice',
  new Set(upgraded.moved || []).size === (upgraded.moved || []).length,
  JSON.stringify(upgraded.moved));

check('THE CHAT IDENTITY SURVIVES THE UPGRADE',
  upgraded.identity === 'OLD-USER-FP-777', upgraded.identity ?? 'null');
check('the chat lock settings survive the upgrade',
  upgraded.settings === '1379', upgraded.settings ?? 'null');
check('contacts survive', upgraded.contact === 'a contact from before', upgraded.contact ?? 'null');
check('notes survive', upgraded.note === 'note from before', upgraded.note ?? 'null');
check('keys survive', upgraded.key === 'my old key', upgraded.key ?? 'null');
check('saved passwords survive', upgraded.password === 'old login', upgraded.password ?? 'null');

check('nothing is left orphaned at a flat name',
  (upgraded.orphans || []).length === 0, JSON.stringify(upgraded.orphans));
check('the old master hash is gone afterwards', upgraded.masterHashGone === true);
check('the old storage salt is gone afterwards', upgraded.saltGone === true);

/* And it has to still be there on the NEXT login — the symptom the user
   reported was an identity that came back different every time. */
await boot();
const secondLogin = await page.evaluate(async (pw) => {
  const opened = await window.PoorijaVault.openVault(pw);
  const app = window.PoorijaApp;
  app.state.activeProfile = opened;
  app.state.masterPassword = pw;
  app.state.isLocked = false;
  return {
    pid: opened?.pid,
    identity: app.decryptStorageData(localStorage.getItem('poorija_chat_identity'))?.fingerprint ?? null
  };
}, PW_B);
check('the migrated profile is the same one on the next login',
  secondLogin.pid === upgraded.pid, `${upgraded.pid} -> ${secondLogin.pid}`);
check('AND THE IDENTITY IS STILL THE SAME ONE',
  secondLogin.identity === 'OLD-USER-FP-777', secondLogin.identity ?? 'null');

/* ===== changing the master password keeps the vault ===================== */

/* This turned out to be a worse bug than the one that started this file. All
   three of setup, "change password" and "reset password" called one helper,
   and it built a brand new vault every time — so changing your password from
   settings produced a new profile id, a new empty namespace, and silently
   orphaned every note, key, contact and message you had. */

console.log('\n===== changing the master password =====');
{
  const OLD = 'my-first-password-11';
  const NEW = 'my-second-password-22';
  await boot();

  const before = await page.evaluate(async (pw) => {
    localStorage.clear();
    await window.writeMasterPasswordRecord(pw);
    const app = window.PoorijaApp;
    localStorage.setItem('poorija_chat_identity', app.encryptStorageData({ fingerprint: 'MY-IDENTITY' }));
    localStorage.setItem('poorija_secure_notes', app.encryptStorageData([{ id: 1, title: 'a note I need' }]));
    const meta = window.PoorijaVault.__internals.readMeta(app.state.activeProfile);
    return { pid: app.state.activeProfile.pid, altPid: meta.alt?.pid };
  }, OLD);

  const after = await page.evaluate(async (pw) => {
    await window.writeMasterPasswordRecord(pw);
    const app = window.PoorijaApp;
    const read = (k) => { try { return app.decryptStorageData(localStorage.getItem(k)); } catch (e) { return null; } };
    const meta = window.PoorijaVault.__internals.readMeta(app.state.activeProfile);
    return {
      pid: app.state.activeProfile.pid,
      altPid: meta.alt?.pid,
      identity: read('poorija_chat_identity')?.fingerprint ?? null,
      note: read('poorija_secure_notes')?.[0]?.title ?? null,
      namespaces: new Set(Object.keys(localStorage).filter((k) => k.startsWith('poorija_p_'))
        .map((k) => k.slice(10).split('_')[0])).size
    };
  }, NEW);

  check('the profile id survives a password change',
    after.pid === before.pid, `${before.pid} -> ${after.pid}`);
  check('THE DATA SURVIVES A PASSWORD CHANGE',
    after.identity === 'MY-IDENTITY' && after.note === 'a note I need',
    JSON.stringify({ identity: after.identity, note: after.note }));
  check('no stale namespace is left behind',
    after.namespaces === 2, `${after.namespaces} namespaces`);
  check('the alternate profile is untouched by the change',
    after.altPid === before.altPid, `${before.altPid} -> ${after.altPid}`);

  const reopens = await page.evaluate(async (pws) => ({
    withNew: (await window.PoorijaVault.openVault(pws.n))?.pid ?? null,
    withOld: (await window.PoorijaVault.openVault(pws.o))?.pid ?? null
  }), { n: NEW, o: OLD });
  check('the new password opens it', reopens.withNew === before.pid, String(reopens.withNew));
  check('and the old password no longer does', reopens.withOld === null, String(reopens.withOld));
}

/* ===== every way in must open the vault ================================= */

/* Reported from a phone: display name and avatar gone after a restart, and a
   chat lock that said it was on while being neither stored nor applied.

   The cause was not saving. Nothing was ever saved. The three quick-unlock
   paths — desktop biometric, passkey largeBlob, passkey PRF — each set
   state.masterPassword to the recovered password and opened the interface
   without opening the vault, so state.activeProfile stayed null. isUnlocked()
   looked only at masterPassword and agreed the app was open; every encrypted
   write then threw into a catch that logged and continued.

   Two things are asserted here: the shared entry point opens the vault, and
   the interface refuses to appear unlocked without one. The second is what
   stops a fourth path from repeating this. */

console.log('\n===== quick unlock =====');
{
  const PW_C = 'quick-unlock-password-77';
  await boot();

  await page.evaluate(async (pw) => {
    localStorage.clear();
    await window.writeMasterPasswordRecord(pw);
  }, PW_C);

  await boot();
  const quick = await page.evaluate(async (pw) => {
    const app = window.PoorijaApp;
    const opened = await window.adoptFromPassword(pw);
    app.state.isLocked = false;
    let saveError = null;
    try {
      localStorage.setItem('poorija_chat_profile',
        app.encryptStorageData({ displayName: 'مریم', avatar: 'a' }));
      localStorage.setItem('poorija_chat_lock',
        app.encryptStorageData({ enabled: true, autoLockMinutes: 5 }));
    } catch (error) { saveError = String(error).slice(0, 90); }
    return {
      opened,
      hasProfile: Boolean(app.state.activeProfile),
      saveError,
      pid: app.state.activeProfile?.pid
    };
  }, PW_C);

  check('the shared entry point opens the vault', quick.opened === true);
  check('and a profile is actually open', quick.hasProfile === true);
  check('so an encrypted write does not throw', quick.saveError === null, quick.saveError || '');

  await boot();
  const persisted = await page.evaluate(async (pw) => {
    const app = window.PoorijaApp;
    await window.adoptFromPassword(pw);
    app.state.isLocked = false;
    return {
      pid: app.state.activeProfile?.pid,
      displayName: app.decryptStorageData(localStorage.getItem('poorija_chat_profile'))?.displayName ?? null,
      lockEnabled: app.decryptStorageData(localStorage.getItem('poorija_chat_lock'))?.enabled ?? null
    };
  }, PW_C);

  check('THE DISPLAY NAME SURVIVES A RESTART',
    persisted.displayName === 'مریم', persisted.displayName ?? 'null');
  check('AND SO DOES THE CHAT LOCK',
    persisted.lockEnabled === true, String(persisted.lockEnabled));
  check('on the same profile as before', persisted.pid === quick.pid);

  /* The structural guard. Without this the next quick-unlock path added would
     reproduce the bug exactly. */
  const guard = await page.evaluate(() => {
    const app = window.PoorijaApp;
    app.state.activeProfile = null;
    app.state.masterPassword = 'pretend';
    app.state.isLocked = true;
    window.unlockUI();
    return { stillLocked: app.state.isLocked, cleared: app.state.masterPassword === null };
  });
  check('the interface refuses to open without a profile', guard.stillLocked === true);
  check('and does not keep a password it cannot use', guard.cleared === true);

  /* Chat has to agree, or it renders and quietly discards everything. */
  const chatView = await page.evaluate(() => {
    const app = window.PoorijaApp;
    app.state.activeProfile = null;
    app.state.masterPassword = 'pretend';
    app.state.isLocked = false;
    try { return { chatThinksUnlocked: eval('isUnlocked()') }; }
    catch (error) { return { error: String(error).slice(0, 80) }; }
  });
  check('chat treats a missing profile as locked',
    chatView.chatThinksUnlocked === false, JSON.stringify(chatView));
}


/* ===== the lock screen can still read what it needs ===================== */

console.log('\n===== what the lock screen reads must not be redirected =====');
const lockScreen = await page.evaluate(() => {
  const V = window.PoorijaVault;
  /* Written while a profile is open; the lock screen reads them with none
     open, so they have to resolve to the same name in both states. */
  const needed = ['poorija_2fa', 'poorija_sq', 'poorija_sq_failed', 'poorija_settings',
                  'poorija_lang', 'poorija_theme', 'poorija_passkey_quick_unlock',
                  'poorija_installation_secret', 'poorija_failed_logins', 'poorija_lock_until'];
  return needed.filter((k) => !V.GLOBAL_KEYS.has(k));
});
check('every key the lock screen needs is exempt from redirection',
  lockScreen.length === 0, lockScreen.join(', '));

const scoped = await page.evaluate(() => {
  const V = window.PoorijaVault;
  /* The opposite: these carry a profile's own content and must be redirected,
     or the decoy would read and overwrite the real vault's chats. */
  const mustBeScoped = ['poorija_chat_identity', 'poorija_chat_history', 'poorija_chat_spaces',
                        'poorija_chat_contacts', 'poorija_notes', 'poorija_keys',
                        'poorija_passwords', 'poorija_secure_notes', 'poorija_convo_locks'];
  return mustBeScoped.filter((k) => V.GLOBAL_KEYS.has(k));
});
check('no key holding a profile\'s own content is exempt',
  scoped.length === 0, scoped.join(', '));

check('no uncaught page errors throughout',
  pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
