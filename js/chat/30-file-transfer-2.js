/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 30 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Streaming file transfer
*/

function rebuildPeerTransport() {
clearPeerHealTimers();
chatState.peerHealInFlight = false;
const peer = chatState.peer;
// Detach first: destroy() fires 'close' synchronously, and a close handler
// that still recognises this peer would queue yet another reconnect.
chatState.peer = null;
chatState.peerId = '';
chatState.sessions.clear();
if (peer && !peer.destroyed) {
try { peer.destroy(); } catch (_error) { /* already gone */ }
}
connectChatTransport().catch(console.error);
}
// When the signalling socket dies the Peer object survives in an unusable
// state: destroyed === false but open === false. Nothing used to cover that,
// so the P2P layer stayed dead until the user reconnected by hand. Prefer
// reconnect() over a rebuild because it keeps the same peer id, and every
// stored contact is keyed on that id.
function healPeerTransport(reason = '') {
/* Relay-only platforms have no peer to heal — the presence socket is the
   whole transport, and it never left. */
if (chatState.p2pUnavailable) return;
if (!chatState.shouldReconnect || !isUnlocked()) return;
if (hasActiveServerRestriction()) return;
const peer = chatState.peer;
if (!peer || peer.destroyed) {
rebuildPeerTransport();
return;
}
if (peer.open && !peer.disconnected) {
chatState.peerHealAttempt = 0;
return;
}
// Still negotiating its first connection. Tearing it down here is what turns
// a single blip into a destroy/create loop, because connectChatTransport()
// discards any peer that is not open yet.
if (!peer.disconnected && !peer.open
&& Date.now() - (chatState.peerConnectStartedAt || 0) < 20000) return;
if (chatState.peerHealInFlight) return;
chatState.peerHealInFlight = true;
const attempt = chatState.peerHealAttempt;
chatState.peerHealAttempt += 1;
console.log(`[Transport] Healing peer (attempt ${attempt + 1}) after: ${reason || 'unknown'}`);
clearPeerHealTimers();
chatState.peerHealTimer = setTimeout(() => {
chatState.peerHealTimer = null;
try {
peer.reconnect();
} catch (error) {
console.warn('[Transport] peer.reconnect() failed, rebuilding:', error);
rebuildPeerTransport();
return;
}
// reconnect() is fire-and-forget, so confirm it actually landed.
chatState.peerVerifyTimer = setTimeout(() => {
chatState.peerVerifyTimer = null;
chatState.peerHealInFlight = false;
if (chatState.peer !== peer) return;
if (peer.open && !peer.disconnected) {
chatState.peerHealAttempt = 0;
return;
}
if (chatState.peerHealAttempt >= 4) {
rebuildPeerTransport();
return;
}
healPeerTransport('reconnect-did-not-open');
}, 6000);
}, attempt === 0 ? 0 : backoffDelay(attempt, 800, 15000));
}
function scheduleReconnect() {
clearReconnectTimer();
if (!chatState.shouldReconnect || !isUnlocked()) return;
/* Relay-only platforms have no peer to heal; the presence socket is the
   whole transport, and connectPresence() already no-ops while it is up. */
if (chatState.p2pUnavailable) {
connectPresence();
return;
}
const delay = backoffDelay(chatState.reconnectAttempt);
chatState.reconnectAttempt += 1;
chatState.reconnectTimer = setTimeout(async () => {
chatState.reconnectTimer = null;
try {
if (!chatState.peer || chatState.peer.destroyed) {
chatState.peer = null;
await connectChatTransport();
return;
}
// The presence socket and the peer socket fail independently, so repair
// both instead of assuming a live presence socket means a live peer.
healPeerTransport('scheduled-reconnect');
connectPresence();
} catch (error) {
console.error(error);
}
}, delay);
}
/* Telling the relay we are going away, before the platform stops us.
 *
 * An iOS web app that is backgrounded keeps its WebSocket — the OS answers the
 * TCP ping from inside the network stack — while the page's JavaScript is
 * frozen and nothing reads a byte off it. The relay saw a live socket, chose
 * the live path, and sent no push: the sender was shown "online" and the phone
 * stayed silent. That is the one combination that loses a message without
 * telling anybody.
 *
 * visibilitychange and pagehide both fire while there is still a moment to
 * send, so this reaches the relay ahead of the heartbeat lapsing and the very
 * next message is pushed. The relay also treats a heartbeat that has stopped
 * as away, which covers the case where the freeze wins the race. */
function tellRelayPresenceState(state) {
try {
if (chatState.ws?.readyState !== WebSocket.OPEN) return;
chatState.ws.send(JSON.stringify({ type: 'presence-state', state }));
} catch (error) {
/* Going away is exactly when a send is most likely to fail; the relay's
   own heartbeat rule is the answer when it does. */
}
}
window.addEventListener('pagehide', () => tellRelayPresenceState('away'));
/* Safari fires freeze on the way into the back/forward cache and on an iOS
   web app being suspended, and it is the last callback before the page stops
   running at all. */
document.addEventListener('freeze', () => tellRelayPresenceState('away'));
document.addEventListener('resume', () => tellRelayPresenceState('active'));

// Handle mobile background/foreground transitions
document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'hidden') {
tellRelayPresenceState('away');
flushHistoryStore();
}
if (document.visibilityState === 'visible') {
tellRelayPresenceState('active');
}
if (document.visibilityState === 'visible') {
// Coming back to the foreground is the moment anything already on screen
// counts as read.
flushSeenReceipts();
if (hasActiveServerRestriction()) {
probeServerRestrictionLifted({ silent: true }).catch(console.error);
return;
}
if (!chatState.shouldReconnect) return;
// Backgrounded tabs stop sending heartbeats, so the relay drops the peer
// after its keep-alive window. Both sockets have to be checked on return,
// not just the presence one.
chatState.reconnectAttempt = 0;
chatState.peerHealAttempt = 0;
clearReconnectTimer();
if (!chatState.ws || chatState.ws.readyState === WebSocket.CLOSED) {
console.log('[Presence] App returned to foreground, triggering reconnection...');
connectChatTransport().catch(console.error);
} else {
chatState.lastInboundAt = Date.now();
}
const peer = chatState.peer;
if (peer && !peer.destroyed && (peer.disconnected || !peer.open)) {
console.log('[Transport] Peer was dropped while backgrounded; healing.');
healPeerTransport('foreground-return');
}
}
});
window.addEventListener('focus', () => {
if (hasActiveServerRestriction()) {
probeServerRestrictionLifted({ silent: true }).catch(console.error);
}
});
window.addEventListener('online', () => {
if (hasActiveServerRestriction()) {
probeServerRestrictionLifted({ silent: true }).catch(console.error);
return;
}
if (!chatState.shouldReconnect) return;
// The OS knows about the handover before any socket times out; use it.
console.log('[Transport] Network came back, reconnecting immediately.');
chatState.reconnectAttempt = 0;
chatState.peerHealAttempt = 0;
clearReconnectTimer();
healPeerTransport('network-online');
if (!chatState.ws || chatState.ws.readyState === WebSocket.CLOSED) {
connectChatTransport().catch(console.error);
} else if (chatState.ws.readyState === WebSocket.OPEN && chatState.peer?.open) {
// Both sockets rode out the interruption; just drop the offline label.
chatState.lastInboundAt = Date.now();
setConnectionState(true, t('متصل به سرور چت', 'Connected to chat server'));
}
});
window.addEventListener('offline', () => {
if (!chatState.shouldReconnect) return;
setConnectionState(false, t('شبکه در دسترس نیست', 'Network unavailable'));
});
window.addEventListener('pagehide', flushHistoryStore);
/* Browsers cannot block a screenshot, but they can make one worthless: the
   moment the app loses focus — which is when the system screenshot UI, the app
   switcher or a screen recorder takes over — protected media is blurred out. */
const setObscured = (on) => document.documentElement.classList.toggle('app-obscured', on);
window.addEventListener('blur', () => setObscured(true));
window.addEventListener('focus', () => setObscured(false));
document.addEventListener('visibilitychange', () => setObscured(document.hidden));
function stopTransportWatchdog() {
if (chatState.wsWatchdogTimer) {
clearInterval(chatState.wsWatchdogTimer);
chatState.wsWatchdogTimer = null;
}
}
// readyState === OPEN is not proof of a working socket. A half-open TCP
// connection (carrier NAT drop, sleeping Wi-Fi, dead proxy) reports OPEN
// forever while nothing flows, which is the "connected but nothing arrives"
// state users read as an unstable network. Track real inbound traffic and
// tear the socket down ourselves when it goes quiet.
function startTransportWatchdog() {
stopTransportWatchdog();
chatState.lastInboundAt = Date.now();
chatState.lastWatchdogTickAt = Date.now();
chatState.wsWatchdogTimer = setInterval(() => {
if (!chatState.shouldReconnect) return;
const now = Date.now();
// Background tabs have their timers throttled, so our own heartbeat stops
// too. Waking up to a long gap means we were frozen, not that the socket
// died -- tearing it down here would reconnect on every foreground return.
const sinceLastTick = now - (chatState.lastWatchdogTickAt || now);
chatState.lastWatchdogTickAt = now;
if (sinceLastTick > 20000) {
chatState.lastInboundAt = now;
return;
}
const ws = chatState.ws;
if (ws?.readyState === WebSocket.OPEN && now - (chatState.lastInboundAt || 0) > 32000) {
console.warn('[Transport] Presence socket went silent; forcing a reconnect.');
try { ws.close(4001, 'liveness-timeout'); } catch (_error) { /* already gone */ }
}
// A peer that quietly lost its signalling socket looks fine to the UI but
// can no longer place or receive calls, so re-check it on every tick.
const peer = chatState.peer;
if (!peer) {
// No peer object at all is the worst state to sit in: every composer control
// keys off it. Rebuild rather than wait for something else to notice.
if (chatState.shouldReconnect && isUnlocked() && !chatState.transportConnectInFlight) {
console.warn('[Transport] No peer object; rebuilding the transport.');
connectChatTransport().catch(console.error);
}
return;
}
if (!peer.destroyed
&& (peer.disconnected
|| (!peer.open && Date.now() - (chatState.peerConnectStartedAt || 0) > 20000))) {
healPeerTransport('watchdog');
}
}, 8000);
}
function startHeartbeat() {
if (chatState.heartbeatTimer) clearInterval(chatState.heartbeatTimer);
startTransportWatchdog();
chatState.heartbeatTimer = setInterval(() => {
if (chatState.ws?.readyState === WebSocket.OPEN) {
chatState.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
}
// Also ping active P2P data connections
chatState.sessions.forEach((session) => {
if (session.connection?.open) {
try {
safeConnectionSend(session.connection, { type: 'ping', timestamp: Date.now() }, 'heartbeat');
} catch (_e) { /* noop */ }
}
});
}, 10000);
}
/* Answers the relay's proof-of-identity challenge: it sealed a nonce to the
   public key we claimed, and only the matching private key — which never
   leaves this device — can open it. importIdentityPrivateKey already imports
   the key for RSA-OAEP 'decrypt', which is exactly this operation. */
async function handleIdentityChallenge(message) {
try {
const priv = await importIdentityPrivateKey();
const nonceBytes = await crypto.subtle.decrypt(
{ name: 'RSA-OAEP' }, priv, app().base64ToArrayBuffer(message.cipher));
if (chatState.ws?.readyState === WebSocket.OPEN) {
chatState.ws.send(JSON.stringify({ type: 'id-proof', nonce: app().arrayBufferToBase64(nonceBytes) }));
}
} catch (error) {
console.warn('[Chat] could not answer the relay identity challenge:', error);
}
}
/* A space record, on its own turn of the sender's queue.
 *
 * The relay stamps the sender from an unauthenticated hello, so the sender
 * claim is the only thing vouching for a roster that can dissolve a group
 * and purge session keys. Only the space's owner (or this device) may push
 * one at an existing space — and over transit, where the envelope's sender
 * is deliberately blank, the record itself names its author and the
 * author's signature is checked against the owner's pinned key. Without
 * that second half, every cross-relay member refused every edit: the
 * owner's renames, permissions and removals simply never arrived, and a
 * removed member kept a ghost group others kept encrypting to. */
