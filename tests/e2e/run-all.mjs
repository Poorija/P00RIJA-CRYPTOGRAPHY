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

/* Runs every end-to-end suite against a running instance and prints one table.
   The suites drive two or three real browsers each, against a real relay, and
   assert on measured geometry rather than on snapshots - so they are slow
   (roughly 25 minutes for the lot) and they are worth it: every one of them
   exists because something shipped broken.

     npm run test:e2e                    # everything, against localhost:8585
     npm run test:e2e -- calls gcallui   # only those two
     PKG_URL=https://box.local:8585 npm run test:e2e

   Each suite is a standalone script: `node tests/e2e/gcallui.mjs` works on its
   own, which is what you want while fixing one thing. */
import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CY = '[36m';
const RD = '[31m';
const GN = '[32m';
const RS = '[0m';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.PKG_URL || 'https://localhost:8585';
const SHOTS = process.env.PKG_SHOTS || join(HERE, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const asked = process.argv.slice(2).map((name) => name.replace(/\.mjs$/, ''));
const suites = readdirSync(HERE)
  /* Files starting with an underscore are shared helpers, not suites: running
     one as a suite produces no result and reads as a crash. */
  .filter((file) => file.endsWith('.mjs') && file !== 'run-all.mjs' && !file.startsWith('_'))
  .map((file) => file.replace(/\.mjs$/, ''))
  .filter((name) => !asked.length || asked.includes(name))
  .sort();

if (!suites.length) {
  console.error(`No suite matched ${asked.join(', ')}`);
  process.exit(2);
}

/* Fail loudly and early rather than after twenty minutes of timeouts. */
async function reachable() {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const response = await fetch(`${BASE_URL}/index.html`, { method: 'HEAD' });
    return response.ok;
  } catch (_error) {
    return false;
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
}

if (!await reachable()) {
  console.error(`\n  ${BASE_URL} is not answering.`);
  console.error('  Start the stack first:  docker compose -f config/docker-compose.yaml up -d');
  console.error('  or point the suites elsewhere with PKG_URL=https://host:port\n');
  process.exit(2);
}

const runSuite = (name) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(process.execPath, [join(HERE, `${name}.mjs`)], {
    env: { ...process.env, PKG_URL: BASE_URL, PKG_SHOTS: SHOTS },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
  /* stderr goes to the screen as well as into `output`.
     It used to only accumulate, so a suite that died on an exception was
     reported as CRASHED under a line reading "scroll up for the stack" — and
     the stack had never been printed. The one piece of evidence the runner
     names is the one piece it was throwing away. */
  child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
  child.on('close', (code) => {
    /* Three shapes are in use across the suites, and a shape this does not
       know is reported as a crash with its checks dropped from the total —
       which is worse than useless, because it invents failures.
         "===== 3 failed of 40 ====="   the older half
         "===== 3 failing of 40 ====="  the same, other spelling
         "37/40 passed"                 the newer suites
       nativeui adds a note after its count, hence [^=]* in the first pattern.
       A full sweep once reported five passing suites as crashed for no reason
       but this. */
    const counted = [...output.matchAll(/=====\s*(\d+)\s+fail(?:ed|ing)\s+of\s+(\d+)\b[^=]*=====/g)].pop();
    const passed = [...output.matchAll(/^\s*(\d+)\/(\d+)\s+passed\s*$/gm)].pop();
    const checkCount = [...output.matchAll(/^\s*(\d+) checks passed\s*$/gm)].pop();
    const tally = counted
      ? { failed: Number(counted[1]), total: Number(counted[2]) }
      : passed
        ? { failed: Number(passed[2]) - Number(passed[1]), total: Number(passed[2]) }
        : checkCount ? { failed: 0, total: Number(checkCount[1]) } : null;
    resolve({
      name,
      failed: tally ? tally.failed : null,
      total: tally ? tally.total : null,
      crashed: !tally || (code !== 0 && tally.failed === 0),
      seconds: Math.round((Date.now() - started) / 1000),
    });
  });
});

const results = [];
for (const name of suites) {
  console.log(`\n${CY}-------- ${name} --------${RS}`);
  // eslint-disable-next-line no-await-in-loop
  results.push(await runSuite(name));
}

console.log('\n\n  suite                 checks   failed   time');
console.log('  ------------------------------------------------');
let checks = 0;
let failures = 0;
let crashed = 0;
for (const result of results) {
  checks += result.total || 0;
  failures += result.failed || 0;
  if (result.crashed) crashed += 1;
  const mark = result.crashed ? `${RD}CRASHED${RS}` : (result.failed ? `${RD}${result.failed}${RS}` : `${GN}0${RS}`);
  console.log(`  ${result.name.padEnd(20)}  ${String(result.total ?? '-').padStart(6)}   ${mark.padStart(6)}   ${String(result.seconds).padStart(4)}s`);
}
console.log('  ------------------------------------------------');
console.log(`  ${String(results.length).padEnd(20)}  ${String(checks).padStart(6)}   ${String(failures).padStart(6)}\n`);
if (crashed) console.log(`  ${crashed} suite(s) did not finish - scroll up for the stack.\n`);
process.exit(failures || crashed ? 1 : 0);
