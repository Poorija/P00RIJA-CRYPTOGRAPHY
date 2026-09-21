/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 15 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   The stage is patched, never rebuilt
*/

/* =====================================================================
   The stage is patched, never rebuilt
   ---------------------------------------------------------------------
   This used to write stage.innerHTML on every state change, which throws
   away every <video> element and builds new ones. That is survivable
   once; it is not survivable thirteen times a call. Raising a hand now
   re-renders on *every* participant's device, and on iOS the recreated
   element never got its decoder back — the picture simply went. Android
   kept the far side alive but froze the local preview.

   So: create a tile once, then patch it. srcObject is assigned only when
   the stream object actually changes, which for a given participant is
   once for the whole call.
   ===================================================================== */
function groupCallRows() {
  return [
    {
      key: 'self',
      name: chatState.profile.name || t('شما', 'You'),
      suffix: t('شما', 'you'),
      stream: chatState.groupCall.localStream,
      muted: chatState.groupCall.muted,
      videoOff: chatState.groupCall.videoOff,
      presenting: Boolean(chatState.groupCall.presenting),
      handRaised: Boolean(chatState.groupCall.handRaised),
      isSelf: true,
      connected: true,
    },
    ...[...chatState.groupCall.participants.values()].map((entry) => ({
      key: entry.key,
      name: entry.name,
      suffix: '',
      stream: entry.stream,
      muted: entry.muted,
      videoOff: entry.videoOff,
      presenting: Boolean(entry.presenting),
      handRaised: Boolean(entry.handRaised),
      isSelf: false,
      connected: Boolean(entry.stream),
    })),
  ];
}

function buildGroupCallTile(row) {
  const tile = document.createElement('figure');
  tile.className = 'chat-gcall-tile';
  tile.setAttribute('data-gcall-key', row.key);
  tile.innerHTML = `
    <div class="chat-gcall-frame" data-fit="cover">
      <video data-gcall-video="${app().escapeHTML(row.key)}" autoplay playsinline ${row.isSelf ? 'muted' : ''}></video>
      <div class="chat-gcall-avatar"></div>
      <button type="button" class="chat-gcall-pin" data-gcall-pin="${app().escapeHTML(row.key)}"><i class="fas fa-thumbtack"></i></button>
      <div class="chat-gcall-waiting hidden">${app().escapeHTML(t('در حال اتصال…', 'Connecting…'))}</div>
    </div>
    <figcaption class="chat-gcall-caption"></figcaption>`;
  return tile;
}

function patchGroupCallTile(tile, row, pinned) {
  const isPinned = row.key === pinned;
  tile.classList.toggle('is-waiting', !row.connected);
  tile.classList.toggle('is-pinned', isPinned);
  tile.classList.toggle('is-presenting', row.presenting);
  const frame = tile.querySelector('.chat-gcall-frame');
  const aspect = isPinned ? '16 / 9' : (chatState.groupCall.aspects[row.key] || '4 / 3');
  if (frame) {
    frame.style.setProperty('--tile-aspect', aspect);
    frame.setAttribute('data-fit', row.presenting ? 'contain' : 'cover');
  }
  const avatar = tile.querySelector('.chat-gcall-avatar');
  const initialsText = initials(row.name);
  if (avatar && avatar.textContent !== initialsText) avatar.textContent = initialsText;
  const pin = tile.querySelector('.chat-gcall-pin');
  if (pin) {
    pin.classList.toggle('is-on', isPinned);
    pin.title = isPinned ? t('برداشتن پین', 'Unpin') : t('پین کردن', 'Pin');
  }
  tile.querySelector('.chat-gcall-waiting')?.classList.toggle('hidden', row.connected);
  const caption = tile.querySelector('.chat-gcall-caption');
  const label = row.suffix ? `${row.name} (${row.suffix})` : row.name;
  const captionHtml = `${row.muted ? '<i class="fas fa-microphone-slash is-muted"></i>' : ''}<span>${app().escapeHTML(label)}</span>${row.presenting ? `<i class="fas fa-display is-presenting" title="${app().escapeHTML(t('در حال پرزنت', 'Presenting'))}"></i>` : ''}${row.handRaised ? `<i class="fas fa-hand is-hand" title="${app().escapeHTML(t('دست بالا', 'Hand raised'))}"></i>` : ''}`;
  /* Only touch the caption when it would actually change: rewriting it every
     tick is what makes a raised hand flicker for everyone in the room. */
  if (caption && caption.innerHTML !== captionHtml) caption.innerHTML = captionHtml;

  const video = tile.querySelector('video');
  if (!video) return;
  if (row.stream) {
    /* The one line that must not run twice. */
    if (video.srcObject !== row.stream) {
      video.srcObject = row.stream;
      const noteAspect = () => {
        if (!video.videoWidth || !video.videoHeight) return;
        const value = `${video.videoWidth} / ${video.videoHeight}`;
        chatState.groupCall.aspects[row.key] = value;
        if (row.key !== chatState.groupCall.pinnedKey) {
          video.closest('.chat-gcall-frame')?.style.setProperty('--tile-aspect', value);
        }
      };
      video.onloadedmetadata = noteAspect;
      video.onresize = noteAspect;
      video.play?.().catch(() => { /* autoplay policy; the tile still shows the avatar */ });
    }
    const hasVideo = row.stream.getVideoTracks?.().some((track) => track.readyState === 'live' && track.enabled);
    video.classList.toggle('is-hidden', !hasVideo || row.videoOff);
  } else if (video.srcObject) {
    video.srcObject = null;
    video.classList.add('is-hidden');
  }
}

