/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 14 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Who is talking, and who wants to
*/

/* =====================================================================
   Who is talking, and who wants to
   ---------------------------------------------------------------------
   With six tiles on screen the question is never "is there sound" but
   "which of these people is making it". Every incoming stream already
   arrives decoded on this device, so the answer needs no signalling at
   all: one analyser per stream, one timer, and a class on the tile.

   Raising a hand does need signalling, and rides the state message that
   already carries mute and camera.
   ===================================================================== */
const GROUP_SPEAKING_THRESHOLD = 0.055;

function groupMeterContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!chatState.groupMeterContext || chatState.groupMeterContext.state === 'closed') {
    try { chatState.groupMeterContext = new AudioContextClass(); } catch (_error) { return null; }
  }
  return chatState.groupMeterContext;
}

function attachGroupMeter(target, stream) {
  if (!stream?.getAudioTracks?.().length || target.meter) return;
  const context = groupMeterContext();
  if (!context) return;
  try {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    target.meter = { source, analyser, buffer: new Uint8Array(analyser.frequencyBinCount) };
  } catch (error) {
    console.warn('[Group call] level meter unavailable', error);
  }
}

function readGroupMeter(target) {
  const meter = target?.meter;
  if (!meter) return 0;
  meter.analyser.getByteFrequencyData(meter.buffer);
  let sum = 0;
  for (let i = 0; i < meter.buffer.length; i += 1) sum += meter.buffer[i];
  return Math.min(1, (sum / meter.buffer.length) / 90);
}

/* Classes are toggled straight on the DOM rather than through a re-render:
   at five ticks a second a re-render would rebuild every tile and reattach
   every stream, which looks exactly like a broken call. */
function startGroupLevelMeters() {
  stopGroupLevelMeters();
  chatState.groupMeterTimer = window.setInterval(() => {
    if (!groupCallActive()) return;
    const self = chatState.groupCall;
    attachGroupMeter(self, self.localStream);
    const selfLevel = self.muted ? 0 : readGroupMeter(self);
    markTileSpeaking('self', selfLevel > GROUP_SPEAKING_THRESHOLD);
    self.participants.forEach((entry) => {
      attachGroupMeter(entry, entry.stream);
      const level = entry.muted ? 0 : readGroupMeter(entry);
      markTileSpeaking(entry.key, level > GROUP_SPEAKING_THRESHOLD);
    });
  }, 200);
}
function stopGroupLevelMeters() {
  if (chatState.groupMeterTimer) window.clearInterval(chatState.groupMeterTimer);
  chatState.groupMeterTimer = 0;
}
/* End of a group call: the AudioContext and every participant's meter nodes
   used to live until the page was closed — a context that keeps running, and
   source/analyser pairs stacking up with each join/leave cycle. */
function disposeGroupMeterContext() {
  try {
    const self = chatState.groupCall;
    if (self?.meter) { self.meter.source?.disconnect?.(); self.meter.analyser?.disconnect?.(); self.meter = null; }
    self?.participants?.forEach((entry) => {
      if (entry?.meter) { entry.meter.source?.disconnect?.(); entry.meter.analyser?.disconnect?.(); entry.meter = null; }
    });
  } catch (_error) { /* teardown must never throw */ }
  stopGroupLevelMeters();
  try { chatState.groupMeterContext?.close?.(); } catch (_error) { /* already closed */ }
  chatState.groupMeterContext = null;
}
function markTileSpeaking(key, speaking) {
  const tile = document.querySelector(`#chatGroupCallGrid [data-gcall-key="${CSS.escape(key)}"]`);
  tile?.classList.toggle('is-speaking', Boolean(speaking));
}

function toggleGroupCallHand() {
  if (!groupCallActive()) return;
  chatState.groupCall.handRaised = !chatState.groupCall.handRaised;
  broadcastGroupCallState();
  renderGroupCallStage();
  notify(chatState.groupCall.handRaised
    ? t('دستتان را بالا بردید.', 'Your hand is raised.')
    : t('دستتان را پایین آوردید.', 'Your hand is down.'), 'info');
}

/* The automatic answer is a good default, not a rule: on a big screen some
   people want four small tiles, some want one big one. The choice is per
   device and outlives the call. */
