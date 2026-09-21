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
import { fileURLToPath } from 'node:url';
/* A 30-second boot check: does this tree load, set up, and wire the chat tab.
   No second peer, no relay — run it first, before the long suites.
     node tests/e2e/smoke.mjs
     PKG_URL=http://localhost:8080 node tests/e2e/smoke.mjs */
const BASE_URL = process.env.PKG_URL || 'https://localhost:8585';
const PASS='Harness#Pass2026!';
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok,d});console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);};
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1440,height:900},ignoreHTTPSErrors:true});
await ctx.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){}});
const page=await ctx.newPage();
const errors=[]; const failedRequests=[];
page.on('pageerror',e=>errors.push(e.message.slice(0,120)));
page.on('console',m=>{ if(m.type()==='error') errors.push('console: '+m.text().slice(0,120)); });
page.on('requestfailed',r=>failedRequests.push(r.url().replace(BASE_URL,'')+' '+(r.failure()?.errorText||'')));
page.on('response',r=>{ if(r.status()>=400) failedRequests.push(r.url().replace(BASE_URL,'')+' HTTP '+r.status()); });
page.on('dialog',d=>d.accept());

console.log('\n===== the packaged tree boots on its own =====');
await page.goto(`${BASE_URL}/index.html`,{waitUntil:'load'});
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);
const boot = await page.evaluate(()=>({
  title: document.title,
  setup: Boolean(document.getElementById('initialSetup')),
  scripts: [...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src').split('?')[0]),
  /* was script[src*="chat.js"], which matched nothing once that file became
     js/chat/NN-*.js — so this read '' and failed for the right reason with the
     wrong message. app.js is the stable anchor; the chat parts are checked
     separately below, which is a stronger claim than the original made. */
  version: (document.querySelector('script[src*="js/app.js"]')?.getAttribute('src')||'').split('?v=')[1]||'',
  chatParts: [...document.querySelectorAll('script[src*="js/chat/"]')].map(s=>s.getAttribute('src')),
  crypto: typeof crypto?.subtle?.encrypt === 'function',
  fontLoaded: [...document.fonts].some(f=>/Vazirmatn/i.test(f.family)),
}));
console.log('  ' + JSON.stringify(boot).slice(0,400));
check('the page loads with its title', /P00RIJ/i.test(boot.title||''), boot.title);
check('every script tag resolves', failedRequests.length===0, JSON.stringify(failedRequests.slice(0,4)));
check('it carries a version tag on every asset', /^\d+\.\d+\.\d+-/.test(boot.version||''), boot.version);
check('the chat module ships as an ordered set of parts', (boot.chatParts||[]).length >= 20, `${(boot.chatParts||[]).length} parts`);
check('every chat part carries the same version tag',
  (boot.chatParts||[]).length > 0 && boot.chatParts.every(src => src.endsWith('?v=' + boot.version)),
  (boot.chatParts||[]).filter(src => !src.endsWith('?v=' + boot.version)).slice(0,3).join(', ') || 'all match');
check('the chat parts are numbered in load order',
  (boot.chatParts||[]).every((src, i) => src.includes('/' + String(i+1).padStart(2,'0') + '-')),
  (boot.chatParts||[]).slice(0,2).join(', '));
check('WebCrypto is available over plain localhost', boot.crypto, String(boot.crypto));
check('the bundled Persian font is registered', boot.fontLoaded, String(boot.fontLoaded));

console.log('\n===== setup runs from the package =====');
await page.evaluate((pass)=>{
  const set=(id,v)=>{const el=document.getElementById(id); if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
  set('setupPassword',pass); set('confirmPassword',pass);
  document.querySelectorAll('#initialSetup select').forEach((s,i)=>{if(s.options.length>i+1){s.selectedIndex=i+1;s.dispatchEvent(new Event('change',{bubbles:true}));}});
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp,i)=>{inp.value='answer'+i;inp.dispatchEvent(new Event('input',{bubbles:true}));});
  const cb=document.getElementById('acceptTermsCheckbox'); if(cb&&!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}
},PASS);
await page.waitForTimeout(400);
await page.evaluate(()=>document.getElementById('setupBtn')?.click());
await page.waitForTimeout(3500);
const after = await page.evaluate(()=>({
  unlocked: getComputedStyle(document.getElementById('mainApp')).opacity !== '0',
  /* The old check asked whether poorija_master_hash was an Argon2id record.
     There is deliberately no password record of any kind any more — that key
     was the thing announcing a duress password existed. So this asks the
     stronger question: nothing hash-shaped is stored, AND the vault that
     replaced it derives its key with Argon2id. */
  noStoredHash: !localStorage.getItem('poorija_master_hash') && !localStorage.getItem('poorija_panic_hash'),
  vaultKdf: (() => { try { return JSON.parse(localStorage.getItem('poorija_vault')).kdf.alg; } catch (e) { return null; } })(),
  vaultSlots: (() => { try { return JSON.parse(localStorage.getItem('poorija_vault')).slots.length; } catch (e) { return 0; } })(),
  tabs: document.querySelectorAll('#sidebarNav button[id^="tab-"]').length,
}));
console.log('  ' + JSON.stringify(after));
check('the wizard completes and the app opens', after.unlocked, String(after.unlocked));
check('no password hash of any kind is stored', after.noStoredHash, String(after.noStoredHash));
check('the vault derives its key with Argon2id', after.vaultKdf === 'argon2id', String(after.vaultKdf));
check('and it holds two indistinguishable slots', after.vaultSlots === 2, String(after.vaultSlots));
check('every dashboard tab is present', after.tabs>=12, `${after.tabs} tabs`);

