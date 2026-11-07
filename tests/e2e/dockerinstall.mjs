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
const install = (args, env = {}) => {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts/docker-install.sh'), ...args], {
    encoding: 'utf8', input: '', timeout: 60000, env: { ...process.env, P00RIJA_TEST_PUBLIC_IP: '203.0.113.10', ...env },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, lines: `${result.stdout}`.split('\n').filter((line) => line.startsWith('+ ')) };
};
const readEnv = (dir) => {
  const text = fs.existsSync(path.join(dir, '.env')) ? fs.readFileSync(path.join(dir, '.env'), 'utf8') : '';
  return { text, get: (key) => ((new RegExp(`^${key}=(.*)$`, 'm').exec(text) || [])[1]) };
};
/* A certificate and its key in a folder, as 3X-UI, acme.sh or certbot leave
   them; `stranger` puts a key there that belongs to another certificate. */
const makePair = (dir, { names = ['chat.example.com'], cert = 'fullchain.pem', key = 'privkey.pem', stranger = false } = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  const make = (certOut, keyOut) => spawnSync('openssl', ['req', '-x509', '-nodes', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-days', '60',
    '-subj', `/CN=${names[0]}`, '-addext', `subjectAltName=${names.map((name) => `DNS:${name}`).join(',')}`, '-keyout', keyOut, '-out', certOut], { encoding: 'utf8' });
  make(path.join(dir, cert), path.join(dir, key));
  if (stranger) make(path.join(dir, 'other-cert.tmp'), path.join(dir, key));
  return dir;
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

  /* Images that can be neither pulled nor found on the server stop the
     install with what to do, instead of Docker's own "no such image" later. */
  const fakeNone = tmp();
  fs.writeFileSync(path.join(fakeNone, 'docker'), `#!/bin/sh
echo "$*" >> "${fakeNone}/calls.log"
case "$*" in
  *" pull"*) echo "Error response from daemon: pull access denied" >&2; exit 1 ;;
  "image inspect"*) exit 1 ;;
esac
exit 0
`, { mode: 0o755 });
  const nowhere = tmp();
  const missing = spawnSync('bash', [path.join(ROOT, 'scripts/docker-install.sh'), '--yes', '--dir', nowhere, '--registry', 'focker.ir'], {
    encoding: 'utf8', input: '', timeout: 60000, env: { ...process.env, P00RIJA_TEST_PUBLIC_IP: '203.0.113.10', PATH: `${fakeNone}:${process.env.PATH}` },
  });
  const noneCalls = fs.existsSync(path.join(fakeNone, 'calls.log')) ? fs.readFileSync(path.join(fakeNone, 'calls.log'), 'utf8') : '';
  check('images neither pulled nor on the server stop the install, naming them and where they were looked for',
    missing.status !== 0 && /focker\.ir\/poorija\/p00rija-app/.test(missing.stderr) && !/up -d/.test(noneCalls), `exit ${missing.status} ${missing.stderr.slice(-300)}`);
  check('and say how to get them there', /dockerhub-release\.sh --push|deploy\.sh/.test(missing.stderr), missing.stderr.slice(-200));

  /* A certificate the server already has — 3X-UI keeps one in
     /root/cert/<domain>/ — is served from where it is, as on a server set up
     by hand, instead of a new one from Let's Encrypt. P00RIJA_TEST_CERT_ROOT
     stands for the server's / here. */
  const root = tmp();
  const xui = makePair(path.join(root, 'root/cert/chat.example.com'));
  const CERT = { P00RIJA_TEST_CERT_ROOT: root };
  const d = tmp();
  const found = install(['--yes', '--dry-run', '--dir', d, '--domain', 'chat.example.com'], CERT);
  const envFound = readEnv(d);
  check('3X-UI’s certificate for the domain is found and served from its folder',
    found.code === 0 && envFound.get('CERTS_DIR') === xui && envFound.get('CERT_FILE') === 'fullchain.pem' && envFound.get('KEY_FILE') === 'privkey.pem',
    `${found.code} ${envFound.get('CERTS_DIR')} ${envFound.get('CERT_FILE')} ${envFound.get('KEY_FILE')} ${found.out.slice(-200)}`);
  check('renewed by its owner unless told otherwise, as with --cert-dir in the other installers', envFound.get('CERT_MODE') === 'existing', envFound.get('CERT_MODE'));
  check('and the first certificate step only checks it: no Let\'s Encrypt request, nothing replaced',
    found.lines.some((line) => /run --rm --no-deps -e CERT_MODE=existing cert-renewer --once$/.test(line)) && !found.lines.some((line) => /run --rm --no-deps cert-renewer --once$/.test(line)), found.lines.join(' ⏎ ').slice(-300));
  check('it says which certificate it serves', found.out.includes(xui), found.out.slice(-200));
  const again = install(['--yes', '--dry-run', '--dir', d], CERT);
  check('a second run keeps serving it', readEnv(d).get('CERTS_DIR') === xui && readEnv(d).get('CERT_MODE') === 'existing' && again.code === 0, readEnv(d).get('CERTS_DIR'));
  const moved = tmp();
  install(['--yes', '--dry-run', '--dir', moved, '--domain', 'chat.example.com'], CERT);
  install(['--yes', '--dry-run', '--dir', moved, '--domain', 'new.example.com'], CERT);
  check('a server moved to a domain with no certificate here goes back to its own folder, not the old domain’s certificate',
    readEnv(moved).get('CERTS_DIR') === path.join(moved, 'certs') && readEnv(moved).get('CERT_FILE') === 'cert.pem' && !readEnv(moved).get('CERT_MODE'), `${readEnv(moved).get('CERTS_DIR')} ${readEnv(moved).get('CERT_MODE')}`);
  const e = tmp();
  install(['--yes', '--dry-run', '--dir', e, '--domain', 'chat.example.com', '--letsencrypt'], CERT);
  check('with --letsencrypt this server renews it there, as on the servers set up by hand', readEnv(e).get('CERTS_DIR') === xui && readEnv(e).get('CERT_MODE') === 'letsencrypt', `${readEnv(e).get('CERTS_DIR')} ${readEnv(e).get('CERT_MODE')}`);
  const f = tmp();
  install(['--yes', '--dry-run', '--dir', f, '--domain', 'chat.example.com', '--new-cert'], CERT);
  check('--new-cert leaves it alone and makes a new one', readEnv(f).get('CERTS_DIR') === path.join(f, 'certs') && !readEnv(f).get('CERT_MODE'), readEnv(f).get('CERTS_DIR'));
  install(['--yes', '--dry-run', '--dir', d, '--new-cert'], CERT);
  check('and takes a server that served one back to its own folder', readEnv(d).get('CERTS_DIR') === path.join(d, 'certs') && readEnv(d).get('CERT_FILE') === 'cert.pem' && readEnv(d).get('KEY_FILE') === 'key.pem' && !readEnv(d).get('CERT_MODE'),
    `${readEnv(d).get('CERTS_DIR')} ${readEnv(d).get('CERT_FILE')} ${readEnv(d).get('CERT_MODE')}`);
  const otherName = tmp();
  makePair(path.join(otherName, 'root/cert/chat.example.com'), { names: ['other.example.com'] });
  const g = tmp();
  install(['--yes', '--dry-run', '--dir', g, '--domain', 'chat.example.com'], { P00RIJA_TEST_CERT_ROOT: otherName });
  check('a certificate that does not name the domain is not served', readEnv(g).get('CERTS_DIR') === path.join(g, 'certs'), readEnv(g).get('CERTS_DIR'));
  const strangerRoot = tmp();
  makePair(path.join(strangerRoot, 'root/cert/chat.example.com'), { stranger: true });
  const h = tmp();
  install(['--yes', '--dry-run', '--dir', h, '--domain', 'chat.example.com'], { P00RIJA_TEST_CERT_ROOT: strangerRoot });
  check('nor one whose key belongs to another certificate', readEnv(h).get('CERTS_DIR') === path.join(h, 'certs'), readEnv(h).get('CERTS_DIR'));
  const panelRoot = tmp();
  const elsewhere = makePair(path.join(panelRoot, 'srv/tls'));
  fs.mkdirSync(path.join(panelRoot, 'etc/x-ui'), { recursive: true });
  fs.writeFileSync(path.join(panelRoot, 'etc/x-ui/x-ui.db'), Buffer.concat([Buffer.from([0, 1, 2, 0x53, 0x51]), Buffer.from('webCertFile\u0000/srv/tls/fullchain.pem\u0000webKeyFile\u0000/srv/tls/privkey.pem'), Buffer.from([0, 0xff, 3])]));
  const k = tmp();
  install(['--yes', '--dry-run', '--dir', k, '--domain', 'chat.example.com'], { P00RIJA_TEST_CERT_ROOT: panelRoot });
  check('so is the one 3X-UI’s panel names in its database, wherever it keeps it', readEnv(k).get('CERTS_DIR') === elsewhere, readEnv(k).get('CERTS_DIR'));
  /* Any program that got a certificate for the domain, not only 3X-UI: where
     certbot, acme.sh and panels such as Hiddify keep theirs. A folder that is
     some program's own store stays that program's to renew. */
  const certbotRoot = tmp();
  const archive = makePair(path.join(certbotRoot, 'etc/letsencrypt/archive/chat.example.com'), { cert: 'fullchain1.pem', key: 'privkey1.pem' });
  const liveDir = path.join(certbotRoot, 'etc/letsencrypt/live/chat.example.com');
  fs.mkdirSync(liveDir, { recursive: true });
  fs.symlinkSync('../../archive/chat.example.com/fullchain1.pem', path.join(liveDir, 'fullchain.pem'));
  fs.symlinkSync('../../archive/chat.example.com/privkey1.pem', path.join(liveDir, 'privkey.pem'));
  const cb = tmp();
  const certbotRun = install(['--yes', '--dry-run', '--dir', cb, '--domain', 'chat.example.com', '--letsencrypt'], { P00RIJA_TEST_CERT_ROOT: certbotRoot });
  check('certbot’s certificate for the domain is found too', readEnv(cb).get('CERTS_DIR') === liveDir && readEnv(cb).get('CERT_FILE') === 'fullchain.pem', `${readEnv(cb).get('CERTS_DIR')} ${archive}`);
  check('and stays certbot’s to renew even when this server was asked to: its folder is certbot’s own store', readEnv(cb).get('CERT_MODE') === 'existing' && /own/i.test(certbotRun.out), `${readEnv(cb).get('CERT_MODE')} ${certbotRun.out.slice(-160)}`);
  const acmeRoot = tmp();
  const acmeHome = makePair(path.join(acmeRoot, 'root/.acme.sh/chat.example.com_ecc'), { cert: 'fullchain.cer', key: 'chat.example.com.key' });
  const ac = tmp();
  install(['--yes', '--dry-run', '--dir', ac, '--domain', 'chat.example.com'], { P00RIJA_TEST_CERT_ROOT: acmeRoot });
  check('so is acme.sh’s', readEnv(ac).get('CERTS_DIR') === acmeHome && readEnv(ac).get('KEY_FILE') === 'chat.example.com.key' && readEnv(ac).get('CERT_MODE') === 'existing', `${readEnv(ac).get('CERTS_DIR')} ${readEnv(ac).get('KEY_FILE')}`);
  const flatRoot = tmp();
  const flat = makePair(path.join(flatRoot, 'opt/hiddify-manager/ssl'), { cert: 'chat.example.com.crt', key: 'chat.example.com.key' });
  makePair(path.join(flatRoot, 'opt/hiddify-manager/ssl-other'), { names: ['x.example.com'] });
  const fl = tmp();
  install(['--yes', '--dry-run', '--dir', fl, '--domain', 'chat.example.com'], { P00RIJA_TEST_CERT_ROOT: flatRoot });
  check('and one kept among other domains’ in a shared folder, by its name', readEnv(fl).get('CERTS_DIR') === flat && readEnv(fl).get('CERT_FILE') === 'chat.example.com.crt', `${readEnv(fl).get('CERTS_DIR')} ${readEnv(fl).get('CERT_FILE')}`);
  const both = tmp();
  makePair(path.join(both, 'etc/letsencrypt/live/chat.example.com'));
  const looked = makePair(path.join(both, 'root/cert/chat.example.com'));
  const bo = tmp();
  install(['--yes', '--dry-run', '--dir', bo, '--domain', 'chat.example.com'], { P00RIJA_TEST_CERT_ROOT: both });
  check('3X-UI’s folder is looked at first', readEnv(bo).get('CERTS_DIR') === looked, readEnv(bo).get('CERTS_DIR'));
  const acme = makePair(path.join(tmp(), 'chat.example.com_ecc'), { cert: 'fullchain.cer', key: 'chat.example.com.key' });
  const m = tmp();
  const given = install(['--yes', '--dry-run', '--dir', m, '--domain', 'chat.example.com', '--cert-dir', acme], CERT);
  check('--cert-dir serves the folder given, acme.sh’s names included', given.code === 0 && readEnv(m).get('CERTS_DIR') === acme && readEnv(m).get('CERT_FILE') === 'fullchain.cer' && readEnv(m).get('KEY_FILE') === 'chat.example.com.key',
    `${readEnv(m).get('CERTS_DIR')} ${readEnv(m).get('CERT_FILE')} ${readEnv(m).get('KEY_FILE')}`);
  const empty = tmp();
  const n = tmp();
  const none = install(['--yes', '--dry-run', '--dir', n, '--domain', 'chat.example.com', '--cert-dir', empty], CERT);
  check('a --cert-dir with no certificate for the domain stops the install before anything starts', none.code !== 0 && !none.lines.some((line) => /up -d$/.test(line)) && /certificate/i.test(none.out), `exit ${none.code} ${none.out.slice(-200)}`);

  if (spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0) {
    for (const dir of [a, b, e]) {
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
