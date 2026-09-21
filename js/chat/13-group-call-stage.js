/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 13 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Presenting, pinning and reacting
*/

/* =====================================================================
   Presenting, pinning and reacting
   ---------------------------------------------------------------------
   Three things a mesh call needs once more than two people are in it:
   somewhere to put a shared screen, a way to say "look at this person",
   and a way to react without talking over whoever is talking.

   Presenting is the same operation three times over — swap the outgoing
   video track on every leg — so screen capture, a presented picture and
   going back to the camera all funnel through one function. That also
   means presenting works without renegotiating anything, which PeerJS
   would not survive.
   ===================================================================== */
const CALL_REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '😮', '🙏', '🔥'];

/* getDisplayMedia simply does not exist in mobile Safari or Chrome for
   Android: capturing the OS screen needs a system-level broadcast permission
   that no browser exposes to a web page. Feature-detect rather than sniff the
   user agent, so a desktop browser that lacks it is treated the same way. */
function screenCaptureSupported() {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

async function replaceOutgoingVideoTrack(calls, track) {
  await Promise.all(calls.map(async (call) => {
    const sender = call?.peerConnection?.getSenders?.().find((item) => item.track?.kind === 'video');
    if (!sender) return;
    try {
      await sender.replaceTrack(track);
    } catch (error) {
      console.warn('[Present] could not replace the outgoing track', error);
    }
  }));
}

/* Swap what the local stream carries too, so your own tile shows what the
   others are being sent rather than a camera you are not pointing at anything. */
function swapLocalStreamVideo(stream, track) {
  if (!stream) return;
  stream.getVideoTracks().forEach((existing) => {
    if (existing !== track) stream.removeTrack(existing);
  });
  if (track && !stream.getVideoTracks().includes(track)) stream.addTrack(track);
}

/* A still picture is a legitimate video source: paint it into a canvas and
   captureStream turns it into a track that travels the path a camera would.
   This is the only kind of "share my screen" a phone browser can actually do,
   and it is what the present sheet offers there. */
async function pictureTrackFromFile(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(2, Math.round(bitmap.width * scale));
  canvas.height = Math.max(2, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  const paint = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  };
  paint();
  const stream = canvas.captureStream(2);
  /* captureStream only emits when the canvas changes, and an encoder with no
     frames looks like a frozen call. Repainting the same pixels is enough. */
  const timer = window.setInterval(paint, 500);
  return {
    track: stream.getVideoTracks()[0],
    stop: () => {
      window.clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      bitmap.close?.();
    },
  };
}

function groupCallLegs() {
  return [...(chatState.groupCall?.participants?.values() || [])].map((entry) => entry.call).filter(Boolean);
}

async function startGroupPresentation(source) {
  if (!groupCallActive()) return;
  if (chatState.groupCall.mode !== 'video') {
    notify(t('پرزنت فقط در تماس تصویری ممکن است.', 'Presenting needs a video call.'), 'warning');
    return;
  }
  let track = null;
  let stop = null;
  try {
    if (source === 'screen') {
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
  await stopGroupPresentation({ silent: true, keepCamera: true });
  const camera = chatState.groupCall.localStream?.getVideoTracks?.()[0] || null;
  if (camera) chatState.groupCall.cameraTrack = camera;
  chatState.groupCall.presenting = source;
  chatState.groupCall.presentStop = stop;
  track.addEventListener('ended', () => { stopGroupPresentation().catch(() => {}); });
  await replaceOutgoingVideoTrack(groupCallLegs(), track);
  swapLocalStreamVideo(chatState.groupCall.localStream, track);
  broadcastGroupCallState();
  chatState.groupCall.pinnedKey = 'self';
  renderGroupCallStage();
  notify(source === 'screen'
    ? t('صفحهٔ شما در حال پخش است.', 'Your screen is being shared.')
    : t('تصویر شما در حال پخش است.', 'Your picture is being shared.'), 'success');
}

async function stopGroupPresentation({ silent = false, keepCamera = false } = {}) {
  if (!groupCallActive() || !chatState.groupCall.presenting) return;
  try { chatState.groupCall.presentStop?.(); } catch (_error) { /* already gone */ }
  chatState.groupCall.presentStop = null;
  chatState.groupCall.presenting = '';
  const camera = chatState.groupCall.cameraTrack;
  if (!keepCamera) {
    await replaceOutgoingVideoTrack(groupCallLegs(), camera || null);
    swapLocalStreamVideo(chatState.groupCall.localStream, camera || null);
    if (chatState.groupCall.pinnedKey === 'self') chatState.groupCall.pinnedKey = '';
  }
  if (!silent) {
    broadcastGroupCallState();
    renderGroupCallStage();
  }
}

function toggleGroupCallPin(key) {
  if (!groupCallActive()) return;
  chatState.groupCall.pinnedKey = chatState.groupCall.pinnedKey === key ? '' : key;
  renderGroupCallStage();
}

/* Mute and camera state used to be local-only, so everyone else's tile was
   permanently unmuted and camera-on no matter what they did. */
function broadcastGroupCallState() {
  if (!groupCallActive()) return;
  const audience = groupCallAudience();
  if (!audience) return;
  signalGroupCall(audience, {
    type: 'gcall-state',
    callId: chatState.groupCall.callId,
    muted: chatState.groupCall.muted,
    videoOff: chatState.groupCall.videoOff,
    presenting: Boolean(chatState.groupCall.presenting),
    hand: Boolean(chatState.groupCall.handRaised),
    fromFingerprint: myCallIdentity(),
  });
}

/* One sheet for both call screens. Screen capture is offered only where it
   exists; the picture option is always there, because on a phone it is the
   only kind of presenting the platform allows at all. */
function renderPresentSheet(id, active) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  const canScreen = screenCaptureSupported();
  sheet.innerHTML = `
    <button type="button" data-present-source="screen" ${canScreen ? '' : 'disabled'}>
      <i class="fas fa-desktop"></i>
      <span>${app().escapeHTML(t('اشتراک صفحه', 'Share screen'))}</span>
      ${canScreen ? '' : `<small>${app().escapeHTML(t('مرورگر موبایل اجازهٔ ضبط صفحه نمی‌دهد', 'Mobile browsers cannot capture the screen'))}</small>`}
    </button>
    <button type="button" data-present-source="picture">
      <i class="fas fa-image"></i>
      <span>${app().escapeHTML(t('پخش یک تصویر', 'Present a picture'))}</span>
      <small>${app().escapeHTML(t('روی موبایل هم کار می‌کند', 'Works on phones too'))}</small>
    </button>
    ${active ? `<button type="button" data-present-source="stop" class="is-danger">
      <i class="fas fa-circle-stop"></i>
      <span>${app().escapeHTML(t('توقف پرزنت', 'Stop presenting'))}</span>
    </button>` : ''}`;
}

function pickImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0] || null;
      resolve(file);
    }, { once: true });
    input.click();
  });
}

