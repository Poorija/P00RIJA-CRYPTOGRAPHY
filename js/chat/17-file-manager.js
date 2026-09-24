/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 17 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   The local file manager
*/

/* =====================================================================
   The local file manager
   ---------------------------------------------------------------------
   Everything this app stores lives on the device: attachments in an
   encrypted IndexedDB vault, sticker packs and custom ringtones in a
   second one. The settings card could only ever say how many bytes that
   was in total and offer to delete all of it, which is not a choice
   anybody can make safely.

   So: one view of every file, grouped the way people think about them,
   with the size of each group drawn rather than listed, and per-file
   open / save / delete. Nothing here leaves the device — saving writes
   through the browser's own download path from a decrypted blob.
   ===================================================================== */
const FILE_CATEGORIES = [
  { id: 'image', fa: 'تصویرها', en: 'Images', icon: 'fa-image', color: '#38bdf8' },
  { id: 'video', fa: 'ویدیوها', en: 'Video', icon: 'fa-film', color: '#a78bfa' },
  { id: 'audio', fa: 'صداها و ویس‌ها', en: 'Audio & voice', icon: 'fa-microphone', color: '#34d399' },
  { id: 'document', fa: 'اسناد و فایل‌ها', en: 'Documents', icon: 'fa-file-lines', color: '#f59e0b' },
  { id: 'sticker', fa: 'استیکرها', en: 'Stickers', icon: 'fa-face-laugh', color: '#f472b6' },
  { id: 'sound', fa: 'صداهای دلخواه', en: 'Custom sounds', icon: 'fa-bell', color: '#94a3b8' },
];

function fileCategoryOf(record) {
  const mime = String(record.mime || '');
  if (record.kind === 'sticker' || record.stickerKind) return 'sticker';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/') || record.kind === 'voice' || record.kind === 'audio') return 'audio';
  return 'document';
}

/* Walks the vault and keeps only what a list needs. The ciphertext is never
   copied out of the cursor, so indexing half a gigabyte of attachments costs
   one record's worth of memory rather than all of it. */
async function mediaVaultIndex() {
  const files = [];
  try {
    const db = await openMediaDb();
    await new Promise((resolve) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly');
      const request = tx.objectStore(MEDIA_STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value;
        files.push({
          id: value.id,
          source: 'vault',
          conversationId: value.conversationId || '',
          name: value.name || t('بدون نام', 'Untitled'),
          mime: value.mime || '',
          kind: value.kind || '',
          category: fileCategoryOf(value),
          size: Number(value.size || value.cipher?.byteLength || 0),
          createdAt: Date.parse(value.createdAt || '') || value.lastUsedAt || 0,
        });
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onabort = resolve;
    });
  } catch (error) {
    console.warn('[Files] could not index the vault', error);
  }
  return files;
}

function stickerPackEntries() {
  return chatState.stickerPacks.map((pack) => ({
    id: pack.id,
    source: 'pack',
    conversationId: '',
    name: pack.title || t('پک استیکر', 'Sticker pack'),
    mime: 'application/zip',
    kind: 'sticker',
    category: 'sticker',
    size: pack.stickers.reduce((sum, record) => sum + (record.blob?.size || 0), 0),
    count: pack.stickers.length,
    createdAt: Date.parse(pack.createdAt || '') || 0,
  }));
}
function customSoundEntries() {
  return chatState.customSounds.map((sound) => ({
    id: sound.id,
    source: 'sound',
    conversationId: '',
    name: sound.name || t('صدای دلخواه', 'Custom sound'),
    mime: sound.blob?.type || 'audio/*',
    kind: 'sound',
    category: 'sound',
    size: sound.blob?.size || 0,
    createdAt: Date.parse(sound.createdAt || '') || 0,
  }));
}

/* The file manager's three sources, without the rest of the chat module. */
let vaultSourcesReady = false;
async function ensureVaultSources() {
  if (isChatInitialized || vaultSourcesReady) return;
  vaultSourcesReady = true;
  await Promise.all([
    loadStickerPacks().catch(() => { chatState.stickerPacks = []; }),
    loadCustomSounds().catch(() => { chatState.customSounds = []; }),
  ]);
}

async function collectLocalFiles() {
  const vault = await mediaVaultIndex();
  return [...vault, ...stickerPackEntries(), ...customSoundEntries()];
}

function conversationLabelFor(conversationId) {
  if (!conversationId) return '';
  const space = [...chatState.spaces.groups, ...chatState.spaces.channels]
    .find((item) => item.conversationId === conversationId);
  if (space) return space.name || '';
  const peerId = String(conversationId).startsWith('peer:') ? conversationId.slice(5) : '';
  const peer = peerId ? findPeerRecordByPeerId(peerId) : null;
  return peer?.username || peer?.name || '';
}

/* A donut drawn from stroke-dasharray: no chart library, no canvas, and it
   stays sharp at any size and in any theme. */
function usageDonut(slices, total) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = slices.filter((slice) => slice.bytes > 0).map((slice) => {
    const fraction = total ? slice.bytes / total : 0;
    const length = fraction * circumference;
    const dash = `<circle class="chat-files-arc" r="${radius}" cx="70" cy="70" fill="none"
      stroke="${slice.color}" stroke-width="17" stroke-linecap="butt"
      stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
    offset += length;
    return dash;
  }).join('');
  return `<svg viewBox="0 0 140 140" class="chat-files-donut" role="img" aria-label="${app().escapeHTML(t('سهم هر دسته از فضای اشغال‌شده', 'Share of used space by category'))}">
    <circle r="${radius}" cx="70" cy="70" fill="none" stroke="rgba(148,163,184,0.16)" stroke-width="17"></circle>
    ${arcs}
    <text x="70" y="66" text-anchor="middle" class="chat-files-donut-total">${app().escapeHTML(formatVaultBytes(total))}</text>
    <text x="70" y="84" text-anchor="middle" class="chat-files-donut-label">${app().escapeHTML(t('روی این دستگاه', 'on this device'))}</text>
  </svg>`;
}

function fileManagerState() {
  chatState.fileManager = chatState.fileManager || { category: 'all', query: '', sort: 'recent' };
  return chatState.fileManager;
}

/* Two places show this: the fold inside Secure Chat, and the Device files tab.
   Rendering both from one function means they can never drift apart, and the
   filter, sort and search a user sets in one carry into the other. */
async function renderFileManager() {
  /* A mount is skipped when it is folded away itself, or when it sits on a tab
     that is not showing. Not an offsetParent test: the Secure Chat fold is
     opened by removing .hidden from an ancestor in the same tick, and a
     visibility check would race that and leave the fold empty. */
  const cards = [...document.querySelectorAll('[data-file-manager]')].filter((node) => {
    if (node.classList.contains('hidden')) return false;
    const tab = node.closest('.tab-content');
    return !tab || !tab.classList.contains('hidden');
  });
  if (!cards.length) return;
  const state = fileManagerState();
  const files = await collectLocalFiles();
  chatState.fileManagerCache = files;
  const totals = new Map(FILE_CATEGORIES.map((category) => [category.id, { bytes: 0, count: 0 }]));
  files.forEach((file) => {
    const bucket = totals.get(file.category);
    if (!bucket) return;
    bucket.bytes += file.size;
    bucket.count += 1;
  });
  const total = [...totals.values()].reduce((sum, bucket) => sum + bucket.bytes, 0);
  const slices = FILE_CATEGORIES.map((category) => ({
    ...category,
    bytes: totals.get(category.id).bytes,
    count: totals.get(category.id).count,
  }));

  let quota = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota) quota = estimate;
  } catch (_error) { /* not everywhere */ }

  const visible = files
    .filter((file) => state.category === 'all' || file.category === state.category)
    .filter((file) => !state.query || file.name.toLowerCase().includes(state.query.toLowerCase()))
    .sort((a, b) => (state.sort === 'size' ? b.size - a.size : b.createdAt - a.createdAt));

  const chips = [
    { id: 'all', label: t('همه', 'All'), count: files.length },
    ...slices.filter((slice) => slice.count > 0).map((slice) => ({ id: slice.id, label: t(slice.fa, slice.en), count: slice.count })),
  ];

  const markup = `
    <div class="chat-files-head">
      <span><i class="fas fa-folder-open"></i> ${app().escapeHTML(t('مدیریت فایل‌های محلی', 'Local file manager'))}</span>
      <button type="button" data-files-refresh class="chat-storage-refresh" title="${app().escapeHTML(t('بازخوانی', 'Refresh'))}"><i class="fas fa-rotate"></i></button>
    </div>
    <div class="chat-files-summary">
      ${usageDonut(slices, total)}
      <div class="chat-files-legend">
        ${slices.map((slice) => `
          <button type="button" class="chat-files-legend-row ${state.category === slice.id ? 'is-on' : ''}" data-files-category="${slice.id}">
            <span class="chat-files-dot" style="background:${slice.color}"></span>
            <span class="chat-files-legend-name"><i class="fas ${slice.icon}"></i> ${app().escapeHTML(t(slice.fa, slice.en))}</span>
            <span class="chat-files-legend-size">${app().escapeHTML(formatVaultBytes(slice.bytes))}</span>
            <span class="chat-files-legend-share">${total ? Math.round((slice.bytes / total) * 100) : 0}%</span>
          </button>`).join('')}
      </div>
    </div>
    ${quota ? `
      <div class="chat-files-quota">
        <div class="chat-files-quota-bar"><span style="width:${Math.min(100, Math.round(((quota.usage || 0) / quota.quota) * 100))}%"></span></div>
        <span>${app().escapeHTML(t(
          `${formatVaultBytes(quota.usage || 0)} از ${formatVaultBytes(quota.quota)} سهمیهٔ مرورگر`,
          `${formatVaultBytes(quota.usage || 0)} of ${formatVaultBytes(quota.quota)} browser quota`,
        ))}</span>
      </div>` : ''}
    <div class="chat-files-controls">
      <div class="chat-files-chips">
        ${chips.map((chip) => `<button type="button" class="chat-files-chip ${state.category === chip.id ? 'is-on' : ''}" data-files-category="${chip.id}">${app().escapeHTML(chip.label)} <b>${chip.count}</b></button>`).join('')}
      </div>
      <div class="chat-files-tools">
        <input type="search" data-files-search value="${app().escapeHTML(state.query)}" placeholder="${app().escapeHTML(t('جستجوی نام فایل', 'Search file names'))}">
        <button type="button" data-files-sort="${state.sort === 'size' ? 'recent' : 'size'}" class="chat-soft-btn">
          <i class="fas ${state.sort === 'size' ? 'fa-arrow-down-wide-short' : 'fa-clock'}"></i>
          ${app().escapeHTML(state.sort === 'size' ? t('بزرگ‌ترین', 'Largest') : t('تازه‌ترین', 'Newest'))}
        </button>
        ${state.category !== 'all' ? `<button type="button" data-files-clear-category="${state.category}" class="chat-soft-btn danger">${app().escapeHTML(t('حذف این دسته', 'Delete this group'))}</button>` : ''}
      </div>
    </div>
    <div class="chat-files-list">
      ${visible.length ? visible.slice(0, 300).map((file) => {
        const category = FILE_CATEGORIES.find((item) => item.id === file.category) || FILE_CATEGORIES[3];
        const where = conversationLabelFor(file.conversationId);
        return `
        <div class="chat-files-row" data-file-id="${app().escapeHTML(file.id)}" data-file-source="${file.source}">
          <span class="chat-files-icon" style="color:${category.color}"><i class="fas ${category.icon}"></i></span>
          <span class="chat-files-meta">
            <b>${app().escapeHTML(file.name)}${file.count ? ` · ${file.count} ${app().escapeHTML(t('استیکر', 'stickers'))}` : ''}</b>
            <i>${app().escapeHTML(formatVaultBytes(file.size))}${file.createdAt ? ` · ${new Date(file.createdAt).toLocaleDateString(language() === 'fa' ? 'fa-IR' : 'en-GB')}` : ''}${where ? ` · ${where}` : ''}</i>
          </span>
          ${file.source === 'vault' ? `<button type="button" data-file-open="${app().escapeHTML(file.id)}" title="${app().escapeHTML(t('باز کردن', 'Open'))}"><i class="fas fa-up-right-from-square"></i></button>` : ''}
          <button type="button" data-file-save="${app().escapeHTML(file.id)}" title="${app().escapeHTML(t('ذخیره روی دستگاه', 'Save to device'))}"><i class="fas fa-download"></i></button>
          <button type="button" class="is-danger" data-file-delete="${app().escapeHTML(file.id)}" title="${app().escapeHTML(t('حذف', 'Delete'))}"><i class="fas fa-trash"></i></button>
        </div>`;
      }).join('') : `<div class="chat-files-empty">${app().escapeHTML(t('چیزی در این دسته نیست.', 'Nothing in this group.'))}</div>`}
      ${visible.length > 300 ? `<div class="chat-files-empty">${app().escapeHTML(t(`${visible.length - 300} مورد دیگر — با جستجو محدودتر کنید.`, `${visible.length - 300} more — narrow it down with search.`))}</div>` : ''}
    </div>`;
  cards.forEach((card) => {
    // A lock can close while the IndexedDB reads above are in flight.
    if (!vaultLockState().unlocked) {
      card.classList.add('hidden'); card.innerHTML = ''; return;
    }
    card.innerHTML = markup;
  });
}

function findLocalFile(id) {
  return (chatState.fileManagerCache || []).find((file) => file.id === id) || null;
}

function chatDownloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name || 'file';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function saveLocalFile(id) {
  const file = findLocalFile(id);
  if (!file) return;
  try {
    if (file.source === 'vault') {
      const media = await readMessageMedia(id);
      if (!media?.blob) throw new Error('missing');
      chatDownloadBlob(media.blob, file.name);
    } else if (file.source === 'pack') {
      const pack = chatState.stickerPacks.find((item) => item.id === id);
      if (!pack) throw new Error('missing');
      chatDownloadBlob(await buildStickerPackArchive(pack), `${pack.title || 'stickers'}.wastickers`);
    } else {
      const sound = chatState.customSounds.find((item) => item.id === id);
      if (!sound?.blob) throw new Error('missing');
      chatDownloadBlob(sound.blob, sound.name || 'sound');
    }
    notify(t('فایل ذخیره شد.', 'File saved.'), 'success');
  } catch (_error) {
    notify(t('این فایل روی دستگاه پیدا نشد.', 'That file is not on this device.'), 'warning');
  }
}

async function openLocalFile(id) {
  const media = await readMessageMedia(id).catch(() => null);
  if (!media?.blob) {
    notify(t('این فایل روی دستگاه پیدا نشد.', 'That file is not on this device.'), 'warning');
    return;
  }
  /* A blob: URL inherits this page's origin, so script inside an SVG (or
     anything HTML-flavoured) opened this way runs as the app. Only the
     inline-safe mime types get a tab; everything else is handed to the
     browser's download path, which does not execute content. */
  const url = URL.createObjectURL(media.blob);
  if (isInlineSafeMediaType(media.blob.type)) {
    window.open(url, '_blank', 'noopener');
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = findLocalFile(id)?.name || 'file';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function deleteLocalFile(id) {
  const file = findLocalFile(id);
  if (!file) return;
  if (!await PoorijaDialogs.confirm(t(`«${file.name}» حذف شود؟`, `Delete "${file.name}"?`))) return;
  if (file.source === 'vault') await dropMessageMedia(id);
  else if (file.source === 'pack') await deleteStickerPack(id);
  else await deleteCustomSound(id);
  await renderFileManager();
  renderStorageCard();
  renderMessages();
}

async function clearFileCategory(category) {
  const files = (chatState.fileManagerCache || []).filter((file) => file.category === category);
  if (!files.length) return;
  const label = FILE_CATEGORIES.find((item) => item.id === category);
  if (!await PoorijaDialogs.confirm(t(
    `${files.length} مورد از «${t(label?.fa || '', label?.en || '')}» حذف شود؟`,
    `Delete ${files.length} items from "${t(label?.fa || '', label?.en || '')}"?`,
  ))) return;
  for (const file of files) {
    /* Sequential on purpose: three different stores, and a parallel storm of
       IndexedDB transactions is how you get a half-deleted category. */
    // eslint-disable-next-line no-await-in-loop
    if (file.source === 'vault') await dropMessageMedia(file.id);
    // eslint-disable-next-line no-await-in-loop
    else if (file.source === 'pack') await deleteStickerPack(file.id);
    // eslint-disable-next-line no-await-in-loop
    else await deleteCustomSound(file.id);
  }
  notify(t(`${files.length} مورد حذف شد.`, `${files.length} items deleted.`), 'success');
  await renderFileManager();
  renderStorageCard();
  renderMessages();
}

async function loadCustomSounds() {
  try {
    chatState.customSounds = (await stickerDbGetAllSounds()) || [];
  } catch (error) {
    console.warn('[Sounds] load failed', error);
    chatState.customSounds = [];
  }
  renderRingtoneSettings();
  renderStorageCard().catch(() => {});
}

async function importCustomSound(file, slot) {
  if (!file) return;
  if (!/^audio\//i.test(file.type) && !/\.(mp3|m4a|aac|ogg|oga|wav|flac|opus|weba)$/i.test(file.name)) {
    notify(t('فقط فایل صوتی پشتیبانی می‌شود.', 'Only audio files are supported.'), 'warning');
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    notify(t('فایل صدا باید کمتر از ۴ مگابایت باشد.', 'The sound file must be under 4 MB.'), 'warning');
    return;
  }
  const record = {
    id: `snd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    slot: slot === 'message' ? 'message' : 'call',
    title: file.name.replace(/\.[^.]+$/, '').slice(0, 48),
    mime: file.type || 'audio/mpeg',
    blob: file,
    createdAt: new Date().toISOString(),
  };
  try {
    await stickerDbPutSound(record);
  } catch (error) {
    notify(t('ذخیرهٔ صدا ناموفق بود.', 'Saving the sound failed.'), 'error');
    return;
  }
  chatState.customSounds.push(record);
  chatState.profile = {
    ...chatState.profile,
    ...buildProfileDraft(),
    [record.slot === 'message' ? 'messageToneId' : 'ringtoneId']: record.id,
  };
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  renderRingtoneSettings();
  notify(t('صدای دلخواه ذخیره و انتخاب شد.', 'Custom sound saved and selected.'), 'success');
}

