/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 19 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Forward secrecy
*/

/* =====================================================================
   Forward secrecy
   ---------------------------------------------------------------------
   The identity key is an RSA-OAEP pair that never changes. Wrapping every
   session key to it means one compromise of that key opens everything ever
   recorded — which is the whole of what forward secrecy is about.

   Two ECDH layers sit on top of it, both P-256 because that is what every
   browser's WebCrypto actually has:

   LIVE SESSIONS (both sides connected). Each side makes an ephemeral pair,
   sends the PUBLIC half to the other encrypted to their pinned identity key,
   and throws the private half away when the session ends. The identity key
   only ever protects the delivery of a public value, so learning it later
   reveals nothing: without an ephemeral private key there is no shared secret
   to recover.

   OFFLINE MESSAGES (recipient not there). They cannot take part, so they
   publish a prekey in advance and rotate it. The sender does ECDH against
   whichever prekey is current, and the recipient keeps that private prekey
   only until it expires. After PREKEY_LIFETIME_MS an undelivered message is
   not "hard to read" — the key it needs no longer exists on any device.
   ===================================================================== */
const CHAT_PREKEY_STORAGE_KEY = 'poorija_chat_prekeys';
/* Fifteen days, and the app says so before anyone relies on it. */
const PREKEY_LIFETIME_MS = 15 * 24 * 60 * 60 * 1000;
/* A live session's key is re-negotiated at least this often, so a device that
   stays open for months is not still using the key it derived in January. */
const SESSION_KEY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

async function exportEcdhPublic(keyPair) {
  return app().arrayBufferToBase64(await crypto.subtle.exportKey('spki', keyPair.publicKey));
}
async function importEcdhPublic(base64) {
  return crypto.subtle.importKey('spki', app().base64ToArrayBuffer(base64),
    { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}
async function importEcdhPrivate(base64) {
  return crypto.subtle.importKey('pkcs8', app().base64ToArrayBuffer(base64),
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}
async function generateEcdhPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    publicKeyData: await exportEcdhPublic(pair),
    privateKeyData: app().arrayBufferToBase64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    keyPair: pair,
  };
}
/* HKDF over the raw ECDH output, so the AES key is not the curve point itself
   and the two directions cannot collide with anything else derived here. */
async function deriveSharedAesKey(privateKey, publicKey, info) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(info) },
    material, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
}

/* ---- the published prekey, and the ones still inside their window ------- */
function loadPrekeys() {
  const stored = loadEncrypted(CHAT_PREKEY_STORAGE_KEY, null);
  return Array.isArray(stored) ? stored : [];
}
function savePrekeys(list) {
  saveEncrypted(CHAT_PREKEY_STORAGE_KEY, list);
}
/* Expired prekeys are deleted, not archived. That deletion IS the feature. */
function prunePrekeys(list) {
  const now = Date.now();
  return list.filter((entry) => Date.parse(entry.expiresAt || 0) > now);
}
async function ensurePrekey() {
  if (!isUnlocked()) return null;
  let prekeys = prunePrekeys(loadPrekeys());
  const now = Date.now();
  /* Rotate at a third of the lifetime, so a message sent just before a
     rotation still has most of its window left. */
  const current = prekeys.find((entry) => Date.parse(entry.createdAt || 0) > now - PREKEY_LIFETIME_MS / 3);
  if (current) {
    savePrekeys(prekeys);
    chatState.prekeys = prekeys;
    return current;
  }
  const pair = await generateEcdhPair();
  const entry = {
    id: generateId('pk'),
    publicKeyData: pair.publicKeyData,
    privateKeyData: pair.privateKeyData,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PREKEY_LIFETIME_MS).toISOString(),
  };
  prekeys = [...prekeys, entry].slice(-4);
  savePrekeys(prekeys);
  chatState.prekeys = prekeys;
  return entry;
}
function findPrekey(id) {
if (!id) return null;
const now = Date.now();
/* The live list first. This is called on every arriving envelope, including
   ones that land while the app is locked — reading only storage there once
   made every locked-interval envelope look past its window, and the relay
   destroyed real mail on the strength of that. */
const live = (chatState.prekeys || []).find((entry) => entry.id === id
  && Date.parse(entry.expiresAt || 0) > now);
if (live) return live;
return prunePrekeys(loadPrekeys()).find((entry) => entry.id === id) || null;
}

