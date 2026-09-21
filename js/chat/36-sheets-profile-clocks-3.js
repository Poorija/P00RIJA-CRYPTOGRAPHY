/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 36 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Full-screen sheets, the profile card, and the world clocks
*/

function syncComposerHeight(el) {
if (!el) return false;
const oldHeight = el.style.height;
el.style.height = 'auto';
const nextHeight = Math.min(150, el.scrollHeight);
el.style.height = nextHeight + 'px';
return oldHeight !== el.style.height;
}
function clearMessageContext() {
chatState.replyToId = '';
chatState.editingMessageId = '';
const ctx = document.getElementById('chatComposerContext');
if (ctx) ctx.classList.add('hidden');
const composer = document.getElementById('chatComposer');
if (composer) {
composer.placeholder = t('پیام امن شما…', 'Your secure message...');
}
}
function handleReplyMessage(messageId) {
const peer = getActiveConversation();
if (!peer) return;
const history = chatState.history[getConversationKey(peer)] || [];
const entry = history.find(m => m.id === messageId);
if (!entry) return;
chatState.replyToId = messageId;
chatState.editingMessageId = '';
const ctx = document.getElementById('chatComposerContext');
const title = document.getElementById('chatContextTitle');
const text = document.getElementById('chatContextText');
const icon = ctx?.querySelector('.chat-context-icon i');
if (ctx && title && text) {
title.textContent = entry.direction === 'out' ? t('پاسخ به خودتان', 'Reply to yourself') : t('پاسخ به', 'Reply to') + ' ' + (peer.username || peer.name || t('کاربر', 'User'));
text.textContent = entry.text || mediaEntryLabel(entry) || t('فایل', 'File');
if (icon) {
icon.className = 'fas fa-reply';
}
ctx.classList.remove('hidden');
}
focusComposerWithoutPageJump();
}
function handleEditMessage(messageId) {
const peer = getActiveConversation();
if (!peer) return;
const history = chatState.history[getConversationKey(peer)] || [];
const entry = history.find(m => m.id === messageId);
if (!entry || entry.direction !== 'out' || entry.type !== 'text') return;
chatState.editingMessageId = messageId;
chatState.replyToId = '';
const ctx = document.getElementById('chatComposerContext');
const title = document.getElementById('chatContextTitle');
const text = document.getElementById('chatContextText');
const icon = ctx?.querySelector('.chat-context-icon i');
if (ctx && title && text) {
title.textContent = t('ویرایش پیام', 'Edit message');
text.textContent = entry.text;
if (icon) {
icon.className = 'fas fa-pen';
}
ctx.classList.remove('hidden');
}
const composer = document.getElementById('chatComposer');
if (composer) {
composer.value = entry.text;
focusComposerWithoutPageJump(composer);
syncComposerHeight(composer);
}
}
async function finalizeMessageEdit(messageId, newText) {
const peer = getActiveConversation();
if (!peer) return;
const key = getConversationKey(peer);
const history = chatState.history[key] || [];
const entry = history.find(m => m.id === messageId);
if (!entry) return;
entry.text = newText;
entry.edited = true;
// Editing changes the text, not whether the peer already received or read it.
// Forcing 'queued' here put a pending clock back on messages that had already
// been delivered and seen — Telegram and WhatsApp both keep the ticks.
if (!entry.status || entry.status === 'failed') entry.status = 'queued';
storeHistory();
renderMessages();
clearMessageContext();
const composer = document.getElementById('chatComposer');
if (composer) {
composer.value = '';
composer.style.height = '';
/* Same reason as the send paths: clearing the box in code fires no input
   event, so the edited text would otherwise stay filed as a draft. */
setDraft(chatState.activeConversationId, '');
}
/* A group has no single peer to open a session with, so the edit used to
stop here: the sender saw the new text and every member kept the old one
forever. Fan the edit out over each member's pairwise session instead,
tagged with the group's conversation key so the receiver finds the entry in
the GROUP's history rather than the member's 1:1 thread. */
if (peer.type === 'group' || peer.type === 'channel' || (!peer.fingerprint && !peer.peerId)) {
const memberKeys = typeof groupDeliveryMemberKeys === 'function' ? groupDeliveryMemberKeys(peer) : [];
await Promise.all(memberKeys.map(async (memberKey) => {
try {
const member = typeof findPeerByAnyKey === 'function' ? findPeerByAnyKey(memberKey) : null;
if (!member) return;
const memberSession = await ensureDirectSession(member);
if (!memberSession) return;
const memberPayload = await encryptForSession(memberSession, new TextEncoder().encode(newText));
relaySessionEvent(member, {
type: 'edit',
messageId,
conversationId: key,
payload: memberPayload,
createdAt: new Date().toISOString()
});
} catch (error) {
console.warn('[Chat] group edit fanout failed for a member:', error);
}
}));
return;
}
const session = await ensureDirectSession(peer);
if (session) {
const payload = await encryptForSession(session, new TextEncoder().encode(newText));
const delivered = relaySessionEvent(peer, {
type: 'edit',
messageId,
payload,
createdAt: new Date().toISOString()
});
// Only a message that had not landed yet gets its state advanced here.
if (entry.status === 'queued') {
markMessageStatus(key, messageId, delivered ? 'sent' : 'queued');
}
}
}
function handlePinMessage(messageId) {
const peer = getActiveConversation();
if (!peer) return;
const key = getConversationKey(peer);
const history = chatState.history[key] || [];
const entry = history.find((item) => item.id === messageId);
if (!entry) return;
entry.pinned = !entry.pinned;
storeHistory();
renderMessages();
notify(entry.pinned ? t('پیام سنجاق شد.', 'Message pinned.') : t('پیام از سنجاق خارج شد.', 'Message unpinned.'), 'success');
}
function forwardEntryLabel(entry) {
if (!entry) return '';
if (entry.text) return entry.text;
if (entry.type === 'sticker' || entry.type === 'rich') return mediaEntryLabel(entry);
if (entry.name) return entry.name;
if (entry.type === 'voice') return t('پیام صوتی', 'Voice message');
if (entry.type === 'file') return t('فایل', 'File');
if (entry.type === 'call-log') return callHistoryText(entry);
return t('پیام', 'Message');
}
function forwardDestinations() {
const activeKey = getConversationKey(getActiveConversation());
const seen = new Set();
// Built from chatState.peers, which is a different set than the list the user
// is looking at: threads recovered from history never appeared, and records
// the list had merged could appear twice under competing keys. Offer exactly
// what the conversation list shows.
const direct = allConversationRecords()
.filter((peer) => peer.type !== 'group')
.filter((peer) => !isSelfPeerRecord(peer))
.filter((peer) => getConversationKey(peer) && getConversationKey(peer) !== activeKey)
.map((peer) => ({
key: getConversationKey(peer),
icon: 'fa-user-lock',
label: peer.username || peer.name || peer.peerId || t('کاربر', 'User'),
hint: peer.status === 'online' ? t('آنلاین', 'Online') : t('آفلاین', 'Offline'),
}));
const spaces = chatState.spaces.groups
.filter((space) => getConversationKey(space) && getConversationKey(space) !== activeKey)
.map((space) => ({
key: getConversationKey(space),
icon: 'fa-user-group',
label: space.name,
hint: t('گروه', 'Group'),
}));
return [...direct, ...spaces].filter((item) => {
if (!item.key || seen.has(item.key)) return false;
seen.add(item.key);
return true;
});
}
function ensureForwardModal() {
let modal = document.getElementById('chatForwardModal');
if (modal) return modal;
modal = document.createElement('div');
modal.id = 'chatForwardModal';
modal.className = 'chat-forward-modal hidden';
document.body.appendChild(modal);
return modal;
}
function closeForwardModal() {
chatState.activeForwardMessageId = '';
const modal = document.getElementById('chatForwardModal');
modal?.classList.add('hidden');
}
async function forwardEntryToDestination(entry, destinationKey) {
const text = forwardEntryLabel(entry).trim();
if (!destinationKey) return;
if (!text && !entry?.downloadUrl) return;
const target = allConversationRecords().find((record) => getConversationKey(record) === destinationKey);
if (!target) {
notify(t('مقصد هدایت پیدا نشد.', 'Forward destination not found.'), 'warning');
return;
}
closeForwardModal();
// This used to write the message straight into local history with
// status 'sent' and announce success — while nothing was ever transmitted.
// The message existed on this device only, which is exactly why it never
// reached anyone. Route it through the real send path instead, so it gets
// encrypted, delivered, acknowledged and status-tracked like any other.
chatState.activePeerClientId = target.clientId || '';
chatState.activeConversationId = destinationKey;
renderPeers();
renderActivePeer();
// Confirm the switch actually landed on the destination. Sending blind here
// once dropped the forward into whatever conversation happened to resolve.
const resolved = activePeer();
if (!resolved || getConversationKey(resolved) !== destinationKey) {
notify(t('مقصد هدایت باز نشد؛ گفتگو را دستی باز کنید.', 'Could not open the forward destination; open the chat manually.'), 'warning');
return;
}
// Media forwards used to arrive as the words "Forwarded: Sticker" — the
// label, not the thing. The bytes are already local (downloadUrl is an object
// URL over the decrypted blob), so re-send them through the same encrypted
// transfer instead of describing them.
const mediaKinds = ['sticker', 'voice', 'file'];
if (mediaKinds.includes(entry.type) && entry.downloadUrl) {
try {
const blob = await (await fetch(entry.downloadUrl)).blob();
const file = new File([blob], entry.name || `${entry.type}.bin`, { type: blob.type || entry.mime || 'application/octet-stream' });
await sendEncryptedBlob(file, entry.type, entry.durationMs || 0,
entry.type === 'sticker'
? { stickerKind: entry.stickerKind || stickerKindForName(entry.name || '', blob.type), stickerEmoji: entry.stickerEmoji || '' }
: {});
return;
} catch (error) {
console.warn('[Forward] media re-send failed, falling back to a text forward', error);
}
}
const composer = document.getElementById('chatComposer');
if (!composer) return;
composer.value = `${t('هدایت‌شده', 'Forwarded')}: ${text}`;
syncComposerDirection();
syncComposerHeight(composer);
await sendMessage();
}
function openForwardModal(entry) {
const destinations = forwardDestinations();
const composer = document.getElementById('chatComposer');
if (!destinations.length) {
if (composer) {
composer.value = `${t('هدایت‌شده', 'Forwarded')}: ${forwardEntryLabel(entry)}`;
focusComposerWithoutPageJump(composer);
syncComposerDirection();
syncComposerHeight(composer);
}
notify(t('مقصد دیگری پیدا نشد؛ متن در کادر پیام آماده شد.', 'No other destination was found; the text is ready in the composer.'), 'info');
return;
}
const modal = ensureForwardModal();
modal.innerHTML = `
<div class="chat-forward-backdrop" data-chat-forward-close></div>
<section class="chat-forward-card" role="dialog" aria-modal="true">
<div class="chat-forward-head">
<div>
<h4>${t('هدایت پیام', 'Forward message')}</h4>
<p>${app().escapeHTML(forwardEntryLabel(entry)).slice(0, 120)}</p>
</div>
<button type="button" data-chat-forward-close aria-label="${app().escapeHTML(t('بستن', 'Close'))}">
<i class="fas fa-xmark"></i>
</button>
</div>
<div class="chat-forward-list">
${destinations.map((item) => `
<button type="button" data-chat-forward-destination="${app().escapeHTML(item.key)}">
<i class="fas ${item.icon}"></i>
<span>${app().escapeHTML(item.label)}</span>
<small>${app().escapeHTML(item.hint)}</small>
</button>
`).join('')}
</div>
</section>
`;
modal.classList.remove('hidden');
modal.querySelectorAll('[data-chat-forward-close]').forEach((button) => {
button.addEventListener('click', closeForwardModal);
});
modal.querySelectorAll('[data-chat-forward-destination]').forEach((button) => {
button.addEventListener('click', () => {
const destination = button.getAttribute('data-chat-forward-destination') || '';
/* One picker for the whole selection, rather than one per message. */
if (chatState.selectionMode && selectionCount() > 0) forwardSelectionTo(destination);
else forwardEntryToDestination(entry, destination);
});
});
}
function handleForwardMessage(messageId) {
const peer = getActiveConversation();
if (!peer) return;
const history = chatState.history[getConversationKey(peer)] || [];
const entry = history.find((item) => item.id === messageId);
if (!entry) return;
chatState.activeForwardMessageId = messageId;
openForwardModal(entry);
}
async function initChatModule() {
if (!document.getElementById('content-chat')) return;
/* Returns false when the vault is still shut, which at module-load time it
   normally is. The poorija:unlock listener calls this again the moment the
   profile is open, and that is the call that actually loads anything. */
loadPersistedChatState();
bindDomEvents();
renderStaticUi();
maybeAskRelayOnboarding();
/* Before the first render: both of these move existing nodes, and moving them
   after something has measured or scrolled them is how layouts jump. */
buildChatSettingsTabs();
buildChatGroupCollapsibles();
bindCallLogActions();
renderPeers();
renderActivePeer();
setChatView(chatState.activeView);
syncTimerUi();
refreshCallControls();
// IndexedDB reads are async and nothing above depends on them, so let the rest
// of init proceed; the picker and the sound selects redraw when they land.
refreshChatLockState();
startChatLockWatcher();
loadStickerPacks().catch((error) => console.warn('[Stickers] init failed', error));
loadCustomSounds().catch((error) => console.warn('[Sounds] init failed', error));
renderStorageCard().catch((error) => console.warn('[Vault] stats failed', error));
if (isUnlocked()) {
await ensureIdentity();
renderStaticUi();
await hydrateRelayTurnConfig();
if (chatState.profile.autoConnect && appState()?.activeTab === 'chat') {
await connectChatTransport();
}
}
// Every messenger keeps checking whether it can get back online; nobody
// should have to press "reconnect" by hand. This supervisor runs for the whole
// session and covers the cases the socket-level watchdog cannot see — a
// transport that never came up in the first place, or one whose reconnect
// bookkeeping was reset.
setInterval(() => {
if (!isUnlocked() || !chatState.profile.autoConnect) return;
/* "Not fully up" is not the same as "should be up". A transport that was
   deliberately taken down — the Disconnect button, a harness stepping a device
   away — and one belonging to an install that has just wiped itself both look
   exactly like a transport that failed to come up, and this loop used to
   rebuild all three alike. It was the only reconnect path in the module that
   read neither flag. */
if (chatState.manualOffline || chatState.wiped) return;
if (hasActiveServerRestriction() || chatState.transportConnectInFlight) return;
const relayUp = chatState.ws?.readyState === WebSocket.OPEN;
const peerUp = Boolean(chatState.peer && chatState.peer.open && !chatState.peer.destroyed);
if (relayUp && peerUp) return;
console.log('[Transport] Supervisor: transport is not fully up, reconnecting.');
connectChatTransport().catch(console.error);
}, 12000);
setInterval(() => {
const expired = pruneExpiredHistory();
if (expired) {
storeHistory();
renderPeers();
renderMessages();
} else {
// Update live countdown labels without full re-render if possible
document.querySelectorAll('.chat-timer-countdown').forEach(el => {
const expires = el.dataset.expires;
if (expires) el.innerHTML = `<i class="fas fa-stopwatch animate-pulse"></i> ${formatCountdown(expires)}`;
});
}
}, 1000);
}
let isChatInitialized = false;
async function lazyInitChatModule() {
if (isChatInitialized) return;
isChatInitialized = true;
await initChatModule();
}
/* Test hooks. The relay hands every device the same discovered identities, so
   an automated run cannot reliably produce a contact card for someone the
   receiver does not already know; these let a harness stage that case. They
   read and write nothing a user action could not. */
