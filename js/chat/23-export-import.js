/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 23 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Taking your chats out, and bringing them back
*/

/* A conversation, as a file you own. Everything is already on this device; the
   point is being able to take it somewhere else, or keep it after deleting the
   chat. Media is referenced by name rather than embedded — a transcript should
   not be half a gigabyte. */
/* ============================================================================
   Taking your chats out, and bringing them back
   ----------------------------------------------------------------------------
   An export is a file that leaves the device, so it is encrypted with a
   password the user chooses — AES-256-GCM under a PBKDF2 key, the same shape
   the rest of the suite uses — and never written as readable JSON. The
   envelope around the ciphertext says what it is and how it was derived, so a
   future version can still open it without guessing.
   ========================================================================== */
const CHAT_EXPORT_TYPE = 'poorija-chat-archive';
const CHAT_EXPORT_KDF_ITERATIONS = 310000;

async function deriveExportKey(password, salt, iterations = CHAT_EXPORT_KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* Ask twice on the way out — a typo in an export password is only discovered
   when the archive is needed, which is the worst moment to discover it. */
async function askExportPassword() {
  const first = await PoorijaDialogs.prompt(
    t('برای این فایل یک رمز بگذارید. بدون این رمز، فایل باز نمی‌شود.',
      'Set a password for this file. Without it the archive cannot be opened.'),
    { password: true, okLabel: t('ادامه', 'Continue') },
  );
  if (first === null) return null;
  const password = String(first);
  if (password.length < 6) {
    notify(t('رمز باید دست‌کم ۶ نویسه باشد.', 'The password needs at least 6 characters.'), 'warning');
    return null;
  }
  const again = await PoorijaDialogs.prompt(t('همان رمز را دوباره بنویسید.', 'Type the same password again.'), { password: true });
  if (again === null) return null;
  if (String(again) !== password) {
    notify(t('دو رمز یکی نیستند.', 'The two passwords do not match.'), 'error');
    return null;
  }
  return password;
}

function conversationExportPayload(conversationId) {
  const record = allConversationRecords().find((item) => getConversationKey(item) === conversationId);
  const history = chatState.history[conversationId] || [];
  return {
    id: conversationId,
    name: record?.username || record?.name || conversationId,
    kind: record?.type === 'group' ? 'group' : 'direct',
    fingerprint: record?.fingerprint || '',
    peerId: record?.peerId || '',
    avatarData: record?.avatarData || '',
    /* The timer and its bookkeeping travel with the message, or a
       self-destructing message comes back as an ordinary one. expiresAt is
       deliberately empty: the old clock belongs to the device that exported
       it, and an imported thread re-arms each timer when it is first read. */
    messages: history.map((entry) => ({
      id: entry.id,
      at: entry.createdAt || entry.timestamp || '',
      direction: entry.direction,
      type: entry.type,
      from: entry.senderName || '',
      text: entry.text || '',
      timerSeconds: Number(entry.timerSeconds || 0),
      expiresAt: '',
      hidden: Boolean(entry.hidden),
      replyToId: entry.replyToId || '',
      pinned: Boolean(entry.pinned),
      attachment: entry.name ? { name: entry.name, mime: entry.mime || '', size: entry.size || 0 } : null,
      reactions: entry.reactions || undefined,
      editedAt: entry.editedAt || undefined,
    })),
  };
}

async function exportChatArchive(conversationIds) {
  const ids = (conversationIds && conversationIds.length
    ? conversationIds
    : allConversationRecords().map((record) => getConversationKey(record)))
    .filter((id) => (chatState.history[id] || []).length);
  if (!ids.length) {
    notify(t('چیزی برای برون‌ریزی نیست.', 'There is nothing to export.'), 'warning');
    return;
  }
  const password = await askExportPassword();
  if (!password) return;
  try {
    const payload = {
      app: 'P00RIJA Cryptography',
      type: CHAT_EXPORT_TYPE,
      version: 2,
      exportedAt: new Date().toISOString(),
      conversations: ids.map((id) => conversationExportPayload(id)),
    };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveExportKey(password, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload)),
    ));
    const envelope = {
      app: 'P00RIJA Cryptography',
      type: CHAT_EXPORT_TYPE,
      version: 2,
      encrypted: true,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: CHAT_EXPORT_KDF_ITERATIONS, salt: bytesToBase64(salt) },
      cipher: { name: 'AES-GCM', iv: bytesToBase64(iv), data: bytesToBase64(cipher) },
      conversations: ids.length,
      exportedAt: payload.exportedAt,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `poorija-chats-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    notify(t(`${ids.length} گفتگو رمزنگاری و ذخیره شد.`, `${ids.length} conversation(s) encrypted and saved.`), 'success');
  } catch (error) {
    console.error('Chat export failed:', error);
    notify(t('برون‌ریزی ناموفق بود.', 'Export failed.'), 'error');
  }
}

async function importChatArchive(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const envelope = JSON.parse(text);
    if (envelope?.type !== CHAT_EXPORT_TYPE && envelope?.type !== 'poorija-chat-export') {
      notify(t('این فایل یک آرشیو گفتگوی P00RIJA نیست.', 'That file is not a P00RIJA chat archive.'), 'warning');
      return;
    }
    let payload = envelope;
    if (envelope.encrypted) {
      const password = await PoorijaDialogs.prompt(
        t('رمز این فایل را وارد کنید.', 'Enter the password for this file.'), { password: true });
      if (password === null) return;
      const salt = base64ToBytes(envelope.kdf?.salt || '');
      const iv = base64ToBytes(envelope.cipher?.iv || '');
      const data = base64ToBytes(envelope.cipher?.data || '');
      const key = await deriveExportKey(password, salt, Number(envelope.kdf?.iterations) || CHAT_EXPORT_KDF_ITERATIONS);
      let plain;
      try {
        plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      } catch (error) {
        void error;
        /* GCM fails as one: a wrong password and a damaged file look the same
           from here, so the message says both. */
        notify(t('رمز درست نیست یا فایل آسیب دیده است.', 'Wrong password, or the file is damaged.'), 'error');
        return;
      }
      payload = JSON.parse(new TextDecoder().decode(plain));
    }
    const conversations = payload.conversations
      || (payload.conversation ? [{ ...payload.conversation, messages: payload.messages || [] }] : []);
    if (!conversations.length) {
      notify(t('این آرشیو گفتگویی ندارد.', 'That archive holds no conversations.'), 'warning');
      return;
    }
    let added = 0;
    let merged = 0;
    let truncated = 0;
    conversations.forEach((conversation) => {
      const id = conversation.id;
      if (!id) return;
      const existing = chatState.history[id] || [];
      const known = new Set(existing.map((entry) => entry.id));
      const incoming = (conversation.messages || []).map((message) => ({
        id: message.id || generateId('msg'),
        createdAt: message.at || new Date().toISOString(),
        direction: message.direction === 'out' ? 'out' : 'in',
        type: message.type || 'text',
        text: message.text || '',
        senderName: message.from || '',
        /* Restored with the message for the same reason they were exported:
           a timer without timerSeconds never burns, and a stale expiresAt
           resurrects the message already expired. Attachment metadata comes
           back as the entry fields the renderer reads (name/mime/size). */
        timerSeconds: Number(message.timerSeconds || 0),
        expiresAt: message.expiresAt || '',
        hidden: Boolean(message.hidden),
        replyToId: message.replyToId || '',
        pinned: Boolean(message.pinned),
        name: message.attachment?.name || '',
        mime: message.attachment?.mime || '',
        size: Number(message.attachment?.size || 0),
        reactions: message.reactions,
        editedAt: message.editedAt,
        imported: true,
      })).filter((message) => !known.has(message.id));
      if (!incoming.length && existing.length) return;
      if (!existing.length) added += 1; else merged += 1;
      const combined = [...existing, ...incoming]
        .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
      const kept = combined.slice(-2000);
      truncated += combined.length - kept.length;
      chatState.history[id] = kept;
      /* A conversation nobody has a contact for would be unreachable, so the
         archive's own record is enough to list it. The avatar is the one
         field here that came from another device and is about to be drawn,
         so it passes the same gate every remote avatar passes. */
      if (conversation.peerId && !chatState.peers.some((peer) => peer.peerId === conversation.peerId)) {
        mergePeerRecord({
          clientId: conversation.peerId,
          peerId: conversation.peerId,
          username: conversation.name || conversation.peerId,
          fingerprint: conversation.fingerprint || '',
          avatarData: sanitizeAvatarData(conversation.avatarData),
          manual: true,
          status: 'offline',
        }, { online: false });
      }
    });
    storeHistory();
    saveContacts();
    renderPeers();
    renderMessages();
    if (truncated) {
      notify(t(`${truncated} پیام قدیمی‌تر از سقف درون‌ریزی نگه داشته نشد.`, `${truncated} older message(s) were past the import limit and were not kept.`), 'warning');
    }
    notify(t(`${added} گفتگوی تازه و ${merged} گفتگوی به‌روزشده وارد شد.`,
      `${added} new and ${merged} updated conversation(s) imported.`), 'success');
  } catch (error) {
    console.error('Chat import failed:', error);
    notify(t('درون‌ریزی ناموفق بود.', 'Import failed.'), 'error');
  }
}

async function clearAllChatHistory() {
  const count = Object.values(chatState.history || {}).reduce((total, list) => total + (list?.length || 0), 0);
  if (!count) {
    notify(t('تاریخچه‌ای برای پاک کردن نیست.', 'There is no history to clear.'), 'info');
    return;
  }
  const ok = await PoorijaDialogs.confirm(
    t(`کل تاریخچهٔ گفتگوها (${count} پیام) پاک شود؟ این کار برگشت‌پذیر نیست.`,
      `Erase the whole chat history (${count} messages)? This cannot be undone.`),
    { danger: true, okLabel: t('پاک کن', 'Erase') },
  );
  if (!ok) return;
  chatState.history = {};
  storeHistory();
  renderPeers();
  renderMessages();
  notify(t('تاریخچهٔ گفتگوها پاک شد.', 'The chat history is cleared.'), 'success');
}

/* Which conversations to take. Everything is one tick; the list is there for
   when it is one chat out of forty that matters. */
function openExportPicker() {
  const records = allConversationRecords()
    .filter((record) => (chatState.history[getConversationKey(record)] || []).length);
  if (!records.length) {
    notify(t('چیزی برای برون‌ریزی نیست.', 'There is nothing to export.'), 'warning');
    return;
  }
  openFullSheet({
    title: t('برون‌ریزی گفتگوها', 'Export conversations'),
    build: (body) => {
      const head = document.createElement('div');
      head.className = 'chat-export-head';
      head.innerHTML = `
