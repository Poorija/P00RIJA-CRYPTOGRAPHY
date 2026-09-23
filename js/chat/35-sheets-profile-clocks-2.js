/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 35 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Full-screen sheets, the profile card, and the world clocks
*/

function stopRecordingTimer() {
if (chatState.recordingInterval) {
clearInterval(chatState.recordingInterval);
chatState.recordingInterval = null;
}
chatState.recordingElapsed = 0;
chatState.recordingPaused = false;
const timerEl = document.getElementById('chatRecordingTimer');
if (timerEl) timerEl.textContent = '00:00';
}
function updateVoiceRecordingStatus() {
const pauseBtn = document.getElementById('chatPauseRecordingBtn');
const recorderState = chatState.mediaRecorder?.state || '';
if (pauseBtn) {
pauseBtn.innerHTML = recorderState === 'paused' ? '<i class="fas fa-play"></i>' : '<i class="fas fa-pause"></i>';
pauseBtn.setAttribute('title', recorderState === 'paused' ? t('ادامه ضبط', 'Resume recording') : t('توقف موقت', 'Pause recording'));
}
}
function renderVoicePreviewWaveform(progress = 0) {
const canvas = document.getElementById('chatVoiceWaveform');
if (!canvas || !chatState.voiceWaveformData?.length) return;
const ctx = canvas.getContext('2d');
if (!ctx) return;
ctx.clearRect(0, 0, canvas.width, canvas.height);
const data = chatState.voiceWaveformData;
const bars = 40;
const step = Math.floor(data.length / bars) || 1;
const barWidth = 3;
const barGap = 1;
const amp = canvas.height / 2;
for (let i = 0; i < bars; i++) {
let sum = 0;
let count = 0;
for (let j = 0; j < step; j++) {
const val = data[i * step + j];
if (val !== undefined) {
sum += val;
count++;
}
}
const avg = count > 0 ? sum / count : 0;
const h = Math.max(2, (avg / 255) * canvas.height * 1.2);
const barX = i * (barWidth + barGap);
const isPlayed = (barX / canvas.width) <= progress;
ctx.fillStyle = isPlayed ? '#38bdf8' : 'rgba(125, 211, 252, 0.3)'; // bright blue vs pale sky
ctx.fillRect(barX, amp - h / 2, barWidth, h);
}
}
function startVoicePlayback() {
const audio = document.getElementById('chatVoicePreviewAudio');
const playBtn = document.getElementById('chatVoicePlayBtn');
if (!audio || !playBtn) return;
audio.play().then(() => {
playBtn.innerHTML = '<i class="fas fa-pause"></i>';
chatState.playbackInterval = setInterval(() => {
if (!audio.duration) return;
const progress = audio.currentTime / audio.duration;
const progressPercent = progress * 100;
const progressEl = document.getElementById('chatVoiceProgress');
const timerEl = document.getElementById('chatVoicePreviewTimer');
if (progressEl) progressEl.style.width = `${progressPercent}%`;
renderVoicePreviewWaveform(progress);
if (timerEl) {
const s = Math.floor(audio.currentTime);
const m = Math.floor(s / 60).toString().padStart(2, '0');
const sec = (s % 60).toString().padStart(2, '0');
timerEl.textContent = `${m}:${sec}`;
}
}, 50);
}).catch(console.error);
audio.onended = () => {
stopVoicePlayback();
};
}
function seekVoicePlayback(event) {
const audio = document.getElementById('chatVoicePreviewAudio');
const container = document.getElementById('chatVoiceWaveform')?.parentElement;
if (!audio || !container || !audio.duration) return;
const progressEl = document.getElementById('chatVoiceProgress');
if (progressEl) progressEl.classList.add('seeking');
const rect = container.getBoundingClientRect();
const x = (event.clientX || (event.touches && event.touches[0] ? event.touches[0].clientX : 0)) - rect.left;
const pos = Math.max(0, Math.min(1, x / rect.width));
audio.currentTime = pos * audio.duration;
// Update UI immediately
if (progressEl) progressEl.style.width = `${pos * 100}%`;
renderVoicePreviewWaveform(pos);
}
function stopVoicePlayback() {
const audio = document.getElementById('chatVoicePreviewAudio');
const playBtn = document.getElementById('chatVoicePlayBtn');
if (audio) {
audio.pause();
audio.currentTime = 0;
}
if (playBtn) playBtn.innerHTML = '<i class="fas fa-play"></i>';
if (chatState.playbackInterval) {
clearInterval(chatState.playbackInterval);
chatState.playbackInterval = null;
}
const progressEl = document.getElementById('chatVoiceProgress');
if (progressEl) progressEl.style.width = '0%';
const timerEl = document.getElementById('chatVoicePreviewTimer');
if (timerEl) timerEl.textContent = '00:00';
renderVoicePreviewWaveform(0);
}
function toggleVoicePreviewPlayback() {
const audio = document.getElementById('chatVoicePreviewAudio');
if (!audio) return;
if (audio.paused) {
startVoicePlayback();
} else {
audio.pause();
const playBtn = document.getElementById('chatVoicePlayBtn');
if (playBtn) playBtn.innerHTML = '<i class="fas fa-play"></i>';
if (chatState.playbackInterval) {
clearInterval(chatState.playbackInterval);
chatState.playbackInterval = null;
}
}
}
function clearVoiceDraft() {
if (chatState.voiceDraftUrl) {
URL.revokeObjectURL(chatState.voiceDraftUrl);
}
chatState.voiceDraft = null;
chatState.voiceDraftUrl = '';
chatState.voiceWaveformData = [];
stopVoicePlayback();
const preview = document.getElementById('chatVoicePreview');
const audio = document.getElementById('chatVoicePreviewAudio');
if (audio) audio.removeAttribute('src');
preview?.classList.add('hidden');
// The recorder object outlives the recording — it is only nulled later by
// cleanupVoiceRecorder() — so `!chatState.mediaRecorder` was false right after
// sending a voice note, the overlay never came down, and the composer surface
// stayed hidden. That is the whole "sending a voice message breaks the chat".
// What matters is whether audio is still being captured, not whether the
// object exists.
const stillCapturing = chatState.mediaRecorder
&& (chatState.mediaRecorder.state === 'recording' || chatState.mediaRecorder.state === 'paused');
if (!stillCapturing) setRecordingOverlayVisible(false);
}
function cleanupVoiceRecorder() {
stopStream(chatState.voiceRecorderStream);
chatState.voiceRecorderStream = null;
stopRecordingTimer();
try {
const closePromise = chatState.voiceRecorderAudioContext?.close?.();
closePromise?.catch?.(() => {});
} catch (_error) {
/* noop */
}
chatState.voiceRecorderAudioContext = null;
chatState.mediaRecorder = null;
chatState.recordedChunks = [];
document.getElementById('chatVoiceMessageBtn')?.classList.remove('recording');
const peerMeta = document.getElementById('chatActivePeerMeta');
peerMeta?.classList.remove('animate-pulse', 'text-rose-500');
renderActivePeer();
}
function cancelVoiceRecording() {
if (chatState.mediaRecorder && chatState.mediaRecorder.state !== 'inactive') {
chatState.mediaRecorder.onstop = null;
chatState.mediaRecorder.stop();
}
cleanupVoiceRecorder();
clearVoiceDraft();
}
function pauseOrResumeVoiceRecording() {
const recorder = chatState.mediaRecorder;
if (!recorder) return;
if (recorder.state === 'recording' && typeof recorder.pause === 'function') {
chatState.recordingPaused = true;
recorder.pause();
} else if (recorder.state === 'paused' && typeof recorder.resume === 'function') {
chatState.recordingStartTime = Date.now();
chatState.recordingPaused = false;
recorder.resume();
}
updateVoiceRecordingStatus();
}
function finishVoiceRecording() {
const recorder = chatState.mediaRecorder;
if (!recorder || recorder.state === 'inactive') return;
recorder.stop();
}
/* A voice message, and separately a voice message with the speaker disguised.
 *
 * Two buttons rather than one with a switch, because they are different things
 * to send and the difference should be visible at the moment of sending. The
 * disguise happens here, on this device, before anything is encrypted - what
 * leaves is the changed audio, and the original is never sent anywhere. */
async function sendVoiceDraft(disguiseMode = '') {
if (!chatState.voiceDraft) return false;
let draft = chatState.voiceDraft;
const duration = draft.durationMs || 0;
if (disguiseMode && window.PoorijaVoice) {
  try {
    const out = await window.PoorijaVoice.transform(draft, disguiseMode);
    /* The processed audio keeps the draft's duration marker: the transform
       preserves length, and the bubble should say what was spoken. */
    draft = out.blob;
    draft.durationMs = duration;
  } catch (error) {
    /* Failing to disguise must not quietly send the undisguised voice - that
       would be the worst possible outcome of a feature that exists to hide
       one. */
    console.warn('[Chat] the voice could not be changed:', error);
    notify(t('تغییر صدا انجام نشد، پس چیزی فرستاده نشد.', 'The voice could not be changed, so nothing was sent.'), 'error');
    return false;
  }
}
clearVoiceDraft();
await sendEncryptedBlob(draft, 'voice', duration, disguiseMode ? { voiceMode: disguiseMode } : {});
return true;
}
window.__voiceDraftProbe = { send: (mode) => sendVoiceDraft(mode) };

/* Which disguise to use is a choice, not a default: they move a voice in
   different directions and which one sounds least like you depends on the
   voice. Asked once per send rather than buried in settings. */
/* What each one actually does to a voice, in a line. Without this the list is
   five names that mean nothing until you have tried all five. */
