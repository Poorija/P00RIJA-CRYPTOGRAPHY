/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Server updates, from the panel's System section.
 *
 * WHERE A RELEASE COMES FROM: a folder of the tree (the page sends it as a
 * tar), an archive of it (.tar, .tar.gz, .zip — the source tarball of a
 * GitHub release, say), a package made earlier, or the latest GitHub release
 * itself. A tree is built here, once, the way `deploy.sh --prebuilt` builds
 * it: the three images for linux/amd64 with this computer's Docker, and the
 * part of the tree a deploy copies. The operator key signs the package
 * (scripts/lib/update-package.js); a package uploaded as it is is kept only
 * if the operator key signed it.
 *
 * WHERE IT GOES: copied in over SSH to the servers chosen. A server whose
 * relay keeps updates (scripts/lib/relay-updates.js) is handed it with the
 * time to apply it, signed so it may travel along the family, and passes it
 * on; the others reach it through the chain. A server too old to have an
 * updater is updated there and then by the package's own apply-update.sh,
 * with the hash of the file this panel checked written beside it. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { run } from './run.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkgLib = require('../../scripts/lib/update-package.js');
const { signPolicy } = require('../../scripts/lib/relay-updates.js');

const SYNC_DIRS = ['js', 'css', 'assets', 'fonts', 'vendor', 'scripts', 'config', 'tests'];
const SYNC_FILES = ['index.html', 'sw.js', 'manifest.webmanifest', 'monitor-client.html', 'package.json'];
const IMAGES = [['poorija-crypto', 'config/Dockerfile'], ['poorija-chat-signal', 'config/Dockerfile.chat-signal'], ['poorija-cert-renewer', 'config/Dockerfile.cert-renewer']];
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const MAX_UPLOAD = 2 * 1024 * 1024 * 1024;
const GITHUB_REPO = 'Poorija/P00RIJA-Cryptography';
const KEEP_PACKAGES = 3;