<label class="chat-export-all">
  <input type="checkbox" data-export-all checked>
  <span>${app().escapeHTML(t('انتخاب همه', 'Select all'))}</span>
</label>
<small>${app().escapeHTML(t('فایل با رمزی که می‌گذارید رمزنگاری می‌شود.', 'The file is encrypted with the password you set.'))}</small>`;
      body.appendChild(head);

      const list = document.createElement('div');
      list.className = 'chat-export-list';
      list.innerHTML = records.map((record) => {
        const id = getConversationKey(record);
        const name = record.username || record.name || id;
        const count = (chatState.history[id] || []).length;
        return `
<label class="chat-export-row">
  <input type="checkbox" value="${app().escapeHTML(id)}" checked>
  <span class="chat-export-name">${app().escapeHTML(name)}</span>
  <small>${app().escapeHTML(t(`${count} پیام`, `${count} messages`))}</small>
</label>`;
      }).join('');
      body.appendChild(list);

      const actions = document.createElement('div');
      actions.className = 'chat-export-actions';
      actions.innerHTML = `
<button type="button" class="chat-primary-btn" data-export-go>
  <i class="fas fa-file-export"></i><span>${app().escapeHTML(t('برون‌ریزی رمزنگاری‌شده', 'Encrypted export'))}</span>
