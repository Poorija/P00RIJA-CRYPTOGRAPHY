/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { readMailboxes } from './_relay-store.mjs';
/* The emergency wipe, from both doors.
 *
 *   npm run relay ; PORT=8123 npm run dev ; npm run test:wipe
 *
 * What is checked is not that a function ran but that nothing is left: the
 * relay's queue for that identity, the browser's storages, its databases, its
 * caches and its service worker, and the keys the chat module was holding.
 */
const BASE = process.env.PKG_URL || 'http://localhost:8123';
/* Reachable FROM THE PAGE, not just from here: an https page cannot fetch
   http://localhost:9000 or open a ws:// socket to it — the browser blocks it as
   mixed content and the suite reads that as a relay that is down. When the app
   is served over https the relay defaults to that same origin, which is the
   container serving both halves. The env var still wins. */
const RELAY = process.env.PKG_RELAY
  || (/^https:/i.test(BASE) ? String(BASE).replace(/\/+$/, '') : 'http://localhost:9000');
const DATA = process.env.CHAT_DATA_DIR || path.resolve(process.cwd(), 'data', 'chat-signal');
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d='') => { results.push({n,ok}); console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const mailboxes = () => readMailboxes(process.env.CHAT_OFFLINE_STORE_PATH || path.join(DATA, 'offline-messages.json'));
const browser = await chromium.launch();

async function boot(tag) {
  const ctx = await browser.newContext({ viewport:{width:1200,height:900} });
  await ctx.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){} window.__clip=[];});
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`   ${tag}!! ${e.message.slice(0,120)}`));
  await page.goto(`${BASE}/index.html`, { waitUntil:'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((pass)=>{const set=(id,v)=>{const el=document.getElementById(id);if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
    set('setupPassword',pass); set('confirmPassword',pass);
    document.querySelectorAll('#initialSetup select').forEach((s,i)=>{if(s.options.length>i+1){s.selectedIndex=i+1;s.dispatchEvent(new Event('change',{bubbles:true}));}});
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp,i)=>{inp.value='answer'+i;inp.dispatchEvent(new Event('input',{bubbles:true}));});
    const cb=document.getElementById('acceptTermsCheckbox'); if(cb&&!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}}, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(3500);
  await page.evaluate(()=>{document.getElementById('mobileInstallGate')?.classList.add('hidden');
    const w=navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText=(t)=>{window.__clip.push(t);return w(t).catch(()=>{});};
    window.switchTab?.('chat');});
  await page.waitForTimeout(1200);
  await page.evaluate((relay)=>{const u=document.getElementById('chatServerUrl');
    if(u){u.value=relay;u.dispatchEvent(new Event('input',{bubbles:true}));u.dispatchEvent(new Event('change',{bubbles:true}));}
    document.getElementById('chatConnectBtn')?.click();}, relayArg());
  await page.waitForTimeout(5500);
  return { ctx, page };
}
function relayArg(){ return RELAY; }

console.log('\n===== something to lose =====');
const A = await boot('A'); const B = await boot('B');
const idB = await B.page.evaluate(async()=>{ await window.copyChatFullIdentity(); return window.__clip.at(-1); });
await A.page.evaluate(async(x)=>{ document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value = x;
  document.querySelector('[data-chat-manual-submit]')?.click(); }, idB);
await A.page.waitForTimeout(2500);
await A.page.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.page.waitForTimeout(3000);
await A.page.fill('#chatComposer','something worth wiping');
await A.page.click('#chatSendMessageBtn');
await B.page.waitForTimeout(4000);
/* B goes away so A can leave a queued envelope behind on the relay.
 *
 * Locking alone stopped being enough at 2.111. A locked app deliberately KEEPS
 * its relay connection now — that was the fix for messages lost or destroyed
 * while the app sat locked in the background — so a locked Playwright page,
 * whose webview is never actually suspended, receives the envelope live and
 * acknowledges it. The mailbox was therefore empty a moment later and this
 * check read 0, which also left the three assertions after it vacuous.
 *
 * Cutting the context's network is what "B goes away" has to mean now: the
 * socket drops, the relay sees an absent recipient, and the envelope stays
 * queued where the wipe can be asked to forget it. */
const fpB = await B.page.evaluate(()=>window.PoorijaChat.identityFingerprint());
/* Genuinely absent, not merely locked.
 *
 * Since 2.111 a locked app deliberately KEEPS its relay connection — that was
 * the fix for messages lost while the app sat locked in the background — so
 * lockApp() alone leaves the recipient online as far as the relay can tell. It
 * forwards live, has no reason to reach for the push service, and this section
 * measured that absence of a wake-up as the relay failing to send one.
 *
 * disconnectChat() is what the app itself calls when somebody leaves: it closes
 * the relay socket, destroys the peer and stops reconnecting. That is what
 * "steps away" has to mean now. */