const VOICE_DISGUISE_HINTS = {
  'veil-low': ['صدا پایین‌تر و سنگین‌تر می‌شود', 'lower and heavier'],
  'veil-high': ['صدا بالاتر و سبک‌تر می‌شود', 'higher and lighter'],
  'veil-neutral': ['نزدیک به میانهٔ محدوده — کمتر جلب توجه می‌کند', 'toward the middle of the range'],
  'veil-deep': ['بیشترین تغییر؛ کمترین شباهت به صدای طبیعی', 'the strongest change, the least natural'],
  'veil-timing': ['ریتم و مکث‌ها را به‌هم می‌ریزد', 'scrambles rhythm and pauses'],
};
async function sendDisguisedVoiceDraft() {
  if (!chatState.voiceDraft) return;
  if (!window.PoorijaVoice) {
    notify(t('تغییر صدا در دسترس نیست.', 'The voice changer is not available.'), 'warning');
    return;
  }
  const disguises = window.PoorijaVoice.MODES.filter((mode) => mode.kind === 'disguise');
  const choice = await PoorijaDialogs.choose(
    t('صدا چطور تغییر کند؟', 'How should the voice be changed?'),
    disguises.map((mode) => ({
      value: mode.id,
      label: t(mode.fa, mode.en),
      hint: t(...(VOICE_DISGUISE_HINTS[mode.id] || ['', ''])),
    })),
    { okLabel: t('انصراف', 'Cancel') },
  );
  if (!choice) return;
  await sendVoiceDraft(choice);
  notify(t(window.PoorijaVoice.CAVEAT.fa, window.PoorijaVoice.CAVEAT.en), 'info');
}
document.getElementById('chatVoiceDisguiseBtn')?.addEventListener('click', () => sendDisguisedVoiceDraft());
async function toggleVoiceRecording() {
const button = document.getElementById('chatVoiceMessageBtn');
if (chatState.mediaRecorder?.state === 'recording') {
pauseOrResumeVoiceRecording();
return;
}
if (chatState.mediaRecorder?.state === 'paused') {
pauseOrResumeVoiceRecording();
return;
}
if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
notify(t('ضبط پیام صوتی در این مرورگر پشتیبانی نمی‌شود.', 'Voice recording is not supported in this browser.'), 'warning');
return;
}
const conversation = getActiveConversation();
if (!conversation) {
// This used to return in silence while the recorder had already reported
// success, so a voice note vanished with no trace on either side.
notify(t('ابتدا یک گفتگو را باز کنید.', 'Open a conversation first.'), 'warning');
return;
}
if (!conversation.type) {
const peer = activePeer();
if (!peer) {
notify(t('گفتگوی فعال پیدا نشد؛ چت را دوباره باز کنید.', 'No active conversation resolved; reopen the chat.'), 'warning');
return;
}
let session = activeSession();
if (!session?.cryptoKey) {
session = await ensureDirectSession(peer);
}
if (!session?.cryptoKey) {
notify(t('برای پیام صوتی ابتدا سشن امن لازم است.', 'A secure session is required before voice messages.'), 'warning');
return;
}
}
try {
document.getElementById('chatComposer')?.blur();
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
clearVoiceDraft();
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
chatState.voiceRecorderStream = stream;
chatState.voiceRecorderAudioContext = audioCtx;
const source = audioCtx.createMediaStreamSource(stream);
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 64;
source.connect(analyser);
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);
const canvas = document.getElementById('chatRecordingSpectrum');
const ctx = canvas?.getContext('2d');
const overlay = document.getElementById('chatRecordingOverlay');
const preview = document.getElementById('chatVoicePreview');
setRecordingOverlayVisible(true);
preview?.classList.add('hidden');
document.getElementById('chatRecordingLive')?.classList.remove('hidden');
chatState.voiceWaveformData = [];
const draw = () => {
if (!chatState.mediaRecorder || chatState.mediaRecorder.state === 'inactive') return;
requestAnimationFrame(draw);
if (chatState.mediaRecorder.state !== 'recording') return;
analyser.getByteFrequencyData(dataArray);
// Collect waveform
let sum = 0;
for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
chatState.voiceWaveformData.push(sum / bufferLength);
if (ctx) {
ctx.clearRect(0, 0, canvas.width, canvas.height);
const barWidth = (canvas.width / bufferLength) * 1.5;
let x = 0;
for (let i = 0; i < bufferLength; i++) {
const barHeight = (dataArray[i] / 255) * canvas.height;
ctx.fillStyle = `rgb(244, 63, 94)`; // rose-500
ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
x += barWidth + 2;
}
}
};
const mimeType = supportedAudioMimeType();
chatState.recordedChunks = [];
chatState.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
chatState.mediaRecorder.addEventListener('dataavailable', (event) => {
if (event.data?.size) chatState.recordedChunks.push(event.data);
});
chatState.mediaRecorder.addEventListener('stop', () => {
const peerMeta = document.getElementById('chatActivePeerMeta');
if (peerMeta) {
peerMeta.classList.remove('animate-pulse', 'text-rose-500');
}
const blob = new Blob(chatState.recordedChunks, { type: chatState.mediaRecorder?.mimeType || 'audio/webm' });
const finalDuration = chatState.recordingElapsed;
cleanupVoiceRecorder();
if (!blob.size) {
setRecordingOverlayVisible(false);
return;
}
const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
chatState.voiceDraft = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' });
chatState.voiceDraft.durationMs = finalDuration;
chatState.voiceDraftUrl = URL.createObjectURL(blob);
const audio = document.getElementById('chatVoicePreviewAudio');
if (audio) audio.src = chatState.voiceDraftUrl;
document.getElementById('chatVoicePreview')?.classList.remove('hidden');
document.getElementById('chatRecordingLive')?.classList.add('hidden');
renderVoicePreviewWaveform();
setRecordingOverlayVisible(true);
notify(t('ضبط آماده پیش‌نمایش است؛ بعد از گوش‌دادن دکمه ارسال را بزنید.', 'Voice draft is ready; preview it, then press send.'), 'success');
});
chatState.mediaRecorder.start();
startRecordingTimer();
draw();
button?.classList.add('recording');
updateVoiceRecordingStatus();
const peerMeta = document.getElementById('chatActivePeerMeta');
if (peerMeta) {
peerMeta.dataset.originalText = peerMeta.textContent;
peerMeta.textContent = t('در حال ضبط صدا...', 'Recording voice...');
peerMeta.classList.add('animate-pulse', 'text-rose-500');
}
notify(t('ضبط صدا شروع شد؛ می‌توانید توقف موقت، ادامه، پایان یا حذف کنید.', 'Recording started; you can pause, resume, finish, or discard.'), 'info');
} catch (error) {
console.error(error);
notify(t('دسترسی به میکروفون ممکن نشد.', 'Could not access microphone.'), 'error');
}
}
function bindDomEvents() {
if (chatState.initialized) return;
chatState.initialized = true;
mountChatPortals();
document.getElementById('chatSaveProfileBtn')?.addEventListener('click', saveProfile);
document.getElementById('chatBackToListBtn')?.addEventListener('click', () => {
chatState.activePeerClientId = '';
chatState.activeConversationId = '';
updateChatShellMode();
renderPeers();
renderActivePeer();
});
document.getElementById('chatProfileAvatarBtn')?.addEventListener('click', () => toggleAvatarChooser(true));
document.querySelectorAll('[data-chat-avatar-close]').forEach((target) => {
target.addEventListener('click', () => toggleAvatarChooser(false));
});
document.getElementById('chatAvatarDefaultBtn')?.addEventListener('click', () => {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
setPendingAvatarData(generatedAvatarData('cyan', chatState.profile.name || 'P'));
});
document.getElementById('chatAvatarFileBtn')?.addEventListener('click', () => document.getElementById('chatProfileAvatarInput')?.click());
document.getElementById('chatProfileAvatarInput')?.addEventListener('change', (event) => {
updateProfileAvatar(event.target.files?.[0]);
event.target.value = '';
});
document.getElementById('chatAvatarRotateLeftBtn')?.addEventListener('click', () => rotateAvatarEditor(-90));
document.getElementById('chatAvatarRotateRightBtn')?.addEventListener('click', () => rotateAvatarEditor(90));
document.getElementById('chatAvatarZoomInput')?.addEventListener('input', (event) => setAvatarEditorZoom(event.target.value));
document.getElementById('chatAvatarOffsetXInput')?.addEventListener('input', (event) => setAvatarEditorAxis('offsetX', event.target.value));
document.getElementById('chatAvatarOffsetYInput')?.addEventListener('input', (event) => setAvatarEditorAxis('offsetY', event.target.value));
document.getElementById('chatAvatarScaleXInput')?.addEventListener('input', (event) => setAvatarEditorAxis('scaleX', event.target.value));
document.getElementById('chatAvatarScaleYInput')?.addEventListener('input', (event) => setAvatarEditorAxis('scaleY', event.target.value));
document.getElementById('chatAvatarFilterSelect')?.addEventListener('change', (event) => setAvatarEditorFilter(event.target.value));
document.getElementById('chatAvatarApplyCropBtn')?.addEventListener('click', applyAvatarEditor);
document.getElementById('chatAvatarCancelCropBtn')?.addEventListener('click', cancelAvatarEditor);
document.getElementById('chatAvatarSaveBtn')?.addEventListener('click', savePendingAvatar);
document.getElementById('chatGroupAvatarInput')?.addEventListener('change', (event) => {
updateGroupAvatar(event.target.files?.[0]);
event.target.value = '';
});
['chatProfileName', 'chatTurnUrl', 'chatTurnUsername', 'chatTurnCredential'].forEach((id) => {
document.getElementById(id)?.addEventListener('input', syncProfileDraftFromInputs);
});
/* The server address syncs on commit (blur/Enter), not on every keystroke:
 * each intermediate value used to fire a live probe of a half-typed URL —
 * dozens of dead DNS lookups per edit and visible stutter while typing. */
document.getElementById('chatServerUrl')?.addEventListener('change', syncProfileDraftFromInputs);
['chatAutoConnect', 'chatAllowVideo', 'chatAutoDiscovery', 'chatShowSuspensionCountdown', 'chatPublicStun'].forEach((id) => {
document.getElementById(id)?.addEventListener('change', handleConnectionToggleChange);
});
/* The master switch is handled separately from the ordinary toggles: turning
 * it on runs the whole connect flow, turning it off tears the transport down.
 * It must not route through handleConnectionToggleChange, which would save a
 * half-decided state before applyChatEnabled() has had its say. */
document.getElementById('chatEnabledToggle')?.addEventListener('change', (event) => {
const input = event.target;
const wanted = Boolean(input.checked);
if (applyChatEnabled(wanted)) {
input.checked = wanted;
} else {
input.checked = false;
}
});
/* Connection config as a portable encrypted file. */
document.getElementById('chatConfigExportBtn')?.addEventListener('click', () => exportRelayConfigFile());
document.getElementById('chatConfigImportBtn')?.addEventListener('click', () => document.getElementById('chatConfigImportInput')?.click());
document.getElementById('chatConfigImportInput')?.addEventListener('change', async (event) => {
const file = event.target.files?.[0];
event.target.value = '';
if (file) await importRelayConfigFile(file);
});
/* Portable profile: the chat identity itself, encrypted, moving between this
   device and any other — native or PWA, either direction. */
document.getElementById('chatProfileExportBtn')?.addEventListener('click', () => exportPortableProfileFile());
document.getElementById('chatIdentityProfileExportBtn')?.addEventListener('click', () => exportPortableProfileFile());
document.getElementById('chatIdentityProfileImportBtn')?.addEventListener('click', () => document.getElementById('chatProfileImportInput')?.click());
document.getElementById('chatProfileImportBtn')?.addEventListener('click', () => document.getElementById('chatProfileImportInput')?.click());
document.getElementById('chatProfileImportInput')?.addEventListener('change', async (event) => {
const file = event.target.files?.[0];
event.target.value = '';
if (file) await importPortableProfileFile(file);
});
/* Linux native has no WebRTC, so the calls pane carries a pointer to the PWA
 * served by the user's own relay; the button hands the relay address to the
 * system browser via the shell, which carries full libwebrtc.
 * Why this is the answer rather than a workaround: docs/linux-webrtc.md. */
document.getElementById('chatCallsPwaBtn')?.addEventListener('click', () => {
const address = String(chatState.profile.serverUrl || '').trim();
if (!isUsableRelayOrigin(address)) {
notify(t('اول آدرس سرور را در تنظیمات چت وارد و ذخیره کنید.', 'Enter and save the server address in the chat settings first.'), 'warning');
return;
}
window.PoorijaDesktop?.openExternal(address)?.catch((error) => {
notify(t('باز کردن مرورگر ناموفق بود.', 'Could not open the browser.'), 'error');
console.warn('[calls] openExternal failed:', error);
});
});
document.querySelectorAll('[data-chat-view]').forEach((button) => {
button.addEventListener('click', () => setChatView(button.getAttribute('data-chat-view') || 'chats'));
});
/* The rail search bar is gone — search lives behind the loupe at the end of
   the nav bar (see part 08) — so the live filter wiring that fed it moved out
   with it. chatState.searchQuery is still respected by renderMessages: the
   search popup sets it when it jumps to a hit, which is what makes the target
   bubble render outside the 80-message window. */
document.getElementById('chatExportChatsBtn')?.addEventListener('click', () => openExportPicker());
document.getElementById('chatImportChatsBtn')?.addEventListener('click', () => pickArchiveFile());
document.getElementById('chatWipeHistoryBtn')?.addEventListener('click', () => clearAllChatHistory());
document.getElementById('chatCreateGroupBtn')?.addEventListener('click', () => createSpace('group'));
/* Connecting must mean connecting to what the box says, not to whatever the
   profile still holds: commit the form field first, or a user who typed a new
   relay address and pressed connect watches the old one be dialed instead. */
function commitServerFieldAndSave() {
syncProfileDraftFromInputs();
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
}
document.getElementById('chatReconnectBtn')?.addEventListener('click', async () => {
commitServerFieldAndSave();
disconnectChat();
await connectChatTransport();
});
document.getElementById('chatConnectBtn')?.addEventListener('click', async () => {
commitServerFieldAndSave();
await connectChatTransport();
});
document.getElementById('chatDiscoverLocalBtn')?.addEventListener('click', async () => {
const result = await discoverLocalRelayServer({ fullScan: true, silent: false });
if (result && !chatState.connected) await connectChatTransport();
});
document.querySelectorAll('.chat-avatar-preset').forEach((btn) => {
btn.addEventListener('click', async () => {
const seed = btn.dataset.avatarSeed;
if (seed) {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
setPendingAvatarData(generatedAvatarData(seed, btn.textContent || chatState.profile.name));
return;
}
const url = btn.dataset.avatarPreset;
await selectPresetAvatar(url);
});
});
document.getElementById('chatResetIdentityBtn')?.addEventListener('click', rotateIdentity);
document.getElementById('chatShowIdentityQrBtn')?.addEventListener('click', showChatIdentityQr);
document.getElementById('chatStartChatBtn')?.addEventListener('click', (event) => {
  if (event.currentTarget.dataset.action === 'new-group') openGroupMaker();
  else openStartChatModal();
});
// --- the group maker -------------------------------------------------------
document.getElementById('chatGroupMaker')?.addEventListener('click', (event) => {
  if (event.target.closest('[data-group-maker-close]') || event.target === event.currentTarget) closeGroupMaker();
});
document.getElementById('chatGroupMakerAvatarBtn')?.addEventListener('click', () => {
  document.getElementById('chatGroupMakerAvatarInput')?.click();
});
document.getElementById('chatGroupMakerAvatarInput')?.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > MAX_PROFILE_AVATAR_BYTES) {
    notify(t('تصویر گروه باید کمتر از ۵ مگابایت باشد.', 'A group picture must be under 5 MB.'), 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    groupMakerAvatar = String(reader.result || '');
    const img = document.getElementById('chatGroupMakerAvatarImg');
    if (img) { img.src = groupMakerAvatar; img.hidden = false; }
  };
  reader.readAsDataURL(file);
});
document.getElementById('chatStartSessionBtn')?.addEventListener('click', () => startSecureSession());
document.getElementById('chatDeleteConversationBtn')?.addEventListener('click', deleteActiveConversation);
/* Locking the open conversation, now, from the menu.
   The timer is right for walking away from a desk and useless for the case
   this is for: handing somebody the phone to show them one photograph. */
