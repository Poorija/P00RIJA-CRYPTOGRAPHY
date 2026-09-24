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

/* Everything index.html loads has to be in the service worker's lists, and
   everything in those lists has to be on disk.
 *
 * The worker names each asset it precaches. Adding a script to index.html and
 * not to sw.js therefore costs nothing a normal session would notice: the
 * fetch handler caches whatever it sees at runtime, so as soon as the file is
 * fetched once it is there. The gap only opens where this app is supposed to
 * be at its best. A version bump deletes the old cache, so after every update
 * the file is absent again until something online fetches it -- and a person
 * who updates, goes offline, and then reaches the feature that needed it finds
 * it missing, with no error that names the cause.
 *
 * js/image-formats.js and js/update-check.js were both added to index.html and
 * to neither list. HEIC and DNG photos would have opened for anyone online and
 * silently not for anyone who was not.
 *
 * The other direction is just as quiet: a file removed from the tree but left
 * in CORE_ASSETS makes install() reject -- addAll is all-or-nothing -- and the
 * worker never activates, which takes the whole offline shell with it.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const html = read('index.html');
const sw = read('sw.js');

/* Every local src= in index.html, minus the ?v= cache-busting suffix. */
const required = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((src) => !/^(https?:)?\/\//.test(src))
  .map((src) => src.replace(/[?#].*$/, '').replace(/^\.?\//, ''));

/* Both lists together: the split between them is about when a thing is
   fetched, not whether it is.

   Read out of the two arrays by name rather than by scanning the file for
   './' strings, which also finds the share-target URLs elsewhere in it and
   reports them as assets that do not exist. */
function assetList(name) {
  const opened = sw.indexOf(`const ${name} = [`);
  if (opened < 0) throw new Error(`sw.js no longer declares ${name}`);
  const closed = sw.indexOf('];', opened);
  if (closed < 0) throw new Error(`${name} is not closed in sw.js`);
  return [...sw.slice(opened, closed).matchAll(/'\.\/([^']*)'/g)].map((match) => match[1]);
}
const listed = new Set([...assetList('CORE_ASSETS'), ...assetList('LAZY_ASSETS')]);

const missing = required.filter((file) => !listed.has(file));
/* './' is the navigation entry, not a file. */
const vanished = [...listed].filter((file) => file !== '' && !fs.existsSync(path.join(ROOT, file)));

console.log(`\n  ${required.length} scripts in index.html, ${listed.size} assets named in sw.js`);

if (!missing.length && !vanished.length) {
  console.log(`\n  every script index.html loads is precached, and everything precached exists\n`);
  process.exit(0);
}

if (missing.length) {
  console.error(`\n  ${missing.length} script(s) index.html loads are in neither list in sw.js:`);
  missing.forEach((file) => console.error(`    ${file}`));
  console.error('\n  Add them to LAZY_ASSETS unless the first paint needs them, in which');
  console.error('  case they belong in CORE_ASSETS. Until then they are missing offline');
  console.error('  after every version bump, and nothing says why.');
}

if (vanished.length) {
  console.error(`\n  ${vanished.length} asset(s) named in sw.js are not on disk:`);
  vanished.forEach((file) => console.error(`    ${file}`));
  console.error('\n  A name in CORE_ASSETS that does not resolve makes install() reject,');
  console.error('  and the worker then never activates at all.');
}

console.error('');
process.exit(1);
