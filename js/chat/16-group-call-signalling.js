/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 16 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   function handleGroupCallSignal(message) {
*/

/* ---------------- signalling ----------------------------------------- */
function handleGroupCallSignal(message, { provenFingerprint = '' } = {}) {
  if (!message?.callId) return false;
  if (message.type === 'gcall-invite') {
    if (groupCallActive()) return true;
    if (message.fromFingerprint === myCallIdentity()) return true;
    /* A group this account has not accepted, or a caller nobody here chose,
       does not ring (49-message-requests.js). */
    if (!message.upgrade && typeof groupCallFromRequest === 'function'
      /* The caller as this device authenticated them — passed alongside the
         message, never read from it. */
      && groupCallFromRequest({ spaceId: message.spaceId, provenFingerprint })) {
      appendCall({
        name: message.groupName || message.callerName || t('تماس گروهی', 'Group call'),
        conversationId: message.callId,
        mode: message.mode === 'video' ? 'video' : 'voice',
        status: 'missed',
        direction: 'in',
        createdAt: new Date().toISOString(),
      });
      return true;
    }
    /* A relay-queued invite sits in the mailbox for as long as the mailbox
       does; ringing hours later for a call that ended long ago — and
       dropping the joiner alone into a dead room — is worse than a quiet
       missed-call row. */
    const queuedAtMs = Date.parse(message.queuedAt || '');
    if (Number.isFinite(queuedAtMs) && Date.now() - queuedAtMs > CALL_RING_TIMEOUT_MS) {
      appendCall({
        name: message.groupName || message.callerName || t('تماس گروهی', 'Group call'),
        conversationId: message.callId,
        mode: message.mode === 'video' ? 'video' : 'voice',
        status: 'missed',
        direction: 'in',
        createdAt: new Date().toISOString(),
      });
      return true;
    }
    /* An upgrade is not a new call to answer - it is the call you are already
       in, becoming a group call. Ringing here would look like the other side
       hanging up and immediately calling back. */
    if (message.upgrade) {
      const withThem = activeCallPeerRecord();
      const theirs = [withThem?.fingerprint, withThem?.peerId, withThem?.clientId].filter(Boolean);
      /* The call may already be gone by the time this lands: the other side
         tears the pair call down to free the microphone, and on a slow link
         that teardown can beat the notice here. Somebody we were on a call
         with moments ago is still "the call we are in" for this purpose -
         otherwise the upgrade rings like a fresh call, which is the whole
         thing this is meant to prevent. */
      const justLeft = chatState.lastPairCall
        && Date.now() - chatState.lastPairCall.endedAt < 25000
        && [chatState.lastPairCall.fingerprint, chatState.lastPairCall.peerId]
          .filter(Boolean).includes(message.fromFingerprint);
      const inItWithThem = chatState.currentCall
        && (theirs.includes(message.fromFingerprint) || theirs.length === 0);
      if (inItWithThem || justLeft) {
        if (chatState.currentCall) endCurrentCall({ logCall: false, notifyPeer: false });
        joinGroupCall(message.callId, message.spaceId, message.mode || 'voice',
          Array.isArray(message.roster) ? message.roster : []);
        notify(t('این تماس به تماس گروهی تبدیل شد.', 'This call became a group call.'), 'info');
        return true;
      }
    }
    showGroupCallInvite(message);
    return true;
  }
  if (message.type === 'call-accepted') {
    /* Answered. Stop the ringing tone and stop counting down the ring - but do
       not claim the call is up: the picture and sound still have to arrive,
       and saying "connected" before they do would be a different lie. */
    if (!chatState.currentCall || chatState.currentCallAnsweredAt) return true;
    stopSound('ringing');
    clearOutgoingRingTimer();
    const status = document.getElementById('chatFloatingCallStatus');
    if (status) status.textContent = t('پاسخ داده شد — در حال اتصال…', 'Answered - connecting…');
    /* A separate, longer clock: if the media never turns up, this still ends
       rather than hanging on a call that was answered and never connected. */
    chatState.outgoingRingTimer = setTimeout(() => {
      chatState.outgoingRingTimer = null;
      if (chatState.currentCallAnsweredAt || !chatState.currentCall) return;
      notify(t('تماس برقرار نشد.', 'The call could not be connected.'), 'warning');
      endCurrentCall();
    }, CALL_CONNECT_TIMEOUT_MS);
    return true;
  }
  if (message.type === 'gcall-join') {
    /* Not yet in the call this is about - hold it rather than drop it. The
       microphone may still be opening; see holdGroupCallSignal. */
    if (!groupCallActive() || chatState.groupCall.callId !== message.callId) {
      holdGroupCallSignal(message);
      return true;
    }
    const peerRecord = findPeerByAnyKey(message.fromFingerprint);
    if (!peerRecord) return true;
    /* Answer the join. Without this the newcomer only ever hears from peers
       whose fingerprint happens to sort below theirs, because nobody tells
       them who is already in the room — the last person to join ended up
       alone in a call everyone else could see. */
    relaySessionEvent(peerRecord, {
      type: 'gcall-here',
      callId: message.callId,
      spaceId: chatState.groupCall.spaceId,
      mode: chatState.groupCall.mode,
      roster: chatState.groupCall.roster || [],
      fromName: chatState.profile.name || t('یک عضو', 'A member'),
      fromFingerprint: myCallIdentity(),
      createdAt: new Date().toISOString(),
    });
    connectGroupCallPeer(peerRecord, message.fromName);
    return true;
  }
  if (message.type === 'gcall-here') {
    if (!groupCallActive() || chatState.groupCall.callId !== message.callId) {
      holdGroupCallSignal(message);
      return true;
    }
    const peerRecord = findPeerByAnyKey(message.fromFingerprint);
    if (peerRecord) connectGroupCallPeer(peerRecord, message.fromName);
    return true;
  }
  if (message.type === 'gcall-leave') {
    if (!groupCallActive() || chatState.groupCall.callId !== message.callId) return true;
    dropGroupCallPeer(message.fromFingerprint);
    /* Last one out turns the lights off. */
    if (!chatState.groupCall.participants.size) leaveGroupCall({ silent: true });
    return true;
  }
  if (message.type === 'gcall-state') {
    if (!groupCallActive() || chatState.groupCall.callId !== message.callId) return true;
    const entry = chatState.groupCall.participants.get(message.fromFingerprint);
    if (!entry) return true;
    entry.muted = Boolean(message.muted);
    entry.videoOff = Boolean(message.videoOff);
    const startedPresenting = Boolean(message.presenting) && !entry.presenting;
    entry.presenting = Boolean(message.presenting);
    entry.handRaised = Boolean(message.hand);
    /* Whoever starts presenting is what everyone came to look at. */
    if (startedPresenting) chatState.groupCall.pinnedKey = entry.key;
    else if (!entry.presenting && chatState.groupCall.pinnedKey === entry.key) chatState.groupCall.pinnedKey = '';
    renderGroupCallStage();
    return true;
  }
  if (message.type === 'gcall-react') {
    if (!groupCallActive() || chatState.groupCall.callId !== message.callId) return true;
    floatCallReaction(document.getElementById('chatGroupCall'), message.emoji, message.fromName || '');
    return true;
  }
  return false;
}

/* A media call carrying a groupCall id belongs to a call we already joined, so
   it is answered without asking — the user said yes when they joined. */
function handleIncomingGroupCallLeg(call) {
  const callId = call?.metadata?.groupCall;
  if (!callId) return false;
  if (!groupCallActive() || chatState.groupCall.callId !== callId) {
    /* An invite we have not accepted yet; let the invite card drive. */
    return true;
  }
  const peerRecord = findPeerRecordByPeerId(call.peer);
  const key = peerRecord ? groupCallParticipantKey(peerRecord) : call.peer;
  if (!chatState.groupCall.participants.has(key)) {
    chatState.groupCall.participants.set(key, {
      key,
      peerId: call.peer,
      name: call.metadata?.username || peerRecord?.username || call.peer,
      call: null,
      stream: null,
      muted: false,
      videoOff: false,
    });
  }
  call.answer(chatState.groupCall.localStream, { sdpTransform: preferCallCodecs });
  attachGroupCallLeg(key, call);
  return true;
}
const STICKER_ACTIVE_PACK_KEY = 'poorija_sticker_active_pack';
const STICKER_DB_NAME = 'poorija-stickers';
const STICKER_DB_VERSION = 1;
const STICKER_PACK_STORE = 'packs';
const STICKER_SOUND_STORE = 'sounds';
/* Packs live in IndexedDB, not in the vault budget, and a pack is a handful of
   recompressed images — so the ceiling is about keeping the picker usable
   rather than about storage. Raised from 50 on request. */
const STICKER_MAX_PACKS = 100;
const STICKER_MAX_PER_PACK = 240;
const STICKER_MAX_BYTES = 6 * 1024 * 1024;
const STICKER_TARGET_EDGE = 512;
const STICKER_RECOMPRESS_OVER = 220 * 1024;
/* The picker draws thumbnails, not the stickers: a pack holds up to 240, each
   512 px, and decoding every one at once is a quarter of a gigabyte — on a
   phone, a frozen app. 256 px keeps a cell sharp on a 3x screen (about 70
   points, 210 pixels) and is still a quarter of the pixels; 160 px, the size
   before, was soft on an iPhone. */
const STICKER_THUMB_EDGE = 256;
/* The first cells of a pack are drawn with the grid, not when the observer
   gets round to them: about the first three screenfuls on a phone. */
const STICKER_EAGER_CELLS = 30;
const STICKER_IMAGE_EXT = /\.(webp|png|gif|jpe?g|avif|svg)$/i;
const STICKER_VIDEO_EXT = /\.(webm|mp4)$/i;
const STICKER_LOTTIE_EXT = /\.(tgs|json)$/i;
const STICKER_ARCHIVE_EXT = /\.(zip|wastickers)$/i;
const LOTTIE_SCRIPT_URL = 'vendor/lottie/lottie_light.min.js';
/* lottie-web's canvas player that draws in a worker (MIT, the same project
   as the SVG player above, 5.13.0): see ensureLottieWorker. */
const LOTTIE_WORKER_SCRIPT_URL = 'vendor/lottie/lottie_canvas_worker.min.js';
const LOTTIE_CANVAS_SCRIPT_URL = 'vendor/lottie/lottie_light_canvas.min.js';
/* The saved-GIF library (55-gifs-and-keyboard-stickers.js) is one record in
   the packs store under this id, so a vault backup carries it with the packs
   and the database keeps its version: js/backup.js restores into version 1,
   and a new object store would have made every restore fail with a version
   error. loadStickerPacks() lifts it out before anything counts packs. */
const GIF_LIBRARY_ID = '__gif_library__';

/* A GIF travels as a sticker whose kind is 'gif'. A client that predates GIFs
   draws a sticker's picture with an <img>, which animates a GIF by itself, so
   it still sees the GIF move rather than a file card with a download button.
   It also puts GIFs under the group's "stickers" permission, the same pairing
   other messengers use ("stickers and GIFs"). */
function isGifEntry(entry) {
  return Boolean(entry) && entry.type === 'sticker' && entry.stickerKind === 'gif';
}

let stickerDbPromise = null;

function openStickerDb() {
  if (stickerDbPromise) return stickerDbPromise;
  stickerDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = window.indexedDB.open(STICKER_DB_NAME, STICKER_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STICKER_PACK_STORE)) db.createObjectStore(STICKER_PACK_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STICKER_SOUND_STORE)) db.createObjectStore(STICKER_SOUND_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  }).catch((error) => {
    /* A rejected promise must not be cached, or one transient failure
       (private mode, quota prompt declined) disables stickers forever. */
    stickerDbPromise = null;
    throw error;
  });
  return stickerDbPromise;
}

function stickerDbRequest(storeName, mode, run) {
  return openStickerDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    tx.onabort = () => reject(tx.error || new Error('sticker transaction aborted'));
    if (!request) {
      tx.oncomplete = () => resolve(undefined);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('sticker request failed'));
  }));
}

const stickerDbGetAllPacks = () => stickerDbRequest(STICKER_PACK_STORE, 'readonly', (store) => store.getAll());
const stickerDbPutPackRecord = (pack) => stickerDbRequest(STICKER_PACK_STORE, 'readwrite', (store) => store.put(pack));
/* Writing a pack without handing Safari back its own pictures.
   On an iPhone a picture read from IndexedDB is a handle onto a file Safari
   keeps for that record. Putting the record again with those same handles in
   it leaves the new record pointing at the old files — which Safari then
   throws away — so every sticker of a pack written that way became a broken
   image, at once or on the next start. That is what broke the GIF shelf after
   a send (the library was rewritten to note the send), and every older pack
   once thumbnails were made for it and stored. Reading the record back after
   the write (the previous attempt at this) made it worse: what came back could
   be another sticker's picture.
   So every picture is copied into memory before the write: Safari then stores
   fresh files of its own, the page keeps drawing from the copies, and nothing
   is read back. A picture that can no longer be read at all — lost before
   this was fixed — is dropped from the pack rather than written again, and the
   person is told which pack to import again (warnLostStickers). */
const stickerMemoryBlobs = new WeakSet();
function stickerBlobInMemory(blob) {
  if (blob instanceof Blob) stickerMemoryBlobs.add(blob);
  return blob;
}
async function stickerBlobCopy(blob) {
  if (stickerMemoryBlobs.has(blob)) return blob;
  const copy = new Blob([await blob.arrayBuffer()], { type: blob.type });
  stickerMemoryBlobs.add(copy);
  return copy;
}
async function stickerDbPutPack(pack) {
  let changed = 0;
  let lost = 0;
  const kept = [];
  for (const record of pack.stickers || []) {
    let gone = false;
    for (const field of ['blob', 'thumb']) {
      const value = record[field];
      if (!(value instanceof Blob)) continue;
      try {
        const copy = await stickerBlobCopy(value);
        if (copy !== value) { record[field] = copy; changed += 1; }
      } catch (_error) {
        if (field === 'blob') gone = true;
        else delete record.thumb;
      }
    }
    if (gone) { lost += 1; forgetStickerRecordUrls(record); continue; }
    kept.push(record);
  }
  if (lost) {
    pack.stickers = kept;
    warnLostStickers(pack, lost);
  }
  const result = await stickerDbPutPackRecord(pack);
  /* The URLs made from the old handles may stop answering once the write has
     gone through; the copies get URLs of their own on the next draw. */
  if (changed || lost) {
    releaseStickerUrls(pack);
    renderStickerPanel();
    if (typeof renderPackManagerList === 'function' && packManagerElement) renderPackManagerList();
  }
  return result;
}

/* Said once per pack per run: stickers whose pictures this device can no
   longer read are not coming back, and importing the pack again is the cure. */
const lostStickerWarned = new Set();
function warnLostStickers(pack, count) {
  if (!pack?.id || lostStickerWarned.has(pack.id)) return;
  lostStickerWarned.add(pack.id);
  const title = pack.title || (pack.id === GIF_LIBRARY_ID ? t('گیف‌ها', 'GIFs') : t('پک', 'pack'));
  notify(t(
    `${count} مورد از «${title}» روی این دستگاه دیگر خوانده نمی‌شود؛ آن را دوباره وارد کنید.`,
    `${count} item(s) of "${title}" can no longer be read on this device; import it again.`,
  ), 'warning');
}
/* Whether a pack's pictures can still be read, tried on a few of them when it
   is shown: a pack damaged before the fix above draws as broken images, and
   saying so beats leaving the person to wonder. */
const packReadChecked = new Set();
async function checkPackReadable(pack) {
  if (!pack?.stickers?.length || packReadChecked.has(pack.id)) return;
  packReadChecked.add(pack.id);
  let lost = 0;
  for (const record of pack.stickers.slice(0, 4)) {
    if (!(record.blob instanceof Blob) || stickerMemoryBlobs.has(record.blob)) continue;
    try { await record.blob.slice(0, 16).arrayBuffer(); } catch (_error) { lost += 1; }
  }
  if (lost) {
    let total = 0;
    for (const record of pack.stickers) {
      try { await record.blob.slice(0, 16).arrayBuffer(); } catch (_error) { total += 1; }
    }
    warnLostStickers(pack, total || lost);
  }
}

/* A picture in the sticker panel that will not load — a handle the system
   dropped under it — is answered by reading every pack back from storage and
   drawing the panel again. At most once in ten seconds, so a picture that
   really is gone cannot loop. */
