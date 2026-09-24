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
   Each is infrastructure the distribution has no equivalent for rather than a
   gap: nginx probes and the certificate renewer's status endpoint. */
const DEPLOYED_ONLY = new Set(['/live', '/ready', '/cert-status']);

function routesOf(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const found = new Set();
  for (const match of source.matchAll(/^app\.(get|post|put|delete)\('([^']+)'/gm)) {
    found.add(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return found;
}

const deployed = routesOf(DEPLOYED);
const distributed = routesOf(DISTRIBUTED);

const missingFromDeployed = [...distributed].filter((route) => !deployed.has(route)).sort();
const missingFromDistributed = [...deployed]
  .filter((route) => !distributed.has(route))
  .filter((route) => !DEPLOYED_ONLY.has(route.split(' ')[1]))
  .sort();

console.log(`\n  ${DEPLOYED}: ${deployed.size} routes`);
console.log(`  ${DISTRIBUTED}: ${distributed.size} routes`);

if (!missingFromDeployed.length && !missingFromDistributed.length) {
  console.log(`\n  both relays answer the same calls\n`);
  process.exit(0);
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
