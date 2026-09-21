/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 22 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Drafts, "mark as unread", jumping to the first unread, and export
*/

/* =====================================================================
   Drafts, "mark as unread", jumping to the first unread, and export
   ---------------------------------------------------------------------
   Four things every mature messenger has and this did not. Each is small on
   its own; together they are most of the difference between "works" and
   "comfortable to live in".
   ===================================================================== */
const CHAT_DRAFTS_STORAGE_KEY = 'poorija_chat_drafts';
const CHAT_UNREAD_FLAGS_STORAGE_KEY = 'poorija_chat_unread_flags';

/* Every saved store here is a v4 envelope — a JSON object with a numeric v and
   a string ct — so "starts with {" says nothing about being legacy plaintext. */
function draftsRecordIsEnvelope(value) {
  return Boolean(value && typeof value === 'object'
    && typeof value.v === 'number' && typeof value.ct === 'string');
}

function loadChatDrafts() {
  const drafts = loadEncrypted(CHAT_DRAFTS_STORAGE_KEY, null);
  chatState.drafts = drafts && typeof drafts === 'object' ? drafts : {};
  const unread = loadEncrypted(CHAT_UNREAD_FLAGS_STORAGE_KEY, null);
  chatState.manualUnread = unread && typeof unread === 'object' ? unread : {};
  /* Anything a previous version left in the clear is migrated once and the
     plaintext copy removed — but only if it really is plaintext. The test used
     to be "starts with {", which the encrypted envelopes pass too: the
     envelope's own fields (v, alg, n, ct) were merged in as drafts and the
     record deleted and re-saved on EVERY unlock, destroying the preserved
     draft instead of migrating anything. Parse once, check the shape, and
     leave an envelope exactly where it lies. */
  try {
    const legacyDraftsRaw = localStorage.getItem(CHAT_DRAFTS_STORAGE_KEY);
    const legacyDrafts = legacyDraftsRaw && legacyDraftsRaw.trim().startsWith('{')
      ? JSON.parse(legacyDraftsRaw)
      : null;
    const migrateDrafts = Boolean(legacyDrafts) && !draftsRecordIsEnvelope(legacyDrafts);
    if (migrateDrafts) {
      chatState.drafts = { ...legacyDrafts, ...chatState.drafts };
      localStorage.removeItem(CHAT_DRAFTS_STORAGE_KEY);
    }
    const legacyUnreadRaw = localStorage.getItem(CHAT_UNREAD_FLAGS_STORAGE_KEY);
    const legacyUnread = legacyUnreadRaw && legacyUnreadRaw.trim().startsWith('{')
      ? JSON.parse(legacyUnreadRaw)
      : null;
    const migrateUnread = Boolean(legacyUnread) && !draftsRecordIsEnvelope(legacyUnread);
    if (migrateUnread) {
      chatState.manualUnread = { ...legacyUnread, ...chatState.manualUnread };
      localStorage.removeItem(CHAT_UNREAD_FLAGS_STORAGE_KEY);
    }
    if (migrateDrafts || migrateUnread) saveChatDrafts();
  } catch (_error) { /* nothing to migrate */ }
}

/* Through the vault, like everything else.
   These two used to be written as plain JSON, with a comment explaining that a
   draft has to be restorable before the app is unlocked. It does not: both
   call sites of loadChatDrafts() run after unlock — poorija:unlock and
   initChatModule, which is gated on isUnlocked() — and the composer that shows
   a draft is inside the locked shell anyway. So the exception bought nothing
   and left the most sensitive text in the app, the message someone had not yet
   decided to send, readable by anyone with the browser profile. The unread
   flags went the same way: keyed by peer id, they were a contact list in the
   clear. */
function saveChatDrafts() {
  saveEncrypted(CHAT_DRAFTS_STORAGE_KEY, chatState.drafts || {});
  saveEncrypted(CHAT_UNREAD_FLAGS_STORAGE_KEY, chatState.manualUnread || {});
}

function draftFor(conversationId) {
  return String(chatState.drafts?.[conversationId] || '');
}

function setDraft(conversationId, text) {
  if (!conversationId) return;
  const value = String(text || '');
  if (value.trim()) chatState.drafts[conversationId] = value;
  else delete chatState.drafts[conversationId];
  saveChatDrafts();
}

/* Called when the conversation changes, so the box always holds whatever
   belongs to the chat now on screen. */
function applyDraftToComposer(conversationId) {
  const composer = document.getElementById('chatComposer');
  if (!composer) return;
  composer.value = draftFor(conversationId);
  /* Fire the app's own input handling so anything watching the composer — the
     mention picker, the send button's enabled state — sees the restored text
     rather than an empty box it was told about earlier. */
  composer.dispatchEvent(new Event('input', { bubbles: true }));
}

function markConversationUnread(conversationId) {
  if (!conversationId) return;
  chatState.manualUnread[conversationId] = true;
  saveChatDrafts();
  renderPeers();
  renderChatNavBadges();
}

function clearManualUnread(conversationId) {
  if (!conversationId || !chatState.manualUnread?.[conversationId]) return;
  delete chatState.manualUnread[conversationId];
  saveChatDrafts();
}

/* The first message you have not read, so opening a busy conversation puts you
   where you stopped rather than at the bottom of everything. */
function firstUnreadEntryId(conversationId) {
  const history = chatState.history[conversationId] || [];
  const entry = history.find((item) => item.unread && item.direction === 'in');
  return entry?.id || '';
}

function jumpToFirstUnread(conversationId) {
  const id = firstUnreadEntryId(conversationId);
  if (!id) return false;
  window.setTimeout(() => {
    const node = document.querySelector(`#chatMessages [data-id="${CSS.escape(id)}"]`);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.add('is-first-unread');
    window.setTimeout(() => node.classList.remove('is-first-unread'), 2600);
  }, 120);
  return true;
}