document.getElementById('chatLockNowBtn')?.addEventListener('click', () => {
const conversation = getActiveConversation();
if (!conversation) return;
const key = conversation.conversationId || getConversationKey(conversation);
if (!conversationHasLock(key)) {
notify(t('اول برای این گفتگو رمز بگذارید.', 'Set a PIN for this conversation first.'), 'warning');
return;
}
lockConversationNow(key);
const lockedIsGroup = Boolean(conversation.type === 'group');
notify(t(lockedIsGroup ? 'این گروه قفل شد.' : 'این گفتگو قفل شد.',
  lockedIsGroup ? 'This group is locked.' : 'This conversation is locked.'), 'success');
});
/* The menu's loupe: the same search surface, scoped to this one conversation.
   Closing the popup clears the scope exactly like it clears everything else. */
document.getElementById('chatSearchInChatBtn')?.addEventListener('click', () => {
const conversation = getActiveConversation();
if (!conversation) return;
document.getElementById('chatThreadMenu')?.classList.add('hidden');
document.getElementById('chatThreadMenuBtn')?.setAttribute('aria-expanded', 'false');
openFullSearchInChat(conversation.conversationId || getConversationKey(conversation));
});
document.getElementById('chatReturnToCallBtn')?.addEventListener('click', () => {
setCallDisplayMode('fullscreen');
});
/* The one-tap lock in the profile card — for the whole Secure Chat tab, not
   for one thread. On the phone the card is on screen in the list view, where
   no conversation is open, so a lock that needs one is a lock that never
   fires; the complaint that produced this shape was exactly that. First press
   without a chat PIN asks for one (and its confirmation) and locks right
   after; with a PIN already set it just locks — no prompt between the tap and
   the gate. The icon tells the truth at a glance: open and green while the
   tab is unlocked, closed and red while locked. */
function syncQuickLockButton() {
const button = document.getElementById('chatQuickLockBtn');
if (!button) return;
const icon = button.querySelector('i');
const locked = chatLockEnabled() && !chatState.chatUnlocked;
button.classList.toggle('is-locked', locked);
button.classList.toggle('is-unlocked', !locked);
if (icon) icon.className = `fas ${locked ? 'fa-lock' : 'fa-lock-open'}`;
button.title = locked
? t('چت امن قفل است', 'Secure chat is locked')
: t('قفل فوری چت امن', 'Lock the secure chat now');
}
window.addEventListener('poorija:section-lock', syncQuickLockButton);
document.getElementById('chatQuickLockBtn')?.addEventListener('click', async () => {
  if (vaultLockState().enabled) lockVaultNow();
  else await configureSharedLock();
  syncQuickLockButton();
});
document.getElementById('chatCancelContextBtn')?.addEventListener('click', clearMessageContext);
document.getElementById('chatKeyCompareBtn')?.addEventListener('click', () => {
  /* Through openSafetyPanel, never by un-hiding the node directly: the panel
     lives inside .chat-shell, which is overflow:hidden and clips a fixed child
     stone dead — opening it without the body portal showed nothing at all,
     which read as "the compare button does nothing" after a key change. */
  openSafetyPanel();
});
document.getElementById('chatKeyAcceptBtn')?.addEventListener('click', async () => {
  const peer = activePeer();
  if (!peer) return;
  const ok = await PoorijaDialogs.confirm(t(
    'کلید تازه پذیرفته شود؟ فقط وقتی این کار را بکنید که مطمئنید خودش برنامه را دوباره نصب کرده است.',
    'Accept the new key? Only do this if you know they reinstalled the app.',
  ), { danger: true });
  if (ok) resolveKeyChange(peer, true);
});
document.getElementById('chatKeyKeepBtn')?.addEventListener('click', () => {
  const peer = activePeer();
  if (peer) resolveKeyChange(peer, false);
});
document.getElementById('chatMessages')?.addEventListener('click', (event) => {
const replyBtn = event.target.closest('[data-chat-reply-message]');
if (replyBtn) {
handleReplyMessage(replyBtn.dataset.chatReplyMessage);
return;
}
const editBtn = event.target.closest('[data-chat-edit-message]');
if (editBtn) {
handleEditMessage(editBtn.dataset.chatEditMessage);
return;
}
const pinBtn = event.target.closest('[data-chat-pin-message]');
if (pinBtn) {
handlePinMessage(pinBtn.dataset.chatPinMessage);
return;
}
const forwardBtn = event.target.closest('[data-chat-forward-message]');
if (forwardBtn) {
handleForwardMessage(forwardBtn.dataset.chatForwardMessage);
return;
}
/* A call entry already names the peer and the kind of call, so a tap on it
   places that same call again. startCall reads the active conversation, which
   is the one this entry is drawn in, and handles the group case itself. */
const callRow = event.target.closest('[data-call-redial]');
if (callRow) {
if (chatState.selectionMode) return;
startCall(callRow.dataset.callRedial === 'video' ? 'video' : 'voice');
}
});
/* Keyboard parity: the row is a button, so Enter and Space must fire it. */
document.getElementById('chatMessages')?.addEventListener('keydown', (event) => {
if (event.key !== 'Enter' && event.key !== ' ') return;
const callRow = event.target.closest?.('[data-call-redial]');
if (!callRow || chatState.selectionMode) return;
event.preventDefault();
startCall(callRow.dataset.callRedial === 'video' ? 'video' : 'voice');
});
document.getElementById('chatSendMessageBtn')?.addEventListener('pointerdown', (event) => {
event.preventDefault(); // Keep focus on composer
sendMessage();
});
/* Belt to the pointerdown's braces: should anything ever deliver the tap as
   a click alone — a bar that moved, a pointer event the phone cancelled —
   the message still goes out. When pointerdown already sent it, the box is
   empty by now and this is a no-op, so nothing is ever sent twice. */
document.getElementById('chatSendMessageBtn')?.addEventListener('click', () => {
const box = document.getElementById('chatComposer');
if (box && box.value.trim()) sendMessage();
});
/* The same courtesy for every other control in the bar. On the phone a tap
   on a button can take the input's focus with it — the keyboard folds, the
   pin comes off, the bar moves: the tap half-arrives. Cancelling the focus
   change at pointer-down keeps the keys up and the bar still for the whole
   bar, the way a messaging app is expected to behave while typing. */
