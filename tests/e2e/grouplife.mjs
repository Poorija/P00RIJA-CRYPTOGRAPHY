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
   Point it somewhere else with PKG_URL=https://host:port

   What the older group suite never covered: what a group looks like to a
   member rather than to the person who made it, once their app has been shut
   down and reopened, and what happens to a post while one member is away.
   Both of those were broken, and both were invisible to a suite that keeps
   every browser open and online for the whole run. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { readMailboxes } from './_relay-store.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const STORE = process.env.CHAT_OFFLINE_STORE_PATH || path.resolve(process.cwd(), 'data/chat-signal/offline-messages.json');
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
/* Against a deployed relay the store is not on this disk, and reading a file
   that is not there returns an empty mailbox — which looks exactly like "the
   message was never queued". REMOTE_STORE_CMD supplies a way to read the real
   one (an ssh plus a docker exec), the same escape hatch _chat-harness.mjs
   already had; this suite carried its own copy of the reader and never got it.

     REMOTE_STORE_CMD="ssh you@host 'docker exec Poorija-Cryptography_ChatSignal \
       cat /data/offline-messages.json'" PKG_URL=https://host:8585 \
       node tests/e2e/grouplife.mjs
*/
const REMOTE_STORE_CMD = process.env.REMOTE_STORE_CMD || '';
/* A store command that fails must not read as an empty mailbox. It did, and
   the difference between "the relay queued nothing" and "this machine could
   not see the relay" is the difference between a bug and a wrong test — the
   documented command still said `cat offline-messages.json`, which the relay
   stopped writing when the store became one file per recipient, so every
   queueing check against a deployed server quietly asserted against {}. */
const mailbox = (fp) => {
  if (REMOTE_STORE_CMD) {
    const raw = execSync(REMOTE_STORE_CMD, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return (JSON.parse(raw) || {})[fp] || [];
  }
  try {
    return readMailboxes(STORE)[fp] || [];
  } catch (_error) { return []; }
};
/* Said out loud rather than reported as a failure: without it, the queueing
   checks below are measuring this machine's empty disk. */
if (!REMOTE_STORE_CMD && !/localhost|127\.0\.0\.1/.test(BASE_URL)) {
  console.log('  note: no REMOTE_STORE_CMD, so the relay mailbox cannot be read from here');
}
const initScript = () => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} window.__clip = []; };

async function setup(page, tag) {
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
}

/* Reopening a shut-down profile: the lock screen, not the setup wizard. */
async function unlock(page) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((p) => { const el = document.getElementById('unlockPassword'); if (el) { el.value = p; el.dispatchEvent(new Event('input', { bubbles: true })); } }, PASS);
  await page.evaluate(() => window.unlockApp?.());
  await page.waitForTimeout(4000);
  await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(10000);
}

const idOf = (p) => p.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });
const imp = (p, x) => p.evaluate(async (t) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-chat-manual-json]').value = t;
  document.querySelector('[data-chat-manual-submit]')?.click();
}, x);
const fpOf = (x) => JSON.parse(atob(x.replace('poorija-chat-v1:', '')))?.fingerprint;
const openGroup = (p, n) => p.evaluate((name) => {
  document.querySelector('[data-chat-view="groups"]')?.click();
  const c = [...document.querySelectorAll('#chatPeerList .chat-peer-card')].find((x) => x.textContent.includes(name));
  c?.click(); return Boolean(c);
}, n);
const texts = (p) => p.evaluate(() => [...document.querySelectorAll('.chat-message-text')].map((e) => e.textContent.trim().slice(0, 48)));

const browser = await chromium.launch();
const mk = async (tag) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
  await setup(page, tag); return { page, ctx };
};

