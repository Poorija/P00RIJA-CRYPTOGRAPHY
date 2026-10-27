/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The ready-made install: docker/compose.yaml only pulls images, and
 * scripts/docker-install.sh writes its .env and runs it. In --dry-run the
 * installer writes the folder and prints the docker commands without running
 * them, which is what is checked here: the .env it writes (random secrets, no
 * monitor password, owner-only), that a second run keeps every secret, that a
 * domain, an email and a registry mirror land where they should, and the
 * order it would start things in. The compose file itself is checked against
 * the build compose and, where Docker is installed, by `docker compose config`.
 *
 *   node tests/e2e/dockerinstall.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const dirs = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-install-')); dirs.push(dir); return dir; };
const install = (args) => {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts/docker-install.sh'), ...args], {
    encoding: 'utf8', input: '', timeout: 60000, env: { ...process.env, P00RIJA_TEST_PUBLIC_IP: '203.0.113.10' },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, lines: `${result.stdout}`.split('\n').filter((line) => line.startsWith('+ ')) };
};
const readEnv = (dir) => {
  const text = fs.existsSync(path.join(dir, '.env')) ? fs.readFileSync(path.join(dir, '.env'), 'utf8') : '';
  return { text, get: (key) => ((new RegExp(`^${key}=(.*)$`, 'm').exec(text) || [])[1]) };
};
/* The coturn arguments of a compose file, as written. */
const coturnArgs = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const block = (/\n  coturn:\n([\s\S]*?)\n  [a-z-]+:\n/.exec(text) || [])[1] || '';
  return Array.from(block.matchAll(/^\s*- (--\S.*?)\s*$/gm), (match) => match[1]);
};

