/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 18 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   The local file manager
*/

function normalizePeerRecord(peer = {}) {
return {
clientId: String(peer.clientId || peer.peerId || ''),
peerId: String(peer.peerId || ''),
username: String(peer.username || peer.name || ''),
name: String(peer.name || peer.username || ''),
publicKeyData: String(peer.publicKeyData || ''),
/* A fingerprint is a hex digest of the key or it is nothing. Anything else
   here used to ride into the safety-number comparison and the render paths
   verbatim. */
fingerprint: /^[a-f0-9]{16,128}$/i.test(String(peer.fingerprint || '')) ? String(peer.fingerprint) : '',
/* Their current prekey, for writing to them while they are away. */
prekeyId: String(peer.prekeyId || ''),
prekeyPublic: String(peer.prekeyPublic || ''),
prekeyExpiresAt: peer.prekeyExpiresAt || '',
status: String(peer.status || 'offline'),
/* Avatars arrive from presence records and contact cards sent by people who
   have never been verified; only a raster data: URL is ever kept. */
avatarData: sanitizeAvatarData(peer.avatarData),
/* What they say they are doing, in their own words, from their hello. */
mood: String(peer.mood || '').slice(0, 40),
conversationId: peer.conversationId || '',
lastSeenAt: peer.lastSeenAt || '',
type: peer.type || '',
members: Array.isArray(peer.members) ? [...peer.members] : undefined,
ownerFingerprint: String(peer.ownerFingerprint || ''),
manual: Boolean(peer.manual),
pinned: Boolean(peer.pinned),
pinOrder: Number(peer.pinOrder || 0),
/* ---- per-contact state that must survive a reload -----------------------
   Blocking, muting, archiving and the conversation timer were kept only on
   the in-memory record, so each one silently reset the moment the app was
   reopened — a blocked peer came back unblocked with their whole history. */
blocked: Boolean(peer.blocked),
muted: Boolean(peer.muted),
archived: Boolean(peer.archived),
timerSeconds: Number(peer.timerSeconds || 0),
/* ---- trust on first use -------------------------------------------------
   The key a contact was first seen with, kept beside the current one. The
   relay hands out public keys in its presence list, so a hostile relay could
   quietly swap one for its own and read everything from then on -- the one
   attack end-to-end encryption cannot see. Pinning the first key turns that
   silent swap into a visible event: trustedKey never moves on its own, and a
   presence record that disagrees with it raises keyChangedAt instead of
   overwriting it. verifiedAt is set only when a human compares the safety
   number aloud, and any change clears it. */
trustedKey: String(peer.trustedKey || ''),
trustedFingerprint: String(peer.trustedFingerprint || ''),
trustedAt: peer.trustedAt || '',
verifiedAt: peer.verifiedAt || '',
keyChangedAt: peer.keyChangedAt || '',
pendingKey: String(peer.pendingKey || ''),
pendingFingerprint: String(peer.pendingFingerprint || ''),
};
}
/* What the address book is allowed to keep.

   The relay hands every online client to every other one -- that is what makes
   discovery work -- and the peers message used to be merged straight into the
   saved contacts. A fresh install therefore opened with a directory of
   strangers in it, kept on disk for good, before the user had done anything at
   all. Presence still arrives and still fills chatState.peers, because the
   online list is built from it; it just no longer survives a reload.

   A record is stored once the user has actually engaged with it: added by
   hand, pinned, archived, holds a session key, or has messages. Local spaces
   and groups keep their old behaviour -- they are the user's own objects. */
function isStoredContact(peer) {
if (!peer || !peer.peerId) return false;
if (peer.type || peer.system) return true;
if (peer.manual || peer.pinned || peer.archived) return true;
if (chatState.sessionKeys?.[peer.peerId]) return true;
if (peer.fingerprint && chatState.sessionKeys?.[peer.fingerprint]) return true;
return conversationHistory(peer).length > 0;
}
/* Online, sent by the relay, and not in the book: shown in its own list and
   never written to storage. */
function discoveredPeers() {
return (chatState.peers || []).filter((peer) => (
peer.peerId && !isSelfPeerRecord(peer) && !peer.type && !peer.system
&& peer.status === 'online' && !isStoredContact(peer)
));
}
function saveContacts() {
const contacts = chatState.peers
.filter((peer) => peer.peerId && !isSelfPeerRecord(peer))
/* The one place the rule is applied, so it also cleans up what earlier
   versions saved: the boot path ends in saveContacts(). */
.filter((peer) => isStoredContact(peer))
.map((peer) => normalizePeerRecord(peer));
saveEncrypted(CHAT_CONTACTS_STORAGE_KEY, contacts);
}
/* Written into the conversation itself, so the change is still there tomorrow
   even if the banner was dismissed in a hurry today. */
/* The fingerprint is a claim until it is checked.
   It arrives inside the relay's presence record, and everything downstream
   trusts it: the safety number is computed from fingerprints, so a relay that
   sent its OWN public key alongside the VICTIM'S fingerprint would sit in the
   middle of the conversation and the safety numbers on both phones would still
   match. Recompute it here from the key that actually arrived, and use that.
   A record whose claimed fingerprint disagrees with its key is not repaired
   quietly — the computed one wins, which is what the pinning check then sees. */
async function withVerifiedFingerprint(peer = {}) {
  const publicKeyData = String(peer.publicKeyData || '');
  if (!publicKeyData) return peer;
  try {
    const raw = app().base64ToArrayBuffer(publicKeyData);
    const computed = await sha256Hex(raw);
    if (peer.fingerprint && peer.fingerprint !== computed) {
      console.warn('[chat] presence record claimed a fingerprint its key does not produce; using the computed one');
    }
    return { ...peer, fingerprint: computed };
  } catch (error) {
    /* An unreadable key is not a usable contact. */
    return { ...peer, publicKeyData: '', fingerprint: peer.fingerprint || '' };
  }
}