document.querySelector('#content-chat footer.chat-composer-bar')?.addEventListener('pointerdown', (event) => {
if (event.pointerType === 'mouse' && event.button !== 0) return;
if (event.target === event.currentTarget) return;
if (event.target.closest?.('button, [role="button"], label, a')) event.preventDefault();
});
// --- composer actions sheet -------------------------------------------
// One circular + button stands in for the four icons that used to crowd the
// input. It opens upward, anchored to the inline-end of the composer, which
// puts it on the left in Persian and on the right in English.
const composerPlusBtn = document.getElementById('chatComposerPlusBtn');
const composerActions = document.getElementById('chatComposerActions');
function closeComposerActions(immediate = false) {
if (!composerActions || composerActions.classList.contains('hidden')) return;
composerPlusBtn?.classList.remove('is-open');
composerPlusBtn?.setAttribute('aria-expanded', 'false');
document.getElementById('chatTimerPopover')?.classList.add('hidden');
if (immediate) {
composerActions.classList.add('hidden');
composerActions.classList.remove('is-closing');
return;
}
composerActions.classList.add('is-closing');
window.setTimeout(() => {
composerActions.classList.add('hidden');
composerActions.classList.remove('is-closing');
}, 150);
}
function openComposerActions() {
if (!composerActions) return;
composerActions.classList.remove('is-closing');
composerActions.classList.remove('hidden');
composerPlusBtn?.classList.add('is-open');
composerPlusBtn?.setAttribute('aria-expanded', 'true');
}
composerPlusBtn?.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
if (composerActions?.classList.contains('hidden')) openComposerActions();
else closeComposerActions();
});
composerActions?.addEventListener('click', (event) => {
// The timer row opens its own popover, so the sheet has to stay put for it.
if (event.target.closest('#chatTimerToggleBtn') || event.target.closest('#chatTimerPopover')) return;
if (event.target.closest('.chat-action-row')) closeComposerActions();
});
document.addEventListener('click', (event) => {
if (!composerActions || composerActions.classList.contains('hidden')) return;
if (event.target.closest('#chatComposerActions') || event.target.closest('#chatComposerPlusBtn')) return;
closeComposerActions();
});
document.addEventListener('keydown', (event) => {
if (event.key !== 'Escape') return;
if (!document.getElementById('chatStickerPanel')?.classList.contains('hidden')) {
setStickerPanelVisible(false);
return;
}
if (composerActions?.classList.contains('hidden')) return;
closeComposerActions();
composerPlusBtn?.focus();
});
document.addEventListener('click', (event) => {
const panel = document.getElementById('chatStickerPanel');
if (!panel || panel.classList.contains('hidden')) return;
/* composedPath, not closest: picking a pack re-renders the panel, so by the
   time this bubbles up the button that was clicked has been thrown away and
   `closest('#chatStickerPanel')` on a detached node answers null — which read
   as "clicked outside" and closed the panel on every pack switch. The path is
   captured when the event is dispatched, so it still remembers. */
const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
const insidePanel = path.includes(panel) || Boolean(event.target.closest?.('#chatStickerPanel'));
const stickerButton = document.getElementById('chatStickerBtn');
const onButton = (stickerButton && path.includes(stickerButton)) || Boolean(event.target.closest?.('#chatStickerBtn'));
if (insidePanel || onButton) return;
setStickerPanelVisible(false);
});
// Which build is actually running matters more than anything else in the
// report: a stale service worker explains most "it is still broken" reports.
navigator.serviceWorker?.getRegistration?.().then((reg) => {
const url = reg?.active?.scriptURL || reg?.waiting?.scriptURL || '';
window.__poorijaSwVersion = url.includes('?v=') ? url.split('?v=')[1] : (url ? 'no version tag' : 'none');
}).catch(() => { window.__poorijaSwVersion = 'unavailable'; });
// The report button lives in the Connection panel, and renderPeers() blanks the
// list on purpose in that view — so measuring the DOM from there says nothing.
// Render the chats view for a moment, count it, then put the view back.
function chatsViewRenderProbe() {
const previousView = chatState.activeView;
try {
if (previousView !== 'chats') {
chatState.activeView = 'chats';
renderPeers();
}
const cards = document.querySelectorAll('#chatPeerList .chat-peer-card, #chatPeerList [data-conversation-key]').length;
const emptyState = document.querySelector('#chatPeerList .chat-empty-state');
return `${cards} card(s)${cards === 0 && emptyState ? ' — empty state: "' + emptyState.textContent.trim().slice(0, 42) + '"' : ''}`;
} catch (error) {
return 'probe failed: ' + String(error?.message || error).slice(0, 50);
} finally {
if (chatState.activeView !== previousView) {
chatState.activeView = previousView;
renderPeers();
}
}
}
// --- chat status report -------------------------------------------------
// One place that answers "why can't I send?" without another round of guesses.
document.getElementById('chatDiagBtn')?.addEventListener('click', () => {
const body = document.getElementById('chatDiagBody');
if (!body) return;
if (!body.hidden) { body.hidden = true; return; }
const peer = chatState.peer;
// Read the conversation AFTER the chats-view probe below has had its chance to
// seed one; capturing it up front reported "none" while the next line happily
// resolved the same key.
chatsViewRenderProbe();
renderActivePeer();
const conv = getActiveConversation();
const key = conv ? getConversationKey(conv) : '';
const session = conv?.peerId ? chatState.sessions.get(conv.peerId) : null;
const ws = chatState.ws;
const wsState = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws?.readyState] || 'none';
const sendBtn = document.getElementById('chatSendMessageBtn');
const lines = [
`build          : ${(document.querySelector('script[src*="chat.js"]')?.getAttribute('src') || '').split('?v=')[1] || 'inline'}  |  sw ${(window.__poorijaSwVersion || 'checking...')}`,
`unlocked       : ${isUnlocked()}`,
`relay ws       : ${wsState}   connected flag: ${chatState.connected}`,
`peer object    : ${peer ? `open=${peer.open} disconnected=${peer.disconnected} destroyed=${peer.destroyed}` : 'NULL  <-- composer stays disabled'}`,
`peer id        : ${chatState.peerId || '-'}`,
`identity       : ${chatState.identity?.fingerprint ? chatState.identity.fingerprint.slice(0, 16) + '...' : 'MISSING'}`,
`view           : ${chatState.activeView}   search: "${chatState.searchQuery || ''}"   archivedView: ${Boolean(chatState.showArchived)}`,
`contacts       : ${chatState.peers.length}   records: ${allConversationRecords().length}`,
`visible convs  : ${allConversationRecords().filter((r) => r.type !== 'group' && shouldShowConversation(r) && Boolean(r.archived) === Boolean(chatState.showArchived)).length}   (chats-view render: ${chatsViewRenderProbe()})`,
`recovered      : ${allConversationRecords().filter((r) => r.recovered).length} thread(s) re-attached from history`,
`history keys   : ${Object.keys(chatState.history || {}).filter((k) => (chatState.history[k] || []).length).map((k) => k.slice(0, 10)).slice(0, 6).join(', ') || 'none'}`,
`record keys    : ${allConversationRecords().map((p) => `${(getConversationKey(p) || '?').slice(0, 10)}:${(chatState.history[getConversationKey(p)] || []).length}`).slice(0, 8).join(', ') || 'none'}`,
`selection match: ${(() => {
const k = chatState.activeConversationId;
if (!k) return 'no key selected';
const hit = allConversationRecords().find((p) => getConversationKey(p) === k);
return hit ? `record found (${hit.username || hit.peerId})` : 'NO RECORD CARRIES THIS KEY';
})()}`,
`active conv    : ${conv ? (conv.username || conv.name || conv.peerId) : 'none'}`,
`selection ids  : client="${chatState.activePeerClientId || ''}" key="${chatState.activeConversationId || ''}"  compactLayout=${isCompactChatLayout()}`,
`history here   : ${key ? (chatState.history[key] || []).length : 0} messages`,
`history total  : ${Object.values(chatState.history).reduce((n, list) => n + (list?.length || 0), 0)} messages in ${Object.keys(chatState.history).length} threads`,
`session        : ${session ? `conn=${session.connection?.open ? 'open' : 'closed'} key=${session.cryptoKey ? 'yes' : 'NO'} source=${session.keySource || '-'} owner=${sessionKeyOwner(session)}` : 'none'}`,
`send button    : ${sendBtn ? (sendBtn.disabled ? 'DISABLED' : 'enabled') : 'missing'}`,
`shouldReconnect: ${chatState.shouldReconnect}   buildInFlight: ${chatState.transportConnectInFlight}  queued: ${chatState.transportConnectQueued}`,
`autoConnect    : ${chatState.profile.autoConnect}   relay: ${chatState.profile.presenceUrl || '-'}`,
`storage        : history ${(localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) || '').length} chars, contacts ${(localStorage.getItem(CHAT_CONTACTS_STORAGE_KEY) || '').length} chars`,
`stickers       : ${chatState.stickerPacks.length} packs / ${chatState.stickerPacks.reduce((n, pack) => n + pack.stickers.length, 0)} stickers${chatState.stickerPacks.length ? ` — ${chatState.stickerPacks.map((pack) => `${pack.title}(${pack.stickers.length})`).slice(0, 4).join(', ')}` : ''}`,
`sounds         : ring="${chatState.profile.ringtoneId}" msg="${chatState.profile.messageToneId}" imported=${chatState.customSounds.length}`,
`media vault    : ${chatState.mediaStatsCache
  ? `${chatState.mediaStatsCache.count} stored / ${Math.round(chatState.mediaStatsCache.bytes / 1024)} KB`
  : 'not measured yet'}, ${chatState.mediaUrls.size} live url(s)`,
`media pending  : ${Object.values(chatState.history).reduce((n, list) => n + (list || []).filter((entry) => isMediaEntry(entry) && !entry.downloadUrl && !entry.viewOnceConsumed).length, 0)} attachment(s) with no bytes`,
`last errors    : ${(window.__poorijaChatErrors || []).slice(-3).join(' | ') || 'none'}`,
];
body.textContent = lines.join('\n');
body.hidden = false;
});
// Presence hands us every peer the relay has ever seen, and they all get kept.
// One device had 220 records taking 1.2 MB, none of which carried a message or
// a key. Drop the ones the list already hides — nothing reachable is lost.
document.getElementById('chatPruneContactsBtn')?.addEventListener('click', async () => {
const before = chatState.peers.length;
const keep = chatState.peers.filter((peer) => isSelfPeerRecord(peer) || shouldShowConversation(peer));
const removed = before - keep.length;
if (!removed) {
notify(t('مخاطب بی‌استفاده‌ای پیدا نشد.', 'No unused contacts to remove.'), 'info');
return;
}
if (!await PoorijaDialogs.confirm(t(
`${removed} مخاطب بدون پیام و بدون کلید حذف شود؟ گفتگوهای دارای پیام دست نمی‌خورند.`,
`Remove ${removed} contacts that carry no messages and no keys? Conversations with history are untouched.`,
))) return;
chatState.peers = keep;
saveContacts();
renderPeers();
renderActivePeer();
notify(t(`${removed} مخاطب بی‌استفاده حذف شد.`, `${removed} unused contacts removed.`), 'success');
});
// --- group calls ---------------------------------------------------------
document.getElementById('chatGroupCallMuteBtn')?.addEventListener('click', toggleGroupCallMute);
document.getElementById('chatGroupCallVideoBtn')?.addEventListener('click', toggleGroupCallVideo);
document.getElementById('chatGroupCallLeaveBtn')?.addEventListener('click', () => leaveGroupCall());
document.getElementById('chatGroupCallPresentBtn')?.addEventListener('click', () => {
const sheet = document.getElementById('chatGroupPresentSheet');
const open = sheet?.classList.contains('hidden');
renderPresentSheet('chatGroupPresentSheet', Boolean(chatState.groupCall?.presenting));
sheet?.classList.toggle('hidden', !open);
toggleCallReactionBar('chatGroupCallReactionBar', false);
});
document.getElementById('chatGroupPresentSheet')?.addEventListener('click', async (event) => {
const option = event.target.closest('[data-present-source]');
if (!option || option.disabled) return;
document.getElementById('chatGroupPresentSheet')?.classList.add('hidden');
const source = option.getAttribute('data-present-source');
if (source === 'stop') { await stopGroupPresentation(); return; }
await startGroupPresentation(source);
});
document.getElementById('chatGroupCallHandBtn')?.addEventListener('click', toggleGroupCallHand);
document.getElementById('chatGroupCallLayoutBtn')?.addEventListener('click', () => {
const sheet = document.getElementById('chatGroupLayoutSheet');
const open = sheet?.classList.contains('hidden');
renderGroupCallLayoutSheet();
sheet?.classList.toggle('hidden', !open);
document.getElementById('chatGroupPresentSheet')?.classList.add('hidden');
toggleCallReactionBar('chatGroupCallReactionBar', false);
});
document.getElementById('chatGroupLayoutSheet')?.addEventListener('click', (event) => {
const option = event.target.closest('[data-gcall-layout]');
if (!option) return;
setGroupCallLayout(option.getAttribute('data-gcall-layout'));
renderGroupCallLayoutSheet();
document.getElementById('chatGroupLayoutSheet')?.classList.add('hidden');
});
document.getElementById('chatGroupCallReactBtn')?.addEventListener('click', () => {
toggleCallReactionBar('chatGroupCallReactionBar');
document.getElementById('chatGroupPresentSheet')?.classList.add('hidden');
});
document.getElementById('chatGroupCallReactionBar')?.addEventListener('click', (event) => {
const button = event.target.closest('[data-call-reaction]');
if (!button) return;
sendCallReaction(button.getAttribute('data-call-reaction'));
toggleCallReactionBar('chatGroupCallReactionBar', false);
});
document.getElementById('chatGroupCallGrid')?.addEventListener('click', (event) => {
const pin = event.target.closest('[data-gcall-pin]');
if (!pin) return;
event.preventDefault();
event.stopPropagation();
toggleGroupCallPin(pin.getAttribute('data-gcall-pin'));
});
// --- reactions and presenting in a one-to-one call ------------------------
document.getElementById('chatCallReactBtn')?.addEventListener('click', (event) => {
event.stopPropagation();
toggleCallReactionBar('chatCallReactionBar');
document.getElementById('chatCallPresentSheet')?.classList.add('hidden');
noteCallActivity();
});
document.getElementById('chatCallReactionBar')?.addEventListener('click', (event) => {
event.stopPropagation();
const button = event.target.closest('[data-call-reaction]');
if (!button) return;
sendCallReaction(button.getAttribute('data-call-reaction'));
toggleCallReactionBar('chatCallReactionBar', false);
noteCallActivity();
});
document.getElementById('chatCallPresentSheet')?.addEventListener('click', async (event) => {
event.stopPropagation();
const option = event.target.closest('[data-present-source]');
if (!option || option.disabled) return;
document.getElementById('chatCallPresentSheet')?.classList.add('hidden');
noteCallActivity();
const source = option.getAttribute('data-present-source');
if (source === 'stop') { await stopDirectPresentation(); return; }
await toggleScreenShare(source);
});
document.getElementById('chatGroupCallInvite')?.addEventListener('click', async (event) => {
const box = document.getElementById('chatGroupCallInvite');
if (event.target.closest('[data-gcall-decline]')) { hideGroupCallInvite(); return; }
if (!event.target.closest('[data-gcall-accept]')) return;
let roster = [];
try { roster = JSON.parse(box.dataset.roster || '[]'); } catch (_error) { roster = []; }
await joinGroupCall(box.dataset.callId, box.dataset.spaceId, box.dataset.mode || 'voice', roster);
});
// A media call for a group we just accepted needs the peer list to be live,
// so mount the portal the same way the one-to-one screen does.
window.addEventListener('beforeunload', () => leaveGroupCall({ silent: true }));
// --- mentions ------------------------------------------------------------
document.getElementById('chatComposer')?.addEventListener('input', () => renderMentionPicker());
document.getElementById('chatComposer')?.addEventListener('keydown', (event) => {
const box = document.getElementById('chatMentionPicker');
if (!box || box.classList.contains('hidden')) return;
if (event.key === 'Escape') { box.classList.add('hidden'); return; }
if (event.key !== 'Enter' && event.key !== 'Tab') return;
const first = box.querySelector('[data-mention-name]');
if (!first) return;
event.preventDefault();
applyMention(first.getAttribute('data-mention-name'));
});
document.getElementById('chatMentionPicker')?.addEventListener('click', (event) => {
const row = event.target.closest('[data-mention-name]');
if (row) applyMention(row.getAttribute('data-mention-name'));
});
// --- group invites --------------------------------------------------------
document.getElementById('chatJoinGroupBtn')?.addEventListener('click', async () => {
const code = await PoorijaDialogs.prompt(t('کد دعوت گروه را بچسبانید:', 'Paste the group invite code:'), '');
if (code) await redeemGroupInvite(code);
});
// --- multi-select --------------------------------------------------------
document.getElementById('chatSelectionCancelBtn')?.addEventListener('click', exitSelectionMode);
document.getElementById('chatSelectionCopyBtn')?.addEventListener('click', copySelection);
document.getElementById('chatSelectionDeleteBtn')?.addEventListener('click', () => { deleteSelection(); });
document.getElementById('chatSelectionForwardBtn')?.addEventListener('click', () => {
if (!selectionCount()) return;
/* The picker is the same one a single forward uses; it just reads the
   selection instead of one entry when it fires. */
openForwardModal(selectedEntriesInOrder()[0]);
});
// All entry points use the same password, counter and confirmation UI.
document.getElementById('chatLockUnlockBtn')?.addEventListener('click', async () => {
  const input = document.getElementById('chatLockPin');
  if (!await tryUnlockVault(input?.value)) showSharedLockError();
  if (input) input.value = '';
});
document.getElementById('chatLockBioBtn')?.addEventListener('click', () => tryUnlockVaultBiometric());
document.getElementById('chatLockToggle')?.addEventListener('change', async event => {
  if (event.target.checked) await configureSharedLock();
  else await removeSharedLock();
  syncChatLockUi();
});
document.getElementById('chatLockMinutes')?.addEventListener('change', event => {
  const config = vaultLockConfig();
  if (config.enabled && vaultLockState().unlocked) saveEncrypted(VAULT_LOCK_STORAGE_KEY, { ...config, autoLockMinutes: Number(event.target.value || 0) });
});
/* The auto-download quota: applied to every incoming live transfer from the
   moment it is set — no restart, no reconnect needed. */
