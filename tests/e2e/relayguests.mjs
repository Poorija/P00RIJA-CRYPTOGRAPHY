/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Guest mode on the relays (scripts/lib/relay-guests.js and its wiring in
 * scripts/server.js), driven by clients that prove their key as the app does.
 *
 * "lib"      the pure parts: signed statements, blinded roster copies, the
 *            guest book, and who may be taken in;
 * "relay"    a family relay takes a guest in or refuses, never as a resident;
 * "rosters"  device rosters reach the family sealed, keep a revoked device
 *            out, and a successor signed during a stay reaches home;
 * "mail"     what waited on the guest relay goes home with the guest, what
 *            still arrives follows for seven days, and guest mail ages out;
 * "notice"   a home filtered for one person hands their mail to the guest
 *            relay on a notice only their key can sign; guest-status;
 * "push"     the guest relay wakes a guest; home stays quiet for a device that
 *            is a guest elsewhere, and wakes it again once the stay ends;
 * "siblings" two devices of one account on two guest relays both get mail;
 * "move"     a person whose home is filtered for them moves it to the guest
 *            relay: signed with their key, refused when forged or replayed;
 *            the old home hands over, forwards, and tells the other devices;
 *
 *   node tests/e2e/relayguests.mjs            # every section
 *   node tests/e2e/relayguests.mjs lib        # one of them
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { relayTestIdentity } from './_relay-identity.mjs';
import { createFleet, waitUntil } from './_relay-fleet.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const dirlib = require(path.join(ROOT, 'scripts', 'lib', 'relay-directory.js'));
const { sealTransit } = require(path.join(ROOT, 'scripts', 'lib', 'relay-transit.js'));
const { textFor } = require(path.join(ROOT, 'scripts', 'lib', 'telegram-text.js'));

const ONLY = new Set(process.argv.slice(2));
const wants = (name) => !ONLY.size || ONLY.has(name);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (n) => crypto.randomBytes(n).toString('hex');

/* A statement signed with an identity key, as the app signs one. */
function signStatement(identity, statement) {
  const sig = crypto.sign('sha256', Buffer.from(dirlib.canonicalJson(statement)), identity.privateKey).toString('base64');
  return { statement, sig, publicKeyData: identity.publicKeyData };
}


/* Relays of one operator's family, linked by their signed list. */
const operatorPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const operatorKey = operatorPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const operatorId = dirlib.operatorIdFor(operatorKey);
const fleets = [];
async function familyFleet(names, { guests = {}, env = {}, clusters = {} } = {}) {
  const fleet = await createFleet(names, {
    env: Object.fromEntries(names.map((name) => [name, (f) => ({
      CHAT_OPERATOR_KEY: operatorKey, CHAT_ALERTS: '0',
      ...(typeof env[name] === 'function' ? env[name](f) : (env[name] || {})),
    })])),
  });
  fleets.push(fleet);
  fleet.sign = (serial = 1, extra = {}) => dirlib.signDirectory({
    v: 1, serial, operator: { id: operatorId, key: operatorKey, name: 'Test family' },
    relays: names.map((name) => ({
      id: fleet.relays[name].id, name, origins: [fleet.relays[name].origin], region: 'outside-iran', gateway: 0,
      ...(clusters[name] ? { cluster: clusters[name] } : {}), ...((extra.guests || guests)[name] ? { guests: true } : {}),
    })),
    revoked: [], signedAt: new Date().toISOString(),
  }, operatorPair.privateKey);
  const doc = fleet.sign(1);
  for (const name of names) fs.writeFileSync(path.join(fleet.relays[name].dir, 'relay-directory.json'), JSON.stringify(doc));
  await fleet.startAll();
  fleet.allLinked = () => waitUntil(async () => {
    for (const name of names) {
      const linked = await fleet.linked(name);
      if (names.filter((other) => other !== name && fleet.relays[other].child?.exitCode === null).some((other) => !linked.has(fleet.relays[other].id.slice(0, 16)))) return false;
    }
    return true;
  }, 30000);
  await fleet.allLinked();
  return fleet;
}
/* A question sealed to a relay, asked through a client of another. */
let askCounter = 0;
async function ask(client, relay, inner) {
  const tag = `q${askCounter += 1}`;
  client.send({ ...sealTransit(relay.id, relay.key, { ...inner, tag }), tag });
  return client.waitFor((message) => message.tag === tag && message.type !== 'queued', 15000);
}
const proven = (client) => client.waitFor((message) => message.type === 'peers' || message.type === 'roster' || message.type === 'guest-ok' || message.type === 'guest-refused', 15000);

/* A device roster as js/chat/58-device-roster.js signs one: the primary's
   P-256 key, certified by the identity key, signs the whole. */
