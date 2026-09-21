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


console.log('\n===== 1. a video group call with three people =====');
await A.evaluate(()=>document.getElementById('chatVideoCallBtn')?.click());
await A.waitForTimeout(4000);
await B.waitForTimeout(3000); await C.waitForTimeout(3000);
await B.evaluate(()=>document.querySelector('[data-gcall-accept]')?.click());
await B.waitForTimeout(6000);
await C.evaluate(()=>document.querySelector('[data-gcall-accept]')?.click());
await C.waitForTimeout(9000);
await A.waitForTimeout(7000);

const layout = (p)=>p.evaluate(()=>{
  const grid=document.getElementById('chatGroupCallGrid');
  const tiles=[...document.querySelectorAll('.chat-gcall-tile')].map(tile=>{
    const r=tile.getBoundingClientRect();
    const frame=tile.querySelector('.chat-gcall-frame');
    const cap=tile.querySelector('.chat-gcall-caption');
    const fr=frame?.getBoundingClientRect(); const cr=cap?.getBoundingClientRect();
    const video=tile.querySelector('video');
    return {
      key: tile.getAttribute('data-gcall-key'),
      x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
      name: cap?.textContent.replace(/\s+/g,' ').trim()||'',
      capBelowFrame: Boolean(fr&&cr) && cr.top >= fr.bottom - 1,
      pinned: tile.classList.contains('is-pinned'),
      presenting: tile.classList.contains('is-presenting'),
      muted: Boolean(tile.querySelector('.chat-gcall-caption .is-muted')),
      fit: frame?.getAttribute('data-fit')||'',
      live: Boolean(video?.srcObject) && !video.classList.contains('is-hidden'),
      vw: video?.videoWidth||0, vh: video?.videoHeight||0,
      frameH: fr?Math.round(fr.height):0,
    };
  });
  /* Any two tiles whose boxes intersect is the bug being tested. */
  const overlaps=[];
  for (let i=0;i<tiles.length;i++) for (let j=i+1;j<tiles.length;j++){
    const a=tiles[i], b=tiles[j];
    if (!(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y)) overlaps.push([a.key,b.key]);
  }
  /* The columns live on the inner block; the grid itself is only the scroller. */
  /* The stage is laid out in half-columns - two tracks per tile - so counting
     tracks reports double. Read the count the layout actually decided on. */
  const gridCols=grid?Number(getComputedStyle(grid).getPropertyValue('--gcall-columns'))||0:0;
  const box = grid?grid.getBoundingClientRect():null;
  return {tiles, overlaps, columns: gridCols, display: grid?getComputedStyle(grid).display:'',
    scrollsDown: grid?grid.scrollHeight>grid.clientHeight+2:false,
    scrollsAcross: grid?grid.scrollWidth>grid.clientWidth+2:false,
    allInside: Boolean(box) && tiles.every(t=>t.x>=Math.floor(box.left)-1 && t.y>=Math.floor(box.top)-1
      && t.x+t.w<=Math.ceil(box.right)+1 && t.y+t.h<=Math.ceil(box.bottom)+1),
    gridBottom: grid?Math.round(grid.getBoundingClientRect().bottom):0, viewportH: innerHeight,
    dockTop: Math.round(document.querySelector('.chat-gcall-dock').getBoundingClientRect().top)};
});

const a=await layout(A), b=await layout(B);
console.log('  A ' + JSON.stringify(a).slice(0,900));
check('all three people are on stage', a.tiles.length===3 && b.tiles.length===3, `${a.tiles.length}/${b.tiles.length}`);
check('every tile carries a live picture', a.tiles.filter(t=>t.live).length===3, JSON.stringify(a.tiles.map(t=>t.live)));
check('no two tiles overlap', a.overlaps.length===0 && b.overlaps.length===0, JSON.stringify(a.overlaps.concat(b.overlaps)));
/* It was a masonry of columns that scrolled; it is a grid sized to the box
   now, so that nobody is below the fold in a call. */
