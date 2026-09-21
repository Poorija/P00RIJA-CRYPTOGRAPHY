/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 32 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Streaming file transfer
*/

function clearOfflineRing() {
  if (chatState.offlineRingTimer) clearTimeout(chatState.offlineRingTimer);
  chatState.offlineRingTimer = null;
  chatState.offlineRing = null;
  stopSound('ringing');
  document.getElementById('chatFloatingCall')?.classList.add('hidden');
  const status = document.getElementById('chatFloatingCallStatus');
  if (status) status.textContent = t('در حال اتصال...', 'Connecting...');
}
/* They arrived inside the window: place the call for real. The ring captured
   WHO it was waiting for, so the call goes to that peer — startCall re-reading
   the currently open conversation used to dial whoever the user happened to
   be looking at when the contact came online. */
function offlineRingPeerArrived(peerRecord) {
  const ring = chatState.offlineRing;
  if (!ring || !peerRecord || peerRecord.peerId !== ring.peerId) return;
  const mode = ring.mode;
  const target = peerRecord;
  clearOfflineRing();
  notify(t('مخاطب آنلاین شد؛ در حال برقراری تماس...', 'They came online — connecting the call…'), 'info');
  Promise.resolve(startCall(mode, target)).catch(console.error);
}

/* The caller's ring timer. The receiving side has always had one; the calling
   side had none, so an unanswered call rang forever - and if the other side
   had in fact answered but the media never arrived, it rang forever next to a
   call that was already up. */
function clearOutgoingRingTimer() {
  if (chatState.outgoingRingTimer) {
    clearTimeout(chatState.outgoingRingTimer);
    chatState.outgoingRingTimer = null;
  }
}
function startOutgoingRingTimer() {
  clearOutgoingRingTimer();
  chatState.outgoingRingTimer = setTimeout(() => {
    chatState.outgoingRingTimer = null;
    /* Answered in the meantime: nothing to do. */
    if (chatState.currentCallAnsweredAt) return;
    if (!chatState.currentCall) return;
    notify(t('پاسخی داده نشد.', 'There was no answer.'), 'info');
    endCurrentCall();
  }, CALL_RING_TIMEOUT_MS);
}

