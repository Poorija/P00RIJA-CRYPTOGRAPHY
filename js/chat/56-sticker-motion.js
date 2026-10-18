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
   Stickers that keep moving, a still for every sticker, and a sticker held up
   to look at.
   ============================================================================

   Four things, all about how a sticker or a GIF looks once it is on screen.

     1. Looping for good. A GIF or an animated WebP or PNG carries how many
        times it plays in its own bytes, and many say two or three: they ran,
        stopped on their last frame, and moved again only when something
        redrew them. Every animated picture is made to say "forever" here
        (loopForeverBlob) — the bytes of the count and nothing else. A video
        sticker that WebKit pauses or stalls at its loop point is started
        again (keepVideoLooping).

     2. A still for every sticker. The picker drew a video or Lottie sticker as
        nothing at all until it had loaded and started, which on a phone is
        the patchwork a big Telegram pack filled in with. Every sticker now has
        a small still — the first frame of a video, a frame of a Lottie
        animation, the first frame of an animated picture — drawn at once,
        with the moving sticker laid over it when it is on screen
        (upkeepStickerRecord, run by ensurePackThumbs).

     3. A sticker held up. Tapping a sticker or a GIF in a conversation lifts
        it out of the thread, large, over a blurred backdrop, with the
        message's reactions and every action its toolbar has. The toolbar is
        not copied: each action presses the real button in the real toolbar,
        so the two can never come to disagree (openStickerFocus).

     4. Pictures in a conversation are given the same "forever" as the
        library: a sticker or GIF someone sent is drawn from a looping copy
        of its bytes (loopThreadPicture).
   ========================================================================== */

/* ---- 1. playing forever ------------------------------------------------- */

const motionAscii = (bytes, from, length) => String.fromCharCode(...bytes.subarray(from, from + length));

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function pngCrc(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = PNG_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* The same picture, told to loop forever. Only the loop count changes: a GIF
   gets its NETSCAPE2.0 count set to 0 (or the block added, without which it
   plays once), an animated WebP its ANIM count, an APNG its acTL plays and
   that chunk's checksum. The rest of the bytes are the original's, sliced,
   not copied. Anything it does not recognise comes back as it was. */
async function loopForeverBlob(blob, type = '') {
  if (!(blob instanceof Blob) || blob.size < 16) return blob;
  const kind = type || (typeof sniffPictureType === 'function' ? await sniffPictureType(blob) : blob.type);
  let head;
  try {
    head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 64 * 1024)).arrayBuffer());
  } catch (_error) {
    return blob;
  }
  const mime = blob.type || kind;
  const spliced = (at, bytes, replacing) => new Blob([blob.slice(0, at), bytes, blob.slice(at + replacing)], { type: mime });

  if (kind === 'image/gif') {
    if (head.length < 13) return blob;
    let at = 13;
    if (head[10] & 0x80) at += 3 * (1 << ((head[10] & 0x07) + 1));
    const afterTable = at;
    while (at + 2 < head.length && head[at] === 0x21) {
      if (head[at + 1] === 0xff && head[at + 2] === 0x0b && at + 18 <= head.length) {
        const name = motionAscii(head, at + 3, 11);
        if ((name === 'NETSCAPE2.0' || name === 'ANIMEXTS1.0') && head[at + 14] === 0x03 && head[at + 15] === 0x01) {
          return head[at + 16] === 0 && head[at + 17] === 0 ? blob : spliced(at + 16, new Uint8Array([0, 0]), 2);
        }
      }
      let next = at + 2;
      while (next < head.length && head[next] !== 0) next += head[next] + 1;
      if (next >= head.length) return blob;
      at = next + 1;
    }
    const netscape = new Uint8Array([0x21, 0xff, 0x0b, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00]);
    return spliced(afterTable, netscape, 0);
  }

  if (kind === 'image/webp') {
    let at = 12;
    while (at + 8 <= head.length) {
      const tag = motionAscii(head, at, 4);
      const size = (head[at + 4] | (head[at + 5] << 8) | (head[at + 6] << 16) | (head[at + 7] << 24)) >>> 0;
      if (tag === 'ANIM') {
        const count = at + 8 + 4;
        if (count + 2 > head.length) return blob;
        return head[count] === 0 && head[count + 1] === 0 ? blob : spliced(count, new Uint8Array([0, 0]), 2);
      }
      if (tag === 'ANMF' || tag === 'VP8 ' || tag === 'VP8L') return blob;
      at += 8 + size + (size & 1);
    }
    return blob;
  }

  if (kind === 'image/png') {
    let at = 8;
    while (at + 12 <= head.length) {
      const length = ((head[at] << 24) | (head[at + 1] << 16) | (head[at + 2] << 8) | head[at + 3]) >>> 0;
      const tag = motionAscii(head, at + 4, 4);
      if (tag === 'acTL') {
        if (length !== 8 || at + 20 > head.length) return blob;
        const plays = at + 12;
        if (!head[plays] && !head[plays + 1] && !head[plays + 2] && !head[plays + 3]) return blob;
        const chunk = head.slice(at + 4, at + 16);
        chunk.fill(0, 8, 12);
        const crc = pngCrc(chunk);
        const rewritten = new Uint8Array(16);
        rewritten.set(chunk, 0);
        rewritten.set([crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff], 12);
        return spliced(at + 4, rewritten, 16);
      }
      if (tag === 'IDAT') return blob;
      at += 12 + length;
    }
    return blob;
  }
  return blob;
}

