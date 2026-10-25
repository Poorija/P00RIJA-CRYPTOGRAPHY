/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A link preview, fetched by the relay for a client that cannot fetch one
 * itself: the web app (a browser will not read another site's page) and the
 * phone apps. The desktop app fetches its own (src-tauri/src/link_preview.rs)
 * and never asks here.
 *
 * The cost is said plainly in the app before the switch is turned on: the
 * relay sees the link it is asked to open, and the site sees the relay's
 * address instead of the person's. The relay keeps nothing — no log line, no
 * cache — and the recipient's device still never contacts the site.
 *
 * Everything the desktop fetch refuses, this refuses too, because a pasted
 * link is text from wherever it was copied and this fetch runs inside the
 * relay's network:
 *
 *   - anything but http and https, a link carrying a password, and any port
 *     but the web ports;
 *   - a host that is a local name or resolves to any non-public address — and
 *     the address that was checked is the one connected to, so a name cannot
 *     answer publicly once and privately the second time;
 *   - more than three redirects (each checked like the first), and a redirect
 *     to another site at all, since the card would show one site under a link
 *     to another;
 *   - more than 512 KB of page or 1 MB of picture, and anything slower than
 *     eight seconds overall.
 */
'use strict';

const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');

const MAX_PAGE_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;
const WEB_PORTS = new Set([80, 443, 8080, 8443]);
/* Test stacks only: lets a suite preview a page it serves on 127.0.0.1 and
   any port. Never set on a real relay — it switches off the address checks
   that keep this fetch out of the relay's own network. */
const ALLOW_PRIVATE = process.env.CHAT_LINK_PREVIEW_ALLOW_PRIVATE === '1';
/* An ordinary browser's, so a preview fetch does not announce what sent it. */
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

function ipv4Parts(address) {
  const parts = String(address).split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isPublicIpv4(address) {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;     // carrier-grade NAT
  if (a === 169 && b === 254) return false;               // link local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;      // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false;      // documentation
  if (a === 192 && b === 88 && c === 99) return false;    // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return false;  // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;   // documentation
  if (a === 203 && b === 0 && c === 113) return false;    // documentation
  if (a >= 224) return false;                             // multicast, reserved, broadcast
  return true;
}

/* Expands an IPv6 address to its eight 16-bit groups. */
function ipv6Groups(address) {
  let value = String(address).toLowerCase().split('%')[0];
  const v4 = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const parts = ipv4Parts(v4[1]);
    if (!parts) return null;
    value = value.slice(0, -v4[1].length)
      + ((parts[0] << 8) | parts[1]).toString(16) + ':' + ((parts[2] << 8) | parts[3]).toString(16);
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((group) => parseInt(group, 16));
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  return groups;
}

function isPublicIpv6(address) {
  const g = ipv6Groups(address);
  if (!g) return false;
  const embedded = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  /* Prefixes that carry an IPv4 address are judged as that address. */
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicIpv4(embedded(g[6], g[7]));
  if (g[0] === 0x2002) return isPublicIpv4(embedded(g[1], g[2]));
  if ((g[0] === 0x0064 && g[1] === 0xff9b) || g.slice(0, 6).every((x) => x === 0)) return isPublicIpv4(embedded(g[6], g[7]));
  const first = g[0];
  if ((first & 0xfe00) === 0xfc00) return false;          // unique local
  if ((first & 0xffc0) === 0xfe80) return false;          // link local
  if ((first & 0xffc0) === 0xfec0) return false;          // site local (deprecated)
  if ((first & 0xff00) === 0xff00) return false;          // multicast
  if (first === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard
  if (first === 0x2001 && g[1] === 0x0000) return false;  // Teredo
  if (first === 0x2001 && g[1] === 0x0db8) return false;  // documentation
  return true;
}

function isPublicAddress(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isLocalName(hostname) {
  const name = String(hostname || '').replace(/\.$/, '').toLowerCase();
  return name === 'localhost'
    || ['.localhost', '.local', '.internal', '.lan', '.home.arpa'].some((suffix) => name.endsWith(suffix))
    || !name.includes('.');
}

/* Throws a short reason for anything a preview may not be made of. */
function checkedLink(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch (_error) { throw new Error('not a link'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http and https links get a preview');
  if (!url.hostname) throw new Error('the link has no host');
  if (url.username || url.password) throw new Error('a link carrying a password gets no preview');
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  if (ALLOW_PRIVATE) return url;
  if (!WEB_PORTS.has(port)) throw new Error('only links on web ports get a preview');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new Error('the link points at a private or local address');
  } else if (isLocalName(host)) {
    throw new Error('the link points at a local name');
  }
  return url;
}

/* The first public address the host resolves to; refuses a host that has
   only private ones. */
async function publicAddressFor(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return { address: host, family: net.isIP(host) };
  const answers = await dns.lookup(host, { all: true, verbatim: true });
  const found = answers.find((answer) => ALLOW_PRIVATE || isPublicAddress(answer.address));
  if (!found) throw new Error('the link points at a private or local address');
  return found;
}

/* One GET, connected to exactly the address that was checked. Resolves to
   { status, headers, body } with at most `limit` bytes of body. */
function getOnce(url, pinned, limit, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { reject(new Error('too slow')); return; }
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,image/*;q=0.9,*/*;q=0.5',
        'Accept-Encoding': 'identity',
      },
      lookup: (_hostname, options, callback) => {
        if (options && options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      },
      timeout: remaining,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        const room = limit - size;
        if (room <= 0) return;
        const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
        chunks.push(piece);
        size += piece.length;
        if (size >= limit) response.destroy();
      });
      const done = () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks) });
      response.on('end', done);
      response.on('close', done);
      response.on('error', () => done());
    });
    const timer = setTimeout(() => request.destroy(new Error('too slow')), remaining);
    request.on('timeout', () => request.destroy(new Error('too slow')));
    request.on('error', (error) => { clearTimeout(timer); reject(error); });
    request.on('close', () => clearTimeout(timer));
    request.end();
  });
}

