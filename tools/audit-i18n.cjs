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

/* The 40 data-i18n keys with no table entry, alongside the text that will be
   shown instead — which is the hard-coded Persian in the markup, in both
   languages, because applyTranslations skips a key it cannot find. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

/* Past the opening brace, not at it: starting the slice on `fa: {` made the
   line itself match the key pattern, so each table was reported as holding a
   key with its own name and every run ended with two findings that were the
   tool looking at itself. */
const faStart = app.indexOf('fa: {') + 'fa: {'.length;
const enStart = app.indexOf('en: {', faStart);
const enBody = enStart + 'en: {'.length;
const enEnd = app.indexOf('\n};', enStart);
const keysIn = (a, b) => new Set(Array.from(app.slice(a, b).matchAll(/^\s*([A-Za-z][\w]*)\s*:/gm)).map((m) => m[1]));
const fa = keysIn(faStart, enStart);
const en = keysIn(enBody, enEnd);

const found = new Map();
const attrs = ['data-i18n', 'data-i18n-title', 'data-i18n-placeholder', 'data-i18n-html', 'data-i18n-aria-label'];
for (const attr of attrs) {
  const re = new RegExp(`${attr}="([^"]+)"([^>]*)>([^<]{0,80})`, 'g');
  for (const m of html.matchAll(re)) {
    const key = m[1];
    if (fa.has(key) && en.has(key)) continue;
    if (!found.has(key)) found.set(key, { attr, text: '', placeholder: '', title: '' });
    const entry = found.get(key);
    if (attr === 'data-i18n' && !entry.text) entry.text = m[3].trim();
    if (attr === 'data-i18n-placeholder') {
      const ph = /placeholder="([^"]*)"/.exec(m[0]);
      if (ph) entry.placeholder = ph[1];
    }
    if (attr === 'data-i18n-title') {
      const ti = /title="([^"]*)"/.exec(m[0]);
      if (ti) entry.title = ti[1];
    }
  }
}
console.log(JSON.stringify([...found.entries()].map(([key, v]) => ({
  key, attr: v.attr, shown: v.text || v.placeholder || v.title,
  inFa: fa.has(key), inEn: en.has(key),
})), null, 1));

/* Findings are reported by the exit code as well as on screen, so a script can
   gate on this without parsing the output. Grepping the last line was the first
   attempt and each tool ends differently — a guard that misreads a clean run as
   a failure is a guard people learn to skip. */
if (found.size) process.exitCode = 1;
