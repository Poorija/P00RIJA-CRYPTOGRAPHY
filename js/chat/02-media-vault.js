/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 2 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Media vault — attachments that survive a reload
*/

/* =====================================================================
   Sticker packs — import, storage, picker, send
   ---------------------------------------------------------------------
   Packs live in IndexedDB rather than localStorage. One WhatsApp pack is
   thirty WebP files; base64'd into a localStorage string it would blow
   past the 5 MB quota on its own and take the rest of the chat history
   down with it. IndexedDB stores the Blob as a Blob — no 33% inflation,
   no encode/decode on every open.

   Nothing here touches the network. Import reads local files the user
   picked, and sending a sticker goes down the same encrypted chunked
   transfer that files and voice notes already use.
   ===================================================================== */
/* =====================================================================
   Media vault — attachments that survive a reload
   ---------------------------------------------------------------------
   History is JSON in localStorage, and an attachment used to live in it
   as `downloadUrl: "blob:https://…"`. An object URL is a pointer into the
   page's memory, not into storage: the moment the tab closes the blob is
   gone and the saved string points at nothing. That is why every file,
   voice note and sticker went dead after a refresh — the bytes were
   never written down anywhere.

   Now the bytes go into IndexedDB, encrypted at rest with AES-256-GCM.
   The vault key is random, never derived per file, and is itself kept in
   localStorage under the master-password envelope the rest of the chat
   state already uses — so a stolen browser profile yields ciphertext.
   WebCrypto does the bulk work rather than CryptoJS: a 16 MB file
   through the CBC path in pure JS takes seconds and freezes the tab.
   ===================================================================== */
const MEDIA_DB_NAME = 'poorija-media';
const MEDIA_DB_VERSION = 1;
const MEDIA_STORE = 'blobs';
const MEDIA_KEY_STORAGE_KEY = 'poorija_chat_media_key';
const MEDIA_BUDGET_BYTES = 512 * 1024 * 1024;
const MEDIA_TYPES = new Set(['file', 'voice', 'sticker', 'stickerpack']);

let mediaDbPromise = null;
let mediaKeyPromise = null;
let mediaKeyOwner = "";

function openMediaDb() {
  if (mediaDbPromise) return mediaDbPromise;
  mediaDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = window.indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const store = db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
        store.createIndex('conversationId', 'conversationId', { unique: false });
        store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const reset = () => { mediaDbPromise = null; };
      db.onclose = reset;
      db.onversionchange = () => { db.close(); reset(); };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('media db open failed'));
  }).catch((error) => {
    mediaDbPromise = null;
    throw error;
  });
  return mediaDbPromise;
}

function mediaTx(mode, run) {
  return openMediaDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, mode);
    const request = run(tx.objectStore(MEDIA_STORE));
    // A successful put request is not a committed transaction. Safari can
    // abort the transaction on suspension after that request succeeds.
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error('media transaction aborted'));
    tx.onerror = () => reject(tx.error || new Error('media transaction failed'));
    if (request) {
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error('media request failed'));
    }
  }));
}

