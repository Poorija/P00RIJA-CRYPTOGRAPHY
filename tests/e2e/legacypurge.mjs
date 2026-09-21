/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.

   A grep, promoted to a test.

   Removing RC4 and TripleDES from the algorithm chooser is not the same as
   removing them from the product: dead branches still ship, still appear in a
   reviewer's search, and still run if some code path reaches them by accident.
   This walks the files that are actually served and fails if any of them can
   still perform a broken cipher.

   It reads the tree rather than a running browser deliberately. What matters
   is what is in the bytes that leave the server.                              */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* fileURLToPath, not URL.pathname: this project lives in a directory whose
   name contains spaces, and pathname hands them back percent-encoded. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

/* Everything the browser is served. Not tests, not docs, not the plan file
   that discusses what was removed. */
function shippedFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.git', 'src-tauri', 'tests', 'docs'].includes(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (/\.(js|html|mjs)$/.test(entry)) out.push(full);
    }
  };
  walk(join(ROOT, 'js'));
  walk(join(ROOT, 'vendor'));
  out.push(join(ROOT, 'index.html'));
  out.push(join(ROOT, 'sw.js'));
  return out;
}

const files = shippedFiles();
console.log(`\n===== scanning ${files.length} shipped files =====`);
check('there is something to scan', files.length > 10, `${files.length} files`);

/* Comments may discuss these; code may not perform them. Strip block and line
   comments before searching so the note explaining why RC4 was removed does
   not fail the test that removed it. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const BANNED = [
  ['RC4', /\bRC4\b/],
  ['TripleDES / 3DES', /\bTripleDES\b|\b3DES\b/],
  ['Rabbit cipher', /CryptoJS\s*\.\s*Rabbit|['"]Rabbit \*['"]/],
  ['CryptoJS itself', /\bCryptoJS\s*\./],
  ['unauthenticated CFB', /mode\s*\.\s*CFB|['"]AES-256-CFB/],
  ['unauthenticated OFB', /mode\s*\.\s*OFB|['"]AES-256-OFB/]
];

for (const [label, pattern] of BANNED) {
  const hits = [];
  for (const file of files) {
    const body = code(readFileSync(file, 'utf8'));
    if (pattern.test(body)) hits.push(relative(ROOT, file));
  }
  check(`no shipped file can perform ${label}`, hits.length === 0, hits.join(', '));
}

/* No shipped code may WRITE a password record to storage.

   Reading poorija_master_hash is still legitimate — the legacy verifier has to
   check one before converting the install — but writing one puts the artifact
   back on disk, and that artifact is the entire thing the two-slot vault
   exists to remove. The migration import path did exactly this: it restored
   the master hash out of an exported bundle, so importing your own backup
   silently reintroduced a stored credential on a device that had none. */
{
  const writers = [];
  for (const file of files) {
    const body = code(readFileSync(file, 'utf8'));
    const re = /setItem\(\s*['"](poorija_(?:master_hash|panic_hash))['"]/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      writers.push(`${relative(ROOT, file)} writes ${m[1]}`);
    }
  }
  check('nothing shipped writes a password record to storage',
    writers.length === 0, writers.join('; '));
}

/* And nothing may put one into an exported file either. */
{
  const leaks = [];
  for (const file of files) {
    const body = code(readFileSync(file, 'utf8'));
    if (/masterHash\s*:\s*localStorage\.getItem/.test(body)) {
      leaks.push(relative(ROOT, file));
    }
  }
  check('no export bundle carries a password record', leaks.length === 0, leaks.join(', '));
}

check('the crypto-js vendor directory is gone',
  !files.some((f) => f.includes('vendor/crypto-js')));

/* The chooser itself. Every algorithm a user can pick has to be authenticated,
   because an unauthenticated one in a list is an invitation to pick it. */
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const config = require('../../js/crypto-config.js');

const offered = config.getSafeAlgorithms();
console.log(`\n===== the ${offered.length} algorithms on offer =====`);
console.log('  ' + offered.map((a) => a.id).join(', '));

check('every offered algorithm is authenticated or a hybrid over one',
  offered.every((a) => a.authenticated || a.family === 'hybrid-rsa'),
  offered.filter((a) => !a.authenticated && a.family !== 'hybrid-rsa').map((a) => a.id).join(', '));
check('nothing is marked legacy-only',
  offered.every((a) => !a.legacyOnly));
check('the legacy list is empty', config.getLegacyAlgorithms().length === 0);
check('no ECB, CFB, OFB, CTR or bare CBC is on offer',
  !offered.some((a) => /ECB|CFB|OFB|CTR|-CBC/.test(a.id)),
  offered.map((a) => a.id).join(','));
check('AES-256-GCM is still the recommended default',
  offered.find((a) => a.recommended)?.id === 'AES-256-GCM');
check('XChaCha20-Poly1305 is available as the non-AES option',
  offered.some((a) => a.id === 'XCHACHA20-POLY1305'));

const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
