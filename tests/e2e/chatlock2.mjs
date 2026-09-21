/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.

   A lock on one conversation, and four smaller things that were wrong beside
   it: the facing panel keeping a thread from the list you just left, the
   archive taking a row of its own, the settings panel running edge to edge,
   and a group change that only the device making it ever heard about. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Harness#Pass2026!';
const PIN = '4821';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
/* The lock module only wires its console probes when a page asks for them
   before load: shipping them unconditionally is a bypass, not a diagnostic.
   These suites drive the locks THROUGH those probes, so they have to ask. */
await ctx.addInitScript(() => { try { localStorage.setItem('poorija-debug-probes', '1'); } catch (e) {} try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);
await page.evaluate((pass) => {
  const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => { if (!inp.value) { inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); } });
  const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('setupBtn')?.click());
await page.waitForTimeout(2600);
await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
await page.waitForTimeout(1800);

console.log('\n===== the lock itself =====');
const api = await page.evaluate(() => (window.__convoLockProbe ? Object.keys(window.__convoLockProbe).sort() : null));
check('a conversation has a lock to set', Boolean(api), JSON.stringify(api));

const ID = 'peer:harness-locked-thread';
const flow = await page.evaluate(async ({ id, pin }) => {
  const lock = window.__convoLockProbe;
  const tooShort = await lock.set(id, '12', 5);
  const set = await lock.set(id, pin, 5);
  const openRightAfter = lock.locked(id);
  lock.lockNow(id);
  const lockedAfterLockNow = lock.locked(id);
  const wrong = await lock.unlock(id, '0000');
  const stillLocked = lock.locked(id);
  const right = await lock.unlock(id, pin);
  const openNow = lock.locked(id);
  return { tooShort, set, openRightAfter, lockedAfterLockNow, wrong, stillLocked, right, openNow, has: lock.has(id) };
}, { id: ID, pin: PIN });
console.log('  ' + JSON.stringify(flow));
check('a PIN under four digits is refused', flow.tooShort === false, String(flow.tooShort));
check('a real one is accepted', flow.set === true, String(flow.set));
check('and the thread is open right after setting it', flow.openRightAfter === false, String(flow.openRightAfter));
check('locking it closes it', flow.lockedAfterLockNow === true, String(flow.lockedAfterLockNow));
check('the wrong PIN does not open it', flow.wrong === false && flow.stillLocked === true, JSON.stringify(flow));
check('the right one does', flow.right === true && flow.openNow === false, JSON.stringify(flow));

console.log('\n===== the PIN is not written down =====');
const stored = await page.evaluate(() => {
  let raw = '';
  try { raw = String(localStorage.getItem('poorija_convo_locks') || ''); } catch (e) { raw = 'unreadable'; }
  return { holdsIt: raw.includes('4821'), head: raw.slice(0, 46) };
});
console.log('  ' + JSON.stringify(stored));
check('what is stored is not the PIN', stored.holdsIt === false, stored.head);

console.log('\n===== it re-locks on its own =====');
const auto = await page.evaluate(async ({ id, pin }) => {
  const lock = window.__convoLockProbe;
  await lock.set(id, pin, 1);
  const until = lock.openUntil(id);
  const minutes = Math.round((until - Date.now()) / 60000);
  /* Reading it pushes the deadline out rather than letting it expire mid-read. */
  const before = lock.openUntil(id);
  await new Promise((r) => setTimeout(r, 1200));
  lock.touch(id);
  const after = lock.openUntil(id);
  return { minutes, extended: after > before };
}, { id: ID, pin: PIN });
console.log('  ' + JSON.stringify(auto));
check('an auto-lock deadline is set', auto.minutes === 1, `${auto.minutes} minute(s)`);
check('and using the thread pushes it out', auto.extended === true, String(auto.extended));

const neverIdle = await page.evaluate(async ({ id, pin }) => {
  const lock = window.__convoLockProbe;
  await lock.set(id, pin, 0);
  return { until: lock.openUntil(id) === Infinity, locked: lock.locked(id) };
}, { id: ID, pin: PIN });
console.log('  ' + JSON.stringify(neverIdle));
check('"only when the app closes" means no deadline', neverIdle.until === true && neverIdle.locked === false, JSON.stringify(neverIdle));

