/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A server made ready before anything is installed on it: Docker with its
 * compose plugin and the small tools, by scripts/lib/server-prereqs.sh sent
 * over SSH. A server inside Iran is pointed at the mirrors reachable there,
 * for Docker's packages and for its images. When the server reaches nothing
 * that has Docker (exit code 3), this panel — outside, on the operator's
 * computer — downloads Docker's static binaries and the compose plugin itself
 * and copies them in over the same SSH, so a server that SSH reaches always
 * gets Docker. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { run } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', '..', 'scripts', 'lib', 'server-prereqs.sh');
const REMOTE_FILES = '"$HOME/.p00rija-prereqs"';
const shellArg = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/* "key=value" lines into an object; anything else is ignored. */
export function parseFacts(lines) {
  const facts = {};
  const needs = [];
  for (const line of lines) {
    const match = /^([A-Za-z]+)=(.*)$/.exec(String(line).trim());
    if (!match) continue;
    if (match[1] === 'need') needs.push(match[2].trim());
    else facts[match[1]] = match[2].trim();
  }
  return { ...facts, needs };
}

/* The names Docker's downloads use for a machine. */
export function archNames(arch) {
  const value = String(arch || '').toLowerCase();
  if (value === 'x86_64' || value === 'amd64') return { docker: 'x86_64', compose: 'x86_64' };
  if (value === 'aarch64' || value === 'arm64') return { docker: 'aarch64', compose: 'aarch64' };
  if (value.startsWith('armv7')) return { docker: 'armhf', compose: 'armv7' };
  return null;
}

/* The newest docker-X.Y.Z.tgz in a listing of download.docker.com/linux/static/stable/<arch>/. */
export function newestStatic(listing) {
  const versions = [...String(listing).matchAll(/docker-(\d+)\.(\d+)\.(\d+)\.tgz/g)].map((match) => match.slice(1, 4).map(Number));
  if (!versions.length) return '';
  versions.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  return `docker-${versions[0].join('.')}.tgz`;
}

const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/* A sudo password for a script's first lines: in a quoted here-document, so
   the shell takes it as it is, sent inside the SSH connection, never on a
   command line and never written to a file. One with a line break, or the
   here-document's own end word, is refused. */
const PASS_END = 'P00RIJA_SUDO_PASS_END';
export function validSudoPassword(value) {
  const text = String(value ?? '');
  return text.length <= 256 && !/[\r\n\0]/.test(text) && text !== PASS_END;
}
export function withSudoPassword(script, password) {
  if (!password) return script;
  if (!validSudoPassword(password)) throw new Error('that sudo password cannot be sent (a line break in it?)');
  return `IFS= read -r P00RIJA_SUDO_PASS <<'${PASS_END}'\n${password}\n${PASS_END}\n${script}`;
}

/* What the SSH user may do: root, sudo without a password, sudo with the
   password given, sudo that asks for one, or none. One attempt per check:
   a wrong password tried again and again can lock an account. */
const ACCESS_SCRIPT = `if [ "$(id -u)" = 0 ]; then echo access=root
elif ! command -v sudo >/dev/null 2>&1; then echo access=no-sudo
elif sudo -n true 2>/dev/null; then echo access=sudo
elif [ -n "\${P00RIJA_SUDO_PASS:-}" ] && printf '%s\\n' "$P00RIJA_SUDO_PASS" | sudo -S -p '' -v 2>/dev/null; then echo access=sudo-password; sudo -k 2>/dev/null
elif id -nG 2>/dev/null | tr ' ' '\\n' | grep -qxE 'sudo|wheel|admin'; then echo access=needs-password
else echo access=none; fi
unset P00RIJA_SUDO_PASS
echo user="$(id -un)"
echo dockerGroup="$(id -nG 2>/dev/null | tr ' ' '\\n' | grep -qx docker && echo 1 || echo 0)"
`;
export const ACCESS_OK = new Set(['root', 'sudo', 'sudo-password']);