function renderGroupCallStage() {
  const stage = document.getElementById('chatGroupCallGrid');
  if (!stage || !groupCallActive()) return;
  const space = chatState.spaces.groups.find((item) => item.conversationId === chatState.groupCall.spaceId);
  const title = document.getElementById('chatGroupCallTitle');
  /* A call put together by hand has no group to take a name from, so it keeps
     the one it was given when it started - the people in it. */
  if (title) title.textContent = space?.name || chatState.groupCall.title || t('تماس گروهی', 'Group call');
  chatState.groupCall.aspects = chatState.groupCall.aspects || {};
  const rows = groupCallRows();
  const pinned = chatState.groupCall.pinnedKey && rows.some((row) => row.key === chatState.groupCall.pinnedKey)
    ? chatState.groupCall.pinnedKey
    : '';
  chatState.groupCall.pinnedKey = pinned;
  syncGroupCallColumns();
  watchGroupCallSize();
  const count = document.getElementById('chatGroupCallCount');
  if (count) {
    count.textContent = t(`${rows.length} نفر`, `${rows.length} ${rows.length === 1 ? 'person' : 'people'}`);
  }

  /* Tiles are children of the grid itself now. With a pin, the unpinned ones
     move into a rail so they can share one strip; without one, everybody is a
     cell in the grid. Either way a tile is moved, never rebuilt - appendChild
     on an element already in the tree relocates it, and a relocated <video>
     keeps playing, which is the whole reason this is patched rather than
     re-rendered. */
  let rail = stage.querySelector('.chat-gcall-rail');
  if (pinned && rows.length > 1) {
    if (!rail) {
      rail = document.createElement('div');
      rail.className = 'chat-gcall-rail';
      stage.appendChild(rail);
    }
  } else if (rail) {
    /* Coming out of pinned mode: hand the tiles back before the rail goes, or
       they are destroyed along with it and every stream is reattached. */
    [...rail.children].forEach((tile) => stage.appendChild(tile));
    rail.remove();
    rail = null;
  }
  const ordered = pinned ? [...rows].sort((a, b) => (a.key === pinned ? -1 : b.key === pinned ? 1 : 0)) : rows;
  const wanted = new Set(ordered.map((row) => row.key));
  stage.querySelectorAll('.chat-gcall-tile').forEach((tile) => {
    if (!wanted.has(tile.getAttribute('data-gcall-key'))) tile.remove();
  });
  ordered.forEach((row) => {
    let tile = stage.querySelector(`.chat-gcall-tile[data-gcall-key="${CSS.escape(row.key)}"]`);
    if (!tile) tile = buildGroupCallTile(row);
    patchGroupCallTile(tile, row, pinned);
    const home = (rail && row.key !== pinned) ? rail : stage;
    if (tile.parentElement !== home) home.appendChild(tile);
  });
  /* Order within each home, so the pinned tile is first in the grid and the
     rail keeps a stable sequence rather than reshuffling on every patch. */
  ordered.forEach((row) => {
    const tile = stage.querySelector(`.chat-gcall-tile[data-gcall-key="${CSS.escape(row.key)}"]`);
    if (tile) tile.parentElement?.appendChild(tile);
  });
  if (rail) stage.appendChild(rail);
  /* The counts depend on whether a pin is set, so they are worked out after
     the pin has been resolved rather than before. */
  syncGroupCallColumns();

  const muteBtn = document.getElementById('chatGroupCallMuteBtn');
  muteBtn?.classList.toggle('is-active', chatState.groupCall.muted);
  const videoBtn = document.getElementById('chatGroupCallVideoBtn');
  videoBtn?.classList.toggle('is-active', chatState.groupCall.videoOff);
  videoBtn?.classList.toggle('hidden', chatState.groupCall.mode !== 'video');
  const handBtn = document.getElementById('chatGroupCallHandBtn');
  handBtn?.classList.toggle('is-active', Boolean(chatState.groupCall.handRaised));
  const presentBtn = document.getElementById('chatGroupCallPresentBtn');
  presentBtn?.classList.toggle('is-active', Boolean(chatState.groupCall.presenting));
  presentBtn?.classList.toggle('hidden', chatState.groupCall.mode !== 'video');
  const layoutBtn = document.getElementById('chatGroupCallLayoutBtn');
  layoutBtn?.classList.toggle('is-active', groupCallLayoutChoice() !== 'auto');
}