function noteKeyChangeInThread(peerRecord) {
  const conversationId = getConversationKey(peerRecord);
  if (!conversationId) return;
  appendHistory(conversationId, {
    id: `key-change-${Date.now()}`,
    type: 'system-note',
    direction: 'in',
    noteKind: 'key-change',
    text: t(
      'کلید امنیتی این مخاطب عوض شد. همین گفتگو ادامه دارد و پیام‌های قبلی روی همین دستگاه باقی می‌مانند، اما دیگر نمی‌توان اصالتشان را با کلید تازه سنجید — تا وقتی شمارهٔ امنیتی را از راهی جز این برنامه نسنجیده‌اید، پیام حساس نفرستید. فایل‌هایی که تا اینجا دانلود نکرده‌اید دیگر قابل بازیابی نیستند.',
      "This contact's security key changed. This same conversation continues and the earlier messages stay on this device, but they can no longer be verified against the new key — compare the safety number over some channel other than this app before sending anything sensitive. Files you have not downloaded by now cannot be retrieved any more.",
    ),
    createdAt: new Date().toISOString(),
  });
}

/* Accepting means the pinned key moves to the one being offered — the ordinary
   case of someone reinstalling. Keeping means the offered key is refused, and
   anything they send from it will not open: that is the honest consequence and
   the note says so. */
function resolveKeyChange(peerRecord, accept) {
  if (!peerRecord) return;
  /* Pin the conversation to the key it has had all along BEFORE the pinned
     fingerprint is allowed to move. getConversationKey is fingerprint-first,
     so an accepted key change used to retarget the record at a brand-new
     conversation id: the thread emptied out, the old messages became
     unreachable behind a stale key, and the whole thing read as a new chat.
     With the id anchored, the same conversation simply carries on. */
  if (!peerRecord.conversationId) {
    peerRecord.conversationId = getConversationKey(peerRecord);
  }
  const conversationId = getConversationKey(peerRecord);
  if (accept && peerRecord.pendingKey) {
    peerRecord.trustedKey = peerRecord.pendingKey;
    peerRecord.trustedFingerprint = peerRecord.pendingFingerprint || peerRecord.trustedFingerprint;
    peerRecord.publicKeyData = peerRecord.pendingKey;
    peerRecord.fingerprint = peerRecord.pendingFingerprint || peerRecord.fingerprint;
    peerRecord.trustedAt = new Date().toISOString();
  }
  peerRecord.pendingKey = '';
  peerRecord.pendingFingerprint = '';
  peerRecord.keyChangedAt = '';
  /* The session key was minted against the old key; it cannot survive either
     answer. Dropping it forces a fresh negotiation. */
  clearSessionKeysFor(peerRecord);
  /* On accept, tell them so. Their side has been holding every negotiation
     because our pin refused their new key; without this word the banner they
     see clears only on the next lucky reconnect. Control frame over the live
     channel first, sealed envelope as the fallback for the offline case. */
  if (accept) {
    const session = chatState.sessions.get(peerRecord.peerId);
    if (session?.connection?.open) {
      safeConnectionSend(session.connection, { type: 'key-accepted' }, 'key-accepted');
    } else {
      relaySessionEvent(peerRecord, { type: 'key-accepted', createdAt: new Date().toISOString() });
    }
  }
  saveContacts();
  if (conversationId) {
    appendHistory(conversationId, {
      id: `key-resolve-${Date.now()}`,
      type: 'system-note',
      direction: 'in',
      text: accept
        ? t('کلید تازه پذیرفته شد. لطفاً شمارهٔ امنیتی را دوباره بسنجید.', 'The new key was accepted. Please compare the safety number again.')
        : t('کلید تازه رد شد. پیام‌هایی که با آن فرستاده شوند باز نخواهند شد.', 'The new key was refused. Anything sent with it will not open.'),
      createdAt: new Date().toISOString(),
    });
  }
  renderActivePeer();
  renderMessages();
}

function clearSessionKeysFor(peerRecord) {
  [peerRecord?.peerId, peerRecord?.fingerprint, peerRecord?.trustedFingerprint, getConversationKey(peerRecord)]
    .filter(Boolean)
    .forEach((alias) => { delete chatState.sessionKeys[alias]; });
  chatState.sessions.get(peerRecord?.peerId)?.connection?.close?.();
  chatState.sessions.delete(peerRecord?.peerId);
  saveSessionKeys();
}

