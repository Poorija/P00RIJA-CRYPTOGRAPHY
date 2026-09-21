/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The lab: several people in one room at the same time.
 *
 *   npm run relay             # terminal 1
 *   PORT=8123 npm run dev     # terminal 2
 *   node tests/e2e/chatlab.mjs
 *   LAB_PEERS=5 node tests/e2e/chatlab.mjs      # more participants
 *
 * Every other chat suite drives two browsers and one conversation. Most of
 * what goes wrong in a group does not happen with two people: a member joins
 * while a message is in flight, three sides of a mesh have to find each other,
 * a burst of messages arrives faster than the list can render, someone leaves
 * while the call is up.
 *
 * So this one opens N real browsers, pairs them all, and then asks the
 * questions that only have meaning with a crowd:
 *
 *   1. does a group reach everyone, and does the history agree afterwards?
 *   2. does a burst survive — sent fast, from several people at once?
 *   3. does a 1:1 call ring, connect, and hang up cleanly?
 *   4. does a group call build a full mesh, so everyone sees everyone?
 *   5. does the room survive someone leaving mid-conversation?
 *
 * Media is faked with Chromium's synthetic devices, so the calls are real
 * WebRTC — real signalling, real ICE, real peer connections — without needing
 * a camera. What is being tested is the plumbing, and the plumbing does not
 * know the difference.
 */

import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import process from 'node:process';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
/* Reachable FROM THE PAGE, not just from here: an https page cannot fetch
   http://localhost:9000 or open a ws:// socket to it — the browser blocks it as
   mixed content and the suite reads that as a relay that is down. When the app
   is served over https the relay defaults to that same origin, which is the
   container serving both halves. The env var still wins. */
const RELAY = process.env.RELAY_URL
  || (/^https:/i.test(BASE) ? String(BASE).replace(/\/+$/, '') : 'http://localhost:9000');
const PASS = 'Lab#Harness2026!';
const PEERS = Math.max(3, Math.min(6, Number(process.env.LAB_PEERS || 4)));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const waitFor = async (page, fn, { timeoutMs = 60000, arg = null } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await page.evaluate(fn, arg)) return true; } catch (_e) { /* navigating */ }
    await page.waitForTimeout(400);
  }
  return false;
};

/* --fake-device-for-media-stream gives getUserMedia a synthetic camera and
   microphone that always succeed, so a headless run can place a real call.
   --use-fake-ui skips the permission prompt. */
const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'
  ]
});

