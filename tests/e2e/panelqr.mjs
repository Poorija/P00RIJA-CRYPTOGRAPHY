/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The panel's own QR encoder (tools/panel/qr.mjs), proven by reading its
 * output back with the QR decoder the app already ships (vendor/jsqr): every
 * text drawn must decode to itself. Then the terminal and SVG drawings, and
 * setup-login showing the code in a terminal.
 *
 *   node tests/e2e/panelqr.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const jsQR = require(path.join(ROOT, 'vendor/jsqr/jsQR.js')).default || require(path.join(ROOT, 'vendor/jsqr/jsQR.js'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/* Modules to pixels, the way a camera would see a printed code. */
function decode(modules) {
  const size = modules.length;
  const scale = 4;
  const quiet = 4;
  const width = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const at = (((y + quiet) * scale + dy) * width + (x + quiet) * scale + dx) * 4;
          data[at] = 0; data[at + 1] = 0; data[at + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, width, width)?.data ?? null;
}

let qr = null;
try {
  qr = await import(pathToFileURL(path.join(ROOT, 'tools/panel/qr.mjs')));
  const texts = [
    'a',
    'P00RIJA Panel 17c',
    `otpauth://totp/P00RIJA%20Panel:op?secret=JBSWY3DPEHPK3PXP&issuer=P00RIJA%20Panel`,
    `otpauth://totp/P00RIJA%20Panel:pooriya?secret=${'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(2)}&issuer=P00RIJA%20Panel`,
    'x'.repeat(250),
    'پنل مرکزی',
  ];
  for (const text of texts) {
    const { size, modules } = qr.encodeQr(text);
    const back = decode(modules);
    check(`a ${text.length}-character text reads back (${size}×${size})`, back === text, back === null ? 'not decoded' : JSON.stringify(back).slice(0, 60));
  }
  const sample = qr.encodeQr(texts[2]);
  const drawn = qr.qrTerminal(texts[2]).split('\n');
  check('the terminal drawing is half-block rows with a quiet zone',
    drawn.length === Math.ceil((sample.size + 4) / 2) && drawn.every((line) => [...line].length === sample.size + 4) && /[▀▄█]/.test(drawn.join('')),
    `${drawn.length} lines of ${[...drawn[0]].length}`);
  const svg = qr.qrSvg(texts[2]);
  check('the SVG drawing is an SVG with crisp edges', svg.startsWith('<svg') && svg.includes('crispEdges'));
  let threw = false;
  try { qr.encodeQr('y'.repeat(2000)); } catch (_error) { threw = true; }
  check('a text too long for the versions it draws is refused, not drawn wrong', threw);
} catch (error) {
  check('the encoder loads and runs', false, error?.stack?.split('\n').slice(0, 3).join(' ') || String(error));
}

/* setup-login, in a terminal, shows the code to scan and the secret under it. */
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-qr-'));
try {
  /* script(1) gives it a terminal; its own input has to be a pipe, not the
     socket spawnSync would hand it, and arrive line by line as typed. */
  const run = spawnSync('bash', ['-c', `(sleep 1; printf 'op\\n'; sleep 1; printf 'A-long-enough-password-42\\n'; sleep 1; printf 'A-long-enough-password-42\\n'; sleep 2) | script -q /dev/null "${process.execPath}" "${path.join(ROOT, 'tools/panel/setup-login.mjs')}"`], {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, POORIJA_PANEL_STATE_DIR: state },
  });
  const out = `${run.stdout}${run.stderr}`;
  const qrAt = out.search(/[▀▄█]{4}/);
  const secretAt = out.search(/secret: [A-Z2-7]{4} /);
  check('setup-login draws the QR code in the terminal', qrAt >= 0, out.slice(-300));
  check('with the secret and the link under it', secretAt > qrAt && /otpauth:\/\/totp\//.test(out.slice(secretAt)), '');
} finally {
  fs.rmSync(state, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
