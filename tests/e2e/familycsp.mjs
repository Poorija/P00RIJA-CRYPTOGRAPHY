/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The page's connect-src allows the relays of its family (config/nginx-mirror-csp.sh).
 *
 * Guest mode and best relay (js/chat/62-guest-mode.js, 63-relay-choice.js)
 * reach the family's other relays from the page. In the browser that is
 * allowed only if the page's Content-Security-Policy names them, so the app
 * container reads the signed family list from its relay when it starts, and
 * again every few minutes, and writes every relay's https and wss origins into
 * connect-src. This builds the real app image and runs it beside a stand-in
 * relay that serves a family list.
 *
 *   node tests/e2e/familycsp.mjs           # needs Docker
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryDocker = (...args) => { try { return docker(...args); } catch (error) { return String(error.stdout || '') + String(error.stderr || ''); } };

const tag = `poorija-familycsp:${process.pid}`;
const net = `poorija-familycsp-${process.pid}`;
const relayName = `poorija-familycsp-relay-${process.pid}`;
const appName = `poorija-familycsp-app-${process.pid}`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-familycsp-'));
const listOf = (origins) => JSON.stringify({ body: { v: 1, serial: 1, relays: origins.map((o, i) => ({ id: String(i).repeat(64).slice(0, 64), origins: [o.origin], ...(o.inside ? { inside: o.inside } : {}) })) }, sig: 'x' });

try {
  console.log('\n===== the family in the page’s connect-src =====');
  docker('build', '-q', '-f', 'config/Dockerfile', '-t', tag, ROOT);
  fs.mkdirSync(path.join(work, 'certs'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(work, 'certs', 'privkey.pem'), '-out', path.join(work, 'certs', 'fullchain.pem'), '-days', '1', '-subj', '/CN=test'], { stdio: 'ignore' });
  fs.mkdirSync(path.join(work, 'relay'));
  fs.writeFileSync(path.join(work, 'relay', 'relay-directory'), listOf([
    { origin: 'https://one.example:8585' },
    { origin: 'https://two.example:8585', inside: ['https://10.0.0.2:8585', 'http://plain.example:9000'] },
  ]));
  fs.writeFileSync(path.join(work, 'relay.conf'), 'server { listen 9000; location / { root /srv; default_type application/json; } }\n');
  docker('network', 'create', net);
  docker('run', '-d', '--name', relayName, '--network', net, '--network-alias', 'chat-signal',
    '-v', `${path.join(work, 'relay')}:/srv:ro`, '-v', `${path.join(work, 'relay.conf')}:/etc/nginx/conf.d/default.conf:ro`, 'nginx:alpine');
  docker('run', '-d', '--name', appName, '--network', net, '-v', `${path.join(work, 'certs')}:/etc/nginx/certs:ro`,
    '-e', 'APP_ORIGIN=https://app.example', '-e', 'APP_ORIGIN_WS=wss://app.example', '-e', 'APP_FAMILY_REFRESH_SECONDS=2', tag);
  const csp = () => {
    const headers = tryDocker('exec', appName, 'sh', '-c', 'wget -S -O /dev/null --no-check-certificate https://127.0.0.1:8585/index.html 2>&1');
    return (headers.match(/content-security-policy:[^\n]*/i) || [''])[0];
  };
  let first = '';
  for (let i = 0; i < 40 && !/one\.example/.test(first); i += 1) { await sleep(500); first = csp(); }
  const connect = (text) => (text.match(/connect-src[^;]*/) || [''])[0];
  check('every relay of the family is in connect-src, https and wss', /https:\/\/one\.example:8585/.test(connect(first)) && /wss:\/\/one\.example:8585/.test(connect(first))
    && /https:\/\/two\.example:8585/.test(connect(first)) && /wss:\/\/two\.example:8585/.test(connect(first)), connect(first).slice(0, 220));
  check('inside addresses over https too', /https:\/\/10\.0\.0\.2:8585/.test(connect(first)));
  check('never a plain http address', !/plain\.example/.test(connect(first)));
  check('the page’s own origin is still there', /https:\/\/app\.example/.test(connect(first)));
  fs.writeFileSync(path.join(work, 'relay', 'relay-directory'), listOf([{ origin: 'https://one.example:8585' }, { origin: 'https://three.example:8585' }]));
  let later = '';
  for (let i = 0; i < 30 && !/three\.example/.test(later); i += 1) { await sleep(500); later = csp(); }
  check('a relay added to the list reaches the page without a restart', /https:\/\/three\.example:8585/.test(connect(later)), connect(later).slice(0, 220));
  check('and one taken off it leaves', !/two\.example/.test(connect(later)));
} catch (error) {
  console.error(error);
  check('suite ran to the end', false, String(error?.message || error).slice(0, 300));
} finally {
  tryDocker('rm', '-f', appName, relayName);
  tryDocker('network', 'rm', net);
  tryDocker('rmi', '-f', tag);
  fs.rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
