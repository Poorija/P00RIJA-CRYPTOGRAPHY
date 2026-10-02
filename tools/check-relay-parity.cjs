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

/* Two relays live in this repository and they have to answer the same calls.
 *
 * config/Dockerfile.chat-signal copies scripts/server.js and runs it, and
 * `npm run relay` starts the same file. standalone-relay/server.js is the
 * self-contained distribution somebody else runs. They are different programs
 * -- the deployed one carries rate limiting, per-address socket caps, TLS
 * paths and a graceful shutdown that the distribution does not -- so this does
 * not compare them line by line. What it compares is the surface a client
 * talks to.
 *
 * It exists because that surface silently came apart. Every feature added
 * after 2.26.95 went into standalone-relay and none of it into the file the
 * Dockerfile builds, and every test suite spawned standalone-relay, so the
 * whole release was proven against a program nobody runs. It surfaced as a
 * phone reporting
 *
 *   SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * when notifications were turned on: Express's 404 page for /push/challenge,
 * a route the deployed relay had never had. Nine months of work, one error
 * message, and nothing anywhere saying the two had diverged.
 *
 * A route in one and not the other is either a feature the deployment is
 * missing or one the distribution is. Both are worth stopping a release for;
 * which it is, the person reading the list can tell at a glance.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEPLOYED = 'scripts/server.js';
const DISTRIBUTED = 'standalone-relay/server.js';

/* Routes the deployed relay has and the distribution deliberately does not.
   Each is infrastructure the distribution has no equivalent for rather than
   a gap: nginx probes and the certificate renewer's status endpoint, and —
   from monitor 3.33 — the whole /Monitor_Server/ management surface, which
   drives the deployment's docker engine, its backups and its GitHub
   updates. The distribution runs on a stranger's machine with none of that
   around it; a client never calls any of these, so the surface a client
   talks to has not moved. */
const DEPLOYED_ONLY = new Set(['/live', '/ready', '/cert-status']);
const DEPLOYED_ONLY_PREFIXES = ['/Monitor_Server/'];

function routesOf(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const found = new Set();
  for (const match of source.matchAll(/^app\.(get|post|put|delete)\('([^']+)'/gm)) {
    found.add(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return found;
}

/* The shared modules, which are a second way the two can come apart.
 *
 * scripts/lib is the only copy in the repository. Both images get it by
 * copying the whole directory in, and standalone-relay/lib is a build
 * artifact that is gitignored and reproduced by the test harness — so there
 * is nothing here to compare file against file, and everything to check about
 * HOW it is copied.
 *
 * Naming the files one at a time is the failure. It worked for as long as
 * there was one module, and the day a second appeared the relay that had been
 * given only the first died on `Cannot find module`. So: both Dockerfiles
 * copy the directory, and every module the distribution requires from ./lib
 * exists in the one directory they copy.
 *
 * A stale copy left in the working tree by a crashed run is reported too. It
 * is not a release problem, but it is a program that quietly ran with the
 * wrong module, which is worth a line. */
function libParityProblems() {
  const source = path.join(ROOT, 'scripts', 'lib');
  const shared = fs.readdirSync(source).filter((name) => name.endsWith('.js'));
  const problems = [];

  const copiesWholeDirectory = [
    ['standalone-relay/Dockerfile.relay', /^COPY\s+scripts\/lib\s+\S+$/m],
    ['config/Dockerfile.chat-signal', /^COPY\s+scripts\/lib\s+\S+$/m],
  ];
  for (const [file, pattern] of copiesWholeDirectory) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (!pattern.test(text)) {
      problems.push(`${file} does not copy scripts/lib as a directory — a new shared module will not reach it`);
    }
    for (const match of text.matchAll(/^COPY\s+scripts\/lib\/(\S+)/gm)) {
      problems.push(`${file} copies scripts/lib/${match[1]} by name; copy the directory instead`);
    }
  }

  const distribution = fs.readFileSync(path.join(ROOT, DISTRIBUTED), 'utf8');
  for (const match of distribution.matchAll(/require\('\.\/lib\/([\w.-]+)'\)/g)) {
    if (!shared.includes(match[1])) {
      problems.push(`${DISTRIBUTED} requires ./lib/${match[1]}, which is not in scripts/lib`);
    }
  }

  const copy = path.join(ROOT, 'standalone-relay', 'lib');
  if (fs.existsSync(copy)) {
    for (const name of fs.readdirSync(copy).filter((entry) => entry.endsWith('.js'))) {
      const original = path.join(source, name);
      if (!fs.existsSync(original)) {
        problems.push(`standalone-relay/lib/${name} is left over and has no original — delete it`);
      } else if (!fs.readFileSync(original).equals(fs.readFileSync(path.join(copy, name)))) {
        problems.push(`standalone-relay/lib/${name} is a stale copy — delete it, the harness recreates it`);
      }
    }
  }
  return problems;
}

const deployed = routesOf(DEPLOYED);
const distributed = routesOf(DISTRIBUTED);
const libProblems = libParityProblems();

const missingFromDeployed = [...distributed].filter((route) => !deployed.has(route)).sort();
const missingFromDistributed = [...deployed]
  .filter((route) => !distributed.has(route))
  .filter((route) => !DEPLOYED_ONLY.has(route.split(' ')[1]))
  .filter((route) => !DEPLOYED_ONLY_PREFIXES.some((prefix) => route.split(' ')[1].startsWith(prefix)))
  .sort();

console.log(`\n  ${DEPLOYED}: ${deployed.size} routes`);
console.log(`  ${DISTRIBUTED}: ${distributed.size} routes`);

console.log(`  shared modules: ${fs.readdirSync(path.join(ROOT, 'scripts', 'lib')).filter((n) => n.endsWith('.js')).length}`);

if (!missingFromDeployed.length && !missingFromDistributed.length && !libProblems.length) {
  console.log(`\n  both relays answer the same calls, from the same modules\n`);
  process.exit(0);
}

if (libProblems.length) {
  console.error(`\n  ${libProblems.length} shared module problem(s):`);
  libProblems.forEach((problem) => console.error(`    ${problem}`));
  console.error('\n  scripts/lib is the only copy. Both images copy the directory, not files.');
}

if (missingFromDeployed.length) {
  console.error(`\n  ${missingFromDeployed.length} route(s) the DEPLOYED relay does not answer:`);
  missingFromDeployed.forEach((route) => console.error(`    ${route}`));
  console.error(`\n  ${DEPLOYED} is what the Dockerfile builds. A route only in the`);
  console.error('  distribution is a feature that reaches nobody, and the app calling it');
  console.error("  gets Express's 404 page where it expected JSON.");
}

if (missingFromDistributed.length) {
  console.error(`\n  ${missingFromDistributed.length} route(s) the DISTRIBUTION does not answer:`);
  missingFromDistributed.forEach((route) => console.error(`    ${route}`));
  console.error(`\n  Anyone running ${DISTRIBUTED} is missing these. Add them there,`);
  console.error('  or name them in DEPLOYED_ONLY here with the reason.');
}

console.error('');
process.exit(1);
