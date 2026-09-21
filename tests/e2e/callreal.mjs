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
const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--allow-file-access-from-files']});
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok,d});console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);};
async function app(tag,w=1440,h=900){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:w,height:h},permissions:['microphone','camera']});
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
const A=await app('A'); const B=await app('B',1280,860);
const idA=await A.evaluate(async()=>{await window.copyChatFullIdentity(); return window.__clip.at(-1);});
await B.evaluate(async(x)=>{document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value=x;
  document.querySelector('[data-chat-manual-submit]')?.click();},idA);
await B.waitForTimeout(2500);
await B.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await B.waitForTimeout(4000);
await B.fill('#chatComposer','pairing'); await B.click('#chatSendMessageBtn');
await A.waitForTimeout(4500);
await A.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.waitForTimeout(3000);


/* Every row in every section, straight from state, so the assertions are about
   the log itself and not about which section happens to be open. */
const log = (p)=>p.evaluate(()=>{
  const open=(id)=>{document.querySelector(`[data-chat-call-filter="${id}"]`)?.click();};
  const read=()=>[...document.querySelectorAll('[data-calls-work] .chat-call-log-row')].map(r=>({
    kind:r.querySelector('.text-sm')?.textContent.trim(),
    status:r.querySelector('.text-xs')?.textContent.trim() }));
  const out={};
  ['all','incoming','outgoing','missed'].forEach((id)=>{ open(id); out[id]=read(); });
  open('all');
  const tabs=[...document.querySelectorAll('[data-calls-work] [data-chat-call-filter]')].map(b=>{
    const r=b.getBoundingClientRect();
    return {id:b.getAttribute('data-chat-call-filter'), y:Math.round(r.y), w:Math.round(r.width)};});
  return {counts:{all:out.all.length,incoming:out.incoming.length,outgoing:out.outgoing.length,missed:out.missed.length},
    rows:out, tabs};
});
const openCalls = async (p) => { await p.evaluate(()=>document.querySelector('[data-chat-view="calls"]')?.click()); await p.waitForTimeout(800); };


/* Calling lives behind the thread menu now - only "end call" is out in the
   open, because ending one is never worth a tap through a menu. Open the menu
   the way a person would, then press the entry. */
const placeCall = async (p, id) => {
  await p.evaluate(() => document.getElementById('chatThreadMenuBtn')?.click());
  await p.waitForTimeout(400);
  await p.click(`#${id}`, { timeout: 15000 }).catch((e) => console.log('  call:', e.message.slice(0, 50)));
};

console.log('\n===== 1. the four sections are one row =====');
await openCalls(A);
const tabs = (await log(A)).tabs;
console.log('  ' + JSON.stringify(tabs));
check('all four tabs exist', tabs.length===4, JSON.stringify(tabs.map(t=>t.id)));
check('and they share a single row', new Set(tabs.map(t=>t.y)).size===1, JSON.stringify(tabs.map(t=>[t.id,t.y])));
check('each takes an equal quarter', new Set(tabs.map(t=>t.w)).size<=2, JSON.stringify(tabs.map(t=>t.w)));

console.log('\n===== 2. one answered call is one row on each side =====');
await A.evaluate(()=>document.querySelector('[data-chat-view="chats"]')?.click());
await A.waitForTimeout(600);
await A.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.waitForTimeout(1200);
await placeCall(A, 'chatVoiceCallBtn');
await B.waitForTimeout(3000);
const accepted = await (async ()=>{ for (let i=0;i<20;i++){
  const done = await B.evaluate(()=>{
    const visible=(el)=>el && !el.classList.contains('hidden') && el.offsetParent!==null;
    const a=document.getElementById('chatAcceptCallBtn'); const m=document.getElementById('chatModalAcceptBtn');
    if (visible(a)) { a.click(); return 'sheet'; } if (visible(m)) { m.click(); return 'modal'; } return ''; });
  if (done) return done; await B.waitForTimeout(500);} return ''; })();