async function handleSpaceSyncMessage(message, payload) {
const senderFingerprint = String(message.fromFingerprint || '');
const senderPeerId = String(message.fromClientId || message.fromPeerId || '');
const existingSpace = (chatState.spaces?.groups || []).find((space) => space.conversationId === payload.space.conversationId)
|| (chatState.spaces?.channels || []).find((space) => space.conversationId === payload.space.conversationId)
|| null;
let authorized = typeof isSpaceUpdateAuthorized !== 'function'
|| isSpaceUpdateAuthorized(existingSpace, senderFingerprint, senderPeerId);
if (!authorized && existingSpace && payload.fromFingerprint) {
const ownerKey = existingSpace.ownerFingerprint
? String((typeof findPeerByAnyKey === 'function' ? findPeerByAnyKey(existingSpace.ownerFingerprint) : null)?.publicKeyData || '') : '';
authorized = payload.fromFingerprint === String(existingSpace.ownerFingerprint || '')
&& Boolean(ownerKey)
&& typeof verifySpaceSyncSender === 'function'
&& await verifySpaceSyncSender(payload, ownerKey);
}
if (!authorized) {
console.warn('[Chat] refused a space-sync from a non-owner sender');
ackRelayMessage(message.relayId);
return;
}
/* Being dropped from the members list of a newer revision means we were
removed; keeping the thread around would show a group we can no longer
post to. */
if (handleSpaceRemoval(payload.space)) {
ackRelayMessage(message.relayId);
return;
}
const merged = upsertSharedSpace(payload.space);
/* Only for a group this device is actually in - a note about a group we are
not a member of would be a thread appearing out of nowhere. */
if (merged && payload.note) appendSpaceNote(merged, String(payload.note).slice(0, 300));
renderPeers();
renderActivePeer();
renderMessages();
ackRelayMessage(message.relayId);
}
function connectPresence() {
if (chatState.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(chatState.ws.readyState)) {
return;
}
if (chatState.manualOffline) return;
chatState.ws = new WebSocket(wsUrl());
setConnectionState(false, t('در حال اتصال...', 'Connecting...'));
chatState.ws.addEventListener('open', () => {
clearReconnectTimer();
chatState.reconnectAttempt = 0;
chatState.lastInboundAt = Date.now();
chatState.lastTransportNoticeAt = 0;
chatState.serverReachable = true;
setConnectionState(true, t('متصل به سرور چت', 'Connected to chat server'));
renderStaticUi();
startHeartbeat();
retryQueuedMessages();
});
chatState.ws.addEventListener('message', (event) => {
// Any frame at all is proof the path is still live; the watchdog reads this.
chatState.lastInboundAt = Date.now();
let message;
try {
message = JSON.parse(event.data);
} catch (error) {
console.warn('Invalid chat signal payload:', error);
return;
}
	if (message.type === 'pong') return;
	/* The relay checks that the client it is talking to holds the private half
	   of the identity it claimed on the query string. Only the holder can
	   answer, and a failure here is logged rather than fatal: an old server
	   that never sends challenges is fine, and a client that cannot answer has
	   bigger problems than this frame. */
	if (message.type === 'id-challenge' && message.cipher) {
	handleIdentityChallenge(message).catch((error) => {
	console.warn('[Chat] identity challenge failed:', error);
	});
	return;
	}
	if (message.type === 'welcome') {
chatState.clientId = message.clientId || '';
renderStaticUi();
broadcastHello();
/* The relay is up and answering, which is the cheap moment to re-read its
   TURN block. An operator who re-runs the relay setup gets a fresh TURN
   password, and until now a client holding the old one lost every relayed
   call with nothing on screen to say why — the credentials were fetched once
   and then kept forever. Not awaited: the connection is already up, and a
   relay that has nothing new to say costs two small requests at most once
   every five minutes. */
hydrateRelayTurnConfig({ force: true }).catch(() => {});
return;
}
if (message.type === 'peers') {
/* Everyone this relay did not mention goes offline -- EXCEPT somebody whose
   presence is not this relay's business.
 *
 * A relay lists its own clients and nobody else's, so a contact on another relay
 * is absent from every one of these broadcasts. Marking them offline here and
 * waiting for the transit answer to mark them back made the status flicker, and
 * flicker towards offline, because the broadcast arrives far more often than the
 * question is asked. It is also simply wrong: this relay has not said that person
 * is away, it has said nothing about them at all.
 *
 * So presence for a contact with a routable home relay elsewhere is owned by the
 * answer from that relay, and is left alone here. staleTransitPresence is what
 * stops that becoming a status that never goes offline again. */
chatState.peers.forEach((peer) => {
if (peer.type) return;
if (typeof presenceAnsweredElsewhere === 'function' && presenceAnsweredElsewhere(peer)) return;
peer.status = 'offline';
});
	/* Every record is checked against its own key before it is believed. */
	Promise.all((message.peers || []).map((peer) => withVerifiedFingerprint(peer)))
	.then((verified) => {
	/* Other machines holding this same identity are family, not contacts. The
	   fingerprint half of isSelfPeerRecord still drops them from chatState.peers
	   below — correctly, or every device would list its siblings as contacts —
	   so they are set aside here for the devices panel and the identity strip.
	   The relay table names live sockets, so presence in this list means the
	   device is connected right now; an away device is simply absent. */
	const myFingerprint = chatState.identity?.fingerprint || '';
	chatState.linkedDevices = myFingerprint
	? verified
	.filter((peer) => peer.fingerprint === myFingerprint)
	.map((peer) => ({
	deviceId: String(peer.deviceId || ''),
	clientId: String(peer.clientId || ''),
	name: String(peer.username || ''),
	}))
	: [];
	/* Sticky, not live: "this account has siblings" must survive every one of
	   them being away, because the ACK policy below needs to keep protecting
	   their mailbox copies exactly then. Persisted so a reload knows it too. */
	if (chatState.linkedDevices.length >= 2 && !chatState.hasLinkedDevices) {
	chatState.hasLinkedDevices = true;
	chatState.profile.hasLinkedDevices = true;
	saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
	}
	/* Everyone is here: whatever mail was held back for the sibling that was
	   away can be acknowledged out of the shared box now. */
	if (chatState.hasLinkedDevices && chatState.linkedDevices.length >= 2) flushDeferredMailAcks();
	verified.forEach((peer) => mergePeerRecord(peer, { online: true }));
	chatState.peers = chatState.peers.filter((peer) => !isSelfPeerRecord(peer));
	dropStaleSessionChannels();
	saveContacts();
	renderPeers();
	renderActivePeer();
	/* The live device list just changed: the strip count follows it, an
	   open devices pane redraws so the list stays current while watched,
	   and a sibling appearing is the moment to offer them the history. */
	renderLinkedDeviceCount();
	maybeAnnounceDeviceSync(chatState.linkedDevices.length);
	if (chatState.settingsPane === 'devices' && typeof renderDevicesCard === 'function') renderDevicesCard();
/* Somebody being rung while they were away may have just walked in. */
if (chatState.offlineRing) {
const arrived = chatState.peers.find((peer) => peer.peerId === chatState.offlineRing.peerId && peer.status === 'online');
if (arrived) offlineRingPeerArrived(arrived);
}
// Retry sending queued messages when peers list updates (potential reconnection)
retryQueuedMessages();
});
return;
}
if (message.type === 'queued') {
/* The relay stored an envelope we asked it to keep. The tag is the outbound
   message id we sent it with; matching it back moves that message to
   'relayed' — "handed to the server, waiting for the peer" — rather than
   leaving it on the ambiguous ✓ of a blind send. */
const entry = chatState.pendingRelayTags?.get(String(message.tag || ''));
if (entry) {
markMessageStatus(entry.conversationKey, entry.messageId, 'relayed');
chatState.pendingRelayTags.delete(String(message.tag || ''));
}
/* A carried message that was accepted needs no fallback copy kept for it. */
chatState.pendingTransit?.delete(String(message.tag || ''));
return;
}
/* The far relay answered a question about one of its own clients. */
if (message.type === 'presence' && message.toFingerprint) {
chatState.pendingTransit?.delete(String(message.tag || ''));
notePeerPresenceAnswer(String(message.toFingerprint), message.up === true);
return;
}
if (message.type === 'error') {
/* The carrier could not take it: no link to that relay, or the far relay
   would not open it. The message is not lost — it goes the ordinary way and
   the conversation is told, because "this went through your own relay after
   all" changes who can see that the two of you are talking. */
if (String(message.reason || '').startsWith('transit-')) {
const waiting = chatState.pendingTransit?.get(String(message.tag || ''));
if (waiting) {
chatState.pendingTransit.delete(String(message.tag || ''));
const peerRecord = chatState.peers.find((peer) => peer.peerId === waiting.peerId) || null;
console.warn(`[Transit] ${message.reason}; falling back to the direct path`);
fallBackToDirect(waiting.frame, peerRecord, message.reason);
return;
}
}
if (message.reason === 'identity-unverified') {
notify(t(
'سرور این نسخه از برنامه را تأیید نمی‌کند؛ لطفاً برنامه را دوباره بارگذاری یا به‌روزرسانی کنید.',
'The server does not accept this version of the app; please reload or update it.',
), 'error');
}
const entry = chatState.pendingRelayTags?.get(String(message.tag || ''));
if (entry) {
markMessageStatus(entry.conversationKey, entry.messageId, 'failed');
chatState.pendingRelayTags.delete(String(message.tag || ''));
notify(t('ارسال یک پیام به سرور ناموفق بود.', 'A message could not be handed to the server.'), 'warning');
}
return;
}
if (message.type === 'server-suspended' || message.type === 'server-kicked') {
let defaultMsg = '';
if (message.permanent) {
defaultMsg = message.type === 'server-suspended'
? t('شما موقتاً تعلیق شده اید.', 'You are temporarily suspended.')
: t('دسترسی شما در سیستم محدود شده است، لطفاً برای رفع محدودیت با ادمین سرور و یا پشتیبانی تماس بگیرید.', 'Your access is permanently restricted, please contact support.');
} else {
let untilText = '';
if (message.until) {
const d = new Date(message.until);
untilText = ' تا ' + d.toLocaleString('fa-IR') + ' (' + d.toLocaleString('en-US') + ')';
}
defaultMsg = message.type === 'server-suspended'
? t(`شما موقتاً تعلیق شده اید.${untilText}`, `You are temporarily suspended${untilText}.`)
: t(`اتصال شما از سرور قطع شد و${untilText} امکان اتصال ندارید.`, `You were kicked from this server${untilText}.`);
}
setServerRestriction({
type: message.type === 'server-suspended' ? 'suspended' : 'kicked',
message: defaultMsg,
until: message.until || null,
permanent: Boolean(message.permanent),
});
const text = message.type === 'server-suspended' ? restrictionText() : defaultMsg;
if (message.silent) {
try { chatState.ws?.close(); } catch (_error) {}
return;
}
notifyRestrictionOnce(text);
appendHistory('system', {
id: generateId('sys'),
type: 'text',
kind: 'text',
text,
senderName: t('سیستم', 'System'),
direction: 'in',
timestamp: message.timestamp || Date.now(),
createdAt: new Date(message.timestamp || Date.now()).toISOString(),
system: true
});
try { chatState.ws?.close(); } catch (_error) {}
return;
}
if (message.type === 'system-broadcast') {
const conversationId = 'system';
const entry = {
id: generateId('sys'),
type: message.kind === 'voice' ? 'voice' : (message.kind === 'file' ? 'file' : 'text'),
kind: message.kind || 'text',
text: message.message || '',
name: message.fileName || (message.kind === 'voice' ? t('صدای سیستم', 'System Voice') : t('فایل سیستم', 'System File')),
downloadUrl: message.fileData || '',
senderName: t('سیستم', 'System'),
direction: 'in',
timestamp: message.timestamp || Date.now(),
createdAt: new Date(message.timestamp || Date.now()).toISOString(),
system: true
};
appendHistory(conversationId, entry);
return;
}
/* The relay could not keep something long enough. Saying so is the whole
   point of the expiry log: without it the recipient never learns that anyone
   wrote to them, which is worse than knowing a file was missed. */
/* Somebody reached for us while we were away. */
if (message.type === 'relay' && message.payload?.type === 'session-offer') {
const identity = message.payload.identity || {};
if (identity.fingerprint || identity.peerId) {
const known = findPeerByAnyKey(identity.fingerprint || identity.peerId);
if (!known) {
addIdentityAsConversation(identity, { startSession: false });
notify(t(
`${identity.name || 'یک مخاطب'} در نبود شما درخواست گفتگو داده بود.`,
`${identity.name || 'Someone'} asked to start a conversation while you were away.`,
), 'info');
	} else {
	/* The key in a session-offer used to be written straight onto the known
	   record, bypassing the TOFU pinning every other identity update goes
	   through. The same merge decides here: a differing key is held as
	   pendingKey with the key-change note, and the pinned key survives. */
	mergePeerRecord({
	peerId: known.peerId,
	clientId: known.clientId,
	publicKeyData: identity.publicKeyData || known.publicKeyData,
	fingerprint: identity.fingerprint || known.fingerprint,
	conversationId: known.conversationId,
	status: known.status,
	});
	saveContacts();
	}
renderPeers();
}
ackRelayMessage(message.relayId);
return;
}
if (message.type === 'expired-notice') {
const items = Array.isArray(message.items) ? message.items : [];
for (const item of items) {
const peer = findPeerByAnyKey(item.from);
const conversationId = peer ? getConversationKey(peer) : (item.from || 'system');
const when = item.queuedAt ? new Date(item.queuedAt).toLocaleString(language() === 'fa' ? 'fa-IR' : 'en-GB') : '';
const reasonText = item.reason === 'quota' || item.reason === 'mailbox-full'
? t('به‌دلیل پر شدن فضای نگهداری سرور', 'because the server ran out of room for it')
: t('چون بیش از ۷ روز تحویل گرفته نشد', 'because it went uncollected for more than 7 days');
appendHistory(conversationId, {
id: generateId('expired'),
direction: 'in',
type: 'text',
system: true,
text: t(
`یک ${item.class === 'media' ? 'فایل' : 'پیام'} در ${when} برای شما فرستاده شد و روی سرور پاک شد ${reasonText}. متن آن هرگز رمزگشایی نشد؛ فقط سابقهٔ ارسالش مانده بود.`,
`A ${item.class === 'media' ? 'file' : 'message'} was sent to you on ${when} and was removed from the server ${reasonText}. Its contents were never decrypted — only the record that it existed.`,
),
status: 'delivered',
createdAt: item.expiredAt || new Date().toISOString(),
});
}
if (items.length) {
renderPeers();
renderMessages();
notify(t(
`${items.length} پیام یا فایل پیش از دریافت شما از سرور پاک شده بود.`,
`${items.length} message(s) or file(s) had been removed from the server before you collected them.`,
), 'warning');
}
return;
}
if (message.type === 'relay') {
const payload = message.payload;
if (!payload) {
ackRelayMessage(message.relayId);
return;
}
/* Somebody on another relay told us their name, their photograph and their
   prekey -- everything a hello would have carried if a relay broadcast reached
   across. */
if (payload.type === 'profile-card') {
const known = findPeerByAnyKey(payload.fingerprint || payload.peerId || message.fromClientId || '');
noteProfileCard(payload, known);
ackRelayMessage(message.relayId);
return;
}

if (payload.type === 'call-invite') {
const queuedAt = message.queuedAt ? Date.parse(message.queuedAt) : 0;
if (queuedAt && Date.now() - queuedAt > CALL_RING_TIMEOUT_MS) {
appendCall({
name: payload.name || message.fromClientId,
peerId: payload.peerId || message.fromClientId,
mode: payload.mode || 'voice',
status: 'missed',
direction: 'in',
createdAt: message.queuedAt,
});
ackRelayMessage(message.relayId);
return;
}
const incomingPeerId = payload.peerId || message.fromClientId;
if (chatState.pendingIncomingInvite?.peerId === incomingPeerId ||
chatState.pendingIncomingCall?.peer === incomingPeerId ||
chatState.currentCall?.peer === incomingPeerId) {
/* Acknowledged, or the mailbox holds it for ever and every reconnect rings
   the same dead invitation again. */
ackRelayMessage(message.relayId);
return;
}
if (chatState.currentCall || chatState.pendingIncomingCall || chatState.pendingIncomingInvite) {
const busyPeer = findPeerRecordByPeerId(incomingPeerId);
if (busyPeer) {
sendRelayEnvelope(busyPeer, {
type: 'call-busy',
mode: payload.mode || 'voice',
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
});
}
/* Same as above: answered is answered, whatever the answer was. */
ackRelayMessage(message.relayId);
notify(t('در حال حاضر در تماس دیگری هستید و تماس جدید رد شد.', 'You are already in another call, so the new request was rejected.'), 'warning');
return;
}
showIncomingCall(null, {
peerId: incomingPeerId,
mode: payload.mode || 'voice',
name: payload.name || message.fromClientId,
groupId: payload.groupId || null,
});
appendCall({
name: payload.name || message.fromClientId,
peerId: incomingPeerId,
mode: payload.mode,
status: 'ringing',
direction: 'in',
logToChat: false,
});
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-busy') {
const peer = findPeerRecordByPeerId(payload.peerId || message.fromClientId || '');
appendCall({
name: payload.name || peer?.username || message.fromClientId,
peerId: peer?.peerId || payload.peerId || message.fromClientId,
mode: payload.mode || chatState.currentCallMode || 'voice',
status: 'failed',
direction: chatState.currentCallDirection || 'out',
});
notify(t('کاربر مقصد در حال حاضر در تماس دیگری است.', 'The target user is already on another call.'), 'warning');
endCurrentCall({ logCall: false });
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-reject') {
const peer = findPeerRecordByPeerId(payload.peerId || message.fromClientId || '') || activePeer();
appendCall({
name: payload.name || peer?.username || message.fromClientId,
peerId: peer?.peerId || payload.peerId || message.fromClientId,
mode: payload.mode || chatState.currentCallMode || 'voice',
status: 'rejected',
direction: chatState.currentCallDirection || 'out',
});
notify(t('تماس شما رد شد.', 'Your call was rejected.'), 'info');
endCurrentCall({ logCall: false });
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-missed') {
appendCall({
name: payload.name || message.fromClientId,
peerId: payload.peerId || message.fromClientId,
mode: payload.mode || 'voice',
status: 'missed',
direction: 'in',
createdAt: payload.createdAt || message.queuedAt || new Date().toISOString(),
});
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-cancel') {
const peerId = payload.peerId || message.fromClientId;
if (chatState.pendingIncomingCall?.peer === peerId || chatState.pendingIncomingInvite?.peerId === peerId) {
clearIncomingCall();
}
appendCall({
name: payload.name || message.fromClientId,
peerId: payload.peerId || message.fromClientId,
mode: payload.mode || 'voice',
status: 'missed',
direction: 'in',
createdAt: payload.createdAt || new Date().toISOString(),
});
ackRelayMessage(message.relayId);
return;
}
	if (payload.type === 'call-ended') {
appendCall({
name: payload.name || message.fromClientId,
peerId: payload.peerId || message.fromClientId,
mode: payload.mode || 'voice',
status: 'ended',
durationMs: Number(payload.durationMs || 0),
createdAt: payload.createdAt || new Date().toISOString(),
/* Updates the row this call already has; never opens one. */
updateOnly: true,
});
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-renegotiate') {
handleCallRenegotiateOffer(payload, message).catch(console.error);
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-renegotiate-answer') {
handleCallRenegotiateAnswer(payload, message).catch(console.error);
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-ice') {
handleCallRemoteCandidate(payload, message).catch(console.error);
ackRelayMessage(message.relayId);
return;
}
/* The offer, the answer and the candidates of a call whose two ends are on
   different relays. They travel this way because a PeerJS id is only meaningful
   on the server that issued it; see js/chat/39-relay-call.js. Handled before
   anything that could mistake them for chat, and named call-relay-* rather than
   reusing call-ice so a build that predates them ignores them instead of
   feeding a candidate to a negotiation that has none. */
if (String(payload.type || '').startsWith('call-relay-')) {
/* An offer that was waiting in a mailbox is not a call, it is a recording of
   one. Three defences stop it being stored at all -- the client marks these
   ephemeral, and both relays refuse to queue them -- and this is the fourth,
   for an envelope queued by a build that predates those. call-invite has had
   the same check since the offline ring was written; without it here, a
   reconnect rang the phone with a dead description behind it: declining logged
   a missed call that never happened, answering gave a call with no sound. */
const queuedAt = message.queuedAt ? Date.parse(message.queuedAt) : 0;
if (queuedAt && Date.now() - queuedAt > CALL_RING_TIMEOUT_MS) {
ackRelayMessage(message.relayId);
return;
}
if (typeof handleRelayCallSignal === 'function') handleRelayCallSignal(message);
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'server-draining') {
/* The relay is going away for a redeploy and has told us when to come back.
   Obeying its jitter is the whole point: every peer reconnecting the instant
   the socket drops is a self-inflicted stampede on whatever replaces it. */
const delay = Math.max(250, Math.min(30000, Number(payload.reconnectAfterMs) || 1500));
setConnectionState(false, t('سرور در حال به‌روزرسانی است…', 'The server is updating…'));
chatState.shouldReconnect = true;
clearReconnectTimer();
chatState.reconnectTimer = setTimeout(() => {
connectChatTransport().catch(console.error);
}, delay);
return;
}
if (payload.type === 'call-state') {
const activePeer = chatState.currentCall ? activeCallPeerRecord() : null;
if (activePeer && (payload.peerId === activePeer.peerId || message.fromFingerprint === activePeer.fingerprint)) {
applyRemoteCallState(payload.state || {});
}
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-screenshot') {
const activePeer = chatState.currentCall ? activeCallPeerRecord() : null;
const inActiveCall = Boolean(activePeer && (payload.peerId === activePeer.peerId || message.fromFingerprint === activePeer.fingerprint));
if (inActiveCall) {
showScreenshotWarning(payload.name);
}
notify(t(
`${payload.name || 'طرف مقابل'} در حین تماس اسکرین‌شات گرفت.`,
`${payload.name || 'The other side'} took a screenshot during the call.`,
), 'warning');
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'space-dissolve-request') {
/* Asked, not done: the owner is shown the request and decides. */
const target = chatState.spaces.groups.find((item) => item.conversationId === payload.spaceId);
if (target && localSpaceRole(target) === 'owner') {
appendHistory(target.conversationId, {
id: generateId('sys'),
direction: 'in',
type: 'system-note',
text: t(`${payload.fromName || 'یک ادمین'} درخواست انحلال این گروه را داد. اگر موافقید از «انحلال گروه برای همه» استفاده کنید.`,
  `${payload.fromName || 'An admin'} asked for this group to be dissolved. Use "Dissolve for everyone" if you agree.`),
status: 'delivered',
createdAt: payload.createdAt || new Date().toISOString(),
});
storeHistory({ immediate: true });
renderMessages();
notify(t(`درخواست انحلال «${target.name}» رسید.`, `A request to dissolve "${target.name}" arrived.`), 'warning');
}
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'space-sync' && payload.space) {
/* Through the same per-sender queue offline mail uses: a space record's
   revision is only meaningful in order, and a signature check that resolves
   asynchronously must not let a later revision overtake an earlier one. */
const fromKey = message.fromFingerprint || payload.fromFingerprint || message.fromClientId || 'unknown';
if (!chatState.wsMessageQueues.has(fromKey)) {
chatState.wsMessageQueues.set(fromKey, Promise.resolve());
}
chatState.wsMessageQueues.set(fromKey, chatState.wsMessageQueues.get(fromKey).then(async () => {
try {
await handleSpaceSyncMessage(message, payload);
} catch (error) {
console.error('Failed to process a space record:', error);
}
}));
return;
}
if (payload.type === 'device-sync') {
/* Serialised behind the sibling's queue like mail is, so a large
   history cannot interleave with an arriving message from the same
   machine. */
const syncFrom = payload.fromDeviceId || message.fromFingerprint || 'device-sync';
if (!chatState.wsMessageQueues.has(syncFrom)) {
chatState.wsMessageQueues.set(syncFrom, Promise.resolve());
}
chatState.wsMessageQueues.set(syncFrom, chatState.wsMessageQueues.get(syncFrom).then(async () => {
try {
await handleDeviceSyncEnvelope(message);
} catch (error) {
console.error('Failed to process a device-sync envelope:', error);
}
}));
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'offline-chat') {
const fromId = message.fromFingerprint || message.fromClientId || 'unknown';
if (!chatState.wsMessageQueues.has(fromId)) {
chatState.wsMessageQueues.set(fromId, Promise.resolve());
}
chatState.wsMessageQueues.set(fromId, chatState.wsMessageQueues.get(fromId).then(async () => {
try {
if (await handleOfflineRelayMessage(message)) {
ackRelayMessage(message.relayId);
}
} catch (error) {
console.error('Failed to process offline relay message in queue:', error);
}
}));
return;
}
/* Seen announcements live in localStorage, not memory: a page refresh or a
   second tab wipes an in-memory set, and the mailbox copy that arrives
   after the reset renders (and rings) a second time — exactly what the
   desktop showed while the phone, which never reloads, stayed quiet. The
   store is shared by every tab of this origin and survives restarts. */
function seenAnnouncementIds() {
  try { return new Set(JSON.parse(localStorage.getItem('poorija-seen-announcements') || '[]')); }
  catch (_error) { return new Set(); }
}
function markAnnouncementSeen(id) {
  if (!id) return;
  const ids = seenAnnouncementIds();
  ids.add(id);
  const kept = Array.from(ids).slice(-200);
  try { localStorage.setItem('poorija-seen-announcements', JSON.stringify(kept)); } catch (_error) { /* private mode */ }
}
if (payload.type === 'system-note') {
/* Live frame now, mailbox copy on the next reconnect: both carry the same
   announceId, and the second one is a receipt, not a new message. */
if (payload.announceId) {
  if (seenAnnouncementIds().has(payload.announceId)) { ackRelayMessage(message.relayId); return; }
  markAnnouncementSeen(payload.announceId);
}
/* The attribution check can await a signature, the listener cannot: the
   whole note runs in its own turn and is acknowledged from inside. */
handleSystemNote(message, payload).catch((error) => console.error('Failed to process a system note:', error));
return;
}
if (payload.type === 'typing') {
/* The payload's name first: over transit the envelope-level fingerprint is
   blank by design, and the payload is where the sender put it. */
handleRemoteTyping(payload.fromFingerprint || message.fromFingerprint);
ackRelayMessage(message.relayId);
return;
}
ackRelayMessage(message.relayId);
}
});
chatState.ws.addEventListener('close', () => {
if (hasActiveServerRestriction()) {
renderRestrictionStatus();
if (chatState.heartbeatTimer) clearInterval(chatState.heartbeatTimer);
return;
}
setConnectionState(false, t('ارتباط با سرور چت قطع شد', 'Chat server disconnected'));
chatState.serverReachable = false;
/* Whose presence this socket may speak for: its own relay's clients and
   nobody else's. The peers broadcast applies the same rule when it marks
   people offline; a socket blip used to apply it to contacts whose presence
   is answered elsewhere, so a reconnect overwrote a cross-relay contact's
   good answer with this relay's silence — and wrote it into the saved
   contacts, where it outlived the blip. Their answer stays as it was. */
chatState.peers.forEach((peer) => {
if (!peer.type
&& !(typeof presenceAnsweredElsewhere === 'function' && presenceAnsweredElsewhere(peer))) {
peer.status = 'offline';
}
});
saveContacts();
if (chatState.heartbeatTimer) clearInterval(chatState.heartbeatTimer);
stopTransportWatchdog();
renderPeers();
renderActivePeer();
if (!chatState.shouldReconnect) return;
scheduleReconnect();
});
chatState.ws.addEventListener('error', () => {
if (hasActiveServerRestriction()) {
renderRestrictionStatus();
return;
}
chatState.serverReachable = false;
setConnectionState(false, t('سرور چت در دسترس نیست', 'Chat server is unreachable'));
});
}
// Overlapping builds were racing each other: the second call reached the
// teardown branch while the first peer was still handshaking, discarded it and
// started over. Serialise them.
async function connectChatTransport() {
if (chatState.transportConnectInFlight) {
// Dropping this call silently is what killed the composer: rebuildPeerTransport()
// nulls chatState.peer and then asks for a rebuild, and if a build happened to
// be in flight the request vanished — leaving peer null for good, which the
// send/file/voice buttons read as "no transport" and stay disabled forever.
chatState.transportConnectQueued = true;
return;
}
chatState.transportConnectInFlight = true;
try {
return await buildChatTransport();
} finally {
chatState.transportConnectInFlight = false;
chatState._transportInFlightSince = 0;
if (chatState.transportConnectQueued) {
chatState.transportConnectQueued = false;
setTimeout(() => connectChatTransport().catch(console.error), 250);
}
}
}
async function buildChatTransport() {
if (!isUnlocked()) {
notify(t('برای فعال‌سازی چت ابتدا باید برنامه را باز کنید', 'Unlock the app before enabling chat'), 'warning');
return;
}
/* The master switch is the single choke point: every connect path — the
 * auto-connect triggers, the reconnect timers, the manual buttons — funnels
 * through here, and when it is off nothing dials, whatever asked. */
if (chatState.profile.chatEnabled === false) {
setConnectionState(false, t('چت امن خاموش است', 'Secure chat is off'));
return;
}
await ensureIdentity();
if (hasActiveServerRestriction()) {
const restrictionLifted = await probeServerRestrictionLifted({ silent: true, reconnect: false });
if (!restrictionLifted && hasActiveServerRestriction()) {
notifyRestrictionOnce();
return;
}
}
if (chatState.profile.autoDiscovery && !isUsableRelayOrigin(chatState.profile.serverUrl)) {
await discoverLocalRelayServer({ fullScan: false, silent: true });
}
await hydrateRelayTurnConfig();
if (!await ensureRelayTransportReady()) return;
chatState.shouldReconnect = true;
/* Asking for a transport is the opposite of having asked to be offline, so it
   lifts the latch disconnectChat() set. It is safe to do it here and not
   earlier: the master switch above has already returned if secure chat is off,
   which is the other thing that sets this flag, and every connectPresence()
   below reads it. */
chatState.manualOffline = false;
renderStaticUi();
const nextPeerOrigin = peerTransportOrigin();
const canReusePeer = Boolean(
chatState.peer
&& !chatState.peer.destroyed
&& chatState.peer.open
&& chatState.peerTransportOrigin === nextPeerOrigin
);
if (!canReusePeer && chatState.peer && !chatState.peer.destroyed) {
const stalePeer = chatState.peer;
chatState.peer = null;
chatState.peerId = '';
chatState.sessions.clear();
stalePeer.destroy();
}
if (canReusePeer) {
connectPresence();
return;
}
const PeerCtor = window.Peer;
if (!PeerCtor || !webRTCSupported()) {
/* Relay-only transport. Constructing a Peer on an engine without WebRTC
   (WebKitGTK) aborts it instantly with browser-incompatible, and the heal
   loop then destroys and rebuilds forever — green for a second, "recovering"
   the next. Everything the relay carries — presence, messages, offline
   queue — works with no peer at all, so run without one and say so once. */
chatState.p2pUnavailable = true;
chatState.shouldReconnect = true;
if (chatState.peer && !chatState.peer.destroyed) {
const deadPeer = chatState.peer;
chatState.peer = null;
chatState.peerId = '';
try { deadPeer.destroy(); } catch (_error) { /* already gone */ }
}
if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) {
connectPresence();
} else {
setConnectionState(true, t('متصل به سرور چت', 'Connected to chat server'));
}
if (!chatState.p2pNoticeShown) {
chatState.p2pNoticeShown = true;
notify(t('تماس‌های مستقیم (P2P) در این پلتفرم پشتیبانی نمی‌شوند؛ چت از طریق رله فعال است.', 'Direct (P2P) calls are unavailable on this platform; chat works through the relay.'), 'warning');
}
renderStaticUi();
refreshCallControls();
return;
}
if (!PeerCtor) {
notify(t('کتابخانه PeerJS لود نشده است', 'PeerJS client failed to load'), 'error');
return;
}
	/* The account's address, or this install's own when a sibling device
	   already holds the account's — see the unavailable-id handler above. */
	const stablePeerId = (chatState.profile.stablePeerId || generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-'))
	+ (chatState.profile.peerIdSuffix ? `~${String(getDeviceId()).slice(-6)}` : '');
	chatState.profile.stablePeerId = chatState.profile.stablePeerId || stablePeerId;
	saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
// Add a small delay to ensure identity and other async states are fully hydrated
if (chatState.reconnectAttempt === 0) {
await new Promise(r => setTimeout(r, 500));
}
const peer = new PeerCtor(stablePeerId, peerOptions());
chatState.peer = peer;
chatState.peerConnectStartedAt = Date.now();
chatState.peerTransportOrigin = nextPeerOrigin;
peer.on('open', (peerId) => {
chatState.reconnectAttempt = 0; // Reset on success
chatState.peerHealAttempt = 0;
chatState.peerHealInFlight = false;
chatState.lastTransportNoticeAt = 0;
chatState.peerIdRetryAttempt = 0;
clearPeerHealTimers();
chatState.peerId = peerId;
renderStaticUi();
connectPresence();
// connectPresence() is a no-op when the presence socket is already up, so it
// would leave the status stuck on "restoring" after every successful heal.
if (chatState.ws?.readyState === WebSocket.OPEN) {
setConnectionState(true, t('متصل به سرور چت', 'Connected to chat server'));
}
broadcastHello();
});
	peer.on('connection', (connection) => {
	const remotePeer = {
	clientId: connection.metadata?.clientId || connection.peer,
	peerId: connection.peer,
	username: connection.metadata?.username || connection.peer,
	publicKeyData: connection.metadata?.publicKeyData || '',
	fingerprint: connection.metadata?.fingerprint || '',
	status: 'online',
	};
	/* The connection metadata carries a public key, and binding the session to
	   the raw record let an unverified key negotiate directly — the TOFU merge
	   had only seen it as a side effect. The merged record (pinned key intact,
	   conflicts held as pending) is what the session must be built from. */
	const mergedRecord = mergePeerRecord(remotePeer, { online: true }) || remotePeer;
	onPeerDiscovered(remotePeer);
	bindDataConnection(mergedRecord, connection, false);
	});
peer.on('call', async (call) => {
/* A leg of a group call the user already joined must not raise the 1:1
   incoming screen — they already said yes. */
if (handleIncomingGroupCallLeg(call)) return;
appendCall({
name: call.metadata?.username || call.peer,
peerId: call.peer,
mode: call.metadata?.mode || 'voice',
status: 'incoming',
direction: 'in',
logToChat: false,
});
showIncomingCall(call);
if (chatState.pendingIncomingAccept) {
acceptIncomingCall().catch(console.error);
}
});
peer.on('error', (error) => {
console.error(error);
const errorText = String(`${error?.type || ''} ${error?.message || error || ''}`);
const missingPeer = errorText.match(/Could not connect to peer\s+([A-Za-z0-9_-]+)/i)?.[1];
if (missingPeer || /peer-unavailable/i.test(errorText)) {
markPeerUnavailable(missingPeer || activePeer()?.peerId || '', t('Peer انتخاب‌شده آنلاین نیست یا دیگر در دسترس نیست؛ فهرست را به‌روزرسانی کردیم.', 'The selected peer is not online or is no longer reachable; the list was refreshed.'));
setConnectionState(Boolean(chatState.ws?.readyState === WebSocket.OPEN), t('متصل به رله؛ Peer مقصد در دسترس نیست', 'Relay connected; target peer is unreachable'));
return;
}
	if (errorText.includes('unavailable-id')) {
	/* Who is holding the id decides what happens next. The portable profile
	   carries the account's stablePeerId, so a LINKED sibling online on this
	   relay holds it — contesting it can never win, and the old answer
	   (regenerate the id outright) forked the account's address into two,
	   with contacts' records flapping between them forever. A second device
	   instead takes its own DETERMINISTIC id — the account's id plus this
	   install's device suffix — which is stable across reconnects, visibly
	   belongs to the same account, and leaves the primary address to the
	   device that already holds it.
	   The other holder can also be this device's own ghost socket after an
	   unclean reload; for that one the suffixed id works just as well, and
	   the reaper clears the ghost on its own. */
	if (!chatState.profile.peerIdSuffix) {
	chatState.profile.peerIdSuffix = true;
	saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
	console.warn('[Transport] Peer id held by another device of this account; taking the per-device id.');
	setTimeout(() => rebuildPeerTransport(), 500);
	return;
	}
	/* Already on the per-device id and still contested: retry the same id —
	   every stored contact is keyed on it, and regenerating silently
	   orphans the whole contact list. */
	chatState.peerIdRetryAttempt += 1;
	if (chatState.peerIdRetryAttempt <= 3) {
	console.warn(`Peer ID busy, retrying the same id (${chatState.peerIdRetryAttempt}/3)...`);
	setConnectionState(Boolean(chatState.ws?.readyState === WebSocket.OPEN), t('در حال بازیابی شناسه...', 'Reclaiming identity...'));
	setTimeout(() => rebuildPeerTransport(), 4000 * chatState.peerIdRetryAttempt);
	return;
	}
	console.warn('Peer ID still in use after retries, regenerating...');
	chatState.peerIdRetryAttempt = 0;
	chatState.profile.stablePeerId = generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
	/* A regenerated id belongs to this device alone; the suffix flag has
	   nothing to say about it any more. */
	chatState.profile.peerIdSuffix = false;
	saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
	// Force immediate reconnect with new ID
	setTimeout(() => connectChatTransport(), 500);
	return;
	}
// PeerJS reports ordinary transport hiccups down the same channel as fatal
// configuration errors. Treating every one of them as fatal is what put a red
// toast on screen for each network blip while leaving the peer unrepaired.
if (/browser-incompatible/i.test(errorText)) {
/* No WebRTC in this engine — the peer can never come up here. Latch the
   relay-only mode instead of letting the heal loop destroy and rebuild a
   peer that will always abort. */
chatState.p2pUnavailable = true;
chatState.shouldReconnect = true;
console.warn('[Transport] No WebRTC in this engine; switching to relay-only chat.');
if (chatState.peer && !chatState.peer.destroyed) {
const deadPeer = chatState.peer;
chatState.peer = null;
chatState.peerId = '';
try { deadPeer.destroy(); } catch (_error) { /* already gone */ }
}
if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) {
connectPresence();
} else {
setConnectionState(true, t('متصل به سرور چت', 'Connected to chat server'));
}
if (!chatState.p2pNoticeShown) {
chatState.p2pNoticeShown = true;
notify(t('تماس‌های مستقیم (P2P) در این پلتفرم پشتیبانی نمی‌شوند؛ چت از طریق رله فعال است.', 'Direct (P2P) calls are unavailable on this platform; chat works through the relay.'), 'warning');
}
renderStaticUi();
refreshCallControls();
return;
}
if (/network|socket-error|socket-closed|server-error/i.test(errorText)) {
console.warn('[Transport] Transient peer error, healing:', errorText);
setConnectionState(Boolean(chatState.ws?.readyState === WebSocket.OPEN), t('در حال بازیابی اتصال...', 'Restoring connection...'));
healPeerTransport(errorText);
return;
}
if (/webrtc|negotiat/i.test(errorText)) {
// Media-plane failure: it belongs to the call, not to the transport.
console.warn('[Transport] WebRTC error during a call:', errorText);
return;
}
notifyTransportTrouble(t('اتصال PeerJS با خطا مواجه شد', 'PeerJS connection failed'));
setConnectionState(Boolean(chatState.ws?.readyState === WebSocket.OPEN), t('رله متصل است؛ لایه P2P خطا دارد', 'Relay connected; P2P layer has an error'));
scheduleReconnect();
});
// PeerJS fires this the moment the signalling socket closes. This is the state
// the old code had no handler for at all: destroyed stays false, so the
// reconnect path skipped it and the P2P layer stayed dead until a manual
// reconnect. Every "randomly disconnects and never comes back" report lands here.
peer.on('disconnected', () => {
if (chatState.peer !== peer) return;
console.warn('[Transport] Peer signalling socket closed; reconnecting.');
setConnectionState(Boolean(chatState.ws?.readyState === WebSocket.OPEN), t('در حال بازیابی اتصال...', 'Restoring connection...'));
healPeerTransport('peer-disconnected');
});
peer.on('close', () => {
if (chatState.peer !== peer) return;
chatState.peerId = '';
if (chatState.shouldReconnect) scheduleReconnect();
});
}
async function startSecureSession(targetPeer = null, { silent = false } = {}) {
if (hasActiveServerRestriction()) {
notifyRestrictionOnce();
return null;
}
const peerRecord = targetPeer || activePeer();
/* A group record has no peerId to dial. */
if (peerRecord?.type === 'group') {
  if (!silent) {
    notify(t('در گروه، سشن با هر عضو جداگانه ساخته می‌شود و خودکار انجام می‌شود.',
             'In a group each member has their own session, set up automatically.'), 'info');
  }
  return null;
}
if (!peerRecord) {
  if (!silent) notify(t('اول یک گفتگو را باز کنید.', 'Open a conversation first.'), 'info');
  return null;
}
if (!chatState.peer) {
  if (!silent) notify(t('هنوز به سرور چت وصل نشده‌اید.', 'Not connected to the chat server yet.'), 'warning');
  return null;
}
const existing = chatState.sessions.get(peerRecord.peerId);
if (existing?.connection?.open) {
if (!existing.cryptoKey) await ensureSessionKey(existing, peerRecord);
renderActivePeer();
return existing;
}
const connection = chatState.peer.connect(peerRecord.peerId, {
reliable: true,
metadata: {
clientId: chatState.clientId || chatState.peerId,
username: chatState.profile.name,
publicKeyData: chatState.identity?.publicKeyData || '',
fingerprint: chatState.identity?.fingerprint || '',
},
});
const session = bindDataConnection(peerRecord, connection, true);
session.silent = Boolean(silent);
return chatState.sessions.get(peerRecord.peerId) || null;
}