window.__injectRichContact = (conversationId, rich) => {
appendHistory(conversationId, {
id: generateId('rich'),
direction: 'in',
type: 'rich',
rich,
status: 'delivered',
createdAt: new Date().toISOString(),
});
renderMessages();
};
window.__peerFingerprints = () => chatState.peers.map((peer) => peer.fingerprint);
/* Stages a call log without placing thirty calls. The records go through
   appendCall, so they are exactly the records a real call writes. */
window.__seedCallLog = (entries) => {
(entries || []).forEach((entry) => appendCall({ logToChat: false, standalone: true, ...entry }));
return chatState.calls.length;
};
/* Lets a harness stage a contact that carries a real profile photo, which is
   the case that used to stall. */
window.__redeemGroupInvite = (code) => redeemGroupInvite(code);
/* Test hook: stand a group up in one call, the way a member-adding flow
   would — owner here, one fingerprint per member. Used by the retention
   suites; writes only what the group UI can. */
window.__groupCreate = (name, memberFingerprints = []) => {
  const me = chatState.identity?.fingerprint || '';
  const space = upsertSharedSpace({
    type: 'group',
    name: String(name || 'harness group'),
    conversationId: `group:harness-${Date.now()}`,
    members: normalizeSpaceMembers([me, ...memberFingerprints]),
    ownerFingerprint: me,
    ownerPeerId: chatState.peerId || '',
    createdAt: new Date().toISOString(),
  });
  saveSpaces?.();
  renderPeers();
  return space ? { conversationId: space.conversationId } : null;
};
window.__spaceMembers = () => {
const space = activeGroupSpace();
if (!space) return null;
return { members: space.members, admins: space.admins, removed: space.removed, rev: space.rev };
};
window.__whySendFails = () => {
const composer = document.getElementById('chatComposer');
return {
guard: guardGroupSend('sendMessages'),
voiceDraft: Boolean(chatState.voiceDraft),
text: composer?.value.trim(),
editing: chatState.editingMessageId,
peer: getActiveConversation()?.conversationId || getActiveConversation()?.peerId || null,
peerType: getActiveConversation()?.type || null,
timerSeconds: chatState.timerSeconds,
activeConversationId: chatState.activeConversationId,
};
};
window.__sendGuardDebug = () => {
const space = activeGroupSpace();
return {
isGroup: Boolean(space),
role: space ? localSpaceRole(space) : null,
canManage: space ? canManageSpace(space) : null,
perms: space ? spacePermissions(space) : null,
mayPost: space ? memberMay(space, 'sendMessages') : null,
ownerFields: space ? [space.ownerPeerId, space.ownerClientId, space.ownerFingerprint] : null,
myKeys: [...localMembershipKeys()],
composer: document.getElementById('chatComposer')?.value,
sendDisabled: document.getElementById('chatSendMessageBtn')?.disabled,
};
};
window.__mentionDebug = () => {
const composer = document.getElementById('chatComposer');
const space = activeGroupSpace();
return {
hasComposer: Boolean(composer),
hasBox: Boolean(document.getElementById('chatMentionPicker')),
isGroup: Boolean(space),
value: composer?.value,
caret: composer?.selectionStart,
query: space && composer ? currentMentionQuery(composer) : null,
candidates: space ? mentionCandidates('').map((row) => row.name) : [],
};
};
/* Test hook, alongside the ones above: the call log is written from a dozen
   protocol paths, and the only way to exercise the de-duplication without two
   real phones is to replay those events. */