async function ensureMediaKey() {
  /* The stored key travels through the store cache, which serves reads while
     the vault is shut — attachments arrive while the user is away, and a
     vault that refused to hold them turned every locked-interval file into
     something only the current page load could see. Only MINTING a key
     needs the vault open, because only then can it be persisted for the
     next session. */
  const owner = chatStorageAddress(MEDIA_KEY_STORAGE_KEY);
  if (mediaKeyPromise && mediaKeyOwner === owner) return mediaKeyPromise;
  mediaKeyOwner = owner;
  mediaKeyPromise = (async () => {
    const stored = loadEncrypted(MEDIA_KEY_STORAGE_KEY, null);
    if (stored !== null) {
      if (typeof stored !== 'string' || stored.length < 40) throw new Error('Stored media key is invalid');
      try {
        return await crypto.subtle.importKey('raw', base64ToBytes(stored), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      } catch (_error) { throw new Error('Stored media key is invalid'); }
    }
    if (!isUnlocked()) throw new Error('Media vault is locked');
    if (unreadableChatStores.has(chatStorageAddress(MEDIA_KEY_STORAGE_KEY))) {
      throw new Error('Stored media key could not be read');
    }
    const raw = crypto.getRandomValues(new Uint8Array(32));
    if (!saveEncrypted(MEDIA_KEY_STORAGE_KEY, bytesToBase64(raw))) {
      throw new Error('Media key could not be persisted');
    }
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  })().catch((error) => {
    if (mediaKeyOwner === owner) mediaKeyPromise = null;
    throw error;
  });
  return mediaKeyPromise;
}

/* The one base64 pair for the whole chat payload.
 *
 * These two names are global — every js/chat/NN-*.js file shares one scope —
 * so a second declaration elsewhere does not shadow this one, it REPLACES it
 * for every caller including the ones above. js/chat/17-file-manager.js used
 * to declare its own pair fifteen files later and therefore won: an encoder
 * that appended one character per byte (about ten times slower on a
 * multi-megabyte chat export, and a TypeError on a plain ArrayBuffer) and a
 * decoder that answered a damaged archive with an empty array instead of an
 * error. Both were deleted; this pair is the only one. tools/global-collisions.cjs
 * fails the build if a third ever appears.
 */
function bytesToBase64(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : (bytes?.buffer || bytes || 0));
  /* 32 KB at a time: String.fromCharCode.apply blows the argument limit on a
     whole multi-megabyte attachment, and one character per byte is an order of
     magnitude slower. */
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
function base64ToBytes(text) {
  /* base64url and stray whitespace both arrive here — a QR payload wraps, and
     an identity blob may be URL-safe — so normalise before atob rather than
     letting a legal encoding look like a damaged one. Genuinely invalid input
     still throws: the callers are decrypt paths, and answering them with an
     empty array turns "this file is damaged" into a silent wrong-key failure. */
  const normalized = String(text || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function missingMediaHtml(label) {
  return `<div class="chat-media-missing"><i class="fas fa-cloud-arrow-down"></i><span>${app().escapeHTML(label)}</span></div>`;
}
function isMediaEntry(entry) {
  return Boolean(entry) && MEDIA_TYPES.has(entry.type);
}

/* Fire-and-forget from the send/receive paths: a vault write must never be
   able to hold up delivery or throw into the message pipeline. */
function persistMessageMedia(conversationId, entry, blob) {
  if (!entry?.id || !blob || !isMediaEntry(entry)) return Promise.resolve(false);
  /* The vault holds 512 MB in total and encrypts each entry in one piece, so a
     single large file would both spike memory and evict every other
     attachment. Above the cap the message keeps its object URL for this
     session and the user is offered the download instead. */
  if (blob.size > MEDIA_VAULT_MAX_FILE_BYTES) return Promise.resolve(false);
  return (async () => {
    const key = await ensureMediaKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = await blob.arrayBuffer();
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    await mediaTx('readwrite', (store) => store.put({
      id: entry.id,
      conversationId: conversationId || '',
      name: entry.name || '',
      mime: blob.type || entry.mime || 'application/octet-stream',
      kind: entry.type,
      stickerKind: entry.stickerKind || '',
      size: blob.size,
      iv: bytesToBase64(iv),
      cipher,
      createdAt: entry.createdAt || new Date().toISOString(),
      lastUsedAt: Date.now(),
    }));
    enforceMediaBudget().catch(() => {});
    return true;
  })().catch((error) => {
    console.warn('[Media] could not store attachment', entry?.id, error);
    return false;
  });
}

async function readMessageMedia(messageId) {
  if (!messageId) return null;
  const record = await mediaTx('readonly', (store) => store.get(messageId));
  if (!record?.cipher) return null;
  const key = await ensureMediaKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) }, key, record.cipher,
  );
  /* Touch the LRU stamp on read so an actively used thread is the last thing
     evicted when the budget bites. */
  mediaTx('readwrite', (store) => store.put({ ...record, lastUsedAt: Date.now() })).catch(() => {});
  return { blob: new Blob([plain], { type: record.mime || 'application/octet-stream' }), record };
}

function dropMessageMedia(messageId, { revokeUrl = true } = {}) {
  if (!messageId) return Promise.resolve();
  const url = chatState.mediaUrls.get(messageId);
  if (url) {
    /* view-once hands the URL to the viewer and revokes it on its own timer;
       pulling it here would close the media the user just opened. */
    if (revokeUrl) URL.revokeObjectURL(url);
    chatState.mediaUrls.delete(messageId);
  }
  return mediaTx('readwrite', (store) => store.delete(messageId)).catch(() => {});
}

