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
const PASS = 'Harness#Pass2026!';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
const results = [];
const check = (n, ok, d='') => { results.push({n, ok, d}); console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

async function app(tag, w=1440, h=900) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h },
    permissions: ['microphone'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('poorija_lang','fa'); } catch(e){} window.__clip=[]; window.__err=[];
    window.addEventListener('error', e=>window.__err.push('ERR '+e.message));
    window.addEventListener('unhandledrejection', e=>window.__err.push('REJ '+(e.reason?.message||e.reason))); });
  const page = await ctx.newPage();
  page.on('dialog', d=>d.accept());
  page.on('pageerror', e=>console.log(`   ${tag}!! ${e.message.slice(0,150)}`));
  await page.goto(`${BASE_URL}/index.html`, { waitUntil:'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((pass)=>{
    const set=(id,v)=>{const el=document.getElementById(id); if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
    set('setupPassword',pass); set('confirmPassword',pass);
    document.querySelectorAll('#initialSetup select').forEach((s,i)=>{ if(s.options.length>i+1){s.selectedIndex=i+1;s.dispatchEvent(new Event('change',{bubbles:true}));}});
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp,i)=>{inp.value='answer'+i;inp.dispatchEvent(new Event('input',{bubbles:true}));});
    const cb=document.getElementById('acceptTermsCheckbox'); if(cb&&!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}
  }, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(2500);
  await instrument(page);
  await page.evaluate(()=>window.switchTab?.('chat'));
  await page.waitForTimeout(800);
  await page.evaluate(()=>document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(6500);
  return page;
}
async function instrument(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.PoorijaApp.showNotification?.bind(window.PoorijaApp);
    window.PoorijaApp.showNotification = (m,t)=>{window.__toasts.push(`${t}: ${m}`); return orig?.(m,t);};
    const w = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText=(t)=>{window.__clip.push(t); return w(t).catch(()=>{});};
    document.getElementById('mobileInstallGate')?.classList.add('hidden');
  });
}
async function reopen(page) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p; el.dispatchEvent(new Event('input',{bubbles:true}));}}, PASS);
  await page.evaluate(()=>window.unlockApp?.());
  await page.waitForTimeout(3000);
  await instrument(page);
  await page.evaluate(()=>window.switchTab?.('chat'));
  await page.waitForTimeout(2500);
  await page.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
  await page.waitForTimeout(4000);
  return page;
}
const media = (p) => p.evaluate(() => ({
  sticker: [...document.querySelectorAll('.chat-sticker-media')].map(e => e.naturalWidth || (e.tagName==='DIV' ? (e.querySelector('svg')?1:0) : 0)),
  voicePlayers: document.querySelectorAll('.modern-audio-player').length,
  voiceUrls: [...document.querySelectorAll('.modern-audio-player')].map(e => (e.dataset.audioUrl||'').slice(0,5)),
  fileLinks: [...document.querySelectorAll('[data-chat-download-message]')].map(a => (a.getAttribute('href')||'').slice(0,5)),
  missing: document.querySelectorAll('.chat-media-missing').length,
  bubbles: document.querySelectorAll('.chat-message-bubble').length,
}));
// can the browser actually read the bytes back through the URL?
const fetchable = (p) => p.evaluate(async () => {
  const urls = [
    ...[...document.querySelectorAll('.chat-sticker-media')].map(e => e.getAttribute('src')).filter(Boolean),
    ...[...document.querySelectorAll('.modern-audio-player')].map(e => e.dataset.audioUrl).filter(Boolean),
    ...[...document.querySelectorAll('[data-chat-download-message]')].map(a => a.getAttribute('href')).filter(Boolean),
  ];
  const out = [];
  for (const u of urls) {
    try { const r = await fetch(u); const b = await r.blob(); out.push(b.size); }
    catch (e) { out.push('DEAD'); }
  }
  return out;
});

const A = await app('A');
const B = await app('B', 1280, 860);
const idA = await A.evaluate(async ()=>{ await window.copyChatFullIdentity(); return window.__clip.at(-1); });
await B.evaluate(async (x)=>{ document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value = x;
  document.querySelector('[data-chat-manual-submit]')?.click(); }, idA);
await B.waitForTimeout(2500);
await B.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await B.waitForTimeout(4000);
await B.fill('#chatComposer','pairing'); await B.click('#chatSendMessageBtn');
await A.waitForTimeout(4500);
await A.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.waitForTimeout(3000);

