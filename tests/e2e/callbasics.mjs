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

   Calling, end to end, in the plainest cases there are.

   The exotic paths - upgrading a pair call, the mesh, the tile layout - have
   suites of their own and had all the attention. This one covers what
   everybody actually does: ring somebody, have them answer, hear each other,
   hang up. And the case nobody tests because it takes forty seconds: ringing
   somebody who never picks up. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function app(tag) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} window.__clip = []; window.__err = [];
    window.addEventListener('error', (e) => window.__err.push('ERR ' + e.message));
    window.addEventListener('unhandledrejection', (e) => window.__err.push('REJ ' + (e.reason?.message || e.reason))); });
  const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
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
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => { inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); });
    const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  }, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(2500);
  await page.evaluate((name) => {
    const w = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__clip.push(t); return w(t).catch(() => {}); };
    const n = document.getElementById('chatDisplayName'); if (n) { n.value = name; n.dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('chatSaveProfileBtn')?.click();
    document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');
  }, tag);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(6500);
  return page;
}
const imp = (p, x) => p.evaluate(async (t) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-chat-manual-json]').value = t;
  document.querySelector('[data-chat-manual-submit]')?.click();
}, x);
const idOf = (p) => p.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });

const A = await app('ALPHA'); const B = await app('BETA'); const C = await app('GAMMA');
const idA = await idOf(A); const idB = await idOf(B); const idC = await idOf(C);
const fpOf = (x) => JSON.parse(atob(x.replace('poorija-chat-v1:', '')))?.fingerprint;
const fpB = fpOf(idB); const fpC = fpOf(idC);
await imp(A, idB); await imp(A, idC); await imp(B, idA); await imp(B, idC); await imp(C, idA); await imp(C, idB);
await A.waitForTimeout(4000);



const state = (p) => p.evaluate(() => window.__callStateProbe?.() || {});
const logRows = (p) => p.evaluate(() => (window.__callLogProbe?.rows?.() || []));
const ringing = (p) => p.evaluate(() => {
  const visible = (el) => Boolean(el) && !el.classList.contains('hidden') && el.offsetParent !== null;
  return visible(document.getElementById('chatAcceptCallBtn')) || visible(document.getElementById('chatModalAcceptBtn'));
});
const answer = async (p) => {
  for (let i = 0; i < 24; i += 1) {
    const done = await p.evaluate(() => {
      const visible = (el) => Boolean(el) && !el.classList.contains('hidden') && el.offsetParent !== null;
      const a = document.getElementById('chatAcceptCallBtn'); const m = document.getElementById('chatModalAcceptBtn');
      if (visible(a)) { a.click(); return 'sheet'; } if (visible(m)) { m.click(); return 'modal'; } return '';
    });
    if (done) return done;
    await p.waitForTimeout(500);
  }
  return '';
};
const placeCall = async (p, fp, kind) => {
  await p.evaluate(() => document.querySelector('[data-chat-view="chats"]')?.click());
  await p.waitForTimeout(800);
  await p.evaluate((f) => {
    const card = [...document.querySelectorAll('#chatPeerList .chat-peer-card')]
      .find((x) => x.outerHTML.includes(f.slice(0, 16)));
    card?.click();
  }, fp);
  await p.waitForTimeout(1400);
  await p.evaluate(() => document.getElementById('chatThreadMenuBtn')?.click());
  await p.waitForTimeout(400);
  await p.evaluate((k) => document.getElementById(k === 'video' ? 'chatVideoCallBtn' : 'chatVoiceCallBtn')?.click(), kind);
};
const hangUp = async (p) => {
  await p.evaluate(() => {
    document.getElementById('chatFloatingEndCallBtn')?.click();
    document.getElementById('chatEndCallControlBtn')?.click();
    document.getElementById('chatEndCallBtn')?.click();
  });
  await p.waitForTimeout(2500);
};

