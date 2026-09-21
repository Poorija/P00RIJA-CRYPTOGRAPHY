/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* =====================================================================
   Full encrypted vault backup
   ---------------------------------------------------------------------
   The migration export already carried keys, passwords, notes and
   settings. It never carried the half of the app that lives outside
   localStorage: the chat history and contacts, the sticker packs, the
   custom ringtones, and the media vault - which is where every file,
   voice note and sticker anyone ever sent now lives. Losing a device
   meant losing all of it.

   This writes one file that holds everything, sealed with a password of
   the user's choosing so it can be restored onto a device that has
   never seen their master password.

   Key derivation is Argon2id, not PBKDF2: a backup file is the one
   artefact that leaves the device and can be attacked offline, forever,
   on whatever hardware the attacker likes. Memory-hardness is what
   makes that expensive.

   Media records are copied exactly as they already are. They are
   ciphertext in IndexedDB and the key that opens them travels inside the
   localStorage snapshot, so decrypting and re-encrypting them here would
   cost minutes and buy nothing.
   ===================================================================== */
(function (global) {
  'use strict';

  const MAGIC = 'P00RIJA-VAULT ';
  const FORMAT_VERSION = 1;
  const LS_PREFIX = /^(poorija_|monitor_)/;
  const MEDIA_DB = 'poorija-media';
  const STICKER_DB = 'poorija-stickers';

  const t = (fa, en) => (global.PoorijaApp?.state?.language === 'en' ? en : fa);

  function bytesToBase64(bytes) {
    let binary = '';
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const CHUNK = 0x8000;
    for (let i = 0; i < view.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  function base64ToBytes(text) {
    const binary = atob(String(text || ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function openDb(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('cannot open ' + name));
      /* Deliberately empty: if the database does not exist yet there is simply
         nothing of that kind to back up, and creating it here would be a lie. */
      request.onupgradeneeded = () => {};
    });
  }
  async function readStore(dbName, storeName) {
    let db;
    try { db = await openDb(dbName); } catch (_error) { return []; }
    if (!db.objectStoreNames.contains(storeName)) { db.close(); return []; }
    const rows = await new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
    db.close();
    return rows;
  }
  async function writeStore(dbName, storeName, rows, version) {
    if (!rows.length) return 0;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, version);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath: 'id' });
          if (storeName === 'blobs') {
            store.createIndex('conversationId', 'conversationId', { unique: false });
            store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    /* An aborted transaction writes nothing (IndexedDB rolls the puts back),
       so it has to count as zero — the caller reports these numbers as what
       was actually restored. */
    const committed = await new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      rows.forEach((row) => store.put(row));
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(false);
    });
    db.close();
    return committed ? rows.length : 0;
  }

  async function blobToBase64(blob) {
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }

  async function collectSnapshot() {
    const localStore = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && LS_PREFIX.test(key)) localStore[key] = localStorage.getItem(key);
    }

    const mediaRows = await readStore(MEDIA_DB, 'blobs');
    const media = mediaRows.map((row) => ({
      ...row,
      cipher: bytesToBase64(row.cipher instanceof ArrayBuffer ? new Uint8Array(row.cipher) : row.cipher),
    }));

    const packRows = await readStore(STICKER_DB, 'packs');
    const packs = [];
    for (const pack of packRows) {
      const stickers = [];
      for (const sticker of pack.stickers || []) {
        stickers.push({
          ...sticker,
          blob: await blobToBase64(sticker.blob),
          blobType: sticker.blob?.type || '',
        });
      }
      packs.push({ ...pack, stickers });
    }

    const soundRows = await readStore(STICKER_DB, 'sounds');
    const sounds = [];
    for (const sound of soundRows) {
      sounds.push({ ...sound, blob: await blobToBase64(sound.blob), blobType: sound.blob?.type || '' });
    }

    return {
      app: 'P00RIJA Cryptography',
      createdAt: new Date().toISOString(),
      localStorage: localStore,
      media,
      packs,
      sounds,
      counts: {
        localStorage: Object.keys(localStore).length,
        media: media.length,
        packs: packs.length,
        sounds: sounds.length,
      },
    };
  }

  async function compress(bytes) {
    if (typeof CompressionStream !== 'function') return { bytes, gzip: false };
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), gzip: true };
  }
  async function decompress(bytes, gzip) {
    if (!gzip) return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function deriveBackupKey(password, salt, params) {
    const advanced = global.PoorijaAdvancedCrypto;
    if (!advanced?.deriveKeyArgon2id) throw new Error('ARGON2_UNAVAILABLE');
    const raw = await advanced.deriveKeyArgon2id(password, salt, {
      iterations: params.t,
      memorySize: params.m,
      parallelism: params.p,
      hashLength: 32,
    });
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function createBackup(password, onProgress = () => {}) {
    onProgress(t('در حال جمع‌آوری اطلاعات…', 'Collecting your data…'));
    const snapshot = await collectSnapshot();
    const plain = new TextEncoder().encode(JSON.stringify(snapshot));
    onProgress(t('در حال فشرده‌سازی…', 'Compressing…'));
    const packedResult = await compress(plain);
    onProgress(t('در حال رمزنگاری با Argon2id…', 'Encrypting with Argon2id…'));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const params = { m: 64 * 1024, t: 3, p: 1 };
    const key = await deriveBackupKey(password, salt, params);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packedResult.bytes));

    const header = JSON.stringify({
      v: FORMAT_VERSION,
      kdf: 'argon2id',
      m: params.m,
      t: params.t,
      p: params.p,
      gzip: packedResult.gzip,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      createdAt: snapshot.createdAt,
      counts: snapshot.counts,
    });
    const headerBytes = new TextEncoder().encode(header);
    const magicBytes = new TextEncoder().encode(MAGIC);
    const lengthBytes = new Uint8Array(4);
    new DataView(lengthBytes.buffer).setUint32(0, headerBytes.length, true);

    const file = new Blob([magicBytes, lengthBytes, headerBytes, cipher], { type: 'application/octet-stream' });
    return { file, counts: snapshot.counts };
  }

  async function readBackupHeader(file) {
    const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
    if (head.length < MAGIC.length + 4) throw new Error('NOT_A_VAULT_BACKUP');
    const magic = new TextDecoder().decode(head.subarray(0, MAGIC.length));
    if (magic !== MAGIC) throw new Error('NOT_A_VAULT_BACKUP');
    const headerLength = new DataView(head.buffer).getUint32(MAGIC.length, true);
    const headerBytes = await file.slice(MAGIC.length + 4, MAGIC.length + 4 + headerLength).arrayBuffer();
    const header = JSON.parse(new TextDecoder().decode(headerBytes));
    return { header, offset: MAGIC.length + 4 + headerLength };
  }

  /* The app keeps writing while a restore runs: the chat module flushes its
     history on a debounce, the settings screen saves on change. Measured on a
     real restore, 1777 bytes of recovered chat history were overwritten by an
     empty one 1.5s later, before the reload could happen. Take the pen away
     from everyone else for the few hundred milliseconds this takes.

     It IS put back now, though. The first version never restored the native
     method because "the page reloads immediately afterwards" — but the reload
     only happens on success. When restore throws partway (quota, a bad store,
     a decode failure), the page survives with the patch still installed, and
     every later localStorage write in that session silently no-ops while
     saveEncrypted reports success. release() exists so the caller can put the
     prototype back no matter how the restore ends. */
  function seizeLocalStorage() {
    const native = Storage.prototype.setItem;
    let mine = false;
    function guardedSetItem(key, value) {
      if (!mine) return undefined;
      return native.call(this, key, value);
    }
    Storage.prototype.setItem = guardedSetItem;
    const write = (key, value) => {
      mine = true;
      try { native.call(localStorage, key, value); } finally { mine = false; }
    };
    const release = () => {
      /* Restore only our own patch; if something else wrapped setItem after
         the seize, clobbering it would break their guard, not ours. */
      if (Storage.prototype.setItem === guardedSetItem) Storage.prototype.setItem = native;
    };
    return { write, release };
  }

  async function restoreBackup(file, password, options = {}) {
    const onProgress = options.onProgress || (() => {});
    onProgress(t('در حال خواندن فایل…', 'Reading the file…'));
    const parsed = await readBackupHeader(file);
    const header = parsed.header;
    if (header.v !== FORMAT_VERSION) throw new Error('UNSUPPORTED_VERSION');
    const cipher = new Uint8Array(await file.slice(parsed.offset).arrayBuffer());
    onProgress(t('در حال بازکردن قفل با Argon2id…', 'Unlocking with Argon2id…'));
    const key = await deriveBackupKey(password, base64ToBytes(header.salt), { m: header.m, t: header.t, p: header.p });
    let packed;
    try {
      packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(header.iv) }, key, cipher));
    } catch (_error) {
      throw new Error('WRONG_PASSWORD');
    }
    const plain = await decompress(packed, header.gzip);
    const snapshot = JSON.parse(new TextDecoder().decode(plain));

    onProgress(t('در حال بازگرداندن…', 'Restoring…'));
    /* Every failed write is collected rather than swallowed. The old loop
       caught quota errors per key, said nothing, and reported the snapshot's
       counts as if they had been restored — then the caller reloaded the page,
       so whatever the running app still had in memory was discarded too. A
       restore that lost records has to say so and has to NOT reload. */
    const failed = [];
    const seize = seizeLocalStorage();
    try {
      let writtenLocal = 0;
      Object.entries(snapshot.localStorage || {}).forEach(([key2, value]) => {
        try { seize.write(key2, value); writtenLocal += 1; } catch (_error) { failed.push(key2); }
      });

      const media = (snapshot.media || []).map((row) => ({ ...row, cipher: base64ToBytes(row.cipher).buffer }));
      let writtenMedia = 0;
      try { writtenMedia = await writeStore(MEDIA_DB, 'blobs', media, 1); }
      catch (_error) { failed.push('media'); }

      const packs = (snapshot.packs || []).map((pack) => ({
        ...pack,
        stickers: (pack.stickers || []).map((sticker) => ({
          ...sticker,
          blob: new Blob([base64ToBytes(sticker.blob)], { type: sticker.blobType || sticker.mime || 'image/webp' }),
        })),
      }));
      const sounds = (snapshot.sounds || []).map((sound) => ({
        ...sound,
        blob: new Blob([base64ToBytes(sound.blob)], { type: sound.blobType || sound.mime || 'audio/mpeg' }),
      }));
      let writtenPacks = 0;
      let writtenSounds = 0;
      try {
        if (packs.length) writtenPacks = await writeStore(STICKER_DB, 'packs', packs, 1);
      } catch (_error) { failed.push('packs'); }
      try {
        if (sounds.length) writtenSounds = await writeStore(STICKER_DB, 'sounds', sounds, 1);
      } catch (_error) { failed.push('sounds'); }

      if (failed.length) {
        const error = new Error('RESTORE_INCOMPLETE');
        error.detail = failed.join(', ');
        throw error;
      }
      /* Counts of what actually landed, not what the snapshot claimed. */
      return {
        header,
        counts: {
          ...snapshot.counts,
          localStorage: writtenLocal,
          media: writtenMedia,
          packs: writtenPacks,
          sounds: writtenSounds,
        },
      };
    } finally {
      seize.release();
    }
  }

  /* ---------------- UI ---------------------------------------------- */
  function setStatus(id, message, tone) {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = message;
    node.className = 'vault-backup-status ' + (tone || '');
  }

  function bindVaultBackupUi() {
    const exportBtn = document.getElementById('vaultBackupExportBtn');
    if (exportBtn && !exportBtn.dataset.bound) {
      exportBtn.dataset.bound = '1';
      exportBtn.addEventListener('click', async () => {
        const password = document.getElementById('vaultBackupPassword')?.value || '';
        const confirmPassword = document.getElementById('vaultBackupPasswordConfirm')?.value || '';
        if (password.length < 8) {
          setStatus('vaultBackupStatus', t('رمز پشتیبان باید حداقل ۸ کاراکتر باشد.', 'The backup password must be at least 8 characters.'), 'is-warn');
          return;
        }
        if (password !== confirmPassword) {
          setStatus('vaultBackupStatus', t('دو رمز یکسان نیستند.', 'The two passwords do not match.'), 'is-warn');
          return;
        }
        exportBtn.disabled = true;
        try {
          const result = await createBackup(password, (message) => setStatus('vaultBackupStatus', message));
          const counts = result.counts;
          const url = URL.createObjectURL(result.file);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'P00RIJA-Vault_' + new Date().toISOString().slice(0, 10) + '.pkgvault';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 8000);
          const size = global.PoorijaApp?.formatBytes?.(result.file.size) || Math.round(result.file.size / 1024) + ' KB';
          setStatus('vaultBackupStatus', t(
            'پشتیبان ساخته شد — ' + size + ': ' + counts.localStorage + ' رکورد خزانه، ' + counts.media + ' پیوست، ' + counts.packs + ' پک استیکر، ' + counts.sounds + ' صدا.',
            'Backup created — ' + size + ': ' + counts.localStorage + ' vault records, ' + counts.media + ' attachments, ' + counts.packs + ' sticker packs, ' + counts.sounds + ' sounds.',
          ), 'is-ok');
          localStorage.setItem('poorija_last_backup_at', new Date().toISOString());
          const passwordInput = document.getElementById('vaultBackupPassword');
          const confirmInput = document.getElementById('vaultBackupPasswordConfirm');
          if (passwordInput) passwordInput.value = '';
          if (confirmInput) confirmInput.value = '';
        } catch (error) {
          console.error('[Vault backup] export failed', error);
          setStatus('vaultBackupStatus', t('ساخت پشتیبان ناموفق بود.', 'Creating the backup failed.'), 'is-bad');
        } finally {
          exportBtn.disabled = false;
        }
      });
    }

    const restoreBtn = document.getElementById('vaultRestoreBtn');
    if (restoreBtn && !restoreBtn.dataset.bound) {
      restoreBtn.dataset.bound = '1';
      restoreBtn.addEventListener('click', async () => {
        const file = document.getElementById('vaultRestoreFile')?.files?.[0];
        const password = document.getElementById('vaultRestorePassword')?.value || '';
        if (!file || !password) {
          setStatus('vaultRestoreStatus', t('فایل پشتیبان و رمز آن را وارد کنید.', 'Choose the backup file and enter its password.'), 'is-warn');
          return;
        }
        const ok = await PoorijaDialogs.confirm(t(
          'بازگردانی، اطلاعات فعلی این دستگاه را با محتوای پشتیبان جایگزین می‌کند و برنامه دوباره بارگذاری می‌شود. ادامه می‌دهید؟',
          'Restoring replaces this device data with the backup and reloads the app. Continue?',
        ));
        if (!ok) return;
        restoreBtn.disabled = true;
        try {
          const result = await restoreBackup(file, password, { onProgress: (m) => setStatus('vaultRestoreStatus', m) });
          const counts = result.counts;
          setStatus('vaultRestoreStatus', t(
            'بازگردانی شد: ' + (counts.localStorage || 0) + ' رکورد، ' + (counts.media || 0) + ' پیوست، ' + (counts.packs || 0) + ' پک. در حال بارگذاری مجدد…',
            'Restored ' + (counts.localStorage || 0) + ' records, ' + (counts.media || 0) + ' attachments, ' + (counts.packs || 0) + ' packs. Reloading…',
          ), 'is-ok');
          setTimeout(() => window.location.reload(), 1600);
        } catch (error) {
          const map = {
            NOT_A_VAULT_BACKUP: t('این فایل یک پشتیبان کامل P00RIJA نیست.', 'That file is not a P00RIJA vault backup.'),
            WRONG_PASSWORD: t('رمز اشتباه است یا فایل آسیب دیده.', 'Wrong password, or the file is damaged.'),
            UNSUPPORTED_VERSION: t('نسخهٔ این پشتیبان پشتیبانی نمی‌شود.', 'That backup version is not supported.'),
            ARGON2_UNAVAILABLE: t('ماژول Argon2 بارگذاری نشد.', 'The Argon2 module did not load.'),
            /* Partial restore: no reload happens for this one, on purpose —
               reloading would throw away the session state that is still
               intact and replace the report with a fresh page. */
            RESTORE_INCOMPLETE: t(
              'بازگردانی ناقص ماند؛ این رکوردها نوشته نشدند: ' + (error.detail || '?') + '. صفحه بارگذاری مجدد نمی‌شود؛ فضای دستگاه را بررسی کنید.',
              'Restore left these records unwritten: ' + (error.detail || '?') + '. The page will not reload; check device storage.',
            ),
          };
          setStatus('vaultRestoreStatus', map[error.message] || t('بازگردانی ناموفق بود.', 'Restore failed.'), 'is-bad');
          if (!map[error.message]) console.error('[Vault backup] restore failed', error);
        } finally {
          restoreBtn.disabled = false;
        }
      });
    }

    const fileInput = document.getElementById('vaultRestoreFile');
    if (fileInput && !fileInput.dataset.bound) {
      fileInput.dataset.bound = '1';
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          const parsed = await readBackupHeader(file);
          const counts = parsed.header.counts || {};
          const when = new Date(parsed.header.createdAt);
          setStatus('vaultRestoreStatus', t(
            'پشتیبان ' + when.toLocaleString('fa-IR') + ' — ' + (counts.media || 0) + ' پیوست، ' + (counts.packs || 0) + ' پک استیکر.',
            'Backup from ' + when.toLocaleString('en-GB') + ' — ' + (counts.media || 0) + ' attachments, ' + (counts.packs || 0) + ' sticker packs.',
          ));
        } catch (_error) {
          setStatus('vaultRestoreStatus', t('این فایل یک پشتیبان کامل P00RIJA نیست.', 'That file is not a P00RIJA vault backup.'), 'is-bad');
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindVaultBackupUi);
  else bindVaultBackupUi();
  global.addEventListener('poorija:tab-switched', bindVaultBackupUi);
  global.addEventListener('poorija:unlock', bindVaultBackupUi);

  global.PoorijaVaultBackup = {
    createBackup,
    restoreBackup,
    readBackupHeader,
    collectSnapshot,
    bindUi: bindVaultBackupUi,
  };
}(typeof globalThis !== 'undefined' ? globalThis : window));
