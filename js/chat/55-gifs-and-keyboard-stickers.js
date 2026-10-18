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
   GIFs, and stickers from the phone's own keyboard.
   ============================================================================

   Three ways in, one way out.

     1. Paste. A GIF or a sticker copied anywhere — a browser's "Copy image",
        a sticker long-pressed in another messenger, a screenshot — and pasted
        into the message box is sent as a GIF or a sticker. Dropping the file
        on the message box does the same.

     2. The keyboard. Gboard's GIFs and stickers on Android; the emoji
        keyboard's stickers, Memoji and Genmoji on an iPhone. Neither keyboard
        will put a picture into a box that only holds text, and the message
        box is a <textarea>:
          - Chrome on Android offers keyboard pictures only to a field it
            treats as rich. Marking the textarea -webkit-user-modify:
            read-write is enough for it to offer them; the picture then
            arrives as an ordinary paste carrying the file, and what is typed
            stays plain text. Chrome still keeps keyboard pictures behind
            chrome://flags/#enable-android-media-insertion on phones; with
            the flag off nothing changes and nothing breaks.
          - WebKit decides from the box itself. A <textarea> takes text and
            nothing else, and nothing a page can set changes that. So the
            sticker panel carries a small rich box (a contenteditable): tap
            it, pick a sticker on the keyboard, and it is sent. Whatever the
            keyboard puts there — a paste with the file in it, or an <img>
            written straight into the box — is read back, sent, and the box
            is emptied again.

     3. The panel's GIF shelf: GIFs imported or saved from a conversation,
        one tap to send again.

   One way out: every one of them ends in sendEncryptedBlob(…, 'sticker'),
   the path stickers have always taken — chunked, encrypted per recipient,
   queued on the relay while the other side is away. A GIF is a sticker whose
   kind is 'gif' (isGifEntry, 16-group-call-signalling.js).

   Nothing here fetches anything from the network. A pasted page that only
   names a picture by its address brings no picture: fetching it would tell
   that site who is reading, and the page's own policy forbids it anyway.
   ============================================================================ */

const GIF_MAX_BYTES = 16 * 1024 * 1024;
/* Saved GIFs sit in the sticker store beside the packs, so they get a ceiling
   of their own: a shelf nobody can scroll to the end of is not a shelf. */
const GIF_LIBRARY_MAX_ITEMS = 120;
const GIF_LIBRARY_MAX_BYTES = 150 * 1024 * 1024;
/* A pasted picture no larger than this on its longer side is a sticker:
   stickers from every keyboard and messenger are 512 px or a little over,
   and a photograph or a screenshot is never that small. */
const PASTED_STICKER_MAX_EDGE = 640;
/* A cut-out (any transparent pixel) is a sticker up to this size — some packs
   ship at 1024 px. Past it, a transparent picture is a window screenshot. */
const PASTED_CUTOUT_MAX_EDGE = 1100;
const KEYBOARD_STICKER_EDGE = 512;
const PASTED_MEDIA_MAX_ITEMS = 10;
const KEYBOARD_PICTURE_TYPE = /^(image\/(gif|png|webp|jpe?g|avif|heic|heif|x-apple-adaptive-glyph)|video\/(mp4|webm))$/i;
const KEYBOARD_PICTURE_NAME = /\.(gif|png|webp|jpe?g|avif|heic|heif|mp4|webm)$/i;

/* ---- what a file is -------------------------------------------------------

   The type a clipboard or a keyboard reports is a claim; the first bytes are
   the file. Both are read, and the bytes win: a sticker pasted from one app
   arrives as "image/png" holding a WebP, and a GIF dragged from another as
   application/octet-stream. */
async function sniffPictureType(blob) {
  const claimed = String(blob?.type || '').toLowerCase();
  let head;
  try {
    head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  } catch (_error) {
    return claimed;
  }
  const ascii = (from, to) => String.fromCharCode(...head.slice(from, to));
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
    return 'video/mp4';
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm';
  return claimed;
}

function isKeyboardPicture(file) {
  if (!file || !file.size) return false;
  const type = String(file.type || '').toLowerCase();
  if (KEYBOARD_PICTURE_TYPE.test(type)) return true;
  /* Dragged and copied files often carry no type at all; their name does. */
  return (!type || type === 'application/octet-stream') && KEYBOARD_PICTURE_NAME.test(file.name || '');
}

function pictureExtension(mime) {
  return ({
    'image/gif': 'gif',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  })[mime] || 'png';
}

/* Whether a still-looking format actually moves. Read from the header, so a
   600 KB animated WebP sticker is never pushed through a canvas, which keeps
   the first frame and throws the rest away. */
async function pictureIsAnimated(blob, mime) {
  let bytes;
  try {
    bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer());
  } catch (_error) {
    return false;
  }
  if (mime === 'image/gif') {
    /* One graphic control extension per frame. */
    let frames = 0;
    for (let i = 0; i < bytes.length - 2; i += 1) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && (frames += 1) > 1) return true;
    }
    return false;
  }
  if (mime === 'image/png') {
    /* APNG: an acTL chunk before the first IDAT. */
    for (let i = 8; i < bytes.length - 4; i += 1) {
      const tag = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
      if (tag === 'acTL') return true;
      if (tag === 'IDAT') return false;
    }
    return false;
  }
  if (mime === 'image/webp') {
    /* Extended WebP: the VP8X flags byte carries an animation bit. */
    return bytes.length > 20 && String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) === 'VP8X'
      && Boolean(bytes[20] & 0x02);
  }
  return false;
}

/* Size, and whether any pixel lets the background through. Sampled small: the
   question is "is this a cut-out", not "which pixels". Null when this engine
   cannot open the picture at all. */