console.log('\n===== the chat tab is fully wired =====');
const chat = await page.evaluate(async ()=>{
  window.switchTab?.('chat');
  await new Promise(r=>setTimeout(r,1500));
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise(r=>setTimeout(r,800));
  return {
    settingsTabs: [...document.querySelectorAll('#chatConnectionPanel [data-settings-tab]')].map(b=>b.getAttribute('data-settings-tab')),
    navLabel: document.querySelector('[data-chat-view="connection"]')?.textContent.trim(),
    /* The fold above the group list is gone: making a group is a dialog now. */
    groupMaker: Boolean(document.getElementById('chatGroupMaker')),
    fileManager: Boolean(document.getElementById('chatFileManagerToggle')),
    verifyStrip: Boolean(document.getElementById('chatCallVerifyStrip')),
    groupCallDock: document.querySelectorAll('.chat-gcall-dock button').length,
    reactionBars: document.querySelectorAll('.chat-call-reaction-bar').length,
  };
});
console.log('  ' + JSON.stringify(chat));
/* Appearance, Chat notifications and Files & privacy were split out of
   Connection & TURN, which had become the pane every card fell into because
   the builder sweeps whatever it has not been told about into it. Order is
   asserted too: it is by how often somebody opens a section, not by how the
   code grew. */
check('the settings tabs are there',
  chat.settingsTabs.join(',')==='appearance,notifications,sounds,privacy,connection,lock,storage,tools',
  JSON.stringify(chat.settingsTabs));
check('the section is named Settings', chat.navLabel==='تنظیمات', chat.navLabel);
check('the group maker ships with the payload', chat.groupMaker, String(chat.groupMaker));
check('the file manager is present', chat.fileManager, String(chat.fileManager));
check('the call emoji key is present', chat.verifyStrip, String(chat.verifyStrip));
check('the group call dock has every control', chat.groupCallDock===7, String(chat.groupCallDock));
check('both reaction bars exist', chat.reactionBars===2, String(chat.reactionBars));

console.log('\n===== nothing threw =====');
console.log('  missing: ' + JSON.stringify(failedRequests));
/* The app probes its own origin for a relay at /chat-health. The static dev
   server has no relay, so those 404s are the expected answer, not a gap. */
const isRelayProbe = (u)=>/\/chat-health/.test(u) || /\/turn-config/.test(u) || /\/peerjs/.test(u);
const realMisses = failedRequests.filter(u=>!isRelayProbe(u));
const realErrors = errors.filter(e=>!/Failed to load resource/.test(e));
check('nothing is missing from the package', realMisses.length===0, JSON.stringify(realMisses));
check('no script threw', realErrors.length===0, JSON.stringify(realErrors.slice(0,3)));
check('the only failures are relay probes, and no relay is running here', failedRequests.every(isRelayProbe), JSON.stringify(realMisses));
const shotDir = process.env.PKG_SHOTS || fileURLToPath(new globalThis.URL('./screenshots/', import.meta.url));
fs.mkdirSync(shotDir, { recursive: true });
await page.screenshot({path:path.join(shotDir,'smoke-boot.png')}).catch(()=>{});
const bad=results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
bad.forEach(r=>console.log('  FAIL ' + r.n + (r.d?'  — '+r.d:'')));
await browser.close();
process.exit(bad.length ? 1 : 0);