const GCALL_LAYOUT_KEY = 'poorija_gcall_layout';
const GCALL_LAYOUTS = ['auto', '1', '2', '3', '4'];
function groupCallLayoutChoice() {
  let stored = 'auto';
  try { stored = localStorage.getItem(GCALL_LAYOUT_KEY) || 'auto'; } catch (_error) { stored = 'auto'; }
  return GCALL_LAYOUTS.includes(stored) ? stored : 'auto';
}
function setGroupCallLayout(choice) {
  const next = GCALL_LAYOUTS.includes(choice) ? choice : 'auto';
  try { localStorage.setItem(GCALL_LAYOUT_KEY, next); } catch (_error) { /* private mode */ }
  syncGroupCallColumns();
  renderGroupCallStage();
}

/* Fitting the people into the box.
 *
 * The stage used to be a masonry column layout that scrolled. That is the
 * wrong shape for a call: a video call is not a document, and the person who
 * has just started speaking must not be below the fold. Every serious client
 * fits every tile into the visible area instead, and sizes them to whatever
 * that allows.
 *
 * The arithmetic is small. For N tiles in a W by H box, try every column count
 * from 1 to N; each gives rows = ceil(N / columns), and a cell of
 * (W - gaps) / columns by (H - gaps) / rows. A tile keeps its aspect ratio
 * inside that cell, so its real size is whichever of width or height binds
 * first. Take the column count whose tile area is largest.
 *
 * That single rule produces all the shapes by itself: two people side by side
 * on a wide screen and stacked on a phone, four as a 2x2, six as 3x2 across
 * and 2x3 down. No special cases, and nothing to keep in step. */
const GCALL_GAP = 10;
function fitGroupCallGrid(count, width, height, aspect = 16 / 9) {
  if (count < 1 || width <= 0 || height <= 0) return { columns: 1, rows: 1, tileWidth: 0, tileHeight: 0 };
  const landscape = width >= height;
  /* A landscape room gets a landscape arrangement and a portrait room a
     portrait one. Without this, area alone puts two people on a wide screen
     one above the other - each tile becomes a wide short strip - because two
     stacked 16:9 tiles happen to work out about six per cent larger. Every
     client makes this same call, and it is a rule about the shape of the room
     rather than a special case for any particular number of people. */
  const allowed = (columns, rows) => (count === 1
    || (landscape ? columns >= rows : rows >= columns));
  let best = null;
  const consider = (relaxed) => {
    for (let columns = 1; columns <= count; columns += 1) {
      const rows = Math.ceil(count / columns);
      if (!relaxed && !allowed(columns, rows)) continue;
      const cellWidth = (width - GCALL_GAP * (columns - 1)) / columns;
      const cellHeight = (height - GCALL_GAP * (rows - 1)) / rows;
      if (cellWidth <= 0 || cellHeight <= 0) continue;
      /* The tile keeps its shape inside the cell: whichever dimension runs out
         first decides the size, and the rest of the cell is spare. */
      const byWidth = { w: cellWidth, h: cellWidth / aspect };
      const byHeight = { w: cellHeight * aspect, h: cellHeight };
      const tile = byWidth.h <= cellHeight ? byWidth : byHeight;
      const area = tile.w * tile.h;
      if (!best || area > best.area) {
        best = { columns, rows, tileWidth: tile.w, tileHeight: tile.h, area };
      }
    }
  };
  consider(false);
  /* Very tall or very wide boxes can leave the preferred orientation with
     nothing usable; take the best of anything rather than nothing. */
  if (!best) consider(true);
  return best || { columns: 1, rows: count, tileWidth: 0, tileHeight: 0 };
}

/* A last row that is not full is centred, the way Meet and Zoom do it: three
   people are two above and one centred below, not two above and one pushed
   into a corner.
 *
 * Centring one tile across two columns needs a half-column offset, and grid
 * cannot express half a track - so the grid is laid out in half-columns and
 * every tile spans two of them. A short row can then start on an odd
 * half-column, which is exactly the middle. The column gap is zero and the
 * spacing comes from padding on the tiles, or the extra tracks would each
 * introduce a gap of their own inside a tile.
 *
 * Done per element rather than in a stylesheet because the offset depends on
 * how many are missing, and nth-child cannot read a custom property. */
