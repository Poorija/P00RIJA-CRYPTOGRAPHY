/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 31 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Streaming file transfer
*/

async function playMediaElement(element) {
if (!element) return;
try {
await element.play?.();
} catch (_error) {
/* ignore autoplay failures */
}
}
function streamHasLiveVideo(stream) {
return Boolean(stream?.getVideoTracks?.().some((track) => track.readyState === 'live'));
}
function prepareVideoElement(element, { muted = false } = {}) {
if (!element) return;
element.autoplay = true;
element.setAttribute('autoplay', 'autoplay');
element.playsInline = true;
element.setAttribute('playsinline', 'true');
element.setAttribute('webkit-playsinline', 'true');
element.preload = 'auto';
element.disablePictureInPicture = true;
element.controls = false;
if (muted) {
element.muted = true;
element.defaultMuted = true;
element.setAttribute('muted', 'muted');
}
}
function syncVideoElementFit(element) {
if (!element) return;
const width = Number(element.videoWidth || 0);
const height = Number(element.videoHeight || 0);
const hasDimensions = width > 0 && height > 0;
const orientation = hasDimensions
? (height > width ? 'portrait' : 'landscape')
: 'unknown';
element.classList.toggle('portrait-mode', orientation === 'portrait');
element.classList.toggle('landscape-mode', orientation === 'landscape');
element.dataset.videoOrientation = orientation;
/* No inline object-fit/transform here any more. Pinning every stream to
   `contain` letterboxed phone-to-phone calls that should have filled the
   screen, and `transform: none` fought the mirror; applyCallStageFit decides
   both from the measured shapes instead. */
const stage = element.closest('.chat-remote-stage, .chat-local-stage');
if (stage) {
stage.dataset.videoOrientation = orientation;
if (hasDimensions) {
stage.style.setProperty('--video-aspect', `${width} / ${height}`);
}
applyCallStageFit(stage);
}
syncCallStageState();
}
function stopStream(stream) {
if (!stream) return;
stream.getTracks().forEach((track) => {
try {
track.stop();
} catch (_error) {
/* noop */
}
});
}
function clearMediaElement(id) {
const element = document.getElementById(id);
if (!element) return;
element.pause?.();
element.srcObject = null;
element.removeAttribute('src');
}
function activeCallPeerRecord() {
return findPeerRecordByPeerId(chatState.currentCall?.peer || chatState.pendingIncomingCall?.peer || chatState.pendingIncomingInvite?.peerId || '') || activePeer() || null;
}
function syncFloatingCallPeerIdentity() {
const peer = activeCallPeerRecord() || getActiveConversation();
const avatar = document.getElementById('chatFloatingRemoteAvatar');
if (avatar && peer) {
avatar.textContent = initials(peer.username || peer.name || peer.peerId || 'P');
avatar.classList.toggle('has-avatar', Boolean(peer.avatarData));
avatar.innerHTML = peer.avatarData ? `<img src="${peer.avatarData}" alt="">` : app().escapeHTML(initials(peer.username || peer.name || peer.peerId || 'P'));
}
const title = document.getElementById('chatFloatingCallTitle');
const status = document.getElementById('chatFloatingCallStatus');
if (title && peer) {
const modeLabel = chatState.currentCallMode === 'video'
? t('تماس تصویری فعال', 'Video call active')
: t('تماس صوتی فعال', 'Voice call active');
title.textContent = `${modeLabel}`;
title.setAttribute('data-peer-name', peer.username || peer.name || peer.peerId || '');
}
if (status && peer && !chatState.currentCall) {
status.textContent = app().escapeHTML(peer.username || peer.name || peer.peerId || '');
}
}
function mountChatPortals() {
const incomingModal = document.getElementById('chatIncomingCallModal');
const floatingCall = document.getElementById('chatFloatingCall');
const timerPopover = document.getElementById('chatTimerPopover');
const avatarChooser = document.getElementById('chatAvatarChooser');
if (incomingModal && incomingModal.parentElement !== document.body) {
document.body.appendChild(incomingModal);
}
const groupCallShell = document.getElementById('chatGroupCall');
if (groupCallShell && groupCallShell.parentElement !== document.body) document.body.appendChild(groupCallShell);
const groupCallInvite = document.getElementById('chatGroupCallInvite');
if (groupCallInvite && groupCallInvite.parentElement !== document.body) document.body.appendChild(groupCallInvite);
/* .chat-shell is overflow:hidden, so anything meant to cover the screen has to
   leave it first. The call picker did not, which is why pressing "add someone"
   during a call appeared to do nothing and the panel only turned up once the
   call screen came down. */
const callPicker = document.getElementById('chatCallPicker');
if (callPicker && callPicker.parentElement !== document.body) document.body.appendChild(callPicker);
const groupMaker = document.getElementById('chatGroupMaker');
if (groupMaker && groupMaker.parentElement !== document.body) document.body.appendChild(groupMaker);
if (floatingCall && floatingCall.parentElement !== document.body) {
document.body.appendChild(floatingCall);
}
if (timerPopover && timerPopover.parentElement !== document.body) {
document.body.appendChild(timerPopover);
}
if (avatarChooser && avatarChooser.parentElement !== document.body) {
document.body.appendChild(avatarChooser);
}
chatState.portalsMounted = true;
chatState.timerPortalMounted = true;
}
function applyFloatingCallPosition() {
const overlay = document.getElementById('chatFloatingCall');
if (!overlay || chatState.callDisplayMode !== 'minimized') return;
overlay.style.left = `${Math.max(12, chatState.floatingCallPosition.x || 24)}px`;
overlay.style.top = `${Math.max(12, chatState.floatingCallPosition.y || 24)}px`;
}
function syncCallChromeState() {
const root = document.documentElement;
const hasCall = Boolean(chatState.currentCall);
const minimized = hasCall && chatState.callDisplayMode === 'minimized';
root.classList.toggle('chat-call-active', hasCall && chatState.callDisplayMode === 'fullscreen');
root.classList.toggle('chat-call-minimized', minimized);
const banner = document.getElementById('chatActiveCallBanner');
if (banner) {
const chatTabActive = appState()?.activeTab === 'chat';
banner.classList.toggle('hidden', !minimized || !chatTabActive);
}
}
function syncCallOverlayBounds() {
const overlay = document.getElementById('chatFloatingCall');
if (!overlay) return;
if (chatState.callDisplayMode === 'minimized' || isCompactChatLayout()) {
overlay.style.left = '';
overlay.style.top = '';
overlay.style.width = '';
overlay.style.height = '';
return;
}
if (window.innerWidth >= 768) {
/* A video call should be as close to fullscreen as the page can get, so it
   covers the app header too; a voice call keeps the header reachable because
   there is nothing to look at underneath it. */
const headerRect = document.getElementById('appHeader')?.getBoundingClientRect();
const top = chatState.currentCallMode === 'video' ? 0 : Math.max(0, Math.round(headerRect?.bottom || 0));
overlay.style.left = '0px';
overlay.style.top = `${top}px`;
overlay.style.width = `${window.innerWidth}px`;
overlay.style.height = `${Math.max(0, window.innerHeight - top)}px`;
return;
}
const host = (window.innerWidth >= 768
? document.getElementById('content-chat')
: document.querySelector('#content-chat > .chat-shell'))
|| document.querySelector('.chat-shell');
if (!host) return;
const rect = host.getBoundingClientRect();
overlay.style.left = `${Math.round(rect.left)}px`;
overlay.style.top = `${Math.round(rect.top)}px`;
overlay.style.width = `${Math.round(rect.width)}px`;
overlay.style.height = `${Math.round(rect.height)}px`;
}
function setCallDisplayMode(mode = 'fullscreen') {
chatState.callDisplayMode = mode;
const overlay = document.getElementById('chatFloatingCall');
const minimizeBtn = document.getElementById('chatMinimizeCallBtn');
if (!overlay) return;
overlay.dataset.callDisplay = mode;
overlay.classList.toggle('is-minimized', mode === 'minimized');
if (mode === 'minimized') {
applyFloatingCallPosition();
minimizeBtn?.setAttribute('title', t('باز کردن دوباره تماس', 'Restore call'));
minimizeBtn?.querySelector('i')?.classList.replace('fa-arrow-right', 'fa-up-right-and-down-left-from-center');
} else {
overlay.style.left = '';
overlay.style.top = '';
minimizeBtn?.setAttribute('title', t('بازگشت به چت / حالت شناور', 'Return to chat / minimize'));
minimizeBtn?.querySelector('i')?.classList.replace('fa-up-right-and-down-left-from-center', 'fa-arrow-right');
}
syncCallChromeState();
syncCallOverlayBounds();
}
function toggleCallDisplayMode() {
if (!chatState.currentCall) return;
setCallDisplayMode(chatState.callDisplayMode === 'minimized' ? 'fullscreen' : 'minimized');
}
function beginFloatingCallDrag(event) {
if (chatState.callDisplayMode !== 'minimized') return;
const overlay = document.getElementById('chatFloatingCall');
if (!overlay) return;
const rect = overlay.getBoundingClientRect();
chatState.draggingFloatingCall = true;
chatState.floatingDragOffset = {
x: event.clientX - rect.left,
y: event.clientY - rect.top,
};
overlay.classList.add('dragging');
}
function moveFloatingCallDrag(event) {
if (!chatState.draggingFloatingCall) return;
const nextX = event.clientX - (chatState.floatingDragOffset?.x || 0);
const nextY = event.clientY - (chatState.floatingDragOffset?.y || 0);
const overlay = document.getElementById('chatFloatingCall');
if (!overlay) return;
const maxX = Math.max(12, window.innerWidth - overlay.offsetWidth - 12);
const maxY = Math.max(12, window.innerHeight - overlay.offsetHeight - 12);
chatState.floatingCallPosition = {
x: Math.min(maxX, Math.max(12, nextX)),
y: Math.min(maxY, Math.max(12, nextY)),
};
applyFloatingCallPosition();
}
function endFloatingCallDrag() {
chatState.draggingFloatingCall = false;
chatState.floatingDragOffset = null;
document.getElementById('chatFloatingCall')?.classList.remove('dragging');
}
function isCallBusy() {
return Boolean(chatState.currentCall || chatState.pendingIncomingCall || chatState.pendingIncomingInvite);
}
function clearCallTimers() {
if (chatState.outgoingCallTimer) {
clearTimeout(chatState.outgoingCallTimer);
chatState.outgoingCallTimer = null;
}
if (chatState.incomingCallTimer) {
clearTimeout(chatState.incomingCallTimer);
chatState.incomingCallTimer = null;
}
}
async function requestCallMedia(mode, includeAudio = true) {
const wantsVideo = mode === 'video';
const audioConstraints = includeAudio
? {
echoCancellation: true,
noiseSuppression: true,
autoGainControl: true,
}
: false;
const preferredConstraints = {
audio: audioConstraints,
video: wantsVideo
? {
facingMode: { ideal: chatState.callFacingMode || 'user' },
width: { ideal: 1280 },
height: { ideal: 720 },
}
: false,
};
try {
return hintTrackContent(await navigator.mediaDevices.getUserMedia(preferredConstraints));
} catch (error) {
if (!wantsVideo) throw error;
return hintTrackContent(await navigator.mediaDevices.getUserMedia({
audio: audioConstraints,
video: true,
}));
}
}
/* Tell the encoder what it is looking at.
 *
 * MediaStreamTrack.contentHint is how a page says whether a stream is moving
 * pictures or fine detail, and the engine uses it to decide what to sacrifice
 * when the link cannot carry everything. Without it every track is "no
 * preference" and the encoder guesses.
 *
 * A camera is 'motion': keep the frame rate and let sharpness go, because a
 * face that stutters is worse to talk to than one that is slightly soft. A
 * shared screen is 'detail': the opposite, since unreadable text at 30fps is
 * no use at all. Audio is 'speech', which lets the encoder spend its bits on
 * the voice band rather than on music it is not carrying.
 *
 * Setting an unknown value throws in some engines, so each one is tried on its
 * own and a refusal leaves that track as it was. */