document.getElementById('chatAutoDownloadLimit')?.addEventListener('change', (event) => {
const value = Number(event.target.value);
chatState.prefs.autoDownloadLimitBytes = Number.isFinite(value) && value >= 0 ? value : DEFAULT_AUTO_DOWNLOAD_LIMIT_BYTES;
saveChatPrefs();
notify(t('سهمیهٔ دانلود خودکار ذخیره شد.', 'The auto-download quota was saved.'), 'success');
});
['pointerdown', 'keydown'].forEach((name) => {
document.getElementById('content-chat')?.addEventListener(name, noteChatActivity, { passive: true });
});
document.addEventListener('visibilitychange', () => {
if (!document.hidden) noteChatActivity();
});
// --- global search -----------------------------------------------------
/* The whole surface moved into the loupe popup owned by part 08 (filters,
   sorts, preview, jump). Nothing is wired here anymore. */
document.getElementById('chatSearchOpenBtn')?.addEventListener('click', () => openFullSearch());
document.addEventListener('keydown', (event) => {
if (event.key === 'Escape') closeFullSearch();
});
// --- key verification --------------------------------------------------
document.getElementById('chatVerifyKeyBtn')?.addEventListener('click', openSafetyPanel);
document.getElementById('chatSafetyPanel')?.addEventListener('click', (event) => {
if (event.target.closest('[data-safety-close]')) { closeSafetyPanel(); return; }
const toggle = event.target.closest('[data-safety-toggle]');
if (!toggle) return;
const fingerprint = toggle.getAttribute('data-safety-toggle');
setPeerVerified(fingerprint, !isPeerVerified(fingerprint));
});
document.addEventListener('keydown', (event) => {
if (event.key === 'Escape') closeSafetyPanel();
});
// --- group management --------------------------------------------------
document.getElementById('chatSpaceInfo')?.addEventListener('click', async (event) => {
if (event.target.closest('[data-space-info-close]')) { closeSpaceInfoPanel(); return; }
if (event.target.closest('[data-space-rename]')) { renameActiveSpace(); return; }
if (event.target.closest('[data-space-desc]')) { editActiveSpaceDescription(); return; }
if (event.target.closest('[data-space-avatar]')) { document.getElementById('chatGroupAvatarInput')?.click(); return; }
if (event.target.closest('[data-space-leave]')) { leaveActiveSpace(); return; }
if (event.target.closest('[data-space-nuke]')) { deleteSpaceForEveryone(); return; }
if (event.target.closest('[data-space-ask-nuke]')) { requestSpaceDissolve(); return; }
if (event.target.closest('[data-space-invite]')) {
const code = buildGroupInvite();
const box = document.getElementById('chatSpaceInviteBox');
if (!code || !box) return;
box.classList.remove('hidden');
box.innerHTML = `
<p class="chat-space-invite-hint">${app().escapeHTML(t('این کد را برای هرکسی که می‌خواهید بفرستید. هیچ سروری آن را نمی‌بیند.', 'Send this code to whoever you want to invite. No server sees it.'))}</p>
<textarea readonly class="chat-space-invite-code">${app().escapeHTML(code)}</textarea>
<button type="button" data-space-invite-copy class="chat-space-add-confirm">${app().escapeHTML(t('کپی کد دعوت', 'Copy invite code'))}</button>`;
return;
}
if (event.target.closest('[data-space-invite-copy]')) {
const code = document.querySelector('.chat-space-invite-code')?.value || '';
navigator.clipboard?.writeText(code)
.then(() => notify(t('کد دعوت کپی شد.', 'Invite code copied.'), 'success'))
.catch(() => notify(t('کپی ناموفق بود.', 'Copy failed.'), 'warning'));
return;
}
const memberPerm = event.target.closest('[data-space-member-perm]');
if (memberPerm) {
  toggleMemberPermission(memberPerm.getAttribute('data-space-member-perm'), memberPerm.getAttribute('data-perm'));
  return;
}
const perm = event.target.closest('[data-space-perm]');
if (perm) { toggleSpacePermission(perm.getAttribute('data-space-perm')); return; }
if (event.target.closest('[data-space-add]')) { renderSpaceAddPicker(); return; }
if (event.target.closest('[data-space-add-confirm]')) {
const keys = [...document.querySelectorAll('#chatSpaceAddPicker input:checked')].map((input) => input.value);
if (!keys.length) {
notify(t('کسی انتخاب نشده است.', 'Nobody is selected.'), 'warning');
return;
}
addMembersToActiveSpace(keys);
return;
}
const memberPerms = event.target.closest('[data-space-member-perms]');
if (memberPerms) { openPermsDialog(memberPerms.getAttribute('data-space-member-perms')); return; }
if (event.target.closest('[data-space-perms-open]')) { openPermsDialog(null); return; }
const admin = event.target.closest('[data-space-admin]');
if (admin) { toggleSpaceAdmin(admin.getAttribute('data-space-admin')); return; }
const remove = event.target.closest('[data-space-remove]');
if (remove) { removeMemberFromActiveSpace(remove.getAttribute('data-space-remove')); }
});
document.getElementById('chatGroupAvatarInput')?.addEventListener('change', async (event) => {
const file = event.target.files?.[0];
event.target.value = '';
if (file) await setActiveSpaceAvatar(file);
});
document.getElementById('chatSpaceInfoBtn')?.addEventListener('click', openSpaceInfoPanel);
document.addEventListener('click', (event) => {
  if (!event.target.closest?.('#chatPermsDialog')) return;
  if (event.target.closest('[data-perms-close]')) { closePermsDialog(); return; }
  const reset = event.target.closest('[data-perms-reset]');
  if (reset) { resetMemberPermissions(reset.getAttribute('data-perms-reset')); return; }
  const memberPerm = event.target.closest('[data-space-member-perm]');
  if (memberPerm) {
    toggleMemberPermission(memberPerm.getAttribute('data-space-member-perm'), memberPerm.getAttribute('data-perm'));
    return;
  }
  const perm = event.target.closest('[data-space-perm]');
  if (perm) toggleSpacePermission(perm.getAttribute('data-space-perm'));
});
document.addEventListener('keydown', (event) => {
if (event.key !== 'Escape') return;
/* The dialog sits on top of the panel, so Escape closes the top one first. */
if (document.getElementById('chatPermsDialog')) { closePermsDialog(); return; }
closeSpaceInfoPanel();
});
// --- polls, location, contact cards -----------------------------------
function renderPollOptionInputs() {
const list = document.getElementById('chatPollOptions');
if (!list) return;
const values = [...list.querySelectorAll('input')].map((input) => input.value);
while (values.length < POLL_MIN_OPTIONS) values.push('');
list.innerHTML = values.slice(0, POLL_MAX_OPTIONS).map((value, index) => `
<div class="chat-poll-option-row">
<input type="text" maxlength="120" class="chat-poll-input" value="${app().escapeHTML(value)}" placeholder="${app().escapeHTML(t(`گزینهٔ ${index + 1}`, `Option ${index + 1}`))}">
${values.length > POLL_MIN_OPTIONS ? `<button type="button" data-poll-remove="${index}" class="chat-poll-remove"><i class="fas fa-xmark"></i></button>` : ''}
</div>`).join('');
}
function setPollComposerVisible(visible) {
const panel = document.getElementById('chatPollComposer');
if (!panel) return;
panel.classList.toggle('hidden', !visible);
if (!visible) return;
setStickerPanelVisible(false);
document.getElementById('chatContactPicker')?.classList.add('hidden');
renderPollOptionInputs();
document.getElementById('chatPollQuestion')?.focus();
}
function renderContactPicker() {
const list = document.getElementById('chatContactPickerList');
if (!list) return;
const contacts = shareableContacts();
if (!contacts.length) {
list.innerHTML = `<div class="chat-sticker-empty-note">${app().escapeHTML(t('مخاطب دیگری برای اشتراک‌گذاری ندارید.', 'You have no other contacts to share.'))}</div>`;
return;
}
/* The picker's avatars come from contact records that arrived over the wire;
   sanitizeAvatarData admits only raster data: URLs, so a crafted value never
   reaches an src attribute here. */
list.innerHTML = contacts.map((contact) => {
const avatarSrc = sanitizeAvatarData(contact.avatarData);
return `
<button type="button" class="chat-contact-pick" data-contact-key="${app().escapeHTML(contact.key)}">
<span class="chat-contact-pick-avatar">${avatarSrc ? `<img src="${avatarSrc}" alt="">` : app().escapeHTML(initials(contact.name))}</span>
<span class="chat-contact-pick-body">
<span class="chat-contact-pick-name">${app().escapeHTML(contact.name)}</span>
<span class="chat-contact-pick-fp" dir="ltr">${app().escapeHTML(shortSecurityValue(contact.fingerprint, 10, 8))}</span>
</span>
<i class="fas fa-paper-plane"></i>
</button>`;
}).join('');
}
document.getElementById('chatPollBtn')?.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
closeComposerActions(true);
if (!guardGroupSend('sendPolls')) return;
const panel = document.getElementById('chatPollComposer');
setPollComposerVisible(Boolean(panel?.classList.contains('hidden')));
});
document.getElementById('chatPollCloseBtn')?.addEventListener('click', () => setPollComposerVisible(false));
document.getElementById('chatPollAddOptionBtn')?.addEventListener('click', () => {
const list = document.getElementById('chatPollOptions');
if (!list || list.querySelectorAll('input').length >= POLL_MAX_OPTIONS) {
notify(t(`حداکثر ${POLL_MAX_OPTIONS} گزینه.`, `At most ${POLL_MAX_OPTIONS} options.`), 'warning');
return;
}
const row = document.createElement('div');
row.className = 'chat-poll-option-row';
row.innerHTML = '<input type="text" maxlength="120" class="chat-poll-input">';
list.appendChild(row);
renderPollOptionInputs();
});
document.getElementById('chatPollOptions')?.addEventListener('click', (event) => {
const remove = event.target.closest('[data-poll-remove]');
if (!remove) return;
remove.closest('.chat-poll-option-row')?.remove();
renderPollOptionInputs();
});
document.getElementById('chatPollSendBtn')?.addEventListener('click', async () => {
const question = (document.getElementById('chatPollQuestion')?.value || '').trim();
const options = [...document.querySelectorAll('#chatPollOptions input')]
.map((input) => input.value.trim()).filter(Boolean);
if (!question) {
notify(t('سؤال نظرسنجی را بنویسید.', 'Write the poll question.'), 'warning');
return;
}
if (options.length < POLL_MIN_OPTIONS) {
notify(t(`حداقل ${POLL_MIN_OPTIONS} گزینه لازم است.`, `At least ${POLL_MIN_OPTIONS} options are required.`), 'warning');
return;
}
if (new Set(options).size !== options.length) {
notify(t('گزینه‌ها نباید تکراری باشند.', 'Options must not repeat.'), 'warning');
return;
}
try {
await sendRichMessage('poll', {
question,
options,
multi: Boolean(document.getElementById('chatPollMulti')?.checked),
votes: {},
closed: false,
});
setPollComposerVisible(false);
const questionInput = document.getElementById('chatPollQuestion');
if (questionInput) questionInput.value = '';
document.getElementById('chatPollOptions').innerHTML = '';
renderPollOptionInputs();
} catch (error) {
console.error('[Poll] send failed', error);
notify(t('ارسال نظرسنجی ناموفق بود.', 'Sending the poll failed.'), 'error');
}
});
document.getElementById('chatLocationBtn')?.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
closeComposerActions(true);
if (!guardGroupSend('sendLocation')) return;
shareCurrentLocation();
});
document.getElementById('chatContactBtn')?.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
closeComposerActions(true);
if (!guardGroupSend('sendContacts')) return;
const picker = document.getElementById('chatContactPicker');
const opening = Boolean(picker?.classList.contains('hidden'));
if (opening) {
setStickerPanelVisible(false);
setPollComposerVisible(false);
renderContactPicker();
}
picker?.classList.toggle('hidden', !opening);
});
document.getElementById('chatContactCloseBtn')?.addEventListener('click', () => {
document.getElementById('chatContactPicker')?.classList.add('hidden');
});
document.getElementById('chatContactPickerList')?.addEventListener('click', async (event) => {
const pick = event.target.closest('[data-contact-key]');
if (!pick) return;
const contact = shareableContacts().find((item) => item.key === pick.getAttribute('data-contact-key'));
if (!contact) return;
document.getElementById('chatContactPicker')?.classList.add('hidden');
try {
await sendRichMessage('contact', {
name: contact.name,
fingerprint: contact.fingerprint,
peerId: contact.peerId,
publicKeyData: contact.publicKeyData,
avatarData: await thumbnailDataUrl(contact.avatarData),
});
} catch (error) {
console.error('[Contact] share failed', error);
notify(t('ارسال کارت مخاطب ناموفق بود.', 'Sharing the contact card failed.'), 'error');
}
});
// --- stickers ---------------------------------------------------------
const openStickerImport = () => document.getElementById('chatStickerInput')?.click();
document.getElementById('chatStickerBtn')?.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
if (!guardGroupSend('sendStickers')) return;
const panel = document.getElementById('chatStickerPanel');
setStickerPanelVisible(Boolean(panel?.classList.contains('hidden')));
closeComposerActions(true);
});
document.getElementById('chatStickerCloseBtn')?.addEventListener('click', () => setStickerPanelVisible(false));
document.getElementById('chatStickerImportBtn')?.addEventListener('click', openStickerImport);
document.getElementById('chatStickerManageBtn')?.addEventListener('click', () => {
chatState.stickerManageMode = !chatState.stickerManageMode;
document.getElementById('chatStickerManageBtn')?.classList.toggle('is-active', chatState.stickerManageMode);
renderStickerPanel();
});
document.getElementById('chatStickerInput')?.addEventListener('change', async (event) => {
// Copy the File objects out before resetting the input: `files` is the live
// FileList the input owns, and clearing value empties it in place — the import
// then sees zero files and silently does nothing.
const files = Array.from(event.target.files || []);
event.target.value = '';
try {
await importStickerFiles(files);
} catch (error) {
console.error('[Stickers] import failed', error);
notify(t('وارد کردن استیکر ناموفق بود.', 'Sticker import failed.'), 'error');
}
});
document.getElementById('chatStickerPanel')?.addEventListener('click', async (event) => {
if (event.target.closest('[data-chat-sticker-import]')) {
openStickerImport();
return;
}
const tab = event.target.closest('[data-chat-sticker-pack]');
if (tab) {
chatState.stickerActivePackId = tab.getAttribute('data-chat-sticker-pack') || '';
/* Tapping a tab is the choice worth remembering across a reload. */
rememberActiveStickerPack(chatState.stickerActivePackId);
chatState.stickerManageMode = false;
document.getElementById('chatStickerManageBtn')?.classList.remove('is-active');
renderStickerPanel();
return;
}
const share = event.target.closest('[data-chat-sticker-share]');
if (share) {
await shareStickerPack(share.getAttribute('data-chat-sticker-share'));
return;
}
const remove = event.target.closest('[data-chat-sticker-delete]');
if (remove) {
const packId = remove.getAttribute('data-chat-sticker-delete');
const pack = chatState.stickerPacks.find((item) => item.id === packId);
if (pack && await PoorijaDialogs.confirm(t(`پک «${pack.title}» حذف شود؟`, `Delete the "${pack.title}" pack?`))) {
await deleteStickerPack(packId);
}
return;
}
/* Reordering packs, from the manage view. */
const moveUp = event.target.closest('[data-chat-sticker-up]');
const moveDown = event.target.closest('[data-chat-sticker-down]');
if (moveUp || moveDown) {
const id = (moveUp || moveDown).getAttribute(moveUp ? 'data-chat-sticker-up' : 'data-chat-sticker-down');
if (moveStickerPack(id, moveUp ? -1 : 1)) renderStickerPanel();
return;
}

/* The star sits inside the cell, so it has to be handled before the cell is:
   otherwise starring a sticker sends it. */
const star = event.target.closest('[data-chat-sticker-fav]');
if (star) {
event.preventDefault();
event.stopPropagation();
toggleStickerFavourite(
star.getAttribute('data-chat-sticker-fav-pack'),
star.getAttribute('data-chat-sticker-fav'));
renderStickerPanel();
return;
}

if (event.target.closest('[data-chat-sticker-send-selected]')) {
const sent = await sendSelectedStickers();
if (sent) notify(t(`${sent} استیکر فرستاده شد.`, `${sent} sticker(s) sent.`), 'success');
return;
}
if (event.target.closest('[data-chat-sticker-clear-selection]')) {
clearStickerSelection();
renderStickerPanel();
return;
}
if (event.target.closest('[data-chat-sticker-make-pack]')) {
const title = await PoorijaDialogs.prompt(
t('نام پک تازه؟', 'A name for the new pack?'), { value: t('پک من', 'My pack') });
if (title === null) return;
const pack = await buildPackFromSelection(title);
if (pack) {
notify(t(`پک «${pack.title}» با ${pack.stickers.length} استیکر ساخته شد.`,
`Made "${pack.title}" with ${pack.stickers.length} sticker(s).`), 'success');
}
return;
}

const cell = event.target.closest('[data-chat-sticker-send]');
if (!cell) return;
const packId = cell.getAttribute('data-chat-sticker-pack-id');
const stickerId = cell.getAttribute('data-chat-sticker-send');
const record = findStickerRecord(packId, stickerId);
if (!record) return;

/* While a selection is running, a tap adds to it rather than sending — the
   rule every gallery uses, and the only one that lets somebody pick a tenth
   sticker without accidentally firing the first nine. */
if (stickerSelectionActive()) {
toggleStickerSelection(packId, stickerId);
renderStickerPanel();
return;
}

cell.classList.add('is-sending');
try {
await sendStickerRecord(record);
noteStickerUsed(packId, stickerId);
renderStickerPanel();
} catch (error) {
console.error('[Stickers] send failed', error);
notify(t('ارسال استیکر ناموفق بود.', 'Sending the sticker failed.'), 'error');
} finally {
cell.classList.remove('is-sending');
}
});