let stickerPanelReloadAt = 0;
document.addEventListener('error', (event) => {
  const node = event.target;
  if (!(node instanceof HTMLImageElement || node instanceof HTMLVideoElement)) return;
  if (!node.closest?.('#chatStickerPanel, .packman')) return;
  if (!String(node.currentSrc || node.getAttribute('src') || '').startsWith('blob:')) return;
  if (Date.now() - stickerPanelReloadAt < 10000) return;
  stickerPanelReloadAt = Date.now();
  chatState.stickerUrls.forEach((url) => URL.revokeObjectURL(url));
  chatState.stickerUrls.clear();
  loadStickerPacks().catch((error) => console.warn('[Stickers] reloading the packs failed', error));
}, true);
const stickerDbDeletePack = (id) => stickerDbRequest(STICKER_PACK_STORE, 'readwrite', (store) => store.delete(id));
const stickerDbGetAllSounds = () => stickerDbRequest(STICKER_SOUND_STORE, 'readonly', (store) => store.getAll());
const stickerDbPutSound = (sound) => stickerDbRequest(STICKER_SOUND_STORE, 'readwrite', (store) => store.put(sound));
const stickerDbDeleteSound = (id) => stickerDbRequest(STICKER_SOUND_STORE, 'readwrite', (store) => store.delete(id));

/* One place decides what an incoming binary becomes, so the chunked path and
   the legacy single-shot path can never disagree about a sticker again. */
function incomingBlobType(kind) {
  if (kind === 'voice') return 'voice';
  if (kind === 'sticker') return 'sticker';
  if (kind === 'stickerpack') return 'stickerpack';
  return 'file';
}
/* Every list that summarises a message in one line goes through here, so a
   sticker never shows up as "01.webp". */