console.log('  B accepted via: ' + accepted);
await A.waitForTimeout(6000);
await A.evaluate(()=>document.getElementById('chatEndCallControlBtn')?.click());
await A.waitForTimeout(4000);
await B.waitForTimeout(4000);
await openCalls(A); await openCalls(B);
const a2 = await log(A); const b2 = await log(B);
console.log('  caller   ' + JSON.stringify(a2.counts) + ' ' + JSON.stringify(a2.rows.all));
console.log('  receiver ' + JSON.stringify(b2.counts) + ' ' + JSON.stringify(b2.rows.all));
check('the caller logs exactly one row', a2.counts.all===1, JSON.stringify(a2.counts));
check('and it is outgoing only', a2.counts.outgoing===1 && a2.counts.incoming===0 && a2.counts.missed===0, JSON.stringify(a2.counts));
check('the receiver logs exactly one row', b2.counts.all===1, JSON.stringify(b2.counts));
check('and it is incoming only', b2.counts.incoming===1 && b2.counts.outgoing===0 && b2.counts.missed===0, JSON.stringify(b2.counts));
check('both rows say the call ended', /پایان|ended|قطع/i.test(a2.rows.all[0]?.status||'') && /پایان|ended|قطع/i.test(b2.rows.all[0]?.status||''), JSON.stringify([a2.rows.all[0], b2.rows.all[0]]));

console.log('\n===== 3. a declined call is one row on each side =====');
await A.evaluate(()=>document.querySelector('[data-chat-view="chats"]')?.click());
await A.waitForTimeout(500);
await A.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.waitForTimeout(900);
await placeCall(A, 'chatVideoCallBtn');
await B.waitForTimeout(3000);
const declined = await (async ()=>{ for (let i=0;i<20;i++){
  const done = await B.evaluate(()=>{
    const visible=(el)=>el && !el.classList.contains('hidden') && el.offsetParent!==null;
    const a=document.getElementById('chatRejectCallBtn'); const m=document.getElementById('chatModalRejectBtn');
    if (visible(a)) { a.click(); return 'sheet'; } if (visible(m)) { m.click(); return 'modal'; } return ''; });
  if (done) return done; await B.waitForTimeout(500);} return ''; })();
console.log('  B declined via: ' + declined);
await A.waitForTimeout(5000); await B.waitForTimeout(3000);
await openCalls(A); await openCalls(B);
const a3 = await log(A); const b3 = await log(B);
console.log('  caller   ' + JSON.stringify(a3.counts));
console.log('  receiver ' + JSON.stringify(b3.counts));
check('the caller gains exactly one row', a3.counts.all===2, JSON.stringify(a3.counts));
check('a declined call counts as missed, not as incoming', a3.counts.incoming===0 && a3.counts.missed===1, JSON.stringify(a3.counts));
check('the receiver gains exactly one row too', b3.counts.all===2, JSON.stringify(b3.counts));
check('and never shows the caller under outgoing', b3.counts.outgoing===0, JSON.stringify(b3.counts));

console.log('\n===== 4. the sections still add up =====');
const adds = (v) => v.counts.incoming + v.counts.outgoing + v.counts.missed === v.counts.all;
check('caller: incoming + outgoing + missed equals all', adds(a3), JSON.stringify(a3.counts));
check('receiver: incoming + outgoing + missed equals all', adds(b3), JSON.stringify(b3.counts));
check('no row is stranded outside every section', adds(a3) && adds(b3), JSON.stringify({a:a3.counts,b:b3.counts}));

console.log('\n===== 5. a video call keeps its kind =====');
const kinds = a3.rows.all.map(r=>r.kind);
console.log('  ' + JSON.stringify(kinds));
check('the log distinguishes voice from video', new Set(kinds).size===2, JSON.stringify(kinds));

await A.screenshot({path:`${SHOTS}/callreal.png`});
const errsA = await A.evaluate(()=>window.__err?.slice(0,3)||[]);
check('no page errors', errsA.length===0, JSON.stringify(errsA));
const bad=results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
bad.forEach(r=>console.log('  FAIL ' + r.n + (r.d?'  — '+r.d:'')));
await browser.close();