window.__callLogProbe = {
  append: (entry) => appendCall(entry),
  rows: () => (chatState.calls || []).map((call) => ({ id: call.id, status: call.status, mode: call.mode, unread: call.unread !== false })),
  clear: () => { chatState.calls = []; saveCalls(); renderCalls(); },
  activeConversationId: () => chatState.activeConversationId || '',
};

/* What the address book keeps versus what is only passing through: the
   difference is invisible from the DOM once a reload has happened, so the
   stored side has to be readable directly. */
window.__contactsProbe = {
  stored: () => (loadEncrypted(CHAT_CONTACTS_STORAGE_KEY, []) || []).map((peer) => peer.peerId),
  book: () => contactBookRecords().map((peer) => peer.peerId),
  online: () => discoveredPeers().map((peer) => peer.peerId),
  adopt: (peerId) => adoptDiscoveredPeer(peerId),
};

/* The lock's own set/verify pair, so a test can prove that a PIN typed on one
   keyboard opens a lock set on another without reaching into the digest. */
window.__chatLockProbe = {
  enable: (pin) => enableChatLock(pin),
  tryUnlock: (pin) => tryUnlockChat(pin),
  disable: pin => disableChatLock(pin),
};

/* For the locked-receive suite: the P2P data channels are closed without
   touching presence (exactly the suspended-webview shape a locked background
   native app shows), so the next message has to travel as a sealed relay
   envelope; the media vault answers whether its key is usable under lock. */