function richEntryLabel(entry = {}) {
  const rich = richPayloadOf(entry);
  if (!rich) return '';
  if (rich.kind === 'poll') return `📊 ${t('نظرسنجی', 'Poll')}: ${rich.question || ''}`.trim();
  if (rich.kind === 'location') return `📍 ${t('موقعیت مکانی', 'Location')}`;
  if (rich.kind === 'live-location') return `📍 ${t('موقعیت زنده', 'Live location')}`;
  if (rich.kind === 'contact') return `👤 ${t('کارت مخاطب', 'Contact card')}: ${rich.name || ''}`.trim();
  return '';
}
function mediaEntryLabel(entry = {}) {
  if (entry.type === 'rich') return richEntryLabel(entry);
  if (entry.type === 'stickerpack') return `🗂 ${t('پک استیکر', 'Sticker pack')}${entry.packTitle ? `: ${entry.packTitle}` : ''}`;
  if (isGifEntry(entry)) return `🎞 ${t('گیف', 'GIF')}`;
  if (entry.type === 'sticker') return `${entry.stickerEmoji || '🩹'} ${t('استیکر', 'Sticker')}`.trim();
  if (entry.type === 'voice') return t('پیام صوتی', 'Voice message');
  if (entry.type === 'file') return entry.name || t('فایل', 'File');
  if (entry.type === 'call-log') return callHistoryText(entry);
  return '';
}
function transferBannerLabel(kind, fileName) {
  if (kind === 'voice') return t('در حال ارسال پیام صوتی…', 'Sending voice message…');
  if (kind === 'sticker' && /\.gif$/i.test(fileName || '')) return t('در حال ارسال گیف…', 'Sending GIF…');
  if (kind === 'sticker') return t('در حال ارسال استیکر…', 'Sending sticker…');
  if (kind === 'stickerpack') return t('در حال ارسال پک استیکر…', 'Sending sticker pack…');
  return t(`در حال ارسال ${fileName}…`, `Sending ${fileName}…`);
}
function stickerKindForName(name, mime) {
  if (STICKER_LOTTIE_EXT.test(name) || /json/i.test(mime || '')) return 'lottie';
  if (STICKER_VIDEO_EXT.test(name) || /^video\//i.test(mime || '')) return 'video';
  return 'image';
}

/* Object URLs are minted once per sticker and reused: renderMessages and the
   picker both redraw often, and a fresh URL on every pass leaks one blob
   handle per redraw until the tab closes. */
function stickerObjectUrl(record) {
  if (!record?.blob) return '';
  const cached = chatState.stickerUrls.get(record.id);
  if (cached) return cached;
  const url = URL.createObjectURL(record.blob);
  chatState.stickerUrls.set(record.id, url);
  return url;
}

/* The picture the picker draws: the sticker's thumbnail when it has one, the
   sticker itself when it moves (a thumbnail is a single frame) or has none
   yet. Only a real Blob counts — a restored backup drops thumbnails, and they
   are made again (ensurePackThumbs). */
const stickerThumbKey = (record) => `${record.id}#thumb`;
function stickerThumbUrl(record) {
  if (!(record?.thumb instanceof Blob)) return stickerObjectUrl(record);
  const key = stickerThumbKey(record);
  const cached = chatState.stickerUrls.get(key);
  if (cached) return cached;
  const url = URL.createObjectURL(record.thumb);
  chatState.stickerUrls.set(key, url);
  return url;
}
/* Let go a little later, not at once: the picture or video drawn from it may
   still be on the page until the redraw that follows replaces it. Revoked
   under them, WebKit failed every one ("cannot load blob"), a playing video
   sticker could no longer loop, and each failure in the panel set off a
   reload of every pack from storage. */
function revokeStickerUrlLater(url) {
  window.setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function forgetStickerRecordUrls(record) {
  for (const key of [record.id, stickerThumbKey(record)]) {
    const url = chatState.stickerUrls.get(key);
    if (!url) continue;
    revokeStickerUrlLater(url);
    chatState.stickerUrls.delete(key);
  }
}
function releaseStickerUrls(pack) {
  (pack?.stickers || []).forEach(forgetStickerRecordUrls);
}

/* A small still of a sticker, or null for one that moves or cannot be read:
   an animated sticker keeps drawing itself, only when it is on screen
   (observeLazyMedia). */
async function makeStickerThumb(blob) {
  if (!(blob instanceof Blob) || typeof createImageBitmap !== 'function') return null;
  try {
    if (typeof pictureIsAnimated === 'function' && typeof sniffPictureType === 'function'
      && await pictureIsAnimated(blob, await sniffPictureType(blob))) return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, STICKER_THUMB_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && blob.size < 24 * 1024) { bitmap.close?.(); return null; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const thumb = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    /* Safari cannot write WebP and hands back a PNG, which can be more bytes
       than the WebP it came from. Kept anyway when it is at most half as
       wide: what a thumbnail saves is pixels to decode, not bytes. */
    return thumb && (thumb.size < blob.size || scale <= 0.5) ? stickerBlobInMemory(thumb) : null;
  } catch (_error) {
    return null;
  }
}

/* A pack brought up to date in the background: a still for every sticker
   (a video's first frame, a Lottie frame, an animated picture's first frame,
   a static one's thumbnail), and every animated picture told to loop forever
   (upkeepStickerRecord, 56-sticker-motion.js). One sticker at a time with a
   breath between, top of the pack first, each still put into its cell as it
   is made; the pack is stored once, at the end. thumbChecked keeps a sticker
   that has no still to give from being asked again. */
const packThumbJobs = new Set();
function stickerRecordPending(record) {
  if (typeof stickerNeedsUpkeep === 'function') return stickerNeedsUpkeep(record);
  return record.kind === 'image' && !(record.thumb instanceof Blob) && !record.thumbChecked;
}
/* Kept by the pack object, not its id: loading the packs again from storage
   makes new objects, and a job still working on the old one must not stop
   the new one from being brought up to date (it would finish, find its pack
   no longer in the list, and store nothing). */
async function ensurePackThumbs(pack) {
  if (!pack?.stickers?.length || packThumbJobs.has(pack)) return;
  const pending = pack.stickers.filter(stickerRecordPending);
  if (!pending.length) return;
  packThumbJobs.add(pack);
  try {
    /* Three at a time: a video's still waits on the decoder far more than it
       works the page, so three overlap where one left the phone idle. A
       machine with more cores runs more. */
    const workers = Math.max(3, Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        const record = pending[next];
        next += 1;
        if (typeof upkeepStickerRecord === 'function') {
          await upkeepStickerRecord(record);
          if (typeof paintStillIntoCell === 'function') paintStillIntoCell(record);
        } else {
          const thumb = await makeStickerThumb(record.blob);
          if (thumb) record.thumb = thumb; else record.thumbChecked = true;
        }
        await yieldToPage();
      }
    };
    await Promise.all(Array.from({ length: workers }, worker));
    if (chatState.stickerPacks.includes(pack) || pack === chatState.gifLibrary) {
      await stickerDbPutPack(pack);
      if (!document.getElementById('chatStickerPanel')?.classList.contains('hidden')) renderStickerPanel();
    }
  } finally {
    packThumbJobs.delete(pack);
  }
}

/* The picture a pack is known by: the sticker chosen for it, or its first.
   Its still is made at once, in memory, when it has none yet — a tab with
   nothing on it is the "?" a Telegram pack showed — and stored with the pack
   the next time the pack is. */
function packCoverRecord(pack) {
  const list = pack?.stickers || [];
  return list.find((record) => record.id === pack.coverId) || list[0] || null;
}
function packCoverUrl(pack) {
  const record = packCoverRecord(pack);
  if (!record) return '';
  if (record.thumb instanceof Blob) return stickerThumbUrl(record);
  return record.kind === 'image' ? stickerObjectUrl(record) : '';
}
/* The cover as it is drawn: a sticker that moves moves here too, over its
   still, the way the picker's cells do; one that does not is its picture. */
function packCoverHtml(pack, className = '') {
  const record = packCoverRecord(pack);
  const stillUrl = packCoverUrl(pack);
  const animated = record && typeof stickerIsAnimated === 'function' && stickerIsAnimated(record);
  if (!record || (!animated && !stillUrl)) return `<span class="${className}"><i class="fas fa-layer-group" aria-hidden="true"></i></span>`;
  if (!animated) return `<img class="${className}" src="${app().escapeHTML(stillUrl)}" alt="" draggable="false">`;
  return `<span class="sticker-cover ${className}">${stillUrl ? `<img class="sticker-cover-still" src="${app().escapeHTML(stillUrl)}" alt="" draggable="false">` : ''}${stickerMediaHtml(stickerObjectUrl(record), record.kind, 'sticker-cover-motion is-motion', { lazy: true })}</span>`;
}
/* After covers are written into a container: their moving stickers start
   when they are in view of the scroller given. */
function startPackCovers(container, scroller = container) {
  if (!container) return;
  observeLazyMedia(scroller);
  hydrateLottieNodes(container);
}
const packCoverJobs = new Set();
function ensurePackCovers(packs) {
  if (typeof upkeepStickerRecord !== 'function') return;
  packs.forEach((pack) => {
    const record = packCoverRecord(pack);
    if (!record || record.thumb instanceof Blob || record.thumbChecked || packCoverJobs.has(record.id)) return;
    packCoverJobs.add(record.id);
    upkeepStickerRecord(record).then(() => {
      packCoverJobs.delete(record.id);
      if (!(record.thumb instanceof Blob)) return;
      const tabs = document.getElementById('chatStickerTabs');
      const tab = tabs?.querySelector(`[data-chat-sticker-pack="${CSS.escape(pack.id)}"]`);
      if (tab) {
        tab.innerHTML = packCoverHtml(pack);
        tabs.__html = '';
        startPackCovers(tabs);
      }
      if (packManagerElement) renderPackManagerList();
    }).catch(() => packCoverJobs.delete(record.id));
  });
}
async function setPackCover(packId, recordId) {
  const pack = chatState.stickerPacks.find((item) => item.id === packId);
  if (!pack || !pack.stickers.some((record) => record.id === recordId)) return false;
  pack.coverId = recordId;
  await stickerDbPutPack(pack);
  renderStickerPanel();
  if (packManagerElement) renderPackManagerList();
  return true;
}

/* A breath for the page between two pieces of heavy work, so a tap or a frame
   gets in: decoding a pack of 512 px WebPs in one go is what froze a phone. */
function yieldToPage() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* Pictures drawn only while they are on screen, and let go when they are far
   off it: a grid of hundreds of stickers, or of GIFs that all move at once,
   decoded the lot. Each <img>/<video> written with data-lazy-src gets its
   source as it nears the visible part of its scroller. */
/* Two distances. Stills and static thumbnails are small, so they are given
   their picture well before they scroll into view — a fast flick through a
   big pack should meet pictures, not empty cells. A moving sticker costs a
   decoder for as long as it runs, so it starts only close to the view, over
   its still, and fades in once it has a frame (is-ready), so a cell never
   goes blank on its way from one to the other. */
const lazyMediaObservers = new WeakMap();
/* What holds a still and a moving sticker over it: a picker cell, a GIF cell,
   a pack's cover. */
const MOTION_HOLDERS = '.chat-sticker-cell, .chat-gif-cell, .sticker-cover';
/* Moving stickers are started a few per frame rather than all at once: a
   screenful of video and Lottie stickers starting together is a screenful of
   decoders spinning up in the same frame, which is the stutter as a big pack
   opens. Their stills are already there, so nothing waits on this. */
const motionQueue = [];
let motionPump = 0;
function queueMotion(node, run) {
  if (!motionQueue.some((item) => item.node === node)) motionQueue.push({ node, run });
  if (!motionPump) motionPump = requestAnimationFrame(pumpMotion);
}
/* Started against a few milliseconds of each frame, not a count: one heavy
   Lottie sticker takes longer to build than three light ones, and three of
   the heavy kind in one frame were the stall as a pack opened on a desktop. */
/* A video costs the engine more than it costs the script — the player behind
   it is built after the script has moved on — so at most two start in a frame,
   however cheap they looked. */
/* While a grid is being scrolled the heavy starts wait — building a Lottie
   sticker's player, starting a video — and the stills carry the cells: a
   sticker that scrolls past in a fraction of a second is not worth a frame,
   and building them as they flew by held a scroll through a big pack to half
   its frame rate. They start the moment the scrolling stops. */
const MOTION_START_BUDGET_MS = 5;
const MOTION_VIDEOS_PER_FRAME = 2;
let motionScrollingUntil = 0;
document.addEventListener('scroll', () => { motionScrollingUntil = performance.now() + 140; }, { capture: true, passive: true });
function pumpMotion() {
  motionPump = 0;
  const began = performance.now();
  const scrolling = began < motionScrollingUntil;
  let started = 0;
  let videos = 0;
  const deferred = [];
  while (motionQueue.length && (started === 0 || performance.now() - began < MOTION_START_BUDGET_MS)) {
    const item = motionQueue.shift();
    const { node, run } = item;
    if (!node.isConnected || node.__wanted === false) continue;
    const heavy = node instanceof HTMLVideoElement || run === mountLottieNode;
    if (heavy && scrolling) { deferred.push(item); continue; }
    if (node instanceof HTMLVideoElement) {
      if (videos >= MOTION_VIDEOS_PER_FRAME) { deferred.push(item); continue; }
      videos += 1;
    }
    run(node);
    started += 1;
  }
  if (deferred.length) motionQueue.unshift(...deferred);
  if (!motionQueue.length) return;
  if (scrolling && deferred.length === motionQueue.length) {
    window.setTimeout(() => { if (!motionPump) motionPump = requestAnimationFrame(pumpMotion); }, Math.max(16, motionScrollingUntil - performance.now() + 4));
  } else {
    motionPump = requestAnimationFrame(pumpMotion);
  }
}
function markMediaReady(node) {
  node.classList.add('is-ready');
  if (node.classList.contains('is-motion')) node.closest(MOTION_HOLDERS)?.classList.add('motion-ready');
}
function giveLazyMedia(node) {
  const wanted = node.getAttribute('data-lazy-src');
  if (node instanceof HTMLVideoElement) {
    node.__onScreen = true;
    if (typeof keepVideoLooping === 'function') keepVideoLooping(node);
  }
  if (node.getAttribute('src') !== wanted) {
    node.classList.remove('is-ready');
    const ready = () => markMediaReady(node);
    node.addEventListener(node instanceof HTMLVideoElement ? 'loadeddata' : 'load', ready, { once: true });
    node.setAttribute('src', wanted);
    if (node instanceof HTMLImageElement && node.complete && node.naturalWidth) ready();
  }
  if (node instanceof HTMLVideoElement) node.play?.().catch(() => {});
}
function releaseLazyMedia(node) {
  if (!node.hasAttribute('src')) return;
  if (node instanceof HTMLVideoElement) {
    node.__onScreen = false;
    node.pause?.();
  }
  node.removeAttribute('src');
  node.classList.remove('is-ready');
  if (node.classList.contains('is-motion')) node.closest(MOTION_HOLDERS)?.classList.remove('motion-ready');
  if (node instanceof HTMLVideoElement) node.load?.();
}
function observeLazyMedia(container) {
  if (!container) return;
  const nodes = container.querySelectorAll('[data-lazy-src]');
  if (!nodes.length) return;
  if (typeof IntersectionObserver !== 'function') {
    nodes.forEach(giveLazyMedia);
    return;
  }
  let observers = lazyMediaObservers.get(container);
  if (!observers) {
    const watch = (entries) => {
      for (const entry of entries) {
        const node = entry.target;
        node.__wanted = entry.isIntersecting;
        if (!entry.isIntersecting) releaseLazyMedia(node);
        else if (node.classList.contains('is-motion')) queueMotion(node, giveLazyMedia);
        else giveLazyMedia(node);
      }
    };
    /* A desktop has the memory and the decoders to reach further ahead. */
    const roomy = window.matchMedia?.('(min-width: 900px) and (pointer: fine)').matches;
    observers = {
      near: new IntersectionObserver(watch, { root: container, rootMargin: roomy ? '720px 0px' : '360px 0px' }),
      close: new IntersectionObserver(watch, { root: container, rootMargin: '120px 0px' }),
    };
    lazyMediaObservers.set(container, observers);
  }
  observers.near.disconnect();
  observers.close.disconnect();
  nodes.forEach((node) => (node.classList.contains('is-motion') ? observers.close : observers.near).observe(node));
}

/* Re-decides which pack is open, from storage.

   loadStickerPacks() runs during chat-module init, which happens before the
   vault profile is adopted — so its read of the remembered pack resolves to a
   name with no profile in it and comes back empty. It then settles on packs[0]
   and is never run again, which is why the pack a user had open never came
   back after a reload even once the stored value was being kept correctly.

   The chat lock already had this shape of problem; there is a note about it on
   the unlock listener. This is the same fix for the same reason: ask again
   once there is a profile to ask on behalf of. */
function resolveActiveStickerPack() {
  let remembered = '';
  try { remembered = localStorage.getItem(STICKER_ACTIVE_PACK_KEY) || ''; } catch (_error) { return; }
  if (!remembered || remembered === chatState.stickerActivePackId) return;
  if (!chatState.stickerPacks.some((pack) => pack.id === remembered)) return;
  chatState.stickerActivePackId = remembered;
  renderStickerPanel();
}

/* The only writer. Called where a person chooses a pack — tapping a tab, or
   importing one, which makes it active on purpose. */
function rememberActiveStickerPack(packId) {
  if (!packId) return;
  try { localStorage.setItem(STICKER_ACTIVE_PACK_KEY, packId); } catch (_error) { /* private mode */ }
}

async function loadStickerPacks() {
  try {
    const packs = await stickerDbGetAllPacks();
    /* The GIF library shares the store but is not a pack: it never shows as
       a tab, never counts toward the pack limit, and the manager never lists
       it. Lifted out here, before anything else sees the list. */
    chatState.gifLibrary = (packs || []).find((pack) => pack.id === GIF_LIBRARY_ID) || null;
    /* An explicit order when one has been set, and arrival order for packs
       imported before there was such a thing -- so an install that predates
       the manager opens looking exactly as it did. */
    chatState.stickerPacks = (packs || []).filter((pack) => pack.id !== GIF_LIBRARY_ID).sort(stickerPackOrder);
  } catch (error) {
    console.warn('[Stickers] load failed', error);
    chatState.stickerPacks = [];
    chatState.gifLibrary = null;
  }
  let remembered = '';
  try { remembered = localStorage.getItem(STICKER_ACTIVE_PACK_KEY) || ''; } catch (_error) { remembered = ''; }
  /* The stored choice wins at load time, not whatever happens to be in memory.

     It used to be the other way round, and that is what lost the open pack
     across a reload: the panel renders once before the packs finish loading,
     falls back to packs[0], and writes that into chatState. This line then saw
     a non-empty stickerActivePackId, preferred it, and the next render
     persisted packs[0] over the pack the user actually had open.

     In-session choices are safe under this order because clicking a tab
     persists immediately, so `remembered` is never staler than memory. */
  const wanted = remembered || chatState.stickerActivePackId;
  chatState.stickerActivePackId = chatState.stickerPacks.some((pack) => pack.id === wanted)
    ? wanted
    : (chatState.stickerPacks[0]?.id || '');
  renderStickerPanel();
  upkeepPacksWhenIdle();
}

/* Every pack brought up to date in the background, once, a little after the
   app has opened and one pack at a time — so a pack is ready with its stills
   the first time it is opened, rather than making them while you look. The
   open pack is done first when the panel shows it (renderStickerPanel). */
let packUpkeepScheduled = false;
function upkeepPacksWhenIdle() {
  if (packUpkeepScheduled || typeof stickerNeedsUpkeep !== 'function') return;
  packUpkeepScheduled = true;
  const idle = (run) => (typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback(run, { timeout: 8000 })
    : window.setTimeout(run, 1500));
  window.setTimeout(() => idle(async () => {
    try {
      for (const pack of [...chatState.stickerPacks, chatState.gifLibrary].filter(Boolean)) {
        if (!pack.stickers?.some(stickerNeedsUpkeep)) continue;
        if (!chatState.stickerPacks.includes(pack) && pack !== chatState.gifLibrary) continue;
        await ensurePackThumbs(pack);
      }
    } finally {
      packUpkeepScheduled = false;
    }
  }), 5000);
}

/* .tgs is a gzipped Lottie JSON. DecompressionStream does the gunzip natively
   in every browser that ships the rest of what this app needs; when it is
   missing we say so instead of storing a corrupt sticker. */
async function readTgsAnimation(blob) {
  const asText = async (source) => new Response(source).text();
  if (typeof window.DecompressionStream === 'function') {
    try {
      const stream = blob.stream().pipeThrough(new window.DecompressionStream('gzip'));
      const text = await asText(stream);
      if (isLottieJson(text)) return text;
    } catch (_error) { /* fall through: some exporters ship plain JSON in a .tgs */ }
  }
  try {
    const text = await asText(blob);
    if (isLottieJson(text)) return text;
  } catch (_error) { /* not JSON at all */ }
  return null;
}
/* A Lottie animation always carries a layers array and a frame rate. Anything
   else that happens to be valid JSON is not a sticker. */
function isLottieJson(text) {
  try {
    const data = JSON.parse(text);
    return Boolean(data && Array.isArray(data.layers) && (data.fr || data.op));
  } catch (_error) {
    return false;
  }
}

function makeStickerId() {
  return `stk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/* Rejecting anything over a size cap is what made desktop imports look broken:
   a sticker saved from a desktop client is a full-resolution PNG, while the
   ones shared on phones are already tiny WebPs. Shrink to a 512px WebP —
   which is the size real sticker packs ship at — instead of refusing it. */
async function normalizeStickerImage(blob, name) {
  if (blob.size <= STICKER_RECOMPRESS_OVER) return blob;
  if (/\.svg$/i.test(name) || /svg/i.test(blob.type)) return blob;
  if (typeof createImageBitmap !== 'function') return blob;
  /* A canvas keeps the first frame and nothing else, so an animated WebP, PNG
     or GIF is kept exactly as it came. The note below promised that and the
     check was never made: an animated sticker kept from a chat came back
     still. Read from the bytes, not the name (55-gifs-and-keyboard-stickers.js). */
  if (typeof pictureIsAnimated === 'function' && typeof sniffPictureType === 'function'
    && await pictureIsAnimated(blob, await sniffPictureType(blob))) return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, STICKER_TARGET_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const shrunk = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
    /* An animated source loses its animation through a canvas, so only take
       the smaller copy when it is actually smaller and the source was static. */
    return shrunk && shrunk.size < blob.size ? stickerBlobInMemory(shrunk) : blob;
  } catch (_error) {
    return blob;
  }
}
async function buildStickerRecord(name, blob, emoji = '') {
  const cleanName = String(name || 'sticker').split('/').pop();
  const kind = stickerKindForName(cleanName, blob.type);
  let record;
  if (kind === 'lottie') {
    const json = await readTgsAnimation(blob);
    if (!json) return null;
    record = {
      id: makeStickerId(),
      name: cleanName,
      mime: 'application/json',
      kind: 'lottie',
      emoji,
      blob: stickerBlobInMemory(new Blob([json], { type: 'application/json' })),
    };
  } else {
    const usable = kind === 'image' ? await normalizeStickerImage(blob, cleanName) : blob;
    if (usable.size > STICKER_MAX_BYTES) return null;
    record = {
      id: makeStickerId(),
      name: cleanName,
      mime: usable.type || blob.type || (kind === 'video' ? 'video/webm' : 'image/webp'),
      kind,
      emoji,
      blob: usable,
    };
  }
  /* Its still, whether it moves, and — for an animated picture — its bytes
     told to loop forever (56-sticker-motion.js), before it is ever stored. */
  if (typeof upkeepStickerRecord === 'function') await upkeepStickerRecord(record);
  else {
    const thumb = kind === 'image' ? await makeStickerThumb(record.blob) : null;
    if (thumb) record.thumb = thumb; else record.thumbChecked = kind === 'image';
  }
  return record;
}

const STICKER_MANIFEST_NAME = /^(contents|pack|manifest|meta|info)\.json$/i;
function stickerEntryIsUsable(path) {
  const base = String(path || '').split('/').pop();
  if (!base || base.startsWith('.') || base.startsWith('__MACOSX')) return false;
  /* .json is both the pack manifest and the uncompressed Lottie extension, so
     the manifest has to be named out explicitly or it imports itself. */
  if (STICKER_MANIFEST_NAME.test(base)) return false;
  return STICKER_IMAGE_EXT.test(base) || STICKER_VIDEO_EXT.test(base) || STICKER_LOTTIE_EXT.test(base);
}

/* Handles both shapes we can actually receive:
   - WhatsApp .wastickers — a ZIP with contents.json naming each file and its
     emoji, plus a tray image we skip.
   - A plain .zip of stickers (what Telegram Desktop produces when you save a
     pack folder, and what most third-party exporters emit): no manifest, so
     every image in the archive becomes a sticker. */
/* How far an import has got, in the transfer banner, so a large pack reads as
   work in progress rather than a hung app. */
function noteStickerImportProgress(done, total) {
  if (typeof setTransferBanner !== 'function' || total < 12) return;
  const owner = 'sticker-import';
  if (done >= total) { clearTransferBanner(600, owner); return; }
  setTransferBanner(t(`وارد کردن استیکرها ${done} از ${total}`, `Importing stickers ${done} of ${total}`), (done / total) * 100, { owner, incoming: true });
}
async function readStickerArchive(file) {
  if (!window.JSZip) throw new Error('JSZip missing');
  const zip = await window.JSZip.loadAsync(file);
  let manifest = null;
  const manifestEntry = zip.file(/(^|\/)(contents|pack|manifest)\.json$/i)[0];
  if (manifestEntry) {
    try { manifest = JSON.parse(await manifestEntry.async('string')); } catch (_error) { manifest = null; }
  }
  const emojiByFile = new Map();
  const manifestStickers = Array.isArray(manifest?.stickers) ? manifest.stickers : [];
  manifestStickers.forEach((item) => {
    const fileName = String(item?.image_file || item?.image || item?.file || item?.name || '').split('/').pop().toLowerCase();
    if (!fileName) return;
    const emojis = item?.emojis || item?.emoji || [];
    emojiByFile.set(fileName, Array.isArray(emojis) ? emojis.join('') : String(emojis || ''));
  });
  const trayName = String(manifest?.tray_image || manifest?.tray || '').split('/').pop().toLowerCase();

  const paths = [];
  zip.forEach((path, entry) => { if (!entry.dir && stickerEntryIsUsable(path)) paths.push(path); });
  paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const stickers = [];
  const total = Math.min(paths.length, STICKER_MAX_PER_PACK);
  for (const path of paths) {
    if (stickers.length >= STICKER_MAX_PER_PACK) break;
    const base = path.split('/').pop().toLowerCase();
    if (trayName && base === trayName) continue;
    const raw = await zip.file(path).async('blob');
    const record = await buildStickerRecord(path, raw, emojiByFile.get(base) || '');
    if (record) stickers.push(record);
    noteStickerImportProgress(stickers.length, total);
    await yieldToPage();
  }
  const fallbackTitle = file.name.replace(STICKER_ARCHIVE_EXT, '');
  return {
    id: makeStickerId(),
    title: String(manifest?.name || manifest?.title || fallbackTitle || 'Stickers').slice(0, 60),
    author: String(manifest?.publisher || manifest?.author || '').slice(0, 60),
    source: /\.wastickers$/i.test(file.name) ? 'whatsapp' : 'archive',
    createdAt: new Date().toISOString(),
    stickers,
  };
}

async function importStickerFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const archives = files.filter((file) => STICKER_ARCHIVE_EXT.test(file.name));
  const loose = files.filter((file) => !STICKER_ARCHIVE_EXT.test(file.name) && stickerEntryIsUsable(file.name));
  const rejected = files.length - archives.length - loose.length;
  const created = [];
  let skipped = 0;

  for (const archive of archives) {
    try {
      const pack = await readStickerArchive(archive);
      if (pack.stickers.length) created.push(pack);
      else skipped += 1;
    } catch (error) {
      console.warn('[Stickers] archive import failed', archive.name, error);
      skipped += 1;
    }
  }

  if (loose.length) {
    const stickers = [];
    const chosen = loose.slice(0, STICKER_MAX_PER_PACK);
    for (const file of chosen) {
      try {
        const record = await buildStickerRecord(file.name, file, '');
        if (record) stickers.push(record);
        else skipped += 1;
      } catch (_error) { skipped += 1; }
      noteStickerImportProgress(stickers.length + skipped, chosen.length);
      await yieldToPage();
    }
    if (stickers.length) {
      /* Loose files land in one pack rather than one pack per file: dragging in
         twenty saved Telegram stickers should produce a usable set, not twenty
         one-sticker tabs. */
      const existing = chatState.stickerPacks.find((pack) => pack.source === 'custom' && pack.stickers.length + stickers.length <= STICKER_MAX_PER_PACK);
      if (existing) {
        existing.stickers = existing.stickers.concat(stickers);
        await stickerDbPutPack(existing);
        chatState.stickerActivePackId = existing.id;
        rememberActiveStickerPack(existing.id);
      } else {
        created.push({
          id: makeStickerId(),
          title: t('استیکرهای من', 'My stickers'),
          author: '',
          source: 'custom',
          createdAt: new Date().toISOString(),
          stickers,
        });
      }
    }
  }

  for (const pack of created) {
    if (chatState.stickerPacks.length >= STICKER_MAX_PACKS) {
      notify(t(`سقف ${STICKER_MAX_PACKS} پک استیکر پر است.`, `The ${STICKER_MAX_PACKS} sticker-pack limit is full.`), 'warning');
      break;
    }
    await stickerDbPutPack(pack);
    chatState.stickerPacks.push(pack);
    chatState.stickerActivePackId = pack.id;
  }

  renderStickerPanel();
  renderStorageCard().catch(() => {});
  const added = created.reduce((sum, pack) => sum + pack.stickers.length, 0);
  if (added || (loose.length && !created.length)) {
    notify(t(`${added || loose.length} استیکر اضافه شد.`, `${added || loose.length} stickers added.`), 'success');
  } else if (rejected) {
    /* Naming the extensions beats "nothing usable was found": on desktop the
       file dialog happily hands over a .DS_Store or a PDF. */
    const kinds = Array.from(new Set(files.map((file) => (file.name.split('.').pop() || '?').toLowerCase()))).slice(0, 4).join(', ');
    notify(t(
      `این فرمت‌ها پشتیبانی نمی‌شوند: ${kinds}. فرمت‌های مجاز: webp، png، gif، jpg، webm، tgs، zip، wastickers.`,
      `Unsupported formats: ${kinds}. Allowed: webp, png, gif, jpg, webm, tgs, zip, wastickers.`,
    ), 'warning');
  } else if (skipped) {
    notify(t('فایل‌ها خوانده شدند ولی هیچ استیکر سالمی داخلشان نبود.', 'The files were read but contained no usable stickers.'), 'warning');
  }
  if (skipped) {
    console.warn(`[Stickers] ${skipped} item(s) skipped (unreadable or unsupported)`);
  }
}

/* ---- a Telegram pack from its share link ---------------------------------
 *
 * Telegram gives a pack out only through its Bot API, so the relay fetches it
 * (scripts/lib/telegram-stickers.js): first the list of stickers, then each
 * file. The relay sees which pack is asked for and Telegram sees the relay,
 * never this device. Files come four at a time, in order, and each is built
 * the way an imported sticker is — a .webp gets its thumbnail, a .tgs becomes
 * a Lottie animation, a .webm a video sticker. */
function telegramPackName(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/(?:t(?:elegram)?\.me|telegram\.dog)\/addstickers\/([A-Za-z0-9_]{1,64})/i)
    || raw.match(/addstickers\?set=([A-Za-z0-9_]{1,64})/i)
    || raw.match(/^([A-Za-z0-9_]{1,64})$/);
  return match ? match[1] : '';
}

function telegramImportReason(reason) {
  return ({
    'not-configured': t('رلهٔ شما نمی‌تواند پک تلگرام بگیرد: مدیر سرور باید یک توکن ربات تلگرام (TELEGRAM_BOT_TOKEN) تنظیم کند.', 'Your relay cannot fetch Telegram packs: its operator has to set a Telegram bot token (TELEGRAM_BOT_TOKEN).'),
    'pack-not-found': t('پکی با این نام در تلگرام نیست.', 'Telegram has no pack by that name.'),
    'pack-empty': t('این پک تلگرام خالی است.', 'That Telegram pack is empty.'),
    'bad-name': t('این لینک پک استیکر تلگرام نیست.', 'That is not a Telegram sticker pack link.'),
    'token-refused': t('تلگرام توکن ربات رله را نپذیرفت.', 'Telegram refused the relay\'s bot token.'),
    busy: t('رله مشغول است؛ چند لحظه بعد دوباره امتحان کنید.', 'The relay is busy; try again in a moment.'),
    'rate-limited': t('درخواست‌ها زیاد بود؛ یک دقیقه بعد دوباره امتحان کنید.', 'Too many requests; try again in a minute.'),
  })[reason] || t('رله نتوانست به تلگرام برسد.', 'The relay could not reach Telegram.');
}

async function importTelegramStickerPack(text) {
  const name = telegramPackName(text);
  if (!name) {
    notify(telegramImportReason('bad-name'), 'warning');
    return null;
  }
  if (chatState.stickerPacks.length >= STICKER_MAX_PACKS) {
    notify(t(`سقف ${STICKER_MAX_PACKS} پک استیکر پر است.`, `The ${STICKER_MAX_PACKS} sticker-pack limit is full.`), 'warning');
    return null;
  }
  const already = chatState.stickerPacks.find((pack) => String(pack.telegramName || '').toLowerCase() === name.toLowerCase());
  if (already && !await PoorijaDialogs.confirm(t(`پک «${already.title}» را قبلاً وارد کرده‌اید. دوباره وارد شود؟`, `You already have "${already.title}". Import it again?`))) return null;
  const origin = chatServerOrigin();
  let described;
  try {
    const response = await fetch(new URL(`/telegram-stickers/set?name=${encodeURIComponent(name)}`, origin), { cache: 'no-store', mode: 'cors' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.ok || !Array.isArray(body.pack?.stickers)) {
      notify(telegramImportReason(body?.reason || (response.status === 429 ? 'rate-limited' : '')), 'warning');
      return null;
    }
    /* The pack described has to be the pack asked for. A cache in the way
       once answered every link with the first pack it had seen (sw.js), and
       the second pack imported as a copy of the first. */
    if (String(body.pack.name || '').toLowerCase() !== name.toLowerCase()) {
      notify(telegramImportReason(''), 'warning');
      return null;
    }
    described = body.pack;
  } catch (_error) {
    notify(t('به رله نرسیدیم؛ اتصال را بررسی کنید.', 'The relay could not be reached; check the connection.'), 'warning');
    return null;
  }
  const list = described.stickers.slice(0, STICKER_MAX_PER_PACK);
  const records = new Array(list.length).fill(null);
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next;
      next += 1;
      const item = list[index];
      try {
        const response = await fetch(new URL(`/telegram-stickers/file?id=${encodeURIComponent(item.file)}`, origin), { cache: 'no-store', mode: 'cors' });
        if (response.ok) {
          /* Straight off the network, never out of IndexedDB: safe to store
             as it is, without the copy stickerDbPutPack makes of anything
             else (118 copies of a pack is time a phone shows as a hang). */
          const blob = stickerBlobInMemory(await response.blob());
          const ext = /^(webp|webm|tgs)$/.test(item.ext) ? item.ext : 'webp';
          records[index] = await buildStickerRecord(`sticker_${String(index + 1).padStart(3, '0')}.${ext}`, blob, item.emoji || '');
        }
      } catch (_error) { /* one sticker that did not come is counted below */ }
      done += 1;
      noteStickerImportProgress(done, list.length);
      await yieldToPage();
    }
  };
  setTransferBanner(t(`دریافت پک «${described.title}» از تلگرام…`, `Fetching "${described.title}" from Telegram…`), null, { owner: 'sticker-import', incoming: true });
  await Promise.all([worker(), worker(), worker(), worker()]);
  noteStickerImportProgress(list.length, list.length);
  clearTransferBanner(600, 'sticker-import');
  const stickers = records.filter(Boolean);
  if (!stickers.length) {
    notify(t('هیچ استیکری از این پک دریافت نشد.', 'Not one sticker of that pack came through.'), 'warning');
    return null;
  }
  const pack = {
    id: makeStickerId(),
    title: String(described.title || name).slice(0, 60),
    author: 'Telegram',
    source: 'telegram',
    telegramName: String(described.name || name).slice(0, 64),
    createdAt: new Date().toISOString(),
    stickers,
  };
  await stickerDbPutPack(pack);
  chatState.stickerPacks.push(pack);
  chatState.stickerActivePackId = pack.id;
  rememberActiveStickerPack(pack.id);
  renderStickerPanel();
  renderStorageCard().catch(() => {});
  const missing = list.length - stickers.length;
  notify(missing
    ? t(`پک «${pack.title}» با ${stickers.length} استیکر اضافه شد؛ ${missing} استیکر نرسید.`, `Added "${pack.title}" with ${stickers.length} stickers; ${missing} did not come through.`)
    : t(`پک «${pack.title}» با ${stickers.length} استیکر اضافه شد.`, `Added "${pack.title}" with ${stickers.length} stickers.`), missing ? 'warning' : 'success');
  return pack;
}

/* ---- the pack manager --------------------------------------------------
 *
 * One panel, two shapes. A centred card on a desktop, where the backdrop is
 * the way out; the whole screen with a back arrow on a phone, where a cramped
 * box inside a screen that could have held the list is just worse. The CSS
 * decides which, so there is one set of behaviour to maintain rather than two.
 *
 * Built when it opens and thrown away when it closes: it holds thumbnails of
 * every pack, and keeping those alive behind a panel nobody is looking at
 * costs memory on the device this app is trying to stay small on.
 */
let packManagerElement = null;

function packManagerSelection() {
  if (!packManagerElement) return [];
  return Array.from(packManagerElement.querySelectorAll('input[type="checkbox"]:checked'))
    .map((box) => box.getAttribute('data-pack-id'))
    .filter(Boolean);
}

function syncPackManagerFooter() {
  if (!packManagerElement) return;
  const chosen = packManagerSelection().length;
  const remove = packManagerElement.querySelector('[data-pack-delete]');
  const share = packManagerElement.querySelector('[data-pack-share]');
  const label = packManagerElement.querySelector('[data-pack-selected]');
  if (remove) remove.disabled = chosen === 0;
  if (share) share.disabled = chosen === 0;
  if (label) {
    label.textContent = chosen
      ? t(`${chosen} پک انتخاب شده`, `${chosen} selected`)
      : t('برای کار گروهی چند پک را انتخاب کنید', 'Select packs to act on several at once');
  }
  packManagerElement.querySelectorAll('.packman-row').forEach((row) => {
    const box = row.querySelector('input[type="checkbox"]');
    row.classList.toggle('on', Boolean(box?.checked));
  });
}

function renderPackManagerList() {
  const list = packManagerElement?.querySelector('[data-pack-list]');
  if (!list) return;
  const packs = chatState.stickerPacks;
  if (!packs.length) {
    list.innerHTML = `<p class="packman-note">${app().escapeHTML(t('هنوز پکی وارد نکرده‌اید.', 'No packs imported yet.'))}</p>`;
    syncPackManagerFooter();
    return;
  }
  ensurePackCovers(packs);
  list.innerHTML = packs.map((pack, index) => {
    /* The pack's cover, and the way to change it: a tap opens its stickers
       to choose from. A video or Lottie sticker used to sit here as an <img>
       of its own bytes, which is the broken "?" a Telegram pack showed. */
    const thumb = `<button type="button" class="packman-cover" data-pack-cover="${app().escapeHTML(pack.id)}" title="${app().escapeHTML(t('تغییر تصویر شاخص پک', 'Change the pack cover'))}" aria-label="${app().escapeHTML(t('تغییر تصویر شاخص پک', 'Change the pack cover'))}">
      ${packCoverHtml(pack, 'packman-thumb')}
      <span class="packman-cover-edit" aria-hidden="true"><i class="fas fa-pen"></i></span>
    </button>`;
    return `<div class="packman-row">
      <input type="checkbox" data-pack-id="${app().escapeHTML(pack.id)}" aria-label="${app().escapeHTML(pack.title || '')}">
      ${thumb}
      <input class="packman-name" data-rename="${app().escapeHTML(pack.id)}" value="${app().escapeHTML(pack.title || '')}" maxlength="60">
      <span class="packman-count">${pack.stickers?.length || 0}</span>
      <button type="button" class="packman-share" data-pack-one-share="${app().escapeHTML(pack.id)}" title="${app().escapeHTML(t('ارسال این پک به گفتگوی باز', 'Share this pack into the open chat'))}" aria-label="${app().escapeHTML(t('ارسال این پک', 'Share this pack'))}"><i class="fas fa-share-nodes"></i></button>
      <span class="packman-move">
        <button type="button" data-move="up" data-pack-id="${app().escapeHTML(pack.id)}" ${index === 0 ? 'disabled' : ''} aria-label="${app().escapeHTML(t('بالا', 'Up'))}"><i class="fas fa-chevron-up" aria-hidden="true"></i></button>
        <button type="button" data-move="down" data-pack-id="${app().escapeHTML(pack.id)}" ${index === packs.length - 1 ? 'disabled' : ''} aria-label="${app().escapeHTML(t('پایین', 'Down'))}"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>
      </span>
    </div>`;
  }).join('');
  startPackCovers(list, packManagerElement.querySelector('.packman-body') || list);
  syncPackManagerFooter();
}

/* Every sticker of a pack, to choose its cover from: stills where there are
   stills, the moving sticker only for one that has none yet. */
function openPackCoverPicker(packId) {
  const pack = chatState.stickerPacks.find((item) => item.id === packId);
  const card = packManagerElement?.querySelector('.packman-card');
  if (!pack || !card) return;
  card.querySelector('.packman-coverpick')?.remove();
  const current = packCoverRecord(pack)?.id || '';
  const sheet = document.createElement('div');
  sheet.className = 'packman-coverpick';
  sheet.setAttribute('data-cover-pack', pack.id);
  sheet.innerHTML = `
    <div class="packman-head">
      <button type="button" class="packman-back" data-cover-cancel aria-label="${app().escapeHTML(t('بازگشت', 'Back'))}"><i class="fas ${document.documentElement.dir === 'rtl' ? 'fa-arrow-right' : 'fa-arrow-left'}" aria-hidden="true"></i></button>
      <h3>${app().escapeHTML(t(`تصویر شاخص «${pack.title}»`, `Cover of "${pack.title}"`))}</h3>
    </div>
    <div class="packman-coverpick-grid">
      ${pack.stickers.map((record) => `<button type="button" class="packman-coverpick-cell ${record.id === current ? 'is-current' : ''}" data-cover-pick="${app().escapeHTML(record.id)}" aria-label="${app().escapeHTML(record.emoji || record.name || '')}">
        ${packCoverHtml({ stickers: [record] }, 'packman-coverpick-media')}
      </button>`).join('')}
    </div>`;
  card.appendChild(sheet);
  startPackCovers(sheet, sheet.querySelector('.packman-coverpick-grid'));
}

function closePackManager() {
  packManagerElement?.remove();
  packManagerElement = null;
  document.documentElement.classList.remove('packman-open');
}

function openPackManager() {
  closePackManager();
  const host = document.createElement('div');
  host.className = 'packman';
  host.innerHTML = `
    <div class="packman-backdrop" data-pack-close></div>
    <div class="packman-card" role="dialog" aria-modal="true">
      <div class="packman-head">
        <button type="button" class="packman-back" data-pack-close aria-label="${app().escapeHTML(t('بازگشت', 'Back'))}"><i class="fas ${document.documentElement.dir === 'rtl' ? 'fa-arrow-right' : 'fa-arrow-left'}" aria-hidden="true"></i></button>
        <h3>${app().escapeHTML(t('مدیریت پک‌های استیکر', 'Manage sticker packs'))}</h3>
      </div>
      <div class="packman-body">
        <p class="packman-note">${app().escapeHTML(t('نام هر پک را همین‌جا می‌توانید عوض کنید، و با فلش‌ها ترتیبشان را. ترتیب همان است که در پنل استیکر می‌بینید. برای عوض کردن تصویر شاخص یک پک، روی تصویرش بزنید. با دکمهٔ ارسال هر پک را جداگانه، یا چندتا را تیک‌زده با هم برای گفتگوی باز بفرستید.', 'Rename a pack in place, and use the arrows to order them. That order is the one the sticker panel shows. Tap a pack\'s picture to choose its cover. The share button sends one pack; tick several and send them together into the open chat.'))}</p>
        <div class="packman-list" data-pack-list></div>
      </div>
      <div class="packman-foot">
        <span class="packman-count" data-pack-selected style="flex:1 1 auto;align-self:center"></span>
        <button type="button" class="packman-bulk is-share" data-pack-share>${app().escapeHTML(t('ارسال انتخاب‌شده‌ها', 'Share selected'))}</button>
        <button type="button" class="packman-bulk is-danger" data-pack-delete>${app().escapeHTML(t('حذف انتخاب‌شده‌ها', 'Delete selected'))}</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  packManagerElement = host;
  document.documentElement.classList.add('packman-open');

  host.addEventListener('click', async (event) => {
    if (event.target.closest('[data-cover-cancel]')) { host.querySelector('.packman-coverpick')?.remove(); return; }
    const picked = event.target.closest('[data-cover-pick]');
    if (picked) {
      const sheet = picked.closest('.packman-coverpick');
      await setPackCover(sheet?.getAttribute('data-cover-pack'), picked.getAttribute('data-cover-pick'));
      sheet?.remove();
      return;
    }
    const cover = event.target.closest('[data-pack-cover]');
    if (cover) { openPackCoverPicker(cover.getAttribute('data-pack-cover')); return; }
    if (event.target.closest('[data-pack-close]')) { closePackManager(); return; }
    const move = event.target.closest('[data-move]');
    if (move) {
      await moveStickerPack(move.getAttribute('data-pack-id'), move.getAttribute('data-move') === 'up' ? -1 : 1);
      renderPackManagerList();
      return;
    }
    /* One pack, straight from its row. */
    const oneShare = event.target.closest('[data-pack-one-share]');
    if (oneShare) {
      await shareStickerPacks([oneShare.getAttribute('data-pack-one-share')]);
      return;
    }
    /* The whole ticked selection. */
    const share = event.target.closest('[data-pack-share]');
    if (share) {
      const chosen = packManagerSelection();
      if (!chosen.length) return;
      const sent = await shareStickerPacks(chosen);
      if (sent) {
        packManagerElement?.querySelectorAll('input[type="checkbox"]').forEach((box) => { box.checked = false; });
        syncPackManagerFooter();
      }
      return;
    }
    const remove = event.target.closest('[data-pack-delete]');
    if (remove) {
      const chosen = packManagerSelection();
      if (!chosen.length) return;
      const yes = await PoorijaDialogs.confirm(
        t(`${chosen.length} پک و همهٔ استیکرهایشان حذف شوند؟`, `Delete ${chosen.length} pack(s) and every sticker in them?`),
        { okLabel: t('حذف', 'Delete'), cancelLabel: t('انصراف', 'Cancel'), danger: true },
      );
      if (!yes) return;
      const removed = await deleteStickerPacks(chosen);
      notify(t(`${removed} پک حذف شد.`, `${removed} pack(s) deleted.`), 'success');
      renderPackManagerList();
      return;
    }
  });

  host.addEventListener('change', (event) => {
    if (event.target.matches('input[type="checkbox"]')) syncPackManagerFooter();
  });

  /* Renamed on blur and on Enter rather than on every keystroke: a write to
     IndexedDB per character is a lot of writes for a name somebody is still
     halfway through typing. */
  host.addEventListener('blur', async (event) => {
    const field = event.target.closest('[data-rename]');
    if (field) await renameStickerPack(field.getAttribute('data-rename'), field.value);
  }, true);
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.closest('[data-rename]')) event.target.blur();
    if (event.key === 'Escape') closePackManager();
  });

  renderPackManagerList();
}