/* Video stickers. WebKit pauses a muted looping video it decides nobody is
   watching, and on an iPhone a WebM sticker plays its loop two or three
   times and then stops on its last frame while still claiming to play; both
   looked like a sticker that froze until the panel was touched. Every sticker
   video that should be moving is watched frame by frame: one that has stopped
   at its end is sent back to the start at once — a frame or two, where the
   slow check this began with left a two- or three-second pause before every
   replay — and one that was paused is played again. */
const loopingVideos = new Set();
function videoShouldMove(video) {
  return video.isConnected && video.__onScreen !== false && Boolean(video.getAttribute('src'))
    && !document.hidden && !video.closest('.hidden');
}
function resumeStickerVideo(video) {
  if (!videoShouldMove(video) || !(video.paused || video.ended)) return;
  if (video.ended) video.currentTime = 0;
  video.play?.().catch(() => {});
}
let loopWatchFrame = 0;
function watchLoopingVideos() {
  if (loopWatchFrame || !loopingVideos.size) return;
  const tick = (now) => {
    loopWatchFrame = 0;
    loopingVideos.forEach((video) => {
      if (!video.isConnected) { loopingVideos.delete(video); return; }
      if (!videoShouldMove(video)) { video.__movedAt = now; return; }
      if (video.paused || video.ended) { resumeStickerVideo(video); video.__movedAt = now; return; }
      const time = video.currentTime;
      if (time !== video.__lastTime) {
        video.__lastTime = time;
        video.__movedAt = now;
        return;
      }
      const nearEnd = video.duration > 0 && video.duration - time < 0.35;
      if (video.readyState >= 2 && now - (video.__movedAt || now) > (nearEnd ? 80 : 700)) {
        video.__movedAt = now;
        if (nearEnd) video.currentTime = 0;
        video.play?.().catch(() => {});
      }
    });
    if (loopingVideos.size) loopWatchFrame = requestAnimationFrame(tick);
  };
  loopWatchFrame = requestAnimationFrame(tick);
}
function keepVideoLooping(video) {
  if (!(video instanceof HTMLVideoElement)) return;
  loopingVideos.add(video);
  watchLoopingVideos();
  if (video.__looping) return;
  video.__looping = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.addEventListener('ended', () => { video.currentTime = 0; resumeStickerVideo(video); });
  video.addEventListener('pause', () => window.setTimeout(() => resumeStickerVideo(video), 160));
}
function sweepStickerMotion() {
  loopingVideos.forEach((video) => {
    if (!video.isConnected) loopingVideos.delete(video);
    else resumeStickerVideo(video);
  });
  watchLoopingVideos();
  if (typeof sweepLottieNodes === 'function') sweepLottieNodes();
}
window.setInterval(sweepStickerMotion, 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sweepStickerMotion(); });