/* Press and hold to start selecting, which is how every phone gallery begins a
   multi-select. On a desktop the same gesture is a right-click, so both are
   bound: neither platform is asked to learn the other's. */
{
const panel = document.getElementById('chatStickerPanel');
let holdTimer = 0;
const beginSelect = (target) => {
const cell = target.closest?.('[data-chat-sticker-send]');
if (!cell || stickerSelectionActive()) return;
toggleStickerSelection(
cell.getAttribute('data-chat-sticker-pack-id'),
cell.getAttribute('data-chat-sticker-send'));
renderStickerPanel();
};
panel?.addEventListener('pointerdown', (event) => {
clearTimeout(holdTimer);
const target = event.target;
holdTimer = setTimeout(() => beginSelect(target), 420);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((name) =>
panel?.addEventListener(name, () => clearTimeout(holdTimer)));
panel?.addEventListener('contextmenu', (event) => {
if (!event.target.closest?.('[data-chat-sticker-send]')) return;
event.preventDefault();
beginSelect(event.target);
});
}
// Desktop file dialogs filter on the accept list and grey out unknown
// extensions like .wastickers; dropping files onto the panel sidesteps the
// dialog entirely, which is the natural desktop gesture anyway.
const stickerPanelEl = document.getElementById('chatStickerPanel');
if (stickerPanelEl) {
['dragenter', 'dragover'].forEach((name) => stickerPanelEl.addEventListener(name, (event) => {
event.preventDefault();
event.stopPropagation();
if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
stickerPanelEl.classList.add('is-dropping');
}));
['dragleave', 'dragend'].forEach((name) => stickerPanelEl.addEventListener(name, (event) => {
if (event.target !== stickerPanelEl) return;
stickerPanelEl.classList.remove('is-dropping');
}));
stickerPanelEl.addEventListener('drop', async (event) => {
event.preventDefault();
event.stopPropagation();
stickerPanelEl.classList.remove('is-dropping');
const files = Array.from(event.dataTransfer?.files || []);
if (!files.length) return;
try {
await importStickerFiles(files);
} catch (error) {
console.error('[Stickers] drop import failed', error);
notify(t('وارد کردن استیکر ناموفق بود.', 'Sticker import failed.'), 'error');
}
});
}
// --- encrypted local vault -------------------------------------------
document.getElementById('chatStorageRefreshBtn')?.addEventListener('click', () => renderStorageCard().catch(() => {}));
// --- the local file manager ----------------------------------------------
document.getElementById('chatFileManagerToggle')?.addEventListener('click', async () => {
const card = document.getElementById('chatFileManager');
if (!card) return;
const opening = card.classList.contains('hidden');
card.classList.toggle('hidden', !opening);
document.getElementById('chatFileManagerToggle')?.classList.toggle('is-active', opening);
if (opening) await renderFileManager();
});
document.addEventListener('click', async (event) => {
if (!event.target.closest?.('[data-file-manager]')) return;
const category = event.target.closest('[data-files-category]');
if (category) {
fileManagerState().category = category.getAttribute('data-files-category');
await renderFileManager();
return;
}
const sort = event.target.closest('[data-files-sort]');
if (sort) {
fileManagerState().sort = sort.getAttribute('data-files-sort');
await renderFileManager();
return;
}
if (event.target.closest('[data-files-refresh]')) { await renderFileManager(); return; }
const clear = event.target.closest('[data-files-clear-category]');
if (clear) { await clearFileCategory(clear.getAttribute('data-files-clear-category')); return; }
const open = event.target.closest('[data-file-open]');
if (open) { await openLocalFile(open.getAttribute('data-file-open')); return; }
const save = event.target.closest('[data-file-save]');
if (save) { await saveLocalFile(save.getAttribute('data-file-save')); return; }
const remove = event.target.closest('[data-file-delete]');
if (remove) { await deleteLocalFile(remove.getAttribute('data-file-delete')); }
});
let fileSearchTimer = 0;
document.addEventListener('input', (event) => {
const search = event.target.closest?.('[data-files-search]');
if (!search || !search.closest('[data-file-manager]')) return;
const mount = search.closest('[data-file-manager]');
window.clearTimeout(fileSearchTimer);
fileSearchTimer = window.setTimeout(() => {
fileManagerState().query = search.value || '';
renderFileManager().then(() => {
/* Re-rendering steals focus from the box the user is typing in. */
const box = mount.querySelector('[data-files-search]');
if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
});
}, 260);
});
document.getElementById('chatClearOldMediaBtn')?.addEventListener('click', async () => {
const removed = await clearMediaVault({ olderThanDays: 30 }).catch(() => 0);
notify(removed
? t(`${removed} پیوست قدیمی پاک شد.`, `${removed} old attachments removed.`)
: t('پیوست قدیمی‌تر از ۳۰ روز پیدا نشد.', 'No attachments older than 30 days.'), removed ? 'success' : 'info');
renderStorageCard().catch(() => {});
});
document.getElementById('chatClearAllMediaBtn')?.addEventListener('click', async () => {
if (!await PoorijaDialogs.confirm(t(
'همهٔ فایل‌ها، پیام‌های صوتی و استیکرهای ذخیره‌شده پاک شوند؟ متن پیام‌ها می‌ماند ولی پیوست‌ها دیگر باز نمی‌شوند.',
'Remove every stored file, voice message and sticker attachment? Message text stays, but the attachments will no longer open.',
))) return;
const removed = await clearMediaVault().catch(() => 0);
notify(t(`${removed} پیوست پاک شد.`, `${removed} attachments removed.`), 'success');
renderStorageCard().catch(() => {});
});
document.getElementById('chatClearStickersBtn')?.addEventListener('click', async () => {
if (!chatState.stickerPacks.length) {
notify(t('پک استیکری برای حذف نیست.', 'There are no sticker packs to remove.'), 'info');
return;
}
if (!await PoorijaDialogs.confirm(t(
`همهٔ ${chatState.stickerPacks.length} پک استیکر حذف شوند؟`,
`Delete all ${chatState.stickerPacks.length} sticker packs?`,
))) return;
for (const pack of [...chatState.stickerPacks]) {
await deleteStickerPack(pack.id);
}
notify(t('همهٔ پک‌ها حذف شدند.', 'All packs removed.'), 'success');
renderStorageCard().catch(() => {});
});
// --- imported call / message sounds -----------------------------------
document.getElementById('chatImportRingtoneBtn')?.addEventListener('click', () => document.getElementById('chatRingtoneFileInput')?.click());
document.getElementById('chatImportMessageToneBtn')?.addEventListener('click', () => document.getElementById('chatMessageToneFileInput')?.click());
document.getElementById('chatRingtoneFileInput')?.addEventListener('change', async (event) => {
const file = event.target.files?.[0];
event.target.value = '';
await importCustomSound(file, 'call');
});
document.getElementById('chatMessageToneFileInput')?.addEventListener('change', async (event) => {
const file = event.target.files?.[0];
event.target.value = '';
await importCustomSound(file, 'message');
});
document.getElementById('chatDeleteRingtoneBtn')?.addEventListener('click', async () => {
const record = selectedSoundFile('call');
if (record) await deleteCustomSound(record.id);
});
document.getElementById('chatDeleteMessageToneBtn')?.addEventListener('click', async () => {
const record = selectedSoundFile('message');
if (record) await deleteCustomSound(record.id);
});
document.getElementById('chatSendFileBtn')?.addEventListener('click', () => document.getElementById('chatFileInput')?.click());
document.getElementById('chatVoiceMessageBtn')?.addEventListener('click', toggleVoiceRecording);
document.getElementById('chatRingtoneSelect')?.addEventListener('change', (event) => {
chatState.profile = {
...chatState.profile,
...buildProfileDraft(),
ringtoneId: event.target.value || 'classic',
};
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderRingtoneSettings();
});
document.getElementById('chatTestRingtoneBtn')?.addEventListener('click', testRingtone);
document.getElementById('chatMessageToneSelect')?.addEventListener('change', (event) => {
chatState.profile = {
...chatState.profile,
...buildProfileDraft(),
messageToneId: event.target.value || 'chime',
};
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderRingtoneSettings();
});
document.getElementById('chatTestMessageToneBtn')?.addEventListener('click', testMessageTone);
document.getElementById('chatPauseRecordingBtn')?.addEventListener('click', pauseOrResumeVoiceRecording);
document.getElementById('chatFinishRecordingBtn')?.addEventListener('click', finishVoiceRecording);
document.getElementById('chatCancelRecordingBtn')?.addEventListener('click', cancelVoiceRecording);
document.getElementById('chatDiscardVoiceDraftBtn')?.addEventListener('click', clearVoiceDraft);
document.getElementById('chatVoicePlayBtn')?.addEventListener('click', toggleVoicePreviewPlayback);
const waveformContainer = document.getElementById('chatVoiceWaveform')?.parentElement;
if (waveformContainer) {
const handleSeek = (e) => {
if (e.type.startsWith('touch') || (e.buttons & 1)) {
seekVoicePlayback(e);
}
};
const endSeek = () => {
const progressEl = document.getElementById('chatVoiceProgress');
if (progressEl) progressEl.classList.remove('seeking');
};
waveformContainer.addEventListener('mousedown', seekVoicePlayback);
waveformContainer.addEventListener('mousemove', handleSeek);
waveformContainer.addEventListener('mouseup', endSeek);
waveformContainer.addEventListener('touchstart', seekVoicePlayback, { passive: true });
waveformContainer.addEventListener('touchmove', handleSeek, { passive: true });
waveformContainer.addEventListener('touchend', endSeek, { passive: true });
}
document.getElementById('chatComposer')?.addEventListener('input', (event) => {
syncComposerDirection();
const heightChanged = syncComposerHeight(event.target);
if (heightChanged) {
syncComposerViewportFocus(true, true);
}
notifyTyping();
});
document.getElementById('chatComposer')?.addEventListener('focus', () => {
syncComposerDirection();
if (isCompactChatLayout()) {
document.documentElement.scrollTop = 0;
document.body.scrollTop = 0;
window.scrollTo(0, 0);
}
syncComposerViewportFocus(true);
});
document.getElementById('chatComposer')?.addEventListener('blur', () => {
syncComposerViewportFocus(false);
});
document.getElementById('chatHiddenToggleBtn')?.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
if (!guardGroupSend('sendHidden')) return;
toggleHiddenCompose();
});
document.getElementById('chatTimerToggleBtn')?.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
if (!guardGroupSend('sendTimed')) return;
toggleTimerPopover();
});
document.querySelectorAll('[data-chat-timer]').forEach((button) => {
button.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
setTimerSeconds(Number(button.getAttribute('data-chat-timer') || 0));
});
});
/* Everything that was chosen, one at a time.
   This took files[0] and dropped the rest without a word, so picking four and
   watching one arrive looked like a transfer that had failed. They still go
   sequentially — each send owns the transfer banner and the data channel, and
   starting several at once is how the channel gets overrun — and a file that
   fails no longer takes the ones behind it with it. */