/* Conversations already advised this session. Held on chatState so it dies
   with the tab: the advice is about the channel's state right now, and a
   preference that outlived a restart would suppress it when it is true. */
const secureSessionAdvised = new Set();

/* Offers to open the live session before a large attachment goes out, and
   returns whatever session the send should then use.

   The condition is narrow on purpose. It has to be a direct conversation with
   somebody the roster says is online, the file has to be big enough that the
   route matters, and — the part that makes it advice rather than noise —
   there must be no open channel already. When a channel is up this does
   nothing at all, which is the ordinary case.

   Returning the session matters: startSecureSession() is what opens the
   channel, and the caller's own `session` is a stale handle after it. */
async function offerSecureSessionBeforeLargeSend(peer, session, file) {
  const size = Number(file?.size || 0);
  if (!peer || peer.type === 'group' || isSelfPeerRecord(peer)) return session;
  if (session?.connection?.open) return session;
  /* peerLooksOnline, not the raw field — a cross-relay contact answers to
     their own relay, and the raw status here says 'offline' for ever. */
  const reachable = typeof peerLooksOnline === 'function' ? peerLooksOnline(peer) : peer.status === 'online';
  if (!reachable) return session;
  if (size < LARGE_FILE_CONFIRM_BYTES) return session;
  const key = getConversationKey(peer) || peer.peerId || '';
  if (!key || secureSessionAdvised.has(key)) return session;
  secureSessionAdvised.add(key);

  const sizeText = app().formatBytes?.(size) || `${size} B`;
  const open = await PoorijaDialogs.confirm(t(
    `برای اطمینان از ارسال صحیح و جلوگیری از دریافت خطای ارسال، «ساخت سشن امن» را در منو بالای چت بزنید تا برای ارسال فایل‌های حجیم آماده شوید.\n\n«${file.name || 'فایل'}» (${sizeText}) الان بدون سشن زندهٔ مستقیم فرستاده می‌شود. همین حالا بسازم؟`,
    `To make sure this goes through and to avoid a send error, tap "Create secure session" in the chat's top menu so you are ready to send large files.\n\n"${file.name || 'This file'}" (${sizeText}) would otherwise go without a live direct session. Create one now?`,
  ), {
    title: t('ارسال فایل حجیم', 'Sending a large file'),
    okLabel: t('ساخت سشن امن', 'Create secure session'),
    cancelLabel: t('بدون آن بفرست', 'Send without it'),
  });
  if (!open) return session;

  notify(t('در حال ساخت سشن امن…', 'Creating the secure session…'), 'info');
  const opened = await startSecureSession(peer, { silent: true });
  /* startSecureSession returns as soon as the connection is being dialled, so
     the channel is usually not open yet on the next line. Wait for it rather
     than handing the send a session that is still coming up — but briefly,
     because a send the user is watching must not hang on a peer that is not
     answering. */
  const deadline = Date.now() + 8000;
  let live = opened || chatState.sessions.get(peer.peerId) || null;
  while (Date.now() < deadline && !live?.connection?.open) {
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    live = chatState.sessions.get(peer.peerId) || live;
  }
  if (!live?.connection?.open) {
    notify(t(
      'سشن امن در این مهلت باز نشد؛ ارسال با مسیر موجود ادامه می‌یابد.',
      'The secure session did not open in time; the send continues on the route available.',
    ), 'warning');
  }
  return live || session;
}