/* ---- 2. a still for every sticker --------------------------------------- */

/* Smaller than the sticker, large enough to stay sharp on a phone's screen:
   a grid cell is about 70 points, 210 pixels at 3x. */
function stillCanvas(width, height) {
  const scale = Math.min(1, STICKER_THUMB_EDGE / Math.max(width, height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}
/* WebP where the engine can write it; Safari cannot and hands back a PNG,
   which is fine — a still is judged by its pixels, not its bytes. */
function canvasStill(canvas) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ? stickerBlobInMemory(blob) : null), 'image/webp', 0.86));
}
/* Whether a frame has anything in it: a Lottie sticker that grows in from
   nothing is empty at frame 0, a video can open on black. */
function stillLooksEmpty(canvas) {
  try {
    const probe = document.createElement('canvas');
    probe.width = 16;
    probe.height = 16;
    const paint = probe.getContext('2d', { willReadFrequently: true });
    paint.drawImage(canvas, 0, 0, 16, 16);
    const { data } = paint.getImageData(0, 0, 16, 16);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 24 && (data[i] + data[i + 1] + data[i + 2]) > 30) lit += 1;
    }
    return lit < 6;
  } catch (_error) {
    return false;
  }
}

/* The first frame of a picture: createImageBitmap decodes only that one. */
async function rasterStill(blob) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = stillCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await canvasStill(canvas);
  } catch (_error) {
    return null;
  }
}

/* A frame of a video sticker, early on: the element is put on the page for a
   moment (an iPhone does not load a video that is nowhere), nudged a little
   in so WebKit really decodes a frame, and drawn. */
function videoStill(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
    let settled = false;
    let timer = 0;
    const finish = (still) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_error) { /* gone already */ }
      video.remove();
      URL.revokeObjectURL(url);
      resolve(still);
    };
    timer = window.setTimeout(() => finish(null), 6000);
    const grab = async (retry) => {
      try {
        if (!video.videoWidth || !video.videoHeight) { finish(null); return; }
        const canvas = stillCanvas(video.videoWidth, video.videoHeight);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        if (retry && stillLooksEmpty(canvas) && video.duration > 0.4) {
          video.addEventListener('seeked', () => grab(false), { once: true });
          video.currentTime = Math.min(video.duration * 0.4, 1.5);
          return;
        }
        finish(await canvasStill(canvas));
      } catch (_error) {
        finish(null);
      }
    };
    video.addEventListener('loadeddata', () => {
      video.addEventListener('seeked', () => grab(true), { once: true });
      try { video.currentTime = Math.min(0.05, (video.duration || 1) / 10); } catch (_error) { grab(true); }
    }, { once: true });
    video.addEventListener('error', () => finish(null), { once: true });
    document.body.appendChild(video);
    video.src = url;
  });
}

/* A frame of a Lottie sticker. lottie draws it as SVG off screen; that SVG is
   turned into pixels, because a hundred small pictures draw faster than a
   hundred vector scenes. An engine that will not paint an SVG onto a canvas
   keeps the SVG itself as the still. */