/* ---- arranging packs ---------------------------------------------------
 *
 * Packs used to be shown in the order they were imported, which is the order
 * nobody chose. These three let somebody name them, put them where they want
 * them, and clear out several at once -- all of it written straight back to
 * IndexedDB, because a pack list that forgets its arrangement on reload is
 * worse than one that never offered to remember it.
 */
function stickerPackOrder(a, b) {
  const left = Number.isFinite(a?.order) ? a.order : Number.MAX_SAFE_INTEGER;
  const right = Number.isFinite(b?.order) ? b.order : Number.MAX_SAFE_INTEGER;
  if (left !== right) return left - right;
  return String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
}

/** Writes the current array positions back as the stored order. */
async function persistStickerPackOrder() {
  await Promise.all(chatState.stickerPacks.map(async (pack, index) => {
    if (pack.order === index) return;
    pack.order = index;
    try { await stickerDbPutPack(pack); } catch (error) { console.warn('[Stickers] order not saved', error); }
  }));
}

async function renameStickerPack(packId, title) {
  const pack = chatState.stickerPacks.find((item) => item.id === packId);
  if (!pack) return false;
  /* Trimmed, capped, and an empty name refused rather than stored: a pack
     with a blank title becomes unfindable in its own list. */
  const next = String(title || '').trim().slice(0, 60);
  if (!next || next === pack.title) return false;
  pack.title = next;
  try {
    await stickerDbPutPack(pack);
  } catch (error) {
    console.warn('[Stickers] rename failed', error);
    return false;
  }
  renderStickerPanel();
  return true;
}

