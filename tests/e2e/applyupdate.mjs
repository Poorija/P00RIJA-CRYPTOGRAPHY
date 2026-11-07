/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* scripts/apply-update.sh: what a server does with a package once it is time
 * — the same as a deploy with --prebuilt, without the computer that deploys.
 * Here against a stand-in install folder and a stand-in docker: it checks the
 * members against the manifest before it touches anything, takes the
 * snapshot first, loads the images, puts the new tree in place (removing
 * what the new one no longer has) and leaves .env and data/ alone, then runs
 * the NEW tree's sync-to-server.sh --prebuilt.
 *
 *   node tests/e2e/applyupdate.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lib = require(path.join(ROOT, 'scripts/lib/update-package.js'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-apply-')));
const write = (file, text, mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, mode ? { mode } : undefined); };
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const OPERATOR = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const OTHER = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

/* An install as a server has it: the old tree, its .env and data. */
function install(name, { operatorKey = OPERATOR } = {}) {
  const dir = path.join(work, name);
  write(path.join(dir, '.env'), `MONITOR_PASSWORD=kept\nCHAT_OPERATOR_KEY=${operatorKey}\n`);
  write(path.join(dir, 'data/chat-signal/relay-identity.json'), '{"kept":true}');
  write(path.join(dir, 'package.json'), '{"version": "2.98.87"}\n');
  write(path.join(dir, 'js/old-only.js'), 'old');
  write(path.join(dir, 'js/app.js'), 'old app');
  write(path.join(dir, 'scripts/apply-update.sh'), fs.readFileSync(path.join(ROOT, 'scripts/apply-update.sh'), 'utf8'), 0o755);
  write(path.join(dir, 'scripts/server-backup.sh'), `#!/bin/bash\necho "snapshot $1: $(cat js/app.js)" >> "${dir}/calls.log"\n`, 0o755);
  return dir;
}
/* A package of a newer tree: its sync-to-server.sh says it ran. */
function makePackage(name, { version = '2.98.88', tamper = false, sourceVersion = version } = {}) {
  const tree = path.join(work, `${name}-tree`);
  write(path.join(tree, 'package.json'), `{"version": "${sourceVersion}"}\n`);
  write(path.join(tree, 'js/app.js'), 'new app');
  write(path.join(tree, 'js/new-only.js'), 'new');
  write(path.join(tree, 'index.html'), '<html>new</html>');
  write(path.join(tree, 'scripts/sync-to-server.sh'), `#!/bin/bash\necho "sync $* in $(pwd) app=$(cat js/app.js)" >> "$CALLS"\n`, 0o755);
  write(path.join(tree, 'scripts/apply-update.sh'), '#!/bin/bash\n# the new one\n', 0o755);
  const src = path.join(work, `${name}-source.tar.gz`);
  spawnSync('tar', ['czf', src, '-C', tree, '.']);
  const images = path.join(work, `${name}-images.tar.gz`);
  fs.writeFileSync(images, crypto.randomBytes(5000));
  const members = { 'source.tar.gz': src, 'images.tar.gz': images };
  const manifest = lib.buildManifest({ version, buildTag: `${version}-chat-v180`, source: 'folder', members, images: [`poorija-crypto:${version}`] });
  const file = path.join(work, `${name}.tar`);
  lib.writePackage(file, { manifest, sig: lib.signManifest(manifest, privateKey.export({ type: 'pkcs8', format: 'pem' })), members });
  /* The record a check leaves: the whole file's hash, which the server
     compares before it unpacks anything. */
  fs.writeFileSync(`${file}.sha256`, `${lib.hashRange(file, 0, fs.statSync(file).size)}\n`);
  if (tamper) {
    const member = lib.readTarIndex(file).find((entry) => entry.name === 'images.tar.gz');
    const fd = fs.openSync(file, 'r+');
    fs.writeSync(fd, Buffer.from([0x42]), 0, 1, member.offset + 10);
    fs.closeSync(fd);
  }
  return file;
}
const fakeDocker = path.join(work, 'bin');
write(path.join(fakeDocker, 'docker'), `#!/bin/sh\necho "docker $*" >> "$CALLS"\nexit 0\n`, 0o755);
const apply = (dir, pkg) => spawnSync('bash', [path.join(dir, 'scripts/apply-update.sh'), pkg], {
  cwd: dir, encoding: 'utf8', timeout: 60000,
  env: { ...process.env, PATH: `${fakeDocker}:${process.env.PATH}`, CALLS: path.join(dir, 'calls.log') },
});
const calls = (dir) => (fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8') : '');

try {
  check('the script exists and parses', spawnSync('bash', ['-n', path.join(ROOT, 'scripts/apply-update.sh')]).status === 0);
  const a = install('a');
  const run = apply(a, makePackage('good'));
  const log = calls(a);
  check('a sound package is applied', run.status === 0, (run.stdout + run.stderr).slice(-400));
  check('the snapshot is taken first, of the old tree', /^snapshot .*: old app$/m.test(log) && log.indexOf('snapshot') < log.indexOf('docker load'), log.replace(/\n/g, ' | '));
  check('the images are loaded', /docker load -i \S+images\.tar\.gz/.test(log), log.replace(/\n/g, ' | '));
  check('the new tree is in place, and what it no longer has is gone', fs.readFileSync(path.join(a, 'js/app.js'), 'utf8') === 'new app'
    && fs.existsSync(path.join(a, 'js/new-only.js')) && !fs.existsSync(path.join(a, 'js/old-only.js')) && fs.readFileSync(path.join(a, 'index.html'), 'utf8').includes('new'));
  check('.env and data/ are left as they were', fs.readFileSync(path.join(a, '.env'), 'utf8').startsWith('MONITOR_PASSWORD=kept\n') && fs.existsSync(path.join(a, 'data/chat-signal/relay-identity.json')));
  check('then the new tree’s own sync-to-server.sh runs, with the images given', new RegExp(`^sync --skip-bump --prebuilt in ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} app=new app$`, 'm').test(log), log.replace(/\n/g, ' | '));
  check('nothing of the work is left in the install', !fs.readdirSync(a).some((entry) => entry.startsWith('.update')));

  const b = install('b');
  const bad = apply(b, makePackage('tampered', { tamper: true }));
  check('a member that is not the one the manifest names stops it before anything is touched',
    bad.status !== 0 && fs.readFileSync(path.join(b, 'js/app.js'), 'utf8') === 'old app' && !calls(b), `${bad.status} ${(bad.stderr || '').slice(-200)}`);
  const c = install('c');
  const mismatch = apply(c, makePackage('mismatch', { sourceVersion: '1.0.0' }));
  check('so does a tree whose own version is not the package’s', mismatch.status !== 0 && fs.readFileSync(path.join(c, 'js/app.js'), 'utf8') === 'old app', `${mismatch.status} ${(mismatch.stderr || '').slice(-200)}`);
  const e = install('e');
  const older = apply(e, makePackage('older', { version: '2.98.80' }));
  check('an older signed package is never applied over a newer install', older.status !== 0 && fs.readFileSync(path.join(e, 'js/app.js'), 'utf8') === 'old app' && !calls(e), `${older.status} ${(older.stderr || '').slice(-200)}`);
  const f = install('f');
  const unchecked = makePackage('unchecked');
  fs.rmSync(`${unchecked}.sha256`);
  const noRecord = apply(f, unchecked);
  check('nor one with no record of having been checked', noRecord.status !== 0 && !calls(f), `${noRecord.status} ${(noRecord.stderr || '').slice(-200)}`);
  const g = install('g');
  const swapped = makePackage('swapped');
  fs.appendFileSync(swapped, Buffer.alloc(512, 0));
  const changedAfter = apply(g, swapped);
  check('nor one changed after it was checked', changedAfter.status !== 0 && !calls(g), `${changedAfter.status} ${(changedAfter.stderr || '').slice(-200)}`);
  const h = install('h', { operatorKey: OTHER });
  const foreign = apply(h, makePackage('foreign'));
  check('the operator’s signature is checked here again, against the key this server trusts', foreign.status !== 0 && !calls(h) && /signature/i.test(foreign.stderr), `${foreign.status} ${(foreign.stderr || '').slice(-200)}`);
  const d = install('d');
  const missing = apply(d, path.join(work, 'nothing.tar'));
  check('and a package that is not there', missing.status !== 0 && !calls(d));
} catch (error) {
  check('the suite ran to the end', false, error?.stack?.split('\n').slice(0, 3).join(' ') || String(error));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
