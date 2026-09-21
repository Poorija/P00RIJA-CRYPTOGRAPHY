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
async function app(tag,w=1440,h=900){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:w,height:h},permissions:['microphone','camera'],deviceScaleFactor:2});
  await ctx.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){} window.__clip=[];window.__err=[];
    window.addEventListener('error',e=>window.__err.push('ERR '+e.message));});
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
  await page.evaluate(()=>{const w=navigator.clipboard.writeText.bind(navigator.clipboard);
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

console.log('\n===== VIDEO CALL =====');
await A.evaluate(()=>document.getElementById('chatVideoCallBtn')?.click());
await B.waitForTimeout(5000);
await B.screenshot({path:`${SHOTS}/v97-incoming.png`});
await B.evaluate(()=>document.getElementById('chatModalAcceptBtn')?.click());
await B.waitForTimeout(6000);
await A.waitForTimeout(4000);
const v = await A.evaluate(()=>{
  const shell=document.getElementById('chatFloatingCall');
  const tile=shell.querySelector('.chat-local-stage');
  const cs=getComputedStyle(tile);
  const btns=[...shell.querySelectorAll('.chat-call-control-row .chat-call-control')].filter(b=>getComputedStyle(b).display!=='none');
  return { mode: shell.querySelector('.chat-floating-call-window')?.dataset.callMode,
    selfViewShown: cs.display!=='none', selfRadius: cs.borderRadius, selfW: Math.round(tile.getBoundingClientRect().width),
    gesturesBound: tile.dataset.gesturesBound === '1',
    primaryIds: btns.map(b=>b.id),
    heroHidden: shell.querySelector('.chat-call-hero')?.classList.contains('hidden'),
    remoteVideo: shell.querySelector('.chat-floating-call-window')?.dataset.remoteVideo };
});
console.log('  ' + JSON.stringify(v));
check('video mode detected', v.mode === 'video', v.mode);
check('self-view tile is a rounded PiP', v.selfViewShown && parseFloat(v.selfRadius) > 10, JSON.stringify([v.selfViewShown, v.selfRadius, v.selfW]));
check('drag/tap gestures are bound to it', v.gesturesBound === true);
check('video call adds the camera controls', v.primaryIds.includes('chatVideoToggleBtn'), JSON.stringify(v.primaryIds));
await A.evaluate(()=>{ const sh=document.getElementById('chatFloatingCall');
  sh.classList.remove('chrome-hidden'); sh.dispatchEvent(new PointerEvent('pointermove',{bubbles:true})); });
await A.waitForTimeout(400);
await A.screenshot({path:`${SHOTS}/v97-video.png`});
await A.evaluate(()=>document.getElementById('chatCallMoreBtn')?.click());
await A.waitForTimeout(600);
await A.screenshot({path:`${SHOTS}/v97-sheet.png`});
await A.evaluate(()=>document.getElementById('chatCallMoreBtn')?.click());
await A.waitForTimeout(400);

console.log('\n===== dragging the self-view snaps to a corner =====');
const drag = await A.evaluate(async () => {
  const tile=document.querySelector('#chatFloatingCall .chat-local-stage');
  const stage=document.querySelector('#chatFloatingCall .chat-floating-call-stage');
  const sb=stage.getBoundingClientRect(); const tb=tile.getBoundingClientRect();
  const from={x:tb.left+tb.width/2, y:tb.top+tb.height/2};
  const fire=(type,x,y)=>tile.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:1,button:0}));
  fire('pointerdown',from.x,from.y);
  fire('pointermove',sb.left+60,sb.bottom-60);
  fire('pointermove',sb.left+50,sb.bottom-50);
  fire('pointerup',sb.left+50,sb.bottom-50);
  await new Promise(r=>setTimeout(r,400));
  const after=tile.getBoundingClientRect();
  return { movedToLeft: after.left - sb.left < 60, movedToBottom: sb.bottom - after.bottom < 60,
    x: Math.round(after.left-sb.left), y: Math.round(sb.bottom-after.bottom) };
});
console.log('  ' + JSON.stringify(drag));
check('the tile snaps to the corner it was dragged to', drag.movedToLeft && drag.movedToBottom, JSON.stringify(drag));

console.log('\n===== chrome auto-hides during a video call =====');
const hid = await A.evaluate(async () => {
  const shell=document.getElementById('chatFloatingCall');
  const probe = { sheet: document.getElementById('chatCallMoreSheet')?.className,
    settings: document.getElementById('chatCallSettingsPanel')?.className,
    mode: shell.querySelector('.chat-floating-call-window')?.dataset.callMode };
  shell.classList.remove('chrome-hidden');
  shell.dispatchEvent(new PointerEvent("pointermove",{bubbles:true}));
  /* The idle window is 5s and a 700ms poller decides, so allow for both. */
  await new Promise(r=>setTimeout(r,6400));
  const hidden = shell.classList.contains('chrome-hidden');
  shell.dispatchEvent(new PointerEvent('pointermove',{bubbles:true}));
  await new Promise(r=>setTimeout(r,200));
  return { hidden, backAfterMove: !shell.classList.contains('chrome-hidden'), probe };
});
console.log('  ' + JSON.stringify(hid));
check('controls fade after ~5s of no input', hid.hidden === true);
check('any input brings them straight back', hid.backAfterMove === true);
await A.screenshot({path:`${SHOTS}/v97-video-clean.png`});

console.log('\n===== the sheet keeps the chrome alive =====');
const sticky = await A.evaluate(async () => {
  document.getElementById('chatCallMoreBtn').click();
  /* The idle window is 5s and a 700ms poller decides, so allow for both. */
  await new Promise(r=>setTimeout(r,6400));
  return { sheetStillOpen: !document.getElementById('chatCallMoreSheet').classList.contains('hidden'),
    chromeVisible: !document.getElementById('chatFloatingCall').classList.contains('chrome-hidden') };
});
console.log('  ' + JSON.stringify(sticky));
check('an open sheet blocks the auto-hide', sticky.sheetStillOpen && sticky.chromeVisible, JSON.stringify(sticky));

await A.evaluate(()=>document.getElementById('chatEndCallControlBtn')?.click());
await A.waitForTimeout(2000);
for (const [tag,p] of [['A',A],['B',B]]) {
  const errs=await p.evaluate(()=>(window.__err||[]).filter(x=>!/SSL|Failed to load resource/.test(x)));
  check(`${tag}: no uncaught errors`, errs.length===0, JSON.stringify(errs.slice(0,3)));
}
const failing=results.filter(r=>!r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach(f=>console.log(`  FAIL ${f.n} — ${f.d}`));
await browser.close();
process.exit(failing.length?1:0);