/* Moving a pack one place is moveStickerPack further down, the version that
   the page has always actually run: two function declarations shared the name
   and the later one silently replaced this one, so this copy was dead code
   that a reader would reasonably take for the live one. */

/** Deletes several at once, and answers how many actually went. */
async function deleteStickerPacks(packIds) {
  const wanted = Array.from(new Set(packIds || []));
  let removed = 0;
  for (const packId of wanted) {
    const before = chatState.stickerPacks.length;
    await deleteStickerPack(packId);
    if (chatState.stickerPacks.length < before) removed += 1;
  }
  if (removed) await persistStickerPackOrder();
  return removed;
}

async function deleteStickerPack(packId) {
  const index = chatState.stickerPacks.findIndex((pack) => pack.id === packId);
  if (index < 0) return;
  const [pack] = chatState.stickerPacks.splice(index, 1);
  releaseStickerUrls(pack);
  try { await stickerDbDeletePack(packId); } catch (error) { console.warn('[Stickers] delete failed', error); }
  if (chatState.stickerActivePackId === packId) {
    chatState.stickerActivePackId = chatState.stickerPacks[0]?.id || '';
  }
  renderStickerPanel();
  renderStorageCard().catch(() => {});
}

/* lottie-web is 165 KB — far too much to ship on the critical path for a
   feature most conversations never touch. Pull it in the first time a .tgs
   sticker actually needs to be drawn, and only once. */
let lottieScriptPromise = null;
function ensureLottie() {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (lottieScriptPromise) return lottieScriptPromise;
  lottieScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LOTTIE_SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.lottie ? resolve(window.lottie) : reject(new Error('lottie missing after load')));
    script.onerror = () => reject(new Error('lottie failed to load'));
    document.head.appendChild(script);
  }).catch((error) => {
    lottieScriptPromise = null;
    throw error;
  });
  return lottieScriptPromise;
}

/* Lottie stickers drawn off the page's thread.
 *
 * The SVG player redraws a sticker by changing an SVG scene, and the engine
 * then restyles and repaints it on the page's own thread — on a Mac, forty of
 * them in a desktop-sized panel left the page drawing at half speed whatever
 * the script did. lottie-web's canvas player can run in a worker instead: each
 * sticker's canvas is handed to it (OffscreenCanvas) and drawn there, on
 * another core, and the page only composites the result. Used wherever the
 * engine has OffscreenCanvas and workers (Safari 16.4 and later, every current
 * Chromium and Firefox); anywhere else, or if the worker does not answer, the
 * SVG player on the shared clock below takes over. The SVG player stays the
 * global `lottie`, and still makes every sticker's still. */
let lottieWorkerPromise = null;
let lottieWorkerHealthy = null;
function lottieWorkerSupported() {
  try {
    return typeof Worker === 'function' && typeof OffscreenCanvas === 'function'
      && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
      && Boolean(new OffscreenCanvas(1, 1).getContext('2d'));
  } catch (_error) {
    return false;
  }
}
/* A second lottie build loaded beside the SVG one: each defines the global
   `lottie`, so the new one is taken from it and the SVG player put back. One
   at a time, so two loads cannot take each other's player. */
let lottiePlayerLoads = Promise.resolve();
function loadLottiePlayer(url) {
  const load = lottiePlayerLoads.then(() => ensureLottie()).then((svgPlayer) => new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      const player = window.lottie && window.lottie !== svgPlayer && typeof window.lottie.loadAnimation === 'function' ? window.lottie : null;
      window.lottie = svgPlayer;
      resolve(player);
    };
    script.onerror = () => {
      window.lottie = svgPlayer;
      resolve(null);
    };
    document.head.appendChild(script);
  })).catch(() => null);
  lottiePlayerLoads = load.then(() => undefined);
  return load;
}
function ensureLottieWorker() {
  if (!lottieWorkerPromise) lottieWorkerPromise = lottieWorkerSupported() ? loadLottiePlayer(LOTTIE_WORKER_SCRIPT_URL) : Promise.resolve(null);
  return lottieWorkerPromise;
}
let lottieCanvasPromise = null;
function ensureLottieCanvas() {
  if (!lottieCanvasPromise) lottieCanvasPromise = loadLottiePlayer(LOTTIE_CANVAS_SCRIPT_URL);
  return lottieCanvasPromise;
}
/* Which player draws a Lottie sticker on screen.
   - The worker's canvas player in Chromium and Firefox: drawn off the page's
     thread, the page only composites.
   - In WebKit — Safari, every browser on an iPhone, and the native app's
     window on macOS — the canvas player on the page, on the shared clock.
     WebKit hands every frame of a worker's canvas back through the page's own
     thread, and measured there, a pack switch with worker canvases on screen
     stalled the page for over a second; the page's canvas player draws in the
     script itself, so the clock's budget holds exactly what it measures.
   - The SVG player when neither can be had. */
function lottieDrawMode() {
  const webkit = /Apple/i.test(navigator.vendor || '');
  if (!webkit && lottieWorkerHealthy !== false && lottieWorkerSupported()) return 'worker';
  return 'canvas';
}

/* Lottie stickers, played only while they are on screen.
   Every placeholder used to be mounted the moment it was drawn: a pack of a
   hundred .tgs stickers was a hundred SVG scenes animating at once, most of
   them scrolled out of sight, and on a phone that was both the long wait for
   the panel and the stutter in the ones you could see. Now each is mounted as
   it nears the view, paused when it leaves, and destroyed once its node is
   gone from the page (a redraw replaces the nodes; lottie would otherwise go
   on animating the old ones, invisibly, for as long as the app is open).
   The JSON is fetched once per sticker and parsed for each mount, because
   lottie writes into the data it is given. */
const lottieTexts = new Map();
const lottieTextsReady = new Map();
/* A sticker's animation as it is handed to a player: parsed, and with every
   expression taken out. lottie-web can evaluate After Effects expressions —
   JavaScript, run with eval — and the worker's canvas build carries that
   code. A sticker comes from whoever sent it or made the pack, so nothing in
   one is ever run. An expression lives under the key "x", and the player
   pastes whatever it finds there into the code it evaluates — a string, or an
   array of strings joined by its toString. So an "x" is kept only when it
   cannot be code: a number or an array of numbers (the easing handles), or an
   object (a split position's own x property, whose insides are checked the
   same way, and which as text is only "[object Object]"). Telegram's own
   stickers never carry an expression, and the page's policy already refuses
   eval; this holds whatever a player or a policy does. */
function lottieDataFrom(text) {
  const data = JSON.parse(text);
  const pending = [data];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) { for (const item of value) if (item && typeof item === 'object') pending.push(item); continue; }
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (key === 'x') {
        const numeric = typeof item === 'number' || (Array.isArray(item) && item.every((n) => typeof n === 'number'));
        const property = Boolean(item) && typeof item === 'object' && !Array.isArray(item);
        if (!numeric && !property) { delete value[key]; continue; }
      }
      if (item && typeof item === 'object') pending.push(item);
    }
  }
  return data;
}
function lottieTextFor(url) {
  if (!lottieTexts.has(url)) {
    lottieTexts.set(url, fetch(url).then((response) => response.text()).then((text) => {
      lottieTextsReady.set(url, text);
      return text;
    }).catch((error) => {
      lottieTexts.delete(url);
      throw error;
    }));
  }
  return lottieTexts.get(url);
}
const mountedLottieNodes = new Set();
let lottieObserver = null;
function lottieWatcher() {
  if (lottieObserver || typeof IntersectionObserver !== 'function') return lottieObserver;
  lottieObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const node = entry.target;
      node.__onScreen = entry.isIntersecting;
      node.__wanted = entry.isIntersecting;
      if (!entry.isIntersecting) unmountLottieNode(node);
      else if (node.__lottie) startLottieClock();
      else queueMotion(node, mountLottieNode);
    }
  }, { rootMargin: '120px 0px' });
  return lottieObserver;
}
function lottieFallback(node) {
  node.textContent = '🎞';
  node.classList.add('is-fallback', 'is-ready');
}
/* Every Lottie sticker on screen is drawn by one clock, against a budget.
 *
 * Each animation used to run its own 60 frames a second, all of them, every
 * frame. A desktop window shows forty or fifty stickers where a phone shows
 * fifteen, and forty vector scenes redrawn sixty times a second is more than
 * a frame has: on a Mac the page fell to half its frame rate and stuttered.
 *
 * Now one requestAnimationFrame loop draws them, each at the frame its own
 * clock says it is on — so a sticker always moves at its true speed — but
 * only as many as fit in a few milliseconds of the frame, in turn, so none is
 * left behind. When the stickers on screen need more than that, they are drawn
 * less often (60, then 30, 20, 15 times a second) rather than the page drawing
 * fewer frames; when there is room again, they go back up. The sticker held up
 * in the large view is drawn every frame, whatever the rest are doing. */
const LOTTIE_RATES = [60, 30, 20, 15];
const lottieClock = { frame: 0, level: 0, cursor: 0, slow: 0, easy: 0, last: 0, pace: 16.7, cap: Infinity };
function lottieBudgetMs() {
  return window.matchMedia?.('(min-width: 900px) and (pointer: fine)').matches ? 8 : 6;
}
function startLottieClock() {
  if (!lottieClock.frame) lottieClock.frame = requestAnimationFrame(lottieTick);
}
/* The script's own time is only half of what a redraw costs: the engine then
   restyles and repaints every scene that changed, outside this loop. So the
   page's real pace — how far apart its frames actually are — decides too:
   frames coming slower than about 40 a second step the stickers down, and
   only a steady 55 or so lets them back up. At the slowest rate, if the page
   still cannot keep up, fewer stickers move at once (the rest hold their
   current frame) until it can. */
function lottiePaceAdjust(spent, budget, behind) {
  const pace = lottieClock.pace;
  const struggling = behind || spent > budget || pace > 25;
  const easy = !behind && spent < budget * 0.6 && pace < 18;
  if (struggling) { lottieClock.slow += 1; lottieClock.easy = 0; } else if (easy) { lottieClock.easy += 1; lottieClock.slow = 0; }
  if (lottieClock.slow > 8) {
    lottieClock.slow = 0;
    if (lottieClock.level < LOTTIE_RATES.length - 1) lottieClock.level += 1;
    else lottieClock.cap = Math.max(8, Math.min(lottieClock.cap, mountedLottieNodes.size) - 4);
  }
  if (lottieClock.easy > 60) {
    lottieClock.easy = 0;
    if (lottieClock.cap !== Infinity) lottieClock.cap = lottieClock.cap + 4 >= mountedLottieNodes.size ? Infinity : lottieClock.cap + 4;
    else if (lottieClock.level > 0) lottieClock.level -= 1;
  }
}
function lottieTick(now) {
  lottieClock.frame = 0;
  if (document.hidden) { lottieClock.last = 0; return; }
  if (lottieClock.last) lottieClock.pace = lottieClock.pace * 0.9 + Math.min(200, now - lottieClock.last) * 0.1;
  lottieClock.last = now;
  const live = [];
  mountedLottieNodes.forEach((node) => {
    if (node.isConnected && node.__lottie && node.__lottieReady && !node.__workerLottie && node.__onScreen !== false) live.push(node);
  });
  if (!live.length) { lottieClock.last = 0; return; }
  const rate = LOTTIE_RATES[lottieClock.level];
  const moving = lottieClock.cap === Infinity ? live : live.filter((node, index) => node.__priority || index < lottieClock.cap);
  const due = moving.filter((node) => node.__priority || now - (node.__drawnAt || 0) >= 1000 / rate - 4);
  const budget = lottieBudgetMs();
  const began = performance.now();
  let drawn = 0;
  for (let i = 0; i < due.length; i += 1) {
    const node = due[(lottieClock.cursor + i) % due.length];
    if (drawn && !node.__priority && performance.now() - began > budget) continue;
    const animation = node.__lottie;
    const total = Math.max(1, animation.totalFrames || 1);
    const fps = animation.frameRate || 60;
    if (node.__startedAt === undefined) node.__startedAt = now;
    try { animation.goToAndStop((((now - node.__startedAt) / 1000) * fps) % total, true); } catch (_error) { /* destroyed under us */ }
    node.__drawnAt = now;
    drawn += 1;
  }
  lottieClock.cursor = due.length ? (lottieClock.cursor + drawn) % due.length : 0;
  lottiePaceAdjust(performance.now() - began, budget, drawn < due.length);
  lottieClock.frame = requestAnimationFrame(lottieTick);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) startLottieClock(); });
/* Building a sticker's player is the expensive step, and it is done here, in
   the frame budget of pumpMotion — synchronously, once its player script and
   its JSON are in hand. When they are not yet, they are fetched first and the
   sticker goes back in the queue. (Built after an await instead, every queued
   sticker started inside one frame's budget and forty were then built back to
   back: the one-second stall as a pack of moving stickers opened on a Mac.) */
const lottiePlayersReady = { svg: null, canvas: null, worker: null };
function lottiePlayersFor(mode) {
  if (!lottiePlayersReady.svg) return null;
  if (mode === 'worker') return lottiePlayersReady.worker === null ? null : lottiePlayersReady;
  return lottiePlayersReady.canvas === null ? null : lottiePlayersReady;
}
async function prepareLottieNode(node, mode) {
  lottiePlayersReady.svg = lottiePlayersReady.svg || await ensureLottie();
  if (mode === 'worker') lottiePlayersReady.worker = (await ensureLottieWorker()) || false;
  else lottiePlayersReady.canvas = (await ensureLottieCanvas()) || false;
  await lottieTextFor(node.dataset.lottieSrc);
}
function mountLottieNode(node) {
  if (node.__lottie) {
    startLottieClock();
    return;
  }
  if (node.__lottieLoading) return;
  const mode = lottieDrawMode();
  const players = lottiePlayersFor(mode);
  const text = lottieTextsReady.get(node.dataset.lottieSrc);
  if (!players || text === undefined) {
    node.__lottieLoading = true;
    prepareLottieNode(node, mode)
      .then(() => {
        node.__lottieLoading = false;
        if (node.isConnected && node.__wanted !== false) queueMotion(node, mountLottieNode);
      })
      .catch(() => {
        node.__lottieLoading = false;
        lottieFallback(node);
      });
    return;
  }
  if (!node.isConnected || node.__wanted === false) return;
  try {
    const sized = node.offsetWidth > 0 && node.offsetHeight > 0;
    if (mode === 'worker' && players.worker && sized) {
      mountWorkerLottie(node, players.worker, lottieDataFrom(text));
      return;
    }
    const onCanvas = Boolean(players.canvas && sized);
    const animation = (onCanvas ? players.canvas : players.svg).loadAnimation({
      container: node,
      renderer: onCanvas ? 'canvas' : 'svg',
      loop: true,
      autoplay: false,
      animationData: lottieDataFrom(text),
      rendererSettings: onCanvas
        ? { preserveAspectRatio: 'xMidYMid meet', clearCanvas: true }
        : { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true, hideOnTransparent: true },
    });
    node.__lottie = animation;
    node.__priority = node.classList.contains('sticker-focus-media');
    mountedLottieNodes.add(node);
    const ready = () => {
      node.__lottieReady = true;
      markMediaReady(node);
      startLottieClock();
    };
    if (animation.isLoaded) ready(); else animation.addEventListener('DOMLoaded', ready);
  } catch (_error) {
    lottieFallback(node);
  }
}
/* A sticker on the worker's canvas player: it plays itself there, at its own
   rate, so it never joins the clock. Each one gets a holder of its own inside
   the sticker's node, because the player clears its container when it is
   destroyed, and one let go before it has loaded can only be destroyed once it
   has — by then the node may hold its successor. The worker is trusted once
   the first sticker it was given has loaded; if that has not happened in a few
   seconds, it is given up on and the stickers go to the SVG player instead. */
