/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Guest mode in the app (js/chat/62-guest-mode.js), on three relays of one
 * family (tests/e2e/_three-stacks.mjs).
 *
 * "bed"      the bed itself: three linked relays, a relay stopped, a relay
 *            filtered for one browser only;
 * "ladder"   home stops: the app becomes a guest on a relay it can reach, the
 *            cluster mate first, never on a blip, straight back after a
 *            restart, and on to the next when its guest relay dies;
 * "home"     home is back: two proofs, guest-end, home again;
 * "roster"   no roster is founded or kept on the guest relay;
 * "refusals" every relay refuses: no stay, and the app says so;
 * "devices"  two devices of one account on two guest relays both receive; a
 *            group message reaches a guest; a call from a guest connects,
 *            with TURN from the guest relay;
 * "move"     home filtered for one person: after the wait the app offers a
 *            move with its reasons; later / no / move; never while home's
 *            state is unknown; the move itself, and a device that follows;
 * "redial"   with guest stays off, home down for a while and back: the app
 *            dials again by itself, and never calls a working address invalid;
 * "ui"       the badge, the line under the address, and the family card;
 * "switch"   the person's own switch: off, no stay; off during one, home;
 * "delivery" a contact on another relay reaches the guest once, the guest
 *            answers, two guests on one relay reach each other; no stored
 *            route moves, and a stale guest route still arrives;
 *
 *   node tests/e2e/guestmode.mjs            # every section
 *   node tests/e2e/guestmode.mjs bed        # one of them
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { openApp, browser, waitFor, PASS, identity, importIdentity } from './_chat-harness.mjs';
import { startThreeStacks } from './_three-stacks.mjs';

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
const connected = (page) => page.evaluate(() => Boolean(chatState.connected && chatState.ws?.readyState === WebSocket.OPEN)).catch(() => false);

/* Guest mode's clock, shortened (js/chat/62-guest-mode.js, guestTiming). */
const FAST = { downMs: 6000, tickMs: 500, homeCheckMs: 1000, probeMs: 4000, fastProofMs: 4000 };
async function guestApp(tag, bed, relayUrl, timings = FAST) {
  const page = await openApp(tag, { origin: bed.app, relay: relayUrl, init: (t) => { window.__POORIJA_GUEST_TIMINGS__ = t; }, initArg: timings });
  await waitFor(page, () => (chatState.profile.relayDirectory?.body?.relays?.length || 0) >= 3, { timeoutMs: 30000 });
  return page;
}
const stay = (page) => page.evaluate(() => chatState.profile.activeGuest || null).catch(() => null);
const inUse = (page) => page.evaluate(() => chatServerOrigin()).catch(() => '');
async function unlockAgain(page) {
  await page.waitForFunction(() => typeof window.PoorijaApp === 'object' && document.getElementById('unlockPassword'));
  await page.evaluate((pass) => { document.getElementById('unlockPassword').value = pass; unlockApp(); }, PASS);
  await page.waitForFunction(() => window.PoorijaApp?.state?.isLocked === false, null, { timeout: 30000 });
}