</button>`;
      body.appendChild(actions);

      const boxes = () => [...list.querySelectorAll('input[type="checkbox"]')];
      head.querySelector('[data-export-all]').addEventListener('change', (event) => {
        boxes().forEach((box) => { box.checked = event.target.checked; });
      });
      actions.querySelector('[data-export-go]').addEventListener('click', async () => {
        const ids = boxes().filter((box) => box.checked).map((box) => box.value);
        if (!ids.length) {
          notify(t('دست‌کم یک گفتگو را انتخاب کنید.', 'Pick at least one conversation.'), 'warning');
          return;
        }
        closeFullSheet();
        await exportChatArchive(ids);
      });
    },
  });
}

function pickArchiveFile() {
  let input = document.getElementById('chatArchiveInput');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'chatArchiveInput';
    input.accept = 'application/json,.json';
    input.className = 'hidden';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      await importChatArchive(file);
    });
  }
  input.click();
}

function exportConversation(conversationId) {
  const record = allConversationRecords().find((item) => getConversationKey(item) === conversationId);
  const history = chatState.history[conversationId] || [];
  if (!history.length) {
    notify(t('این گفتگو چیزی برای برون‌ریزی ندارد.', 'This conversation has nothing to export.'), 'warning');
    return;
  }
  /* A PIN-locked thread is closed to every reader, export included: writing
     its contents to a file the lock does not guard would be a bypass, not a
     backup. */
  if (typeof conversationLocked === 'function' && conversationLocked(conversationId)) {
    notify(t('این گفتگو قفل است؛ برای برون‌ریزی ابتدا قفل آن را باز کنید.', 'This conversation is locked; unlock it before exporting it.'), 'warning');
    return;
  }
  const payload = {
    app: 'P00RIJA Cryptography',
    type: 'poorija-chat-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    conversation: {
      id: conversationId,
      name: record?.username || record?.name || conversationId,
      kind: record?.type === 'group' ? 'group' : 'direct',
      fingerprint: record?.fingerprint || '',
    },
    messages: history.map((entry) => ({
      id: entry.id,
      at: entry.createdAt || entry.timestamp || '',
      direction: entry.direction,
      type: entry.type,
      from: entry.senderName || '',
      text: entry.text || '',
      /* Same fields the encrypted archive carries: a transcript that loses
         the timer or the attachment metadata is not the conversation. */
      timerSeconds: Number(entry.timerSeconds || 0),
      expiresAt: '',
      hidden: Boolean(entry.hidden),
      replyToId: entry.replyToId || '',
      pinned: Boolean(entry.pinned),
      /* Attachments are named, not inlined: the bytes are in the vault and a
         readable transcript is the thing worth carrying. */
      attachment: entry.name ? { name: entry.name, mime: entry.mime || '', size: entry.size || 0 } : null,
      reactions: entry.reactions || undefined,
      editedAt: entry.editedAt || undefined,
    })),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = String(payload.conversation.name).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 48) || 'chat';
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `poorija-${safeName}-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  notify(t(`${history.length} پیام برون‌ریزی شد.`, `Exported ${history.length} messages.`), 'success');
}