window.__lockedReceiveProbe = {
  dropPeerChannels: () => {
    let closed = 0;
    chatState.sessions.forEach((session) => {
      if (session.connection) {
        try { session.connection.close(); } catch (_error) { /* already gone */ }
        session.connection = null;
        closed += 1;
      }
    });
    return closed;
  },
  mediaKeyState: async () => {
    try { await ensureMediaKey(); return 'ok'; } catch (error) { return String(error?.message || error); }
  },
  prekeyCount: () => (chatState.prekeys || []).length,
};

/* Whether a call is up, and which kind -- the redial path has to be provable
   from the outside without reading a hidden video element's state. */
window.__callStateProbe = () => ({
  mode: chatState.currentCallMode || '',
  direction: chatState.currentCallDirection || '',
  busy: isCallBusy(),
  live: Boolean(chatState.currentCall),
  pendingCall: Boolean(chatState.pendingIncomingCall),
  pendingInvite: Boolean(chatState.pendingIncomingInvite),
  ending: Boolean(chatState.endingCurrentCall),
});

/* What the settings panel in app.js needs from the chat module: who this
   device is, and which relay it talks to. Push has to be registered against
   that relay, which is not always this page's origin. */
/* Test hooks for the key-trust suite: what the app currently believes about
   the peer it is talking to, and a way to make an identity genuinely change
   the way a reinstall would. Both read and write only what a user action
   already can. */
