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
   Saved Messages: a conversation with nobody but this account.
   ============================================================================

   Notes, links, files kept for later, a message forwarded to keep. Nothing
   here is ever sent anywhere: an entry is written into this device's history
   (and its media into this device's encrypted vault) and that is the whole of
   it.

   The account's other devices get it the way they get everything else —
   device to device, while both are online. Each entry is mirrored to online
   siblings as it is written (mirrorToSiblings, the same path a sent message
   takes), and a sibling that was away asks for what it missed through the
   delta sync. Media follows the account's file-sync choice: with it off, a
   sibling shows the row and says the file is on another device. No relay
   ever holds a byte of this conversation.

   It appears in the chat list once it holds something, and the bookmark in
   the list's header opens it at any time — it is not drawn while empty, so
   the first row of a fresh install is still the first real conversation.
   ============================================================================ */

const SAVED_CONVERSATION_KEY = 'saved';

function savedMessagesRecord() {
  const entries = chatState.history?.[SAVED_CONVERSATION_KEY] || [];
  return {
    clientId: SAVED_CONVERSATION_KEY,
    peerId: SAVED_CONVERSATION_KEY,
    conversationId: SAVED_CONVERSATION_KEY,
    type: 'saved',
    saved: true,
    username: t('پیام‌های ذخیره‌شده', 'Saved Messages'),
    name: t('پیام‌های ذخیره‌شده', 'Saved Messages'),
    /* Not 'online': nobody is on the other end, and the list sorts by it. */
    status: 'saved',
    avatarData: '',
    lastSeenAt: entries.slice(-1)[0]?.createdAt || '',
  };
}
function isSavedConversationKey(key) {
  return key === SAVED_CONVERSATION_KEY;
}
function savedConversationActive() {
  return chatState.activeConversationId === SAVED_CONVERSATION_KEY;
}
/* Listed once it has something in it, or while it is the open thread. */
function shouldListSavedMessages() {
  return (chatState.history?.[SAVED_CONVERSATION_KEY] || []).length > 0 || savedConversationActive();
}

function openSavedMessages() {
  const composer = document.getElementById('chatComposer');
  if (typeof setDraft === 'function') setDraft(chatState.activeConversationId, composer?.value || '');
  if (chatState.editingMessageId && typeof clearMessageContext === 'function') clearMessageContext();
  if (chatState.selectedMessages?.size && typeof exitSelectionMode === 'function') exitSelectionMode();
  chatState.activePeerClientId = SAVED_CONVERSATION_KEY;
  chatState.activeConversationId = SAVED_CONVERSATION_KEY;
  chatState.timerSeconds = 0;
  if (typeof syncTimerUi === 'function') syncTimerUi();
  if (typeof setChatView === 'function' && chatState.activeView !== 'chats') setChatView('chats');
  if (typeof markConversationRead === 'function') markConversationRead(SAVED_CONVERSATION_KEY);
  if (typeof applyDraftToComposer === 'function') applyDraftToComposer(SAVED_CONVERSATION_KEY);
  updateChatShellMode();
  renderPeers();
  renderActivePeer();
}

function clearComposerAfterKeep() {
  const composer = document.getElementById('chatComposer');
  if (!composer) return;
  composer.value = '';
  if (typeof setDraft === 'function') setDraft(SAVED_CONVERSATION_KEY, '');
  if (typeof syncComposerHeight === 'function') syncComposerHeight(composer);
  if (typeof clearMessageContext === 'function') clearMessageContext();
}

function savedEntryBase(type) {
  return {
    id: generateId('saved'),
    direction: 'out',
    type,
    status: 'sent',
    createdAt: new Date().toISOString(),
    expiresAt: '',
    timerSeconds: 0,
    senderName: chatState.profile?.name || t('شما', 'You'),
    senderFingerprint: chatState.identity?.fingerprint || '',
  };
}

async function keepTextInSaved(text) {
  const body = String(text || '').trim();
  if (!body) return null;
  const entry = {
    ...savedEntryBase('text'),
    text: body,
    replyToId: chatState.replyToId || '',
    hidden: typeof isHiddenComposeActive === 'function' ? isHiddenComposeActive() : false,
  };
  const preview = typeof takeComposerPreview === 'function' ? takeComposerPreview(body) : null;
  if (preview) entry.preview = preview;
  chatState.hiddenNext = false;
  if (typeof syncHiddenToggleUi === 'function') syncHiddenToggleUi();
  appendHistory(SAVED_CONVERSATION_KEY, entry);
  clearComposerAfterKeep();
  return entry;
}

/* A file, a voice note or a sticker kept here goes straight into the vault —
   the same encrypted store every received attachment lands in, so it comes
   back after a reload like any other. The vault encrypts an entry in one
   piece and caps one at MEDIA_VAULT_MAX_FILE_BYTES; anything larger stays
   for this session only, and the person is told so rather than finding out
   tomorrow. */
async function keepBlobInSaved(file, kind = 'file', durationMs = 0, extra = {}, viewOnce = false) {
  if (!file) return null;
  const entry = {
    ...savedEntryBase(kind),
    ...extra,
    name: file.name || `${kind}.bin`,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    viewOnce: Boolean(viewOnce),
    durationMs: kind === 'voice' ? Number(durationMs || 0) : 0,
  };
  const url = URL.createObjectURL(file);
  entry.downloadUrl = url;
  chatState.mediaUrls.set(entry.id, url);
  const kept = await persistMessageMedia(SAVED_CONVERSATION_KEY, entry, file);
  appendHistory(SAVED_CONVERSATION_KEY, entry);
  if (!kept && file.size > MEDIA_VAULT_MAX_FILE_BYTES) {
    notify(t(
      `این فایل بزرگ‌تر از ${app().formatBytes(MEDIA_VAULT_MAX_FILE_BYTES)} است و فقط تا بسته شدن برنامه نگه داشته می‌شود.`,
      `This file is larger than ${app().formatBytes(MEDIA_VAULT_MAX_FILE_BYTES)} and is kept only until the app closes.`,
    ), 'warning');
  }
  return entry;
}

/* A structured message — a poll, a location, a contact card — kept as it is. */
function keepRichInSaved(rich) {
  if (!rich) return null;
  const entry = { ...savedEntryBase('rich'), rich: { ...rich } };
  entry.rich.id = entry.id;
  appendHistory(SAVED_CONVERSATION_KEY, entry);
  return entry;
}

/* Forwarding into Saved Messages copies the message itself — its text, its
   card, its file — rather than re-sending a "Forwarded:" line, because there
   is nobody to send it to. Where it came from is kept beside it. */
async function copyEntryToSaved(entry, fromLabel = '') {
  if (!entry) return null;
  const base = savedEntryBase(entry.type === 'call-log' || entry.type === 'system-note' ? 'text' : entry.type);
  const copy = { ...base, forwardedFrom: String(fromLabel || '').slice(0, 80) };
  if (base.type === 'text') {
    copy.text = entry.type === 'text' ? String(entry.text || '') : (typeof forwardEntryLabel === 'function' ? forwardEntryLabel(entry) : '');
    if (!copy.text) return null;
  } else if (entry.type === 'rich') {
    copy.rich = { ...(typeof richPayloadOf === 'function' ? richPayloadOf(entry) : entry.rich), id: copy.id };
  } else if (typeof isMediaEntry === 'function' && isMediaEntry(entry)) {
    /* From the bubble's URL or the vault (forwardableBlob), and with what makes
       it what it is: a pack keeps its title and count, a GIF its size. */
    const blob = typeof forwardableBlob === 'function' ? await forwardableBlob(entry) : null;
    if (!blob) return null;
    const file = new File([blob], entry.name || `${entry.type}.bin`, { type: blob.type || entry.mime || 'application/octet-stream' });
    return keepBlobInSaved(file, entry.type, entry.durationMs || 0, {
      forwardedFrom: copy.forwardedFrom,
      ...(entry.type === 'sticker' ? {
        stickerKind: entry.stickerKind || '',
        stickerEmoji: entry.stickerEmoji || '',
        ...(entry.mediaWidth && entry.mediaHeight ? { mediaWidth: entry.mediaWidth, mediaHeight: entry.mediaHeight } : {}),
      } : {}),
      ...(entry.type === 'stickerpack' ? { packTitle: entry.packTitle || '', packCount: Number(entry.packCount || 0) } : {}),
    });
  } else {
    copy.type = 'text';
    copy.text = typeof forwardEntryLabel === 'function' ? forwardEntryLabel(entry) : String(entry.name || '');
    if (!copy.text) return null;
  }
  appendHistory(SAVED_CONVERSATION_KEY, copy);
  return copy;
}

/* "Forwarded from …" above a copy kept here. Text only: the name is whatever
   the conversation was called, which somebody else may have chosen. */
function forwardedFromHtml(entry) {
  if (!entry?.forwardedFrom) return '';
  return `<div class="chat-forwarded-from"><i class="fas fa-share"></i> ${app().escapeHTML(t('هدایت‌شده از', 'Forwarded from'))} ${app().escapeHTML(String(entry.forwardedFrom).slice(0, 80))}</div>`;
}

/* The forward picker's row for it, first in the list. */
function savedMessagesDestination(activeKey) {
  if (activeKey === SAVED_CONVERSATION_KEY) return [];
  return [{
    key: SAVED_CONVERSATION_KEY,
    icon: 'fa-bookmark',
    label: t('پیام‌های ذخیره‌شده', 'Saved Messages'),
    hint: t('فقط دستگاه‌های خودتان', 'Only your own devices'),
  }];
}

/* The header for it: no presence, no calls, no session — and a composer
   that never waits for a relay, because nothing it writes goes to one. */
function renderSavedMessagesHeader(peer) {
  if (peer?.type !== 'saved') return false;
  const composerBar = document.querySelector('.chat-composer-bar');
  const banner = document.getElementById('chatSessionBanner');
  const peerMeta = document.getElementById('chatActivePeerMeta');
  const locked = typeof conversationLocked === 'function' && conversationLocked(SAVED_CONVERSATION_KEY);
  composerBar?.classList.toggle('hidden', locked || chatState.activeView === 'calls' || chatState.activeView === 'connection');
  if (peerMeta) {
    peerMeta.classList.remove('animate-pulse', 'text-sky-500');
    const devices = (chatState.linkedDevices || []).length;
    peerMeta.textContent = devices >= 2
      ? t('فقط روی دستگاه‌های خودتان، مستقیم بین آن‌ها همگام می‌شود', 'Only on your own devices, synced directly between them')
      : t('فقط روی همین دستگاه — به هیچ سروری فرستاده نمی‌شود', 'Only on this device — never sent to any server');
  }
  document.getElementById('chatActivePeerMood')?.classList.add('hidden');
  const avatar = document.getElementById('chatActiveAvatar');
  if (avatar) {
    avatar.classList.remove('hidden');
    avatar.innerHTML = '<i class="fas fa-bookmark text-xl"></i>';
    avatar.className = 'chat-avatar chat-active-avatar chat-saved-avatar';
  }
  banner?.classList.add('hidden');
  document.getElementById('chatVerifyKeyBtn')?.classList.add('hidden');
  document.getElementById('chatKeyAlert')?.classList.add('hidden');
  ['chatSendMessageBtn', 'chatSendFileBtn', 'chatVoiceMessageBtn'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = Boolean(locked);
  });
  ['chatVoiceCallBtn', 'chatVideoCallBtn', 'chatStartSessionBtn'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = true;
  });
  const remoteFingerprint = document.getElementById('chatRemoteFingerprint');
  if (remoteFingerprint) remoteFingerprint.textContent = '-';
  const deleteBtn = document.getElementById('chatDeleteConversationBtn');
  deleteBtn?.classList.remove('hidden');
  if (deleteBtn) deleteBtn.disabled = false;
  const menuBtn = document.getElementById('chatThreadMenuBtn');
  if (menuBtn) menuBtn.disabled = Boolean(locked);
  return true;
}

document.getElementById('chatSavedMessagesBtn')?.addEventListener('click', () => openSavedMessages());

window.openSavedMessages = openSavedMessages;
window.keepTextInSaved = keepTextInSaved;
window.copyEntryToSaved = copyEntryToSaved;