function mountWorkerLottie(node, workerPlayer, animationData) {
  const holder = document.createElement('div');
  holder.className = 'lottie-worker-holder';
  node.appendChild(holder);
  const animation = workerPlayer.loadAnimation({
    container: holder,
    renderer: 'canvas',
    loop: true,
    autoplay: true,
    animationData,
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet', clearCanvas: true },
  });
  const entry = { animation, holder, loaded: false, dropWhenLoaded: false };
  node.__lottie = animation;
  node.__workerEntry = entry;
  node.__workerLottie = true;
  mountedLottieNodes.add(node);
  animation.addEventListener('DOMLoaded', () => {
    lottieWorkerHealthy = true;
    entry.loaded = true;
    if (entry.dropWhenLoaded) {
      try { animation.destroy(); } catch (_error) { /* already gone */ }
      holder.remove();
      return;
    }
    node.__lottieReady = true;
    markMediaReady(node);
  });
  if (lottieWorkerHealthy === null) {
    window.setTimeout(() => {
      if (lottieWorkerHealthy !== null || entry.loaded) return;
      lottieWorkerHealthy = false;
      lottiePlayersReady.worker = false;
      console.warn('[Stickers] the Lottie worker did not answer; drawing Lottie stickers on the page instead');
      [...mountedLottieNodes].filter((each) => each.__workerLottie).forEach((each) => {
        unmountLottieNode(each);
        if (each.isConnected && each.__wanted !== false) queueMotion(each, mountLottieNode);
      });
    }, 4000);
  }
}

/* Off screen, a Lottie sticker gives its scene back: a hundred mounted and
   paused were a hundred SVG trees kept for nothing. Its still shows until it
   comes back, and coming back is quick — the JSON is kept (lottieTextFor). */
function releaseLottieAnimation(node) {
  const animation = node.__lottie;
  if (!animation) return;
  const entry = node.__workerEntry;
  node.__workerEntry = null;
  if (node.__workerLottie && entry) {
    if (!entry.loaded && lottieWorkerHealthy !== false) {
      entry.dropWhenLoaded = true;
      entry.holder.style.display = 'none';
      return;
    }
    try { animation.destroy(); } catch (_error) { /* already stopped */ }
    entry.holder.remove();
    return;
  }
  try { animation.destroy(); } catch (_error) { /* already stopped */ }
}
function unmountLottieNode(node) {
  if (!node.__lottie) return;
  releaseLottieAnimation(node);
  node.__workerLottie = false;
  node.__lottie = null;
  node.__lottieReady = false;
  mountedLottieNodes.delete(node);
  node.classList.remove('is-ready');
  node.closest(MOTION_HOLDERS)?.classList.remove('motion-ready');
}
function sweepLottieNodes() {
  mountedLottieNodes.forEach((node) => {
    if (node.isConnected) return;
    releaseLottieAnimation(node);
    node.__workerLottie = false;
    node.__lottie = null;
    node.__lottieReady = false;
    mountedLottieNodes.delete(node);
    lottieObserver?.unobserve(node);
  });
}
function hydrateLottieNodes(root = document) {
  sweepLottieNodes();
  const nodes = Array.from(root.querySelectorAll('[data-lottie-src]:not([data-lottie-watched])'));
  if (!nodes.length) return;
  const watcher = lottieWatcher();
  nodes.forEach((node) => {
    node.dataset.lottieWatched = '1';
    if (watcher) watcher.observe(node);
    else { node.__onScreen = true; mountLottieNode(node); }
  });
}

function stickerMediaHtml(url, kind, className, { width = 0, height = 0, lazy = false, eager = false } = {}) {
  /* The URL can originate off the wire (relay broadcasts, archive imports);
     anything that is not https/blob/data renders as nothing rather than as
     an attacker-chosen src. */
  const safeUrl = safeMediaUrl(url);
  if (!safeUrl) return '';
  const src = app().escapeHTML(safeUrl);
  /* With its size known, the picture holds its shape before it has loaded.
     A thread redraw rebuilds every bubble, and WebKit decodes each picture
     again: without this a GIF stood at no height for a moment, the reader's
     place was restored against that, and the thread then slid as the GIFs
     filled in. Numbers only, so nothing else can ride into the style. */
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  const shape = w > 0 && h > 0 && w <= 10000 && h <= 10000 ? ` style="aspect-ratio:${w} / ${h}"` : '';
  if (kind === 'lottie') return `<div class="${className} chat-lottie" data-lottie-src="${src}"></div>`;
  /* lazy: the source is given only while it is on screen (observeLazyMedia).
     eager as well: given at once, and still let go when it is far off — the
     first screenfuls of a pack open drawn, without waiting for the observer. */
  if (lazy && eager && kind !== 'lottie' && kind !== 'video') {
    return `<img class="${className} is-ready" src="${src}" data-lazy-src="${src}"${shape} alt="" draggable="false" decoding="async">`;
  }
  const source = lazy ? `data-lazy-src="${src}"` : `src="${src}"`;
  if (kind === 'video') return `<video class="${className}" ${source}${shape} ${lazy ? '' : 'autoplay '}loop muted playsinline disablepictureinpicture></video>`;
  return `<img class="${className}" ${source}${shape} alt="" draggable="false" ${lazy ? 'decoding="async"' : 'loading="lazy"'}>`;
}

/* ---- recent, favourites, and the order packs sit in ---------------------- */

/* Three small preferences, kept apart from the packs themselves.
 *
 * A sticker lives in exactly one pack in IndexedDB, and that is the right place
 * for the bytes. But "I used this five minutes ago", "I starred this" and "I
 * want this pack first" are facts about the PERSON, not about the pack — they
 * have to survive a pack being deleted and re-imported, they are tiny, and they
 * change far more often than the blobs do. So they are ids in localStorage,
 * resolved against the packs at render time. A starred sticker whose pack has
 * gone simply stops resolving and drops out, which is the correct behaviour and
 * costs no cleanup code.
 */
const STICKER_RECENT_KEY = 'poorija_sticker_recent';
const STICKER_FAVOURITE_KEY = 'poorija_sticker_favourites';
const STICKER_PACK_ORDER_KEY = 'poorija_sticker_pack_order';
const STICKER_RECENT_MAX = 40;

function stickerPrefRead(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function stickerPrefWrite(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list.slice(0, 400))); }
  catch (error) { /* private mode: the choice lasts the session */ }
}

/* A sticker is named by pack AND id: ids are unique per import, and the same
   sticker imported twice is genuinely two stickers with two blobs. */
const stickerRef = (packId, stickerId) => `${packId}:${stickerId}`;

function stickerRecentRefs() { return stickerPrefRead(STICKER_RECENT_KEY); }
function stickerFavouriteRefs() { return stickerPrefRead(STICKER_FAVOURITE_KEY); }

function noteStickerUsed(packId, stickerId) {
  const ref = stickerRef(packId, stickerId);
  const next = [ref, ...stickerRecentRefs().filter((item) => item !== ref)]
    .slice(0, STICKER_RECENT_MAX);
  stickerPrefWrite(STICKER_RECENT_KEY, next);
}

function stickerIsFavourite(packId, stickerId) {
  return stickerFavouriteRefs().includes(stickerRef(packId, stickerId));
}

function toggleStickerFavourite(packId, stickerId) {
  const ref = stickerRef(packId, stickerId);
  const current = stickerFavouriteRefs();
  const next = current.includes(ref)
    ? current.filter((item) => item !== ref)
    : [ref, ...current];
  stickerPrefWrite(STICKER_FAVOURITE_KEY, next);
  return next.includes(ref);
}

/* Refs back to records, in the order they were stored, skipping anything whose
   pack or sticker has since gone. */
function resolveStickerRefs(refs) {
  const out = [];
  for (const ref of refs) {
    const cut = String(ref).indexOf(':');
    if (cut < 0) continue;
    const packId = ref.slice(0, cut);
    const stickerId = ref.slice(cut + 1);
    const pack = chatState.stickerPacks.find((item) => item.id === packId);
    const record = pack?.stickers.find((item) => item.id === stickerId);
    if (record) out.push({ pack, record });
  }
  return out;
}

/* The order packs appear in.
 *
 * Stored as a list of ids rather than an index on each pack: an index has to be
 * rewritten for every pack when one moves, and goes wrong the moment two packs
 * disagree. A list is reordered by moving one entry, and anything missing from
 * it — a pack imported since the order was last saved — falls to the end in
 * import order, which is where a new pack belongs. */
function orderedStickerPacks() {
  const order = stickerPrefRead(STICKER_PACK_ORDER_KEY);
  const byId = new Map(chatState.stickerPacks.map((pack) => [pack.id, pack]));
  const out = [];
  order.forEach((id) => {
    const pack = byId.get(id);
    if (pack) { out.push(pack); byId.delete(id); }
  });
  byId.forEach((pack) => out.push(pack));
  return out;
}

function moveStickerPack(packId, direction) {
  const packs = orderedStickerPacks();
  const from = packs.findIndex((pack) => pack.id === packId);
  if (from < 0) return false;
  const to = from + (direction < 0 ? -1 : 1);
  if (to < 0 || to >= packs.length) return false;
  const [moved] = packs.splice(from, 1);
  packs.splice(to, 0, moved);
  stickerPrefWrite(STICKER_PACK_ORDER_KEY, packs.map((pack) => pack.id));
  return true;
}

/* The manage view's multi-pick, for sending several packs in one go. A set of
   pack ids, same shape as the sticker selection below it; ids that no longer
   exist are filtered out when the selection is read, so deleting a ticked pack
   cannot leave a ghost tick behind. */
const stickerManageSelection = new Set();
function toggleStickerManagePick(packId) {
  if (!packId) return false;
  if (stickerManageSelection.has(packId)) stickerManageSelection.delete(packId);
  else stickerManageSelection.add(packId);
  return stickerManageSelection.has(packId);
}
function orderedStickerManageSelection() {
  const ids = orderedStickerPacks().map((pack) => pack.id);
  return ids.filter((id) => stickerManageSelection.has(id));
}
function clearStickerManageSelection() {
  stickerManageSelection.clear();
}

/* ---- picking several at once -------------------------------------------- */

/* Selection is a set of refs, not a flag on each record.
 *
 * The same sticker can appear three times in one panel — once under Recent,
 * once under Favourites, once in its own pack — and all three have to light up
 * together, because they are the same sticker. A flag on the record would do
 * that too, but it would also survive into IndexedDB on the next write, which
 * is how a transient UI state becomes a permanent field nobody meant to store.
 */
const stickerSelection = new Set();

/* Picking can also be switched on with nothing picked yet, from the panel's
   select button: a long press is how a phone starts it, but nobody finds a
   long press they were never shown. */
let stickerPickMode = false;
function stickerSelectionActive() { return stickerSelection.size > 0 || stickerPickMode; }
function setStickerPickMode(on) {
  stickerPickMode = Boolean(on);
  if (!stickerPickMode) stickerSelection.clear();
}

function toggleStickerSelection(packId, stickerId) {
  const ref = stickerRef(packId, stickerId);
  if (stickerSelection.has(ref)) stickerSelection.delete(ref);
  else stickerSelection.add(ref);
  return stickerSelection.has(ref);
}

function clearStickerSelection() {
  stickerSelection.clear();
  stickerPickMode = false;
}

/* Sending what is selected.
 *
 * One at a time and in the order they were chosen: each send owns the transfer
 * banner and the data channel, and starting several at once is how the channel
 * gets overrun — the same reason the gallery picker sends sequentially. */
async function sendSelectedStickers() {
  const chosen = resolveStickerRefs([...stickerSelection]);
  if (!chosen.length) return 0;
  clearStickerSelection();
  renderStickerPanel();
  let sent = 0;
  for (const { pack, record } of chosen) {
    try {
      await sendStickerRecord(record);
      noteStickerUsed(pack.id, record.id);
      sent += 1;
    } catch (error) {
      console.warn('[Stickers] one sticker did not send', error);
    }
  }
  renderStickerPanel();
  return sent;
}

/* Building a pack out of a selection.
 *
 * The blobs are shared with the packs they came from rather than copied: a Blob
 * is a handle, and IndexedDB stores the bytes once per put — copying would
 * double the storage for a set somebody assembled precisely because they
 * already had the stickers. New ids, though: two records with one id would make
 * the ref scheme ambiguous, and every favourite and recent entry is a ref.
 */
async function buildPackFromSelection(title) {
  const chosen = resolveStickerRefs([...stickerSelection]);
  if (!chosen.length) return null;
  if (chatState.stickerPacks.length >= STICKER_MAX_PACKS) {
    notify(t(`سقف ${STICKER_MAX_PACKS} پک استیکر پر است.`, `The ${STICKER_MAX_PACKS} sticker-pack limit is full.`), 'warning');
    return null;
  }
  const pack = {
    id: makeStickerId(),
    title: String(title || '').trim().slice(0, 60)
      || t('پک من', 'My pack'),
    author: '',
    createdAt: new Date().toISOString(),
    stickers: chosen.slice(0, STICKER_MAX_PER_PACK).map(({ record }) => ({
      ...record,
      id: makeStickerId(),
    })),
  };
  await stickerDbPutPack(pack);
  chatState.stickerPacks.push(pack);
  chatState.stickerActivePackId = pack.id;
  clearStickerSelection();
  renderStickerPanel();
  renderStorageCard().catch(() => {});
  return pack;
}

/* ---- managing single stickers ------------------------------------------
 *
 * What is picked can be deleted, or copied or moved into another pack — any
 * pack, "My stickers" included, and from any tab, Recent and Favourites too,
 * since a pick is a ref to the sticker in the pack it lives in. A move keeps
 * the sticker's id and carries its Recent and Favourite entries with it; a
 * copy is a new id over the same bytes, as buildPackFromSelection makes. A
 * pack left with nothing in it goes: an empty tab is a question with no
 * answer. */
function rewriteStickerRefs(mapping) {
  if (!mapping.size) return;
  for (const key of [STICKER_RECENT_KEY, STICKER_FAVOURITE_KEY]) {
    const next = [];
    for (const ref of stickerPrefRead(key)) {
      if (!mapping.has(ref)) next.push(ref);
      else if (mapping.get(ref)) next.push(mapping.get(ref));
    }
    stickerPrefWrite(key, [...new Set(next)]);
  }
}

async function storeTouchedStickerPacks(packs) {
  let emptied = 0;
  for (const pack of packs) {
    if (!chatState.stickerPacks.includes(pack)) continue;
    if (!pack.stickers.length) {
      await deleteStickerPack(pack.id);
      emptied += 1;
      continue;
    }
    try { await stickerDbPutPack(pack); } catch (error) { console.warn('[Stickers] a pack was not saved', error); }
  }
  if (emptied) await persistStickerPackOrder();
  return emptied;
}

function selectedStickerRecords() {
  return resolveStickerRefs([...stickerSelection]);
}

async function deleteSelectedStickers() {
  const chosen = selectedStickerRecords();
  if (!chosen.length) return { removed: 0, emptied: 0 };
  const touched = new Set();
  const mapping = new Map();
  for (const { pack, record } of chosen) {
    pack.stickers = pack.stickers.filter((item) => item !== record);
    forgetStickerRecordUrls(record);
    mapping.set(stickerRef(pack.id, record.id), null);
    touched.add(pack);
  }
  rewriteStickerRefs(mapping);
  const emptied = await storeTouchedStickerPacks(touched);
  clearStickerSelection();
  renderStickerPanel();
  renderStorageCard().catch(() => {});
  return { removed: chosen.length, emptied };
}