let chatIdentityInitialization = null;
window.addEventListener('poorija:lock', () => { chatIdentityInitialization = null; });
async function ensureIdentity() {
  const address = chatStorageAddress(CHAT_IDENTITY_STORAGE_KEY);
  if (chatIdentityInitialization?.address === address) return chatIdentityInitialization.promise;
  const operation = { address, promise: null };
  chatIdentityInitialization = operation;
  operation.promise = initializeChatIdentity(operation);
  try { return await operation.promise; }
  finally { if (chatIdentityInitialization === operation) chatIdentityInitialization = null; }
}
async function initializeChatIdentity(operation) {
/* After an emergency wipe this page does not get another identity. */
if (chatState.wiped) return null;
if (chatState.identity?.publicKeyData && chatState.identity?.privateKeyData) {
return chatState.identity;
}
const stored = loadEncrypted(CHAT_IDENTITY_STORAGE_KEY, null);
if (stored?.publicKeyData && stored?.privateKeyData) {
chatState.identity = stored;
await ensurePrekey();
return stored;
}
if (!isUnlocked()) return null;
const keyPair = await crypto.subtle.generateKey({
name: 'RSA-OAEP',
modulusLength: 3072,
publicExponent: new Uint8Array([1, 0, 1]),
hash: 'SHA-256',
}, true, ['encrypt', 'decrypt']);
const exportedPublic = await crypto.subtle.exportKey('spki', keyPair.publicKey);
const exportedPrivate = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
const identity = {
publicKeyData: app().arrayBufferToBase64(exportedPublic),
privateKeyData: app().arrayBufferToBase64(exportedPrivate),
fingerprint: await sha256Hex(exportedPublic),
createdAt: new Date().toISOString(),
};
// RSA generation can overlap startup, Copy/QR, import, or a profile lock.
// Never publish a second identity or write one into a different vault.
if (chatState.wiped || !isUnlocked() || chatIdentityInitialization !== operation
  || operation.address !== chatStorageAddress(CHAT_IDENTITY_STORAGE_KEY)) return null;
if (chatState.identity?.publicKeyData && chatState.identity?.privateKeyData) return chatState.identity;
chatState.identity = identity;
saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, identity);
await ensurePrekey();
return identity;
}
async function importIdentityPublicKey(publicKeyData) {
return crypto.subtle.importKey(
'spki',
app().base64ToArrayBuffer(publicKeyData),
{ name: 'RSA-OAEP', hash: 'SHA-256' },
false,
['encrypt']
);
}
async function importIdentityPrivateKey() {
const identity = await ensureIdentity();
return crypto.subtle.importKey(
'pkcs8',
app().base64ToArrayBuffer(identity.privateKeyData),
{ name: 'RSA-OAEP', hash: 'SHA-256' },
false,
['decrypt']
);
}
function activePeer() {
const wantedClient = chatState.activePeerClientId || '';
const wantedKey = chatState.activeConversationId || '';
if (!wantedClient && !wantedKey) return null;
const records = allConversationRecords();
// The conversation key is the stable identity; a relay clientId is a UUID the
// presence server hands out fresh on every reconnect. Matching either in one
// pass let `find` return whichever record came first in the array, so a stale
// clientId could resolve to a different conversation than the one selected —
// the thread then read an unrelated key and rendered empty while the list
// preview, which uses the right record, still showed the messages.
// An empty id must never match a record that also has none.
const byKey = wantedKey
? records.find((peer) => getConversationKey(peer) === wantedKey)
: null;
if (byKey) return byKey;
return (wantedClient ? records.find((peer) => peer.clientId === wantedClient) : null) || null;
}
function activeSession() {
const peer = activePeer();
if (!peer || peer.clientId === 'system') return null;
return chatState.sessions.get(peer.peerId) || null;
}
function isCompactChatLayout() {
return window.matchMedia?.('(max-width: 1023px)').matches || false;
}
function updateChatShellMode() {
const shell = document.querySelector('.chat-shell');
if (!shell) return;
const hasConversation = Boolean(getActiveConversation());
shell.classList.toggle('chat-has-conversation', hasConversation);
['chats', 'calls', 'groups', 'connection'].forEach((view) => {
shell.classList.toggle(`chat-view-${view}`, chatState.activeView === view);
});
document.documentElement.classList.toggle('chat-screen-active', appState()?.activeTab === 'chat');
document.documentElement.classList.toggle('chat-conversation-active', hasConversation);
refreshComposerFocusFlag();
}

/* chat-composer-focused hides the phone's tab bar, which is right while you
   are typing and wrong the moment you are not. It was set when a conversation
   opened and cleared only by the composer's own blur event — an event that
   never fires when the composer is hidden by a class change instead. So going
   back to the list left the flag on and the bar gone, until a tap somewhere
   blurred something and it reappeared. Re-deriving it from what is actually
   focused, at every point the view changes, is the fix. */
