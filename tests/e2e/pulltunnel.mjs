/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The tunnel `deploy.sh --prebuilt` pulls through (scripts/lib/pull-tunnel.sh).
 * A pull whose link died left its sshd session holding port 5055 on the
 * server, and every deploy after it failed at once with "remote port
 * forwarding failed for listen port 5055" (the Iran relay, 2026-11-09). Here:
 *
 *   - the server's end of the tunnel is a random port of each pull's own,
 *     20000 to 60000, and the server pulls from 127.0.0.1:<that port>;
 *   - a port that is taken on the server is retried with another one, and
 *     any other failure is not retried;
 *   - deploy.sh's own prebuilt_pull, run with a stand-in ssh and docker,
 *     sends the sweep and pulls from the right place;
 *   - the sweep ends this account's earlier pulls whose tunnel is dead — and
 *     their ssh session — and leaves alone a pull that still answers, a
 *     terminal session, a pull with no ssh session above it, a `bash -s`
 *     without the mark, and this pull itself;
 *   - with Docker here: the same sweep, written out by this computer's bash
 *     as deploy.sh sends it, run by Linux's bash and procps in a local
 *     Ubuntu/Debian image (PULL_TUNNEL_IMAGE names one), where another
 *     account's stale pull must survive; and a registry on a random
 *     127.0.0.1 port is pushed to and pulled from with no daemon settings.
 *     Each Docker part is skipped, and says so, when it cannot run.
 *
 *   node tests/e2e/pulltunnel.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = path.join(ROOT, 'scripts/lib/pull-tunnel.sh');
const DEPLOY = path.join(ROOT, 'scripts/deploy.sh');
const MARK = 'poorija-prebuilt-pull';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const skip = (name, why) => console.log(`  SKIP  ${name}  — ${why}`);
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-pulltunnel-')));
const write = (file, text, mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, mode ? { mode } : undefined); };
const sh = (script, opts = {}) => spawnSync('bash', ['-c', script], { encoding: 'utf8', ...opts });
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inRange = (p) => Number.isInteger(p) && p >= 20000 && p <= 60000;