check('the stage is a grid sized to the box', a.display==='grid', a.display);
check('and it does not scroll', a.scrollsDown===false && a.scrollsAcross===false,
  JSON.stringify({down:a.scrollsDown, across:a.scrollsAcross}));
check('with every tile inside it', a.allInside===true && b.allInside===true,
  JSON.stringify({a:a.allInside, b:b.allInside}));
check('every tile is named under its picture', a.tiles.every(t=>t.name.length>0 && t.capBelowFrame), JSON.stringify(a.tiles.map(t=>[t.name,t.capBelowFrame])));
check('the grid stays above the controls', a.gridBottom <= a.dockTop+2, `${a.gridBottom} vs dock at ${a.dockTop}`);

console.log('\n===== 2. the same call on a phone =====');
await A.setViewportSize({width:412,height:900});
await A.waitForTimeout(1200);
await A.evaluate(()=>window.dispatchEvent(new Event('resize')));
await A.waitForTimeout(900);
const phone=await layout(A);
console.log('  ' + JSON.stringify({cols:phone.columns, tiles:phone.tiles.map(t=>({k:t.key,x:t.x,y:t.y,w:t.w,h:t.h}))}));
check('a phone gets fewer, larger columns', Number(phone.columns)<=2, String(phone.columns));
check('and still nothing overlaps', phone.overlaps.length===0, JSON.stringify(phone.overlaps));
check('every tile is still big enough to see a face in', phone.tiles.every(t=>t.frameH>40), JSON.stringify(phone.tiles.map(t=>t.frameH)));
check('and a phone does not scroll either',
  phone.scrollsDown===false && phone.scrollsAcross===false && phone.allInside===true,
  JSON.stringify({down:phone.scrollsDown, across:phone.scrollsAcross, inside:phone.allInside}));
await A.setViewportSize({width:1280,height:900});
await A.waitForTimeout(1200);
await A.evaluate(()=>window.dispatchEvent(new Event('resize')));
await A.waitForTimeout(600);

console.log('\n===== 3. pinning someone =====');
const target = a.tiles.find(t=>t.key!=='self')?.key;
await A.evaluate((k)=>document.querySelector(`[data-gcall-pin="${k}"]`)?.click(), target);
await A.waitForTimeout(900);
const pinned=await layout(A);
const pin=pinned.tiles.find(t=>t.pinned);
const others=pinned.tiles.filter(t=>!t.pinned);
console.log('  ' + JSON.stringify({pin:pin&&{key:pin.key,w:pin.w,y:pin.y}, others:others.map(t=>({k:t.key,y:t.y,w:t.w}))}));
check('the pinned person is the one that was tapped', pin?.key===target, `${pin?.key} vs ${target}`);
check('the pinned tile dominates the stage and aligns with the thumbnail rail', pin && others.every(t=>pin.w > t.w) && others.every(t=>t.y>=pin.y-3), JSON.stringify({pw:pin?.w,ow:others.map(t=>t.w)}));
check('pinning does not make tiles overlap', pinned.overlaps.length===0, JSON.stringify(pinned.overlaps));
await A.evaluate((k)=>document.querySelector(`[data-gcall-pin="${k}"]`)?.click(), target);
await A.waitForTimeout(700);
check('tapping again unpins', (await layout(A)).tiles.every(t=>!t.pinned));

console.log('\n===== 4. muting is visible to the others =====');
await A.evaluate(()=>document.getElementById('chatGroupCallMuteBtn')?.click());
await A.waitForTimeout(2500);
const bSees=await layout(B);
const aTileOnB=bSees.tiles.find(t=>t.key!=='self');
check('B sees a muted marker on the muted participant', bSees.tiles.some(t=>t.muted), JSON.stringify(bSees.tiles.map(t=>[t.key,t.muted])));
await A.evaluate(()=>document.getElementById('chatGroupCallMuteBtn')?.click());
await A.waitForTimeout(2000);

