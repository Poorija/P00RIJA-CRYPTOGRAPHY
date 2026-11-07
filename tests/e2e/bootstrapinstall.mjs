/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */
/* The clean-server installer the panel's "Fresh install" command runs.
 *
 *   node tests/e2e/bootstrapinstall.mjs
 *
 * The script the relay serves at /bootstrap/install is taken out of
 * scripts/server.js and run for real, under bash and under sh, against a
 * stand-in curl (the bundle, the public address) and a stand-in docker that
 * records what it was asked. It used to stop at once with "no .env template
 * found in the bundle". Checked here: it gets as far as starting the stack,
 * the .env it writes has fresh secrets and nothing from a template, a second
 * run keeps it, and the bundle it unpacks can never have carried a .env of
 * the server it came from.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(ROOT, 'scripts/server.js'), 'utf8');
let checks = 0;
let failures = 0;
const check = (name, ok, detail = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/* The installer as the relay builds it: an array literal of lines. */
const start = source.indexOf('const BOOTSTRAP_INSTALLER = [');
const end = source.indexOf("].join('\\n');", start);
// eslint-disable-next-line no-new-func
const installer = new Function(`return ${source.slice(start + 'const BOOTSTRAP_INSTALLER = '.length, end + 1)}.join('\\n');`)();
check('the relay serves an installer', installer.startsWith('#!/bin/sh') && installer.includes('$SRC/bundle'));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-bootstrap-'));
const bin = path.join(scratch, 'bin');
fs.mkdirSync(bin);
/* The bundle a relay would send: enough of the tree for the installer. */
const tree = path.join(scratch, 'tree');
fs.mkdirSync(path.join(tree, 'config'), { recursive: true });
fs.writeFileSync(path.join(tree, 'package.json'), '{\n  "name": "app",\n  "version": "9.8.7",\n  "buildTag": "chat-v1"\n}\n');
fs.writeFileSync(path.join(tree, 'config/docker-compose.yaml'), 'services: {}\n');
const bundle = path.join(scratch, 'bundle.tar.gz');
spawnSync('tar', ['czf', bundle, '-C', tree, '.']);

fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
out=""; url=""; token=""; prev=""
for arg in "$@"; do
  [ "$prev" = "-o" ] && out="$arg"
  [ "$prev" = "-H" ] && token="$arg"
  case "$arg" in http*) url="$arg" ;; esac
  prev="$arg"
done
case "$url" in
  *ipify*|*ifconfig*) if [ -n "$FAKE_IP_FILE" ]; then cat "$FAKE_IP_FILE"; else printf '198.51.100.7'; fi ;;
  */bundle) [ "$token" = "X-Bootstrap-Token: the-token" ] || { echo "401" >&2; exit 22; }; cp "$FAKE_BUNDLE" "$out" ;;
  *) exit 6 ;;
esac
`, { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
[ "$1 $2" = "compose version" ] && exit 0
echo "APP_VERSION=$APP_VERSION OPS_INSTALL_DIR=$OPS_INSTALL_DIR $*" >> "$FAKE_DOCKER_LOG"
`, { mode: 0o755 });

