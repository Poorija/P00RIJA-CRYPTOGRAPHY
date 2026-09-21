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
await A.evaluate(()=>document.getElementById('chatVideoCallBtn')?.click());
await B.waitForTimeout(5000);
await B.evaluate(()=>document.getElementById('chatModalAcceptBtn')?.click());
await B.waitForTimeout(6000);
await A.waitForTimeout(4000);

const geo = () => A.evaluate(()=>{
  const win=document.querySelector('#chatFloatingCall .chat-floating-call-window');
  const stage=win.querySelector('.chat-floating-call-stage');
  const sb=stage.getBoundingClientRect();
  const box=(sel)=>{const e=win.querySelector(sel); const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return { w:Math.round(r.width), h:Math.round(r.height), x:Math.round(r.left-sb.left), y:Math.round(r.top-sb.top),
      br:cs.borderRadius, disp:cs.display,
      coversStage: Math.abs(r.width-sb.width)<2 && Math.abs(r.height-sb.height)<2,
      fit: getComputedStyle(e.querySelector('video')||e).objectFit };};
  const ov=document.getElementById('chatFloatingCall').getBoundingClientRect();
  return { primary: win.dataset.callPrimary, stage:{w:Math.round(sb.width),h:Math.round(sb.height)},
    remote: box('.chat-remote-stage'), local: box('.chat-local-stage'),
    overlayTop: Math.round(ov.top), vh: innerHeight, vw: innerWidth,
    overlayCoversViewport: Math.round(ov.top)===0 && Math.round(ov.width)===innerWidth };
});

console.log('\n===== 1. full-bleed geometry (primary = remote) =====');
const g1 = await geo();
console.log('  ' + JSON.stringify(g1));
check('remote video fills the whole stage', g1.remote.coversStage, JSON.stringify(g1.remote));
check('it crops instead of letterboxing', g1.remote.fit === 'cover', g1.remote.fit);
check('self-view is a small rounded tile', g1.local.w < g1.stage.w/3 && parseFloat(g1.local.br) > 10, JSON.stringify(g1.local));
check('neither box is a sliver', g1.remote.w > 200 && g1.remote.h > 200 && g1.local.w > 80 && g1.local.h > 80, JSON.stringify([g1.remote.w,g1.remote.h,g1.local.w,g1.local.h]));
check('a video call covers the whole viewport', g1.overlayCoversViewport, `top ${g1.overlayTop} / ${g1.vh}x${g1.vw}`);

console.log('\n===== 2. swapping the main view =====');
await A.evaluate(()=>document.getElementById('chatCallMoreBtn')?.click());
await A.waitForTimeout(500);
await A.evaluate(()=>document.getElementById('chatSwapVideoLayoutBtn')?.click());
await A.waitForTimeout(1200);
const g2 = await geo();
console.log('  ' + JSON.stringify(g2));
check('the attribute flipped to local', g2.primary === 'local', g2.primary);
check('now the LOCAL video fills the stage', g2.local.coversStage, JSON.stringify(g2.local));
check('and the remote becomes the tile', !g2.remote.coversStage && g2.remote.w < g2.stage.w/3, JSON.stringify(g2.remote));
check('nothing collapsed into a sliver after the swap', g2.local.w > 200 && g2.local.h > 200 && g2.remote.w > 80 && g2.remote.h > 80, JSON.stringify([g2.local.w,g2.local.h,g2.remote.w,g2.remote.h]));
await A.evaluate(()=>document.getElementById('chatSwapVideoLayoutBtn')?.click());
await A.waitForTimeout(1000);
const g3 = await geo();
check('swapping back restores the original layout', g3.primary === 'remote' && g3.remote.coversStage, JSON.stringify([g3.primary,g3.remote.coversStage]));

console.log('\n===== 3. the mirror button =====');
const mirror = await A.evaluate(async () => {
  const vid = document.querySelector('#chatFloatingCall .chat-local-stage video');
  const before = getComputedStyle(vid).transform;
  document.getElementById('chatMirrorVideoBtn').click();
  await new Promise(r=>setTimeout(r,300));
  const after = getComputedStyle(vid).transform;
  document.getElementById('chatMirrorVideoBtn').click();
  await new Promise(r=>setTimeout(r,300));
  const back = getComputedStyle(vid).transform;
  return { before, after, back, offClass: document.querySelector('#chatFloatingCall .chat-local-stage').className.includes('mirror-off') };
});
console.log('  ' + JSON.stringify(mirror));
check('mirroring is on by default (scaleX(-1))', /matrix\(-1/.test(mirror.before), mirror.before);
check('the button actually changes the transform', mirror.before !== mirror.after, `${mirror.before} -> ${mirror.after}`);
check('pressing it again restores the mirror', mirror.back === mirror.before, mirror.back);

console.log('\n===== 4. every control does something and throws nothing =====');
const controls = ['chatMuteToggleBtn','chatVideoToggleBtn','chatSpeakerToggleBtn','chatFlipCameraBtn',
  'chatScreenShareBtn','chatCallScreenshotBtn','chatMirrorVideoBtn','chatSwapVideoLayoutBtn',
  'chatHoldToggleBtn','chatCallPiPBtn','chatCallFullscreenBtn','chatCallSettingsBtn'];
for (const id of controls) {
  const out = await A.evaluate(async (btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return { missing: true };
    const errsBefore = (window.__err||[]).length;
    const snap = () => JSON.stringify({
      cls: btn.className, muted: !!window.__st?.callMuted,
      dom: document.querySelector('#chatFloatingCall .chat-floating-call-window')?.dataset.callPrimary,
      settings: document.getElementById('chatCallSettingsPanel')?.classList.contains('hidden'),
    });
    const before = snap();
    btn.click();
    await new Promise(r=>setTimeout(r,700));
    return { missing:false, disabled: btn.disabled, changed: snap() !== before,
      newErrors: (window.__err||[]).length - errsBefore };
  }, id);
  check(`${id}`, !out.missing && out.newErrors === 0, JSON.stringify(out));
}
// leave the call in a sane state
await A.evaluate(()=>{ const p=document.getElementById('chatCallSettingsPanel'); p?.classList.add('hidden'); });
await A.waitForTimeout(500);
await A.evaluate(()=>{ const sh=document.getElementById('chatFloatingCall'); sh.classList.remove('chrome-hidden');
  sh.dispatchEvent(new PointerEvent('pointermove',{bubbles:true})); });
await A.waitForTimeout(400);
await A.screenshot({path:`${SHOTS}/v98-video.png`});

for (const [tag,p] of [['A',A],['B',B]]) {
  const errs=await p.evaluate(()=>(window.__err||[]).filter(x=>!/SSL|Failed to load resource|Permission|NotAllowed|getDisplayMedia|not allowed/i.test(x)));
  check(`${tag}: no uncaught errors`, errs.length===0, JSON.stringify(errs.slice(0,3)));
}
const failing=results.filter(r=>!r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach(f=>console.log(`  FAIL ${f.n} — ${f.d}`));
await browser.close();
process.exit(failing.length?1:0);