function mergePeerRecord(peer = {}, options = {}) {
const normalized = normalizePeerRecord(peer);
if (!normalized.peerId || isSelfPeerRecord(normalized)) return null;
const existing = chatState.peers.find((item) => (
(normalized.peerId && item.peerId === normalized.peerId)
|| (normalized.clientId && item.clientId === normalized.clientId)
|| (normalized.fingerprint && item.fingerprint === normalized.fingerprint)
|| (normalized.conversationId && getConversationKey(item) === normalized.conversationId)
));
const lastSeenAt = options.online ? new Date().toISOString() : (normalized.lastSeenAt || existing?.lastSeenAt || '');
if (existing) {
/* Trust on first use. The presented key is compared with the one this contact
   was first seen with; a mismatch is held aside as pendingKey and reported,
   and the trusted key stays exactly where it was until a person accepts the
   change. Without this the relay could hand over a different key and the app
   would adopt it without a word. */
const trusted = existing.trustedKey || '';
const offered = normalized.publicKeyData || '';
const keyConflict = Boolean(trusted && offered && offered !== trusted);
if (keyConflict) {
existing.pendingKey = offered;
existing.pendingFingerprint = normalized.fingerprint || '';
/* Anchor the conversation before any key can move: the alert's accept path
   swaps the fingerprint, and an unanchored record would follow it into a
   fresh conversation id — the "key change opens a new chat" breakage. */
if (!existing.conversationId) existing.conversationId = getConversationKey(existing);
if (!existing.keyChangedAt) {
existing.keyChangedAt = new Date().toISOString();
/* A key that changed is a key nobody has compared yet. Whatever was
   verified before referred to the old one. */
if (existing.trustedFingerprint) setPeerVerified(existing.trustedFingerprint, false);
noteKeyChangeInThread(existing);
}
}
Object.assign(existing, {
...normalized,
clientId: normalized.clientId || existing.clientId,
/* The conversation id is the anchor a key change must not move (see the
   conflict branch above); a presence record arriving without one must not
   wipe what was pinned. */
conversationId: normalized.conversationId || existing.conversationId || '',
/* The pinned key wins over anything the relay offers. */
publicKeyData: keyConflict ? trusted : (normalized.publicKeyData || existing.publicKeyData),
/* The prekey is what makes a queued message expire, and it has to survive a
   record that does not carry one — an identity card pasted by hand has no
   prekey, and merging it used to blank what presence had just published. The
   sender then silently fell back to the identity-wrapped seal, which never
   expires, and the fifteen-day window quietly did not apply. */
prekeyId: normalized.prekeyId || existing.prekeyId || '',
prekeyPublic: normalized.prekeyPublic || existing.prekeyPublic || '',
prekeyExpiresAt: normalized.prekeyExpiresAt || existing.prekeyExpiresAt || '',
fingerprint: keyConflict
? (existing.trustedFingerprint || existing.fingerprint)
: (normalized.fingerprint || existing.fingerprint),
trustedKey: trusted || normalized.publicKeyData || '',
trustedFingerprint: existing.trustedFingerprint || normalized.fingerprint || '',
trustedAt: existing.trustedAt || (normalized.publicKeyData ? new Date().toISOString() : ''),
verifiedAt: keyConflict ? '' : (existing.verifiedAt || ''),
keyChangedAt: keyConflict ? (existing.keyChangedAt || new Date().toISOString()) : existing.keyChangedAt || '',
pendingKey: keyConflict ? offered : (existing.pendingKey || ''),
pendingFingerprint: keyConflict ? (normalized.fingerprint || '') : (existing.pendingFingerprint || ''),
avatarData: normalized.avatarData || existing.avatarData,
mood: normalized.mood !== undefined && normalized.mood !== '' ? normalized.mood : existing.mood,
username: normalized.username || existing.username,
name: normalized.name || existing.name,
members: normalized.members || existing.members,
manual: existing.manual || normalized.manual,
pinned: existing.pinned || normalized.pinned,
pinOrder: existing.pinOrder || normalized.pinOrder,
status: options.online ? 'online' : (normalized.status || existing.status || 'offline'),
lastSeenAt,
});
return existing;
}
/* First sight is what gets pinned — unless this identity's trust was already
   revoked locally. A tombstone (26-contacts keeps them when a contact with a
   pinned key is deleted) that matches this peerId/clientId and names a
   DIFFERENT key means the person we once verified has been met again under a
   new one: pinning it silently would re-arm exactly the trust the user took
   away, so it goes through the key-change flow instead. */
const revoked = (() => {
try {
return (typeof loadRevokedTrust === 'function' ? loadRevokedTrust() : null) || [];
} catch (_error) {
return [];
}
})();
const tombstone = revoked.find((item) => (
(item.peerId && item.peerId === normalized.peerId)
|| (item.clientId && item.clientId === normalized.clientId)
)) || null;
if (tombstone && tombstone.trustedKey && normalized.publicKeyData
&& tombstone.trustedKey !== normalized.publicKeyData) {
const record = {
...normalized,
status: options.online ? 'online' : normalized.status || 'offline',
lastSeenAt,
/* The revoked key stays the pinned one; the newcomer is held as pending
   until a person compares the safety number and accepts it. */
trustedKey: tombstone.trustedKey,
trustedFingerprint: tombstone.fingerprint || '',
trustedAt: '',
verifiedAt: '',
pendingKey: normalized.publicKeyData,
pendingFingerprint: normalized.fingerprint || '',
keyChangedAt: new Date().toISOString(),
};
chatState.peers.push(record);
noteKeyChangeInThread(record);
return record;
}
const record = {
...normalized,
status: options.online ? 'online' : normalized.status || 'offline',
lastSeenAt,
trustedKey: normalized.trustedKey || normalized.publicKeyData || '',
trustedFingerprint: normalized.trustedFingerprint || normalized.fingerprint || '',
trustedAt: normalized.trustedAt || (normalized.publicKeyData ? new Date().toISOString() : ''),
};
chatState.peers.push(record);
/* The same key meeting us again after its contact was deleted is the real
person coming back, not an impersonation — retire the tombstone so it stops
forcing the pending-key path on every future merge. */
if (typeof clearRevokedTrustFor === 'function'
&& tombstone && tombstone.trustedKey === record.trustedKey) {
clearRevokedTrustFor(record);
}
return record;
}
function findPeerRecordByPeerId(peerId) {
if (!peerId) return null;
return chatState.peers.find((peer) => peer.peerId === peerId) || null;
}
function findPeerBySession(session) {
if (!session) return null;
return chatState.peers.find((peer) => (
peer.peerId === session.peerId ||
peer.fingerprint === session.remoteFingerprint ||
getConversationKey(peer) === session.conversationId
)) || null;
}
/* A WebRTC data channel does not notice the far end going away. `open` stays
 * true long after the other browser is closed, and every send path in here
 * asks that flag whether to go direct or through the relay - so a message to
 * somebody who had just left went into a dead channel, came back as sent, and
 * was never queued for them. The relay's presence list is the authority on who
 * is actually there, so when it says a peer is gone their channel is closed
 * and `open` starts telling the truth again. One place, rather than teaching
 * thirty-three call sites to distrust the flag they are reading. */