function hintTrackContent(stream, kind = 'camera') {
  if (!stream?.getTracks) return stream;
  stream.getTracks().forEach((track) => {
    try {
      if (track.kind === 'audio') track.contentHint = 'speech';
      else if (track.kind === 'video') track.contentHint = kind === 'screen' ? 'detail' : 'motion';
    } catch (_error) { /* engine does not take this hint; the default stands */ }
  });
  return stream;
}

function attachLocalStream(stream) {
if (chatState.localStream && chatState.localStream !== stream) {
stopStream(chatState.localStream);
}
chatState.localStream = stream;
const localVideo = document.getElementById('chatLocalVideo');
const floatingLocalVideo = document.getElementById('chatFloatingLocalVideo');
if (localVideo) {
prepareVideoElement(localVideo, { muted: true });
localVideo.srcObject = stream;
localVideo.onloadedmetadata = () => {
playMediaElement(localVideo);
syncVideoElementFit(localVideo);
};
localVideo.onresize = () => syncVideoElementFit(localVideo);
playMediaElement(localVideo);
}
if (floatingLocalVideo) {
prepareVideoElement(floatingLocalVideo, { muted: true });
floatingLocalVideo.srcObject = stream;
floatingLocalVideo.onloadedmetadata = () => {
playMediaElement(floatingLocalVideo);
syncVideoElementFit(floatingLocalVideo);
};
floatingLocalVideo.onresize = () => syncVideoElementFit(floatingLocalVideo);
playMediaElement(floatingLocalVideo);
}
document.querySelector('.chat-local-stage')?.classList.toggle('has-video', streamHasLiveVideo(stream));
syncCallStageState();
}
function attachRemoteStream(stream) {
chatState.remoteStream = stream;
startCallLevelMeter(stream);
const remoteVideo = document.getElementById('chatRemoteVideo');
const floatingRemoteVideo = document.getElementById('chatFloatingRemoteVideo');
if (remoteVideo) {
prepareVideoElement(remoteVideo);
remoteVideo.srcObject = stream;
remoteVideo.onloadedmetadata = () => {
playMediaElement(remoteVideo);
syncVideoElementFit(remoteVideo);
};
remoteVideo.onresize = () => syncVideoElementFit(remoteVideo);
playMediaElement(remoteVideo);
}
if (floatingRemoteVideo) {
prepareVideoElement(floatingRemoteVideo);
floatingRemoteVideo.srcObject = stream;
floatingRemoteVideo.onloadedmetadata = () => {
playMediaElement(floatingRemoteVideo);
syncVideoElementFit(floatingRemoteVideo);
};
floatingRemoteVideo.onresize = () => syncVideoElementFit(floatingRemoteVideo);
playMediaElement(floatingRemoteVideo);
}
syncCallStageState();
}
function syncCallStageState() {
const windowEl = document.querySelector('#chatFloatingCall .chat-floating-call-window');
if (!windowEl) return;
const localVideoEnabled = streamHasLiveVideo(chatState.localStream);
const remoteVideoEnabled = streamHasLiveVideo(chatState.remoteStream);
windowEl.dataset.callMode = chatState.currentCallMode || 'voice';
if (chatState.currentCallMode === 'video') {
if (!['remote', 'local'].includes(chatState.callPrimaryVideo)) {
chatState.callPrimaryVideo = 'remote';
}
if (remoteVideoEnabled) {
chatState.callPrimaryVideo = chatState.callPrimaryVideo || 'remote';
}
} else {
chatState.callPrimaryVideo = 'remote';
}
windowEl.dataset.callPrimary = chatState.callPrimaryVideo || 'remote';
windowEl.dataset.localVideo = localVideoEnabled ? 'on' : 'off';
windowEl.dataset.remoteVideo = remoteVideoEnabled ? 'on' : 'off';
windowEl.dataset.remoteOrientation = document.getElementById('chatFloatingRemoteVideo')?.dataset.videoOrientation
|| document.getElementById('chatRemoteVideo')?.dataset.videoOrientation
|| 'unknown';
windowEl.dataset.localOrientation = document.getElementById('chatFloatingLocalVideo')?.dataset.videoOrientation
|| document.getElementById('chatLocalVideo')?.dataset.videoOrientation
|| 'unknown';
const avatar = document.getElementById('chatFloatingRemoteAvatar');
const showAvatar = chatState.currentCallMode === 'voice' || !remoteVideoEnabled;
if (avatar) avatar.classList.toggle('hidden', !showAvatar);
document.querySelector('#chatFloatingCall .chat-call-hero')?.classList.toggle('hidden', !showAvatar);
syncCallHeroCopy();
bindCallSelfViewGestures();
document.querySelector('.chat-local-stage')?.classList.toggle('has-video', localVideoEnabled);
document.querySelector('.chat-local-stage-placeholder')?.classList.toggle('hidden', localVideoEnabled);
watchCallStageSize();
refreshCallLayout();
}
/* Presenting in a one-to-one call.
   Two things were wrong with the old version. It handed the whole display
   stream to attachLocalStream, which stops the previous stream — including the
   microphone track the audio sender was still transmitting, so sharing your
   screen quietly muted you. And it could only ever offer screen capture, which
   no mobile browser has. Both are fixed by swapping only the video track and
   letting the source be a screen or a picture. */
async function toggleScreenShare(source = 'screen') {
if (!chatState.currentCall || chatState.currentCallMode !== 'video') return;
if (chatState.screenStream) {
await stopDirectPresentation();
return;
}
let track = null;
let stop = null;
try {
if (source === 'screen') {
if (!screenCaptureSupported()) {
notify(t('این مرورگر اجازهٔ ضبط صفحه نمی‌دهد.', 'This browser cannot capture the screen.'), 'warning');
return;
}
const stream = hintTrackContent(await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }), 'screen');
track = stream.getVideoTracks()[0];
stop = () => stream.getTracks().forEach((item) => item.stop());
} else {
const file = await pickImageFile();
if (!file) return;
const picture = await pictureTrackFromFile(file);
track = picture.track;
stop = picture.stop;
}
} catch (error) {
if (error?.name !== 'NotAllowedError') {
notify(t('شروع پرزنت ممکن نشد.', 'Could not start presenting.'), 'warning');
}
return;
}
if (!track) return;
const sender = chatState.currentCall.peerConnection?.getSenders?.().find((item) => item.track?.kind === 'video');
if (!sender) {
stop?.();
notify(t('این تماس مسیر تصویری ندارد.', 'This call has no video path.'), 'warning');
return;
}
chatState.callCameraTrack = chatState.localStream?.getVideoTracks?.()[0] || null;
await sender.replaceTrack(track);
swapLocalStreamVideo(chatState.localStream, track);
refreshLocalPreview();
chatState.screenStream = { source, stop };
track.addEventListener('ended', () => { stopDirectPresentation().catch(() => {}); });
refreshCallControls();
broadcastCallState();
notify(source === 'screen'
? t('صفحهٔ شما در حال پخش است.', 'Your screen is being shared.')
: t('تصویر شما در حال پخش است.', 'Your picture is being shared.'), 'success');
}

async function stopDirectPresentation() {
if (!chatState.screenStream) return;
try { chatState.screenStream.stop?.(); } catch (_error) { /* already gone */ }
chatState.screenStream = null;
let camera = chatState.callCameraTrack;
if (!camera || camera.readyState !== 'live') {
/* The camera track can be gone if the browser released it while presenting;
   ask for a fresh one rather than leaving the far side on a frozen frame. */
try {
const stream = await requestCallMedia('video', false);
camera = stream.getVideoTracks()[0] || null;
} catch (_error) { camera = null; }
}
chatState.callCameraTrack = null;
const sender = chatState.currentCall?.peerConnection?.getSenders?.().find((item) => item.track?.kind === 'video');
if (sender) {
try { await sender.replaceTrack(camera || null); } catch (_error) { /* call may be ending */ }
}
swapLocalStreamVideo(chatState.localStream, camera);
refreshLocalPreview();
refreshCallControls();
broadcastCallState();
}

/* Re-point the preview elements at the same stream. Swapping a track inside a
   MediaStream does not always wake an attached <video>, and a frozen self-view
   is indistinguishable from a broken camera. */
function refreshLocalPreview() {
const stream = chatState.localStream;
['chatLocalVideo', 'chatFloatingLocalVideo'].forEach((id) => {
const element = document.getElementById(id);
if (!element || !stream) return;
element.srcObject = null;
element.srcObject = stream;
playMediaElement(element);
syncVideoElementFit(element);
});
syncCallStageState();
}