window.__peerProbe = () => {
  const peer = activePeer();
  if (!peer) return null;
  return {
    peerId: peer.peerId || '',
    clientId: peer.clientId || '',
    conversationId: peer.conversationId || '',
    fingerprint: peer.fingerprint || '',
    publicKeyData: peer.publicKeyData || '',
    trustedKey: peer.trustedKey || '',
    trustedFingerprint: peer.trustedFingerprint || '',
    keyChangedAt: peer.keyChangedAt || '',
    pendingKey: peer.pendingKey || '',
    pendingFingerprint: peer.pendingFingerprint || '',
  };
};
/* Delivers a peers frame exactly as the relay's socket would, so a hostile
   presence record can be exercised without a hostile server. */
window.__injectPeersFrame = async (peerRecord) => {
  const verified = await withVerifiedFingerprint(peerRecord);
  mergePeerRecord(verified, { online: true });
  saveContacts();
  renderPeers();
  renderActivePeer();
  return { fingerprint: verified.fingerprint, hasKey: Boolean(verified.publicKeyData) };
};
window.__lastPeerId = () => activePeer()?.peerId || '';
window.__keyFingerprints = async () => {
  const out = [];
  for (const [id, session] of chatState.sessions.entries()) {
    let fp = '(none)';
    if (session.cryptoKey) {
      try {
        const raw = await crypto.subtle.exportKey('raw', session.cryptoKey);
        fp = (await sha256Hex(raw)).slice(0, 12);
      } catch (e) { fp = '(unexportable)'; }
    }
    out.push({ peer: String(id).slice(0, 12), key: fp, source: session.keySource || '', ready: Boolean(session.keyReady) });
  }
  return out;
};
/* What the forward-secrecy suite needs to see: whether an envelope carried a
   prekey exchange or the old identity wrap, and what happens to a queued
   message once its prekey window has closed. */
