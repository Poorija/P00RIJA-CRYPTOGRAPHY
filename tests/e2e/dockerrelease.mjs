/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* scripts/dockerhub-release.sh refuses to publish an image that carries a
 * private string. `docker push` sends every layer, so a file written in one
 * layer and deleted in the next still ships: the check has to read the
 * layers, not the image's final filesystem. A throwaway image does exactly
 * that with a canary string, and must be caught; plain alpine must pass.
 *
 *   node tests/e2e/dockerrelease.mjs      (needs Docker)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/dockerhub-release.sh');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 600000, ...opts });

if (sh('docker', ['info']).status !== 0) {
  console.log('  SKIP  Docker is not running');
  process.exit(0);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-leak-'));
const IMAGE = `poorija-leaktest:${process.pid}`;
try {
  check('the release script exists and parses', fs.existsSync(SCRIPT) && sh('bash', ['-n', SCRIPT]).status === 0);
  const help = sh('bash', [SCRIPT, '--help']);
  check('--help names the four images', ['poorija/p00rija-panel', 'poorija/p00rija-app', 'poorija/p00rija-relay', 'poorija/p00rija-cert-renewer'].every((name) => help.stdout.includes(name)), '');

  fs.writeFileSync(path.join(work, 'Dockerfile'), 'FROM alpine:latest\nRUN echo leak-canary-7f3 > /planted\nRUN rm /planted\n');
  const built = sh('docker', ['build', '-q', '-t', IMAGE, work]);
  check('a throwaway image that wrote a canary and deleted it', built.status === 0, built.stderr.slice(-200));
  const strings = path.join(work, 'private.txt');
  fs.writeFileSync(strings, '# comment line\nleak-canary-7f3\treplacement\n');

  const caught = sh('bash', [SCRIPT, '--scan-only', IMAGE, '--private-file', strings]);
  check('the check finds the canary in a layer below the final one, and in the build history', caught.status === 3 && /LEAK: \S+ planted$/m.test(caught.stdout) && /LEAK: \S+ config-[0-9a-f]{12}\.json$/m.test(caught.stdout), `exit ${caught.status} ${(caught.stdout + caught.stderr).slice(-200)}`);
  const clean = sh('bash', [SCRIPT, '--scan-only', 'alpine:latest', '--private-file', strings]);
  check('and passes an image without it', clean.status === 0, `exit ${clean.status} ${(clean.stdout + clean.stderr).slice(-200)}`);
  const nothing = sh('bash', [SCRIPT, '--scan-only', 'alpine:latest', '--private-file', path.join(work, 'none.txt')], { env: { ...process.env, HOME: work, POORIJA_PRIVATE_STRINGS: path.join(work, 'absent.txt') } });
  check('with nothing to look for it says so rather than claiming a clean scan', /nothing to look for/i.test(nothing.stdout + nothing.stderr), (nothing.stdout + nothing.stderr).slice(-200));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  sh('docker', ['rmi', '-f', IMAGE]);
  fs.rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
