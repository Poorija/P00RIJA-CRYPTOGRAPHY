/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* An update package (scripts/lib/update-package.js): a plain tar of a
 * manifest, the operator's signature over it, the source and the images.
 * A server stages or applies nothing that this check does not pass: the
 * signature must be the operator's, every member must be the one the
 * manifest names, byte for byte, and the version must be a version.
 *
 *   node tests/e2e/updatepackage.mjs
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
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-updatepkg-'));
const keyPair = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), pem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};

try {
  const lib = require(path.join(ROOT, 'scripts/lib/update-package.js'));
  const operator = keyPair();
  const stranger = keyPair();
  fs.writeFileSync(path.join(work, 'source.tar.gz'), crypto.randomBytes(70000));
  fs.writeFileSync(path.join(work, 'images.tar.gz'), crypto.randomBytes(1300000));
  const make = (name, { version = '2.98.88', key = operator.pem, tamper = null, afterSigning = {} } = {}) => {
    const file = path.join(work, name);
    const manifest = lib.buildManifest({
      version, buildTag: `${version}-chat-v180`, source: 'folder',
      members: { 'source.tar.gz': path.join(work, 'source.tar.gz'), 'images.tar.gz': path.join(work, 'images.tar.gz') },
      images: [`poorija-crypto:${version}`, `poorija-chat-signal:${version}`, `poorija-cert-renewer:${version}`],
    });
    const sig = lib.signManifest(manifest, key);
    Object.assign(manifest, afterSigning);
    lib.writePackage(file, { manifest, sig, members: { 'source.tar.gz': path.join(work, 'source.tar.gz'), 'images.tar.gz': path.join(work, 'images.tar.gz') } });
    if (tamper) tamper(file);
    return file;
  };

  const good = make('good.tar');
  const verdict = lib.verifyPackage(good, operator.spki);
  check('a package the operator signed verifies', verdict.ok && verdict.manifest.version === '2.98.88', JSON.stringify({ ok: verdict.ok, reason: verdict.reason }));
  const listed = spawnSync('tar', ['tf', good], { encoding: 'utf8' });
  check('and is a plain tar any tar can read', listed.status === 0 && ['manifest.json', 'manifest.sig', 'source.tar.gz', 'images.tar.gz'].every((name) => listed.stdout.split('\n').includes(name)), listed.stdout.replace(/\n/g, ' '));
  check('whose manifest names each member’s size and hash', verdict.manifest.members['images.tar.gz'].size === 1300000 && /^[0-9a-f]{64}$/.test(verdict.manifest.members['images.tar.gz'].sha256));

  const otherKey = lib.verifyPackage(make('stranger.tar', { key: stranger.pem }), operator.spki);
  check('one signed by any other key is refused', !otherKey.ok && otherKey.reason === 'bad-signature', otherKey.reason);

  const flipped = make('flipped.tar', {
    tamper: (file) => {
      const index = lib.readTarIndex(file).find((member) => member.name === 'images.tar.gz');
      const fd = fs.openSync(file, 'r+');
      const byte = Buffer.alloc(1);
      fs.readSync(fd, byte, 0, 1, index.offset + 1000);
      byte[0] ^= 0xff;
      fs.writeSync(fd, byte, 0, 1, index.offset + 1000);
      fs.closeSync(fd);
    },
  });
  const changed = lib.verifyPackage(flipped, operator.spki);
  check('one byte changed in an image is caught', !changed.ok && changed.reason === 'member-hash', changed.reason);

  const forged = lib.verifyPackage(make('forged.tar', { afterSigning: { version: '9.9.9' } }), operator.spki);
  check('a manifest changed after signing is refused', !forged.ok && forged.reason === 'bad-signature', forged.reason);
  const notVersion = lib.verifyPackage(make('weird.tar', { version: '2.98.88; reboot' }), operator.spki);
  check('a version that is not a version is refused', !notVersion.ok && notVersion.reason === 'bad-manifest', notVersion.reason);
  const truncated = path.join(work, 'truncated.tar');
  fs.writeFileSync(truncated, fs.readFileSync(good).subarray(0, 4000));
  const cut = lib.verifyPackage(truncated, operator.spki);
  check('a package cut short is refused', !cut.ok, cut.reason);
  const garbage = path.join(work, 'garbage.tar');
  fs.writeFileSync(garbage, crypto.randomBytes(3000));
  check('so is one that is not a tar at all', !lib.verifyPackage(garbage, operator.spki).ok);
  check('and a missing file', !lib.verifyPackage(path.join(work, 'absent.tar'), operator.spki).ok);

  /* tar extracts the LAST member of a name; a checker that read the first
     one would pass a package whose appended twin is what gets applied. */
  const appendMember = (file, name, data) => {
    const body = fs.readFileSync(file);
    const end = lib.readTarIndex(file).reduce((at, member) => Math.max(at, member.offset + Math.ceil(member.size / 512) * 512), 0);
    const header = Buffer.alloc(512, 0);
    header.write(name, 0); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); header.write('00000000000\0', 136); header.write('        ', 148); header.write('0', 156); header.write('ustar\u000000', 257);
    let sum = 0; for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    const pad = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
    fs.writeFileSync(file, Buffer.concat([body.subarray(0, end), header, data, pad, Buffer.alloc(1024, 0)]));
  };
  const twin = make('twin.tar');
  appendMember(twin, 'images.tar.gz', crypto.randomBytes(2000));
  const twinVerdict = lib.verifyPackage(twin, operator.spki);
  check('a package with a second member of the same name is refused', !twinVerdict.ok && twinVerdict.reason === 'bad-package', twinVerdict.reason);
  const extra = make('extra.tar');
  appendMember(extra, 'scripts/evil.sh', Buffer.from('echo hi'));
  check('so is one with any member besides the four', !lib.verifyPackage(extra, operator.spki).ok);
  const linked = make('linked.tar');
  const linkIndex = lib.readTarIndex(linked).find((member) => member.name === 'source.tar.gz');
  const fd = fs.openSync(linked, 'r+');
  const headerAt = linkIndex.offset - 512;
  const head = Buffer.alloc(512); fs.readSync(fd, head, 0, 512, headerAt);
  head.write('2', 156); head.write('        ', 148);
  let sum2 = 0; for (const byte of head) sum2 += byte;
  head.write(`${sum2.toString(8).padStart(6, '0')}\0 `, 148);
  fs.writeSync(fd, head, 0, 512, headerAt); fs.closeSync(fd);
  check('and one whose member is a link, not a file', !lib.verifyPackage(linked, operator.spki).ok);

  check('versions compare as numbers', lib.compareVersions('2.98.88', '2.98.9') > 0 && lib.compareVersions('2.98.87', '2.98.88') < 0 && lib.compareVersions('2.98.88', '2.98.88') === 0);
  const member = lib.readTarIndex(good).find((entry) => entry.name === 'source.tar.gz');
  const copy = path.join(work, 'copy.bin');
  await new Promise((resolve, reject) => lib.memberStream(good, member).pipe(fs.createWriteStream(copy)).on('finish', resolve).on('error', reject));
  check('a member reads back exactly', fs.readFileSync(copy).equals(fs.readFileSync(path.join(work, 'source.tar.gz'))));
} catch (error) {
  check('the suite ran to the end', false, error?.stack?.split('\n').slice(0, 3).join(' ') || String(error));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