document.getElementById('chatFileInput')?.addEventListener('change', async (event) => {
const files = Array.from(event.target.files || []);
event.target.value = '';
await sendChosenFiles(files);
});

async function sendChosenFiles(files) {
  if (!files.length) return;
  const failed = [];
  for (const file of files) {
    try {
      await sendFile(file);
    } catch (error) {
      console.error('[Chat] sending failed', file.name, error);
      failed.push(file.name);
    }
  }
  if (!failed.length) return;
  /* Named, because "sending failed" about one of four files is not something
     anybody can act on. */
  const list = failed.slice(0, 3).join('، ') + (failed.length > 3 ? '…' : '');
  notify(t(`ارسال نشد: ${list}`, `Could not send: ${list}`), 'error');
}
/* The sheet closes itself: a delegated listener on #chatComposerActions
   dismisses it for any .chat-action-row click. */
document.getElementById('chatGalleryBtn')?.addEventListener('click', () => {
  if (!guardGroupSend('sendMedia')) return;
  document.getElementById('chatGalleryInput')?.click();
});
/* The gallery picker allows a multi-selection. They go one at a time on
   purpose: each send owns the transfer banner and the data channel, and
   starting several at once is how the channel gets overrun. */
document.getElementById('chatGalleryInput')?.addEventListener('change', async (event) => {
const files = Array.from(event.target.files || []);
event.target.value = '';
/* The same path as the file button, so a failure behaves the same way in both
   — this called sendEncryptedBlob directly and a throw from any one file
   silently abandoned the rest of the selection. */
await sendChosenFiles(files);
});
document.getElementById('chatVoiceCallBtn')?.addEventListener('click', () => startCall('voice'));
document.getElementById('chatVideoCallBtn')?.addEventListener('click', () => startCall('video'));
document.getElementById('chatEndCallBtn')?.addEventListener('click', endCurrentCall);
// --- calls among people who are not a group -------------------------------
/* Delegated: the calls list is re-rendered constantly and exists in two panes,
   so nothing here can hold a reference to one button. */
document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-adhoc-call]');
  if (!btn) return;
  const mode = btn.getAttribute('data-adhoc-call') === 'video' ? 'video' : 'voice';
  openCallPicker({
    mode, kind: 'new',
    title: mode === 'video'
      ? t('تماس گروهی تصویری با چه کسانی؟', 'A group video call with whom?')
      : t('تماس گروهی صوتی با چه کسانی؟', 'A group voice call with whom?'),
  });
});
document.getElementById('chatCallAddPeopleBtn')?.addEventListener('click', () => {
  openCallPicker({
    kind: 'add',
    /* Who is already on the line, taken from the call rather than from
       whichever conversation happens to be open - on a desktop those are not
       the same thing, and the person you were already talking to was being
       offered back to you as somebody to add. */
    exclude: peopleAlreadyOnTheCall(),
    title: t('چه کسی به تماس اضافه شود؟', 'Who should join the call?'),
  });
});
document.getElementById('chatCallPicker')?.addEventListener('change', (event) => {
  if (event.target.matches('input[type="checkbox"]')) syncCallPickerCount();
});
document.getElementById('chatCallPicker')?.addEventListener('click', async (event) => {
  if (event.target.closest('[data-call-picker-close]')) { closeCallPicker(); return; }
  if (event.target === event.currentTarget) { closeCallPicker(); return; }
  if (!event.target.closest('[data-call-picker-go]')) return;
  const intent = callPickerIntent;
  const people = selectedCallPeers();
  if (!people.length) {
    notify(t('حداقل یک نفر را انتخاب کنید.', 'Pick at least one person.'), 'warning');
    return;
  }
  closeCallPicker();
  if (intent?.kind === 'add') await addPeopleToLiveCall(people);
  else await startAdhocGroupCall(people, intent?.mode || 'voice');
});
document.getElementById('chatFloatingEndCallBtn')?.addEventListener('click', endCurrentCall);
document.getElementById('chatEndCallControlBtn')?.addEventListener('click', endCurrentCall);
document.getElementById('chatMinimizeCallBtn')?.addEventListener('click', (event) => {
event.stopPropagation();
toggleCallDisplayMode();
});
/* chatAcceptCallBtn and chatRejectCallBtn were listened for here and never
   existed: the incoming-call screen is built at runtime in
   js/chat/31-file-transfer-3.js, which creates chatModalAcceptBtn /
   chatModalRejectBtn / chatModalReplyBtn and binds them itself. Optional
   chaining made these two lines silent rather than wrong, but they read as a
   second way to answer a call, and there is only one. */
document.getElementById('chatMuteToggleBtn')?.addEventListener('click', toggleMuteCall);
document.getElementById('chatHoldToggleBtn')?.addEventListener('click', toggleHoldCall);
document.getElementById('chatSpeakerToggleBtn')?.addEventListener('click', toggleSpeakerCall);
document.getElementById('chatVideoToggleBtn')?.addEventListener('click', toggleVideoCall);
document.getElementById('chatScreenShareBtn')?.addEventListener('click', () => {
toggleCallMoreSheet(false);
const sheet = document.getElementById('chatCallPresentSheet');
const open = sheet?.classList.contains('hidden');
renderPresentSheet('chatCallPresentSheet', Boolean(chatState.screenStream));
sheet?.classList.toggle('hidden', !open);
noteCallActivity();
});
document.getElementById('chatFlipCameraBtn')?.addEventListener('click', flipCameraCall);
document.getElementById('chatMirrorVideoBtn')?.addEventListener('click', toggleMirrorVideo);
const backdropSelect = document.getElementById('chatCallBackdropSelect');
if (backdropSelect) {
backdropSelect.value = callBackdropStyle();
backdropSelect.addEventListener('change', () => {
chatState.profile.callBackdrop = backdropSelect.value === 'dark' ? 'dark' : 'blur';
try { saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile); } catch (_error) { /* best effort */ }
/* Re-running the fit is what actually removes or restores the second video
   element; the class alone would leave it decoding behind a solid panel. */
refreshCallLayout();
});
}
document.getElementById('chatCallScreenshotBtn')?.addEventListener('click', captureCallScreenshot);
document.getElementById('chatCallPiPBtn')?.addEventListener('click', toggleCallPiP);
document.getElementById('chatCallFullscreenBtn')?.addEventListener('click', toggleCallFullscreen);
// --- call chrome: auto-hide, overflow sheet -----------------------------
document.getElementById('chatCallMoreBtn')?.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
toggleCallMoreSheet();
});
document.getElementById('chatCallMoreSheet')?.addEventListener('click', (event) => {
if (event.target.closest('.chat-call-control')) toggleCallMoreSheet(false);
});
const callShell = document.getElementById('chatFloatingCall');
if (callShell) {
const CALL_CHROME_IGNORE = '.chat-call-control, .chat-floating-call-header, .chat-call-settings-panel, .chat-call-more-sheet';
/* A mouse reveals the chrome by moving, because a mouse hovers. A finger does
   not, so on touch only a tap counts — and binding pointerdown to "reveal" was
   exactly what made the tap useless on Android: the down-stroke showed the
   controls, then the click that followed saw them already showing and put them
   straight back. One frame of controls, every time. */
const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
['pointermove', 'wheel'].forEach((name) => {
callShell.addEventListener(name, (event) => {
if (event.pointerType === 'touch' || !finePointer()) return;
noteCallActivity();
}, { passive: true });
});
callShell.addEventListener('pointerdown', (event) => {
/* Remember what the user was looking at before this gesture, so the click
   toggles from that rather than from something we changed underneath them. */
chatState.callChromeWasHidden = callShell.classList.contains('chrome-hidden');
if (event.target.closest(CALL_CHROME_IGNORE)) noteCallActivity();
}, { passive: true });
callShell.addEventListener('click', (event) => {
/* Tapping the stage toggles the chrome the way FaceTime does; tapping a
   control must not hide what you are aiming at, and tapping the small tile
   swaps the views instead. */
if (event.target.closest(CALL_CHROME_IGNORE)) {
noteCallActivity();
return;
}
const box = event.target.closest('.chat-local-stage, .chat-remote-stage');
if (box && isCallTile(box)) {
noteCallActivity();
return;
}
const wasHidden = typeof chatState.callChromeWasHidden === 'boolean'
? chatState.callChromeWasHidden
: callShell.classList.contains('chrome-hidden');
chatState.callChromeWasHidden = null;
if (wasHidden || chatState.currentCallMode !== 'video') {
noteCallActivity();
return;
}
chatState.callLastInputAt = 0;
callShell.classList.add('chrome-hidden');
});
}
/* Connection quality, opened from the call header.
 *
 * The numbers used to be reachable only through Settings -> Tools, which meant
 * leaving the call to find out what was wrong with the call. noteCallActivity
 * matters here: the header hides itself after a few idle seconds, and it would
 * take the panel with it while somebody was reading it. */