await B.page.evaluate(()=>{
  window.disconnectChat?.();
  (window.lockApp || window.PoorijaApp?.lockApp)?.();
});
await B.page.waitForTimeout(4000);
await A.page.fill('#chatComposer','and this one is queued');
await A.page.click('#chatSendMessageBtn');
await A.page.waitForTimeout(3500);
const queuedBefore = (mailboxes()[fpB] || []).length;
check('the relay is holding a queued envelope for B', queuedBefore >= 1, `${queuedBefore} envelope(s)`);

const secretBefore = await A.page.evaluate(()=>localStorage.getItem('poorija_installation_secret'));
const before = await A.page.evaluate(async () => ({
  local: localStorage.length,
  idb: (await indexedDB.databases?.() || []).length,
  caches: (await caches.keys()).length,
  workers: (await navigator.serviceWorker.getRegistrations()).length,
  identity: Boolean(window.PoorijaChat.identityFingerprint()),
}));
console.log('  A before: ' + JSON.stringify(before));
check('A has an identity, storage, a database, a cache and a worker to lose',
  before.local > 0 && before.identity && before.workers >= 1, JSON.stringify(before));

console.log('\n===== the wipe itself, before anything reloads =====');
/* Measured with the reload held back, so what is seen is what the wipe did
   rather than what a fresh install rebuilt a moment later. */
const wiped = await A.page.evaluate(async () => {
  const report = await window.emergencyWipe({ purgeRelay: true });
  return { report,
    local: localStorage.length, session: sessionStorage.length,
    idb: (await indexedDB.databases?.() || []).length,
    caches: (await caches.keys()).length,
    workers: (await navigator.serviceWorker.getRegistrations()).length,
    identity: window.PoorijaChat.identityFingerprint(),
    sessionKeys: Object.keys(window.__sessionKeyAges?.() || {}).length,
  };
});
console.log('  ' + JSON.stringify(wiped));
check('storage, databases, caches and the worker are all gone',
  wiped.local === 0 && wiped.session === 0 && wiped.idb === 0
  && wiped.caches === 0 && wiped.workers === 0, JSON.stringify(wiped));
check('and the chat module is holding no identity and no keys',
  wiped.identity === '' && wiped.sessionKeys === 0,
  `identity "${wiped.identity}", ${wiped.sessionKeys} key(s)`);

console.log('\n===== the biohazard button =====');
await A.page.evaluate(()=>window.triggerPanic());
await A.page.waitForTimeout(6000);
const after = await A.page.evaluate(async () => {
  const keys = Object.keys(localStorage);
  return {
    keys,
    /* Anything that could carry an identity, a key, a message or a password. */
    sensitive: keys.filter((k) => /identity|session_keys|prekey|history|contacts|master|panic|vault|calls|spaces|drafts/i.test(k)),
    idb: (await indexedDB.databases?.() || []).length,
    onSetup: Boolean(document.getElementById('initialSetup') && !document.getElementById('initialSetup').classList.contains('hidden')),
  };
});
console.log('  A after: ' + JSON.stringify(after));
/* After the reload the app is a new install and writes its own baseline —
   a language, a theme. What must not come back is anything of the old one. */
console.log('  keys left after the reload: ' + JSON.stringify(after.keys));
check('nothing of the old install survives the reload',
  after.sensitive.length === 0, after.sensitive.join(', ') || 'no identity, vault, history or key data');
check('every database is gone', after.idb === 0, `${after.idb} left`);
check('and the app is back at first run', after.onSetup === true, String(after.onSetup));
/* The device-binding secret is regenerated, not carried over: a wiped install
   must not be recognisable as the one that was wiped. */
const secretAfter = await A.page.evaluate(()=>localStorage.getItem('poorija_installation_secret'));
check('the install is a new one, not the old one wearing a fresh coat',
  Boolean(secretAfter) && secretAfter !== secretBefore,
  `${String(secretBefore).slice(0,8)}… → ${String(secretAfter).slice(0,8)}…`);

console.log('\n===== and the relay forgot it too =====');
/* B's queue is A's counterpart: wipe from B and its mailbox must vanish. */
await B.page.evaluate((pass)=>{ const el=document.getElementById('unlockPassword');
  if(el){ el.value=pass; el.dispatchEvent(new Event('input',{bubbles:true})); }
  window.unlockApp?.(); }, PASS);
await B.page.waitForTimeout(7000);
await B.page.fill('#chatComposer','B leaves something too').catch(()=>{});
const queuedNow = (mailboxes()[fpB] || []).length;
await B.page.evaluate(()=>window.wipeAllData(true));
await B.page.waitForTimeout(6000);
const queuedAfter = (mailboxes()[fpB] || []).length;
console.log(`  B mailbox: ${queuedNow} before the wipe, ${queuedAfter} after`);
check('the relay drops the queue for an identity that wipes itself',
  queuedAfter === 0, `${queuedAfter} left`);