function spawnReactionAnimation(emoji, messageId) {
const bubble = document.querySelector(`.chat-message-bubble[data-id="${messageId}"]`);
if (!bubble) return;
const anim = document.createElement('div');
anim.className = 'chat-reaction-animation';
anim.textContent = emoji;
// Position near the bubble center
const rect = bubble.getBoundingClientRect();
anim.style.left = (rect.left + rect.width / 2) + 'px';
anim.style.top = rect.top + 'px';
document.body.appendChild(anim);
setTimeout(() => anim.remove(), 1600);
}
function setCallControlState(id, active, disabled = false) {
const button = document.getElementById(id);
if (!button) return;
button.classList.toggle('active', Boolean(active));
button.disabled = Boolean(disabled);
}
function refreshCallControls() {
setCallControlState('chatMuteToggleBtn', chatState.callMuted, !chatState.currentCall);
setCallControlState('chatHoldToggleBtn', chatState.callHeld, !chatState.currentCall);
setCallControlState('chatSpeakerToggleBtn', chatState.callSpeakerEnabled, !chatState.currentCall);
setCallControlState('chatVideoToggleBtn', !chatState.callVideoEnabled, !chatState.currentCall || chatState.currentCallMode !== 'video');
setCallControlState('chatFlipCameraBtn', false, !chatState.currentCall || chatState.currentCallMode !== 'video');
setCallControlState('chatScreenShareBtn', Boolean(chatState.screenStream), !chatState.currentCall || chatState.currentCallMode !== 'video');
setCallControlState('chatEndCallControlBtn', false, !chatState.currentCall);
const isVideoMode = chatState.currentCallMode === 'video';
const pipSupported = typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled);
const fullscreenSupported = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);
setCallControlState('chatMirrorVideoBtn', chatState.callMirrorSelf, !chatState.currentCall || !isVideoMode);
setCallControlState('chatSwapVideoLayoutBtn', chatState.callPrimaryVideo === 'local', !chatState.currentCall || !isVideoMode);
setCallControlState('chatCallScreenshotBtn', false, !chatState.currentCall || !isVideoMode);
setCallControlState('chatCallPiPBtn', Boolean(document.pictureInPictureElement), !chatState.currentCall || !pipSupported);
setCallControlState('chatCallFullscreenBtn', Boolean(document.fullscreenElement), !chatState.currentCall || !fullscreenSupported);
setCallControlState('chatCallSettingsBtn', false, !chatState.currentCall);
document.getElementById('chatVideoToggleBtn')?.classList.toggle('hidden', !isVideoMode);
document.getElementById('chatFlipCameraBtn')?.classList.toggle('hidden', !isVideoMode);
document.getElementById('chatScreenShareBtn')?.classList.toggle('hidden', !isVideoMode);
document.getElementById('chatCallScreenshotBtn')?.classList.toggle('hidden', !isVideoMode);
document.getElementById('chatMirrorVideoBtn')?.classList.toggle('hidden', !isVideoMode);
document.getElementById('chatSwapVideoLayoutBtn')?.classList.toggle('hidden', !isVideoMode);
document.getElementById('chatCallPiPBtn')?.classList.toggle('hidden', !pipSupported);
document.getElementById('chatCallFullscreenBtn')?.classList.toggle('hidden', !fullscreenSupported);
syncCallStageState();
syncCallVerification().catch(() => { /* the call is fine without the strip */ });
}
function getRingtoneOption(id = chatState.profile.ringtoneId) {
return CHAT_RINGTONE_OPTIONS.find((option) => option.id === id) || CHAT_RINGTONE_OPTIONS[0];
}
function getMessageToneOption(id = chatState.profile.messageToneId) {
return CHAT_MESSAGE_TONE_OPTIONS.find((option) => option.id === id) || CHAT_MESSAGE_TONE_OPTIONS[0];
}
/* A picked audio file wins over the synthesised patterns: if the stored id
   matches an imported sound, that file is what rings. */
function selectedSoundFile(slot) {
  const id = slot === 'message' ? chatState.profile.messageToneId : chatState.profile.ringtoneId;
  const record = findCustomSound(id);
  return record && record.slot === slot ? record : null;
}
function soundSelectMarkup(builtIns, customs, currentId) {
  const builtInGroup = builtIns.map((option) => (
    `<option value="${option.id}">${app().escapeHTML(t(option.labelFa, option.labelEn))}</option>`
  )).join('');
  if (!customs.length) return builtInGroup;
  const customGroup = customs.map((sound) => (
    `<option value="${sound.id}">${app().escapeHTML(sound.title || t('صدای دلخواه', 'Custom sound'))}</option>`
  )).join('');
  return `${builtInGroup}<optgroup label="${app().escapeHTML(t('صداهای من', 'My sounds'))}">${customGroup}</optgroup>`;
}
function renderRingtoneSettings() {
const callSounds = chatState.customSounds.filter((sound) => sound.slot === 'call');
const messageSounds = chatState.customSounds.filter((sound) => sound.slot === 'message');
const ringtoneSelect = document.getElementById('chatRingtoneSelect');
if (ringtoneSelect) {
const stored = chatState.profile.ringtoneId;
const current = findCustomSound(stored)?.id || getRingtoneOption(stored).id;
ringtoneSelect.innerHTML = soundSelectMarkup(CHAT_RINGTONE_OPTIONS, callSounds, current);
ringtoneSelect.value = current;
}
const messageSelect = document.getElementById('chatMessageToneSelect');
if (messageSelect) {
const stored = chatState.profile.messageToneId;
const current = findCustomSound(stored)?.id || getMessageToneOption(stored).id;
messageSelect.innerHTML = soundSelectMarkup(CHAT_MESSAGE_TONE_OPTIONS, messageSounds, current);
messageSelect.value = current;
}
document.getElementById('chatDeleteRingtoneBtn')?.classList.toggle('hidden', !selectedSoundFile('call'));
document.getElementById('chatDeleteMessageToneBtn')?.classList.toggle('hidden', !selectedSoundFile('message'));
}
function ensureRingtoneContext() {
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
if (!AudioContextClass) return null;
if (!chatState.ringtoneAudioContext || chatState.ringtoneAudioContext.state === 'closed') {
chatState.ringtoneAudioContext = new AudioContextClass();
}
return chatState.ringtoneAudioContext;
}
function primeRingtoneAudio() {
const ctx = ensureRingtoneContext();
if (!ctx) return;
ctx.resume?.().catch(() => {});
chatState.ringtonePrimed = true;
}
function playRingtonePattern(id = chatState.profile.ringtoneId) {
const ctx = ensureRingtoneContext();
if (!ctx) return;
ctx.resume?.().catch(() => {});
const option = getRingtoneOption(id);
const masterGain = ctx.createGain();
masterGain.gain.setValueAtTime(0.085, ctx.currentTime);
masterGain.connect(ctx.destination);
option.tones.forEach(([frequency, delayMs, durationMs]) => {
const startAt = ctx.currentTime + (delayMs / 1000);
const endAt = startAt + (durationMs / 1000);
const osc = ctx.createOscillator();
const gain = ctx.createGain();
osc.type = option.wave || 'sine';
osc.frequency.setValueAtTime(frequency, startAt);
gain.gain.setValueAtTime(0, startAt);
gain.gain.linearRampToValueAtTime(1, startAt + 0.025);
gain.gain.exponentialRampToValueAtTime(0.001, Math.max(startAt + 0.03, endAt));
osc.connect(gain);
gain.connect(masterGain);
osc.start(startAt);
osc.stop(endAt + 0.02);
});
window.setTimeout(() => masterGain.disconnect(), Math.max(900, option.gap + 120));
}
/* An imported ringtone is an <audio> element on loop rather than an oscillator
   schedule, so it needs its own start/stop — and stopRingtoneLoop has to kill
   both, or answering a call would leave the file playing under the call. */
