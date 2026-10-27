/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* QR codes for the panel's authenticator setup: drawn in a terminal by
 * setup-login and as SVG in the page. The panel takes nothing from npm, so
 * this is a small QR Model 2 encoder of its own — byte mode, error correction
 * level M, versions 1 to 20 (an otpauth link needs about 5) — following the
 * structure of the standard: data and Reed–Solomon codewords in interleaved
 * blocks, the function patterns, eight masks scored by the four penalty
 * rules. tests/e2e/panelqr.mjs reads every drawing back with the QR decoder
 * the app already ships.
 */

const MAX_VERSION = 20;
/* Level M, by version (index 0 unused): error correction codewords per block,
   and the number of blocks. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const FORMAT_LEVEL_M = 0;

/* ---- GF(256) and Reed–Solomon -------------------------------------------- */

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, i) => { result[i] ^= gfMultiply(coefficient, factor); });
  }
  return result;
}

/* ---- sizes --------------------------------------------------------------- */

function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}
const dataCodewords = (version) => Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];

function alignmentPositions(version, size) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}

/* ---- data ---------------------------------------------------------------- */

function encodeData(bytes, version) {
  const bits = [];
  const put = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);
  const capacity = dataCodewords(version) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  return codewords;
}

function withErrorCorrection(data, version) {
  const blockCount = BLOCKS[version];
  const eccLength = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blockCount - (raw % blockCount);
  const shortLength = Math.floor(raw / blockCount);
  const divisor = rsDivisor(eccLength);
  const blocks = [];
  for (let i = 0, at = 0; i < blockCount; i += 1) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const part = data.slice(at, at + length);
    at += length;
    blocks.push({ data: part, ecc: rsRemainder(part, divisor) });
  }
  const result = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longest; i += 1) for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
  for (let i = 0; i < eccLength; i += 1) for (const block of blocks) result.push(block.ecc[i]);
  return result;
}

/* ---- the symbol ---------------------------------------------------------- */

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function buildSymbol(version, codewords) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = (x, y, dark) => { modules[y][x] = dark; reserved[y][x] = true; };

  for (let i = 0; i < size; i += 1) { fixed(6, i, i % 2 === 0); fixed(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx; const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        fixed(x, y, distance !== 2 && distance !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const positions = alignmentPositions(version, size);
  const last = positions.length - 1;
  positions.forEach((cy, i) => positions.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) fixed(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const format = (mask) => {
    const value = (FORMAT_LEVEL_M << 3) | mask;
    let remainder = value;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((value << 10) | remainder) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) fixed(8, i, bit(i));
    fixed(8, 7, bit(6)); fixed(8, 8, bit(7)); fixed(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) fixed(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) fixed(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) fixed(8, size - 15 + i, bit(i));
    fixed(8, size - 8, true);
  };
  format(0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      fixed(a, b, dark); fixed(b, a, dark);
    }
  }

  /* The codewords, in the zigzag the standard reads them in. */
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (reserved[y][x] || i >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        i += 1;
      }
    }
  }

  const applyMask = (mask) => {
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!reserved[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(mask);
    format(mask);
    const score = penalty(modules);
    if (score < bestScore) { best = mask; bestScore = score; }
    applyMask(mask);
  }
  applyMask(best);
  format(best);
  return { size, modules };
}

/* The four penalty rules: runs of one colour, 2×2 blocks, finder-like
   patterns, and the balance of dark and light. */
function penalty(modules) {
  const size = modules.length;
  let score = 0;
  const line = (get) => {
    let run = 1;
    for (let i = 1; i <= size; i += 1) {
      if (i < size && get(i) === get(i - 1)) { run += 1; continue; }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    const pattern = Array.from({ length: size }, (_, i) => (get(i) ? '1' : '0')).join('');
    for (const finder of ['10111010000', '00001011101']) {
      for (let at = pattern.indexOf(finder); at >= 0; at = pattern.indexOf(finder, at + 1)) score += 40;
    }
  };
  for (let y = 0; y < size; y += 1) line((x) => modules[y][x]);
  for (let x = 0; x < size; x += 1) line((y) => modules[y][x]);
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const dark = modules[y][x];
      if (dark === modules[y][x + 1] && dark === modules[y + 1][x] && dark === modules[y + 1][x + 1]) score += 3;
    }
  }
  const total = size * size;
  const dark = modules.reduce((count, row) => count + row.filter(Boolean).length, 0);
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/* ---- the three faces ----------------------------------------------------- */

export function encodeQr(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const needed = 4 + (version < 10 ? 8 : 16) + bytes.length * 8;
    if (needed <= dataCodewords(version) * 8) return buildSymbol(version, withErrorCorrection(encodeData(bytes, version), version));
  }
  throw new Error(`too long for a QR code here (${bytes.length} bytes)`);
}

/* Two modules per character with half blocks, around a quiet zone of two.
   Plain characters: the caller sets the colours (dark on light), so the code
   reads the same on a dark terminal and a light one. */
export function qrTerminal(text, { quiet = 2 } = {}) {
  const { size, modules } = encodeQr(text);
  const dark = (x, y) => x >= 0 && y >= 0 && x < size && y < size && modules[y][x];
  const lines = [];
  for (let y = -quiet; y < size + quiet; y += 2) {
    let row = '';
    for (let x = -quiet; x < size + quiet; x += 1) {
      const top = dark(x, y);
      const bottom = dark(x, y + 1);
      row += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(row);
  }
  return lines.join('\n');
}

export function qrSvg(text, { scale = 6, quiet = 4 } = {}) {
  const { size, modules } = encodeQr(text);
  const width = (size + quiet * 2) * scale;
  let path = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) if (modules[y][x]) path += `M${(x + quiet) * scale} ${(y + quiet) * scale}h${scale}v${scale}h-${scale}z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}" width="${width}" height="${width}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