function findCustomSound(id) {
  return chatState.customSounds.find((sound) => sound.id === id) || null;
}

function customSoundUrl(record) {
  if (!record?.blob) return '';
  const cached = chatState.stickerUrls.get(record.id);
  if (cached) return cached;
  const url = URL.createObjectURL(record.blob);
  chatState.stickerUrls.set(record.id, url);
  return url;
}

async function deleteCustomSound(id) {
  const index = chatState.customSounds.findIndex((sound) => sound.id === id);
  if (index < 0) return;
  const [record] = chatState.customSounds.splice(index, 1);
  const url = chatState.stickerUrls.get(record.id);
  if (url) {
    URL.revokeObjectURL(url);
    chatState.stickerUrls.delete(record.id);
  }
  try { await stickerDbDeleteSound(id); } catch (_error) { /* the in-memory removal already took effect */ }
  const patch = {};
  if (chatState.profile.ringtoneId === id) patch.ringtoneId = 'classic';
  if (chatState.profile.messageToneId === id) patch.messageToneId = 'chime';
  if (Object.keys(patch).length) {
    chatState.profile = { ...chatState.profile, ...buildProfileDraft(), ...patch };
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  }
  renderRingtoneSettings();
}
const chatState = {
initialized: false,
profile: {
name: '',
serverUrl: '',
presenceUrl: '',
peerOrigin: '',
autoConnect: true,
allowVideo: true,
autoDiscovery: true,
showSuspensionCountdown: true,
avatarData: '',
stablePeerId: '',
turnUrl: '',
turnUsername: '',
turnCredential: '',
/* null = decide from whether a TURN server is configured; see peerOptions(). */
publicStun: null,
ringtoneId: 'classic',
messageToneId: 'chime',
},
identity: null,
history: {},
sessionKeys: {},
spaces: {
groups: [],
channels: [],
},
calls: [],
peers: [],
stickerPacks: [],
stickerActivePackId: '',
stickerManageMode: false,
stickerUrls: new Map(),
mediaUrls: new Map(),
mediaHydrating: new Set(),
mediaStatsCache: null,
chatUnlocked: false,
chatLockResolved: false,
groupCall: null,
selectionMode: false,
selectedMessages: new Set(),
threadRender: { conversationId: '', newestId: '' },
chatLastSeenAt: 0,
chatLockTimer: 0,
callChromeTimer: 0,
callLastInputAt: 0,
callChromeWasHidden: null,
callLevelMeter: null,
callLevelFrame: 0,
customSounds: [],
customRingtoneAudio: null,
activePeerClientId: null,
activeConversationId: '',
activeView: 'chats',
searchQuery: '',
ws: null,
peer: null,
peerTransportOrigin: '',
peerId: '',
clientId: '',
connected: false,
serverReachable: false,
shouldReconnect: false,
reconnectTimer: null,
sessions: new Map(),
chatListFilter: 'all',
/* Half-written messages, per conversation. Switching chats used to throw the
   text away, which is the single most common way to lose something you had
   already thought about. */
drafts: {},
/* Conversations the user deliberately marked unread — a to-do flag that
   survives having actually read them. */
manualUnread: {},
incomingFiles: new Map(),
/* Blobs still in flight, kept briefly so a receiver that ends up with a gap
   can ask for those chunks again instead of losing the whole file. */
outgoingFiles: new Map(),
/* Live transfers waiting on the recipient's file-accept / file-decline answer,
   keyed by transferId. */
transferConsentWaiters: new Map(),
/* Peers whose side of THIS device's key change is still unanswered: they hold
   a new identity key, we have not accepted it yet, and until we do their live
   session cannot come up. Keyed by the peer's peerId. */
awaitingKeyAccept: new Set(),
/* Small per-device choices that are neither profile nor identity: the
   auto-download quota lives here. */
prefs: { autoDownloadLimitBytes: DEFAULT_AUTO_DOWNLOAD_LIMIT_BYTES },
currentCall: null,
currentCallStartedAt: 0,
currentCallAnsweredAt: 0,
currentCallLogged: false,
currentCallDirection: 'out',
outgoingCallTimer: null,
incomingCallTimer: null,
outgoingRingTimer: null,
groupRingTimer: null,
pendingIncomingCall: null,
localStream: null,
remoteStream: null,
mediaRecorder: null,
recordedChunks: [],
voiceRecorderStream: null,
voiceRecorderAudioContext: null,
voiceDraft: null,
voiceDraftUrl: '',
expiryTimer: null,
timerSeconds: 0,
timerPopoverOpen: false,
replyToId: '',
editingMessageId: '',
callFilter: 'all',
activeCallLog: null,
callSelectMode: false,
callSelection: new Set(),
callSearch: '',
activeReactionMessageId: '',
/* Which message's toolbar is open.
   Held here rather than as a class on the bubble, because renderMessages()
   rebuilds the panel and a class does not survive that — and renderMessages()
   is called by the reaction button itself, by the lock ticker, and by every
   arriving receipt. The toolbar vanished "after a few seconds" for that reason,
   and pressing the emoji button appeared to do nothing at all: the re-render it
   triggered took away the very toolbar the picker hangs off. */
activeMessageId: '',
activeForwardMessageId: '',
avatarEditor: null,
pendingAvatarData: '',
recordingStartTime: 0,
recordingElapsed: 0,
recordingPaused: false,
recordingInterval: null,
voiceWaveformData: [],
playbackInterval: null,
pendingIncomingInvite: null,
pendingIncomingAccept: false,
currentCallMode: 'voice',
endingCurrentCall: false,
callMuted: false,
callHeld: false,
callSpeakerEnabled: false,
callVideoEnabled: true,
callFacingMode: 'user',
callDisplayMode: 'fullscreen',
callPrimaryVideo: 'remote',
callMirrorSelf: true,
callTimerInterval: null,
callQualityTimer: null,
callQuality: 'unknown',
callActiveSinkId: 'default',
remoteCallState: { muted: false, held: false, videoOff: false, screen: false },
floatingCallPosition: {
x: 24,
y: 24,
},
draggingFloatingCall: false,
floatingDragOffset: null,
portalsMounted: false,
timerPortalMounted: false,
heartbeatTimer: null,
reconnectAttempt: 0,
peerHealAttempt: 0,
peerHealTimer: null,
peerVerifyTimer: null,
peerHealInFlight: false,
wsWatchdogTimer: null,
lastInboundAt: 0,
lastTransportNoticeAt: 0,
iceRecoveryTimer: null,
iceRestartAttempt: 0,
peerIdRetryAttempt: 0,
peerConnectStartedAt: 0,
transportConnectInFlight: false,
transportConnectQueued: false,
lastWatchdogTickAt: 0,
historySaveTimer: null,
typingTimers: new Map(),
wsMessageQueues: new Map(),
/* Outbound message id → the conversation it belongs to, for the relay's
   queued/error frames. The server echoes the `tag` we put on a relay frame;
   without this map there is nothing to look that echo up against. */
pendingRelayTags: new Map(),
sessionWarmupTimers: new Map(),
sessionWarmupInFlight: new Set(),
serverRestriction: null,
serverRestrictionCountdownTimer: null,
serverRestrictionProbeTimer: null,
lastRestrictionNoticeAt: 0,
lastRestrictionNoticeText: '',
pinnedConversations: [],
qrScanner: null,
screenStream: null,
ringtoneAudioContext: null,
ringtoneInterval: null,
ringtoneStopTimer: null,
ringtonePrimed: false,
};
function app() {
return window.PoorijaApp;
}
function appState() {
return app()?.state;
}
function isUnlocked() {
/* activeProfile, not just masterPassword.

   A quick unlock used to set the password without opening the vault, and this
   function said yes to that: chat rendered, the user set a display name and a
   chat lock, and every write threw into a catch below. Treating "no profile"
   as locked makes the failure visible instead of silent. */
const st = appState();
return Boolean(st && !st.isLocked && st.masterPassword && st.activeProfile);
}
function language() {
return appState()?.language || 'fa';
}
function notify(message, type = 'info') {
if (type === 'error' || type === 'warning') {
window.__poorijaChatErrors = window.__poorijaChatErrors || [];
window.__poorijaChatErrors.push(String(message).slice(0, 70));
if (window.__poorijaChatErrors.length > 12) window.__poorijaChatErrors.shift();
}
app()?.showNotification?.(message, type);
}
function t(fa, en) {
return language() === 'fa' ? fa : en;
}
// Failed reads must never become successful writes of empty defaults.
const unreadableChatStores = new Set();
/* A read-through cache beside the encrypted store.
 *
 * The chat used to disconnect when the app locked, so no code ever ran with
 * the vault shut and storage was simply unreadable. The lock no longer
 * disconnects — messages arrive while the user is away, and that is the
 * point — but the code that receives them still reads storage: findPrekey
 * re-reads the prekey list on every envelope, and while locked those reads
 * came back empty, so minutes-old envelopes were declared past their window,
 * noted as expired, ACKNOWLEDGED, and the relay destroyed them.
 *
 * The cache holds the live copy of every chat store this session has read or
 * written. Reads are served from it whether the vault is open or shut;
 * writes go into it always, and reach localStorage the moment the key
 * exists — flushEncryptedStoreCache() runs on unlock for everything that
 * piled up while the vault was shut. Nothing new is held in memory that the
 * running chat was not already holding: chatState itself is the same
 * plaintext. */
