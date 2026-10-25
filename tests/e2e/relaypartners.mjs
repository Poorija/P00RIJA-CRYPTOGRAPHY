/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Partners: families of relays run by different operators, linked through
 * their gateways once an admin approves (docs/RELAY-NETWORK.md, "Linking
 * with other operators").
 *
 * "the rules" checks scripts/lib/relay-partners.js on its own: who may ask
 * to link and how a request is proved, how relays of one family agree on
 * shared state, which gateway carries, and when a relay may carry a frame on.
 *
 * "partners" runs real relays: family A (a1, its gateway, and a2) asks
 * family B (b1 and b2, both gateways) to link; B's admin approves on one
 * relay and the other agrees; only the gateways link across. A fake Telegram
 * stands in for B's alerts, and c1 is a lone relay that takes requests.
 *
 * "carry" runs A and B as partners: a client of a2 writes to a client of b2
 * through a1 and B's best gateway, which changes when b1 stops and changes
 * back only after b1's link has stood for the settle time; and a relay
 * pretending to be b1 shows what a partner's gateway may not send.
 *
 * "gateways" changes A's gateways from a dashboard: B follows without being
 * asked again, the old gateway hands over before it lets go, messages keep
 * arriving, and B finds the change by itself when no link could tell it.
 *
 * "common" has three families of one relay each, all partners of each
 * other, where A and C cannot reach each other: A's messages for C go through
 * B only when B allows it and only while A and C still name each other, and
 * a direct link that has stood for the settle time takes over again.
 *
 * "dashboard" reads the page a relay serves its admin: the controls for all
 * of this are there, in both languages, and its script still parses.
 *
 *   node tests/e2e/relaypartners.mjs            # every section
 *   node tests/e2e/relaypartners.mjs rules      # one of them
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createFleet, waitUntil, sleep, short, fetchJson } from './_relay-fleet.mjs';

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

const dirlib = require('../../scripts/lib/relay-directory.js');
const { sealTransit } = require('../../scripts/lib/relay-transit.js');

/* An operator: a key and directories it signs over named members. */
function operator(name) {
  const pair = newKey();
  const key = spki(pair.publicKey);
  const id = dirlib.operatorIdFor(key);
  return {
    name, key, id,
    sign: (members, serial = 1) => dirlib.signDirectory({
      v: 1, operator: { id, key, name }, serial, issuedAt: new Date().toISOString(),
      relays: members.map(({ relay, gateway = 0, region = 'outside-iran' }) => ({ id: relay.id, name: relay.name, origins: relay.origin ? [relay.origin] : [], region, gateway })),
      revoked: [],
    }, pair.privateKey),
  };
}
const FAST = {
  CHAT_DIRECTORY_PULL_MS: '3000', CHAT_PARTNER_PULL_MS: '3000', CHAT_JOIN_POLL_MS: '2000',
  CHAT_GATEWAY_STABLE_MS: '3000', CHAT_ALERT_INTERVAL_MS: '2000',
};

/* Families A (a1 its gateway, a2) and B (b1 gateway 1, b2 gateway 2),
   partners already: A asked from a2, B approved on b2. */
async function partneredFleet({ env = {} } = {}) {
  const A = operator('Alpha Ops');
  const B = operator('Bravo Ops');
  const fleet = await createFleet(['a1', 'a2', 'b1', 'b2'], {
    env: {
      a1: () => ({ ...FAST, CHAT_OPERATOR_KEY: A.key, ...(env.a1 || {}) }),
      a2: () => ({ ...FAST, CHAT_OPERATOR_KEY: A.key, ...(env.a2 || {}) }),
      b1: () => ({ ...FAST, CHAT_OPERATOR_KEY: B.key, ...(env.b1 || {}) }),
      b2: () => ({ ...FAST, CHAT_OPERATOR_KEY: B.key, ...(env.b2 || {}) }),
    },
  });
  const { a1, a2, b1, b2 } = fleet.relays;
  const docA = A.sign([{ relay: a1, gateway: 1 }, { relay: a2, region: 'inside-iran' }]);
  const docB = B.sign([{ relay: b1, gateway: 1 }, { relay: b2, gateway: 2 }]);
  await fleet.startAll();
  for (const [name, doc] of [['a1', docA], ['a2', docA], ['b1', docB], ['b2', docB]]) await fleet.post(name, '/Monitor_Server/directory', doc);
  await waitUntil(async () => (await fleet.linked('a1')).has(short(a2.id)) && (await fleet.linked('b1')).has(short(b2.id)));
  await fleet.post('a2', '/Monitor_Server/partners/request', { origin: b1.origin, operatorId: B.id });
  await waitUntil(async () => ((await fleet.post('b2', '/Monitor_Server/partners', {})).partners || []).some((entry) => entry.operatorId === A.id));
  await fleet.post('b2', '/Monitor_Server/partners/approve', { operatorId: A.id });
  const linked = await waitUntil(async () => { const up = await fleet.linked('a1'); return up.has(short(b1.id)) && up.has(short(b2.id)); }, 20000);
  if (!linked) throw new Error('the partner links never came up');
  const entryFor = async (name, operatorId) => ((await fleet.post(name, '/Monitor_Server/partners', {})).partners || []).find((entry) => entry.operatorId === operatorId);
  return { fleet, A, B, docA, docB, entryFor };
}

