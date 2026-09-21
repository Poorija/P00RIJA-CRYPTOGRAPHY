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
import { fileURLToPath } from 'node:url';
/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
   Point it somewhere else with PKG_URL=https://host:port npm run test:e2e */
const BASE_URL = process.env.PKG_URL || 'https://localhost:8585';
const SHOTS = process.env.PKG_SHOTS || fileURLToPath(new URL('./screenshots', import.meta.url));
const PASS='Harness#Pass2026!';
const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok,d});console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);};
async function app(tag){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900},permissions:['microphone','camera']});
  await ctx.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){} window.__clip=[];window.__err=[];
    window.addEventListener('error',e=>window.__err.push('ERR '+e.message));
    window.addEventListener('unhandledrejection',e=>window.__err.push('REJ '+(e.reason?.message||e.reason)));});
  const page=await ctx.newPage();
  page.on('dialog',d=>d.accept());
  page.on('pageerror',e=>console.log(`   ${tag}!! ${e.message.slice(0,150)}`));
  await page.goto(`${BASE_URL}/index.html`,{waitUntil:'load'});
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((pass)=>{
    const set=(id,v)=>{const el=document.getElementById(id); if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
    set('setupPassword',pass); set('confirmPassword',pass);
    document.querySelectorAll('#initialSetup select').forEach((s,i)=>{if(s.options.length>i+1){s.selectedIndex=i+1;s.dispatchEvent(new Event('change',{bubbles:true}));}});
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp,i)=>{inp.value='answer'+i;inp.dispatchEvent(new Event('input',{bubbles:true}));});
    const cb=document.getElementById('acceptTermsCheckbox'); if(cb&&!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}
  },PASS);
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{window.__toasts=[];
    const o=window.PoorijaApp.showNotification?.bind(window.PoorijaApp);
    window.PoorijaApp.showNotification=(m,t)=>{window.__toasts.push(`${t}: ${m}`);return o?.(m,t);};
    const w=navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText=(t)=>{window.__clip.push(t);return w(t).catch(()=>{});};
    document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');});
  await page.waitForTimeout(800);
  await page.evaluate(()=>document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(6500);
  return page;
}
const imp=(p,x)=>p.evaluate(async(t)=>{document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value=t;
  document.querySelector('[data-chat-manual-submit]')?.click();},x);
const id=(p)=>p.evaluate(async()=>{await window.copyChatFullIdentity(); return window.__clip.at(-1);});

const A=await app('A'); const B=await app('B'); const C=await app('C');
const idA=await id(A), idB=await id(B), idC=await id(C);
const fpB=JSON.parse(atob(idB.replace('poorija-chat-v1:',''))).fingerprint;
const fpC=JSON.parse(atob(idC.replace('poorija-chat-v1:',''))).fingerprint;
await imp(A,idB); await imp(A,idC);
await imp(B,idA); await imp(B,idC);
await imp(C,idA); await imp(C,idB);
await A.waitForTimeout(4500);

console.log('\n===== building the group =====');
await A.evaluate(()=>document.querySelector('[data-chat-view="groups"]')?.click());
await A.waitForTimeout(1200);
/* Making a group is one dialog now: the button above a list of groups opens
   it, and the name, members and rules are all asked for in the one place. */
await A.evaluate(()=>document.getElementById('chatStartChatBtn')?.click());
await A.waitForTimeout(900);
await A.evaluate(async ({b,c})=>{
  const name=document.getElementById('chatGroupNameInput');
  name.value='اتاق جلسه'; name.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelectorAll('#chatGroupMembersPanel input[type="checkbox"]').forEach((box)=>{
    box.checked = box.value===b || box.value===c;
    box.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await new Promise((r)=>setTimeout(r,400));
  document.getElementById('chatCreateGroupBtn')?.click();
}, {b:fpB, c:fpC});
await A.waitForTimeout(3500);
await B.waitForTimeout(4000); await C.waitForTimeout(4000);
const openGroup = (p)=>p.evaluate(()=>{
  document.querySelector('[data-chat-view="groups"]')?.click();
  return new Promise(r=>setTimeout(()=>{
    const card=[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(x=>/اتاق جلسه/.test(x.textContent));
    card?.click(); setTimeout(()=>r(Boolean(card)),1500);
  },1000));
});
check('all three see the group', (await openGroup(A)) && (await openGroup(B)) && (await openGroup(C)));
// a message first, so every pair has a live session before the call
await A.fill('#chatComposer','قبل از تماس');
await A.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
await B.waitForTimeout(5000); await C.waitForTimeout(5000);

console.log('\n===== 1. starting a group call =====');
await A.evaluate(()=>document.getElementById('chatVoiceCallBtn')?.click());
await A.waitForTimeout(4000);
const aStage = await A.evaluate(()=>({
  stageOpen: !document.getElementById('chatGroupCall').classList.contains('hidden'),
  tiles: document.querySelectorAll('.chat-gcall-tile').length,
  title: document.getElementById('chatGroupCallTitle')?.textContent.trim(),
  e2ee: Boolean(document.querySelector('.chat-gcall-e2ee')),
  controls: document.querySelectorAll('.chat-gcall-dock button:not(.hidden)').length,
}));
console.log('  A: ' + JSON.stringify(aStage));
check('the caller gets a grid stage with their own tile', aStage.stageOpen && aStage.tiles>=1, JSON.stringify(aStage));
check('it names the group and shows the encryption badge', /اتاق جلسه/.test(aStage.title||'') && aStage.e2ee, aStage.title);

console.log('\n===== 2. the others are invited =====');
await B.waitForTimeout(4000); await C.waitForTimeout(4000);
const bInvite = await B.evaluate(()=>({
  shown: !document.getElementById('chatGroupCallInvite').classList.contains('hidden'),
  text: document.querySelector('.chat-gcall-invite-body')?.textContent.replace(/\s+/g,' ').trim(),
  accept: Boolean(document.querySelector('[data-gcall-accept]')),
  decline: Boolean(document.querySelector('[data-gcall-decline]')),
}));
const cInvite = await C.evaluate(()=>({shown: !document.getElementById('chatGroupCallInvite').classList.contains('hidden')}));
console.log('  B: ' + JSON.stringify(bInvite));
check('every other member gets an invite with accept and decline', bInvite.shown && bInvite.accept && bInvite.decline && cInvite.shown, JSON.stringify({b:bInvite,c:cInvite}));

console.log('\n===== 3. two members join, the mesh assembles =====');
await B.evaluate(()=>document.querySelector('[data-gcall-accept]')?.click());
await B.waitForTimeout(6000);
await C.evaluate(()=>document.querySelector('[data-gcall-accept]')?.click());
await C.waitForTimeout(9000);
await A.waitForTimeout(6000);
const tiles = async (p) => p.evaluate(()=>({
  tiles: document.querySelectorAll('.chat-gcall-tile').length,
  connected: document.querySelectorAll('.chat-gcall-tile:not(.is-waiting)').length,
  withStream: [...document.querySelectorAll('[data-gcall-video]')].filter(v=>v.srcObject).length,
  count: document.getElementById('chatGroupCallCount')?.textContent.trim(),
  duration: document.getElementById('chatGroupCallDuration')?.textContent.trim(),
}));
const tA = await tiles(A), tB = await tiles(B), tC = await tiles(C);
console.log('  A: ' + JSON.stringify(tA));
console.log('  B: ' + JSON.stringify(tB));
console.log('  C: ' + JSON.stringify(tC));
check('the caller sees three tiles', tA.tiles===3, JSON.stringify(tA));
check('each joiner sees three tiles too', tB.tiles===3 && tC.tiles===3, JSON.stringify([tB.tiles,tC.tiles]));
check('every leg carries a live stream on the caller', tA.withStream===3, JSON.stringify(tA));
check('and on both joiners', tB.withStream===3 && tC.withStream===3, JSON.stringify([tB.withStream,tC.withStream]));
check('the participant count is shown', /3/.test(tA.count||''), tA.count);
check('the timer is running', /\d/.test(tA.duration||'') && tA.duration!=='0:00', tA.duration);

console.log('\n===== 4. mute =====');
const muted = await A.evaluate(async ()=>{
  const before = document.querySelectorAll('.chat-gcall-caption .is-muted').length;
  document.getElementById('chatGroupCallMuteBtn')?.click();
  await new Promise(r=>setTimeout(r,600));
  return { before, after: document.querySelectorAll('.chat-gcall-caption .is-muted').length,
    btnActive: document.getElementById('chatGroupCallMuteBtn')?.classList.contains('is-active'),
    trackEnabled: null };
});
console.log('  ' + JSON.stringify(muted));
check('muting marks the tile and the button', muted.after>muted.before && muted.btnActive, JSON.stringify(muted));
await A.evaluate(()=>document.getElementById('chatGroupCallMuteBtn')?.click());

console.log('\n===== 5. one participant leaves =====');
await C.evaluate(()=>document.getElementById('chatGroupCallLeaveBtn')?.click());
await C.waitForTimeout(2500);
await A.waitForTimeout(5000); await B.waitForTimeout(5000);
const cGone = await C.evaluate(()=>({
  stageHidden: document.getElementById('chatGroupCall').classList.contains('hidden'),
}));
const afterLeave = await tiles(A);
const bAfterLeave = await tiles(B);
console.log('  C: ' + JSON.stringify(cGone) + '  A: ' + JSON.stringify(afterLeave) + '  B: ' + JSON.stringify(bAfterLeave));
check('the leaver closes their own stage', cGone.stageHidden);
check('the others drop that tile', afterLeave.tiles===2 && bAfterLeave.tiles===2, JSON.stringify([afterLeave.tiles,bAfterLeave.tiles]));

console.log('\n===== 6. the caller hangs up =====');
await A.evaluate(()=>document.getElementById('chatGroupCallLeaveBtn')?.click());
await A.waitForTimeout(2500);
await B.waitForTimeout(5000);
const ended = await A.evaluate(()=>({hidden: document.getElementById('chatGroupCall').classList.contains('hidden')}));
const bEnded = await B.evaluate(()=>({
  hidden: document.getElementById('chatGroupCall').classList.contains('hidden'),
  tiles: document.querySelectorAll('.chat-gcall-tile').length,
}));
console.log('  A: ' + JSON.stringify(ended) + '  B: ' + JSON.stringify(bEnded));
check('the caller leaves cleanly', ended.hidden);
check('the last one left closes too', bEnded.hidden, JSON.stringify(bEnded));

for (const [tag,p] of [['A',A],['B',B],['C',C]]) {
  const errs=await p.evaluate(()=>(window.__err||[]).filter(x=>!/SSL|Failed to load resource/.test(x)));
  check(`${tag}: no uncaught errors`, errs.length===0, JSON.stringify(errs.slice(0,2)));
}
const failing=results.filter(r=>!r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach(f=>console.log(`  FAIL ${f.n} — ${f.d}`));
await browser.close();
process.exit(failing.length?1:0);
