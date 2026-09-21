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

/* The relay image pins its dependencies in its own RUN line rather than
   installing from package.json, which means the repository and the running
   server can disagree without anything saying so.
   That is not hypothetical: an audit found ws upgraded to 8.21.3 here and
   still pinned at 8.20.0 there — a HIGH advisory reachable through the
   WebSocket frames the relay reads from untrusted clients all day. The fix
   lived in the repository and never reached a server.
   This makes the drift loud. Run before deploying. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(ROOT, 'config', 'Dockerfile.chat-signal'), 'utf8');
const line = dockerfile.split('\n').find((l) => /^RUN npm install/.test(l));
if (!line) {
  console.error('  no `RUN npm install` line in config/Dockerfile.chat-signal');
  process.exit(1);
}

const pinned = new Map();
for (const m of line.matchAll(/([@a-z0-9/-]+)@(\d[\w.-]*)/gi)) pinned.set(m[1], m[2]);

let bad = 0;
for (const [name, want] of pinned) {
  let have;
  try {
    have = require(path.join(ROOT, 'node_modules', name, 'package.json')).version;
  } catch (error) {
    console.log(`  ${name.padEnd(12)} pinned ${want}, not installed here — cannot compare`);
    continue;
  }
  const agree = have === want;
  if (!agree) bad += 1;
  console.log(`  ${agree ? 'ok  ' : 'DRIFT'} ${name.padEnd(12)} image ${want.padEnd(10)} repo ${have}`);
}

/* Overrides drift the same way pins do, and more quietly: a transitive package
   three levels under peer is nobody's idea of a dependency they own. The
   repository fixes it in package.json; the image can only see the copy the
   Dockerfile brings along. If the two stop agreeing, the repository is clean
   and the running relay is not. */
const repoOverrides = require(path.join(ROOT, 'package.json')).overrides || {};
let overridesFile = {};
try {
  overridesFile = require(path.join(ROOT, 'config', 'relay-overrides.json')).overrides || {};
} catch (error) {
  if (Object.keys(repoOverrides).length) {
    console.error('  package.json has overrides but config/relay-overrides.json is missing.');
    bad += 1;
  }
}
for (const [name, want] of Object.entries(repoOverrides)) {
  const agree = overridesFile[name] === want;
  if (!agree) bad += 1;
  console.log(`  ${agree ? 'ok  ' : 'DRIFT'} ${`override ${name}`.padEnd(12)} image ${String(overridesFile[name] || 'absent').padEnd(10)} repo ${want}`);
}
if (!dockerfile.includes('relay-overrides.json') && Object.keys(repoOverrides).length) {
  console.error('  config/relay-overrides.json is never COPYed, so npm never reads it.');
  bad += 1;
}

/* The OTHER relay. config/Dockerfile.chat-signal installs by name with exact
   versions, so the server the project runs is reproducible. standalone-relay —
   the copy handed to somebody self-hosting — had caret ranges, no lockfile, and
   a plain `npm install --production`, so its build resolved to whatever was
   newest that day. It had already drifted: ws ^8.20.0 against the 8.21.3 the
   production relay pins. Two relays running the same server.js should not be
   running different libraries underneath it. */
const standalonePath = path.join(ROOT, 'standalone-relay', 'package.json');
if (fs.existsSync(standalonePath)) {
  console.log('');
  const standalone = require(standalonePath).dependencies || {};
  for (const [name, want] of pinned) {
    const declared = standalone[name];
    if (declared === undefined) continue;
    const agree = declared === want;
    if (!agree) bad += 1;
    console.log(`  ${agree ? 'ok  ' : 'DRIFT'} standalone ${name.padEnd(10)} declares ${String(declared).padEnd(10)} dockerfile pins ${want}`);
  }
  for (const [name, declared] of Object.entries(standalone)) {
    if (/^[\^~]|\*|\s-\s|x/i.test(String(declared))) {
      console.error(`  RANGE standalone ${name} is "${declared}" — a range, so its image is not reproducible.`);
      bad += 1;
    }
  }
}

if (bad) {
  console.error(`\n  ${bad} dependency pin(s) differ between config/Dockerfile.chat-signal and node_modules.`);
  console.error('  The server runs what the Dockerfile says, so fix that line before deploying.');
  process.exit(1);
}
console.log(`  ${pinned.size + Object.keys(repoOverrides).length} relay dependency pin(s) agree with the repository`);