window.__peerPrekeyProbe = () => {
  const peer = activePeer();
  return peer ? { prekeyId: peer.prekeyId || '', hasPublic: Boolean(peer.prekeyPublic),
    expiresAt: peer.prekeyExpiresAt || '' } : null;
};
window.__spacesProbe = () => (chatState.spaces?.groups || []).map((g) => ({ id: g.id, name: g.name, members: (g.members||[]).length }));
/* The counted form above hides exactly what group bugs turn on: which keys a
   member list actually holds, and whether the receiver counts itself in. */
window.__spacesDeepProbe = () => (chatState.spaces?.groups || []).map((g) => ({
  conversationId: g.conversationId,
  name: g.name,
  rev: Number(g.rev || 0),
  members: [...(g.members || [])],
  admins: [...(g.admins || [])],
  ownerFingerprint: g.ownerFingerprint || '',
  ownerPeerId: g.ownerPeerId || '',
  deleted: Boolean(g.deleted),
  dissolved: Boolean(g.dissolved),
  includesMe: spaceIncludesLocalUser(g),
  myRole: localSpaceRole(g),
}));
/* Walks the exact decision the group send loop makes, one member at a time,
   and says where it would give up. The loop skips silently on three different
   conditions and a silent skip is indistinguishable from a delivery. */
window.__spacePermsProbe = () => SPACE_PERMISSIONS.slice();
window.__memberMayProbe = (conversationId, permission) => {
  const space = (chatState.spaces?.groups || []).find((g) => g.conversationId === conversationId);
  return space ? memberMay(space, permission) : null;
};
window.__canManageProbe = (conversationId) => {
  const space = (chatState.spaces?.groups || []).find((g) => g.conversationId === conversationId);
  return space ? canManageSpace(space) : null;
};
window.__historyProbe = (conversationId) => (chatState.history[conversationId] || [])
  .map((entry) => ({ id: entry.id, type: entry.type, dir: entry.direction, text: String(entry.text || '').slice(0, 60), status: entry.status, unread: entry.unread === true, seenAckSent: entry.seenAckSent === true }));
/* Test hook: stage a whole conversation's history at once. Writes only what
   a received message could — same store, same shapes — for the search and
   windowing suites. */
window.__historySet = (conversationId, entries) => {
  chatState.history[conversationId] = (entries || []).map((entry) => ({ status: 'delivered', ...entry }));
  storeHistory();
  renderPeers();
  renderMessages();
  return (chatState.history[conversationId] || []).length;
};
window.__groupSendProbe = async (conversationId) => {
  const space = (chatState.spaces?.groups || []).find((g) => g.conversationId === conversationId);
  if (!space) return { error: 'no such group' };
  const keys = groupDeliveryMemberKeys(space);
  const rows = [];
  for (const key of keys) {
    const member = findPeerByAnyKey(key);
    if (!member) { rows.push({ key: key.slice(0, 12), stop: 'no peer record' }); continue; }
    if (isSelfPeerRecord(member)) { rows.push({ key: key.slice(0, 12), stop: 'is self' }); continue; }
    let session = await ensureStoredSession(member);
    let via = session?.cryptoKey ? 'stored' : '';
    if (!session?.cryptoKey) {
      session = await ensureDirectSession(member, { silent: true });
      via = session?.cryptoKey ? 'minted' : '';
    }
    if (!session?.cryptoKey) { rows.push({ key: key.slice(0, 12), name: member.username, status: member.status, stop: 'no session key' }); continue; }
    rows.push({
      key: key.slice(0, 12), name: member.username, status: member.status, sessionFrom: via,
      live: Boolean(session.connection?.open),
      route: session.connection?.open ? 'direct' : 'sealed relay',
      hasPrekey: Boolean(member.prekeyPublic), hasFingerprint: Boolean(member.fingerprint),
    });
  }
  return { deliveryKeys: keys.length, rows };
};
window.__groupDeliveryProbe = (conversationId) => {
  const space = (chatState.spaces?.groups || []).find((g) => g.conversationId === conversationId);
  return space ? groupDeliveryMemberKeys(space) : null;
};
window.__membershipProbe = () => ({
  keys: [...localMembershipKeys()],
  clientId: chatState.clientId || '',
  peerId: chatState.peerId || '',
  fingerprint: chatState.identity?.fingerprint || '',
  stablePeerId: chatState.profile?.stablePeerId || '',
});
window.__peersProbe = () => chatState.peers.map((p) => ({
  username: p.username || '',
  status: p.status || '',
  type: p.type || '',
  key: getConversationKey(p),
  hasFingerprint: Boolean(p.fingerprint),
  hasClientId: Boolean(p.clientId),
}));
window.__prekeyProbe = () => ({
  count: (chatState.prekeys || []).length,
  current: (chatState.prekeys || []).slice(-1)[0]?.id || '',
  expiresAt: (chatState.prekeys || []).slice(-1)[0]?.expiresAt || '',
  lifetimeDays: PREKEY_LIFETIME_MS / 86400000,
});
/* Ages the stored prekeys as if the window had passed, exactly as the boot
   sweep would once the clock got there. */