const encryptedStoreCache = new Map();
function chatStorageAddress(key) {
return window.PoorijaVault.__native.resolve(key);
}
function reportChatStorageFailure(key) {
notify(t('خواندن یا ذخیره داده‌های چت ناموفق بود. داده‌های قبلی حفظ شده‌اند؛ برنامه را دوباره باز کنید یا فضای دستگاه را بررسی کنید.',
  'Chat storage failed. Existing data was preserved; reopen the app or check device storage.'), 'error');
}
function saveEncrypted(key, value) {
const address = chatStorageAddress(key);
if (unreadableChatStores.has(address)) return false;
encryptedStoreCache.set(address, { value, dirty: true });
/* A write with the vault shut is held, not refused: the arrival that made it
   is real, and dropping it on the floor is what produced messages that
   vanished between lock and unlock. */
if (!isUnlocked()) return true;
try {
localStorage.setItem(key, app().encryptStorageData(value));
const entry = encryptedStoreCache.get(address);
if (entry) entry.dirty = false;
return true;
} catch (error) {
console.error(`[chat] failed to save ${key}:`, error);
reportChatStorageFailure(key);
return false;
}
}
function loadEncrypted(key, fallback) {
const address = chatStorageAddress(key);
if (unreadableChatStores.has(address)) return fallback;
const cached = encryptedStoreCache.get(address);
if (cached) return cached.value;
/* No live copy and the vault is shut: the honest answer is the fallback —
   the key exists but cannot be read yet, and the poorija:unlock listener
   re-runs every one of these reads with the key in hand. Returning a default
   here used to toast three errors per notification-tap cold start. */
if (!isUnlocked()) return fallback;
try {
const raw = localStorage.getItem(key);
if (raw === null) {
unreadableChatStores.delete(address);
return fallback;
}
let decrypted = app()?.decryptStorageData(raw);
if (decrypted === null || decrypted === undefined) {
const legacy = JSON.parse(raw);
// Never interpret an encrypted envelope as application data after auth fails.
if (!legacy || typeof legacy !== 'object' || 'v' in legacy || 'ct' in legacy || 'mac' in legacy) {
throw new Error('Unreadable chat storage');
}
decrypted = legacy;
}
if (key === CHAT_HISTORY_STORAGE_KEY && (!decrypted || Array.isArray(decrypted)
  || typeof decrypted !== 'object' || !Object.values(decrypted).every(Array.isArray))) {
throw new Error('Invalid chat history');
}
unreadableChatStores.delete(address);
encryptedStoreCache.set(address, { value: decrypted, dirty: false });
return decrypted;
} catch (error) {
unreadableChatStores.add(address);
console.error(`[chat] preserving unreadable ${key}:`, error);
reportChatStorageFailure(key);
return fallback;
}
}
/* Persist everything the cache has been holding. Runs on unlock: whatever
   arrived while the vault was shut lands in localStorage here. */
function flushEncryptedStoreCache() {
if (!isUnlocked()) return 0;
let flushed = 0;
for (const [address, entry] of encryptedStoreCache) {
if (!entry.dirty) continue;
try {
localStorage.setItem(address, app().encryptStorageData(entry.value));
entry.dirty = false;
flushed += 1;
} catch (error) {
console.error(`[chat] could not flush ${address}:`, error);
}
}
return flushed;
}
function chatServerOrigin() {
const configured = String(chatState.profile.serverUrl || '').trim();
const fallbackOrigin = defaultRelayFallbackOrigin();
if (!configured || configured === 'file://' || configured === 'null') return fallbackOrigin;
return normalizeRelayOrigin(configured, fallbackOrigin);
}
/* The auto-download quota: an incoming live transfer at or under this size is
   accepted silently and written straight into the encrypted vault; anything
   larger is put to the user first. Zero means "never download without asking". */
function chatAutoDownloadLimitBytes() {
const raw = Number(chatState.prefs?.autoDownloadLimitBytes);
if (!Number.isFinite(raw) || raw < 0) return DEFAULT_AUTO_DOWNLOAD_LIMIT_BYTES;
return raw;
}
function saveChatPrefs() {
saveEncrypted(CHAT_PREFS_STORAGE_KEY, {
autoDownloadLimitBytes: chatAutoDownloadLimitBytes(),
relayOnboardAsked: Boolean(chatState.prefs?.relayOnboardAsked),
/* The pixel step the last video call settled at, so the next one starts near
   an answer that held instead of asking for 1080p and walking down through
   the opening seconds. A number, and one this device worked out about itself:
   it says nothing about who was called or when. */
callPixelStep: Number(chatState.prefs?.callPixelStep ?? 0),
});
}
/* The webview's internal origin is never a relay.
 *
 * macOS and iOS serve the native shell from 'tauri://localhost', which this
 * already rejected. Linux serves it from 'https://tauri.localhost' and Windows
 * from 'http://tauri.localhost', which pass the http(s) check below and were
 * therefore returned as if they were a real server — so the same build that
 * worked on macOS pointed the chat at itself on Linux and Windows and never
 * connected. That asymmetry, not anything about WebKitGTK, is the "Linux
 * cannot reach the chat server" bug. Any protocol is matched by hostname
 * because the scheme is the platform's choice, not ours. */
function isInternalShellOrigin(url) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    if (/^tauri:/i.test(parsed.protocol)) return true;
    return /^tauri\.localhost$/i.test(parsed.hostname);
  } catch (_error) {
    return false;
  }
}
/* A server address that can actually answer. Anything that points back at
 * this webview, names no host at all, or carries a bare single-label host
 * (the "tauri" disaster: a saved internal origin survives normalization as
 * https://tauri and every connect attempt then dies in DNS with NXDOMAIN) is
 * not a relay — callers replace it with the shell's hinted default instead of
 * firing requests at it. */
function isUsableRelayOrigin(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'file://') return false;
  if (isInternalShellOrigin(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host) return false;
    if (!host.includes('.') && !isLocalRelayHostname(host) && !isPrivateIpv4(host)) return false;
    return true;
  } catch (_error) {
    return false;
  }
}
/* WebRTC is the one thing PeerJS refuses to run without, and the one thing
 * WebKitGTK — the Linux native shell's engine — does not ship. Chat itself
 * rides the relay WebSocket and needs none of it, so "can a peer exist here"
 * and "is the relay reachable" are separate questions: when this returns
 * false the transport runs relay-only (messages, presence, offline queue) and
 * only the P2P layer — direct calls — is declared unavailable. */