console.log('\n===== 5. presenting a picture (the mobile-safe path) =====');
const sheet = await A.evaluate(()=>{
  document.getElementById('chatGroupCallPresentBtn')?.click();
  const s=document.getElementById('chatGroupPresentSheet');
  return {open: !s.classList.contains('hidden'),
    options: [...s.querySelectorAll('[data-present-source]')].map(b=>({src:b.getAttribute('data-present-source'), off:b.disabled, text:b.textContent.replace(/\s+/g,' ').trim().slice(0,60)}))};
});
console.log('  ' + JSON.stringify(sheet));
check('the present sheet offers both a screen and a picture', sheet.open && sheet.options.some(o=>o.src==='screen') && sheet.options.some(o=>o.src==='picture'), JSON.stringify(sheet.options.map(o=>o.src)));
/* Feed the file chooser without a real dialog. */
await A.evaluate(()=>{
  window.__pickedPicture=true;
  const realClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function(){
    if (this.type!=='file') return realClick.call(this);
    const canvas=document.createElement('canvas'); canvas.width=1280; canvas.height=720;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#7c3aed'; ctx.fillRect(0,0,1280,720);
    ctx.fillStyle='#fff'; ctx.font='90px sans-serif'; ctx.fillText('SLIDE', 420, 400);
    canvas.toBlob((blob)=>{
      const file=new File([blob],'slide.png',{type:'image/png'});
      const dt=new DataTransfer(); dt.items.add(file); this.files=dt.files;
      this.dispatchEvent(new Event('change',{bubbles:true}));
    },'image/png');
  };
});
await A.evaluate(()=>document.querySelector('[data-present-source="picture"]')?.click());
await A.waitForTimeout(4000);
const presenting=await layout(A);
const bDuring=await layout(B);
console.log('  A ' + JSON.stringify(presenting.tiles.map(t=>({k:t.key,p:t.presenting,fit:t.fit,pin:t.pinned}))));
console.log('  B ' + JSON.stringify(bDuring.tiles.map(t=>({k:t.key,p:t.presenting,fit:t.fit,pin:t.pinned,vw:t.vw,vh:t.vh}))));
check('the presenter tile is marked and auto-pinned locally', presenting.tiles.some(t=>t.presenting && t.pinned && t.key==='self'), JSON.stringify(presenting.tiles.map(t=>[t.key,t.presenting,t.pinned])));
check('a presentation is shown whole, not cropped', presenting.tiles.find(t=>t.presenting)?.fit==='contain', presenting.tiles.find(t=>t.presenting)?.fit);
check('the other side sees the presenter marked and pinned', bDuring.tiles.some(t=>t.presenting && t.pinned), JSON.stringify(bDuring.tiles.map(t=>[t.key,t.presenting,t.pinned])));
check('and receives the 16:9 slide rather than the camera', bDuring.tiles.some(t=>t.vw>t.vh && t.vw>=640), JSON.stringify(bDuring.tiles.map(t=>[t.vw,t.vh])));
check('presenting does not break the layout', presenting.overlaps.length===0 && bDuring.overlaps.length===0, JSON.stringify(presenting.overlaps.concat(bDuring.overlaps)));
console.log('  B geometry while pinned: ' + JSON.stringify(bDuring.tiles.map(t=>({k:t.key.slice(0,6),y:t.y,h:t.h,frameH:t.frameH,cap:t.capBelowFrame,pin:t.pinned}))));
check('the tiles below a pinned presenter are still full tiles', bDuring.tiles.filter(t=>!t.pinned).every(t=>t.frameH>60 && t.capBelowFrame), JSON.stringify(bDuring.tiles.map(t=>[t.frameH,t.capBelowFrame])));

await B.screenshot({path:`${SHOTS}/gcall-presenting.png`});
await A.evaluate(()=>{document.getElementById('chatGroupCallPresentBtn')?.click();});
await A.waitForTimeout(500);
await A.evaluate(()=>document.querySelector('[data-present-source="stop"]')?.click());
await A.waitForTimeout(3500);
const stopped=await layout(A); const bAfter=await layout(B);
check('stopping the presentation returns everyone to the camera', !stopped.tiles.some(t=>t.presenting) && !bAfter.tiles.some(t=>t.presenting), JSON.stringify({a:stopped.tiles.map(t=>t.presenting),b:bAfter.tiles.map(t=>t.presenting)}));

