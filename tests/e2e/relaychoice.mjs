/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Best relay (docs/RELAY-NETWORK.md, "Best relay").
 *
 * "relay"    a relay serves a speed sample, and takes a move straight from a
 *            resident of another relay of the family (no guest stay);
 * "scoring"  the app's scores and its decision to move, from fixed numbers;
 * "measure"  measuring from the device: latency, speed, nothing offline, no
 *            unproven relay, nothing when off, nothing with one relay;
 * "move"     a new account takes the best home at once; an existing one moves
 *            off a full home by itself (automatic) or is asked (suggest);
 *            off, a guest stay, a recent move, or a refusal: no move;
 * "settings" the "Best relay" card: hidden with one relay, the three choices
 *            with Off's warning, Measure now, and Move here;
 *
 *   node tests/e2e/relaychoice.mjs            # every section
 *   node tests/e2e/relaychoice.mjs relay      # one of them
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { relayTestIdentity } from './_relay-identity.mjs';
import { createFleet, waitUntil } from './_relay-fleet.mjs';
import { openApp, browser, waitFor, PASS, identity, importIdentity } from './_chat-harness.mjs';
import { startThreeStacks } from './_three-stacks.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const dirlib = require(path.join(ROOT, 'scripts', 'lib', 'relay-directory.js'));
const { sealTransit } = require(path.join(ROOT, 'scripts', 'lib', 'relay-transit.js'));

const ONLY = new Set(process.argv.slice(2));
const wants = (name) => !ONLY.size || ONLY.has(name);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test, ms = 20000, step = 250) {
  for (let waited = 0; waited <= ms; waited += step) {
    try { if (await test()) return true; } catch (_error) { /* not yet */ }
    await sleep(step);
  }
  return false;
}
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


async function choiceApp(tag, bed, relayUrl, timings = {}) {
  const page = await openApp(tag, { origin: bed.app, relay: relayUrl, init: (t) => { window.__POORIJA_CHOICE_TIMINGS__ = t; }, initArg: timings });
  await waitFor(page, () => Boolean(chatState.profile.relayDirectory?.body?.relays?.length), { timeoutMs: 30000 });
  return page;
}

const beds = [];
async function bedWith(options) {
  const bed = await startThreeStacks(options);
  beds.push(bed);
  return bed;
}