function webRTCSupported() {
  return typeof window.RTCPeerConnection === 'function'
    || typeof window.webkitRTCPeerConnection === 'function';
}
function defaultRelayFallbackOrigin() {
if (window.location.protocol === 'file:' || window.location.protocol === 'tauri:') return 'http://127.0.0.1:9000';
try {
const current = new URL(window.location.origin);
if (isInternalShellOrigin(current)) {
  const hinted = relayHintOrigins().find((value) => /^https?:\/\//i.test(String(value || '')));
  return hinted || 'http://127.0.0.1:9000';
}
if (current.protocol === 'http:' || current.protocol === 'https:') return current.origin;
} catch (error) {
/* noop */
}
return 'http://127.0.0.1:9000';
}
function isLocalRelayHostname(hostname = '') {
const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.localhost');
}
function relayHostnameFromInput(value = '') {
const hostish = String(value || '').trim().split(/[/?#]/)[0].toLowerCase();
if (hostish.startsWith('[')) return hostish.slice(1).split(']')[0] || '';
return hostish.split(':')[0] || '';
}
function normalizeRelayOrigin(raw = '', fallbackOrigin = defaultRelayFallbackOrigin()) {
const trimmed = String(raw || '').trim();
if (!trimmed || trimmed === 'file://' || trimmed === 'null') return fallbackOrigin;
/* The webview's own origin must never become the relay: normalized it would
   survive as a one-label host ("tauri") that only produces DNS failures. */
if (isInternalShellOrigin(trimmed)) return fallbackOrigin;
try {
const isLocal = isLocalRelayHostname(relayHostnameFromInput(trimmed)) || isPrivateIpv4(relayHostnameFromInput(trimmed));
const withScheme = /^https?:\/\//i.test(trimmed)
? trimmed
: `${isLocal ? 'http' : 'https'}://${trimmed}`;
const parsed = new URL(withScheme);
if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallbackOrigin;
/* "https://tauri://localhost" parses with host "tauri" — a single label that
   can only die in name resolution. A relay answers on a real name. */
const host = String(parsed.hostname || '').toLowerCase();
if (!host.includes('.') && !isLocalRelayHostname(host) && !isPrivateIpv4(host)) return fallbackOrigin;
// In PWA/HTTPS contexts, Safari/Chrome may block HTTP requests to local IPs.
// We keep the original protocol if provided, otherwise default based on locality.
return parsed.origin;
} catch (error) {
return fallbackOrigin;
}
}
function relayHintOrigins() {
const values = [];
const append = (value) => {
if (!value) return;
if (Array.isArray(value)) {
value.forEach(append);
return;
}
if (typeof value === 'object') {
append(value.origin || value.url || value.relayOrigin);
return;
}
values.push(String(value));
};
append(window.__POORIJA_RELAY_HINTS__);
append(window.__POORIJA_DEFAULT_RELAY_ORIGINS__);
document.querySelectorAll('meta[name="poorija-relay-origin"]').forEach((meta) => append(meta.getAttribute('content')));
return values;
}
/* What to put in the server box on a profile that has never had one.
 *
 * In a browser the page's own origin is right: the app is served BY the relay.
 * In the native shell it is catastrophically wrong — window.location.origin is
 * the webview's internal origin ('tauri://localhost' on macOS and iOS,
 * 'https://tauri.localhost' on Linux, 'http://tauri.localhost' on Windows), so
 * a fresh install pointed the chat at itself and simply never connected. That
 * is the whole of the "the Linux build will not reach the chat server" report:
 * nothing about Linux was broken except that it was the copy installed fresh.
 *
 * A build can carry its own answer through relay-hints.js, which is what the
 * distributed installers should ship. Failing that, leave it blank rather than
 * pre-filling a value that cannot work — an empty box asks a question, a wrong
 * one hides it. */
function defaultRelayOriginForShell() {
  const nativeShell = Boolean(window.PoorijaDesktop?.available);
  const internalOrigin = isInternalShellOrigin(window.location.href);
  /* The native shell ships with NO default relay at all: the suite is open
     source and self-hostable, so tying a fresh install to the developer's
     server would be wrong. Native starts with chat OFF and an explicit
     first-run question; the PWA keeps its origin, which IS the relay it was
     served from. */
  if (nativeShell || internalOrigin) return '';
  const hinted = relayHintOrigins().find((value) => /^https?:\/\//i.test(String(value || '')));
  if (window.location.protocol === 'file:') return hinted || 'http://127.0.0.1:9000';
  return window.location.origin;
}
/* ===================== چت امن: سوییچ اصلی و کانفیگ ===================== */
/* The master switch. OFF is a hard stop for everything relay-shaped: no
 * presence dial, no watchdog, no heartbeat, no reconnect timer, no
 * notifications. The rest of the suite — vault, files, stego, SSH — never
 * cared about the relay and keeps working exactly as before. */
function chatEnabled() {
  return Boolean(chatState.profile.chatEnabled) && isUsableRelayOrigin(chatState.profile.serverUrl);
}
function applyChatEnabled(on, { silent = false } = {}) {
  const wanted = Boolean(on);
  if (wanted && !isUsableRelayOrigin(chatState.profile.serverUrl)) {
    if (!silent) {
      notify(t('اول یک آدرس سرور معتبر وارد کنید یا فایل کانفیگ را ایمپورت کنید.', 'Enter a valid server address or import a config file first.'), 'warning');
    }
    return false;
  }
  chatState.profile.chatEnabled = wanted;
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  if (wanted) {
    chatState.manualOffline = false;
    chatState.shouldReconnect = true;
    connectChatTransport().catch(console.error);
  } else {
    /* Hard stop: every timer the transport owns goes away with it. */
    chatState.manualOffline = true;
    chatState.shouldReconnect = false;
    chatState.transportConnectQueued = false;
    clearReconnectTimer();
    clearPeerHealTimers();
    stopTransportWatchdog();
    if (chatState.heartbeatTimer) {
      clearInterval(chatState.heartbeatTimer);
      chatState.heartbeatTimer = null;
    }
    if (chatState.ws) {
      const dying = chatState.ws;
      chatState.ws = null;
      try { dying.close(); } catch (_error) { /* already gone */ }
    }
    if (chatState.peer && !chatState.peer.destroyed) {
      const deadPeer = chatState.peer;
      chatState.peer = null;
      chatState.peerId = '';
      try { deadPeer.destroy(); } catch (_error) { /* already gone */ }
    }
    chatState.connected = false;
    setConnectionState(false, t('چت امن خاموش است', 'Secure chat is off'));
  }
  renderStaticUi();
  return true;
}
/* First run on a native install: the messenger half starts OFF by design, so
 * the first visit to the chat asks once, in plain language, whether the user
 * wants a relay at all. "Later" means exactly that — the switch and this
 * question live in Settings and nothing dials until they are used. */
function maybeAskRelayOnboarding() {
  if (!window.PoorijaDesktop?.available) return;
  if (isUsableRelayOrigin(chatState.profile.serverUrl)) return;
  if (chatState.profile.chatEnabled) return;
  if (chatState.prefs?.relayOnboardAsked) return;
  chatState.prefs = chatState.prefs || {};
  chatState.prefs.relayOnboardAsked = true;
  saveChatPrefs();
  window.PoorijaDialogs?.choose(
    t('به یک سرور رله وصل شوید؟', 'Connect to a relay server?'),
    [
      { value: 'yes', label: t('بله، اتصال به سرور', 'Yes, set up a server'), hint: t('آدرس را دستی وارد می‌کنید، فایل کانفیگ را ایمپورت می‌کنید یا QR می‌خوانید.', 'You will enter an address, import a config file, or scan a QR.') },
      { value: 'no', label: t('فعال‌سازی بعداً', 'Maybe later'), hint: t('چت امن خاموش می‌ماند؛ هر زمان خواستید از تنظیمات چت روشنش کنید.', 'Secure chat stays off; turn it on any time from the chat settings.') },
    ],
    { title: t('چت امن', 'Secure Chat') }
  ).then((choice) => {
    if (choice === 'yes') {
      document.getElementById('chatConnectionPanel')?.classList.remove('hidden');
      document.getElementById('chatServerUrl')?.focus();
    }
  }).catch(() => { /* dialog queue closed */ });
}
/* ===================== فایل کانفیگ اتصال (خروجی/ایمپورت) ===================== */
/* The connection settings as one portable, password-encrypted file: the relay
 * origin, its presence/peer endpoints and the TURN block. It deliberately
 * carries no user secrets — no keys, no messages — but the TURN credential is
 * a shared server secret, so the file is always encrypted before it leaves
 * the machine. Same KDF and cipher as chat-history export. */
const RELAY_CONFIG_TYPE = 'poorija-relay-config';
function buildRelayConfigPayload() {
  const origin = chatServerOrigin();
  if (!isUsableRelayOrigin(origin)) return null;
  return {
    app: 'P00RIJA Cryptography',
    type: RELAY_CONFIG_TYPE,
    version: 1,
    label: 'relay',
    serverUrl: origin,
    presenceUrl: chatState.profile.presenceUrl || '',
    peerOrigin: chatState.profile.peerOrigin || '',
    turnUrl: chatState.profile.turnUrl || '',
    turnUsername: chatState.profile.turnUsername || '',
    turnCredential: chatState.profile.turnCredential || '',
  };
}
async function exportRelayConfigFile() {
  const payload = buildRelayConfigPayload();
  if (!payload) {
    notify(t('هنوز یک آدرس سرور معتبر ذخیره نشده است.', 'No valid server address is saved yet.'), 'warning');
    return;
  }
  let password = '';
  try {
    password = await window.PoorijaDialogs.prompt(
      t('رمز این فایل کانفیگ را تعیین کنید (گیرنده باید همان را وارد کند):', 'Set a password for this config file (the recipient must type the same one):'),
      { password: true }
    );
  } catch (_error) {
    return;
  }
  password = String(password || '');
  if (password.length < 4) {
    notify(t('رمز فایل کانفیگ حداقل ۴ نویسه باشد.', 'The config file password needs at least 4 characters.'), 'warning');
    return;
  }
  try {
    const salt = getrandom(16);
    const iv = getrandom(12);
    const key = await deriveExportKey(password, salt, CHAT_EXPORT_KDF_ITERATIONS);
    const plain = new TextEncoder().encode(JSON.stringify(payload));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    const envelope = {
      app: 'P00RIJA Cryptography',
      type: RELAY_CONFIG_TYPE + '-enc',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: CHAT_EXPORT_KDF_ITERATIONS, salt: bytesToBase64(salt) },
      cipher: { name: 'AES-GCM', iv: bytesToBase64(iv), data: bytesToBase64(cipher) },
      exportedAt: new Date().toISOString(),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `poorija-relay-${stamp}.p00rijaconf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    notify(t('کانفیگ اتصال رمزنگاری و ذخیره شد.', 'Connection config encrypted and saved.'), 'success');
  } catch (error) {
    console.error('Relay config export failed:', error);
    notify(t('خروجی کانفیگ ناموفق بود.', 'Config export failed.'), 'error');
  }
}
async function importRelayConfigFile(file) {
  let envelope;
  try {
    envelope = JSON.parse(await file.text());
  } catch (_error) {
    notify(t('فایل کانفیگ معتبر نیست.', 'That is not a valid config file.'), 'error');
    return;
  }
  if (envelope?.type !== RELAY_CONFIG_TYPE + '-enc' || !envelope.cipher?.data) {
    notify(t('فایل کانفیگ معتبر نیست.', 'That is not a valid config file.'), 'error');
    return;
  }
  let password = '';
  try {
    password = await window.PoorijaDialogs.prompt(
      t('رمز فایل کانفیگ:', 'Config file password:'),
      { password: true }
    );
  } catch (_error) {
    return;
  }
  let payload;
  try {
    const salt = base64ToBytes(String(envelope.kdf?.salt || ''));
    const iv = base64ToBytes(String(envelope.cipher.iv || ''));
    const key = await deriveExportKey(String(password || ''), salt, Number(envelope.kdf?.iterations) || CHAT_EXPORT_KDF_ITERATIONS);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      base64ToBytes(String(envelope.cipher.data))
    );
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch (_error) {
    notify(t('رمز اشتباه است یا فایل خراب شده.', 'Wrong password, or the file is corrupted.'), 'error');
    return;
  }
  if (payload?.type !== RELAY_CONFIG_TYPE || !isUsableRelayOrigin(payload.serverUrl)) {
    notify(t('فایل کانفیگ معتبر نیست.', 'That is not a valid config file.'), 'error');
    return;
  }
  /* Trust, then verify: dial the health endpoint before anything is saved, so
   * a mistyped password producing a plausible-looking file still cannot point
   * the app at a dead server. */
  const probe = await probeRelayOrigin(payload.serverUrl).catch(() => null);
  if (!probe) {
    notify(t('سرور داخل فایل پاسخ نداد؛ چیزی ذخیره نشد.', 'The server in the file did not answer; nothing was saved.'), 'error');
    return;
  }
  chatState.profile.serverUrl = probe.origin;
  chatState.profile.presenceUrl = String(payload.presenceUrl || probe.health?.presenceUrl || '');
  chatState.profile.peerOrigin = String(payload.peerOrigin || probe.health?.peerOrigin || probe.origin);
  chatState.profile.turnUrl = String(payload.turnUrl || chatState.profile.turnUrl || '');
  chatState.profile.turnUsername = String(payload.turnUsername || chatState.profile.turnUsername || '');
  chatState.profile.turnCredential = String(payload.turnCredential || chatState.profile.turnCredential || '');
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  notify(t(`کانفیگ اعمال شد: ${probe.origin}`, `Config applied: ${probe.origin}`), 'success');
  applyChatEnabled(true, { silent: true });
}
/* Small CSPRNG helper for the export salts/IVs — crypto.subtle needs raw
 * bytes and the page already guarantees a secure context here. */
function getrandom(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
/* ===================== پروفایل همراه (مهاجرت هویت) ===================== */
/* The whole chat identity in one password-encrypted file: the RSA keypair
 * (the fingerprint every contact trusts), the prekeys, the stable peer id,
 * the profile, the contacts and the group memberships. Importing it on
 * another device — native or PWA, either direction — makes that device BE
 * you: same fingerprint, same pinned trust, same groups. Conversation text
 * itself is not in here; the existing chat archive export covers history.
 * The file is always encrypted: whoever holds it and the password IS you. */
const PORTABLE_PROFILE_TYPE = 'poorija-portable-profile';
function buildPortableProfilePayload() {
  if (!chatState.identity?.publicKeyData || !chatState.identity?.privateKeyData) return null;
  /* Only a usable, currently-configured relay travels with the profile — a
   * poisoned or dead address in the source device must not infect the target. */
  const usableOrigin = isUsableRelayOrigin(chatState.profile.serverUrl) ? chatServerOrigin() : '';
  const sameOrigin = (value) => {
    if (!value || !usableOrigin) return '';
    try { return new URL(value).origin === new URL(usableOrigin).origin ? value : ''; } catch (_error) { return ''; }
  };
  const spaces = loadEncrypted(CHAT_SPACES_STORAGE_KEY, null);
  return {
    app: 'P00RIJA Cryptography',
    type: PORTABLE_PROFILE_TYPE,
    version: 1,
    identity: {
      publicKeyData: chatState.identity.publicKeyData,
      privateKeyData: chatState.identity.privateKeyData,
      fingerprint: chatState.identity.fingerprint || '',
      createdAt: chatState.identity.createdAt || '',
    },
    stablePeerId: chatState.profile.stablePeerId || '',
    profile: {
      name: chatState.profile.name || '',
      avatarData: chatState.profile.avatarData || '',
      mood: chatState.profile.mood || '',
      autoConnect: Boolean(chatState.profile.autoConnect),
      chatEnabled: Boolean(chatState.profile.chatEnabled) && Boolean(usableOrigin),
      serverUrl: usableOrigin,
      presenceUrl: sameOrigin(chatState.profile.presenceUrl),
      peerOrigin: sameOrigin(chatState.profile.peerOrigin),
      turnUrl: chatState.profile.turnUrl || '',
      turnUsername: chatState.profile.turnUsername || '',
      turnCredential: chatState.profile.turnCredential || '',
    },
    contacts: loadEncrypted(CHAT_CONTACTS_STORAGE_KEY, []),
    spaces: spaces && typeof spaces === 'object' ? spaces : { groups: [], channels: [] },
    prekeys: loadPrekeys(),
  };
}
async function exportPortableProfileFile() {
  const payload = buildPortableProfilePayload();
  if (!payload) {
    notify(t('هویت چت هنوز ساخته نشده است.', 'The chat identity has not been created yet.'), 'warning');
    return;
  }
  let password = '';
  try {
    password = await window.PoorijaDialogs.prompt(
      t('رمز فایل پروفایل همراه را تعیین کنید (حداقل ۶ نویسه — هر کس فایل و رمز را داشته باشد «شما»ست):', 'Set the portable profile password (min 6 characters — whoever holds the file and the password IS you):'),
      { password: true }
    );
  } catch (_error) {
    return;
  }
  password = String(password || '');
  if (password.length < 6) {
    notify(t('رمز پروفایل همراه حداقل ۶ نویسه باشد.', 'The portable profile password needs at least 6 characters.'), 'warning');
    return;
  }
  try {
    const salt = getrandom(16);
    const iv = getrandom(12);
    const key = await deriveExportKey(password, salt, CHAT_EXPORT_KDF_ITERATIONS);
    const plain = new TextEncoder().encode(JSON.stringify(payload));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    const envelope = {
      app: 'P00RIJA Cryptography',
      type: PORTABLE_PROFILE_TYPE + '-enc',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: CHAT_EXPORT_KDF_ITERATIONS, salt: bytesToBase64(salt) },
      cipher: { name: 'AES-GCM', iv: bytesToBase64(iv), data: bytesToBase64(cipher) },
      fingerprintHint: payload.identity.fingerprint.slice(0, 12),
      exportedAt: new Date().toISOString(),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `poorija-profile-${stamp}.p00rijaconf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    notify(t('پروفایل همراه رمزنگاری و ذخیره شد.', 'Portable profile encrypted and saved.'), 'success');
  } catch (error) {
    console.error('Portable profile export failed:', error);
    notify(t('خروجی پروفایل همراه ناموفق بود.', 'Portable profile export failed.'), 'error');
  }
}
async function importPortableProfileFile(file) {
  let envelope;
  try {
    envelope = JSON.parse(await file.text());
  } catch (_error) {
    notify(t('فایل پروفایل معتبر نیست.', 'That is not a valid profile file.'), 'error');
    return;
  }
  if (envelope?.type !== PORTABLE_PROFILE_TYPE + '-enc' || !envelope.cipher?.data) {
    notify(t('فایل پروفایل معتبر نیست.', 'That is not a valid profile file.'), 'error');
    return;
  }
  let password = '';
  try {
    password = await window.PoorijaDialogs.prompt(
      t('رمز فایل پروفایل همراه:', 'Portable profile password:'),
      { password: true }
    );
  } catch (_error) {
    return;
  }
  let payload;
  try {
    const salt = base64ToBytes(String(envelope.kdf?.salt || ''));
    const iv = base64ToBytes(String(envelope.cipher.iv || ''));
    const key = await deriveExportKey(String(password || ''), salt, Number(envelope.kdf?.iterations) || CHAT_EXPORT_KDF_ITERATIONS);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      base64ToBytes(String(envelope.cipher.data))
    );
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch (_error) {
    notify(t('رمز اشتباه است یا فایل خراب شده.', 'Wrong password, or the file is corrupted.'), 'error');
    return;
  }
  if (payload?.type !== PORTABLE_PROFILE_TYPE || !payload.identity?.publicKeyData || !payload.identity?.privateKeyData) {
    notify(t('فایل پروفایل معتبر نیست.', 'That is not a valid profile file.'), 'error');
    return;
  }
  const replacing = Boolean(chatState.identity?.fingerprint);
  const confirmText = replacing
    ? t('این کار هویت چت امنِ فعلی این دستگاه را با هویت داخل فایل جایگزین می‌کند. ادامه می‌دهید؟', 'This replaces this device\'s current secure-chat identity with the one inside the file. Continue?')
    : t('هویت داخل فایل روی این دستگاه فعال شود؟', 'Activate the identity inside the file on this device?');
  let choice = '';
  try {
    choice = await window.PoorijaDialogs.choose(confirmText, [
      { value: 'yes', label: replacing ? t('جایگزین کن', 'Replace') : t('فعال‌سازی', 'Activate') },
      { value: 'no', label: t('انصراف', 'Cancel') },
    ], { title: t('پروفایل همراه', 'Portable Profile') });
  } catch (_error) {
    return;
  }
  if (choice !== 'yes') return;
  /* Write the imported identity everywhere it lives, then adopt it live. */
  const identity = {
    publicKeyData: String(payload.identity.publicKeyData),
    privateKeyData: String(payload.identity.privateKeyData),
    fingerprint: String(payload.identity.fingerprint || ''),
    createdAt: String(payload.identity.createdAt || new Date().toISOString()),
  };
  chatState.identity = identity;
  saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, identity);
  const incomingProfile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
  chatState.profile = {
    ...chatState.profile,
    ...incomingProfile,
    stablePeerId: String(payload.stablePeerId || chatState.profile.stablePeerId || ''),
    avatarData: String(incomingProfile.avatarData || ''),
  };
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  saveEncrypted(CHAT_CONTACTS_STORAGE_KEY, contacts);
  chatState.peers = contacts.map((peer) => normalizePeerRecord(peer)).filter(Boolean);
  if (payload.spaces && typeof payload.spaces === 'object') {
    chatState.spaces = {
      groups: Array.isArray(payload.spaces.groups) ? payload.spaces.groups : [],
      channels: [],
    };
    saveEncrypted(CHAT_SPACES_STORAGE_KEY, chatState.spaces);
  }
  const prekeys = Array.isArray(payload.prekeys) ? payload.prekeys : [];
  chatState.prekeys = prunePrekeys(prekeys);
  savePrekeys(chatState.prekeys);
  chatState.p2pNoticeShown = false;
  chatState.reconnectAttempt = 0;
  renderStaticUi();
  renderPeers();
  renderActivePeer();
  notify(t(`هویت ${identity.fingerprint.slice(0, 12)}… روی این دستگاه فعال شد.`, `Identity ${identity.fingerprint.slice(0, 12)}… is now active on this device.`), 'success');
  /* The imported profile decides whether this device chats at all. */
  if (chatState.profile.chatEnabled && isUsableRelayOrigin(chatState.profile.serverUrl)) {
    applyChatEnabled(true, { silent: true });
  } else {
    chatState.profile.chatEnabled = false;
    setConnectionState(false, t('چت امن خاموش است', 'Secure chat is off'));
    renderStaticUi();
  }
}
function restrictionText(restriction = chatState.serverRestriction) {
if (!restriction) return '';
if (restriction.type === 'kicked') {
return t('شما محدود شده‌ اید.', 'You are restricted.');
}
const base = t('شما موقتاً تعلیق شده اید.', 'You are temporarily suspended.');
const details = [restrictionLocalUntilText(restriction), restrictionRemainingText(restriction)].filter(Boolean);
return details.length ? `${base} ${details.join(' ')}` : base;
}
function restrictionStatusLabel(restriction = chatState.serverRestriction) {
if (!restriction) return '';
if (restriction.type === 'suspended') return t('تعلیق موقت', 'Temporary suspension');
if (restriction.type === 'kicked') return t('محدود شده', 'Restricted');
return t('محدودیت سرور', 'Server restriction');
}
function notifyRestrictionOnce(message = restrictionText()) {
const text = String(message || restrictionText() || '').trim();
if (!text) return false;
const now = Date.now();
const active = chatState.serverRestriction;
const key = active
? `${active.type || 'restriction'}:${restrictionUntilMs(active) || ''}:${active.permanent ? 'permanent' : 'temporary'}`
: text;
if (chatState.lastRestrictionNoticeKey === key && now - Number(chatState.lastRestrictionNoticeAt || 0) < 5000) {
return false;
}
chatState.lastRestrictionNoticeKey = key;
chatState.lastRestrictionNoticeText = text;
chatState.lastRestrictionNoticeAt = now;
notify(text, 'warning');
return true;
}
function restrictionUntilMs(restriction = chatState.serverRestriction) {
if (!restriction?.until) return 0;
if (typeof restriction.until === 'number') return Number.isFinite(restriction.until) ? restriction.until : 0;
const parsed = Date.parse(restriction.until);
return Number.isFinite(parsed) ? parsed : 0;
}
function restrictionLocalUntilText(restriction = chatState.serverRestriction) {
if (!restriction?.until || restriction.permanent) return '';
const untilMs = restrictionUntilMs(restriction);
if (!Number.isFinite(untilMs) || untilMs <= 0) return '';
const locale = language() === 'fa' ? 'fa-IR' : undefined;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
let formatted = '';
try {
formatted = new Intl.DateTimeFormat(locale, {
dateStyle: 'medium',
timeStyle: 'short',
timeZone: timezone || undefined,
}).format(new Date(untilMs));
} catch (_) {
formatted = new Date(untilMs).toLocaleString(locale);
}
const suffix = timezone ? ` (${timezone})` : '';
return t(`پایان به وقت شما: ${formatted}${suffix}`, `Ends in your local time: ${formatted}${suffix}`);
}
function restrictionRemainingText(restriction = chatState.serverRestriction) {
if (chatState.profile.showSuspensionCountdown === false) return '';
if (!restriction?.until || restriction.permanent) return '';
const remainingMs = restrictionUntilMs(restriction) - Date.now();
if (!Number.isFinite(remainingMs) || remainingMs <= 0) return t('(زمان تعلیق تمام شده است.)', '(Suspension time has ended.)');
const totalSeconds = Math.ceil(remainingMs / 1000);
const days = Math.floor(totalSeconds / 86400);
const hours = Math.floor((totalSeconds % 86400) / 3600);
const minutes = Math.floor((totalSeconds % 3600) / 60);
const seconds = totalSeconds % 60;
const clock = days > 0
? `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
return t(`زمان باقی‌مانده: ${clock}`, `Remaining: ${clock}`);
}
function clearRestrictionTimers() {
if (chatState.serverRestrictionCountdownTimer) {
clearInterval(chatState.serverRestrictionCountdownTimer);
chatState.serverRestrictionCountdownTimer = null;
}
if (chatState.serverRestrictionProbeTimer) {
clearInterval(chatState.serverRestrictionProbeTimer);
chatState.serverRestrictionProbeTimer = null;
}
}
function renderRestrictionStatus() {
if (!chatState.serverRestriction) return;
const label = restrictionStatusLabel(chatState.serverRestriction);
const detail = restrictionText(chatState.serverRestriction);
setConnectionState(false, label);

// Force status dot to orange for temporary suspension and red for kicked users.
const dot = document.getElementById('chatConnectionDot');
if (dot) {
dot.classList.remove('online');
const suspended = chatState.serverRestriction?.type === 'suspended';
dot.style.background = suspended ? '#f59e0b' : '#ef4444';
dot.style.boxShadow = suspended
? '0 0 0 6px rgba(245, 158, 11, 0.16)'
: '0 0 0 6px rgba(239, 68, 68, 0.14)';
}

const restrictionBanner = document.getElementById('chatRestrictionBanner');
if (restrictionBanner) {
restrictionBanner.textContent = detail;
restrictionBanner.classList.remove('hidden');
}
}
async function probeServerRestrictionLifted({ silent = true, reconnect = true } = {}) {
const restriction = chatState.serverRestriction;
if (!restriction) return false;
try {
const response = await fetch(`${chatServerOrigin()}/chat-health?_t=${Date.now()}`, {
cache: 'no-store',
headers: restrictionHeaders(),
});
if (response.status === 403) {
await restrictedResponseToState(response, { notifyUser: false, restartProbe: false });
return false;
}
if (!response.ok) return false;
setServerRestriction(null);
chatState.shouldReconnect = true;
if (!silent) notify(t('محدودیت سرور برداشته شد. اتصال دوباره برقرار می‌شود.', 'Server restriction was lifted. Reconnecting.'), 'success');
if (reconnect) setTimeout(() => connectChatTransport().catch(console.error), 500);
return true;
} catch (error) {
console.warn('Restriction lift probe failed:', error);
return false;
}
}
function startRestrictionWatchers(restriction) {
clearRestrictionTimers();
renderRestrictionStatus();
chatState.serverRestrictionCountdownTimer = setInterval(() => {
if (!chatState.serverRestriction) {
clearRestrictionTimers();
return;
}
if (!hasActiveServerRestriction()) {
setServerRestriction(null);
if (chatState.profile.autoConnect) connectChatTransport().catch(console.error);
return;
}
renderRestrictionStatus();
}, 1000);
const probeMs = restriction?.permanent ? 15000 : 10000;
chatState.serverRestrictionProbeTimer = setInterval(() => {
probeServerRestrictionLifted({ silent: true }).catch(console.error);
}, probeMs);
}
function hasActiveServerRestriction() {
const restriction = chatState.serverRestriction;
if (!restriction) return false;
const untilMs = restrictionUntilMs(restriction);
if (!restriction.permanent && restriction.until && (!untilMs || Date.now() > untilMs)) {
setServerRestriction(null);
return false;
}
return true;
}
let _serverRestrictionTimer = null;
function setServerRestriction(restriction = null) {
if (_serverRestrictionTimer) {
clearTimeout(_serverRestrictionTimer);
_serverRestrictionTimer = null;
}
chatState.serverRestriction = restriction;
if (restriction) {
if (!restriction.permanent && restriction.until) {
const remaining = restrictionUntilMs(restriction) - Date.now();
if (remaining > 0) {
_serverRestrictionTimer = setTimeout(() => {
setServerRestriction(null);
if (chatState.profile.autoConnect) connectChatTransport();
}, remaining + 1000);
} else {
chatState.serverRestriction = null;
if (chatState.profile.autoConnect) setTimeout(connectChatTransport, 1000);
return;
}
}
chatState.shouldReconnect = false;
clearReconnectTimer();
startRestrictionWatchers(restriction);
} else if (!chatState.connected) {
clearRestrictionTimers();
setConnectionState(false, t('آفلاین', 'Offline'));
} else {
clearRestrictionTimers();
}
renderStaticUi();
renderPeers();
renderActivePeer();
}
function isStaticDevAppOrigin(origin = chatServerOrigin()) {
try {
const candidate = new URL(origin, window.location.origin);
const appOrigin = new URL(window.location.origin);
const devPorts = new Set(['3000', '4173', '4174', '5173', '5174', '8080']);
return candidate.origin === appOrigin.origin
&& devPorts.has(candidate.port || appOrigin.port || '')
&& !chatState.profile.presenceUrl
&& !chatState.profile.peerOrigin;
} catch (_error) {
return false;
}
}
function restrictionHeaders() {
const headers = {
'X-P00RIJA-Fingerprint': chatState.identity?.fingerprint || '',
'X-P00RIJA-Peer-Id': chatState.peerId || chatState.profile.stablePeerId || '',
'X-P00RIJA-Client-Id': chatState.clientId || '',
'X-P00RIJA-Username': chatState.profile.name || '',
};
const encoded = {};
Object.entries(headers).forEach(([key, val]) => {
try {
// Use a safe ASCII-only encoding for headers to avoid browser blocks
encoded[key] = btoa(unescape(encodeURIComponent(String(val))));
} catch (e) {
encoded[key] = '';
}
});
return encoded;
}
async function restrictedResponseToState(response, { notifyUser = true, restartProbe = true } = {}) {
if (!response || response.status !== 403) return false;
const data = await response.json().catch(() => ({}));
if (!data?.restricted) return false;
setServerRestriction({
type: data.restrictionType || 'restricted',
message: data.message || t('اتصال شما با این سرور محدود شده است، لطفاً با ادمین تماس بگیرید.', 'Your connection to this server is restricted. Contact the admin.'),
until: data.until || null,
permanent: Boolean(data.permanent),
});
if (!restartProbe && chatState.serverRestriction) renderRestrictionStatus();
if (notifyUser) notifyRestrictionOnce();
return true;
}
function wsUrl() {
const appendIdentityParams = (rawUrl) => {
try {
const url = new URL(rawUrl, window.location.origin);
const identity = chatState.identity || {};
if (identity.fingerprint) url.searchParams.set('fingerprint', identity.fingerprint);
const peerId = chatState.peerId || chatState.profile.stablePeerId || '';
if (peerId) url.searchParams.set('peerId', peerId);
if (chatState.clientId) url.searchParams.set('clientId', chatState.clientId);
if (chatState.profile.name) url.searchParams.set('username', chatState.profile.name);
return url.toString();
} catch (_error) {
return rawUrl;
}
};
const origin = new URL(chatServerOrigin());
const protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
/* A cached presence endpoint is honored only while it belongs to the server
 * the user actually has configured. An endpoint saved under an older setup
 * must never outlive the address in the box — this exact mismatch is what let
 * a build show "connected" while its own server box pointed at a dead local
 * address. */
if (chatState.profile.presenceUrl) {
try {
if (new URL(chatState.profile.presenceUrl).origin === origin.origin) {
return appendIdentityParams(String(chatState.profile.presenceUrl));
}
} catch (_error) {
/* malformed cache — fall through and derive */
}
}
return appendIdentityParams(`${protocol}//${origin.host}/chat-signal`);
}
function peerTransportOrigin() {
const expected = chatServerOrigin();
const configured = String(chatState.profile.peerOrigin || '').trim();
if (configured) {
try {
const origin = new URL(configured, window.location.origin).origin;
/* Same rule as the presence endpoint: a cached peer origin from another
   setup never speaks for the server currently in the box. */
if (origin === new URL(expected).origin) return origin;
} catch (_error) {
/* noop */
}
}
return expected;
}
function normalizeIceServerUrls(value = '') {
if (Array.isArray(value)) {
return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}
return String(value || '')
.split(/[,\n\r]+/)
.map((entry) => entry.trim())
.filter(Boolean);
}
function formatIceServerUrlsForInput(value = '') {
return normalizeIceServerUrls(value).join(',');
}
/* Public STUN servers are third parties, and a STUN binding request tells them
   this device's public address and that a call is starting right now. Google's
   and Twilio's used to be in this list unconditionally — on every call, even
   for someone running their own relay and TURN precisely so that nothing else
   would see their traffic.

   The list is now built the other way round: your own TURN first, and the
   public servers only as the fallback for someone who has not configured one,
   because without any STUN a call across two NATs simply will not connect. The
   toggle in Connection settings forces it either way. */
const PUBLIC_STUN_SERVERS = [
{ urls: 'stun:stun.l.google.com:19302' },
{ urls: 'stun:global.stun.twilio.com:3478' },
];
function shouldUsePublicStun(turnUrlCount) {
const preference = chatState.profile.publicStun;
if (preference === true || preference === false) return preference;
return turnUrlCount === 0;
}
function peerOptions() {
const origin = new URL(peerTransportOrigin());
const iceServers = [];
const configuredUrls = normalizeIceServerUrls(chatState.profile.turnUrl);
/* A turn: or turns: entry without BOTH a username and a credential does not
   merely fail to relay — Chrome refuses to construct the RTCPeerConnection at
   all, so the peer object never comes up and nothing connects, P2P calls and
   file transfers included. The relay hands out a TURN URL with an empty
   password whenever CHAT_TURN_CREDENTIAL is unset, which is easy to do, so the
   incomplete entry is dropped here rather than passed on. Any stun: URLs in
   the same list need no credentials and are kept. */
const turnUsername = chatState.profile.turnUsername || '';
const turnCredential = chatState.profile.turnCredential || '';
const stunUrls = configuredUrls.filter((url) => /^stuns?:/i.test(url));
const turnUrls = configuredUrls.filter((url) => /^turns?:/i.test(url));
const turnUsable = turnUrls.length > 0 && Boolean(turnUsername) && Boolean(turnCredential);
if (turnUsable) {
iceServers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });
} else if (turnUrls.length) {
console.warn('[Chat] the TURN server was ignored: it needs both a username and a credential.');
}
if (stunUrls.length) iceServers.push({ urls: stunUrls });
if (shouldUsePublicStun(turnUsable ? turnUrls.length : 0)) {
iceServers.push(...PUBLIC_STUN_SERVERS);
}
return {
host: origin.hostname,
port: origin.port || (origin.protocol === 'https:' ? '443' : '80'),
path: '/peerjs',
secure: origin.protocol === 'https:',
debug: 1,
config: {
iceServers,
/* Everything below was left at the browser default until now, which for a
   call means the slowest of the standard paths.

   max-bundle puts audio, video and data on ONE transport instead of one per
   media section. That is one ICE negotiation rather than three, one set of
   candidates to gather and one hole to punch — faster to connect, and far
   likelier to connect at all through a restrictive NAT, because the firewall
   only has to permit a single flow. The fallback when a peer cannot bundle is
   part of the spec, so an old client still connects.

   rtcpMuxPolicy require goes with it: RTP and RTCP share the one port rather
   than asking for a second. Every engine this app runs on has muxed for years;
   what the default buys is compatibility with endpoints that are not in play
   here, at the cost of another candidate to gather.

   iceCandidatePoolSize starts gathering before there is anything to offer, so
   the candidates are ready when the call is placed instead of being collected
   while the other person's phone is already ringing. Two is the usual figure —
   it covers the host and reflexive candidates without holding TURN
   allocations open for calls that never happen. */
bundlePolicy: 'max-bundle',
rtcpMuxPolicy: 'require',
iceCandidatePoolSize: 2,
},
};
}
function isPrivateIpv4(hostname) {
const match = String(hostname || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
if (!match) return false;
const [first, second] = [Number(match[1]), Number(match[2])];
return first === 10
|| (first === 172 && second >= 16 && second <= 31)
|| (first === 192 && second === 168);
}
async function fetchRelayJson(url, timeoutMs = 2500) {
const controller = new AbortController();
const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
const isHttpsApp = window.location.protocol === 'https:';
const targetUrl = new URL(url);

// Browsers block HTTP from HTTPS unless the target is a local IP.
if (isHttpsApp && targetUrl.protocol === 'http:' && !isLocalRelayHostname(targetUrl.hostname) && !isPrivateIpv4(targetUrl.hostname)) {
console.log(`[Fetch] Skipping insecure HTTP request from HTTPS origin to avoid block: ${url}`);
return { ok: false, status: 0, statusText: 'Blocked (Mixed Content)' };
}

console.log(`[Fetch] Requesting: ${url}`);
try {
const response = await fetch(url, {
mode: 'cors',
cache: 'no-store',
headers: restrictionHeaders(),
signal: controller.signal,
});
console.log(`[Fetch] Response from ${url}: ${response.status} ${response.statusText}`);
return response;
} catch (error) {
if (error.name === 'AbortError') {
console.log(`[Fetch] Timeout (${timeoutMs}ms) for ${url}`);
} else {
console.log(`[Fetch] Error for ${url}:`, error.message || error);
}
return { ok: false, status: 0, statusText: error.name || 'Error' };
} finally {
clearTimeout(timeout);
}
}
/* The missing half of the relay probe.
 *
 * probeRelayOrigin() has always fallen back to this when its own fetch throws,
 * but the function was never written: every failed probe raised
 * "probeRelayOriginNatively is not defined" instead of returning null, and the
 * discovery loop died on the first candidate that was not listening — which is
 * most of them, since it walks a list of guesses.
 *
 * In the native shell the fallback is real work, not just a null: the page is
 * served from tauri://localhost, so a plain-http relay on the LAN is mixed
 * content and the webview refuses the request before it leaves the process.
 * Rust is not bound by the page's origin, so desktop_probe_relay_origin can
 * reach it. In a browser there is nothing to fall back to, and null correctly
 * means "this origin is not a relay we can use".
 */
async function probeRelayOriginNatively(origin) {
const desktop = window.PoorijaDesktop;
if (!desktop?.available) return null;
try {
const result = await desktop.probeRelayOrigin(origin);
if (!result?.origin || !result?.health) return null;
console.log(`[Discovery] Native probe found a relay at ${result.origin}`);
return {
origin: result.origin,
health: result.health,
turnConfig: result.turnConfig || null
};
} catch (error) {
console.log(`[Discovery] Native probe failed for ${origin}:`, error?.message || error);
return null;
}
}
async function probeRelayOrigin(origin) {
const normalizedOrigin = normalizeRelayOrigin(origin);
console.log(`[Discovery] Probing: ${normalizedOrigin}`);
try {
const healthUrl = new URL('/chat-health', normalizedOrigin);
const healthResponse = await fetchRelayJson(healthUrl, 4000);
if (!healthResponse.ok && healthResponse.status === 0) return null; // Blocked or failed
if (await restrictedResponseToState(healthResponse)) {
console.warn(`[Discovery] Access restricted for ${normalizedOrigin}`);
return null;
}
if (!healthResponse.ok) {
console.log(`[Discovery] Health check failed for ${normalizedOrigin} (Status: ${healthResponse.status})`);
return null;
}
const health = await healthResponse.json();
if (!health?.ok || !String(health.service || '').includes('poorija-chat-signal')) {
console.log(`[Discovery] Invalid service at ${normalizedOrigin}`);
return null;
}
console.log(`[Discovery] Found Poorija Relay at ${normalizedOrigin}`);
let turnConfig = null;
try {
const turnUrl = new URL('/turn-config', normalizedOrigin);
const turnResponse = await fetchRelayJson(turnUrl, 4000);
if (turnResponse.ok) {
turnConfig = await turnResponse.json();
console.log(`[Discovery] TURN configuration loaded from ${normalizedOrigin}`);
} else {
console.log(`[Discovery] TURN config endpoint failed for ${normalizedOrigin} (Status: ${turnResponse.status})`);
}
} catch (error) {
console.log(`[Discovery] TURN config fetch failed for ${normalizedOrigin}:`, error.message);
const nativeResult = await probeRelayOriginNatively(normalizedOrigin);
if (nativeResult?.turnConfig) return nativeResult;
}
return { origin: normalizedOrigin, health, turnConfig };
} catch (error) {
console.log(`[Discovery] Probe failed for ${normalizedOrigin}:`, error.message);
return probeRelayOriginNatively(normalizedOrigin);
}
}
function localDiscoveryCandidates(fullScan = false) {
const origins = [];
const fallbackOrigin = defaultRelayFallbackOrigin();
const appProtocol = window.location.protocol;

const seedInputs = [
chatState.profile.serverUrl,
...relayHintOrigins(),
fallbackOrigin,
window.location.origin,
];

const pushOrigin = (host, port, protocol) => {
if (!host || !protocol) return;
const origin = `${protocol}//${host}${port ? `:${port}` : ''}`;
if (!origins.includes(origin)) origins.push(origin);
};

const expandSeed = (rawSeed) => {
const normalized = normalizeRelayOrigin(rawSeed, fallbackOrigin);
let seedOrigin;
try {
seedOrigin = new URL(normalized);
} catch (_error) {
return;
}
const hostname = seedOrigin.hostname;
const isLocal = isLocalRelayHostname(hostname) || isPrivateIpv4(hostname);

// Force HTTPS if app is HTTPS, unless the target is a local IP.
const protocols = [appProtocol];
if (isLocal && appProtocol === 'https:') protocols.push('http:');

const ports = Array.from(new Set([
seedOrigin.port,
'9000',
'8585',
isLocal ? '80' : '',
'443',
])).filter(Boolean);

protocols.forEach((protocol) => {
ports.forEach((port) => {
if (protocol === 'https:' && port === '80') return;
if (protocol === 'http:' && port === '443' && !isLocal) return;
pushOrigin(hostname, port, protocol);
});
});

if (isLocal) {
['127.0.0.1', 'localhost'].forEach((host) => {
protocols.forEach((protocol) => {
ports.forEach((port) => pushOrigin(host, port, protocol));
});
});
}
};

seedInputs.filter(Boolean).forEach(expandSeed);
return origins;
}
async function discoverLocalRelayServer({ fullScan = false, silent = false, allowOverwrite = false } = {}) {
if (hasActiveServerRestriction()) {
if (!silent) notifyRestrictionOnce();
return null;
}
/* Silent auto-discovery runs on every connect. It exists to fill a blank, and
 * must never override an address the user has configured and can reach: on a
 * machine with any relay-like service on localhost (a leftover dev relay,
 * another self-hosted install) the scan finds it and — unchecked — it used to
 * stomp the configured address with its own. The explicit «کشف محلی» button
 * stays allowed to overwrite: there the user asked for it. */
if (silent && !allowOverwrite && isUsableRelayOrigin(chatState.profile.serverUrl)) {
return null;
}
const candidates = localDiscoveryCandidates(fullScan);
for (const origin of candidates) {
const result = await probeRelayOrigin(origin);
if (!result) continue;
chatState.profile.serverUrl = result.origin;
chatState.profile.presenceUrl = String(result.health?.presenceUrl || chatState.profile.presenceUrl || '');
chatState.profile.peerOrigin = String(result.health?.peerOrigin || chatState.profile.peerOrigin || result.origin);
if (result.turnConfig?.enabled && result.turnConfig?.urls) {
chatState.profile.turnUrl = formatIceServerUrlsForInput(result.turnConfig.urls || '');
chatState.profile.turnUsername = String(result.turnConfig.username || '');
chatState.profile.turnCredential = String(result.turnConfig.credential || '');
}
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderStaticUi();
if (!silent) {
notify(t(`سرور محلی پیدا شد: ${result.origin}`, `Local relay discovered: ${result.origin}`), 'success');
}
return result;
}
if (!silent) {
notify(t('سرور محلی پیدا نشد.', 'No local relay server was discovered.'), 'warning');
}
return null;
}
async function hydrateRelayTurnConfig() {
if (hasActiveServerRestriction()) return;
const needsTurn = !chatState.profile.turnUrl || !chatState.profile.turnUsername || !chatState.profile.turnCredential;
const needsPresence = !chatState.profile.presenceUrl;
const needsPeerOrigin = !chatState.profile.peerOrigin;
if (!needsTurn && !needsPresence && !needsPeerOrigin) return;
if (isStaticDevAppOrigin() && !window.__POORIJA_DESKTOP__) return;
try {
const result = await probeRelayOrigin(chatServerOrigin());
if (result) {
applyRelayDiscoveryResult(result);
}
} catch (error) {
console.warn('Relay config hydration failed:', error);
}
}
function applyRelayDiscoveryResult(result) {
if (!result?.origin || !result?.health) return false;
console.log(`[Discovery] Applying results from ${result.origin}`);
chatState.profile.serverUrl = result.origin;
chatState.profile.presenceUrl = String(result.health?.presenceUrl || chatState.profile.presenceUrl || '');
chatState.profile.peerOrigin = String(result.health?.peerOrigin || chatState.profile.peerOrigin || result.origin);
if (result.turnConfig) {
const turn = result.turnConfig;
if (turn.urls) {
chatState.profile.turnUrl = formatIceServerUrlsForInput(turn.urls || '');
chatState.profile.turnUsername = String(turn.username || '');
chatState.profile.turnCredential = String(turn.credential || '');
console.log('[Discovery] TURN fields populated successfully.');
} else {
console.warn('[Discovery] TURN config received but no URLs found.');
}
} else {
console.warn('[Discovery] No TURN configuration received from relay.');
}
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderStaticUi();
return Boolean(chatState.profile.presenceUrl || chatState.profile.peerOrigin);
}
async function ensureRelayTransportReady() {
if (hasActiveServerRestriction()) {
notifyRestrictionOnce();
return false;
}
/* The cached presence/peer pair counts as ready only while it belongs to the
 * server currently configured. Trusting a pair saved under an older setup is
 * what produced "connected to the relay" while the server box pointed at a
 * dead local address. */
const cachedEndpointsUsable = (() => {
if (!chatState.profile.presenceUrl || !chatState.profile.peerOrigin) return false;
try {
return new URL(chatState.profile.presenceUrl).origin === new URL(chatServerOrigin()).origin;
} catch (_error) {
return false;
}
})();
if (cachedEndpointsUsable) return true;
if (!isStaticDevAppOrigin() || window.__POORIJA_DESKTOP__) {
const result = await probeRelayOrigin(chatServerOrigin());
if (applyRelayDiscoveryResult(result)) return true;
}
// If configured server fails, try automatic discovery
const discoveryResult = await discoverLocalRelayServer({ fullScan: false, silent: true });
if (discoveryResult) return true;

chatState.shouldReconnect = false;
setConnectionState(false, t('سرور رله تنظیم نشده', 'Relay server is not configured'));
notify(
t('برای چت و تماس، آدرس رله/TURN معتبر وارد کنید یا دکمه کشف محلی را بزنید.', 'Enter a valid relay/TURN server or use local discovery before starting chat/calls.'),
'warning'
);
renderStaticUi();
return false;
}
function registerChatPush(promptForAccess = false) {
const fingerprint = chatState.identity?.fingerprint;
if (!fingerprint) return Promise.resolve({ ok: false, reason: 'missing-fingerprint' });
return app()?.registerWebPushSubscription?.(fingerprint, chatServerOrigin(), promptForAccess)
|| Promise.resolve({ ok: false, reason: 'unsupported' });
}
/* The same identity must produce the same card every time it is asked for.
 *
 * `createdAt` used to be `new Date()` evaluated at call time, so every render
 * produced a different string: the QR changed on each open and on each redraw,
 * a photograph taken a second ago no longer matched what was on screen, and
 * the payload was needlessly larger for a field the reader never uses —
 * parseIdentityText only looks at peerId and the key.
 *
 * It is kept, because a card that says when it was made is useful to a person
 * reading it, but it is stamped once for the identity rather than once per
 * call. chatState.profile carries it so it survives a reload; failing that it
 * is frozen for the session. */
function identityCreatedAt() {
  if (chatState.profile && !chatState.profile.identityCreatedAt) {
    chatState.profile.identityCreatedAt = new Date().toISOString();
    try { saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile); }
    catch (error) { /* the session-lifetime value below still holds */ }
  }
  if (!identityCreatedAt.fallback) identityCreatedAt.fallback = new Date().toISOString();
  return chatState.profile?.identityCreatedAt || identityCreatedAt.fallback;
}

function identityPayload() {
return {
app: 'P00RIJA Cryptography',
type: 'poorija-chat-identity',
version: 1,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId || chatState.profile.stablePeerId || chatState.clientId || '',
fingerprint: chatState.identity?.fingerprint || '',
publicKeyData: chatState.identity?.publicKeyData || '',
createdAt: identityCreatedAt(),
};
}
function utf8_to_b64(str) {
return window.btoa(unescape(encodeURIComponent(str)));
}
function b64_to_utf8(str) {
return decodeURIComponent(escape(window.atob(str)));
}
function identityText() {
return 'poorija-chat-v1:' + utf8_to_b64(JSON.stringify(identityPayload()));
}

/* The same identity, sized for a camera.
 *
 * A QR has a hard size limit and the clipboard does not, so the two should not
 * carry the same bytes. Measured on a real identity, with a real RSA key:
 *
 *     v1, as pasted        1148 chars   129 modules
 *     v3, for the camera    700 chars    97 modules
 *
 * and 129 modules is why a phone struggled with this code while the Local Link
 * one at 93 read fine.
 *
 * The saving is not compression. v1 base64-encodes a JSON document that itself
 * contains a base64 public key, so the key is encoded TWICE — 423 bytes become
 * 564 characters become 752. Encoding the fields as bytes and base64-ing the
 * result once removes that, and it beats deflating the JSON (808 chars) while
 * needing no decompressor at all: parseIdentityText stays synchronous, which
 * matters because a dozen callers treat it as a pure parse.
 *
 * identityText above is untouched, so anything copied, pasted or exported is
 * byte-for-byte what it always was and every build can still read it. Only the
 * QR is compact, and parseIdentityText understands both. */
const IDENTITY_QR_PREFIX = 'poorija-chat-v3:';

function identityQrText() {
  try {
    const full = identityPayload();
    const encoder = new TextEncoder();
    const fields = [
      encoder.encode(String(full.name || '')),
      encoder.encode(String(full.peerId || '')),
      hexToBytes(full.fingerprint || ''),
      base64ToBytes(full.publicKeyData || ''),
      encoder.encode(String(full.createdAt || '')),
    ];
    let total = 0;
    fields.forEach((field) => { total += 2 + field.length; });
    const out = new Uint8Array(total);
    let at = 0;
    for (const field of fields) {
      /* Two-byte big-endian length: an RSA-4096 key is over 512 bytes, so one
         byte would silently truncate exactly the field that matters most. */
      out[at] = (field.length >> 8) & 0xff;
      out[at + 1] = field.length & 0xff;
      out.set(field, at + 2);
      at += 2 + field.length;
    }
    let binary = '';
    out.forEach((byte) => { binary += String.fromCharCode(byte); });
    const packed = IDENTITY_QR_PREFIX + window.btoa(binary);
    /* Only if it is actually smaller. An identity with a short key could come
       out longer this way, and a bigger code is the problem, not the fix. */
    return packed.length < identityText().length ? packed : identityText();
  } catch (error) {
    return identityText();
  }
}

function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
    /* base64ToBytes / bytesToBase64 live in js/chat/02-media-vault.js and are
       global to this payload. The copies that stood here silently replaced
       them for every earlier file — see the note there. */

function parseIdentityQrText(packed) {
  try {
    const bytes = base64ToBytes(String(packed).slice(IDENTITY_QR_PREFIX.length));
    const decoder = new TextDecoder();
    const fields = [];
    let at = 0;
    while (at + 2 <= bytes.length && fields.length < 5) {
      const length = (bytes[at] << 8) | bytes[at + 1];
      if (at + 2 + length > bytes.length) return null;
      fields.push(bytes.subarray(at + 2, at + 2 + length));
      at += 2 + length;
    }
    if (fields.length < 4) return null;
    return JSON.stringify({
      app: 'P00RIJA Cryptography',
      type: 'poorija-chat-identity',
      version: 1,
      name: decoder.decode(fields[0]),
      peerId: decoder.decode(fields[1]),
      fingerprint: bytesToHex(fields[2]),
      publicKeyData: bytesToBase64(fields[3]),
      createdAt: fields[4] ? decoder.decode(fields[4]) : '',
    });
  } catch (error) {
    return null;
  }
}

function parseIdentityText(raw = '') {
let text = String(raw || '').trim();
if (!text) return null;
if (text.startsWith('poorija-chat-v1:')) {
try {
text = b64_to_utf8(text.substring(16));
} catch (_e) {}
}
/* v3 is the camera-sized card: the same identity with its fields as bytes,
   base64-encoded once instead of twice. Synchronous, so this function keeps
   the signature every caller already treats as a pure parse. */
if (text.startsWith(IDENTITY_QR_PREFIX)) {
const expanded = parseIdentityQrText(text);
if (expanded) text = expanded;
}
try {
const parsed = JSON.parse(text);
if (parsed?.peerId && (parsed.fingerprint || parsed.publicKeyData)) return parsed;
} catch (_error) {}
const peerMatch = text.match(/Peer:\s*"?([^"\n]+)"?/i) || text.match(/peerId["\s:]+([^",\n]+)/i);
const keyMatch = text.match(/Security Key:\s*"?([^"\n]+)"?/i) || text.match(/fingerprint["\s:]+([^",\n]+)/i);
const nameMatch = text.match(/Name of User:\s*"?([^"\n]+)"?/i) || text.match(/name["\s:]+([^",\n]+)/i);
if (!peerMatch && !keyMatch) return null;
return {
type: 'poorija-chat-identity',
name: nameMatch?.[1]?.trim() || '',
peerId: peerMatch?.[1]?.trim() || '',
fingerprint: keyMatch?.[1]?.trim() || '',
publicKeyData: '',
};
}
function generateId(prefix) {
/* Math.random is predictable: its output can be reconstructed from a few
   samples, and these ids name messages, transfers and peer registrations.
   Eight bytes from the platform CSPRNG, hex-encoded, keeps the same
   `prefix-<digits>-<random>` shape every reader already expects. */
const bytes = new Uint8Array(8);
crypto.getRandomValues(bytes);
const random = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
return `${prefix}-${Date.now()}-${random}`;
}
function getConversationKey(record) {
if (!record) return '';
if (record.conversationId) return record.conversationId;
return record.fingerprint || record.peerId || record.clientId || '';
}
function isSelfPeerRecord(record) {
if (!record) return false;
return Boolean(
(record.clientId && record.clientId === chatState.clientId)
|| (record.peerId && record.peerId === chatState.peerId)
|| (record.fingerprint && chatState.identity?.fingerprint && record.fingerprint === chatState.identity.fingerprint)
);
}
function getPeerHistoryKey(peerRecord, session = null) {
if (peerRecord) return getConversationKey(peerRecord);
return session?.conversationId || session?.remoteFingerprint || session?.peerId || '';
}
function findPeerByConversationKey(conversationId) {
if (!conversationId) return null;
return chatState.peers.find((peer) => (
getConversationKey(peer) === conversationId
|| peer.peerId === conversationId
|| peer.fingerprint === conversationId
|| peer.clientId === conversationId
)) || null;
}
function buildProfileDraft() {
/* The shell's hinted relay (or nothing), never the webview's internal origin —
   in the browser this is the page origin, which is right there. */
const defaultServerUrl = defaultRelayOriginForShell();
return {
name: document.getElementById('chatProfileName')?.value.trim() || chatState.profile.name,
serverUrl: document.getElementById('chatServerUrl')?.value.trim() || chatState.profile.serverUrl || defaultServerUrl,
autoConnect: Boolean(document.getElementById('chatAutoConnect')?.checked),
allowVideo: Boolean(document.getElementById('chatAllowVideo')?.checked),
autoDiscovery: Boolean(document.getElementById('chatAutoDiscovery')?.checked),
showSuspensionCountdown: Boolean(document.getElementById('chatShowSuspensionCountdown')?.checked),
avatarData: chatState.profile.avatarData || '',
/* Your own words for what you are doing — "busy", "on shift", anything. It
   rides with the profile and goes out with hello, so contacts see it beside
   your name in their chat header. */
mood: String(chatState.profile.mood || '').slice(0, 40),
presenceUrl: chatState.profile.presenceUrl || '',
peerOrigin: chatState.profile.peerOrigin || '',
stablePeerId: chatState.profile.stablePeerId || generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-'),
turnUrl: document.getElementById('chatTurnUrl')?.value.trim() || '',
turnUsername: document.getElementById('chatTurnUsername')?.value.trim() || '',
turnCredential: document.getElementById('chatTurnCredential')?.value || '',
publicStun: document.getElementById('chatPublicStun')?.checked ?? chatState.profile.publicStun ?? null,
ringtoneId: document.getElementById('chatRingtoneSelect')?.value || chatState.profile.ringtoneId || 'classic',
messageToneId: document.getElementById('chatMessageToneSelect')?.value || chatState.profile.messageToneId || 'chime',
};
}
function syncProfileDraftFromInputs() {
const draft = buildProfileDraft();
const serverUrlChanged = draft.serverUrl !== chatState.profile.serverUrl;
chatState.profile = {
...chatState.profile,
...draft,
};
if (serverUrlChanged && chatState.profile.serverUrl) {
hydrateRelayTurnConfig().catch(console.error);
}
}
function syncChatToggleStates() {
const toggleMeta = {
chatAutoConnect: ['اتصال خودکار روشن است', 'Auto connect is on', 'اتصال خودکار خاموش است', 'Auto connect is off'],
chatAllowVideo: ['تماس تصویری فعال است', 'Video calls are on', 'تماس تصویری غیرفعال است', 'Video calls are off'],
chatAutoDiscovery: ['دیسکاوری محلی فعال است', 'Local discovery is on', 'دیسکاوری محلی غیرفعال است', 'Local discovery is off'],
chatShowSuspensionCountdown: ['شمارش معکوس تعلیق روشن است', 'Suspension countdown is on', 'شمارش معکوس تعلیق خاموش است', 'Suspension countdown is off'],
chatPublicStun: ['STUN عمومی روشن است — آی‌پی شما به گوگل/توییلیو دیده می‌شود', 'Public STUN is on — Google/Twilio see your address', 'فقط رله و TURN خودتان استفاده می‌شود', 'Only your own relay and TURN are used'],
};
Object.entries(toggleMeta).forEach(([id, labels]) => {
const input = document.getElementById(id);
const label = input?.closest('.chat-toggle');
if (!input || !label) return;
const checked = Boolean(input.checked);
const title = checked ? t(labels[0], labels[1]) : t(labels[2], labels[3]);
label.classList.toggle('is-active', checked);
label.setAttribute('role', 'switch');
label.setAttribute('aria-checked', checked ? 'true' : 'false');
label.setAttribute('title', title);
label.dataset.state = checked ? 'on' : 'off';
input.setAttribute('aria-checked', checked ? 'true' : 'false');
});
}
function handleConnectionToggleChange(event) {
syncProfileDraftFromInputs();
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
syncChatToggleStates();
refreshCallControls();
renderActivePeer();
if (chatState.serverRestriction) renderRestrictionStatus();
const id = event?.target?.id || '';
if (id === 'chatAutoConnect' && chatState.profile.autoConnect && isUnlocked() && appState()?.activeTab === 'chat' && !chatState.connected) {
connectChatTransport();
}
if (id === 'chatAutoDiscovery' && chatState.profile.autoDiscovery && isUnlocked()) {
discoverLocalRelayServer({ fullScan: false, silent: true })
.then((result) => {
if (result && !chatState.connected) return connectChatTransport();
return null;
})
.catch(console.error);
}
}