/* A pack to put the picked stickers in: one of the packs, a new one, or —
   for a copy of nothing but GIFs — the GIF shelf. Null when the person backs
   out. */
async function chooseStickerTarget({ move = false } = {}) {
  const chosen = selectedStickerRecords();
  if (!chosen.length) return null;
  const allGifs = chosen.every(({ record }) => String(record.mime || '').toLowerCase() === 'image/gif');
  return chooseStickerPackFor({
    question: move ? t(`${chosen.length} استیکر به کدام پک منتقل شود؟`, `Move ${chosen.length} sticker(s) to which pack?`)
      : t(`${chosen.length} استیکر در کدام پک کپی شود؟`, `Copy ${chosen.length} sticker(s) into which pack?`),
    offerGifShelf: !move && allGifs && typeof saveGif === 'function',
  });
}
/* The pack list as a question, with a new pack at the end — shared by the
   sticker shelf and the GIF shelf ("copy into a sticker pack"). */
async function chooseStickerPackFor({ question, offerGifShelf = false }) {
  const choices = orderedStickerPacks().map((pack) => ({
    value: pack.id,
    label: `${pack.title || t('پک', 'Pack')} (${pack.stickers.length})`,
  }));
  choices.push({ value: '__new__', label: t('+ پک تازه', '+ A new pack') });
  if (offerGifShelf) choices.push({ value: '__gifs__', label: t('قفسهٔ گیف', 'The GIF shelf') });
  const choice = await PoorijaDialogs.choose(question, choices, { cancelLabel: t('انصراف', 'Cancel') });
  if (!choice) return null;
  if (choice === '__gifs__') return '__gifs__';
  if (choice === '__new__') {
    if (chatState.stickerPacks.length >= STICKER_MAX_PACKS) {
      notify(t(`سقف ${STICKER_MAX_PACKS} پک استیکر پر است.`, `The ${STICKER_MAX_PACKS} sticker-pack limit is full.`), 'warning');
      return null;
    }
    const title = await PoorijaDialogs.prompt(t('نام پک تازه؟', 'A name for the new pack?'), { value: t('پک من', 'My pack') });
    if (title === null) return null;
    const pack = {
      id: makeStickerId(),
      title: String(title || '').trim().slice(0, 60) || t('پک من', 'My pack'),
      author: '',
      source: 'custom',
      createdAt: new Date().toISOString(),
      stickers: [],
    };
    chatState.stickerPacks.push(pack);
    return pack;
  }
  return chatState.stickerPacks.find((pack) => pack.id === choice) || null;
}

async function copySelectedStickersTo(target, { move = false } = {}) {
  const chosen = selectedStickerRecords();
  if (!chosen.length || !target) return { done: 0, skipped: 0 };
  let done = 0;
  let skipped = 0;
  if (target === '__gifs__') {
    for (const { record } of chosen) {
      if (record.blob && await saveGif(record.blob)) done += 1;
      else skipped += 1;
    }
    clearStickerSelection();
    renderStickerPanel();
    return { done, skipped, target: '__gifs__' };
  }
  const touched = new Set([target]);
  const mapping = new Map();
  for (const { pack, record } of chosen) {
    if (pack === target) { skipped += 1; continue; }
    if (target.stickers.length >= STICKER_MAX_PER_PACK) { skipped += 1; continue; }
    if (move) {
      pack.stickers = pack.stickers.filter((item) => item !== record);
      target.stickers.push(record);
      mapping.set(stickerRef(pack.id, record.id), stickerRef(target.id, record.id));
      touched.add(pack);
    } else {
      target.stickers.push({ ...record, id: makeStickerId() });
    }
    done += 1;
  }
  rewriteStickerRefs(mapping);
  await storeTouchedStickerPacks(touched);
  if (chatState.stickerPacks.includes(target)) {
    chatState.stickerActivePackId = target.id;
    rememberActiveStickerPack(target.id);
  }
  clearStickerSelection();
  renderStickerPanel();
  renderStorageCard().catch(() => {});
  return { done, skipped, target: target.id };
}

/* The two sections that are not packs.
 *
 * Recent and Favourites are lists of refs into the packs, so they are tabs
 * without being packs — they cannot be reordered, deleted or shared, and they
 * disappear when they are empty rather than sitting there as a puzzle. Recent
 * comes first because it is what most sends come from; Favourites next because
 * it is chosen deliberately and changes slowly.
 */
const STICKER_VIRTUAL_RECENT = '__recent__';
const STICKER_VIRTUAL_FAVOURITE = '__favourite__';

/* What a cell draws. A sticker that stays still: its thumbnail. One that
   moves: its still, at once, and the moving sticker over it once it is on
   screen and has a frame (observeLazyMedia, hydrateLottieNodes). */
function stickerCellMediaHtml(record, { eager = false } = {}) {
  const animated = typeof stickerIsAnimated === 'function' && stickerIsAnimated(record);
  if (!animated) return stickerMediaHtml(stickerThumbUrl(record), record.kind, 'chat-sticker-thumb', { lazy: true, eager });
  /* Stills of the first screenfuls are drawn with the grid; the rest as they
     near the view, like any thumbnail. Ninety of them decoded at once was a
     one-second stall on a Mac each time a big pack of moving stickers opened. */
  const still = record.thumb instanceof Blob
    ? stickerMediaHtml(stickerThumbUrl(record), 'image', 'chat-sticker-still', { lazy: true, eager })
    : '';
  return still + stickerMediaHtml(stickerObjectUrl(record), record.kind, 'chat-sticker-thumb is-motion', { lazy: true });
}
function stickerCellHtml(pack, record, { selectable, eager = false }) {
  const ref = stickerRef(pack.id, record.id);
  const chosen = stickerSelection.has(ref);
  const starred = stickerIsFavourite(pack.id, record.id);
  return `<button type="button"
    class="chat-sticker-cell ${chosen ? 'is-picked' : ''}"
    data-chat-sticker-send="${record.id}"
    data-chat-sticker-pack-id="${pack.id}"
    title="${app().escapeHTML(record.emoji || record.name)}">
    ${stickerCellMediaHtml(record, { eager })}
    <span class="chat-sticker-star ${starred ? 'is-on' : ''}"
      data-chat-sticker-fav="${record.id}"
      data-chat-sticker-fav-pack="${pack.id}"
      role="button" tabindex="0"
      title="${app().escapeHTML(starred ? t('برداشتن از دلخواه‌ها', 'Remove from favourites') : t('افزودن به دلخواه‌ها', 'Add to favourites'))}"><i class="fas fa-star"></i></span>
    ${selectable ? `<span class="chat-sticker-tick"><i class="fas fa-check"></i></span>` : ''}
  </button>`;
}

/* A row that says only "Gholam's pack · 24 stickers" is a row nobody can tell
   from the one above it, which is the whole difficulty of managing packs: the
   names are the user's own and they blur together, while the pictures never
   do. The first few stickers are shown so the row is recognisable at a glance,
   and the count of what is not shown goes on the end so the strip is not
   mistaken for the whole pack.
   Lazily decoded and capped: a manage list is not a place to decode two
   hundred images, and the object URLs are the same ones the grid already
   holds, so nothing extra is allocated or has to be revoked. */
const STICKER_STRIP_MAX = 6;
function stickerStripHtml(pack) {
  const stickers = pack?.stickers || [];
  if (!stickers.length) return '';
  const shown = stickers.slice(0, STICKER_STRIP_MAX)
    .map((record) => stickerMediaHtml(stickerThumbUrl(record), record.thumb instanceof Blob ? 'image' : record.kind, 'chat-sticker-manage-thumb'))
    .filter(Boolean)
    .join('');
  if (!shown) return '';
  const rest = stickers.length - STICKER_STRIP_MAX;
  const more = rest > 0
    ? `<span class="chat-sticker-manage-more">+${rest}</span>`
    : '';
  return `<div class="chat-sticker-manage-strip" aria-hidden="true">${shown}${more}</div>`;
}

function renderStickerPanel() {
  const grid = document.getElementById('chatStickerGrid');
  const tabs = document.getElementById('chatStickerTabs');
  if (!grid || !tabs) return;
  /* One panel, two shelves: the GIF shelf draws itself (55-gifs-and-keyboard-
     stickers.js). Everything that redraws the sticker shelf calls this, so
     the switch lives here rather than at every caller. */
  if (typeof syncStickerPanelShelf === 'function') syncStickerPanelShelf();
  if (chatState.stickerPanelMode === 'gifs' && typeof renderGifShelf === 'function') {
    renderGifShelf();
    return;
  }
  grid.classList.remove('is-managing', 'is-empty');
  const packs = orderedStickerPacks();
  /* Leaving the manage view ends the pick: a tick that survives into the
     sticker grid and reappears weeks later is a question with no answer. */
  if (!chatState.stickerManageMode) clearStickerManageSelection();

  if (!packs.length) {
    tabs.innerHTML = '';
    tabs.__html = '';
    grid.__html = '';
    grid.innerHTML = `<div class="chat-sticker-empty">
      <i class="fas fa-face-smile-wink"></i>
      <div class="chat-sticker-empty-title">${app().escapeHTML(t('هنوز پک استیکری اضافه نشده', 'No sticker packs yet'))}</div>
      <div class="chat-sticker-empty-note">${app().escapeHTML(t('فایل .wastickers واتس‌اپ، یک فایل zip، یا استیکرهای تکی (webp / png / gif / tgs / webm) را وارد کنید.', 'Import a WhatsApp .wastickers file, a .zip, or individual stickers (webp / png / gif / tgs / webm).'))}</div>
      <button type="button" data-chat-sticker-import class="chat-sticker-empty-btn"><i class="fas fa-file-import"></i> ${app().escapeHTML(t('وارد کردن استیکر', 'Import stickers'))}</button>
    </div>`;
    return;
  }

  const recent = resolveStickerRefs(stickerRecentRefs());
  const favourites = resolveStickerRefs(stickerFavouriteRefs());

  /* Which tab is showing. A virtual tab is only offered while it has
     something in it, so a remembered choice can point at one that has since
     emptied — falling back to the first real pack is what a person expects
     over an empty grid with no explanation. */
  let activeId = chatState.stickerActivePackId;
  if (activeId === STICKER_VIRTUAL_RECENT && !recent.length) activeId = '';
  if (activeId === STICKER_VIRTUAL_FAVOURITE && !favourites.length) activeId = '';
  const activePack = packs.find((pack) => pack.id === activeId);
  const virtual = activeId === STICKER_VIRTUAL_RECENT || activeId === STICKER_VIRTUAL_FAVOURITE;
  if (!virtual && !activePack) activeId = packs[0].id;
  chatState.stickerActivePackId = activeId;

  /* Virtual tabs carry data-chat-sticker-virtual as well, so "how many packs
     are there" stays answerable from the DOM. Without it Recent and Favourites
     count as packs, which is not a cosmetic problem: three suites assert pack
     counts from exactly this selector. */
  const tabButton = (id, iconHtml, label, virtualTab = false) => `<button type="button"
    class="chat-sticker-tab ${id === activeId ? 'active' : ''} ${virtualTab ? 'is-virtual' : ''}"
    data-chat-sticker-pack="${id}"
    ${virtualTab ? 'data-chat-sticker-virtual="1"' : ''}
    title="${app().escapeHTML(label)}">${iconHtml}</button>`;

  const virtualTabs = [
    recent.length ? tabButton(STICKER_VIRTUAL_RECENT, '<i class="fas fa-clock"></i>',
      t('اخیر', 'Recent'), true) : '',
    favourites.length ? tabButton(STICKER_VIRTUAL_FAVOURITE, '<i class="fas fa-star"></i>',
      t('دلخواه‌ها', 'Favourites'), true) : '',
  ].filter(Boolean).join('');

  const tabsHtml = virtualTabs + packs.map((pack) => tabButton(pack.id, packCoverHtml(pack), pack.title)).join('')
    + `<button type="button" class="chat-sticker-tab chat-sticker-tab-add" data-chat-sticker-import title="${app().escapeHTML(t('وارد کردن استیکر', 'Import stickers'))}"><i class="fas fa-plus"></i></button>`;
  /* Written only when it changed: a redraw for something else (a sticker
     sent, a star) must not make every picture load again. */
  if (tabs.__html !== tabsHtml) {
    tabs.innerHTML = tabsHtml;
    tabs.__html = tabsHtml;
    startPackCovers(tabs);
  }
  ensurePackCovers(packs);

  if (chatState.stickerManageMode) {
    grid.__html = '';
    grid.innerHTML = `<div class="chat-sticker-manage">
      ${packs.map((pack, index) => `
        <div class="chat-sticker-manage-row ${stickerManageSelection.has(pack.id) ? 'is-picked' : ''}">
          <input type="checkbox" class="chat-sticker-manage-pick" data-chat-sticker-pick="${pack.id}" ${stickerManageSelection.has(pack.id) ? 'checked' : ''} aria-label="${app().escapeHTML(t('انتخاب پک', 'Select pack'))}: ${app().escapeHTML(pack.title)}">
          <div class="chat-sticker-manage-order">
            <button type="button" data-chat-sticker-up="${pack.id}" ${index === 0 ? 'disabled' : ''} title="${app().escapeHTML(t('بالاتر', 'Move up'))}"><i class="fas fa-chevron-up"></i></button>
            <button type="button" data-chat-sticker-down="${pack.id}" ${index === packs.length - 1 ? 'disabled' : ''} title="${app().escapeHTML(t('پایین‌تر', 'Move down'))}"><i class="fas fa-chevron-down"></i></button>
          </div>
          <div class="chat-sticker-manage-info">
            <div class="chat-sticker-manage-title">${app().escapeHTML(pack.title)}</div>
            <div class="chat-sticker-manage-note">${pack.stickers.length} ${app().escapeHTML(t('استیکر', 'stickers'))}${pack.author ? ` · ${app().escapeHTML(pack.author)}` : ''}</div>
            ${stickerStripHtml(pack)}
          </div>
          <button type="button" class="chat-sticker-manage-share" data-chat-sticker-share="${pack.id}" title="${app().escapeHTML(t('ارسال پک به این گفتگو', 'Share pack into this chat'))}"><i class="fas fa-share-nodes"></i></button>
          <button type="button" class="chat-sticker-manage-del" data-chat-sticker-delete="${pack.id}" title="${app().escapeHTML(t('حذف پک', 'Delete pack'))}"><i class="fas fa-trash"></i></button>
        </div>`).join('')}
      <div class="chat-sticker-manage-bar ${stickerManageSelection.size ? '' : 'hidden'}">
        <span class="chat-sticker-selcount">${stickerManageSelection.size} ${app().escapeHTML(t('پک انتخاب‌شده', 'pack(s) selected'))}</span>
        <button type="button" class="chat-sticker-selbtn is-primary" data-chat-sticker-send-packs><i class="fas fa-paper-plane"></i> ${app().escapeHTML(t('ارسال انتخاب‌شده‌ها', 'Send selected'))}</button>
        <button type="button" class="chat-sticker-selbtn" data-chat-sticker-clear-packs>${app().escapeHTML(t('لغو', 'Clear'))}</button>
      </div>
    </div>`;
    return;
  }

  const showing = activeId === STICKER_VIRTUAL_RECENT ? recent
    : activeId === STICKER_VIRTUAL_FAVOURITE ? favourites
      : (activePack || packs[0]).stickers.map((record) => ({ pack: activePack || packs[0], record }));

  const picking = stickerSelectionActive();
  const cells = showing
    .map(({ pack, record }, index) => stickerCellHtml(pack, record, { selectable: picking, eager: index < STICKER_EAGER_CELLS }))
    .join('');

  /* The bar lives outside the grid, because the grid is a CSS grid of sticker
     cells and anything placed inside it becomes one. It only exists while
     something is selected: a permanent bar carrying disabled buttons is a
     question the panel keeps asking. */
  const bar = document.getElementById('chatStickerSelbar');
  if (bar) {
    bar.classList.toggle('hidden', !picking);
    bar.innerHTML = picking ? `
      <span class="chat-sticker-selcount">${stickerSelection.size} ${app().escapeHTML(t('انتخاب‌شده', 'selected'))}</span>
      <button type="button" data-chat-sticker-send-selected class="chat-sticker-selbtn is-primary" ${stickerSelection.size ? '' : 'disabled'}><i class="fas fa-paper-plane"></i> ${app().escapeHTML(t('ارسال', 'Send'))}</button>
      <button type="button" data-chat-sticker-copy-selected class="chat-sticker-selbtn" ${stickerSelection.size ? '' : 'disabled'}><i class="fas fa-copy"></i> ${app().escapeHTML(t('کپی به…', 'Copy to…'))}</button>
      <button type="button" data-chat-sticker-move-selected class="chat-sticker-selbtn" ${stickerSelection.size ? '' : 'disabled'}><i class="fas fa-arrow-right-arrow-left"></i> ${app().escapeHTML(t('انتقال به…', 'Move to…'))}</button>
      <button type="button" data-chat-sticker-make-pack class="chat-sticker-selbtn" ${stickerSelection.size ? '' : 'disabled'}><i class="fas fa-layer-group"></i> ${app().escapeHTML(t('ساخت پک', 'Make a pack'))}</button>
      <button type="button" data-chat-sticker-cover-selected class="chat-sticker-selbtn" ${stickerSelection.size === 1 ? '' : 'disabled'} title="${app().escapeHTML(t('این استیکر تصویر شاخص پکش شود', 'Make this sticker its pack\'s cover'))}"><i class="fas fa-image"></i> ${app().escapeHTML(t('شاخص پک', 'Pack cover'))}</button>
      <button type="button" data-chat-sticker-delete-selected class="chat-sticker-selbtn is-danger" ${stickerSelection.size ? '' : 'disabled'}><i class="fas fa-trash"></i> ${app().escapeHTML(t('حذف', 'Delete'))}</button>
      <button type="button" data-chat-sticker-clear-selection class="chat-sticker-selbtn"><i class="fas fa-xmark"></i> ${app().escapeHTML(t('لغو', 'Done'))}</button>` : '';
  }

  /* The same cells as last time are left alone: rebuilding them threw every
     picture away and loaded it again, which on a phone was the pack filling
     in piece by piece after each sticker sent. */
  if (grid.__html !== cells || !grid.firstElementChild) {
    grid.innerHTML = cells;
    grid.__html = cells;
  }
  hydrateLottieNodes(grid);
  observeLazyMedia(grid);
  if (activePack && !virtual) {
    checkPackReadable(activePack).catch(() => {});
    ensurePackThumbs(activePack).catch(() => {});
  }
}

