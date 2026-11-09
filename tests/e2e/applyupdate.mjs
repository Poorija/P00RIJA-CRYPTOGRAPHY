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
 * the NEW tree's sync-to-server.sh --prebuilt. Then it watches the relay
 * (/chat-health through nginx: answering, serving the new version, not
 * restarting, linked to its family again if it was before) and, when the
 * update fails after the tree was touched, puts the old tree back and runs
 * the OLD tree's sync-to-server.sh: exit 3, or 4 when that fails too.
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
  write(path.join(dir, 'scripts/server-backup.sh'), `#!/bin/bash\necho "snapshot $1: $(cat js/app.js) of \${POORIJA_SOURCE_DIR:-unset}" >> "${dir}/calls.log"\n`, 0o755);
  /* The old tree's own way of bringing the stack up, for the way back: the
     relay it starts serves the old version. */
  write(path.join(dir, 'scripts/sync-to-server.sh'), `#!/bin/bash\necho "sync-old $* app=$(cat js/app.js)" >> "$CALLS"\nprintf '%s' "$OLD_HEALTH" > "$HEALTH"\nexit \${OLD_SYNC_EXIT:-0}\n`, 0o755);
  /* What the running relay answers before the update. */
  write(path.join(dir, 'health.json'), health('2.98.87', 2));
  return dir;
}
function health(version, up = 1) {
  return JSON.stringify({ ok: true, service: 'poorija-chat-signal', version, transit: { enabled: true, allowed: 3, up, hybrid: up } });
}
/* A package of a newer tree: its sync-to-server.sh says it ran. */
function makePackage(name, { version = '2.98.88', tamper = false, sourceVersion = version } = {}) {
  const tree = path.join(work, `${name}-tree`);
  write(path.join(tree, 'package.json'), `{"version": "${sourceVersion}"}\n`);
  write(path.join(tree, 'js/app.js'), 'new app');
  write(path.join(tree, 'js/new-only.js'), 'new');
  write(path.join(tree, 'index.html'), '<html>new</html>');
  write(path.join(tree, 'scripts/sync-to-server.sh'), `#!/bin/bash\necho "sync $* in $(pwd) app=$(cat js/app.js)" >> "$CALLS"\nprintf '%s' "$NEW_HEALTH" > "$HEALTH"\nexit \${NEW_SYNC_EXIT:-0}\n`, 0o755);
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
/* docker: `inspect` answers the relay container's restart count and start
   time, one line of $MARKS per call (the last one stays); `load` may fail. */
write(path.join(fakeDocker, 'docker'), `#!/bin/bash
case "$1" in
  inspect)
    if [ -s "$MARKS" ]; then head -1 "$MARKS"; [ "$(wc -l < "$MARKS")" -gt 1 ] && sed -i.bak 1d "$MARKS"; else echo "0 2026-11-08T00:00:00Z"; fi
    exit 0 ;;
  load) echo "docker $*" >> "$CALLS"; exit \${DOCKER_LOAD_EXIT:-0} ;;
esac
echo "docker $*" >> "$CALLS"
exit 0
`, 0o755);
/* curl: the relay's /chat-health through nginx is whatever $HEALTH holds;
   no file, no answer. */
write(path.join(fakeDocker, 'curl'), `#!/bin/bash\n[ -s "$HEALTH" ] && cat "$HEALTH" && exit 0\nexit 7\n`, 0o755);
const apply = (dir, pkg, env = {}) => spawnSync('bash', [path.join(dir, 'scripts/apply-update.sh'), pkg], {
  cwd: dir, encoding: 'utf8', timeout: 120000,
  env: {
    ...process.env, PATH: `${fakeDocker}:${process.env.PATH}`, CALLS: path.join(dir, 'calls.log'),
    HEALTH: path.join(dir, 'health.json'), MARKS: path.join(dir, 'marks.txt'),
    NEW_HEALTH: health('2.98.88', 1), OLD_HEALTH: health('2.98.87', 2),
    UPDATE_HEALTH_WATCH_S: '2', UPDATE_HEALTH_POLL_S: '1', ...env,
  },
});
const calls = (dir) => (fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8') : '');

try {
  check('the script exists and parses', spawnSync('bash', ['-n', path.join(ROOT, 'scripts/apply-update.sh')]).status === 0);
  const a = install('a');
  const run = apply(a, makePackage('good'));
  const log = calls(a);
  check('a sound package is applied', run.status === 0, (run.stdout + run.stderr).slice(-400));
  check('the snapshot is taken first, of the old tree', /^snapshot .*: old app of /m.test(log) && log.indexOf('snapshot') < log.indexOf('docker load'), log.replace(/\n/g, ' | '));
  check('the images are loaded', /docker load -i \S+images\.tar\.gz/.test(log), log.replace(/\n/g, ' | '));
  check('the new tree is in place, and what it no longer has is gone', fs.readFileSync(path.join(a, 'js/app.js'), 'utf8') === 'new app'
    && fs.existsSync(path.join(a, 'js/new-only.js')) && !fs.existsSync(path.join(a, 'js/old-only.js')) && fs.readFileSync(path.join(a, 'index.html'), 'utf8').includes('new'));
  check('.env and data/ are left as they were', fs.readFileSync(path.join(a, '.env'), 'utf8').startsWith('MONITOR_PASSWORD=kept\n') && fs.existsSync(path.join(a, 'data/chat-signal/relay-identity.json')));
  check('then the new tree’s own sync-to-server.sh runs, with the images given', new RegExp(`^sync --skip-bump --prebuilt in ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} app=new app$`, 'm').test(log), log.replace(/\n/g, ' | '));
  check('nothing of the work is left in the install', !fs.readdirSync(a).some((entry) => entry.startsWith('.update')));

  check('the snapshot is of this install, wherever it is', new RegExp(`^snapshot .* of ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(log), log.replace(/\n/g, ' | '));
  check('a healthy update is not undone', !/sync-old/.test(log) && /watch/i.test(run.stdout), run.stdout.slice(-300));

  /* The way back. */
  const oldTree = (dir) => fs.readFileSync(path.join(dir, 'js/app.js'), 'utf8') === 'old app'
    && fs.existsSync(path.join(dir, 'js/old-only.js')) && !fs.existsSync(path.join(dir, 'js/new-only.js'))
    && !fs.existsSync(path.join(dir, 'index.html')) && fs.readFileSync(path.join(dir, 'package.json'), 'utf8').includes('2.98.87');
  const kept = (dir) => fs.readFileSync(path.join(dir, '.env'), 'utf8').startsWith('MONITOR_PASSWORD=kept\n') && fs.existsSync(path.join(dir, 'data/chat-signal/relay-identity.json'));
  const r1 = install('r1');
  const syncFails = apply(r1, makePackage('r1'), { NEW_SYNC_EXIT: '1' });
  check('a new tree that will not come up is undone: exit 3', syncFails.status === 3, `${syncFails.status} ${(syncFails.stdout + syncFails.stderr).slice(-300)}`);
  check('the old tree is back, all of it (what the new one added gone), .env and data/ untouched', oldTree(r1) && kept(r1));
  check('and the OLD tree’s sync-to-server.sh brought the stack back up, after the new one', /^sync .*\n(.*\n)*sync-old --skip-bump --prebuilt app=old app$/m.test(calls(r1)), calls(r1).replace(/\n/g, ' | '));
  check('nothing of the work is left after the way back either', !fs.readdirSync(r1).some((entry) => entry.startsWith('.update')));

  const r2 = install('r2');
  const wrongVersion = apply(r2, makePackage('r2'), { NEW_HEALTH: health('2.98.87', 1) });
  check('a relay still serving the old version after the update is not healthy: undone', wrongVersion.status === 3 && oldTree(r2) && /version/i.test(wrongVersion.stdout + wrongVersion.stderr), `${wrongVersion.status} ${(wrongVersion.stdout + wrongVersion.stderr).slice(-300)}`);
  const r3 = install('r3');
  const silent = apply(r3, makePackage('r3'), { NEW_HEALTH: '' });
  check('nor one that does not answer at all', silent.status === 3 && oldTree(r3), `${silent.status} ${(silent.stdout + silent.stderr).slice(-300)}`);
  const r4 = install('r4');
  fs.writeFileSync(path.join(r4, 'marks.txt'), '0 2026-11-08T10:00:00Z\n1 2026-11-08T10:00:40Z\n');
  const restarted = apply(r4, makePackage('r4'));
  check('nor one whose container restarts during the watch', restarted.status === 3 && oldTree(r4) && /restart/i.test(restarted.stdout + restarted.stderr), `${restarted.status} ${(restarted.stdout + restarted.stderr).slice(-300)}`);
  const r5 = install('r5');
  const unlinked = apply(r5, makePackage('r5'), { NEW_HEALTH: health('2.98.88', 0) });
  check('nor one that was linked to its family before and is not after', unlinked.status === 3 && oldTree(r5) && /link/i.test(unlinked.stdout + unlinked.stderr), `${unlinked.status} ${(unlinked.stdout + unlinked.stderr).slice(-300)}`);
  const r6 = install('r6');
  fs.writeFileSync(path.join(r6, 'health.json'), health('2.98.87', 0));
  const neverLinked = apply(r6, makePackage('r6'), { NEW_HEALTH: health('2.98.88', 0) });
  check('but a relay with no family link before needs none after', neverLinked.status === 0, `${neverLinked.status} ${(neverLinked.stdout + neverLinked.stderr).slice(-300)}`);

  const r7 = install('r7');
  const bothFail = apply(r7, makePackage('r7'), { NEW_SYNC_EXIT: '1', OLD_SYNC_EXIT: '1' });
  check('when the way back fails too: exit 4, and it says so', bothFail.status === 4 && /back/i.test(bothFail.stderr), `${bothFail.status} ${(bothFail.stdout + bothFail.stderr).slice(-300)}`);
  const r8 = install('r8');
  const noRevert = apply(r8, makePackage('r8'), { NEW_SYNC_EXIT: '1', UPDATE_AUTO_REVERT: '0' });
  check('UPDATE_AUTO_REVERT=0: a failure is left as it is for the operator (exit 1, no way back run)', noRevert.status === 1 && !/sync-old/.test(calls(r8)), `${noRevert.status} ${calls(r8).replace(/\n/g, ' | ')}`);
  const r9 = install('r9');
  const noLoad = apply(r9, makePackage('r9'), { DOCKER_LOAD_EXIT: '1' });
  check('images that will not load: exit 1, the tree never touched, nothing to undo', noLoad.status === 1 && fs.readFileSync(path.join(r9, 'js/app.js'), 'utf8') === 'old app' && !/sync/.test(calls(r9)), `${noLoad.status} ${calls(r9).replace(/\n/g, ' | ')}`);

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