/* A port nothing listens on: taken from the system, then let go. */
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
/* Async, so a server in this process can answer while the sweep runs. */
const run = (script, env = {}) => new Promise((resolve) => {
  const child = spawn('bash', ['-c', script], { env: { ...process.env, ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});
const groups = [];
const alive = (pid) => {
  const r = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  const stat = (r.stdout || '').trim();
  return Boolean(stat) && !stat.startsWith('Z');
};
const table = () => spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'args='], { encoding: 'utf8' }).stdout
  .split('\n').map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
  .map(([, pid, ppid, args]) => ({ pid: Number(pid), ppid: Number(ppid), args }));

try {
  /* ------------------------------------------------------------ the port */
  const many = sh(`. ${q(LIB)}; i=0; while [ $i -lt 400 ]; do pull_tunnel_port; i=$((i+1)); done`).stdout.trim().split('\n').map(Number);
  check('every port is a whole number from 20000 to 60000', many.length === 400 && many.every(inRange), `${many.filter((p) => !inRange(p)).slice(0, 5)}`);
  check('the port is a different one from pull to pull, not one fixed port', new Set(many).size > 300, `${new Set(many).size} distinct of 400`);
  check('it spreads over the whole range', many.some((p) => p < 26000) && many.some((p) => p > 54000), `${Math.min(...many)}..${Math.max(...many)}`);
  const fresh = Array.from({ length: 12 }, () => Number(sh(`. ${q(LIB)}; pull_tunnel_port`).stdout.trim()));
  check('and a new run of deploy.sh does not start from the same port', new Set(fresh).size >= 10, fresh.join(' '));

  /* ---------------------------------------- deploy.sh's prebuilt_pull itself */
  const text = fs.readFileSync(DEPLOY, 'utf8');
  const fn = text.match(/^prebuilt_pull\(\) \{\n[\s\S]*?\n\}\n/m)?.[0] || '';
  check('deploy.sh has a prebuilt_pull to run', fn.includes('ExitOnForwardFailure=yes'));
  check('deploy.sh no longer asks the server for the fixed registry port', !/-R\s+"\$REGISTRY:\$REGISTRY"/.test(text));
  check('deploy.sh loads scripts/lib/pull-tunnel.sh', /^\. "\$\(dirname "\$0"\)\/lib\/pull-tunnel\.sh"/m.test(text));

  const bin = path.join(work, 'bin');
  /* ssh as deploy.sh calls it: what it was asked, the script it was sent,
     and per call what the server does — "taken" (the port is held there),
     "down" (the server does not answer), or "ok" (the script runs). */
  write(path.join(bin, 'ssh'), `#!/usr/bin/env bash
n=$(( $(cat "$STATE/count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STATE/count"
printf '%s\\n' "$@" > "$STATE/args.$n"
cat > "$STATE/script.$n"
fwd=""; prev=""; for a in "$@"; do [ "$prev" = "-R" ] && fwd="$a"; prev="$a"; done
port="\${fwd#127.0.0.1:}"; port="\${port%%:*}"
case "$(sed -n "\${n}p" "$STATE/plan")" in
  taken) echo "Error: remote port forwarding failed for listen port $port" >&2; exit 255 ;;
  down) echo "ssh: connect to host relay.test port 22: Operation timed out" >&2; exit 255 ;;
  *) cmd="\${!#}"; $cmd < "$STATE/script.$n"; exit $? ;;
esac
`, 0o755);
  /* docker on a server that holds some names an interrupted pull left, and
     some that are not the pull's. */
  write(path.join(bin, 'docker'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STATE/docker.log"
case "$1 $2" in
  "image ls") printf '%s\\n' 127.0.0.1:5055/poorija-crypto:2.98.91 127.0.0.1:41234/alpine:3.24.3 127.0.0.1:5055/someone-else:1 poorija-crypto:2.98.91 registry.example/alpine:3 127.0.0.1:5055/coturn/coturn:4.18.0-alpine ;;
  "image inspect") echo sha256:0123456789abcdef0123456789abcdef ;;
esac
exit 0
`, 0o755);
  const pull = (name, plan) => {
    const state = path.join(work, name);
    fs.mkdirSync(state, { recursive: true });
    write(path.join(state, 'plan'), `${plan.join('\n')}\n`);
    const harness = `set -uo pipefail
log() { echo "LOG $1"; }; warn() { echo "WARN $1"; }; fail() { echo "FAIL $1"; }
tree_version() { echo 9.98.7; }; coturn_image() { echo coturn/coturn:4.18.0-alpine; }
ALPINE_TAG=3.24.3; REGISTRY=127.0.0.1:5055
SSH_OPTS=(-p 22 -o BatchMode=yes); USER_NAME=me; HOST=relay.test
. ${q(LIB)}
${fn}
prebuilt_pull; echo "status=$?"`;
    const r = sh(harness, { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STATE: state } });
    const count = Number(fs.existsSync(path.join(state, 'count')) ? fs.readFileSync(path.join(state, 'count'), 'utf8') : 0);
    const calls = Array.from({ length: count }, (_, i) => {
      const args = fs.readFileSync(path.join(state, `args.${i + 1}`), 'utf8').trimEnd().split('\n');
      const fwd = args[args.indexOf('-R') + 1] || '';
      return { args, fwd, port: Number(fwd.split(':')[1]), command: args[args.length - 1], script: fs.readFileSync(path.join(state, `script.${i + 1}`), 'utf8') };
    });
    const docker = fs.existsSync(path.join(state, 'docker.log')) ? fs.readFileSync(path.join(state, 'docker.log'), 'utf8').trim().split('\n') : [];
    return { out: r.stdout + r.stderr, status: Number((r.stdout.match(/status=(\d+)/) || [])[1] ?? -1), calls, docker };
  };

  const taken = pull('taken-then-ok', ['taken', 'ok']);
  const [first = {}, second = { script: '' }] = taken.calls;
  check('a port taken on the server is tried again, once, with another port', taken.calls.length === 2 && first.port !== second.port && taken.status === 0, `${taken.calls.map((c) => c.port)} status ${taken.status}`);
  check('and the person sees why', /WARN port \d+ is taken on the server; trying another/.test(taken.out));
  check('each try forwards a port of its own on the server to the registry here',
    taken.calls.every((c) => inRange(c.port) && c.fwd === `127.0.0.1:${c.port}:127.0.0.1:5055`), taken.calls.map((c) => c.fwd).join(' '));
  check('ExitOnForwardFailure stays on, so a taken port is an error and not a pull from nowhere',
    taken.calls.every((c) => c.args.join(' ').includes('ExitOnForwardFailure=yes')));
  check('the command on the server names the pull and its port (what a later sweep reads)',
    taken.calls.every((c) => c.command === `bash -s ${MARK} ${c.port}`), taken.calls.map((c) => c.command).join(' | '));
  const pulls = taken.docker.filter((l) => l.startsWith('pull '));
  const want = ['poorija-crypto:9.98.7', 'poorija-chat-signal:9.98.7', 'poorija-cert-renewer:9.98.7', 'coturn/coturn:4.18.0-alpine', 'alpine:3.24.3'];
  check('the server pulls every image from 127.0.0.1:<its own port>',
    pulls.length === 5 && want.every((ref) => pulls.includes(`pull -q 127.0.0.1:${second.port}/${ref}`)), pulls.join(' | '));
  check('and keeps them under their own names', want.every((ref) => taken.docker.includes(`tag 127.0.0.1:${second.port}/${ref} ${ref}`)));
  check('nothing is pulled from the old fixed port', !taken.docker.some((l) => /pull .*127\.0\.0\.1:5055\//.test(l)));
  check('the script the server runs carries the sweep, and runs it with its own port first',
    second.script.includes('pull_sweep_stale ()') && second.script.includes(`pull_sweep_stale ${second.port} || true`)
      && second.script.indexOf(`pull_sweep_stale ${second.port}`) < second.script.indexOf('docker pull'));
  const rmis = taken.docker.filter((l) => l.startsWith('rmi '));
  const leftovers = rmis.includes('rmi 127.0.0.1:5055/poorija-crypto:2.98.91') && rmis.includes('rmi 127.0.0.1:41234/alpine:3.24.3') && rmis.includes('rmi 127.0.0.1:5055/coturn/coturn:4.18.0-alpine');
  check('names an interrupted pull left (127.0.0.1:<port>/<this pull’s image>) are removed', leftovers, leftovers ? '' : rmis.join(' | '));
  const others = rmis.filter((l) => /someone-else|registry\.example|^rmi poorija-crypto:2\.98\.91$/.test(l));
  check('and no other name: not another image’s, not a name without the tunnel', !others.length, others.join(' | '));

  const down = pull('down', ['down', 'ok']);
  check('a server that does not answer is not tried again: that failure is the answer', down.calls.length === 1 && down.status === 255, `${down.calls.length} call(s), status ${down.status}`);
  const busy = pull('taken-thrice', ['taken', 'taken', 'taken', 'ok']);
  check('three taken ports in a row: it stops and says the pull failed', busy.calls.length === 3 && busy.status !== 0, `${busy.calls.length} call(s), status ${busy.status}`);

  /* ------------------------------------------------ the sweep, on this computer */
  const user = sh('id -un').stdout.trim();
  const fakes = path.join(work, 'fakes');
  fs.mkdirSync(fakes, { recursive: true });
  const bashPath = sh('command -v bash').stdout.trim();
  /* An "sshd-session" and a "fish" that are bash under those names. */
  fs.copyFileSync(bashPath, path.join(fakes, 'sshd-session')); fs.chmodSync(path.join(fakes, 'sshd-session'), 0o755);
  fs.copyFileSync(bashPath, path.join(fakes, 'fish')); fs.chmodSync(path.join(fakes, 'fish'), 0o755);
  const SSHD = path.join(fakes, 'sshd-session');
  const FISH = path.join(fakes, 'fish');
  const start = (script) => {
    const child = spawn('bash', ['-c', script], { detached: true, stdio: 'ignore' });
    groups.push(child.pid);
    child.unref();
    return child.pid;
  };
  /* sshd-session → [fish →] bash -s <mark> <port>, the marked pull waiting
     on its script the way a stuck one waits on its pull. */
  const session = (as, line, viaFish = false) => {
    const inner = `sleep 600 | ${line}`;
    const body = viaFish ? `${q(FISH)} -c ${q(inner)}; true` : `${inner}; true`;
    return start(`exec -a ${q(`sshd-session: ${as}`)} ${q(SSHD)} -c ${q(body)}`);
  };

  const ports = {};
  for (const k of ['dead', 'deadFish', 'silent', 'tty', 'bare', 'own']) ports[k] = await freePort();
  /* A tunnel that still reaches a registry, and one whose link is gone: it
     accepts, and nothing ever answers. */
  const registry = http.createServer((req, res) => { res.writeHead(200, { 'Docker-Distribution-API-Version': 'registry/2.0' }); res.end('{}'); });
  await new Promise((r) => registry.listen(0, '127.0.0.1', r));
  ports.live = registry.address().port;
  const held = [];
  const silent = net.createServer((socket) => { held.push(socket); });
  await new Promise((r) => silent.listen(ports.silent, '127.0.0.1', r));

  session(`${user}@notty`, `bash -s ${MARK} ${ports.dead}`);
  session(`${user}@notty`, `bash -s ${MARK} ${ports.deadFish}`, true);
  session(`${user}@notty`, `bash -s ${MARK} ${ports.silent}`);
  session(`${user}@notty`, `bash -s ${MARK} ${ports.live}`);
  session(`${user}@pts/3`, `bash -s ${MARK} ${ports.tty}`);
  start(`sleep 600 | bash -s ${MARK} ${ports.bare}; true`);
  session(`${user}@notty`, `bash -s ${MARK} ${ports.own}`);
  session(`${user}@notty`, 'bash -s');
  await sleep(800);

  const procs = table();
  const pullOn = (port) => procs.find((p) => p.args === `bash -s ${MARK} ${port}`);
  const sessionOf = (p) => {
    let cur = p && procs.find((x) => x.pid === p.ppid);
    for (let i = 0; cur && i < 3; i += 1) {
      if (cur.args.startsWith('sshd-session: ')) return cur;
      cur = procs.find((x) => x.pid === cur.ppid);
    }
    return null;
  };
  const cases = {};
  for (const [k, port] of Object.entries(ports)) { const p = pullOn(port); cases[k] = { pull: p?.pid, session: sessionOf(p)?.pid }; }
  const plain = procs.find((p) => p.args === 'bash -s' && procs.find((x) => x.pid === p.ppid)?.args.startsWith(`sshd-session: ${user}@notty`));
  check('the stand-in sessions are all up', Object.values(cases).every((c) => c.pull) && plain && ['dead', 'deadFish', 'silent', 'live', 'tty', 'own'].every((k) => cases[k].session),
    JSON.stringify(cases));

  const sweep = await run(`. ${q(LIB)}; pull_sweep_stale ${ports.own}; echo "status=$?"`, { PULL_PROBE_SECONDS: '2' });
  await sleep(700);
  const swept = /status=0/.test(sweep.stdout);
  check('the sweep finishes and does not fail the pull', swept, swept ? '' : (sweep.stdout + sweep.stderr).slice(-300));
  check('a stale pull whose port is closed is ended, with its ssh session', !alive(cases.dead.pull) && !alive(cases.dead.session));
  check('the same when the login shell (fish) sits between them', !alive(cases.deadFish.pull) && !alive(cases.deadFish.session));
  check('a tunnel that accepts but never answers — the dead link itself — counts as stale', !alive(cases.silent.pull) && !alive(cases.silent.session));
  const told = (sweep.stdout.match(/ended an earlier pull/g) || []).length;
  check('the sweep says what it ended, once for each', told === 3, told === 3 ? '' : sweep.stdout.trim());
  check('a pull whose tunnel still answers is left alone', alive(cases.live.pull) && alive(cases.live.session));
  check('a pull on a terminal session (not @notty) is left alone', alive(cases.tty.pull) && alive(cases.tty.session));
  check('a marked process with no ssh session above it is left alone', alive(cases.bare.pull));
  check('this pull’s own port is never swept', alive(cases.own.pull) && alive(cases.own.session));
  check('a plain `bash -s` session without the mark is left alone', alive(plain.pid) && alive(plain.ppid));
  silent.close(); held.forEach((s) => s.destroy());
  registry.close();

  /* ------------------------------------------------------------- Docker */
  const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, ...opts });
  const dockerUp = docker(['info', '--format', '{{json .RegistryConfig.InsecureRegistryCIDRs}}'], { timeout: 20000 });
  if (dockerUp.status !== 0) {
    skip('the sweep on Linux, and a registry on a random loopback port', 'Docker is not running here');
  } else {
    let cidrs = [];
    try { cidrs = JSON.parse(dockerUp.stdout); } catch (_) { /* reported below */ }
    check('Docker treats 127.0.0.0/8 as a plain-HTTP registry by default', cidrs.includes('127.0.0.0/8'), dockerUp.stdout.trim());

    /* The sweep as deploy.sh sends it — this computer's bash writes it out
       — run by Linux's bash and ps as root, among another account's
       processes. */
    const local = docker(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']).stdout.split('\n').filter((n) => n && !n.includes('<none>') && !n.startsWith('127.0.0.1:'));
    const order = (n) => (/^(ubuntu|debian)(:|$)/.test(n) ? 0 : /ubuntu|debian|builder/.test(n) ? 1 : 2);
    const candidates = process.env.PULL_TUNNEL_IMAGE ? [process.env.PULL_TUNNEL_IMAGE] : local.sort((a, b) => order(a) - order(b)).slice(0, 15);
    const image = candidates.find((img) => docker(['run', '--rm', '--network', 'none', '--entrypoint', 'bash', img, '-c', 'ps -A -o pid= -o ppid= -o uid= -o comm= >/dev/null && command -v setpriv >/dev/null && id nobody >/dev/null'], { timeout: 60000 }).status === 0);
    if (!image) {
      skip('the sweep on Linux', 'no local image here has bash, procps and setpriv (set PULL_TUNNEL_IMAGE to one)');
    } else {
      const sent = sh(`. ${q(LIB)}; echo "PULL_MARK=$PULL_MARK"; declare -f _pull_proc pull_tunnel_answers pull_sweep_stale pull_untag_leftovers`).stdout;
      const scenario = `${sent}
cp "$(command -v bash)" /tmp/sshd-session; cp "$(command -v bash)" /tmp/fish
printf '#!/bin/bash\\nexec -a "sshd-session: $1" /tmp/sshd-session -c "$2"\\n' > /tmp/launch
chmod 755 /tmp/sshd-session /tmp/fish /tmp/launch
NU="$(id -u nobody)"; NG="$(id -g nobody)"
# whose (root or nobody), the session's title, the pull's port, and "fish"
# when the login shell sits between the session and the pull
fake() {
  inner="sleep 600 | bash -s $PULL_MARK $3"
  if [ "\${4:-}" = fish ]; then body="/tmp/fish -c '$inner'; true"; else body="$inner; true"; fi
  if [ "$1" = root ]; then /tmp/launch "$2" "$body" </dev/null >/dev/null 2>&1 &
  else setpriv --reuid="$NU" --regid="$NG" --clear-groups /tmp/launch "$2" "$body" </dev/null >/dev/null 2>&1 & fi
}
fake root root@notty 31001
fake root root@notty 31002 fish
fake nobody nobody@notty 31003
fake nobody nobody@notty 31004 fish
# root's, under a session whose title names another account
fake root nobody@notty 31005
sleep 1
pid_of() { ps -A -o pid= -o args= | awk -v a="bash -s $PULL_MARK $1" '{p=$1; $1=""; sub(/^ +/,""); if ($0==a) print p}' | head -1; }
ppid_of() { ps -o ppid= -p "$1" | tr -d ' '; }
up() { s="$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')"; [ -n "$s" ] && [ "\${s#Z}" = "$s" ] && echo up || echo gone; }
for port in 31001 31002 31003 31004 31005; do
  p="$(pid_of $port)"; pp="$(ppid_of "$p")"
  # through fish, the session is one more step up
  case "$(ps -o comm= -p "$pp")" in fish) s="$(ppid_of "$pp")" ;; *) s="$pp" ;; esac
  eval "pull_$port=$p session_$port=$s"