for (const kind of ['voice', 'video']) {
  console.log(`\n===== a plain ${kind} call, answered =====`);
  await placeCall(A, fpB, kind);
  await B.waitForTimeout(3500);
  const rang = await ringing(B);
  check(`${kind}: the other phone rings`, rang === true, String(rang));
  const how = await answer(B);
  await A.waitForTimeout(7000);
  const a = await state(A); const b = await state(B);
  console.log(`  answered via ${how}   A ${JSON.stringify(a)}   B ${JSON.stringify(b)}`);
  check(`${kind}: the call comes up for the person who answered`, b.live === true, JSON.stringify(b));
  check(`${kind}: and the caller stops ringing and joins it`, a.live === true && a.busy === true, JSON.stringify(a));
  /* The caller used to learn that somebody had answered only from the media
     arriving. On a link that has to go the long way round that can take
     seconds or fail, and the caller sat listening to a ringing tone next to a
     call that was already up. */
  const toneOff = await A.evaluate(() => {
    const sounds = [...document.querySelectorAll('audio')].filter((el) => !el.paused);
    return { playing: sounds.length, status: document.getElementById('chatFloatingCallStatus')?.textContent || '' };
  });
  console.log('  caller tone: ' + JSON.stringify(toneOff));
  check(`${kind}: the ringing tone stops for the caller once it is answered`,
    toneOff.playing === 0, JSON.stringify(toneOff));
  const media = await Promise.all([A, B].map((p) => p.evaluate(() => {
    const v = document.getElementById('chatFloatingRemoteVideo') || document.getElementById('chatRemoteVideo');
    const stream = v?.srcObject;
    return { has: Boolean(stream), live: stream ? stream.getTracks().some((tr) => tr.readyState === 'live') : false };
  })));
  console.log('  media: ' + JSON.stringify(media));
  check(`${kind}: each side is receiving the other`, media.every((m) => m.has && m.live), JSON.stringify(media));
  await hangUp(A);
  await B.waitForTimeout(2500);
  const after = await Promise.all([state(A), state(B)]);
  check(`${kind}: hanging up ends it on both sides`, after.every((x) => x.live === false), JSON.stringify(after));
  const rows = await Promise.all([logRows(A), logRows(B)]);
  check(`${kind}: and it is logged as answered, not missed`,
    rows.every((list) => list[0] && list[0].status !== 'missed'),
    JSON.stringify(rows.map((list) => list[0]?.status)));
  await A.waitForTimeout(1500);
}

console.log('\n===== declining =====');
await placeCall(A, fpB, 'voice');
await B.waitForTimeout(3500);
await B.evaluate(() => {
  document.getElementById('chatRejectCallBtn')?.click();
  document.getElementById('chatModalRejectBtn')?.click();
});
await A.waitForTimeout(4000);
const declined = await state(A);
console.log('  A: ' + JSON.stringify(declined));
check('a declined call stops ringing for the caller', declined.live === false && declined.busy === false, JSON.stringify(declined));
await A.waitForTimeout(1500);

console.log('\n===== nobody answers =====');
/* The case that needs forty seconds of patience and therefore never gets
   tested. The caller had no timer at all: it rang until somebody pressed the
   button. */
const ringLimit = await A.evaluate(() => window.__ringTimeoutProbe?.() || 0);
check('there is a ring timeout, and it is forty seconds', ringLimit === 40000, `${ringLimit}ms`);
await placeCall(A, fpB, 'voice');
await A.waitForTimeout(2500);
const started = await state(A);
check('the call is ringing out', started.busy === true, JSON.stringify(started));
/* Left deliberately unanswered. */
await A.waitForTimeout(ringLimit + 9000);
const gaveUp = await state(A);
const callerRows = await logRows(A);
console.log('  A after the timeout: ' + JSON.stringify(gaveUp) + '  log: ' + JSON.stringify(callerRows[0]));
check('the caller gives up on its own', gaveUp.busy === false && gaveUp.live === false, JSON.stringify(gaveUp));
check('and it goes down as a call that was not answered',
  Boolean(callerRows[0]) && ['missed', 'cancelled'].includes(callerRows[0].status),
  JSON.stringify(callerRows[0]));
const calleeQuiet = await ringing(B);
check('and the other phone stops ringing too', calleeQuiet === false, String(calleeQuiet));

console.log('\n===== two people, on a call =====');

await A.evaluate(() => document.querySelector('[data-chat-view="chats"]')?.click());
await A.waitForTimeout(800);
await A.evaluate((fp) => {
  const card = [...document.querySelectorAll('#chatPeerList .chat-peer-card')]
    .find((x) => x.outerHTML.includes(fp.slice(0, 16)));
  card?.click();
}, fpB);
await A.waitForTimeout(1500);
await A.evaluate(() => document.getElementById('chatThreadMenuBtn')?.click());
await A.waitForTimeout(400);
await A.evaluate(() => document.getElementById('chatVoiceCallBtn')?.click());
await B.waitForTimeout(3500);
const answered = await (async () => {
  for (let i = 0; i < 20; i += 1) {
    const done = await B.evaluate(() => {
      const visible = (el) => el && !el.classList.contains('hidden') && el.offsetParent !== null;
      const a = document.getElementById('chatAcceptCallBtn');
      const m = document.getElementById('chatModalAcceptBtn');
      if (visible(a)) { a.click(); return 'sheet'; }
      if (visible(m)) { m.click(); return 'modal'; }
      return '';
    });
    if (done) return done;
    await B.waitForTimeout(500);
  }
  return '';
})();
await A.waitForTimeout(5000);
const pairUp = await A.evaluate(() => window.__callStateProbe?.() || {});
console.log('  B answered via: ' + answered + '   A: ' + JSON.stringify(pairUp));
check('the pair call is up', Boolean(answered) && pairUp.live === true, JSON.stringify(pairUp));

