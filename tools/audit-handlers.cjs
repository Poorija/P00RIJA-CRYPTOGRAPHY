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

/* Inline handlers that call a function nothing defines.
 *
 * `onclick="doThing()"` is resolved at click time against the global object, so
 * a handler naming a function that was renamed or removed is silent until
 * somebody presses the button — and then it is an uncaught ReferenceError with
 * no visible effect. No end-to-end test catches this unless it happens to click
 * that exact control.
 *
 * Also checks that every src/href in the markup resolves to a file, and that
 * the service worker's precache list matches what is on disk: a precached URL
 * that 404s makes the whole install fail, which silently disables offline use.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* Every name that ends up callable from an inline attribute: function
   declarations at the top level of a classic script become window properties,
   and so do explicit window.x = assignments. */
const defined = new Set(['alert', 'confirm', 'prompt', 'print', 'open', 'close', 'event', 'this']);
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'vendor') walk(full); }
    else if (entry.name.endsWith('.js')) files.push(full);
  }
};
walk(path.join(ROOT, 'js'));
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const m of source.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) defined.add(m[1]);
  for (const m of source.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
  for (const m of source.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm)) defined.add(m[1]);
}
/* index.html's own inline scripts define globals too — toggleNativeShellDiag
   lives there and nowhere else, and scanning only js/ reported it as missing. */
for (const block of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
  const source = block[1];
  for (const m of source.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
  for (const m of source.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) defined.add(m[1]);
}

/* Vendor libraries define globals the markup may call. */
const vendorDir = path.join(ROOT, 'vendor');
if (fs.existsSync(vendorDir)) {
  ['QRCode', 'jsQR', 'Chart', 'JSZip', 'otpauth', 'html2canvas'].forEach((n) => defined.add(n));
}

const called = new Map();
for (const m of html.matchAll(/\bon[a-z]+="([^"]*)"/g)) {
  const body = m[1];
  /* A method call is not a global: `document.getElementById(x).click()` was
     reported here as two missing functions, which is noise that buries the one
     real finding underneath it. Anything preceded by a dot belongs to whatever
     is on its left, and that is not this tool's question. */
  for (const c of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = c[2];
    if (defined.has(name)) continue;
    if (!called.has(name)) called.set(name, []);
    if (called.get(name).length < 3) called.get(name).push(body.slice(0, 70));
  }
}

console.log(`inline handler attributes: ${[...html.matchAll(/\bon[a-z]+="/g)].length}`);
console.log(`global functions discovered: ${defined.size}`);
console.log(`\n== inline handlers calling something undefined: ${called.size} ==`);
[...called.entries()].forEach(([name, where]) => console.log(`   ${name}()  <- ${where[0]}`));

/* Assets */
const assets = new Set();
for (const m of html.matchAll(/(?:src|href)="([^"#?][^"]*?)(?:\?[^"]*)?"/g)) {
  const url = m[1];
  /* Any URI scheme is somebody else's to resolve, not a path on disk: the
     donation link is ton:, and reporting it as a missing file every run taught
     people to skim this section. */
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) continue;
  assets.add(url);
}
const missingAssets = [...assets].filter((url) => !fs.existsSync(path.join(ROOT, url.replace(/^\.\//, ''))));
console.log(`\n== src/href targets that are not on disk: ${missingAssets.length} ==`);
missingAssets.forEach((url) => console.log('   ' + url));

/* Do the inline scripts even parse?
 *
 * index.html carries several hundred lines of its own JavaScript — the viewport
 * measurement, the install gate, the service-worker registration — and nothing
 * checked it. `node --check` covers js/*.js and stops at the markup, so a
 * syntax error in here reached a full regression run before anything said a
 * word, and what it said was seventeen suites failing at once because the app
 * never booted. One parse is cheaper than that. */
{
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
  const broken = [];
  blocks.forEach((code, index) => {
    try {
      new Function(code);
    } catch (error) {
      broken.push(`block ${index + 1}: ${error.message}`);
    }
  });
  console.log(`\n== inline scripts in index.html that do not parse: ${broken.length} of ${blocks.length} ==`);
  broken.forEach((line) => console.log('   ' + line));
  if (broken.length) process.exitCode = 1;
}

/* Service worker precache */
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
/* Read the two lists by name. Taking the first '[' in the file found
   NETWORK_ONLY_PREFIXES instead, whose entries are absolute paths that match
   nothing here, so this reported every script in the app as uncached — a tool
   that cries wolf on all 62 files is one nobody reads. */
function swList(name) {
  const start = sw.indexOf(`${name} = [`);
  if (start < 0) return null;
  const end = sw.indexOf('];', start);
  return [...sw.slice(start, end).matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
}
const core = swList('CORE_ASSETS');
const lazy = swList('LAZY_ASSETS');
if (!core || !lazy) {
  console.log('\n== sw.js precache lists could not be read; rename or reshape? ==');
  process.exitCode = 1;
}
const precache = [...(core || []), ...(lazy || [])];
const missingPrecache = precache.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
console.log(`\n== precached by sw.js but not on disk: ${missingPrecache.length} of ${precache.length} ==`);
missingPrecache.forEach((rel) => console.log('   ' + rel));

/* Scripts index.html loads but sw.js never caches: those stop the app working
   offline even though the install succeeds. */
const scripts = [...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map((m) => m[1].replace(/^\.\//, ''));
const uncached = scripts.filter((s) => !precache.some((p) => p.replace(/^\.\//, '') === s));
console.log(`\n== scripts loaded by index.html but not precached: ${uncached.length} of ${scripts.length} ==`);
uncached.slice(0, 20).forEach((s) => console.log('   ' + s));
if (uncached.length > 20) console.log(`   … and ${uncached.length - 20} more`);