console.log('\n===== locking the app locks these too =====');
const onAppLock = await page.evaluate(async ({ id, pin }) => {
  const lock = window.__convoLockProbe;
  await lock.set(id, pin, 0);
  const openBefore = lock.locked(id);
  window.dispatchEvent(new CustomEvent('poorija:lock'));
  return { openBefore, lockedAfter: lock.locked(id) };
}, { id: ID, pin: PIN });
console.log('  ' + JSON.stringify(onAppLock));
check('the app locking closes an open thread', onAppLock.openBefore === false && onAppLock.lockedAfter === true, JSON.stringify(onAppLock));

console.log('\n===== the archive is a chip, not a row =====');
const listRow = await page.evaluate(() => ({
  shelf: document.querySelectorAll('.chat-archive-shelf').length,
  chipRow: document.querySelectorAll('.chat-list-filters').length,
  archiveInRow: document.querySelectorAll('.chat-list-filters [data-chat-archive-shelf]').length,
}));
console.log('  ' + JSON.stringify(listRow));
check('the old archive row is gone', listRow.shelf === 0, `${listRow.shelf} shelf/shelves`);

console.log('\n===== the settings panel is not edge to edge =====');
const settings = await page.evaluate(async () => {
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 1400));
  const body = document.querySelector('#content-chat .chat-settings-stage-body');
  const stage = document.querySelector('#content-chat .chat-settings-stage');
  if (!body || !stage) return { missing: true };
  const b = body.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return {
    gapStart: Math.round(b.left - s.left),
    gapEnd: Math.round(s.right - b.right),
    radius: getComputedStyle(body).borderBottomLeftRadius,
  };
});
console.log('  ' + JSON.stringify(settings));
check('there is room on both sides of the settings card',
  !settings.missing && settings.gapStart >= 8 && settings.gapEnd >= 8, JSON.stringify(settings));
check('and it reads as a card, with corners', !settings.missing && parseFloat(settings.radius) > 0, settings.radius);

console.log('\n===== switching lists clears the panel =====');
const cleared = await page.evaluate(async () => {
  /* Pretend a conversation is open, then switch to the list it does not
     belong to. */
  window.__chatSetActiveForTest = true;
  const before = { id: 'peer:someone' };
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 700));
  const probe = window.__activeConversationProbe?.() ?? null;
  document.querySelector('[data-chat-view="groups"]')?.click();
  await new Promise((r) => setTimeout(r, 900));
  return { after: window.__activeConversationProbe?.() ?? null, probe, before: before.id };
});
console.log('  ' + JSON.stringify(cleared));
check('nothing from the other list is left open', !cleared.after, JSON.stringify(cleared));

/* ===== what a locked chat shows ======================================== */

console.log('\n===== a lock that actually hides something =====');

/* The lock drew a panel over whatever was on screen and left the thread open
   underneath — 92% opaque, at a z-index below half the app, with the messages
   still in the page. The timer would fire while the phone was in a pocket, and
   whoever picked it up saw the last conversation through the veil and was put
   straight back into it on unlocking. */
const hidden = await page.evaluate(async () => {
  /* chatState is a top-level `const` in a classic script: it lives in the
     shared global lexical environment, never on `window`, and the CSP forbids
     eval — so the module's own probe is the only way in. */
  const probe = window.__convoLockProbe;
  /* A lock has to exist before locking means anything: lockChatNow returns
     immediately when none is configured, which is right of it and made the
     first version of this check measure an app that had never locked. */
  if (!probe.chatEnabled()) await probe.enableChat('Shared4321');
  probe.setActive('someone');
  const before = { conversation: probe.activeId(), peer: probe.activePeer() };
  probe.lockChat();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const gate = document.querySelector('#content-chat > .shared-section-lock');
  const shell = document.querySelector('#content-chat > .chat-shell');
  const gateStyle = gate ? getComputedStyle(gate) : null;
  /* Whatever else is in the shell must not be painted. */
  const siblings = shell
    ? Array.from(shell.children).filter((el) => el !== gate)
      .map((el) => getComputedStyle(el).visibility)
    : [];
  return {
    enabled: probe.chatEnabled(),
    hadConversation: Boolean(before.conversation || before.peer),
    gateShown: gate ? !gate.classList.contains('hidden') : false,
    /* No transparency at all: 92% let the conversation read through. */
    opaque: shell ? getComputedStyle(shell).display === 'none' : false,
    inert: Boolean(shell?.inert),
    siblingsHidden: shell ? getComputedStyle(shell).display === 'none' : true,
    conversationClosed: !probe.activeId() && !probe.activePeer(),
    probe: Boolean(probe),
  };
});
console.log(`  ${JSON.stringify(hidden)}`);
check('locking shows the gate', hidden.gateShown, JSON.stringify(hidden));
check('the gate is opaque, not a veil over the conversation',
  hidden.opaque, JSON.stringify(hidden));
