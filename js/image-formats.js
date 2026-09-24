/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Opening the pictures a phone camera actually produces.
 *
 * An iPhone shoots HEIC by default and any camera in raw mode writes DNG.
 * Both are what somebody has when they go to set a profile picture, and
 * neither can be drawn by most browsers: WebKit decodes HEIC, Chromium does
 * not, and no engine decodes DNG at all. The app used `new Image()` on the
 * file and waited for onload, which for these never fires -- so the picture
 * was chosen, nothing happened, and nothing said why.
 *
 * WHY THERE IS NO DECODER HERE
 *
 * Decoding HEIC properly means libheif compiled to WebAssembly, and decoding
 * raw sensor data means LibRaw. Together that is several megabytes added to
 * every platform to serve a case that has a much cheaper answer: both formats
 * are containers that already hold a finished JPEG. A DNG carries preview
 * images in its TIFF directories, and a HEIC carries its Exif thumbnail and
 * frequently a full-size rendition beside the HEVC data. Pulling that out is
 * parsing, not decoding.
 *
 * It is a preview rather than the raw image, which for a profile picture and a
 * chat attachment is the right thing anyway -- nobody wants a 40MB sensor dump
 * as an avatar. When a file genuinely has no embedded preview, this says so
 * rather than failing silently, which is the part that was actually broken.
 */

(function () {
  'use strict';

  /* A JPEG begins FF D8 FF and ends FF D9. Scanning for that pair is how the
     preview is found without understanding either container's box structure --
     which differ completely between HEIC and DNG and would otherwise mean two
     parsers to maintain for one answer. */
  const SOI = [0xFF, 0xD8, 0xFF];

  /** Smaller than this is an icon, not a picture worth showing. */
  const MIN_PREVIEW_BYTES = 8 * 1024;

  function looksLikeHeic(bytes) {
    // ISOBMFF: a 4-byte size, then 'ftyp', then a brand. heic, heix, hevc,
    // mif1 and msf1 all reach this code path from an iPhone.
    if (bytes.length < 12) return false;
    const tag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (tag !== 'ftyp') return false;
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    return /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand);
  }

  function looksLikeDng(bytes) {
    // TIFF: II* or MM* in the first four bytes. A DNG is a TIFF with extra
    // tags, so this also catches plain raw TIFFs, which is fine -- they have
    // embedded previews too and are equally undrawable.
    if (bytes.length < 4) return false;
    const little = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00;
    const big = bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0x00 && bytes[3] === 0x2A;
    return little || big;
  }

  /**
   * Finds the largest complete JPEG inside a container.
   *
   * The largest rather than the first: a DNG usually holds several previews at
   * different sizes and the small one comes first, so taking the first would
   * quietly give somebody a 160-pixel avatar from a 24-megapixel photograph.
   */
  function findLargestEmbeddedJpeg(bytes) {
    let best = null;
    for (let i = 0; i + 3 < bytes.length; i += 1) {
      if (bytes[i] !== SOI[0] || bytes[i + 1] !== SOI[1] || bytes[i + 2] !== SOI[2]) continue;
      // Walk forward for the matching end marker.
      for (let j = i + 3; j + 1 < bytes.length; j += 1) {
        if (bytes[j] !== 0xFF || bytes[j + 1] !== 0xD9) continue;
        const length = j + 2 - i;
        if (length >= MIN_PREVIEW_BYTES && (!best || length > best.length)) {
          best = { start: i, length };
        }
        i = j + 1;
        break;
      }
    }
    return best ? bytes.subarray(best.start, best.start + best.length) : null;
  }

  function isCameraContainer(file, bytes) {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    if (/\.(heic|heif|dng|arw|cr2|cr3|nef|orf|rw2|raf)$/.test(name)) return true;
    if (/heic|heif|dng|x-adobe-dng|tiff|raw/.test(type)) return true;
    return looksLikeHeic(bytes) || looksLikeDng(bytes);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('unreadable'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Turns any picture file into something a canvas can draw.
   *
   * @returns {Promise<{dataUrl: string, converted: boolean}>}
   * @throws when the file holds no picture this app can reach, with a message
   *   worth showing somebody -- the silent nothing is what was wrong before.
   */
  async function toDrawableDataUrl(file) {
    if (!file) throw new Error('no file');

    /* The engine first. WebKit decodes HEIC natively, so on macOS and iOS the
       whole container dance is unnecessary and the full-quality image is
       already available. */
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        bitmap.close?.();
        return { dataUrl: await blobToDataUrl(file), converted: false };
      } catch (_error) { /* the engine cannot read it; try the container */ }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isCameraContainer(file, bytes)) {
      // Not a format this module is for. Hand it back and let the caller's own
      // error path report it, rather than claiming a container problem.
      return { dataUrl: await blobToDataUrl(file), converted: false };
    }

    const embedded = findLargestEmbeddedJpeg(bytes);
    if (!embedded) {
      const kind = looksLikeDng(bytes) ? 'DNG' : looksLikeHeic(bytes) ? 'HEIC' : 'this format';
      throw new Error(`${kind}-no-preview`);
    }
    return {
      dataUrl: await blobToDataUrl(new Blob([embedded], { type: 'image/jpeg' })),
      converted: true,
    };
  }

  window.PoorijaImageFormats = {
    toDrawableDataUrl,
    isCameraContainer,
    looksLikeHeic,
    looksLikeDng,
    findLargestEmbeddedJpeg,
  };
})();