function refreshComposerFocusFlag() {
const composer = document.getElementById('chatComposer');
const live = Boolean(composer)
&& document.activeElement === composer
&& composer.getBoundingClientRect().height > 0;
syncComposerViewportFocus(live);
}
function conversationHistory(record) {
const key = getConversationKey(record);
return key ? (chatState.history[key] || []) : [];
}
function saveSpaces() {
chatState.spaces.channels = [];
saveEncrypted(CHAT_SPACES_STORAGE_KEY, {
groups: chatState.spaces.groups,
channels: [],
});
}
function upsertSharedSpace(space) {
if (!space?.conversationId || !space?.type) return null;
if (space.type !== 'group') return null;
if (!spaceIncludesLocalUser(space)) return null;
const collection = chatState.spaces.groups;
const members = normalizeSpaceMembers(space.members);
/* A removal has to win over the union, whatever order the records arrive in:
   both sides know somebody left, so merging without subtracting puts them
   straight back. The removed list can name a member by any of their keys, so
   each candidate is also tested through the peer record it resolves to —
   the same key set broadcastSpaceRecord membership uses. */
const removed = new Set([...normalizeSpaceMembers(space.removed || [])]);
const isRemovedMember = (memberKey) => {
if (removed.has(memberKey)) return true;
const peer = findPeerByAnyKey(memberKey);
return Boolean(peer) && [getConversationKey(peer), peer.peerId, peer.clientId, peer.fingerprint]
.filter(Boolean).some((key) => removed.has(key));
};
const existing = collection.find((item) => item.conversationId === space.conversationId);
if (existing) {
/* Merging member lists is right when two devices learn about the same group
   from different directions, and wrong the moment somebody is removed — the
   union puts them straight back. A record carrying a newer revision is a
   deliberate edit, so it replaces instead of merging. */
const incomingRev = Number(space.rev || 0);
const currentRev = Number(existing.rev || 0);
const authoritative = incomingRev > currentRev;
normalizeSpaceMembers(existing.removed || []).forEach((key) => removed.add(key));
const mergedMembers = (authoritative ? members : normalizeSpaceMembers([
...normalizeSpaceMembers(existing.members),
...members,
space.ownerPeerId,
space.ownerClientId,
space.ownerFingerprint,
])).filter((memberKey) => !isRemovedMember(memberKey));
Object.assign(existing, {
...existing,
...space,
type: 'group',
rev: Math.max(incomingRev, currentRev),
admins: authoritative
  ? normalizeSpaceMembers(space.admins)
  : normalizeSpaceMembers([...(existing.admins || []), ...(space.admins || [])]),
removed: normalizeSpaceMembers([...(existing.removed || []), ...(space.removed || [])]),
description: space.description !== undefined ? space.description : existing.description,
avatarData: space.avatarData !== undefined ? space.avatarData : existing.avatarData,
ownerPeerId: space.ownerPeerId || existing.ownerPeerId || '',
ownerClientId: space.ownerClientId || existing.ownerClientId || '',
ownerFingerprint: space.ownerFingerprint || existing.ownerFingerprint || '',
members: mergedMembers.length || authoritative ? mergedMembers : normalizeSpaceMembers(existing.members),
});
saveSpaces();
return existing;
}
collection.unshift({
...space,
type: 'group',
ownerPeerId: space.ownerPeerId || '',
ownerClientId: space.ownerClientId || '',
ownerFingerprint: space.ownerFingerprint || '',
members: members.filter((memberKey) => !isRemovedMember(memberKey)),
});
saveSpaces();
return collection[0];
}
function broadcastSpaceRecord(space, note = '') {
if (!space) return;
const memberSet = new Set(Array.isArray(space.members) ? space.members : []);
const isMember = (peer) => {
if (peer.type || isSelfPeerRecord(peer)) return false;
if (!memberSet.size) return true;
return memberSet.has(getConversationKey(peer)) || memberSet.has(peer.peerId) || memberSet.has(peer.clientId) || memberSet.has(peer.fingerprint);
};
const payload = () => ({
type: 'space-sync',
space,
note: note || '',
createdAt: new Date().toISOString(),
});
chatState.peers
.filter((peer) => peer.status === 'online' && isMember(peer))
.forEach((peer) => {
sendRelayEnvelope(peer, payload());
});
/* A removal has to reach the people who were offline when it happened, or the
   roster they come back to still lists the removed member forever. The relay
   queue is the same road offline 1:1 traffic takes: sendRelayEnvelope with a
   non-ephemeral type is persisted by the relay until the recipient returns,
   and the space-sync handler on the other side applies it then. Fire-and-forget
   per member — one failure must not stop the rest being queued. */
chatState.peers
.filter((peer) => peer.status !== 'online' && isMember(peer))
.forEach((peer) => {
try {
sendRelayEnvelope(peer, payload());
} catch (error) {
console.warn('[Space] an offline member could not be sent the space record', error);
}
});
}
/* The log holds this many calls, newest first. */
const CALL_LOG_LIMIT = 80;
function saveCalls() {
/* Newest first, so the cap has to take from the front. slice(-80) kept the
   *oldest* eighty — harmless only because appendCall already trims. */
saveEncrypted(CHAT_CALLS_STORAGE_KEY, chatState.calls.slice(0, CALL_LOG_LIMIT));
}