done
PULL_PROBE_SECONDS=2 pull_sweep_stale 39999 > /tmp/sweep.out; echo "sweep-status $?"
sleep 1
for port in 31001 31002 31003 31004 31005; do
  eval "p=\\$pull_$port s=\\$session_$port"
  echo "case $port pull=$( [ -n "$p" ] && up "$p" || echo missing ) session=$( [ -n "$s" ] && up "$s" || echo missing ) uid=$(ps -o uid= -p "$s" 2>/dev/null | tr -d ' ')"
done
cat /tmp/sweep.out | sed 's/^/said /'
`;
      const linux = docker(['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'bash', image, '-s'], { input: scenario, timeout: 120000 });
      const out = linux.stdout + linux.stderr;
      const caseOf = (port) => (out.match(new RegExp(`^case ${port} pull=(\\w+) session=(\\w+)`, 'm')) || []).slice(1).join(' ');
      console.log(`        (Linux image: ${image})`);
      const ran = /sweep-status 0/.test(out);
      check('Linux: the sweep runs as deploy.sh sends it (written out by this computer’s bash)', ran, ran ? '' : out.slice(-400));
      check('Linux: this account’s stale pull and its sshd-session are ended', caseOf(31001) === 'gone gone', caseOf(31001));
      check('Linux: the same through a fish login shell', caseOf(31002) === 'gone gone', caseOf(31002));
      check('Linux: another account’s stale pull is never touched', caseOf(31003) === 'up up' && caseOf(31004) === 'up up', `${caseOf(31003)} / ${caseOf(31004)}`);
      check('Linux: nor a pull under a session whose title names another account', caseOf(31005) === 'up up', caseOf(31005));
      const said = (out.match(/^said ended an earlier pull/gm) || []).length;
      check('Linux: it says what it ended, twice', said === 2, said === 2 ? '' : out.split('\n').filter((l) => l.startsWith('said')).join(' | '));
    }

    /* The server pulls from 127.0.0.1:<random port> over plain HTTP: a
       throwaway registry on such a port, pushed to and pulled from, with
       no daemon setting. Only images already here are used. */
    const haveRegistry = docker(['image', 'inspect', 'registry:3.1.2']).status === 0;
    const small = local.find((n) => /^alpine:/.test(n)) || (haveRegistry ? 'registry:3.1.2' : '');
    if (!haveRegistry || !small) {
      skip('a registry on a random 127.0.0.1 port', 'registry:3.1.2 is not on this computer (it is what deploy.sh runs; nothing is pulled here)');
    } else {
      const port = Number(sh(`. ${q(LIB)}; pull_tunnel_port`).stdout.trim());
      const name = `poorija-pulltunnel-test-${process.pid}`;
      const ref = `127.0.0.1:${port}/poorija-pulltunnel-check:1`;
      try {
        const up = docker(['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1:${port}:5000`, 'registry:3.1.2']);
        let ready = false;
        for (let i = 0; i < 30 && up.status === 0 && !ready; i += 1) {
          ready = await new Promise((r) => http.get(`http://127.0.0.1:${port}/v2/`, (res) => { res.resume(); r(res.statusCode === 200); }).on('error', () => r(false)));
          if (!ready) await sleep(300);
        }
        const tagged = docker(['tag', small, ref]).status === 0;
        const pushed = tagged && docker(['push', '-q', ref]).status === 0;
        docker(['rmi', ref]);
        const pulled = pushed && docker(['pull', '-q', ref]);
        check(`a registry on random port ${port} of 127.0.0.1 takes a push and gives a pull, with no daemon setting`,
          ready && pushed && pulled?.status === 0, `${up.stderr || ''}${pulled?.stderr || ''}`.trim().slice(-300));
      } finally {
        docker(['rmi', ref]);
        docker(['rm', '-f', name]);
      }
    }
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack?.split('\n').slice(0, 3).join(' ') || String(error));
} finally {
  for (const pgid of groups) { try { process.kill(-pgid, 'SIGKILL'); } catch (_) { /* already gone */ } }
  fs.rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
