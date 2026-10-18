/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A Telegram sticker pack, fetched by the relay from a share link.
 *
 * Telegram gives a pack out only through its Bot API, which wants a bot's
 * token, and Telegram is unreachable from some networks the app is used on. So
 * the relay that has a token (TELEGRAM_BOT_TOKEN) asks on the client's behalf,
 * and a relay that has none but can reach one that does
 * (TELEGRAM_STICKERS_UPSTREAM) passes the question along. The token never
 * leaves the relay; Telegram sees the relay's address, not the person's; the
 * relay keeps nothing but a short cache of which files make up a pack.
 *
 * It only ever speaks to Telegram, about a pack name or a file id it has
 * checked the shape of — it is not a proxy for anything else:
 *   - a pack name is letters, digits and underscores, as Telegram's are;
 *   - a file id is Telegram's own alphabet and length;
 *   - a file is at most 2 MB (Telegram's own limits are far lower), a reply at
 *     most 1 MB of JSON, and nothing takes longer than fifteen seconds.
 */
'use strict';

const http = require('http');
const https = require('https');

const PACK_NAME = /^[A-Za-z0-9_]{1,64}$/;
const FILE_ID = /^[A-Za-z0-9_-]{20,200}$/;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const MAX_STICKERS = 240;

/* Where Telegram is. Overridable only so the test suite can stand up a fake
   Telegram; a relay in production leaves it alone. */
function apiBase() {
  return String(process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
}

function getBytes(url, maxBytes, { accept = '' } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'http:' ? http : https;
    const request = client.get(target, { timeout: TIMEOUT_MS, headers: accept ? { Accept: accept } : {} }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error('too-large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode || 0, type: String(response.headers['content-type'] || ''), body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

async function botCall(token, method, params) {
  const query = new URLSearchParams(params).toString();
  const { body } = await getBytes(`${apiBase()}/bot${token}/${method}?${query}`, MAX_JSON_BYTES);
  let parsed;
  try { parsed = JSON.parse(body.toString('utf8')); } catch (_error) { throw new Error('telegram-unreadable'); }
  if (!parsed?.ok) {
    const description = String(parsed?.description || '').toLowerCase();
    if (description.includes('stickerset_invalid') || description.includes('not found')) throw new Error('pack-not-found');
    if (description.includes('unauthorized')) throw new Error('token-refused');
    throw new Error('telegram-refused');
  }
  return parsed.result;
}

/* What the client is told about a pack: its name, its title, and for each
   sticker the file to ask for, its emoji and what kind of picture it is. */
function describePack(set) {
  const stickers = (Array.isArray(set?.stickers) ? set.stickers : []).slice(0, MAX_STICKERS).map((sticker) => {
    const kind = sticker.is_animated ? 'lottie' : (sticker.is_video ? 'video' : 'image');
    return {
      file: String(sticker.file_id || ''),
      emoji: String(sticker.emoji || '').slice(0, 16),
      kind,
      ext: kind === 'lottie' ? 'tgs' : (kind === 'video' ? 'webm' : 'webp'),
    };
  }).filter((sticker) => FILE_ID.test(sticker.file));
  return {
    name: String(set?.name || '').slice(0, 64),
    title: String(set?.title || set?.name || 'Telegram').slice(0, 64),
    stickers,
  };
}

/* A pack's description is kept for ten minutes: a person importing it asks
   for the description once and then for every file, and the file ids in it
   are what the file requests are checked against. */
const packCache = new Map();
const knownFiles = new Map();
const CACHE_MS = 10 * 60 * 1000;

function remember(pack) {
  const until = Date.now() + CACHE_MS;
  packCache.set(pack.name.toLowerCase(), { pack, until });
  for (const sticker of pack.stickers) knownFiles.set(sticker.file, until);
  if (packCache.size > 200) {
    const now = Date.now();
    for (const [key, entry] of packCache) if (entry.until < now) packCache.delete(key);
    for (const [key, until] of knownFiles) if (until < now) knownFiles.delete(key);
  }
}

async function stickerPack(token, name) {
  if (!PACK_NAME.test(String(name || ''))) throw new Error('bad-name');
  const cached = packCache.get(String(name).toLowerCase());
  if (cached && cached.until > Date.now()) return cached.pack;
  const pack = describePack(await botCall(token, 'getStickerSet', { name }));
  if (!pack.stickers.length) throw new Error('pack-empty');
  remember(pack);
  return pack;
}

const FILE_TYPES = { tgs: 'application/x-tgsticker', webm: 'video/webm', webp: 'image/webp', png: 'image/png' };

/* One file of a pack this relay has described: only a file id that came out
   of a pack description in the last ten minutes is fetched, so the endpoint
   cannot be pointed at anything else Telegram holds. */
async function stickerFile(token, fileId) {
  if (!FILE_ID.test(String(fileId || ''))) throw new Error('bad-file');
  const known = knownFiles.get(fileId);
  if (!known || known < Date.now()) throw new Error('unknown-file');
  const info = await botCall(token, 'getFile', { file_id: fileId });
  const filePath = String(info?.file_path || '');
  if (!/^[A-Za-z0-9_./-]{1,200}$/.test(filePath) || filePath.includes('..')) throw new Error('telegram-refused');
  const { status, body } = await getBytes(`${apiBase()}/file/bot${token}/${filePath}`, MAX_FILE_BYTES);
  if (status !== 200 || !body.length) throw new Error('telegram-refused');
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  return { body, type: FILE_TYPES[ext] || 'application/octet-stream' };
}

/* A relay without a token hands the same question to one with a token, over
   HTTPS, and passes the answer back as it came. */
async function fromUpstream(upstream, pathAndQuery, maxBytes) {
  const base = String(upstream || '').replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d{2,5})?$/.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/.test(base)) throw new Error('bad-upstream');
  return getBytes(`${base}${pathAndQuery}`, maxBytes);
}

module.exports = { stickerPack, stickerFile, fromUpstream, describePack, PACK_NAME, FILE_ID, MAX_FILE_BYTES, MAX_JSON_BYTES };
