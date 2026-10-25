/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Relay families: an operator-signed directory of relays
 * (docs/RELAY-NETWORK.md, "Relay families").
 *
 * "the rules" checks the library on its own: the canonical form a signature
 * covers, who may sign, the serial that only goes up, and what a relay
 * allows and drops when a new directory arrives.
 *
 * "two relays, one operator" runs two real relays that trust the same
 * operator key and are told nothing else: one is handed a directory, the
 * other finds it by itself, and they link; a newer directory drops one, an
 * old one replayed changes nothing.
 *
 *   node tests/e2e/relaydirectory.mjs            # every section
 *   node tests/e2e/relaydirectory.mjs rules      # one of them
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startTwoStacks } from './_two-stacks.mjs';

const require = createRequire(import.meta.url);
const ONLY = new Set(process.argv.slice(2));
const wants = (name) => !ONLY.size || ONLY.has(name);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);

const spki = (publicKey) => publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const newKey = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const fakeId = (n) => crypto.createHash('sha256').update(`relay-${n}`).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AUTH = 'Basic ' + Buffer.from('admin:Local-Test-Only-Password-36').toString('base64');
const waitUntil = async (test, ms) => {
  for (let waited = 0; waited < ms; waited += 500) {
    if (await test()) return true;
    await sleep(500);
  }
  return false;
};