async function lottieStill(blob) {
  let host = null;
  let animation = null;
  try {
    const lottie = await ensureLottie();
    const data = JSON.parse(await blob.text());
    const edge = STICKER_THUMB_EDGE;
    host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${edge}px;height:${edge}px;pointer-events:none;opacity:0`;
    document.body.appendChild(host);
    animation = lottie.loadAnimation({
      container: host, renderer: 'svg', loop: false, autoplay: false, animationData: data,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    });
    if (!animation.isLoaded) {
      await new Promise((resolve) => {
        animation.addEventListener('DOMLoaded', resolve);
        window.setTimeout(resolve, 1500);
      });
    }
    const frames = Math.max(1, Math.floor(animation.totalFrames || 1));
    let vector = null;
    for (const frame of [0, Math.floor(frames / 2)]) {
      animation.goToAndStop(frame, true);
      const svg = host.querySelector('svg');
      if (!svg) return null;
      const copy = svg.cloneNode(true);
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      copy.setAttribute('width', String(edge));
      copy.setAttribute('height', String(edge));
      copy.removeAttribute('style');
      vector = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(vector);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = edge;
        canvas.height = edge;
        canvas.getContext('2d').drawImage(image, 0, 0, edge, edge);
        if (frame === 0 && frames > 2 && stillLooksEmpty(canvas)) continue;
        const still = await canvasStill(canvas);
        if (still) return still;
      } catch (_error) {
        return stickerBlobInMemory(vector);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return vector ? stickerBlobInMemory(vector) : null;
  } catch (_error) {
    return null;
  } finally {
    try { animation?.destroy(); } catch (_error) { /* nothing left to stop */ }
    host?.remove();
  }
}

/* Bumped when what a sticker record carries changes, so a record from before
   is brought up to date once, in the background. */
const STICKER_UPKEEP_VERSION = 2;
function stickerNeedsUpkeep(record) {
  return Boolean(record) && (record.upkeep !== STICKER_UPKEEP_VERSION
    || !(record.thumb instanceof Blob || record.thumbChecked));
}
function stickerIsAnimated(record) {
  return Boolean(record) && (record.kind === 'video' || record.kind === 'lottie' || record.animated === true);
}

/* One record brought up to date: whether it moves, a still of it, and — for
   an animated picture — its bytes told to loop forever. In memory only; the
   caller stores the pack once, when the whole of it is done. */
async function upkeepStickerRecord(record) {
  if (!record) return;
  const blob = record.blob;
  let still = record.thumb instanceof Blob ? record.thumb : null;
  try {
    if (!(blob instanceof Blob)) {
      still = null;
    } else if (record.kind === 'video') {
      still = still || await videoStill(blob);
    } else if (record.kind === 'lottie') {
      still = still || await lottieStill(blob);
    } else {
      const type = typeof sniffPictureType === 'function' ? await sniffPictureType(blob) : blob.type;
      const animated = typeof pictureIsAnimated === 'function' ? await pictureIsAnimated(blob, type) : false;
      record.animated = animated;
      if (animated) {
        record.blob = await loopForeverBlob(blob, type);
        still = still || await rasterStill(blob);
      } else if (!still) {
        still = await makeStickerThumb(blob);
      }
    }
  } catch (_error) { /* a record that cannot be read keeps what it had */ }
  if (still) {
    record.thumb = still;
    delete record.thumbChecked;
  } else {
    delete record.thumb;
    record.thumbChecked = true;
  }
  record.upkeep = STICKER_UPKEEP_VERSION;
}

/* A still that arrives while its pack is on screen is put into its cell at
   once, so the grid fills in from the top as the background work goes. */
function paintStillIntoCell(record) {
  if (!(record?.thumb instanceof Blob)) return;
  const cell = document.querySelector(`#chatStickerGrid [data-chat-sticker-send="${CSS.escape(record.id)}"], #chatStickerGrid [data-chat-gif-send="${CSS.escape(record.id)}"]`);
  if (!cell || cell.querySelector('.chat-sticker-still, .chat-gif-still')) return;
  if (!stickerIsAnimated(record)) return;
  const still = document.createElement('img');
  still.className = cell.matches('[data-chat-gif-send]') ? 'chat-gif-still is-ready' : 'chat-sticker-still is-ready';
  still.alt = '';
  still.draggable = false;
  still.decoding = 'async';
  still.src = stickerThumbUrl(record);
  cell.prepend(still);
}

/* ---- 4. pictures in a conversation -------------------------------------- */

/* A sticker or GIF in the thread is drawn from a copy of its bytes that loops
   forever. Made once per picture; the looping copy is kept by the URL it came
   from, so a redraw of the thread goes straight to it. */
const loopedPictureUrls = new Map();
const loopingPictureJobs = new Map();
function loopedPictureUrl(url) {
  return loopedPictureUrls.get(url) || url;
}
function loopThreadPicture(img) {
  const original = img.getAttribute('src') || '';
  if (!original.startsWith('blob:') || img.dataset.loopChecked) return;
  img.dataset.loopChecked = '1';
  if (loopedPictureUrls.has(original)) return;
  if ([...loopedPictureUrls.values()].includes(original)) return;
  if (!loopingPictureJobs.has(original)) {
    loopingPictureJobs.set(original, (async () => {
      try {
        const blob = await (await fetch(original)).blob();
        const type = typeof sniffPictureType === 'function' ? await sniffPictureType(blob) : blob.type;
        if (typeof pictureIsAnimated !== 'function' || !await pictureIsAnimated(blob, type)) return original;
        const looped = await loopForeverBlob(blob, type);
        if (looped === blob) return original;
        const url = URL.createObjectURL(looped);
        /* Decoded before it is swapped in, so the picture does not blink. */
        const probe = new Image();
        probe.src = url;
        await probe.decode().catch(() => {});
        return url;
      } catch (_error) {
        return original;
      }
    })().then((url) => {
      loopedPictureUrls.set(original, url);
      loopingPictureJobs.delete(original);
      if (url !== original) {
        document.querySelectorAll('#chatMessages img.chat-sticker-media').forEach((node) => {
          if (node.getAttribute('src') === original) node.setAttribute('src', url);
        });
      }
      return url;
    }));
  }
}
/* Called after every thread render (27-message-render.js). */
function keepThreadStickersMoving(panel) {
  if (!panel) return;
  panel.querySelectorAll('.chat-sticker-bubble video.chat-sticker-media').forEach((video) => {
    video.__onScreen = true;
    keepVideoLooping(video);
  });
  panel.querySelectorAll('.chat-sticker-bubble img.chat-sticker-media').forEach(loopThreadPicture);
}

/* ---- 3. a sticker held up ----------------------------------------------- */

let stickerFocus = null;

function focusEntryFor(entryId) {
  const key = getConversationKey(getActiveConversation());
  return (chatState.history[key] || []).find((item) => item.id === entryId) || null;
}
function liveBubbleFor(entryId) {
  return document.querySelector(`#chatMessages .chat-message-bubble[data-id="${CSS.escape(entryId)}"]`);
}
/* The real toolbar's buttons, in its order, minus the reaction toggle — the
   reactions have a row of their own up here. */
function focusActionsFor(bubble) {
  const buttons = [...(bubble?.querySelectorAll('.chat-message-toolbar > button') || [])];
  return buttons
    .filter((button) => !button.hasAttribute('data-chat-toggle-reaction'))
    .map((button) => {
      const attribute = [...button.attributes].find((attr) => attr.name.startsWith('data-chat-'));
      return attribute ? {
        attribute: attribute.name,
        value: attribute.value,
        icon: button.querySelector('i')?.className || 'fas fa-circle',
        label: button.getAttribute('title') || '',
        danger: button.classList.contains('chat-message-delete'),
      } : null;
    })
    .filter(Boolean);
}

function focusMediaHtml(entry, url) {
  const kind = entry.stickerKind || stickerKindForName(entry.name || '', entry.mime || '');
  const src = app().escapeHTML(url);
  if (kind === 'lottie') return `<div class="sticker-focus-media chat-lottie" data-lottie-src="${src}"></div>`;
  if (kind === 'video') return `<video class="sticker-focus-media" src="${src}" autoplay loop muted playsinline disablepictureinpicture></video>`;
  return `<img class="sticker-focus-media" src="${src}" alt="" draggable="false">`;
}

function openStickerFocus(bubble, entryId) {
  const entry = focusEntryFor(entryId);
  const url = entry?.downloadUrl ? safeMediaUrl(loopedPictureUrl(entry.downloadUrl)) : '';
  if (!entry || entry.type !== 'sticker' || !url) return false;
  closeStickerFocus({ instant: true });
  const gif = isGifEntry(entry);
  const canReact = entry.direction !== 'out';
  const mine = canReact ? (normalizeMessageReactions(entry)[currentReactorId()] || '') : '';
  const actions = focusActionsFor(bubble);
  const quick = CHAT_REACTION_GROUPS[0].emojis.slice(0, 7);
  const w = Number(entry.mediaWidth) || 0;
  const h = Number(entry.mediaHeight) || 0;
  const shape = gif && w > 0 && h > 0 && w <= 10000 && h <= 10000 ? `aspect-ratio:${Math.round(w)} / ${Math.round(h)}` : '';
  const sender = typeof messageSenderLabel === 'function' ? messageSenderLabel(entry, getActiveConversation()) : '';
  const caption = [entry.direction === 'out' ? t('شما', 'You') : sender, formatTime(entry.createdAt)].filter(Boolean).join(' · ');

  const host = document.createElement('div');
  host.className = 'sticker-focus';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', gif ? t('گیف', 'GIF') : t('استیکر', 'Sticker'));
  host.innerHTML = `
    <div class="sticker-focus-backdrop" data-focus-close></div>
    <div class="sticker-focus-stage" data-focus-close>
      ${canReact ? `<div class="sticker-focus-reactions" data-focus-part>
        ${quick.map((emoji) => `<button type="button" data-focus-react="${app().escapeHTML(emoji)}" class="${mine === emoji ? 'is-mine' : ''}">${emoji}</button>`).join('')}
        <button type="button" data-focus-more-reactions aria-label="${app().escapeHTML(t('ری‌اکشن‌های بیشتر', 'More reactions'))}"><i class="fas fa-plus"></i></button>
      </div>
      <div class="sticker-focus-allreactions hidden" data-focus-part>
        ${CHAT_REACTION_GROUPS.map((group) => group.emojis.map((emoji) => `<button type="button" data-focus-react="${app().escapeHTML(emoji)}" class="${mine === emoji ? 'is-mine' : ''}">${emoji}</button>`).join('')).join('')}
      </div>` : ''}
      <div class="sticker-focus-art ${gif ? 'is-gif' : ''}" style="${shape}">
        <div class="sticker-focus-glow" aria-hidden="true"></div>
        ${focusMediaHtml(entry, url)}
        ${gif ? '<span class="sticker-focus-badge" aria-hidden="true">GIF</span>' : ''}
      </div>
      ${caption ? `<div class="sticker-focus-caption" data-focus-part>${app().escapeHTML(caption)}</div>` : ''}
      <div class="sticker-focus-menu" data-focus-part>
        ${actions.map((action, index) => `<button type="button" class="sticker-focus-action ${action.danger ? 'is-danger' : ''}" data-focus-act="${index}" style="--i:${index}">
          <i class="${app().escapeHTML(action.icon)}" aria-hidden="true"></i><span>${app().escapeHTML(action.label)}</span>
        </button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(host);
  document.documentElement.classList.add('sticker-focus-open');

  const art = host.querySelector('.sticker-focus-art');
  const media = host.querySelector('.sticker-focus-media');
  if (media instanceof HTMLVideoElement) { media.__onScreen = true; keepVideoLooping(media); }
  hydrateLottieNodes(host);
  const source = bubble.querySelector('.chat-sticker-body');
  stickerFocus = { host, entryId, actions, source };
  source?.classList.add('is-lifted');

  /* From where the sticker sits in the thread to the middle of the screen,
     with a little overshoot, the way a thing picked up settles in the hand. */
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const from = source?.getBoundingClientRect();
  const to = art.getBoundingClientRect();
  host.classList.add('is-opening');
  if (!reduce && from?.width && to.width && art.animate) {
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    const scale = from.width / to.width;
    art.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      { transform: 'translate(0, 0) scale(1)' },
    ], { duration: 460, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.18)' });
  }
  requestAnimationFrame(() => host.classList.add('is-open'));

  host.addEventListener('click', (event) => {
    const react = event.target.closest('[data-focus-react]');
    if (react) {
      const emoji = react.getAttribute('data-focus-react');
      closeStickerFocus();
      applyReactionFromPicker(entryId, emoji);
      return;
    }
    if (event.target.closest('[data-focus-more-reactions]')) {
      host.querySelector('.sticker-focus-reactions')?.classList.add('hidden');
      host.querySelector('.sticker-focus-allreactions')?.classList.remove('hidden');
      return;
    }
    const act = event.target.closest('[data-focus-act]');
    if (act) {
      const action = actions[Number(act.getAttribute('data-focus-act'))];
      closeStickerFocus();
      /* The real button, in the real toolbar, of the bubble as it is now: a
         redraw since this opened made a new one. */
      const live = action && liveBubbleFor(entryId)?.querySelector(`.chat-message-toolbar [${action.attribute}="${CSS.escape(action.value)}"]`);
      live?.click();
      return;
    }
    if (event.target.closest('.sticker-focus-art, [data-focus-part]')) return;
    if (event.target.closest('[data-focus-close]')) closeStickerFocus();
  });
  bindFocusSwipe(host, art);
  return true;
}