async function openPeer(tag) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    ignoreHTTPSErrors: true,
    permissions: ['microphone', 'camera']
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('poorija_lang', 'en'); } catch (e) {}
    /* The app reloads itself once when it sees a new service worker; that
       lands in the middle of the setup wizard and wipes it. */
    try { delete Navigator.prototype.serviceWorker; } catch (e) {}
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message.slice(0, 140)}`));
  page.__errors = errors;
  page.__tag = tag;

  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((pass) => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('setupPassword', pass); set('confirmPassword', pass);
    document.querySelectorAll('#initialSetup select').forEach((s, i) => {
      if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => {
      inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const cb = document.getElementById('acceptTermsCheckbox');
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  }, PASS);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('setupBtn')?.click());
  const unlocked = await waitFor(page, () => window.PoorijaApp?.state?.isLocked === false);
  if (!unlocked) console.log(`  ${tag}: setup never finished`);

  await page.evaluate(() => {
    window.__toasts = [];
    window.__clip = [];
    const orig = window.PoorijaApp?.showNotification?.bind(window.PoorijaApp);
    if (window.PoorijaApp) {
      window.PoorijaApp.showNotification = (m, t) => { window.__toasts.push(`${t}: ${m}`); return orig?.(m, t); };
    }
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__clip.push(t); return write(t).catch(() => {}); };
    document.getElementById('mobileInstallGate')?.classList.add('hidden');
    window.switchTab?.('chat');
  });
  await waitFor(page, () => Boolean(document.getElementById('chatDisplayName')), { timeoutMs: 6000 });
  await page.evaluate((name) => {
    const field = document.getElementById('chatDisplayName');
    if (!field) return;
    field.value = name;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('chatSaveProfileBtn')?.click();
  }, tag);
  await page.waitForTimeout(700);
  await page.evaluate((relay) => {
    const el = document.getElementById('chatServerUrl');
    if (el) { el.value = relay; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    document.getElementById('chatConnectBtn')?.click();
  }, RELAY);
  const online = await waitFor(page, () => (document.getElementById('chatPeerId')?.textContent || '').trim().length > 8);
  if (!online) console.log(`  ${tag}: never got a peer id`);
  return page;
}

const identityOf = async (p) => {
  await waitFor(p, () => typeof window.copyChatFullIdentity === 'function');
  return p.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });
};
const importIdentity = (p, text) => p.evaluate(async (t) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 900));
  const field = document.querySelector('[data-chat-manual-json]');
  if (field) { field.value = t; field.dispatchEvent(new Event('input', { bubbles: true })); }
  document.querySelector('[data-chat-manual-submit]')?.click();
}, text);
const fingerprintOf = (blob) =>
  JSON.parse(atob(String(blob).replace('poorija-chat-v1:', ''))).fingerprint;

const bubbleCount = (p) => p.evaluate(() =>
  document.querySelectorAll('#chatMessages [data-id]').length);

async function sendText(page, text) {
  await page.evaluate((t) => {
    const input = document.getElementById('chatComposer');
    if (!input) return;
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  /* A real click: a synthetic one does not reach the handler. */
  await page.click('#chatSendMessageBtn').catch(() => {});
}

/* ===== the room ========================================================== */

console.log(`\n===== opening ${PEERS} participants =====`);
const peers = [];
for (let i = 0; i < PEERS; i++) {
  peers.push(await openPeer(String.fromCharCode(65 + i)));   /* A, B, C, … */
}
const ids = [];
for (const p of peers) ids.push(await identityOf(p));
check('every participant got an identity from the relay',
  ids.every((id) => typeof id === 'string' && id.length > 20),
  `${ids.filter(Boolean).length}/${PEERS}`);

/* Everyone adds everyone. */
for (let i = 0; i < peers.length; i++) {
  for (let j = 0; j < peers.length; j++) {
    if (i !== j) await importIdentity(peers[i], ids[j]);
  }
}
await peers[0].waitForTimeout(3500);

const rosterSizes = [];
for (const p of peers) {
  rosterSizes.push(await p.evaluate(() =>
    document.querySelectorAll('#chatPeerList .chat-peer-card').length));
}
console.log('  contact counts: ' + JSON.stringify(rosterSizes));
check('everyone can see everyone else',
  rosterSizes.every((n) => n >= PEERS - 1), JSON.stringify(rosterSizes));

/* ===== 1. a group that reaches everyone ================================= */

console.log('\n===== 1. a group =====');
const [A, ...rest] = peers;
/* #chatStartChatBtn is context-sensitive: in the chats view it is "Start a
   chat" and opens the contact dialog; only in the groups view does it become
   "New group" and open the maker. Clicking it from the chats view left the
   maker hidden and the name field invisible, which read as a broken dialog
   and was really a test that had not switched views. */
await A.evaluate(() => document.querySelector('[data-chat-view="groups"]')?.click());
await A.waitForTimeout(700);
await A.evaluate(() => document.getElementById('chatStartChatBtn')?.click());
await A.waitForTimeout(1200);
await A.fill('#chatGroupNameInput', 'اتاق آزمایش');

const memberFps = ids.slice(1).map(fingerprintOf);
/* Wait for the picker to finish filling rather than reading it once.
   The roster arrives from the relay peer by peer, and reading it at a fixed
   moment caught two of three candidates on one run and all three on another —
   a flake that would have been reported as "a contact cannot be added to a
   group". If it never reaches the full count, that IS the bug, and the
   timeout says so. */
const pickerReady = await waitFor(A, (n) =>
  document.querySelectorAll('#chatGroupMembersPanel input[type="checkbox"]').length >= n,
  { timeoutMs: 30000, arg: PEERS - 1 });
check('the picker lists every contact once the roster settles',
  pickerReady === true,
  `${await A.evaluate(() => document.querySelectorAll('#chatGroupMembersPanel input[type="checkbox"]').length)} of ${PEERS - 1}`);

const picked = await A.evaluate((wanted) => {
  const chosen = [];
  document.querySelectorAll('#chatGroupMembersPanel input[type="checkbox"]').forEach((box) => {
    const want = wanted.includes(box.value);
    box.checked = want;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    if (want) chosen.push(box.value.slice(0, 8));
  });
  return chosen;
}, memberFps);
check('and every one of them can be selected',
  picked.length === PEERS - 1, `${picked.length} of ${PEERS - 1}`);

await A.waitForTimeout(500);
await A.evaluate(() => document.getElementById('chatCreateGroupBtn')?.click());
await A.waitForTimeout(4000);

const sawGroup = [];
for (const p of rest) {
  const ok = await waitFor(p, () => {
    document.querySelector('[data-chat-view="groups"]')?.click();
    return [...document.querySelectorAll('#chatPeerList .chat-peer-card')]
      .some((c) => /اتاق آزمایش/.test(c.textContent || ''));
  }, { timeoutMs: 30000 });
  sawGroup.push(ok);
}
check('the group reaches every member',
  sawGroup.every(Boolean), `${sawGroup.filter(Boolean).length}/${rest.length}`);

/* Open the group on every side. */
for (const p of peers) {
  await p.evaluate(() => {
    document.querySelector('[data-chat-view="groups"]')?.click();
    const card = [...document.querySelectorAll('#chatPeerList .chat-peer-card')]
      .find((c) => /اتاق آزمایش/.test(c.textContent || ''));
    card?.click();
  });
  await p.waitForTimeout(500);
}

/* ===== 2. a burst, from several people at once ========================== */

console.log('\n===== 2. a burst =====');
const BURST = 8;
const before = [];
for (const p of peers) before.push(await bubbleCount(p));

/* Everyone talks at the same time, which is the case a serialised test never
   reaches: the renders overlap and the ordering has to hold anyway. */
await Promise.all(peers.map(async (p, i) => {
  for (let n = 1; n <= BURST; n++) {
    await sendText(p, `${p.__tag}-${n}`);
    await p.waitForTimeout(120);
  }
}));
await peers[0].waitForTimeout(9000);

const totals = [];
for (const p of peers) totals.push(await bubbleCount(p) - before[peers.indexOf(p)]);
const expected = BURST * PEERS;
console.log(`  each side should hold ${expected}: ${JSON.stringify(totals)}`);
check('every message reaches every member',
  totals.every((n) => n >= expected * 0.9),
  `${JSON.stringify(totals)} of ${expected}`);

/* The strongest statement about a group: the transcripts agree. */
const transcripts = [];
for (const p of peers) {
  transcripts.push(await p.evaluate(() => [...document.querySelectorAll('#chatMessages [data-id]')]
    .map((n) => (n.querySelector('.chat-message-text')?.textContent || '').trim())
    .filter((t) => /^[A-F]-\d+$/.test(t))
    .sort()
    .join(',')));
}
const agree = transcripts.every((t) => t === transcripts[0]);
check('and every member ends up with the same transcript', agree,
  agree ? `${transcripts[0].split(',').length} messages, identical everywhere`
        : transcripts.map((t, i) => `${peers[i].__tag}:${t.split(',').length}`).join(' '));

/* ===== 3. a call between two people ===================================== */

console.log('\n===== 3. a 1:1 call =====');
const B = peers[1];
await A.evaluate(() => document.querySelector('[data-chat-view="chats"]')?.click());
await A.waitForTimeout(900);
const opened = await A.evaluate((fp) => {
  const cards = [...document.querySelectorAll('#chatPeerList .chat-peer-card')];
  const card = cards.find((c) => (c.getAttribute('data-chat-conversation') || '').startsWith(fp.slice(0, 16)))
            || cards[0];
  card?.click();
  return { cards: cards.length, clicked: card?.getAttribute('data-chat-conversation')?.slice(0, 16) || null };
}, fingerprintOf(ids[1]));
console.log('  opened conversation: ' + JSON.stringify(opened));
await A.waitForTimeout(1500);
check('a one-to-one conversation is open before calling',
  Boolean(opened.clicked), JSON.stringify(opened));

/* The call controls live behind the thread menu, not the composer's + sheet —
   the first version of this reached for #chatComposerPlusBtn and nothing
   rang, which looked like a broken call and was a wrong button. */
const ringing = (p) => p.evaluate(() => {
  const visible = (el) => Boolean(el) && !el.classList.contains('hidden') && el.offsetParent !== null;
  return visible(document.getElementById('chatAcceptCallBtn'))
      || visible(document.getElementById('chatModalAcceptBtn'));
});
const answer = async (p) => {
  for (let i = 0; i < 24; i += 1) {
    const how = await p.evaluate(() => {
      const visible = (el) => Boolean(el) && !el.classList.contains('hidden') && el.offsetParent !== null;
      const a = document.getElementById('chatAcceptCallBtn');
      const m = document.getElementById('chatModalAcceptBtn');
      if (visible(a)) { a.click(); return 'sheet'; }
      if (visible(m)) { m.click(); return 'modal'; }
      return '';
    });
    if (how) return how;
    await p.waitForTimeout(500);
  }
  return '';
};
const hangUp = async (p) => {
  await p.evaluate(() => {
    document.getElementById('chatFloatingEndCallBtn')?.click();
    document.getElementById('chatEndCallControlBtn')?.click();
    document.getElementById('chatEndCallBtn')?.click();
  });
  await p.waitForTimeout(2500);
};

await A.evaluate(() => document.getElementById('chatThreadMenuBtn')?.click());
await A.waitForTimeout(500);
await A.evaluate(() => document.getElementById('chatVoiceCallBtn')?.click());

const rang = await (async () => {
  for (let i = 0; i < 30; i++) {
    if (await ringing(B)) return true;
    await B.waitForTimeout(500);
  }
  return false;
})();
check('the other side rings', rang === true);

if (rang) {
  const how = await answer(B);
  check('and it can be answered', Boolean(how), how || 'never became clickable');

  const connected = await waitFor(A, () => {
    try { return Boolean(eval('chatState.localStream')); } catch (e) { return false; }
  }, { timeoutMs: 25000 });
  check('the caller has a live local stream', connected === true);

  const both = await waitFor(B, () => {
    try { return Boolean(eval('chatState.localStream')); } catch (e) { return false; }
  }, { timeoutMs: 25000 });
  check('and so does the answerer', both === true);

  await hangUp(A);
  const cleared = await waitFor(B, () => {
    try { return !eval('chatState.localStream'); } catch (e) { return true; }
  }, { timeoutMs: 20000 });
  check('hanging up releases the microphone on both sides', cleared === true);
}

/* ===== 4. a group call, and the mesh it has to build ==================== */

console.log('\n===== 4. a group call =====');
for (const p of peers) {
  await p.evaluate(() => {
    document.querySelector('[data-chat-view="groups"]')?.click();
    const card = [...document.querySelectorAll('#chatPeerList .chat-peer-card')]
      .find((c) => /اتاق آزمایش/.test(c.textContent || ''));
    card?.click();
  });
  await p.waitForTimeout(400);
}
await A.evaluate(() => document.getElementById('chatThreadMenuBtn')?.click());
await A.waitForTimeout(500);
await A.evaluate(() => document.getElementById('chatVoiceCallBtn')?.click());
await A.waitForTimeout(2500);

/* A group call has its own invite card — [data-gcall-accept] inside
   #chatGroupCallInvite — not the one-to-one accept button. Reusing answer()
   here found nothing and reported that nobody could join a call that was in
   fact ringing correctly. */
const inviteShown = [];
for (const p of rest) {
  inviteShown.push(await waitFor(p,
    () => Boolean(document.querySelector('[data-gcall-accept]')),
    { timeoutMs: 30000 }));
}
check('every other member is invited',
  inviteShown.every(Boolean), `${inviteShown.filter(Boolean).length} of ${rest.length}`);

let joined = 0;
for (const p of rest) {
  const took = await p.evaluate(() => {
    const btn = document.querySelector('[data-gcall-accept]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (took) joined += 1;
  await p.waitForTimeout(1200);
}
check('every other member can join the group call', joined === rest.length,
  `${joined} of ${rest.length}`);

/* __gcallMeshProbe returns { active, callId, roster, participants[] } — the
   `live` flag is per participant, not a count. Reading it as a number gave
   zero for everyone while four tiles were plainly on the stage, which is the
   shape of a test measuring the wrong field rather than a broken mesh. */
const meshOf = (p) => p.evaluate(() => {
  const probe = window.__gcallMeshProbe?.();
  if (!probe) return { total: -1, withStream: -1, live: -1 };
  return {
    total: probe.participants.length,
    withStream: probe.participants.filter((x) => x.hasStream).length,
    live: probe.participants.filter((x) => x.live).length,
    active: probe.active
  };
});

/* The point of a mesh: each participant holds a connection to each of the
   others, not just to whoever started it. With four people that is three
   connections each — the case that broke when a third person joined. */
const meshes = [];
for (const p of peers) {
  await waitFor(p, (n) => {
    const probe = window.__gcallMeshProbe?.();
    return Boolean(probe) && probe.participants.filter((x) => x.live).length >= n;
  }, { timeoutMs: 40000, arg: PEERS - 1 });
  meshes.push(await meshOf(p));
}
console.log('  what each participant holds: ' + JSON.stringify(meshes));
check('everyone is in the call', meshes.every((m) => m.active === true),
  JSON.stringify(meshes.map((m) => m.active)));
check('THE MESH IS COMPLETE — everyone carries a live stream from everyone else',
  meshes.every((m) => m.live >= PEERS - 1),
  JSON.stringify(meshes.map((m) => `${m.live}/${PEERS - 1}`)));

const tiles = await A.evaluate(() =>
  document.querySelectorAll('.chat-gcall-tile').length);
check('the stage shows a tile per participant', tiles >= PEERS, `${tiles} tiles`);

/* Someone leaves.

   hangUp() presses the one-to-one end-call buttons, and a group call has its
   own: #chatGroupCallLeaveBtn. Using the wrong one left the participant in the
   call and then reported that the others had failed to drop them — a finding
   about the test, not the mesh. */
const leaveGroupCall = async (p) => {
  await p.evaluate(() => {
    document.getElementById('chatGroupCallLeaveBtn')?.click();
    document.querySelector('[data-gcall-leave]')?.click();
  });
  await p.waitForTimeout(3000);
};
const leaver = peers[PEERS - 1];
await leaveGroupCall(leaver);
const leftForReal = await waitFor(leaver, () => {
  const probe = window.__gcallMeshProbe?.();
  return !probe || probe.active === false;
}, { timeoutMs: 20000 });
check('the participant who leaves is out of the call', leftForReal === true);
/* Give the others time to notice, then read what they hold. */
for (const p of peers.slice(0, PEERS - 1)) {
  await waitFor(p, (n) => {
    const probe = window.__gcallMeshProbe?.();
    return Boolean(probe) && probe.participants.filter((x) => x.live).length <= n;
  }, { timeoutMs: 25000, arg: PEERS - 2 });
}
const afterLeave = [];
for (const p of peers.slice(0, PEERS - 1)) afterLeave.push(await meshOf(p));
console.log('  after one participant leaves: ' + JSON.stringify(afterLeave));
check('the rest stay in the call when one leaves',
  afterLeave.every((m) => m.active === true), JSON.stringify(afterLeave.map((m) => m.active)));
check('and the one who left is dropped from their mesh',
  afterLeave.every((m) => m.live <= PEERS - 2),
  JSON.stringify(afterLeave.map((m) => m.live)));

for (const p of peers) { await leaveGroupCall(p); await hangUp(p); }

/* ===== 4. errors, everywhere ============================================ */

console.log('\n===== 4. what threw =====');
const allErrors = peers.flatMap((p) => p.__errors);
check('no participant logged an uncaught error',
  allErrors.length === 0, allErrors.slice(0, 4).join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
if (bad.length) console.log(bad.map((r) => '  ' + r.name).join('\n'));
process.exit(bad.length ? 1 : 0);