async function measurePicture(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (_error) {
    return null;
  }
  const { width, height } = bitmap;
  let transparent = false;
  try {
    const side = 48;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const paint = canvas.getContext('2d', { willReadFrequently: true });
    paint.drawImage(bitmap, 0, 0, side, side);
    const pixels = paint.getImageData(0, 0, side, side).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 250) { transparent = true; break; }
    }
  } catch (_error) { /* unreadable pixels: judged on size alone */ }
  bitmap.close?.();
  return { width, height, transparent };
}

function looksLikeSticker({ width, height, transparent }) {
  const edge = Math.max(width, height);
  return edge <= PASTED_STICKER_MAX_EDGE || (transparent && edge <= PASTED_CUTOUT_MAX_EDGE);
}

/* Redrawn as a PNG, at most `maxEdge` on its longer side, keeping
   transparency. For formats only some engines read — HEIC, AVIF, Apple's
   adaptive glyph behind a Genmoji — so the other side can draw what arrives,
   and so the HEIC metadata question (30-file-transfer-2.js) is never asked
   about a sticker. Takes a Blob, or an <img> the engine has already decoded,
   which is how a picture the keyboard wrote into the page is read. */
async function rasterisePicture(source, maxEdge = KEYBOARD_STICKER_EDGE) {
  let drawable = null;
  let release = () => {};
  if (source instanceof Blob) {
    try {
      const bitmap = await createImageBitmap(source);
      drawable = bitmap;
      release = () => bitmap.close?.();
    } catch (_error) {
      /* createImageBitmap is pickier than <img> about containers on some
         WebKit builds; an <img> on an object URL is the second try. */
      const url = URL.createObjectURL(source);
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
        drawable = image;
        release = () => URL.revokeObjectURL(url);
      } catch (_decodeError) {
        URL.revokeObjectURL(url);
        return null;
      }
    }
  } else if (source && source.tagName === 'IMG') {
    try { await source.decode(); } catch (_error) { /* may already be decoded */ }
    if (!source.naturalWidth) return null;
    drawable = source;
  } else {
    return null;
  }
  const width = drawable.naturalWidth || drawable.width;
  const height = drawable.naturalHeight || drawable.height;
  if (!width || !height) { release(); return null; }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  try {
    canvas.getContext('2d').drawImage(drawable, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch (_error) {
    /* A picture the page may not read back (a cross-origin source taints the
       canvas) cannot be sent, and saying so beats sending a blank. */
    return null;
  } finally {
    release();
  }
}

/* data: URLs are decoded by hand: the web build's connect-src does not list
   data:, so fetch() would refuse one. */
function pictureFromDataUrl(url) {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is.exec(String(url || ''));
  if (!match) return null;
  try {
    const mime = (match[1] || 'application/octet-stream').toLowerCase();
    if (/;base64/i.test(match[2])) {
      const raw = atob(match[3].replace(/\s+/g, ''));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(match[3])], { type: mime });
  } catch (_error) {
    return null;
  }
}

async function pictureFromUrl(url) {
  if (/^data:/i.test(url)) return pictureFromDataUrl(url);
  if (!/^blob:/i.test(url)) return null;
  try {
    const blob = await (await fetch(url)).blob();
    return blob.size ? blob : null;
  } catch (_error) {
    return null;
  }
}

/* Everything picture-shaped a clipboard, a drop or a keyboard insertion
   carries. files and items name the same file twice in Chromium, so they are
   matched up rather than counted twice. A picture inside pasted HTML is taken
   only when the HTML carries the bytes (a data: URL); one that is merely an
   address stays where it is. */