/* The sticker library, reachable from a test.
 *
 * Everything above lives in this file's module scope — a classic script's
 * top-level `const` never reaches `window` — and the CSP forbids eval, so a
 * suite has no other way in. Reading the rendered DOM alone cannot tell a
 * favourite that was stored from one that merely happens to be drawn. */
window.__stickerProbe = {
  state: () => ({
    packs: chatState.stickerPacks.length,
    active: chatState.stickerActivePackId,
  }),
  render: () => renderStickerPanel(),
  recent: () => stickerRecentRefs(),
  favourites: () => stickerFavouriteRefs(),
  order: () => orderedStickerPacks().map((pack) => pack.id),
  resolved: (refs) => resolveStickerRefs(refs).map(({ pack, record }) => stickerRef(pack.id, record.id)),
  use: (packId, stickerId) => noteStickerUsed(packId, stickerId),
  star: (packId, stickerId) => toggleStickerFavourite(packId, stickerId),
  move: (packId, direction) => moveStickerPack(packId, direction),
  select: (packId, stickerId) => toggleStickerSelection(packId, stickerId),
  selection: () => [...stickerSelection],
  clearSelection: () => clearStickerSelection(),
  makePack: (title) => buildPackFromSelection(title),
  telegramName: (text) => telegramPackName(text),
  setCover: (packId, stickerId) => setPackCover(packId, stickerId),
  lottieData: (text) => lottieDataFrom(text),
  lottieClock: () => ({ rate: LOTTIE_RATES[lottieClock.level], cap: lottieClock.cap, pace: Math.round(lottieClock.pace * 10) / 10, mounted: mountedLottieNodes.size, worker: [...mountedLottieNodes].filter((node) => node.__workerLottie).length, canvas: document.querySelectorAll('.chat-lottie > canvas').length, workerHealthy: lottieWorkerHealthy, mode: lottieDrawMode() }),
  coverUrl: (packId) => packCoverUrl(chatState.stickerPacks.find((pack) => pack.id === packId)),
  importTelegram: (text) => importTelegramStickerPack(text),
  deleteSelected: () => deleteSelectedStickers(),
  copySelected: (packId, move = false) => copySelectedStickersTo(packId === '__gifs__' ? '__gifs__' : chatState.stickerPacks.find((pack) => pack.id === packId), { move }),
  pickMode: (on) => { setStickerPickMode(on); renderStickerPanel(); },
  packs: () => chatState.stickerPacks.map((pack) => ({ id: pack.id, title: pack.title, ids: pack.stickers.map((record) => record.id) })),
  addPack: async (pack) => {
    await stickerDbPutPack(pack);
    chatState.stickerPacks.push(pack);
    return pack.id;
  },
  removePack: (packId) => deleteStickerPack(packId),
  /* A clean slate, including the three preference lists: a test that inherits
     the last run's favourites is measuring the last run. */
  reset: () => {
    chatState.stickerPacks = [];
    chatState.stickerActivePackId = '';
    clearStickerSelection();
    [STICKER_RECENT_KEY, STICKER_FAVOURITE_KEY, STICKER_PACK_ORDER_KEY]
      .forEach((key) => { try { localStorage.removeItem(key); } catch (error) { /* private mode */ } });
  },
};

function setStickerPanelVisible(visible, { shelf = 'stickers' } = {}) {
  const panel = document.getElementById('chatStickerPanel');
  if (!panel) return;
  const button = document.getElementById('chatStickerBtn');
  panel.classList.toggle('hidden', !visible);
  button?.classList.toggle('is-open', visible);
  button?.setAttribute('aria-expanded', visible ? 'true' : 'false');
  document.getElementById('chatStickerManageBtn')?.classList.remove('is-active');
  if (visible) {
    chatState.stickerManageMode = false;
    /* Opened from the Stickers row it opens on stickers, from the GIF row on
       GIFs: the row somebody tapped is the shelf they meant. */
    chatState.stickerPanelMode = shelf === 'gifs' ? 'gifs' : 'stickers';
    renderStickerPanel();
  }
  /* Opening the panel shortens the thread pane, which leaves the scroll offset
     pointing above the newest message; closing it lengthens the pane again.
     Either way the user expects to still be looking at the bottom. */
  requestAnimationFrame(() => {
    const messages = document.getElementById('chatMessages');
    if (messages) messages.scrollTop = messages.scrollHeight;
  });
}

function findStickerRecord(packId, stickerId) {
  const pack = chatState.stickerPacks.find((item) => item.id === packId);
  return pack?.stickers.find((item) => item.id === stickerId) || null;
}

async function sendStickerRecord(record) {
  if (!record?.blob) return;
  const extension = record.kind === 'lottie' ? 'tgs.json' : (record.kind === 'video' ? 'webm' : (record.name.split('.').pop() || 'webp'));
  const fileName = record.name && record.name.includes('.') ? record.name : `sticker.${extension}`;
  const file = new File([record.blob], fileName, { type: record.mime || 'image/webp' });
  await sendEncryptedBlob(file, 'sticker', 0, {
    stickerKind: record.kind,
    stickerEmoji: record.emoji || '',
  });
}

/* A shared pack travels as an ordinary encrypted attachment: a .wastickers ZIP
   with the same contents.json layout the importer already understands. No new
   wire type, no new parser, and the receiver can save the file and re-import it
   anywhere else. */
async function buildStickerPackArchive(pack) {
  if (!window.JSZip) throw new Error('JSZip missing');
  const zip = new window.JSZip();
  const manifest = {
    identifier: pack.id,
    name: pack.title,
    publisher: pack.author || (chatState.profile.name || ''),
    stickers: [],
  };
  let index = 1;
  for (const record of pack.stickers) {
    const extension = record.kind === 'lottie' ? 'tgs' : (record.kind === 'video' ? 'webm' : ((record.name.split('.').pop() || 'webp').toLowerCase()));
    const fileName = `${String(index).padStart(2, '0')}.${extension}`;
    zip.file(fileName, record.blob);
    manifest.stickers.push({ image_file: fileName, emojis: record.emoji ? [record.emoji] : [] });
    index += 1;
  }
  zip.file('contents.json', JSON.stringify(manifest));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const safeTitle = (pack.title || 'stickers').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'stickers';
  return new File([blob], `${safeTitle}.wastickers`, { type: 'application/zip' });
}

async function shareStickerPack(packId) {
  const pack = chatState.stickerPacks.find((item) => item.id === packId);
  if (!pack) return;
  if (!pack.stickers.length) {
    notify(t('این پک خالی است.', 'That pack is empty.'), 'warning');
    return;
  }
  const conversation = getActiveConversation();
  if (!conversation) {
    notify(t('اول یک گفتگو را باز کنید تا پک برایش ارسال شود.', 'Open a conversation first, then share the pack into it.'), 'warning');
    return;
  }
  notify(t('در حال بسته‌بندی پک…', 'Packing the sticker pack…'), 'info');
  try {
    const file = await buildStickerPackArchive(pack);
    if (file.size > MAX_FILE_BYTES) {
      notify(t('این پک برای ارسال بزرگ است؛ چند استیکر را حذف کنید.', 'This pack is too large to send; remove a few stickers.'), 'warning');
      return;
    }
    setStickerPanelVisible(false);
    await sendEncryptedBlob(file, 'stickerpack', 0, {
      packTitle: pack.title,
      packCount: pack.stickers.length,
    });
  } catch (error) {
    console.error('[Stickers] share failed', error);
    notify(t('ارسال پک استیکر ناموفق بود.', 'Sharing the sticker pack failed.'), 'error');
  }
}

/* The pack manager's "send what I ticked". One intent, several packs: each
   still leaves as its own message, because merging them into one archive
   would arrive on the other side as a single pack nobody chose — and the
   receiver's Add button works per pack. The packs go out in the order the
   manager lists them, and the summary at the end is one sentence, not one
   toast per pack. Returns how many left, so the caller knows to clear the
   ticks. */
async function shareStickerPacks(packIds) {
  const conversation = getActiveConversation();
  if (!conversation) {
    notify(t('اول یک گفتگو را باز کنید تا پک‌ها برایش ارسال شوند.', 'Open a conversation first, then share the packs into it.'), 'warning');
    return 0;
  }
  notify(t('در حال بسته‌بندی پک‌ها…', 'Packing the sticker packs…'), 'info');
  setStickerPanelVisible(false);
  let sent = 0;
  let skipped = 0;
  for (const packId of packIds) {
    const pack = chatState.stickerPacks.find((item) => item.id === packId);
    /* An empty or oversized pack is skipped, not fatal: the rest of the
       selection still goes, and the count says what did not. */
    if (!pack || !pack.stickers.length) { skipped += 1; continue; }
    try {
      const file = await buildStickerPackArchive(pack);
      if (file.size > MAX_FILE_BYTES) { skipped += 1; continue; }
      await sendEncryptedBlob(file, 'stickerpack', 0, {
        packTitle: pack.title,
        packCount: pack.stickers.length,
      });
      sent += 1;
    } catch (error) {
      console.error('[Stickers] pack share failed for', pack.title, error);
      skipped += 1;
    }
  }
  if (sent && skipped) {
    notify(t(`${sent} پک ارسال شد؛ ${skipped} پک رد شد (خالی یا بیش از حد بزرگ).`, `${sent} pack(s) sent; ${skipped} skipped (empty or too large).`), 'warning');
  } else if (sent) {
    notify(t(`${sent} پک ارسال شد.`, `${sent} pack(s) sent.`), 'success');
  } else {
    notify(t('هیچ پکی ارسال نشد؛ خالی یا بیش از حد بزرگ بودند.', 'No packs were sent; they were empty or too large.'), 'warning');
  }
  return sent;
}

/* Saves a pack that arrived in a message. Reuses the same archive reader the
   file picker uses, so a shared pack and an imported one are identical. */
async function adoptSharedStickerPack(entry) {
  if (!entry?.downloadUrl) {
    notify(t('فایل این پک روی دستگاه نیست.', 'This pack file is not on the device.'), 'warning');
    return;
  }
  if (chatState.stickerPacks.length >= STICKER_MAX_PACKS) {
    notify(t(`سقف ${STICKER_MAX_PACKS} پک استیکر پر است.`, `The ${STICKER_MAX_PACKS} sticker-pack limit is full.`), 'warning');
    return;
  }
  try {
    const blob = await (await fetch(entry.downloadUrl)).blob();
    const file = new File([blob], entry.name || 'shared.wastickers', { type: 'application/zip' });
    const pack = await readStickerArchive(file);
    if (!pack.stickers.length) {
      notify(t('این پک هیچ استیکر قابل استفاده‌ای ندارد.', 'That pack has no usable stickers.'), 'warning');
      return;
    }
    if (entry.packTitle) pack.title = String(entry.packTitle).slice(0, 60);
    pack.source = 'shared';
    await stickerDbPutPack(pack);
    chatState.stickerPacks.push(pack);
    chatState.stickerActivePackId = pack.id;
    entry.packAdopted = true;
    storeHistory();
    renderStickerPanel();
    renderMessages();
    notify(t(`پک «${pack.title}» با ${pack.stickers.length} استیکر اضافه شد.`, `Added "${pack.title}" with ${pack.stickers.length} stickers.`), 'success');
  } catch (error) {
    console.error('[Stickers] adopt failed', error);
    notify(t('افزودن پک ناموفق بود.', 'Adding the pack failed.'), 'error');
  }
}

function formatVaultBytes(bytes) {
  return app().formatBytes?.(bytes) || `${Math.round((bytes || 0) / 1024)} KB`;
}

async function renderStorageCard() {
  const target = document.getElementById('chatStorageStats');
  if (!target) return;
  /* The quota select rides in the same card; its stored value is applied here
     so the control never shows a setting this device is not actually using. */
  const limitSelect = document.getElementById('chatAutoDownloadLimit');
  if (limitSelect) {
    limitSelect.value = String(chatAutoDownloadLimitBytes());
    if (limitSelect.selectedIndex < 0) limitSelect.value = String(DEFAULT_AUTO_DOWNLOAD_LIMIT_BYTES);
  }
  const media = await mediaStorageStats();
  chatState.mediaStatsCache = media;
  const packBytes = chatState.stickerPacks.reduce(
    (sum, pack) => sum + pack.stickers.reduce((inner, record) => inner + (record.blob?.size || 0), 0), 0,
  );
  const packCount = chatState.stickerPacks.reduce((sum, pack) => sum + pack.stickers.length, 0);
  const soundBytes = chatState.customSounds.reduce((sum, sound) => sum + (sound.blob?.size || 0), 0);
  const savedGifs = chatState.gifLibrary?.stickers || [];
  const gifBytes = savedGifs.reduce((sum, record) => sum + (record.blob?.size || 0), 0);
  const rows = [
    [t('پیوست پیام‌ها', 'Message attachments'), `${media.count} ${t('مورد', 'items')} · ${formatVaultBytes(media.bytes)}`],
    [t('استیکرها', 'Stickers'), `${chatState.stickerPacks.length} ${t('پک', 'packs')} / ${packCount} ${t('استیکر', 'stickers')} · ${formatVaultBytes(packBytes)}`],
    [t('گیف‌های ذخیره‌شده', 'Saved GIFs'), `${savedGifs.length} ${t('مورد', 'items')} · ${formatVaultBytes(gifBytes)}`],
    [t('صداهای دلخواه', 'Custom sounds'), `${chatState.customSounds.length} ${t('مورد', 'items')} · ${formatVaultBytes(soundBytes)}`],
  ];
  if (media.oldest) {
    rows.push([t('قدیمی‌ترین پیوست', 'Oldest attachment'), new Date(media.oldest).toLocaleDateString(language() === 'fa' ? 'fa-IR' : 'en-GB')]);
  }
  /* navigator.storage is the only honest number for how much room is left;
     without it the card would imply a budget nobody is enforcing. */
  try {
    const quota = await navigator.storage?.estimate?.();
    if (quota?.quota) {
      rows.push([t('سهمیهٔ مرورگر', 'Browser quota'), `${formatVaultBytes(quota.usage || 0)} / ${formatVaultBytes(quota.quota)}`]);
    }
  } catch (_error) { /* not available everywhere */ }
  target.innerHTML = rows.map(([label, value]) => `
    <div class="chat-storage-row">
      <span class="chat-storage-label">${app().escapeHTML(label)}</span>
      <span class="chat-storage-value">${app().escapeHTML(value)}</span>
    </div>`).join('');
}
