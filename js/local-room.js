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
   local-room.js — the room's face.
   ============================================================================

   local-mesh.js owns the connections, the keys and the message types. This is
   the part a person sees: it opens itself the moment a link forms, because by
   then the pairing controls have done their job and somebody who has just
   connected wants the conversation, not the machinery that got them there.

   Everything here is rendered from mesh events rather than from its own copy
   of the state. A view that keeps its own list is a view that can disagree
   with the room, and in a mesh the room is the only thing that can be right.
   ============================================================================ */

(function (global) {
  'use strict';

  const app = () => global.PoorijaApp;
  const mesh = () => global.PoorijaLocalMesh;
  const t = (fa, en) => (app()?.state?.language === 'fa' ? fa : en);
  const notify = (fa, en, kind = 'info') => app()?.showNotification?.(t(fa, en), kind);
  const el = (id) => document.getElementById(id);
  /* Everything drawn in this room was written by another device on the
     network, so the escape has to work whether or not the main app module has
     loaded yet. Delegating to it with a plain String() fallback — which is what
     this did — meant that on any load order where PoorijaApp was not ready, a
     member's name or message went into innerHTML raw. The fallback is now a
     real escape, so the worst case is duplicated work rather than injection. */
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => app()?.escapeHTML?.(String(value ?? ''))
    ?? String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const bytes = (n) => app()?.formatBytes?.(n) ?? `${n} B`;
  const burnLabel = (seconds) => (seconds >= 3600
    ? t(`${Math.round(seconds / 3600)} ساعت`, `${Math.round(seconds / 3600)}h`)
    : seconds >= 60
      ? t(`${Math.round(seconds / 60)} دقیقه`, `${Math.round(seconds / 60)}m`)
      : t(`${seconds} ثانیه`, `${seconds}s`));

  /* What the composer will attach to the next line of text. */
  const compose = { hidden: false, burn: 0 };
  /* Whether a call was running last time anything changed, so the screen is
     opened once when one starts rather than on every update. */
  let wasInCall = false;
  let recorder = null;
  let recordedAt = 0;
  let recordTimer = null;

  /* A small built-in set, so a room has stickers on a device that never
     imported a pack. A pack the user has loaded is offered first. */
  const FALLBACK_STICKERS = ['😀', '😂', '🥲', '😍', '🤔', '👍', '🙏', '🎉', '🔥', '💯', '❤️', '😴'];

  let bound = false;

  /* ---- opening and closing ----------------------------------------------- */

  /* Where the room lives when it is not open, so it can be put back. */
  let roomHome = null;

  function showRoom(show) {
    const room = el('linkRoom');
    if (!room) return;

    /* A conversation is not part of a tab.
     *
     * The room was markup inside #content-locallink, and a tab pane is
     * display:none when another tab is open — which no amount of
     * `position: fixed` escapes, because a fixed element inside a hidden
     * ancestor is not laid out at all. So the room measured zero by zero, the
     * full-screen styles did nothing on a phone, and switching tabs mid-call
     * took the whole conversation off the screen.
     *
     * Open, it belongs to the body: a real top-level layer, covering the
     * viewport, surviving whatever the tabs behind it are doing. Closed, it
     * goes home, so nothing about the page's structure is quietly rewritten
     * for the rest of the session. */
    if (show) {
      if (!roomHome && room.parentElement !== document.body) {
        roomHome = { parent: room.parentElement, next: room.nextSibling };
        document.body.appendChild(room);
      }
    } else if (roomHome) {
      roomHome.parent.insertBefore(room, roomHome.next);
      roomHome = null;
    }

    room.classList.toggle('hidden', !show);
    document.body.classList.toggle('link-room-open', show);
    /* The pairing card stays in the DOM but steps aside; "invite" brings it
       back, which is the only reason anyone needs it once connected. */
    const pairing = el('linkQrStage')?.closest('.glass');
    pairing?.classList.toggle('is-behind-room', show);
    reflectRoomExists();
  }

  /* What the pairing tab looks like while a room exists.
   *
   * Two things were wrong here. Its own composer stayed on screen, sending into
   * a channel the room had taken over — a second message box that looked live
   * and belonged to nothing. And once the room was put away there was no way
   * back into it at all. */
  function reflectRoomExists() {
    const active = Boolean(mesh()?.room.active && mesh().room.members.size);
    el('linkComposerRow')?.classList.toggle('hidden', active);
    el('linkMessages')?.classList.toggle('hidden', active);
    const back = el('linkReturnBtn');
    if (back) {
      const roomOpen = !el('linkRoom')?.classList.contains('hidden');
      back.classList.toggle('hidden', !active || roomOpen);
    }
  }

  const FACES = ['🙂', '😎', '🦊', '🐼', '🦉', '🐙', '🌵', '🍉', '⚡', '🌙', '🎧', '🚀'];
  const ROOM_FACES = ['🏠', '🛋️', '☕', '🎲', '📻', '🌳', '🏔️', '🔦', '🧭', '📌', '🎪', '🛰️'];

  function renderMembers() {
    const box = el('linkRoomMembers');
    const state = mesh()?.snapshot();
    if (!box || !state) return;
    const count = el('linkRoomCount');
    if (count) {
      count.textContent = t(`${state.count} از ${state.capacity}`, `${state.count} of ${state.capacity}`);
      count.classList.toggle('is-full', state.full);
    }
    const name = el('linkRoomName');
    if (name) name.textContent = state.name || t('اتاق محلی', 'Local room');
    const face = el('linkRoomAvatarFace');
    if (face) face.textContent = state.face || '🏠';
    if (!el('linkPeoplePanel')?.classList.contains('hidden')) renderPeople();
    const rows = [{ id: state.me.id, name: state.me.name, state: 'me' }].concat(state.members);
    box.innerHTML = rows.map((m) => {
      const label = m.state === 'me' ? t('شما', 'you')
        : m.state === 'open' ? t('متصل', 'connected')
          : t('در حال اتصال…', 'connecting…');
      return `<span class="link-member is-${esc(m.state)}">
        <i class="fas fa-circle"></i>${esc(m.name || m.id.slice(0, 6))}
        <small>${esc(label)}</small>${m.video ? '<i class="fas fa-video"></i>' : ''}</span>`;
    }).join('');
  }

  /* Who is here, with the host's controls beside them. */
  function renderPeople() {
    const list = el('linkPeopleList');
    const state = mesh()?.snapshot();
    if (!list || !state) return;
    const rows = [{ id: state.me.id, name: state.me.name, face: state.me.face, state: 'me' }]
      .concat(state.members);
    list.innerHTML = rows.map((m) => {
      const label = m.state === 'me' ? t('شما', 'you')
        : m.state === 'open' ? t('متصل', 'connected')
          : t('در حال اتصال…', 'connecting…');
      /* Only the host can remove anybody, and nobody can remove themselves —
         leaving is a different button with a different meaning. */
      const remove = state.host && m.state !== 'me'
        ? `<button type="button" class="link-people-remove" data-remove-member="${esc(m.id)}"
            title="${esc(t('خارج کردن', 'Remove'))}"><i class="fas fa-user-minus"></i></button>`
        : '';
      return `<div class="link-people-row">
        <span class="link-people-face">${esc(m.face || '🙂')}</span>
        <span class="link-people-name">${esc(m.name || m.id.slice(0, 6))}</span>
        <small class="link-people-state">${esc(label)}</small>${remove}</div>`;
    }).join('');
    el('linkDissolveBtn')?.classList.toggle('hidden', !state.host);
  }

  /* A name and a face for this person, and — for the host — for the room. */
  function renderIdentitySheet() {
    const kit = mesh();
    if (!kit) return;
    const identity = kit.readIdentity();
    const state = kit.snapshot();
    const mine = el('linkMyName');
    if (mine) mine.value = identity.name || state.me.name || '';
    const roomName = el('linkRoomNameInput');
    if (roomName) roomName.value = identity.roomName || state.name || '';
    el('linkRoomIdentityFields')?.classList.toggle('hidden', !state.host);
    const faces = (host, chosen) => (host ? ROOM_FACES : FACES).map((face) => `
      <button type="button" class="link-face${face === chosen ? ' is-on' : ''}"
        data-face="${esc(face)}">${esc(face)}</button>`).join('');
    const mineRow = el('linkMyFaceRow');
    if (mineRow) mineRow.innerHTML = faces(false, identity.face || state.me.face);
    const roomRow = el('linkRoomFaceRow');
    if (roomRow) roomRow.innerHTML = faces(true, identity.roomFace || state.face);
  }

  /* ---- the transcript ----------------------------------------------------- */

  function renderMessages() {
    const box = el('linkRoomMessages');
    const state = mesh();
    if (!box || !state) return;
    box.innerHTML = state.room.messages.map((m) => bubble(m, state)).join('');
    box.scrollTop = box.scrollHeight;
  }

  function bubble(m, state) {
    const side = m.direction === 'out' ? 'is-out' : 'is-in';
    const who = m.direction === 'out' ? '' : `<span class="link-who">${esc(m.fromName || '')}</span>`;
    let body = '';

    if (m.kind === 'text') {
      /* Hidden is a courtesy, not a secret: the words are on the other device
         either way, and covering them until a tap only stops a passer-by
         reading over a shoulder. Saying that plainly is better than a blur that
         implies more than it does. */
      body = m.hidden
        ? `<span class="link-hidden" data-reveal="${esc(m.id)}" role="button" tabindex="0">${esc(m.text)}</span>`
        : esc(m.text);
      if (m.burn) {
        body += `<span class="link-burn"><i class="fas fa-stopwatch"></i>${esc(burnLabel(m.burn))}</span>`;
      }
    } else if (m.kind === 'rich' && m.rich?.kind === 'location') {
      /* OpenStreetMap rather than a map tile fetched into the page: a room
         exists so that nothing leaves the local network, and quietly loading a
         map image would tell somebody's server exactly where this person is. */
      const lat = Number(m.rich.lat);
      const lng = Number(m.rich.lng);
      const link = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
      body = `<div class="link-location">
        <i class="fas fa-location-dot link-location-pin"></i>
        <span class="link-location-coords">${esc(`${lat}, ${lng}`)}</span>
        <span class="link-location-accuracy">${esc(t(`دقت حدود ${m.rich.accuracy} متر`, `about ${m.rich.accuracy} m`))}</span>
        <a class="link-location-btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">
          ${esc(t('روی نقشه', 'On the map'))}</a></div>`;
    } else if (m.kind === 'rich' && m.rich?.kind === 'contact') {
      body = `<div class="link-contact">
        <i class="fas fa-address-card"></i>
        <strong>${esc(m.rich.name)}</strong>
        ${m.rich.fingerprint ? `<code>${esc(String(m.rich.fingerprint).slice(0, 16))}…</code>` : ''}</div>`;
    } else if (m.kind === 'sticker') {
      /* A sticker URL arrives from another member, so it is not ours to trust.
         The CSP already refuses anything but self/data/blob, but a remote http
         URL would still be an attempt to learn this device's address from
         inside a room that exists precisely so nothing leaves the network.
         Refusing it here says no before the request is made. */
      const safeUrl = /^(blob:|data:image\/)/.test(String(m.url || '')) ? m.url : '';
      body = safeUrl
        ? `<img class="link-sticker" src="${esc(safeUrl)}" alt="${esc(m.emoji || '')}">`
        : `<span class="link-sticker-emoji">${esc(m.emoji || '🙂')}</span>`;
    } else if (m.kind === 'file') {
      body = m.url
        ? `<a class="link-file" href="${esc(m.url)}" download="${esc(m.name)}"><i class="fas fa-file-arrow-down"></i> ${esc(m.name)} <span class="link-size">${esc(bytes(m.size))}</span></a>`
        : `<span class="link-file"><i class="fas fa-file-arrow-up"></i> ${esc(m.name)} <span class="link-size">${esc(bytes(m.size))}</span></span>`;
    } else if (m.kind === 'rich' && m.rich?.kind === 'poll') {
      body = poll(m, state);
    } else if (m.kind === 'rich') {
      body = esc(JSON.stringify(m.rich));
    }

    /* A voice note is a file with a player instead of a download link — the
       transfer underneath is the same one every other file uses. */
    if (m.kind === 'file' && m.url && /^audio\//.test(String(m.mime || ''))) {
      body = `<audio class="link-voice" controls preload="metadata" src="${esc(m.url)}"></audio>`;
    }

    const reactions = Object.entries(m.reactions || {})
      .map(([emoji, who2]) => `<button type="button" class="link-reaction" data-react="${esc(m.id)}" data-emoji="${esc(emoji)}">${esc(emoji)} ${who2.size || 1}</button>`)
      .join('');

    return `<div class="link-bubble ${side}">${who}${body}
      <div class="link-bubble-foot">${reactions}
        <button type="button" class="link-react-add" data-react="${esc(m.id)}" data-emoji="👍">+👍</button>
      </div></div>`;
  }

  function poll(m, state) {
    const record = state.room.polls.get(m.id);
    const options = m.rich.options || [];
    const votes = record?.votes || {};
    const tally = options.map((_, i) => Object.values(votes).filter((v) => v === i).length);
    const total = tally.reduce((a, b) => a + b, 0) || 0;
    const mine = votes[state.room.me.id];
    return `<div class="link-poll">
      <strong>${esc(m.rich.question)}</strong>
      ${options.map((option, i) => {
        const share = total ? Math.round((tally[i] / total) * 100) : 0;
        return `<button type="button" class="link-poll-option${mine === i ? ' is-mine' : ''}"
            data-vote="${esc(m.id)}" data-option="${i}">
            <span class="link-poll-bar" style="width:${share}%"></span>
            <span class="link-poll-label">${esc(option)}</span>
            <span class="link-poll-count">${tally[i]}</span></button>`;
      }).join('')}
      <small>${esc(t(`${total} رأی`, `${total} vote${total === 1 ? '' : 's'}`))}</small>
    </div>`;
  }

  /* ---- calls -------------------------------------------------------------- */

  /* The call screen, drawn from the room's state every time.
   *
   * The old version attached an incoming stream only if a tile for that person
   * already existed — and the `stream` event beats the `call` event as often as
   * it loses to it, so whenever it arrived first the stream was dropped and
   * nothing ever tried again. That is the black rectangle with a name under it:
   * a tile with no picture, permanently.
   *
   * So nothing is attached on an event any more. Tiles are built from the
   * roster and every tile is given whatever stream that member currently has,
   * every time anything changes. Arriving early becomes indistinguishable from
   * arriving late, which is the only way to make a race stop mattering.
   */
  const GRID_MAX = 4;

  function tileFor(container, id, name, muted) {
    let tile = container.querySelector('[data-tile="' + id + '"]');
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'link-call-tile';
      tile.dataset.tile = id;
      /* Built only when missing: replacing a <video> drops its stream, and the
         picture flickers black on every roster change. */
      tile.innerHTML = '<video autoplay playsinline></video><span class="link-tile-name"></span>';
      container.appendChild(tile);
    }
    tile.querySelector('.link-tile-name').textContent = name;
    const video = tile.querySelector('video');
    /* Your own camera is muted on your own screen, or you hear yourself. */
    video.muted = Boolean(muted);
    return tile;
  }

  function paintTile(tile, stream) {
    const video = tile.querySelector('video');
    if (video.srcObject !== (stream || null)) video.srcObject = stream || null;
    tile.classList.toggle('has-video',
      Boolean(stream && stream.getVideoTracks().some((track) => track.enabled)));
  }

  function renderCall() {
    const screen = el('linkCallScreen');
    const stage = el('linkCallStage');
    const strip = el('linkCallStrip');
    const kit = mesh();
    if (!screen || !stage || !strip || !kit) return;

    const call = kit.room.call;
    if (!call) {
      screen.classList.add('hidden');
      document.body.classList.remove('link-call-open');
      stage.innerHTML = '';
      strip.innerHTML = '';
      el('linkCallResumeBtn')?.classList.add('hidden');
      return;
    }

    const state = kit.snapshot();
    /* You first: on your own screen your own picture is the one you check. */
    const seats = [{ id: state.me.id, name: t('شما', 'You'), stream: call.stream, muted: true }]
      .concat(Array.from(kit.room.members.values())
        .filter((m) => m.state === 'open')
        .map((m) => ({ id: m.id, name: m.name || m.id.slice(0, 6), stream: m.stream, muted: false })));

    /* Four in the grid, anybody beyond that along the bottom. A fifth tile in a
       four-up grid makes all five too small to recognise anybody in. */
    const grid = seats.slice(0, GRID_MAX);
    const rest = seats.slice(GRID_MAX);
    stage.dataset.count = String(grid.length);
    strip.classList.toggle('hidden', rest.length === 0);

    const place = (container, list) => {
      const wanted = new Set(list.map((seat) => seat.id));
      container.querySelectorAll('[data-tile]').forEach((tile) => {
        if (!wanted.has(tile.dataset.tile)) tile.remove();
      });
      list.forEach((seat) => paintTile(tileFor(container, seat.id, seat.name, seat.muted), seat.stream));
    };
    place(stage, grid);
    place(strip, rest);

    const title = el('linkCallTitle');
    if (title) title.textContent = call.video ? t('تماس تصویری', 'Video call') : t('تماس صوتی', 'Voice call');
    const count = el('linkCallCount');
    if (count) count.textContent = t(seats.length + ' نفر', seats.length + ' people');

    /* Which of the two places the call can be looked at from. */
    const onScreen = !screen.classList.contains('hidden');
    document.body.classList.toggle('link-call-open', onScreen);
    el('linkCallResumeBtn')?.classList.toggle('hidden', onScreen);

    const mute = el('linkCallMuteBtn');
    if (mute) {
      const live = call.stream.getAudioTracks().some((track) => track.enabled);
      mute.classList.toggle('is-off', !live);
      mute.querySelector('i').className = live ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    }
    const camera = el('linkCallCameraBtn');
    if (camera) {
      const live = call.stream.getVideoTracks().some((track) => track.enabled);
      camera.classList.toggle('is-off', !live);
      camera.querySelector('i').className = live ? 'fas fa-video' : 'fas fa-video-slash';
    }
  }

  /* Starting a call from the room's own buttons.
   *
   * These called a beginCall() that no longer existed — the two buttons in the
   * room header threw a ReferenceError and did nothing at all, which is most of
   * "calls do not work". A missing function is invisible from a button. */
  async function beginCall(video) {
    const kit = mesh();
    if (!kit) return;
    const advice = kit.callAdvice(video);
    if (advice) {
      const go = await global.PoorijaDialogs?.confirm(t(advice.fa, advice.en),
        { okLabel: t('ادامه', 'Go ahead') });
      if (!go) return;
    }
    try {
      const call = await kit.startCall({ video });
      /* Straight onto the call screen: a call that starts behind the
         conversation is one nobody can see they are in. */
      if (call) showCallScreen(true);
      else notify('کسی در اتاق نیست که تماس بگیرید.', 'There is nobody here to call.', 'warning');
    } catch (error) {
      console.error('[LocalRoom] the call could not start', error);
      notify('میکروفون یا دوربین در دسترس نیست.', 'The microphone or camera is unavailable.', 'error');
    }
  }

  function showCallScreen(show) {
    const screen = el('linkCallScreen');
    if (!screen || !mesh()?.room.call) return;
    screen.classList.toggle('hidden', !show);
    renderCall();
  }

  function stickerTray() {
    const tray = el('linkStickerTray');
    if (!tray) return;
    const packs = global.chatState?.stickerPacks || [];
    /* Only the local kinds. An imported pack could carry a remote URL, and
       offering it here would put a request to somebody else's server inside a
       room that exists so that nothing leaves the network. The CSP would refuse
       to load it anyway; not offering it is the honest version. */
    const custom = packs.flatMap((pack) => (pack.items || []).slice(0, 24)
      .map((item) => ({ url: item.url || item.dataUrl || '', emoji: item.emoji || '' })))
      .filter((item) => /^(blob:|data:image\/)/.test(item.url));
    const rows = custom.length
      ? custom.map((item) => `<button type="button" data-sticker-url="${esc(item.url)}"><img src="${esc(item.url)}" alt=""></button>`)
      : FALLBACK_STICKERS.map((emoji) => `<button type="button" data-sticker-emoji="${esc(emoji)}">${esc(emoji)}</button>`);
    tray.innerHTML = rows.join('');
  }

  async function sendComposed() {
    const field = el('linkRoomComposer');
    if (!field?.value.trim()) return;
    await mesh().sendText(field.value, { hidden: compose.hidden, burn: compose.burn });
    field.value = '';
    /* Hidden is per message, the way it is in Secure Chat: it would be a nasty
       surprise to have every line after it stay covered. The timer is sticky,
       because somebody who set one usually means it for the conversation. */
    compose.hidden = false;
    renderComposeState();
  }

  /* One sheet, opened by one button, exactly as Secure Chat does it. */
  function setSheet(open) {
    const sheet = el('linkRoomActions');
    if (!sheet) return;
    sheet.classList.toggle('hidden', !open);
    el('linkRoomPlusBtn')?.setAttribute('aria-expanded', String(open));
    if (!open) el('linkTimerPopover')?.classList.add('hidden');
  }

  function renderComposeState() {
    el('linkRoomHiddenBtn')?.classList.toggle('is-on', compose.hidden);
    const badge = el('linkTimerBadge');
    if (badge) {
      badge.classList.toggle('hidden', !compose.burn);
      badge.textContent = compose.burn ? burnLabel(compose.burn) : '';
    }
    el('linkRoomTimerBtn')?.classList.toggle('is-on', Boolean(compose.burn));
    el('linkRoomComposer')?.classList.toggle('is-hidden-msg', compose.hidden);
  }

  /* ---- a voice note ------------------------------------------------------- */

  async function startRecording() {
    if (recorder) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      notify('میکروفون در دسترس نیست.', 'The microphone is unavailable.', 'error');
      return;
    }
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      /* The tracks are stopped here rather than at the button, so a recording
         that ends any other way — a tab losing the microphone, an error —
         still turns the light off. */
      stream.getTracks().forEach((track) => { try { track.stop(); } catch (e) { /* gone */ } });
      clearInterval(recordTimer);
      recordTimer = null;
      const keep = recorder?.__send;
      recorder = null;
      el('linkVoiceBar')?.classList.add('hidden');
      if (!keep || !chunks.length) return;
      const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
      await mesh().sendFile(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }));
    };
    recorder.start();
    recordedAt = Date.now();
    el('linkVoiceBar')?.classList.remove('hidden');
    setSheet(false);
    recordTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordedAt) / 1000);
      const time = el('linkVoiceTime');
      if (time) time.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }, 250);
  }

  function stopRecording(send) {
    if (!recorder) return;
    recorder.__send = send;
    try { recorder.stop(); } catch (error) { recorder = null; }
  }

  /* ---- somebody is calling ------------------------------------------------ */

  function renderRing(detail) {
    const ring = el('linkCallRing');
    if (!ring) return;
    ring.classList.toggle('hidden', !detail);
    if (!detail) return;
    const who = el('linkCallRingWho');
    if (who) {
      who.textContent = detail.video
        ? t(`${detail.name || 'کسی'} تماس تصویری گرفته است`, `${detail.name || 'Someone'} started a video call`)
        : t(`${detail.name || 'کسی'} تماس صوتی گرفته است`, `${detail.name || 'Someone'} started a voice call`);
    }
    el('linkCallJoinBtn')?.setAttribute('data-video', String(Boolean(detail.video)));
  }

  async function sendChosenFiles(files) {
    const chosen = Array.from(files || []).filter(Boolean);
    if (!chosen.length) return;
    const kit = mesh();

    /* No ceiling, but the room is told what a large send costs it — asked ONCE
       for the whole selection rather than per file, because four questions in a
       row is how people learn to dismiss the question without reading it. On a
       shared Wi-Fi one transfer is everybody's bandwidth, and a call in
       progress is what suffers first. */
    const total = chosen.reduce((sum, file) => sum + (file.size || 0), 0);
    const cost = kit.describeFileCost({ size: total, name: chosen[0].name });
    if (cost) {
      const go = await global.PoorijaDialogs?.confirm(t(cost.fa, cost.en),
        { okLabel: t('بفرست', 'Send it') });
      if (!go) return;
    }

    const progress = el('linkRoomProgress');
    const failed = [];
    for (let n = 0; n < chosen.length; n += 1) {
      const file = chosen[n];
      const label = chosen.length > 1 ? ` (${n + 1}/${chosen.length})` : '';
      try {
        /* One at a time: each transfer owns the channel, and starting several
           at once is how it gets overrun. */
        await kit.sendFile(file, {
          onProgress: ({ index, total: parts }) => {
            if (progress) {
              progress.textContent = t(`ارسال ${index} از ${parts}${label}`,
                `Sending ${index} of ${parts}${label}`);
            }
          },
        });
      } catch (error) {
        console.error('[LocalRoom] sending failed', file.name, error);
        failed.push(file.name);
      }
    }
    if (progress) progress.textContent = '';
    if (failed.length) {
      const list = failed.slice(0, 3).join('، ') + (failed.length > 3 ? '…' : '');
      notify(`ارسال نشد: ${list}`, `Could not send: ${list}`, 'error');
    }
  }

  /* Somebody is sending this device a file. Shown while it arrives and cleared
     when it does — the message itself then appears in the transcript with a
     download link, which is what the finished transfer looks like. */
  function renderIncoming(detail) {
    const line = el('linkRoomIncoming');
    if (!line || !detail) return;
    const done = detail.received >= detail.total;
    if (done) {
      line.textContent = '';
      line.classList.add('hidden');
      return;
    }
    const percent = Math.min(99, Math.round((detail.received / detail.total) * 100));
    const of = detail.size ? ` · ${bytes(Math.min(detail.bytes, detail.size))} / ${bytes(detail.size)}` : '';
    line.textContent = t(`دریافت ${detail.name} — ٪${percent}${of}`,
      `Receiving ${detail.name} — ${percent}%${of}`);
    line.classList.remove('hidden');
  }

  /* ---- wiring ------------------------------------------------------------- */

  function bind() {
    if (bound) return;
    bound = true;

    el('linkRoomSendBtn')?.addEventListener('click', sendComposed);
    el('linkRoomComposer')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendComposed(); }
    });
    /* The one button that opens everything, and the row that closes it again
       once the thing it opened is on screen. */
    el('linkRoomPlusBtn')?.addEventListener('click', () => {
      const sheet = el('linkRoomActions');
      setSheet(Boolean(sheet?.classList.contains('hidden')));
    });
    /* Back puts the room away; it does not leave it. Without something to come
       back to, pressing it stranded people in a room they were still in with no
       way to return — so the pairing card grows a button while a room exists. */
    el('linkRoomBackBtn')?.addEventListener('click', () => showRoom(false));
    el('linkReturnBtn')?.addEventListener('click', () => showRoom(true));

    el('linkRoomMembers')?.addEventListener('click', () => {
      renderPeople();
      el('linkPeoplePanel')?.classList.toggle('hidden');
    });
    el('linkPeopleCloseBtn')?.addEventListener('click',
      () => el('linkPeoplePanel')?.classList.add('hidden'));
    el('linkPeopleList')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-remove-member]');
      if (!button) return;
      const go = await global.PoorijaDialogs?.confirm(
        t('این نفر از اتاق خارج شود؟', 'Remove this person from the room?'),
        { okLabel: t('خارج کن', 'Remove') });
      if (!go) return;
      await mesh().removeMember(button.dataset.removeMember);
      renderPeople();
    });
    el('linkDissolveBtn')?.addEventListener('click', async () => {
      const go = await global.PoorijaDialogs?.confirm(
        t('اتاق برای همه بسته شود؟ همه از آن خارج می‌شوند و گفتگو باقی نمی‌ماند.',
          'Close the room for everybody? Everyone is disconnected and nothing is kept.'),
        { okLabel: t('منحل کن', 'Dissolve') });
      if (!go) return;
      await mesh().dissolveRoom();
      el('linkPeoplePanel')?.classList.add('hidden');
      showRoom(false);
    });

    el('linkRoomAvatarBtn')?.addEventListener('click', () => {
      renderIdentitySheet();
      el('linkIdentitySheet')?.classList.toggle('hidden');
    });
    el('linkIdentityCloseBtn')?.addEventListener('click',
      () => el('linkIdentitySheet')?.classList.add('hidden'));
    el('linkIdentitySheet')?.addEventListener('click', (event) => {
      const face = event.target.closest('[data-face]');
      if (!face) return;
      const row = face.closest('[data-face-target]');
      if (!row) return;
      row.querySelectorAll('[data-face]').forEach((b) => b.classList.toggle('is-on', b === face));
    });
    el('linkIdentitySaveBtn')?.addEventListener('click', () => {
      const chosen = (id) => el(id)?.querySelector('.link-face.is-on')?.dataset.face || '';
      mesh().writeIdentity({
        name: el('linkMyName')?.value || '',
        face: chosen('linkMyFaceRow'),
        roomName: el('linkRoomNameInput')?.value || '',
        roomFace: chosen('linkRoomFaceRow'),
      });
      el('linkIdentitySheet')?.classList.add('hidden');
      renderMembers();
      notify('ذخیره شد.', 'Saved.', 'success');
    });

    el('linkRoomFileBtn')?.addEventListener('click', () => { setSheet(false); el('linkRoomFileInput')?.click(); });
    el('linkRoomGalleryBtn')?.addEventListener('click', () => { setSheet(false); el('linkRoomGalleryInput')?.click(); });
    ['linkRoomFileInput', 'linkRoomGalleryInput'].forEach((id) => {
      el(id)?.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        await sendChosenFiles(files);
      });
    });

    el('linkRoomLocationBtn')?.addEventListener('click', async () => {
      setSheet(false);
      notify('در حال گرفتن موقعیت…', 'Getting your location…', 'info');
      try {
        await mesh().sendLocation();
      } catch (error) {
        notify('موقعیت در دسترس نیست.', 'Location is unavailable.', 'warning');
      }
    });

    el('linkRoomVoiceBtn')?.addEventListener('click', () => startRecording());
    el('linkVoiceStopBtn')?.addEventListener('click', () => stopRecording(true));
    el('linkVoiceCancelBtn')?.addEventListener('click', () => stopRecording(false));

    el('linkRoomHiddenBtn')?.addEventListener('click', () => {
      compose.hidden = !compose.hidden;
      renderComposeState();
      setSheet(false);
    });
    el('linkRoomTimerBtn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      el('linkTimerPopover')?.classList.toggle('hidden');
    });
    el('linkTimerPopover')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-link-timer]');
      if (!option) return;
      compose.burn = Number(option.dataset.linkTimer) || 0;
      el('linkTimerPopover')?.querySelectorAll('[data-link-timer]')
        .forEach((b) => b.classList.toggle('is-on', b === option));
      el('linkTimerPopover')?.classList.add('hidden');
      renderComposeState();
      setSheet(false);
    });

    /* Tapping a hidden message uncovers it, and only for the person who
       tapped: nothing is sent, nothing changes for anyone else. */
    el('linkRoomMessages')?.addEventListener('click', (event) => {
      const covered = event.target.closest('[data-reveal]');
      if (covered) covered.classList.add('is-open');
    });

    el('linkCallJoinBtn')?.addEventListener('click', async () => {
      const video = el('linkCallJoinBtn')?.dataset.video === 'true';
      try {
        const call = await mesh().joinCall({ video });
        if (call) showCallScreen(true);
      } catch (error) {
        console.error('[LocalRoom] the call could not be joined', error);
        notify('میکروفون یا دوربین در دسترس نیست.', 'The microphone or camera is unavailable.', 'error');
      }
    });
    el('linkCallDeclineBtn')?.addEventListener('click', () => mesh().declineCall());
    el('linkCallEndBtn')?.addEventListener('click', () => mesh().endCall());
    /* A call you have stepped away from is still a call. Back to the chat
       leaves it running and offers the way in again; hanging up is the button
       next to it and means something else. */
    el('linkCallBackBtn')?.addEventListener('click', () => showCallScreen(false));
    el('linkCallResumeBtn')?.addEventListener('click', () => showCallScreen(true));
    /* The buttons ask the call to change and then draw what the call says.
       Toggling a class and telling the mesh separately meant the two could
       disagree — a microphone that was live under a slashed icon. */
    el('linkCallMuteBtn')?.addEventListener('click', async () => {
      const live = mesh().room.call?.stream.getAudioTracks().some((track) => track.enabled);
      await mesh().setMuted(Boolean(live));
      renderCall();
    });
    el('linkCallCameraBtn')?.addEventListener('click', async () => {
      const live = mesh().room.call?.stream.getVideoTracks().some((track) => track.enabled);
      try {
        await mesh().setCameraOn(!live);
      } catch (error) {
        notify('دوربین در دسترس نیست.', 'The camera is unavailable.', 'error');
      }
      renderCall();
    });

    el('linkRoomStickerBtn')?.addEventListener('click', () => {
      setSheet(false);
      stickerTray();
      el('linkStickerTray')?.classList.toggle('hidden');
    });
    el('linkStickerTray')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-sticker-emoji], [data-sticker-url]');
      if (!button) return;
      await mesh().sendSticker({
        emoji: button.dataset.stickerEmoji || '',
        url: button.dataset.stickerUrl || '',
      });
      el('linkStickerTray')?.classList.add('hidden');
    });

    el('linkRoomPollBtn')?.addEventListener('click', () => {
      setSheet(false);
      el('linkPollMaker')?.classList.toggle('hidden');
    });
    el('linkPollCancelBtn')?.addEventListener('click',
      () => el('linkPollMaker')?.classList.add('hidden'));
    el('linkPollSendBtn')?.addEventListener('click', async () => {
      const question = el('linkPollQuestion')?.value.trim();
      const options = (el('linkPollOptions')?.value || '').split('\n')
        .map((line) => line.trim()).filter(Boolean);
      if (!question || options.length < 2) {
        notify('یک سؤال و دست‌کم دو گزینه لازم است.',
          'A question and at least two options are needed.', 'warning');
        return;
      }
      await mesh().sendPoll(question, options);
      el('linkPollQuestion').value = '';
      el('linkPollOptions').value = '';
      el('linkPollMaker')?.classList.add('hidden');
    });

    el('linkRoomMessages')?.addEventListener('click', async (event) => {
      const voteBtn = event.target.closest('[data-vote]');
      if (voteBtn) {
        await mesh().vote(voteBtn.dataset.vote, Number(voteBtn.dataset.option));
        return;
      }
      const reactBtn = event.target.closest('[data-react]');
      if (reactBtn) await mesh().react(reactBtn.dataset.react, reactBtn.dataset.emoji);
    });

    el('linkRoomCallBtn')?.addEventListener('click', () => beginCall(false));
    el('linkRoomVideoBtn')?.addEventListener('click', () => beginCall(true));
    el('linkRoomLeaveBtn')?.addEventListener('click', async () => {
      await mesh().leave();
      showRoom(false);
    });
    el('linkRoomInviteBtn')?.addEventListener('click', () => {
      /* Bring the pairing card back for one more person. Whoever is already
         here stays connected; the room is not restarted. */
      el('linkQrStage')?.closest('.glass')?.classList.remove('is-behind-room');
      global.PoorijaLocalLink?.startAsHost?.();
    });

    mesh()?.on((event, detail) => {
      if (event === 'room' || event === 'member') { renderMembers(); renderCall(); }
      if (event === 'message' || event === 'poll') renderMessages();
      if (event === 'call') {
        /* A call that has just started shows itself, whoever started it and
           however it was started. Opening the screen from inside beginCall and
           joinCall meant a call raised any other way — the mesh API, a future
           caller — ran with nothing on screen to show for it. */
        const running = Boolean(mesh()?.room.call);
        if (running && !wasInCall) showCallScreen(true);
        wasInCall = running;
        renderCall();
      }
      if (event === 'stream') attachStream(detail);
      if (event === 'member' && mesh().snapshot().count > 1) showRoom(true);
      if (event === 'transfer') renderIncoming(detail);
      if (event === 'room' || event === 'member') reflectRoomExists();
      if (event === 'ringing') renderRing(detail);

    });
  }

  function init() {
    if (!document.getElementById('linkRoom')) return;
    bind();
    renderMembers();
    renderMessages();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.PoorijaLocalRoom = {
    showRoom, showCallScreen, renderMembers, renderMessages, renderCall, init, bind,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