/* Pulled down, it lets go: past a short distance, or flicked. */
function bindFocusSwipe(host, art) {
  let start = null;
  art.addEventListener('pointerdown', (event) => {
    start = { y: event.clientY, at: performance.now() };
    art.setPointerCapture?.(event.pointerId);
  });
  art.addEventListener('pointermove', (event) => {
    if (!start) return;
    const dy = Math.max(0, event.clientY - start.y);
    art.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 240) / 1200})`;
    host.style.setProperty('--focus-pull', String(Math.min(1, dy / 260)));
  });
  const release = (event) => {
    if (!start) return;
    const dy = Math.max(0, event.clientY - start.y);
    const fast = dy / Math.max(1, performance.now() - start.at) > 0.6;
    start = null;
    if (dy > 90 || (fast && dy > 30)) { closeStickerFocus(); return; }
    art.style.transform = '';
    host.style.removeProperty('--focus-pull');
  };
  art.addEventListener('pointerup', release);
  art.addEventListener('pointercancel', release);
}

/* Back into the thread, to where the sticker is now — or simply faded out
   when it has gone (deleted, or scrolled off). */
function closeStickerFocus({ instant = false } = {}) {
  if (!stickerFocus) return;
  const { host, entryId, source } = stickerFocus;
  stickerFocus = null;
  document.documentElement.classList.remove('sticker-focus-open');
  const live = liveBubbleFor(entryId)?.querySelector('.chat-sticker-body');
  const restore = () => {
    source?.classList.remove('is-lifted');
    live?.classList.remove('is-lifted');
  };
  const art = host.querySelector('.sticker-focus-art');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  host.classList.add('is-closing');
  host.classList.remove('is-open');
  const to = live?.getBoundingClientRect();
  const from = art?.getBoundingClientRect();
  if (instant || reduce || !art?.animate || !to?.width || !from?.width
    || to.bottom < 0 || to.top > window.innerHeight) {
    restore();
    if (instant) { host.remove(); return; }
    window.setTimeout(() => host.remove(), 220);
    return;
  }
  const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
  const scale = to.width / from.width;
  art.style.transform = '';
  const motion = art.animate([
    { transform: 'translate(0, 0) scale(1)' },
    { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
  ], { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' });
  motion.onfinish = () => { restore(); host.remove(); };
  window.setTimeout(() => { restore(); host.remove(); }, 600);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && stickerFocus) {
    event.stopPropagation();
    closeStickerFocus();
  }
}, true);

window.__stickerMotionProbe = {
  loopForever: (blob) => loopForeverBlob(blob),
  upkeep: (record) => upkeepStickerRecord(record),
  focusOpen: () => Boolean(stickerFocus),
  closeFocus: () => closeStickerFocus({ instant: true }),
  videoStill: (blob) => videoStill(blob),
  lottieStill: (blob) => lottieStill(blob),
};
