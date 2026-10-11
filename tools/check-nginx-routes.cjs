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

/* Every relay path the app asks for must have a way through nginx.
 *
 * config/nginx.conf proxies to the relay by exact path, and anything it does
 * not name falls through to the single-page app: the client asks a JSON
 * question and is handed index.html with a 200. It happened to /relay-identity
 * and then again to /transit-peers — both endpoints answered perfectly when the
 * relay was addressed directly, so every suite passed and only the deployment
 * found it. This reads the paths the client builds with `new URL('/…')` and
 * checks each one against the locations the file declares.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const nginx = fs.readFileSync(path.join(ROOT, 'config', 'nginx.conf'), 'utf8');
const exact = new Set();
const prefixes = [];
for (const match of nginx.matchAll(/^\s*location\s+(=|\^~)?\s*(\/[^\s{]*)\s*\{/gm)) {
  if (match[1] === '=') exact.add(match[2]);
  else if (match[2] !== '/') prefixes.push(match[2]);
}

const files = [
  ...fs.readdirSync(path.join(ROOT, 'js')).filter((n) => n.endsWith('.js')).map((n) => path.join('js', n)),
  ...fs.readdirSync(path.join(ROOT, 'js', 'chat')).filter((n) => n.endsWith('.js')).map((n) => path.join('js', 'chat', n)),
];
const asked = new Map();
for (const file of files) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const match of source.matchAll(/new URL\('(\/[A-Za-z0-9_\/-]+)'/g)) {
    if (!asked.has(match[1])) asked.set(match[1], file);
  }
}

const missing = [];
for (const [route, file] of asked) {
  const served = exact.has(route) || prefixes.some((prefix) => route === prefix || route.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) || route.startsWith(prefix));
  if (!served) missing.push(`${route}  (asked for in ${file})`);
}

console.log(`\n  ${asked.size} relay path(s) the app asks for; ${exact.size} exact and ${prefixes.length} prefix location(s) in nginx.conf`);
if (missing.length) {
  console.log('\n  reach the single-page app instead of the relay:');
  missing.forEach((line) => console.log(`    ${line}`));
  console.log('');
  process.exit(1);
}
console.log('\n  every relay path the app asks for has a location in nginx.conf\n');