function dropStaleSessionChannels() {
const reachable = new Set();
chatState.peers.forEach((peer) => {
if (peer.type || peer.status !== 'online') return;
[peer.peerId, peer.clientId, peer.fingerprint].filter(Boolean).forEach((key) => reachable.add(key));
});
chatState.sessions.forEach((session, peerId) => {
if (!session?.connection) return;
const known = [peerId, session.peerId, session.remoteFingerprint].filter(Boolean);
if (known.some((key) => reachable.has(key))) return;
try {
session.connection.close();
} catch (_error) {
/* Already torn down at the other end; the point is only that `open` stops
   claiming otherwise. */
}
session.connection = null;
});
}
function markPeerUnavailable(peerId, message = '') {
if (!peerId) return;
const record = chatState.peers.find((peer) => peer.peerId === peerId);
let changed = false;
if (record && record.status !== 'offline') {
record.status = 'offline';
record.lastSeenAt = new Date().toISOString();
changed = true;
saveContacts();
}
if (changed) {
notify(message || t('این کاربر آفلاین شد، اما گفتگو به‌صورت محلی باقی می‌ماند.', 'This peer went offline, but the local conversation remains available.'), 'warning');
renderPeers();
renderActivePeer();
}
}
function getActiveConversation() {
return activePeer();
}
function localMembershipKeys() {
return new Set([
chatState.clientId,
chatState.peerId,
chatState.identity?.fingerprint,
chatState.profile.stablePeerId,
].filter(Boolean));
}
function spaceIncludesLocalUser(space) {
if (!space?.type) return false;
if (space.ownerPeerId && localMembershipKeys().has(space.ownerPeerId)) return true;
if (space.ownerClientId && localMembershipKeys().has(space.ownerClientId)) return true;
if (space.ownerFingerprint && space.ownerFingerprint === chatState.identity?.fingerprint) return true;
const members = Array.isArray(space.members) ? space.members : [];
if (!members.length) return true;
const mine = localMembershipKeys();
return members.some((member) => mine.has(member));
}
function selectedSpaceMembers(type = 'group') {
if (type !== 'group') return [];
const panel = document.getElementById('chatGroupMembersPanel');
if (!panel) return [];
return Array.from(panel.querySelectorAll('input[type="checkbox"]:checked'))
.map((input) => input.value)
.filter(Boolean);
}
/* The roster is everybody in the group, the reader included.
 *
 * This used to drop the local user's own keys, which reads as sensible - you
 * do not send yourself a copy - until you notice the same function normalises
 * the roster a *member* stores of a group somebody else made. Their own key
 * was stripped on the way in, and `spaceIncludesLocalUser` then went looking
 * for them in a list they had just been removed from and decided the group
 * was not theirs: it survived a restart on disk and came back inert. Dropping
 * yourself belongs at delivery time, and `groupDeliveryMemberKeys` already
 * does it as its last step. */
function normalizeSpaceMembers(members = []) {
return Array.from(new Set((Array.isArray(members) ? members : [])
.map((member) => String(member || '').trim())
.filter(Boolean)));
}
function groupDeliveryMemberKeys(space) {
const fromHistory = (chatState.history[space?.conversationId] || [])
.flatMap((entry) => [entry.senderPeerId, entry.senderFingerprint]);
const candidates = normalizeSpaceMembers([
...(Array.isArray(space?.members) ? space.members : []),
space?.ownerPeerId,
space?.ownerClientId,
space?.ownerFingerprint,
...fromHistory,
]);
/* A removal only sticks if it also beats the ways a member can still be
   named: history rows and stale rosters keep listing keys of people who were
    taken out, and without this filter they came straight back through the
    delivery list — a removed member kept receiving everything the group sent.
    Both the raw removed key and everything it resolves to are excluded, the
    same resolution the candidate list itself goes through. */
const removedKeys = new Set();
normalizeSpaceMembers(space?.removed).forEach((key) => {
removedKeys.add(key);
const resolved = findPeerByAnyKey(key);
if (resolved) {
removedKeys.add(resolved.peerId);
removedKeys.add(resolved.clientId);
removedKeys.add(resolved.fingerprint);
}
});
const seen = new Set();
return candidates
.filter((memberKey) => memberKey && !removedKeys.has(memberKey))
.map((memberKey) => {
const peer = findPeerByAnyKey(memberKey);
return peer?.peerId || peer?.clientId || peer?.fingerprint || memberKey;
})
.filter((memberKey) => {
if (!memberKey || localMembershipKeys().has(memberKey) || removedKeys.has(memberKey) || seen.has(memberKey)) return false;
seen.add(memberKey);
return true;
});
}
function findPeerByAnyKey(key) {
if (!key) return null;
return chatState.peers.find((peer) => (
getConversationKey(peer) === key
|| peer.peerId === key
|| peer.clientId === key
|| peer.fingerprint === key
)) || null;
}
function renderSpaceMemberPickers() {
const renderPanel = (id, labelText) => {
const panel = document.getElementById(id);
if (!panel) return;
const peers = chatState.peers
.filter((peer) => peer.peerId && !peer.type && !isSelfPeerRecord(peer))
.sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'));
if (!peers.length) {
panel.innerHTML = `<div class="chat-member-picker-empty">${t('برای انتخاب عضو، ابتدا کاربر آنلاین یا مخاطب داشته باشید.', 'Add or discover contacts before choosing members.')}</div>`;
return;
}
panel.innerHTML = `
<div class="chat-member-picker-title">${labelText}</div>
${peers.map((peer) => {
const name = peer.username || peer.name || peer.peerId;
return `
<label class="chat-member-option">
<input type="checkbox" value="${app().escapeHTML(getConversationKey(peer))}" ${peer.status === 'online' ? 'checked' : ''}>
<span class="chat-peer-presence-dot ${peer.status === 'online' ? 'online' : 'offline'}"></span>
<span>${app().escapeHTML(name)}</span>
</label>
`;
}).join('')}
`;
};
renderPanel('chatGroupMembersPanel', t('اعضای گروه', 'Group members'));
}
function memberDisplayName(memberKey) {
const peer = findPeerByAnyKey(memberKey);
return peer?.username || peer?.name || peer?.peerId || memberKey;
}
function messageSenderLabel(entry, conversation) {
if (!conversation?.type) return '';
if (entry.senderName) return entry.senderName;
if (entry.direction === 'out') return chatState.profile.name || t('شما', 'You');
return memberDisplayName(entry.senderPeerId || entry.senderFingerprint || '');
}
/* The face beside the name, in a group. A name alone makes a busy group hard
   to read at a glance: several people, several similar names, and every line
   looking the same. Falls back to initials, which is what the roster and the
   conversation list already do, so the same person looks the same everywhere. */
