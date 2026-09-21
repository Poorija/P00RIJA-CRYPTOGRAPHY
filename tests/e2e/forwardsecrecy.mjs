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
/* Forward secrecy, end to end.
 *
 *   npm run relay                 # terminal 1
 *   PORT=8123 npm run dev         # terminal 2
 *   npm run test:fs
 *
 * Two questions, both answered against a real relay rather than by reading the
 * code: does a live session derive its key instead of shipping one wrapped to
 * a key that never changes, and does an undelivered message really stop being
 * openable once its prekey window closes?
 */
const BASE = process.env.PKG_URL || 'http://localhost:8123';
/* Reachable FROM THE PAGE, not just from here: an https page cannot fetch
   http://localhost:9000 or open a ws:// socket to it — the browser blocks it as
   mixed content and the suite reads that as a relay that is down. When the app
   is served over https the relay defaults to that same origin, which is the
   container serving both halves. The env var still wins. */
const RELAY = process.env.PKG_RELAY
  || (/^https:/i.test(BASE) ? String(BASE).replace(/\/+$/, '') : 'http://localhost:9000');
const PASS = 'Harness#Pass2026!';
const DATA = process.env.CHAT_DATA_DIR || path.resolve(process.cwd(), 'data', 'chat-signal');
const mailboxes = () => readMailboxes(path.join(DATA, 'offline-messages.json'));
const results = [];
const check = (n, ok, d='') => { results.push({n,ok}); console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
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
    document.getElementById('chatConnectBtn')?.click();}, RELAY);
  await page.waitForTimeout(5500);
  return { ctx, page };
}

console.log('\n===== every device publishes a prekey, and it expires =====');
const A = await boot('A');
const B = await boot('B');
const prekey = await A.page.evaluate(()=>window.__prekeyProbe());
console.log('  ' + JSON.stringify(prekey));
check('a prekey exists and carries an expiry',
  prekey.count >= 1 && Boolean(prekey.current) && Boolean(prekey.expiresAt), JSON.stringify(prekey));
check('and the window is the fifteen days the app promises',
  prekey.lifetimeDays === 15, `${prekey.lifetimeDays} days`);

console.log('\n===== a live session derives its key rather than being handed one =====');
const idB = await B.page.evaluate(async()=>{ await window.copyChatFullIdentity(); return window.__clip.at(-1); });
await A.page.evaluate(async(x)=>{ document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value = x;
  document.querySelector('[data-chat-manual-submit]')?.click(); }, idB);
await A.page.waitForTimeout(2500);
await A.page.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.page.waitForTimeout(3000);
await A.page.fill('#chatComposer', 'live and forward secret');
await A.page.click('#chatSendMessageBtn');
await B.page.waitForTimeout(5000);

const arrived = await B.page.evaluate(()=>document.body.innerText.includes('live and forward secret'));
check('the message arrives', arrived === true, String(arrived));
const [keysA, keysB] = await Promise.all([
  A.page.evaluate(()=>window.__keyFingerprints()),
  B.page.evaluate(()=>window.__keyFingerprints()),
]);
console.log('  A ' + JSON.stringify(keysA) + '\n  B ' + JSON.stringify(keysB));
check('both ends hold the same derived key, from one exchange each',
  keysA[0]?.key && keysA[0].key === keysB[0]?.key, `${keysA[0]?.key} vs ${keysB[0]?.key}`);

console.log('\n===== an envelope queued under lock survives the lock =====');
/* The window closes while the message is in flight, which is the case that
   matters: the sender sealed it to the prekey it last saw, and by the time the
   recipient collects it that prekey is gone from their device.
   Expiry has to happen while B is unlocked — the store is written through the
   vault, and a locked app cannot persist anything. */
const expired = await B.page.evaluate(()=>window.__expirePrekeys());
console.log('  prekeys left after the window closes: ' + JSON.stringify(expired));
check('the private prekey is deleted rather than archived', expired.left === 0, JSON.stringify(expired));

await B.page.evaluate(()=>{ (window.lockApp || window.PoorijaApp?.lockApp)?.(); });
await B.page.waitForTimeout(3000);
console.log('  A knows B prekey: ' + JSON.stringify(await A.page.evaluate(()=>window.__peerPrekeyProbe())));
await A.page.fill('#chatComposer', 'this one waits in the queue');
await A.page.click('#chatSendMessageBtn');
await A.page.waitForTimeout(4000);
/* A steps away too. Otherwise A simply resends the message from its own copy
   the moment B reappears — which is correct behaviour, and would hide whether
   the queued envelope itself could still be opened. */
