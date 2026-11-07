/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A relay's updates (scripts/lib/relay-updates.js), with its network, its
 * clock, its users and the step that applies a package all stood in for:
 *
 * - it keeps only a package the operator signed, and only a newer one;
 * - it hands its package only to a member of the signed family, who proves
 *   it with its relay key (ECDH between the two, then an HMAC);
 * - one relay takes a newer package from another by itself, with the
 *   operator's chosen time when one was set — the chain;
 * - it applies at the operator's time, at once, or — watching — when the
 *   fewest people are on, telling those who are a couple of minutes first;
 * - after the restart it knows how it went, and never retries a failure
 *   by itself.
 *
 *   node tests/e2e/relayupdates.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = require(path.join(ROOT, 'scripts/lib/update-package.js'));
const identity = require(path.join(ROOT, 'scripts/lib/relay-identity.js'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-relayupd-'));
const operator = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const OPERATOR = operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const stranger = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
fs.writeFileSync(path.join(work, 'src.tgz'), crypto.randomBytes(3000));
fs.writeFileSync(path.join(work, 'img.tgz'), crypto.randomBytes(9000));
function makePackage(version, key = operator.privateKey) {
  const members = { 'source.tar.gz': path.join(work, 'src.tgz'), 'images.tar.gz': path.join(work, 'img.tgz') };
  const manifest = pkg.buildManifest({ version, buildTag: `${version}-chat-v1`, source: 'test', members, images: [`poorija-crypto:${version}`] });
  const file = path.join(work, `in-${version}-${crypto.randomBytes(3).toString('hex')}.tar`);
  pkg.writePackage(file, { manifest, sig: pkg.signManifest(manifest, key.export({ type: 'pkcs8', format: 'pem' })), members });
  return file;
}
function relayKeys() {
  const made = identity.generateRelayIdentity();
  const pub = identity.publicRelayIdentity(made);
  return { id: pub.id, publicKey: pub.publicKey, privateKey: identity.relayPrivateKey(made) };
}

try {
  const { createRelayUpdates, makeUpdateAuth, verifyUpdateAuth, signPolicy } = require(path.join(ROOT, 'scripts/lib/relay-updates.js'));
  const OPERATOR_PEM = operator.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const A = relayKeys();
  const B = relayKeys();
  const C = relayKeys();
  let clock = Date.parse('2026-11-10T10:00:00Z');
  const notices = { a: [], b: [] };
  const applied = { a: [], b: [] };
  let online = { a: 5, b: 5 };
  let current = { a: '2.98.88', b: '2.98.88' };
  const instances = {};
  const origins = { a: 'https://a.example:8585', b: 'https://b.example:8585' };
  const peersOf = { a: [{ id: B.id, origins: [origins.b] }], b: [{ id: A.id, origins: [origins.a] }] };
  const keysOf = { a: A, b: B };
  const members = new Set([A.id, B.id]);
  /* The network between the two: the offer, and the package behind the family check. */
  const route = (url) => Object.entries(origins).find(([, origin]) => url.startsWith(origin))?.[0];
  const fetchJson = async (url) => {
    const who = route(url);
    if (!who || !url.endsWith('/p00rija-update/offer')) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: instances[who].offer() };
  };
  const fetchFile = async (url, { headers, to }) => {
    const who = route(url);
    const pathOnly = new URL(url).pathname;
    const allowed = instances[who].authorize(headers['X-P00rija-Update-Auth'], pathOnly);
    if (!allowed.ok) return { ok: false, status: 401 };
    const file = instances[who].packageFile(pathOnly.split('/').pop());
    if (!file) return { ok: false, status: 404 };
    fs.copyFileSync(file, to);
    return { ok: true, status: 200 };
  };
  const make = (name) => {
    const dir = path.join(work, name);
    instances[name] = createRelayUpdates({
      dir, operatorKey: () => OPERATOR, currentVersion: () => current[name], self: keysOf[name],
      peers: () => peersOf[name], isMember: (id) => members.has(id), fetchJson, fetchFile,
      onlineCount: () => online[name], notifyClients: (notice) => notices[name].push(notice),
      launchApply: async (job) => { applied[name].push(job); return { ok: true }; }, now: () => clock,
    });
    return instances[name];
  };
  const a = make('a');
  const b = make('b');

  /* Keeping a package. */
  const refusedKey = await a.stage(makePackage('2.98.89', stranger.privateKey));
  check('a package signed by any other key is not kept', !refusedKey.ok && refusedKey.reason === 'bad-signature', JSON.stringify(refusedKey));
  const notNewer = await a.stage(makePackage('2.98.88'));
  check('nor one that is not newer than what runs', !notNewer.ok && notNewer.reason === 'not-newer', JSON.stringify(notNewer));
  const scheduled = { mode: 'schedule', at: '2026-11-10T13:00:00Z' };
  const staged = await a.stage(makePackage('2.98.89'), { policy: { ...scheduled, sig: signPolicy({ ...scheduled, version: '2.98.89' }, OPERATOR_PEM) } });
  const status = a.status();
  check('a signed, newer package is kept', staged.ok && status.staged?.version === '2.98.89' && status.phase === 'staged', JSON.stringify(status).slice(0, 200));
  const kept = a.packageFile('2.98.89');
  check('as a file anyone on the machine may read, with the hash the apply step checks', kept && (fs.statSync(kept).mode & 0o777) === 0o644
    && fs.readFileSync(`${kept}.sha256`, 'utf8').trim() === pkg.hashRange(kept, 0, fs.statSync(kept).size), kept);
  const offer = a.offer();
  check('its offer names the version, its size and hash, and the operator’s time', offer.available?.version === '2.98.89' && /^[0-9a-f]{64}$/.test(offer.available.sha256)
    && offer.policy?.mode === 'schedule' && offer.id === A.id && offer.publicKey === A.publicKey, JSON.stringify(offer).slice(0, 220));

  /* A package is checked as the copy the relay keeps, never as the file it
     was handed: that one sits where others on the machine may write. */
  const handed = makePackage('2.98.95');
  const relay = createRelayUpdates({
    dir: path.join(work, 'swap'), operatorKey: () => OPERATOR, currentVersion: () => '2.98.88', self: C, peers: () => [], isMember: () => false,
    fetchJson: async () => ({ ok: false }), fetchFile: async () => ({ ok: false }), launchApply: async () => ({ ok: true }), now: () => clock,
  });
  const swapping = relay.stage(handed);
  fs.writeFileSync(handed, crypto.randomBytes(100));
  const swapped = await swapping;
  check('a package swapped after it was handed over changes nothing the relay keeps', swapped.ok && pkg.verifyPackage(relay.packageFile('2.98.95'), OPERATOR).ok, JSON.stringify(swapped));
  check('and the relay keeps its working copies where only it may write', (fs.statSync(path.join(work, 'swap', 'work')).mode & 0o777) === 0o700);

  /* The family check. */
  const pathOf = '/p00rija-update/package/2.98.89';
  const header = makeUpdateAuth({ self: B, server: { id: A.id, publicKey: A.publicKey }, path: pathOf, now: clock });
  check('a family member proves itself with its relay key', verifyUpdateAuth(header, { self: A, isMember: (id) => members.has(id), path: pathOf, now: clock }).ok);
  check('one not in the signed family is refused', !verifyUpdateAuth(makeUpdateAuth({ self: C, server: { id: A.id, publicKey: A.publicKey }, path: pathOf, now: clock }), { self: A, isMember: (id) => members.has(id), path: pathOf, now: clock }).ok);
  check('so is a proof made for another path', !verifyUpdateAuth(header, { self: A, isMember: (id) => members.has(id), path: '/p00rija-update/package/2.98.90', now: clock }).ok);
  check('or ten minutes old', !verifyUpdateAuth(header, { self: A, isMember: (id) => members.has(id), path: pathOf, now: clock + 600000 }).ok);
  const [hid, hkey, hts, hmac] = header.split('.');
  check('or carrying a key that is not the id’s', !verifyUpdateAuth([hid, Buffer.from(C.publicKey, 'base64').toString('base64url'), hts, hmac].join('.'), { self: A, isMember: (id) => members.has(id), path: pathOf, now: clock }).ok);
  check('or with its proof changed', !verifyUpdateAuth([hid, hkey, hts, `${hmac.slice(0, -2)}00`].join('.'), { self: A, isMember: (id) => members.has(id), path: pathOf, now: clock }).ok);
  check('or nothing at all', !verifyUpdateAuth('', { self: A, isMember: (id) => members.has(id), path: pathOf, now: clock }).ok);

  /* The chain: b finds a's newer package and takes it, time and all. */
  await b.checkPeers();
  check('a relay takes a newer signed package from a family member by itself', b.status().staged?.version === '2.98.89', JSON.stringify(b.status()).slice(0, 200));
  check('keeping the time the operator chose for it', b.status().policy?.mode === 'schedule' && Date.parse(b.status().policy?.at) === Date.parse('2026-11-10T13:00:00Z'), JSON.stringify(b.status().policy));

  /* A time a peer offers without the operator's signature is not taken. */
  const loose = createRelayUpdates({
    dir: path.join(work, 'loose'), operatorKey: () => OPERATOR, currentVersion: () => '2.98.88', self: C, peers: () => [{ id: A.id, origins: [origins.a] }], isMember: () => true,
    fetchJson: async () => ({ ok: true, status: 200, json: { ...a.offer(), policy: { mode: 'now', at: null } } }),
    fetchFile: async (url, { to }) => { fs.copyFileSync(a.packageFile('2.98.89'), to); return { ok: true, status: 200 }; },
    onlineCount: () => 3, notifyClients: () => {}, launchApply: async () => ({ ok: true }), now: () => clock,
  });
  await loose.checkPeers();
  check('a time a peer offers unsigned is not taken: the relay watches instead', loose.status().staged?.version === '2.98.89' && loose.status().policy?.mode === 'watch', JSON.stringify(loose.status().policy));

  /* The operator's time. */
  await a.tick();
  check('before the chosen time nothing happens', !notices.a.length && !applied.a.length && a.status().phase === 'staged');
  clock = Date.parse('2026-11-10T13:00:30Z');
  await a.tick();
  check('at it, those online are told first', notices.a.length === 1 && notices.a[0].inSeconds >= 60 && !applied.a.length && a.status().phase === 'notifying', JSON.stringify(notices.a));
  clock += 30000;
  await a.tick();
  check('and given time before it starts', !applied.a.length);
  clock += 120000;
  await a.tick();
  check('then the package is applied, the one that was checked', applied.a.length === 1 && applied.a[0].file === kept && applied.a[0].version === '2.98.89' && a.status().phase === 'applying', JSON.stringify(applied.a));

  /* After the restart: the new version runs. */
  current.a = '2.98.89';
  const a2 = make('a');
  await a2.tick();
  check('after the restart it knows the update took', a2.status().phase === 'idle' && !a2.status().staged && a2.status().lastResult?.ok === true && a2.status().lastResult?.version === '2.98.89', JSON.stringify(a2.status()).slice(0, 240));
  check('and still hands the package on to the family', a2.offer().available?.version === '2.98.89' && Boolean(a2.packageFile('2.98.89')));

  /* The watcher: a week of mornings busy and nights quiet. */
  online.b = 40;
  for (let hour = 0; hour < 24 * 7; hour += 1) {
    clock += 3600000;
    online.b = (hour % 24) < 6 ? 2 : 40;
    b.sample();
  }
  /* Kept afresh, to be applied whenever is best. */
  await b.cancel();
  await b.stage(b.packageFile('2.98.89'), { policy: { mode: 'watch' } });
  online.b = 40;
  await b.tick();
  check('watching, a busy hour is not the time', !notices.b.length && !applied.b.length, `${notices.b.length} ${applied.b.length}`);
  online.b = 2;
  await b.tick();
  check('a quiet one is: the few on are told first', notices.b.length === 1 && !applied.b.length, `${notices.b.length} ${applied.b.length}`);
  clock += 180000;
  await b.tick();
  check('and then it applies', applied.b.length === 1 && applied.b[0].version === '2.98.89', JSON.stringify(applied.b));

  /* With nobody on there is nobody to tell. */
  current.b = '2.98.88';
  fs.writeFileSync(path.join(work, 'b', 'result.json'), JSON.stringify({ code: 1, at: new Date(clock).toISOString(), version: '2.98.89' }));
  const b2 = make('b');
  await b2.tick();
  check('a failed update is said so after the restart', b2.status().phase === 'failed' && b2.status().lastResult?.ok === false, JSON.stringify(b2.status()).slice(0, 240));
  applied.b.length = 0;
  online.b = 0;
  clock += 3600000;
  await b2.tick();
  check('and not tried again by itself', !applied.b.length);
  await b2.setPolicy({ mode: 'now' });
  await b2.tick();
  check('until the operator says now; with nobody on it starts at once', applied.b.length === 1 && !notices.b.slice(1).length, `${applied.b.length} ${notices.b.length}`);

  /* The operator can take a package back. */
  current.a = '2.98.89';
  const later = makePackage('2.98.90');
  await a2.stage(later);
  await a2.cancel();
  check('a cancelled update is not applied', !a2.status().staged && a2.status().phase === 'idle');

  /* A peer offering something unsigned is not followed. */
  const c = createRelayUpdates({
    dir: path.join(work, 'c'), operatorKey: () => OPERATOR, currentVersion: () => '2.98.88', self: C,
    peers: () => [{ id: A.id, origins: ['https://evil.example:8585'] }], isMember: () => true,
    fetchJson: async () => ({ ok: true, status: 200, json: { id: A.id, publicKey: A.publicKey, version: '9.9.9', available: { version: '9.9.9', size: 10, sha256: '0'.repeat(64) } } }),
    fetchFile: async (url, { to }) => { fs.copyFileSync(makePackage('9.9.9', stranger.privateKey), to); return { ok: true, status: 200 }; },
    onlineCount: () => 0, notifyClients: () => {}, launchApply: async () => ({ ok: true }), now: () => clock,
  });
  await c.checkPeers();
  check('a package a peer offers is kept only when the operator signed it', !c.status().staged, JSON.stringify(c.status()).slice(0, 200));
} catch (error) {
  check('the suite ran to the end', false, error?.stack?.split('\n').slice(0, 4).join(' ') || String(error));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