try {
  const hub = path.join(ROOT, 'docker/compose.yaml');
  check('docker/compose.yaml exists', fs.existsSync(hub));
  const text = fs.existsSync(hub) ? fs.readFileSync(hub, 'utf8') : '';
  check('it only pulls: no build section', text && !/^\s*build:/m.test(text));
  const images = Array.from(text.matchAll(/^\s*image:\s*(\S+)/gm), (match) => match[1]);
  check('its own images come from the Docker Hub prefix',
    ['p00rija-app', 'p00rija-relay', 'p00rija-cert-renewer'].every((name) => images.includes(`\${P00RIJA_IMAGE_PREFIX:-poorija/}${name}:\${APP_VERSION:-latest}`)), images.join(' '));
  check('coturn is the upstream image, behind the same mirror when one is set', images.includes('${P00RIJA_REGISTRY:-}coturn/coturn:4.18.0-alpine'), images.join(' '));
  const ours = text ? coturnArgs(hub) : [];
  const built = coturnArgs(path.join(ROOT, 'config/docker-compose.yaml'));
  check('coturn gets exactly the arguments of the build compose', ours.length > 10 && JSON.stringify(ours) === JSON.stringify(built),
    ours.filter((arg) => !built.includes(arg)).concat(built.filter((arg) => !ours.includes(arg))).join(' | '));
  check('the monitor password is optional and the user name defaults to admin',
    text.includes('MONITOR_PASSWORD: ${MONITOR_PASSWORD:-}') && text.includes('MONITOR_USER: ${MONITOR_USER:-admin}'));
  check('the renewer runs the script inside its image, not one from a checkout', text && !text.includes('scripts/cert-renewer.sh:'));

  /* A default install. */
  const a = tmp();
  const first = install(['--yes', '--dry-run', '--dir', a]);
  const env = readEnv(a);
  check('a default install writes .env', first.code === 0 && env.text.length > 0, first.out.slice(-400));
  check('with the public IP as its address', env.get('DOMAIN') === '203.0.113.10' && env.get('EXTERNAL_IP') === '203.0.113.10', `${env.get('DOMAIN')} ${env.get('EXTERNAL_IP')}`);
  check('the default port and the admin user', env.get('APP_PORT') === '8585' && env.get('MONITOR_USER') === 'admin');
  check('random TURN secrets', /^[0-9a-f]{64}$/.test(env.get('TURN_SECRET') || '') && (env.get('TURN_PASSWORD') || '').length >= 24, `${(env.get('TURN_SECRET') || '').length} ${(env.get('TURN_PASSWORD') || '').length}`);
  check('and no monitor password: the relay makes one', !/^MONITOR_PASSWORD=/m.test(env.text));
  check('.env is readable by its owner only', (fs.statSync(path.join(a, '.env')).mode & 0o777) === 0o600);
  check('the compose file is put beside it', fs.existsSync(path.join(a, 'compose.yaml')));
  const at = (pattern) => first.lines.findIndex((line) => pattern.test(line));
  const pull = at(/compose .* pull$/);
  const cert = at(/run --rm --no-deps cert-renewer --once$/);
  const up = at(/compose .* up -d$/);
  check('it pulls, makes the first certificate, then starts everything', pull >= 0 && cert > pull && up > cert, first.lines.join(' ⏎ ').slice(0, 400));

  /* Again: nothing that is already there changes. */
  const second = install(['--yes', '--dry-run', '--dir', a]);
  const env2 = readEnv(a);
  check('a second run keeps every secret', second.code === 0 && env2.get('TURN_SECRET') === env.get('TURN_SECRET')
    && env2.get('TURN_PASSWORD') === env.get('TURN_PASSWORD') && env2.get('TURN_USER') === env.get('TURN_USER'));

  /* A domain, an email and a mirror. */
  const b = tmp();
  install(['--yes', '--dry-run', '--dir', b, '--domain', 'chat.example.com', '--email', 'a@example.com', '--registry', 'mirror.example.com']);
  const env3 = readEnv(b);
  check('a domain and an email are written as given', env3.get('DOMAIN') === 'chat.example.com' && env3.get('CERTBOT_EMAIL') === 'a@example.com', `${env3.get('DOMAIN')} ${env3.get('CERTBOT_EMAIL')}`);
  check('the browser origins are that domain’s', (env3.get('CHAT_ALLOWED_ORIGINS') || '').includes('https://chat.example.com:8585'), env3.get('CHAT_ALLOWED_ORIGINS'));
  check('a registry mirror goes in front of every image', env3.get('P00RIJA_IMAGE_PREFIX') === 'mirror.example.com/poorija/' && env3.get('P00RIJA_REGISTRY') === 'mirror.example.com/',
    `${env3.get('P00RIJA_IMAGE_PREFIX')} ${env3.get('P00RIJA_REGISTRY')}`);

  /* A domain whose first Let's Encrypt certificate fails (DNS not pointed yet,
     port 80 closed) must not stop the install: it starts on a temporary
     self-signed certificate, which the renewer replaces once Let's Encrypt
     answers. A stand-in docker records what the installer runs. */
  const fake = tmp();
  fs.writeFileSync(path.join(fake, 'docker'), `#!/bin/sh
echo "$*" >> "${fake}/calls.log"
case "$*" in
  *"cert-renewer --once"*) case "$*" in *CERT_MODE=self-signed*) exit 0 ;; *) echo "ERROR: certbot could not get a certificate" >&2; exit 1 ;; esac ;;
  *"cat /data/initial-monitor-password"*) echo FakeFirstPassword20ch ;;
esac
exit 0
`, { mode: 0o755 });
  const c = tmp();
  const live = spawnSync('bash', [path.join(ROOT, 'scripts/docker-install.sh'), '--yes', '--dir', c, '--domain', 'chat.example.com', '--email', 'a@example.com'], {
    encoding: 'utf8', input: '', timeout: 60000, env: { ...process.env, P00RIJA_TEST_PUBLIC_IP: '203.0.113.10', PATH: `${fake}:${process.env.PATH}` },
  });
  const calls = fs.existsSync(path.join(fake, 'calls.log')) ? fs.readFileSync(path.join(fake, 'calls.log'), 'utf8') : '';
  check('a failed first Let\'s Encrypt certificate falls back to a temporary self-signed one',
    live.status === 0 && /CERT_MODE=self-signed .*cert-renewer --once/.test(calls) && /up -d/.test(calls), `exit ${live.status} ${(live.stdout + live.stderr).slice(-300)}`);
  check('and says so, and that it is replaced by itself', /temporary self-signed/i.test(live.stdout + live.stderr) && /replace/i.test(live.stdout + live.stderr));

  if (spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0) {
    for (const dir of [a, b]) {
      const valid = spawnSync('docker', ['compose', '-f', path.join(dir, 'compose.yaml'), '--env-file', path.join(dir, '.env'), 'config', '-q'], { encoding: 'utf8' });
      check(`docker compose accepts the file with that .env (${path.basename(dir)})`, valid.status === 0, valid.stderr.slice(-300));
    }
  } else {
    console.log('  SKIP  docker compose is not installed here');
  }
  const help = spawnSync('bash', [path.join(ROOT, 'scripts/docker-install.sh'), '--help'], { encoding: 'utf8' });
  check('--help shows the one-line install', /curl -fsSL .*docker-install\.sh \| bash/.test(help.stdout), '');
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