console.log('\n===== send a file, a voice note and a sticker from A =====');
await A.setInputFiles('#chatFileInput', `${FIX}/loose1.png`);
await A.waitForTimeout(3500);
// voice
await A.evaluate(()=>document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(300);
await A.click('#chatVoiceMessageBtn').catch(()=>{});
await A.waitForTimeout(2200);
await A.evaluate(()=>document.getElementById('chatFinishRecordingBtn')?.click());
await A.waitForTimeout(1200);
await A.click('#chatSendMessageBtn').catch(()=>{});
await A.waitForTimeout(3500);
// sticker
await A.evaluate(()=>document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(300);
await A.click('#chatStickerBtn');
await A.waitForTimeout(400);
await A.setInputFiles('#chatStickerInput', `${FIX}/pack.wastickers`);
await A.waitForTimeout(2500);
await A.evaluate(()=>document.querySelector('[data-chat-sticker-send]')?.click());
await A.waitForTimeout(2500);
await A.evaluate(()=>setStickerPanelVisible?.(false)).catch(()=>{});
await B.waitForTimeout(5000);

const aBefore = await media(A), bBefore = await media(B);
console.log('  A before reload:', JSON.stringify(aBefore));
console.log('  B before reload:', JSON.stringify(bBefore));
check('sender has all three attachments live', aBefore.sticker.some(w=>w>0) && aBefore.voicePlayers>0 && aBefore.fileLinks.length>0, JSON.stringify(aBefore));
check('receiver has all three attachments live', bBefore.sticker.some(w=>w>0) && bBefore.voicePlayers>0 && bBefore.fileLinks.length>0, JSON.stringify(bBefore));

console.log('\n===== RELOAD BOTH SIDES =====');
await reopen(A); await reopen(B);
await A.waitForTimeout(2500); await B.waitForTimeout(2500);
const aAfter = await media(A), bAfter = await media(B);
const aFetch = await fetchable(A), bFetch = await fetchable(B);
console.log('  A after reload :', JSON.stringify(aAfter), 'fetch', JSON.stringify(aFetch));
console.log('  B after reload :', JSON.stringify(bAfter), 'fetch', JSON.stringify(bFetch));
check('sender: sticker still renders after reload', aAfter.sticker.some(w=>w>0), JSON.stringify(aAfter.sticker));
check('sender: voice player still present after reload', aAfter.voicePlayers>0 && aAfter.voiceUrls.every(u=>u==='blob:'), JSON.stringify(aAfter.voiceUrls));
check('sender: file link still present after reload', aAfter.fileLinks.length>0 && aAfter.fileLinks.every(u=>u==='blob:'), JSON.stringify(aAfter.fileLinks));
check('sender: nothing reports missing media', aAfter.missing===0, String(aAfter.missing));
check('sender: every restored URL returns real bytes', aFetch.length>0 && aFetch.every(v=>typeof v==='number' && v>0), JSON.stringify(aFetch));
check('receiver: sticker still renders after reload', bAfter.sticker.some(w=>w>0), JSON.stringify(bAfter.sticker));
check('receiver: voice player still present after reload', bAfter.voicePlayers>0, JSON.stringify(bAfter));
check('receiver: file link still present after reload', bAfter.fileLinks.length>0, JSON.stringify(bAfter));
check('receiver: every restored URL returns real bytes', bFetch.length>0 && bFetch.every(v=>typeof v==='number' && v>0), JSON.stringify(bFetch));

console.log('\n===== bytes are ciphertext at rest =====');
const atRest = await A.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('poorija-media'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  const rows = await new Promise((res) => { const tx = db.transaction('blobs','readonly'); const q = tx.objectStore('blobs').getAll(); q.onsuccess=()=>res(q.result); });
  const png = new Uint8Array([0x89,0x50,0x4e,0x47]);
  return rows.map(r => {
    const head = new Uint8Array(r.cipher.slice(0,4));
    const looksPlain = head.every((b,i)=>b===png[i]);
    return { id: r.id.slice(0,10), kind: r.kind, size: r.size, hasIv: Boolean(r.iv), cipherBytes: r.cipher.byteLength, plaintextHeader: looksPlain };
  });
});
console.log('  vault rows:', JSON.stringify(atRest));
check('vault holds one row per attachment', atRest.length >= 3, String(atRest.length));
check('every row carries its own IV', atRest.every(r=>r.hasIv));
check('no row starts with a recognisable file header', atRest.every(r=>!r.plaintextHeader));
check('ciphertext is longer than plaintext (GCM tag present)', atRest.every(r=>r.cipherBytes > r.size), JSON.stringify(atRest.map(r=>[r.size,r.cipherBytes])));

console.log('\n===== storage card =====');
await A.evaluate(()=>document.querySelector('[data-chat-view="connection"]')?.click());
await A.waitForTimeout(1200);
await A.evaluate(()=>document.getElementById('chatStorageRefreshBtn')?.click());
await A.waitForTimeout(1500);
const card = await A.evaluate(()=>({
  rows: document.querySelectorAll('.chat-storage-row').length,
  text: [...document.querySelectorAll('.chat-storage-row')].map(r=>r.textContent.replace(/\s+/g,' ').trim()),
}));
console.log('  ' + JSON.stringify(card));
check('storage card reports the vault', card.rows>=3 && /\d/.test(card.text.join('')), JSON.stringify(card.text));

const failing = results.filter(r=>!r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach(f=>console.log(`  FAIL ${f.n} — ${f.d}`));
await browser.close();
process.exit(failing.length?1:0);