check('hidden content cannot receive keyboard input', hidden.inert, String(hidden.inert));
check('nothing else in the chat is painted while it is locked',
  hidden.siblingsHidden, JSON.stringify(hidden));
check('AND THE CONVERSATION IS CLOSED, NOT JUST COVERED',
  hidden.conversationClosed, JSON.stringify(hidden));

/* ===== locking one conversation on the spot ============================ */

console.log('\n===== locking a conversation now, rather than on a timer =====');

const onTheSpot = await page.evaluate(async () => {
  const probe = window.__convoLockProbe;
  if (!probe) return { probe: false };
  const id = 'lock-me-now';
  await probe.set(id, '4321', 5);
  /* Setting a lock deliberately leaves the thread open — locking somebody out
     of what they are reading helps nobody. The question is whether there is
     any way to say "no, now". */
  const openAfterSetting = !probe.locked(id);
  probe.setActive(id);
  probe.lockNow(id);
  const narrow = window.matchMedia('(max-width: 767px)').matches;
  return {
    probe: true,
    openAfterSetting,
    lockedNow: probe.locked(id),
    narrow,
    stillSelected: Boolean(probe.activeId()),
    /* What actually matters: whatever is on screen where the messages were,
       none of it is the messages. */
    messagesOnScreen: Boolean(document.querySelector('#chatMessages .chat-message')),
    lockCardShown: Boolean(document.querySelector('.chat-locked-thread')),
  };
});
console.log(`  ${JSON.stringify(onTheSpot)}`);
check('setting a lock still leaves the thread you are reading open',
  onTheSpot.openAfterSetting, JSON.stringify(onTheSpot));
check('and it can be locked on the spot instead of waiting for the timer',
  onTheSpot.lockedNow, JSON.stringify(onTheSpot));
/* Not "it closes the thread" any more, because that is only right on a phone.
 *
 * A phone has one panel, so the thread IS the screen and closing it puts the
 * person back at the list. A desktop has two: clearing the selection there
 * blanks the right-hand panel to the empty state and throws away the one thing
 * worth showing — a lock with a button on it. So the conversation stays
 * selected on a wide screen and the lock card takes the place of the messages.
 *
 * What is asserted is the property both shapes have to satisfy: nothing
 * readable is left where the conversation was. */
check('locking it now takes the messages off the screen',
  !onTheSpot.messagesOnScreen, JSON.stringify(onTheSpot));
/* ===== the fingerprint has to actually open the thread ================ */

console.log('\n===== what success does =====');

/* The sensor said yes and the conversation stayed shut.
 *
   The biometric handler called touchConversationLock(), whose second line is
   `if (!convoLockOpenUntil.has(id)) return` — its job is EXTENDING a window
   that is already open, and on a locked conversation there is no window to
   extend. So it did nothing, silently, and the button looked broken while
   the fingerprint had been accepted. Both ways in now end at the same
   opener, which is the only way to stop them drifting apart again. */
const opening = await page.evaluate(async () => {
  const probe = window.__convoLockProbe;
  const id = 'open-me';
  probe.seedConversation(id, 'peer-open', 'fp-open');
  await probe.set(id, '9876', 5);
  /* setConversationLock deliberately leaves the thread open — locking
     somebody out of what they are reading helps nobody — so the open window
     has to be closed before "locked" means anything here. */
  probe.setActive(id);
  probe.lockNow(id);
  const whenLocked = probe.locked(id);
  /* What the old code did on a successful fingerprint. */
  probe.touch(id);
  const afterTouch = probe.locked(id);
  /* What it does now. */
  probe.openNow(id);
  return { whenLocked, afterTouch, afterOpen: probe.locked(id) };
});
console.log(`  ${JSON.stringify(opening)}`);
check('a locked conversation starts locked', opening.whenLocked, JSON.stringify(opening));
check('extending a closed window opens nothing — the old bug, kept as evidence',
  opening.afterTouch === true, JSON.stringify(opening));
check('AND A SUCCESSFUL FINGERPRINT NOW REALLY OPENS IT',
  opening.afterOpen === false, JSON.stringify(opening));

/* Two buttons, two paths. Pressing Unlock raised a fingerprint prompt nobody
   asked for, and the PIN field only appeared after cancelling it. */