const devicePair = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spkiOf = (pair) => pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
function makeRoster(identity, { seq, primaryId, primaryPair, members = [], revoked = [], signerPair = primaryPair }) {
  const fp = identity.fingerprint;
  const primary = { d: primaryId, k: spkiOf(primaryPair), n: 'test device' };
  const cert = crypto.sign('sha256', Buffer.from(`poorija-roster-primary|${fp}|${primary.d}|${primary.k}`), identity.privateKey).toString('base64');
  const roster = {
    v: 1, fp, seq, at: Date.now(), primary, cert,
    members: [{ ...primary, at: Date.now() }, ...members], revoked, signer: spkiOf(signerPair),
  };
  const text = 'poorija-roster|1|' + JSON.stringify([
    roster.fp, roster.seq, roster.at, [primary.d, primary.k, primary.n], roster.cert,
    roster.members.map((member) => [member.d, member.k, member.n, member.at]),
    roster.revoked.map((entry) => [entry.d, entry.k, entry.at, entry.why]), roster.signer,
  ]);
  roster.sig = crypto.sign('sha256', Buffer.from(text), { key: signerPair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  return roster;
}

const cleanup = [];
try {
  /* ---- lib ------------------------------------------------------------------- */
  if (wants('lib')) {
    section('lib: statements, roster copies, the guest book, admission');
    const guests = require(path.join(ROOT, 'scripts', 'lib', 'relay-guests.js'));
    const me = relayTestIdentity();
    const other = relayTestIdentity();
    const H = hex(32); const G = hex(32);
    const now = Date.now();
    const notice = { v: 1, type: 'guest-at', fp: me.fingerprint, deviceId: 'dev-1', home: H, guest: G, at: now, until: now + 24 * 3600 * 1000 };
    const verify = (signed, type, at = now) => guests.verifyIdentityStatement(signed, { type, now: at });
    check('a guest notice signed by the account verifies', verify(signStatement(me, notice), 'guest-at').ok === true);
    const flipped = signStatement(me, notice);
    flipped.statement = { ...notice, deviceId: 'dev-2' };
    check('a changed field breaks it', verify(flipped, 'guest-at').reason === 'bad-signature');
    check('another key is not this fingerprint', verify({ ...signStatement(me, notice), publicKeyData: other.publicKeyData }, 'guest-at').reason === 'key-not-fp');
    check('a notice past its time has expired', verify(signStatement(me, notice), 'guest-at', now + 25 * 3600 * 1000).reason === 'expired');
    check('a notice longer than a day is malformed', verify(signStatement(me, { ...notice, until: now + 26 * 3600 * 1000 }), 'guest-at').reason === 'malformed');
    check('a statement of another type is refused', verify(signStatement(me, { ...notice, type: 'home-move' }), 'guest-at').reason === 'wrong-type');
    check('garbage is malformed, not a throw', verify({ statement: null, sig: 5, publicKeyData: {} }, 'guest-at').reason === 'malformed'
      && verify({ statement: { ...notice, home: 'zz' }, sig: 'x', publicKeyData: me.publicKeyData }, 'guest-at').reason === 'malformed');
    const move = { v: 1, type: 'home-move', fp: me.fingerprint, from: H, to: G, at: now };
    check('a move signed by the account verifies', verify(signStatement(me, move), 'home-move').ok === true);
    check('a move to where it already is is malformed', verify(signStatement(me, { ...move, to: H }), 'home-move').reason === 'malformed');
    check('a move more than a week old has expired', verify(signStatement(me, move), 'home-move', now + 8 * 24 * 3600 * 1000).reason === 'expired');
    const route = { v: 1, type: 'guest-route', fp: me.fingerprint, guest: G, until: now + 24 * 3600 * 1000 };
    check('a route statement verifies, and carries nothing but fp, guest and until', verify(signStatement(me, route), 'guest-route').ok === true
      && verify(signStatement(me, { ...route, deviceId: 'x' }), 'guest-route').reason === 'malformed' && verify(signStatement(me, route), 'guest-route', now + 25 * 3600 * 1000).reason === 'expired');

    const roster = { v: 1, fp: me.fingerprint, seq: 4, at: now, members: [{ d: 'dev-1' }] };
    const copy = guests.sealRosterCopy(me.fingerprint, roster, me.publicKeyData);
    const opened = guests.openRosterCopy(me.fingerprint, copy);
    check('a roster copy opens with its fingerprint, with the identity key', JSON.stringify(opened?.roster) === JSON.stringify(roster) && opened?.publicKeyData === me.publicKeyData);
    check('its index is not the fingerprint, and differs per account', copy.i === guests.rosterCopyIndex(me.fingerprint) && copy.i !== me.fingerprint
      && copy.i !== guests.rosterCopyIndex(other.fingerprint) && !JSON.stringify(copy).includes(me.fingerprint) && !JSON.stringify(copy).includes('dev-1'));
    check('another fingerprint cannot open it', guests.openRosterCopy(other.fingerprint, copy) === null);
    const tampered = { ...copy, ct: Buffer.from(Buffer.from(copy.ct, 'base64').map((b, i) => (i === 3 ? b ^ 1 : b))).toString('base64') };
    check('a tampered copy does not open', guests.openRosterCopy(me.fingerprint, tampered) === null);
    check('a copy whose seq is not its roster’s does not open', guests.openRosterCopy(me.fingerprint, { ...copy, seq: 9 }) === null);
    check('a copy sealed with a key that is not the account’s does not open', guests.openRosterCopy(me.fingerprint, guests.sealRosterCopy(me.fingerprint, roster, other.publicKeyData)) === null);
    check('garbage does not open, and does not throw', guests.openRosterCopy(me.fingerprint, { i: 'x', seq: 'y', iv: 3 }) === null && guests.openRosterCopy(me.fingerprint, null) === null);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-guestbook-'));
    cleanup.push(dir);
    const file = path.join(dir, 'guests.json');
    let clock = now;
    const book = guests.createGuestBook({ file, now: () => clock, ttlMs: 1000, forwardMs: 5000 });
    book.admit({ fp: me.fingerprint, deviceId: 'a', home: H });
    book.admit({ fp: me.fingerprint, deviceId: 'b', home: H });
    check('a guest is a guest, from its home', book.isGuest(me.fingerprint) && book.homeOf(me.fingerprint) === H && book.devices(me.fingerprint).sort().join() === 'a,b');
    const first = book.end(me.fingerprint, 'a');
    check('ending one device is not the last', first.last === false && book.isGuest(me.fingerprint));
    const second = book.end(me.fingerprint, 'b');
    check('ending the last starts forwarding home', second.last === true && second.home === H && !book.isGuest(me.fingerprint) && book.forwarding(me.fingerprint)?.relay === H);
    clock += 6000;
    check('forwarding ends after its time', book.forwarding(me.fingerprint) === null);
    book.admit({ fp: other.fingerprint, deviceId: 'c', home: H });
    clock += 1500;
    const swept = book.sweep();
    check('a guest not seen within the record’s time is ended by the sweep', swept.ended.some((entry) => entry.fp === other.fingerprint && entry.home === H)
      && !book.isGuest(other.fingerprint) && book.forwarding(other.fingerprint)?.relay === H);
    book.noteRemote({ fp: me.fingerprint, deviceId: 'a', guest: G, until: clock + 1000 });
    book.noteRemote({ fp: me.fingerprint, deviceId: 'b', guest: G, until: clock - 1 });
    check('a remote guest is held until its time', book.remoteFor(me.fingerprint).map((entry) => entry.deviceId).join() === 'a');
    book.noteMoved(me.fingerprint, G, 3000);
    book.save();
    const again = guests.createGuestBook({ file, now: () => clock, ttlMs: 1000, forwardMs: 5000 });
    check('the book reloads as it was', again.forwarding(other.fingerprint)?.relay === H && again.remoteFor(me.fingerprint).length === 1 && again.movedTo(me.fingerprint) === G);
    again.dropRemote(me.fingerprint);
    check('remote records go', again.remoteFor(me.fingerprint).length === 0);
    again.noteMoveAt(me.fingerprint, clock - 5);
    check('the newest move taken is remembered, for replays', again.moveAtOf(me.fingerprint) === clock - 5 && again.moveAtOf(other.fingerprint) === 0);
    again.noteMoved(me.fingerprint, G, 3000, { statement: { to: G }, sig: 's' });
    again.notePendingMove(other.fingerprint, H, { statement: { from: H }, sig: 's' }, 3000);
    check('a move keeps its statement, and a move not yet handed home waits', again.movedStatement(me.fingerprint)?.sig === 's'
      && again.pendingMoves().some((entry) => entry.fp === other.fingerprint && entry.home === H));
    again.clearPendingMove(other.fingerprint);
    check('a handed-on move stops waiting', again.pendingMoves().length === 0);
    again.admit({ fp: me.fingerprint, deviceId: 'q', home: H });
    again.dropGuests(me.fingerprint);
    check('a move drops its guest records without forwarding anything home', !again.isGuest(me.fingerprint) && again.forwarding(me.fingerprint) === null);
    again.noteFloor(me.fingerprint, 'a', clock);
    check('a notice floor is kept per device, and reloads', again.floorOf(me.fingerprint, 'a') === clock && again.floorOf(me.fingerprint, 'b') === 0
      && guests.createGuestBook({ file, now: () => clock }).floorOf(me.fingerprint, 'a') === clock);
    const fresh = guests.createGuestBook({ file: path.join(dir, 'broken.json'), now: () => clock });
    fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
    check('a broken file is an empty book', guests.createGuestBook({ file: path.join(dir, 'broken.json'), now: () => clock }).isGuest(me.fingerprint) === false && fresh.isGuest('x') === false);

    const store = guests.createRosterCopyStore({ dir: path.join(dir, 'copies'), now: () => clock, ttlMs: 10000 });
    const A = hex(32); const B = hex(32);
    const real = guests.sealRosterCopy(me.fingerprint, roster, me.publicKeyData);
    store.keep(real, A);
    store.keep({ ...real, seq: 999, ct: Buffer.from('garbage-garbage-garbage').toString('base64') }, B);
    const held = store.copies(real.i);
    check('a copy with a huge seq from another relay does not push out the real one', held.length === 2 && held.some((entry) => entry.from === A && entry.copy.seq === 4));
    check('copies come newest first', held[0].copy.seq === 999);
    store.keep({ ...real, seq: 3 }, A);
    check('a relay cannot go back on its own copy', store.copies(real.i).find((entry) => entry.from === A)?.copy.seq === 4);
    store.keep({ ...real, seq: 1000, ct: 'AAAA' }, A);
    check('a relay replaces only its own slot', store.copies(real.i).length === 2 && store.copies(real.i).find((entry) => entry.from === B)?.copy.seq === 999);
    check('a malformed copy or sender is not kept', store.keep({ i: 'zz', seq: 1 }, A) === false && store.keep(real, 'not-an-id') === false);
    clock += 20000;
    store.sweep();
    check('copies go after their time', store.copies(real.i).length === 0);

    const S = hex(32);
    const family = { relays: [{ id: S, guests: true }, { id: H }, { id: G }], revoked: [] };
    const refuse = (patch = {}) => guests.guestRefusal({ directory: family, selfId: S, guestOf: H, guestSockets: 0, wsMax: 100, share: 0.3, deviceRevoked: false, ...patch });
    check('a family relay\'s guest is taken in', refuse() === '');
    check('a relay that does not take guests says off', refuse({ directory: { ...family, relays: [{ id: S }, { id: H }] } }) === 'off');
    check('no directory at all is off', refuse({ directory: null }) === 'off');
    check('a home outside the family, or this relay, or malformed, is not-family', refuse({ guestOf: hex(32) }) === 'not-family' && refuse({ guestOf: S }) === 'not-family' && refuse({ guestOf: 'zz' }) === 'not-family');
    check('a revoked home is not-family', refuse({ directory: { relays: family.relays, revoked: [H] } }) === 'not-family');
    check('the guest share full is full', refuse({ guestSockets: 30 }) === 'full' && refuse({ guestSockets: 29 }) === '' && refuse({ share: 0 }) === 'full');
    check('a revoked device is revoked', refuse({ deviceRevoked: true }) === 'revoked');
    check('a book already holding four times the guest room is full for newcomers', refuse({ bookEntries: 120 }) === 'full' && refuse({ bookEntries: 119 }) === '');
    check('but a guest already in the book comes back in', refuse({ bookEntries: 500, known: true }) === '');

    const capped = guests.createGuestBook({ file: path.join(dir, 'capped.json'), now: () => clock });
    for (let n = 0; n < 9; n += 1) { clock += 1; capped.admit({ fp: me.fingerprint, deviceId: `d${n}`, home: H }); }
    check('one account holds at most eight guest devices, the oldest going first', capped.devices(me.fingerprint).length === 8 && !capped.devices(me.fingerprint).includes('d0'));
    const crowd = guests.createGuestBook({ file: path.join(dir, 'crowd.json'), now: () => clock });
    crowd.admit({ fp: me.fingerprint, deviceId: 'idle', home: H });
    clock += 20 * 60 * 1000;
    crowd.admit({ fp: other.fingerprint, deviceId: 'fresh', home: H });
    const keptIdle = crowd.evictStale({ olderThanMs: 10 * 60 * 1000, connected: (fp) => fp === me.fingerprint, max: 5 });
    check('a guest still connected is never evicted', keptIdle.length === 0 && crowd.isGuest(me.fingerprint));
    const evicted = crowd.evictStale({ olderThanMs: 10 * 60 * 1000, connected: () => false, max: 5 });
    check('an idle guest is evicted, a recent one kept, and its mail sent home', evicted.length === 1 && evicted[0].fp === me.fingerprint && evicted[0].home === H
      && !crowd.isGuest(me.fingerprint) && crowd.isGuest(other.fingerprint) && crowd.forwarding(me.fingerprint)?.relay === H);
    check('too many newcomers from one place is full', refuse({ newcomerLimited: true }) === 'full' && refuse({ newcomerLimited: true, known: true }) === '');
    const busy = guests.createGuestBook({ file: path.join(dir, 'busy.json'), now: () => clock, saveDelayMs: 60000 });
    const many = Array.from({ length: 5000 }, (_, n) => crypto.createHash('sha256').update(`g${n}`).digest('hex'));
    for (const fp of many) busy.admit({ fp, deviceId: 'd', home: H });
    const started = process.hrtime.bigint();
    let found = 0;
    for (let n = 0; n < 20000; n += 1) if (busy.isGuest(many[n % many.length])) found += 1;
    const tookMs = Number(process.hrtime.bigint() - started) / 1e6;
    check('asking whether someone is a guest does not walk the whole book', found === 20000 && tookMs < 300, `${tookMs.toFixed(0)} ms for 20000 lookups`);
    const lazyFile = path.join(dir, 'lazy.json');
    const lazy = guests.createGuestBook({ file: lazyFile, now: () => clock, saveDelayMs: 80 });
    lazy.admit({ fp: me.fingerprint, deviceId: 'a', home: H });
    const writtenAtOnce = fs.existsSync(lazyFile);
    await sleep(200);
    check('with a save delay, admissions are written together a moment later', !writtenAtOnce && fs.existsSync(lazyFile));
  }

  /* ---- relay ----------------------------------------------------------------- */
  if (wants('relay')) {
    section('relay: a guest taken in, or refused, never a resident');
    const fleet = await familyFleet(['h', 'g1', 'g2', 'g3', 'g4', 'g5'], {
      guests: { g1: true, g3: true, g4: true, g5: true },
      env: { g3: { CHAT_GUEST_SHARE: '0' }, g4: { CHAT_GUEST_NEW_PER_IP_10M: '2' }, g5: { CHAT_WS_MAX_TOTAL: '20', CHAT_GUEST_IDLE_MS: '500', CHAT_GUEST_NEW_PER_IP_10M: '100' } },
    });
    const { h, g1, g2, g3 } = fleet.relays;
    const bob = fleet.client('h', 'bob');
    await bob.ready;
    await proven(bob);

    const alice = relayTestIdentity();
    const guest = fleet.client('g1', 'alice-1', alice, { guestOf: h.id });
    await guest.ready;
    const ok = await guest.waitFor((message) => message.type === 'guest-ok' || message.type === 'guest-refused', 15000).catch(() => null);
    check('a guest is taken in', ok?.type === 'guest-ok' && ok.home === h.id && Number(ok.until) > Date.now(), JSON.stringify(ok));
    const roster = await guest.waitFor((message) => message.type === 'roster', 8000).catch(() => null);
    check('its roster frame says it is a guest', roster?.guest === true, JSON.stringify(roster));
    const whileGuest = await ask(bob, g1, { type: 'route-query', toFingerprint: alice.fingerprint }).catch(() => null);
    check('g1 answers for it as a guest, not as home', whileGuest?.type === 'route' && whileGuest.guest === true && whileGuest.home === false, JSON.stringify(whileGuest));
    check('the operator hears that g1 started hosting guests', await waitUntil(() => g1.output.includes(textFor('fa').guests.title), 8000));

    guest.send({ type: 'guest-end' });
    await sleep(500);
    const afterEnd = await ask(bob, g1, { type: 'route-query', toFingerprint: alice.fingerprint }).catch(() => null);
    check('after guest-end it is neither guest nor home', afterEnd?.type === 'route' && afterEnd.guest !== true && afterEnd.home === false, JSON.stringify(afterEnd));
    guest.close();
    await sleep(2600);
    const known = (() => { try { return JSON.parse(fs.readFileSync(path.join(g1.dir, 'known-identities.json'), 'utf8')); } catch (_error) { return {}; } })();
    check('g1 never wrote it down as a resident', !known.proven?.[alice.fingerprint], JSON.stringify(known.proven || {}).slice(0, 120));

    const refusedOn = async (name, label, hello) => {
      const client = fleet.client(name, label, relayTestIdentity(), hello);
      await client.ready;
      const answer = await client.waitFor((message) => message.type === 'guest-ok' || message.type === 'guest-refused', 15000).catch(() => null);
      const code = await Promise.race([client.closed, sleep(5000).then(() => 'open')]);
      return { reason: answer?.type === 'guest-refused' ? answer.reason : answer?.type || 'none', code };
    };
    const off = await refusedOn('g2', 'r-off', { guestOf: h.id });
    check('a relay that takes no guests says off and closes', off.reason === 'off' && off.code !== 'open', JSON.stringify(off));
    const outside = await refusedOn('g1', 'r-out', { guestOf: crypto.randomBytes(32).toString('hex') });
    check('a home outside the family is not-family', outside.reason === 'not-family' && outside.code !== 'open', JSON.stringify(outside));
    const itself = await refusedOn('g1', 'r-self', { guestOf: g1.id });
    check('this relay as its own home is not-family', itself.reason === 'not-family', JSON.stringify(itself));
    const junk = await refusedOn('g1', 'r-junk', { guestOf: { evil: 1 } });
    check('a guestOf that is not an id is not-family', junk.reason === 'not-family', JSON.stringify(junk));
    const full = await refusedOn('g3', 'r-full', { guestOf: h.id });
    check('no room for guests is full', full.reason === 'full' && full.code !== 'open', JSON.stringify(full));
    /* g5: room for six guest sockets, so the book holds twenty-four; idle
       after half a second. */
    for (let i = 0; i < 24; i += 1) {
      const filler = fleet.client('g5', `f-${i}`, relayTestIdentity(), { guestOf: h.id });
      await filler.ready;
      await filler.waitFor((message) => message.type === 'guest-ok' || message.type === 'guest-refused', 15000).catch(() => null);
      filler.close();
    }
    await sleep(2600);
    const bookSize = () => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(fleet.relays.g5.dir, 'guests.json'), 'utf8')).guests).length; } catch (_error) { return -1; } };
    const before = bookSize();
    const stranger5 = await refusedOn('g5', 'f-out', { guestOf: crypto.randomBytes(32).toString('hex') });
    await sleep(2600);
    check('a newcomer refused for another reason evicts nobody', before === 24 && stranger5.reason === 'not-family' && bookSize() === 24, `${before} ${stranger5.reason} ${bookSize()}`);
    const welcome = await refusedOn('g5', 'f-new', { guestOf: h.id });
    await sleep(2600);
    check('a full book lets an idle guest go for a welcome newcomer', welcome.reason === 'guest-ok' && bookSize() === 24, `${welcome.reason} ${bookSize()}`);
    const n1 = await refusedOn('g4', 'n-1', { guestOf: h.id });
    const n2 = await refusedOn('g4', 'n-2', { guestOf: h.id });
    const n3 = await refusedOn('g4', 'n-3', { guestOf: h.id });
    check('one address adds only so many new guests in ten minutes', n1.reason === 'guest-ok' && n2.reason === 'guest-ok' && n3.reason === 'full', `${n1.reason} ${n2.reason} ${n3.reason}`);

    const carol = relayTestIdentity();
    const stranger = fleet.client('g1', 'carol', carol);
    await stranger.ready;
    await proven(stranger);
    await sleep(300);
    const resident = await ask(bob, g1, { type: 'route-query', toFingerprint: carol.fingerprint }).catch(() => null);
    check('someone without guestOf is an ordinary resident, as before', resident?.home === true && resident.guest !== true, JSON.stringify(resident));
    stranger.close();

    const dave = relayTestIdentity();
    const first = fleet.client('g1', 'dave-1', dave, { guestOf: h.id });
    await first.ready;
    await first.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    first.close();
    await fleet.stop('g1');
    await fleet.start('g1');
    await fleet.allLinked();
    const backAgain = fleet.client('g1', 'dave-1', dave, { guestOf: h.id });
    await backAgain.ready;
    const okAgain = await backAgain.waitFor((message) => message.type === 'guest-ok' || message.type === 'guest-refused', 15000).catch(() => null);
    const stillGuest = await ask(bob, g1, { type: 'route-query', toFingerprint: dave.fingerprint }).catch(() => null);
    check('after a restart the guest is taken in again, still not a resident', okAgain?.type === 'guest-ok' && stillGuest?.guest === true && stillGuest.home === false, `${JSON.stringify(okAgain)} ${JSON.stringify(stillGuest)}`);
    backAgain.close();
    bob.close();
  }

  /* ---- rosters --------------------------------------------------------------- */
  if (wants('rosters')) {
    section('rosters: sealed copies across the family');
    const guests = require(path.join(ROOT, 'scripts', 'lib', 'relay-guests.js'));
    const fleet = await familyFleet(['h', 'g1', 'g2'], { guests: { g1: true, g2: true } });
    const { h, g1, g2 } = fleet.relays;
    const copyDir = (relay, fp) => path.join(relay.dir, 'rosters', 'copies', guests.rosterCopyIndex(fp));
    const copyFile = (relay, fp) => { try { const name = fs.readdirSync(copyDir(relay, fp)).find((entry) => entry.endsWith('.json')); return name ? path.join(copyDir(relay, fp), name) : path.join(copyDir(relay, fp), 'none'); } catch (_error) { return path.join(copyDir(relay, fp), 'none'); } };
    await fleet.stop('g2');

    const alice = relayTestIdentity();
    const primary = devicePair();
    const resident = fleet.client('h', 'alice-p', alice);
    await resident.ready;
    await proven(resident);
    const first = makeRoster(alice, { seq: 1, primaryId: 'alice-p', primaryPair: primary, revoked: [{ d: 'old', k: '', at: Date.now(), why: 'revoked' }] });
    resident.send({ type: 'roster-put', roster: first });
    const stored = await resident.waitFor((message) => message.type === 'roster-stored' || message.type === 'roster-refused', 10000).catch(() => null);
    check('the roster is stored at home', stored?.type === 'roster-stored', JSON.stringify(stored));
    const reached = await waitUntil(() => fs.existsSync(copyFile(g1, alice.fingerprint)), 10000);
    const text = reached ? fs.readFileSync(copyFile(g1, alice.fingerprint), 'utf8') : '';
    check('a copy reaches the family, blinded', reached && !text.includes(alice.fingerprint) && !text.includes('alice-p') && !text.includes('"old"'), text.slice(0, 120));
    resident.close();

    const revoked = fleet.client('g1', 'old', alice, { guestOf: h.id });
    await revoked.ready;
    const refusal = await revoked.waitFor((message) => message.type === 'guest-ok' || message.type === 'guest-refused', 15000).catch(() => null);
    check('a device the roster revoked is refused as a guest', refusal?.type === 'guest-refused' && refusal.reason === 'revoked', JSON.stringify(refusal));

    await fleet.start('g2');
    await fleet.allLinked();
    check('a relay that was away gets the copy when its link comes up', await waitUntil(() => fs.existsSync(copyFile(g2, alice.fingerprint)), 12000));

    const carol = relayTestIdentity();
    const carolPrimary = devicePair();
    const carolRoster = makeRoster(carol, { seq: 1, primaryId: 'carol-p', primaryPair: carolPrimary, revoked: [{ d: 'carol-old', k: '', at: Date.now(), why: 'revoked' }] });
    const carolOld = fleet.client('g1', 'carol-old', carol, { guestOf: h.id, roster: carolRoster });
    await carolOld.ready;
    const carolAnswer = await carolOld.waitFor((message) => message.type === 'guest-ok' || message.type === 'guest-refused', 15000).catch(() => null);
    check('with no copy anywhere, the roster the device itself carries counts', carolAnswer?.type === 'guest-refused' && carolAnswer.reason === 'revoked', JSON.stringify(carolAnswer));

    const forged = makeRoster(alice, { seq: 50, primaryId: 'old', primaryPair: devicePair() });
    const forger = fleet.client('g1', 'old', alice, { guestOf: h.id, roster: forged });
    await forger.ready;
    const forgedAnswer = await forger.waitFor((message) => message.type === 'guest-ok' || message.type === 'guest-refused', 15000).catch(() => null);
    check('a revoked device cannot outbid the copy with a roster it made itself', forgedAnswer?.type === 'guest-refused' && forgedAnswer.reason === 'revoked', JSON.stringify(forgedAnswer));

    const dora = relayTestIdentity();
    const doraGuest = fleet.client('g1', 'dora-x', dora, { guestOf: h.id });
    await doraGuest.ready;
    await doraGuest.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    doraGuest.send({ type: 'roster-put', roster: makeRoster(dora, { seq: 1, primaryId: 'dora-x', primaryPair: devicePair() }) });
    const founded = await doraGuest.waitFor((message) => message.type === 'roster-stored' || message.type === 'roster-refused', 10000).catch(() => null);
    check('a guest cannot found a roster where none is known', founded?.type === 'roster-refused' && founded.reason === 'no-anchor'
      && !fs.existsSync(path.join(g1.dir, 'rosters', `${dora.fingerprint}.json`)), JSON.stringify(founded));
    doraGuest.close();

    const revokedResident = fleet.client('g2', 'old', alice);
    await revokedResident.ready;
    const shut = await revokedResident.waitFor((message) => message.type === 'device-revoked' || message.type === 'roster' || message.type === 'peers', 15000).catch(() => null);
    check('a relay without its own roster shuts out a device the family’s copy revokes', shut?.type === 'device-revoked', JSON.stringify(shut)?.slice(0, 120));
    revokedResident.close();
    const planter = fleet.client('g2', 'newdev', alice);
    await planter.ready;
    await proven(planter);
    planter.send({ type: 'roster-put', roster: makeRoster(alice, { seq: 1, primaryId: 'newdev', primaryPair: devicePair() }) });
    const planted = await planter.waitFor((message) => message.type === 'roster-stored' || message.type === 'roster-refused', 10000).catch(() => null);
    check('a relay that holds the family’s copy refuses a resident’s rival founding', planted?.type === 'roster-refused', JSON.stringify(planted));
    planter.close();
    const sideways = fleet.client('g1', 'old', alice, { guestOf: g2.id });
    await sideways.ready;
    const sidewaysAnswer = await sideways.waitFor((message) => message.type === 'guest-ok' || message.type === 'guest-refused', 15000).catch(() => null);
    check('naming another relay as home does not get a revoked device past home’s copy', sidewaysAnswer?.type === 'guest-refused' && sidewaysAnswer.reason === 'revoked', JSON.stringify(sidewaysAnswer));

    const guest = fleet.client('g1', 'alice-p', alice, { guestOf: h.id });
    await guest.ready;
    const ok = await guest.waitFor((message) => message.type === 'guest-ok' || message.type === 'guest-refused', 15000).catch(() => null);
    const given = await guest.waitFor((message) => message.type === 'roster', 8000).catch(() => null);
    check('the primary is taken in, and handed the roster from the copy', ok?.type === 'guest-ok' && given?.guest === true && given?.roster?.seq === 1, `${JSON.stringify(ok)} ${given?.roster?.seq}`);
    const second = makeRoster(alice, { seq: 2, primaryId: 'alice-p', primaryPair: primary, revoked: [{ d: 'old', k: '', at: Date.now(), why: 'revoked' }, { d: 'other', k: '', at: Date.now(), why: 'left' }] });
    guest.send({ type: 'roster-put', roster: second });
    const storedOnGuest = await guest.waitFor((message) => message.type === 'roster-stored' || message.type === 'roster-refused', 10000).catch(() => null);
    check('a successor signed during the stay is taken on the guest relay', storedOnGuest?.type === 'roster-stored' && storedOnGuest.seq === 2, JSON.stringify(storedOnGuest));
    const homeSeq = () => { try { return JSON.parse(fs.readFileSync(path.join(h.dir, 'rosters', `${alice.fingerprint}.json`), 'utf8')).seq; } catch (_error) { return 0; } };
    check('and reaches home', await waitUntil(() => homeSeq() === 2, 12000), `home has ${homeSeq()}`);
    guest.close();
  }

  /* ---- mail ------------------------------------------------------------------ */
  if (wants('mail')) {
    section('mail: during and after a stay');
    const fleet = await familyFleet(['h', 'g1', 'g2', 'g3'], { guests: { g1: true, g2: true, g3: true }, env: { g2: { CHAT_GUEST_RETENTION_MS: '1500', CHAT_GUEST_SWEEP_MS: '300' } } });
    const { h, g1, g2, g3 } = fleet.relays;
    const box = async (name, fp) => ((await fleet.post(name, '/Monitor_Server/identities')).identities || []).find((row) => row.fingerprint === fp.slice(0, 16))?.mailbox || 0;
    const bob = fleet.client('h', 'bob');
    await bob.ready;
    await proven(bob);
    let n = 0;
    const send = async (relay, fp) => {
      const tag = `m${n += 1}`;
      bob.send({ ...sealTransit(relay.id, relay.key, { type: 'relay', toFingerprint: fp, payload: { type: 'offline-chat', notify: false, body: tag }, persist: true, tag }), tag });
      return bob.waitFor((message) => message.tag === tag, 10000).catch(() => null);
    };

    const alice = relayTestIdentity();
    const away = fleet.client('g1', 'alice-1', alice, { guestOf: h.id });
    await away.ready;
    await away.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    away.close();
    await sleep(500);
    const q1 = await send(g1, alice.fingerprint);
    const q2 = await send(g1, alice.fingerprint);
    check('mail for a guest that is away waits on the guest relay', q1?.type === 'queued' && q2?.type === 'queued' && await box('g1', alice.fingerprint) === 2, `${JSON.stringify(q1)}`);
    const back = fleet.client('g1', 'alice-1', alice, { guestOf: h.id });
    await back.ready;
    await back.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    back.send({ type: 'guest-end' });
    check('on guest-end, what it did not take goes home', await waitUntil(async () => await box('h', alice.fingerprint) === 2 && await box('g1', alice.fingerprint) === 0, 12000),
      `h ${await box('h', alice.fingerprint)} g1 ${await box('g1', alice.fingerprint)}`);
    back.close();
    await send(g1, alice.fingerprint);
    check('what still arrives at the guest relay follows it home', await waitUntil(async () => await box('h', alice.fingerprint) === 3 && await box('g1', alice.fingerprint) === 0, 12000),
      `h ${await box('h', alice.fingerprint)} g1 ${await box('g1', alice.fingerprint)}`);

    const dave = relayTestIdentity();
    const daveGuest = fleet.client('g2', 'dave-1', dave, { guestOf: h.id });
    await daveGuest.ready;
    await daveGuest.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    daveGuest.close();
    const erin = relayTestIdentity();
    const erinHome = fleet.client('g2', 'erin-1', erin);
    await erinHome.ready;
    await proven(erinHome);
    erinHome.close();
    await sleep(500);
    await send(g2, dave.fingerprint);
    await send(g2, erin.fingerprint);
    await sleep(2800);
    check('a guest’s mail ages out after the guest retention, a resident’s does not', await box('g2', dave.fingerprint) === 0 && await box('g2', erin.fingerprint) === 1,
      `dave ${await box('g2', dave.fingerprint)} erin ${await box('g2', erin.fingerprint)}`);

    /* Three relays each named as the next one's home: an item does not go
       round for ever. */
    const xavier = relayTestIdentity();
    for (const [on, home] of [['g1', g2.id], ['g3', g1.id]]) {
      const stay = fleet.client(on, `x-${on}`, xavier, { guestOf: home });
      await stay.ready;
      await stay.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
      stay.send({ type: 'guest-end' });
      await sleep(300);
      stay.close();
    }
    const g2stay = fleet.client('g2', 'x-g2', xavier, { guestOf: g3.id });
    await g2stay.ready;
    await g2stay.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    g2stay.send({ type: 'guest-end' });
    await sleep(300);
    g2stay.close();
    await send(g1, xavier.fingerprint);
    await sleep(4000);
    const spread = [await box('g1', xavier.fingerprint), await box('g2', xavier.fingerprint), await box('g3', xavier.fingerprint)];
    await sleep(2000);
    const later = [await box('g1', xavier.fingerprint), await box('g2', xavier.fingerprint), await box('g3', xavier.fingerprint)];
    check('an item forwarded twice stays where it is, so a forged ring cannot spin it', spread.join() === '0,0,1' && later.join() === '0,0,1', `${spread} then ${later}`);
    bob.close();
  }

  /* ---- notice ---------------------------------------------------------------- */
  if (wants('notice')) {
    section('notice: home hands mail to the guest relay on the person’s own word');
    const guests = require(path.join(ROOT, 'scripts', 'lib', 'relay-guests.js'));
    const fleet = await familyFleet(['h', 'g1', 'g2'], { guests: { g1: true, g2: true }, env: { h: { CHAT_GUEST_SWEEP_MS: '500' } } });
    const { h, g1, g2 } = fleet.relays;
    const box = async (name, fp) => ((await fleet.post(name, '/Monitor_Server/identities')).identities || []).find((row) => row.fingerprint === fp.slice(0, 16))?.mailbox || 0;
    const bob = fleet.client('h', 'bob');
    await bob.ready;
    await proven(bob);
    const toHome = async (fp, body) => {
      bob.send({ type: 'relay', toFingerprint: fp, payload: { type: 'offline-chat', notify: false, body }, persist: true, tag: body });
      return bob.waitFor((message) => message.tag === body, 10000).catch(() => null);
    };
    const notice = (identity, deviceId, guest, { at = Date.now(), signer = identity } = {}) => {
      const statement = { v: 1, type: 'guest-at', fp: identity.fingerprint, deviceId, home: h.id, guest, at, until: at + 24 * 3600 * 1000 };
      const signed = signStatement(signer, statement);
      return { statement, sig: signed.sig };
    };
    const got = (client, body, ms = 10000) => client.waitFor((message) => message.type === 'relay' && message.payload?.body === body, ms).then(() => true).catch(() => false);

    const alice = relayTestIdentity();
    await toHome(alice.fingerprint, 'w1');
    const aliceNotice = notice(alice, 'alice-1', g1.id);
    const routeStatement = { v: 1, type: 'guest-route', fp: alice.fingerprint, guest: g1.id, until: Date.now() + 24 * 3600 * 1000 };
    const aliceRoute = { statement: routeStatement, sig: signStatement(alice, routeStatement).sig };
    const guest = fleet.client('g1', 'alice-1', alice, { guestOf: h.id, guestNotice: aliceNotice, guestRoute: aliceRoute });
    await guest.ready;
    await guest.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    const status = await guest.waitFor((message) => message.type === 'guest-status', 8000).catch(() => null);
    check('the guest hears its home is up as seen from the guest relay', status?.homeUp === true, JSON.stringify(status));
    check('mail already waiting at home reaches the guest', await got(guest, 'w1'));
    await toHome(alice.fingerprint, 'w2');
    check('new mail at home reaches the guest too', await got(guest, 'w2'));
    check('and home keeps its own copies', await box('h', alice.fingerprint) === 2);
    const routeAnswer = await ask(bob, g1, { type: 'route-query', toFingerprint: alice.fingerprint }).catch(() => null);
    check('a route answer for a guest carries the guest’s own signed route statement, and only that', routeAnswer?.guest === true && routeAnswer.notice?.statement?.guest === g1.id
      && routeAnswer.notice.statement.type === 'guest-route' && !('deviceId' in routeAnswer.notice.statement) && !('home' in routeAnswer.notice.statement)
      && guests.verifyIdentityStatement({ ...routeAnswer.notice, publicKeyData: alice.publicKeyData }, { type: 'guest-route' }).ok === true, JSON.stringify(routeAnswer?.notice)?.slice(0, 200));
    const statsOf = (name) => fleet.post(name, '/Monitor_Server/guests').catch(() => ({}));
    check('home counts what it has copied to a guest elsewhere', (await statsOf('h')).remoteCopied >= 1, JSON.stringify(await statsOf('h')));
    guest.send({ type: 'guest-end' });
    await sleep(3000);
    check('on guest-end the guest relay sends nothing back to home that came from home', await box('h', alice.fingerprint) === 2, `h ${await box('h', alice.fingerprint)}`);
    check('and home forgets what it copied for that stay', (await statsOf('h')).remoteCopied === 0 && (await statsOf('h')).remote === 0, JSON.stringify(await statsOf('h')));
    guest.close();
    await toHome(alice.fingerprint, 'w3');
    const replay = fleet.client('g1', 'alice-1', alice, { guestOf: h.id, guestNotice: aliceNotice });
    await replay.ready;
    await replay.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    check('after the stay ended, the same notice again forwards nothing', !(await got(replay, 'w3', 4000)));
    replay.close();

    const carol = relayTestIdentity();
    await toHome(carol.fingerprint, 'c1');
    const forgedKey = fleet.client('g1', 'carol-1', carol, { guestOf: h.id, guestNotice: notice(carol, 'carol-1', g1.id, { signer: relayTestIdentity() }) });
    await forgedKey.ready;
    await forgedKey.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    check('a notice signed by another key forwards nothing', !(await got(forgedKey, 'c1', 4000)));
    forgedKey.close();
    const elsewhere = fleet.client('g1', 'carol-1', carol, { guestOf: h.id, guestNotice: notice(carol, 'carol-1', g2.id) });
    await elsewhere.ready;
    await elsewhere.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    check('a notice naming another guest relay forwards nothing', !(await got(elsewhere, 'c1', 4000)));
    elsewhere.close();

    const dave = relayTestIdentity();
    const daveGuest = fleet.client('g1', 'dave-1', dave, { guestOf: h.id, guestNotice: notice(dave, 'dave-1', g1.id) });
    await daveGuest.ready;
    await daveGuest.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    await sleep(800);
    const daveHome = fleet.client('h', 'dave-1', dave);
    await daveHome.ready;
    await proven(daveHome);
    await sleep(500);
    await toHome(dave.fingerprint, 'd1');
    check('once the device proves itself at home, home stops handing its mail on', await got(daveHome, 'd1') && !(await got(daveGuest, 'd1', 3000)));
    daveHome.close();
    daveGuest.close();

    const frank = relayTestIdentity();
    await toHome(frank.fingerprint, 'f1');
    const shortNotice = (() => {
      const at = Date.now();
      const statement = { v: 1, type: 'guest-at', fp: frank.fingerprint, deviceId: 'frank-1', home: h.id, guest: g1.id, at, until: at + 2500 };
      return { statement, sig: signStatement(frank, statement).sig };
    })();
    const frankGuest = fleet.client('g1', 'frank-1', frank, { guestOf: h.id, guestNotice: shortNotice });
    await frankGuest.ready;
    await got(frankGuest, 'f1');
    const copiedWhile = (await fleet.post('h', '/Monitor_Server/guests')).remoteCopied;
    await sleep(4500);
    const copiedAfter = (await fleet.post('h', '/Monitor_Server/guests')).remoteCopied;
    check('a stay whose notice ran out without a word is forgotten by the sweep', copiedWhile >= 1 && copiedAfter === 0, `${copiedWhile} → ${copiedAfter}`);
    frankGuest.close();

    const erin = relayTestIdentity();
    const erinGuest = fleet.client('g1', 'erin-1', erin, { guestOf: h.id, guestNotice: notice(erin, 'erin-1', g1.id) });
    await erinGuest.ready;
    await erinGuest.waitFor((message) => message.type === 'guest-status' && message.homeUp === true, 15000).catch(() => null);
    await fleet.stop('h');
    const down = await erinGuest.waitFor((message) => message.type === 'guest-status' && message.homeUp === null, 15000).catch(() => null);
    check('home down: homeUp is unknown', down?.homeUp === null, JSON.stringify(down));
    erinGuest.inbox.length = 0;
    await fleet.start('h');
    const up = await erinGuest.waitFor((message) => message.type === 'guest-status' && message.homeUp === true, 30000).catch(() => null);
    check('home back: homeUp is true again', up?.homeUp === true, JSON.stringify(up));
    erinGuest.close();
    bob.close();
  }

  /* ---- push ------------------------------------------------------------------- */
  if (wants('push')) {
    section('push: who wakes a guest');
    const fleet = await familyFleet(['h', 'g1'], { guests: { g1: true } });
    const { h, g1 } = fleet.relays;
    /* A push service of our own per subscription: the relay deciding to wake a
       device is proven the moment it connects (tests/e2e/push.mjs). */
    const services = [];
    const pushService = async () => {
      const service = { hits: 0 };
      service.server = net.createServer((socket) => { service.hits += 1; socket.on('error', () => {}); socket.destroy(); });
      await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve));
      services.push(service);
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.generateKeys();
      const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      service.subscription = { endpoint: `https://127.0.0.1:${service.server.address().port}/wake`, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)) } };
      return service;
    };
    const subscribe = async (relay, identity, deviceId, service) => {
      const challenge = await fetch(`${relay.origin}/push/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fingerprint: identity.fingerprint, publicKeyData: identity.publicKeyData }) }).then((r) => r.json());
      const nonce = crypto.privateDecrypt({ key: identity.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(challenge.cipher, 'base64')).toString('base64');
      const answer = await fetch(`${relay.origin}/push/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fingerprint: identity.fingerprint, subscription: service.subscription, challengeId: challenge.challengeId, nonce, deviceId, ttlDays: 30 }) });
      return answer.ok;
    };
    const bob = fleet.client('h', 'bob');
    await bob.ready;
    await proven(bob);
    let n = 0;
    const toHome = (fp) => { const tag = `p${n += 1}`; bob.send({ type: 'relay', toFingerprint: fp, payload: { type: 'offline-chat', notify: true, body: tag }, persist: true, tag }); return bob.waitFor((m) => m.tag === tag, 10000).catch(() => null); };
    const toGuest = (fp) => { const tag = `p${n += 1}`; bob.send({ ...sealTransit(g1.id, g1.key, { type: 'relay', toFingerprint: fp, payload: { type: 'offline-chat', notify: true, body: tag }, persist: true, tag }), tag }); return bob.waitFor((m) => m.tag === tag, 10000).catch(() => null); };

    const alice = relayTestIdentity();
    const onGuest = await pushService();
    const onHomeGuestDevice = await pushService();
    const onHomeOtherDevice = await pushService();
    const at = Date.now();
    const statement = { v: 1, type: 'guest-at', fp: alice.fingerprint, deviceId: 'alice-1', home: h.id, guest: g1.id, at, until: at + 24 * 3600 * 1000 };
    const guest = fleet.client('g1', 'alice-1', alice, { guestOf: h.id, guestNotice: { statement, sig: signStatement(alice, statement).sig } });
    await guest.ready;
    await guest.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    check('subscriptions are taken on both relays', await subscribe(g1, alice, 'alice-1', onGuest) && await subscribe(h, alice, 'alice-1', onHomeGuestDevice) && await subscribe(h, alice, 'alice-2', onHomeOtherDevice));
    guest.close();
    await sleep(800);
    await toGuest(alice.fingerprint);
    check('the guest relay wakes a guest that is away', await waitUntil(() => onGuest.hits > 0, 8000), `hits ${onGuest.hits}`);
    await toHome(alice.fingerprint);
    await sleep(3000);
    check('home stays quiet for the device that is a guest elsewhere, and wakes the others', onHomeGuestDevice.hits === 0 && onHomeOtherDevice.hits > 0, `guest device ${onHomeGuestDevice.hits}, other ${onHomeOtherDevice.hits}`);
    const back = fleet.client('g1', 'alice-1', alice, { guestOf: h.id });
    await back.ready;
    await back.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    back.send({ type: 'guest-end' });
    await sleep(800);
    back.close();
    await toHome(alice.fingerprint);
    check('once the stay ended, home wakes that device again', await waitUntil(() => onHomeGuestDevice.hits > 0, 8000), `hits ${onHomeGuestDevice.hits}`);
    if (process.env.GUEST_DEBUG) console.log(h.output.split('\n').filter((line) => /Push|Guest/.test(line)).slice(-20).join('\n'));
    for (const service of services) service.server.close();
    bob.close();
  }

  /* ---- siblings --------------------------------------------------------------- */
  if (wants('siblings')) {
    section('siblings: one account on two guest relays');
    const fleet = await familyFleet(['h', 'g1', 'g2', 'x'], { guests: { g1: true, g2: true, x: true } });
    const { h, g1, g2 } = fleet.relays;
    await fleet.stop('h');
    const alice = relayTestIdentity();
    const noticeFor = (deviceId, guestRelay) => {
      const at = Date.now();
      const statement = { v: 1, type: 'guest-at', fp: alice.fingerprint, deviceId, home: h.id, guest: guestRelay, at, until: at + 24 * 3600 * 1000 };
      return { statement, sig: signStatement(alice, statement).sig };
    };
    const routeFor = (guestRelay) => {
      const statement = { v: 1, type: 'guest-route', fp: alice.fingerprint, guest: guestRelay, until: Date.now() + 24 * 3600 * 1000 };
      return { statement, sig: signStatement(alice, statement).sig };
    };
    const got = (client, body, ms = 10000) => client.waitFor((message) => message.type === 'relay' && message.payload?.body === body, ms).then(() => true).catch(() => false);
    const bob = fleet.client('x', 'bob');
    await bob.ready;
    await proven(bob);
    const unsigned = fleet.client('g2', 'alice-u', alice, { guestOf: h.id });
    const signedOne = fleet.client('g1', 'alice-1', alice, { guestOf: h.id, guestNotice: noticeFor('alice-1', g1.id), guestRoute: routeFor(g1.id) });
    await unsigned.ready; await signedOne.ready;
    await unsigned.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    await signedOne.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    await sleep(1500);
    bob.send({ ...sealTransit(g1.id, g1.key, { type: 'relay', toFingerprint: alice.fingerprint, payload: { type: 'offline-chat', notify: false, body: 's0' }, persist: true, tag: 's0' }), tag: 's0' });
    check('without the device’s own signed word, a relay gets no copies', await got(signedOne, 's0') && !(await got(unsigned, 's0', 4000)));
    unsigned.close(); signedOne.close();
    await sleep(800);
    const one = fleet.client('g1', 'alice-1', alice, { guestOf: h.id, guestNotice: noticeFor('alice-1', g1.id), guestRoute: routeFor(g1.id) });
    const two = fleet.client('g2', 'alice-2', alice, { guestOf: h.id, guestNotice: noticeFor('alice-2', g2.id), guestRoute: routeFor(g2.id) });
    await one.ready; await two.ready;
    await one.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    await two.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    await sleep(1500);
    bob.send({ ...sealTransit(g1.id, g1.key, { type: 'relay', toFingerprint: alice.fingerprint, payload: { type: 'offline-chat', notify: false, body: 's1' }, persist: true, tag: 's1' }), tag: 's1' });
    check('mail to one guest relay reaches the device there', await got(one, 's1'));
    check('and the account’s device on the other guest relay', await got(two, 's1'));
    bob.send({ ...sealTransit(g2.id, g2.key, { type: 'relay', toFingerprint: alice.fingerprint, payload: { type: 'offline-chat', notify: false, body: 's2' }, persist: true, tag: 's2' }), tag: 's2' });
    check('the other way round too', await got(two, 's2') && await got(one, 's2'));
    await sleep(2000);
    const count = (client, body) => client.inbox.filter((message) => message.type === 'relay' && message.payload?.body === body).length;
    check('once each, not bounced back and forth', count(one, 's1') === 1 && count(two, 's1') === 1 && count(one, 's2') === 1 && count(two, 's2') === 1,
      `${count(one, 's1')} ${count(two, 's1')} ${count(one, 's2')} ${count(two, 's2')}`);
    const xLog = fleet.relays.x.output;
    check('a relay hosting nobody of that account learns nothing about it', !xLog.includes(alice.fingerprint.slice(0, 12)));
    const box = async (name, fp) => ((await fleet.post(name, '/Monitor_Server/identities')).identities || []).find((row) => row.fingerprint === fp.slice(0, 16))?.mailbox || 0;
    two.send({ type: 'guest-end' });
    await sleep(800);
    two.close();
    const before = await box('g2', alice.fingerprint);
    bob.send({ ...sealTransit(g1.id, g1.key, { type: 'relay', toFingerprint: alice.fingerprint, payload: { type: 'offline-chat', notify: false, body: 's3' }, persist: true, tag: 's3' }), tag: 's3' });
    await got(one, 's3');
    await sleep(2500);
    check('once the stay on the other relay ended, nothing more is copied there', await box('g2', alice.fingerprint) === before, `${before} → ${await box('g2', alice.fingerprint)}`);
    const g1stats = await fleet.post('g1', '/Monitor_Server/guests').catch(() => ({}));
    check('and the relay that was copying forgets what it copied there', g1stats.siblingCopied === 0 && g1stats.siblings === 0, JSON.stringify(g1stats));
    one.close(); bob.close();
  }

  /* ---- move ------------------------------------------------------------------- */
  if (wants('move')) {
    section('move: home moves to the guest relay, on the person’s own word');
    const fleet = await familyFleet(['h', 'g1', 'g2'], { guests: { g1: true, g2: true } });
    const { h, g1, g2 } = fleet.relays;
    const box = async (name, fp) => ((await fleet.post(name, '/Monitor_Server/identities')).identities || []).find((row) => row.fingerprint === fp.slice(0, 16))?.mailbox || 0;
    const bob = fleet.client('g2', 'bob');
    await bob.ready;
    await proven(bob);
    const alice = relayTestIdentity();
    const atHome = fleet.client('h', 'alice-1', alice);
    await atHome.ready;
    await proven(atHome);
    atHome.close();
    await sleep(500);
    const routeOf = (relay, fp) => ask(bob, relay, { type: 'route-query', toFingerprint: fp }).catch(() => null);
    check('alice lives at h', (await routeOf(h, alice.fingerprint))?.home === true);
    const toH = (body) => { bob.send({ ...sealTransit(h.id, h.key, { type: 'relay', toFingerprint: alice.fingerprint, payload: { type: 'offline-chat', notify: false, body }, persist: true, tag: body }), tag: body }); return bob.waitFor((m) => m.tag === body, 10000).catch(() => null); };
    await toH('m-before');
    check('mail waits for her at h', await box('h', alice.fingerprint) === 1);

    const guest = fleet.client('g1', 'alice-1', alice, { guestOf: h.id });
    await guest.ready;
    await guest.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    const moveOf = (signer, patch = {}) => {
      const statement = { v: 1, type: 'home-move', fp: alice.fingerprint, from: h.id, to: g1.id, at: Date.now(), ...patch };
      return { statement, sig: signStatement(signer, statement).sig };
    };
    const tryMove = async (client, move) => {
      client.send({ type: 'home-move', ...move });
      return client.waitFor((message) => message.type === 'home-move-ok' || message.type === 'home-move-refused', 10000).catch(() => null);
    };
    const forgedKey = await tryMove(guest, moveOf(relayTestIdentity()));
    check('a move signed by another key is refused', forgedKey?.type === 'home-move-refused', JSON.stringify(forgedKey));
    guest.inbox.length = 0;
    const wrongTo = await tryMove(guest, moveOf(alice, { to: g2.id }));
    check('a move to another relay is refused here', wrongTo?.type === 'home-move-refused', JSON.stringify(wrongTo));
    guest.inbox.length = 0;
    const wrongFrom = await tryMove(guest, moveOf(alice, { from: g2.id }));
    check('a move from a relay that is not its home is refused', wrongFrom?.type === 'home-move-refused', JSON.stringify(wrongFrom));
    guest.inbox.length = 0;
    const realMove = moveOf(alice);
    const moved = await tryMove(guest, realMove);
    check('the real move is taken', moved?.type === 'home-move-ok' && moved.to === g1.id, JSON.stringify(moved));
    await sleep(1500);
    check('g1 is her home now', (await routeOf(g1, alice.fingerprint))?.home === true);
    check('h no longer claims her', (await routeOf(h, alice.fingerprint))?.home === false);
    check('h handed over what waited for her', await waitUntil(async () => await box('h', alice.fingerprint) === 0, 10000));
    check('which reaches her at g1', await guest.waitFor((message) => message.type === 'relay' && message.payload?.body === 'm-before', 10000).then(() => true).catch(() => false));
    await toH('m-after');
    check('mail still sent to h goes on to g1', await guest.waitFor((message) => message.type === 'relay' && message.payload?.body === 'm-after', 10000).then(() => true).catch(() => false));
    const again = fleet.client('g1', 'alice-3', alice, { guestOf: h.id });
    await again.ready;
    await again.waitFor((message) => message.type === 'guest-ok', 15000).catch(() => null);
    const replayed = await tryMove(again, realMove);
    check('the same move again is refused as a replay', replayed?.type === 'home-move-refused' && replayed.reason === 'replay', JSON.stringify(replayed));
    again.close();

    const sibling = fleet.client('h', 'alice-2', alice);
    await sibling.ready;
    const told = await sibling.waitFor((message) => message.type === 'home-move', 10000).catch(() => null);
    check('another device of hers that reaches h is told, with the signed statement', told?.statement?.to === g1.id
      && require(path.join(ROOT, 'scripts', 'lib', 'relay-guests.js')).verifyIdentityStatement({ ...told, publicKeyData: alice.publicKeyData }, { type: 'home-move', now: Date.now() }).ok === true,
      JSON.stringify(told)?.slice(0, 120));
    sibling.close(); guest.close(); bob.close();
  }
} catch (error) {
  console.error(error);
  check('suite ran to the end', false, String(error?.message || error).slice(0, 300));
} finally {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  for (const fleet of fleets) await fleet.stopAll().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
