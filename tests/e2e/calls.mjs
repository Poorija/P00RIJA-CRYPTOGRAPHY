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

console.log('\n===== 1. incoming call screen =====');
await A.evaluate(()=>document.getElementById('chatVoiceCallBtn')?.click());
await B.waitForTimeout(5000);
const inc = await B.evaluate(()=>{
  const m=document.getElementById('chatIncomingCallModal');
  if(!m) return {present:false};
  const btn=(s)=>{const e=m.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect();
    return {w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x)};};
  return { present:true,
    backdrop: Boolean(m.querySelector('.chat-incoming-backdrop')),
    rings: m.querySelectorAll('.chat-incoming-rings span').length,
    e2ee: Boolean(m.querySelector('.chat-incoming-e2ee')),
    reply: Boolean(m.querySelector('#chatModalReplyBtn')),
    accept: btn('#chatModalAcceptBtn'), reject: btn('#chatModalRejectBtn'),
    name: m.querySelector('h2')?.textContent.trim() };
});
console.log('  ' + JSON.stringify(inc));
check('incoming screen appears', inc.present);
check('blurred backdrop + three breathing rings', inc.backdrop && inc.rings===3, JSON.stringify([inc.backdrop,inc.rings]));
check('encryption badge shown', inc.e2ee);
check('decline-with-message offered', inc.reply);
check('accept and decline are far apart', inc.accept && inc.reject && Math.abs(inc.accept.x-inc.reject.x) > 120,
  `gap ${inc.accept&&inc.reject?Math.abs(inc.accept.x-inc.reject.x):'n/a'}px`);

console.log('\n===== 2. answering: the dock =====');
await B.evaluate(()=>document.getElementById('chatModalAcceptBtn')?.click());
await B.waitForTimeout(4000);
await A.waitForTimeout(2000);
const dock = await A.evaluate(()=>{
  const shell=document.getElementById('chatFloatingCall');
  const row=shell?.querySelector('.chat-call-control-row');
  const btns=[...(row?.querySelectorAll('.chat-call-control')||[])].filter(b=>getComputedStyle(b).display!=='none');
  const first=btns[0]?.getBoundingClientRect();
  return { visible: shell && !shell.classList.contains('hidden'),
    primaryButtons: btns.length, ids: btns.map(b=>b.id),
    round: first ? Math.abs(first.width-first.height) < 6 : null,
    labelsHidden: btns.filter(b=>b.id!=='chatEndCallControlBtn').every(b=>{
      const s=b.querySelector('span'); return !s || getComputedStyle(s).clipPath !== 'none';}),
    sheetHidden: document.getElementById('chatCallMoreSheet')?.classList.contains('hidden'),
    hero: !document.querySelector('#chatFloatingCall .chat-call-hero')?.classList.contains('hidden'),
    heroName: document.getElementById('chatCallHeroName')?.textContent.trim(),
    e2ee: Boolean(document.getElementById('chatCallE2eeBadge')),
    selfViewShown: getComputedStyle(document.querySelector('#chatFloatingCall .chat-local-stage')).display !== 'none',
    mode: document.querySelector('#chatFloatingCall .chat-floating-call-window')?.dataset.callMode };
});
console.log('  ' + JSON.stringify(dock));
console.log('  DEBUG ' + JSON.stringify(await A.evaluate(()=>{
  const row=document.querySelector('#chatFloatingCall .chat-call-control-row');
  const btn=document.getElementById('chatMuteToggleBtn');
  const sp=btn?.querySelector('span');
  const cs=btn?getComputedStyle(btn):null; const ss=sp?getComputedStyle(sp):null;
  const r=btn?.getBoundingClientRect();
  return { inShell: Boolean(document.getElementById('chatFloatingCall')?.contains(btn)),
    rowCount: document.querySelectorAll('#chatFloatingCall .chat-call-control-row').length,
    rect: r?{w:Math.round(r.width),h:Math.round(r.height)}:null,
    css: cs?{w:cs.width,h:cs.height,minH:cs.minHeight,br:cs.borderRadius,disp:cs.display}:null,
    span: ss?{clip:ss.clipPath,pos:ss.position,w:ss.width}:null,
    rootFont: getComputedStyle(document.documentElement).fontSize,
    ancestry: (()=>{const out=[];let e=btn; while(e && e!==document.documentElement){out.push(e.id||e.tagName+'.'+(e.className||'').toString().split(' ')[0]); e=e.parentElement;} return out.join(' < ');})(),
    inMainApp: Boolean(document.getElementById('mainApp')?.contains(btn)),
    firstBtnId: row?.querySelector('.chat-call-control')?.id };
})));
check('call screen is up', dock.visible);
check('dock shows a compact primary row, not 13 buttons', dock.primaryButtons <= 6 && dock.primaryButtons >= 3, `${dock.primaryButtons}: ${JSON.stringify(dock.ids)}`);
check('primary buttons are circular glyphs', dock.round === true);
check('their text labels are visually hidden', dock.labelsHidden === true);
check('overflow sheet starts closed', dock.sheetHidden === true);
check('voice call shows the hero with the caller name', dock.hero && (dock.heroName||'').length>0, JSON.stringify([dock.hero,dock.heroName]));
check('voice call hides the self-view tile', dock.selfViewShown === false, String(dock.mode));