async function sendMessage() {
if (!guardGroupSend('sendMessages')) return;
if (chatState.voiceDraft) {
await sendVoiceDraft();
return;
}
const composer = document.getElementById('chatComposer');
const text = composer?.value.trim();
if (!text) return;
if (chatState.editingMessageId) {
await finalizeMessageEdit(chatState.editingMessageId, text);
return;
}
let session = activeSession();
const peer = getActiveConversation();
const directPeer = activePeer();
if (!peer || !composer) return;
const messageId = generateId('msg');
const timerSeconds = Number(chatState.timerSeconds || 0);
/* One-shot: marking a message hidden applies to this send only, the same way
   the self-destruct timer badge does not persist across messages. */
const hiddenMessage = isHiddenComposeActive();
chatState.hiddenNext = false;
syncHiddenToggleUi();

if (timerSeconds > 0 && directPeer) {
// Same ordering trap as the file path: without this the first self-destruct
// message of a conversation is refused because its session does not exist yet.
if (!session?.cryptoKey) {
session = await ensureDirectSession(directPeer);
}
const liveChannel = Boolean(session?.connection?.open);
/* peerLooksOnline, not the raw field: a cross-relay contact is answered by
   their own relay, and the raw status on this side says 'offline' forever —
   which made every self-destruct message to one refuse to send while their
   dot was green. */
const peerReachable = typeof peerLooksOnline === 'function'
? peerLooksOnline(directPeer) : directPeer.status === 'online';
if (!session?.cryptoKey || (!liveChannel && !peerReachable)) {
const reason = !session?.cryptoKey
? t('سشن امن هنوز آماده نیست', 'the secure session is not ready yet')
: t('کاربر آفلاین است', 'the peer is offline');
notify(t(`پیام خودتخریب ارسال نشد — ${reason}.`, `Self-destruct message not sent — ${reason}.`), 'warning');
return;
}
}

const expiresAt = ''; // Start timer only on delivery
const replyToId = chatState.replyToId;
const createdAt = new Date().toISOString();
if (peer.type === 'group') {
const members = groupDeliveryMemberKeys(peer);
/* groupDeliveryMemberKeys resolves every member to whatever key the peer is
   reachable by right now — usually a peerId, which changes between sessions.
   Writing that back into space.members replaced the stable fingerprint roster
   the group was created with, so after the first message the member list was
   full of volatile ids: removals matched nothing and a reconnected peer looked
   like a stranger. The delivery list is derived; it must not be persisted. */
/* No write-back. groupDeliveryMemberKeys resolves each member to whatever key
   they are reachable by right now — usually a peerId, which changes between
   sessions. Persisting that replaced the stable fingerprint roster the group
   was created with, so removals matched nothing and a reconnected peer looked
   like a stranger. The delivery list is derived; it stays derived. */

appendHistory(peer.conversationId, {
id: messageId,
direction: 'out',
type: 'text',
text,
hidden: hiddenMessage,
senderName: chatState.profile.name || t('شما', 'You'),
senderPeerId: chatState.peerId || '',
senderFingerprint: chatState.identity?.fingerprint || '',
status: 'queued',
expiresAt: '',
timerSeconds,
replyToId,
createdAt,
});
composer.value = '';
/* The draft store is written from the composer's input event, and clearing the
   box in code fires no such event — so the text that was just sent stayed
   filed as a draft and came back the next time the conversation was opened. */
setDraft(chatState.activeConversationId, '');
syncComposerHeight(composer);
clearMessageContext();
let delivered = 0;
for (const memberId of members) {
const member = findPeerByAnyKey(memberId);
if (!member || isSelfPeerRecord(member)) continue;
let memberSession = await ensureStoredSession(member);
if (!memberSession?.cryptoKey) {
/* An offline member used to be skipped here, leaving holes in their copy
   of the group. ensureDirectSession mints an offline key instead. */
memberSession = await ensureDirectSession(member, { silent: true });
}
if (!memberSession?.cryptoKey) continue;
const spacePayload = {
spaceId: peer.conversationId,
spaceType: 'group',
spaceName: peer.name,
/* Stored roster, not the derived delivery list — see sendRichMessage. */
members: normalizeSpaceMembers(peer.members),
ownerPeerId: peer.ownerPeerId || chatState.peerId || '',
ownerClientId: peer.ownerClientId || chatState.clientId || '',
ownerFingerprint: peer.ownerFingerprint || '',
messageId,
text,
senderName: chatState.profile.name || t('شما', 'You'),
senderPeerId: chatState.peerId || '',
senderFingerprint: chatState.identity?.fingerprint || '',
createdAt,
expiresAt: '',
timerSeconds,
replyToId,
hidden: hiddenMessage,
};
const payload = await encryptForSession(memberSession, new TextEncoder().encode(JSON.stringify(spacePayload)));
const outbound = { id: messageId, type: 'space-message', createdAt, payload };
/* `open` does not mean `send succeeded`: PeerJS can throw on a congested
   channel and swallow it. Only a true return counts as delivered, so the
   relay fallback gets its chance instead of a silent loss wearing a ✓. */
if (memberSession.connection?.open
&& safeConnectionSend(memberSession.connection, outbound, 'group-message')) {
delivered += 1;
} else if (await sendSealedRelay(member, memberSession, outbound, { createdAt: outbound.createdAt, scope: 'group' })) {
delivered += 1;
}
}
markMessageStatus(peer.conversationId, messageId, delivered ? 'sent' : 'queued');
if (!delivered && members.length) {
notify(t('پیام گروه ذخیره شد؛ بعد از آماده شدن سشن اعضا دوباره تلاش کنید.', 'Group message was saved; retry after member sessions are ready.'), 'warning');
}
return;
}
const targetPeer = directPeer || (peer && !peer.type ? peer : null);
if (!targetPeer) return;
if (isSelfPeerRecord(targetPeer)) {
notify(t('ارسال پیام به خود همین سشن مجاز نیست.', 'Sending a message to the current session itself is not allowed.'), 'warning');
return;
}
appendHistory(getConversationKey(targetPeer), {
id: messageId,
direction: 'out',
type: 'text',
text,
status: 'queued',
expiresAt: '',
hidden: hiddenMessage,
timerSeconds,
replyToId,
createdAt: new Date().toISOString(),
});
composer.value = '';
/* The draft store is written from the composer's input event, and clearing the
   box in code fires no such event — so the text that was just sent stayed
   filed as a draft and came back the next time the conversation was opened. */
setDraft(chatState.activeConversationId, '');
syncComposerHeight(composer);
clearMessageContext();
if (!session?.cryptoKey) {
notify(t('در حال ساخت سشن امن برای ارسال پیام...', 'Creating secure session before sending...'), 'info');
session = await ensureDirectSession(targetPeer);
}
if (!session?.cryptoKey) {
markMessageStatus(getConversationKey(targetPeer), messageId, 'failed');
notify(t('سشن امن هنوز آماده نیست. چند ثانیه بعد دوباره ارسال کنید یا اتصال را بررسی کنید.', 'Secure session is not ready yet. Try again in a few seconds or check the connection.'), 'warning');
return;
}
const payload = await encryptForSession(session, new TextEncoder().encode(text));
const outbound = {
type: 'text',
id: messageId,
createdAt: new Date().toISOString(),
expiresAt: '',
timerSeconds,
replyToId,
hidden: hiddenMessage,
payload,
};
	/* Same rule as the group path: a data-channel send that throws must not be
	   reported as sent. Fall through to the relay queue so the message survives
	   a flaky channel instead of dying with a confident tick. */
	if (session.connection?.open
	&& safeConnectionSend(session.connection, outbound, 'text-message')) {
	markMessageStatus(getConversationKey(targetPeer), messageId, 'sent');
	} else {
	await sendSealedRelay(targetPeer, session, outbound, { createdAt: outbound.createdAt });
	markMessageStatus(getConversationKey(targetPeer), messageId, 'queued');
	}
	}
