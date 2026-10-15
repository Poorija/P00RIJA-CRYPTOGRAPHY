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
   Message requests: what somebody who is not a contact sends waits apart.
   ============================================================================

   Anybody who holds a person's card can write to them — that is how a first
   message is possible at all. What a stranger does not get, until the person
   says yes, is everything that rides along with a contact's message:

     - it does not sit in the main list, it waits under Requests;
     - it makes no sound and raises no notification;
     - no read receipt goes back, so the sender cannot learn whether — or
       when — it was read; delivery is still acknowledged, because the relay
       must be able to drop its copy;
     - files, voice notes and stickers are not drawn until it is accepted, so
       a picture cannot be used to make the device fetch or render something
       of the sender's choosing;
     - a large file is always asked about, whatever the auto-download quota;
     - a call does not ring; it is written down as missed.

   Accepting is one tap, and so is replying: answering somebody is accepting
   them. Blocking and deleting sit beside it. Everybody this device already
   talked to before this existed is accepted on first run, so an update does
   not suddenly file old friends under Requests.
   ============================================================================ */

function seedAcceptedConversations(savedPrefs) {
  chatState.prefs = chatState.prefs || {};
  chatState.prefs.requestsSeeded = Boolean(savedPrefs?.requestsSeeded);
  if (chatState.prefs.requestsSeeded) return;
  let changed = false;
  for (const peer of chatState.peers || []) {
    if (!peer?.peerId || peer.type || peer.system || isSelfPeerRecord(peer)) continue;
    if (!peer.accepted && isStoredContact(peer)) {
      peer.accepted = true;
      changed = true;
    }
  }
  let groupsChanged = false;
  for (const space of chatState.spaces?.groups || []) {
    if (!space.accepted) { space.accepted = true; groupsChanged = true; }
  }
  chatState.prefs.requestsSeeded = true;
  if (changed) saveContacts();
  if (groupsChanged && typeof saveSpaces === 'function') saveSpaces();
  saveChatPrefs();
}

function wroteInto(record) {
  return conversationHistory(record).some((entry) => entry?.direction === 'out'
    && entry.type !== 'system-note' && entry.type !== 'call-log');
}
/* Somebody this account chose directly — added, pinned, carried over from a
   sibling's book, or written to. Group membership is deliberately not on
   this list: anybody can put anybody in a group they made, so being in one
   says nothing about whether this person said yes. */
function isAcceptedContact(record) {
  if (!record || record.type || record.system) return false;
  if (isSelfPeerRecord(record)) return true;
  if (record.accepted || record.manual || record.pinned || record.synced) return true;
  return wroteInto(record);
}
/* A group is a request unless this account said yes to it — made it here,
   joined it by a code, accepted it, or wrote in it — or the person who put
   this account in it is a contact. "Who put it there" is the authenticated
   sender of the first record that created the group on this device
   (addedBy, written by upsertSharedSpace), never the owner the record
   claims: a record can name anybody as its owner, this account included. */
function isGroupRequest(space) {
  if (!space || space.type !== 'group') return false;
  if (space.accepted) return false;
  if (wroteInto(space)) return false;
  /* Added by this account itself, from another of its devices. */
  if (space.addedBy && space.addedBy === chatState.identity?.fingerprint) return false;
  const adder = space.addedBy ? findPeerByAnyKey(space.addedBy) : null;
  return !isAcceptedContact(adder);
}

/* A request is somebody this account never chose — or a group they put it
   in — who has written. Sharing a group is not choosing: a group's member
   list is assembled from what members send, and anybody who knows a group's
   id can add their own name to it. */
function isMessageRequest(record) {
  if (!record || record.system) return false;
  if (record.type === 'group') return isGroupRequest(record);
  if (record.type || !record.peerId) return false;
  if (isAcceptedContact(record)) return false;
  return conversationHistory(record).some((entry) => entry?.direction === 'in'
    && entry.type !== 'system-note' && entry.type !== 'call-log');
}

function messageRequestCount() {
  return allConversationRecords().filter((record) => isMessageRequest(record)).length;
}
function showingRequests() {
  return Boolean(chatState.showRequests);
}
function toggleRequestsView(force) {
  chatState.showRequests = typeof force === 'boolean' ? force : !chatState.showRequests;
  if (chatState.showRequests) chatState.showArchived = false;
  renderPeers();
}