console.log('\n===== 3. the overflow sheet =====');
await A.evaluate(()=>document.getElementById('chatCallMoreBtn')?.click());
await A.waitForTimeout(600);
const sheet = await A.evaluate(()=>{
  const s=document.getElementById('chatCallMoreSheet');
  const items=[...s.querySelectorAll('.chat-call-control')];
  return { open: !s.classList.contains('hidden'), items: items.length,
    labelled: items.every(b=>{const sp=b.querySelector('span'); return sp && sp.textContent.trim().length>0;}),
    ids: items.map(b=>b.id) };
});
console.log('  ' + JSON.stringify(sheet));
check('the sheet opens with the secondary controls', sheet.open && sheet.items === 8, JSON.stringify(sheet.ids));
check('sheet items keep readable labels', sheet.labelled);
await A.evaluate(()=>document.getElementById('chatCallMoreBtn')?.click());
await A.waitForTimeout(500);
check('it closes again', await A.evaluate(()=>document.getElementById('chatCallMoreSheet').classList.contains('hidden')));

console.log('\n===== 4. auto-hiding chrome (video only) =====');
const voiceIdle = await A.evaluate(async () => {
  const shell = document.getElementById('chatFloatingCall');
  shell.classList.remove('chrome-hidden');
  await new Promise(r=>setTimeout(r, 5200));
  return shell.classList.contains('chrome-hidden');
});
check('a voice call never hides its controls', voiceIdle === false);

console.log('\n===== 5. the level meter drives the rings =====');
const level = await A.evaluate(()=>({
  meter: Boolean(window.__probeMeter ?? null),
  cssVar: getComputedStyle(document.querySelector('#chatFloatingCall .chat-call-hero')).getPropertyValue('--call-level').trim(),
}));
console.log('  ' + JSON.stringify(level));
check('the hero exposes a live level variable', level.cssVar !== '' && !Number.isNaN(Number(level.cssVar)), level.cssVar);

console.log('\n===== 6. hang up cleanly =====');
await A.evaluate(()=>document.getElementById('chatEndCallControlBtn')?.click());
await A.waitForTimeout(2500);
await B.waitForTimeout(2500);
const ended = await A.evaluate(()=>({
  hidden: document.getElementById('chatFloatingCall')?.classList.contains('hidden'),
  meterStopped: true,
  errs: (window.__err||[]).filter(x=>!/SSL|Failed to load resource/.test(x)),
}));
check('the call screen closes', ended.hidden === true);
for (const [tag,p] of [['A',A],['B',B]]) {
  const errs = await p.evaluate(()=>(window.__err||[]).filter(x=>!/SSL|Failed to load resource/.test(x)));
  check(`${tag}: no uncaught errors`, errs.length===0, JSON.stringify(errs.slice(0,3)));
}
const failing=results.filter(r=>!r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach(f=>console.log(`  FAIL ${f.n} — ${f.d}`));
await browser.close();
process.exit(failing.length?1:0);
