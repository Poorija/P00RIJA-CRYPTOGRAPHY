/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

'use strict';
/* What a file says about itself.
 *
 * A photograph from a phone carries where it was taken, on what, and when.
 * Encrypting the photograph and sending those coordinates beside it protects
 * the wrong thing, so this reads them, lets them be edited, and takes them out.
 *
 * No dependencies: the page's CSP blocks external scripts and the app has to
 * work with no network at all. No DOM, no knowledge of chat - bytes in, bytes
 * or a description out - so it can be tested on its own and called from
 * anywhere.
 *
 * One reader per container, all answering the same three questions, so PDF can
 * be added later by adding a file rather than by changing any caller. */
(function (global) {
  /* What a field would tell somebody, rather than how big it is. This is what
     lets the interface say which lines matter without the reader having to know
     what GPSLatitudeRef means. */
  const RISK = {
    LOCATION: 'location', DEVICE: 'device', IDENTITY: 'identity',
    TIME: 'time', OTHER: 'other',
  };

  const EXIF_TAGS = {
    0x010f: { label: 'Make', risk: RISK.DEVICE },
    0x0110: { label: 'Model', risk: RISK.DEVICE },
    0x0131: { label: 'Software', risk: RISK.DEVICE },
    0x0132: { label: 'DateTime', risk: RISK.TIME },
    0x013b: { label: 'Artist', risk: RISK.IDENTITY },
    0x8298: { label: 'Copyright', risk: RISK.IDENTITY },
    0xa430: { label: 'CameraOwnerName', risk: RISK.IDENTITY },
    0xa431: { label: 'BodySerialNumber', risk: RISK.DEVICE },
    0x8825: { label: 'GPSInfo', risk: RISK.LOCATION },
  };
  const GPS_TAGS = {
    0x0000: 'GPSVersionID', 0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude', 0x0005: 'GPSAltitudeRef',
    0x0006: 'GPSAltitude', 0x0007: 'GPSTimeStamp', 0x001d: 'GPSDateStamp',
  };

  const bytesOf = async (input) => new Uint8Array(await input.arrayBuffer());
  /* Two shapes of text live in these containers and they need different
     readers. An EXIF ASCII tag is a C string: it ends at the first zero. A PNG
     text chunk is a span with a zero *inside* it separating the keyword from
     the value - read with the C-string reader it comes back as the keyword
     alone, and the part that actually names somebody is silently dropped. */
  const latin1 = (view, start, length) => {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      if (start + i >= view.byteLength) break;
      out += String.fromCharCode(view.getUint8(start + i));
    }
    return out;
  };
  const ascii = (view, start, length) => {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      if (start + i >= view.byteLength) break;
      const code = view.getUint8(start + i);
      if (!code) break;
      out += String.fromCharCode(code);
    }
    return out;
  };

  /* --- JPEG ------------------------------------------------------------
     A JPEG is a run of segments, each 0xFF followed by a marker and, for the
     ones that carry anything, a two-byte length. Metadata lives in APP1
     (EXIF and XMP), APP2 (ICC), APP13 (IPTC) and COM; everything else is the
     image. Walking the segments means the pixels are never touched. */
  function jpegSegments(bytes) {
    const segments = [];
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) break;
      const marker = bytes[at + 1];
      if (marker === 0xd8 || marker === 0xd9) { at += 2; continue; }
      if (marker === 0xda) { segments.push({ marker, start: at, end: bytes.length, scan: true }); break; }
      const length = (bytes[at + 2] << 8) | bytes[at + 3];
      if (length < 2) break;
      segments.push({ marker, start: at, end: at + 2 + length, bodyAt: at + 4, bodyLength: length - 2 });
      at += 2 + length;
    }
    return segments;
  }
  const JPEG_META_MARKERS = new Set([0xe1, 0xe2, 0xed, 0xee, 0xfe]);

  function readExifBlock(bytes, at, length, fields) {
    if (length < 14) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset + at, length);
    if (ascii(view, 0, 4) !== 'Exif') return;
    const tiff = 6;
    const little = view.getUint16(tiff) === 0x4949;
    const readIfd = (offset, group) => {
      if (tiff + offset + 2 > length) return;
      const count = view.getUint16(tiff + offset, little);
      for (let i = 0; i < count; i += 1) {
        const entry = tiff + offset + 2 + (i * 12);
        if (entry + 12 > length) return;
        const tag = view.getUint16(entry, little);
        const type = view.getUint16(entry + 2, little);
        const num = view.getUint32(entry + 4, little);
        if (tag === 0x8825 && group === 'ifd0') {
          readIfd(view.getUint32(entry + 8, little), 'gps');
          continue;
        }
        const known = group === 'ifd0' ? EXIF_TAGS[tag] : null;
        const label = group === 'gps' ? (GPS_TAGS[tag] || `GPS:${tag}`) : (known ? known.label : `Tag:${tag}`);
        const risk = group === 'gps' ? RISK.LOCATION : (known ? known.risk : RISK.OTHER);
        let value = '';
        if (type === 2) {
          const inline = num <= 4;
          const at2 = inline ? entry + 8 : tiff + view.getUint32(entry + 8, little);
          if (at2 + num <= length) value = ascii(view, at2, num);
        } else {
          value = String(num <= 4 ? view.getUint32(entry + 8, little) : '…');
        }
        fields.push({ id: `exif:${group}:${tag}`, group: group === 'gps' ? 'GPS' : 'EXIF', label, value, risk });
      }
    };
    readIfd(view.getUint32(tiff + 4, little), 'ifd0');
  }

  function readJpeg(bytes) {
    const fields = [];
    jpegSegments(bytes).forEach((segment) => {
      if (segment.scan || !JPEG_META_MARKERS.has(segment.marker)) return;
      if (segment.marker === 0xe1) readExifBlock(bytes, segment.bodyAt, segment.bodyLength, fields);
      else {
        fields.push({
          id: `jpeg:${segment.marker}:${segment.start}`,
          group: segment.marker === 0xe2 ? 'ICC' : (segment.marker === 0xed ? 'IPTC' : 'Comment'),
          label: segment.marker === 0xfe ? 'Comment' : 'Block',
          value: `${segment.bodyLength} bytes`,
          risk: RISK.OTHER,
        });
      }
    });
    return { format: 'jpeg', supported: true, fields, warnings: [] };
  }

  /* --- PNG -------------------------------------------------------------
     A signature followed by length-prefixed chunks. The text ones, eXIf and
     tIME are metadata; IHDR, IDAT, PLTE and IEND are the picture. */
  const PNG_META = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
  function pngChunks(bytes) {
    const chunks = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    let at = 8;
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at);
      if (at + 12 + length > bytes.length) break;
      const type = ascii(new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4), 0, 4);
      chunks.push({ type, start: at, end: at + 12 + length, bodyAt: at + 8, bodyLength: length });
      at += 12 + length;
      if (type === 'IEND') break;
    }
    return chunks;
  }
  function readPng(bytes) {
    const fields = [];
    pngChunks(bytes).forEach((c) => {
      if (!PNG_META.has(c.type)) return;
      const raw = latin1(new DataView(bytes.buffer, bytes.byteOffset + c.bodyAt, c.bodyLength), 0, Math.min(c.bodyLength, 120));
      fields.push({
        id: `png:${c.type}:${c.start}`, group: 'PNG', label: c.type,
        value: raw.replace(/\0/g, ' '),
        risk: c.type === 'eXIf' ? RISK.LOCATION : (c.type === 'tIME' ? RISK.TIME : RISK.IDENTITY),
      });
    });
    return { format: 'png', supported: true, fields, warnings: [] };
  }
  function stripPng(bytes) {
    const keep = [bytes.subarray(0, 8)];
    const removed = [];
    pngChunks(bytes).forEach((c) => {
      if (PNG_META.has(c.type)) { removed.push(`png:${c.type}:${c.start}`); return; }
      keep.push(bytes.subarray(c.start, c.end));
    });
    return { bytes: concat(keep), removed };
  }

  /* --- WebP ------------------------------------------------------------
     RIFF: a header, then four-character chunks each with a length. */
  const WEBP_META = new Set(['EXIF', 'XMP ', 'ICCP']);
  function riffChunks(bytes) {
    const chunks = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    let at = 12;
    while (at + 8 <= bytes.length) {
      const type = ascii(new DataView(bytes.buffer, bytes.byteOffset + at, 4), 0, 4);
      const length = view.getUint32(at + 4, true);
      const padded = length + (length % 2);
      if (at + 8 + padded > bytes.length) break;
      chunks.push({ type, start: at, end: at + 8 + padded, bodyAt: at + 8, bodyLength: length });
      at += 8 + padded;
    }
    return chunks;
  }
  function readWebp(bytes) {
    const fields = riffChunks(bytes).filter((c) => WEBP_META.has(c.type)).map((c) => ({
      id: `webp:${c.type.trim()}:${c.start}`, group: 'WebP', label: c.type.trim(),
      value: `${c.bodyLength} bytes`,
      risk: c.type === 'EXIF' ? RISK.LOCATION : RISK.OTHER,
    }));
    return { format: 'webp', supported: true, fields, warnings: [] };
  }
  function stripWebp(bytes) {
    const keep = [bytes.subarray(0, 12)];
    const removed = [];
    riffChunks(bytes).forEach((c) => {
      if (WEBP_META.has(c.type)) { removed.push(`webp:${c.type.trim()}:${c.start}`); return; }
      keep.push(bytes.subarray(c.start, c.end));
    });
    const out = concat(keep);
    /* The RIFF header carries the total size, so it has to be rewritten. */
    if (out.length >= 8) new DataView(out.buffer).setUint32(4, out.length - 8, true);
    return { bytes: out, removed };
  }

  /* --- MP4 / MOV / M4A --------------------------------------------------
     Boxes, each a four-byte length and a four-character name. `udta` and
     `meta` are where a phone writes the location and the device; `moov` and
     `trak` have to be walked because they sit inside them. */
  const MP4_META = new Set(['udta', 'meta']);
  function mp4Boxes(bytes, from, to) {
    const boxes = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    let at = from;
    while (at + 8 <= to) {
      const size = view.getUint32(at);
      const name = ascii(new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4), 0, 4);
      const end = size === 0 ? to : at + size;
      if (size < 8 || end > to) break;
      boxes.push({ name, start: at, end });
      at = end;
    }
    return boxes;
  }
  function readMp4(bytes) {
    const fields = [];
    const walk = (from, to) => {
      mp4Boxes(bytes, from, to).forEach((box) => {
        if (MP4_META.has(box.name)) {
          const span = Math.min(box.end - box.start - 8, 160);
          const raw = latin1(new DataView(bytes.buffer, bytes.byteOffset + box.start + 8, Math.max(span, 0)), 0, 160);
          fields.push({
            id: `mp4:${box.name}:${box.start}`, group: 'MP4', label: box.name,
            value: raw.replace(/[^\x20-\x7e]/g, ' ').trim().slice(0, 120),
            risk: /\+\d|xyz|loci/.test(raw) ? RISK.LOCATION : RISK.DEVICE,
          });
          return;
        }
        if (box.name === 'moov' || box.name === 'trak') walk(box.start + 8, box.end);
      });
    };
    walk(0, bytes.length);
    return { format: 'mp4', supported: true, fields, warnings: [] };
  }
  function stripMp4(bytes) {
    const removed = [];
    const rebuild = (from, to) => {
      const parts = [];
      mp4Boxes(bytes, from, to).forEach((box) => {
        if (MP4_META.has(box.name)) { removed.push(`mp4:${box.name}:${box.start}`); return; }
        if (box.name === 'moov' || box.name === 'trak') {
          const inner = rebuild(box.start + 8, box.end);
          const head = new Uint8Array(8);
          head.set(bytes.subarray(box.start + 4, box.start + 8), 4);
          new DataView(head.buffer).setUint32(0, inner.length + 8);
          parts.push(head, inner);
          return;
        }
        parts.push(bytes.subarray(box.start, box.end));
      });
      return concat(parts);
    };
    return { bytes: rebuild(0, bytes.length), removed };
  }

  /* --- MP3 --------------------------------------------------------------
     ID3v2 sits at the head with a synchsafe length; ID3v1 is a flat 128 bytes
     at the tail. Everything between them is the audio. */
  function mp3Tags(bytes) {
    const tags = [];
    if (bytes.length > 10 && ascii(new DataView(bytes.buffer, bytes.byteOffset, 3), 0, 3) === 'ID3') {
      const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
      tags.push({ kind: 'id3v2', start: 0, end: Math.min(10 + size, bytes.length) });
    }
    if (bytes.length > 128 && ascii(new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 128, 3), 0, 3) === 'TAG') {
      tags.push({ kind: 'id3v1', start: bytes.length - 128, end: bytes.length });
    }
    return tags;
  }
  function readMp3(bytes) {
    const fields = mp3Tags(bytes).map((tag) => ({
      id: `mp3:${tag.kind}`, group: 'ID3', label: tag.kind === 'id3v2' ? 'ID3v2' : 'ID3v1',
      value: latin1(new DataView(bytes.buffer, bytes.byteOffset + tag.start, tag.end - tag.start), 0, Math.min(tag.end - tag.start, 160))
        .replace(/[^\x20-\x7e]/g, ' ').trim().slice(0, 120),
      risk: RISK.IDENTITY,
    }));
    return { format: 'mp3', supported: true, fields, warnings: [] };
  }
  function stripMp3(bytes) {
    const removed = [];
    let start = 0;
    let end = bytes.length;
    mp3Tags(bytes).forEach((tag) => {
      removed.push(`mp3:${tag.kind}`);
      if (tag.kind === 'id3v2') start = tag.end;
      else end = tag.start;
    });
    return { bytes: bytes.subarray(start, end), removed };
  }

  /* ---------------------------------------------------------------- PDF
   *
   * A PDF keeps what it says about you in two places: the Info dictionary
   * (Title, Author, Creator, Producer, the two dates) and, on anything made
   * this century, an XMP packet that repeats most of it as XML.
   *
   * Rewriting either in place is the HEIC trap all over again - a PDF is a
   * graph of objects found through byte offsets in a cross-reference table,
   * and moving one byte invalidates every offset after it. But a PDF has an
   * escape hatch that HEIC does not: an INCREMENTAL UPDATE. New versions of
   * some objects, a new cross-reference section pointing at them, and a
   * trailer whose /Prev points back at the old table - all appended, with not
   * one existing byte touched. Every reader has supported this since 1993,
   * because it is how signed and annotated PDFs work.
   *
   * So: never edit, always append. The original bytes remain in the file, and
   * that is worth being plain about - an incremental update replaces what a
   * reader shows, and somebody with a hex editor can still read the old
   * values underneath. For "this document should not say I wrote it" that is
   * enough; for "this must not be recoverable at all" it is not, and the
   * caller is told so.
   */
  const PDF_INFO_KEYS = [
    ['Title', RISK.OTHER], ['Author', RISK.IDENTITY], ['Subject', RISK.OTHER],
    ['Keywords', RISK.OTHER], ['Creator', RISK.DEVICE], ['Producer', RISK.DEVICE],
    ['CreationDate', RISK.TIME], ['ModDate', RISK.TIME],
  ];

  /* PDF strings come as (literal) or <hex>. Only enough of each is decoded to
     show it; nothing here is fed back into the file. */
  function pdfString(raw) {
    const text = String(raw || '').trim();
    if (text.startsWith('<') && text.endsWith('>')) {
      const hex = text.slice(1, -1).replace(/[^0-9a-fA-F]/g, '');
      let out = '';
      for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      /* UTF-16BE, which is what a byte-order mark at the front means. */
      if (out.charCodeAt(0) === 0xfe && out.charCodeAt(1) === 0xff) {
        let wide = '';
        for (let i = 2; i + 1 < out.length; i += 2) wide += String.fromCharCode((out.charCodeAt(i) << 8) | out.charCodeAt(i + 1));
        return wide;
      }
      return out;
    }
    if (text.startsWith('(') && text.endsWith(')')) {
      return text.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_m, ch) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[ch] || ch));
    }
    return text;
  }

  /* The whole file as latin1 text. A PDF is binary, but its structure - object
     headers, dictionaries, the trailer - is ASCII, and latin1 maps every byte
     to exactly one character so offsets in the string are offsets in the file. */
  function pdfText(bytes) {
    let out = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return out;
  }

  /* Where the Info dictionary is, and what is in it. Later trailers win: an
     incremental update appends a new trailer, and the last one is the live
     one. */
  function pdfInfo(text) {
    let ref = '';
    const trailers = [...text.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R/g)];
    if (trailers.length) ref = `${trailers[trailers.length - 1][1]} ${trailers[trailers.length - 1][2]}`;
    if (!ref) return { ref: '', body: '' };
    const [num, gen] = ref.split(' ');
    /* The last definition of that object, for the same reason. */
    const objs = [...text.matchAll(new RegExp(`(?:^|[^0-9])${num}\\s+${gen}\\s+obj([\\s\\S]*?)endobj`, 'g'))];
    if (!objs.length) return { ref, body: '' };
    return { ref, body: objs[objs.length - 1][1] };
  }

  function readPdf(bytes) {
    const text = pdfText(bytes);
    const info = pdfInfo(text);
    const fields = [];
    PDF_INFO_KEYS.forEach(([key, risk]) => {
      const match = info.body.match(new RegExp(`/${key}\\s*(\\([^)]*\\)|<[0-9a-fA-F\\s]*>)`));
      if (!match) return;
      const value = pdfString(match[1]).replace(/[^\x20-\x7e؀-ۿ]/g, ' ').trim();
      if (value) fields.push({ id: `pdf:${key}`, group: 'Info', label: key, value: value.slice(0, 160), risk });
    });
    /* The XMP packet, if there is one. Its contents are not listed field by
       field - it is XML with dozens of namespaces - but its presence matters,
       because it usually repeats the author and the software. */
    const xmp = /<\?xpacket begin/.test(text) || /\/Type\s*\/Metadata/.test(text);
    if (xmp) {
      fields.push({
        id: 'pdf:xmp', group: 'XMP', label: 'XMP packet',
        value: 'present', risk: RISK.IDENTITY,
      });
    }
    return {
      format: 'pdf', supported: true, fields,
      warnings: fields.length ? [] : ['no-metadata'],
    };
  }

  /* An incremental update that empties the Info dictionary and, where there is
     one, the XMP packet. Nothing before the appended bytes is altered. */
  function stripPdf(bytes) {
    const text = pdfText(bytes);
    const info = pdfInfo(text);
    const removed = [];

    /* Which objects the update replaces, and with what. */
    const updates = [];
    if (info.ref) {
      const [num, gen] = info.ref.split(' ');
      updates.push({ num: Number(num), gen: Number(gen), body: '<< >>' });
      PDF_INFO_KEYS.forEach(([key]) => {
        if (new RegExp(`/${key}\\s*(\\(|<)`).test(info.body)) removed.push(`pdf:${key}`);
      });
    }
    const xmpRef = [...text.matchAll(/\/Metadata\s+(\d+)\s+(\d+)\s+R/g)].pop();
    if (xmpRef) {
      /* An empty XMP stream rather than a missing one: a reader that follows
         the reference should find something valid at the end of it. */
      const empty = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta><?xpacket end="w"?>';
      updates.push({
        num: Number(xmpRef[1]), gen: Number(xmpRef[2]),
        body: `<< /Type /Metadata /Subtype /XML /Length ${empty.length} >>\nstream\n${empty}\nendstream`,
      });
      removed.push('pdf:xmp');
    }
    if (!updates.length) return { bytes, removed: [] };

    const startxref = [...text.matchAll(/startxref\s+(\d+)/g)].pop();
    const prev = startxref ? Number(startxref[1]) : 0;
    const sizeMatch = [...text.matchAll(/\/Size\s+(\d+)/g)].pop();
    const size = sizeMatch ? Number(sizeMatch[1]) : (Math.max(...updates.map((u) => u.num)) + 1);
    const rootMatch = [...text.matchAll(/\/Root\s+(\d+\s+\d+\s+R)/g)].pop();
    if (!rootMatch) return { bytes, removed: [] };

    /* Objects first, each remembering where it began, because the new
       cross-reference table has to point at those offsets. */
    let tail = '\n';
    const offsets = [];
    updates.sort((a, b) => a.num - b.num).forEach((update) => {
      offsets.push({ num: update.num, at: bytes.length + tail.length });
      tail += `${update.num} ${update.gen} obj\n${update.body}\nendobj\n`;
    });

    const xrefAt = bytes.length + tail.length;
    tail += 'xref\n';
    /* One subsection per run of consecutive object numbers, which is what the
       format asks for and what readers that do not tolerate sloppiness need. */
    let run = [];
    const flush = () => {
      if (!run.length) return;
      tail += `${run[0].num} ${run.length}\n`;
      run.forEach((entry) => { tail += `${String(entry.at).padStart(10, '0')} 00000 n \n`; });
      run = [];
    };
    offsets.forEach((entry) => {
      if (run.length && entry.num !== run[run.length - 1].num + 1) flush();
      run.push(entry);
    });
    flush();
    tail += `trailer\n<< /Size ${size} /Root ${rootMatch[1]}${prev ? ` /Prev ${prev}` : ''} >>\nstartxref\n${xrefAt}\n%%EOF\n`;

    const out = new Uint8Array(bytes.length + tail.length);
    out.set(bytes, 0);
    for (let i = 0; i < tail.length; i += 1) out[bytes.length + i] = tail.charCodeAt(i) & 0xff;
    return { bytes: out, removed };
  }

  /* Which container this is, decided from the bytes rather than the name: a
     file called .jpg that is really a PNG must be read as a PNG. */
  /* Photographs in the ISO container. HEIC and HEIF from phones, AVIF from
     newer ones. Their metadata is reachable in principle, but only by
     rewriting an index of byte offsets into the picture data - so they are
     recognised in order to be left alone, and the caller is told they were
     not cleaned rather than left to assume they were. */
  const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx',
    'mif1', 'msf1', 'avif', 'avis', 'heif']);
  /* The video and audio brands this module's box editor is safe on. */
  const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42',
    'avc1', 'dash', 'm4a ', 'm4b ', 'm4v ', 'm4p ', 'qt  ',
    '3gp4', '3gp5', '3gp6', '3g2a', 'mmp4']);
  function sniff(bytes) {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
    /* Eight bytes is the whole signature, so a file that is exactly that is a
       PNG - a truncated one. Calling it unrecognised would be a wrong answer
       where "a PNG with nothing in it" is the right one. */
    if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(new DataView(bytes.buffer, bytes.byteOffset + 1, 3), 0, 3) === 'PNG') return 'png';
    if (bytes.length > 12
      && ascii(new DataView(bytes.buffer, bytes.byteOffset, 4), 0, 4) === 'RIFF'
      && ascii(new DataView(bytes.buffer, bytes.byteOffset + 8, 4), 0, 4) === 'WEBP') return 'webp';
    /* Everything below is ISO base media format: MP4, QuickTime, M4A - and
       also HEIC, HEIF and AVIF, which are photographs in the same container.
       Reading "ftyp" alone and calling all of them mp4 is what corrupted a
       HEIC photograph sent from a phone: the picture in a HEIC lives in mdat
       and is found through byte offsets recorded in the meta box, so removing
       or resizing any box moves the picture out from under its own index. The
       file still starts with "ftyp" afterwards, so even the round-trip check
       at the end of a strip saw nothing wrong.
       The brand says which it is. Anything not on the video list is reported
       as its own format and left alone. */
    if (bytes.length > 12 && ascii(new DataView(bytes.buffer, bytes.byteOffset + 4, 4), 0, 4) === 'ftyp') {
      const brand = ascii(new DataView(bytes.buffer, bytes.byteOffset + 8, 4), 0, 4).toLowerCase();
      if (HEIF_BRANDS.has(brand)) return 'heif';
      if (MP4_BRANDS.has(brand)) return 'mp4';
      /* An unlisted brand is not assumed to be video: guessing wrong here
         rewrites somebody's file. */
      return 'iso-unknown';
    }
    if (bytes.length > 5 && ascii(new DataView(bytes.buffer, bytes.byteOffset, 5), 0, 5) === '%PDF-') return 'pdf';
    if (bytes.length > 10 && ascii(new DataView(bytes.buffer, bytes.byteOffset, 3), 0, 3) === 'ID3') return 'mp3';
    /* An MP3 whose tags have just been taken off starts at a frame sync, not at
       "ID3" - so without this the strip's own round-trip check would decide the
       file had stopped being an MP3 and hand the tags back. */
    if (bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
    return 'unknown';
  }

  const READERS = { jpeg: readJpeg, png: readPng, webp: readWebp, mp4: readMp4, mp3: readMp3, pdf: readPdf };
  const STRIPPERS = { jpeg: stripJpeg, png: stripPng, webp: stripWebp, mp4: stripMp4, mp3: stripMp3, pdf: stripPdf };

  /* Which container this is, from a header slice rather than the whole file.
   *
   * `sniff` needs twelve bytes. Reading a 400 MB video into memory to look at
   * twelve of them undoes the streaming the send path was rebuilt for - and
   * that is exactly what happened the first time this module was called from
   * there. Callers that only need to know the format ask this. */
  async function sniffBlob(input) {
    try {
      const head = new Uint8Array(await input.slice(0, 32).arrayBuffer());
      return sniff(head);
    } catch (error) {
      return 'unknown';
    }
  }

  /* Above this, the whole-file read that reading and stripping need costs more
     than the metadata is worth: a phone photograph is a couple of megabytes and
     a long video is not, and the streaming path exists so a large file never
     has to sit in memory at once. Callers are told, rather than left to assume
     it was cleaned. */
  const WHOLE_FILE_CEILING = 64 * 1024 * 1024;

  async function readMetadata(input) {
    let bytes;
    try {
      bytes = await bytesOf(input);
    } catch (error) {
      return { format: 'unknown', supported: false, fields: [], warnings: ['unreadable'] };
    }
    const format = sniff(bytes);
    const reader = READERS[format];
    if (!reader) return { format: 'unknown', supported: false, fields: [], warnings: ['unrecognised-format'] };
    try {
      return reader(bytes);
    } catch (error) {
      /* A truncated or malformed file is not a reason to guess. */
      return { format, supported: false, fields: [], warnings: ['malformed'] };
    }
  }

  /* Rebuild the file without the segments that carry metadata. Nothing is
     re-encoded: the scan, and every segment that is not metadata, is copied
     across byte for byte, so the picture that comes out is the picture that
     went in. */
  function stripJpeg(bytes) {
    const keep = [bytes.subarray(0, 2)];
    const removed = [];
    const segments = jpegSegments(bytes);
    segments.forEach((segment) => {
      if (!segment.scan && JPEG_META_MARKERS.has(segment.marker)) {
        removed.push(`jpeg:${segment.marker}:${segment.start}`);
        return;
      }
      keep.push(bytes.subarray(segment.start, segment.end));
    });
    /* Whatever follows the last segment - the EOI marker, and in a real file
       anything a camera appended after it. The segment walk skips SOI and EOI
       by design, so without this the rebuilt file loses its ending and the
       safety check downstream correctly refuses it. */
    const lastEnd = segments.length ? segments[segments.length - 1].end : 2;
    if (lastEnd < bytes.length) keep.push(bytes.subarray(lastEnd));
    return { bytes: concat(keep), removed };
  }

  function concat(parts) {
    const size = parts.reduce((total, part) => total + part.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    parts.forEach((part) => { out.set(part, at); at += part.length; });
    return out;
  }

  async function stripMetadata(input) {
    const untouched = (format) => ({ blob: input, removed: [], supported: false, format: format || 'unknown' });
    let bytes;
    try {
      bytes = await bytesOf(input);
    } catch (error) {
      return untouched();
    }
    const format = sniff(bytes);
    const stripper = STRIPPERS[format];
    if (!stripper) return untouched(format);
    try {
      const result = stripper(bytes);
      /* The invariant, not a proxy for it: what came out still has to be the
         format that went in. A byte-count floor rejected correct work - a JPEG
         with nothing but its start and end markers is four bytes and perfectly
         valid. A user's file is not where a bug gets to land, but neither is a
         guard allowed to throw away a good result. */
      if (!result.bytes || !result.bytes.length || sniff(result.bytes) !== format) return untouched(format);
      return {
        blob: new Blob([result.bytes], { type: input.type || '' }),
        removed: result.removed,
        supported: true,
        format,
      };
    } catch (error) {
      return untouched(format);
    }
  }

  function pngCrc(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i += 1) {
      c ^= buf[i];
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }

  /* Replacing a value in place.
   *
   * A PNG chunk carries its own length and CRC, so one can be rebuilt without
   * disturbing its neighbours. EXIF cannot: its offsets point at each other, so
   * changing the length of one string moves everything after it, and a parser
   * that got it slightly wrong would hand back a photograph that no longer
   * opens. For those formats the offer is to clear the field rather than retype
   * it - which is the honest half of "full control", and `skipped` says which
   * fields took that path. */
  function writePngField(bytes, id, value) {
    const at = Number(String(id).split(':')[2]);
    const parts = [bytes.subarray(0, 8)];
    let applied = false;
    pngChunks(bytes).forEach((c) => {
      if (c.start !== at) { parts.push(bytes.subarray(c.start, c.end)); return; }
      const data = new TextEncoder().encode(value);
      const name = new TextEncoder().encode(c.type);
      const body = new Uint8Array(name.length + data.length);
      body.set(name, 0); body.set(data, name.length);
      const out = new Uint8Array(4 + body.length + 4);
      new DataView(out.buffer).setUint32(0, data.length);
      out.set(body, 4);
      new DataView(out.buffer).setUint32(4 + body.length, pngCrc(body));
      parts.push(out);
      applied = true;
    });
    return { bytes: concat(parts), applied };
  }

  async function writeMetadata(input, changes) {
    const ids = Object.keys(changes || {});
    const untouched = (format) => ({ blob: input, applied: [], skipped: ids, supported: false, format: format || 'unknown' });
    let bytes;
    try { bytes = await bytesOf(input); } catch (error) { return untouched(); }
    const format = sniff(bytes);
    const applied = [];
    const skipped = [];
    let working = bytes;
    ids.forEach((id) => {
      if (format !== 'png' || !String(id).startsWith('png:')) { skipped.push(id); return; }
      try {
        const result = writePngField(working, id, String(changes[id]));
        if (!result.applied) { skipped.push(id); return; }
        working = result.bytes;
        applied.push(id);
      } catch (error) { skipped.push(id); }
    });
    if (!applied.length) return untouched(format);
    if (sniff(working) !== format) return untouched(format);
    return { blob: new Blob([working], { type: input.type || '' }), applied, skipped, supported: true, format };
  }

  /* Taking one field out. Unlike editing, this works in every format the module
     reads: removing a chunk, a segment or a box never asks anything else to
     move. It is what makes "control over every field" true rather than
     aspirational. */
  const FIELD_REMOVERS = {
    jpeg: (bytes, id) => {
      const at = Number(String(id).split(':')[2]);
      const keep = [bytes.subarray(0, 2)];
      const segments = jpegSegments(bytes);
      let hit = false;
      segments.forEach((segment) => {
        if (segment.start === at && !segment.scan) { hit = true; return; }
        keep.push(bytes.subarray(segment.start, segment.end));
      });
      const lastEnd = segments.length ? segments[segments.length - 1].end : 2;
      if (lastEnd < bytes.length) keep.push(bytes.subarray(lastEnd));
      return hit ? concat(keep) : null;
    },
    png: (bytes, id) => {
      const at = Number(String(id).split(':')[2]);
      const keep = [bytes.subarray(0, 8)];
      let hit = false;
      pngChunks(bytes).forEach((c) => {
        if (c.start === at) { hit = true; return; }
        keep.push(bytes.subarray(c.start, c.end));
      });
      return hit ? concat(keep) : null;
    },
    webp: (bytes, id) => {
      const at = Number(String(id).split(':')[2]);
      const keep = [bytes.subarray(0, 12)];
      let hit = false;
      riffChunks(bytes).forEach((c) => {
        if (c.start === at) { hit = true; return; }
        keep.push(bytes.subarray(c.start, c.end));
      });
      if (!hit) return null;
      const out = concat(keep);
      if (out.length >= 8) new DataView(out.buffer).setUint32(4, out.length - 8, true);
      return out;
    },
    mp4: (bytes, id) => {
      const at = Number(String(id).split(':')[2]);
      let hit = false;
      const rebuild = (from, to) => {
        const parts = [];
        mp4Boxes(bytes, from, to).forEach((box) => {
          if (box.start === at) { hit = true; return; }
          if (box.name === 'moov' || box.name === 'trak') {
            const inner = rebuild(box.start + 8, box.end);
            const head = new Uint8Array(8);
            head.set(bytes.subarray(box.start + 4, box.start + 8), 4);
            new DataView(head.buffer).setUint32(0, inner.length + 8);
            parts.push(head, inner);
            return;
          }
          parts.push(bytes.subarray(box.start, box.end));
        });
        return concat(parts);
      };
      const out = rebuild(0, bytes.length);
      return hit ? out : null;
    },
    mp3: (bytes, id) => {
      const kind = String(id).split(':')[1];
      const tag = mp3Tags(bytes).find((entry) => entry.kind === kind);
      if (!tag) return null;
      return kind === 'id3v2' ? bytes.subarray(tag.end) : bytes.subarray(0, tag.start);
    },
  };

  async function clearField(input, id) {
    const untouched = (format) => ({ blob: input, cleared: false, supported: false, format: format || 'unknown' });
    let bytes;
    try { bytes = await bytesOf(input); } catch (error) { return untouched(); }
    const format = sniff(bytes);
    const remover = FIELD_REMOVERS[format];
    if (!remover) return untouched(format);
    try {
      const out = remover(bytes, id);
      if (!out || !out.length || sniff(out) !== format) return untouched(format);
      return { blob: new Blob([out], { type: input.type || '' }), cleared: true, supported: true, format };
    } catch (error) { return untouched(format); }
  }

  /* What this module can actually take metadata out of. A caller that knows
     the answer before reading the file can skip the read - and, more to the
     point, can say plainly that a format it does not handle was sent as it
     was, rather than leaving somebody to assume it was cleaned. */
  const STRIPPABLE = Object.freeze(Object.keys(STRIPPERS));
  global.PoorijaMetadata = {
    readMetadata, writeMetadata, stripMetadata, clearField, sniffBlob,
    WHOLE_FILE_CEILING, RISK, STRIPPABLE,
  };
}(typeof globalThis !== 'undefined' ? globalThis : window));