/* GAMMA gets a profile on disk so it can be closed and reopened as itself. */
const dirC = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-grouplife-'));
let ctxC = await chromium.launchPersistentContext(dirC, { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctxC.addInitScript(initScript);
let pageC = ctxC.pages()[0] || await ctxC.newPage(); pageC.on('dialog', (d) => d.accept());
await setup(pageC, 'GAMMA');

const A = await mk('ALPHA'); const B = await mk('BETA');
const idA = await idOf(A.page); const idB = await idOf(B.page); const idC = await idOf(pageC);
await imp(A.page, idB); await imp(A.page, idC);
await imp(B.page, idA); await imp(B.page, idC);
await imp(pageC, idA); await imp(pageC, idB);
await A.page.waitForTimeout(4000);
const fpB = fpOf(idB); const fpC = fpOf(idC);

console.log('\n===== making a group is one decision, in one place =====');
await A.page.evaluate(() => document.querySelector('[data-chat-view="groups"]')?.click());
await A.page.waitForTimeout(1200);
const headingBtn = await A.page.evaluate(() => {
  const b = document.getElementById('chatStartChatBtn');
  return { label: b?.querySelector('span')?.textContent?.trim() || '', action: b?.dataset.action || '' };
});
check('the button above a list of groups offers a group, not a chat',
  headingBtn.action === 'new-group' && /گروه|group/i.test(headingBtn.label), JSON.stringify(headingBtn));

await A.page.evaluate(() => document.getElementById('chatStartChatBtn')?.click());
await A.page.waitForTimeout(900);
const maker = await A.page.evaluate(() => ({
  open: !document.getElementById('chatGroupMaker')?.classList.contains('hidden'),
  portalled: document.getElementById('chatGroupMaker')?.parentElement === document.body,
  hasName: Boolean(document.getElementById('chatGroupNameInput')),
  hasAbout: Boolean(document.getElementById('chatGroupMakerAbout')),
  hasAvatar: Boolean(document.getElementById('chatGroupMakerAvatarBtn')),
  perms: document.querySelectorAll('[data-group-maker-perm]').length,
  members: document.querySelectorAll('#chatGroupMembersPanel input[type=checkbox]').length,
}));
console.log('  ' + JSON.stringify(maker));
check('it opens as a dialog outside the clipped shell', maker.open && maker.portalled, JSON.stringify({ o: maker.open, p: maker.portalled }));
check('and asks for the picture, the description, the members and the rules',
  maker.hasName && maker.hasAbout && maker.hasAvatar && maker.perms >= 6 && maker.members >= 2,
  JSON.stringify(maker));

await A.page.evaluate(async ({ b, c }) => {
  const n = document.getElementById('chatGroupNameInput'); n.value = 'TeamLife'; n.dispatchEvent(new Event('input', { bubbles: true }));
  const about = document.getElementById('chatGroupMakerAbout'); about.value = 'یک گروه آزمایشی'; about.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelectorAll('#chatGroupMembersPanel input[type=checkbox]').forEach((box) => {
    box.checked = (box.value === b || box.value === c); box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 400));
  document.getElementById('chatCreateGroupBtn')?.click();
}, { b: fpB, c: fpC });
await A.page.waitForTimeout(5000);
check('the dialog closes once the group exists',
  await A.page.evaluate(() => document.getElementById('chatGroupMaker')?.classList.contains('hidden')), 'closed');
check('the description was kept',
  await A.page.evaluate(() => ((window.__spacesDeepProbe?.() || [])[0] || {}).name === 'TeamLife'), 'TeamLife');

console.log('\n===== a group, seen from the member\'s side =====');

const cFirst = await pageC.evaluate(() => (window.__spacesDeepProbe?.() || [])[0] || null);
console.log('  GAMMA: ' + JSON.stringify(cFirst));
check('a member receives the group', Boolean(cFirst), cFirst?.name || 'none');
check('and the member is in its own copy of the roster',
  cFirst?.includesMe === true, `includesMe=${cFirst?.includesMe} members=${JSON.stringify(cFirst?.members)}`);
check('the roster names everyone, the member included',
  Array.isArray(cFirst?.members) && cFirst.members.length === 2,
  `${cFirst?.members?.length} of 2`);

console.log('\n===== the member closes the app and comes back =====');
await ctxC.close();
await A.page.waitForTimeout(2000);
ctxC = await chromium.launchPersistentContext(dirC, { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctxC.addInitScript(initScript);
pageC = ctxC.pages()[0] || await ctxC.newPage(); pageC.on('dialog', (d) => d.accept());
await unlock(pageC);
const cBack = await pageC.evaluate(() => ({
  groups: window.__spacesDeepProbe?.() || [],
  identity: Boolean(window.__membershipProbe?.().fingerprint),
}));
console.log('  GAMMA: ' + JSON.stringify(cBack.groups));
check('the profile really did come back', cBack.identity, String(cBack.identity));
check('the group is still on disk after a restart', cBack.groups.length === 1, `${cBack.groups.length} group(s)`);
check('and it is still a group the member belongs to',
  cBack.groups[0]?.includesMe === true, `includesMe=${cBack.groups[0]?.includesMe}`);
check('the member can still address the group',
  Array.isArray(cBack.groups[0]?.members) && cBack.groups[0].members.length >= 1,
  JSON.stringify(cBack.groups[0]?.members));

console.log('\n===== a post while one member is away =====');
await ctxC.close();
await A.page.waitForTimeout(3000);
const before = mailbox(fpC).length;
await openGroup(A.page, 'TeamLife'); await A.page.waitForTimeout(1500);
console.log('  ALPHA keys before send: ' + JSON.stringify(await A.page.evaluate(()=>window.__keyFingerprints())));
const sendPlan = await A.page.evaluate(async () => {
  const g = (window.__spacesDeepProbe?.() || [])[0];
  return g ? await window.__groupSendProbe(g.conversationId) : null;
});
console.log('  ALPHA send plan: ' + JSON.stringify(sendPlan));
await A.page.fill('#chatComposer', 'POST-WHILE-AWAY');
await A.page.click('#chatSendMessageBtn', { timeout: 15000 }).catch(() => {});
await A.page.waitForTimeout(8000);
const queued = mailbox(fpC);
console.log(`  GAMMA mailbox ${before} -> ${queued.length}, types ${JSON.stringify(queued.map((i) => i?.payload?.type))}`);
check('a group post is queued for the member who is away',
  queued.length > before, `${before} -> ${queued.length}`);

await openGroup(B.page, 'TeamLife'); await B.page.waitForTimeout(2500);
const bText = await texts(B.page);
check('and the member who is present still gets it', bText.some((x) => /POST-WHILE-AWAY/.test(x)), JSON.stringify(bText));

ctxC = await chromium.launchPersistentContext(dirC, { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctxC.addInitScript(initScript);
pageC = ctxC.pages()[0] || await ctxC.newPage(); pageC.on('dialog', (d) => d.accept());
const cLogs = [];
pageC.on('console', (m) => { const t = m.text(); if (/offline|relay|decrypt|space|group|fail|error/i.test(t)) cLogs.push(`${m.type()}: ${t.slice(0, 160)}`); });
pageC.on('pageerror', (e) => cLogs.push('PAGEERROR: ' + e.message.slice(0, 160)));
await unlock(pageC);
await openGroup(pageC, 'TeamLife'); await pageC.waitForTimeout(3000);
console.log('  GAMMA console:'); cLogs.slice(-8).forEach((l) => console.log('    ' + l));
console.log('  GAMMA keys after restart: ' + JSON.stringify(await pageC.evaluate(()=>window.__keyFingerprints())));
console.log('  ALPHA keys after        : ' + JSON.stringify(await A.page.evaluate(()=>window.__keyFingerprints())));
const cText = await texts(pageC);
const cState = await pageC.evaluate(() => {
  const g = (window.__spacesDeepProbe?.() || [])[0];
  const hist = window.__historyProbe ? window.__historyProbe(g?.conversationId) : 'no probe';
  return { group: g?.name, activeId: g?.conversationId, history: hist };
});
console.log('  GAMMA state: ' + JSON.stringify(cState));
console.log('  mailbox left after reconnect: ' + mailbox(fpC).length);
console.log('  GAMMA sees: ' + JSON.stringify(cText));
check('the member reads it when they come back', cText.some((x) => /POST-WHILE-AWAY/.test(x)), JSON.stringify(cText));


console.log('\n===== who is in charge, seen from every side =====');
/* Promotion was only ever checked on the owner's own screen. The interesting
   half is whether the promoted person's device agrees - it did not, because a
   member's copy of the group had their own key stripped out of the admin list,
   so an admin read itself as a plain member. */
const openInfo = async (p) => { await p.evaluate(() => document.getElementById('chatSpaceInfoBtn')?.click()); await p.waitForTimeout(900); };
const roleOn = async (p) => p.evaluate(() => ((window.__spacesDeepProbe?.() || [])[0] || {}).myRole || '(none)');

/* One browser at a time on that profile directory: a second launch against a
   directory that is still open comes up with nothing in it, which reads as
   "the member lost the group" and is really just two Chromes fighting. */
await ctxC.close().catch(() => {});
ctxC = await chromium.launchPersistentContext(dirC, { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctxC.addInitScript(initScript);
pageC = ctxC.pages()[0] || await ctxC.newPage(); pageC.on('dialog', (d) => d.accept());
await unlock(pageC);

await openGroup(A.page, 'TeamLife'); await openInfo(A.page);
await A.page.evaluate((fp) => document.querySelector(`[data-space-admin="${fp}"]`)?.click(), fpB);
await A.page.waitForTimeout(3000);
check('the promoted member\'s own device agrees they are an admin',
  (await roleOn(B.page)) === 'admin', await roleOn(B.page));

await A.page.evaluate((fp) => document.querySelector(`[data-space-admin="${fp}"]`)?.click(), fpC);
await A.page.waitForTimeout(3000);
const admins = await A.page.evaluate(() => ((window.__spacesDeepProbe?.() || [])[0] || {}).admins || []);
check('a group can hold more than one admin', admins.length === 2, `${admins.length} admin(s)`);
await pageC.waitForTimeout(5000);
const cRole = await roleOn(pageC);
const cGroups = await pageC.evaluate(() => (window.__spacesDeepProbe?.() || []).map((g) => g.name));
check('and the second one knows it too', cRole === 'admin', `${cRole}, groups=${JSON.stringify(cGroups)}`);

/* An admin, not the owner, adding somebody: that is what the role is for. */
const adminMayManage = await B.page.evaluate(() => {
  const g = (window.__spacesDeepProbe?.() || [])[0];
  return g ? window.__canManageProbe(g.conversationId) : null;
});
check('an admin may manage the group on their own device', adminMayManage === true, String(adminMayManage));

await A.page.evaluate((fp) => document.querySelector(`[data-space-admin="${fp}"]`)?.click(), fpB);
await A.page.waitForTimeout(3000);
check('demoting reaches the demoted device', (await roleOn(B.page)) === 'member', await roleOn(B.page));
check('and it may no longer manage', await B.page.evaluate(() => {
  const g = (window.__spacesDeepProbe?.() || [])[0];
  return g ? window.__canManageProbe(g.conversationId) : null;
}) === false, 'canManage=false');

const nonOwner = await pageC.evaluate(async () => {
  window.__toasts = [];
  const o = window.PoorijaApp?.showNotification?.bind(window.PoorijaApp);
  if (o) window.PoorijaApp.showNotification = (m, t) => { window.__toasts.push(String(m)); return o(m, t); };
  document.getElementById('chatSpaceInfoBtn')?.click();
  await new Promise((r) => setTimeout(r, 800));
  return document.querySelectorAll('[data-space-nuke]').length;
});
check('an admin who is not the owner gets no delete-for-everyone button', nonOwner === 0, `${nonOwner} button(s)`);

console.log('\n===== what one member in particular may do =====');
/* A group-wide rule is a blunt instrument. Closing one thing for one person
   without changing the group is what "mute this member" actually means, and
   nothing did it before. */
await openGroup(A.page, 'TeamLife'); await openInfo(A.page);
const permBtns = await A.page.evaluate(() => document.querySelectorAll('[data-space-member-perms]').length);
check('each plain member has a way in to their own access', permBtns >= 1, `${permBtns} button(s)`);
/* B, not C: the section above demoted B and left C an admin, and limits do
   not apply to admins. */
await A.page.evaluate((fp) => document.querySelector(`[data-space-member-perms="${fp}"]`)?.click(), fpB);
await A.page.waitForTimeout(800);
/* ">= 6" passed while eight of the twelve were missing. Count against the
   app's own list instead of a number somebody guessed. */
const ruleCount = await A.page.evaluate(() => window.__spacePermsProbe?.().length || 0);
const rows = await A.page.evaluate(() => document.querySelectorAll('#chatPermsDialog [data-space-member-perm]').length);
check('and it lists every rule the group has, not a subset',
  ruleCount > 0 && rows === ruleCount, `${rows} of ${ruleCount}`);
check('the rules open as a dialog on top, not folded into the row',
  await A.page.evaluate(() => {
    const d = document.getElementById('chatPermsDialog');
    return Boolean(d) && d.parentElement === document.body;
  }), 'portalled to body');

/* The group's own rules have to offer the same twelve. Showing four here while
   the member dialog showed twelve is exactly what shipped. */
await A.page.evaluate(() => document.querySelector('[data-perms-close]')?.click());
await A.page.waitForTimeout(400);
await A.page.evaluate(() => document.querySelector('[data-space-perms-open]')?.click());
await A.page.waitForTimeout(600);
const groupRows = await A.page.evaluate(() => document.querySelectorAll('#chatPermsDialog [data-space-perm]').length);
check('the group-wide rules offer the same list, not a hand-picked few',
  groupRows === ruleCount, `${groupRows} of ${ruleCount}`);
await A.page.evaluate(() => document.querySelector('[data-perms-close]')?.click());
await A.page.waitForTimeout(400);
await A.page.evaluate((fp) => document.querySelector(`[data-space-member-perms="${fp}"]`)?.click(), fpB);
await A.page.waitForTimeout(700);

await A.page.evaluate((fp) => {
  const box = document.querySelector(`[data-space-member-perm="${fp}"][data-perm="sendMessages"]`);
  box?.click();
}, fpB);
await A.page.waitForTimeout(3500);
await B.page.waitForTimeout(5000);
const bBlocked = await B.page.evaluate(() => {
  const g = (window.__spacesDeepProbe?.() || [])[0];
  return g ? window.__memberMayProbe(g.conversationId, 'sendMessages') : null;
});
const bMayStillSendFiles = await B.page.evaluate(() => {
  const g = (window.__spacesDeepProbe?.() || [])[0];
  return g ? window.__memberMayProbe(g.conversationId, 'sendFiles') : null;
});
check('the muted member knows it on their own device', bBlocked === false, `may post = ${bBlocked}`);
check('and only the one rule that was closed is closed', bMayStillSendFiles === true, `may send files = ${bMayStillSendFiles}`);

console.log('\n===== how much of the group is here =====');
const card = await A.page.evaluate(() => {
  const c = [...document.querySelectorAll('#chatPeerList .chat-peer-card')].find((x) => x.textContent.includes('TeamLife'));
  if (!c) return null;
  return {
    badge: c.querySelector('.chat-group-count')?.textContent?.trim() || '',
    here: c.querySelector('.chat-group-count-here')?.textContent?.trim() || '',
    all: c.querySelector('.chat-group-count-all')?.textContent?.trim() || '',
    dot: c.querySelector('.chat-peer-presence-dot')?.className || '',
    saysDisconnected: /عدم اتصال|Disconnected|Offline/.test(c.textContent),
  };
});
console.log('  ' + JSON.stringify(card));
check('a group says how many of its people are here, not whether it is connected',
  Boolean(card && card.here && card.all) && !card.saysDisconnected, JSON.stringify(card));
/* Matching any of the three words proves nothing - every class matches one.
   Pin the reading that actually applies while all three people are here. */
check('everybody present reads as everybody present',
  / online/.test(card.dot) && card.here === card.all, `${card.dot} | ${card.here}/${card.all}`);

console.log('\n===== when one of them is away =====');
/* Now take one away and watch the reading change. This is the case the desktop
   got wrong: the ring for "some of us" was never given a display rule, so a
   partly-present group showed no ring at all. */
/* B goes offline rather than away for good - the sections below still need
   that profile, and what is being tested is presence, not teardown. */
await B.page.evaluate(() => window.PoorijaChat?.goOffline?.());
await A.page.waitForTimeout(9000);
const partial = await A.page.evaluate(() => {
  const c = [...document.querySelectorAll('#chatPeerList .chat-peer-card')].find((x) => x.textContent.includes('TeamLife'));
  if (!c) return null;
  const dot = c.querySelector('.chat-peer-presence-dot');
  const av = c.querySelector('.chat-peer-avatar');
  return {
    here: c.querySelector('.chat-group-count-here')?.textContent?.trim() || '',
    all: c.querySelector('.chat-group-count-all')?.textContent?.trim() || '',
    cls: dot?.className || '',
    dotColour: dot ? getComputedStyle(dot).backgroundColor : '',
    ringShown: av ? getComputedStyle(av, '::after').display : '',
    ringColour: av ? getComputedStyle(av, '::after').backgroundColor : '',
  };
});
console.log('  ' + JSON.stringify(partial));
check('with one away the count drops rather than saying disconnected',
  partial && partial.here !== partial.all && Number(partial.here) >= 1, JSON.stringify(partial));
check('and it reads as partly present, not absent',
  / partial/.test(partial.cls), partial?.cls);
check('the dot is amber for that, not the red of nobody here',
  partial?.dotColour === 'rgb(245, 158, 11)', partial?.dotColour);
check('and the ring around the avatar is actually drawn',
  partial?.ringShown === 'block' && partial?.ringColour === 'rgb(245, 158, 11)',
  `${partial?.ringShown} ${partial?.ringColour}`);

/* Put B back on the relay: the sections below need that profile reachable. */
await B.page.evaluate(() => window.PoorijaChat?.goOnline?.());
await B.page.waitForTimeout(4000);
await A.page.waitForTimeout(3000);



console.log('\n===== a change is announced on every device =====');
/* The note explaining a change used to be written only on the device that made
   it. Everybody else saw the group rename itself, or gain an admin, with
   nothing said - the change arrived, the sentence did not. */
const memberNotes = (page) => page.evaluate(() => {
  const group = (window.__spacesDeepProbe?.() || [])[0];
  return (window.__historyProbe?.(group?.conversationId) || [])
    .filter((entry) => entry.type === 'system-note');
});
const notesBefore = (await memberNotes(B.page)).length;
await A.page.evaluate(() => document.querySelector('[data-space-rename]')?.click());
await A.page.waitForTimeout(600);
await A.page.evaluate(() => {
  const input = document.querySelector('.poorija-dialog-input');
  if (input) { input.value = 'RenamedRoom'; input.dispatchEvent(new Event('input', { bubbles: true })); }
  document.querySelector('.poorija-dialog-ok')?.click();
});
await A.page.waitForTimeout(4500);
const noteRows = await memberNotes(B.page);
const notes = { count: noteRows.length, last: noteRows[noteRows.length - 1]?.text || '' };
console.log('  member sees: ' + JSON.stringify(notes));
check('the member is told the group was renamed, not just shown the new name',
  notes.count > notesBefore && /RenamedRoom/.test(notes.last), JSON.stringify(notes));

/* Twice would be worse than not at all. */
const dupeRows = await memberNotes(B.page);
const dupes = { rows: dupeRows.length, unique: new Set(dupeRows.map((r) => r.id)).size };
console.log('  ' + JSON.stringify(dupes));
check('and told once, not twice', dupes.rows === dupes.unique, JSON.stringify(dupes));

console.log('\n===== the same panel, on a phone =====');
/* Everything above ran at desktop width. The dissolve buttons used to sit in a
   <footer>, and a global mobile rule hides every footer outright - so on a
   phone the owner had no way to dissolve their own group. */
await A.page.setViewportSize({ width: 390, height: 844 });
await A.page.waitForTimeout(1200);
await openGroup(A.page, 'TeamLife'); await openInfo(A.page);
const onPhone = await A.page.evaluate(() => {
  const seen = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'missing';
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0)
      ? 'visible' : 'hidden';
  };
  return {
    nuke: seen('[data-space-nuke]'),
    leave: seen('[data-space-leave]'),
    perms: seen('[data-space-perms-open]'),
    footTag: document.querySelector('.chat-space-info-foot')?.tagName || '',
  };
});
console.log('  ' + JSON.stringify(onPhone));
check('the owner can dissolve the group from a phone', onPhone.nuke === 'visible', JSON.stringify(onPhone));
check('and leave it', onPhone.leave === 'visible', onPhone.leave);
check('the rules are reachable there too', onPhone.perms === 'visible', onPhone.perms);
check('the button row is not a <footer>, which mobile hides outright',
  onPhone.footTag !== 'FOOTER', onPhone.footTag);

const phoneDialog = await A.page.evaluate(async () => {
  document.querySelector('[data-space-perms-open]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  const card = document.querySelector('#chatPermsDialog .chat-perms-card');
  const box = card?.getBoundingClientRect();
  return {
    rows: document.querySelectorAll('#chatPermsDialog [data-space-perm]').length,
    fitsWidth: box ? box.width <= window.innerWidth : false,
    fitsHeight: box ? box.height <= window.innerHeight : false,
  };
});
console.log('  ' + JSON.stringify(phoneDialog));
check('the rules dialog fits a phone screen', phoneDialog.fitsWidth && phoneDialog.fitsHeight, JSON.stringify(phoneDialog));
check('and lists all of them there as well', phoneDialog.rows === ruleCount, `${phoneDialog.rows} of ${ruleCount}`);
await A.page.evaluate(() => document.querySelector('[data-perms-close]')?.click());
await A.page.setViewportSize({ width: 1440, height: 900 });
await A.page.waitForTimeout(1200);

console.log('\n===== the owner deletes it for everyone =====');
await openGroup(A.page, 'TeamLife'); await openInfo(A.page);
const nukeShown = await A.page.evaluate(() => document.querySelectorAll('[data-space-nuke]').length);
check('the owner does get one', nukeShown === 1, `${nukeShown} button(s)`);
await A.page.evaluate(() => document.querySelector('[data-space-nuke]')?.click());
/* The shell has no window.confirm, so the question is an in-page dialog. */
await A.page.waitForTimeout(600);
await A.page.evaluate(() => document.querySelector('.poorija-dialog-ok')?.click());
await A.page.waitForTimeout(7000);
/* Dissolving ends the group; it does not reach into anybody's device and take
   the conversation with it. What has to go is the relay's side. */
const aAfter = await A.page.evaluate(() => (window.__spacesDeepProbe?.() || [])[0] || null);
check('the owner keeps the conversation', Boolean(aAfter), aAfter ? aAfter.name : 'gone');
check('and it reads as dissolved rather than live', aAfter?.dissolved === true, `dissolved=${aAfter?.dissolved}`);
await B.page.waitForTimeout(5000);
const bAfter = await B.page.evaluate(() => {
  const g = (window.__spacesDeepProbe?.() || [])[0];
  return g ? { name: g.name, dissolved: g.dissolved, history: (window.__historyProbe(g.conversationId) || []).length } : null;
});
console.log('  member after dissolution: ' + JSON.stringify(bAfter));
check('the member keeps it too', Boolean(bAfter), bAfter ? bAfter.name : 'gone');
check('marked dissolved on their side as well', bAfter?.dissolved === true, `dissolved=${bAfter?.dissolved}`);
check('with the conversation still readable', (bAfter?.history || 0) > 0, `${bAfter?.history} entries`);
check('and the composer refuses to send into it',
  await B.page.evaluate(() => {
    const g = (window.__spacesDeepProbe?.() || [])[0];
    return g ? window.__memberMayProbe(g.conversationId, 'sendMessages') === false : null;
  }), 'read-only');


await ctxC.close(); await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
