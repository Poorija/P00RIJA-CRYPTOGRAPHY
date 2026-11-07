/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Build & package: a checkout of the app on this computer, named by its
 * folder, looked over and built for the servers, everything landing in that
 * same folder's dist/server/<version>/ (scripts/build-server-package.sh).
 *
 * The panel sees only the folders it was given (POORIJA_PANEL_SOURCES, which
 * scripts/panel.sh fills from --source; the checkout the panel runs from, when
 * it runs outside a container). A folder outside them is refused by name,
 * never looked for elsewhere.
 *
 * What a build can make: the signed update package (with the server images
 * and the archive of the tree, through updates.mjs), the Docker Hub images as
 * an archive, and the push to Docker Hub after a login made here. What it
 * made can be downloaded, and sent to servers: the update package through the
 * updates, an image archive copied in and loaded with `docker load`; a server
 * installed with docker-install.sh is then started on the new version. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { run } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const ARTIFACT = /^(p00rija-(server|images|dockerhub|update)-\d+\.\d+\.\d+(-(amd64|arm64))?\.tar(\.gz)?|SHA256SUMS|build\.json)$/;
const SYNC_DIRS = ['js', 'css', 'assets', 'fonts', 'vendor', 'scripts', 'config', 'docker'];

/* The folders this panel may read and build in. */
export function sourceRoots(env = process.env, here = HERE) {
  const roots = String(env.POORIJA_PANEL_SOURCES || '').split(/[:\n]/).map((entry) => entry.trim()).filter(Boolean);
  const own = path.resolve(here, '..', '..');
  if (fs.existsSync(path.join(own, 'scripts', 'server.js')) && fs.existsSync(path.join(own, '.git'))) roots.push(own);
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

/* A folder named in the page, if it is inside one of those. */
export function allowedFolder(folder, roots) {
  const value = String(folder || '').trim();
  if (!value || !path.isAbsolute(value) || value.includes('\0')) return null;
  const resolved = path.resolve(value);
  return roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`)) ? resolved : null;
}

function gitInfo(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return { commit: head.slice(0, 7), branch: '' };
    const ref = head.slice(5);
    let commit = '';
    try { commit = fs.readFileSync(path.join(dir, '.git', ref), 'utf8').trim(); } catch (_error) {
      const packed = fs.readFileSync(path.join(dir, '.git', 'packed-refs'), 'utf8');
      commit = (packed.split('\n').find((line) => line.endsWith(` ${ref}`)) || '').split(' ')[0];
    }
    return { commit: commit.slice(0, 7), branch: ref.replace(/^refs\/heads\//, '') };
  } catch (_error) {
    return { commit: '', branch: '' };
  }
}

function countFiles(dir, limit = 20000) {
  let count = 0;
  const walk = (at) => {
    if (count >= limit) return;
    let entries = [];
    try { entries = fs.readdirSync(at, { withFileTypes: true }); } catch (_error) { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.DS_Store') continue;
      if (entry.isDirectory()) walk(path.join(at, entry.name));
      else if (entry.isFile()) count += 1;
    }
  };
  walk(dir);
  return count;
}

/* What a folder is: a P00RIJA checkout or not, its version, and what was built in it. */
export function scanFolder(dir) {
  const out = { ok: true, folder: dir, tree: false, problems: [] };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ...out, ok: false, reason: 'no-folder' };
  const need = ['package.json', 'config/Dockerfile.chat-signal', 'scripts/server.js'];
  const missing = need.filter((entry) => !fs.existsSync(path.join(dir, entry)));
  if (missing.length) return { ...out, problems: missing.map((entry) => `missing:${entry}`) };
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch (_error) { out.problems.push('bad:package.json'); }
  out.tree = true;
  out.version = String(meta.version || '');
  out.buildTag = String(meta.buildTag || meta.version || '');
  if (!VERSION.test(out.version)) out.problems.push('no-version');
  out.script = fs.existsSync(path.join(dir, 'scripts', 'build-server-package.sh'));
  if (!out.script) out.problems.push('missing:scripts/build-server-package.sh');
  Object.assign(out, gitInfo(dir));
  out.files = Object.fromEntries(SYNC_DIRS.filter((entry) => fs.existsSync(path.join(dir, entry))).map((entry) => [entry, countFiles(path.join(dir, entry))]));
  out.builds = listBuilds(dir);
  return out;
}

/* dist/server/<version>/ in a checkout, newest first. */
export function listBuilds(dir) {
  const base = path.join(dir, 'dist', 'server');
  let versions = [];
  try { versions = fs.readdirSync(base).filter((name) => VERSION.test(name)); } catch (_error) { return []; }
  return versions.map((version) => {
    const at = path.join(base, version);
    let record = {};
    try { record = JSON.parse(fs.readFileSync(path.join(at, 'build.json'), 'utf8')); } catch (_error) { record = {}; }
    const files = fs.readdirSync(at).filter((name) => ARTIFACT.test(name) && !name.endsWith('.part')).map((name) => {
      const stat = fs.statSync(path.join(at, name));
      const kind = /-update-/.test(name) ? 'update' : /-dockerhub-/.test(name) ? 'dockerhub' : /-images-/.test(name) ? 'images' : /-server-/.test(name) ? 'archive' : 'meta';
      return { name, size: stat.size, kind, at: stat.mtime.toISOString() };
    });
    return { version, createdAt: String(record.createdAt || ''), commit: String(record.commit || ''), platform: String(record.platform || ''), files };
  }).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

/* What runs on a server after an image archive is copied in. */
export function shipScript(name, version) {
  const hub = /-dockerhub-/.test(name);
  return `set -e
f="$HOME/.p00rija-ship/${name}"
echo "▶ docker load"
docker load -i "$f" | tail -n 8
rm -f "$f"
dir=""
for candidate in /opt/p00rija "$HOME/p00rija"; do [ -f "$candidate/compose.yaml" ] && [ -f "$candidate/.env" ] && dir="$candidate" && break; done
if [ ${hub ? '1' : '0'} = 1 ] && [ -n "$dir" ]; then
  cd "$dir"
  cp -p .env ".env.bak-$(date +%Y%m%d%H%M%S)"
  if grep -q '^APP_VERSION=' .env; then sed -i 's/^APP_VERSION=.*/APP_VERSION=${version}/' .env; else printf 'APP_VERSION=${version}\\n' >> .env; fi
  echo "▶ $dir: starting ${version}"
  docker compose --env-file .env -f compose.yaml up -d
  echo "✓ running ${version}"
else
  echo "✓ the images are on this server; ${hub ? 'no docker-install.sh folder here to start them in' : 'the update package applies them'}"
fi
`;
}

export function createBuilds({ stateDir, servers, sshArgs, audit, startTask, confirmCode, sendJson, updates, env = process.env }) {
  const memoryFile = path.join(stateDir, 'builds.json');
  let building = false;
  const roots = () => sourceRoots(env);
  const remember = (folder) => { try { fs.writeFileSync(memoryFile, JSON.stringify({ folder }), { mode: 0o600 }); } catch (_error) { /* not kept */ } };
  const remembered = () => { try { return String(JSON.parse(fs.readFileSync(memoryFile, 'utf8')).folder || ''); } catch (_error) { return ''; } };
  const dockerReady = async () => (await run(['docker', 'info'], { quiet: true })) === 0;
  const dockerHubUser = () => {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.docker', 'config.json'), 'utf8'));
      return Object.keys(config.auths || {}).some((host) => /docker\.io|index\.docker\.io/.test(host)) ? (config.p00rijaUser || 'yes') : '';
    } catch (_error) { return ''; }
  };

  function folderOf(body, res) {
    const folder = allowedFolder(body.folder, roots());
    if (!folder) { sendJson(res, 400, { ok: false, reason: 'folder-not-shared', roots: roots() }); return null; }
    return folder;
  }

  async function build(folder, options, who, line) {
    if (building) throw new Error('a build is already running');
    building = true;
    try {
      const scan = scanFolder(folder);
      if (!scan.tree || !VERSION.test(scan.version || '')) throw new Error(`${folder} is not a P00RIJA checkout (${scan.problems.join(', ')})`);
      const out = path.join(folder, 'dist', 'server', scan.version);
      fs.mkdirSync(out, { recursive: true });
      line(`▶ ${folder}: ${scan.version}${scan.commit ? ` (commit ${scan.commit})` : ''}`);
      if (options.signed) {
        await updates.buildFromTree(folder, 'folder', line, { exportTo: out });
        line(`✓ the signed update package, the server images and the archive are in ${out}`);
      }
      const flags = [];
      if (options.archive && !options.signed) flags.push('--archive');
      if (options.images && !options.signed) flags.push('--images');
      if (options.dockerhub) flags.push('--dockerhub');
      if (options.push) flags.push('--push');
      if (flags.length) {
        const code = await run(['bash', path.join(folder, 'scripts', 'build-server-package.sh'), ...flags, '--out', out], { cwd: folder, line });
        if (code !== 0) throw new Error(`build-server-package.sh stopped (${code})`);
      } else if (!options.signed) {
        throw new Error('nothing was chosen to build');
      }
      audit(`${who.user} built ${scan.version} in ${folder} (${[options.signed && 'signed package', ...flags].filter(Boolean).join(' ')})`);
    } finally {
      building = false;
    }
  }

  async function ship(folder, version, name, names, who, line) {
    if (!VERSION.test(String(version)) || !ARTIFACT.test(String(name)) || !/-(images|dockerhub)-/.test(name)) throw new Error('not an image archive');
    const file = path.join(folder, 'dist', 'server', version, name);
    if (!fs.existsSync(file)) throw new Error('no such file');
    const chosen = servers().filter((server) => (names || []).includes(server.name) && server.ssh);
    if (!chosen.length) throw new Error('no server chosen');
    let failed = 0;
    for (const server of chosen) {
      line(`▶ ${server.name}: copying ${name} (${Math.round(fs.statSync(file).size / 1048576)} MB)`);
      const copied = await run(['ssh', ...sshArgs(server.ssh), `mkdir -p "$HOME/.p00rija-ship" && cat > "$HOME/.p00rija-ship/${name}.part" && mv "$HOME/.p00rija-ship/${name}.part" "$HOME/.p00rija-ship/${name}"`],
        { input: fs.createReadStream(file), line: (text) => line(`  ${text}`) });
      if (copied !== 0) { line(`  ✗ copying failed (${copied})`); failed += 1; continue; }
      const loaded = await run(['ssh', ...sshArgs(server.ssh), 'bash -s'], { input: Readable.from([shipScript(name, version)]), line: (text) => line(`  ${text}`) });
      if (loaded !== 0) { line(`  ✗ (${loaded})`); failed += 1; }
    }
    audit(`${who.user} sent ${name} to ${chosen.map((server) => server.name).join(' ')}${failed ? ` (${failed} failed)` : ''}`);
    if (failed) throw new Error(`${failed} of ${chosen.length} server(s) did not take it`);
  }

  async function get(req, res, url) {
    if (url.pathname === '/api/builds') {
      return sendJson(res, 200, { ok: true, roots: roots(), folder: remembered() || roots()[0] || '', canBuild: await dockerReady(), building, dockerHub: dockerHubUser() });
    }
    if (url.pathname === '/api/builds/file') {
      const folder = allowedFolder(url.searchParams.get('folder'), roots());
      const version = String(url.searchParams.get('version') || '');
      const name = String(url.searchParams.get('name') || '');
      if (!folder || !VERSION.test(version) || !ARTIFACT.test(name)) return sendJson(res, 404, { ok: false });
      const file = path.join(folder, 'dist', 'server', version, name);
      if (!fs.existsSync(file)) return sendJson(res, 404, { ok: false });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(fs.statSync(file).size), 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return undefined;
    }
    return sendJson(res, 404, { ok: false });
  }

  async function post(req, res, url, body, who) {
    if (url.pathname === '/api/builds/scan') {
      const folder = folderOf(body, res);
      if (!folder) return undefined;
      remember(folder);
      return sendJson(res, 200, scanFolder(folder));
    }
    if (!confirmCode(req, res, body.code)) return undefined;
    if (url.pathname === '/api/builds/run') {
      const folder = folderOf(body, res);
      if (!folder) return undefined;
      const options = { signed: body.signed === true, archive: body.archive === true, images: body.images === true, dockerhub: body.dockerhub === true, push: body.push === true };
      const job = startTask(`build in ${path.basename(folder)}`, (line) => build(folder, options, who, line));
      return sendJson(res, 200, { ok: true, job });
    }
    if (url.pathname === '/api/builds/ship') {
      const folder = folderOf(body, res);
      if (!folder) return undefined;
      const job = startTask(`send ${String(body.name || '')}`, (line) => ship(folder, String(body.version || ''), String(body.name || ''), body.servers, who, line));
      return sendJson(res, 200, { ok: true, job });
    }
    if (url.pathname === '/api/builds/keep') {
      /* An update package built in a folder, taken into the panel's own list. */
      const folder = folderOf(body, res);
      if (!folder) return undefined;
      const version = String(body.version || '');
      const file = VERSION.test(version) ? path.join(folder, 'dist', 'server', version, `p00rija-update-${version}.tar`) : '';
      if (!file || !fs.existsSync(file)) return sendJson(res, 404, { ok: false, reason: 'no-such-package' });
      const job = startTask(`keep update ${version}`, (line) => updates.keepFile(file, who, line));
      return sendJson(res, 200, { ok: true, job });
    }
    if (url.pathname === '/api/builds/dockerhub-login') {
      const username = String(body.username || '').trim();
      const token = String(body.token || '');
      if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(username) || !token || token.length > 300) return sendJson(res, 400, { ok: false, reason: 'bad-login' });
      const lines = [];
      const code = await run(['docker', 'login', '-u', username, '--password-stdin'], { input: Readable.from([token]), line: (text) => lines.push(text) });
      if (code === 0) {
        try {
          const file = path.join(os.homedir(), '.docker', 'config.json');
          const config = JSON.parse(fs.readFileSync(file, 'utf8'));
          fs.writeFileSync(file, JSON.stringify({ ...config, p00rijaUser: username }, null, 2), { mode: 0o600 });
        } catch (_error) { /* the login stands */ }
      }
      audit(`${who.user} Docker Hub login as ${username}: ${code === 0 ? 'ok' : 'refused'}`);
      return sendJson(res, code === 0 ? 200 : 400, { ok: code === 0, reason: code === 0 ? '' : 'login-refused', detail: lines.filter((text) => !/password/i.test(text)).slice(-2).join(' ').slice(0, 200) });
    }
    if (url.pathname === '/api/builds/dockerhub-logout') {
      await run(['docker', 'logout'], {});
      audit(`${who.user} Docker Hub logout`);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { ok: false });
  }

  return { get, post };
}
