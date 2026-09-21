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
const FIX = fileURLToPath(new URL('./fixtures', import.meta.url));
const PASS='Harness#Pass2026!';
const browser=await chromium.launch();
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok,d});console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);};
async function app(tag){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});
  await ctx.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){} window.__clip=[];window.__err=[];
    window.addEventListener('error',e=>window.__err.push('ERR '+e.message));});
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

const A=await app('ALPHA'); const B=await app('BETA');
const idA=await id(A), idB=await id(B);
await imp(A,idB); await imp(B,idA);
await A.waitForTimeout(4000);
const fpB=JSON.parse(atob(idB.replace('poorija-chat-v1:',''))).fingerprint;
await A.evaluate((f)=>{[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(c=>c.outerHTML.includes(f.slice(0,16)))?.click();},fpB);
await A.waitForTimeout(2000);

console.log('\n===== 1. switching sticker packs keeps the panel open =====');
await A.evaluate(() => document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(400);
await A.click('#chatStickerBtn');
await A.waitForTimeout(600);
await A.setInputFiles('#chatStickerInput', `${FIX}/pack.wastickers`);
await A.waitForTimeout(2500);
await A.setInputFiles('#chatStickerInput', `${FIX}/tgpack.zip`);
await A.waitForTimeout(2500);
const staged = await A.evaluate(()=>({
  open: !document.getElementById('chatStickerPanel')?.classList.contains('hidden'),
  tabs: [...document.querySelectorAll('[data-chat-sticker-pack]')].map(t=>t.getAttribute('data-chat-sticker-pack')),
  active: document.querySelector('.chat-sticker-tab.active')?.getAttribute('data-chat-sticker-pack')||'',
  cells: document.querySelectorAll('[data-chat-sticker-send]').length,
}));
console.log('  ' + JSON.stringify(staged));
check('two packs are staged and the panel is open', staged.open && staged.tabs.length===2, JSON.stringify({open:staged.open,tabs:staged.tabs.length}));

const other = staged.tabs.find(t=>t!==staged.active);
await A.click(`[data-chat-sticker-pack="${other}"]`);
await A.waitForTimeout(900);
const afterSwitch = await A.evaluate(()=>({
  open: !document.getElementById('chatStickerPanel')?.classList.contains('hidden'),
  active: document.querySelector('.chat-sticker-tab.active')?.getAttribute('data-chat-sticker-pack')||'',
  cells: document.querySelectorAll('[data-chat-sticker-send]').length,
}));
console.log('  ' + JSON.stringify(afterSwitch));
check('picking the other pack does NOT close the panel', afterSwitch.open, `open=${afterSwitch.open}`);
check('and the other pack is now the active one', afterSwitch.active===other, `${staged.active} -> ${afterSwitch.active}`);
check('its stickers are shown', afterSwitch.cells>0, `${afterSwitch.cells} stickers`);

await A.click(`[data-chat-sticker-pack="${staged.active}"]`);
await A.waitForTimeout(900);
const backAgain = await A.evaluate(()=>({
  open: !document.getElementById('chatStickerPanel')?.classList.contains('hidden'),
  active: document.querySelector('.chat-sticker-tab.active')?.getAttribute('data-chat-sticker-pack')||'',
}));
check('switching back also stays open', backAgain.open && backAgain.active===staged.active, JSON.stringify(backAgain));

console.log('\n===== 2. clicking outside still closes it =====');
await A.mouse.click(700, 120);
await A.waitForTimeout(700);
const closed = await A.evaluate(()=>!document.getElementById('chatStickerPanel')?.classList.contains('hidden'));
check('a click outside the panel closes it, as before', !closed, `open=${closed}`);

console.log('\n===== 3. the chat-lock prompt uses the app font =====');
const lockFont = await A.evaluate(()=>{
  const gate=document.getElementById('chatLockGate');
  gate?.classList.remove('hidden');
  const input=document.getElementById('chatLockPin');
  const cs=getComputedStyle(input);
  const bodyFont=getComputedStyle(document.body).fontFamily;
  const out={input:cs.fontFamily, body:bodyFont, spacing:cs.letterSpacing,
    heading:getComputedStyle(gate.querySelector('h3')).fontFamily};
  gate?.classList.add('hidden');
  return out;
});
console.log('  ' + JSON.stringify(lockFont));
check('the password box inherits the app font', lockFont.input===lockFont.body, `${lockFont.input} vs ${lockFont.body}`);
check('it is not a monospace fallback any more', !/monospace/i.test(lockFont.input), lockFont.input);
check('it matches the heading beside it', lockFont.input===lockFont.heading, `${lockFont.input} vs ${lockFont.heading}`);

const errs=await A.evaluate(()=>window.__err.slice(0,4));
check('no page errors', errs.length===0, JSON.stringify(errs));
const bad=results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
bad.forEach(r=>console.log('  FAIL ' + r.n + (r.d?'  — '+r.d:'')));
await browser.close();