export function createProvision({ stateDir, sshArgs, regionOf = () => '', registryMirrors = () => [], fetchImpl = fetch }) {
  const cache = path.join(stateDir, 'provision');
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 });

  const script = () => fs.readFileSync(SCRIPT, 'utf8');

  function runScript(server, args, line, lines, password = '') {
    const remote = `bash -s -- ${args.map((arg) => (arg === REMOTE_FILES ? arg : shellArg(arg))).join(' ')}`;
    return run(['ssh', ...sshArgs(server.ssh), remote], {
      input: Readable.from([withSudoPassword(script(), password)]),
      line: (text) => { lines.push(text); line(text); },
    });
  }

  /* What the SSH user may do there. */
  async function access(server, password = '') {
    const lines = [];
    const code = await run(['ssh', ...sshArgs(server.ssh), 'bash -s'], { input: Readable.from([withSudoPassword(ACCESS_SCRIPT, password)]), line: (text) => lines.push(text) });
    return { ok: code === 0, code, facts: parseFacts(lines) };
  }

  /* What a server has, changing nothing. */
  async function check(server) {
    const lines = [];
    const code = await runScript(server, ['--check'], () => {}, lines);
    return { ok: code === 0, code, facts: parseFacts(lines) };
  }

  async function download(url, to, line) {
    if (fs.existsSync(to) && fs.statSync(to).size > 0) { line(`  ${path.basename(to)} (kept from before)`); return to; }
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'p00rija-panel' }, redirect: 'follow', signal: AbortSignal.timeout(20 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
    const part = `${to}.part`;
    const out = fs.createWriteStream(part, { mode: 0o600 });
    let got = 0;
    let said = 0;
    for await (const chunk of response.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
      if (got - said > 10 * 1024 * 1024) { said = got; line(`  ${Math.round(got / 1048576)} MB`); }
    }
    await new Promise((resolve) => out.end(resolve));
    fs.renameSync(part, to);
    line(`  ${path.basename(to)} (${Math.round(got / 1048576)} MB)`);
    return to;
  }

  /* What the server said it needs, downloaded here. */
  async function fetchFiles(needs, arch, line) {
    const names = archNames(arch);
    if (!names) throw new Error(`no Docker downloads for a ${arch} machine`);
    const files = [];
    if (needs.includes('docker-static')) {
      const base = `https://download.docker.com/linux/static/stable/${names.docker}/`;
      const listing = await (await fetchImpl(base, { headers: { 'User-Agent': 'p00rija-panel' }, signal: AbortSignal.timeout(30000) })).text();
      const file = newestStatic(listing);
      if (!file) throw new Error(`no static Docker listed at ${base}`);
      files.push(await download(`${base}${file}`, path.join(cache, `${names.docker}-${file}`), line));
    }
    if (needs.includes('compose') || needs.includes('docker-static')) {
      /* The plugin is checked against the sum its release publishes beside it. */
      const url = `https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${names.compose}`;
      const file = await download(url, path.join(cache, `docker-compose-${names.compose}`), line);
      const want = String(await (await fetchImpl(`${url}.sha256`, { headers: { 'User-Agent': 'p00rija-panel' }, redirect: 'follow', signal: AbortSignal.timeout(30000) })).text()).trim().split(/\s+/)[0];
      if (!/^[0-9a-f]{64}$/.test(want) || want !== sha256Of(file)) {
        fs.rmSync(file, { force: true });
        throw new Error('the compose plugin does not match the sum its release publishes; not copied in');
      }
      line('  the compose plugin matches its published SHA-256');
      files.push(file);
    }
    return files;
  }

  async function copyIn(server, file, line) {
    const name = path.basename(file).replace(/^(x86_64|aarch64|armhf)-/, '').replace(/^docker-compose-.*/, 'docker-compose');
    const code = await run(['ssh', ...sshArgs(server.ssh), `mkdir -p ${REMOTE_FILES} && cat > ${REMOTE_FILES}/${name}`], { input: fs.createReadStream(file), line });
    if (code !== 0) throw new Error(`copying ${name} failed (${code})`);
    line(`  copied ${name}`);
  }

  /* Docker and the rest, installed where missing. */
  async function prepare(server, line, { sudoPassword = '' } = {}) {
    const region = regionOf(server.name);
    const args = region ? ['--region', region] : [];
    if (region === 'inside-iran') {
      const mirrors = registryMirrors();
      if (mirrors.length) args.push('--registry-mirrors', mirrors.join(' '));
    }
    line(`▶ ${server.name}: prerequisites${region === 'inside-iran' ? ' (through the mirrors inside Iran)' : ''}`);
    let lines = [];
    let code = await runScript(server, args, (text) => line(`  ${text}`), lines, sudoPassword);
    if (code === 3) {
      const facts = parseFacts(lines);
      line(`▶ This server reaches nothing that has Docker; the panel downloads ${facts.needs.join(', ')} itself and copies it in`);
      const files = await fetchFiles(facts.needs, facts.arch, line);
      for (const file of files) await copyIn(server, file, line);
      lines = [];
      code = await runScript(server, [...args, '--files', REMOTE_FILES], (text) => line(`  ${text}`), lines, sudoPassword);
      await run(['ssh', ...sshArgs(server.ssh), `rm -rf ${REMOTE_FILES}`], {});
    }
    if (code === 2) throw new Error('installing needs root on that server: log in as root, or tick “the user has sudo” and type its sudo password if it asks for one');
    if (code !== 0) throw new Error(`the prerequisites were not installed (exit ${code})`);
    line(`✓ ${server.name}: ready`);
    return parseFacts(lines);
  }

  return { check, prepare, access };
}