document.getElementById('chatCallQualityBadge')?.addEventListener('click', (event) => {
event.stopPropagation();
const card = document.getElementById('chatCallQualityCard');
const badge = document.getElementById('chatCallQualityBadge');
const next = card?.classList.contains('hidden');
card?.classList.toggle('hidden', !next);
badge?.setAttribute('aria-expanded', next ? 'true' : 'false');
/* Draw immediately rather than waiting for the next sample: opening a panel
   that stays blank for two seconds reads as broken. */
if (next && typeof renderCallQualityCard === 'function') renderCallQualityCard();
/* And the verify card goes away, same reason. */
if (next) {
document.getElementById('chatCallVerifyCard')?.classList.add('hidden');
document.getElementById('chatCallVerifyStrip')?.setAttribute('aria-expanded', 'false');
}
noteCallActivity();
});
document.getElementById('chatCallQualityCard')?.addEventListener('click', (event) => {
event.stopPropagation();
noteCallActivity();
if (event.target.closest('[data-quality-close]')) {
document.getElementById('chatCallQualityCard')?.classList.add('hidden');
document.getElementById('chatCallQualityBadge')?.setAttribute('aria-expanded', 'false');
}
});
document.getElementById('chatCallVerifyStrip')?.addEventListener('click', (event) => {
event.stopPropagation();
const card = document.getElementById('chatCallVerifyCard');
const strip = document.getElementById('chatCallVerifyStrip');
const next = card?.classList.contains('hidden');
card?.classList.toggle('hidden', !next);
strip?.setAttribute('aria-expanded', next ? 'true' : 'false');
/* The two panels share the same corner of a small screen, so opening one puts
   the other away rather than stacking them. */
if (next) {
document.getElementById('chatCallQualityCard')?.classList.add('hidden');
document.getElementById('chatCallQualityBadge')?.setAttribute('aria-expanded', 'false');
}
noteCallActivity();
});
document.getElementById('chatCallVerifyCard')?.addEventListener('click', (event) => {
event.stopPropagation();
noteCallActivity();
if (event.target.closest('[data-verify-close]')) {
document.getElementById('chatCallVerifyCard')?.classList.add('hidden');
document.getElementById('chatCallVerifyStrip')?.setAttribute('aria-expanded', 'false');
return;
}
const toggle = event.target.closest('[data-verify-toggle]');
if (!toggle) return;
const fingerprint = toggle.getAttribute('data-verify-toggle') || '';
setPeerVerified(fingerprint, !isPeerVerified(fingerprint));
syncCallVerification().catch(() => {});
});
document.getElementById('chatCallSettingsBtn')?.addEventListener('click', openCallDeviceSettings);
document.getElementById('chatCallSettingsCloseBtn')?.addEventListener('click', closeCallSettingsPanel);
document.getElementById('chatMicDeviceSelect')?.addEventListener('change', (event) => switchCallMediaDevice('audioinput', event.target.value));
document.getElementById('chatCamDeviceSelect')?.addEventListener('change', (event) => switchCallMediaDevice('videoinput', event.target.value));
document.getElementById('chatSpeakerDeviceSelect')?.addEventListener('change', (event) => switchCallMediaDevice('audiooutput', event.target.value));
document.addEventListener('click', (event) => {
const redial = event.target.closest('[data-chat-redial-peer]');
if (!redial) return;
redialCall(redial.getAttribute('data-chat-redial-peer'), redial.getAttribute('data-chat-redial-mode'));
});
document.getElementById('chatSwapVideoLayoutBtn')?.addEventListener('click', () => {
chatState.callPrimaryVideo = chatState.callPrimaryVideo === 'remote' ? 'local' : 'remote';
/* Drop any dragged coordinates: they were measured for the box that is about
   to become full-bleed, and carrying them over parks the new tile off-screen. */
document.querySelectorAll('#chatFloatingCall .chat-local-stage, #chatFloatingCall .chat-remote-stage').forEach((box) => {
box.style.removeProperty('--self-x');
box.style.removeProperty('--self-y');
});
refreshCallControls();
noteCallActivity();
});
document.getElementById('chatComposer')?.addEventListener('keydown', (event) => {
if (event.key !== 'Enter') return;
/* On a hardware keyboard Enter sends and Shift+Enter breaks the line, which
   is what desktop users expect. On a touch keyboard there is no Shift+Enter
   to reach, so the return key must do what it looks like it does — insert a
   newline — and sending is the send button's job. */
const touchKeyboard = window.matchMedia('(pointer: coarse)').matches;
if (touchKeyboard || event.shiftKey) return;
event.preventDefault();
sendMessage();
});
document.addEventListener('click', (event) => {
const timerOption = event.target.closest('[data-chat-timer]');
if (timerOption) {
event.preventDefault();
event.stopPropagation();
setTimerSeconds(Number(timerOption.getAttribute('data-chat-timer') || 0));
return;
}
const popover = document.getElementById('chatTimerPopover');
const toggle = document.getElementById('chatTimerToggleBtn');
if (!popover || popover.classList.contains('hidden')) return;
if (popover.contains(event.target) || toggle?.contains(event.target)) return;
toggleTimerPopover(false);
});
document.addEventListener('click', (event) => {
if (event.target.closest('[data-chat-toggle-reaction]') || event.target.closest('[data-chat-reaction-choice]') || event.target.closest('[data-chat-reaction-custom]')) return;
if (chatState.activeReactionMessageId && !event.target.closest('.chat-message-toolbar') && !event.target.closest('.chat-reaction-picker')) {
chatState.activeReactionMessageId = '';
renderMessages();
}
});
['pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
document.addEventListener(eventName, primeRingtoneAudio, { once: true, passive: true });
});
document.getElementById('chatFloatingCallHeader')?.addEventListener('pointerdown', (event) => {
if (event.target.closest('button')) return;
beginFloatingCallDrag(event);
});
document.getElementById('chatFloatingCall')?.addEventListener('click', (event) => {
if (chatState.callDisplayMode !== 'minimized') return;
if (event.target.closest('button')) return;
setCallDisplayMode('fullscreen');
});
window.addEventListener('pointermove', moveFloatingCallDrag);
window.addEventListener('pointerup', endFloatingCallDrag);
window.addEventListener('pointercancel', endFloatingCallDrag);
window.addEventListener('resize', () => {
if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
syncCallOverlayBounds();
});
window.visualViewport?.addEventListener('resize', () => {
if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
syncComposerViewportFocus(document.activeElement?.id === 'chatComposer');
composerKeyboardOverlapFix();
syncCallOverlayBounds();
});
window.visualViewport?.addEventListener('scroll', () => {
if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
syncComposerViewportFocus(document.activeElement?.id === 'chatComposer');
composerKeyboardOverlapFix();
syncCallOverlayBounds();
});
window.addEventListener('scroll', () => {
if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
syncCallOverlayBounds();
}, true);
window.addEventListener('poorija:tab-switched', async (event) => {
updateChatShellMode();
if (event.detail?.tabName === 'chat') {
renderStaticUi();
renderPeers();
renderActivePeer();
setChatView(chatState.activeView);
if (isUnlocked() && chatState.profile.autoConnect && !chatState.connected) {
await connectChatTransport();
}
}
});
window.addEventListener('poorija:unlock', async () => {
loadPersistedChatState();
await ensureIdentity();
renderStaticUi();
renderPeers();
renderActivePeer();
/* First run on a native install: with no relay saved the messenger asks once,
   right here, whether the user wants one at all. */
maybeAskRelayOnboarding();
setChatView(chatState.activeView);
/* Anything that sat queued through the lock gets its turn now — a message
   whose envelope was consumed by a connection that had gone unreadable has
   been waiting here since. */
retryQueuedMessages();
if (chatState.profile.autoConnect) {
await connectChatTransport();
}
});
window.addEventListener('poorija:lock', () => {
/* The transport used to be torn down here, which made a locked app deaf:
   on the desktop a running-but-locked app was exactly when the user still
   wanted to hear that a message had come in (only a quit app stays silent).
   The connection now stays up. Nothing is exposed by that that the unlocked
   app was not already doing — arrivals are stored under the same encryption
   and, while the lock screen is up, announced with a bare "new message"
   that names no sender and no words (see appendHistory). */
});
window.addEventListener('poorija:language-changed', () => {
renderStaticUi();
renderPeers();
renderActivePeer();
setChatView(chatState.activeView);
/* The lists rebuild themselves from t() above, but the settings menu and the
   profile menu are each built once and then kept, so their labels would stay
   in the language they were born in. */
relabelChatMenus();
/* The appearance pane is built once from t() and then only touched when one
   of its own controls moves, so every label it writes itself -- the theme
   names, the background tiles, the tick profile and the contrast reading --
   stayed in the language the pane was opened in while the headings around
   them switched. */
renderChatAppearanceSettings();
/* And so are the cards inside the settings panes: the import/export block and
   the whole Tools card are written by JavaScript, so nothing in
   updateLanguage()'s data-i18n sweep reaches them. That is why Tools showed an
   English menu sitting over Persian cards. */
if (typeof relabelChatSettingsCards === 'function') relabelChatSettingsCards();
});

function relabelChatMenus() {
  document.querySelectorAll('#chatConnectionPanel [data-settings-tab]').forEach((button) => {
    const tab = CHAT_SETTINGS_TABS.find((entry) => entry.id === button.getAttribute('data-settings-tab'));
    const label = button.querySelector('.chat-settings-menu-label');
    if (tab && label) label.textContent = t(tab.fa, tab.en);
  });
  document.querySelectorAll('[data-settings-back] span').forEach((span) => {
    span.textContent = t('تنظیمات', 'Settings');
  });
  const stageTitle = document.querySelector('#chatSettingsStage .chat-settings-stage-title');
  if (stageTitle && chatState.settingsPane) stageTitle.textContent = settingsPaneTitle(chatState.settingsPane);
  const paneTitle = document.querySelector('#chatConnectionPanel .chat-settings-pane-head-title');
  if (paneTitle && chatState.settingsPane) paneTitle.textContent = settingsPaneTitle(chatState.settingsPane);

  /* A sheet is rebuilt from t() every time it opens, so there is nothing of
     its text to refresh here — only the card behind it. */
  renderProfileSummary();
}
window.addEventListener('resize', () => {
if (!isCompactChatLayout() && !chatState.activePeerClientId && !chatState.activeConversationId && chatState.peers.some(shouldShowConversation)) {
const visiblePeers = chatState.peers.filter(shouldShowConversation);
chatState.activePeerClientId = visiblePeers[0].clientId;
chatState.activeConversationId = getConversationKey(visiblePeers[0]);
}
updateChatShellMode();
applyFloatingCallPosition();
syncCallOverlayBounds();
renderPeers();
renderActivePeer();
});
window.addEventListener('poorija:notifications-enabled', () => {
registerChatPush(true).catch((error) => console.warn('Web Push registration failed:', error));
});
}
