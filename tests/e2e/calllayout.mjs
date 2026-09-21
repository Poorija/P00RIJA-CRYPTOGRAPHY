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

/* portrait:true makes getUserMedia hand back a 720x1280 stream, which is what a
   phone camera actually sends and what the old layout could not cope with. */
async function app(tag, viewport, { portrait = false, pwa = false } = {}){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport,permissions:['microphone','camera']});
  await ctx.addInitScript(({portrait, pwa})=>{
    try{localStorage.setItem('poorija_lang','fa');}catch(e){}
    window.__clip=[];window.__err=[];
    window.addEventListener('error',e=>window.__err.push('ERR '+e.message));
    if (portrait) {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c)=>{
        if (c && c.video && typeof c.video === 'object') {
          c = {...c, video: {...c.video, width:{ideal:720}, height:{ideal:1280}}};
        }
        return real(c);
      };
    }
  }, {portrait, pwa});
  const page=await ctx.newPage();
  page.on('dialog',d=>d.accept());
  page.on('pageerror',e=>console.log(`   ${tag}!! ${e.message.slice(0,140)}`));
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
  await page.evaluate((name)=>{
    const w=navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText=(t)=>{window.__clip.push(t);return w(t).catch(()=>{});};
    const n=document.getElementById('chatDisplayName'); if(n){n.value=name;n.dispatchEvent(new Event('input',{bubbles:true}));}
    document.getElementById('chatSaveProfileBtn')?.click();
    document.getElementById('mainApp')?.classList.remove('hidden','opacity-0');
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
const openPeer=(p,fp)=>p.evaluate((f)=>{[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(c=>c.outerHTML.includes(f.slice(0,16)))?.click();},fp);

async function acceptWhenOffered(page, tries=24){
  for (let i=0;i<tries;i++){
    const done = await page.evaluate(()=>{
      const visible=(el)=>el && !el.classList.contains('hidden') && el.offsetParent !== null;
      const a=document.getElementById('chatAcceptCallBtn');
      const b=document.getElementById('chatModalAcceptBtn');
      if (visible(a)) { a.click(); return 'sheet'; }
      if (visible(b)) { b.click(); return 'modal'; }
      return '';
    });
    if (done) return done;
    await page.waitForTimeout(500);
  }
  return '';
}

const probe=(p)=>p.evaluate(()=>{
  const win=document.querySelector('#chatFloatingCall .chat-floating-call-window');
  const box=(el)=>{ if(!el) return null; const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),display:cs.display};};
  const vid=(el)=>{ if(!el) return null; const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
    return {vw:el.videoWidth,vh:el.videoHeight,fit:cs.objectFit,w:Math.round(r.width),h:Math.round(r.height)};};
  const remote=document.querySelector('#chatFloatingCall .chat-remote-stage');
  const local=document.querySelector('#chatFloatingCall .chat-local-stage');
  const pill=document.querySelector('#chatFloatingCall .chat-call-control-row');
  const pillCs=pill?getComputedStyle(pill):null;
  const btns=[...document.querySelectorAll('#chatFloatingCall .chat-call-control-row .chat-call-control')].filter(b=>b.offsetParent!==null);
  const pr=pill?pill.getBoundingClientRect():null;
  const first=btns[0]?.getBoundingClientRect();
  return {
    primary: win?.dataset.callPrimary, mode: win?.dataset.callMode,
    remoteVideoAttr: win?.dataset.remoteVideo, localVideoAttr: win?.dataset.localVideo,
    viewport: {w:innerWidth,h:innerHeight},
    stage: box(document.querySelector('#chatFloatingCall .chat-floating-call-stage')),
    remoteStage: box(remote), localStage: box(local),
    remoteVideo: vid(document.getElementById('chatFloatingRemoteVideo')),
    localVideo: vid(document.getElementById('chatFloatingLocalVideo')),
    backdrops: document.querySelectorAll('#chatFloatingCall .chat-stage-backdrop').length,
    fitAttrs: {remote: remote?.dataset.fit||'', local: local?.dataset.fit||''},
    pill: pr?{x:Math.round(pr.x),y:Math.round(pr.y),w:Math.round(pr.width),h:Math.round(pr.height)}:null,
    pillPad: pillCs?{top:pillCs.paddingTop,bottom:pillCs.paddingBottom}:null,
    gapTop: (pr&&first)?Math.round(first.top-pr.top):null,
    gapBottom: (pr&&first)?Math.round(pr.bottom-first.bottom):null,
    pillOffscreen: pr? Math.round(pr.bottom-innerHeight):null,
    chromeHidden: document.getElementById('chatFloatingCall')?.classList.contains('chrome-hidden'),
    buttons: btns.length,
  };
});

console.log('\n===== staging a phone <-> desktop video call =====');
const A=await app('ALPHA',{width:393,height:873},{portrait:true});   // phone in portrait, phone-shaped camera
const B=await app('BETA',{width:1512,height:945});                            // desktop, 16:9 webcam
const idA=await id(A), idB=await id(B);
await imp(A,idB); await imp(B,idA);
await A.waitForTimeout(4000);
const fpB=JSON.parse(atob(idB.replace('poorija-chat-v1:',''))).fingerprint;
const fpA=JSON.parse(atob(idA.replace('poorija-chat-v1:',''))).fingerprint;
await openPeer(A,fpB); await openPeer(B,fpA);
await A.waitForTimeout(1800);
/* Calling moved behind the thread menu; only "end call" stayed in the open. */
await A.evaluate(()=>document.getElementById('chatThreadMenuBtn')?.click());
await A.waitForTimeout(400);
await A.click('#chatVideoCallBtn',{timeout:15000}).catch(e=>console.log('  call:',e.message.slice(0,60)));
console.log('  B accepted via: ' + await acceptWhenOffered(B));
await A.waitForTimeout(7000);

const a=await probe(A), b=await probe(B);
console.log('  PHONE   ' + JSON.stringify(a));
console.log('  DESKTOP ' + JSON.stringify(b));
check('the call is up on both sides', a.mode==='video' && b.mode==='video' && a.remoteVideoAttr==='on' && b.remoteVideoAttr==='on', `${a.remoteVideoAttr}/${b.remoteVideoAttr}`);
check('the phone receives the desktop 16:9 stream', a.remoteVideo?.vw > a.remoteVideo?.vh, JSON.stringify(a.remoteVideo));
check('the desktop receives the phone portrait stream', b.remoteVideo?.vh > b.remoteVideo?.vw, JSON.stringify(b.remoteVideo));

console.log('\n===== 1. a 16:9 desktop stream on a tall phone is not cropped to a nose =====');
const shownRatio = a.remoteVideo ? (a.remoteVideo.vw/a.remoteVideo.vh) : 0;
const boxRatio = a.remoteStage ? (a.remoteStage.w/a.remoteStage.h) : 0;
check('the phone letterboxes rather than fills when the shapes disagree', a.fitAttrs.remote==='contain', `fit=${a.fitAttrs.remote} video ${shownRatio.toFixed(2)} vs box ${boxRatio.toFixed(2)}`);
/* The blurred filler is opt-in: the default is a flat dark surround, because
   a blown-up moving copy in the corner of the eye is worse for some people
   than a letterbox. Turn it on, then check it actually appears - asserting on
   the default would only prove the default. */
const withBlur = await A.evaluate(async () => {
  const select = document.getElementById('chatCallBackdropSelect');
  if (!select) return { off: 'no setting' };
  select.value = 'blur';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  return {
    setting: window.PoorijaChat?.callBackdrop?.() || select.value,
    backdrops: document.querySelectorAll('#chatFloatingCall .chat-stage-backdrop').length,
  };
});
console.log('  ' + JSON.stringify(withBlur));
check('black bars by default, so nothing moves in the corner of the eye', a.backdrops===0, `${a.backdrops} backdrop layers`);
check('and a blurred backdrop once it is asked for', withBlur.backdrops>=1, JSON.stringify(withBlur));

console.log('\n===== 2. the self-view tile keeps its own shape =====');
const tileAspect = a.localStage ? (a.localStage.w/a.localStage.h) : 0;
const camAspect = a.localVideo ? (a.localVideo.vw/a.localVideo.vh) : 0;
check('the tile matches the camera aspect', Math.abs(tileAspect-camAspect) < 0.12, `tile ${tileAspect.toFixed(2)} vs camera ${camAspect.toFixed(2)}`);
check('the tile is a tile, not a sliver or a panel', a.localStage.w>70 && a.localStage.w < a.stage.w*0.45 && a.localStage.h < a.stage.h*0.4, JSON.stringify(a.localStage));
const bTile = b.localStage ? (b.localStage.w/b.localStage.h) : 0;
const bCam = b.localVideo ? (b.localVideo.vw/b.localVideo.vh) : 0;
check('the desktop self-view is landscape, matching its webcam', Math.abs(bTile-bCam) < 0.12, `tile ${bTile.toFixed(2)} vs camera ${bCam.toFixed(2)}`);

console.log('\n===== 3. swapping exchanges the two views =====');
const before = {remote:a.remoteStage, local:a.localStage};
await A.evaluate(()=>{document.getElementById('chatCallMoreBtn')?.click();});
await A.waitForTimeout(400);
await A.evaluate(()=>{document.getElementById('chatSwapVideoLayoutBtn')?.click();});
await A.waitForTimeout(1500);
const a2=await probe(A);
console.log('  ' + JSON.stringify({primary:a2.primary,remote:a2.remoteStage,local:a2.localStage,fit:a2.fitAttrs}));
check('the local view takes the full stage', a2.localStage.w >= a2.stage.w-4 && a2.localStage.h >= a2.stage.h-4, JSON.stringify(a2.localStage));
check('the remote view becomes the tile, still visible', a2.remoteStage.display!=='none' && a2.remoteStage.w>70 && a2.remoteStage.w < a2.stage.w*0.45, JSON.stringify(a2.remoteStage));
check('the tile now carries the remote 16:9 shape', Math.abs((a2.remoteStage.w/a2.remoteStage.h)-shownRatio) < 0.12, `${(a2.remoteStage.w/a2.remoteStage.h).toFixed(2)} vs ${shownRatio.toFixed(2)}`);
check('nothing overlaps the full-bleed view except the tile', a2.remoteStage.y >= 0 && a2.remoteStage.y < a2.stage.h*0.5, JSON.stringify({y:a2.remoteStage.y}));
await A.evaluate(()=>{document.getElementById('chatCallMoreBtn')?.click();});
await A.waitForTimeout(300);
await A.evaluate(()=>{document.getElementById('chatSwapVideoLayoutBtn')?.click();});
await A.waitForTimeout(1200);
const a3=await probe(A);
check('swapping back restores the first arrangement', a3.primary==='remote' && a3.remoteStage.w>=a3.stage.w-4, JSON.stringify({p:a3.primary,r:a3.remoteStage}));

console.log('\n===== 4. the control pill on an installed iPhone =====');
/* html.pwa-standalone plus a home-indicator inset is what an installed iPhone
   looks like to the stylesheet, and it is the only state in which the pill's
   own padding was being stretched. */
await A.evaluate(()=>document.documentElement.classList.add('pwa-standalone','mobile-browser-context'));
await A.addStyleTag({content:':root{--pwa-safe-bottom:34px !important;--pwa-safe-top:47px !important;}'});
await A.waitForTimeout(700);
const a4=await probe(A);
console.log('  ' + JSON.stringify({pad:a4.pillPad,gapTop:a4.gapTop,gapBottom:a4.gapBottom,off:a4.pillOffscreen,btns:a4.buttons}));
check('the buttons sit centred in the pill', Math.abs(a4.gapTop-a4.gapBottom) <= 2, `top ${a4.gapTop}px vs bottom ${a4.gapBottom}px`);
check('the pill stays clear of the home indicator', a4.pillOffscreen <= -30, `pill bottom is ${-a4.pillOffscreen}px above the screen edge`);
check('every control is reachable', a4.buttons>=6, `${a4.buttons} buttons`);
await A.evaluate(()=>document.documentElement.classList.remove('pwa-standalone','mobile-browser-context'));
await A.waitForTimeout(500);

console.log('\n===== 5. the controls get out of the way, and a tap brings them back =====');
/* Headless Chromium reports a fine pointer, which is the mouse path. A phone
   reports coarse, and that is the path under test here. */
await A.evaluate(()=>{
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q)=> /pointer:\s*fine/.test(q)
    ? {matches:false, media:q, onchange:null, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){return false;}}
    : real(q);
});
const hiddenBy = await (async ()=>{
  for (let i=0;i<24;i++){
    if (await A.evaluate(()=>document.getElementById('chatFloatingCall').classList.contains('chrome-hidden'))) return i*400;
    await A.waitForTimeout(400);
  }
  return -1;
})();
check('the controls fade out on their own while you watch', hiddenBy >= 0, `after ~${hiddenBy}ms idle`);
const stageBox = await A.evaluate(()=>{const r=document.querySelector('#chatFloatingCall .chat-floating-call-stage').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};});
await A.mouse.click(stageBox.x+stageBox.w/2, stageBox.y+stageBox.h*0.45);
await A.waitForTimeout(700);
const afterTap=await probe(A);
check('one tap brings them back', !afterTap.chromeHidden, `chromeHidden=${afterTap.chromeHidden}`);
await A.waitForTimeout(1800);
const stillUp=await probe(A);
check('and they stay up, not for a single frame', !stillUp.chromeHidden, `still up 2.5s later: ${!stillUp.chromeHidden}`);
await A.mouse.click(stageBox.x+stageBox.w/2, stageBox.y+stageBox.h*0.45);
await A.waitForTimeout(700);
const afterSecond=await probe(A);
check('a second tap puts them away again', afterSecond.chromeHidden, `chromeHidden=${afterSecond.chromeHidden}`);