console.log('\n===== the panic password takes the same door =====');
const C = await boot('C');
await C.page.evaluate(()=>{
  const el = document.getElementById('panicPasswordInput_sc');
  if (el) { el.value = 'PanicWord#2026'; el.dispatchEvent(new Event('input', { bubbles: true })); }
  window.setPanicPassword?.('panicPasswordInput_sc');
});
await C.page.waitForTimeout(1500);

/* The duress password used to be a second hash in localStorage that triggered
   a wipe. Both halves of that were wrong: the hash sat beside the real one and
   announced that a duress password existed, and a wipe is not an escape from
   compulsion — an empty vault is an answer, and a visibly destroyed one
   invites the next question.

   So what is asserted here is inverted on purpose. Entering the duress
   password must NOT wipe anything; it must open a different, fully furnished
   profile, leaving the real one untouched and unreadable. The nuclear button
   still wipes, and is checked separately above. */

const duressState = await C.page.evaluate(() => ({
  noPanicHash: localStorage.getItem('poorija_panic_hash') === null,
  noMasterHash: localStorage.getItem('poorija_master_hash') === null,
  slots: (() => { try { return JSON.parse(localStorage.getItem('poorija_vault')).slots.length; } catch (e) { return 0; } })(),
  profiles: new Set(Object.keys(localStorage)
    .filter((k) => k.startsWith('poorija_p_'))
    .map((k) => k.slice(10).split('_')[0])).size,
  realPid: window.PoorijaApp?.state?.activeProfile?.pid || null
}));
console.log('  C after setting a duress password: ' + JSON.stringify(duressState));

check('setting a duress password stores no second hash', duressState.noPanicHash === true);
check('and no password record of any kind exists', duressState.noMasterHash === true);
check('the vault still holds exactly two slots', duressState.slots === 2, String(duressState.slots));
check('two profile namespaces exist, as they do on every install',
  duressState.profiles === 2, String(duressState.profiles));

/* Lock, then enter the duress password at the real lock screen. */
await C.page.evaluate(() => { (window.lockApp || window.PoorijaApp?.lockApp)?.(); });
await C.page.waitForTimeout(2000);
await C.page.evaluate(() => {
  const input = document.getElementById('unlockPassword');
  if (input) { input.value = 'PanicWord#2026'; input.dispatchEvent(new Event('input', { bubbles: true })); }
  window.unlockApp?.();
});
await C.page.waitForTimeout(6000);

const afterDuress = await C.page.evaluate(() => {
  const keys = Object.keys(localStorage);
  return {
    openedPid: window.PoorijaApp?.state?.activeProfile?.pid || null,
    unlocked: window.PoorijaApp?.state?.isLocked === false,
    vaultIntact: localStorage.getItem('poorija_vault') !== null,
    profiles: new Set(keys.filter((k) => k.startsWith('poorija_p_'))
      .map((k) => k.slice(10).split('_')[0])).size,
    totalKeys: keys.length
  };
});
console.log('  C after entering the duress password: ' + JSON.stringify(afterDuress));

check('entering the duress password opens the app rather than wiping it',
  afterDuress.unlocked === true && afterDuress.vaultIntact === true,
  JSON.stringify(afterDuress));
check('it opens a DIFFERENT profile from the real one',
  Boolean(afterDuress.openedPid) && afterDuress.openedPid !== duressState.realPid,
  `${duressState.realPid} vs ${afterDuress.openedPid}`);
check('the real profile\'s data is still on disk, just unreachable',
  afterDuress.profiles === 2, String(afterDuress.profiles));
check('nothing was destroyed by entering it',
  afterDuress.totalKeys > 3, `${afterDuress.totalKeys} keys`);

/* And the decoy has to look like somebody uses it. An empty decoy fails. */
const decoyContent = await C.page.evaluate(() => {
  const app = window.PoorijaApp;
  const read = (k) => { try { return app.decryptStorageData(localStorage.getItem(k)); } catch (e) { return null; } };
  const notes = read('poorija_secure_notes');
  const keys = read('poorija_keys');
  const contacts = read('poorija_chat_contacts');
  return {
    notes: Array.isArray(notes) ? notes.length : 0,
    keys: Array.isArray(keys) ? keys.length : 0,
    contacts: Array.isArray(contacts) ? contacts.length : 0
  };
});
console.log('  C decoy contents: ' + JSON.stringify(decoyContent));
check('the space it opens is furnished, not empty',
  decoyContent.notes >= 5 && decoyContent.keys >= 2 && decoyContent.contacts >= 3,
  JSON.stringify(decoyContent));

await browser.close();
const bad = results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length?1:0);