function unreadConversationCount(conversationId) {
/* A conversation flagged by hand reads as one unread item even though every
   message in it has been seen — which is the whole point of the flag. */
if (chatState.manualUnread?.[conversationId]) return Math.max(1, rawUnreadCount(conversationId));
return rawUnreadCount(conversationId);
}
function rawUnreadCount(conversationId) {
return (chatState.history[conversationId] || []).filter((entry) => {
if (!entry.unread || entry.direction !== 'in') return false;
if (entry.type === 'call-log') return isMissedCallStatus(entry.status) || entry.status === 'ringing' || entry.status === 'incoming';
return true;
}).length;
}
function isConversationCurrentlyVisible(conversationId) {
if (!conversationId || conversationId !== chatState.activeConversationId) return false;
if (document.hidden || appState()?.activeTab !== 'chat') return false;
if (['calls', 'connection'].includes(chatState.activeView)) return false;
/* A lock over the screen means the thread is NOT being read, whatever the
   routing says. The lock screen of the app, the gate over the Secure Chat
   tab and the padlock on this one conversation each hide the words — and
   every "the user is looking at it" decision (unread flags, read receipts)
   flows through here. With the app or the tab locked the active id is
   cleared anyway; the conversation padlock is the case that kept returning
   true: its card covered the thread while the routing still called it the
   open conversation, so arrivals were marked read before anyone saw them. */
if (appState()?.isLocked) return false;
if (typeof chatLockEnabled === 'function' && chatLockEnabled() && !chatState.chatUnlocked) return false;
if (typeof conversationLocked === 'function' && conversationLocked(conversationId)) return false;
return true;
}
function markConversationRead(conversationId) {
const history = chatState.history[conversationId] || [];
let changed = false;
let cleared = 0;
history.forEach((entry) => {
if (entry.unread) {
entry.unread = false;
changed = true;
cleared += 1;
}
/* Where a self-destruct timer begins for a message we received. Arrival is
   the wrong moment: one held in the relay queue for days would burn its whole
   life waiting to be looked at. Reading it is the event the timer is about. */
if (entry.direction === 'in' && Number(entry.timerSeconds || 0) > 0 && !entry.expiresAt) {
entry.expiresAt = new Date(Date.now() + Number(entry.timerSeconds) * 1000).toISOString();
changed = true;
}
});
if (changed) {
storeHistory();
window.dispatchEvent(new CustomEvent('poorija:chat-read', {
detail: { conversationId, count: cleared }
}));
}
return changed;
}
function pinnedRecords() {
return allConversationRecords()
.filter((record) => record.pinned)
.sort((a, b) => (a.pinOrder || 0) - (b.pinOrder || 0))
.slice(0, 5);
}
function shouldShowConversation(record) {
if (!record) return false;
if (record.system || record.type) return true;
const key = getConversationKey(record);
return Boolean(record.manual || record.pinned || conversationHistory(record).length > 0 || chatState.sessionKeys[record.peerId] || chatState.sessionKeys[record.fingerprint] || chatState.activeConversationId === key);
}
function nextPinOrder() {
const max = Math.max(0, ...allConversationRecords().map((record) => Number(record.pinOrder || 0)));
return max + 1;
}
function toggleConversationPin(conversationId) {
const record = conversationRecordById(conversationId);
if (!record) return;
if (!record.pinned && pinnedRecords().length >= 5) {
notify(t('حداکثر ۵ چت را می‌توانید پین کنید.', 'You can pin up to 5 chats.'), 'warning');
return;
}
record.pinned = !record.pinned;
record.pinOrder = record.pinned ? (record.pinOrder || nextPinOrder()) : 0;
saveContacts();
saveSpaces();
renderPeers();
}
/* ---- Per-conversation controls: block, mute, archive ------------------------
   Same shape as the existing pin flag: a boolean on the conversation record,
   persisted through saveContacts()/saveSpaces(). Enforcement lives at three
   points — the inbound message path (blocked peers never reach history), the
   alert path (muted chats make no sound and raise no notification), and the
   list filter (archived chats leave the main list). */