function centreShortLastRow(stage, people, columns) {
  const tiles = [...stage.querySelectorAll(':scope > .chat-gcall-tile')];
  /* Both ends, every time. Setting grid-column-start on its own drops the
     "span 2" the stylesheet gives every tile - the tile then takes one half
     column and comes out half width, which is what it did. */
  tiles.forEach((tile) => { tile.style.gridColumn = ''; });
  if (columns < 2 || people <= columns) return;
  const remainder = people % columns;
  if (remainder === 0) return;
  const firstOfLastRow = people - remainder;
  const tile = tiles[firstOfLastRow];
  if (!tile) return;
  /* Half-columns: one missing column is one half-column of offset. */
  const offset = columns - remainder;
  if (offset > 0) tile.style.gridColumn = `${offset + 1} / span 2`;
}

/* Recomputed on its own, not only when somebody joins or leaves: rotating a
   phone or dragging a window changes what fits, and a full re-render would
   reattach every stream and flash the whole stage. */
function syncGroupCallColumns() {
  const stage = document.getElementById('chatGroupCallGrid');
  if (!stage || !groupCallActive()) return;
  const people = 1 + chatState.groupCall.participants.size;
  const pinnedKey = chatState.groupCall.pinnedKey || '';
  const box = stage.getBoundingClientRect();
  const width = box.width || stage.clientWidth || window.innerWidth || 360;
  const height = box.height || stage.clientHeight || 400;

  /* Pinned: one big tile, everybody else in a strip. The strip goes down the
     side when there is width to spare and along the bottom when there is not,
     which is the same call every client makes and for the same reason. */
  if (pinnedKey && people > 1) {
    const sideRail = width >= 720 && width / height > 1.15;
    stage.dataset.gcallMode = sideRail ? 'pinned-side' : 'pinned-bottom';
    const railCount = people - 1;
    const railSize = sideRail
      ? Math.max(120, Math.min(240, width * 0.22))
      : Math.max(84, Math.min(150, height * 0.2));
    stage.style.setProperty('--gcall-rail', `${Math.round(railSize)}px`);
    stage.style.setProperty('--gcall-rail-count', String(Math.max(1, railCount)));
    return;
  }

  stage.dataset.gcallMode = 'grid';
  const choice = groupCallLayoutChoice();
  /* Landscape tiles everywhere. Cameras produce landscape frames and every
     other client shows them that way; a portrait tile on a phone sounded
     reasonable and in practice put a tall crop of a wide picture on screen,
     which is a face with its sides cut off. */
  const fit = fitGroupCallGrid(people, width, height, 16 / 9);
  const columns = choice === 'auto'
    ? fit.columns
    /* A chosen count is still capped by what fits: three columns on a 390px
       phone is four thumbnails and no faces. */
    : Math.max(1, Math.min(Number(choice), Math.max(1, Math.floor(width / 150))));
  const rows = Math.ceil(people / columns);
  stage.style.setProperty('--gcall-columns', String(columns));
  stage.style.setProperty('--gcall-rows', String(rows));
  centreShortLastRow(stage, people, columns);
}

function renderGroupCallLayoutSheet() {
  const sheet = document.getElementById('chatGroupLayoutSheet');
  if (!sheet) return;
  const current = groupCallLayoutChoice();
  const label = (choice) => (choice === 'auto'
    ? t('خودکار — بر اساس تعداد و اندازهٔ صفحه', 'Automatic — by count and screen size')
    : t(`${choice} ستون`, `${choice} column${choice === '1' ? '' : 's'}`));
  sheet.innerHTML = GCALL_LAYOUTS.map((choice) => `
    <button type="button" data-gcall-layout="${choice}" class="${current === choice ? 'is-on' : ''}">
      <i class="fas ${choice === 'auto' ? 'fa-wand-magic-sparkles' : 'fa-table-cells'}"></i>
      <span>${app().escapeHTML(label(choice))}</span>
      ${current === choice ? '<i class="fas fa-check"></i>' : ''}
    </button>`).join('');
}
function watchGroupCallSize() {
  const stage = document.getElementById('chatGroupCallGrid');
  if (!stage || stage.dataset.sizeWatched || typeof ResizeObserver !== 'function') return;
  stage.dataset.sizeWatched = '1';
  new ResizeObserver(() => syncGroupCallColumns()).observe(stage);
}