function messageSenderAvatar(entry, conversation) {
  if (!conversation?.type) return '';
  const own = entry.direction === 'out';
  const peer = own ? null : findPeerByAnyKey(entry.senderPeerId || entry.senderFingerprint || '');
  const image = own ? (chatState.profile.avatarData || '') : (peer?.avatarData || '');
  const name = messageSenderLabel(entry, conversation) || '?';
  return `<span class="chat-message-avatar">${image
    ? `<img src="${app().escapeHTML(image)}" alt="">`
    : app().escapeHTML(initials(name))}</span>`;
}
function renderSpaceMemberManager() {
const panel = document.getElementById('chatSpaceMembersPanel');
if (!panel) return;
const space = getActiveConversation();
const visible = Boolean(space?.type === 'group' && chatState.activeView === 'groups');
panel.classList.toggle('hidden', !visible);
if (!visible) {
panel.innerHTML = '';
return;
}
const peers = chatState.peers
.filter((peer) => peer.peerId && !peer.type && !isSelfPeerRecord(peer))
.sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'));
const normalizedMembers = normalizeSpaceMembers(space.members);
const members = new Set(normalizedMembers);
const memberPeers = peers.filter((peer) => (
members.has(peer.peerId)
|| members.has(peer.clientId)
|| members.has(peer.fingerprint)
|| members.has(getConversationKey(peer))
));
const avatarMarkup = space.avatarData
? `<img src="${space.avatarData}" alt="">`
: app().escapeHTML(initials(space.name || 'G'));
panel.innerHTML = `
<div class="chat-space-profile-editor">
<button id="chatGroupAvatarBtn" type="button" class="chat-space-avatar-btn" title="${app().escapeHTML(t('تغییر عکس گروه', 'Change group picture'))}">${avatarMarkup}</button>
<input id="chatGroupNameEditInput" class="chat-space-name-input" type="text" value="${app().escapeHTML(space.name || '')}" placeholder="${app().escapeHTML(t('نام گروه', 'Group name'))}">
<button id="chatSaveGroupDetailsBtn" type="button" class="chat-space-save-btn">${t('ذخیره مشخصات', 'Save details')}</button>
</div>
<div class="chat-space-members-head">
<div>
<strong>${app().escapeHTML(space.name || '')}</strong>
<span>${t('اعضای گروه', 'Group members')} · ${members.size}</span>
</div>
<button id="chatSaveSpaceMembersBtn" type="button" class="chat-space-save-btn">${t('ذخیره اعضا', 'Save members')}</button>
</div>
<div class="chat-space-current-members">
${memberPeers.length ? memberPeers.map((peer) => `
<div class="chat-space-current-member">
<span class="chat-peer-presence-dot ${peer.status === 'online' ? 'online' : 'offline'}"></span>
<span>${app().escapeHTML(peer.username || peer.name || peer.peerId)}</span>
<small>${peer.status === 'online' ? t('آنلاین', 'Online') : t('آفلاین', 'Offline')}</small>
</div>
`).join('') : `<div class="chat-member-picker-empty">${t('هنوز عضوی برای این گروه انتخاب نشده است.', 'No members are selected for this group yet.')}</div>`}
</div>
<details class="chat-space-member-accordion" open>
<summary>${t('مدیریت اعضای محلی', 'Manage local members')}</summary>
<div class="chat-space-members-list">
${peers.length ? peers.map((peer) => {
const key = peer.peerId || getConversationKey(peer);
const checked = members.has(key) || members.has(peer.peerId) || members.has(peer.clientId) || members.has(peer.fingerprint) || members.has(getConversationKey(peer));
return `
<label class="chat-member-option">
<input type="checkbox" value="${app().escapeHTML(key)}" ${checked ? 'checked' : ''}>
<span class="chat-peer-presence-dot ${peer.status === 'online' ? 'online' : 'offline'}"></span>
<span>${app().escapeHTML(peer.username || peer.name || peer.peerId)}</span>
<small>${peer.status === 'online' ? t('آنلاین', 'Online') : t('آفلاین', 'Offline')}</small>
</label>
`;
}).join('') : `<div class="chat-member-picker-empty">${t('هنوز مخاطبی برای مدیریت اعضا وجود ندارد.', 'No contacts are available for member management yet.')}</div>`}
</div>
</details>
`;
panel.querySelector('#chatGroupAvatarBtn')?.addEventListener('click', () => {
document.getElementById('chatGroupAvatarInput')?.click();
});
panel.querySelector('#chatSaveGroupDetailsBtn')?.addEventListener('click', () => {
const nextName = panel.querySelector('#chatGroupNameEditInput')?.value.trim();
if (nextName) space.name = nextName;
space.members = normalizeSpaceMembers(space.members);
saveSpaces();
broadcastSpaceRecord(space);
renderPeers();
renderActivePeer();
renderSpaceMemberManager();
notify(t('مشخصات گروه ذخیره شد.', 'Group details saved.'), 'success');
});
panel.querySelector('#chatSaveSpaceMembersBtn')?.addEventListener('click', () => {
space.members = normalizeSpaceMembers(Array.from(panel.querySelectorAll('input[type="checkbox"]:checked'))
.map((input) => input.value)
.filter(Boolean));
saveSpaces();
broadcastSpaceRecord(space);
renderPeers();
renderSpaceMemberManager();
notify(t('اعضای فضا ذخیره شدند.', 'Members saved.'), 'success');
});
}
function notifyTyping() {
const peer = activePeer();
if (!peer || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return;
const now = Date.now();
if (chatState.lastTypingSentAt && now - chatState.lastTypingSentAt < 3000) return;
chatState.lastTypingSentAt = now;
sendRelayEnvelope(peer, { type: 'typing' });
}
function handleRemoteTyping(fingerprint) {
const peer = chatState.peers.find((p) => p.fingerprint === fingerprint);
if (!peer) return;
const key = getConversationKey(peer);
if (chatState.typingTimers.has(key)) {
clearTimeout(chatState.typingTimers.get(key));
}
const timer = setTimeout(() => {
chatState.typingTimers.delete(key);
renderActivePeer();
}, 4000);
chatState.typingTimers.set(key, timer);
renderActivePeer();
}
function initials(name) {
const clean = String(name || 'P').trim();
return clean.slice(0, 1).toUpperCase() || 'P';
}
function formatTime(value) {
try {
return new Date(value || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
} catch (_error) {
return '';
}
}
function formatCountdown(expiresAt) {
if (!expiresAt) return '';
const diff = Date.parse(expiresAt) - Date.now();
if (diff <= 0) return '0s';
const totalSeconds = Math.floor(diff / 1000);
if (totalSeconds < 60) return `${totalSeconds}s`;
const minutes = Math.floor(totalSeconds / 60);
const seconds = totalSeconds % 60;
if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`;
const hours = Math.floor(minutes / 60);
const remMinutes = minutes % 60;
return `${hours}:${String(remMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
/* h:mm:ss once an hour has passed, m:ss before that.
 *
 * Minutes used to run without a ceiling, so an hour and a half of talking read
 * as "90:45" — a number nobody converts in their head, and one that looks like
 * a mistake beside a clock. Every call surface goes through here: the calls
 * list, the label above a call in progress, and the group call stage. */
function formatDuration(ms = 0) {
const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
const hours = Math.floor(totalSeconds / 3600);
const minutes = Math.floor((totalSeconds % 3600) / 60);
const seconds = totalSeconds % 60;
if (hours > 0) {
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
function formatTimerLabel(seconds) {
if (!seconds) return t('بدون تایمر', 'No timer');
if (seconds < 60) return t(`${seconds} ثانیه`, `${seconds}s`);
if (seconds < 3600) return t(`${Math.round(seconds / 60)} دقیقه`, `${Math.round(seconds / 60)}m`);
return t(`${Math.round(seconds / 3600)} ساعت`, `${Math.round(seconds / 3600)}h`);
}
function formatTimerBadge(seconds) {
if (!seconds) return '';
if (seconds < 60) return `${seconds}s`;
if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
return `${Math.round(seconds / 3600)}h`;
}
function currentReactorId() {
return chatState.clientId || chatState.peerId || chatState.identity?.fingerprint || 'local-user';
}
function currentReactorCandidates() {
return new Set([
chatState.clientId,
chatState.peerId,
chatState.identity?.fingerprint,
].filter(Boolean));
}
function resolveRemoteReactorId(session, message) {
const localIds = currentReactorCandidates();
const incomingCandidates = [
message?.reactorId,
message?.clientId,
message?.peerId,
message?.fingerprint,
].filter(Boolean);
const incoming = incomingCandidates.find((candidate) => !localIds.has(candidate));
if (incoming) return incoming;
return session?.remoteClientId || session?.peerId || session?.remoteFingerprint || 'remote-user';
}
function normalizeMessageReactions(entry) {
if (!entry) return {};
if (entry.reactions && typeof entry.reactions === 'object' && !Array.isArray(entry.reactions)) {
return { ...entry.reactions };
}
if (entry.reaction) {
return { legacy: entry.reaction };
}
return {};
}
function summarizeMessageReactions(entry) {
const reactions = normalizeMessageReactions(entry);
const tally = new Map();
Object.values(reactions).forEach((emoji) => {
if (!emoji) return;
tally.set(emoji, (tally.get(emoji) || 0) + 1);
});
return Array.from(tally.entries()).map(([emoji, count]) => ({ emoji, count }));
}
function applyMessageReaction(entry, reaction, reactorId = currentReactorId()) {
if (!entry || !reactorId) return;
const reactions = normalizeMessageReactions(entry);
if (!reaction) delete reactions[reactorId];
else reactions[reactorId] = reaction;
entry.reactions = reactions;
delete entry.reaction;
}
function syncTimerUi() {
const badge = document.getElementById('chatTimerBadge');
const toggle = document.getElementById('chatTimerToggleBtn');
const popover = document.getElementById('chatTimerPopover');
const seconds = Number(chatState.timerSeconds || 0);
if (badge) {
badge.textContent = formatTimerBadge(seconds);
badge.classList.toggle('hidden', !seconds);
}
if (toggle) {
toggle.classList.toggle('active', Boolean(seconds));
toggle.setAttribute('title', seconds ? formatTimerLabel(seconds) : t('پیام خودتخریب', 'Self-destruct message'));
}
if (popover) {
popover.classList.toggle('hidden', !chatState.timerPopoverOpen);
popover.querySelectorAll('[data-chat-timer]').forEach((button) => {
button.classList.toggle('active', Number(button.getAttribute('data-chat-timer') || 0) === seconds);
});
if (chatState.timerPopoverOpen) {
positionTimerPopover();
requestAnimationFrame(positionTimerPopover);
window.setTimeout(positionTimerPopover, 0);
}
}
}
function toggleTimerPopover(force) {
chatState.timerPopoverOpen = typeof force === 'boolean' ? force : !chatState.timerPopoverOpen;
syncTimerUi();
}
function setTimerSeconds(seconds) {
chatState.timerSeconds = Number(seconds || 0);
chatState.timerPopoverOpen = false;
/* The timer used to live only in chatState, so setting it in one
   conversation and switching away silently carried it into the next one.
   It is written onto the conversation record here, and normalizePeerRecord
   keeps it across reloads; the switch path reads it back. */
const record = activePeer();
if (record && !isSelfPeerRecord(record)) {
record.timerSeconds = chatState.timerSeconds;
if (record.type) saveSpaces();
else saveContacts();
}
syncTimerUi();
}
function detectComposerDirection(value) {
const text = String(value || '');
const RTL_STRONG = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
const LTR_STRONG = /[A-Za-z\u00C0-\u02AF\u0370-\u058F\u2C00-\uD7FF]/;
// The first STRONG character decides, the way the Unicode bidi algorithm does
// it. Reading only charAt(0) called "123 hello" and "!Salam" right-to-left,
// because digits, punctuation and spaces carry no direction of their own.
for (const ch of text) {
if (RTL_STRONG.test(ch)) return 'rtl';
if (LTR_STRONG.test(ch)) return 'ltr';
}
return language() === 'fa' ? 'rtl' : 'ltr';
}
function positionTimerPopover() {
const popover = document.getElementById('chatTimerPopover');
const toggle = document.getElementById('chatTimerToggleBtn');
if (!popover || !toggle || popover.classList.contains('hidden')) return;
// Modern check for mobile/PWA standalone
const isMobile = document.documentElement.classList.contains('mobile-browser-context') ||
window.matchMedia('(max-width: 767px)').matches;
if (isMobile) {
// Let CSS handle mobile placement, but clear desktop inline overrides first.
['position', 'z-index', 'top', 'right', 'bottom', 'left', 'inset', 'inset-inline-start', 'inset-inline-end'].forEach((property) => {
popover.style.removeProperty(property);
});
return;
}
const toggleRect = toggle.getBoundingClientRect();
const popoverHeight = popover.offsetHeight || 220;
const popoverWidth = popover.offsetWidth || 180;
// Older responsive override blocks use !important, so desktop placement must
// be set with matching priority after every toggle/open.
popover.style.setProperty('position', 'fixed', 'important');
popover.style.setProperty('z-index', '99999', 'important');
popover.style.setProperty('bottom', 'auto', 'important');
popover.style.setProperty('right', 'auto', 'important');
popover.style.setProperty('inset', 'auto', 'important');
popover.style.setProperty('inset-inline-start', 'auto', 'important');
popover.style.setProperty('inset-inline-end', 'auto', 'important');
// Default: Above the toggle
let top = toggleRect.top - popoverHeight - 10;
let left = toggleRect.right - popoverWidth;
// Boundary checks
if (top < 10) {
// Show below if no space above
top = toggleRect.bottom + 10;
}
if (left < 10) left = 10;
if (left + popoverWidth > window.innerWidth - 10) {
left = window.innerWidth - popoverWidth - 10;
}
popover.style.setProperty('left', left + 'px', 'important');
popover.style.setProperty('top', top + 'px', 'important');
}
// One place that decides how every delivery state looks, so the glyph, the
// colour and the tooltip can never drift apart. 'seen' and 'delivered' both
// drew ✓✓ before, which left no way to tell a read message from a delivered one.
function statusMeta(status) {
switch (status) {
case 'seen':
case 'opened':
return { label: '✓✓', cls: 'is-seen', title: t('خوانده شد', 'Read') };
case 'delivered':
return { label: '✓✓', cls: 'is-delivered', title: t('تحویل داده شد', 'Delivered') };
case 'sent':
return { label: '✓', cls: 'is-sent', title: t('ارسال شد', 'Sent') };
case 'relayed':
return { label: '✓', cls: 'is-relayed', title: t('به سرور سپرده شد؛ در انتظار دریافت', 'Stored on the relay, waiting for the peer') };
case 'queued':
return { label: '🕐', cls: 'is-queued', title: t('در انتظار ارسال', 'Waiting to send') };
case 'failed':
return { label: '!', cls: 'is-failed', title: t('ارسال نشد', 'Not sent') };
default:
return { label: '🕐', cls: 'is-pending', title: t('در حال ارسال', 'Sending') };
}
}
function statusLabel(status) {
return statusMeta(status).label;
}
function pruneExpiredHistory() {
const now = Date.now();
let changed = false;
Object.keys(chatState.history).forEach((key) => {
const current = chatState.history[key];
if (!Array.isArray(current)) return;
const next = current.filter((entry) => {
if (!entry || !entry.expiresAt) return true;
const expiry = Date.parse(entry.expiresAt);
const alive = !isNaN(expiry) && expiry > now;
/* Leaving the ciphertext behind would make "self-destruct" a lie: the
   message row disappears while the bytes sit in IndexedDB forever. */
if (!alive && isMediaEntry(entry)) dropMessageMedia(entry.id);
return alive;
});
if (next.length !== current.length) {
chatState.history[key] = next;
changed = true;
}
});
return changed;
}
function scheduleExpirySweep() {
if (chatState.expiryTimer) {
clearTimeout(chatState.expiryTimer);
chatState.expiryTimer = null;
}
let nextExpiry = Infinity;
Object.values(chatState.history).forEach((items) => {
(items || []).forEach((entry) => {
if (!entry.expiresAt) return;
const stamp = Date.parse(entry.expiresAt);
if (!isNaN(stamp) && stamp > Date.now()) nextExpiry = Math.min(nextExpiry, stamp);
});
});
if (!Number.isFinite(nextExpiry)) return;
chatState.expiryTimer = setTimeout(() => {
if (pruneExpiredHistory()) storeHistory();
renderPeers();
renderMessages();
scheduleExpirySweep();
}, Math.max(250, nextExpiry - Date.now() + 50));
}
function saveSessionKeys() {
saveEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, chatState.sessionKeys);
}
async function persistSessionKey(session, rawKey) {
const key = session.peerId || session.remoteFingerprint;
if (!key || !rawKey) return;
const record = {
rawKey: app().arrayBufferToBase64(rawKey),
fingerprint: session.remoteFingerprint || '',
conversationId: session.conversationId || '',
updatedAt: new Date().toISOString(),
/* Kept so the key can be retired on age rather than living as long as the
   contact does. A key nobody has replaced for a week is a week of recorded
   traffic that one stolen device would open. */
createdAt: new Date().toISOString(),
};
chatState.sessionKeys[key] = record;
if (session.remoteFingerprint) chatState.sessionKeys[session.remoteFingerprint] = record;
if (session.conversationId) chatState.sessionKeys[session.conversationId] = record;
saveSessionKeys();
}
function forgetSessionKey(session) {
[session?.peerId, session?.remoteFingerprint, session?.conversationId]
.filter(Boolean)
.forEach((alias) => { delete chatState.sessionKeys[alias]; });
saveSessionKeys();
}
// Both ends learn both fingerprints from session-hello, so they can agree on a
// single key owner without another round trip. Whoever's fingerprint sorts
// first generates the AES key; the other side only ever accepts one. Letting
// both sides generate is how they ended up encrypting under different keys.
function sessionKeyOwner(session) {
const mine = chatState.identity?.fingerprint || '';
const theirs = session?.remoteFingerprint || '';
if (!mine || !theirs) return Boolean(session?.initiator);
return mine < theirs;
}
function requestSessionKey(session) {
if (!session?.connection?.open) return false;
return safeConnectionSend(session.connection, {
type: 'chat-key-request',
fingerprint: chatState.identity?.fingerprint || '',
}, 'chat-key-request');
}
async function renegotiateSessionKey(session) {
forgetSessionKey(session);
session.cryptoKey = null;
session.keySource = '';
session.keyNegotiatedFor = null;
session.keyReady = false;
if (sessionKeyOwner(session)) {
await ensureSessionKey(session, {
peerId: session.peerId,
clientId: session.remoteClientId,
publicKeyData: session.remotePublicKeyData,
fingerprint: session.remoteFingerprint,
});
return;
}
requestSessionKey(session);
}
async function hydrateSessionKey(session) {
if (session.cryptoKey) return;
const stored = chatState.sessionKeys[session.peerId] || chatState.sessionKeys[session.remoteFingerprint] || chatState.sessionKeys[session.conversationId];
if (!stored?.rawKey) return;
// A stored key belongs to the identity it was negotiated with. Once the peer
// resets their key their fingerprint changes, and reviving the old key here
// is what made both ends talk past each other for good.
if (session.remoteFingerprint && stored.fingerprint && stored.fingerprint !== session.remoteFingerprint) {
forgetSessionKey(session);
return;
}
/* And a key has an age. Past its lifetime it is dropped rather than revived,
   which forces a fresh exchange and takes everything older than that out of
   reach of a device opened tomorrow. */
const bornAt = Date.parse(stored.createdAt || stored.updatedAt || 0);
if (bornAt && Date.now() - bornAt > SESSION_KEY_LIFETIME_MS) {
console.info('[Chat] a stored session key passed its lifetime and was dropped.');
forgetSessionKey(session);
return;
}
session.cryptoKey = await crypto.subtle.importKey(
'raw',
app().base64ToArrayBuffer(stored.rawKey),
{ name: 'AES-GCM' },
true,
['encrypt', 'decrypt']
);
session.keySource = 'stored';
session.keyReady = true;
}
async function sha256Hex(buffer) {
const hash = await crypto.subtle.digest('SHA-256', buffer);
return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