window.__expirePrekeys = () => {
  const aged = loadPrekeys().map((entry) => ({ ...entry, expiresAt: new Date(Date.now() - 1000).toISOString() }));
  savePrekeys(aged);
  const live = prunePrekeys(aged);
  chatState.prekeys = live;
  savePrekeys(live);
  return { left: live.length };
};
window.__sessionKeyAges = () => Object.entries(chatState.sessionKeys || {}).map(([alias, record]) => ({
  alias: String(alias).slice(0, 12),
  createdAt: record?.createdAt || '',
}));

window.__sessionProbe = () => [...chatState.sessions.entries()].map(([id, session]) => ({
  peer: String(id).slice(0, 12),
  keyReady: Boolean(session.keyReady), keySource: session.keySource || '',
  hasKey: Boolean(session.cryptoKey), kexPending: Boolean(session.kexPrivate),
  hasRemoteKey: Boolean(session.remotePublicKeyData),
  open: Boolean(session.connection?.open),
}));
window.__allPeersProbe = () => (chatState.peers || []).map((p) => ({
  peerId: (p.peerId || '').slice(0, 10),
  fp: (p.fingerprint || '').slice(0, 10),
  trusted: (p.trustedKey || '').slice(0, 10),
  pendingKey: (p.pendingKey || '').slice(0, 10),
  pendingFp: (p.pendingFingerprint || '').slice(0, 10),
  changed: Boolean(p.keyChangedAt),
}));

window.__resetIdentityProbe = async () => {
  /* What rotateIdentity() does, without its confirmation dialog. */
  localStorage.removeItem(CHAT_IDENTITY_STORAGE_KEY);
  localStorage.removeItem(CHAT_SESSION_KEYS_STORAGE_KEY);
  chatState.identity = null;
  chatState.sessionKeys = {};
  chatState.sessions.clear();
  await ensureIdentity();
  renderStaticUi();
  broadcastHello();
  return chatState.identity?.fingerprint || '';
};

/* The chat module's part of an emergency wipe: ask the relay to drop
   everything it holds for this identity, then blank every key and message this
   module is holding in memory. Called by the app-wide wipe, which owns the
   storage and reload side. */
async function emergencyWipeChat({ purgeRelay = true, waitMs = 1500 } = {}) {
  const report = { relayPurged: false, removed: 0 };
  /* An open connection blocks deleteDatabase — the delete fires, the browser
     answers "blocked", and the database is still there. Close the handles this
     module is holding before anybody tries to delete them. */
  try {
    const media = await mediaDbPromise?.catch?.(() => null);
    media?.close?.();
    mediaDbPromise = null;
  } catch (error) { /* never opened */ }
  try {
    const stickers = await stickerDbPromise?.catch?.(() => null);
    stickers?.close?.();
    stickerDbPromise = null;
  } catch (error) { /* never opened */ }
  try {
    if (purgeRelay && chatState.ws?.readyState === WebSocket.OPEN) {
      const purged = new Promise((resolve) => {
        const onMessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data?.type === 'purged') {
              chatState.ws.removeEventListener('message', onMessage);
              resolve({ ok: true, removed: Number(data.removed || 0) });
            }
          } catch (error) { /* not ours */ }
        };
        chatState.ws.addEventListener('message', onMessage);
        setTimeout(() => {
          chatState.ws?.removeEventListener?.('message', onMessage);
          resolve({ ok: false, removed: 0 });
        }, waitMs);
      });
      chatState.ws.send(JSON.stringify({ type: 'purge-me' }));
      const outcome = await purged;
      report.relayPurged = outcome.ok;
      report.removed = outcome.removed;
    }
  } catch (error) {
    console.warn('[Wipe] the relay could not be asked to purge:', error);
  }
  /* Nothing may rebuild what is about to be deleted. Closing the socket wakes
     the reconnect logic, which calls ensureIdentity(), which read the identity
     back out of storage — storage that had not been cleared yet — and put it
     straight back in memory. The flag holds for the rest of this page's life;
     the reload is what starts a clean one. */
  chatState.wiped = true;
  encryptedStoreCache.clear();
  unreadableChatStores.clear();
  chatState.shouldReconnect = false;
  try { clearReconnectTimer(); } catch (error) { /* never scheduled */ }
  try {
    if (chatState.heartbeatTimer) { clearInterval(chatState.heartbeatTimer); chatState.heartbeatTimer = null; }
  } catch (error) { /* none running */ }

  /* Sessions carry live keys; close them before dropping the references. */
  try {
    chatState.sessions.forEach((session) => {
      session.cryptoKey = null;
      session.kexPrivate = '';
      try { session.connection?.close?.(); } catch (error) { /* already gone */ }
    });
    chatState.sessions.clear();
  } catch (error) { /* nothing to close */ }
  try { chatState.peer?.destroy?.(); } catch (error) { /* already gone */ }
  try { chatState.ws?.close?.(); } catch (error) { /* already gone */ }
  /* Every field that could hold a key, a message or an identity. */
  chatState.identity = null;
  chatState.prekeys = [];
  chatState.sessionKeys = {};
  chatState.history = {};
  chatState.peers = [];
  chatState.calls = [];
  chatState.drafts = {};
  chatState.spaces = { groups: [], channels: [] };
  chatState.pendingIncomingCall = null;
  chatState.pendingIncomingInvite = null;
  chatState.currentCall = null;
  chatState.ws = null;
  chatState.peer = null;
  chatState.peerId = '';
  chatState.clientId = '';
  chatState.profile = { name: '', avatarData: '', mood: '', serverUrl: '', autoConnect: false };
  /* So an automated check can tell a wipe that ran from one that was skipped. */
  window.__chatWipedAt = Date.now();
  return report;
}
window.__emergencyWipeChat = emergencyWipeChat;