function picturesIn(dataTransfer) {
  if (!dataTransfer) return [];
  const found = [];
  const seen = new Set();
  const take = (file) => {
    if (!isKeyboardPicture(file)) return;
    const key = `${file.name || ''}|${file.size}|${file.type || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(file);
  };
  Array.from(dataTransfer.files || []).forEach(take);
  Array.from(dataTransfer.items || []).forEach((item) => {
    if (item.kind === 'file') {
      try { take(item.getAsFile()); } catch (_error) { /* an item that will not hand over its file */ }
    }
  });
  if (!found.length) {
    let html = '';
    try { html = dataTransfer.getData('text/html') || ''; } catch (_error) { html = ''; }
    for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](data:(?:image\/(?:gif|png|webp|jpeg)|video\/(?:mp4|webm))[^"']+)["']/gi)) {
      const blob = pictureFromDataUrl(match[1]);
      if (blob && blob.size) found.push(blob);
    }
  }
  return found.slice(0, PASTED_MEDIA_MAX_ITEMS);
}

/* ---- sending ------------------------------------------------------------ */

async function sendGifBlob(blob) {
  if (!blob || !blob.size) return false;
  if (blob.size > GIF_MAX_BYTES) {
    notify(t(`این گیف بزرگ‌تر از ${app().formatBytes(GIF_MAX_BYTES)} است.`, `That GIF is larger than ${app().formatBytes(GIF_MAX_BYTES)}.`), 'warning');
    return false;
  }
  const file = new File([blob], 'animation.gif', { type: 'image/gif' });
  /* Its size travels with it, so the bubble on both sides is the right shape
     before the picture has loaded (mediaWidth / mediaHeight). */
  const size = await measurePicture(blob).catch(() => null);
  await sendEncryptedBlob(file, 'sticker', 0, {
    stickerKind: 'gif',
    stickerEmoji: '',
    ...(size?.width && size?.height ? { mediaWidth: size.width, mediaHeight: size.height } : {}),
  });
  return true;
}

/* A still or animated picture, or a short video, as a sticker. Large stills
   are brought down to 512 px the way an imported sticker is; anything only
   some engines can draw is redrawn as a PNG first. */
async function sendPictureAsSticker(blob, mime) {
  let body = blob;
  let type = mime;
  let kind = 'image';
  if (/^video\//.test(mime)) {
    kind = 'video';
  } else if (!/^image\/(png|webp|jpeg)$/.test(mime)) {
    body = await rasterisePicture(blob);
    type = 'image/png';
  } else if (blob.size > STICKER_RECOMPRESS_OVER && !(await pictureIsAnimated(blob, mime))) {
    body = await normalizeStickerImage(blob, `sticker.${pictureExtension(mime)}`);
    type = String(body?.type || mime).toLowerCase();
  }
  if (!body || !body.size) return false;
  if (body.size > STICKER_MAX_BYTES) {
    notify(t('این استیکر برای ارسال بزرگ است.', 'That sticker is too large to send.'), 'warning');
    return false;
  }
  await sendStickerRecord({
    id: makeStickerId(),
    name: `sticker.${pictureExtension(type)}`,
    mime: type,
    kind,
    emoji: '',
    blob: body,
  });
  return true;
}

/* A large picture pasted on purpose is usually a photograph or a screenshot,
   and turning that into a sticker without asking would be a surprise. */
async function askPhotoOrSticker() {
  return PoorijaDialogs.choose(
    t('این تصویر بزرگ است. چطور فرستاده شود؟', 'This is a large picture. How should it go?'),
    [
      { value: 'photo', label: t('ارسال به‌صورت عکس', 'Send as a photo'), hint: t('با کیفیت کامل، مثل یک فایل', 'full quality, as a file') },
      { value: 'sticker', label: t('ارسال به‌صورت استیکر', 'Send as a sticker'), hint: t('کوچک می‌شود، بدون حباب پیام', 'made small, without a bubble') },
    ],
    { cancelLabel: t('انصراف', 'Cancel') },
  );
}

/* `origin` is where it came from: 'keyboard' (a keyboard put it in a field —
   always meant as a sticker), 'paste' or 'drop'. Resolves true when it went,
   false when it could not be used, null when the person backed out. */
async function sendOnePicture(file, origin) {
  const mime = await sniffPictureType(file);
  if (mime === 'image/gif') return sendGifBlob(file);
  if (/^video\/(mp4|webm)$/.test(mime)) {
    /* A short clip is what a keyboard calls a GIF on some phones; a long one
       is a video, and goes as the file it is. */
    if (file.size <= STICKER_MAX_BYTES) return sendPictureAsSticker(file, mime);
    await sendFile(file);
    return true;
  }
  if (!/^image\//.test(mime) || /svg/.test(mime)) return false;
  if (origin !== 'keyboard' && !(await pictureIsAnimated(file, mime))) {
    const measured = await measurePicture(file);
    if (measured && !looksLikeSticker(measured)) {
      const choice = await askPhotoOrSticker();
      if (!choice) return null;
      if (choice === 'photo') {
        const named = file.name ? file : new File([file], `photo.${pictureExtension(mime)}`, { type: mime });
        await sendFile(named);
        return true;
      }
    }
  }
  return sendPictureAsSticker(file, mime);
}

/* One at a time, in order: each send owns the transfer banner and the data
   channel, the same reason the gallery and the sticker selection go one by
   one. */
async function sendPastedPictures(files, { origin = 'paste' } = {}) {
  const items = (files || []).filter(Boolean).slice(0, PASTED_MEDIA_MAX_ITEMS);
  if (!items.length) return 0;
  if (!getActiveConversation()) {
    notify(t('اول یک گفتگو را باز کنید.', 'Open a conversation first.'), 'warning');
    return 0;
  }
  /* What a keyboard sends is always a sticker or a GIF, so its permission is
     known up front. A paste may turn out to be a photo, which a group can
     allow when it does not allow stickers — sendEncryptedBlob asks per item. */
  if (origin === 'keyboard' && !guardGroupSend('sendStickers')) return 0;
  let sent = 0;
  let unusable = 0;
  for (const file of items) {
    try {
      const outcome = await sendOnePicture(file, origin);
      if (outcome === true) sent += 1;
      else if (outcome === false) unusable += 1;
      else if (outcome === null) break;
    } catch (error) {
      console.warn('[GIF] a pasted picture did not send', error);
      unusable += 1;
    }
  }
  if (unusable) {
    notify(t('این تصویر قابل خواندن نبود و فرستاده نشد.', 'That picture could not be read and was not sent.'), 'warning');
  }
  return sent;
}

/* ---- the message box ---------------------------------------------------- */

const keyboardPicturesWanted = (() => {
  const agent = navigator.userAgent || '';
  /* Chromium on Android only. -webkit-user-modify is a WebKit/Blink
     property; nothing else needs it, and nothing else is promised by it. */
  return /Android/i.test(agent) && /Chrome\//.test(agent) && !/Firefox\//.test(agent);
})();
if (keyboardPicturesWanted) document.documentElement.classList.add('keyboard-pictures');

function bindComposerPictureInput() {
  const composer = document.getElementById('chatComposer');
  if (!composer || composer.dataset.picturesBound) return;
  composer.dataset.picturesBound = '1';

  composer.addEventListener('paste', (event) => {
    const clipboard = event.clipboardData;
    /* Copying from a document or a spreadsheet puts a picture of the
       selection on the clipboard beside its text, and what was wanted is the
       words. Rich text alongside is the tell. */
    let text = '';
    try { text = clipboard?.getData('text/plain') || ''; } catch (_error) { text = ''; }
    if (text.trim() && Array.from(clipboard?.types || []).includes('text/rtf')) return;
    const pictures = picturesIn(clipboard);
    if (!pictures.length) return;
    event.preventDefault();
    sendPastedPictures(pictures, { origin: 'paste' });
  });

  /* Where a keyboard hands its picture over as an input rather than a paste. */
  composer.addEventListener('beforeinput', (event) => {
    const pictures = picturesIn(event.dataTransfer);
    if (!pictures.length) return;
    event.preventDefault();
    sendPastedPictures(pictures, { origin: 'keyboard' });
  });

  /* A picture the box could not hold becomes U+FFFC — the object replacement
     character — in a field that only keeps text. Nothing of the picture is
     left to send from here, so the character is taken back out and the
     keyboard box is offered instead, where the same tap does work. */
  composer.addEventListener('input', (event) => {
    if (event.isComposing || !composer.value.includes('￼')) return;
    const caret = composer.selectionStart;
    const before = composer.value.slice(0, caret).replace(/￼/g, '');
    composer.value = before + composer.value.slice(caret).replace(/￼/g, '');
    composer.setSelectionRange(before.length, before.length);
    openKeyboardCatcher();
  });

  /* Dropping files on the message box. Pictures go the way a paste does;
     anything else is sent as the file it is — taken over from the browser,
     which would otherwise open the file in place of the app. */
  const surface = composer.closest('.chat-composer-surface') || composer;
  const carriesFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  ['dragenter', 'dragover'].forEach((name) => surface.addEventListener(name, (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    surface.classList.add('is-dropping');
  }));
  ['dragleave', 'dragend'].forEach((name) => surface.addEventListener(name, (event) => {
    if (event.relatedTarget && surface.contains(event.relatedTarget)) return;
    surface.classList.remove('is-dropping');
  }));
  surface.addEventListener('drop', async (event) => {
    const files = Array.from(event.dataTransfer?.files || []);
    surface.classList.remove('is-dropping');
    if (!files.length) return;
    event.preventDefault();
    const pictures = files.filter(isKeyboardPicture);
    const others = files.filter((file) => !pictures.includes(file));
    if (pictures.length) await sendPastedPictures(pictures, { origin: 'drop' });
    for (const file of others) {
      try {
        await sendFile(file);
      } catch (error) {
        console.error('[Chat] a dropped file did not send', file.name, error);
        notify(t(`ارسال نشد: ${file.name}`, `Could not send: ${file.name}`), 'error');
      }
    }
  });
}

/* ---- the keyboard box --------------------------------------------------- */

/* A text box the keyboard treats as rich, inside the sticker panel. It never
   keeps anything: a picture is sent, text is handed to the message box. */
function keyboardCatcher() {
  return document.getElementById('chatKeyboardCatcher');
}

function moveTextToComposer(text) {
  const composer = document.getElementById('chatComposer');
  const clean = String(text || '').replace(/￼/g, '');
  if (!composer || !clean.trim()) return;
  composer.value += clean;
  composer.dispatchEvent(new Event('input', { bubbles: true }));
}

let catcherDraining = false;
let catcherAgain = false;
let catcherTextNoticeShown = false;

/* Reads back whatever the keyboard wrote into the box. Pictures are read
   before they are removed — a blob: address the engine minted for the
   insertion may not outlive its element — and each node is removed as it is
   used, so a second sticker tapped while the first is still being read is
   not swept away with it. */
async function drainKeyboardCatcher() {
  const box = keyboardCatcher();
  if (!box) return;
  if (catcherDraining) { catcherAgain = true; return; }
  catcherDraining = true;
  try {
    do {
      catcherAgain = false;
      const images = Array.from(box.querySelectorAll('img'));
      const pictures = [];
      for (const image of images) {
        const source = image.currentSrc || image.getAttribute('src') || '';
        let blob = await pictureFromUrl(source);
        const type = blob ? await sniffPictureType(blob) : '';
        /* A Genmoji or a HEIC sticker is drawn from the element itself: the
           engine has already decoded it, which is more than every engine can
           say about the bytes behind it. */
        if (!/^(image\/(gif|png|webp|jpeg)|video\/(mp4|webm))$/.test(type)) blob = (await rasterisePicture(image)) || blob;
        if (blob) pictures.push(blob);
        (image.closest('picture') || image).remove();
      }
      const text = (box.textContent || '').replace(/￼/g, '');
      if (!box.querySelector('img')) box.innerHTML = '';
      if (text.trim()) {
        moveTextToComposer(text);
        /* Said once: somebody typing here would otherwise get a toast for
           every letter. */
        if (!catcherTextNoticeShown) {
          catcherTextNoticeShown = true;
          notify(t('متن به کادر پیام منتقل شد؛ این کادر فقط برای استیکر و گیف است.', 'The text went to the message box; this box is only for stickers and GIFs.'), 'info');
        }
      }
      if (pictures.length) await sendPastedPictures(pictures, { origin: 'keyboard' });
      else if (images.length) notify(t('این استیکر قابل خواندن نبود.', 'That sticker could not be read.'), 'warning');
    } while (catcherAgain);
  } finally {
    catcherDraining = false;
  }
}

function bindKeyboardCatcher() {
  const box = keyboardCatcher();
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  /* When the clipboard or the keyboard hands over the file, it is taken here
     and the browser inserts nothing. When it does not — some insertions only
     show up as an element written into the box — the insertion is let
     through and drainKeyboardCatcher() reads it back off the page. A picture
     that is only a remote address never loads (the page's img-src forbids
     it, before any request is made) and is dropped with a word. */
  box.addEventListener('paste', (event) => {
    const pictures = picturesIn(event.clipboardData);
    if (!pictures.length) return;
    event.preventDefault();
    sendPastedPictures(pictures, { origin: 'keyboard' });
  });
  box.addEventListener('beforeinput', (event) => {
    const pictures = picturesIn(event.dataTransfer);
    if (!pictures.length) return;
    event.preventDefault();
    sendPastedPictures(pictures, { origin: 'keyboard' });
  });
  box.addEventListener('drop', (event) => {
    event.preventDefault();
    const pictures = picturesIn(event.dataTransfer);
    if (pictures.length) sendPastedPictures(pictures, { origin: 'drop' });
  });
  /* Enter in this box sends nothing and should not leave a line break. */
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  /* A MutationObserver rather than the input event alone: a sticker or a
     Genmoji written in by the keyboard does not always come with one. */
  new MutationObserver(() => {
    if (box.querySelector('img') || (box.textContent || '').trim()) {
      /* Typing in a language that composes characters is left to finish. */
      if (box.dataset.composing) return;
      queueMicrotask(drainKeyboardCatcher);
    }
  }).observe(box, { childList: true, subtree: true, characterData: true });
  box.addEventListener('compositionstart', () => { box.dataset.composing = '1'; });
  box.addEventListener('compositionend', () => {
    delete box.dataset.composing;
    queueMicrotask(drainKeyboardCatcher);
  });
}

/* Opens the sticker panel with the keyboard box ready, from wherever a
   sticker tapped into the message box was lost. */
function openKeyboardCatcher() {
  const panel = document.getElementById('chatStickerPanel');
  if (panel?.classList.contains('hidden')) setStickerPanelVisible(true);
  const box = keyboardCatcher();
  if (!box) return;
  box.closest('.chat-keyboard-catcher-row')?.classList.add('is-wanted');
  try { box.focus({ preventScroll: true }); } catch (_error) { box.focus(); }
  notify(t('استیکرهای کیبورد را این‌جا بزنید؛ در کادر پیام جا نمی‌شوند.', 'Tap keyboard stickers in this box; the message box cannot hold them.'), 'info');
}

/* ---- the saved GIFs ----------------------------------------------------- */

function gifLibraryRecords() {
  return chatState.gifLibrary?.stickers || [];
}

function ensureGifLibrary() {
  if (!chatState.gifLibrary) {
    chatState.gifLibrary = {
      id: GIF_LIBRARY_ID,
      title: 'GIFs',
      author: '',
      source: 'gif-library',
      createdAt: new Date().toISOString(),
      stickers: [],
    };
  }
  return chatState.gifLibrary;
}

/* The same GIF saved twice is one GIF: named by its content, not by the
   message it came from. */
async function gifContentHash(blob) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function forgetGifUrl(record) {
  const url = chatState.stickerUrls.get(record.id);
  if (!url) return;
  URL.revokeObjectURL(url);
  chatState.stickerUrls.delete(record.id);
}

/* Most recent first, so the shelf opens on what was used last. Returns
   'added', 'moved' (it was already there) or '' when it could not be kept. */
async function saveGif(blob) {
  if (!blob?.size) return '';
  if (blob.size > GIF_MAX_BYTES) {
    notify(t(`گیف‌های بزرگ‌تر از ${app().formatBytes(GIF_MAX_BYTES)} نگه داشته نمی‌شوند.`, `GIFs larger than ${app().formatBytes(GIF_MAX_BYTES)} are not kept.`), 'warning');
    return '';
  }
  const library = ensureGifLibrary();
  const hash = await gifContentHash(blob);
  const existing = library.stickers.find((record) => record.hash === hash);
  if (existing) {
    noteGifUsed(existing.id);
    library.stickers = [existing, ...library.stickers.filter((record) => record !== existing)];
  } else {
    const record = {
      id: makeStickerId(),
      name: 'animation.gif',
      mime: 'image/gif',
      kind: 'gif',
      emoji: '',
      hash,
      addedAt: new Date().toISOString(),
      blob: blob.type === 'image/gif' ? blob : new Blob([blob], { type: 'image/gif' }),
    };
    /* Its still, and its bytes told to loop forever (56-sticker-motion.js);
       the hash stays the original's, so saving the same GIF again still
       finds this one. */
    if (typeof upkeepStickerRecord === 'function') await upkeepStickerRecord(record);
    library.stickers.unshift(record);
  }
  /* Oldest out first, past either ceiling. */
  let bytes = library.stickers.reduce((sum, record) => sum + (record.blob?.size || 0), 0);
  while (library.stickers.length > 1
    && (library.stickers.length > GIF_LIBRARY_MAX_ITEMS || bytes > GIF_LIBRARY_MAX_BYTES)) {
    const dropped = library.stickers.pop();
    bytes -= dropped.blob?.size || 0;
    forgetGifUrl(dropped);
  }
  await stickerDbPutPack(library);
  if (chatState.stickerPanelMode === 'gifs') renderStickerPanel();
  renderStorageCard().catch(() => {});
  return existing ? 'moved' : 'added';
}

async function removeSavedGif(recordId) {
  const library = chatState.gifLibrary;
  const record = library?.stickers.find((item) => item.id === recordId);
  if (!record) return;
  library.stickers = library.stickers.filter((item) => item !== record);
  forgetGifUrl(record);
  await stickerDbPutPack(library);
  renderStickerPanel();
  renderStorageCard().catch(() => {});
}

async function importGifFiles(fileList) {
  const files = Array.from(fileList || []);
  let added = 0;
  let refused = 0;
  for (const file of files) {
    try {
      if (await sniffPictureType(file) !== 'image/gif') { refused += 1; continue; }
      if (await saveGif(file)) added += 1;
      else refused += 1;
    } catch (error) {
      console.warn('[GIF] import failed', file.name, error);
      refused += 1;
    }
  }
  if (added) notify(t(`${added} گیف ذخیره شد.`, `${added} GIF(s) saved.`), 'success');
  if (refused) notify(t('فقط فایل‌های GIF به این قفسه اضافه می‌شوند.', 'Only GIF files can be added to this shelf.'), 'warning');
}

/* The bookmark on a sticker or GIF somebody sent (27-message-render.js). */
async function keepStickerFromMessage(entry) {
  const url = safeMediaUrl(entry?.downloadUrl);
  const blob = url ? await pictureFromUrl(url) : null;
  if (!blob) {
    notify(t('این مورد روی این دستگاه نیست.', 'This is not on this device.'), 'warning');
    return;
  }
  if (isGifEntry(entry)) {
    const result = await saveGif(blob);
    if (result === 'added') notify(t('در گیف‌های شما ذخیره شد.', 'Saved to your GIFs.'), 'success');
    else if (result === 'moved') notify(t('این گیف از قبل ذخیره شده بود.', 'That GIF was already saved.'), 'info');
    return;
  }
  /* A sticker joins "My stickers" through the importer, which already knows
     every sticker format and where loose stickers belong. */
  let name = String(entry.name || '').split('/').pop();
  if (!stickerEntryIsUsable(name)) name = `sticker.${pictureExtension(await sniffPictureType(blob))}`;
  await importStickerFiles([new File([blob], name, { type: blob.type || '' })]);
}

/* ---- the GIF shelf ------------------------------------------------------ */

/* Which shelf the panel shows, and the parts of the panel that belong to only
   one of them. Called from renderStickerPanel(). */
function syncStickerPanelShelf() {
  const panel = document.getElementById('chatStickerPanel');
  if (!panel) return;
  const gifs = chatState.stickerPanelMode === 'gifs';
  panel.classList.toggle('is-gif-shelf', gifs);
  panel.querySelectorAll('[data-chat-panel-shelf]').forEach((button) => {
    const on = button.getAttribute('data-chat-panel-shelf') === (gifs ? 'gifs' : 'stickers');
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  ['chatStickerImportBtn', 'chatStickerPacksBtn'].forEach((id) => {
    document.getElementById(id)?.classList.toggle('hidden', gifs);
  });
  document.getElementById('chatGifImportBtn')?.classList.toggle('hidden', !gifs);
  document.getElementById('chatGifHelpBtn')?.classList.toggle('hidden', !gifs);
  document.getElementById('chatStickerTabs')?.classList.toggle('hidden', gifs);
  document.getElementById('chatStickerGrid')?.classList.toggle('is-gif-shelf', gifs);
  if (gifs && !gifPickActive()) document.getElementById('chatStickerSelbar')?.classList.add('hidden');
}

/* ---- picking GIFs -------------------------------------------------------
 *
 * The GIF shelf picks the way the sticker shelf does: a long press, or the
 * panel's select button, and then each tap adds or drops one. What is picked
 * can be sent, deleted, or copied into a sticker pack. */
const gifSelection = new Set();
let gifPickMode = false;
function gifPickActive() { return gifPickMode || gifSelection.size > 0; }
function setGifPickMode(on) {
  gifPickMode = Boolean(on);
  if (!gifPickMode) gifSelection.clear();
}
function toggleGifPicked(id) {
  if (gifSelection.has(id)) gifSelection.delete(id);
  else gifSelection.add(id);
}
function pickedGifRecords() {
  return gifShelfOrder(gifLibraryRecords()).filter((record) => gifSelection.has(record.id));
}
function renderGifSelbar() {
  const bar = document.getElementById('chatStickerSelbar');
  if (!bar) return;
  const picking = gifPickActive();
  bar.classList.toggle('hidden', !picking);
  const off = gifSelection.size ? '' : 'disabled';
  bar.innerHTML = picking ? `
      <span class="chat-sticker-selcount">${gifSelection.size} ${app().escapeHTML(t('گیف انتخاب‌شده', 'GIF(s) selected'))}</span>
      <button type="button" data-chat-gif-send-picked class="chat-sticker-selbtn is-primary" ${off}><i class="fas fa-paper-plane"></i> ${app().escapeHTML(t('ارسال', 'Send'))}</button>
      <button type="button" data-chat-gif-copy-picked class="chat-sticker-selbtn" ${off}><i class="fas fa-copy"></i> ${app().escapeHTML(t('کپی در پک استیکر…', 'Copy to a sticker pack…'))}</button>
      <button type="button" data-chat-gif-delete-picked class="chat-sticker-selbtn is-danger" ${off}><i class="fas fa-trash"></i> ${app().escapeHTML(t('حذف', 'Delete'))}</button>
      <button type="button" data-chat-gif-end-pick class="chat-sticker-selbtn"><i class="fas fa-xmark"></i> ${app().escapeHTML(t('لغو', 'Done'))}</button>` : '';
}
async function deletePickedGifs() {
  const picked = pickedGifRecords();
  const library = chatState.gifLibrary;
  if (!picked.length || !library) return 0;
  library.stickers = library.stickers.filter((record) => !gifSelection.has(record.id));
  picked.forEach(forgetGifUrl);
  await stickerDbPutPack(library);
  setGifPickMode(false);
  renderStickerPanel();
  renderStorageCard().catch(() => {});
  return picked.length;
}
async function copyPickedGifsToPack() {
  const picked = pickedGifRecords();
  if (!picked.length) return null;
  const target = await chooseStickerPackFor({ question: t(`${picked.length} گیف در کدام پک استیکر کپی شود؟`, `Copy ${picked.length} GIF(s) into which sticker pack?`) });
  if (!target || target === '__gifs__') return null;
  let done = 0;
  for (const record of picked) {
    if (target.stickers.length >= STICKER_MAX_PER_PACK) break;
    target.stickers.push({ id: makeStickerId(), name: 'animation.gif', mime: 'image/gif', kind: 'image', emoji: '', blob: record.blob });
    done += 1;
  }
  await stickerDbPutPack(target);
  setGifPickMode(false);
  renderStickerPanel();
  renderStorageCard().catch(() => {});
  return { done, skipped: picked.length - done, title: target.title };
}
async function sendPickedGifs() {
  const picked = pickedGifRecords();
  if (!picked.length || !guardGroupSend('sendStickers')) return 0;
  setGifPickMode(false);
  renderStickerPanel();
  let sent = 0;
  for (const record of picked) {
    try {
      if (await sendGifBlob(record.blob)) { noteGifUsed(record.id); sent += 1; }
    } catch (error) { console.warn('[GIF] one GIF did not send', error); }
  }
  return sent;
}

/* Used last, shown first — decided when the shelf is drawn, not when a GIF is
   sent: moving the GIF under the finger to the top and redrawing is what
   threw the shelf back to its first row on every send. */
/* When each GIF was last sent, kept apart from the GIFs: writing the library
   to note it is what threw away every picture on an iPhone (stickerDbPutPack).
   Ids and times only, in this device's storage. */
const GIF_USED_KEY = 'poorija_gif_used';
function gifUsedTimes() {
  try { return JSON.parse(localStorage.getItem(GIF_USED_KEY) || '{}') || {}; } catch (_error) { return {}; }
}
function noteGifUsed(id) {
  const times = gifUsedTimes();
  times[id] = Date.now();
  const kept = Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, GIF_LIBRARY_MAX_ITEMS * 2);
  try { localStorage.setItem(GIF_USED_KEY, JSON.stringify(Object.fromEntries(kept))); } catch (_error) { /* private mode */ }
}
function gifShelfOrder(records) {
  const used = gifUsedTimes();
  const stamp = (record) => Number(used[record.id] || 0) || Number(record.usedAt || 0) || Date.parse(record.addedAt || 0) || 0;
  return records.slice().sort((a, b) => stamp(b) - stamp(a));
}
function renderGifShelf() {
  const grid = document.getElementById('chatStickerGrid');
  if (!grid) return;
  /* The sticker shelf keeps its last cells to skip a redraw that changes
     nothing (renderStickerPanel); this shelf writes over them. */
  grid.__html = '';
  const keepScroll = grid.classList.contains('is-gif-shelf') ? grid.scrollTop : 0;
  const managing = Boolean(chatState.stickerManageMode);
  grid.classList.toggle('is-managing', managing);
  const records = gifShelfOrder(gifLibraryRecords());
  /* A pick of something that has since gone is no pick. */
  [...gifSelection].forEach((id) => { if (!records.some((record) => record.id === id)) gifSelection.delete(id); });
  const picking = gifPickActive();
  grid.classList.toggle('is-picking', picking);
  renderGifSelbar();
  grid.classList.toggle('is-empty', !records.length);
  if (!records.length) {
    grid.innerHTML = `<div class="chat-sticker-empty">
      <i class="fas fa-photo-film"></i>
      <div class="chat-sticker-empty-title">${app().escapeHTML(t('هنوز گیفی ذخیره نشده', 'No saved GIFs yet'))}</div>
      <div class="chat-sticker-empty-note">${app().escapeHTML(t(
        'گیف را در کادر پیام پیست کنید یا از کیبورد انتخاب کنید تا فرستاده شود. برای نگه داشتن، روی گیف داخل گفتگو نشانک را بزنید یا فایل .gif وارد کنید.',
        'Paste a GIF into the message box, or pick one on your keyboard, to send it. To keep one here, tap the bookmark on a GIF in a conversation, or import .gif files.'))}</div>
      <button type="button" data-chat-gif-import class="chat-sticker-empty-btn"><i class="fas fa-file-import"></i> ${app().escapeHTML(t('وارد کردن گیف', 'Import GIFs'))}</button>
      <button type="button" data-chat-gif-help class="chat-sticker-empty-btn"><i class="fas fa-circle-question"></i> ${app().escapeHTML(t('گیف از کیبورد گوشی', 'GIFs from the phone keyboard'))}</button>
    </div>`;
    return;
  }
  grid.innerHTML = records.map((record) => `<button type="button" class="chat-gif-cell ${gifSelection.has(record.id) ? 'is-picked' : ''}" data-chat-gif-send="${app().escapeHTML(record.id)}" title="GIF">
      ${record.thumb instanceof Blob ? `<img class="chat-gif-still" src="${app().escapeHTML(stickerThumbUrl(record))}" alt="" draggable="false" decoding="async">` : ''}
      ${stickerMediaHtml(stickerObjectUrl(record), 'gif', record.thumb instanceof Blob ? 'chat-gif-thumb is-motion' : 'chat-gif-thumb', { lazy: true })}
      ${picking ? '<span class="chat-sticker-tick chat-gif-tick"><i class="fas fa-check"></i></span>' : ''}
      ${managing ? `<span class="chat-gif-remove" data-chat-gif-remove="${app().escapeHTML(record.id)}" role="button" tabindex="0"
        title="${app().escapeHTML(t('حذف از گیف‌ها', 'Remove from GIFs'))}"><i class="fas fa-xmark"></i></span>` : ''}
    </button>`).join('');
  grid.scrollTop = keepScroll;
  /* A hundred GIFs all moving at once is a hundred decoders running: only
     the ones on screen are given their picture (observeLazyMedia), over a
     still of each that is there at once. The stills, and every GIF told to
     loop forever, are made in the background (ensurePackThumbs). */
  observeLazyMedia(grid);
  if (chatState.gifLibrary) ensurePackThumbs(chatState.gifLibrary).catch(() => {});
}

/* The guide, from the same entry the Help tab shows (js/help-content.js), so
   the two can never say different things. The steps are numbered here; the
   dialog keeps line breaks. */
function showGifKeyboardGuide() {
  const lang = app().state?.language === 'en' ? 'en' : 'fa';
  const entry = (window.PoorijaHelp?.ENTRIES || []).find((item) => item.id === 'gifs-keyboard');
  const text = entry?.[lang];
  if (!text) return;
  const digits = (n) => (lang === 'fa' ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]) : String(n));
  const steps = (text.steps || []).map((step, index) => `${digits(index + 1)}. ${step}`).join('\n\n');
  PoorijaDialogs.alert(`${text.b}\n\n${steps}`, { title: text.t });
}

function toggleGifShelf() {
  const panel = document.getElementById('chatStickerPanel');
  if (!panel) return;
  if (!panel.classList.contains('hidden') && chatState.stickerPanelMode === 'gifs') {
    setStickerPanelVisible(false);
    return;
  }
  setStickerPanelVisible(true, { shelf: 'gifs' });
}

function bindGifShelf() {
  const panel = document.getElementById('chatStickerPanel');
  if (!panel || panel.dataset.gifShelfBound) return;
  panel.dataset.gifShelfBound = '1';
  panel.addEventListener('click', async (event) => {
    const shelf = event.target.closest('[data-chat-panel-shelf]');
    if (shelf) {
      setGifPickMode(false);
      if (typeof clearStickerSelection === 'function') clearStickerSelection();
      chatState.stickerPanelMode = shelf.getAttribute('data-chat-panel-shelf') === 'gifs' ? 'gifs' : 'stickers';
      chatState.stickerManageMode = false;
      document.getElementById('chatStickerManageBtn')?.classList.remove('is-active');
      renderStickerPanel();
      return;
    }
    if (event.target.closest('#chatGifHelpBtn') || event.target.closest('[data-chat-gif-help]')) {
      showGifKeyboardGuide();
      return;
    }
    if (event.target.closest('[data-chat-gif-import]') || event.target.closest('#chatGifImportBtn')) {
      document.getElementById('chatGifInput')?.click();
      return;
    }
    /* The cross sits inside the cell, so it is handled first: otherwise
       removing a GIF would send it. */
    const remove = event.target.closest('[data-chat-gif-remove]');
    if (remove) {
      event.preventDefault();
      event.stopPropagation();
      await removeSavedGif(remove.getAttribute('data-chat-gif-remove'));
      notify(t('از گیف‌ها حذف شد.', 'Removed from your GIFs.'), 'info');
      return;
    }
    if (event.target.closest('[data-chat-gif-end-pick]')) {
      setGifPickMode(false);
      renderStickerPanel();
      return;
    }
    if (event.target.closest('[data-chat-gif-send-picked]')) {
      const sent = await sendPickedGifs();
      if (sent) notify(t(`${sent} گیف فرستاده شد.`, `${sent} GIF(s) sent.`), 'success');
      return;
    }
    if (event.target.closest('[data-chat-gif-delete-picked]')) {
      const count = gifSelection.size;
      if (!count || !await PoorijaDialogs.confirm(t(`${count} گیف حذف شود؟`, `Delete ${count} GIF(s)?`),
        { okLabel: t('حذف', 'Delete'), cancelLabel: t('انصراف', 'Cancel'), danger: true })) return;
      const removed = await deletePickedGifs();
      notify(t(`${removed} گیف حذف شد.`, `${removed} GIF(s) deleted.`), 'success');
      return;
    }
    if (event.target.closest('[data-chat-gif-copy-picked]')) {
      const result = await copyPickedGifsToPack();
      if (result) {
        notify(t(`${result.done} گیف در «${result.title}» کپی شد.${result.skipped ? ` ${result.skipped} مورد جا نشد.` : ''}`,
          `${result.done} GIF(s) copied into "${result.title}".${result.skipped ? ` ${result.skipped} did not fit.` : ''}`), result.done ? 'success' : 'warning');
      }
      return;
    }
    const cell = event.target.closest('[data-chat-gif-send]');
    if (!cell) return;
    if (gifPickActive()) {
      toggleGifPicked(cell.getAttribute('data-chat-gif-send'));
      renderStickerPanel();
      return;
    }
    const record = gifLibraryRecords().find((item) => item.id === cell.getAttribute('data-chat-gif-send'));
    if (!record?.blob) return;
    if (!guardGroupSend('sendStickers')) return;
    cell.classList.add('is-sending');
    try {
      if (await sendGifBlob(record.blob)) {
        /* Noted, not acted on: the shelf reorders the next time it opens
           (gifShelfOrder), so the GIF stays where the finger is — and the
           library is not written for it. */
        noteGifUsed(record.id);
      }
    } catch (error) {
      console.error('[GIF] send failed', error);
      notify(t('ارسال گیف ناموفق بود.', 'Sending the GIF failed.'), 'error');
    } finally {
      cell.classList.remove('is-sending');
    }
  });
  /* A long press, or a right click on a desktop, starts picking with the GIF
     under the finger — the same gesture the sticker shelf answers to. */
  let holdTimer = 0;
  const beginPick = (target) => {
    const cell = target?.closest?.('[data-chat-gif-send]');
    if (!cell || chatState.stickerPanelMode !== 'gifs' || gifPickActive()) return;
    gifSelection.add(cell.getAttribute('data-chat-gif-send'));
    renderStickerPanel();
    navigator.vibrate?.(15);
  };
  panel.addEventListener('pointerdown', (event) => {
    clearTimeout(holdTimer);
    const target = event.target;
    holdTimer = setTimeout(() => beginPick(target), 420);
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'pointermove'].forEach((name) => panel.addEventListener(name, () => clearTimeout(holdTimer)));
  panel.addEventListener('contextmenu', (event) => {
    if (!event.target.closest?.('[data-chat-gif-send]')) return;
    event.preventDefault();
    beginPick(event.target);
  });
  document.getElementById('chatGifInput')?.addEventListener('change', async (event) => {
    /* Copied before the reset: `files` is live and clearing value empties it. */
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await importGifFiles(files);
  });
}

/* ---- wiring --------------------------------------------------------------- */

function bindGifsAndKeyboardStickers() {
  bindComposerPictureInput();
  bindKeyboardCatcher();
  bindGifShelf();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindGifsAndKeyboardStickers);
else bindGifsAndKeyboardStickers();
window.addEventListener('poorija:language-changed', () => {
  if (!document.getElementById('chatStickerPanel')?.classList.contains('hidden')) renderStickerPanel();
});

/* Reachable from a test: the functions above live in this file's scope, and
   the CSP forbids eval. Nothing here does what a person could not. */
window.__gifProbe = {
  library: () => gifLibraryRecords().map((record) => ({ id: record.id, size: record.blob?.size || 0, hash: record.hash })),
  save: (blob) => saveGif(blob),
  remove: (id) => removeSavedGif(id),
  sniff: (blob) => sniffPictureType(blob),
  animated: (blob, mime) => pictureIsAnimated(blob, mime),
  measure: (blob) => measurePicture(blob),
  send: (files, origin) => sendPastedPictures(files, { origin }),
  keyboardPictures: () => keyboardPicturesWanted,
  pick: (id) => { toggleGifPicked(id); renderStickerPanel(); },
  picked: () => [...gifSelection],
  pickMode: (on) => { setGifPickMode(on); renderStickerPanel(); },
};