/* `sameSite`: a page that redirects to another host is not followed at all —
   its card would show one site under a link to another, and the other site
   need not learn anything. Pictures may come from anywhere (a site's images
   usually live on another host), each hop checked like the first. */
async function fetchChecked(start, limit, deadline, { sameSite = false } = {}) {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const pinned = await publicAddressFor(current);
    const response = await getOnce(current, pinned, limit, deadline);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new Error('a redirect without a destination');
      current = checkedLink(new URL(String(location), current).href);
      if (sameSite && current.hostname !== start.hostname) return null;
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`the site answered ${response.status}`);
    return { url: current, contentType: String(response.headers['content-type'] || '').toLowerCase(), body: response.body };
  }
  throw new Error('too many redirects');
}

function decodeEntities(text) {
  return String(text || '').replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower === 'nbsp') return ' ';
    const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    try { return String.fromCodePoint(code); } catch (_error) { return whole; }
  });
}

function cleanText(text, max) {
  // eslint-disable-next-line no-control-regex
  return [...decodeEntities(text).replace(/\s+/g, ' ').trim().replace(/[\u0000-\u001f\u007f-\u009f]/g, '')].slice(0, max).join('');
}

function attribute(tag, name) {
  const pattern = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function readPage(html) {
  let title = '';
  let description = '';
  let site = '';
  let image = '';
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    const key = String(attribute(tag, 'property') || attribute(tag, 'name') || '').toLowerCase();
    const content = attribute(tag, 'content');
    if (content === null) continue;
    if (key === 'og:title') title = content;
    else if (key === 'twitter:title' && !title) title = content;
    else if (key === 'og:description') description = content;
    else if ((key === 'twitter:description' || key === 'description') && !description) description = content;
    else if (key === 'og:site_name') site = content;
    else if (['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'].includes(key) && !image) image = content;
  }
  if (!title) {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title/i);
    if (match) title = match[1];
  }
  return { title, description, site, image };
}

function imageMime(contentType) {
  const essence = String(contentType || '').split(';')[0].trim();
  if (essence === 'image/png') return 'image/png';
  if (essence === 'image/jpeg' || essence === 'image/jpg') return 'image/jpeg';
  if (essence === 'image/webp') return 'image/webp';
  if (essence === 'image/gif') return 'image/gif';
  return null;
}

/* Resolves to the preview, or null when the page offers nothing worth a
   card; rejects with a short reason when the link may not be fetched. */
async function linkPreview(raw) {
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  const start = checkedLink(raw);
  const page = await fetchChecked(start, MAX_PAGE_BYTES, deadline, { sameSite: true });
  if (!page) return null;
  if (!page.contentType.includes('text/html') && !page.contentType.includes('application/xhtml')) return null;
  if (page.url.hostname !== start.hostname) return null;
  const found = readPage(page.body.toString('utf8'));
  const result = {
    url: page.url.href,
    title: cleanText(found.title, 200),
    description: cleanText(found.description, 300),
    siteName: cleanText(found.site, 80),
    imageData: '',
    imageMime: '',
  };
  if (!result.title && !result.description) return null;
  if (found.image) {
    try {
      const imageUrl = checkedLink(new URL(decodeEntities(found.image.trim()), page.url).href);
      const picture = await fetchChecked(imageUrl, MAX_IMAGE_BYTES + 1, deadline);
      const mime = imageMime(picture.contentType);
      if (mime && picture.body.length && picture.body.length <= MAX_IMAGE_BYTES) {
        result.imageData = picture.body.toString('base64');
        result.imageMime = mime;
      }
    } catch (_error) { /* a card without a picture is still a card */ }
  }
  return result;
}

module.exports = { linkPreview, checkedLink, isPublicAddress, isLocalName, readPage, cleanText, MAX_IMAGE_BYTES };
