/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* scripts/link-relays.sh against two pretend servers on this machine.
 *
 * ssh, curl and docker are stand-ins on PATH: ssh runs the remote command
 * here, in the server's directory; curl answers each relay's identity; docker
 * writes down what it was asked to do and with which environment. Nothing
 * leaves the machine and no container starts.
 *
 * What it pins: a relay the script restarts keeps the host's install and
 * backup paths and the version, which the deploy hands it on the command
 * line rather than in .env. Restarted without them, the dashboard's backups
 * and jobs pointed nowhere until the next deploy.
 *
 *   node tests/e2e/linkrelays.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const idOf = (name) => crypto.createHash('sha256').update(`relay-${name}`).digest('hex');

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'link-relays-')));
try {
  section('a relay link-relays restarts');
  const bin = path.join(home, 'bin');
  const record = path.join(home, 'docker.log');
  fs.mkdirSync(bin);
  const servers = ['a', 'b'];
  const dirOf = (name) => path.join(home, name);
  for (const name of servers) {
    const other = servers.find((n) => n !== name);
    fs.mkdirSync(path.join(dirOf(name), 'data', 'chat-signal'), { recursive: true });
    fs.writeFileSync(path.join(dirOf(name), '.env'), `MONITOR_PASSWORD=x\nCHAT_TRANSIT_PEERS=${idOf(other)}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(dirOf(name), 'package.json'), '{\n  "name": "p",\n  "version": "9.8.7"\n}\n');
    fs.writeFileSync(path.join(dirOf(name), 'data', 'chat-signal', 'relay-identity.json'), JSON.stringify({ id: idOf(name) }));
  }
  const conf = path.join(home, 'deploy.conf');
  fs.writeFileSync(conf, [
    "SERVERS='a b'",
    ...servers.flatMap((name) => [
      `${name.toUpperCase()}_SSH_HOST='${name}.test'`,
      `${name.toUpperCase()}_SSH_USER='u'`,
      `${name.toUpperCase()}_REMOTE_DIR='${dirOf(name)}'`,
      `${name.toUpperCase()}_PUBLIC_URL='https://${name}.test:8585'`,
    ]),
    '',
  ].join('\n'));

  /* The remote command is ssh's last argument; its stdin is the script. */
  fs.writeFileSync(path.join(bin, 'ssh'), '#!/usr/bin/env bash\nexec bash -c "${@: -1}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
for arg in "$@"; do case "$arg" in http*) url="$arg" ;; esac; done
case "$url" in
  *a.test*/relay-identity) echo '{"id":"${idOf('a')}","key":"k"}' ;;
  *b.test*/relay-identity) echo '{"id":"${idOf('b')}","key":"k"}' ;;
  *) echo '{"transit":{"enabled":true,"allowed":1,"up":1}}' ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
[ "$1" = inspect ] && { echo config; exit 0; }
echo "$PWD | $* | OPS_INSTALL_DIR=\${OPS_INSTALL_DIR:-} OPS_BACKUP_DIR=\${OPS_BACKUP_DIR:-} APP_VERSION=\${APP_VERSION:-}" >> "${record}"
`, { mode: 0o755 });
  /* The servers run GNU sed; BSD sed reads "-i <script>" as a suffix. */
  fs.writeFileSync(path.join(bin, 'sed'), `#!/bin/sh
if /usr/bin/sed --version >/dev/null 2>&1; then exec /usr/bin/sed "$@"; fi
if [ "$1" = "-i" ]; then shift; exec /usr/bin/sed -i '' "$@"; fi
exec /usr/bin/sed "$@"
`, { mode: 0o755 });

  const run = spawnSync('bash', [path.join(ROOT, 'scripts', 'link-relays.sh'), '--unlink', 'a', 'b'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, POORIJA_DEPLOY_CONF: conf },
    encoding: 'utf8',
    timeout: 60000,
  });
  const ups = (fs.existsSync(record) ? fs.readFileSync(record, 'utf8') : '').split('\n').filter((line) => line.includes('up -d chat-signal'));
  check('the script ran and unlinked both', run.status === 0
    && servers.every((name) => /^CHAT_TRANSIT_PEERS=$/m.test(fs.readFileSync(path.join(dirOf(name), '.env'), 'utf8'))),
  `exit ${run.status}; ${`${run.stdout}${run.stderr}`.replace(/\s+/g, ' ').slice(-200)}`);
  check('each relay was restarted once', ups.length === 2, ups.join(' || ') || 'no restart');
  check('a restarted relay keeps the install paths and version the deploy gave it',
    ups.length === 2 && servers.every((name) => ups.some((line) => line.startsWith(`${dirOf(name)} |`)
      && line.includes(`OPS_INSTALL_DIR=${dirOf(name)} `)
      && line.includes(`OPS_BACKUP_DIR=${dirOf(name)}/backups `)
      && line.endsWith('APP_VERSION=9.8.7'))),
    ups.join(' || ').slice(0, 400));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  fs.rmSync(home, { recursive: true, force: true });
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  process.exit(failed ? 1 : 0);
}