/* ---------------- reactions ------------------------------------------ */
/* A reaction is a hint, not a message: it is not stored, not delivered
   offline and not retried. It floats up the screen of whoever is watching and
   then it is gone, which is exactly what makes it usable mid-sentence. */
function floatCallReaction(container, emoji, who) {
  if (!container || !emoji) return;
  let layer = container.querySelector('.chat-call-reaction-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'chat-call-reaction-layer';
    container.appendChild(layer);
  }
  const bubble = document.createElement('div');
  bubble.className = 'chat-call-reaction';
  bubble.style.setProperty('--drift', `${Math.round((Math.random() * 60) - 30)}px`);
  bubble.style.setProperty('--delay', `${Math.round(Math.random() * 120)}ms`);
  bubble.innerHTML = `<b>${app().escapeHTML(emoji)}</b>${who ? `<i>${app().escapeHTML(who)}</i>` : ''}`;
  layer.appendChild(bubble);
  /* Three seconds on screen, which is the point: the old 2.4s float spent most
     of its life fading and travelling, so a reaction was easy to miss entirely.
     Must stay in step with the callReactFloat keyframes. */
  window.setTimeout(() => bubble.remove(), CALL_REACTION_MS + 200);
}

function callReactionSurface() {
  if (groupCallActive()) return document.getElementById('chatGroupCall');
  return document.getElementById('chatFloatingCall');
}

function sendCallReaction(emoji) {
  if (!CALL_REACTIONS.includes(emoji)) return;
  const me = chatState.profile.name || t('شما', 'You');
  floatCallReaction(callReactionSurface(), emoji, me);
  if (groupCallActive()) {
    const audience = groupCallAudience();
    if (audience) {
      signalGroupCall(audience, {
        type: 'gcall-react',
        callId: chatState.groupCall.callId,
        emoji,
        fromName: me,
        fromFingerprint: myCallIdentity(),
      });
    }
    return;
  }
  const peer = activeCallPeerRecord();
  if (peer) relaySessionEvent(peer, { type: 'call-reaction', emoji, fromName: me });
}

function toggleCallReactionBar(id, force) {
  const bar = document.getElementById(id);
  if (!bar) return;
  const next = typeof force === 'boolean' ? force : bar.classList.contains('hidden');
  bar.classList.toggle('hidden', !next);
  if (next && !bar.dataset.filled) {
    bar.dataset.filled = '1';
    bar.innerHTML = CALL_REACTIONS
      .map((emoji) => `<button type="button" data-call-reaction="${app().escapeHTML(emoji)}">${emoji}</button>`)
      .join('');
  }
}

let groupCallTicker = 0;
function startGroupCallTicker() {
  stopGroupCallTicker();
  startCallQualityMonitor();
  groupCallTicker = window.setInterval(() => {
    const label = document.getElementById('chatGroupCallDuration');
    if (!label || !groupCallActive()) return;
    label.textContent = formatDuration(Date.now() - chatState.groupCall.startedAt);
  }, 1000);
}
function stopGroupCallTicker() {
  if (groupCallTicker) stopCallQualityMonitor();
  if (groupCallTicker) window.clearInterval(groupCallTicker);
  groupCallTicker = 0;
}

/* ---------------- the grid ------------------------------------------ */
function openGroupCallStage() {
  document.getElementById('chatGroupCall')?.classList.remove('hidden');
  document.documentElement.classList.add('chat-group-call-active');
}
function closeGroupCallStage() {
  document.getElementById('chatGroupCall')?.classList.add('hidden');
  document.documentElement.classList.remove('chat-group-call-active');
}

function groupCallColumns(width, count) {
  if (count <= 1) return 1;
  /* A phone in portrait can only carry one big tile or two small ones; past
     that the tiles stop being faces and start being thumbnails. */
  if (width < 560) return count <= 2 ? 1 : 2;
  if (width < 900) return count <= 4 ? 2 : 3;
  if (count <= 2) return 2;
  return count <= 6 ? 3 : 4;
}