try {
  if (wants('rules')) {
    section('the rules');
    const dir = require('../../scripts/lib/relay-directory.js');
    check('canonical JSON sorts keys at every level and keeps array order',
      dir.canonicalJson({ b: 1, a: { d: [2, 1], c: 'x' } }) === '{"a":{"c":"x","d":[2,1]},"b":1}',
      dir.canonicalJson({ b: 1, a: { d: [2, 1], c: 'x' } }));

    const operator = newKey();
    const intruder = newKey();
    const operatorKey = spki(operator.publicKey);
    const [SELF, A, B, C, D] = [1, 2, 3, 4, 5].map(fakeId);
    const body = (serial, relays, revoked = []) => ({
      v: 1,
      operator: { id: dir.operatorIdFor(operatorKey), key: operatorKey, name: 'test' },
      serial,
      issuedAt: '2026-10-25T00:00:00Z',
      relays,
      revoked,
    });
    const member = (id, origins = []) => ({ id, name: id.slice(0, 4), origins, region: 'outside-iran', gateway: 0 });
    check('the operator id is the SHA-256 of the key, as relay ids are',
      dir.operatorIdFor(operatorKey) === crypto.createHash('sha256').update(Buffer.from(operatorKey, 'base64')).digest('hex'));

    const doc = dir.signDirectory(body(7, [member(SELF, ['https://self.example']), member(A, ['https://a.example'])]), operator.privateKey);
    const verdict = dir.verifyDirectory(doc, { operatorKey, selfId: SELF });
    check('a signed directory verifies for a relay it names', verdict.ok === true && verdict.directory?.serial === 7, JSON.stringify(verdict.reason || ''));

    const intruderKey = spki(intruder.publicKey);
    check('one checked against another operator\'s key is refused',
      dir.verifyDirectory(doc, { operatorKey: intruderKey, selfId: SELF }).reason === 'wrong-operator');
    const forged = dir.signDirectory({ ...body(8, [member(SELF), member(B)]), operator: { id: dir.operatorIdFor(operatorKey), key: operatorKey, name: 'test' } }, intruder.privateKey);
    check('one claiming the operator but signed by someone else is refused',
      dir.verifyDirectory(forged, { operatorKey, selfId: SELF }).reason === 'bad-signature');
    const tampered = JSON.parse(JSON.stringify(doc));
    tampered.body.relays[1].origins = ['https://evil.example'];
    check('a tampered body is refused', dir.verifyDirectory(tampered, { operatorKey, selfId: SELF }).reason === 'bad-signature');

    check('the serial held again is stale',
      dir.verifyDirectory(doc, { operatorKey, selfId: SELF, heldSerial: 7, heldBody: doc.body }).reason === 'stale');
    const rival = dir.signDirectory(body(7, [member(SELF), member(C)]), operator.privateKey);
    check('the same serial with a different body is refused as an operator mistake',
      dir.verifyDirectory(rival, { operatorKey, selfId: SELF, heldSerial: 7, heldBody: doc.body }).reason === 'same-serial-different-body');
    const older = dir.signDirectory(body(6, [member(SELF), member(A)]), operator.privateKey);
    check('an older serial is stale (the replay guard)',
      dir.verifyDirectory(older, { operatorKey, selfId: SELF, heldSerial: 7, heldBody: doc.body }).reason === 'stale');

    const elsewhere = dir.signDirectory(body(9, [member(A), member(B)]), operator.privateKey);
    check('a directory that does not name this relay is not applied',
      dir.verifyDirectory(elsewhere, { operatorKey, selfId: SELF }).reason === 'not-a-member');
    const contradictory = dir.signDirectory(body(9, [member(SELF), member(A)], [A]), operator.privateKey);
    check('a relay both listed and revoked is refused',
      dir.verifyDirectory(contradictory, { operatorKey, selfId: SELF }).reason === 'revoked-and-listed');
    check('garbage is malformed', dir.verifyDirectory({ nope: 1 }, { operatorKey, selfId: SELF }).reason === 'malformed');

    const plan = dir.planChanges(body(10, [member(SELF, ['https://self.example']), member(A, ['https://a1.example', 'https://a2.example']), member(B)], [D]), SELF, new Set([A, C]));
    const allowed = Object.fromEntries(plan.allow.map((entry) => [entry.id, entry.origins]));
    check('the plan allows every other member, with its origins, and never itself',
      plan.allow.length === 2 && allowed[A] === 'https://a1.example|https://a2.example' && allowed[B] === '' && !(SELF in allowed),
      JSON.stringify(plan.allow));
    check('and drops what an earlier directory added and this one left out, and every revoked id',
      plan.drop.slice().sort().join() === [C, D].sort().join(), JSON.stringify(plan.drop));
  }

  if (wants('tool')) {
    section('the operator tool');
    const dir = require('../../scripts/lib/relay-directory.js');
    const tool = await import('../../tools/relay-directory.mjs');
    const conf = tool.parseDeployConf("SERVERS='fl ir'\nFL_SSH_HOST='fl.example'\nFL_PUBLIC_URL='https://fl.example:8585'\nIR_REGION='inside-iran'\n# a comment\n");
    check('reads the servers and their fields out of deploy.conf',
      conf.servers.join() === 'fl,ir' && conf.fields('fl', 'SSH_HOST') === 'fl.example' && conf.fields('ir', 'REGION') === 'inside-iran' && conf.fields('ir', 'SSH_HOST') === '',
      JSON.stringify(conf.servers));

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-operator-'));
    const made = tool.initKey(home, 'Test Operator');
    const keyFile = path.join(home, 'operator-key.json');
    check('init makes the operator key, readable by its owner only', fs.existsSync(keyFile) && (fs.statSync(keyFile).mode & 0o777) === 0o600 && /^[a-f0-9]{64}$/.test(made.id),
      (fs.statSync(keyFile).mode & 0o777).toString(8));
    let refused = false;
    try { tool.initKey(home, 'again'); } catch (_error) { refused = true; }
    check('and refuses to make a second one over it', refused);

    const [R1, R2, R3] = [11, 12, 13].map(fakeId);
    let draft = tool.applyEdit(null, { op: 'add', relay: { id: R1, name: 'one', origins: ['https://one.example'], region: 'outside-iran', gateway: 1 } });
    draft = tool.applyEdit(draft, { op: 'add', relay: { id: R2, name: 'two', origins: [], region: 'inside-iran', gateway: 0 } });
    draft = tool.applyEdit(draft, { op: 'add', relay: { id: R1, name: 'one', origins: ['https://one-new.example'], region: 'outside-iran', gateway: 1 } });
    check('adding a relay again updates it rather than listing it twice',
      draft.relays.length === 2 && draft.relays.find((relay) => relay.id === R1).origins[0] === 'https://one-new.example');
    draft = tool.applyEdit(draft, { op: 'add', relay: { id: R3, name: 'three', origins: [], region: '', gateway: 0 } });
    draft = tool.applyEdit(draft, { op: 'revoke', id: R3 });
    check('revoking moves a relay out of the list and into the revoked ids', !draft.relays.some((relay) => relay.id === R3) && draft.revoked.includes(R3));
    let readded = false;
    try { tool.applyEdit(draft, { op: 'add', relay: { id: R3, name: 'three', origins: [], region: '', gateway: 0 } }); } catch (_error) { readded = true; }
    check('a revoked relay cannot be added back', readded);
    draft = tool.applyEdit(draft, { op: 'remove', id: R2 });
    check('removing takes a relay out without revoking it', !draft.relays.some((relay) => relay.id === R2) && !draft.revoked.includes(R2));

    const state = { ...tool.loadState(home), draft };
    const first = tool.signDraft(state);
    const second = tool.signDraft({ ...state, signed: first });
    const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    check('signing numbers each directory one higher than the last',
      first.body.serial === 1 && second.body.serial === 2 && first.body.operator.name === 'Test Operator');
    check('and a relay it names accepts what it signs',
      dir.verifyDirectory(second, { operatorKey: key.publicKey, selfId: R1, heldSerial: 1, heldBody: first.body }).ok === true);
    const script = tool.deliveryScript('/srv/pkg', second, { sources: ['https://two.example:8585'] });
    check('the dashboard password never reaches a command line on the server',
      !/curl[^\n]*\s-u\s/.test(script) && script.includes('-K "$CFG"') && /chmod 600 "\$CFG"|umask 077/.test(script), script.split('\n').filter((line) => line.includes('curl')).join(' | ').slice(0, 200));
    /* Run against a pretend server: docker and curl are stand-ins that write
       down what they were given. The deploy starts the relay with the host's
       install and backup paths and the version; a restart without them left
       the dashboard's backups and jobs pointing nowhere. */
    {
      const server = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-server-'));
      const bin = path.join(server, 'bin');
      const record = path.join(server, 'docker.log');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(server, '.env'), 'MONITOR_PASSWORD=x\n');
      fs.writeFileSync(path.join(server, 'package.json'), '{\n  "name": "p",\n  "version": "9.8.7"\n}\n');
      fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\n[ "$1" = inspect ] && { echo config; exit 0; }\necho "$* | OPS_INSTALL_DIR=\${OPS_INSTALL_DIR:-} OPS_BACKUP_DIR=\${OPS_BACKUP_DIR:-} APP_VERSION=\${APP_VERSION:-}" >> "${record}"\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\necho \'{"ok":true}\'\n', { mode: 0o755 });
      const run = spawnSync('bash', ['-s'], { input: tool.deliveryScript(server, second, { sources: ['https://two.example:8585'] }), env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 30000 });
      const up = (fs.existsSync(record) ? fs.readFileSync(record, 'utf8') : '').split('\n').find((line) => line.includes('up -d chat-signal')) || '';
      check('a relay the tool restarts keeps the install paths and version the deploy gave it',
        up.includes(`OPS_INSTALL_DIR=${server} `) && up.includes(`OPS_BACKUP_DIR=${server}/backups `) && up.endsWith('APP_VERSION=9.8.7'),
        up || `${run.stdout}${run.stderr}`.slice(0, 200));
      fs.rmSync(server, { recursive: true, force: true });
    }
    fs.rmSync(home, { recursive: true, force: true });
  }

  if (wants('relays')) {
    const dir = require('../../scripts/lib/relay-directory.js');
    const operator = newKey();
    const operatorKey = spki(operator.publicKey);
    const signed = (serial, relays, revoked = []) => dir.signDirectory({
      v: 1,
      operator: { id: dir.operatorIdFor(operatorKey), key: operatorKey, name: 'test' },
      serial,
      issuedAt: new Date().toISOString(),
      relays,
      revoked,
    }, operator.privateKey);

    section('a relay that trusts an operator but has no directory yet');
    {
      const stacks = await startTwoStacks({ envA: { CHAT_OPERATOR_KEY: operatorKey, CHAT_DIRECTORY_MIN_SERIAL: '5' }, envB: { CHAT_OPERATOR_KEY: operatorKey } });
      try {
        const health = await fetch(`http://127.0.0.1:${stacks.a.signal}/chat-health`).then((r) => r.json());
        check('links exactly as it did through CHAT_TRANSIT_PEERS', health.transit?.up >= 1, JSON.stringify(health.transit));
        check('and serves no directory', (await fetch(`http://127.0.0.1:${stacks.a.signal}/relay-directory`)).status === 404);
        /* A relay holding nothing would otherwise take any directory the
           operator ever signed, an old one naming a relay revoked since. */
        const member = (side) => ({ id: side.identity.id, name: 'm', origins: [`http://127.0.0.1:${side.signal}`], region: 'outside-iran', gateway: 0 });
        const post = (doc) => fetch(`http://127.0.0.1:${stacks.a.signal}/Monitor_Server/directory`, { method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(doc) }).then((r) => r.json());
        const below = await post(signed(3, [member(stacks.a), member(stacks.b)]));
        check('below CHAT_DIRECTORY_MIN_SERIAL, even with nothing held, a directory is stale', below.ok === false && below.reason === 'stale', JSON.stringify(below));
        const atFloor = await post(signed(5, [member(stacks.a), member(stacks.b)]));
        check('and at the floor it is taken', atFloor.ok === true && atFloor.serial === 5, JSON.stringify(atFloor));
      } finally {
        await stacks.stop();
      }
    }

    section('two relays, one operator');
    const stacks = await startTwoStacks({
      waitForLink: false,
      envA: { CHAT_TRANSIT_PEERS: '', CHAT_OPERATOR_KEY: operatorKey, CHAT_DIRECTORY_PULL_MS: '3000' },
      envB: { CHAT_TRANSIT_PEERS: '', CHAT_OPERATOR_KEY: operatorKey, CHAT_DIRECTORY_PULL_MS: '3000', CHAT_DIRECTORY_SOURCES: (sides) => `http://127.0.0.1:${sides.a.signal}` },
    });
    try {
      const A = stacks.a; const B = stacks.b;
      const base = (side) => `http://127.0.0.1:${side.signal}`;
      const transit = async (side) => (await fetch(`${base(side)}/chat-health`).then((r) => r.json())).transit || {};
      const publish = (side, doc, auth = AUTH) => fetch(`${base(side)}/Monitor_Server/directory`, {
        method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
      }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
      const served = async (side) => (await fetch(`${base(side)}/relay-directory`).then((r) => (r.ok ? r.json() : null)))?.body?.serial || 0;
      const relay = (side, extra = {}) => ({ id: side.identity.id, name: side === A ? 'a' : 'b', origins: [base(side)], region: 'outside-iran', gateway: 0, ...extra });
      const C = fakeId('elsewhere');

      check('told nothing, neither relay carries for anybody', (await transit(A)).allowed === 0 && (await transit(B)).allowed === 0);
      const first = await publish(A, signed(1, [relay(A), relay(B)]));
      check('the dashboard takes a directory signed by the operator', first.ok === true && first.serial === 1, JSON.stringify(first));
      check('the other relay finds it by itself, and the two link',
        await waitUntil(async () => (await transit(A)).up >= 1 && (await transit(B)).up >= 1, 30000), JSON.stringify([await transit(A), await transit(B)]));
      check('and serves it to anyone who asks', (await served(B)) === 1);
      const floorFile = (side) => { try { return fs.readFileSync(path.join(side.dir, 'relay-directory.json.serial'), 'utf8').trim(); } catch (_error) { return ''; } };
      check('each keeps the highest serial apart from the directory itself', floorFile(A) === '1' && floorFile(B) === '1', `${floorFile(A)} / ${floorFile(B)}`);
      const pane = await fetch(`${base(A)}/Monitor_Server/transit`, { method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());
      check('the dashboard\'s relays pane gets the family: serial, and each member\'s link',
        pane.directory?.serial === 1 && pane.directory.relays.length === 2 && pane.directory.relays.every((member) => member.linked), JSON.stringify(pane.directory || null).slice(0, 200));
      const page = await fetch(`${base(A)}/Monitor_Server`, { headers: { Authorization: AUTH } }).then((r) => r.text());
      check('and the dashboard has a card to show it in', page.includes('id="tFamily"'), `${page.length} bytes`);
      /* The dashboard's script is written inside a template literal, where a
         stray escape in a string breaks the whole page without a sound. */
      const broken = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => {
        try { new vm.Script(match[1]); return ''; } catch (error) { return error.message; }
      }).filter(Boolean);
      check('and its script parses', broken.length === 0, broken.join('; ').slice(0, 160));

      const second = await publish(A, signed(2, [relay(A), { id: C, name: 'c', origins: ['https://127.0.0.1:9'], region: 'outside-iran', gateway: 0 }]));
      check('a newer directory that leaves a relay out is taken', second.ok === true && second.serial === 2, JSON.stringify(second));
      check('and the relay left out loses its link', await waitUntil(async () => (await transit(B)).up === 0, 20000), JSON.stringify(await transit(B)));
      await sleep(4000);
      check('the relay left out keeps the last directory that named it', (await served(B)) === 1, String(await served(B)));

      const replay = await publish(A, signed(1, [relay(A), relay(B)]));
      check('an old directory replayed is refused and changes nothing', replay.ok === false && replay.reason === 'stale' && (await served(A)) === 2, JSON.stringify(replay));

      const third = await publish(A, signed(3, [relay(A), relay(B), { id: C, name: 'c', origins: ['https://127.0.0.1:9'], region: 'inside-iran', gateway: 0 }]));
      check('a member nobody can reach does not stop the others linking',
        third.ok === true && await waitUntil(async () => (await transit(A)).up >= 1 && (await transit(B)).up >= 1, 30000), JSON.stringify([third, await transit(B)]));

      const manual = fakeId('manual');
      await fetch(`${base(B)}/Monitor_Server/transit-add`, { method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: manual, origin: 'https://127.0.0.1:9' }) });
      const store = fs.readFileSync(path.join(B.dir, 'transit-peers.json'), 'utf8');
      check('a dashboard edit keeps the family out of the runtime store', store.includes(manual) && !store.includes(A.identity.id), store.slice(0, 200));

      const unauthorised = await publish(A, signed(4, [relay(A), relay(B)]), 'Basic ' + Buffer.from('admin:wrong-password-123').toString('base64'));
      check('the dashboard endpoint wants the password', unauthorised.status === 401, String(unauthorised.status));
      const intruder = newKey();
      const foreign = dir.signDirectory({ ...signed(5, [relay(A), relay(B)]).body, operator: { id: dir.operatorIdFor(spki(intruder.publicKey)), key: spki(intruder.publicKey), name: 'x' } }, intruder.privateKey);
      const refused = await publish(A, foreign);
      check('and refuses a directory from another operator, saying why', refused.ok === false && refused.reason === 'wrong-operator', JSON.stringify(refused));
    } finally {
      await stacks.stop();
    }
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  process.exit(failed ? 1 : 0);
}