/* The chip in the list's filter row, beside Archived. */
function messageRequestsChipHtml() {
  const count = messageRequestCount();
  const on = showingRequests();
  if (!count && !on) return '';
  return `<button type="button" role="tab" aria-selected="${on}" data-chat-requests-shelf class="chat-list-filter chat-list-filter-requests ${on ? 'is-on' : ''}" title="${app().escapeHTML(on ? t('بازگشت به چت‌ها', 'Back to chats') : t('پیام از کسانی که در مخاطبان شما نیستند', 'Messages from people who are not your contacts'))}"><i class="fas fa-user-clock"></i>${app().escapeHTML(t('درخواست‌ها', 'Requests'))}${count ? `<span>${count > 99 ? '99+' : count}</span>` : ''}</button>`;
}

function acceptMessageRequest(record) {
  if (!record) return;
  record.accepted = true;
  if (record.type === 'group') saveSpaces();
  else saveContacts();
  renderPeers();
  renderActivePeer();
  renderMessages();
  /* The read receipts that were held now go — the burst limit in
     flushSeenReceipts keeps that to the last few. */
  if (typeof flushSeenReceipts === 'function') flushSeenReceipts();
}

/* The card in the middle of the conversation while a request is open.
 *
 * It used to sit in the composer's footer, which is sized for the input and
 * clips what does not fit — on a phone and on a desktop alike the three
 * buttons were cut through the middle, and Accept, Block and Delete could not
 * be pressed. It is a decision, so it is placed where a decision is read: over
 * the middle of the messages, centred on them, kept there as the panel
 * changes size (the keyboard, a rotation, the rail being dragged). */
function placeMessageRequestCard() {
  const bar = document.getElementById('chatRequestBar');
  const panel = document.getElementById('chatMessages');
  if (!bar || !panel || bar.classList.contains('hidden')) return;
  const host = bar.offsetParent || document.body;
  const hostBox = host.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const width = Math.max(220, Math.min(480, box.width - 32));
  bar.style.width = `${Math.round(width)}px`;
  bar.style.left = `${Math.round(box.left - hostBox.left + (host.scrollLeft || 0) + box.width / 2)}px`;
  bar.style.top = `${Math.round(box.top - hostBox.top + (host.scrollTop || 0) + box.height / 2)}px`;
  bar.style.maxHeight = `${Math.round(Math.max(160, box.height - 24))}px`;
}
let messageRequestCardObserver = null;
function keepMessageRequestCardPlaced() {
  if (messageRequestCardObserver) return;
  const panel = document.getElementById('chatMessages');
  if (!panel) return;
  if (typeof ResizeObserver === 'function') {
    messageRequestCardObserver = new ResizeObserver(() => placeMessageRequestCard());
    messageRequestCardObserver.observe(panel);
  }
  window.addEventListener('resize', placeMessageRequestCard, { passive: true });
  window.visualViewport?.addEventListener('resize', placeMessageRequestCard, { passive: true });
}

