/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* scripts/panel.sh, the central panel's launcher, in --dry-run: it prints the
 * docker commands it would run and runs none. What is checked is what it
 * would hand Docker for the answers given — restart policy, port, address,
 * the Host/Origin allowlist and the mounts — that it remembers them, that it
 * refuses a port already taken and write access without the operator key,
 * and that no password ever reaches its settings file.
 *
 *   node tests/e2e/panellauncher.mjs
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const homes = [];
const freshHome = () => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-panel-home-')); homes.push(home); return home; };
const run = (home, args, input = '') => {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts/panel.sh'), ...args], {
    encoding: 'utf8', input, timeout: 30000,
    env: { ...process.env, HOME: home, POORIJA_PANEL_SETTINGS: path.join(home, 'panel.env'), POORIJA_PANEL_NO_DOCKER: '1' },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, runLine: (`${result.stdout}`.split('\n').find((line) => line.startsWith('+ docker run -d')) || '') };
};
const settings = (home) => (fs.existsSync(path.join(home, 'panel.env')) ? fs.readFileSync(path.join(home, 'panel.env'), 'utf8') : '');

try {
  check('the launcher exists and parses', fs.existsSync(path.join(ROOT, 'scripts/panel.sh'))
    && spawnSync('bash', ['-n', path.join(ROOT, 'scripts/panel.sh')]).status === 0);

  /* Defaults. */
  const a = freshHome();
  const first = run(a, ['--yes', '--dry-run', '--no-open']);
  const line = first.runLine;
  check('with every default it would start the panel container', first.code === 0 && line.includes('--name Poorija-Cryptography_ControlPanel'), first.out.slice(-400));
  check('that comes back whenever Docker starts', line.includes('--restart unless-stopped'), line);
  check('on 127.0.0.1:8686 only', line.includes('-p 127.0.0.1:8686:8686'), line);
  check('allowing exactly the addresses it is reached at', line.includes('-e POORIJA_PANEL_ORIGINS=http://127.0.0.1:8686,http://localhost:8686'), line);
  check('with the config folder read-only, the SSH keys and its own state volume',
    line.includes(`-v ${a}/.config/p00rija-cryptography:/config:ro`) && line.includes(`-v ${a}/.ssh:/ssh-src:ro`) && line.includes('-v panel-state:/state'), line);
  check('and tells the panel where those keys are on this computer, so deploy.conf’s key paths can be found in the copy',
    line.includes(`-e POORIJA_PANEL_HOST_SSH_DIR=${a}/.ssh`), line);
  check('built from this checkout, tagged for Docker Hub', first.out.includes(`+ docker build -f ${ROOT}/config/Dockerfile.control-panel -t poorija/p00rija-panel:${VERSION} ${ROOT}`)
    && line.endsWith(`poorija/p00rija-panel:${VERSION}`), first.out.split('\n').find((l) => l.startsWith('+ docker build')) || '');

  /* Flags are remembered. */
  const b = freshHome();
  const flagged = run(b, ['--yes', '--dry-run', '--no-open', '--port', '9191', '--autostart', 'no']);
  check('--autostart no gives a container Docker leaves alone', flagged.runLine.includes('--restart no') && flagged.runLine.includes('-p 127.0.0.1:9191:8686'), flagged.runLine);
  check('and the answers are kept', /^PANEL_PORT=9191$/m.test(settings(b)) && /^PANEL_AUTOSTART=no$/m.test(settings(b)), settings(b).replace(/\n/g, ' '));
  const again = run(b, ['--yes', '--dry-run', '--no-open']);
  check('so the next start uses them without asking', again.runLine.includes('-p 127.0.0.1:9191:8686') && again.runLine.includes('--restart no'), again.runLine);

  /* Answers typed at the prompts. */
  const c = freshHome();
  const typed = run(c, ['--dry-run', '--no-open'], '9292\n\nn\n\n\n');
  check('answers typed at the prompts are used', typed.runLine.includes('-p 127.0.0.1:9292:8686') && typed.runLine.includes('--restart no'), typed.runLine || typed.out.slice(-300));

  /* A LAN address. */
  const d = freshHome();
  const lan = run(d, ['--yes', '--dry-run', '--no-open', '--bind', '0.0.0.0', '--host', '192.168.1.5']);
  check('on a LAN address the name it is reached by is allowed too',
    lan.runLine.includes('-p 0.0.0.0:8686:8686') && lan.runLine.includes('-e POORIJA_PANEL_ORIGINS=http://192.168.1.5:8686,http://127.0.0.1:8686,http://localhost:8686'), lan.runLine);

  /* On the LAN the login travels the network: HTTPS when a certificate is
     given, and a plain warning when it is not. */
  check('a LAN address without a certificate is warned about as unencrypted', /unencrypted/i.test(lan.out), lan.out.slice(-300));
  const g = freshHome();
  fs.writeFileSync(path.join(g, 'cert.pem'), 'x'); fs.writeFileSync(path.join(g, 'key.pem'), 'x');
  const tls = run(g, ['--yes', '--dry-run', '--no-open', '--bind', '0.0.0.0', '--host', '192.168.1.5', '--tls-cert', path.join(g, 'cert.pem'), '--tls-key', path.join(g, 'key.pem')]);
  check('with a certificate it serves HTTPS and allows only https origins',
    tls.runLine.includes('-e POORIJA_PANEL_ORIGINS=https://192.168.1.5:8686,https://127.0.0.1:8686,https://localhost:8686')
    && tls.runLine.includes(`-v ${g}/cert.pem:/tls/cert.pem:ro`) && tls.runLine.includes(`-v ${g}/key.pem:/tls/key.pem:ro`)
    && tls.runLine.includes('-e POORIJA_PANEL_TLS_CERT=/tls/cert.pem') && tls.runLine.includes('-e POORIJA_PANEL_TLS_KEY=/tls/key.pem')
    && !/unencrypted/i.test(tls.out), tls.runLine || tls.out.slice(-300));
  const missing = run(freshHome(), ['--yes', '--dry-run', '--no-open', '--tls-cert', '/nonexistent/cert.pem', '--tls-key', '/nonexistent/key.pem']);
  check('a certificate file that is not there is refused', missing.code !== 0 && /cert\.pem/.test(missing.out), missing.out.slice(-200));

  /* A port already taken. */
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const held = holder.address().port;
  const e = freshHome();
  const taken = run(e, ['--yes', '--dry-run', '--no-open', '--port', String(held)]);
  holder.close();
  check('a port already in use is refused before anything starts', taken.code !== 0 && /already in use/.test(taken.out) && !taken.runLine, taken.out.slice(-200));

  /* Write access needs the operator key. */
  /* Since the panel edits deploy.conf, write access no longer needs the operator key. */
  const f = freshHome();
  const write = run(f, ['--yes', '--dry-run', '--no-open', '--write']);
  check('write access mounts the config folder writable, operator key or not', write.code === 0 && write.runLine.includes(`-v ${f}/.config/p00rija-cryptography:/config:rw`), write.runLine || write.out.slice(-200));
  const asked = freshHome();
  const askedRun = run(asked, ['--dry-run', '--no-open'], '\n\n\n\n\nyes\n');
  check('and it is asked for even without the operator key', /edit deploy\.conf/.test(askedRun.out) && askedRun.runLine.includes(':/config:rw'), askedRun.runLine || askedRun.out.slice(-200));

  /* Keeping it: doctor, backup, restore, uninstall. */
  const keep = freshHome();
  fs.mkdirSync(path.join(keep, '.config/p00rija-cryptography'), { recursive: true });
  fs.writeFileSync(path.join(keep, '.config/p00rija-cryptography/deploy.conf'), "SERVERS='a b'\nA_SSH_HOST='a.example'\nA_SSH_KEY='~/.ssh/k'\nB_SSH_HOST='b.example'\n");
  const doctor = run(keep, ['doctor', '--dry-run']);
  check('doctor lists every check it would make, one SSH login per server and no more',
    ['check docker', 'check config', 'check key a', 'check ssh a', 'check ssh b', 'check port 8686'].every((line) => doctor.out.includes(line)) && !/^\+ ssh/m.test(doctor.out), doctor.out.slice(-300));
  const backup = run(keep, ['backup', path.join(keep, 'panel.tar.gz'), '--dry-run']);
  check('backup streams the panel’s state into a file only you can read', /\+ \(umask 077\) docker run --rm -v panel-state:\/state --entrypoint sh \S+ -c tar czf - -C \/state \. > .*panel\.tar\.gz/.test(backup.out), backup.out.slice(-300));
  fs.writeFileSync(path.join(keep, 'panel.tar.gz'), 'x');
  const restore = run(keep, ['restore', path.join(keep, 'panel.tar.gz'), '--dry-run']);
  check('restore streams it back, with the panel stopped meanwhile', /\+ docker stop Poorija-Cryptography_ControlPanel/.test(restore.out) && /\+ docker run --rm -i -v panel-state:\/state --entrypoint sh \S+ -c tar xzf - -C \/state < .*panel\.tar\.gz/.test(restore.out) && /\+ docker start Poorija-Cryptography_ControlPanel/.test(restore.out), restore.out.slice(-300));
  const noBackup = run(keep, ['restore', path.join(keep, 'absent.tar.gz'), '--dry-run']);
  check('a backup file that is not there is refused', noBackup.code !== 0, noBackup.out.slice(-120));
  const uninstall = run(keep, ['uninstall', '--dry-run']);
  check('uninstall takes the container and the image, and leaves the login', /\+ docker rm -f Poorija-Cryptography_ControlPanel/.test(uninstall.out) && /\+ docker rmi /.test(uninstall.out) && !/volume rm/.test(uninstall.out), uninstall.out.slice(-300));
  const purge = run(keep, ['uninstall', '--purge', '--yes', '--dry-run']);
  check('with --purge, the login, the state and the settings go too', /\+ docker volume rm panel-state/.test(purge.out), purge.out.slice(-300));

  check('no settings file ever holds a password', [a, b, c, d, e, f, asked].every((home) => !/password/i.test(settings(home))));

  /* The launcher waits a long time for a person (the questions, the login),
     and its file can change meanwhile — an edit, a pull, a sync. Bash reads a
     script as it goes, so a file that changed under it was read from the old
     offset and failed with "unexpected EOF". It must read itself whole first. */
  const copyDir = freshHome();
  const copy = path.join(copyDir, 'panel.sh');
  fs.copyFileSync(path.join(ROOT, 'scripts/panel.sh'), copy);
  const h = freshHome();
  const changed = await new Promise((resolve) => {
    const child = spawn('bash', [copy, '--dry-run', '--no-open'], { env: { ...process.env, HOME: h, POORIJA_PANEL_SETTINGS: path.join(h, 'panel.env') } });
    let out = '';
    let edited = false;
    const onData = (chunk) => {
      out += chunk;
      if (!edited && out.includes('Port on this computer')) {
        edited = true;
        /* Lines added near the top shift everything after them. */
        const text = fs.readFileSync(copy, 'utf8').split('\n');
        text.splice(3, 0, ...Array.from({ length: 40 }, (_, i) => `# a line added while it ran, number ${i}, long enough to move every offset after it`));
        fs.writeFileSync(copy, text.join('\n'));
        child.stdin.end('\n\nno\n\n\n');
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => resolve({ code, out }));
  });
  check('a launcher whose file changes while it waits for answers still finishes',
    changed.code === 0 && changed.out.includes('+ docker run -d') && !/unexpected EOF|syntax error/.test(changed.out), `exit ${changed.code} ${(changed.out.match(/.*(unexpected EOF|syntax error).*/) || [''])[0]}`);

  const stop = run(a, ['stop', '--dry-run']);
  check('stop stops the panel container', stop.out.includes('+ docker stop Poorija-Cryptography_ControlPanel'), stop.out.slice(-200));
  const help = run(a, ['--help']);
  check('--help names every subcommand', ['start', 'stop', 'status', 'logs', 'update', 'login', 'doctor', 'backup', 'restore', 'uninstall'].every((word) => help.out.includes(word)), '');
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