console.log('\n===== 6. the six-emoji key, on both ends =====');
const keyOf=(p)=>p.evaluate(()=>{
  const strip=document.getElementById('chatCallVerifyStrip');
  return {
    visible: Boolean(strip) && !strip.classList.contains('hidden'),
    emoji: (strip?.querySelector('.chat-call-verify-emoji')?.textContent||'').trim(),
    verified: Boolean(strip?.classList.contains('is-verified')),
    cardOpen: !document.getElementById('chatCallVerifyCard')?.classList.contains('hidden'),
  };
});
await A.evaluate(()=>{const s=document.getElementById('chatFloatingCall'); s.classList.remove('chrome-hidden');});
const ka=await keyOf(A), kb=await keyOf(B);
console.log('  A ' + JSON.stringify(ka));
console.log('  B ' + JSON.stringify(kb));
check('the key is shown during the call', ka.visible && kb.visible, JSON.stringify({a:ka.visible,b:kb.visible}));
const overlap = await A.evaluate(()=>{
  const s=document.getElementById('chatCallVerifyStrip').getBoundingClientRect();
  const win=document.querySelector('#chatFloatingCall .chat-floating-call-window');
  const tileSel = win.dataset.callPrimary==='local' ? '.chat-remote-stage' : '.chat-local-stage';
  const tl=document.querySelector('#chatFloatingCall '+tileSel).getBoundingClientRect();
  const hit = !(s.right<=tl.left || s.left>=tl.right || s.bottom<=tl.top || s.top>=tl.bottom);
  return {hit, strip:{l:Math.round(s.left),r:Math.round(s.right),t:Math.round(s.top),b:Math.round(s.bottom)},
          tile:{l:Math.round(tl.left),r:Math.round(tl.right),t:Math.round(tl.top),b:Math.round(tl.bottom)}};
});
check('the key does not sit on top of the self-view', !overlap.hit, JSON.stringify(overlap));
check('it is six symbols', ka.emoji.split(/\s+/).filter(Boolean).length===6, `${ka.emoji.split(/\s+/).filter(Boolean).length}: ${ka.emoji}`);
check('and both ends derive the same six', ka.emoji===kb.emoji && ka.emoji.length>0, `${ka.emoji}  vs  ${kb.emoji}`);
await A.evaluate(()=>document.getElementById('chatCallVerifyStrip').click());
await A.waitForTimeout(600);
const opened=await A.evaluate(()=>{
  const card=document.getElementById('chatCallVerifyCard');
  return {open: !card.classList.contains('hidden'),
    tiles: card.querySelectorAll('.chat-call-verify-grid span').length,
    names: [...card.querySelectorAll('.chat-call-verify-grid i')].map(n=>n.textContent).slice(0,3),
    confirm: Boolean(card.querySelector('[data-verify-toggle]'))};
});
console.log('  ' + JSON.stringify(opened));
check('tapping it explains what to do', opened.open && opened.tiles===6 && opened.confirm, JSON.stringify(opened));
check('each symbol is named, so it can be read aloud', opened.names.every(n=>n && n.length>1), JSON.stringify(opened.names));
await A.evaluate(()=>document.querySelector('#chatCallVerifyCard [data-verify-toggle]')?.click());
await A.waitForTimeout(800);
const marked=await keyOf(A);
check('marking it verified sticks', marked.verified, JSON.stringify(marked));