function renderMessageRequestBar(peer) {
  const thread = document.querySelector('.chat-thread');
  let bar = document.getElementById('chatRequestBar');
  const request = isMessageRequest(peer);
  if (!request) {
    bar?.classList.add('hidden');
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'chatRequestBar';
    bar.className = 'chat-request-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', t('درخواست پیام', 'Message request'));
    (thread || document.body).appendChild(bar);
    keepMessageRequestCardPlaced();
    bar.addEventListener('click', (event) => {
      const action = event.target.closest?.('[data-request-action]')?.dataset.requestAction;
      const current = activePeer();
      if (!action || !current) return;
      if (action === 'accept') acceptMessageRequest(current);
      else if (action === 'leave' && typeof leaveActiveSpace === 'function') leaveActiveSpace().catch(console.error);
      else if (action === 'block') {
        const key = getConversationKey(current);
        if (!current.blocked) toggleConversationBlock(key);
        toggleConversationArchive(key);
      } else if (action === 'delete' && typeof deleteActiveConversation === 'function') {
        deleteActiveConversation().catch(console.error);
      }
    });
  }
  if (peer.type === 'group') {
    const owner = findPeerByAnyKey(peer.ownerFingerprint) || findPeerByAnyKey(peer.ownerPeerId);
    const by = owner?.username || owner?.name || t('کسی', 'someone');
    bar.innerHTML = `
    <p><i class="fas fa-user-clock"></i> <span></span></p>
    <div class="chat-request-actions">
      <button type="button" class="chat-request-btn is-accept" data-request-action="accept"><i class="fas fa-check"></i> ${app().escapeHTML(t('پذیرفتن', 'Accept'))}</button>
      <button type="button" class="chat-request-btn is-block" data-request-action="leave"><i class="fas fa-right-from-bracket"></i> ${app().escapeHTML(t('خروج از گروه', 'Leave'))}</button>
      <button type="button" class="chat-request-btn" data-request-action="delete"><i class="fas fa-trash"></i> ${app().escapeHTML(t('حذف', 'Delete'))}</button>
    </div>`;
    bar.querySelector('p span').textContent = t(
      `«${by}» که در مخاطبان شما نیست، شما را به این گروه اضافه کرده. تا نپذیرید، صدایی پخش نمی‌شود، فایل‌ها نمایش داده نمی‌شوند و تماس گروهی زنگ نمی‌زند.`,
      `"${by}", who is not in your contacts, added you to this group. Until you accept, it makes no sound, its files are not shown and its calls do not ring.`,
    );
    bar.classList.remove('hidden');
    placeMessageRequestCard();
    return;
  }
  const name = peer.username || peer.name || t('این شخص', 'This person');
  bar.innerHTML = `
    <p><i class="fas fa-user-clock"></i> <span></span></p>
    <div class="chat-request-actions">
      <button type="button" class="chat-request-btn is-accept" data-request-action="accept"><i class="fas fa-check"></i> ${app().escapeHTML(t('پذیرفتن', 'Accept'))}</button>
      <button type="button" class="chat-request-btn is-block" data-request-action="block"><i class="fas fa-ban"></i> ${app().escapeHTML(t('مسدود کردن', 'Block'))}</button>
      <button type="button" class="chat-request-btn" data-request-action="delete"><i class="fas fa-trash"></i> ${app().escapeHTML(t('حذف', 'Delete'))}</button>
    </div>`;
  bar.querySelector('p span').textContent = t(
    `«${name}» در مخاطبان شما نیست. تا نپذیرید، رسید خواندن نمی‌گیرد، فایل‌هایش نمایش داده نمی‌شود و تماسش زنگ نمی‌زند. پاسخ دادن یعنی پذیرفتن.`,
    `"${name}" is not in your contacts. Until you accept, they get no read receipts, their files are not shown and their calls do not ring. Replying accepts them.`,
  );
  bar.classList.remove('hidden');
  placeMessageRequestCard();
}

/* What a file, voice note or sticker from a request looks like until it is
   accepted: a line saying what it is, and nothing of the sender's drawn. */
function requestMaskedBubble(entry, bubbleClassName) {
  const label = entry.type === 'voice'
    ? t('پیام صوتی', 'Voice message')
    : isGifEntry(entry) ? t('گیف', 'GIF')
    : entry.type === 'sticker' ? t('استیکر', 'Sticker') : t('فایل', 'File');
  return `
<div class="${bubbleClassName}" data-id="${app().escapeHTML(String(entry.id || ''))}">
<div class="chat-request-masked"><i class="fas fa-eye-slash"></i> ${app().escapeHTML(t(`${label} — پس از پذیرفتن درخواست نمایش داده می‌شود`, `${label} — shown once you accept the request`))}</div>
</div>`;
}
function requestMasksEntry(peer, entry) {
  return entry?.direction === 'in' && ['file', 'voice', 'sticker'].includes(entry.type) && isMessageRequest(peer);
}

/* A call from a request: written down, not rung. Who is calling is taken
   only from what this device or its relay established — the peer id the
   call came from, and the fingerprint the relay proved for that id or for
   the frame — never from metadata the caller wrote. Somebody with no record
   at all is as much a stranger as one whose message is waiting. */
function callFromMessageRequest(peerId, { provenFingerprint = '' } = {}) {
  const id = String(peerId || '');
  const byId = id && typeof findPeerRecordByPeerId === 'function' ? findPeerRecordByPeerId(id) : null;
  const relayFp = provenFingerprint || chatState.presenceFingerprints?.get(id) || '';
  const record = byId || (relayFp ? findPeerByAnyKey(relayFp) : null);
  if (!record) return Boolean(id || relayFp);
  return !isAcceptedContact(record);
}
/* A group call rings only for a group this account accepted, or when the
   caller the relay vouched for is a contact. */
function groupCallFromRequest(message) {
  const space = (chatState.spaces?.groups || []).find((item) => item.conversationId === message?.spaceId);
  if (space) return isGroupRequest(space);
  const caller = findPeerByAnyKey(message?.provenFingerprint || '');
  return !(caller && isAcceptedContact(caller));
}

document.getElementById('chatPeerList')?.addEventListener('click', (event) => {
  if (!event.target.closest?.('[data-chat-requests-shelf]')) return;
  event.preventDefault();
  toggleRequestsView();
});

window.isMessageRequest = isMessageRequest;
window.isGroupRequest = isGroupRequest;
window.acceptMessageRequest = acceptMessageRequest;
