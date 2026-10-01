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

/*
 * P00RIJA Cryptography — quick installer.
 *
 *   npx p00rija-cryptography@latest        download the native installer
 *   npx p00rija-cryptography@latest --pwa  serve the web app locally
 *
 * Downloads the right installer for this machine from the project's GitHub
 * releases, or serves the bundled web payload in a browser tab. Node standard
 * library only: no dependencies, no telemetry, no install scripts.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { get } from 'node:https';
import { createServer } from 'node:http';
import { createReadStream, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = 'Poorija/P00RIJA-Cryptography';
const USER_AGENT = 'p00rija-installer';

const log = (message) => console.log(`\x1b[1;34m▶\x1b[0m ${message}`);
const ok = (message) => console.log(`\x1b[1;32m✓\x1b[0m ${message}`);
const fail = (message) => {
  console.error(`\x1b[1;31m✖ ${message}\x1b[0m`);
  process.exit(1);
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GitHub API answered ${response.statusCode}`));
        return;
      }
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = (target, redirects = 0) => {
      if (redirects > 5) { reject(new Error('too many redirects')); return; }
      get(target, { headers: { 'User-Agent': USER_AGENT } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          request(response.headers.location, redirects + 1);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`download answered ${response.statusCode}`));
          return;
        }
        const file = createWriteStream(destination);
        response.pipe(file);
        file.on('finish', () => file.end(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    };
    request(url);
  });
}

function pickAsset(assets) {
  const arch = /arm64|aarch64/.test(os.arch()) ? 'arm64' : 'amd64';
  const table = {
    darwin: [`_${arch === 'arm64' ? 'aarch64' : 'universal'}.dmg`],
    win32: [`${arch === 'arm64' ? 'arm64' : 'x64'}-setup.exe`],
    linux: [arch === 'arm64' ? 'aarch64.AppImage' : 'amd64.AppImage'],
  };
  const suffixes = table[process.platform] || [];
  return assets.find((asset) => suffixes.some((suffix) => asset.name.includes(suffix))) || null;
}

function servePwa() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'app');
  if (!existsSync(path.join(root, 'index.html'))) {
    fail('web payload missing from this package — use the GitHub release instead');
  }
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
  };
    const server = createServer(async (request, response) => {
    let requested;
    try {
      requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch (_error) {
      response.writeHead(400).end();
      return;
    }
    let file = path.join(root, requested === '/' ? 'index.html' : requested);
    // The traversal guard needs the separator: a sibling directory whose name
    // shares this root as a prefix ("app-anything") passed the old prefix
    // check. Same root, or one step inside it, and nothing else.
    const inside = file === root || file.startsWith(root + path.sep);
    if (!inside) { response.writeHead(403).end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(root, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    ok(`PWA served at ${url}`);
    const opener = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(opener, args, { detached: true, stdio: 'ignore' }).unref();
    log('Press Ctrl+C to stop.');
  });
}

const args = process.argv.slice(2);
if (args.includes('--pwa')) {
  servePwa();
} else {
  log('Fetching the latest release…');
  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`)
    .catch((error) => fail(`could not reach GitHub: ${error.message}`));
  const asset = pickAsset(release.assets || []);
  if (!asset) fail('no installer for this platform in the latest release');
  /* The release publishes SHA256SUMS.txt and nothing consumed it: a
     compromised account or a swapped asset handed the installer over with no
     automatic way for the person to notice. The manifest is fetched and the
     bytes are checked before the file is called an installer. */
  const sumsAsset = (release.assets || []).find((entry) => entry.name === 'SHA256SUMS.txt');
  const destination = path.join(os.tmpdir(), asset.name);
  log(`Downloading ${asset.name} (${Math.round(asset.size / 1048576)} MB)…`);
  await download(asset.browser_download_url, destination)
    .catch((error) => fail(`download failed: ${error.message}`));
  if (sumsAsset) {
    const sumsDestination = path.join(os.tmpdir(), 'SHA256SUMS.txt');
    await download(sumsAsset.browser_download_url, sumsDestination)
      .catch(() => undefined);
    if (existsSync(sumsDestination)) {
      const wanted = (readFileSync(sumsDestination, 'utf8').split('\n')
        .find((line) => line.includes(asset.name)) || '').trim().split(/\s+/)[0];
      if (wanted) {
        const actual = createHash('sha256').update(readFileSync(destination)).digest('hex');
        if (wanted.toLowerCase() !== actual) {
          rmSync(destination, { force: true });
          fail(`checksum mismatch for ${asset.name} — the file has been deleted, nothing was run`);
        }
        ok(`Checksum verified against SHA256SUMS.txt (${actual.slice(0, 16)}…)`);
      }
    }
  }
  ok(`Installer saved to ${destination}`);
  log('Open the file to install — checksums live in SHA256SUMS.txt of the release.');
}
