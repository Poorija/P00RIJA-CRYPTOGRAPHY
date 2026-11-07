/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Two real relays (scripts/server.js) of one signed family, and an update:
 * the panel hands r1 a signed package with a time for it; r2 takes it from
 * r1 by itself, time and all, proving it is family; nobody else gets it; and
 * the dashboard's update calls want the dashboard's password.
 *
 *   node tests/e2e/relayupdateroutes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createFleet, waitUntil, fetchJson, AUTH } from './_relay-fleet.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = require(path.join(ROOT, 'scripts/lib/update-package.js'));
const dirlib = require(path.join(ROOT, 'scripts/lib/relay-directory.js'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const operator = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const operatorKey = operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const VERSION = '9.98.1';
const fleet = await createFleet(['r1', 'r2'], {
  env: {
    r1: (f) => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_UPDATES_DIR: path.join(f.relays.r1.dir, 'updates'), CHAT_UPDATE_START_MS: '600000' }),
    r2: (f) => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_UPDATES_DIR: path.join(f.relays.r2.dir, 'updates'), CHAT_UPDATE_START_MS: '600000' }),
  },
});
const { r1, r2 } = fleet.relays;

try {
  await fleet.startAll();
  const doc = dirlib.signDirectory({
    v: 1, operator: { id: dirlib.operatorIdFor(operatorKey), key: operatorKey, name: 'Ops' }, serial: 1, issuedAt: new Date().toISOString(),
    relays: [r1, r2].map((relay) => ({ id: relay.id, name: relay.name, origins: [relay.origin], region: 'outside-iran', gateway: 0 })), revoked: [],
  }, operator.privateKey);
  for (const name of ['r1', 'r2']) await fleet.post(name, '/Monitor_Server/directory', doc);

  /* The package, as the panel would copy it in over SSH. */
  const work = path.join(r1.dir, 'work');
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'src.tgz'), crypto.randomBytes(4000));
  fs.writeFileSync(path.join(work, 'img.tgz'), crypto.randomBytes(200000));
  const members = { 'source.tar.gz': path.join(work, 'src.tgz'), 'images.tar.gz': path.join(work, 'img.tgz') };
  const manifest = pkg.buildManifest({ version: VERSION, buildTag: `${VERSION}-chat-v1`, source: 'test', members, images: [`poorija-crypto:${VERSION}`] });
  const incoming = path.join(r1.dir, 'updates', 'incoming');
  await waitUntil(() => fs.existsSync(incoming), 10000);
  pkg.writePackage(path.join(incoming, 'from-panel.tar'), { manifest, sig: pkg.signManifest(manifest, operator.privateKey.export({ type: 'pkcs8', format: 'pem' })), members });

  const nobody = await fetchJson(`${r1.origin}/Monitor_Server/updates/stage`, { method: 'POST', body: { file: 'from-panel.tar' } });
  check('the dashboard’s update calls want its password', nobody.status === 401, JSON.stringify(nobody));
  const at = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  /* The time, signed by the operator so it may travel along the family. */
  const { signPolicy } = require(path.join(ROOT, 'scripts/lib/relay-updates.js'));
  const sig = signPolicy({ version: VERSION, mode: 'schedule', at }, operator.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const staged = await fleet.post('r1', '/Monitor_Server/updates/stage', { file: 'from-panel.tar', policy: { mode: 'schedule', at, sig } });
  check('a signed package the panel copied in is kept, with the operator’s time', staged.ok === true && staged.version === VERSION, JSON.stringify(staged));
  const state = await fetchJson(`${r1.origin}/Monitor_Server/updates`, { headers: { Authorization: AUTH } });
  check('and the dashboard says so', state.staged?.version === VERSION && state.policy?.mode === 'schedule' && state.phase === 'staged', JSON.stringify(state).slice(0, 240));
  const bad = await fleet.post('r1', '/Monitor_Server/updates/stage', { file: '../relay-identity.json' });
  check('a file outside the folder for incoming packages is never named', bad.status === 400, JSON.stringify(bad));

  const offer = await fetchJson(`${r1.origin}/p00rija-update/offer`);
  check('anyone may ask what it has', offer.available?.version === VERSION && offer.id === r1.id, JSON.stringify(offer).slice(0, 200));
  const stranger = await fetch(`${r1.origin}/p00rija-update/package/${VERSION}`);
  check('but the package goes only to the family', stranger.status === 401, String(stranger.status));

  const pulled = await fleet.post('r2', '/Monitor_Server/updates/check', {});
  const r2state = await fetchJson(`${r2.origin}/Monitor_Server/updates`, { headers: { Authorization: AUTH } });
  check('a family member takes it by itself, proving who it is', pulled.ok === true && r2state.staged?.version === VERSION, `${JSON.stringify(pulled)} ${JSON.stringify(r2state).slice(0, 200)}`);
  check('with the operator’s signed time', r2state.policy?.mode === 'schedule' && Date.parse(r2state.policy?.at) === Date.parse(at), JSON.stringify(r2state.policy));
  const copy = path.join(r2.dir, 'updates', `p00rija-update-${VERSION}.tar`);
  check('byte for byte the package the operator signed', fs.existsSync(copy) && pkg.verifyPackage(copy, operatorKey).ok);
} catch (error) {
  check('the suite ran to the end', false, error?.stack?.split('\n').slice(0, 4).join(' ') || String(error));
} finally {
  await fleet.stopAll();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