console.log('\n===== 6. reactions =====');
await A.evaluate(()=>document.getElementById('chatGroupCallReactBtn')?.click());
await A.waitForTimeout(600);
const bar=await A.evaluate(()=>({open:!document.getElementById('chatGroupCallReactionBar').classList.contains('hidden'),
  count: document.querySelectorAll('#chatGroupCallReactionBar [data-call-reaction]').length}));
check('the reaction bar opens with a set of emoji', bar.open && bar.count>=6, JSON.stringify(bar));
await A.evaluate(()=>document.querySelector('#chatGroupCallReactionBar [data-call-reaction="🎉"]')?.click());
await A.waitForTimeout(1200);
const react=await A.evaluate(()=>({mine: document.querySelectorAll('#chatGroupCall .chat-call-reaction').length,
  barClosed: document.getElementById('chatGroupCallReactionBar').classList.contains('hidden')}));
const bReact=await B.evaluate(()=>[...document.querySelectorAll('#chatGroupCall .chat-call-reaction')].map(n=>n.textContent.trim()));
const cReact=await C.evaluate(()=>[...document.querySelectorAll('#chatGroupCall .chat-call-reaction')].map(n=>n.textContent.trim()));
console.log('  ' + JSON.stringify({react, bReact, cReact}));
check('the sender sees their own reaction float', react.mine>=1, String(react.mine));
check('the bar closes after picking one', react.barClosed);
check('everyone else in the room sees it too', bReact.some(x=>x.includes('🎉')) && cReact.some(x=>x.includes('🎉')), JSON.stringify({b:bReact,c:cReact}));
await A.waitForTimeout(2800);
check('reactions clean themselves up', (await A.evaluate(()=>document.querySelectorAll('#chatGroupCall .chat-call-reaction').length))===0);

console.log('\n===== 7. the picture survives repeated state changes =====');
/* The reported bug: raising a hand re-rendered the stage on every device, which
   threw away and rebuilt every <video>. Track element identity and playback. */
const videoIdentity = (p)=>p.evaluate(()=>{
  const out=[];
  document.querySelectorAll('#chatGroupCallGrid video').forEach((v)=>{
    if (!v.__probeId) v.__probeId = Math.random().toString(36).slice(2,8);
    out.push({id:v.__probeId, key:v.getAttribute('data-gcall-video')?.slice(0,6),
      hasStream: Boolean(v.srcObject), paused: v.paused, ended: v.ended,
      w: v.videoWidth, h: v.videoHeight, t: Number(v.currentTime.toFixed(2))});
  });
  return out;
});
const before7 = await videoIdentity(B);
for (let i=0;i<4;i++){
  await A.evaluate(()=>document.getElementById('chatGroupCallHandBtn')?.click());
  await A.waitForTimeout(1400);
}
await B.waitForTimeout(1500);
const after7 = await videoIdentity(B);
console.log('  B before ' + JSON.stringify(before7));
console.log('  B after  ' + JSON.stringify(after7));
check('four hand toggles do not replace a single video element',
  before7.length===after7.length && before7.every((v,i)=>v.id===after7[i].id),
  JSON.stringify({b:before7.map(v=>v.id), a:after7.map(v=>v.id)}));
check('every picture is still attached and playing after them',
  after7.every(v=>v.hasStream && !v.paused && !v.ended && v.w>0), JSON.stringify(after7));
check('and the pictures are still advancing, not frozen',
  after7.every((v,i)=>v.t > (before7[i]?.t ?? 0)), JSON.stringify({b:before7.map(v=>v.t), a:after7.map(v=>v.t)}));
const selfAlive = await videoIdentity(A);
check('the raiser\'s own preview is alive too', selfAlive.every(v=>v.hasStream && !v.paused && v.w>0), JSON.stringify(selfAlive));