window.PoorijaChat = Object.assign(window.PoorijaChat || {}, {
  emergencyWipe: emergencyWipeChat,
  identityFingerprint: () => chatState.identity?.fingerprint || '',
  /* The fingerprint, loading or minting the identity if this page has not
     needed it yet.
     identityFingerprint() above reads a cache that is only filled once the
     messenger has started. Somebody who unlocks the app and goes straight to
     Settings has an empty one — and background notifications are keyed on it,
     so switching them on from there failed with nothing to explain it. This is
     what that switch should ask instead. */
  ensureIdentityFingerprint: async () => {
    try {
      const identity = await ensureIdentity();
      return identity?.fingerprint || '';
    } catch (error) {
      console.warn('[Chat] identity could not be prepared:', error?.message || error);
      return '';
    }
  },
  serverOrigin: () => chatServerOrigin(),
  /* The standalone vault tab reads the same index Secure Chat's own file
     manager reads, so the two can never disagree about what is stored. The
     sticker and sound entries live in chatState, so the module has to be up
     before the answer is complete. */
  /* Reading what is on the device must not start the messenger: opening a file
     list is not a reason to fetch TURN config or claim a relay identity. The
     three sources are plain IndexedDB reads, so load them and nothing else. */
  listVaultFiles: async () => {
    await ensureVaultSources();
    return collectLocalFiles();
  },
  renderFileManager: async () => {
    await ensureVaultSources();
    return renderFileManager();
  },
  vaultLock: () => ({
    state: vaultLockState,
    enable: enableVaultLock,
    tryUnlock: tryUnlockVault,
    biometric: tryUnlockVaultBiometric,
    activatePolicy: password => verifyVaultPassword(password, { activatePolicy: true }),
    biometricAvailable: lockBiometricAvailable,
    disable: disableVaultLock,
    lock: lockVaultNow,
    extraTabs: vaultLockExtraTabs,
    setExtraTabs: setVaultLockExtraTabs,
  }),
  formatVaultBytes,
  /* Dropping this device off the relay without wiping it, so a harness can
     watch what the other side reads when somebody goes away. */
  goOffline: () => {
    /* The watchdog exists to bring a dropped connection back, so it has to be
       stopped first or this undoes itself a few seconds later. */
    if (chatState.wsWatchdogTimer) {
      clearInterval(chatState.wsWatchdogTimer);
      chatState.wsWatchdogTimer = null;
    }
    chatState.manualOffline = true;
    try { chatState.ws?.close(); } catch (_error) { /* already gone */ }
    chatState.ws = null;
    return true;
  },
  goOnline: () => {
    chatState.manualOffline = false;
    connectPresence();
    startTransportWatchdog();
    return true;
  },
});

window.__attachAvatar = (dataUrl) => {
const target = chatState.peers.find((peer) => !isSelfPeerRecord(peer) && peer.fingerprint);
if (!target) return false;
target.avatarData = dataUrl;
saveContacts();
return true;
};
window.addEventListener('poorija:unlock', (e) => {
if (e.detail.activeTab === 'chat') lazyInitChatModule();
/* The lock may not have been readable when the module booted. */
setTimeout(() => refreshChatLockState(), 400);
/* Neither was the remembered sticker pack, for exactly the same reason. */
setTimeout(() => { try { resolveActiveStickerPack(); } catch (_error) { /* packs not loaded */ } }, 600);
});
window.addEventListener('poorija:tab-switched', (e) => {
if (e.detail.tabName === 'chat') {
lazyInitChatModule();
setTimeout(() => refreshChatLockState(), 200);
}
});
// Also try to init on load if already unlocked (rare case)
window.addEventListener('load', () => {
const appState = window.PoorijaApp?.state;
if (appState && !appState.isLocked && appState.activeTab === 'chat') {
lazyInitChatModule();
}
});