console.log('\n===== 7. the call header fits on one row =====');
const header = await A.evaluate(()=>{
  const h=document.querySelector('#chatFloatingCall .chat-floating-call-header');
  const hr=h.getBoundingClientRect();
  const kids=[...h.children].filter(c=>getComputedStyle(c).display!=='none').map(c=>{const r=c.getBoundingClientRect();
    return {id:c.id||c.className.toString().slice(0,20), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)};});
  /* Same row means same vertical centre; the boxes differ in height. */
  const rows=new Set(kids.map(k=>Math.round((k.y+k.h/2)/16)));
  const win=document.querySelector('#chatFloatingCall .chat-floating-call-window');
  const tileSel = win.dataset.callPrimary==='local' ? '.chat-remote-stage' : '.chat-local-stage';
  const tl=document.querySelector('#chatFloatingCall '+tileSel).getBoundingClientRect();
  const clash=kids.filter(k=>!(k.x+k.w<=tl.left || k.x>=tl.right || k.y+k.h<=tl.top || k.y>=tl.bottom)).map(k=>k.id);
  return {h:Math.round(hr.height), kids, rows:rows.size, clash};
});
console.log('  ' + JSON.stringify(header));
check('every header control sits on the same row', header.rows===1, `${header.rows} rows: ` + header.kids.map(k=>`${k.id}@${k.y}`).join(', '));
check('nothing from the header lands on the self-view', header.clash.length===0, JSON.stringify(header.clash));

await A.evaluate(()=>{document.getElementById('chatCallVerifyCard')?.classList.add('hidden');
  document.getElementById('chatFloatingCall')?.classList.remove('chrome-hidden');});
await A.waitForTimeout(600);
await A.screenshot({path:`${SHOTS}/call-phone.png`});
await A.evaluate(()=>document.getElementById('chatCallVerifyStrip').click());
await A.waitForTimeout(600);
await A.screenshot({path:`${SHOTS}/call-phone-verify.png`});
await B.screenshot({path:`${SHOTS}/call-desktop.png`});
const errs=await A.evaluate(()=>window.__err.slice(0,4));
check('no page errors on the phone', errs.length===0, JSON.stringify(errs));
const bad=results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
bad.forEach(r=>console.log('  FAIL ' + r.n + (r.d?'  — '+r.d:'')));
await browser.close();