function isConversationBlocked(record) {
return Boolean(record?.blocked);
}
function isPeerKeyBlocked(key) {
if (!key) return false;
const record = findPeerByAnyKey(key) || conversationRecordById(key);
return isConversationBlocked(record);
}
function toggleConversationBlock(conversationId) {
const record = conversationRecordById(conversationId);
if (!record) return;
record.blocked = !record.blocked;
if (record.blocked) {
/* A blocked chat should also stop making noise and stop taking up room. */
record.muted = true;
}
saveContacts();
saveSpaces();
renderPeers();
renderActivePeer();
notify(record.blocked
? t('این مخاطب مسدود شد؛ پیام و تماس او دریافت نمی‌شود.', 'Contact blocked; their messages and calls will be rejected.')
: t('مسدودسازی برداشته شد.', 'Contact unblocked.'), record.blocked ? 'warning' : 'success');
}
function toggleConversationMute(conversationId) {
const record = conversationRecordById(conversationId);
if (!record) return;
record.muted = !record.muted;
saveContacts();
saveSpaces();
renderPeers();
notify(record.muted
? t('این گفتگو بی‌صدا شد.', 'Conversation muted.')
: t('صدای این گفتگو برگشت.', 'Conversation unmuted.'), 'info');
}
function toggleConversationArchive(conversationId) {
const record = conversationRecordById(conversationId);
if (!record) return;
record.archived = !record.archived;
if (record.archived) {
record.pinned = false;
record.pinOrder = 0;
if (chatState.activeConversationId === conversationId) {
chatState.activeConversationId = '';
chatState.activePeerClientId = '';
}
}
saveContacts();
saveSpaces();
renderPeers();
renderActivePeer();
notify(record.archived
? t('گفتگو آرشیو شد.', 'Conversation archived.')
: t('گفتگو از آرشیو خارج شد.', 'Conversation restored from archive.'), 'info');
}
function archivedConversationCount() {
return allConversationRecords().filter((record) => record.archived && shouldShowConversation(record)).length;
}
function toggleArchivedView() {
chatState.showArchived = !chatState.showArchived;
renderPeers();
}