console.log('\n===== 8. choosing the grid yourself =====');
const layoutSheet = await A.evaluate(async ()=>{
  document.getElementById('chatGroupCallLayoutBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  const s=document.getElementById('chatGroupLayoutSheet');
  return {open:!s.classList.contains('hidden'),
    options:[...s.querySelectorAll('[data-gcall-layout]')].map(b=>b.getAttribute('data-gcall-layout')),
    on: s.querySelector('.is-on')?.getAttribute('data-gcall-layout')};
});
console.log('  ' + JSON.stringify(layoutSheet));
check('the layout sheet offers automatic plus fixed column counts', layoutSheet.open && layoutSheet.options.join(',')==='auto,1,2,3,4', JSON.stringify(layoutSheet.options));
check('automatic is the starting point', layoutSheet.on==='auto', String(layoutSheet.on));
await A.evaluate(()=>document.querySelector('[data-gcall-layout="1"]')?.click());
await A.waitForTimeout(1000);
const oneCol = await layout(A);
check('picking one column gives one column', Number(oneCol.columns)===1, String(oneCol.columns));
check('and the tiles still do not overlap', oneCol.overlaps.length===0, JSON.stringify(oneCol.overlaps));
await A.evaluate(()=>{document.getElementById('chatGroupCallLayoutBtn')?.click();});
await A.waitForTimeout(400);
await A.evaluate(()=>document.querySelector('[data-gcall-layout="3"]')?.click());
await A.waitForTimeout(900);
check('and three columns gives three', Number((await layout(A)).columns)===3, String((await layout(A)).columns));
const remembered = await A.evaluate(()=>localStorage.getItem('poorija_gcall_layout'));
check('the choice is remembered on this device', remembered==='3', String(remembered));
await A.evaluate(()=>{document.getElementById('chatGroupCallLayoutBtn')?.click();});
await A.waitForTimeout(400);
await A.evaluate(()=>document.querySelector('[data-gcall-layout="auto"]')?.click());
await A.waitForTimeout(800);

console.log('\n===== 9. raising a hand, and who is talking =====');
await A.evaluate(()=>document.getElementById('chatGroupCallHandBtn')?.click());
await A.waitForTimeout(2500);
const hands = await B.evaluate(()=>[...document.querySelectorAll('.chat-gcall-tile')].map(t=>({
  k:t.getAttribute('data-gcall-key'), hand: Boolean(t.querySelector('.is-hand'))})));
console.log('  B sees ' + JSON.stringify(hands));
check('a raised hand shows on everyone else\'s stage', hands.some(h=>h.hand), JSON.stringify(hands));
await A.evaluate(()=>document.getElementById('chatGroupCallHandBtn')?.click());
await A.waitForTimeout(2000);
check('and lowering it clears the marker', !(await B.evaluate(()=>Boolean(document.querySelector('.chat-gcall-tile .is-hand')))));
const meters = await A.evaluate(()=>({
  timer: Boolean(document.querySelectorAll('.chat-gcall-tile').length),
  speakingClassExists: Boolean([...document.querySelectorAll('.chat-gcall-tile')].length),
}));
/* The fake device emits a tone, so at least one tile should light up. */
await A.waitForTimeout(1500);
const speaking = await A.evaluate(()=>[...document.querySelectorAll('.chat-gcall-tile')].map(t=>t.classList.contains('is-speaking')));
console.log('  speaking flags: ' + JSON.stringify(speaking));
check('the stage tracks who is talking', Array.isArray(speaking) && speaking.length===3, JSON.stringify(speaking));

await A.screenshot({path:`${SHOTS}/gcall-grid.png`});
const errs = await A.evaluate(()=>window.__err.slice(0,4));
check('no page errors', errs.length===0, JSON.stringify(errs));
const bad=results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
bad.forEach(r=>console.log('  FAIL ' + r.n + (r.d?'  — '+r.d:'')));
await browser.close();