const run = (shell, dir, extra = []) => spawnSync(shell, ['-s', '--', 'https://relay.example/bootstrap', 'the-token', dir, ...extra], {
  input: installer,
  encoding: 'utf8',
  env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_BUNDLE: bundle, FAKE_DOCKER_LOG: path.join(scratch, 'docker.log') },
});
const envOf = (dir) => Object.fromEntries(fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n')
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

try {
  for (const shell of ['bash', 'sh']) {
    console.log(`\n===== a fresh machine, under ${shell} =====`);
    fs.rmSync(path.join(scratch, 'docker.log'), { force: true });
    const dir = path.join(scratch, `install-${shell}`);
    const first = run(shell, dir);
    check('it runs to the end', first.status === 0, (first.stderr || first.stdout).trim().split('\n').slice(-2).join(' | '));
    check('and no longer asks the bundle for a template', !/no \.env template/.test(first.stderr + first.stdout));
    const env = fs.existsSync(path.join(dir, '.env')) ? envOf(dir) : {};
    check('.env names this machine, by its public address when no domain is given',
      env.DOMAIN === '198.51.100.7' && env.EXTERNAL_IP === '198.51.100.7' && env.CHAT_ALLOWED_ORIGINS === 'https://198.51.100.7:8585,http://198.51.100.7:8585',
      JSON.stringify({ DOMAIN: env.DOMAIN, EXTERNAL_IP: env.EXTERNAL_IP }));
    check('every secret is fresh and random',
      /^[0-9a-f]{24}$/.test(env.MONITOR_PASSWORD || '') && /^p00rija-[0-9a-f]{8}$/.test(env.TURN_USER || '')
        && /^[0-9a-f]{32}$/.test(env.TURN_PASSWORD || '') && /^[0-9a-f]{64}$/.test(env.TURN_SECRET || ''),
      JSON.stringify({ user: env.TURN_USER, monitor: (env.MONITOR_PASSWORD || '').length }));
    const text = fs.existsSync(path.join(dir, '.env')) ? fs.readFileSync(path.join(dir, '.env'), 'utf8') : '';
    check('and nothing of the documentation template is in it', !/change-me|example\.com|203\.0\.113/.test(text));
    check('.env is readable by its owner only', fs.existsSync(path.join(dir, '.env')) && (fs.statSync(path.join(dir, '.env')).mode & 0o777) === 0o600,
      fs.existsSync(path.join(dir, '.env')) ? (fs.statSync(path.join(dir, '.env')).mode & 0o777).toString(8) : 'missing');
    const docker = fs.existsSync(path.join(scratch, 'docker.log')) ? fs.readFileSync(path.join(scratch, 'docker.log'), 'utf8') : '';
    check('the stack is built and started from the bundle, under its version',
      /APP_VERSION=9\.8\.7 /.test(docker) && [dir, fs.realpathSync(dir)].some((where) => docker.includes(`OPS_INSTALL_DIR=${where} `))
        && docker.includes('compose -p config -f config/docker-compose.yaml --env-file .env up -d --build'),
      docker.trim().slice(0, 160));
    check('the dashboard password is shown once, at the end', first.stdout.includes(`Password:   ${env.MONITOR_PASSWORD}`));

    const before = text;
    const again = run(shell, dir);
    check('a second run keeps .env exactly as it was', again.status === 0 && fs.readFileSync(path.join(dir, '.env'), 'utf8') === before);
    check('and does not print a password it did not make', !/Password:/.test(again.stdout));
  }

  console.log('\n===== a domain, and a bad one =====');
  const named = path.join(scratch, 'install-named');
  const withDomain = run('bash', named, ['chat.example.org']);
  const namedEnv = withDomain.status === 0 ? envOf(named) : {};
  check('a domain given on the command line is used, with its own origins',
    namedEnv.DOMAIN === 'chat.example.org' && namedEnv.CHAT_ALLOWED_ORIGINS === 'https://chat.example.org:8585,https://chat.example.org'
      && namedEnv.VAPID_SUBJECT === 'mailto:admin@chat.example.org', JSON.stringify(namedEnv).slice(0, 160));
  const bad = run('bash', path.join(scratch, 'install-bad'), ['x;touch /tmp/p00rija-pwned']);
  check('a domain with anything but name characters is refused before .env is written',
    bad.status !== 0 && !fs.existsSync(path.join(scratch, 'install-bad', '.env')) && !fs.existsSync('/tmp/p00rija-pwned'));
  /* A value with a new line in it: grep, which tests line by line, let the
     first line vouch for the second, and the second became a line of .env. */
  const injected = run('bash', path.join(scratch, 'install-newline'), ['chat.example.org\nMONITOR_PASSWORD=chosen-by-someone-else']);
  check('a domain carrying a new line is refused, so it cannot add a line to .env',
    injected.status !== 0 && !fs.existsSync(path.join(scratch, 'install-newline', '.env')));
  fs.writeFileSync(path.join(bin, 'curl-ip'), '198.51.100.7\nMONITOR_PASSWORD=chosen-by-someone-else');
  const lyingIp = spawnSync('bash', ['-s', '--', 'https://relay.example/bootstrap', 'the-token', path.join(scratch, 'install-ip')], {
    input: installer, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_BUNDLE: bundle, FAKE_DOCKER_LOG: path.join(scratch, 'docker.log'), FAKE_IP_FILE: path.join(bin, 'curl-ip') },
  });
  check('so is a public address that comes back with a second line',
    lyingIp.status !== 0 && !fs.existsSync(path.join(scratch, 'install-ip', '.env')), (lyingIp.stderr || '').trim().slice(0, 100));
  const wrongToken = spawnSync('bash', ['-s', '--', 'https://relay.example/bootstrap', 'not-the-token', path.join(scratch, 'install-token')], {
    input: installer, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_BUNDLE: bundle, FAKE_DOCKER_LOG: path.join(scratch, 'docker.log') },
  });
  check('a refused token stops it before anything is written', wrongToken.status !== 0 && !fs.existsSync(path.join(scratch, 'install-token', '.env')));

  console.log('\n===== what the bundle may carry =====');
  const excludeLine = /const OPS_BUNDLE_EXCLUDE = \[([^\]]*)\]/.exec(source)?.[1] || '';
  check('the bundle leaves out every .env, not only the one named .env', excludeLine.includes("'.env*'"), excludeLine.trim());
  /* The same exclude the relay hands tar, run on a tree like a server's. */
  const server = path.join(scratch, 'server');
  fs.mkdirSync(path.join(server, 'config'), { recursive: true });
  for (const file of ['.env', '.env.bak-before-family', '.env.bak-before-shared-cert', '.env.example', 'README.md', 'config/x.yaml']) fs.writeFileSync(path.join(server, file), 'x');
  const listed = spawnSync('sh', ['-c', `tar czf - --exclude='./.env*' ./ | tar tzf -`], { cwd: server, encoding: 'utf8' }).stdout;
  check('so a .env backup beside it never leaves the server', !/\.env/.test(listed) && /README\.md/.test(listed), listed.replace(/\n/g, ' ').trim());
  const bundleRoute = source.slice(source.indexOf("if (asked.startsWith('/bundle'))"), source.indexOf("res.writeHead(404).end('not found');"));
  check('the bootstrap token is compared in constant time and used once',
    /secretsMatch\(req\.headers\['x-bootstrap-token'\]/.test(bundleRoute) && /rotateBootstrapToken\(\);\s*\n\s*opsBundleTo/.test(bundleRoute));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