function dropConversationMedia(conversationId) {
  if (!conversationId) return Promise.resolve();
  return openMediaDb()
    .then((db) => new Promise((resolve) => {
      const tx = db.transaction(MEDIA_STORE, 'readwrite');
      const cursorRequest = tx.objectStore(MEDIA_STORE).index('conversationId').openCursor(IDBKeyRange.only(conversationId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const url = chatState.mediaUrls.get(cursor.value.id);
        if (url) {
          URL.revokeObjectURL(url);
          chatState.mediaUrls.delete(cursor.value.id);
        }
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
    }))
    .catch(() => {});
}

/* Rehydrates every attachment in one conversation that lost its object URL,
   then asks for a single re-render. Guarded per conversation so a render
   triggered by the hydration cannot start another hydration. */
async function hydrateConversationMedia(conversationId) {
  if (!conversationId || chatState.mediaHydrating.has(conversationId)) return;
  const history = chatState.history[conversationId] || [];
  const pending = history.filter((entry) => isMediaEntry(entry) && !entry.downloadUrl && !entry.viewOnceConsumed);
  if (!pending.length) return;
  chatState.mediaHydrating.add(conversationId);
  let restored = 0;
  try {
    for (const entry of pending) {
      const cached = chatState.mediaUrls.get(entry.id);
      if (cached) {
        entry.downloadUrl = cached;
        restored += 1;
        continue;
      }
      const found = await readMessageMedia(entry.id).catch(() => null);
      if (!found) {
        entry.mediaMissing = true;
        continue;
      }
      const url = URL.createObjectURL(found.blob);
      chatState.mediaUrls.set(entry.id, url);
      entry.downloadUrl = url;
      entry.mime = entry.mime || found.record.mime;
      if (!entry.stickerKind && found.record.stickerKind) entry.stickerKind = found.record.stickerKind;
      entry.mediaMissing = false;
      restored += 1;
    }
  } finally {
    chatState.mediaHydrating.delete(conversationId);
  }
  if (restored && conversationId === chatState.activeConversationId) renderMessages();
  if (restored) renderPeers();
}

async function mediaStorageStats() {
  const stats = { count: 0, bytes: 0, oldest: 0 };
  try {
    const db = await openMediaDb();
    await new Promise((resolve) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly');
      const cursorRequest = tx.objectStore(MEDIA_STORE).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        stats.count += 1;
        stats.bytes += Number(cursor.value.size || cursor.value.cipher?.byteLength || 0);
        const stamp = Date.parse(cursor.value.createdAt || '') || cursor.value.lastUsedAt || 0;
        if (stamp && (!stats.oldest || stamp < stats.oldest)) stats.oldest = stamp;
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onabort = resolve;
    });
  } catch (_error) { /* report zeroes rather than break the settings card */ }
  return stats;
}

/* Oldest-touched records go first once the vault passes its budget, so the
   thread the user is actually in keeps its attachments. */
async function enforceMediaBudget(limit = MEDIA_BUDGET_BYTES) {
  const db = await openMediaDb();
  const rows = [];
  await new Promise((resolve) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const cursorRequest = tx.objectStore(MEDIA_STORE).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      rows.push({ id: cursor.value.id, size: Number(cursor.value.size || 0), lastUsedAt: Number(cursor.value.lastUsedAt || 0) });
      cursor.continue();
    };
    tx.oncomplete = resolve;
    tx.onabort = resolve;
  });
  let total = rows.reduce((sum, row) => sum + row.size, 0);
  if (total <= limit) return 0;
  rows.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  let evicted = 0;
  for (const row of rows) {
    if (total <= limit) break;
    await dropMessageMedia(row.id);
    total -= row.size;
    evicted += 1;
  }
  return evicted;
}

async function clearMediaVault({ olderThanDays = 0 } = {}) {
  const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * 86400000 : 0;
  const db = await openMediaDb();
  let removed = 0;
  await new Promise((resolve) => {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    const cursorRequest = tx.objectStore(MEDIA_STORE).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const stamp = Date.parse(cursor.value.createdAt || '') || Number(cursor.value.lastUsedAt || 0);
      if (!cutoff || stamp < cutoff) {
        const url = chatState.mediaUrls.get(cursor.value.id);
        if (url) {
          URL.revokeObjectURL(url);
          chatState.mediaUrls.delete(cursor.value.id);
        }
        cursor.delete();
        removed += 1;
      }
      cursor.continue();
    };
    tx.oncomplete = resolve;
    tx.onabort = resolve;
  });
  /* Anything just deleted must stop claiming it has a live URL, or the bubble
     keeps a dead blob: pointer until the next reload. */
  Object.values(chatState.history).forEach((list) => {
    (list || []).forEach((entry) => {
      if (isMediaEntry(entry) && entry.downloadUrl && !chatState.mediaUrls.has(entry.id)) {
        entry.downloadUrl = '';
        entry.mediaMissing = true;
      }
    });
  });
  storeHistory({ immediate: true });
  renderMessages();
  return removed;
}