try {
  /* ---- relay ------------------------------------------------------------------ */
  if (wants('relay')) {
    section('relay: a speed sample, and a move without a guest stay');
    const fleet = await familyFleet(['h', 'g', 'x'], {
      env: { g: { CHAT_TEST_SATURATION: '0.9' }, x: { CHAT_TEST_HOOKS: '1', CHAT_TEST_SATURATION: '0.9' } },
    });
    const { h, g, x } = fleet.relays;
    const speed = (query = '') => fetch(`${g.origin}/relay-speed${query}`, { cache: 'no-store' });
    const first = await speed();
    const firstBytes = (await first.arrayBuffer()).byteLength;
    const big = await speed('?bytes=999999');
    const bigBytes = (await big.arrayBuffer()).byteLength;
    check('a speed sample is 256 KB by default, at most 512 KB, never cached', first.status === 200 && firstBytes === 262144 && bigBytes === 524288
      && /no-store/.test(first.headers.get('cache-control') || ''), `${firstBytes} ${bigBytes} ${first.headers.get('cache-control')}`);
    for (let n = 0; n < 4; n += 1) await (await speed('?bytes=1024')).arrayBuffer();
    const seventh = await speed('?bytes=1024');
    check('the seventh in a minute from one address is turned away', seventh.status === 429, String(seventh.status));
    const health = async (relay) => (await fetch(`${relay.origin}/chat-health`).then((r) => r.json())).capacity?.saturation;
    check('the load hook works only where test hooks are on', await health(x) === 0.9 && await health(g) !== 0.9, `${await health(x)} ${await health(g)}`);

    const box = async (name, fp) => ((await fleet.post(name, '/Monitor_Server/identities')).identities || []).find((row) => row.fingerprint === fp.slice(0, 16))?.mailbox || 0;
    const bob = fleet.client('x', 'bob');
    await bob.ready;
    await proven(bob);
    const alice = relayTestIdentity();
    const atHome = fleet.client('h', 'alice-1', alice);
    await atHome.ready;
    await proven(atHome);
    atHome.close();
    await sleep(500);
    bob.send({ ...sealTransit(h.id, h.key, { type: 'relay', toFingerprint: alice.fingerprint, payload: { type: 'offline-chat', notify: false, body: 'waiting' }, persist: true, tag: 'w' }), tag: 'w' });
    await bob.waitFor((message) => message.tag === 'w', 10000).catch(() => null);
    check('mail waits for her at h', await box('h', alice.fingerprint) === 1);
    const moveOf = (signer, patch = {}) => {
      const statement = { v: 1, type: 'home-move', fp: alice.fingerprint, from: h.id, to: g.id, at: Date.now(), ...patch };
      return { statement, sig: signStatement(signer, statement).sig };
    };
    const tryMove = async (label, move) => {
      const client = fleet.client('g', label, alice, { homeMove: move });
      await client.ready;
      const answer = await client.waitFor((message) => message.type === 'home-move-ok' || message.type === 'home-move-refused', 15000).catch(() => null);
      return { client, answer };
    };
    const forged = await tryMove('alice-f1', moveOf(relayTestIdentity()));
    check('a move signed by another key is refused', forged.answer?.type === 'home-move-refused', JSON.stringify(forged.answer));
    forged.client.close();
    const elsewhere = await tryMove('alice-f2', moveOf(alice, { to: x.id }));
    check('a move to another relay is refused here', elsewhere.answer?.type === 'home-move-refused', JSON.stringify(elsewhere.answer));
    elsewhere.client.close();
    const outside = await tryMove('alice-f3', moveOf(alice, { from: crypto.randomBytes(32).toString('hex') }));
    check('a move from a relay outside the family is refused', outside.answer?.type === 'home-move-refused', JSON.stringify(outside.answer));
    const routeEarly = (relay) => {
      const tag = `e${Math.random().toString(36).slice(2, 8)}`;
      bob.send({ ...sealTransit(relay.id, relay.key, { type: 'route-query', toFingerprint: alice.fingerprint, tag }), tag });
      return bob.waitFor((message) => message.tag === tag && message.type === 'route', 10000).catch(() => null);
    };
    await sleep(800);
    check('a refused move leaves her no resident of g, and the socket is closed', (await routeEarly(g))?.home === false
      && await Promise.race([outside.client.closed.then(() => true), sleep(3000).then(() => false)]), JSON.stringify(await routeEarly(g)));
    const real = moveOf(alice);
    const moved = await tryMove('alice-1', real);
    check('a resident of h moves straight to g, which takes no guests', moved.answer?.type === 'home-move-ok' && moved.answer.to === g.id, JSON.stringify(moved.answer));
    await sleep(1500);
    const route = (relay) => {
      const tag = `r${Math.random().toString(36).slice(2, 8)}`;
      bob.send({ ...sealTransit(relay.id, relay.key, { type: 'route-query', toFingerprint: alice.fingerprint, tag }), tag });
      return bob.waitFor((message) => message.tag === tag && message.type === 'route', 10000).catch(() => null);
    };
    check('g is her home, h no longer', (await route(g))?.home === true && (await route(h))?.home === false);
    check('what waited at h reaches her at g', await moved.client.waitFor((message) => message.type === 'relay' && message.payload?.body === 'waiting', 10000).then(() => true).catch(() => false)
      && await waitUntil(async () => await box('h', alice.fingerprint) === 0, 8000));
    moved.client.close();
    const replay = await tryMove('alice-r', real);
    check('the same move again is refused as a replay', replay.answer?.type === 'home-move-refused' && replay.answer.reason === 'replay', JSON.stringify(replay.answer));
    replay.client.close();
    bob.close();
  }

  /* ---- scoring ---------------------------------------------------------------- */
  if (wants('scoring')) {
    section('scoring: steadiness first, a full relay passed over, moves only when it lasts');
    const bed = await bedWith({});
    const page = await openApp('SCORE', { origin: bed.app, relay: bed.relays.h.url });
    const r = await page.evaluate(() => {
      const sample = (latency, ok, load = 0.1, kbps = null) => ({ at: Date.now(), latency, spread: 10, ok, kbps, load });
      const steady = scoreRelays({ A: [sample(50, 0.4)], B: [sample(120, 1)] }, { homeId: 'A' });
      const loads = scoreRelays({ A: [sample(80, 1, 0.1)], B: [sample(80, 1, 0.85)], C: [sample(80, 1, 0.7)] }, { homeId: 'A' });
      const day = relayChoiceTiming('dayMs');
      const now = 100 * day;
      const days = (n, home, other) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(99 - i), { H: home, B: other }]));
      const quiet = { H: [0.2, 0.2, 0.2], B: [0.2] };
      const decide = (history, saturation, extra = {}) => moveDecision(history, saturation, { homeId: 'H', newAccount: false, lastMoveAt: 0, now, ...extra });
      return {
        steadyWins: steady.B.score > steady.A.score,
        excluded: loads.B.excluded === true && loads.A.excluded === false,
        penalised: Math.abs(loads.C.score / loads.A.score - 0.8) < 0.01,
        twoDays: decide(days(2, 0.5, 0.7), quiet),
        threeDays: decide(days(3, 0.5, 0.7), quiet),
        notEnough: decide(days(5, 0.5, 0.6), quiet),
        full: decide(days(1, 0.5, 0.5), { H: [0.9, 0.88, 0.86], B: [0.3] }),
        fullButBusy: decide(days(1, 0.5, 0.5), { H: [0.9, 0.88, 0.86], B: [0.7] }),
        fresh: decide(days(1, 0.5, 0.58), quiet, { newAccount: true }),
        freshSmall: decide(days(1, 0.5, 0.54), quiet, { newAccount: true }),
        tooSoon: decide(days(3, 0.5, 0.7), quiet, { lastMoveAt: now - 10 * day }),
        toFull: decide(days(3, 0.5, 0.7), { H: [0.2], B: [0.85] }),
      };
    });
    check('a steadier relay outranks a faster flaky one', r.steadyWins, JSON.stringify(r));
    check('a relay at 85% is passed over, one at 70% scores × 0.8', r.excluded && r.penalised);
    check('30% better on two days is not enough, on three it is', r.twoDays === null && r.threeDays?.to === 'B' && r.threeDays.reason === 'better', JSON.stringify([r.twoDays, r.threeDays]));
    check('20% better, however long, is not enough', r.notEnough === null);
    check('a full home moves to a quiet relay, not to a busy one', r.full?.to === 'B' && r.full.reason === 'full' && r.fullButBusy === null, JSON.stringify([r.full, r.fullButBusy]));
    check('a new account moves for 15%, not for 8%', r.fresh?.reason === 'new' && r.freshSmall === null, JSON.stringify([r.fresh, r.freshSmall]));
    check('no move within thirty days of the last, and never to a full relay', r.tooSoon === null && r.toFull === null, JSON.stringify([r.tooSoon, r.toFull]));
    await page.context().close();
  }

  /* ---- measure ---------------------------------------------------------------- */
  if (wants('measure')) {
    section('measure: from the device, lightly');
    const bed = await bedWith({ delays: { g1: 400 } });
    const { h, g1, g2 } = bed.relays;
    const page = await choiceApp('MEASURE', bed, h.url, { sampleGapMs: 50 });
    check('with three relays the feature is available', await page.evaluate(() => relayChoiceAvailable()));
    const light = await page.evaluate(() => measureRelays());
    check('every relay is measured, the far one slower', Boolean(light[g1.id] && light[g2.id] && light[h.id]) && light[g1.id].latency > light[g2.id].latency + 200 && light[g2.id].ok === 1,
      JSON.stringify(Object.fromEntries(Object.entries(light).map(([id, v]) => [id.slice(0, 6), [Math.round(v.latency), v.ok, v.load]]))));
    const again = await page.evaluate(() => measureRelays());
    check('the first measurement of a day includes a download; the next ones do not', Object.values(light).every((v) => v.kbps > 0) && Object.values(again).every((v) => v.kbps === null),
      JSON.stringify(Object.values(again).map((v) => v.kbps)));
    const full = await page.evaluate(() => measureRelays({ withSpeed: true }));
    check('a full measurement times a download from each', Object.values(full).length === 3 && Object.values(full).every((v) => v.kbps > 0), JSON.stringify(Object.values(full).map((v) => v.kbps)));
    check('measurements are kept, the last twelve per relay', await page.evaluate((id) => (chatState.profile.relayScores?.[id] || []).length === 3, g2.id));
    await page.context().setOffline(true);
    const offline = await page.evaluate(() => measureRelays());
    await page.context().setOffline(false);
    check('offline: nothing is measured or kept', Object.keys(offline).length === 0 && await page.evaluate((id) => (chatState.profile.relayScores?.[id] || []).length === 3, g2.id));
    const fakeId = crypto.randomBytes(32).toString('hex');
    await bed.sign({ g2: { id: fakeId } });
    await page.evaluate(() => refreshRelayDirectory({ force: true }));
    await waitFor(page, (id) => (chatState.profile.relayDirectory?.body?.relays || []).some((relay) => relay.id === id), { timeoutMs: 15000, arg: fakeId });
    const unproven = await page.evaluate(() => measureRelays());
    check('a relay that does not prove the key the list names is not measured', !unproven[fakeId] && Boolean(unproven[g1.id]), Object.keys(unproven).map((id) => id.slice(0, 6)).join());
    await page.context().close();

    const offBed = await bedWith({});
    const off = await choiceApp('OFF', offBed, offBed.relays.h.url, { tickMs: 300, backgroundMs: 1000, minGapMs: 500, sampleGapMs: 20 });
    check('on by default, it measures in the background', await until(() => off.evaluate(() => Object.keys(chatState.profile.relayScores || {}).length >= 2), 30000));
    await off.evaluate(() => { chatState.profile.relayChoice = 'off'; chatState.profile.relayScores = {}; });
    await sleep(4000);
    check('off: nothing is measured', await off.evaluate(() => Object.keys(chatState.profile.relayScores || {}).length === 0));
    await off.context().close();

    const lone = await bedWith({ names: ['h'], guests: {} });
    const single = await choiceApp('LONE', lone, lone.relays.h.url, { tickMs: 300, backgroundMs: 1000, minGapMs: 500 });
    await sleep(3000);
    check('with one relay the feature is unavailable and nothing runs', await single.evaluate(() => !relayChoiceAvailable() && Object.keys(chatState.profile.relayScores || {}).length === 0));
    await single.context().close();
  }

  /* ---- move -------------------------------------------------------------------- */
  if (wants('move')) {
    section('move: deciding, and moving straight to the better relay');
    const near = await bedWith({ delays: { h: 1500 } });
    const fresh = await choiceApp('NEWACC', near, near.relays.h.url, { tickMs: 500, backgroundMs: 1000, minGapMs: 500, sampleGapMs: 30 });
    const landed = await until(() => fresh.evaluate((ids) => ids.includes(relayPinFor(configuredRelayOrigin())?.id || '') && chatState.connected, [near.relays.g1.id, near.relays.g2.id]), 90000);
    check('a new account takes the best home at once, not the relay the page came from', landed, await fresh.evaluate(() => chatState.profile.serverUrl));
    check('and says so', await fresh.evaluate(() => /home/i.test((window.__toasts || []).join(' '))));
    await fresh.context().close();

    const busy = await bedWith({ env: { h: { CHAT_TEST_HOOKS: '1', CHAT_TEST_SATURATION: '0.9' } } });
    const { h, g1, g2 } = busy.relays;
    const slowStart = { tickMs: 400, backgroundMs: 86400000, minGapMs: 300, sampleGapMs: 20 };
    const existing = async (tag, mode) => {
      const page = await choiceApp(tag, busy, h.url, slowStart);
      await page.evaluate((m) => {
        chatState.profile.relayChoice = m;
        chatState.history.__existing = [{ id: 'x', type: 'text', direction: 'out', text: 'an existing account', createdAt: new Date().toISOString() }];
      }, mode);
      return page;
    };
    const go = (page) => page.evaluate(() => { window.__POORIJA_CHOICE_TIMINGS__.backgroundMs = 1000; });
    const onHome = (page) => page.evaluate((id) => relayPinFor(configuredRelayOrigin())?.id === id, h.id);

    const auto = await existing('AUTO', 'auto');
    await go(auto);
    check('automatic: a full home is left for a quiet relay, without a question', await until(async () => !(await onHome(auto)), 60000)
      && await auto.evaluate((ids) => ids.includes(relayPinFor(configuredRelayOrigin())?.id), [g1.id, g2.id]), await auto.evaluate(() => chatState.profile.serverUrl));
    check('with a notice afterwards, and the move time kept', await auto.evaluate(() => /Moved home/i.test((window.__toasts || []).join(' ')) && Number(chatState.profile.lastHomeMoveAt) > 0));
    check('connected at the new home', await until(() => auto.evaluate(() => Boolean(chatState.connected && chatState.ws?.readyState === 1)), 30000));
    await auto.context().close();

    const ask = await existing('SUGGEST', 'suggest');
    await ask.evaluate(() => {
      window.__prompts = [];
      window.__answer = 'later';
      window.PoorijaDialogs.choose = async (question, options) => { window.__prompts.push({ question, options: options.map((o) => o.value) }); return window.__answer; };
    });
    await go(ask);
    check('suggest: the move is offered instead', await until(() => ask.evaluate(() => window.__prompts.length >= 1), 60000));
    const offered = await ask.evaluate(() => window.__prompts[0]);
    check('with each relay’s numbers as the reasons, and three answers', /ms/.test(offered.question) && /%/.test(offered.question) && JSON.stringify(offered.options) === JSON.stringify(['move', 'later', 'no']), offered.question.slice(0, 160));
    const later = await ask.evaluate(() => (chatState.profile.relayChoiceOffer?.nextAt || 0) - Date.now());
    check('"remind me later" waits about a week; still home', later > 6 * 86400000 && later <= 7 * 86400000 && await onHome(ask), String(later));
    await ask.evaluate(() => { window.__answer = 'no'; chatState.profile.relayChoiceOffer.nextAt = 0; });
    await until(() => ask.evaluate(() => window.__prompts.length >= 2), 30000);
    const no = await ask.evaluate(() => (chatState.profile.relayChoiceOffer?.nextAt || 0) - Date.now());
    check('"no" waits about a month', no > 29 * 86400000 && no <= 30 * 86400000, String(no));
    await ask.evaluate(() => {
      chatState.profile.relayChoiceOffer.nextAt = 0;
      window.PoorijaDialogs.choose = async (question, options) => { window.__prompts.push({ question }); chatState.profile.relayChoice = 'off'; return 'move'; };
    });
    await sleep(4000);
    check('turned off while the question was open: no move', await onHome(ask));
    await ask.evaluate(() => {
      chatState.profile.relayChoice = 'auto';
      chatState.profile.activeGuest = { id: 'x', origin: 'http://localhost:1', homeOrigin: 'http://elsewhere.invalid', home: 'y' };
    });
    await ask.evaluate(() => maybeMoveHome());
    check('no move while a guest stay is recorded', await onHome(ask) && await ask.evaluate(() => !chatState.pendingDirectMove));
    await ask.evaluate(() => { chatState.profile.activeGuest = null; chatState.profile.lastHomeMoveAt = Date.now() - 86400000; });
    await ask.evaluate(() => maybeMoveHome());
    check('no move within thirty days of the last', await onHome(ask) && await ask.evaluate(() => !chatState.pendingDirectMove));
    await ask.evaluate(() => { chatState.profile.lastHomeMoveAt = 0; window.signGuestStatement = async (statement) => ({ statement, sig: 'AAAA' }); });
    const refused = await ask.evaluate((id) => moveHomeDirect(id), g1.id);
    await sleep(3000);
    check('a refused move leaves the home and the address as they were', refused === false && await onHome(ask) && await until(() => ask.evaluate(() => Boolean(chatState.connected && chatState.ws?.readyState === 1)), 30000));
    await ask.context().close();
  }

  /* ---- settings ----------------------------------------------------------------- */
  if (wants('settings')) {
    section('settings: the Best relay card');
    const lone = await bedWith({ names: ['h'], guests: {} });
    const single = await choiceApp('CARD1', lone, lone.relays.h.url, { backgroundMs: 86400000 });
    await single.evaluate(() => renderRelayChoice());
    check('with one relay the card is hidden', await single.evaluate(() => document.getElementById('chatRelayChoice')?.classList.contains('hidden') === true));
    await single.context().close();

    const bed = await bedWith({});
    const { h, g1 } = bed.relays;
    const page = await choiceApp('CARD', bed, h.url, { backgroundMs: 86400000, sampleGapMs: 20 });
    await page.evaluate(() => { chatState.history.__existing = [{ id: 'x', type: 'text', direction: 'out', text: 'x', createdAt: new Date().toISOString() }]; renderRelayChoice(); });
    const card = () => page.evaluate(() => {
      const node = document.getElementById('chatRelayChoice');
      return {
        hidden: node?.classList.contains('hidden'),
        checked: node?.querySelector('input[name="chatRelayChoiceMode"]:checked')?.value || '',
        note: node?.querySelector('[data-relay-choice-note]')?.textContent || '',
        rows: Array.from(node?.querySelectorAll('[data-relay-choice-row]') || []).map((row) => row.textContent),
        moves: node?.querySelectorAll('[data-relay-move]').length || 0,
      };
    });
    const first = await card();
    check('with three relays the card shows, Automatic by default, saying it does not ask', first.hidden === false && first.checked === 'auto' && /not asked/.test(first.note), JSON.stringify(first));
    const pick = (value, answer) => page.evaluate(({ v, a }) => {
      window.__asked = [];
      window.PoorijaDialogs.confirm = async (message) => { window.__asked.push(message); return a; };
      const box = document.querySelector(`#chatRelayChoice input[value="${v}"]`);
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }, { v: value, a: answer });
    await pick('off', false);
    await sleep(600);
    const kept = await card();
    check('choosing Off warns, and declining keeps Automatic', await page.evaluate(() => /stability may suffer/.test(window.__asked[0] || '') && chatState.profile.relayChoice !== 'off') && kept.checked === 'auto', JSON.stringify(kept));
    await pick('off', true);
    await sleep(600);
    check('accepting turns it off', await page.evaluate(() => chatState.profile.relayChoice === 'off') && (await card()).checked === 'off');
    await pick('suggest', true);
    await sleep(400);
    check('Suggest is saved, and its line changes', await page.evaluate(() => chatState.profile.relayChoice === 'suggest') && !/not asked/.test((await card()).note));
    await page.evaluate(() => document.querySelector('[data-relay-choice-measure]')?.click());
    check('Measure now lists every relay with its numbers and the home mark', await until(async () => { const c = await card(); return c.rows.length === 3 && c.rows.every((row) => /ms/.test(row) && /%/.test(row)) && c.rows.some((row) => /home/i.test(row)); }, 60000), JSON.stringify((await card()).rows));
    check('and a Move here beside the other relays', (await card()).moves === 2);
    await page.evaluate((id) => {
      window.PoorijaDialogs.confirm = async () => true;
      document.querySelector(`[data-relay-move="${id}"]`)?.click();
    }, g1.id);
    check('Move here moves home there', await until(() => page.evaluate((id) => relayPinFor(configuredRelayOrigin())?.id === id, g1.id), 60000));
    await page.context().close();
  }
} catch (error) {
  console.error(error);
  check('suite ran to the end', false, String(error?.message || error).slice(0, 300));
} finally {
  for (const fleet of fleets) await fleet.stopAll().catch(() => {});
  for (const bed of beds) await bed.shutdown().catch(() => {});
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