// A file upload used to happen in complete silence, so a slow transfer looked
// like nothing was happening at all. Telegram shows progress at the top of the
// thread; so do we.
/* Which transfer the banner is currently showing. A send and a receive can
   overlap, and without this the one that finishes first hides the banner out
   from under the one still running. */
let transferBannerOwner = '';
function setTransferBanner(label, percent = null, options = {}) {
const { detail = '', owner = '', incoming = false } = typeof options === 'string' ? { detail: options } : options;
const banner = document.getElementById('chatTransferBanner');
const text = document.getElementById('chatTransferBannerText');
const detailNode = document.getElementById('chatTransferBannerDetail');
const icon = document.getElementById('chatTransferBannerIcon');
const fill = document.getElementById('chatTransferBarFill');
if (!banner || !text) return;
transferBannerOwner = owner;
banner.classList.remove('hidden');
text.textContent = label;
if (detailNode) {
detailNode.textContent = detail;
detailNode.classList.toggle('hidden', !detail);
}
if (icon) icon.className = incoming ? 'fas fa-download' : 'fas fa-arrow-up-from-bracket';
if (fill) fill.style.width = percent === null ? '0%' : `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
banner.classList.toggle('is-indeterminate', percent === null);
banner.classList.toggle('is-incoming', Boolean(incoming));
/* A send in progress is one tap from stopped. Picking the wrong
   multi-gigabyte file used to mean watching it grind or reloading the
   app; the decline path had a flag all along and only the recipient
   could set it. */
banner.onclick = null;
banner.title = '';
banner.style.cursor = '';
if (!incoming && typeof owner === 'string' && owner.startsWith('send:')
&& typeof cancelOutgoingTransfer === 'function') {
const messageId = owner.slice('send:'.length);
banner.title = t('برای لغو ارسال کلیک کنید', 'Click to cancel the transfer');
banner.style.cursor = 'pointer';
banner.onclick = () => {
for (const [transferId, entry] of chatState.outgoingFiles.entries()) {
if ((entry?.messageId || '') === messageId) { cancelOutgoingTransfer(transferId); break; }
}
};
}
}
function clearTransferBanner(delay = 700, owner = '') {
window.setTimeout(() => {
if (owner && transferBannerOwner !== owner) return;
transferBannerOwner = '';
document.getElementById('chatTransferBanner')?.classList.add('hidden');
}, delay);
}
async function sendFile(file) {
return sendEncryptedBlob(file, 'file', 0);
}
/* `extra` rides along on both the local history entry and the wire message so a
   sticker keeps its emoji and its animation kind on the far side. Files and
   voice notes pass nothing and behave exactly as before. */
/* Cleaning a file on its way out.
 *
 * A format the module does not recognise is passed through untouched - saying
 * "cleaned" about a file nothing was read from is the promise this project
 * does not make. And when the setting is off, a file that really is carrying a
 * location or a name says so once, rather than leaving silently. */
/* Turning a photograph the cleaner cannot open into one it can.
 *
 * A HEIC has its picture data indexed by byte offsets, so nothing can be
 * removed from it without moving the picture out from under its own index.
 * Re-encoding sidesteps that entirely: the pixels are decoded and written out
 * again as a fresh JPEG, and a fresh JPEG carries nothing but the pixels - no
 * camera, no location, no timestamps, because none of it was ever put in.
 *
 * The catch is decoding. Safari and iOS read HEIC; Chrome and Firefox on the
 * desktop do not, and there is no polyfill here worth its weight. So this
 * tries, and says plainly when it cannot rather than pretending.
 *
 * It is offered, never automatic: re-encoding is lossy, and quietly turning
 * somebody's photograph into a smaller different one is not a decision to make
 * on their behalf. */
async function canDecodeImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close?.();
    return true;
  } catch (_error) { /* the engine cannot; the container still might */ }
  /* WebKit decodes HEIC and Chromium does not, so this used to answer no on
     Android and Linux and the photograph went out with its metadata intact --
     the one outcome the offer exists to avoid. A HEIC carries a finished JPEG
     beside its HEVC data, and that is enough to re-encode from. */
  try {
    await window.PoorijaImageFormats?.toDrawableDataUrl(file);
    return true;
  } catch (_error) {
    return false;
  }
}
async function convertImageToJpeg(file, quality = 0.92) {
  /* Through the format module rather than straight to createImageBitmap: on
     an engine that cannot read the container it returns the embedded preview,
     which re-encodes just as well and is the difference between converting
     the photograph and sending it untouched. */
  const drawable = window.PoorijaImageFormats
    ? await fetch((await window.PoorijaImageFormats.toDrawableDataUrl(file)).dataUrl).then((r) => r.blob())
    : file;
  const bitmap = await createImageBitmap(drawable);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const paint = canvas.getContext('2d');
  paint.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('the picture could not be re-encoded');
  const name = file.name ? file.name.replace(/\.[^.]+$/, '') : 'photo';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}
/* Asked once per file, and only for a format nothing can clean. */
async function offerJpegConversion(file, formatLabel) {
  if (!await canDecodeImage(file)) {
    notify(t(`متادیتای ${formatLabel} پاک نمی‌شود و این مرورگر هم نمی‌تواند بازش کند تا تبدیلش کند؛ فایل همان‌طور که هست فرستاده شد.`,
      `Metadata in ${formatLabel} is not removed, and this browser cannot decode it to convert either; the file was sent as it is.`), 'warning');
    return file;
  }
  const choice = await PoorijaDialogs.choose(
    t(`متادیتای ${formatLabel} پاک نمی‌شود. تبدیل به JPEG متادیتا را کامل حذف می‌کند، ولی کیفیت کمی کم می‌شود و فایل عوض می‌شود.`,
      `Metadata in ${formatLabel} cannot be removed. Converting to JPEG removes it completely, at the cost of a re-encode.`),
    [
      { value: 'convert', label: t('تبدیل به JPEG و ارسال', 'Convert to JPEG and send'), hint: t('متادیتا کامل می‌رود', 'nothing carries over') },
      { value: 'asis', label: t('همین‌طور بفرست', 'Send it as it is'), hint: t('متادیتا دست‌نخورده می‌ماند', 'metadata stays in the file') },
    ],
    { okLabel: t('انصراف', 'Cancel') },
  );
  if (choice !== 'convert') {
    if (choice === 'asis') {
      notify(t('فایل با متادیتای خودش فرستاده شد.', 'The file was sent with its metadata.'), 'info');
    }
    return choice === 'asis' ? file : null;
  }
  try {
    const jpeg = await convertImageToJpeg(file);
    notify(t('به JPEG تبدیل شد؛ متادیتا همراهش نیامد.', 'Converted to JPEG; no metadata came with it.'), 'success');
    return jpeg;
  } catch (error) {
    notify(t('تبدیل ممکن نشد؛ فایل همان‌طور که هست فرستاده شد.', 'The conversion failed; the file was sent as it is.'), 'warning');
    return file;
  }
}

window.__jpegConvertProbe = (file) => convertImageToJpeg(file);
async function stripFileMetadataForSend(file) {
  if (!window.PoorijaMetadata || !file) return file;
  if (!app().metadataSettings?.().stripOnSend) {
    try {
      /* Same reasoning on this side: no whole-file read just to word a warning. */
      if (file.size > window.PoorijaMetadata.WHOLE_FILE_CEILING) return file;
      if (await window.PoorijaMetadata.sniffBlob(file) === 'unknown') return file;
      const read = await window.PoorijaMetadata.readMetadata(file);
      const risky = (read.fields || []).filter((f) => f.risk === 'location' || f.risk === 'identity');
      if (risky.length) {
        notify(t(`این فایل ${risky.length} مورد مکان یا هویت دارد و پاک‌سازی خاموش است.`,
          `This file carries ${risky.length} location or identity field(s) and cleaning is off.`), 'warning');
      }
    } catch (error) { /* the warning is a courtesy; its failure must not block a send */ }
    return file;
  }
  try {
    /* Look at the header before touching the file. Reading a large video into
       memory to find out it has no metadata worth removing would undo the
       chunked transfer this path was built around. */
    const format = await window.PoorijaMetadata.sniffBlob(file);
    if (format === 'unknown') return file;
    /* A format this build cannot open is said out loud rather than passed over
       in silence. HEIC and HEIF photographs from phones land here: their
       picture data is found through byte offsets recorded elsewhere in the
       file, so nothing can be removed without moving the picture out from
       under its own index. Sending it untouched is the only safe answer, and
       with cleaning switched on the sender has every reason to assume it was
       cleaned unless told otherwise. */
    const strippable = window.PoorijaMetadata.STRIPPABLE || [];
    if (!strippable.includes(format)) {
      const known = { heif: 'HEIC/HEIF' }[format] || format;
      /* A photograph can be offered a way out: re-encoding drops everything.
         Anything else is simply reported. */
      if (format === 'heif' && app().metadataSettings?.().offerHeicConvert !== false) {
        return await offerJpegConversion(file, known);
      }
      notify(t(`متادیتای فایل‌های ${known} پاک نمی‌شود؛ این فایل همان‌طور که هست فرستاده شد.`,
        `Metadata in ${known} files is not removed; this one was sent as it is.`), 'warning');
      return file;
    }
    if (file.size > window.PoorijaMetadata.WHOLE_FILE_CEILING) {
      notify(t('این فایل برای پاک‌سازی متادیتا خیلی بزرگ است و همان‌طور که هست فرستاده می‌شود.',
        'This file is too large to clean, and is being sent as it is.'), 'warning');
      return file;
    }
    const out = await window.PoorijaMetadata.stripMetadata(file);
    if (!out.supported || !out.removed.length) return file;
    return new File([out.blob], file.name, { type: file.type, lastModified: Date.now() });
  } catch (error) {
    /* A file that could not be cleaned is sent as it was, never dropped. */
    console.warn('[Chat] metadata could not be stripped; sending the file as it is:', error);
    return file;
  }
}
window.__metadataOnSendProbe = (file) => stripFileMetadataForSend(file);

async function sendEncryptedBlob(file, kind = 'file', durationMs = 0, extra = {}) {
/* One gate per kind of thing, because "no media" and "no files" are different
   rules a group might want: a voice note is not a photo and a spreadsheet is
   neither. Stickers ride the media rule, which is what they look like. */
const permission = kind === 'voice' ? 'sendVoice'
  : (kind === 'sticker' ? 'sendStickers'
  : (kind === 'file' ? 'sendFiles' : 'sendMedia'));
if (!guardGroupSend(permission)) return;
/* What a file says about itself goes before the file does. Cleaned here, on
   this device, and before encryption - so what the relay carries is already
   clean rather than trusted to have been cleaned somewhere else. */
file = await stripFileMetadataForSend(file);
/* null means the question about this file was cancelled, not that anything
   failed - so the send stops here rather than going ahead with nothing. */
if (!file) return;
/* Same one-shot toggle as hidden text: consumed by this send. */
const privateSend = isHiddenComposeActive();
if (privateSend) {
chatState.hiddenNext = false;
syncHiddenToggleUi();
}
let session = activeSession();
const conversation = getActiveConversation();
const peer = activePeer();
/* Said out loud rather than returned from.
   A file chosen with no conversation open used to end here in silence: the
   picker closed, nothing appeared, nothing failed, and the only reading
   available was that sending is unreliable. It is a perfectly ordinary thing
   to do — the composer's plus button is reachable from a list with nothing
   selected — and it deserves an answer. */
if (!file) return;
if (!conversation) {
  notify(t('اول یک گفتگو را باز کنید، بعد فایل را بفرستید.',
    'Open a conversation first, then send the file.'), 'warning');
  return;
}
if (file.size > MAX_FILE_BYTES) {
notify(t(`حداکثر حجم فایل ${app().formatBytes(MAX_FILE_BYTES)} است`, `Files are limited to ${app().formatBytes(MAX_FILE_BYTES)}`), 'warning');
return;
}
if (conversation.type === 'group') {
const historyId = generateId(kind === 'voice' ? 'voice' : 'file');
const localUrl = URL.createObjectURL(file);
const timerSeconds = Number(chatState.timerSeconds || 0);

// (The self-destruct guard that used to sit here tested `!conversation.type`
// inside the branch taken only when the type IS 'group' — it could never fire.)

const expiresAt = ''; // Start timer only on delivery
const createdAt = new Date().toISOString();
const members = groupDeliveryMemberKeys(conversation);
/* groupDeliveryMemberKeys resolves every member to whatever key the peer is
   reachable by right now — usually a peerId, which changes between sessions.
   Writing that back into space.members replaced the stable fingerprint roster
   the group was created with, so after the first message the member list was
   full of volatile ids: removals matched nothing and a reconnected peer looked
   like a stranger. The delivery list is derived; it must not be persisted. */
/* No write-back. groupDeliveryMemberKeys resolves each member to whatever key
   they are reachable by right now — usually a peerId, which changes between
   sessions. Persisting that replaced the stable fingerprint roster the group
   was created with, so removals matched nothing and a reconnected peer looked
   like a stranger. The delivery list is derived; it stays derived. */

persistMessageMedia(conversation.conversationId, { id: historyId, type: kind, name: file.name, mime: file.type, createdAt, ...extra }, file);
chatState.mediaUrls.set(historyId, localUrl);
appendHistory(conversation.conversationId, {
id: historyId,
direction: 'out',
type: kind,
...extra,
name: file.name,
size: file.size,
viewOnce: privateSend,
downloadUrl: localUrl,
durationMs: kind === 'voice' ? durationMs : 0,
senderName: chatState.profile.name || t('شما', 'You'),
senderPeerId: chatState.peerId || '',
senderFingerprint: chatState.identity?.fingerprint || '',
status: 'queued',
createdAt,
expiresAt: '',
timerSeconds,
});
let delivered = 0;
let oversizedForOffline = 0;
/* One meter across every member: the file is encrypted once per member, so a
   three-member group really is three times the bytes and the read-out should
   say so rather than restarting at zero three times. */
const groupTargets = Math.max(1, members.length);
const groupMeter = createTransferMeter(file.size * groupTargets);
const groupOwner = `send:${historyId}`;
let groupBase = 0;
setTransferBanner(transferBannerLabel(kind, file.name), 0, { owner: groupOwner });
for (const memberId of members) {
const member = findPeerByAnyKey(memberId);
if (!member || isSelfPeerRecord(member)) continue;
let memberSession = await ensureStoredSession(member);
if (!memberSession?.cryptoKey) {
/* An offline member used to be skipped here, leaving holes in their copy
   of the group. ensureDirectSession mints an offline key instead. */
memberSession = await ensureDirectSession(member, { silent: true });
}
if (!memberSession?.cryptoKey) continue;
if (!memberSession.connection?.open && file.size > MAX_OFFLINE_FILE_BYTES) {
oversizedForOffline += 1;
continue;
}
const transferId = generateId('transfer');
const startMessage = {
type: 'file-start',
transferId,
messageId: historyId,
...extra,
name: file.name,
mime: file.type || 'application/octet-stream',
kind,
size: file.size,
durationMs: kind === 'voice' ? durationMs : 0,
createdAt,
expiresAt: '',
timerSeconds,
viewOnce: privateSend,
spaceId: conversation.conversationId,
spaceType: 'group',
spaceName: conversation.name,
/* Stored roster, not the derived delivery list — see sendRichMessage. */
members: normalizeSpaceMembers(conversation.members),
ownerPeerId: conversation.ownerPeerId || chatState.peerId || '',
ownerClientId: conversation.ownerClientId || chatState.clientId || '',
ownerFingerprint: conversation.ownerFingerprint || '',
senderName: chatState.profile.name || t('شما', 'You'),
senderPeerId: chatState.peerId || '',
senderFingerprint: chatState.identity?.fingerprint || '',
};
const ok = await sendBlobChunks(file, {
session: memberSession,
peerRecord: member,
transferId,
startMessage,
createdAt,
scope: 'group',
onProgress: (bytes) => {
const painted = groupMeter(groupBase + bytes);
if (painted) setTransferBanner(transferBannerLabel(kind, file.name), painted.percent, { detail: painted.detail, owner: groupOwner });
},
});
groupBase += file.size;
if (ok) delivered += 1;
}
/* A refused member has had its explanation already; what the thread records
   must not read 'queued', which promises a delivery nobody will make. */
const groupRefusal = chatState.transferRefusalReason;
const groupWasRefused = !delivered && groupRefusal && (Date.now() - groupRefusal.at) < 5000;
markMessageStatus(conversation.conversationId, historyId, delivered ? 'sent' : (groupWasRefused ? 'failed' : 'queued'));
setTransferBanner(delivered ? t('ارسال شد', 'Sent') : t('ارسال نشد', 'Not sent'), 100, { owner: groupOwner });
clearTransferBanner(700, groupOwner);
if (oversizedForOffline) {
notify(t(
`${oversizedForOffline} عضو آفلاین هستند و فایل‌های بزرگ‌تر از ${app().formatBytes(MAX_OFFLINE_FILE_BYTES)} برای آن‌ها در صف نمی‌رود؛ وقتی آنلاین شوند دوباره بفرستید.`,
`${oversizedForOffline} member(s) are offline, and files larger than ${app().formatBytes(MAX_OFFLINE_FILE_BYTES)} are not queued for them — send again once they are online.`,
), 'warning');
}
if (!delivered && members.length) {
notify(t('فایل/صوت گروه ذخیره شد؛ برای تحویل، سشن امن اعضا باید آماده باشد.', 'Group file/voice was saved; member secure sessions must be ready for delivery.'), 'warning');
}
return;
}
if (!peer) return;
if (isSelfPeerRecord(peer)) {
notify(t('ارسال فایل یا پیام صوتی به همین سشن محلی مجاز نیست.', 'Sending files or voice messages to the current session itself is not allowed.'), 'warning');
return;
}
const historyId = generateId(kind === 'voice' ? 'voice' : 'file');
const localUrl = URL.createObjectURL(file);
const timerSeconds = Number(chatState.timerSeconds || 0);

// Sessions are created lazily on first send, so asking "is there a key?"
// before building one meant the FIRST self-destruct file of any conversation
// was always refused — the send simply stopped here with nothing to show for
// it. Establish the session first, then judge.
if (!session?.cryptoKey) {
session = await ensureDirectSession(peer);
}
/* Both of you are here, but the live channel is not. Say so before the send,
   not after it fails.

   Nothing in the UI distinguished "the recipient is away" from "the peer-to-
   peer channel has not been opened yet", and the two consequences of the
   second both read as somebody else's fault: a file over
   MAX_OFFLINE_FILE_BYTES was refused with "they are offline" while the
   recipient was plainly online and typing, and anything under it took the
   slow road through the relay mailbox for no reason at all. One button in the
   chat's own menu fixes both, so this offers it — and presses it for them if
   they say yes, because sending somebody hunting through a menu mid-send is
   not advice, it is homework.

   Once per conversation per session: an advisory that appears on every
   attachment stops being read. */
session = await offerSecureSessionBeforeLargeSend(peer, session, file);
/* A queued file sits in the recipient's relay mailbox until they come back,
   and that mailbox is 512 MB for everything they are waiting on. One 500 MB
   file would take essentially all of it and evict the rest, so above this the
   sender is asked to wait for the peer instead. Checked before any history is
   written, so a refusal leaves nothing behind. */
if (!session?.connection?.open && file.size > MAX_OFFLINE_FILE_BYTES) {
/* Which of the two it is decides what the sentence can honestly say. */
const peerIsHere = peer?.status === 'online';
notify(peerIsHere
? t(
`ارسال «${file.name || 'فایل'}» نیاز به سشن امن زنده دارد. از منوی بالای چت «ساخت سشن امن» را بزنید و دوباره بفرستید.`,
`Sending "${file.name || 'this file'}" needs a live secure session. Open the chat menu, tap "Create secure session", and send again.`,
)
: t(
`${peer.username || 'مخاطب'} آفلاین است؛ فایل‌های بزرگ‌تر از ${app().formatBytes(MAX_OFFLINE_FILE_BYTES)} فقط وقتی طرف مقابل آنلاین باشد ارسال می‌شوند.`,
`${peer.username || 'This contact'} is offline; files larger than ${app().formatBytes(MAX_OFFLINE_FILE_BYTES)} can only be sent while they are online.`,
), 'warning');
return;
}
if (timerSeconds > 0) {
const target = activePeer() || peer;
// Picking a file opens a system dialog, which backgrounds the page; on the way
// back the presence flag can still read 'offline' for a moment even though the
// P2P channel never dropped. An open data connection is the honest answer to
// "can they receive this right now", so accept either signal. Text and voice
// never hit this because neither opens a picker.
const liveChannel = Boolean(session?.connection?.open);
if (!session?.cryptoKey || (!liveChannel && target?.status !== 'online')) {
// Name the reason: "can only be sent when online" told the user nothing when
// the real blocker was a session that had not finished its key exchange.
const reason = !session?.cryptoKey
? t('سشن امن هنوز آماده نیست', 'the secure session is not ready yet')
: t('کاربر آفلاین است', 'the peer is offline');
notify(t(`فایل خودتخریب ارسال نشد — ${reason}.`, `Self-destruct file not sent — ${reason}.`), 'warning');
return;
}
}

const expiresAt = ''; // Start timer only on delivery
/* The bytes go to the vault as well as to an object URL: the URL dies with
   the tab, the vault entry is what makes the attachment survive a reload. */
persistMessageMedia(getConversationKey(peer), { id: historyId, type: kind, name: file.name, mime: file.type, createdAt: new Date().toISOString(), ...extra }, file);
chatState.mediaUrls.set(historyId, localUrl);
appendHistory(getConversationKey(peer), {
id: historyId,
direction: 'out',
type: kind,
...extra,
name: file.name,
size: file.size,
viewOnce: privateSend,
downloadUrl: localUrl,
durationMs: kind === 'voice' ? durationMs : 0,
status: 'queued',
createdAt: new Date().toISOString(),
expiresAt: '',
timerSeconds,
});
if (!session?.cryptoKey) {
session = await ensureDirectSession(peer);
}
if (!session?.cryptoKey) {
markMessageStatus(getConversationKey(peer), historyId, 'failed');
notify(t('برای ارسال فایل/صدا باید سشن امن آماده باشد.', 'A secure session is required before sending files or voice messages.'), 'warning');
return;
}
const transferId = generateId('transfer');
const sentAt = new Date().toISOString();
const startMessage = {
type: 'file-start',
transferId,
messageId: historyId,
...extra,
name: file.name,
mime: file.type || 'application/octet-stream',
kind,
size: file.size,
durationMs: kind === 'voice' ? durationMs : 0,
createdAt: sentAt,
expiresAt: '',
timerSeconds,
};
const owner = `send:${historyId}`;
const meter = createTransferMeter(file.size);
const label = transferBannerLabel(kind, file.name);
setTransferBanner(label, 0, { owner });
const ok = await sendBlobChunks(file, {
session,
peerRecord: peer,
transferId,
startMessage,
createdAt: sentAt,
onProgress: (bytes) => {
const painted = meter(bytes);
if (painted) setTransferBanner(label, painted.percent, { detail: painted.detail, owner });
},
});
/* A half-sent transfer used to be marked 'sent' regardless, because the loop
   ignored what safeConnectionSend returned. Saying 'failed' is what lets the
   existing retry path pick it up. */
if (!ok) {
markMessageStatus(getConversationKey(peer), historyId, 'failed');
setTransferBanner(t('ارسال ناتمام ماند', 'Transfer did not finish'), 100, { owner });
/* A refused transfer has already told the user exactly what happened — the
   generic "try again" wording would read as if the network had failed. */
const refusal = chatState.transferRefusalReason;
const wasRefused = refusal && refusal.transferId === transferId && (Date.now() - refusal.at) < 5000;
if (!wasRefused) {
notify(t('ارسال فایل کامل نشد؛ دوباره تلاش کنید.', 'The file transfer did not finish; please try again.'), 'warning');
}
} else {
markMessageStatus(getConversationKey(peer), historyId, session.connection?.open ? 'sent' : 'queued');
setTransferBanner(t('ارسال شد', 'Sent'), 100, { owner });
}
clearTransferBanner(700, owner);
renderMessages();
}

/* Whose voice a system note is. Three shapes exist, and each has to prove
   itself:
   — The relay's own: this server writes 'monitor' into the from-field
     itself (a verified peer carries their real fingerprint, an unverified
     socket an empty one, and neither can produce the marker), and the
     payload carries the relay id the recipient has pinned. Transit refuses
     the type, so no far relay can quote the stamp.
   — A sibling's key-change notice: signed with the NEW identity key it
     announces, so the signature is proof the writer holds that key.
   — Any other peer note: nothing legitimate sends them, and they drop. */
async function handleSystemNote(message, payload) {
const noteSender = String(message.fromFingerprint || '');
let authenticated = false;
if (noteSender === 'monitor') {
const pinnedRelayId = chatState.profile?.relayPins?.[chatServerOrigin()]?.id || '';
/* No pin yet is the first-contact case every relay pin starts from; with
   one, only this relay's stamp passes. */
authenticated = !pinnedRelayId || String(payload.relayId || '') === pinnedRelayId;
} else if (payload.keyChange && payload.newPublicKeyData && payload.sig) {
authenticated = await verifyIdentitySignature(
payload.newPublicKeyData,
app().base64ToArrayBuffer(payload.sig),
offlineEnvelopeSignBytes(payload),
).catch(() => false);
}
if (!authenticated) {
console.warn('[Chat] a system note arrived that could not be attributed; ignored');
ackRelayMessage(message.relayId);
return;
}
/* The server's announce centre: a note the RELAY itself wrote, carried the
   same way mail is — online as a relay frame, offline out of the mailbox.
   It is not sealed (the server cannot seal what it cannot read), and that
   is the point: it is the server's own voice, shown in the system
   conversation the old broadcast already used. A peer's key-change notice
   renders through the same door, as a bubble from the account itself. */
const serverAttachment = payload.attachment || null;
appendHistory('system', {
id: generateId('sys'),
type: serverAttachment ? 'file' : 'text',
kind: serverAttachment?.kind === 'audio' ? 'voice' : (serverAttachment?.kind || 'text'),
/* Subject first, body under it — the operator typed both, both arrive. */
text: (payload.title ? payload.title + '\n' : '') + (payload.message || payload.text || ''),
name: serverAttachment?.name || '',
downloadUrl: serverAttachment?.dataUrl || '',
senderName: noteSender === 'monitor' ? t('سرور', 'Server') : t('دستگاه دیگر همین حساب', 'Another device of this account'),
direction: 'in',
status: 'delivered',
timestamp: payload.queuedAt ? Date.parse(payload.queuedAt) : Date.now(),
createdAt: payload.queuedAt || new Date().toISOString(),
system: true,
});
/* No in-app notify here: the server pushes only when the app is NOT awake,
   so the badge and the buzz belong to exactly one of the two, never both. */
ackRelayMessage(message.relayId);
}

/* ------------------------------------------------------------------
 * Device sync — one history, several machines.
 *
 * Phase one put every socket of an identity on the relay's delivery
 * list; this is the other half: the history that already exists on one
 * machine reaching the others. Batches of history entries are sealed
 * exactly like offline mail — a fresh AES key per envelope, wrapped to
 * the identity key every device of this account holds — and addressed
 * to this account's own fingerprint, so the relay carries them the way
 * it carries any envelope and can read none of it. The bundle is never
 * persisted: a device that was away collects the history from the next
 * sync, not out of a mailbox.
 *
 * Only a sibling can produce one. The envelope is signed with the
 * identity key and the receiver checks that signature against its OWN
 * public key before opening anything: a stranger can encrypt to a
 * public key all day, but they cannot sign with its private half.
 * ------------------------------------------------------------------ */

const DEVICE_SYNC_BATCH_ENTRIES = 200;
/* Inline-media budget, per entry and per batch. FILE_CHUNK_BYTES is the
   size every relayed file transfer has used since the beginning — proven
   on both production relays at scale — and measurement agrees: 64 KB
   frames at the send rhythm below arrived 80 of 80 on each server, while
   megabyte frames arrived sometimes and vanished others with no error
   anywhere. Nothing bigger than this rides a sync envelope; the pull
   below slices to the same size. */
const DEVICE_SYNC_FILE_INLINE_BYTES = FILE_CHUNK_BYTES;
const DEVICE_SYNC_BATCH_INLINE_BUDGET = 256 * 1024;
/* A sibling coming online triggers a sync, but a flapping connection
   must not turn that into a broadcast every few seconds. */
const DEVICE_SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;
let deviceSyncLastSentAt = 0;

function deviceSyncFilesEnabled() {
try { return localStorage.getItem(CHAT_DEVICE_SYNC_FILES_STORAGE_KEY) === '1'; } catch (_error) { return false; }
}
function setDeviceSyncFilesEnabled(enabled) {
try { localStorage.setItem(CHAT_DEVICE_SYNC_FILES_STORAGE_KEY, enabled ? '1' : '0'); } catch (_error) { /* private mode */ }
}

/* What one history entry looks like on the wire. An object URL is a
   handle into THIS page's memory and means nothing on another machine, so
   it never travels; whether the bytes do is the opt-in, and only for media
   small enough to ride inline. Two sources of bytes exist: the vault, and
   the rare attachment that never had one — an announcement's data URL,
   which lives only inside the encrypted history itself. */
async function deviceSyncEntryForWire(entry, includeFiles) {
const copy = { ...entry };
const dataUrl = typeof entry.downloadUrl === 'string' && entry.downloadUrl.startsWith('data:')
? entry.downloadUrl
: '';
delete copy.downloadUrl;
if (!includeFiles || !isMediaEntry(copy)) return copy;
try {
if (dataUrl) {
const dataBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
if (dataBase64.length <= DEVICE_SYNC_FILE_INLINE_BYTES) copy.mediaData = dataBase64;
return copy;
}
const stored = await readMessageMedia(copy.id);
if (stored && stored.blob.size <= DEVICE_SYNC_FILE_INLINE_BYTES) {
copy.mediaData = app().arrayBufferToBase64(await stored.blob.arrayBuffer());
}
} catch (_error) { /* the vault declined; the metadata still travels */ }
return copy;
}

async function buildDeviceSyncBundles() {
const includeFiles = deviceSyncFilesEnabled();
const bundles = [];
for (const conversationKey in chatState.history) {
const entries = chatState.history[conversationKey] || [];
/* A batch closes on the entry count OR the inline-media budget, whichever
   comes first: many small entries and a few stickerful ones must both
   produce envelopes inside the frame size the relay path delivers. */
let wireEntries = [];
let inlineBytes = 0;
for (const entry of entries) {
/* Each entry is awaited separately: it may need a vault read, and these
   are the cheap kind of await — local IndexedDB, no network. */
const wireEntry = await deviceSyncEntryForWire(entry, includeFiles);
wireEntries.push(wireEntry);
inlineBytes += (wireEntry.mediaData || '').length;
if (wireEntries.length >= DEVICE_SYNC_BATCH_ENTRIES || inlineBytes >= DEVICE_SYNC_BATCH_INLINE_BUDGET) {
bundles.push({ conversation: conversationKey, entries: wireEntries });
wireEntries = [];
inlineBytes = 0;
}
}
if (wireEntries.length) bundles.push({ conversation: conversationKey, entries: wireEntries });
}
/* The calls list is bounded by CALL_LOG_LIMIT on every device, so it
   fits one envelope with room to spare. */
const calls = (chatState.calls || []).slice(0, CALL_LOG_LIMIT).map((call) => ({ ...call }));
if (calls.length) bundles.push({ calls });
	const contactBundle = buildContactSyncBundle();
	if (contactBundle) bundles.push(contactBundle);
	/* The prekey store travels with everything else. Each device rotates on
	   its own clock, and two diverging stores meant a message sealed to the
	   prekey one device published could only be opened by that device — its
	   sibling met a wall of "could not be opened" notes. A union of both
	   stores, pruned of what has expired, gives every device every private
	   half, whichever prekey a sender happens to seal to. */
	const prekeys = prunePrekeys(loadPrekeys() || []);
	if (prekeys.length) bundles.push({ prekeys: prekeys.map((entry) => ({ ...entry })) });
	return bundles;
}

/* The address book travels with the history: somebody engaged with on one
   machine is somebody the others are about to write to as well. Personal
   contacts only — a space or group is its own record and rides the space
   envelopes, which every device of this account already receives. */
function storedPersonalContacts() {
return (chatState.peers || [])
.filter((peer) => peer.peerId && !peer.type && !peer.system && !isSelfPeerRecord(peer) && isStoredContact(peer))
.slice(0, 500)
.map((peer) => normalizePeerRecord(peer));
}
function buildContactSyncBundle() {
const contacts = storedPersonalContacts();
return contacts.length ? { contacts } : null;
}

/* The bytes a sibling vouches for. Offline envelopes sign
   (fingerprint, peer id, time, body); a device-sync envelope names one more
   thing the relay could otherwise rewrite — WHICH device sent it — so the
   claim and the signature cover it too. */
function deviceSyncSignBytes(envelope) {
return new TextEncoder().encode([
offlineEnvelopeSignBytes(envelope),
String(envelope?.fromDeviceId || ''),
].join('\n'));
}
async function signDeviceSyncEnvelope(envelope) {
try {
const key = await importIdentitySigningKey();
const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, deviceSyncSignBytes(envelope));
envelope.sig = app().arrayBufferToBase64(signature);
envelope.sigv = 1;
} catch (error) {
console.warn('[Chat] could not sign the device-sync envelope:', error);
}
}
async function verifyDeviceSyncSender(envelope) {
try {
if (!envelope?.sig) return false;
return await verifyIdentitySignature(
chatState.identity.publicKeyData,
app().base64ToArrayBuffer(envelope.sig),
deviceSyncSignBytes(envelope),
);
} catch (_error) {
return false;
}
}

async function sealDeviceSyncBundle(bundle) {
const rawKey = app().generateSecureRandomBytes(32);
const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, true, ['encrypt']);
const iv = app().generateSecureRandomBytes(12);
const cipher = await crypto.subtle.encrypt(
{ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(bundle)));
/* Wrapped to this account's own key: every linked device holds the
   private half, nobody else does. */
const publicKey = await importIdentityPublicKey(chatState.identity.publicKeyData);
const seal = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey);
const envelope = {
type: 'device-sync',
fromFingerprint: chatState.identity.fingerprint,
fromDeviceId: getDeviceId(),
seal: app().arrayBufferToBase64(seal),
body: { iv: Array.from(iv), cipher: app().arrayBufferToBase64(cipher) },
createdAt: new Date().toISOString(),
};
	await signDeviceSyncEnvelope(envelope);
	return envelope;
}

let deviceSyncInFlight = false;
async function sendDeviceSync({ contactsOnly = false } = {}) {
if (!chatState.connected || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return false;
if (!chatState.identity?.fingerprint) return false;
/* One sync at a time: the manual button and the sibling-arrival trigger can
   fire together, and two interleaved loops send every bundle twice for
   nothing — the merge would absorb it, the bandwidth would not. A caller
   that arrives mid-sync WAITS for it and then runs: a person pressing the
   button while the automatic pass is on wants their newest history in the
   next pass, not a silent refusal. Bounded, because an in-flight sync is
   finite and a stuck one must not wedge the button for good. */
const waitDeadline = Date.now() + 120 * 1000;
while (deviceSyncInFlight && Date.now() < waitDeadline) {
await new Promise((resolve) => setTimeout(resolve, 200));
}
if (deviceSyncInFlight) return false;
deviceSyncInFlight = true;
try {
	const bundles = contactsOnly ? [] : await buildDeviceSyncBundles();
	/* A contacts-only push is the delta path: the book changed while a sibling
	   was listening, and the history has not. */
	if (contactsOnly) {
	const contactBundle = buildContactSyncBundle();
	if (contactBundle) bundles.push(contactBundle);
	}
	for (const bundle of bundles) {
	const envelope = await sealDeviceSyncBundle(bundle);
	sendRelayEnvelope({ fingerprint: chatState.identity.fingerprint }, envelope);
	/* A breath between envelopes, so a large history does not arrive as
	   one back-to-back wall of frames. */
	await new Promise((resolve) => setTimeout(resolve, 150));
	}
	return true;
} finally {
deviceSyncInFlight = false;
}
}
async function sendDeviceSyncFromUi() {
const sent = await sendDeviceSync();
notify(sent
? t('تاریخچه برای دستگاه‌های متصل ارسال شد', 'History was sent to the linked devices')
: t('اتصال به سرور برقرار نیست؛ بعد از اتصال دوباره تلاش کنید', 'Not connected to the relay; try again after reconnecting'),
sent ? 'success' : 'warning');
}

/* One synced entry into one conversation. The precedence rules are
   appendHistory's, restated because sync is not delivery: no sound, no
   notification, and the unread mark belongs to the device that holds
   it — history arriving is not news arriving. */
function mergeSyncedEntry(conversationKey, entry) {
if (!conversationKey || !entry?.id) return;
const list = chatState.history[conversationKey] || (chatState.history[conversationKey] = []);
const existing = list.find((item) => item.id === entry.id);
if (existing) {
const next = { ...entry };
if (existing.edited && !next.edited) next.text = existing.text;
next.status = chatStatusRank(existing.status) >= chatStatusRank(next.status) ? existing.status : next.status;
next.unread = existing.unread;
next.reactions = existing.reactions || next.reactions;
next.downloadUrl = existing.downloadUrl || next.downloadUrl;
Object.assign(existing, next);
} else {
/* The sender's attention state, not a recomputed one: history arriving is
   not news arriving, but a message their device had not read yet is still
   worth a badge on this one. */
entry.unread = Boolean(entry.unread);
list.push(entry);
list.splice(0, Math.max(0, list.length - 2000));
}
}

async function mergeDeviceSyncBundle(bundle) {
let changed = false;
if (bundle?.conversation && Array.isArray(bundle.entries)) {
for (const entry of bundle.entries) {
/* Inline media arrives as bytes; land it in this device's vault the
   way received media lands, so it survives a reload like any other
   attachment. */
if (entry.mediaData) {
try {
const blob = new Blob([app().base64ToArrayBuffer(entry.mediaData)], { type: entry.mime || 'application/octet-stream' });
persistMessageMedia(bundle.conversation, entry, blob);
entry.downloadUrl = URL.createObjectURL(blob);
chatState.mediaUrls.set(entry.id, entry.downloadUrl);
} catch (_error) { /* the bytes failed to land; the row still does */ }
delete entry.mediaData;
}
mergeSyncedEntry(bundle.conversation, entry);
changed = true;
}
if (changed) {
storeHistory();
renderPeers();
renderMessages();
}
}
	if (Array.isArray(bundle?.calls)) {
	const known = new Set(chatState.calls.map((call) => call.id));
	let callsChanged = false;
	for (const call of bundle.calls) {
	if (!call?.id || known.has(call.id)) continue;
	chatState.calls.push(call);
	callsChanged = true;
	}
	if (callsChanged) {
	chatState.calls.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
	chatState.calls = chatState.calls.slice(0, CALL_LOG_LIMIT);
	saveCalls();
	changed = true;
	}
	}
	/* Contacts arrive add-only: a record this device already knows by peer id
	   or fingerprint is left exactly as it is, because what it holds locally —
	   a nickname, a mute, a pin — is this device's own business. */
	if (Array.isArray(bundle?.contacts)) {
	const byPeerId = new Set(chatState.peers.map((peer) => peer.peerId).filter(Boolean));
	const byFingerprint = new Set(chatState.peers.map((peer) => peer.fingerprint).filter(Boolean));
	let contactsChanged = false;
	for (const contact of bundle.contacts) {
	const record = normalizePeerRecord(contact);
	if (!record.peerId || byPeerId.has(record.peerId)) continue;
	if (record.fingerprint && byFingerprint.has(record.fingerprint)) continue;
	/* Marked so isStoredContact keeps it: nothing here has spoken to them
	   yet, but this account has, on another machine. */
	record.synced = true;
	record.status = 'offline';
	chatState.peers.push(record);
	byPeerId.add(record.peerId);
	if (record.fingerprint) byFingerprint.add(record.fingerprint);
	contactsChanged = true;
	}
	if (contactsChanged) {
	saveContacts();
	renderPeers();
	changed = true;
	}
	}
	if (Array.isArray(bundle?.prekeys)) {
	const known = new Set((loadPrekeys() || []).map((entry) => entry.id));
	const merged = prunePrekeys(loadPrekeys() || []);
	let prekeysChanged = false;
	for (const entry of bundle.prekeys) {
	/* Only a shape a prekey store would hold: an id, both halves, an
	   expiry still in the future (prunePrekeys re-checks it). */
	if (!entry?.id || !entry.publicKeyData || !entry.privateKeyData || known.has(entry.id)) continue;
	merged.push({ ...entry });
	known.add(entry.id);
	prekeysChanged = true;
	}
	if (prekeysChanged) {
	savePrekeys(prunePrekeys(merged));
	chatState.prekeys = prunePrekeys(merged);
	changed = true;
	}
	}
	/* One ring, whichever machine takes it. The invite fans out to every
	   device of the account; the first to answer or refuse tells the others,
	   sealed the same way everything between these devices travels. */
	if (bundle?.callHandled?.callerPeerId) {
	const fromCaller = String(bundle.callHandled.callerPeerId);
	if (chatState.pendingIncomingInvite?.peerId === fromCaller
	|| chatState.pendingIncomingCall?.peer === fromCaller) {
	clearIncomingCall();
	}
	}
	/* The two on-demand shapes. A request is answered in the background; a
	   part is one slice of a pull this device asked for. */
	if (bundle?.fileRequest?.messageId) {
	serveDeviceFileRequest(bundle.fileRequest).catch((error) => console.warn('[Chat] serving a sibling file failed:', error));
	}
	if (bundle?.filePart?.messageId) {
	acceptDeviceFilePart(bundle.filePart);
	}
	return changed;
}

async function handleDeviceSyncEnvelope(message) {
const payload = message.payload || {};
const myFingerprint = chatState.identity?.fingerprint || '';
/* Not addressed from this account's key: nothing to do here. */
if (!payload.body || payload.fromFingerprint !== myFingerprint) return;
/* The relay fans a fingerprint's mail out to every socket holding it,
   including the one that sent it — this device's own copy is a receipt
   it has no use for. */
if (payload.fromDeviceId && payload.fromDeviceId === getDeviceId()) return;
	/* The whole gate: signed by this account's private key — over the
	   deviceId it names as well — which only a linked device holds. Anything
	   else is a stranger sealing garbage and claiming a deviceId, and it
	   stops here — unopened and unmerged. */
	const authentic = await verifyDeviceSyncSender(payload);
if (!authentic) {
console.warn('[Chat] a device-sync envelope arrived that this identity key did not sign; ignored');
return;
}
	try {
	const key = await openOfflineSeal(payload.seal);
const plain = await crypto.subtle.decrypt(
{ name: 'AES-GCM', iv: new Uint8Array(payload.body.iv || []) },
key,
app().base64ToArrayBuffer(payload.body.cipher),
);
await mergeDeviceSyncBundle(JSON.parse(new TextDecoder().decode(plain)));
} catch (_error) {
console.warn('[Chat] a device-sync envelope could not be opened; ignored');
}
}

/* A sibling appearing is the moment one machine's history is wanted on
   the others — the new device just linked, or one coming back online
   after being away while messages arrived elsewhere. Rate-limited, and
   always late by three seconds so the sibling's own connection settles
   first. */
function maybeAnnounceDeviceSync(linkedDeviceCount) {
/* Whatever the count says, this runs on every peers broadcast and is the
   cheap place to forget the pulls that never finished. */
const sweepNow = Date.now();
for (const [pullId, pull] of deviceFilePulls) {
if (sweepNow - pull.at > DEVICE_FILE_PULL_TTL_MS) deviceFilePulls.delete(pullId);
}
if (!linkedDeviceCount || linkedDeviceCount < 2) return;
const now = Date.now();
if (now - deviceSyncLastSentAt < DEVICE_SYNC_MIN_INTERVAL_MS) return;
deviceSyncLastSentAt = now;
setTimeout(() => { sendDeviceSync().catch((error) => console.warn('[Chat] device sync failed:', error)); }, 3000);
}

/* Contacts are an event, not only a snapshot: the moment a new one is
   stored on this machine is the moment the siblings should learn it, not
   the next time a full sync happens. The baseline is whatever the first
   save of this session held, so a reload never re-announces the book. */
const DEVICE_CONTACT_PUSH_MIN_INTERVAL_MS = 30 * 1000;
let deviceContactPushLastAt = 0;
let deviceContactPeerIdsBaseline = null;
function maybePushContactDelta(contacts) {
const ids = new Set((contacts || []).map((peer) => peer.peerId).filter(Boolean));
if (!deviceContactPeerIdsBaseline) {
deviceContactPeerIdsBaseline = ids;
return;
}
const grew = Array.from(ids).some((id) => !deviceContactPeerIdsBaseline.has(id));
deviceContactPeerIdsBaseline = ids;
/* A sibling merging this device's contacts grows its own book, which lands
   here again — with nothing new on the way back, the exchange ends. */
if (!grew) return;
if ((chatState.linkedDevices || []).length < 2) return;
const now = Date.now();
if (now - deviceContactPushLastAt < DEVICE_CONTACT_PUSH_MIN_INTERVAL_MS) return;
deviceContactPushLastAt = now;
setTimeout(() => {
sendDeviceSync({ contactsOnly: true }).catch((error) => console.warn('[Chat] contact delta push failed:', error));
}, 1000);
}

/* ------------------------------------------------------------------
 * Files on demand.
 *
 * Phase two rides an attachment of up to DEVICE_SYNC_FILE_INLINE_BYTES
 * inside the history bundle; a larger one stays on the machine that
 * received it, and the row that reaches a sibling says so. This is the
 * other half: the sibling that wants the bytes asks for them by message
 * id, and they travel the same sealed envelopes, sliced into frames the
 * relay already carries and cannot read.
 * ------------------------------------------------------------------ */

/* One slice of a pulled file: FILE_CHUNK_BYTES, the size the relay path
   has carried reliably since file transfer existed. A pull has to
   reassemble every part, so a part that arrived only sometimes is a pull
   that cannot finish. */
const DEVICE_SYNC_FILE_PART_BYTES = FILE_CHUNK_BYTES;
/* The parts of one pull, held only while it runs. Ten minutes and the
   pull is forgotten — half an assembled file is worth nothing. */
const DEVICE_FILE_PULL_TTL_MS = 10 * 60 * 1000;
const deviceFilePulls = new Map();

/* One ring, whichever machine takes it: the invite reaches every device of
   the account, and the device that answers or refuses tells the others in
   the same sealed envelopes everything between these machines travels in.
   The caller's own cancel already reaches them — it is a relay frame too. */
function announceCallHandled(callerPeerId, action) {
if (!callerPeerId || !chatState.identity?.fingerprint) return;
if ((chatState.linkedDevices || []).length < 2) return;
sealDeviceSyncBundle({ callHandled: { callerPeerId: String(callerPeerId), action } })
.then((envelope) => sendRelayEnvelope({ fingerprint: chatState.identity.fingerprint }, envelope))
.catch(() => { /* the siblings time their own rings out */ });
}

function requestDeviceFile(conversationKey, messageId) {
if (!chatState.connected || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) {
notify(t('اتصال به سرور برقرار نیست؛ بعد از اتصال دوباره تلاش کنید', 'Not connected to the relay; try again after reconnecting'), 'warning');
return;
}
if (!chatState.identity?.fingerprint) return;
if ((chatState.linkedDevices || []).length < 2) {
notify(t('هیچ دستگاه دیگری از این حساب الان آنلاین نیست.', 'No other device of this account is online right now.'), 'warning');
return;
}
if (deviceFilePulls.has(messageId)) return;
const pull = { parts: new Map(), total: 0, meta: null, at: Date.now() };
deviceFilePulls.set(messageId, pull);
/* A pull nobody serves is a button that did nothing: the ring has to come
   back and say so. Generous, because the parts arrive paced. */
pull.timeout = setTimeout(() => {
if (deviceFilePulls.has(messageId)) {
deviceFilePulls.delete(messageId);
notify(t('دریافت فایل از دستگاه دیگر طول کشید و رها شد؛ دوباره تلاش کنید', 'Fetching the file from the other device took too long and was given up; try again'), 'warning');
}
}, 60 * 1000);
sealDeviceSyncBundle({ fileRequest: { conversation: conversationKey, messageId } })
.then((envelope) => {
sendRelayEnvelope({ fingerprint: chatState.identity.fingerprint }, envelope);
notify(t('درخواست فایل برای دستگاه‌های دیگر فرستاده شد', 'The file was requested from the other devices'), 'info');
})
.catch((error) => {
deviceFilePulls.delete(messageId);
console.warn('[Chat] the file request could not be sealed:', error);
});
}

/* The sibling that holds the bytes answers. The toggle governs serving as
   it governs pushing: off means this machine does not hand its files to
   anyone, sibling or not. */
async function serveDeviceFileRequest(request) {
if (!deviceSyncFilesEnabled()) return;
const messageId = String(request?.messageId || '');
if (!messageId) return;
const stored = await readMessageMedia(messageId).catch(() => null);
if (!stored) return;
const bytes = new Uint8Array(await stored.blob.arrayBuffer());
const total = Math.max(1, Math.ceil(bytes.length / DEVICE_SYNC_FILE_PART_BYTES));
for (let part = 0; part < total; part += 1) {
const slice = bytes.subarray(part * DEVICE_SYNC_FILE_PART_BYTES, (part + 1) * DEVICE_SYNC_FILE_PART_BYTES);
const envelope = await sealDeviceSyncBundle({
filePart: {
conversation: String(request.conversation || ''),
messageId,
part,
total,
name: stored.record.name || '',
mime: stored.record.mime || '',
kind: stored.record.kind || 'file',
bytes: app().arrayBufferToBase64(slice),
},
});
sendRelayEnvelope({ fingerprint: chatState.identity.fingerprint }, envelope);
/* Same breathing room the history bundles take. */
await new Promise((resolve) => setTimeout(resolve, 150));
}
}

function acceptDeviceFilePart(part) {
const messageId = String(part?.messageId || '');
if (!messageId) return;
const pull = deviceFilePulls.get(messageId);
if (!pull || Date.now() - pull.at > DEVICE_FILE_PULL_TTL_MS) {
deviceFilePulls.delete(messageId);
return;
}
	if (!pull.total) {
	pull.total = Math.max(1, Math.min(256, Number(part.total) || 1));
	pull.meta = { name: String(part.name || ''), mime: String(part.mime || ''), kind: String(part.kind || 'file') };
	}
pull.parts.set(Number(part.part) || 0, String(part.bytes || ''));
if (pull.parts.size < pull.total) return;
deviceFilePulls.delete(messageId);
if (pull.timeout) clearTimeout(pull.timeout);
const conversationKey = String(part.conversation || '');
const assembled = new Uint8Array(pull.parts.size * DEVICE_SYNC_FILE_PART_BYTES);
let offset = 0;
for (let index = 0; index < pull.total; index += 1) {
const slice = base64ToBytes(pull.parts.get(index) || '');
assembled.set(slice, offset);
offset += slice.length;
}
const blob = new Blob([assembled.subarray(0, offset)], { type: pull.meta.mime || 'application/octet-stream' });
const entry = (chatState.history[conversationKey] || []).find((item) => item.id === messageId);
persistMessageMedia(conversationKey, entry || {
id: messageId,
type: pull.meta.kind,
name: pull.meta.name,
mime: pull.meta.mime,
createdAt: new Date().toISOString(),
}, blob);
const url = URL.createObjectURL(blob);
chatState.mediaUrls.set(messageId, url);
if (entry) {
entry.downloadUrl = url;
entry.mediaMissing = false;
storeHistory();
}
renderMessages();
notify(t(`«${pull.meta.name || 'فایل'}» از دستگاه دیگر رسید`, `"${pull.meta.name || 'file'}" arrived from the other device`), 'success');
}