console.log('\n===== a third person is added =====');
/* Everything B is told from here on. If "the call ended" is in it, the bug is
   back however healthy the call looks afterwards. */
const bBefore = await B.evaluate(() => ({
  toasts: (window.__toasts || []).length,
  logRows: (window.__callLogProbe?.rows?.() || []).length,
}));
await A.evaluate(() => document.getElementById('chatCallAddPeopleBtn')?.click());
await A.waitForTimeout(900);
const picked = await A.evaluate((fp) => {
  const rows = [...document.querySelectorAll('#chatCallPickerList input[type="checkbox"]')];
  const wanted = rows.find((box) => String(box.value).includes(fp.slice(0, 16)));
  if (!wanted) return { rows: rows.length, found: false };
  wanted.checked = true;
  wanted.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('[data-call-picker-go]')?.click();
  return { rows: rows.length, found: true };
}, fpC);
console.log('  picker: ' + JSON.stringify(picked));
check('the picker offers somebody to add', picked.found === true, JSON.stringify(picked));

await C.waitForTimeout(7000);
const cRing = await C.evaluate(() => ({
  invited: Boolean(document.querySelector('[data-gcall-accept]')),
  ringing: !document.getElementById('chatGroupCallInvite')?.classList.contains('hidden'),
}));
console.log('  C: ' + JSON.stringify(cRing));
check('the third person is rung', cRing.invited === true, JSON.stringify(cRing));

await B.waitForTimeout(3000);
const bAfter = await B.evaluate(() => ({
  newToasts: (window.__toasts || []).slice(-6),
  stageOpen: !document.getElementById('chatGroupCall')?.classList.contains('hidden'),
  logRows: (window.__callLogProbe?.rows?.() || []).length,
  lastLog: (window.__callLogProbe?.rows?.() || [])[0] || null,
}));
console.log('  B: ' + JSON.stringify(bAfter));
check('the person already on the line is moved across, not hung up on',
  bAfter.stageOpen === true, JSON.stringify(bAfter));
check('and is never told the call ended',
  !bAfter.newToasts.some((line) => /پایان|ended|قطع/i.test(String(line))),
  JSON.stringify(bAfter.newToasts));
check('nor gains a finished call in their log',
  bAfter.logRows === bBefore.logRows, `${bBefore.logRows} -> ${bAfter.logRows}`);

console.log('\n===== everybody can see everybody =====');
/* The stage looking right proves nothing: the mesh is the part that fails
   quietly, and when it does every screen shows the right names and not one
   picture moves. Ask each device who it is actually receiving from. */
await C.evaluate(() => document.querySelector('[data-gcall-accept]')?.click());
await Promise.all([A, B, C].map((p) => p.waitForTimeout(12000)));
const mesh = {
  A: await A.evaluate(() => window.__gcallMeshProbe?.() || null),
  B: await B.evaluate(() => window.__gcallMeshProbe?.() || null),
  C: await C.evaluate(() => window.__gcallMeshProbe?.() || null),
};
for (const [who, m] of Object.entries(mesh)) {
  console.log(`  ${who}: ` + JSON.stringify(m));
}
check('all three are in a call', Object.values(mesh).every((m) => m?.active === true),
  JSON.stringify(Object.entries(mesh).map(([k, m]) => `${k}:${m?.active}`)));
check('and in the SAME call', new Set(Object.values(mesh).map((m) => m?.callId)).size === 1,
  JSON.stringify(Object.entries(mesh).map(([k, m]) => `${k}:${String(m?.callId).slice(0, 14)}`)));
check('each of them sees the other two',
  Object.values(mesh).every((m) => (m?.participants || []).length === 2),
  JSON.stringify(Object.entries(mesh).map(([k, m]) => `${k}:${(m?.participants || []).length}`)));
check('and is receiving a live picture from both',
  Object.values(mesh).every((m) => (m?.participants || []).length === 2
    && m.participants.every((entry) => entry.hasStream && entry.live)),
  JSON.stringify(Object.entries(mesh).map(([k, m]) => `${k}:${(m?.participants || []).map((e) => e.live).join(',')}`)));

const errs = await Promise.all([A, B, C].map((p) => p.evaluate(() => (window.__err || []).slice(-3))));
check('nothing threw on any of the three', errs.every((list) => list.length === 0), JSON.stringify(errs));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