/* What actually went on the wire. The prekey path is silent when it does not
   engage — the sender simply falls back to the identity-wrapped seal, which
   never expires — so the envelope itself has to be read. This caught a real
   one: merging a pasted identity card blanked the stored prekey, and every
   queued message after that quietly lost its window. */
const queued = Object.values(mailboxes()).flat()
  .map((item) => item?.payload).filter((p) => p?.type === 'offline-chat');
const sealed = queued.find((p) => p.kex) || null;
console.log('  envelope on the relay: ' + JSON.stringify({
  fields: sealed ? Object.keys(sealed).sort() : null,
  kexVersion: sealed?.kex?.v, legacySeal: sealed ? sealed.seal || '(empty)' : null }));
check('the queued envelope really is sealed to a prekey, not to the identity key',
  Boolean(sealed) && sealed.kex.v === 2 && Boolean(sealed.kex.prekeyId) && !sealed.seal,
  sealed ? `v${sealed.kex.v}, seal ${sealed.seal ? 'present' : 'empty'}` : 'no kex envelope found');
check('and nothing readable is in it',
  Boolean(sealed) && !JSON.stringify(sealed).includes('this one waits in the queue'),
  'no plaintext');

await A.page.evaluate(()=>{ (window.lockApp || window.PoorijaApp?.lockApp)?.(); });
await A.page.waitForTimeout(2500);

await B.page.evaluate((pass)=>{ const el=document.getElementById('unlockPassword');
  if(el){ el.value=pass; el.dispatchEvent(new Event('input',{bubbles:true})); }
  window.unlockApp?.(); }, PASS);
await B.page.waitForTimeout(9000);
await B.page.evaluate(()=>{ window.switchTab?.('chat'); document.querySelector('#chatPeerList .chat-peer-card')?.click(); });
await B.page.waitForTimeout(2500);
const afterExpiry = await B.page.evaluate(()=>({
  hasMessage: (document.getElementById('chatMessages')?.textContent || '').includes('this one waits in the queue'),
  expiredNote: [...document.querySelectorAll('#chatMessages .chat-system-note')]
    .some(n => /۱۵ روزه|15-day/.test(n.textContent || '')),
  notes: [...document.querySelectorAll('#chatMessages .chat-system-note')].map(n=>n.textContent.trim().slice(0,50)),
}));
console.log('  ' + JSON.stringify(afterExpiry));
/* These two used to assert the opposite, and asserting the opposite was
   asserting a bug. The scenario above is a recipient who was LOCKED while the
   envelope arrived — not a recipient whose fifteen-day window has closed. The
   envelope here is seconds old.

   Until 2.111 the unseal path re-read the prekey list from encrypted storage
   on every arrival, which under lock came back empty; a minutes-old envelope
   was therefore declared past its window, noted as expired, acknowledged, and
   the relay destroyed it. This test measured that and called it a pass.

   The contract now: an envelope younger than 24 hours that cannot be opened
   leaves no note and is not acknowledged, and findPrekey() consults the live
   list so a locked recipient can open its own mail on unlock. So the message
   must ARRIVE, and there must be NO expiry note.

   The genuine "dies with its prekey" property is still covered above — the
   envelope is sealed to a prekey and carries no plaintext. The >24h expiry
   path needs a backdated envelope and is not exercised by this scenario. */
check('a message queued while the recipient was locked still opens after unlock',
  afterExpiry.hasMessage === true, JSON.stringify(afterExpiry));
check('and no false expiry note is left on mail that is seconds old',
  afterExpiry.expiredNote === false, JSON.stringify(afterExpiry));

console.log('\n===== and the app says so where people will meet it =====');
await A.page.evaluate((pass)=>{ const el=document.getElementById('unlockPassword');
  if(el){ el.value=pass; el.dispatchEvent(new Event('input',{bubbles:true})); }
  window.unlockApp?.(); }, PASS);
await A.page.waitForTimeout(6000);
const notice = await A.page.evaluate(()=>{
  window.switchTab?.('chat');
  document.querySelector('[data-chat-view="connection"]')?.click();
  const card = document.getElementById('chatForwardSecrecyCard');
  return { present: Boolean(card), text: (card?.textContent || '').replace(/\s+/g,' ').trim() };
});
console.log('  ' + JSON.stringify({ present: notice.present, text: notice.text.slice(0, 70) }));
check('the fifteen-day window is stated in the app, not only in the docs',
  notice.present && /۱۵ روز|15 days/.test(notice.text), notice.text.slice(0, 60));
check('and it is honest about what it does not cover',
  /تاریخچه|history/.test(notice.text), notice.text.slice(-60));

await browser.close();
const bad = results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length?1:0);