const fingerprintOf = (card) => {
  const body = String(card || '').split(':').slice(1).join(':');
  try { return JSON.parse(decodeURIComponent(escape(atob(body)))).fingerprint || ''; } catch (_error) { return ''; }
};
async function befriend(a, b) {
  const cardA = await identity(a);
  const cardB = await identity(b);
  await importIdentity(a, cardB);
  await waitFor(a, (needle) => Boolean(window.findPeerByAnyKey?.(needle)), { timeoutMs: 30000, arg: fingerprintOf(cardB) });
  await importIdentity(b, cardA);
  await waitFor(b, (needle) => Boolean(window.findPeerByAnyKey?.(needle)), { timeoutMs: 30000, arg: fingerprintOf(cardA) });
  return { fpA: fingerprintOf(cardA), fpB: fingerprintOf(cardB) };
}
async function openWith(page, fingerprint) {
  await waitFor(page, (needle) => Boolean(window.findPeerByAnyKey?.(needle)), { timeoutMs: 45000, arg: fingerprint });
  await page.evaluate((needle) => window.openConversationWithFingerprint?.(needle), fingerprint);
  await page.waitForSelector('#chatComposer', { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);
}
async function say(page, fingerprint, text) {
  await openWith(page, fingerprint);
  await page.fill('#chatComposer', text);
  await page.press('#chatComposer', 'Enter');
}
/* How many times a text arrived from that contact, in the stored history. */
const received = (page, fingerprint, text) => page.evaluate(({ fp, body }) => {
  const peer = window.findPeerByAnyKey?.(fp);
  const list = peer ? (chatState.history[getConversationKey(peer)] || []) : [];
  return list.filter((entry) => entry.direction === 'in' && String(entry.text || entry.body || '').includes(body)).length;
}, { fp: fingerprint, body: text }).catch(() => 0);

const beds = [];
async function bedWith(options) {
  const bed = await startThreeStacks(options);
  beds.push(bed);
  return bed;
}

try {
  /* ---- bed ------------------------------------------------------------------ */
  if (wants('bed')) {
    section('bed: three relays of one family');
    const bed = await bedWith({});
    const { h, g1, g2 } = bed.relays;
    const linkedAll = await until(async () => {
      const [lh, l1, l2] = await Promise.all([bed.linked('h'), bed.linked('g1'), bed.linked('g2')]);
      return lh.has(g1.id) && lh.has(g2.id) && l1.has(h.id) && l1.has(g2.id) && l2.has(h.id) && l2.has(g1.id);
    }, 30000);
    check('the bed starts, each relay linked with the other two', linkedAll);

    const A = await openApp('BEDA', { origin: bed.app, relay: h.url });
    const B = await openApp('BEDB', { origin: bed.app, relay: h.url });
    check('two pages connect to h', await until(() => connected(A)) && await until(() => connected(B)));
    await bed.stop('h');
    check('stopping h drops both sockets', await until(async () => !(await connected(A)) && !(await connected(B)), 20000));
    await bed.start('h');
    check('both come back when h is back', await until(() => connected(A), 60000) && await until(() => connected(B), 60000));
    await A.context().close();
    await B.context().close();

    const door = await h.door();
    const C = await openApp('BEDC', { origin: bed.app, relay: door.url });
    const D = await openApp('BEDD', { origin: bed.app, relay: h.url });
    check('a page reaches h through a door', await until(() => connected(C)));
    door.block();
    const reach = (page, url) => page.evaluate((u) => fetch(`${u}/chat-health`, { cache: 'no-store' }).then((r) => r.ok).catch(() => false), url);
    check('blocked: the door page cannot reach h', !(await reach(C, door.url)) && await until(async () => !(await connected(C)), 15000));
    check('blocked: another page still can', await reach(D, h.url) && await connected(D));
    check('blocked: g1 still has its link to h', (await bed.linked('g1')).has(h.id));
    await C.context().close();
    await D.context().close();
  }

  /* ---- ladder / home / roster / refusals -------------------------------------- */
  if (wants('ladder') || wants('home') || wants('roster') || wants('refusals')) {
    section('ladder: becoming a guest, and going home');
    const bed = await bedWith({});
    const { h, g1, g2 } = bed.relays;
    const A = await guestApp('LADA', bed, h.url);
    const fp = await A.evaluate(() => chatState.identity.fingerprint);
    check('the app holds the family list and h’s pin', await A.evaluate((id) => relayPinFor(configuredRelayOrigin())?.id === id, h.id));
    const origins = await A.evaluate(() => guestCandidateOrigins({ origins: ['http://10.0.0.5:8585', 'https://a.example:8585'], inside: ['http://192.168.1.2:8585', 'https://10.0.0.6:8585'], cluster: 'X' }, { cluster: 'X' }));
    check('guest candidates are reached over https only (plain http only on this machine)', JSON.stringify(origins) === JSON.stringify(['https://10.0.0.6:8585', 'https://a.example:8585']), JSON.stringify(origins));

    bed.relays.g2.front.block();
    await bed.stop('h');
    const became = await until(async () => (await stay(A))?.id === g1.id && await inUse(A) === g1.url && await connected(A), 60000);
    check('home stopped: the app is a guest on the relay that answers', became, (await stay(A))?.name);
    check('the configured address is untouched', await A.evaluate((url) => chatState.profile.serverUrl === url, h.url));
    check('the card names home, not the guest relay', await A.evaluate((url) => myHomeRelay()?.origin === url, h.url));
    bed.relays.g2.front.unblock();

    if (wants('ladder')) {
      await A.reload();
      await unlockAgain(A);
      check('reopened during the stay, it is straight back on the guest relay', await until(async () => await inUse(A) === g1.url && await connected(A), 15000));
      await bed.stop('g1');
      check('its guest relay dies: on to the next', await until(async () => (await stay(A))?.id === g2.id && await connected(A), 60000), (await stay(A))?.name);
      await bed.start('g1');
    }

    if (wants('roster')) {
      check('nothing of its roster is kept on the guest relay', !fs.existsSync(path.join(bed.relays[(await stay(A))?.id === g1.id ? 'g1' : 'g2'].dir, 'rosters', `${fp}.json`)));
    }

    const lastOn = (await stay(A))?.id === g2.id ? 'g2' : 'g1';
    await bed.start('h');
    const home = await until(async () => !(await stay(A)) && await inUse(A) === h.url && await connected(A), 60000);
    check('home is back: after two proofs the app goes home', home, `${JSON.stringify(await stay(A))} ${await inUse(A)}`);
    await sleep(3000);
    const book = (name) => { try { return JSON.parse(fs.readFileSync(path.join(bed.relays[name].dir, 'guests.json'), 'utf8')); } catch (_error) { return { guests: {} }; } };
    check('it said guest-end: the relay it was a guest on no longer lists it', !Object.values(book(lastOn).guests || {}).some((entry) => entry.fp === fp), lastOn);

    if (wants('ladder')) {
      await bed.stop('h');
      await sleep(800);
      await bed.start('h');
      await sleep(FAST.downMs + 4000);
      check('a blip shorter than the wait moves nobody', !(await stay(A)) && await inUse(A) === h.url);
    }

    if (wants('refusals')) {
      await bed.sign({ g1: { guests: false }, g2: { guests: false } });
      await bed.stop('h');
      await sleep(FAST.downMs + 15000);
      const state = await A.evaluate(() => ({ active: chatState.profile.activeGuest, allRefused: guestModeState.allRefused }));
      check('every relay refuses: no stay, and the app knows nobody would take it', !state.active && state.allRefused === true, JSON.stringify(state));
      const entered = await A.evaluate(({ g1id, g2id }) => {
        const tried = [];
        const original = window.enterGuestStay;
        window.enterGuestStay = async (next) => { tried.push(next.relay.id); return true; };
        guestModeState.refused.set(g1id, Date.now() - 20 * 60 * 1000);
        chatState.profile.activeGuest = { id: g2id, origin: 'http://localhost:1', homeOrigin: configuredRelayOrigin(), home: 'x' };
        guestModeState.queue = [{ relay: { id: g2id } }, { relay: { id: g1id } }];
        handleGuestFrame({ type: 'guest-refused', reason: 'full' });
        window.enterGuestStay = original;
        return tried;
      }, { g1id: g1.id, g2id: g2.id });
      check('after a refusal, the next candidate refused long ago is tried, the one refused just now skipped', JSON.stringify(entered) === JSON.stringify([g1.id]), JSON.stringify(entered));
      await bed.start('h');
      await bed.sign({ g1: { guests: true }, g2: { guests: true } });
    }
    await A.context().close();

    if (wants('ladder')) {
      section('ladder: the cluster mate first');
      const near = await bedWith({ clusters: { h: 'X', g2: 'X' } });
      const B = await guestApp('LADB', near, near.relays.h.url);
      await near.stop('h');
      check('with both answering, the relay in home’s cluster is chosen', await until(async () => (await stay(B))?.id === near.relays.g2.id, 60000), (await stay(B))?.name);
      await B.context().close();
    }
  }



  /* ---- devices, groups, calls ---------------------------------------------------- */
  if (wants('devices')) {
    section('devices: two devices, a group, and a call during a stay');
    const bed = await bedWith({ clusters: { h: 'X', g1: 'X' } });
    const { h, g1, g2 } = bed.relays;
    const alice = await guestApp('DEVA', bed, h.url);
    const bob = await guestApp('DEVB', bed, g2.url);
    const { fpA: fpAlice, fpB: fpBob } = await befriend(alice, bob);
    const yes = (page) => page.evaluate(() => { window.PoorijaDialogs.confirm = async () => true; window.PoorijaDialogs.choose = async (_q, options) => options[0]?.value; });

    const phone = await guestApp('DEVP', bed, h.url);
    await yes(alice);
    await yes(phone);
    await alice.evaluate(() => window.openLinkChooser('account'));
    await alice.evaluate(() => document.querySelector('.chat-link-overlay [data-link-action="show-add"]')?.click());
    await waitFor(alice, () => Boolean(window.__deviceLinkProbe?.qr()), { timeoutMs: 20000 });
    const code = await alice.evaluate(() => window.__deviceLinkProbe.qr());
    await phone.evaluate((text) => window.__deviceLinkProbe.scan(text), code);
    await waitFor(alice, () => Boolean(document.querySelector('.chat-link-overlay [data-link-action="approve"]')), { timeoutMs: 20000 });
    await alice.evaluate(() => document.querySelector('.chat-link-overlay [data-link-action="approve"]')?.click());
    const joined = await waitFor(phone, (fp) => chatState.identity?.fingerprint === fp, { timeoutMs: 45000, arg: fpAlice });
    check('a second device joins the account', joined === true);
    await waitFor(phone, (fp) => (chatState.peers || []).some((peer) => peer.fingerprint === fp), { timeoutMs: 30000, arg: fpBob });
    /* g1 does not answer this device: it ends up on g2. */
    await phone.context().route(`${g1.url}/**`, (route) => route.abort());

    await bob.evaluate((member) => {
      const id = generateId('space');
      const space = upsertSharedSpace({
        type: 'group', conversationId: id, name: 'guests-group', members: [chatState.identity.fingerprint, member],
        ownerPeerId: chatState.peerId, ownerFingerprint: chatState.identity.fingerprint, rev: 1, createdAt: new Date().toISOString(),
      });
      broadcastSpaceRecord(space);
    }, fpAlice);
    check('the contact’s group reaches the account', await waitFor(alice, () => chatState.spaces.groups.some((g) => g.name === 'guests-group'), { timeoutMs: 60000 }) === true);

    await bed.stop('h');
    const placed = await until(async () => (await stay(alice))?.id === g1.id && (await stay(phone))?.id === g2.id && await connected(alice) && await connected(phone), 90000);
    check('home stops: the two devices are guests on two relays', placed, `${(await stay(alice))?.name} / ${(await stay(phone))?.name}`);
    await say(bob, fpAlice, 'devices-1');
    check('a message reaches the first device', await until(async () => await received(alice, fpBob, 'devices-1') === 1, 120000));
    check('and the second', await until(async () => await received(phone, fpBob, 'devices-1') === 1, 120000));

    const groupOf = (page) => page.evaluate(() => (chatState.spaces.groups.find((g) => g.name === 'guests-group') || {}).conversationId || '');
    const gBob = await groupOf(bob);
    const gAlice = await groupOf(alice);
    await bob.evaluate((id) => { chatState.activeConversationId = id; chatState.activePeerClientId = ''; renderPeers(); renderActivePeer(); renderMessages(); }, gBob);
    await bob.waitForSelector('#chatComposer', { state: 'visible', timeout: 30000 });
    await bob.fill('#chatComposer', 'group-during-stay');
    await bob.press('#chatComposer', 'Enter');
    check('a group message reaches a guest member', await waitFor(alice, ({ id }) => (chatState.history[id] || []).some((e) => e.text === 'group-during-stay'), { timeoutMs: 120000, arg: { id: gAlice } }) === true);

    check('the guest’s TURN comes from its guest relay', await alice.evaluate((url) => chatState.profile.turnOrigin === url, g1.url), await alice.evaluate(() => chatState.profile.turnOrigin));
    await alice.evaluate((fp) => window.openConversationWithFingerprint?.(fp), fpBob);
    await alice.waitForTimeout(1200);
    await alice.evaluate(() => document.getElementById('chatThreadMenuBtn')?.click());
    await alice.waitForTimeout(400);
    await alice.evaluate(() => document.getElementById('chatVoiceCallBtn')?.click());
    const rang = await until(() => bob.evaluate(() => {
      const visible = (el) => Boolean(el) && !el.classList.contains('hidden') && el.offsetParent !== null;
      return visible(document.getElementById('chatAcceptCallBtn')) || visible(document.getElementById('chatModalAcceptBtn'));
    }), 45000, 500);
    check('a call from the guest rings the contact', rang);
    await bob.evaluate(() => { document.getElementById('chatAcceptCallBtn')?.click(); document.getElementById('chatModalAcceptBtn')?.click(); });
    const live = await until(async () => (await alice.evaluate(() => window.__callStateProbe?.()?.live)) === true && (await bob.evaluate(() => window.__callStateProbe?.()?.live)) === true, 45000, 500);
    check('and it connects', live);
    await alice.evaluate(() => { document.getElementById('chatFloatingEndCallBtn')?.click(); document.getElementById('chatEndCallControlBtn')?.click(); document.getElementById('chatEndCallBtn')?.click(); });
    for (const page of [alice, bob, phone]) await page.context().close();
  }


  /* ---- move -------------------------------------------------------------------- */
  if (wants('move')) {
    section('move: a home filtered for one person');
    const bed = await bedWith({ clusters: { h: 'X', g1: 'X' } });
    const { h, g1, g2 } = bed.relays;
    const door = await h.door();
    const timings = { ...FAST, moveAfterMs: 4000, remindMs: 3000, declineMs: 60000 };
    const alice = await guestApp('MOVA', bed, door.url, timings);
    const phone = await guestApp('MOVP', bed, h.url, timings);
    const bob = await guestApp('MOVB', bed, g2.url, timings);
    const { fpA: fpAlice } = await befriend(alice, bob);
    const yes = (page) => page.evaluate(() => { window.PoorijaDialogs.confirm = async () => true; window.PoorijaDialogs.choose = async (_q, options) => options[0]?.value; });
    await yes(alice); await yes(phone);
    await alice.evaluate(() => window.openLinkChooser('account'));
    await alice.evaluate(() => document.querySelector('.chat-link-overlay [data-link-action="show-add"]')?.click());
    await waitFor(alice, () => Boolean(window.__deviceLinkProbe?.qr()), { timeoutMs: 20000 });
    await phone.evaluate((text) => window.__deviceLinkProbe.scan(text), await alice.evaluate(() => window.__deviceLinkProbe.qr()));
    await waitFor(alice, () => Boolean(document.querySelector('.chat-link-overlay [data-link-action="approve"]')), { timeoutMs: 20000 });
    await alice.evaluate(() => document.querySelector('.chat-link-overlay [data-link-action="approve"]')?.click());
    check('a second device of the account stays on home', await waitFor(phone, (fp) => chatState.identity?.fingerprint === fp, { timeoutMs: 45000, arg: fpAlice }) === true);
    /* It stays at home throughout: no guest stays of its own, and it is never
       the one to answer a move question. */
    /* Linking hands the new device the account's settings, the server
       address among them — alice's door. This device is at home itself. */
    await phone.evaluate((url) => {
      chatState.profile.useGuestRelays = false;
      chatState.profile.serverUrl = url;
      chatState.profile.activeGuest = null;
      saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
      window.__movePrompts = [];
      window.PoorijaDialogs.choose = async (question) => { window.__movePrompts.push(question); return 'later'; };
      try { chatState.ws?.close(); } catch (_error) { /* gone */ }
      chatState.ws = null;
      connectChatTransport().catch(() => {});
    }, h.url);
    check('it is connected at home under its own address', await until(async () => await connected(phone) && await phone.evaluate((id) => relayFamilyHomeId() === id, h.id), 45000));
    await until(() => alice.evaluate(() => (currentRoster()?.members || []).length >= 2), 30000);
    await alice.evaluate(() => {
      window.__movePrompts = [];
      window.__moveAnswer = 'later';
      window.PoorijaDialogs.choose = async (question, options) => {
        window.__movePrompts.push({ question, options: options.map((option) => option.value) });
        return window.__moveAnswer;
      };
    });
    const prompts = () => alice.evaluate(() => window.__movePrompts.length);

    door.block();
    check('home filtered for this one person: a guest on g1, home up as g1 sees it', await until(async () => (await stay(alice))?.id === g1.id && await connected(alice)
      && await alice.evaluate(() => guestModeState.homeUp === true), 60000));

    await bed.stop('h');
    await sleep(timings.moveAfterMs + 4000);
    check('while home’s state is unknown, no move is offered', await prompts() === 0, String(await prompts()));
    await bed.start('h');

    check('after the wait with home up for everyone else, the move is offered', await until(async () => await prompts() >= 1, 60000));
    const first = await alice.evaluate(() => window.__movePrompts[0]);
    check('with its reasons, and the three answers', /works for everyone else/.test(first.question) && /probably filtered/.test(first.question)
      && /link between them/.test(first.question) && /may itself be filtered/.test(first.question) && /notifications/i.test(first.question)
      && JSON.stringify(first.options) === JSON.stringify(['move', 'later', 'no']), first.question.slice(0, 160));
    check('it names the other device that will move too', /will move too/.test(first.question), `${first.question.slice(-120)} roster ${await alice.evaluate(() => (currentRoster()?.members || []).length)}`);
    check('"remind me later" brings it back after the wait', await until(async () => await prompts() >= 2, 30000));
    const beforeNo = await prompts();
    await alice.evaluate(() => { window.__moveAnswer = 'no'; });
    await until(async () => await prompts() >= beforeNo + 1, 30000);
    await sleep(300);
    const afterNo = await prompts();
    await sleep(timings.remindMs * 2 + 2000);
    check('"no" keeps it away', await prompts() === afterNo, `${afterNo} → ${await prompts()}`);

    await phone.evaluate(() => {
      window.__phoneFrames = [];
      const original = window.handleHomeMoveFrame;
      window.handleHomeMoveFrame = (message) => { window.__phoneFrames.push(JSON.stringify(message).slice(0, 100)); return original(message); };
    });
    await alice.evaluate(() => { window.__moveAnswer = 'move'; chatState.profile.moveOffer = { ...(chatState.profile.moveOffer || {}), nextAt: 0 }; });
    check('moved: the configured address is g1', await until(() => alice.evaluate((url) => chatState.profile.serverUrl === url && !chatState.profile.activeGuest, g1.url), 60000),
      JSON.stringify(await alice.evaluate((url) => ({ want: url, serverUrl: chatState.profile.serverUrl, guest: chatState.profile.activeGuest?.name || null }), g1.url)));
    check('connected there as at home', await until(async () => await connected(alice) && await inUse(alice) === g1.url, 30000));
    /* The device at home is opened again (it may have locked itself, and it
       stopped redialling while home was down): home hands it the signed move
       when it proves itself there. */
    if (await phone.evaluate(() => window.PoorijaApp?.state?.isLocked === true)) await unlockAgain(phone);
    await phone.evaluate(() => { chatState.shouldReconnect = true; connectChatTransport().catch(() => {}); });
    check('the other device follows, with no question asked', await until(() => phone.evaluate((url) => chatState.profile.serverUrl === url, g1.url), 90000)
      && await phone.evaluate(() => (window.__movePrompts || []).length === 0),
      JSON.stringify(await phone.evaluate(() => ({ serverUrl: chatState.profile.serverUrl, frames: window.__phoneFrames, connected: Boolean(chatState.connected && chatState.ws?.readyState === 1) }))));
    const stale = await phone.evaluate(async (hId) => {
      const fp = chatState.identity.fingerprint;
      const from = relayFamilyHomeId();
      const old = await signGuestStatement({ v: 1, type: 'home-move', fp, from, to: hId, at: Date.now() - 8 * 24 * 3600 * 1000 });
      const ahead = await signGuestStatement({ v: 1, type: 'home-move', fp, from, to: hId, at: Date.now() + 3600 * 1000 });
      return { old: await followSiblingMove(old), ahead: await followSiblingMove(ahead), stillAt: chatState.profile.serverUrl };
    }, h.id);
    check('a move statement more than a week old, or dated ahead, is not followed', stale.old === false && stale.ahead === false && stale.stillAt === g1.url, JSON.stringify(stale));
    check('and the device that followed has the new home pinned', await phone.evaluate((id) => relayPinFor(chatState.profile.serverUrl)?.id === id, g1.id));
    /* The contact writes to her old home: it forwards, and says it no longer
       knows her — which sends the contact to ask where she lives now. */
    const fpBobHere = fingerprintOf(await identity(bob));
    await say(bob, fpAlice, 'after-move');
    check('a contact’s message to the old home still reaches her', await until(async () => await received(alice, fpBobHere, 'after-move') === 1, 90000));
    check('and the contact learns her new home', await until(() => bob.evaluate(({ fp, id }) => window.findPeerByAnyKey(fp)?.homeRelay?.id === id, { fp: fpAlice, id: g1.id }), 90000),
      await bob.evaluate((fp) => window.findPeerByAnyKey(fp)?.homeRelay?.id?.slice(0, 12), fpAlice));
    for (const page of [alice, phone, bob]) await page.context().close();
  }


  /* ---- redial ------------------------------------------------------------------- */
  if (wants('redial')) {
    section('redial: home down for a while, then back');
    const bed = await bedWith({});
    const { h } = bed.relays;
    const P = await guestApp('REDIAL', bed, h.url);
    await P.evaluate(() => { const box = document.getElementById('chatUseGuestRelays'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); });
    check('connected at home, guest stays off', await until(() => connected(P), 30000) && await P.evaluate(() => chatState.profile.useGuestRelays === false));
    /* What was said before (the page's first address was not a relay) is not
       about this outage. */
    await P.evaluate(() => window.PoorijaApp.toasts.clear());
    await bed.stop('h');
    await sleep(25000);
    const during = await P.evaluate(() => ({ should: chatState.shouldReconnect, toasts: (window.__toasts || []).join(' | ') }));
    check('while home is down, the app keeps meaning to reconnect', during.should === true, JSON.stringify(during).slice(0, 200));
    check('and never tells the person a working address is invalid', !/valid relay/i.test(during.toasts), during.toasts.slice(-200));
    await bed.start('h');
    check('home back: the app dials again by itself', await until(() => connected(P), 90000));
    /* An address that never answered is still a wrong setting, said so, and
       not dialled for ever. */
    const dead = `http://localhost:${await new Promise((resolve) => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); })}`;
    await P.evaluate((url) => {
      window.PoorijaApp.toasts.clear();
      const field = document.getElementById('chatServerUrl');
      field.value = url;
      field.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('chatConnectBtn')?.click();
    }, dead);
    const told = await until(() => P.evaluate(() => /valid relay/i.test((window.__toasts || []).join(' ')) && chatState.shouldReconnect === false), 40000);
    check('an address that never answered is still called invalid, and not dialled for ever', told, JSON.stringify(await P.evaluate(() => ({ toasts: (window.__toasts || []).slice(-2), should: chatState.shouldReconnect }))));
    await P.context().close();
  }

  /* ---- ui / switch --------------------------------------------------------------- */
  if (wants('ui') || wants('switch')) {
    section('ui and switch: what people see, and their own say');
    const bed = await bedWith({});
    const { h, g1 } = bed.relays;
    const P = await guestApp('UI', bed, h.url);
    const view = () => P.evaluate(() => {
      const badge = document.getElementById('chatGuestBadge');
      const note = document.getElementById('chatMirrorNote');
      if (typeof renderRelayFamily === 'function') renderRelayFamily();
      const guestRow = document.querySelector('#chatRelayFamily li.is-guest');
      return {
        badge: badge && !badge.classList.contains('hidden') ? badge.textContent : '',
        note: note && !note.classList.contains('hidden') ? note.textContent : '',
        family: guestRow ? guestRow.textContent : '',
        toggle: document.getElementById('chatUseGuestRelays')?.checked ?? null,
      };
    });
    check('the switch is on by default', (await view()).toggle === true);
    if (wants('ui')) {
      bed.relays.g2.front.block();
      await bed.stop('h');
      await until(async () => (await stay(P))?.id === g1.id && await connected(P), 60000);
      const during = await view();
      check('during a stay: the badge names the guest relay', /g1/.test(during.badge) && /Temporarily on relay/.test(during.badge), during.badge);
      check('the line under the address says why and that home is tried again', /unreachable/.test(during.note) && /g1/.test(during.note), during.note);
      check('the family card marks the guest relay', /g1/.test(during.family) && /guest/.test(during.family), during.family);
      bed.relays.g2.front.unblock();
      await bed.start('h');
      await until(async () => !(await stay(P)) && await connected(P), 60000);
      const after = await view();
      check('back home: badge, line and mark are gone', !after.badge && !/temporarily/i.test(after.note) && !after.family, JSON.stringify(after));
    }
    if (wants('switch')) {
      await P.evaluate(() => { const box = document.getElementById('chatUseGuestRelays'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); });
      check('turned off, it is saved', await until(() => P.evaluate(() => chatState.profile.useGuestRelays === false), 5000));
      await bed.stop('h');
      await sleep(FAST.downMs * 3 + 3000);
      check('off: home stops and nobody becomes a guest', !(await stay(P)));
      await P.evaluate(() => { const box = document.getElementById('chatUseGuestRelays'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); });
      check('on again: a guest stay begins', await until(async () => Boolean((await stay(P))?.id), 60000));
      await P.evaluate(() => { const box = document.getElementById('chatUseGuestRelays'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); });
      check('off during a stay: the stay ends at once', await until(async () => !(await stay(P)), 10000));
      await sleep(2500);
      const book = (() => { try { return JSON.parse(fs.readFileSync(path.join(bed.relays.g1.dir, 'guests.json'), 'utf8')).guests || {}; } catch (_error) { return {}; } })();
      const fp = await P.evaluate(() => chatState.identity.fingerprint);
      const book2 = (() => { try { return JSON.parse(fs.readFileSync(path.join(bed.relays.g2.dir, 'guests.json'), 'utf8')).guests || {}; } catch (_error) { return {}; } })();
      check('and the guest relay was told (guest-end)', !Object.values(book).some((entry) => entry.fp === fp) && !Object.values(book2).some((entry) => entry.fp === fp));
      await bed.start('h');
    }
    await P.context().close();
  }

  /* ---- delivery and routes ----------------------------------------------------- */
  if (wants('delivery')) {
    section('delivery: messages reach a guest, and nobody’s address moves');
    const bed = await bedWith({ clusters: { h: 'X', g1: 'X' } });
    const { h, g1, g2 } = bed.relays;
    const alice = await guestApp('ALICE', bed, h.url);
    const carol = await guestApp('CAROL', bed, h.url);
    const bob = await guestApp('BOB', bed, g2.url);
    const ab = await befriend(alice, bob);
    const ac = await befriend(alice, carol);
    const fpAlice = ab.fpA; const fpBob = ab.fpB; const fpCarol = ac.fpB;
    await say(alice, fpBob, 'before-1');
    check('before the outage, messages cross between the relays', await until(async () => await received(bob, fpAlice, 'before-1') === 1, 60000));

    await bed.stop('h');
    check('home stops: both of h’s people are guests on g1', await until(async () => (await stay(alice))?.id === g1.id && (await stay(carol))?.id === g1.id
      && await connected(alice) && await connected(carol), 60000));
    await say(bob, fpAlice, 'outage-b1');
    check('a contact on g2 reaches the guest, once', await until(async () => await received(alice, fpBob, 'outage-b1') >= 1, 90000) && await received(alice, fpBob, 'outage-b1') === 1);
    await say(alice, fpBob, 'outage-a1');
    check('the guest’s answer reaches the contact', await until(async () => await received(bob, fpAlice, 'outage-a1') === 1, 90000));
    await say(carol, fpAlice, 'outage-c1');
    check('two guests on one relay reach each other', await until(async () => await received(alice, fpCarol, 'outage-c1') === 1, 60000));
    check('the contact’s stored address for the guest is still home', await bob.evaluate(({ fp, id }) => window.findPeerByAnyKey(fp)?.homeRelay?.id === id, { fp: fpAlice, id: h.id }));
    /* A live peer connection from before the outage may have carried that
       message; asking is what the transit refusal does. */
    await bob.evaluate((fp) => askForGuestRoute(window.findPeerByAnyKey(fp)), fpAlice);
    check('asked, the linked relay names the guest relay, kept in memory only', await bob.evaluate(({ fp, id }) => chatState.guestRoutes?.get?.(fp)?.id === id, { fp: fpAlice, id: g1.id }));
    const noticeChecks = await bob.evaluate(async ({ fp, g1id, g2id }) => {
      const peer = window.findPeerByAnyKey(fp);
      const notice = (await (async () => {
        const tag = transitQueryTag('route');
        const answer = awaitTransitAnswer(tag, 10000);
        const relay = (await linkedRelays({ force: true })).find((entry) => entry.id === g1id);
        sendViaTransit({ type: 'route-query', toFingerprint: fp, tag }, { id: relay.id, key: relay.key }, peer);
        return answer;
      })())?.notice;
      return {
        real: await guestNoticeHolds(peer, notice, g1id),
        otherRelay: await guestNoticeHolds(peer, notice, g2id),
        tampered: await guestNoticeHolds(peer, notice && { ...notice, statement: { ...notice.statement, until: notice.statement.until + 1 } }, g1id),
        none: await guestNoticeHolds(peer, null, g1id),
      };
    }, { fp: fpAlice, g1id: g1.id, g2id: g2.id });
    check('the guest’s notice holds for its relay, and for nothing else', noticeChecks.real === true && noticeChecks.otherRelay === false && noticeChecks.tampered === false && noticeChecks.none === false, JSON.stringify(noticeChecks));
    const provenOnG1 = (() => { try { return JSON.parse(fs.readFileSync(path.join(g1.dir, 'known-identities.json'), 'utf8')).proven || {}; } catch (_error) { return {}; } })();
    check('g1 never wrote the guests down as residents', !provenOnG1[fpAlice] && !provenOnG1[fpCarol]);

    await bed.start('h');
    check('home is back: both go home', await until(async () => !(await stay(alice)) && !(await stay(carol)) && await connected(alice), 60000));
    check('the contact still holds the stale guest route', await bob.evaluate((fp) => Boolean(chatState.guestRoutes?.get?.(fp)), fpAlice));
    await say(bob, fpAlice, 'after-b2');
    check('a message on the stale guest route still arrives, through g1’s forwarding', await until(async () => await received(alice, fpBob, 'after-b2') === 1, 90000));
    check('and the contact’s stored address never moved', await bob.evaluate(({ fp, id }) => window.findPeerByAnyKey(fp)?.homeRelay?.id === id, { fp: fpAlice, id: h.id }));
    for (const page of [alice, bob, carol]) await page.context().close();
  }
} catch (error) {
  console.error(error);
  check('suite ran to the end', false, String(error?.message || error).slice(0, 300));
} finally {
  for (const bed of beds) await bed.shutdown().catch(() => {});
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