const fileKind = (file) => {
  const head = Buffer.alloc(512);
  const fd = fs.openSync(file, 'r');
  const read = fs.readSync(fd, head, 0, 512, 0);
  fs.closeSync(fd);
  if (read >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'tar.gz';
  if (read >= 4 && head.readUInt32LE(0) === 0x04034b50) return 'zip';
  if (read >= 262 && head.toString('ascii', 257, 262) === 'ustar') return 'tar';
  return 'unknown';
};

/* A time to apply, signed so it may travel along the family — only for a
   version whose package this panel holds (built or kept here): the version
   is the operator's word, never a relay's, and the key signs nothing else.
   A canary is picked by server name and signed in as that server's verified
   relay id (scripts/lib/relay-updates.js waits the others for it), with the
   minutes it must stay healthy. */
export function policySignerFor({ packageExists, operatorKey, relayIdOf = () => '' }) {
  return (policy, version) => {
    const mode = ['watch', 'schedule', 'now'].includes(policy?.mode) ? policy.mode : 'watch';
    const at = mode === 'schedule' && Number.isFinite(Date.parse(String(policy?.at || ''))) ? new Date(Date.parse(policy.at)).toISOString() : null;
    if (mode === 'schedule' && !at) return { mode: 'watch', at: null };
    let staged = {};
    if (policy?.canary) {
      const canary = String(relayIdOf(String(policy.canary)) || '');
      if (!/^[0-9a-f]{64}$/.test(canary)) throw new Error(`${policy.canary} has not shown a verified relay identity, so it cannot be the canary`);
      const hold = Math.round(Number(policy.holdMin));
      staged = { canary, holdMin: Number.isFinite(hold) && hold > 0 ? Math.min(1440, Math.max(5, hold)) : 30 };
    }
    const key = operatorKey();
    if (!key || !VERSION.test(String(version || '')) || !packageExists(String(version))) return { mode, at, ...staged };
    return { mode, at, ...staged, sig: signPolicy({ version, mode, at, ...staged }, key.privateKey) };
  };
}

export function createUpdates({ stateDir, configDir, servers, serverRequest, sshArgs, audit, startTask, confirmCode, sendJson }) {
  const root = path.join(stateDir, 'updates');
  const uploadsDir = path.join(root, 'uploads');
  const packagesDir = path.join(root, 'packages');
  const workRoot = path.join(root, 'work');
  for (const dir of [root, uploadsDir, packagesDir, workRoot]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let building = false;
  /* Which version this panel sent to which server: a time is signed only for
     one of these, so what a relay reports never decides what is signed. */
  const sentFile = path.join(root, 'sent.json');
  const sentRecord = () => { try { return JSON.parse(fs.readFileSync(sentFile, 'utf8')) || {}; } catch (_error) { return {}; } };
  const noteSent = (version, name) => {
    const record = sentRecord();
    record[version] = [...new Set([...(record[version] || []), name])];
    fs.writeFileSync(sentFile, JSON.stringify(record), { mode: 0o600 });
  };

  function operatorKey() {
    try {
      const key = JSON.parse(fs.readFileSync(path.join(configDir(), 'operator-key.json'), 'utf8'));
      return key?.publicKey && key?.privateKey ? key : null;
    } catch (_error) {
      return null;
    }
  }
  const dockerReady = async () => (await run(['docker', 'info'], { quiet: true })) === 0;
  const packageFile = (version) => path.join(packagesDir, `p00rija-update-${version}.tar`);

  function packages() {
    return fs.readdirSync(packagesDir)
      .filter((name) => /^p00rija-update-\d+\.\d+\.\d+\.tar$/.test(name))
      .map((name) => {
        const file = path.join(packagesDir, name);
        let manifest = null;
        try {
          const member = pkgLib.readTarIndex(file).find((entry) => entry.name === 'manifest.json');
          manifest = JSON.parse(pkgLib.readMember(file, member, 64 * 1024).toString('utf8'));
        } catch (_error) { /* listed without its manifest */ }
        return { version: manifest?.version || name.slice(15, -4), size: fs.statSync(file).size, createdAt: manifest?.createdAt || '', source: manifest?.source || '', buildTag: manifest?.buildTag || '' };
      })
      .sort((a, b) => pkgLib.compareVersions(b.version, a.version));
  }

  /* Kept with the hash of the whole file beside it, which a server's
     apply-update.sh checks before it unpacks anything. */
  function keep(file, version) {
    const target = packageFile(version);
    fs.copyFileSync(file, `${target}.part`);
    fs.renameSync(`${target}.part`, target);
    fs.writeFileSync(`${target}.sha256`, `${pkgLib.hashRange(target, 0, fs.statSync(target).size)}\n`);
    for (const old of packages().slice(KEEP_PACKAGES)) {
      for (const suffix of ['', '.sha256']) { try { fs.unlinkSync(`${packageFile(old.version)}${suffix}`); } catch (_error) { /* gone */ } }
    }
    return target;
  }

  /* ---- the upload ---------------------------------------------------------- */

  async function upload(req, res, url, who) {
    const kind = url.searchParams.get('kind') === 'folder' ? 'folder' : 'archive';
    const name = String(url.searchParams.get('name') || 'upload').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    const id = crypto.randomBytes(8).toString('hex');
    const file = path.join(uploadsDir, `${id}.bin`);
    const out = fs.createWriteStream(file, { mode: 0o600, flags: 'wx' });
    let size = 0;
    let tooLarge = false;
    await new Promise((resolve) => {
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_UPLOAD && !tooLarge) { tooLarge = true; req.unpipe(out); out.destroy(); req.resume(); }
      });
      req.pipe(out);
      out.on('finish', resolve);
      out.on('close', resolve);
      req.on('error', resolve);
    });
    if (tooLarge) { try { fs.unlinkSync(file); } catch (_error) { /* gone */ } return sendJson(res, 413, { ok: false, reason: 'too-large' }); }
    fs.writeFileSync(path.join(uploadsDir, `${id}.json`), JSON.stringify({ id, kind, name, size, at: new Date().toISOString(), user: who.user }));
    /* The last few uploads only: each may be a tree of tens of megabytes. */
    const metas = fs.readdirSync(uploadsDir).filter((entry) => entry.endsWith('.json'))
      .map((entry) => { try { return JSON.parse(fs.readFileSync(path.join(uploadsDir, entry), 'utf8')); } catch (_error) { return null; } })
      .filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    for (const old of metas.slice(5)) for (const suffix of ['.bin', '.json']) { try { fs.unlinkSync(path.join(uploadsDir, `${old.id}${suffix}`)); } catch (_error) { /* gone */ } }
    audit(`${who.user} uploaded an update ${kind} (${name}, ${size} bytes)`);
    return sendJson(res, 200, { ok: true, id, size });
  }

  /* ---- GitHub ---------------------------------------------------------------- */

  async function latestRelease() {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'p00rija-panel' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = await response.json();
    const version = String(release?.tag_name || '').replace(/^v/i, '');
    if (!VERSION.test(version)) throw new Error('the latest release names no version');
    const assets = (release.assets || []).map((asset) => ({ name: String(asset.name || ''), url: String(asset.browser_download_url || '') }));
    return { version, page: String(release.html_url || ''), source: assets.find((asset) => /-source\.tar\.gz$/i.test(asset.name)), sums: assets.find((asset) => /^SHA256SUMS(\.txt)?$/i.test(asset.name)) };
  }

  async function download(url, to, line) {
    const response = await fetch(url, { headers: { 'User-Agent': 'p00rija-panel' }, redirect: 'follow', signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
    const out = fs.createWriteStream(to, { mode: 0o600 });
    let got = 0;
    let said = 0;
    for await (const chunk of response.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
      if (got - said > 5 * 1024 * 1024) { said = got; line(`  ${Math.round(got / 1048576)} MB`); }
    }
    await new Promise((resolve) => out.end(resolve));
  }

  /* ---- building ------------------------------------------------------------- */

  /* Every entry is looked at before anything is unpacked: one that climbs out
     of the folder (..) or starts at / is refused, whatever tar would make of it. */
  async function unpack(file, into, line) {
    const kind = fileKind(file);
    const listing = [];
    const lister = kind === 'zip' ? ['unzip', '-Z1', file] : kind === 'tar.gz' ? ['tar', 'tzf', file] : kind === 'tar' ? ['tar', 'tf', file] : null;
    if (!lister) throw new Error('not a .tar, .tar.gz or .zip');
    if (await run(lister, { line: (entry) => listing.push(entry) }) !== 0) throw new Error('the archive does not list');
    const climbing = listing.find((entry) => entry.startsWith('/') || entry.split('/').includes('..'));
    if (climbing) throw new Error(`the archive holds a path outside its folder (${climbing.slice(0, 120)}); nothing was unpacked`);
    fs.mkdirSync(into, { recursive: true });
    const unpacker = kind === 'zip' ? ['unzip', '-q', file, '-d', into] : ['tar', kind === 'tar.gz' ? 'xzf' : 'xf', file, '-C', into];
    if (await run(unpacker, { line }) !== 0) throw new Error('the archive did not unpack');
  }

  function findTree(dir, depth = 0) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'config', 'Dockerfile.chat-signal'))) return dir;
    if (depth >= 3) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const found = findTree(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
    return null;
  }

  async function buildTree(tree, source, work, line, { exportTo = '' } = {}) {
    const meta = JSON.parse(fs.readFileSync(path.join(tree, 'package.json'), 'utf8'));
    const version = String(meta.version || '');
    const buildTag = String(meta.buildTag || version);
    if (!VERSION.test(version) || !/^[0-9A-Za-z.-]{1,60}$/.test(buildTag)) throw new Error('the tree’s package.json names no version');
    const key = operatorKey();
    if (!key) throw new Error('there is no operator key on this computer to sign with');
    if (!await dockerReady()) throw new Error('this computer’s Docker cannot be reached from the panel (start it with: bash scripts/panel.sh --builds yes)');
    line(`▶ Building ${version} for the servers (linux/amd64), once`);
    for (const [name, dockerfile] of IMAGES) {
      line(`  ${name}:${version}`);
      const code = await run(['docker', 'buildx', 'build', '--platform', 'linux/amd64', '--pull', '--provenance=false', '--sbom=false',
        '-f', path.join(tree, dockerfile), '-t', `${name}:${version}`, '--load', tree], { line: (text) => { if (/error|ERROR|failed/.test(text)) line(`    ${text}`); } });
      if (code !== 0) throw new Error(`building ${name} failed`);
    }
    line('▶ Saving the images');
    const images = path.join(work, 'images.tar.gz');
    const gzip = zlib.createGzip({ level: 1 });
    const out = fs.createWriteStream(images, { mode: 0o600 });
    gzip.pipe(out);
    const saved = await run(['docker', 'save', ...IMAGES.map(([name]) => `${name}:${version}`)], { line, stdout: gzip });
    await new Promise((resolve) => out.on('close', resolve));
    if (saved !== 0) throw new Error('saving the images failed');
    line('▶ The tree a deploy copies');
    const sourceFile = path.join(work, 'source.tar.gz');
    const parts = [...SYNC_DIRS, ...SYNC_FILES].filter((entry) => fs.existsSync(path.join(tree, entry)));
    if (await run(['tar', 'czf', sourceFile, '--exclude=node_modules', '--exclude=.DS_Store', '-C', tree, ...parts], { line }) !== 0) throw new Error('packing the tree failed');
    const members = { 'source.tar.gz': sourceFile, 'images.tar.gz': images };
    const manifest = pkgLib.buildManifest({ version, buildTag, source, members, images: IMAGES.map(([name]) => `${name}:${version}`) });
    const sig = pkgLib.signManifest(manifest, key.privateKey);
    const made = path.join(work, 'package.tar');
    pkgLib.writePackage(made, { manifest, sig, members });
    if (!pkgLib.verifyPackage(made, key.publicKey).ok) throw new Error('the package did not verify after signing');
    keep(made, version);
    line(`✓ p00rija-update-${version}.tar, signed by the operator key (${Math.round(fs.statSync(packageFile(version)).size / 1048576)} MB)`);
    if (exportTo) exportBuild(exportTo, { version, buildTag, source, images, sourceFile, made });
    return version;
  }

  /* What a build in a checkout made, also kept in that checkout's
     dist/server/<version>/ (Build & package), with its sums and record. */
  function exportBuild(out, { version, buildTag, source, images, sourceFile, made }) {
    fs.mkdirSync(out, { recursive: true });
    const copies = [[made, `p00rija-update-${version}.tar`], [images, `p00rija-images-${version}-amd64.tar.gz`], [sourceFile, `p00rija-server-${version}.tar.gz`]];
    for (const [from, name] of copies) {
      fs.copyFileSync(from, path.join(out, `${name}.part`));
      fs.renameSync(path.join(out, `${name}.part`), path.join(out, name));
    }
    const sums = fs.readdirSync(out).filter((name) => /^p00rija-.*\.tar(\.gz)?$/.test(name)).sort()
      .map((name) => `${pkgLib.hashRange(path.join(out, name), 0, fs.statSync(path.join(out, name)).size)}  ${name}`);
    fs.writeFileSync(path.join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
    let record = {};
    try { record = JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')); } catch (_error) { record = {}; }
    const madeNames = [...new Set([...(Array.isArray(record.made) ? record.made : []), ...copies.map(([, name]) => name)])];
    fs.writeFileSync(path.join(out, 'build.json'), `${JSON.stringify({ ...record, version, buildTag, platform: 'linux/amd64', source, createdAt: new Date().toISOString(), made: madeNames }, null, 2)}\n`);
  }

  /* A checkout on this computer, built as it is (Build & package). */
  async function buildFromTree(tree, source, line, options = {}) {
    if (building) throw new Error('a build is already running');
    building = true;
    const work = fs.mkdtempSync(path.join(workRoot, 'build-'));
    try {
      return await buildTree(tree, source, work, line, options);
    } finally {
      building = false;
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  /* A package file on this computer, kept if the operator key signed it. */
  async function keepFile(file, who, line) {
    const key = operatorKey();
    if (!key) throw new Error('there is no operator key on this computer to check it with');
    const verdict = pkgLib.verifyPackage(file, key.publicKey);
    if (!verdict.ok) throw new Error(`the package was refused: ${verdict.reason}`);
    keep(file, verdict.manifest.version);
    line(`✓ p00rija-update-${verdict.manifest.version}.tar is in the panel's packages`);
    audit(`${who.user} kept an update package ${verdict.manifest.version} from a checkout`);
    return verdict.manifest.version;
  }

  async function build({ upload: id, github }, who, line) {
    if (building) throw new Error('a build is already running');
    building = true;
    const work = fs.mkdtempSync(path.join(workRoot, 'build-'));
    try {
      let file;
      let source;
      if (github) {
        const release = await latestRelease();
        if (!release.source) throw new Error(`release ${release.version} has no source tarball`);
        line(`▶ GitHub: ${release.version}`);
        file = path.join(work, 'github-source.tar.gz');
        await download(release.source.url, file, line);
        if (release.sums) {
          const sums = path.join(work, 'SHA256SUMS.txt');
          await download(release.sums.url, sums, () => {});
          const want = fs.readFileSync(sums, 'utf8').split('\n').map((entry) => entry.trim().split(/\s+/)).find(([, name]) => name?.replace(/^\*/, '') === release.source.name)?.[0];
          if (!want || want !== pkgLib.hashRange(file, 0, fs.statSync(file).size)) throw new Error('the source tarball is not the one SHA256SUMS names');
          line('  the source tarball matches SHA256SUMS');
        }
        source = 'github';
      } else {
        if (!/^[0-9a-f]{16}$/.test(String(id || ''))) throw new Error('no such upload');
        file = path.join(uploadsDir, `${id}.bin`);
        if (!fs.existsSync(file)) throw new Error('no such upload');
        source = JSON.parse(fs.readFileSync(path.join(uploadsDir, `${id}.json`), 'utf8')).kind;
      }
      /* A package as it is: kept only if the operator signed it. */
      if (fileKind(file) === 'tar') {
        let index = null;
        try { index = pkgLib.readTarIndex(file); } catch (_error) { index = null; }
        if (index?.[0]?.name === 'manifest.json') {
          const key = operatorKey();
          if (!key) throw new Error('there is no operator key on this computer to check it with');
          const verdict = pkgLib.verifyPackage(file, key.publicKey);
          if (!verdict.ok) throw new Error(`the package was refused: ${verdict.reason}`);
          keep(file, verdict.manifest.version);
          line(`✓ p00rija-update-${verdict.manifest.version}.tar kept as it is: the operator key signed it`);
          audit(`${who.user} kept an update package ${verdict.manifest.version}`);
          return verdict.manifest.version;
        }
      }
      line('▶ Unpacking');
      await unpack(file, path.join(work, 'tree'), line);
      const tree = findTree(path.join(work, 'tree'));
      if (!tree) throw new Error('no P00RIJA tree in it (a folder with package.json and config/Dockerfile.chat-signal)');
      const version = await buildTree(tree, source, work, line);
      audit(`${who.user} built an update package ${version} (${source})`);
      return version;
    } finally {
      building = false;
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  /* ---- sending ------------------------------------------------------------- */

  const quoteDir = (dir) => String(dir || '~/work/pkg').replace(/[^A-Za-z0-9._~/-]/g, '');

  function bootstrapScript(dir, name, sha) {
    return `set -e
cd ${quoteDir(dir)}
pkg="data/chat-signal/updates/incoming/${name}"
printf '%s\\n' '${sha}' > "$pkg.sha256"
tmp="$(mktemp -d)"
tar xOf "$pkg" source.tar.gz | tar xzf - -C "$tmp" scripts/apply-update.sh
cp "$tmp/scripts/apply-update.sh" scripts/apply-update.sh
rm -rf "$tmp"
bash scripts/apply-update.sh "$pkg"
`;
  }

  const signedPolicy = policySignerFor({
    packageExists: (version) => fs.existsSync(packageFile(version)), operatorKey,
    relayIdOf: (name) => servers().find((server) => server.name === name)?.relayId || '',
  });

  async function send({ version, servers: names, policy }, who, line) {
    if (!VERSION.test(String(version || ''))) throw new Error('no such package');
    const file = packageFile(version);
    if (!fs.existsSync(file)) throw new Error('no such package');
    const sha = pkgLib.hashRange(file, 0, fs.statSync(file).size);
    const name = path.basename(file);
    const chosen = servers().filter((server) => (names || []).includes(server.name));
    if (!chosen.length) throw new Error('no server chosen');
    /* Signed once, before anything is copied: a canary that cannot be named
       stops the send here. The canary goes first. */
    const signed = signedPolicy(policy, version);
    if (policy?.canary) chosen.sort((x, y) => Number(y.name === policy.canary) - Number(x.name === policy.canary));
    let failed = 0;
    for (const server of chosen) {
      line(`▶ ${server.name}`);
      const dir = quoteDir(server.ssh.dir);
      const incoming = `${dir}/data/chat-signal/updates/incoming`;
      const copied = await run(['ssh', ...sshArgs(server.ssh), `bash -c 'mkdir -p ${incoming} && cat > ${incoming}/${name}.part && mv ${incoming}/${name}.part ${incoming}/${name}'`],
        { line: (text) => line(`  ${text}`), input: fs.createReadStream(file) });
      if (copied !== 0) { line(`  ✗ copying failed (${copied})`); failed += 1; continue; }
      line(`  copied (${Math.round(fs.statSync(file).size / 1048576)} MB)`);
      noteSent(version, server.name);
      const status = await serverRequest(server, '/Monitor_Server/updates').catch(() => ({ status: 0 }));
      if (status?.status === 200) {
        const staged = await serverRequest(server, '/Monitor_Server/updates/stage', { method: 'POST', body: { file: name, policy: signed }, timeout: 10 * 60 * 1000 });
        if (staged?.status === 200 && staged.json?.ok) {
          const canaryNote = !policy?.canary ? '' : policy.canary === server.name ? ' (the canary)' : `, once the canary ${policy.canary} has been healthy for ${signed.holdMin} min`;
          line(`  ✓ kept by its relay; applied ${policy?.mode === 'schedule' ? `at ${policy.at}` : policy?.mode === 'now' ? 'now' : 'when the fewest people are on'}${canaryNote}`);
        }
        else { line(`  ✗ its relay refused it: ${staged?.json?.reason || staged?.status}`); failed += 1; }
        continue;
      }
      /* No updater there yet: updated now, by the package's own script. */
      line('  no updater on this server yet: updating it now over SSH');
      const applied = await run(['ssh', ...sshArgs(server.ssh), 'bash -s'], {
        line: (text) => line(`  ${text}`),
        input: require('stream').Readable.from([bootstrapScript(dir, name, sha)]),
      });
      if (applied === 0) line('  ✓ updated'); else { line(`  ✗ the update failed (${applied}); the server keeps a snapshot from before it`); failed += 1; }
    }
    audit(`${who.user} send update ${version} to ${chosen.map((server) => server.name).join(' ')}${failed ? ` (${failed} failed)` : ''}`);
    if (failed) throw new Error(`${failed} of ${chosen.length} server(s) did not take it`);
  }

  async function relayCall(names, route, body, who, label) {
    const out = [];
    for (const server of servers().filter((candidate) => (names || []).includes(candidate.name))) {
      const answer = await serverRequest(server, route, { method: 'POST', body: typeof body === 'function' ? await body(server) : body }).catch(() => ({ status: 0 }));
      out.push({ server: server.name, ok: answer?.status === 200 && answer.json?.ok !== false, reason: answer?.json?.reason || (answer?.status === 404 ? 'no-updater' : '') });
    }
    audit(`${who.user} ${label} on ${out.map((entry) => entry.server).join(' ')}`);
    return out;
  }

  /* ---- routes ---------------------------------------------------------------- */

  async function get(req, res, url) {
    if (url.pathname === '/api/updates') {
      return sendJson(res, 200, { ok: true, canBuild: await dockerReady(), operatorKey: Boolean(operatorKey()), packages: packages(), building });
    }
    if (url.pathname === '/api/updates/servers') {
      const rows = await Promise.all(servers().map(async (server) => {
        const answer = await serverRequest(server, '/Monitor_Server/updates').catch(() => ({ status: 0 }));
        return { name: server.name, updater: answer?.status === 200, status: answer?.status === 200 ? answer.json : null, reason: answer?.status === 404 ? 'no-updater' : answer?.status ? '' : 'unreachable' };
      }));
      return sendJson(res, 200, { ok: true, servers: rows });
    }
    if (url.pathname === '/api/updates/package') {
      const version = String(url.searchParams.get('version') || '');
      const file = VERSION.test(version) ? packageFile(version) : '';
      if (!file || !fs.existsSync(file)) return sendJson(res, 404, { ok: false });
      res.writeHead(200, { 'Content-Type': 'application/x-tar', 'Content-Length': String(fs.statSync(file).size), 'Content-Disposition': `attachment; filename="${path.basename(file)}"`, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return undefined;
    }
    return sendJson(res, 404, { ok: false });
  }

  async function post(req, res, url, body, who) {
    if (url.pathname === '/api/updates/github') {
      try { return sendJson(res, 200, { ok: true, ...(await latestRelease()) }); } catch (error) { return sendJson(res, 502, { ok: false, reason: 'github', detail: error.message }); }
    }
    if (!confirmCode(req, res, body.code)) return undefined;
    if (url.pathname === '/api/updates/build') {
      const job = startTask('build update package', (line) => build(body, who, line));
      return sendJson(res, 200, { ok: true, job });
    }
    if (url.pathname === '/api/updates/send') {
      if (body.policy?.canary && !(body.servers || []).includes(body.policy.canary)) return sendJson(res, 400, { ok: false, reason: 'canary-not-chosen' });
      const job = startTask(`send update ${String(body.version || '')}`, (line) => send(body, who, line));
      return sendJson(res, 200, { ok: true, job });
    }
    if (url.pathname === '/api/updates/policy') {
      /* The version comes from the operator's page and is signed only if this
         panel holds its package; what a relay says it holds is never signed. */
      const version = String(body.version || '');
      const sentTo = sentRecord()[version] || [];
      const allSent = (body.servers || []).length > 0 && (body.servers || []).every((name) => sentTo.includes(name));
      let policy;
      try {
        policy = allSent ? signedPolicy(body.policy, version) : { ...signedPolicy(body.policy, ''), sig: undefined };
      } catch (error) {
        return sendJson(res, 400, { ok: false, reason: error.message });
      }
      const results = await relayCall(body.servers, '/Monitor_Server/updates/policy', policy, who, `update time ${body.policy?.mode || ''}${allSent ? ' (signed)' : ''}`);
      return sendJson(res, 200, { ok: true, results });
    }
    if (url.pathname === '/api/updates/cancel') {
      return sendJson(res, 200, { ok: true, results: await relayCall(body.servers, '/Monitor_Server/updates/cancel', {}, who, 'update cancelled') });
    }
    return sendJson(res, 404, { ok: false });
  }

  return { upload, get, post, buildFromTree, keepFile, send };
}