function movePinnedConversation(conversationId, direction) {
const pins = pinnedRecords();
const index = pins.findIndex((record) => getConversationKey(record) === conversationId);
const nextIndex = index + direction;
if (index < 0 || nextIndex < 0 || nextIndex >= pins.length) return;
const current = pins[index];
const next = pins[nextIndex];
const temp = current.pinOrder || index + 1;
current.pinOrder = next.pinOrder || nextIndex + 1;
next.pinOrder = temp;
saveContacts();
saveSpaces();
renderPeers();
}
function searchableMessageText(entry = {}) {
return [
entry.text,
entry.name,
entry.type === 'call-log' ? callHistoryText(entry) : '',
entry.type === 'voice' ? t('پیام صوتی', 'Voice message') : '',
entry.type === 'file' ? t('فایل', 'File') : '',
entry.type === 'sticker' ? t('استیکر', 'Sticker') : '',
entry.type === 'rich' ? richEntryLabel(entry) : '',
].filter(Boolean).join(' ');
}
function notificationMessageLabel(entry = {}) {
if (entry.type === 'text') return entry.text || t('پیام جدید', 'New message');
if (entry.type === 'voice') return t('پیام صوتی جدید', 'New voice message');
if (entry.type === 'sticker') return mediaEntryLabel(entry);
if (entry.type === 'file') return entry.name || t('فایل جدید', 'New file');
if (entry.type === 'call-log') return callHistoryText(entry);
return t('پیام جدید', 'New message');
}
function messageMatchesSearch(entry, query) {
const normalized = String(query || '').trim().toLowerCase();
if (!normalized) return false;
return searchableMessageText(entry).toLowerCase().includes(normalized);
}
function activateFirstSearchResult(query) {
const normalized = String(query || '').trim().toLowerCase();
if (!normalized) return false;
const current = getActiveConversation();
const currentKey = current ? getConversationKey(current) : '';
if ((chatState.history[currentKey] || []).some((entry) => messageMatchesSearch(entry, normalized))) {
return true;
}
const match = allConversationRecords().find((record) => {
const key = getConversationKey(record);
return (chatState.history[key] || []).some((entry) => messageMatchesSearch(entry, normalized));
});
if (!match) return false;
chatState.activeConversationId = getConversationKey(match);
chatState.activePeerClientId = match.type ? '' : (match.clientId || '');
chatState.activeView = match.type === 'group' ? 'groups' : 'chats';
updateChatShellMode();
return true;
}
