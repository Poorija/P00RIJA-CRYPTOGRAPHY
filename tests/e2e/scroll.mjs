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
const browser=await chromium.launch();
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok,d});console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);};
async function app(tag){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});
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
  await page.evaluate((name)=>{window.__toasts=[];
    const o=window.PoorijaApp.showNotification?.bind(window.PoorijaApp);
    window.PoorijaApp.showNotification=(m,t)=>{window.__toasts.push(`${t}: ${m}`);return o?.(m,t);};
    const w=navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText=(t)=>{window.__clip.push(t);return w(t).catch(()=>{});};
    const n=document.getElementById('chatDisplayName'); if(n){n.value=name;n.dispatchEvent(new Event('input',{bubbles:true}));}
    document.getElementById('chatSaveProfileBtn')?.click();
    document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');},tag);
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
const fpOf=(x)=>JSON.parse(atob(x.replace('poorija-chat-v1:',''))).fingerprint;

const openPeer=(p,fp)=>p.evaluate((f)=>{
  const card=[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(c=>(c.dataset.peerFingerprint||c.getAttribute('data-fingerprint')||c.outerHTML).includes(f.slice(0,16)));
  card?.click();
  return Boolean(card);
},fp);

/* Everything the thread's scroll position can tell us in one shot. */
const probe=(p)=>p.evaluate(()=>{
  const panel=document.getElementById('chatMessages');
  if(!panel) return null;
  /* offsetTop, not client rects: bubbles animate in with a transform and a
     rect read mid-animation reports a position the layout never had. */
  const visible=[...panel.querySelectorAll('.chat-message-bubble[data-id]')]
    .filter(b=>b.offsetTop+b.offsetHeight>panel.scrollTop+4 && b.offsetTop<panel.scrollTop+panel.clientHeight-4);
  return {
    scrollTop: Math.round(panel.scrollTop),
    scrollHeight: panel.scrollHeight,
    clientHeight: panel.clientHeight,
    bottomGap: Math.round(panel.scrollHeight-panel.scrollTop-panel.clientHeight),
    bubbles: panel.querySelectorAll('.chat-message-bubble').length,
    firstVisible: visible[0]?.querySelector('.chat-message-text')?.textContent.trim().slice(0,24)||'',
    firstVisibleOffset: visible[0]? Math.round(visible[0].offsetTop-panel.scrollTop):null,
    animating: [...panel.querySelectorAll('.chat-message-bubble')].filter(b=>b.classList.contains('is-fresh')).length,
    selecting: !document.getElementById('chatSelectionBar')?.classList.contains('hidden'),
    selected: Number(document.getElementById('chatSelectionCount')?.textContent||'0'),
  };
});

/* Park the thread somewhere without the stylesheet's smooth animation, so the
   probes are not racing a glide that is still in flight. */
const stage=(page,where)=>page.evaluate((w)=>{
  const p=document.getElementById('chatMessages');
  const previous=p.style.scrollBehavior; p.style.scrollBehavior='auto';
  p.scrollTop = w==='top' ? 0 : p.scrollHeight;
  p.style.scrollBehavior=previous;
},where);

/* A real long press: move, hold still, release. Any pointermove cancels the
   hold, so the mouse must not drift between down and up. */
async function longPress(page, box, ms=760){
  await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  const held = await page.evaluate(()=>({
    selecting: !document.getElementById('chatSelectionBar')?.classList.contains('hidden'),
    selected: Number(document.getElementById('chatSelectionCount')?.textContent||'0'),
  }));
  await page.mouse.up();
  return held;
}
const boxOfNth=async(page,n)=>{
  const el=page.locator('#chatMessages .chat-message-bubble').nth(n);
  return await el.boundingBox();
};

console.log('\n===== staging a long thread =====');
const A=await app('ALPHA'); const B=await app('BETA'); const C=await app('GAMMA');
const idA=await id(A), idB=await id(B), idC=await id(C);
await imp(A,idB); await imp(A,idC); await imp(B,idA); await imp(C,idA);
await A.waitForTimeout(4000);
const fpB=fpOf(idB), fpC=fpOf(idC);
console.log('  opened B: ' + await openPeer(A,fpB));
await A.waitForTimeout(2500);
for(let i=1;i<=26;i++){
  await A.fill('#chatComposer', `پیام شماره ${i}`);
  await A.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
  await A.waitForTimeout(140);
}
await A.waitForTimeout(2500);
let p=await probe(A);
console.log('  ' + JSON.stringify(p));
check('the thread is long enough to scroll', p.scrollHeight - p.clientHeight > 300, `${p.scrollHeight}px of content in ${p.clientHeight}px`);
check('after sending, the thread sits at the newest message', p.bottomGap < 40, `gap ${p.bottomGap}px`);

console.log('\n===== 1. long-pressing a message keeps your place =====');
await stage(A,'top');
await A.waitForTimeout(300);
const before1=await probe(A);
console.log('  before: ' + JSON.stringify(before1));
const box=await boxOfNth(A,2);
const held1=await longPress(A,box);
console.log('  while still held down: ' + JSON.stringify(held1));
await A.waitForTimeout(700);
const after1=await probe(A);
console.log('  after:  ' + JSON.stringify(after1));
check('the long press turns selection on', held1.selecting && held1.selected===1, JSON.stringify(held1));
check('and it survives letting go', after1.selecting && after1.selected===1, JSON.stringify({sel:after1.selecting,n:after1.selected}));
check('the thread does NOT jump to the end', after1.bottomGap > 100, `bottom gap went ${before1.bottomGap} -> ${after1.bottomGap}`);
check('the same message is still under the same pixel', after1.firstVisible===before1.firstVisible && Math.abs((after1.firstVisibleOffset??0)-(before1.firstVisibleOffset??0))<6, `${before1.firstVisible}@${before1.firstVisibleOffset} -> ${after1.firstVisible}@${after1.firstVisibleOffset}`);

console.log('\n===== 2. picking a second message keeps your place =====');
const before2=await probe(A);
const box2=await boxOfNth(A,4);
await A.mouse.click(box2.x+box2.width/2, box2.y+box2.height/2);
await A.waitForTimeout(600);
const after2=await probe(A);
console.log('  ' + JSON.stringify(after2));
check('the second message is selected too', after2.selected===2, `${after2.selected} selected`);
check('selecting does not replay the entry animation on every bubble', after2.animating===0, `${after2.animating} bubbles marked fresh`);
check('and the thread still has not moved', Math.abs(after2.scrollTop-before2.scrollTop)<6 && after2.bottomGap>100, `${before2.scrollTop} -> ${after2.scrollTop}`);

console.log('\n===== 3. deselecting keeps your place =====');
const before3=await probe(A);
await A.mouse.click(box2.x+box2.width/2, box2.y+box2.height/2);
await A.waitForTimeout(600);
const after3=await probe(A);
console.log('  ' + JSON.stringify(after3));
check('the message is deselected', after3.selected===1, `${after3.selected} selected`);
check('the thread still has not moved', Math.abs(after3.scrollTop-before3.scrollTop)<6, `${before3.scrollTop} -> ${after3.scrollTop}`);

console.log('\n===== 4. leaving selection mode keeps your place =====');
const before4=await probe(A);
await A.click('#chatSelectionCancelBtn').catch(()=>{});
await A.waitForTimeout(700);
const after4=await probe(A);
console.log('  ' + JSON.stringify(after4));
check('selection mode is off', !after4.selecting, JSON.stringify({sel:after4.selecting}));
check('the thread still has not moved', Math.abs(after4.scrollTop-before4.scrollTop)<6, `${before4.scrollTop} -> ${after4.scrollTop}`);

console.log('\n===== 5. someone else writing while you read older messages =====');
const before5=await probe(A);
await B.evaluate((f)=>{const card=[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(c=>c.outerHTML.includes(f.slice(0,16))); card?.click();}, fpOf(idA));
await B.waitForTimeout(2000);
await B.fill('#chatComposer','پیام تازه از بتا');
await B.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
await A.waitForTimeout(3500);
const after5=await probe(A);
console.log('  ' + JSON.stringify(after5));
check('the new message arrives', after5.bubbles>before5.bubbles, `${before5.bubbles} -> ${after5.bubbles}`);
check('but it does not yank you down to it', after5.bottomGap>100, `bottom gap ${after5.bottomGap}px`);
check('you are still looking at the same message', after5.firstVisible===before5.firstVisible, `${before5.firstVisible} -> ${after5.firstVisible}`);

console.log('\n===== 6. but at the bottom, new messages still follow =====');
await stage(A,'bottom');
await A.waitForTimeout(300);
await B.fill('#chatComposer','پیام دوم از بتا');
await B.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
await A.waitForTimeout(3500);
const after6=await probe(A);
console.log('  ' + JSON.stringify(after6));
check('reading at the bottom still auto-follows the newest message', after6.bottomGap<40, `bottom gap ${after6.bottomGap}px`);

console.log('\n===== 7. your own message always pulls you down =====');
await stage(A,'top');
await A.waitForTimeout(300);
await A.fill('#chatComposer','پاسخ من');
await A.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
await A.waitForTimeout(2000);
const after7=await probe(A);
console.log('  ' + JSON.stringify(after7));
check('sending scrolls to your own new message', after7.bottomGap<40, `bottom gap ${after7.bottomGap}px`);

console.log('\n===== 8. switching conversations opens at the newest message =====');
await stage(A,'top');
await A.waitForTimeout(300);
await openPeer(A,fpC);
await A.waitForTimeout(1500);
await openPeer(A,fpB);
await A.waitForTimeout(1800);
const after8=await probe(A);
console.log('  ' + JSON.stringify(after8));
check('coming back to a conversation lands on the newest message', after8.bottomGap<40, `bottom gap ${after8.bottomGap}px`);

console.log('\n===== 9. no errors along the way =====');
const errs=await A.evaluate(()=>window.__err.slice(0,5));
console.log('  ' + JSON.stringify(errs));
check('no page errors', errs.length===0, JSON.stringify(errs));

const bad=results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
bad.forEach(r=>console.log('  FAIL ' + r.n + (r.d?'  — '+r.d:'')));
await browser.close();
