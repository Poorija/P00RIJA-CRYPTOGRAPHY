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
/* The folder it is run from, the script's own path and the environment are
   all chosen per run: where the launcher finds things must follow them, never
   the computer it was written on. */
const SCRIPT = path.join(ROOT, 'scripts/panel.sh');
const baseEnv = () => { const env = { ...process.env }; delete env.XDG_CONFIG_HOME; delete env.POORIJA_CONFIG_DIR; return env; };
const run = (home, args, input = '', { cwd = ROOT, script = SCRIPT, env = {}, bashArgs } = {}) => {
  const result = spawnSync('bash', bashArgs || [script, ...args], {
    encoding: 'utf8', input, timeout: 30000, cwd,
    env: { ...baseEnv(), PWD: cwd, HOME: home, POORIJA_PANEL_SETTINGS: path.join(home, 'panel.env'), ...env },
  });
  const lines = `${result.stdout}`.split('\n');
  return {
    code: result.status, out: `${result.stdout}${result.stderr}`,
    runLine: lines.find((line) => line.startsWith('+ docker run -d')) || '',
    buildLine: lines.find((line) => line.startsWith('+ docker build')) || '',
    pullLine: lines.find((line) => line.startsWith('+ docker pull')) || '',
  };
};
const place = () => fs.realpathSync(freshHome());
/* The same, at a terminal: the lines are typed into a pseudo-terminal. */
const runTty = (home, args, lines, { cwd = ROOT, script = SCRIPT } = {}) => {
  const quote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
  const command = ['bash', script, ...args].map(quote).join(' ');
  const inner = process.platform === 'darwin' ? `script -q /dev/null ${command}` : `script -qec ${quote(command)} /dev/null`;
  const typed = lines.map((line) => `${line}\\n`).join('');
  const result = spawnSync('bash', ['-c', `(printf ${quote(typed)}; sleep 3) | ${inner}`], {
    encoding: 'utf8', timeout: 30000, cwd,
    env: { ...baseEnv(), PWD: cwd, HOME: home, POORIJA_PANEL_SETTINGS: path.join(home, 'panel.env') },
  });
  const out = `${result.stdout}${result.stderr}`.replace(/\r/g, '');
  return { code: result.status, out, runLine: out.split('\n').find((line) => line.startsWith('+ docker run -d')) || '' };
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

  /* Wherever it is run from. The script finds its own checkout from where its
     file really is, and deploy.conf, the SSH keys and the backup from where it
     is run and what deploy.conf says — never from a path written into it. */
  const START = ['--yes', '--dry-run', '--no-open'];
  const BUILD = `+ docker build -f ${ROOT}/config/Dockerfile.control-panel -t poorija/p00rija-panel:${VERSION} ${ROOT}`;
  const away = place();
  const fromAway = run(place(), START, '', { cwd: away });
  check('run from another folder, it still builds from its own checkout', fromAway.code === 0 && fromAway.buildLine === BUILD, fromAway.buildLine || fromAway.out.slice(-200));
  const links = place();
  fs.symlinkSync(SCRIPT, path.join(links, 'p00rija-panel'));
  const linked = run(place(), START, '', { cwd: away, script: path.join(links, 'p00rija-panel') });
  check('called through a symlink, it follows the link to its checkout', linked.code === 0 && linked.buildLine === BUILD, linked.buildLine || linked.pullLine || linked.out.slice(-200));
  fs.symlinkSync(path.relative(links, SCRIPT), path.join(links, 'relative'));
  const relLinked = run(place(), START, '', { cwd: away, script: path.join(links, 'relative') });
  check('and through a relative symlink too', relLinked.code === 0 && relLinked.buildLine === BUILD, relLinked.buildLine || relLinked.pullLine || relLinked.out.slice(-200));
  const alone = place();
  fs.copyFileSync(SCRIPT, path.join(alone, 'panel.sh'));
  const lone = run(place(), START, '', { cwd: away, script: path.join(alone, 'panel.sh') });
  check('a copy with no checkout around it pulls the image instead of building', lone.code === 0 && !lone.buildLine && lone.pullLine === '+ docker pull poorija/p00rija-panel:latest', lone.buildLine || lone.pullLine);
  const pipedHelp = run(place(), [], fs.readFileSync(SCRIPT, 'utf8'), { cwd: away, bashArgs: ['-s', '--', '--help'] });
  check('piped into bash, --help works', pipedHelp.code === 0 && ['start', 'stop', 'doctor', 'backup', 'restore', 'uninstall'].every((word) => pipedHelp.out.includes(word)) && !/unbound/.test(pipedHelp.out), pipedHelp.out.slice(-200));
  const piped = run(place(), [], fs.readFileSync(SCRIPT, 'utf8'), { cwd: away, bashArgs: ['-s', '--', ...START] });
  check('and so does a start, from Docker Hub', piped.code === 0 && piped.pullLine === '+ docker pull poorija/p00rija-panel:latest' && piped.runLine && !/unbound/.test(piped.out), piped.out.slice(-200));

  const xdgHome = place();
  const xdg = run(xdgHome, START, '', { cwd: away, env: { XDG_CONFIG_HOME: path.join(xdgHome, 'xdg'), POORIJA_PANEL_SETTINGS: undefined } });
  check('XDG_CONFIG_HOME moves deploy.conf’s folder and the settings, as deploy.sh does',
    xdg.runLine.includes(`-v ${xdgHome}/xdg/p00rija-cryptography:/config:ro`) && fs.existsSync(path.join(xdgHome, 'xdg/p00rija-cryptography/panel.env')), xdg.runLine);
  const envDir = place();
  const byEnv = run(place(), START, '', { cwd: away, env: { POORIJA_CONFIG_DIR: envDir } });
  check('POORIJA_CONFIG_DIR names deploy.conf’s folder, as for the other tools', byEnv.runLine.includes(`-v ${envDir}:/config:ro`), byEnv.runLine);

  /* A deploy.conf found where it is run, or beside it, names the servers the
     panel connects to, so it is only offered: used on a yes typed at a
     terminal, never on an Enter, a pipe, --yes or no answer at all. */
  const CONF = "SERVERS='a'\nA_SSH_HOST='a.example'\n";
  const ENTER = '\n\n\n\n\n\n';
  const YES_TO_FOUND = ['', '', '', 'yes', '', ''];
  const here = place();
  fs.writeFileSync(path.join(here, 'deploy.conf'), CONF);
  const hereHome = place();
  const inHere = runTty(hereHome, ['--dry-run', '--no-open'], YES_TO_FOUND, { cwd: here });
  check('a deploy.conf in the folder it is run from is offered, and used on a yes typed at a terminal', inHere.runLine.includes(`-v ${here}:/config:ro`) && /deploy\.conf found in/.test(inHere.out), inHere.runLine || inHere.out.slice(-300));
  const enterHome = place();
  const entered = runTty(enterHome, ['--dry-run', '--no-open'], ['', '', '', '', '', '', ''], { cwd: here });
  check('an Enter at that question leaves it alone', /deploy\.conf found in/.test(entered.out) && entered.runLine.includes(`-v ${enterHome}/.config/p00rija-cryptography:/config:ro`), entered.runLine || entered.out.slice(-300));
  const pipedYesHome = place();
  const pipedYes = run(pipedYesHome, ['--dry-run', '--no-open'], ENTER, { cwd: here });
  check('and answers down a pipe are never asked it', pipedYes.runLine.includes(`-v ${pipedYesHome}/.config/p00rija-cryptography:/config:ro`) && pipedYes.out.includes(`--config-dir ${here}`), pipedYes.runLine || pipedYes.out.slice(-300));
  const kept = run(hereHome, START, '', { cwd: away });
  check('and remembered, wherever it is run from next', kept.runLine.includes(`-v ${here}:/config:ro`), kept.runLine);
  const yesHome = place();
  const unasked = run(yesHome, START, '', { cwd: here });
  check('with --yes it is not taken, only named with the flag that takes it',
    unasked.runLine.includes(`-v ${yesHome}/.config/p00rija-cryptography:/config:ro`) && unasked.out.includes(`--config-dir ${here}`) && !settings(yesHome).includes(here), unasked.runLine);
  const silentHome = place();
  const silent = run(silentHome, ['--dry-run', '--no-open'], '', { cwd: here });
  check('nor when the questions get no answer at all', silent.runLine.includes(`-v ${silentHome}/.config/p00rija-cryptography:/config:ro`) && !settings(silentHome).includes(here), silent.runLine || silent.out.slice(-200));
  const kit = place();
  fs.copyFileSync(SCRIPT, path.join(kit, 'panel.sh'));
  fs.writeFileSync(path.join(kit, 'deploy.conf'), CONF);
  const besideIt = runTty(place(), ['--dry-run', '--no-open'], YES_TO_FOUND, { cwd: away, script: path.join(kit, 'panel.sh') });
  check('so is one beside a copy of the script', besideIt.runLine.includes(`-v ${kit}:/config:ro`), besideIt.runLine);
  const notOurs = place();
  fs.writeFileSync(path.join(notOurs, 'deploy.conf'), 'host=example\n');
  const notOursHome = place();
  const other = run(notOursHome, ['--dry-run', '--no-open'], ENTER, { cwd: notOurs });
  check('but a deploy.conf of something else is not offered', other.runLine.includes(`-v ${notOursHome}/.config/p00rija-cryptography:/config:ro`) && !other.out.includes(notOurs), other.runLine);

  /* deploy.conf is read as data by the launcher, as by the panel: nothing in
     it runs, whichever folder it came from. */
  const shellConf = place();
  const marker = path.join(shellConf, 'ran');
  fs.writeFileSync(path.join(shellConf, 'deploy.conf'), `SERVERS='a'\nA_SSH_HOST='a.example'\nA_SSH_USER='op'\nA_SSH_PORT="$(touch ${marker}-port)"\ntouch ${marker}\n`);
  const fakeBin = place();
  fs.writeFileSync(path.join(fakeBin, 'ssh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${fakeBin}/ssh.log\nexit 0\n`, { mode: 0o755 });
  const dry = run(place(), ['doctor', '--dry-run', '--config-dir', shellConf], '', { cwd: away });
  const real = run(place(), ['doctor', '--config-dir', shellConf], '', { cwd: away, env: { PATH: `${fakeBin}:${process.env.PATH}` } });
  const sshLog = fs.existsSync(path.join(fakeBin, 'ssh.log')) ? fs.readFileSync(path.join(fakeBin, 'ssh.log'), 'utf8') : '';
  check('doctor reads deploy.conf as data: nothing in it runs', !fs.existsSync(marker) && !fs.existsSync(`${marker}-port`) && dry.out.includes('check ssh a'), `${fs.existsSync(marker) ? 'a line ran ' : ''}${fs.existsSync(`${marker}-port`) ? 'a $(…) ran' : ''}`);
  check('and still logs in to each server as deploy.conf says', /(^| )op@a\.example( |$)/m.test(sshLog), sshLog.trim() || real.out.slice(-200));

  const keyHome = place();
  const keyConf = place();
  fs.writeFileSync(path.join(keyConf, 'deploy.conf'), `SERVERS='a b'\nA_SSH_HOST='a.example'\nA_SSH_KEY='${keyHome}/.ssh/relays/sub/a'\nB_SSH_HOST='b.example'\nB_SSH_KEY='${keyHome}/.ssh/relays/b'\n`);
  const keyed = run(keyHome, [...START, '--config-dir', keyConf], '', { cwd: away });
  check('the SSH folder is the narrowest one in ~/.ssh holding deploy.conf’s keys', keyed.runLine.includes(`-v ${keyHome}/.ssh/relays:/ssh-src:ro`) && keyed.runLine.includes(`-e POORIJA_PANEL_HOST_SSH_DIR=${keyHome}/.ssh/relays`), keyed.runLine);
  const tildeHome = place();
  const tildeConf = place();
  fs.writeFileSync(path.join(tildeConf, 'deploy.conf'), "SERVERS='a'\nA_SSH_HOST='a.example'\nA_SSH_KEY='~/.ssh/relay-keys/a'\n");
  const tilde = run(tildeHome, [...START, '--config-dir', tildeConf], '', { cwd: away });
  check('with ~ in deploy.conf meaning this computer’s home', tilde.runLine.includes(`-v ${tildeHome}/.ssh/relay-keys:/ssh-src:ro`), tilde.runLine);
  const elsewhereHome = place();
  const elsewhereConf = place();
  fs.writeFileSync(path.join(elsewhereConf, 'deploy.conf'), `SERVERS='a b'\nA_SSH_HOST='a.example'\nA_SSH_KEY='${elsewhereHome}/Documents/a'\nB_SSH_HOST='b.example'\nB_SSH_KEY='${elsewhereHome}/Documents/b'\n`);
  const elsewhereKeys = run(elsewhereHome, [...START, '--config-dir', elsewhereConf], '', { cwd: away });
  check('keys outside ~/.ssh never choose a folder to hand the container: that takes --ssh-dir',
    elsewhereKeys.runLine.includes(`-v ${elsewhereHome}/.ssh:/ssh-src:ro`) && /outside/.test(elsewhereKeys.out) && /--ssh-dir/.test(elsewhereKeys.out), elsewhereKeys.runLine);
  const spreadHome = place();
  const spreadConf = place();
  fs.writeFileSync(path.join(spreadConf, 'deploy.conf'), `SERVERS='a b'\nA_SSH_HOST='a.example'\nA_SSH_KEY='${spreadHome}/one/a'\nB_SSH_HOST='b.example'\nB_SSH_KEY='${spreadHome}/two/b'\n`);
  const spread = run(spreadHome, [...START, '--config-dir', spreadConf], '', { cwd: away });
  check('keys with only the home folder in common never hand the whole home to the container', spread.runLine.includes(`-v ${spreadHome}/.ssh:/ssh-src:ro`) && /outside/.test(spread.out), `${spread.runLine} ${spread.out.match(/.*outside.*/)?.[0] || ''}`);

  /* Docker takes a folder that is not a whole path for the name of a volume,
     and a quoted ~ for a folder called "~". */
  const dotHome = place();
  const dot = run(dotHome, [...START, '--config-dir', '.'], '', { cwd: here });
  check('--config-dir . is the folder it is run from, as a whole path', dot.runLine.includes(`-v ${here}:/config:ro`), dot.runLine);
  const tildeFlagHome = place();
  const tildeFlag = run(tildeFlagHome, [...START, '--ssh-dir', '~/k'], '', { cwd: away });
  check('a ~ that reached it unexpanded means this computer’s home', tildeFlag.runLine.includes(`-v ${tildeFlagHome}/k:/ssh-src:ro`) && !tildeFlag.runLine.includes('~'), tildeFlag.runLine);
  const typedHome = place();
  const typedPaths = run(typedHome, ['--dry-run', '--no-open'], '\n\n\n~/conf\nkeys/\n\n', { cwd: away });
  check('and so do answers typed at the prompts, a relative one against the folder it is run from',
    typedPaths.runLine.includes(`-v ${typedHome}/conf:/config:ro`) && typedPaths.runLine.includes(`-v ${away}/keys:/ssh-src:ro`), typedPaths.runLine || typedPaths.out.slice(-200));
  check('which is what it remembers', new RegExp(`^PANEL_SSH_DIR=${away}/keys$`, 'm').test(settings(typedHome)), settings(typedHome).replace(/\n/g, ' '));
  fs.writeFileSync(path.join(here, 'cert.pem'), 'cert');
  fs.writeFileSync(path.join(here, 'key.pem'), 'key');
  const relTls = run(place(), [...START, '--bind', '0.0.0.0', '--host', 'panel.example', '--tls-cert', 'cert.pem', '--tls-key', 'key.pem'], '', { cwd: here });
  check('a certificate named relative to the folder it is run from is found and mounted whole', relTls.code === 0 && relTls.runLine.includes(`-v ${here}/cert.pem:/tls/cert.pem:ro`) && relTls.runLine.includes(`-v ${here}/key.pem:/tls/key.pem:ro`), relTls.runLine || relTls.out.slice(-200));

  const hint = run(place(), ['restore', '--dry-run'], '', { cwd: away, script: path.join(links, 'p00rija-panel') });
  check('its hints name the command the way it was called', hint.code !== 0 && hint.out.includes(`bash ${path.join(links, 'p00rija-panel')} restore FILE`), hint.out.slice(-200));
  const copyHelp = run(place(), ['--help'], '', { cwd: away, script: path.join(alone, 'panel.sh') });
  check('and so does --help', copyHelp.out.includes(`bash ${path.join(alone, 'panel.sh')} doctor`) && !copyHelp.out.includes('scripts/panel.sh'), copyHelp.out.split('\n').find((l) => /doctor/.test(l)) || '');
  const backHome = place();
  const backAway = run(backHome, ['backup', '--dry-run'], '', { cwd: away });
  check('a backup with no file named lands in the folder it was run from', new RegExp(`> ${away}/p00rija-panel-backup-\\d{8}-\\d{6}\\.tar\\.gz`).test(backAway.out), backAway.out.split('\n').find((l) => l.includes('tar czf')) || '');
  const backRepo = run(backHome, ['backup', '--dry-run']);
  check('but never inside the checkout, where git could pick its secrets up', new RegExp(`> ${backHome}/p00rija-panel-backup-`).test(backRepo.out), backRepo.out.split('\n').find((l) => l.includes('tar czf')) || '');

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
