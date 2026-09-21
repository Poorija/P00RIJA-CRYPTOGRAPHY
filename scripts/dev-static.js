#!/usr/bin/env node
/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A static server for the app itself, for the edit-and-reload loop.
 *
 * The Docker stack is the real deployment and `scripts/server.js` is the
 * signalling relay; neither is what you want when you are moving a button two
 * pixels. This serves the working tree with caching turned off, so a reload
 * always shows the file you just saved.
 *
 *   npm run dev              -> http://localhost:8080
 *   PORT=9090 npm run dev
 *
 * http://localhost counts as a secure context in every current browser, so
 * WebCrypto, getUserMedia and service workers all work here without a
 * certificate. What does NOT work is a second device on your LAN pointing at
 * this: that is a plain-HTTP origin to them, and the browser will refuse the
 * camera. For two real devices, use the Docker stack over HTTPS.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.tgs': 'application/gzip',
};

/* Nothing outside the project may be read, whatever the request says. */
function resolveSafely(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]); } catch (_) { return null; }
  if (decoded.split('/').some(part => part.startsWith('.')) || /^\/(data|certs?|node_modules|src-tauri)(\/|$)/.test(decoded)) return null;
  const target = path.normalize(path.join(ROOT, decoded === '/' ? '/index.html' : decoded));
  return target.startsWith(ROOT + path.sep) ? target : null;
}

/* The same Content-Security-Policy nginx serves in production.
 *
 * Without this, every end-to-end suite ran against a page with no policy at
 * all, so a directive that breaks the app — a worker that cannot start, a
 * blob: URL that will not load, the Argon2 WASM refused — would only surface
 * after a deployment. connect-src is widened to localhost because the dev
 * relay lives on another port; every other directive is production's, which is
 * where the breakage would be. */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob: mediastream:",
  "connect-src 'self' blob: http://localhost:* https://localhost:* ws://localhost:* wss://localhost:*",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ');

/* The monitor is a different program with a different policy, and serving it
   under the application's CSP tests the wrong thing entirely: the app forbids
   plain http because it holds the user's vault, while the monitor's whole job
   is connecting to a relay the operator names — very often an http address on
   the LAN. Under DEV_CSP every one of those died as
   `connect-src -> http://127.0.0.1:9310/admin/login`, reaching the page as a
   bare "Failed to fetch".

   Read from tauri.monitor.conf.json rather than copied, so the policy under
   test here is the policy that actually ships. */
const MONITOR_CSP = (() => {
  try {
    const conf = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'src-tauri', 'tauri.monitor.conf.json'), 'utf8'));
    return conf?.app?.security?.csp || DEV_CSP;
  } catch (error) {
    console.warn('  monitor CSP unreadable, falling back to the app policy:', error.message);
    return DEV_CSP;
  }
})();

const server = http.createServer((request, response) => {
  const target = resolveSafely(request.url || '/');
  if (!target) {
    response.writeHead(403).end('Outside the project');
    return;
  }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        .end(`404 ${request.url}`);
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      /* No caching at all: a stale service worker or a cached chat.js is the
         single most common "but I fixed that" of this codebase. */
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-security-policy': path.basename(target) === 'monitor-client.html' ? MONITOR_CSP : DEV_CSP,
      'content-length': stat.size,
    });
    fs.createReadStream(target).pipe(response);
  });
});

server.listen(PORT, () => {
  console.log(`\n  P00RIJA dev server\n  ${ROOT}\n  http://localhost:${PORT}\n`);
  console.log('  Chat needs the relay too:  npm run relay');
  console.log('  Stop with Ctrl-C\n');
});