function startCustomRingtone(record) {
  stopCustomRingtone();
  const audio = new Audio(customSoundUrl(record));
  audio.loop = true;
  audio.volume = 0.85;
  chatState.customRingtoneAudio = audio;
  return audio.play().catch(() => { /* blocked until a gesture; the UI still shows the call */ });
}
function stopCustomRingtone() {
  const audio = chatState.customRingtoneAudio;
  if (!audio) return;
  chatState.customRingtoneAudio = null;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (_error) { /* already torn down */ }
}
function startRingtoneLoop() {
if (chatState.ringtoneInterval || chatState.customRingtoneAudio) return Promise.resolve();
const custom = selectedSoundFile('call');
if (custom) return startCustomRingtone(custom);
primeRingtoneAudio();
playRingtonePattern();
const option = getRingtoneOption();
chatState.ringtoneInterval = window.setInterval(() => playRingtonePattern(), Math.max(900, option.gap));
return Promise.resolve();
}
function stopRingtoneLoop() {
stopCustomRingtone();
if (chatState.ringtoneInterval) {
window.clearInterval(chatState.ringtoneInterval);
chatState.ringtoneInterval = null;
}
if (chatState.ringtoneStopTimer) {
window.clearTimeout(chatState.ringtoneStopTimer);
chatState.ringtoneStopTimer = null;
}
}
function testRingtone() {
stopRingtoneLoop();
const custom = selectedSoundFile('call');
if (custom) {
startCustomRingtone(custom);
chatState.ringtoneStopTimer = window.setTimeout(stopRingtoneLoop, 4000);
return;
}
primeRingtoneAudio();
playRingtonePattern();
chatState.ringtoneStopTimer = window.setTimeout(stopRingtoneLoop, 2300);
}
const sounds = {
// Standard ringing sound (synthesized)
ringing: {
play: function() {
return startRingtoneLoop();
},
pause: function() {
stopRingtoneLoop();
},
stop: function() { this.pause(); },
currentTime: 0
},
message: {
currentTime: 0,
play: () => playMessageChime(),
pause: () => {},
}
};
// Modern Audio Player state and helpers
const audioPlayers = new Map();
function createModernAudioPlayer(url, containerId) {
const player = {
url,
playbackRate: 1.0,
audio: new Audio(url),
};
// Implementation will be handled in renderMessages
return player;
}
function playSound(name) {
try {
const sound = sounds[name];
if (sound) {
sound.currentTime = 0;
const result = sound.play?.();
if (!result?.catch) return;
result.catch(() => {
// Fallback: try playing on next click if blocked by browser
const once = () => {
const retry = sound.play?.();
retry?.catch?.(() => {});
document.removeEventListener('click', once);
};
document.addEventListener('click', once);
});
}
} catch (e) { /* noop */ }
}
function playMessageChime(id = chatState.profile.messageToneId) {
const customTone = findCustomSound(id);
if (customTone && customTone.slot === 'message') {
const audio = new Audio(customSoundUrl(customTone));
audio.volume = 0.85;
return audio.play().catch(() => {});
}
const context = ensureRingtoneContext();
if (!context) return Promise.resolve();
const option = getMessageToneOption(id);
if (!option.tones.length) return Promise.resolve();
context.resume?.().catch(() => {});
const now = context.currentTime;
const masterGain = context.createGain();
masterGain.gain.setValueAtTime(0.085, now);
masterGain.connect(context.destination);
option.tones.forEach(([frequency, delayMs, durationMs]) => {
const startAt = now + (delayMs / 1000);
const endAt = startAt + (durationMs / 1000);
const oscillator = context.createOscillator();
const gain = context.createGain();
oscillator.type = option.type || 'sine';
oscillator.frequency.setValueAtTime(frequency, startAt);
gain.gain.setValueAtTime(0.0001, startAt);
gain.gain.exponentialRampToValueAtTime(1, startAt + 0.018);
gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(startAt + 0.03, endAt));
oscillator.connect(gain);
gain.connect(masterGain);
oscillator.start(startAt);
oscillator.stop(endAt + 0.02);
});
window.setTimeout(() => masterGain.disconnect(), 650);
return Promise.resolve();
}
function testMessageTone() {
primeRingtoneAudio();
return playMessageChime();
}
function stopSound(name) {
try {
const sound = sounds[name];
if (sound) {
sound.pause();
sound.currentTime = 0;
}
} catch (e) { /* noop */ }
}
function showIncomingCall(call, invite = null) {
const incomingPeerId = call?.peer || invite?.peerId || '';
if (isPeerKeyBlocked(incomingPeerId)) {
/* Blocked callers are hung up on silently, exactly like a blocked message. */
call?.close?.();
return;
}
if (chatState.currentCall && incomingPeerId !== chatState.currentCall?.peer) {
const busyPeer = findPeerRecordByPeerId(incomingPeerId);
if (busyPeer) {
sendRelayEnvelope(busyPeer, {
type: 'call-busy',
mode: call?.metadata?.mode || invite?.mode || 'voice',
name: chatState.profile.name,
peerId: chatState.peerId,
});
}
call?.close?.();
return;
}
const mode = call?.metadata?.mode || invite?.mode || 'voice';
const peer = findPeerRecordByPeerId(incomingPeerId);
const name = call?.metadata?.username || invite?.name || peer?.username || incomingPeerId || t('کاربر P00RIJA', 'P00RIJA User');
const avatarData = peer?.avatarData || '';
navigator.vibrate?.([500, 250, 500, 250, 500]);
// Remove existing if any
document.getElementById('chatIncomingCallModal')?.remove();
const modal = document.createElement('div');
modal.id = 'chatIncomingCallModal';
modal.className = 'chat-incoming-call-modal animate-fade-in';
/* Telegram's incoming screen: the caller's own picture, blurred, IS the
   backdrop; the avatar sits inside breathing rings; the two actions are far
   apart so a half-awake thumb cannot answer when it meant to decline. */
modal.innerHTML = `
<div class="chat-incoming-backdrop" ${avatarData ? `style="background-image:url('${avatarData}')"` : ''}></div>
<div class="chat-incoming-call-content">
<div class="chat-incoming-hero">
<div class="chat-incoming-rings"><span></span><span></span><span></span></div>
<div class="chat-incoming-call-avatar-hero">
${avatarData ? `<img src="${avatarData}" alt="">` : `<span>${initials(name)}</span>`}
</div>
</div>
<div class="chat-incoming-copy">
<h2>${app().escapeHTML(name)}</h2>
<div class="chat-incoming-kind">
<i class="fas ${mode === 'video' ? 'fa-video' : 'fa-phone-volume'}"></i>
<span>${mode === 'video' ? t('تماس تصویری ورودی', 'Incoming video call') : t('تماس صوتی ورودی', 'Incoming voice call')}</span>
</div>
<div class="chat-incoming-e2ee"><i class="fas fa-shield-halved"></i><span>${app().escapeHTML(t('رمزنگاری سرتاسری', 'End-to-end encrypted'))}</span></div>
</div>
<div class="chat-incoming-call-actions">
<div class="chat-incoming-action">
<button id="chatModalRejectBtn" class="chat-incoming-btn is-reject" aria-label="${app().escapeHTML(t('رد کردن', 'Decline'))}">
<i class="fas fa-phone-slash"></i>
</button>
<span>${t('رد کردن', 'Decline')}</span>
</div>
<div class="chat-incoming-action">
<button id="chatModalAcceptBtn" class="chat-incoming-btn is-accept" aria-label="${app().escapeHTML(t('پاسخ دادن', 'Answer'))}">
<i class="fas fa-phone"></i>
</button>
<span>${t('پاسخ دادن', 'Answer')}</span>
</div>
</div>
<button id="chatModalReplyBtn" type="button" class="chat-incoming-reply">
<i class="fas fa-comment-dots"></i><span>${app().escapeHTML(t('رد کردن و ارسال پیام', 'Decline with a message'))}</span>
</button>
</div>
`;
document.body.appendChild(modal);
document.getElementById('chatModalRejectBtn')?.addEventListener('click', rejectIncomingCall);
document.getElementById('chatModalAcceptBtn')?.addEventListener('click', acceptIncomingCall);
document.getElementById('chatModalReplyBtn')?.addEventListener('click', () => {
rejectIncomingCall();
const record = findPeerRecordByPeerId(incomingPeerId);
if (record) {
chatState.activePeerClientId = record.clientId || '';
chatState.activeConversationId = getConversationKey(record);
setChatView('chats');
renderPeers();
renderActivePeer();
}
const composer = document.getElementById('chatComposer');
if (composer) {
composer.value = t('الان نمی‌توانم صحبت کنم.', 'Can\'t talk right now.');
focusComposerWithoutPageJump(composer);
syncComposerDirection();
syncComposerHeight(composer);
}
});
playSound('ringing');
if (call) chatState.pendingIncomingCall = call;
if (invite) chatState.pendingIncomingInvite = invite;
if (chatState.incomingCallTimer) clearTimeout(chatState.incomingCallTimer);
chatState.incomingCallTimer = setTimeout(() => {
const pendingCall = chatState.pendingIncomingCall;
const pendingInvite = chatState.pendingIncomingInvite;
const missedPeerId = pendingCall?.peer || pendingInvite?.peerId || incomingPeerId;
appendCall({
name,
peerId: missedPeerId,
mode,
status: 'missed',
direction: 'in',
});
clearIncomingCall();
}, CALL_RING_TIMEOUT_MS);
syncCallChromeState();
renderActivePeer();
}
function hideIncomingCall() {
stopSound('ringing');
document.getElementById('chatIncomingCallModal')?.remove();
renderActivePeer();
}
/* An incoming ring can end four ways: answered, declined, timed out, or
   cancelled by the caller. Three of them cleared the pending call; the cancel
   path only took the modal off the screen. isCallBusy() reads those pending
   fields, so a caller who hung up before you answered left you permanently
   "in a call" -- every later call, placed or received, was refused until the
   page was reloaded. One definition of "the ring is over", used by all of
   them. */
function clearIncomingCall() {
chatState.pendingIncomingCall?.close?.();
chatState.pendingIncomingCall = null;
chatState.pendingIncomingInvite = null;
chatState.pendingIncomingAccept = false;
if (chatState.incomingCallTimer) {
clearTimeout(chatState.incomingCallTimer);
chatState.incomingCallTimer = null;
}
hideIncomingCall();
}
async function acceptIncomingCall() {
const call = chatState.pendingIncomingCall;
const invite = chatState.pendingIncomingInvite;
hideIncomingCall();
if (chatState.incomingCallTimer) {
clearTimeout(chatState.incomingCallTimer);
chatState.incomingCallTimer = null;
}
if (!call && invite) {
chatState.pendingIncomingAccept = true;
notify(t('در حال برقراری اتصال امن...', 'Establishing secure connection...'), 'info');
return;
}
if (!call) return;
chatState.pendingIncomingAccept = false;
try {
const wantsVideo = call.metadata?.mode === 'video';
const stream = await requestCallMedia(wantsVideo ? 'video' : 'voice');
attachLocalStream(stream);
call.answer(stream, { sdpTransform: preferCallCodecs });
appendCall({
name: call.metadata?.username || call.peer,
peerId: call.peer,
mode: wantsVideo ? 'video' : 'voice',
status: 'answered',
direction: 'in',
logToChat: false,
});
bindMediaCall(call, wantsVideo ? 'video' : 'voice', { answered: true, direction: 'in' });
/* Say so out loud. Until now the only sign the caller had that this side
   picked up was the media arriving - and on a slow link, or one that has to
   go the long way round through TURN, that can take several seconds or fail
   outright. The caller was left listening to a ringing tone next to a call
   that was already up, with no way to tell the difference from no answer. */
{
  const them = findPeerRecordByPeerId(call.peer);
  if (them) {
    relaySessionEvent(them, {
      type: 'call-accepted',
      mode: wantsVideo ? 'video' : 'voice',
      peerId: chatState.peerId,
      createdAt: new Date().toISOString(),
    });
  }
}
} catch (error) {
console.error(error);
notify(t('دسترسی به میکروفون/دوربین ممکن نشد', 'Could not access microphone/camera'), 'error');
call.close();
}
}
function rejectIncomingCall() {
const call = chatState.pendingIncomingCall;
const invite = chatState.pendingIncomingInvite;
const peerId = call?.peer || invite?.peerId;
if (peerId) {
const peer = findPeerRecordByPeerId(peerId);
if (peer) {
sendRelayEnvelope(peer, {
type: 'call-reject',
mode: call?.metadata?.mode || invite?.mode || 'voice',
name: chatState.profile.name,
peerId: chatState.peerId,
});
}
}
if (call) {
appendCall({
name: call.metadata?.username || call.peer,
peerId: call.peer,
mode: call.metadata?.mode || 'voice',
status: 'rejected',
direction: 'in',
});
call.close();
} else if (invite) {
appendCall({
name: invite.name || peerId,
peerId,
mode: invite.mode || 'voice',
status: 'rejected',
direction: 'in',
});
}
clearIncomingCall();
}
function startCallDurationTimer() {
stopCallDurationTimer();
const durationEl = document.getElementById('chatCallDuration');
if (!durationEl) return;
durationEl.classList.remove('hidden');
chatState.callTimerInterval = window.setInterval(() => {
if (!chatState.currentCallAnsweredAt) return;
durationEl.textContent = formatDuration(Date.now() - chatState.currentCallAnsweredAt);
}, 1000);
}
function stopCallDurationTimer() {
if (chatState.callTimerInterval) {
clearInterval(chatState.callTimerInterval);
chatState.callTimerInterval = null;
}
const durationEl = document.getElementById('chatCallDuration');
if (durationEl) {
durationEl.classList.add('hidden');
durationEl.textContent = '';
}
}
function setCallQuality(level, mineLevel = level) {
chatState.callQuality = level;
const badge = document.getElementById('chatCallQualityBadge');
if (!badge) return;
/* The badge is a pill with one segment per direction, and each segment
   carries its own colour: "mine" is what the other side receives from this
   device (the remote's own receiver report), "theirs" is what this device
   receives. A call can be asymmetric — good here, breaking up there — and a
   single colour flattened exactly that away. */
const worst = [level, mineLevel].includes('bad') ? 'bad'
  : [level, mineLevel].includes('ok') ? 'ok'
  : [level, mineLevel].includes('good') ? 'good' : 'unknown';
badge.classList.remove('good', 'ok', 'bad');
if (worst !== 'unknown') badge.classList.add(worst);
const worstIn = (chatState.callQualityReadings || [])
  .filter((reading) => reading.rtt !== null)
  .sort((a, b) => b.rtt - a.rtt)[0];
const worstOut = (chatState.callQualityReadings || [])
  .filter((reading) => reading.mine && reading.mine.rtt !== null)
  .map((reading) => reading.mine)
  .sort((a, b) => b.rtt - a.rtt)[0];
const paintSide = (sideId, valueId, whoFa, whoEn, reading, legLevel) => {
  const side = document.getElementById(sideId);
  if (!side) return;
  side.classList.remove('good', 'ok', 'bad');
  if (legLevel && legLevel !== 'unknown') side.classList.add(legLevel);
  const who = side.querySelector('.chat-call-quality-who');
  if (who) who.textContent = t(whoFa, whoEn);
  const value = document.getElementById(valueId);
  if (value) value.textContent = reading && reading.rtt !== null ? `${reading.rtt}ms` : '—';
};
paintSide('chatCallQualityMine', 'chatCallQualityMineValue', 'من', 'Me', worstOut, mineLevel);
paintSide('chatCallQualityTheirs', 'chatCallQualityTheirsValue', 'او', 'Them', worstIn, level);
badge.title = worst === 'good'
? t('کیفیت اتصال: عالی', 'Connection quality: excellent')
: worst === 'ok'
? t('کیفیت اتصال: متوسط', 'Connection quality: fair')
: worst === 'bad'
? t('کیفیت اتصال: ضعیف', 'Connection quality: poor')
: t('کیفیت اتصال', 'Connection quality');
}
/* The panel, drawn from the readings the monitor already took.
 *
 * The question people ask during a bad call is not "what is my jitter" — it is
 * "is it me, them, or this app". So the numbers come with an answer to that,
 * and the answer names the network when the network is what is wrong. */