function bindMediaCall(call, mode, { answered = false, direction = 'out' } = {}) {
chatState.currentCall = call;
chatState.currentCallMode = mode;
chatState.currentCallStartedAt = Date.now();
chatState.currentCallAnsweredAt = answered ? Date.now() : 0;
chatState.currentCallLogged = false;
chatState.currentCallDirection = direction;
chatState.callDisplayMode = 'fullscreen';
chatState.callPrimaryVideo = 'remote';
chatState.callMuted = false;
chatState.callHeld = false;
chatState.callSpeakerEnabled = false;
chatState.callVideoEnabled = mode === 'video';
chatState.remoteCallState = { muted: false, held: false, videoOff: false, screen: false };
chatState.callMirrorSelf = chatState.profile?.mirrorSelfVideo !== false;
syncMirrorSelfView();
applyRemoteCallState(chatState.remoteCallState);
closeCallSettingsPanel();
syncFloatingCallPeerIdentity();
const callLabel = mode === 'video'
? t('تماس تصویری فعال', 'Video call active')
: t('تماس صوتی فعال', 'Voice call active');
document.getElementById('chatCallStatus').textContent = callLabel;
document.getElementById('chatFloatingCallTitle').textContent = callLabel;
document.getElementById('chatFloatingCallStatus').textContent = answered
? t('اتصال امن برقرار است', 'Secure call is active')
: t('در حال زنگ خوردن...', 'Ringing...');
document.getElementById('chatFloatingCall').classList.remove('hidden');
/* Ringing out: start the clock. Already answered: make sure no clock is
   running from a previous attempt. */
if (!answered && direction === 'out') startOutgoingRingTimer();
else clearOutgoingRingTimer();
startCallChromeWatcher();
setCallDisplayMode('fullscreen');
syncCallChromeState();
syncCallOverlayBounds();
document.getElementById('chatEndCallBtn').classList.remove('hidden');
refreshCallControls();
syncCallStageState();
call.on('stream', (stream) => {
chatState.currentCallAnsweredAt = chatState.currentCallAnsweredAt || Date.now();
if (chatState.outgoingCallTimer) {
clearTimeout(chatState.outgoingCallTimer);
chatState.outgoingCallTimer = null;
}
document.getElementById('chatFloatingCallStatus').textContent = t('اتصال امن برقرار است', 'Secure call is active');
startCallDurationTimer();
startCallQualityMonitor();
broadcastCallState();
attachRemoteStream(stream);
});
call.on('close', () => {
endCurrentCall({ closePeer: false });
});
call.on('error', (error) => {
console.error(error);
endCurrentCall({ closePeer: false });
});
const pc = call.peerConnection;
if (pc) {
bindCallIceRecovery(pc, call);
}
}
async function startCall(mode, peerOverride) {
if (hasActiveServerRestriction()) {
notifyRestrictionOnce();
return;
}
if (!webRTCSupported()) {
/* WebKitGTK and friends: the engine cannot build a peer connection, so a
   call here would die mid-negotiation with an error nobody could act on.
   Not a setting that can be flipped — the WebRTC backend is not compiled into
   the WebKitGTK that distributions ship, and `enable-webrtc` sets happily
   while changing nothing. Measured, with the probe, in docs/linux-webrtc.md. */
notify(t('تماس در این پلتفرم پشتیبانی نمی‌شود (WebRTC در دسترس نیست).', 'Calls are not supported on this platform (no WebRTC).'), 'warning');
return;
}
if (isCallBusy()) {
notify(t('ابتدا تماس فعلی را تمام کنید.', 'Finish the current call first.'), 'warning');
return;
}
/* peerOverride is how the offline ring dials the peer it was armed for;
   without it this read the currently open conversation and could call the
   wrong person entirely. */
const active = peerOverride || getActiveConversation();
if (active?.type === 'group') {
/* This used to fan out invites and leave each member to place a separate
   one-to-one call, which is not a group call at all. It is a real mesh now. */
appendCall({
name: active.name,
peerId: active.conversationId,
conversationId: active.conversationId,
mode,
status: 'outgoing',
direction: 'out',
});
await startGroupCall(mode);
return;
}
const peerRecord = activePeer();
if (!peerRecord || !chatState.peer) {
notify(t('برای تماس ابتدا به سرور چت وصل شوید و یک کاربر را انتخاب کنید.', 'Connect to chat and select a peer before calling.'), 'warning');
return;
}
if (isSelfPeerRecord(peerRecord)) {
notify(t('تماس با همین سشن محلی مجاز نیست.', 'Calling the current session itself is not allowed.'), 'warning');
return;
}
let callInviteSent = false;
try {
if (peerRecord.status !== 'online') {
/* An offline contact used to be an instant missed call: nothing rang, and the
   other side only found out afterwards. Now the invitation is queued — which
   also wakes their device through push — and this side rings for thirty
   seconds. If they open the app inside that window the call is placed for
   real; if they do not, it becomes a missed call on both sides.
   What a web app cannot do is ring a closed phone the way a native dialler
   does: what arrives is a notification, and it takes a tap. */
const invited = sendRelayEnvelope(peerRecord, {
type: 'call-invite',
mode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
if (!invited) {
notify(t('کاربر آفلاین است و رله در دسترس نیست.', 'The user is offline and the relay is unavailable.'), 'warning');
return;
}
startOfflineRing(peerRecord, mode);
return;
}

callInviteSent = sendRelayEnvelope(peerRecord, {
type: 'call-invite',
mode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
});
const stream = await requestCallMedia(mode);
attachLocalStream(stream);
syncFloatingCallPeerIdentity();
const call = chatState.peer.call(peerRecord.peerId, stream, {
sdpTransform: preferCallCodecs,
metadata: {
mode,
username: chatState.profile.name,
peerId: chatState.peerId,
},
});
appendCall({
name: peerRecord.username || peerRecord.peerId,
peerId: peerRecord.peerId,
mode,
status: 'outgoing',
direction: 'out',
logToChat: false,
});
bindMediaCall(call, mode);
if (chatState.outgoingCallTimer) clearTimeout(chatState.outgoingCallTimer);
chatState.outgoingCallTimer = setTimeout(() => {
if (!chatState.currentCall || chatState.currentCallAnsweredAt) return;
sendRelayEnvelope(peerRecord, {
type: 'call-missed',
mode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
appendCall({
name: peerRecord.username || peerRecord.peerId,
peerId: peerRecord.peerId,
mode,
status: 'missed',
direction: 'out',
});
notify(t('تماس پاسخ داده نشد.', 'The call was not answered.'), 'info');
endCurrentCall({ closePeer: true, logCall: false });
}, CALL_RING_TIMEOUT_MS);
} catch (error) {
console.error(error);
if (typeof callInviteSent !== 'undefined' && callInviteSent && peerRecord) {
sendRelayEnvelope(peerRecord, {
type: 'call-cancel',
mode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
}
notify(t('دسترسی به میکروفون/دوربین ناموفق بود', 'Failed to access microphone/camera'), 'error');
}
}
function toggleMuteCall() {
if (!chatState.localStream) return;
chatState.callMuted = !chatState.callMuted;
chatState.localStream.getAudioTracks().forEach((track) => {
track.enabled = !chatState.callMuted;
});
refreshCallControls();
broadcastCallState();
}
function toggleHoldCall() {
if (!chatState.localStream) return;
chatState.callHeld = !chatState.callHeld;
chatState.localStream.getTracks().forEach((track) => {
track.enabled = !chatState.callHeld && (track.kind !== 'audio' || !chatState.callMuted) && (track.kind !== 'video' || chatState.callVideoEnabled);
});
document.getElementById('chatFloatingCallStatus').textContent = chatState.callHeld
? t('تماس روی Hold قرار گرفت', 'Call is on hold')
: t('اتصال امن برقرار است', 'Secure call is active');
refreshCallControls();
broadcastCallState();
}
function toggleVideoCall() {
if (!chatState.localStream || chatState.currentCallMode !== 'video') return;
chatState.callVideoEnabled = !chatState.callVideoEnabled;
chatState.localStream.getVideoTracks().forEach((track) => {
track.enabled = chatState.callVideoEnabled && !chatState.callHeld;
});
refreshCallControls();
broadcastCallState();
}
async function flipCameraCall() {
if (!chatState.currentCall || chatState.currentCallMode !== 'video' || !navigator.mediaDevices?.getUserMedia) return;
const nextFacingMode = chatState.callFacingMode === 'user' ? 'environment' : 'user';
try {
const replacement = hintTrackContent(await navigator.mediaDevices.getUserMedia({
video: { facingMode: { ideal: nextFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
audio: false,
}));
const nextTrack = replacement.getVideoTracks()[0];
if (!nextTrack) return;
const sender = chatState.currentCall.peerConnection?.getSenders?.().find((item) => item.track?.kind === 'video');
await sender?.replaceTrack(nextTrack);
const currentVideoTracks = chatState.localStream?.getVideoTracks?.() || [];
currentVideoTracks.forEach((track) => {
chatState.localStream?.removeTrack?.(track);
track.stop();
});
chatState.localStream?.addTrack(nextTrack);
attachLocalStream(chatState.localStream);
chatState.callFacingMode = nextFacingMode;
chatState.callVideoEnabled = true;
refreshCallControls();
syncCallStageState();
} catch (error) {
console.error(error);
notify(t('تعویض دوربین در این دستگاه/مرورگر ممکن نشد.', 'Could not switch cameras on this device/browser.'), 'warning');
}
}
/* notifyPeer:false is for the one case where the call is not ending: a pair
   call growing into a group call. The other side has already been told it
   became a group call; sending "the call ended" straight after it is how the
   upgrade came to look like a hang-up followed by a fresh three-way call. */
function endCurrentCall({ closePeer = true, logCall = true, notifyPeer = true, keepLocalStream = false } = {}) {
/* A ring to somebody who was not connected has no media call behind it, so
   the teardown below would find nothing to do and leave it ringing. */
if (chatState.offlineRing) {
const ring = chatState.offlineRing;
const peer = findPeerRecordByPeerId(ring.peerId);
clearOfflineRing();
if (peer) {
sendRelayEnvelope(peer, {
type: 'call-cancel',
mode: ring.mode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
appendCall({
name: peer.username || peer.peerId,
peerId: peer.peerId,
mode: ring.mode,
status: 'cancelled',
direction: 'out',
});
}
}
stopSound('ringing');
navigator.vibrate?.(0);
clearOutgoingRingTimer();
stopCallDurationTimer();
stopCallQualityMonitor();
closeCallSettingsPanel();
if (document.pictureInPictureElement) {
document.exitPictureInPicture?.().catch(() => {});
}
if (document.fullscreenElement) {
document.exitFullscreen?.().catch(() => {});
}
document.getElementById('chatScreenshotWarning')?.classList.add('hidden');
document.getElementById('chatRemoteStateBadges')?.classList.add('hidden');
if (chatState.endingCurrentCall) return;
chatState.endingCurrentCall = true;
try {
if (chatState.screenStream) {
/* The presentation now owns its own teardown — a screen capture stream and a
   canvas painter are not stopped the same way. */
try { chatState.screenStream.stop?.(); } catch (_error) { /* already gone */ }
chatState.screenStream = null;
}
chatState.callCameraTrack?.stop?.();
chatState.callCameraTrack = null;
const activeCall = chatState.currentCall;
const callPeer = activeCall?.peer || '';
const callMode = chatState.currentCallMode || activeCall?.metadata?.mode || 'voice';
const answeredAt = Number(chatState.currentCallAnsweredAt || 0);
const startedAt = Number(chatState.currentCallStartedAt || Date.now());
const durationMs = answeredAt ? Math.max(0, Date.now() - answeredAt) : 0;
/* Taken from the last sample the quality poll wrote, not read here.
   getStats() is async and this teardown is not — making it async would change
   every call site — and getStats() on a closed RTCPeerConnection returns an
   empty report anyway, so reading at teardown is a race against the close
   below. The poll already runs while the call is up and its counters are
   cumulative for the connection's lifetime, which is exactly the call. */
const callBytes = {
  in: Number(chatState.currentCallBytesIn || 0),
  out: Number(chatState.currentCallBytesOut || 0),
};
chatState.currentCall = null;
clearCallTimers();
if (activeCall) {
activeCall.peerConnection?.getSenders?.().forEach((sender) => {
try {
sender.track?.stop?.();
} catch (_error) {
/* noop */
}
});
if (closePeer) {
try {
activeCall.close();
} catch (_error) {
/* noop */
}
}
}
if (activeCall && logCall && !chatState.currentCallLogged) {
const peer = findPeerRecordByPeerId(callPeer) || activePeer();
const status = answeredAt ? 'ended' : 'missed';
const callDirection = chatState.currentCallDirection || 'out';
// If outgoing call was never answered, send a cancel signal
if (!answeredAt && callDirection === 'out' && peer && notifyPeer) {
sendRelayEnvelope(peer, {
type: 'call-cancel',
mode: callMode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
}
appendCall({
name: peer?.username || activeCall.metadata?.username || callPeer,
peerId: peer?.peerId || callPeer,
mode: callMode,
status,
direction: callDirection,
durationMs,
bytesIn: callBytes.in,
bytesOut: callBytes.out,
});
if (answeredAt && peer && notifyPeer) {
sendRelayEnvelope(peer, {
type: 'call-ended',
mode: callMode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
durationMs,
createdAt: new Date().toISOString(),
});
}
chatState.currentCallLogged = true;
}
/* Who this call was with, and when it stopped. An upgrade notice that arrives
   a moment after the teardown has to be recognised as belonging to this call
   rather than treated as a fresh one. */
{
  /* `callPeer` was captured before currentCall was nulled; reading
     chatState.currentCall here always found null and fell back to whatever
     conversation happened to be open, so a pair→group upgrade right after
     hangup rang as a brand-new call instead of continuing. */
  const lastPeer = findPeerRecordByPeerId(callPeer || '') || activeCallPeerRecord();
  if (lastPeer) {
    chatState.lastPairCall = {
      fingerprint: lastPeer.fingerprint || '',
      peerId: lastPeer.peerId || '',
      endedAt: Date.now(),
    };
  }
}
/* A pair call growing into a group call hands its microphone straight over.
   Stopping it here and opening a new one is a second device acquisition, a
   second camera light, and a visible second or two where the person who
   pressed "add" is in no call at all - which is what made an upgrade look
   like leaving and rejoining. */
if (!keepLocalStream) stopStream(chatState.localStream);
stopStream(chatState.remoteStream);
if (!keepLocalStream) chatState.localStream = null;
chatState.remoteStream = null;
clearMediaElement('chatLocalVideo');
clearMediaElement('chatRemoteVideo');
clearMediaElement('chatFloatingLocalVideo');
stopCallLevelMeter();
clearMediaElement('chatFloatingRemoteVideo');
clearMediaElement('chatIncomingPreviewVideo');
chatState.pendingIncomingCall = null;
chatState.pendingIncomingInvite = null;
chatState.pendingIncomingAccept = false;
chatState.currentCallStartedAt = 0;
chatState.currentCallAnsweredAt = 0;
chatState.currentCallDirection = 'out';
clearIceRecoveryTimer();
chatState.iceRestartAttempt = 0;
chatState.currentCallMode = 'voice';
chatState.callMuted = false;
chatState.callHeld = false;
chatState.callSpeakerEnabled = false;
chatState.callVideoEnabled = true;
chatState.callFacingMode = 'user';
chatState.callDisplayMode = 'fullscreen';
chatState.callPrimaryVideo = 'remote';
chatState.remoteCallState = { muted: false, held: false, videoOff: false, screen: false };
chatState.callActiveSinkId = 'default';
document.getElementById('chatCallStatus').textContent = t('آماده', 'Idle');
document.getElementById('chatEndCallBtn')?.classList.add('hidden');
stopCallChromeWatcher();
document.getElementById('chatFloatingCall')?.classList.add('hidden');
document.getElementById('chatFloatingCall')?.style.removeProperty('width');
document.getElementById('chatFloatingCall')?.style.removeProperty('height');
document.getElementById('chatFloatingCall')?.style.removeProperty('left');
document.getElementById('chatFloatingCall')?.style.removeProperty('top');
document.getElementById('chatFloatingRemoteAvatar')?.classList.remove('hidden');
document.querySelector('.chat-local-stage')?.classList.remove('has-video');
hideIncomingCall();
syncCallChromeState();
refreshCallControls();
syncCallStageState();
renderActivePeer();
/* Show the call log after a call that actually happened. disconnectChat()
   also comes through here to tear down state, and with no call in progress
   that turned every "reconnect" into an unexplained jump to the calls list. */
if (activeCall && chatState.activeView !== 'calls') {
setChatView('calls');
}
} finally {
chatState.endingCurrentCall = false;
/* Whatever route the call took out, its row is finished. Leaving it open
   would let the next call to the same peer merge into it. */
closeActiveCallLog();
}
}
function disconnectChat() {
/* Two flags, because they answer two different questions.
 *
 * shouldReconnect is what the repair machinery reads: the reconnect timer, the
 * watchdog, the foreground-return and network-online handlers all stop when it
 * is false. manualOffline is the stronger statement — somebody asked to be
 * offline — and the 12-second transport supervisor reads that one, because it
 * is the one connect path that must keep working before a transport has ever
 * come up (shouldReconnect starts false, and on a boot into a non-chat tab the
 * supervisor is what dials first). Setting only shouldReconnect here left the
 * supervisor free to rebuild everything this function just tore down, within
 * twelve seconds, every time: the Disconnect button showed Offline and then
 * quietly went back online, and a device told to step away kept draining its
 * relay queue. buildChatTransport() clears manualOffline again, which is what
 * makes the Reconnect button — disconnectChat() then connect — still work. */
chatState.shouldReconnect = false;
chatState.manualOffline = true;
clearReconnectTimer();
if (chatState.heartbeatTimer) {
clearInterval(chatState.heartbeatTimer);
chatState.heartbeatTimer = null;
}
chatState.ws?.close();
chatState.ws = null;
chatState.sessions.forEach((session) => session.connection?.close());
chatState.sessions.clear();
if (chatState.peer && !chatState.peer.destroyed) {
chatState.peer.destroy();
}
chatState.peer = null;
chatState.peerTransportOrigin = '';
chatState.peerId = '';
chatState.clientId = '';
chatState.peers.forEach((peer) => {
if (!peer.type) peer.status = 'offline';
});
saveContacts();
endCurrentCall();
setConnectionState(false, t('آفلاین', 'Offline'));
renderStaticUi();
renderPeers();
renderActivePeer();
}
async function rotateIdentity() {
if (!isUnlocked()) return;
if (!await PoorijaDialogs.confirm(t('بازنشانی کلید چت، سشن‌ها و پیام‌های آفلاین قبلی را غیرقابل بازکردن می‌کند. ادامه می‌دهید؟', 'Resetting the chat key can make previous sessions and offline messages unreadable. Continue?'))) {
return;
}
localStorage.removeItem(CHAT_IDENTITY_STORAGE_KEY);
localStorage.removeItem(CHAT_SESSION_KEYS_STORAGE_KEY);
chatState.identity = null;
chatState.sessionKeys = {};
chatState.sessions.clear();
await ensureIdentity();
renderStaticUi();
broadcastHello();
notify(t('کلید هویتی چت بازسازی شد', 'Chat identity key rotated'), 'success');
}
async function retryQueuedMessages() {
if (!chatState.connected || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return;
/* Every peers broadcast used to run this whole loop again, and two runs
   overlapped freely — the same message sealed to the relay twice per
   reconnect, its copies crowding out other people's held mail. One pass at
   a time. */
if (retryQueuedMessages.inFlight) return;
retryQueuedMessages.inFlight = true;
try {
for (const conversationKey in chatState.history) {
const history = chatState.history[conversationKey];
/* 'relayed' is deliberately absent: the message is already in the server's
   mailbox, and re-sending it on every presence blip only mints duplicate
   envelopes that evict real mail. Only things that never landed are retried. */
const queuedMessages = history.filter(m => m.direction === 'out' && m.status === 'queued');
if (!queuedMessages.length) continue;
const peer = findPeerByConversationKey(conversationKey);
if (peer) {
let session = chatState.sessions.get(peer.peerId) || await ensureStoredSession(peer);
for (const msg of queuedMessages) {
// If message is older than 24h, mark as failed instead of retrying forever
if (msg.createdAt && (Date.now() - Date.parse(msg.createdAt) > 86400000)) {
markMessageStatus(conversationKey, msg.id, 'failed');
continue;
}
if (!session?.cryptoKey) {
session = await ensureStoredSession(peer);
}
if (!session?.cryptoKey || msg.type !== 'text') continue;
const payload = await encryptForSession(session, new TextEncoder().encode(msg.text || ''));
const outbound = {
type: 'text',
id: msg.id,
createdAt: msg.createdAt || new Date().toISOString(),
expiresAt: '',
timerSeconds: Number(msg.timerSeconds || 0),
replyToId: msg.replyToId || '',
/* The original send carried `hidden`; a retried copy without it used to
   land unmasked on the recipient's screen. */
hidden: Boolean(msg.hidden),
payload,
};
if (session.connection?.open && safeConnectionSend(session.connection, outbound, 'retry-message')) {
markMessageStatus(conversationKey, msg.id, 'sent');
} else if (await sendSealedRelay(peer, session, outbound, { createdAt: outbound.createdAt })) {
markMessageStatus(conversationKey, msg.id, 'relayed');
}
}
}
}
} finally {
retryQueuedMessages.inFlight = false;
}
}