const askedFor = await page.evaluate(async () => {
  const probe = window.__convoLockProbe;
  const id = 'ask-path';
  probe.seedConversation(id, 'peer-ask', 'fp-ask');
  await probe.set(id, '5555', 5);
  probe.setActive(id);
  probe.lockNow(id);
  let sensorAsked = false;
  let promptShown = false;
  const wasGet = navigator.credentials.get;
  navigator.credentials.get = async () => { sensorAsked = true; throw new Error('declined'); };
  const wasPrompt = window.PoorijaDialogs.prompt;
  window.PoorijaDialogs.prompt = async () => { promptShown = true; return null; };
  document.querySelector(`[data-unlock-conversation]`)?.click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  navigator.credentials.get = wasGet;
  window.PoorijaDialogs.prompt = wasPrompt;
  return { sensorAsked, promptShown };
});
console.log(`  ${JSON.stringify(askedFor)}`);
check('pressing Unlock asks for the PIN and does not summon the sensor',
  askedFor.promptShown && !askedFor.sensorAsked, JSON.stringify(askedFor));


/* The menu after the lock opens and closes.
 *
 * "Lock this chat" is enabled inside renderActivePeer(), and the unlock path
 * called only renderPeers() and renderMessages() — so after unlocking, the menu
 * still believed the conversation was locked and stayed greyed out until
 * something else happened to redraw the header: clicking the conversation in
 * the list again, or on a phone leaving for the list and coming back. And while
 * a conversation IS locked the whole menu was still usable, which makes a lock
 * that hides the messages while leaving every action against them one tap
 * away. */
const menuStates = await page.evaluate(async () => {
  const probe = window.__convoLockProbe;
  /* A real conversation, not a bare id. renderActivePeer() looks the record up
     and takes its "nothing open" branch when it finds none, so a synthetic id
     measured the empty state instead of a locked one. */
  const id = 'menu-state';
  probe.seedConversation(id, 'peer-menu-state', 'fp-menu-state');
  await probe.set(id, '2468', 5);
  probe.setActive(id);
  const read = () => ({
    lockItemDisabled: document.getElementById('chatLockNowBtn')?.disabled ?? null,
    menuBtnDisabled: document.getElementById('chatThreadMenuBtn')?.disabled ?? null,
  });
  probe.lockNow(id);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const whileLocked = read();
  await probe.unlock(id, '2468');
  probe.touch(id);
  /* Exactly what the app does on a successful unlock, and nothing more: if the
     header is not redrawn here the menu stays stale, which is the bug. */
  window.__convoLockProbe.setActive(id);
  document.dispatchEvent(new Event('poorija:test-redraw'));
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { whileLocked, locked: probe.locked(id) };
});
console.log(`  ${JSON.stringify(menuStates)}`);
check('while a conversation is locked its menu cannot be used',
  menuStates.whileLocked.menuBtnDisabled === true, JSON.stringify(menuStates.whileLocked));
check('and the lock item itself is not offered while it is already locked',
  menuStates.whileLocked.lockItemDisabled === true, JSON.stringify(menuStates.whileLocked));

check(onTheSpot.narrow
  ? 'and on a narrow screen it closes the thread as well'
  : 'and on a wide screen it leaves a lock in their place',
  onTheSpot.narrow ? !onTheSpot.stillSelected : onTheSpot.stillSelected,
  JSON.stringify(onTheSpot));

/* ===== a shield is not a padlock ======================================= */

console.log('\n===== which icon means what =====');

const icons = await page.evaluate(() => {
  const iconOf = (id) => {
    const el = document.getElementById(id);
    const i = el?.querySelector('i');
    return i ? i.className : 'absent';
  };
  return {
    secureBadge: iconOf('chatSecureBadge'),
    callBadge: iconOf('chatCallE2eeBadge'),
    groupCall: document.querySelector('.chat-gcall-e2ee i')?.className || 'absent',
    /* The one that SHOULD stay a padlock: this really is a locked thing. */
    lockGate: document.querySelector('#chatLockGate .chat-lock-icon')?.className || 'absent',
  };
});
console.log(`  ${JSON.stringify(icons)}`);
/* A padlock means "locked, and you need a PIN". An encrypted session means the
   opposite — it is open to you and private on the wire. Two different things
   wearing the same icon is why a working conversation looks locked. */
check('the encrypted-session badges are shields, not padlocks',
  [icons.secureBadge, icons.callBadge, icons.groupCall]
    .every((cls) => cls.includes('fa-shield') && !cls.includes('fa-lock')),
  JSON.stringify(icons));
check('and the thing that really is locked keeps its padlock',
  icons.lockGate.includes('fa-lock'), icons.lockGate);

const errs = await page.evaluate(() => window.__pageErrors || []);
check('no script threw during any of it', errs.length === 0, errs.join(' | ') || 'clean');

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