try {
  if (wants('rules')) {
    section('the rules');
    const dir = require('../../scripts/lib/relay-directory.js');
    const { relayIdFor } = require('../../scripts/lib/relay-identity.js');
    const rules = require('../../scripts/lib/relay-partners.js');

    /* A relay: its key pair, id and public key, as a relay holds them. */
    const relay = () => {
      const pair = newKey();
      const key = spki(pair.publicKey);
      return { pair, key, id: relayIdFor(key) };
    };
    /* A family: an operator key and a directory it signed. */
    const family = (name, members, { serial = 1 } = {}) => {
      const operator = newKey();
      const operatorKey = spki(operator.publicKey);
      const doc = dir.signDirectory({
        v: 1,
        operator: { id: dir.operatorIdFor(operatorKey), key: operatorKey, name },
        serial,
        issuedAt: new Date().toISOString(),
        relays: members.map(({ r, gateway = 0, origin = '' }) => ({ id: r.id, name: r.id.slice(0, 4), origins: origin ? [origin] : [], region: '', gateway })),
        revoked: [],
      }, operator.privateKey);
      return { operator, operatorKey, operatorId: doc.body.operator.id, doc };
    };

    const a1 = relay(); const a2 = relay(); const b1 = relay(); const stranger = relay();
    const A = family('A', [{ r: a1, gateway: 1, origin: 'https://a1.test' }, { r: a2 }]);
    const B = family('B', [{ r: b1, gateway: 1, origin: 'https://b1.test' }]);
    const now = Date.now();
    const request = (overrides = {}, signer = a2) => rules.signJoinRequest({
      directory: A.doc, from: a2.id, key: a2.key, to: B.operatorId, at: now,
      nonce: crypto.randomBytes(16).toString('hex'), contact: 'https://a2.test', ...overrides,
    }, signer.pair.privateKey);
    const verify = (req, opts = {}) => rules.verifyJoinRequest(req, { selfOperatorId: B.operatorId, now, nonceSeen: () => false, ...opts });

    const good = verify(request());
    check('a join request signed by a member of a family with a gateway is accepted',
      good.ok === true && good.operatorId === A.operatorId && good.operatorKey === A.operatorKey && good.name === 'A', JSON.stringify(good).slice(0, 160));

    const refusal = (name, req, want, opts) => {
      const verdict = verify(req, opts);
      check(name, verdict.ok === false && verdict.reason === want, JSON.stringify(verdict));
    };
    const noSig = request(); delete noSig.sig;
    refusal('a request without a signature is malformed', noSig, 'malformed');
    const badDir = request({ directory: { ...A.doc, sig: B.doc.sig } });
    refusal('a request whose directory does not verify is refused', badDir, 'bad-directory');
    refusal('a request from a relay outside its own directory is refused', request({ from: stranger.id, key: stranger.key }, stranger), 'not-a-member');
    refusal('a request whose key is not the sender’s is refused', request({ key: b1.key }), 'key-mismatch');
    const tampered = request(); tampered.nonce = crypto.randomBytes(16).toString('hex');
    refusal('a request changed after signing is refused', tampered, 'bad-signature');
    const moved = request(); moved.contact = 'https://elsewhere.test';
    refusal('a request whose contact address was changed after signing is refused', moved, 'bad-signature');
    refusal('a request meant for another operator is refused', request({ to: A.operatorId }), 'wrong-operator');
    refusal('a request older than ten minutes is refused', request({ at: now - 11 * 60 * 1000 }), 'stale');
    refusal('a request heard before is refused', request(), 'replayed', { nonceSeen: () => true });
    const noGateway = family('N', [{ r: a1 }, { r: a2 }]);
    refusal('a family without a gateway cannot ask', request({ directory: noGateway.doc }), 'no-gateway');

    const entry = (operatorId, state, updatedAt, updatedBy = 'a'.repeat(64)) => ({ operatorId, operatorKey: 'k', name: 'x', state, updatedAt, updatedBy });
    const opX = 'c'.repeat(64);
    const merged = rules.mergePartners({ [opX]: entry(opX, 'incoming', 100) }, [entry(opX, 'approved', 200)]);
    check('merging keeps the later entry and reports what changed', merged.held[opX].state === 'approved' && merged.changed.join() === opX, JSON.stringify(merged));
    const older = rules.mergePartners({ [opX]: entry(opX, 'approved', 200) }, [entry(opX, 'removed', 100)]);
    check('an older entry changes nothing', older.held[opX].state === 'approved' && older.changed.length === 0);
    const tie = rules.mergePartners({ [opX]: entry(opX, 'approved', 300, '1'.repeat(64)) }, [entry(opX, 'removed', 300, 'f'.repeat(64))]);
    check('equal times go to the larger relay id', tie.held[opX].state === 'removed');
    const withDir = (serial, updatedAt) => ({ ...entry(opX, 'approved', updatedAt), directory: { body: { serial }, sig: 's' } });
    const kept = rules.mergePartners({ [opX]: withDir(3, 100) }, [withDir(2, 200)]);
    check('merging never lowers a partner’s directory serial', kept.held[opX].updatedAt === 200 && kept.held[opX].directory.body.serial === 3, JSON.stringify(kept.held[opX]));
    const junk = rules.mergePartners({}, [entry('nope', 'approved', 1), entry(opX, 'owner', 1)]);
    check('a malformed entry is skipped', Object.keys(junk.held).length === 0 && junk.changed.length === 0, JSON.stringify(junk));

    const plain = rules.gatewaySet(A.doc.body, null);
    check('the gateway set follows the directory without an override',
      plain.length === 1 && plain[0].id === a1.id && plain[0].priority === 1 && plain[0].origins[0] === 'https://a1.test', JSON.stringify(plain));
    const over = rules.gatewaySet(A.doc.body, { gateways: [{ id: a2.id, priority: 1 }, { id: a1.id, priority: 2 }, { id: stranger.id, priority: 3 }], updatedAt: 1 });
    check('an override wins and ignores ids the directory does not name',
      over.map((g) => `${g.id.slice(0, 4)}:${g.priority}`).join() === `${a2.id.slice(0, 4)}:1,${a1.id.slice(0, 4)}:2`, JSON.stringify(over));

    const choose = (candidates) => rules.chooseGateway(candidates, { now: 1_000_000, stableMs: 60000 });
    check('the best gateway is one up for the settle time, then the lower number',
      choose([{ id: 'a', priority: 1, upSince: 1_000_000 - 10000 }, { id: 'b', priority: 2, upSince: 1_000_000 - 120000 }]) === 'b');
    check('with none settled the lower number wins',
      choose([{ id: 'b', priority: 2, upSince: 1_000_000 - 5000 }, { id: 'a', priority: 1, upSince: 1_000_000 - 1000 }]) === 'a');
    check('among settled ones the lower number wins',
      choose([{ id: 'b', priority: 2, upSince: 1 }, { id: 'a', priority: 1, upSince: 1 }]) === 'a');
    check('nothing up gives null', choose([{ id: 'a', priority: 1, upSince: 0 }]) === null);

    const opA = 'a'.repeat(64); const opC = 'c'.repeat(64);
    const lists = (map) => (operatorId) => new Set(map[operatorId] || []);
    const rule = (over) => rules.forwardRule({
      from: 'family', fromOperator: '', selfGateway: true, target: { family: 'partner', operator: opC }, hop: 1,
      carryBetween: false, partnerNames: lists({}), ...over,
    });
    const action = (verdict) => verdict.action + (verdict.operator ? `:${verdict.operator.slice(0, 1)}` : '');
    check('a gateway carries its family’s frame on to a partner', action(rule({})) === 'partner:c');
    check('a relay that is not a gateway does not', rule({ selfGateway: false }).action === 'reject');
    check('a partner’s frame for this family goes on to the family',
      action(rule({ from: 'partner', fromOperator: opA, target: { family: 'self' } })) === 'family');
    check('a partner’s frame for another partner is refused when this family does not carry between partners',
      rule({ from: 'partner', fromOperator: opA, carryBetween: false, partnerNames: lists({ [opA]: [opC], [opC]: [opA] }) }).action === 'reject');
    check('and carried when it does and the two named each other',
      action(rule({ from: 'partner', fromOperator: opA, carryBetween: true, partnerNames: lists({ [opA]: [opC], [opC]: [opA] }) })) === 'partner:c');
    check('but not when only one of them named the other',
      rule({ from: 'partner', fromOperator: opA, carryBetween: true, partnerNames: lists({ [opA]: [opC] }) }).action === 'reject');
    check('a frame from anybody else is refused', rule({ from: 'other' }).action === 'reject');
    check('a frame for nobody we know is refused', rule({ target: { family: 'none' } }).action === 'reject');
    check('a frame at hop 5 is refused', rule({ hop: 5 }).action === 'reject');
    check('a frame at hop 4 still goes on', action(rule({ hop: 4 })) === 'partner:c');
    check('a frame with a negative hop is refused', rule({ hop: -10 }).action === 'reject');
    check('a frame whose hop is not a whole number is refused', rule({ hop: 'x' }).action === 'reject' && rule({ hop: 1.5 }).action === 'reject');
    check('a frame from an older relay, with no hop at all, counts as the first', action(rule({ hop: undefined })) === 'partner:c');

    const notice = rules.signGatewayNotice({ operatorId: A.operatorId, gateways: [{ id: a2.id, priority: 1 }], updatedAt: 500 }, { id: a1.id, key: a1.key }, a1.pair.privateKey);
    const noticeOk = rules.verifyGatewayNotice(notice, { directoryBody: A.doc.body, heldAt: 100 });
    check('a gateway notice from a member verifies', noticeOk.ok === true && noticeOk.set.gateways[0].id === a2.id, JSON.stringify(noticeOk).slice(0, 160));
    const outsider = rules.signGatewayNotice({ operatorId: A.operatorId, gateways: [{ id: a2.id, priority: 1 }], updatedAt: 500 }, { id: stranger.id, key: stranger.key }, stranger.pair.privateKey);
    const outsiderVerdict = rules.verifyGatewayNotice(outsider, { directoryBody: A.doc.body, heldAt: 100 });
    check('a notice from a relay outside the directory is refused', outsiderVerdict.ok === false && outsiderVerdict.reason === 'not-a-member', JSON.stringify(outsiderVerdict));
    const forged = { ...notice, updatedAt: 900 };
    const forgedVerdict = rules.verifyGatewayNotice(forged, { directoryBody: A.doc.body, heldAt: 100 });
    check('a notice changed after signing is refused', forgedVerdict.ok === false && forgedVerdict.reason === 'bad-signature', JSON.stringify(forgedVerdict));
    const staleVerdict = rules.verifyGatewayNotice(notice, { directoryBody: A.doc.body, heldAt: 600 });
    check('an older notice than the held one is stale', staleVerdict.ok === false && staleVerdict.reason === 'stale', JSON.stringify(staleVerdict));

    const sign = (fields) => rules.signGatewayNotice({ operatorId: A.operatorId, updatedAt: 500, ...fields }, { id: a1.id, key: a1.key }, a1.pair.privateKey);
    const future = rules.verifyGatewayNotice(sign({ gateways: [{ id: a2.id, priority: 1 }], updatedAt: Date.now() + 60 * 60 * 1000 }), { directoryBody: A.doc.body, heldAt: 0 });
    check('a gateway notice stamped far in the future is refused', future.ok === false && future.reason === 'future', JSON.stringify(future));
    const outside = rules.verifyGatewayNotice(sign({ gateways: [{ id: stranger.id, priority: 1 }] }), { directoryBody: A.doc.body, heldAt: 0 });
    const badPriority = rules.verifyGatewayNotice(sign({ gateways: [{ id: a2.id, priority: 0 }] }), { directoryBody: A.doc.body, heldAt: 0 });
    const tooMany = rules.verifyGatewayNotice(sign({ gateways: Array.from({ length: 65 }, () => ({ id: a2.id, priority: 1 })) }), { directoryBody: A.doc.body, heldAt: 0 });
    check('a notice naming a relay outside the directory, a bad priority, or too many gateways is refused',
      outside.reason === 'malformed' && badPriority.reason === 'malformed' && tooMany.reason === 'malformed', JSON.stringify([outside, badPriority, tooMany]));
    const extra = rules.verifyGatewayNotice(rules.signGatewayNotice({ operatorId: A.operatorId, updatedAt: 500, gateways: [{ id: a2.id, priority: 1 }] }, { id: a1.id, key: a1.key }, a1.pair.privateKey), { directoryBody: A.doc.body, heldAt: 0 });
    check('a notice is kept as ids and priorities only', extra.ok && JSON.stringify(extra.set.gateways) === JSON.stringify([{ id: a2.id, priority: 1 }]));

    const farFuture = rules.mergePartners({}, [entry(opX, 'approved', Date.now() + 60 * 60 * 1000)]);
    check('a shared entry stamped far in the future is skipped', farFuture.changed.length === 0);
    check('a gateway choice stamped far in the future is not well formed',
      rules.validOverride({ gateways: [{ id: a1.id, priority: 1 }], updatedAt: Date.now() + 60 * 60 * 1000, updatedBy: 'x' }) === false
        && rules.validOverride({ gateways: [{ id: a1.id, priority: 1 }], updatedAt: Date.now(), updatedBy: 'x' }) === true
        && rules.validOverride({ gateways: null, updatedAt: Date.now(), updatedBy: 'x' }) === true
        && rules.validOverride({ gateways: [{ id: 'zz', priority: 1 }], updatedAt: Date.now(), updatedBy: 'x' }) === false);

    const safe = (origin, options) => rules.safePartnerOrigin(origin, options);
    const privateOnes = ['http://127.0.0.1:8585', 'http://10.0.0.5', 'https://192.168.1.1', 'http://169.254.169.254', 'http://localhost:9000',
      'http://[::1]:8585', 'http://172.16.0.1', 'http://[fc00::1]', 'http://0.0.0.0', 'http://100.64.0.1', 'http://relay.localhost'];
    check('a partner’s origin at a private, loopback or link-local address is refused', privateOnes.every((origin) => safe(origin) === ''), JSON.stringify(privateOnes.map((origin) => safe(origin))));
    check('a public one is kept as its origin', safe('https://fl.example.com:8585/some/path') === 'https://fl.example.com:8585' && safe('http://93.113.238.213:8585') === 'http://93.113.238.213:8585');
    check('other schemes and credentials are refused', safe('ftp://fl.example.com') === '' && safe('https://u:p@fl.example.com') === '' && safe('not a url') === '');
    check('a private one is allowed only when the relay is told to', safe('http://127.0.0.1:8585', { allowPrivate: true }) === 'http://127.0.0.1:8585');
    const embedded = ['http://[64:ff9b::a00:1]', 'http://[2002:a00:1::]', 'http://[2001:0:1::1]', 'http://[::10.0.0.1]', 'http://[::ffff:10.0.0.1]', 'http://relay:8585', 'http://box.internal', 'http://printer.local'];
    check('addresses that carry a private one inside (NAT64, 6to4, Teredo, mapped) and local names are refused too', embedded.every((origin) => safe(origin) === ''), JSON.stringify(embedded.map((origin) => safe(origin))));

    /* The dial path's lookup: a partner's host is resolved once, refused
       when any answer is private, and dialled at the address checked. */
    const fakeResolver = (answers) => async () => answers;
    const lookupWith = (answers, partner) => new Promise((resolve) => {
      const lookup = rules.guardedLookup({ resolve: fakeResolver(answers), isPartnerHost: () => partner, allowPrivate: false });
      lookup('relay.example', {}, (error, address) => resolve(error ? `error:${error.code}` : address));
    });
    check('a partner host resolving to a private address is not dialled', await lookupWith([{ address: '10.0.0.7', family: 4 }], true) === 'error:EPRIVATE');
    check('nor one with a private answer among public ones', await lookupWith([{ address: '93.113.238.213', family: 4 }, { address: '127.0.0.1', family: 4 }], true) === 'error:EPRIVATE');
    check('a partner host with public answers is dialled at the one checked', await lookupWith([{ address: '93.113.238.213', family: 4 }], true) === '93.113.238.213');
    check('a host no partner named resolves as before', await lookupWith([{ address: '10.0.0.7', family: 4 }], false) === '10.0.0.7');

    /* A family's partner list, signed by the relay that says it, so a common
       partner can pass it on without being able to change it. */
    const opB = 'b'.repeat(64);
    const listOf = (fields, by = a1) => rules.signPartnerList({ operatorId: A.operatorId, operators: [opB, opC], carries: false, updatedAt: 700, ...fields }, { id: by.id, key: by.key }, by.pair.privateKey);
    const listOk = rules.verifyPartnerList(listOf({}), { directoryBody: A.doc.body, heldAt: 0 });
    check('a partner list signed by a member verifies', listOk.ok === true && listOk.list.operators.has(opB) && listOk.list.carries === false, JSON.stringify(listOk).slice(0, 160));
    check('one signed by a relay outside the directory is refused', rules.verifyPartnerList(listOf({}, stranger), { directoryBody: A.doc.body, heldAt: 0 }).reason === 'not-a-member');
    const editedList = { ...listOf({}), operators: [opB] };
    check('one changed on the way is refused', rules.verifyPartnerList(editedList, { directoryBody: A.doc.body, heldAt: 0 }).reason === 'bad-signature');
    check('an older one than held is stale, a future one refused',
      rules.verifyPartnerList(listOf({}), { directoryBody: A.doc.body, heldAt: 800 }).reason === 'stale'
        && rules.verifyPartnerList(listOf({ updatedAt: Date.now() + 3600000 }), { directoryBody: A.doc.body, heldAt: 0 }).reason === 'future');
    check('a list longer than 256 operators is refused', rules.verifyPartnerList(listOf({ operators: Array.from({ length: 257 }, (_, i) => i.toString(16).padStart(64, '0')) }), { directoryBody: A.doc.body, heldAt: 0 }).reason === 'malformed');

    const heldList = { ...listOk.list, by: a1.id, receivedAt: 1000 };
    check('a held partner list is used while fresh and from a relay still in the directory',
      rules.freshList(heldList, { now: 5000, maxAgeMs: 10000, directoryBody: A.doc.body }) === heldList);
    check('an old one is treated as missing', rules.freshList(heldList, { now: 20000, maxAgeMs: 10000, directoryBody: A.doc.body }) === null);
    check('freshness counts from the time the list was signed, not when it arrived, so an old list sent again stays old',
      rules.freshList({ ...heldList, receivedAt: 19000 }, { now: 20000, maxAgeMs: 10000, directoryBody: A.doc.body }) === null);
    const aged = rules.verifyPartnerList(listOf({ updatedAt: Date.now() - 3600000 }), { directoryBody: A.doc.body, heldAt: 0, maxAgeMs: 60000 });
    check('a list signed longer ago than the maximum age is refused on arrival', aged.ok === false && aged.reason === 'stale', JSON.stringify(aged));
    check('so is one said by a relay the directory no longer names',
      rules.freshList({ ...heldList, by: stranger.id }, { now: 5000, maxAgeMs: 10000, directoryBody: A.doc.body }) === null);
    const through = (throughList, targetList) => rules.commonPartnerOk({ through: opB, target: opC, throughList, targetList });
    const carriesC = { operators: new Set([opC]), carries: true };
    check('a common partner is used only when it carries, names the far family, and the far family’s own list names it',
      through(carriesC, { operators: new Set([opB]) }) === true
        && through({ ...carriesC, carries: false }, { operators: new Set([opB]) }) === false
        && through({ operators: new Set(), carries: true }, { operators: new Set([opB]) }) === false
        && through(carriesC, { operators: new Set() }) === false
        && through(carriesC, null) === false);

    /* What one relay of a family hands another about a partner must be
       about the operator whose directory it carries. */
    const consistent = { operatorId: A.operatorId, operatorKey: A.operatorKey, directory: A.doc, state: 'approved' };
    check('a shared partner entry about the operator its directory names is consistent', rules.partnerEntryConsistent(consistent) === true);
    check('one filed under another operator’s id is not', rules.partnerEntryConsistent({ ...consistent, operatorId: B.operatorId }) === false);
    check('nor one whose key is another operator’s', rules.partnerEntryConsistent({ ...consistent, operatorKey: B.operatorKey }) === false);
    check('nor one whose directory does not verify', rules.partnerEntryConsistent({ ...consistent, directory: { ...A.doc, sig: B.doc.sig } }) === false);
    check('an entry with no directory yet (a bare state change) passes on its id alone',
      rules.partnerEntryConsistent({ operatorId: A.operatorId, state: 'removed' }) === true && rules.partnerEntryConsistent({ operatorId: 'zz', state: 'removed' }) === false);

    const day = 24 * 60 * 60 * 1000;
    const heavy = { directory: A.doc, contact: 'https://x.test', operatorKey: A.operatorKey, name: 'x' };
    const pruned = rules.prunePartners({
      [opA]: { operatorId: opA, state: 'removed', updatedAt: 1, updatedBy: 'r', ...heavy },
      [opB]: { operatorId: opB, state: 'rejected', updatedAt: 1, updatedBy: 'r', mutedUntil: 2, ...heavy },
      [opC]: { operatorId: opC, state: 'rejected', updatedAt: 1, updatedBy: 'r', mutedUntil: 100 * day, ...heavy },
      ['d'.repeat(64)]: { operatorId: 'd'.repeat(64), state: 'approved', updatedAt: 1, updatedBy: 'r', ...heavy },
    }, { now: 60 * day, keepMs: 30 * day });
    check('disconnected and rejected partners shrink to a tombstone 30 days on, once their mute is over',
      JSON.stringify(pruned[opA]) === JSON.stringify({ operatorId: opA, state: 'removed', updatedAt: 1, updatedBy: 'r' })
        && pruned[opB].state === 'rejected' && !pruned[opB].directory
        && Boolean(pruned[opC].directory) && Boolean(pruned['d'.repeat(64)].directory), JSON.stringify(pruned[opA]));
    const revived = rules.mergePartners(pruned, [{ operatorId: opA, state: 'approved', updatedAt: 0, updatedBy: 'z', ...heavy }]);
    check('and the tombstone still beats an older “approved” a relay brings back after a long time away', revived.held[opA].state === 'removed' && revived.changed.length === 0);

    const first = rules.retainGateways(null, ['x'], { now: 1000, handoffMs: 5000 });
    const second = rules.retainGateways(first, ['y'], { now: 4000, handoffMs: 5000 });
    check('a handoff window is never extended by a later change', first.until === 6000 && second.until === 6000 && second.ids.has('x') && second.ids.has('y'), JSON.stringify({ first: first.until, second: second.until }));
    const after = rules.retainGateways(second, ['z'], { now: 7000, handoffMs: 5000 });
    check('a change after the window opens a new one', after.until === 12000 && after.ids.has('z') && !after.ids.has('x'));
  }

  if (wants('partners')) {
    section('partners: requests, approval, gateway links');
    const rules = require('../../scripts/lib/relay-partners.js');
    const { relayIdFor } = require('../../scripts/lib/relay-identity.js');

    const TOKEN = '123456:partners-suite-token';
    const sent = [];
    const telegram = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (req.url === `/bot${TOKEN}/sendMessage`) {
          try { sent.push(JSON.parse(body)); } catch (_error) { /* not JSON */ }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise((resolve) => telegram.listen(0, '127.0.0.1', resolve));
    const notices = (word) => sent.map((message) => String(message.text || '')).filter((text) => text.includes(word));

    /* A relay that exists only to sign requests: a family nobody runs. */
    const paperFamily = (name) => {
      const pair = newKey();
      const key = spki(pair.publicKey);
      const relay = { id: relayIdFor(key), key, name: `${name}-gw`, origin: '', pair };
      const op = operator(name);
      return { op, relay, doc: op.sign([{ relay, gateway: 1 }]) };
    };
    const joinRequest = (family, to, contact = 'https://paper.test') => rules.signJoinRequest({
      directory: family.doc, from: family.relay.id, key: family.relay.key, to, at: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'), contact,
    }, family.relay.pair.privateKey);

    const A = operator('Alpha Ops');
    const B = operator('Bravo Ops');
    const C = operator('Charlie Ops');
    const fleet = await createFleet(['a1', 'a2', 'b1', 'b2', 'c1'], {
      env: {
        a1: () => ({ ...FAST, CHAT_OPERATOR_KEY: A.key }),
        a2: () => ({ ...FAST, CHAT_OPERATOR_KEY: A.key }),
        b1: () => ({
          ...FAST, CHAT_OPERATOR_KEY: B.key,
          TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: `http://127.0.0.1:${telegram.address().port}`, CHAT_ALERT_TELEGRAM_CHAT_ID: '424242',
        }),
        b2: () => ({ ...FAST, CHAT_OPERATOR_KEY: B.key }),
        c1: () => ({ ...FAST, CHAT_OPERATOR_KEY: C.key, CHAT_JOIN_WAITING_MAX: '3', CHAT_JOIN_PER_HOUR: '100', CHAT_PARTNER_ALLOW_PRIVATE: '0' }),
      },
    });
    const { a1, a2, b1, b2, c1 } = fleet.relays;
    const docA = A.sign([{ relay: a1, gateway: 1 }, { relay: a2, region: 'inside-iran' }]);
    const docB = B.sign([{ relay: b1, gateway: 1 }, { relay: b2, gateway: 2 }]);
    const docC = C.sign([{ relay: c1, gateway: 1 }]);
    const partnersOf = async (name) => (await fleet.post(name, '/Monitor_Server/partners', {})).partners || [];
    const entryFor = async (name, operatorId) => (await partnersOf(name)).find((entry) => entry.operatorId === operatorId);
    try {
      await fleet.startAll();
      for (const [name, doc] of [['a1', docA], ['a2', docA], ['b1', docB], ['b2', docB], ['c1', docC]]) {
        await fleet.post(name, '/Monitor_Server/directory', doc);
      }
      const families = await waitUntil(async () => (await fleet.linked('a1')).has(short(a2.id)) && (await fleet.linked('b1')).has(short(b2.id)));
      check('each family meshes from its directory', families);

      const look = await fleet.post('a2', '/Monitor_Server/partners/lookup', { origin: b1.origin });
      check('looking up B from A’s dashboard shows B’s operator, relays and gateways',
        look.ok === true && look.operator?.id === B.id && look.operator?.name === 'Bravo Ops' && look.relays === 2
          && (look.gateways || []).map((gateway) => `${gateway.id}:${gateway.priority}`).join() === `${b1.id}:1,${b2.id}:2`,
        JSON.stringify(look).slice(0, 300));

      const asked = await fleet.post('a2', '/Monitor_Server/partners/request', { origin: b1.origin, operatorId: B.id });
      check('A asks B to link', asked.ok === true && asked.state === 'requested', JSON.stringify(asked));
      const waitingOnB = await waitUntil(async () => (await entryFor('b1', A.id))?.state === 'incoming' && (await entryFor('b2', A.id))?.state === 'incoming');
      check('the request reaches B and waits there, on every B relay', waitingOnB, JSON.stringify(await entryFor('b2', A.id)));
      const noticed = await waitUntil(() => notices('Alpha Ops').length >= 1, 15000);
      await sleep(3000);
      check('the request raised one notice, from the relay it reached', noticed && notices('Alpha Ops').length === 1, JSON.stringify(sent.map((m) => m.text)).slice(0, 400));
      check('the notice names who asks and where to answer, and no address',
        notices('Alpha Ops')[0]?.includes(A.id.slice(0, 12)) && !/\d+\.\d+\.\d+\.\d+/.test(notices('Alpha Ops')[0] || ''), notices('Alpha Ops')[0]);

      const allowA1 = await waitUntil(async () => { const allowed = await fleet.allowed('a1'); return allowed.has(short(b1.id)) && allowed.has(short(b2.id)); });
      check('A’s gateway allows B’s gateways once A asked', allowA1, JSON.stringify([...await fleet.allowed('a1')]));
      check('B’s gateways do not allow A yet', !(await fleet.allowed('b1')).has(short(a1.id)) && !(await fleet.allowed('b2')).has(short(a1.id)));

      const approved = await fleet.post('b2', '/Monitor_Server/partners/approve', { operatorId: A.id });
      check('B’s admin approves on b2', approved.ok === true && approved.state === 'approved', JSON.stringify(approved));
      check('and b1 agrees', await waitUntil(async () => (await entryFor('b1', A.id))?.state === 'approved'));
      const crossLinks = await waitUntil(async () => { const linked = await fleet.linked('a1'); return linked.has(short(b1.id)) && linked.has(short(b2.id)); }, 20000);
      check('the gateway links come up: a1–b1 and a1–b2', crossLinks, JSON.stringify([...await fleet.linked('a1')]));
      const a2Allowed = await fleet.allowed('a2');
      check('a2, not a gateway, allows nobody outside its family', [...a2Allowed].every((id) => id === short(a1.id)), JSON.stringify([...a2Allowed]));
      const b2Allowed = await fleet.allowed('b2');
      check('B allows only A’s gateway from A', b2Allowed.has(short(a1.id)) && !b2Allowed.has(short(a2.id)), JSON.stringify([...b2Allowed]));
      check('the link standing turns A’s request into a partnership, seen on a2',
        await waitUntil(async () => (await entryFor('a2', B.id))?.state === 'approved'), JSON.stringify(await entryFor('a2', B.id)));

      /* Review Focus 1: B's directory, serial 2, also claims a2. */
      await fleet.post('b1', '/Monitor_Server/directory', B.sign([{ relay: b1, gateway: 1 }, { relay: b2, gateway: 2 }, { relay: a2 }], 2));
      const heard = await waitUntil(async () => (await entryFor('a1', B.id))?.serial === 2, 20000);
      const believed = (await entryFor('a1', B.id))?.relayIds || [];
      check('a partner directory claiming one of our relays is not believed for it',
        heard && believed.includes(short(b1.id)) && !believed.includes(short(a2.id)), JSON.stringify(await entryFor('a1', B.id)).slice(0, 300));

      const paper = paperFamily('Paper Ops');
      const first = joinRequest(paper, B.id);
      const tampered = { ...first, nonce: crypto.randomBytes(16).toString('hex') };
      const forged = await fleet.post('b1', '/relay-join', tampered, null);
      check('a forged request is refused, saying why', forged.status === 400 && forged.reason === 'bad-signature', JSON.stringify(forged));
      const stored = await fleet.post('b1', '/relay-join', first, null);
      check('a good one is taken and waits', stored.status === 202 && stored.state === 'incoming' && /^[a-f0-9]{32}$/.test(stored.requestId || ''), JSON.stringify(stored));
      const again = await fleet.post('b1', '/relay-join', first, null);
      check('the same request again is refused as replayed', again.status === 400 && again.reason === 'replayed', JSON.stringify(again));
      const status = await fleet.get('b1', `/relay-join/${stored.requestId}`);
      check('its status answers waiting, and nothing more', status.status === 200 && status.state === 'waiting' && Object.keys(status).sort().join() === 'ok,state,status', JSON.stringify(status));
      await fleet.post('b1', '/Monitor_Server/partners/reject', { operatorId: paper.op.id });
      const beforeMute = notices('Paper Ops').length;
      const muted = await fleet.post('b1', '/relay-join', joinRequest(paper, B.id), null);
      await sleep(3000);
      check('a rejected operator asking again is stored as rejected, without a notice',
        muted.status === 202 && muted.state === 'rejected' && notices('Paper Ops').length === beforeMute && beforeMute === 1, JSON.stringify({ muted, beforeMute, after: notices('Paper Ops').length }));
      check('and its status says rejected', (await fleet.get('b1', `/relay-join/${muted.requestId}`)).state === 'rejected');

      /* A family's newer directory revokes p2; p2 then asks with the old one. */
      const p1 = paperFamily('Papa Ops');
      const p2pair = newKey();
      const p2 = { id: relayIdFor(spki(p2pair.publicKey)), key: spki(p2pair.publicKey), name: 'p2', origin: '', pair: p2pair };
      const oldDoc = p1.op.sign([{ relay: p1.relay, gateway: 1 }, { relay: p2 }], 1);
      /* Serial 2 no longer names p2 (dropped, as good as revoked for asking). */
      const revokedDoc = p1.op.sign([{ relay: p1.relay, gateway: 1 }], 2);
      const ask = (doc, relay) => rules.signJoinRequest({
        directory: doc, from: relay.id, key: relay.key, to: B.id, at: Date.now(),
        nonce: crypto.randomBytes(16).toString('hex'), contact: 'https://papa.test',
      }, relay.pair.privateKey);
      const fresh = await fleet.post('b1', '/relay-join', ask(revokedDoc, p1.relay), null);
      const rollback = await fleet.post('b1', '/relay-join', ask(oldDoc, p2), null);
      const olderFromMember = await fleet.post('b1', '/relay-join', ask(oldDoc, p1.relay), null);
      check('a relay its family has since dropped cannot ask with the old directory',
        fresh.status === 202 && rollback.status === 400 && rollback.reason === 'not-a-member', JSON.stringify({ fresh, rollback }));
      check('and an older directory never replaces the newer one held',
        olderFromMember.status === 202 && (await entryFor('b1', p1.op.id))?.serial === 2, JSON.stringify({ olderFromMember, held: (await entryFor('b1', p1.op.id))?.serial }));

      /* A peer the admin named by hand stays theirs, whatever a partner's
         directory says about it. */
      const quebec = paperFamily('Quebec Ops');
      await fleet.post('c1', '/Monitor_Server/transit-add', { id: quebec.relay.id, origin: 'http://manual.test' });
      const quebecDoc = quebec.op.sign([{ relay: { ...quebec.relay, origin: 'http://partner.test' }, gateway: 1 }]);
      const quebecAsk = rules.signJoinRequest({
        directory: quebecDoc, from: quebec.relay.id, key: quebec.relay.key, to: C.id, at: Date.now(),
        nonce: crypto.randomBytes(16).toString('hex'), contact: 'https://quebec.test',
      }, quebec.relay.pair.privateKey);
      const quebecIn = await fleet.post('c1', '/relay-join', quebecAsk, null);
      await fleet.post('c1', '/Monitor_Server/partners/approve', { operatorId: quebec.op.id });
      await sleep(500);
      const manualPeer = ((await fleet.transit('c1')).peers || []).find((peer) => peer.id === short(quebec.relay.id));
      await fleet.post('c1', '/Monitor_Server/transit-add', { id: 'e'.repeat(64) });
      await fleet.post('c1', '/Monitor_Server/transit-remove', { id: 'e'.repeat(64) });
      const c1Store = fs.readFileSync(path.join(c1.dir, 'transit-peers.json'), 'utf8');
      check('a partner directory does not take over a peer named by hand',
        quebecIn.status === 202 && manualPeer?.origin === 'http://manual.test' && manualPeer?.kind === 'manual' && c1Store.includes(quebec.relay.id),
        JSON.stringify({ quebecIn: quebecIn.status, manualPeer, stored: c1Store.includes(quebec.relay.id) }));

      /* The dashboard's own lookup and request keep to the same rule. */
      const lookPrivate = await fleet.post('c1', '/Monitor_Server/partners/lookup', { origin: b1.origin });
      const askPrivate = await fleet.post('c1', '/Monitor_Server/partners/request', { origin: b1.origin, operatorId: B.id });
      check('a relay that keeps off private addresses will not look one up or ask one either',
        lookPrivate.status === 400 && lookPrivate.reason === 'bad-origin' && askPrivate.status === 400, JSON.stringify({ lookPrivate, askPrivate }));

      /* A partner whose gateway sits at a private address is never dialled
         there: c1 answers it and nothing more. */
      const romeo = paperFamily('Romeo Ops');
      const romeoDoc = romeo.op.sign([{ relay: { ...romeo.relay, origin: 'http://10.0.0.5:8585' }, gateway: 1 }]);
      const romeoIn = await fleet.post('c1', '/relay-join', rules.signJoinRequest({
        directory: romeoDoc, from: romeo.relay.id, key: romeo.relay.key, to: C.id, at: Date.now(),
        nonce: crypto.randomBytes(16).toString('hex'), contact: 'https://romeo.test',
      }, romeo.relay.pair.privateKey), null);
      await fleet.post('c1', '/Monitor_Server/partners/approve', { operatorId: romeo.op.id });
      await sleep(500);
      const romeoPeer = ((await fleet.transit('c1')).peers || []).find((peer) => peer.id === short(romeo.relay.id));
      check('a partner gateway at a private address is allowed to call in but never dialled there',
        romeoIn.status === 202 && romeoPeer?.kind === 'partner' && romeoPeer.origin === '', JSON.stringify({ romeoIn: romeoIn.status, romeoPeer }));

      /* A partner relay that answers with megabytes: cut off at the cap. */
      const huge = { asked: false, finished: false, closedEarly: false };
      const bigServer = http.createServer((req, res) => {
        if (req.url !== '/relay-gateways') { res.writeHead(404).end(); return; }
        huge.asked = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"v":1,"pad":"');
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        let sent = 0;
        const pump = () => {
          if (sent >= 4 * 1024 * 1024) { res.end('"}'); huge.finished = true; return; }
          sent += chunk.length;
          if (res.write(chunk)) setImmediate(pump); else res.once('drain', pump);
        };
        res.on('close', () => { huge.closedEarly = !huge.finished; });
        pump();
      });
      await new Promise((resolve) => bigServer.listen(0, '127.0.0.1', resolve));
      const sierra = paperFamily('Sierra Ops');
      const sierraDoc = sierra.op.sign([{ relay: { ...sierra.relay, origin: `http://127.0.0.1:${bigServer.address().port}` }, gateway: 1 }]);
      await fleet.post('b1', '/relay-join', rules.signJoinRequest({
        directory: sierraDoc, from: sierra.relay.id, key: sierra.relay.key, to: B.id, at: Date.now(),
        nonce: crypto.randomBytes(16).toString('hex'), contact: 'https://sierra.test',
      }, sierra.relay.pair.privateKey), null);
      await fleet.post('b1', '/Monitor_Server/partners/approve', { operatorId: sierra.op.id });
      const capped = await waitUntil(() => huge.asked && (huge.closedEarly || huge.finished), 15000);
      const alive = (await fleet.get('b1', '/chat-health')).status === 200;
      check('a partner relay answering with megabytes is cut off at the cap, not read to the end', capped && huge.closedEarly && alive, JSON.stringify({ ...huge, alive }));
      await fleet.post('b1', '/Monitor_Server/partners/remove', { operatorId: sierra.op.id });
      bigServer.close();

      /* Review Focus 2. */
      let lastFlood = null;
      for (let i = 0; i < 11; i += 1) lastFlood = await fleet.post('b2', '/relay-join', { v: 1, junk: i }, null);
      check('the 11th request from one address in an hour is refused', lastFlood.status === 429, JSON.stringify(lastFlood));
      const waiting = [];
      for (let i = 0; i < 4; i += 1) waiting.push(await fleet.post('c1', '/relay-join', joinRequest(paperFamily(`Queue ${i}`), C.id), null));
      check('past the waiting cap a request is refused and nothing is stored',
        waiting.slice(0, 3).every((answer) => answer.status === 202) && waiting[3].status === 409 && waiting[3].reason === 'too-many-waiting'
          && (await partnersOf('c1')).filter((entry) => entry.state === 'incoming').length === 3, JSON.stringify(waiting.map((answer) => answer.status)));
      const noGateway = await fleet.post('a2', '/relay-join', joinRequest(paperFamily('Late Ops'), A.id), null);
      check('a family asked through a relay that is not its gateway still takes the request', noGateway.status === 202, JSON.stringify(noGateway));

      /* Review Focus 4. */
      await fleet.stop('a1');
      await fleet.start('a1');
      const back = await waitUntil(async () => { const linked = await fleet.linked('a1'); return linked.has(short(b1.id)) && linked.has(short(b2.id)); }, 20000);
      check('a restarted gateway keeps its partners and links again', back && (await entryFor('a1', B.id))?.state === 'approved');

      await fleet.post('a1', '/Monitor_Server/transit-add', { id: 'e'.repeat(64) });
      await fleet.post('a1', '/Monitor_Server/transit-remove', { id: 'e'.repeat(64) });
      const store = fs.readFileSync(path.join(a1.dir, 'transit-peers.json'), 'utf8');
      check('the runtime peer store never holds a partner’s gateway', !store.includes(b1.id) && !store.includes(b2.id), store.slice(0, 200));

      const removed = await fleet.post('a1', '/Monitor_Server/partners/remove', { operatorId: B.id });
      const cut = await waitUntil(async () => {
        const fromA = await fleet.linked('a1');
        const fromB = await fleet.linked('b1');
        return !fromA.has(short(b1.id)) && !fromA.has(short(b2.id)) && !fromB.has(short(a1.id));
      });
      check('removing on A closes every cross-family link on both sides', removed.ok === true && cut);
      check('and a2 agrees B is removed', await waitUntil(async () => (await entryFor('a2', B.id))?.state === 'removed'));
      check('family links stand throughout', (await fleet.linked('a1')).has(short(a2.id)) && (await fleet.linked('b1')).has(short(b2.id)));
    } finally {
      await fleet.stopAll();
      telegram.close();
    }
  }

  if (wants('carry')) {
    section('carry: across families, through the gateways');
    const ids = require('../../scripts/lib/relay-identity.js');
    const { createRelayPeers, makeIdentityFetcher } = require('../../scripts/lib/relay-peers.js');
    const { WebSocket } = require('ws');
    const { fleet, A, B, entryFor } = await partneredFleet();
    const { a1, a2, b1, b2 } = fleet.relays;
    const clients = [];
    try {
      const listed = await waitUntil(async () => {
        const peers = (await fleet.get('a2', '/transit-peers')).peers || [];
        return [b1, b2].every((relay) => peers.some((peer) => peer.id === relay.id && peer.key === relay.key));
      }, 15000);
      check('a2’s /transit-peers lists B’s relays with their keys, reached through its gateway', listed, JSON.stringify((await fleet.get('a2', '/transit-peers')).peers).slice(0, 300));

      const sender = fleet.client('a2', 'sender-on-a2');
      const recipient = fleet.client('b2', 'recipient-on-b2');
      clients.push(sender, recipient);
      await sender.ready;
      await recipient.ready;
      await sleep(800);
      let count = 0;
      const send = (to, tag, extra = {}) => {
        count += 1;
        const inner = { type: 'relay', toFingerprint: recipient.identity.fingerprint, persist: true, tag, payload: { type: 'offline-chat', inner: `hello-${tag}` }, ...extra };
        sender.send({ ...sealTransit(to.id, to.key, inner), tag });
      };
      const attempt = (promise) => promise.catch((error) => ({ error: error.message }));

      send(b2, 'm1');
      const answer = await attempt(sender.waitFor((message) => message.tag === 'm1', 15000));
      const got = await attempt(recipient.waitFor((message) => message.type === 'relay' && message.payload?.inner === 'hello-m1', 15000));
      check('a client on a2 writes to a client on b2 and the answer comes back',
        answer?.type === 'queued' && answer.known === true && got?.payload?.inner === 'hello-m1', JSON.stringify({ answer, got }).slice(0, 300));

      sender.send({ ...sealTransit(b2.id, b2.key, { type: 'route-query', toFingerprint: recipient.identity.fingerprint }), tag: 'r1' });
      const route = await attempt(sender.waitFor((message) => message.tag === 'r1', 15000));
      check('the route question from a2 finds the person living on b2', route?.type === 'route' && route.home === true, JSON.stringify(route));

      await waitUntil(async () => (await entryFor('a1', B.id))?.carrying === short(b1.id), 8000);
      check('a1 carries through b1, B’s first gateway, once its link has stood', (await entryFor('a1', B.id))?.carrying === short(b1.id), JSON.stringify(await entryFor('a1', B.id)).slice(0, 300));

      await fleet.stop('b1');
      const moved = await waitUntil(async () => (await entryFor('a1', B.id))?.carrying === short(b2.id), 3000, 100);
      check('b1 down: a1 carries through b2 at once', moved, JSON.stringify(await entryFor('a1', B.id)).slice(0, 300));
      send(b2, 'm2');
      const second = await attempt(recipient.waitFor((message) => message.type === 'relay' && message.payload?.inner === 'hello-m2', 15000));
      check('and messages still arrive', second?.payload?.inner === 'hello-m2', JSON.stringify(second));

      await fleet.start('b1');
      await waitUntil(async () => (await fleet.linked('a1')).has(short(b1.id)), 30000, 100);
      const stillB2 = (await entryFor('a1', B.id))?.carrying;
      const backToB1 = await waitUntil(async () => (await entryFor('a1', B.id))?.carrying === short(b1.id), 8000, 200);
      check('b1 back: it carries again only after its link has stood for the settle time', stillB2 === short(b2.id) && backToB1, JSON.stringify({ stillB2, now: (await entryFor('a1', B.id))?.carrying }));

      /* Review Focus 5: b2 gone, so b1 parks what a1 hands it for b2. */
      await fleet.stop('b2');
      await sleep(500);
      const sentAt = Date.now();
      send(b2, 'p1');
      await sleep(800);
      const early = sender.inbox.find((message) => message.tag === 'p1');
      const removedAt = Date.now();
      await fleet.post('a2', '/Monitor_Server/partners/remove', { operatorId: B.id });
      const parked = await attempt(sender.waitFor((message) => message.tag === 'p1', 15000));
      const took = Date.now() - removedAt;
      check('removing B while an envelope waits answers it at once, as transit-unavailable so the app sends it again',
        !early && parked?.type === 'error' && parked.reason === 'transit-unavailable' && took < 3000, JSON.stringify({ early, parked, took, waited: removedAt - sentAt }));

      /* Review Focus 3: B a partner again, then b1 replaced by a relay that
         holds its key. */
      const again = await fleet.post('a2', '/Monitor_Server/partners/request', { origin: b1.origin, operatorId: B.id });
      check('asking again after a disconnect links at once while B still approves A', again.state === 'approved', JSON.stringify(again));
      await waitUntil(async () => (await fleet.linked('a1')).has(short(b1.id)), 20000);
      await fleet.stop('b1');
      const frames = [];
      const fake = createRelayPeers({
        identity: ids.publicRelayIdentity(b1.identity),
        privateKey: ids.relayPrivateKey(b1.identity),
        pqPrivateKey: ids.relayPqPrivateKey(b1.identity),
        allowlist: [a1.id],
        WebSocketImpl: WebSocket,
        fetchIdentity: makeIdentityFetcher({ verifyTls: false }),
        verifyTls: false,
        log: { log() {}, warn() {}, error() {} },
        onFrame: (payload) => frames.push(payload),
      });
      try {
        /* b1 stopped, so B's directory and approval come from a1's store:
           A still allows b1 as long as B is requested or approved. */
        const entry = await entryFor('a1', B.id);
        await fleet.post('a1', '/Monitor_Server/transit', {});
        fake.dial(a1.id, a1.origin).catch(() => {});
        const up = await waitUntil(() => Boolean(fake.linkFor(a1.id)), 15000, 100);
        check('the stand-in for b1 links with a1', up, JSON.stringify(entry || {}).slice(0, 200));
        const before = JSON.stringify({ partners: (await fleet.post('a1', '/Monitor_Server/partners', {})).partners, directory: (await fleet.transit('a1')).directory?.serial });
        const link = fake.linkFor(a1.id);
        link.send({ kind: 'partners', entries: [{ operatorId: 'd'.repeat(64), operatorKey: 'k', name: 'Injected', state: 'approved', updatedAt: Date.now() + 1e9, updatedBy: 'f'.repeat(64) }], override: null, carryBetween: null });
        link.send({ kind: 'reach', relays: [{ id: 'e'.repeat(64), key: 'k', origin: 'http://x.test', operatorId: B.id, operatorName: 'B' }] });
        link.send({ kind: 'directory', doc: { body: { serial: 99 }, sig: 'x' } });
        link.send({ kind: 'alert', id: 'abc', text: 'injected alert' });
        await sleep(1500);
        const after = JSON.stringify({ partners: (await fleet.post('a1', '/Monitor_Server/partners', {})).partners, directory: (await fleet.transit('a1')).directory?.serial });
        const peersA2 = (await fleet.get('a2', '/transit-peers')).peers || [];
        check('a partner gateway’s partners, reach, directory and alert frames change nothing',
          before === after && !after.includes('Injected') && !peersA2.some((peer) => peer.id === 'e'.repeat(64)) && !a1.output.includes('injected alert'), after.slice(0, 200));
        const stranger = ids.generateRelayIdentity();
        link.send({ kind: 'transit', ref: 'x1', envelope: sealTransit(stranger.id, ids.publicRelayIdentity(stranger).publicKey, { type: 'presence-query', toFingerprint: 'ab'.repeat(32) }), hop: 1 });
        link.send({ kind: 'transit', ref: 'x2', envelope: sealTransit(a2.id, a2.key, { type: 'presence-query', toFingerprint: 'ab'.repeat(32) }), hop: 5 });
        link.send({ kind: 'transit', ref: 'x3', envelope: sealTransit(a2.id, a2.key, { type: 'presence-query', toFingerprint: 'ab'.repeat(32) }), hop: 1 });
        await waitUntil(() => ['x1', 'x2', 'x3'].every((ref) => frames.some((frame) => frame.kind === 'transit-result' && frame.ref === ref)), 10000, 100);
        const result = (ref) => frames.find((frame) => frame.kind === 'transit-result' && frame.ref === ref)?.answer || {};
        check('a frame from a partner for a relay of nobody’s family is refused', result('x1').reason === 'transit-rejected', JSON.stringify(result('x1')));
        check('a frame at the hop limit is refused', result('x2').reason === 'transit-rejected', JSON.stringify(result('x2')));
        check('a frame for A’s own relay goes on to it and is answered', result('x3').type === 'presence', JSON.stringify(result('x3')));
      } finally {
        fake.close();
      }
    } finally {
      for (const client of clients) client.close();
      await fleet.stopAll();
    }
  }

  if (wants('gateways')) {
    section('gateways: chosen in the dashboard');
    const { verifyGatewayNotice } = require('../../scripts/lib/relay-partners.js');
    const { fleet, A, B, docA } = await partneredFleet({ env: { a1: { CHAT_GATEWAY_HANDOFF_MS: '8000' }, a2: { CHAT_GATEWAY_HANDOFF_MS: '8000' }, b1: { CHAT_GATEWAY_HANDOFF_MS: '8000' }, b2: { CHAT_GATEWAY_HANDOFF_MS: '8000' } } });
    const { a1, a2, b1, b2 } = fleet.relays;
    const clients = [];
    const selfGateways = async (name) => ((await fleet.post(name, '/Monitor_Server/partners', {})).self?.gateways || []).map((gateway) => `${gateway.id}:${gateway.priority}`).join();
    try {
      const sender = fleet.client('b2', 'sender-on-b2');
      const recipient = fleet.client('a1', 'recipient-on-a1');
      clients.push(sender, recipient);
      await sender.ready;
      await recipient.ready;
      await sleep(800);
      /* One message a second from b2 to a client of a1, through the change. */
      let n = 0;
      const tags = [];
      const sentAt = new Map();
      const ticker = setInterval(() => {
        n += 1;
        const tag = `g${n}`;
        tags.push(tag);
        sentAt.set(tag, Date.now());
        sender.send({ ...sealTransit(a1.id, a1.key, { type: 'relay', toFingerprint: recipient.identity.fingerprint, persist: true, tag, payload: { type: 'offline-chat', inner: tag } }), tag });
      }, 1000);

      await sleep(2500);
      const changed = await fleet.post('a2', '/Monitor_Server/gateways', { gateways: [{ id: a2.id, priority: 1 }] });
      const changedAt = Date.now();
      check('the admin makes a2 the gateway on a2’s dashboard', changed.ok === true, JSON.stringify(changed));
      check('a1 agrees within 5 s', await waitUntil(async () => (await selfGateways('a1')) === `${short(a2.id)}:1`, 5000, 200), await selfGateways('a1'));
      let a2LinkedAt = 0;
      const a2Linked = await waitUntil(async () => {
        const linked = await fleet.linked('a2');
        if (linked.has(short(b1.id)) && linked.has(short(b2.id))) { a2LinkedAt = a2LinkedAt || Date.now(); return true; }
        return false;
      }, 15000, 200);
      check('B allows a2 without a new approval, and a2’s links with B come up', a2Linked);
      let a1GoneAt = 0;
      const a1Gone = await waitUntil(async () => {
        const linked = await fleet.linked('a1');
        if (!linked.has(short(b1.id)) && !linked.has(short(b2.id))) { a1GoneAt = a1GoneAt || Date.now(); return true; }
        return false;
      }, 15000, 200);
      check('a1 lets go of B only once a2’s links stand', a1Gone && a2LinkedAt && a2LinkedAt <= a1GoneAt, JSON.stringify({ a2: a2LinkedAt - changedAt, a1: a1GoneAt - changedAt }));
      await sleep(5000);
      clearInterval(ticker);
      await sleep(12000);
      const missing = tags.filter((tag) => !recipient.inbox.some((message) => message.type === 'relay' && message.payload?.inner === tag));
      const afterChange = tags.filter((tag) => sentAt.get(tag) >= changedAt).length;
      check('messages keep arriving through the change', afterChange >= 5 && missing.length === 0, JSON.stringify({ sent: tags.length, afterChange, missing }));

      const reset = await fleet.post('a1', '/Monitor_Server/gateways', { reset: true });
      check('“use the deploy settings” returns to the directory’s gateways', reset.ok === true
        && await waitUntil(async () => (await selfGateways('a2')) === `${short(a1.id)}:1`, 5000, 200), await selfGateways('a2'));
      check('and a1 links with B again', await waitUntil(async () => (await fleet.linked('a1')).has(short(b1.id)), 20000, 200));

      const notice = await fleet.get('a1', '/relay-gateways');
      const verified = verifyGatewayNotice(notice, { directoryBody: docA.body, heldAt: 0 });
      check('every relay serves the family’s gateways, signed by itself', notice.status === 200 && verified.ok === true && verified.set.gateways[0].id === a1.id, JSON.stringify(verified).slice(0, 200));
      check('a gateway set naming a relay outside the directory is refused',
        (await fleet.post('a1', '/Monitor_Server/gateways', { gateways: [{ id: 'f'.repeat(64), priority: 1 }] })).status === 400);

      /* No link to B can carry the next change: a1, the only gateway, is down. */
      await fleet.stop('a1');
      await waitUntil(async () => !(await fleet.linked('b1')).has(short(a1.id)), 10000, 200);
      await fleet.post('a2', '/Monitor_Server/gateways', { gateways: [{ id: a2.id, priority: 1 }] });
      const pulled = await waitUntil(async () => { const linked = await fleet.linked('a2'); return linked.has(short(b1.id)); }, 25000, 300);
      check('B finds the change at /relay-gateways when no link could tell it', pulled);
      await fleet.start('a1');
    } finally {
      for (const client of clients) client.close();
      await fleet.stopAll();
    }
  }

  if (wants('common')) {
    section('common: through a partner both share');
    const A = operator('Alpha Ops');
    const B = operator('Bravo Ops');
    const C = operator('Charlie Ops');
    const fleet = await createFleet(['a', 'b', 'c'], {
      env: {
        a: () => ({ ...FAST, CHAT_OPERATOR_KEY: A.key }),
        b: () => ({ ...FAST, CHAT_OPERATOR_KEY: B.key }),
        c: () => ({ ...FAST, CHAT_OPERATOR_KEY: C.key }),
      },
    });
    const { a, b, c } = fleet.relays;
    /* Nobody can dial a or c at the address their directories give. */
    const dead = 'http://127.0.0.1:9';
    const docA = A.sign([{ relay: { ...a, origin: dead }, gateway: 1 }]);
    const docB = B.sign([{ relay: b, gateway: 1 }]);
    const docC = C.sign([{ relay: { ...c, origin: dead }, gateway: 1 }]);
    const entryFor = async (name, operatorId) => ((await fleet.post(name, '/Monitor_Server/partners', {})).partners || []).find((entry) => entry.operatorId === operatorId);
    const clients = [];
    try {
      await fleet.startAll();
      await fleet.post('a', '/Monitor_Server/directory', docA);
      await fleet.post('b', '/Monitor_Server/directory', docB);
      await fleet.post('c', '/Monitor_Server/directory', docC);
      const ask = async (from, to, op, approver, opFrom) => {
        await fleet.post(from, '/Monitor_Server/partners/request', { origin: fleet.relays[to].origin, operatorId: op.id });
        await waitUntil(async () => Boolean(await entryFor(approver, opFrom.id)));
        await fleet.post(approver, '/Monitor_Server/partners/approve', { operatorId: opFrom.id });
      };
      await ask('a', 'b', B, 'b', A);
      await ask('c', 'b', B, 'b', C);
      await ask('a', 'c', C, 'c', A);
      const ready = await waitUntil(async () => {
        const fromB = await fleet.linked('b');
        return fromB.has(short(a.id)) && fromB.has(short(c.id)) && (await entryFor('a', C.id))?.state === 'approved';
      }, 25000);
      check('A–B and C–B link, A and C approve each other but have no link', ready && !(await fleet.linked('a')).has(short(c.id)), JSON.stringify(await entryFor('a', C.id)).slice(0, 200));

      const sender = fleet.client('a', 'sender-on-a');
      const recipient = fleet.client('c', 'recipient-on-c');
      clients.push(sender, recipient);
      await sender.ready;
      await recipient.ready;
      await sleep(800);
      const send = (tag) => sender.send({ ...sealTransit(c.id, c.key, { type: 'relay', toFingerprint: recipient.identity.fingerprint, persist: true, tag, payload: { type: 'offline-chat', inner: tag } }), tag });
      const attempt = (promise) => promise.catch((error) => ({ error: error.message }));

      send('off');
      const off = await attempt(sender.waitFor((message) => message.tag === 'off', 20000));
      check('with B’s setting off, A’s message for C is refused', off?.type === 'error', JSON.stringify(off));

      const turnedOn = await fleet.post('b', '/Monitor_Server/partners/carry', { on: true });
      check('B’s admin turns on carrying between partners', turnedOn.ok === true && turnedOn.on === true, JSON.stringify(turnedOn));
      await waitUntil(async () => (await entryFor('a', C.id))?.path === `via:${B.id.slice(0, 16)}`, 10000);
      send('via');
      const via = await attempt(sender.waitFor((message) => message.tag === 'via', 15000));
      const arrived = await attempt(recipient.waitFor((message) => message.type === 'relay' && message.payload?.inner === 'via', 15000));
      check('with it on, A’s message reaches C through B', via?.type === 'queued' && arrived?.payload?.inner === 'via', JSON.stringify({ via, arrived }).slice(0, 300));
      check('and A’s dashboard shows the path through B', (await entryFor('a', C.id))?.path === `via:${B.id.slice(0, 16)}`, JSON.stringify(await entryFor('a', C.id)).slice(0, 300));

      /* C becomes dialable; A hears of it by asking C again. */
      await fleet.post('c', '/Monitor_Server/directory', C.sign([{ relay: c, gateway: 1 }], 2));
      await fleet.post('a', '/Monitor_Server/partners/request', { origin: c.origin, operatorId: C.id });
      const linkedDirect = await waitUntil(async () => (await fleet.linked('a')).has(short(c.id)), 20000, 200);
      const pathRightAfter = (await entryFor('a', C.id))?.path;
      const direct = await waitUntil(async () => (await entryFor('a', C.id))?.path === 'direct', 8000, 200);
      check('a direct A–C link takes over once it has stood for the settle time',
        linkedDirect && pathRightAfter === `via:${B.id.slice(0, 16)}` && direct, JSON.stringify({ linkedDirect, pathRightAfter, now: (await entryFor('a', C.id))?.path }));
      send('direct');
      const directAnswer = await attempt(sender.waitFor((message) => message.tag === 'direct', 15000));
      check('and messages go direct', directAnswer?.type === 'queued', JSON.stringify(directAnswer));

      /* C no longer approves A: B must refuse to carry between them. */
      await fleet.post('c', '/Monitor_Server/partners/remove', { operatorId: A.id });
      await waitUntil(async () => !(await fleet.linked('a')).has(short(c.id)), 10000, 200);
      await sleep(1500);
      send('gone');
      const gone = await attempt(sender.waitFor((message) => message.tag === 'gone', 20000));
      const leaked = recipient.inbox.some((message) => message.type === 'relay' && message.payload?.inner === 'gone');
      check('once C stops approving A, B refuses to carry between them, even with the setting on', gone?.type === 'error' && !leaked, JSON.stringify(gone));
    } finally {
      for (const client of clients) client.close();
      await fleet.stopAll();
    }
  }

  if (wants('dashboard')) {
    section('dashboard: the controls');
    const fleet = await createFleet(['solo']);
    try {
      await fleet.startAll();
      const page = await fetch(`${fleet.relays.solo.origin}/Monitor_Server`, { headers: { Authorization: 'Basic ' + Buffer.from('admin:Local-Test-Only-Password-36').toString('base64') } }).then((r) => r.text());
      const ids = ['tPartners', 'tPartnersStatus', 'tPartnersMissing', 'tPartnersTable', 'tPartnerOrigin', 'tPartnerLookup', 'tPartnerFound', 'tPartnerSend', 'tCarryBetween', 'tGatewaysSave', 'tGatewaysReset', 'tGatewaysHint'];
      const missingIds = ids.filter((id) => !page.includes(`id="${id}"`));
      check('the relays tab has the other-operators card and the gateway controls', missingIds.length === 0, missingIds.join(', '));
      check('the family table offers a gateway choice per relay', page.includes('data-gw-id'));
      const broken = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => {
        try { new vm.Script(match[1]); return ''; } catch (error) { return error.message; }
      }).filter(Boolean);
      check('every inline script on the page parses', broken.length === 0, broken.join('; ').slice(0, 200));
      const keys = ['partners', 'partnersHint', 'partnersNoFamily', 'partnersNoGateway', 'lookup', 'sendRequest', 'carryBetween', 'colLinks', 'colPath',
        'stRequested', 'stIncoming', 'stLinked', 'stApproved', 'stRejected', 'stRemoved', 'approve', 'reject', 'cancelReq', 'disconnect',
        'confirmApprove', 'confirmReject', 'confirmDisconnect', 'confirmSend', 'confirmCarryOn', 'pathDirect', 'pathVia', 'gwSave', 'gwReset',
        'gwFromDashboard', 'gwFromDeploy', 'gwInsideIran', 'gwNoneLeft', 'confirmGwReset', 'noPartners'];
      const half = keys.filter((key) => (page.match(new RegExp(`[{,\\s]${key}:'`, 'g')) || []).length !== 2);
      check('every new string is there in Persian and in English', half.length === 0, half.join(', '));
      check('without a gateway the card says how to set one', /partnersNoGateway:'[^']*deploy\.conf/.test(page));
    } finally {
      await fleet.stopAll();
    }
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  process.exit(failed ? 1 : 0);
}