/* ---------------- incoming invite ------------------------------------ */
function showGroupCallInvite(message) {
  const box = document.getElementById('chatGroupCallInvite');
  if (!box) return;
  box.dataset.callId = message.callId;
  box.dataset.spaceId = message.spaceId;
  box.dataset.mode = message.mode || 'voice';
  /* Carried on the invitation so a call that belongs to no group can still be
     joined: without it the accept button has nothing to look up, and the
     newcomer would announce themselves to nobody. */
  box.dataset.roster = JSON.stringify(Array.isArray(message.roster) ? message.roster : []);
  const space = chatState.spaces.groups.find((item) => item.conversationId === message.spaceId);
  const heading = space?.name
    || message.title
    || (String(message.spaceId || '').startsWith('adhoc-') ? t('تماس گروهی', 'Group call') : t('گروه', 'Group'));
  box.innerHTML = `
    <div class="chat-gcall-invite-card">
      <div class="chat-gcall-invite-icon"><i class="fas ${message.mode === 'video' ? 'fa-video' : 'fa-users'}"></i></div>
      <div class="chat-gcall-invite-body">
        <strong>${app().escapeHTML(heading)}</strong>
        <span>${app().escapeHTML(t(`${message.fromName || 'یک عضو'} تماس گروهی شروع کرد`, `${message.fromName || 'Someone'} started a group call`))}</span>
      </div>
      <button type="button" data-gcall-decline class="chat-gcall-invite-btn is-decline"><i class="fas fa-xmark"></i></button>
      <button type="button" data-gcall-accept class="chat-gcall-invite-btn is-accept"><i class="fas fa-phone"></i></button>
    </div>`;
  box.classList.remove('hidden');
  playSound('ringing');
  /* A group invitation rang until somebody touched it. It gives up on the
     same clock a one-to-one call does, and leaves a missed call behind so
     there is a record of having been asked. */
  if (chatState.groupRingTimer) clearTimeout(chatState.groupRingTimer);
  chatState.groupRingTimer = setTimeout(() => {
    chatState.groupRingTimer = null;
    if (groupCallActive()) return;
    const stillRinging = !document.getElementById('chatGroupCallInvite')?.classList.contains('hidden');
    if (!stillRinging) return;
    hideGroupCallInvite();
    appendCall({
      name: message.fromName || t('تماس گروهی', 'Group call'),
      peerId: message.fromFingerprint || '',
      mode: message.mode === 'video' ? 'video' : 'voice',
      status: 'missed',
      direction: 'in',
      scope: 'group',
    });
    notify(t('تماس گروهی بی‌پاسخ ماند.', 'A group call went unanswered.'), 'info');
  }, CALL_RING_TIMEOUT_MS);
}
function hideGroupCallInvite() {
  stopSound('ringing');
  if (chatState.groupRingTimer) {
    clearTimeout(chatState.groupRingTimer);
    chatState.groupRingTimer = null;
  }
  const box = document.getElementById('chatGroupCallInvite');
  box?.classList.add('hidden');
  if (box) box.innerHTML = '';
}