function renderCallQualityCard() {
  const card = document.getElementById('chatCallQualityCard');
  const body = document.getElementById('chatCallQualityBody');
  if (!card || !body || card.classList.contains('hidden')) return;

  const readings = chatState.callQualityReadings || [];
  const esc = (value) => window.PoorijaApp?.escapeHTML?.(String(value ?? '')) ?? String(value ?? '');

  if (!readings.length) {
    body.innerHTML = `<p class="chat-call-quality-empty">${esc(t(
      'هنوز اندازه‌ای نیست. چند ثانیه پس از برقراری تماس پر می‌شود.',
      'No reading yet. This fills in a few seconds after the call connects.'))}</p>`;
    return;
  }

  const verdictFor = (reading) => {
    const level = callQualityLevel(reading);
    if (level === 'unknown') return t('در حال برقراری', 'connecting');
    if (level === 'good') return t('خوب', 'good');
    if (level === 'ok') return t('قابل‌قبول', 'usable');
    return t('ضعیف — مشکل از شبکه است، نه برنامه',
      'poor — this is the network, not the app');
  };

  const nameFor = (reading) => {
    if (!reading.key) return t('طرف مقابل', 'the other side');
    const member = chatState.groupCall?.connections?.get(reading.key);
    return member?.username || member?.name || reading.key;
  };

  const rows = readings.map((reading) => {
    const level = callQualityLevel(reading);
    const stat = (label, value) =>
      `<div class="chat-call-quality-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    return `<article class="chat-call-quality-row is-${esc(level)}">
      <header>
        <span class="chat-call-quality-peer">${esc(nameFor(reading))}</span>
        <span class="chat-call-quality-verdict">${esc(verdictFor(reading))}</span>
      </header>
      <div class="chat-call-quality-stats">
        ${stat(t('رفت‌وبرگشت', 'round trip'), reading.rtt === null ? '—' : `${reading.rtt} ms`)}
        ${stat(t('اتلاف بسته', 'packet loss'), `${reading.lossPercent}%`)}
        ${stat(t('لرزش', 'jitter'), reading.jitter === null ? '—' : `${reading.jitter} ms`)}
        ${stat(t('دریافت‌شده', 'received'),
          window.PoorijaApp?.formatBytes?.(reading.bytes) ?? `${reading.bytes} B`)}
      </div>
    </article>`;
  });
  /* The outbound direction, in the same terms: what the other side receives
   * from this device. Null when the browser does not report it. */
  const mineWorst = readings
    .map((reading) => reading.mine)
    .filter(Boolean)
    .sort((a, b) => (b.rtt ?? 0) - (a.rtt ?? 0))[0];
  if (mineWorst) {
    const mineLevel = callQualityLevel({ rtt: mineWorst.rtt, lossPercent: mineWorst.lossPercent });
    const stat = (label, value) =>
      `<div class="chat-call-quality-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    rows.unshift(`<article class="chat-call-quality-row is-${esc(mineLevel)}">
      <header>
        <span class="chat-call-quality-peer">${esc(t('شما — آنچه طرف مقابل دریافت می‌کند', 'You — as the other side receives you'))}</span>
        <span class="chat-call-quality-verdict">${esc(verdictFor({ rtt: mineWorst.rtt, lossPercent: mineWorst.lossPercent }))}</span>
      </header>
      <div class="chat-call-quality-stats">
        ${stat(t('رفت‌وبرگشت', 'round trip'), mineWorst.rtt === null ? '—' : `${mineWorst.rtt} ms`)}
        ${stat(t('اتلاف بسته', 'packet loss'), `${mineWorst.lossPercent}%`)}
        ${stat(t('لرزش', 'jitter'), mineWorst.jitter === null ? '—' : `${mineWorst.jitter} ms`)}
      </div>
    </article>`);
  }
  body.innerHTML = rows.join('');
}

function isCallSignalFromActivePeer(payload, message) {
const activeRecord = chatState.currentCall ? activeCallPeerRecord() : null;
if (!activeRecord) return false;
return payload.peerId === activeRecord.peerId || message.fromFingerprint === activeRecord.fingerprint;
}
async function handleCallRenegotiateOffer(payload, message) {
if (!isCallSignalFromActivePeer(payload, message)) return;
const pc = chatState.currentCall?.peerConnection;
if (!pc || !payload.sdp) return;
try {
await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
const answer = await pc.createAnswer();
answer.sdp = preferCallCodecs(answer.sdp);
await pc.setLocalDescription(answer);
const peerRecord = activeCallPeerRecord();
if (peerRecord) {
sendRelayEnvelope(peerRecord, {
type: 'call-renegotiate-answer',
peerId: chatState.peerId,
sdp: { type: answer.type, sdp: answer.sdp },
});
}
// Open our own candidate trickle for the restarted session.
chatState.iceRestartAttempt = Math.max(chatState.iceRestartAttempt, 1);
setCallStatusText(t('در حال بازیابی تماس...', 'Recovering the call...'));
} catch (error) {
console.warn('[Call] Renegotiation offer rejected:', error);
}
}
async function handleCallRenegotiateAnswer(payload, message) {
if (!isCallSignalFromActivePeer(payload, message)) return;
const pc = chatState.currentCall?.peerConnection;
if (!pc || !payload.sdp) return;
try {
await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
} catch (error) {
console.warn('[Call] Renegotiation answer rejected:', error);
}
}
async function handleCallRemoteCandidate(payload, message) {
if (!isCallSignalFromActivePeer(payload, message)) return;
const pc = chatState.currentCall?.peerConnection;
if (!pc || !payload.candidate) return;
try {
await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
} catch (error) {
console.warn('[Call] Remote candidate rejected:', error);
}
}
function clearIceRecoveryTimer() {
if (chatState.iceRecoveryTimer) {
clearTimeout(chatState.iceRecoveryTimer);
chatState.iceRecoveryTimer = null;
}
}
function setCallStatusText(text) {
const el = document.getElementById('chatFloatingCallStatus');
if (el) el.textContent = text;
}
// PeerJS 1.5 never renegotiates: its Negotiator makes exactly one offer and
// closes any connection that receives a second one. So restartIce() on its own
// is inert here — the new offer would have nowhere to go. We carry the ICE
// restart over the app's own relay channel instead, which is already
// authenticated and already used for call-invite/call-state.
async function sendIceRestartOffer(pc) {
const peerRecord = activeCallPeerRecord();
if (!peerRecord || !pc) return false;
try {
const offer = await pc.createOffer({ iceRestart: true });
offer.sdp = preferCallCodecs(offer.sdp);
await pc.setLocalDescription(offer);
return sendRelayEnvelope(peerRecord, {
type: 'call-renegotiate',
peerId: chatState.peerId,
sdp: { type: offer.type, sdp: offer.sdp },
});
} catch (error) {
console.warn('[Call] ICE restart offer failed:', error);
return false;
}
}
function attemptCallRecovery(pc, reason) {
if (!chatState.currentCall || chatState.currentCall.peerConnection !== pc) return;
// Both ends can see the failure at the same moment. Let only the caller
// re-offer, otherwise the two offers collide and neither side recovers.
if ((chatState.currentCallDirection || 'out') !== 'out') {
setCallStatusText(t('در حال بازیابی تماس...', 'Recovering the call...'));
// The caller drives the restart, but do not wait on it forever.
clearIceRecoveryTimer();
chatState.iceRecoveryTimer = setTimeout(() => {
chatState.iceRecoveryTimer = null;
if (!chatState.currentCall || chatState.currentCall.peerConnection !== pc) return;
if (['connected', 'completed'].includes(pc.iceConnectionState)) return;
notifyTransportTrouble(t('تماس به دلیل قطع شدن شبکه پایان یافت.', 'The call ended because the network dropped.'));
endCurrentCall({ closePeer: false });
}, 25000);
return;
}
if (chatState.iceRestartAttempt >= 3) {
notifyTransportTrouble(t('تماس به دلیل قطع شدن شبکه پایان یافت.', 'The call ended because the network dropped.'));
endCurrentCall({ closePeer: false });
return;
}
chatState.iceRestartAttempt += 1;
console.warn(`[Call] ICE recovery attempt ${chatState.iceRestartAttempt} (${reason})`);
setCallStatusText(t('در حال بازیابی تماس...', 'Recovering the call...'));
sendIceRestartOffer(pc);
clearIceRecoveryTimer();
chatState.iceRecoveryTimer = setTimeout(() => {
chatState.iceRecoveryTimer = null;
if (!chatState.currentCall || chatState.currentCall.peerConnection !== pc) return;
if (['connected', 'completed'].includes(pc.iceConnectionState)) return;
attemptCallRecovery(pc, 'restart-did-not-take');
}, 9000);
}
function bindCallIceRecovery(pc, call) {
chatState.iceRestartAttempt = 0;
clearIceRecoveryTimer();
// PeerJS's own negotiator installs an ICE listener that hangs up the moment
// iceConnectionState reaches "failed" -- see Negotiator._setupListeners. That
// is the second reason calls died on a brief loss of the media path: the
// library tore the call down before any restart could be attempted. Take the
// handler over and keep everything it did except the hang-up.
pc.oniceconnectionstatechange = () => {
const state = pc.iceConnectionState;
if (state === 'completed') pc.onicecandidate = () => {};
try { call?.emit?.('iceStateChanged', state); } catch (_error) { /* optional */ }
};
// Trickle our own candidates over the relay so a restarted ICE session can
// actually complete; PeerJS stops forwarding them once it has negotiated.
pc.addEventListener('icecandidate', (event) => {
if (!event.candidate || !chatState.iceRestartAttempt) return;
const peerRecord = activeCallPeerRecord();
if (!peerRecord) return;
sendRelayEnvelope(peerRecord, {
type: 'call-ice',
peerId: chatState.peerId,
candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
});
});
pc.addEventListener('iceconnectionstatechange', () => {
const state = pc.iceConnectionState;
if (['connected', 'completed'].includes(state)) {
clearIceRecoveryTimer();
chatState.iceRestartAttempt = 0;
setCallStatusText(t('اتصال امن برقرار است', 'Secure call is active'));
return;
}
if (state === 'disconnected') {
// ICE recovers from this on its own most of the time, so give it a
// grace period before spending a renegotiation on it.
setCallStatusText(t('شبکه ناپایدار است؛ تماس حفظ می‌شود...', 'Network unstable; holding the call...'));
clearIceRecoveryTimer();
chatState.iceRecoveryTimer = setTimeout(() => {
chatState.iceRecoveryTimer = null;
if (!chatState.currentCall || chatState.currentCall.peerConnection !== pc) return;
if (pc.iceConnectionState === 'disconnected') attemptCallRecovery(pc, 'disconnected');
}, 5000);
return;
}
if (state === 'failed') {
// The old code hung up here. A failed ICE session is recoverable by
// restarting it, which is what every mainstream client does.
attemptCallRecovery(pc, 'failed');
return;
}
if (state === 'closed') {
clearIceRecoveryTimer();
endCurrentCall({ closePeer: false });
}
});
}
/* Prefer interoperable codecs without removing any fallback or RTX/FEC payload.
   PeerJS creates its first offer inside peer.call(), before it exposes the PC;
   its documented sdpTransform hook is therefore used for initial negotiation. */
function preferCallCodecs(sdp) {
  if (typeof sdp !== 'string') return sdp;
  return sdp.split(/(?=^m=)/m).map((section) => {
    const lines = section.split('\r\n');
    const media = /^m=(audio|video) /.exec(lines[0]);
    if (!media) return section;
    const preferred = media[1] === 'audio' ? ['opus'] : ['H264', 'VP8'];
    const codecs = new Map();
    lines.forEach((line) => {
      const match = /^a=rtpmap:(\d+) ([^/]+)/.exec(line);
      if (match) codecs.set(match[1], match[2].toLowerCase());
    });
    const fields = lines[0].split(' ');
    const rank = (pt) => {
      const i = preferred.findIndex((name) => name.toLowerCase() === codecs.get(pt));
      return i < 0 ? preferred.length : i;
    };
    lines[0] = [...fields.slice(0, 3), ...fields.slice(3).sort((a, b) => rank(a) - rank(b))].join(' ');
    return lines.join('\r\n');
  }).join('');
}

const callAdaptationState = new WeakMap();
const callQualitySamples = new WeakMap();
function callIntervalLoss(pc, stats) {
  const previous = callQualitySamples.get(pc) || new Map();
  const next = new Map();
  let lost = 0, received = 0, fraction = null;
  stats.forEach((report) => {
    if (report.type !== 'remote-inbound-rtp') return;
    const current = { lost: Number(report.packetsLost || 0), received: Number(report.packetsReceived || 0), timestamp: report.timestamp };
    next.set(report.id, current);
    const old = previous.get(report.id);
    // RTCP reports can remain unchanged across several polls.
    if (!old || old.timestamp === current.timestamp) return;
    if (Number.isFinite(report.fractionLost)) fraction = Math.max(fraction || 0, report.fractionLost * 100);
    lost += Math.max(0, current.lost - old.lost);
    received += Math.max(0, current.received - old.received);
  });
  callQualitySamples.set(pc, next);
  return fraction !== null ? fraction : lost + received > 0 ? 100 * lost / (lost + received) : null;
}

async function adaptCallSenders(pc, reading) {
  if (!pc?.getSenders || pc.signalingState === 'closed' || !reading) return;
  let state = callAdaptationState.get(pc);
  if (!state) { state = { level: 2, healthy: 0, busy: false, applied: new WeakMap() }; callAdaptationState.set(pc, state); }
  if (state.busy) return;
  const rtt = reading.mine?.rtt ?? reading.rtt;
  const loss = reading.outboundLoss;
  const bandwidth = reading.availableOutgoingBitrate;
  const known = rtt != null || loss != null || bandwidth != null;
  if (!known) return;
  const bad = (rtt != null && rtt >= 500) || (loss != null && loss >= 8) || (bandwidth != null && bandwidth < 300000);
  const strained = (rtt != null && rtt >= 250) || (loss != null && loss >= 2) || (bandwidth != null && bandwidth < 1000000);
  const target = bad ? 0 : strained ? 1 : 2;
  if (target < state.level) { state.level = target; state.healthy = 0; }
  else if (target > state.level) {
    if (++state.healthy >= 3) { state.level++; state.healthy = 0; }
  } else state.healthy = 0;
  state.busy = true;
  try {
    for (const sender of pc.getSenders()) {
      if (!sender.track || sender.track.readyState === 'ended' || !sender.getParameters || !sender.setParameters) continue;
      const video = sender.track.kind === 'video';
      const screen = ['detail', 'text'].includes(sender.track.contentHint);
      let bitrate = (video ? [180000, 600000, 2000000] : [24000, 40000, 64000])[state.level];
      if (video && bandwidth != null) bitrate = Math.min(bitrate, Math.max(64000, Math.floor(bandwidth * 0.75)));
      const preference = screen ? 'maintain-resolution' : state.level < 2 ? 'maintain-framerate' : 'balanced';
      const signature = `${sender.track.id}:${bitrate}:${video ? preference : ''}`;
      if (state.applied.get(sender) === signature) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings?.length) continue; // Not negotiated yet; retry on the next sample.
        params.encodings.forEach((encoding) => { encoding.maxBitrate = Math.floor(bitrate / params.encodings.length); });
        if (video) params.degradationPreference = preference;
        try { await sender.setParameters(params); }
        catch (error) {
          if (!video || !['TypeError', 'NotSupportedError', 'InvalidModificationError'].includes(error.name)) throw error;
          // Some WebKit versions support the bitrate cap but not this hint.
          const fallback = sender.getParameters();
          if (!fallback.encodings?.length) continue;
          fallback.encodings.forEach((encoding) => { encoding.maxBitrate = Math.floor(bitrate / fallback.encodings.length); });
          delete fallback.degradationPreference;
          await sender.setParameters(fallback);
        }
        state.applied.set(sender, signature);
      } catch (_error) { /* Renegotiation/track replacement may race this poll. Retry later. */ }
    }
  } finally { state.busy = false; }
}

/* One reading from one peer connection.
 *
 * Audio AND video inbound streams are counted. The old version summed only
 * `kind === 'video'`, so on a voice call packetsReceived stayed zero, the loss
 * ratio came out as a clean 0%, and a call breaking up reported itself as
 * perfect. A wrong number is worse than no number: it ends the investigation.
 */
async function readCallQuality(pc, key = '') {
  if (!pc?.getStats) return null;
  const stats = await pc.getStats();
  let rtt = null;
  let availableOutgoingBitrate = null;
  let jitter = null;
  let lost = 0;
  let received = 0;
  let bytes = 0;
  /* Sent as well as received. Only the inbound side was counted, which is half
     a call: the calls list now reports both directions, and on a metered
     connection the uploaded half is the one people are asked about. */
  let bytesOut = 0;
  let kinds = new Set();
  /* The other direction, as the OTHER SIDE experiences it. `remote-inbound-rtp`
     is the remote receiver's own report about our outbound stream — its loss,
     jitter and round trip come back inside our own getStats, no signalling
     needed. Where the browser does not produce it (older WebKit), mine stays
     null and the pill shows a dash for that side rather than a guess. */
  let mineRtt = null;
  let mineJitter = null;
  let mineLost = 0;
  let mineReceived = 0;

  let selectedPairId = null;
  const succeededPairs = [];
  stats.forEach((report) => {
    if (report.type === 'transport' && report.selectedCandidatePairId) selectedPairId = report.selectedCandidatePairId;
    if (report.type === 'candidate-pair' && report.state === 'succeeded') succeededPairs.push(report);
  });
  const selectedPair = (selectedPairId && stats.get(selectedPairId))
    || succeededPairs.find((pair) => pair.nominated === true)
    || (succeededPairs.length === 1 ? succeededPairs[0] : null);
  stats.forEach((report) => {
    if (report.id === selectedPair?.id && report.type === 'candidate-pair'
      && (report.state === 'succeeded' || report.nominated === true)
      && typeof report.currentRoundTripTime === 'number') {
      rtt = report.currentRoundTripTime * 1000;
      if (Number.isFinite(report.availableOutgoingBitrate)) availableOutgoingBitrate = report.availableOutgoingBitrate;
    }
    if (report.type === 'inbound-rtp' && !report.isRemote) {
      if (report.kind) kinds.add(report.kind);
      lost += Number(report.packetsLost || 0);
      received += Number(report.packetsReceived || 0);
      bytes += Number(report.bytesReceived || 0);
      /* Jitter is per stream and reported in seconds; the worst one is what a
         listener actually hears. */
      if (typeof report.jitter === 'number') {
        const ms = report.jitter * 1000;
        jitter = jitter === null ? ms : Math.max(jitter, ms);
      }
    }
    if (report.type === 'outbound-rtp' && !report.isRemote) {
      bytesOut += Number(report.bytesSent || 0);
    }
    if (report.type === 'remote-inbound-rtp') {
      if (typeof report.roundTripTime === 'number') {
        const ms = report.roundTripTime * 1000;
        mineRtt = mineRtt === null ? ms : Math.max(mineRtt, ms);
      }
      if (typeof report.jitter === 'number') {
        const ms = report.jitter * 1000;
        mineJitter = mineJitter === null ? ms : Math.max(mineJitter, ms);
      }
      mineLost += Number(report.packetsLost || 0);
      mineReceived += Number(report.packetsReceived || 0);
    }
  });

  if (rtt === null && received === 0 && bytesOut === 0 && mineRtt === null && availableOutgoingBitrate === null) return null;
  const expected = lost + received;
  const mineExpected = mineLost + mineReceived;
  const mine = (mineRtt === null && mineExpected === 0) ? null : {
    rtt: mineRtt === null ? null : Math.round(mineRtt),
    jitter: mineJitter === null ? null : Math.round(mineJitter),
    lossPercent: mineExpected ? Math.round((mineLost / mineExpected) * 1000) / 10 : 0,
  };
  return {
    outboundLoss: callIntervalLoss(pc, stats),
    availableOutgoingBitrate,
    key: String(key).slice(0, 10),
    rtt: rtt === null ? null : Math.round(rtt),
    jitter: jitter === null ? null : Math.round(jitter),
    lossPercent: expected ? Math.round((lost / expected) * 1000) / 10 : 0,
    packets: received,
    bytes,
    bytesOut,
    kinds: Array.from(kinds),
    mine,
  };
}

/* Every connection in the call: the one peer of a two-person call, or every
   leg of a group call's mesh. */
async function collectCallQuality() {
  const connections = [];
  const direct = chatState.currentCall?.peerConnection || chatState.callConnection;
  if (direct) connections.push(['', direct]);
  for (const [key, entry] of (chatState.groupCall?.participants || new Map()).entries()) {
    if (entry?.call?.peerConnection) connections.push([key, entry.call.peerConnection]);
  }
  const readings = [];
  for (const [key, pc] of connections) {
    try {
      const reading = await readCallQuality(pc, key);
      if (reading) {
        readings.push(reading);
        await adaptCallSenders(pc, reading);
      }
    } catch (_error) { /* a connection that closed mid-read */ }
  }
  return readings;
}

function callQualityLevel(reading) {
  if (!reading || reading.rtt === null) return 'unknown';
  if (reading.rtt < 250 && reading.lossPercent < 2) return 'good';
  if (reading.rtt < 500 && reading.lossPercent < 8) return 'ok';
  return 'bad';
}

/* The readings used to be computed and thrown away — only good/ok/bad
   survived, and the actual numbers lived in Settings → Tools, which is behind
   leaving the call. They are kept here now so the panel in the call header can
   show them without measuring anything twice. */
let callQualityMonitorGeneration = 0;
function startCallQualityMonitor() {
stopCallQualityMonitor();
const generation = callQualityMonitorGeneration;
setCallQuality('unknown');
const tick = async () => {
  try {
    const readings = await collectCallQuality();
    if (generation !== callQualityMonitorGeneration) return;
    chatState.callQualityReadings = readings;
    /* Kept for the call log. getStats() counters are cumulative and the
       connection is closed by the time the call is recorded, so the last
       sample taken while it was up is the total — and this poll is already
       running, so it costs nothing extra. Summed across legs, which is what a
       group call actually moved. */
    chatState.currentCallBytesIn = readings.reduce((total, r) => total + Number(r.bytes || 0), 0);
    chatState.currentCallBytesOut = readings.reduce((total, r) => total + Number(r.bytesOut || 0), 0);
    /* The worst leg decides each direction: in a group call one bad connection
       is what the person notices, and averaging it away hides exactly that.
       The two directions are graded separately — a call can be fine here and
       breaking up over there. */
    const levels = readings.map(callQualityLevel);
    const level = levels.includes('bad') ? 'bad'
      : levels.includes('ok') ? 'ok'
      : levels.includes('good') ? 'good' : 'unknown';
    const mineLevels = readings
      .filter((reading) => reading.mine)
      .map((reading) => callQualityLevel({ rtt: reading.mine.rtt, lossPercent: reading.mine.lossPercent }));
    const mineLevel = mineLevels.includes('bad') ? 'bad'
      : mineLevels.includes('ok') ? 'ok'
      : mineLevels.includes('good') ? 'good'
      : 'unknown';
    setCallQuality(level, mineLevel);
    renderCallQualityCard();
  } catch (_error) {
    /* stats unavailable */
  }
};
/* Two seconds while somebody is reading the panel, five while it is closed.
   Five is fine for a coloured dot and far too slow for a number being watched
   change; two costs one getStats call and nothing else. */
const schedule = () => {
  const open = !document.getElementById('chatCallQualityCard')?.classList.contains('hidden');
  chatState.callQualityTimer = window.setTimeout(async () => {
    await tick();
    if (generation === callQualityMonitorGeneration && chatState.callQualityTimer !== null) schedule();
  }, open ? 2000 : 5000);
};
chatState.callQualityTimer = -1;
tick().then(() => { if (generation === callQualityMonitorGeneration && chatState.callQualityTimer !== null) schedule(); });
}
function stopCallQualityMonitor() {
callQualityMonitorGeneration++;
if (chatState.callQualityTimer) {
clearTimeout(chatState.callQualityTimer);
chatState.callQualityTimer = null;
}
chatState.callQualityReadings = [];
setCallQuality('unknown');
}
function broadcastCallState() {
const peer = activeCallPeerRecord();
if (!peer || !chatState.currentCall) return;
sendRelayEnvelope(peer, {
type: 'call-state',
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
state: {
muted: Boolean(chatState.callMuted),
held: Boolean(chatState.callHeld),
videoOff: Boolean(chatState.currentCallMode === 'video' && !chatState.callVideoEnabled),
screen: Boolean(chatState.screenStream),
/* Mirroring used to be a purely local CSS flip on my own preview, so the
   other side kept seeing me unflipped and the setting looked broken. It
   travels with the rest of the call state now, and the peer applies it to
   the video of me that they are watching. */
mirror: Boolean(chatState.callMirrorSelf),
},
});
}
function applyRemoteCallState(state) {
const merged = {
muted: Boolean(state?.muted),
held: Boolean(state?.held),
videoOff: Boolean(state?.videoOff),
screen: Boolean(state?.screen),
mirror: Boolean(state?.mirror),
};
chatState.remoteCallState = merged;
applyRemoteMirrorView(merged.mirror);
const badges = document.getElementById('chatRemoteStateBadges');
if (badges) {
badges.classList.toggle('hidden', !(merged.muted || merged.videoOff || merged.held || merged.screen));
badges.querySelectorAll('[data-state]').forEach((badge) => {
badge.classList.toggle('hidden', !merged[badge.getAttribute('data-state')]);
});
}
if (merged.held) {
document.getElementById('chatFloatingCallStatus').textContent = t('طرف مقابل تماس را روی hold گذاشت', 'The other side put the call on hold');
}
}
function toggleMirrorVideo() {
chatState.callMirrorSelf = !chatState.callMirrorSelf;
try {
chatState.profile.mirrorSelfVideo = chatState.callMirrorSelf;
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
} catch (_error) {
/* profile save best-effort */
}
syncMirrorSelfView();
refreshCallControls();
/* The flag travelled with the call state, but nothing sent the call state
   when the flag changed — so the far side only learned about a mirror if the
   user happened to mute or hold afterwards, and the setting looked as though
   it applied to the local preview alone. Mute, hold and video-off all
   broadcast at the point they change; so does this now. */
broadcastCallState();
}
/* The peer asked for their picture to be mirrored; honour it on the element
   that shows them. Kept off the badge row on purpose — it is a framing
   preference, not a call state anybody needs announced. */
function applyRemoteMirrorView(mirrored) {
['chatFloatingRemoteVideo', 'chatRemoteVideo'].forEach((id) => {
document.getElementById(id)?.classList.toggle('remote-mirrored', Boolean(mirrored));
});
document.querySelectorAll('.chat-remote-stage').forEach((stage) => {
stage.classList.toggle('remote-mirrored', Boolean(mirrored));
});
}
function syncMirrorSelfView() {
document.querySelectorAll('.chat-local-stage').forEach((stage) => {
stage.classList.toggle('mirror-off', !chatState.callMirrorSelf);
});
const inlineLocal = document.getElementById('chatLocalVideo');
if (inlineLocal) inlineLocal.classList.toggle('mirror-off', !chatState.callMirrorSelf);
}
function activeCallPrimaryVideoElement() {
const ids = chatState.callPrimaryVideo === 'local'
? ['chatFloatingLocalVideo', 'chatLocalVideo']
: ['chatFloatingRemoteVideo', 'chatRemoteVideo'];
for (const id of ids) {
const element = document.getElementById(id);
if (element && element.videoWidth > 0 && element.srcObject) return element;
}
const fallback = document.getElementById('chatFloatingRemoteVideo');
return fallback?.srcObject ? fallback : document.getElementById('chatFloatingLocalVideo');
}
async function captureCallScreenshot() {
if (!chatState.currentCall) return;
const video = activeCallPrimaryVideoElement();
if (!video || !video.videoWidth) {
notify(t('ویدیویی برای عکس گرفتن در دسترس نیست.', 'No video available to capture.'), 'warning');
return;
}
const canvas = document.createElement('canvas');
canvas.width = video.videoWidth;
canvas.height = video.videoHeight;
const ctx = canvas.getContext('2d');
ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
const stamp = new Date().toLocaleString();
ctx.font = `${Math.max(14, Math.round(canvas.height / 36))}px sans-serif`;
ctx.fillStyle = 'rgba(255,255,255,0.85)';
ctx.textAlign = 'left';
ctx.fillText(`P00RIJA · ${stamp}`, 12, canvas.height - 12);
const peer = activeCallPeerRecord();
const selfName = chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User');
canvas.toBlob((blob) => {
if (!blob) return;
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
const safeName = String(peer?.username || 'peer').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 32) || 'peer';
link.href = url;
link.download = `poorija-call-${safeName}-${Date.now()}.png`;
document.body.appendChild(link);
link.click();
link.remove();
setTimeout(() => URL.revokeObjectURL(url), 15000);
}, 'image/png');
if (peer) {
const sent = sendRelayEnvelope(peer, {
type: 'call-screenshot',
mode: chatState.currentCallMode || 'voice',
name: selfName,
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
notify(t(
sent ? 'اسکرین‌شات ذخیره شد و به طرف مقابل اطلاع داده شد.' : 'اسکرین‌شات ذخیره شد ولی اطلاع‌رسانی به طرف مقابل ارسال نشد.',
sent ? 'Screenshot saved and the other side was notified.' : 'Screenshot saved, but the other side could not be notified.',
), sent ? 'info' : 'warning');
} else {
notify(t('اسکرین‌شات ذخیره شد.', 'Screenshot saved.'), 'info');
}
}
function showScreenshotWarning(name) {
const warning = document.getElementById('chatScreenshotWarning');
if (!warning) return;
warning.querySelector('span').textContent = t(`${name || 'طرف مقابل'} از تماس عکس گرفت.`, `${name || 'The other side'} took a screenshot of the call.`);
warning.classList.remove('hidden');
navigator.vibrate?.([120, 80, 120]);
clearTimeout(showScreenshotWarning._timer);
showScreenshotWarning._timer = setTimeout(() => warning.classList.add('hidden'), 6000);
}
async function toggleCallPiP() {
try {
if (document.pictureInPictureElement) {
await document.exitPictureInPicture();
return;
}
const video = document.getElementById('chatFloatingRemoteVideo');
if (!video || !video.srcObject) {
notify(t('ویدیویی برای PiP در دسترس نیست.', 'No video available for PiP.'), 'warning');
return;
}
await video.requestPictureInPicture();
} catch (_error) {
notify(t('این مرورگر از حالت تصویر-در-تصویر پشتیبانی نمی‌کند.', 'This browser does not support picture-in-picture.'), 'info');
}
}
async function toggleCallFullscreen() {
const root = document.querySelector('#chatFloatingCall .chat-floating-call-window');
if (!root) return;
try {
if (document.fullscreenElement) {
await document.exitFullscreen();
} else {
await root.requestFullscreen();
}
} catch (_error) {
notify(t('حالت تمام‌صفحه در این مرورگر در دسترس نیست.', 'Fullscreen is not available in this browser.'), 'info');
}
}
async function listCallDevices() {
if (!navigator.mediaDevices?.enumerateDevices) return [];
try {
return await navigator.mediaDevices.enumerateDevices();
} catch (_error) {
return [];
}
}
function closeCallSettingsPanel() {
document.getElementById('chatCallSettingsPanel')?.classList.add('hidden');
}
async function openCallDeviceSettings() {
const panel = document.getElementById('chatCallSettingsPanel');
if (!panel) return;
if (!panel.classList.contains('hidden')) {
closeCallSettingsPanel();
return;
}
const devices = await listCallDevices();
const fillSelect = (selectId, kind, currentId) => {
const select = document.getElementById(selectId);
if (!select) return;
const options = devices.filter((device) => device.kind === kind);
select.innerHTML = options.length
? options.map((device, index) => `<option value="${device.deviceId}" ${device.deviceId === currentId ? 'selected' : ''}>${app().escapeHTML(device.label || `${kind === 'audioinput' ? 'میکروفون' : kind === 'videoinput' ? 'دوربین' : 'خروجی صدا'} ${index + 1}`)}</option>`).join('')
: `<option value="">${t('در دسترس نیست', 'Unavailable')}</option>`;
select.disabled = options.length === 0;
};
const audioTrack = chatState.localStream?.getAudioTracks?.()[0];
const videoTrack = chatState.localStream?.getVideoTracks?.()[0];
fillSelect('chatMicDeviceSelect', 'audioinput', audioTrack?.label ? devices.find((d) => d.kind === 'audioinput' && d.label === audioTrack.label)?.deviceId : '');
fillSelect('chatCamDeviceSelect', 'videoinput', videoTrack?.label ? devices.find((d) => d.kind === 'videoinput' && d.label === videoTrack.label)?.deviceId : '');
const speakerSelect = document.getElementById('chatSpeakerDeviceSelect');
const outputs = devices.filter((device) => device.kind === 'audiooutput');
if (speakerSelect) {
speakerSelect.innerHTML = outputs.length
? `<option value="default" ${chatState.callActiveSinkId === 'default' ? 'selected' : ''}>${t('پیش‌فرض', 'Default')}</option>` + outputs.filter((d) => d.deviceId !== 'default').map((device) => `<option value="${device.deviceId}" ${chatState.callActiveSinkId === device.deviceId ? 'selected' : ''}>${app().escapeHTML(device.label || t('خروجی صدا', 'Audio output'))}</option>`).join('')
: `<option value="">${t('در دسترس نیست', 'Unavailable')}</option>`;
speakerSelect.disabled = outputs.length === 0;
}
panel.classList.remove('hidden');
}
async function switchCallMediaDevice(kind, deviceId) {
if (!deviceId || !chatState.currentCall) return;
try {
if (kind === 'audiooutput') {
chatState.callActiveSinkId = deviceId;
await applyCallSink(deviceId);
notify(t('خروجی صدا تغییر کرد.', 'Audio output switched.'), 'success');
return;
}
const constraints = kind === 'audioinput'
? { audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }
: { audio: false, video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } };
const replacement = hintTrackContent(await navigator.mediaDevices.getUserMedia(constraints));
const nextTrack = replacement.getTracks()[0];
if (!nextTrack) throw new Error('no track');
const sender = chatState.currentCall.peerConnection?.getSenders?.().find((item) => item.track?.kind === (kind === 'audioinput' ? 'audio' : 'video'));
await sender?.replaceTrack(nextTrack);
if (chatState.localStream) {
chatState.localStream.getTracks().filter((track) => track.kind === (kind === 'audioinput' ? 'audio' : 'video')).forEach((track) => {
chatState.localStream.removeTrack(track);
track.stop();
});
chatState.localStream.addTrack(nextTrack);
attachLocalStream(chatState.localStream);
}
if (kind === 'videoinput') {
chatState.callVideoEnabled = true;
const activeDevice = (await listCallDevices()).find((device) => device.deviceId === deviceId);
if (activeDevice?.label) chatState.callFacingMode = /back|rear|environment/i.test(activeDevice.label) ? 'environment' : 'user';
}
refreshCallControls();
syncCallStageState();
notify(t('دستگاه تماس تغییر کرد.', 'Call device switched.'), 'success');
} catch (error) {
console.error(error);
notify(t('تغییر دستگاه ناموفق بود.', 'Could not switch the device.'), 'error');
}
}
async function applyCallSink(deviceId) {
const targets = ['chatFloatingRemoteVideo', 'chatRemoteVideo'].map((id) => document.getElementById(id)).filter((element) => element && typeof element.setSinkId === 'function');
if (!targets.length) {
notify(t('این مرورگر اجازه تغییر خروجی صدا را نمی‌دهد.', 'This browser does not allow changing the audio output.'), 'info');
return;
}
try {
await Promise.all(targets.map((element) => element.setSinkId(deviceId)));
} catch (_error) {
notify(t('تغییر خروجی صدا ناموفق بود.', 'Could not change the audio output.'), 'warning');
}
}
async function toggleSpeakerCall() {
chatState.callSpeakerEnabled = !chatState.callSpeakerEnabled;
const outputs = (await listCallDevices()).filter((device) => device.kind === 'audiooutput' && device.deviceId !== 'default');
if (chatState.callSpeakerEnabled && outputs.length > 0) {
chatState.callActiveSinkId = outputs[0].deviceId;
await applyCallSink(outputs[0].deviceId);
} else if (!chatState.callSpeakerEnabled) {
chatState.callActiveSinkId = 'default';
await applyCallSink('default');
}
refreshCallControls();
}
function redialCall(peerId, mode) {
const peer = findPeerRecordByPeerId(peerId);
if (!peer || peer.status !== 'online') {
notify(t('این کاربر آنلاین نیست.', 'This user is not online.'), 'warning');
return;
}
if (chatState.activeConversationId !== `peer:${peer.peerId}`) {
chatState.activeConversationId = `peer:${peer.peerId}`;
chatState.activePeerClientId = peer.clientId || '';
chatState.activeView = 'chats';
updateChatShellMode();
renderPeers();
renderActivePeer();
}
startCall(mode === 'video' ? 'video' : 'voice');
}
/* Ringing a contact who is not connected.
   There is no media connection to make yet — the invitation sits on the relay
   and their device is woken by push. This holds the ringing state for thirty
   seconds: if they arrive, the real call is placed; if they do not, both sides
   get a missed call. */
const OFFLINE_RING_MS = 30000;
function startOfflineRing(peerRecord, mode) {
  clearOfflineRing();
  chatState.currentCallMode = mode;
  chatState.currentCallDirection = 'out';
  chatState.offlineRing = { peerId: peerRecord.peerId, mode, startedAt: Date.now() };
  const win = document.querySelector('#chatFloatingCall .chat-floating-call-window');
  if (win) {
    win.dataset.callMode = mode;
    win.dataset.remoteVideo = 'off';
    win.dataset.callPrimary = 'remote';
  }
  document.getElementById('chatFloatingCall')?.classList.remove('hidden');
  const title = document.getElementById('chatFloatingCallTitle');
  if (title) title.textContent = mode === 'video' ? t('تماس تصویری', 'Video call') : t('تماس صوتی', 'Voice call');
  const status = document.getElementById('chatFloatingCallStatus');
  if (status) status.textContent = t('در حال زنگ خوردن... (مخاطب آفلاین است)', 'Ringing… (they are offline)');
  syncFloatingCallPeerIdentity();
  syncCallHeroCopy();
  refreshCallControls();
  playSound('ringing');
  chatState.offlineRingTimer = setTimeout(() => {
    if (!chatState.offlineRing) return;
    clearOfflineRing();
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
    notify(t('پاسخی داده نشد؛ به‌صورت بی‌پاسخ ثبت شد.', 'No answer; recorded as a missed call.'), 'info');
  }, OFFLINE_RING_MS);
}
