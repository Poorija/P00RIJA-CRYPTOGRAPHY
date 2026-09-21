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


console.log('\n===== staging a few local files =====');
await A.setInputFiles('#chatFileInput', `${FIX}/loose1.png`);
await A.waitForTimeout(3500);
await A.setInputFiles('#chatFileInput', `${FIX}/ring.wav`);
await A.waitForTimeout(3500);
await A.evaluate(()=>document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(300);
await A.click('#chatStickerBtn');
await A.waitForTimeout(400);
await A.setInputFiles('#chatStickerInput', `${FIX}/pack.wastickers`);
await A.waitForTimeout(2500);
await A.evaluate(()=>document.querySelector('[data-chat-sticker-send]')?.click());
await A.waitForTimeout(2500);
await A.keyboard.press('Escape');
await A.waitForTimeout(600);

console.log('\n===== 1. the manager opens with a picture of what is stored =====');
await A.evaluate(()=>window.switchTab?.('chat'));
await A.evaluate(()=>document.querySelector('[data-chat-view="connection"]')?.click());
await A.waitForTimeout(900);
const opened = await A.evaluate(async ()=>{
  /* The vault now lives in its own settings tab; open it first. */
  document.querySelector('[data-settings-tab="storage"]')?.click();
  await new Promise(r=>setTimeout(r,500));
  const toggle=document.getElementById('chatFileManagerToggle');
  toggle?.scrollIntoView();
  toggle?.click();
  await new Promise(r=>setTimeout(r,1200));
  const card=document.getElementById('chatFileManager');
  return {
    open: !card.classList.contains('hidden'),
    arcs: card.querySelectorAll('.chat-files-arc').length,
    total: card.querySelector('.chat-files-donut-total')?.textContent||'',
    legend: [...card.querySelectorAll('.chat-files-legend-row')].map(r=>r.textContent.replace(/\s+/g,' ').trim()),
    chips: [...card.querySelectorAll('.chat-files-chip')].map(c=>c.textContent.replace(/\s+/g,' ').trim()),
    rows: [...card.querySelectorAll('.chat-files-row')].map(r=>({
      name: r.querySelector('.chat-files-meta b')?.textContent.trim(),
      meta: r.querySelector('.chat-files-meta i')?.textContent.trim(),
      src: r.getAttribute('data-file-source'),
      buttons: r.querySelectorAll('button').length })),
    quota: card.querySelector('.chat-files-quota span')?.getAttribute('style')||'',
  };
});
console.log('  ' + JSON.stringify(opened).slice(0,900));
check('the file manager opens', opened.open, String(opened.open));
check('the donut draws one arc per non-empty category', opened.arcs>=2, `${opened.arcs} arcs`);
check('it reports a total that is not zero', /\d/.test(opened.total) && !/^0\s*B/.test(opened.total), opened.total);
check('every category is in the legend with a size and a share', opened.legend.length===6 && opened.legend.every(l=>/%$/.test(l)), JSON.stringify(opened.legend));
const legendWidths = await A.evaluate(()=>[...document.querySelectorAll('#chatFileManager .chat-files-legend-name')].map(n=>Math.round(n.getBoundingClientRect().width)));
check('the category names are actually readable, not collapsed', legendWidths.every(w=>w>60), JSON.stringify(legendWidths));
check('the browser quota bar is drawn', /width:\s*\d+%/.test(opened.quota), opened.quota);
check('files are listed with a name, a size and a date', opened.rows.length>=2 && opened.rows.every(r=>r.name && /\d/.test(r.meta||'')), JSON.stringify(opened.rows.slice(0,3)));
check('each row offers open, save and delete', opened.rows.filter(r=>r.src==='vault').every(r=>r.buttons===3), JSON.stringify(opened.rows.map(r=>[r.src,r.buttons])));
check('the sticker pack is listed too, not just attachments', opened.rows.some(r=>r.src==='pack'), JSON.stringify(opened.rows.map(r=>r.src)));

console.log('\n===== 2. filtering by category =====');
const filtered = await A.evaluate(async ()=>{
  document.querySelector('[data-files-category="image"]')?.click();
  await new Promise(r=>setTimeout(r,900));
  const card=document.getElementById('chatFileManager');
  return {
    chip: card.querySelector('.chat-files-chip.is-on')?.textContent.replace(/\s+/g,' ').trim(),
    rows: [...card.querySelectorAll('.chat-files-row')].map(r=>r.querySelector('.chat-files-meta b')?.textContent.trim()),
    hasClear: Boolean(card.querySelector('[data-files-clear-category]')),
  };
});
console.log('  ' + JSON.stringify(filtered));
check('picking a category narrows the list to it', filtered.rows.length>=1 && filtered.rows.every(n=>/png|jpg|jpeg|webp|loose/i.test(n||'')), JSON.stringify(filtered.rows));
check('and offers to clear that whole group', filtered.hasClear, String(filtered.hasClear));

console.log('\n===== 3. searching by name =====');
const searched = await A.evaluate(async ()=>{
  document.querySelector('[data-files-category="all"]')?.click();
  await new Promise(r=>setTimeout(r,700));
  const box=document.querySelector('[data-files-search]');
  box.value='loose'; box.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,900));
  return [...document.querySelectorAll('#chatFileManager .chat-files-row .chat-files-meta b')].map(n=>n.textContent.trim());
});
console.log('  ' + JSON.stringify(searched));
check('search filters the list', searched.length>=1 && searched.every(n=>/loose/i.test(n)), JSON.stringify(searched));

console.log('\n===== 4. saving a file writes it out decrypted =====');
const saved = await A.evaluate(async ()=>{
  window.__saved=[];
  const realClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    if (this.download) { window.__saved.push({name:this.download, href:this.href.slice(0,12)}); return; }
    return realClick.call(this);
  };
  document.querySelector('#chatFileManager [data-file-save]')?.click();
  await new Promise(r=>setTimeout(r,1500));
  return window.__saved;
});
console.log('  ' + JSON.stringify(saved));
check('save hands the browser a real file', saved.length===1 && saved[0].name && saved[0].href.startsWith('blob:'), JSON.stringify(saved));

console.log('\n===== 5. deleting one file =====');
const deleted = await A.evaluate(async ()=>{
  const box=document.querySelector('[data-files-search]');
  box.value=''; box.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,900));
  const before=document.querySelectorAll('#chatFileManager .chat-files-row').length;
  const totalBefore=document.querySelector('.chat-files-donut-total')?.textContent||'';
  document.querySelector('#chatFileManager [data-file-delete]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  /* Confirm it: the delete goes through the in-page dialog. */
  document.querySelector('.poorija-dialog-ok')?.click();
  await new Promise(r=>setTimeout(r,2200));
  return {before, after: document.querySelectorAll('#chatFileManager .chat-files-row').length,
    totalBefore, totalAfter: document.querySelector('.chat-files-donut-total')?.textContent||''};
});
console.log('  ' + JSON.stringify(deleted));
check('the file disappears from the list', deleted.after === deleted.before-1, JSON.stringify(deleted));
check('and the chart total goes down with it', deleted.totalBefore!==deleted.totalAfter, `${deleted.totalBefore} -> ${deleted.totalAfter}`);

console.log('\n===== 6. it survives a reload =====');
await A.reload({waitUntil:'load'});
await A.waitForTimeout(2500);
await A.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p;el.dispatchEvent(new Event('input',{bubbles:true}));}},PASS);
await A.evaluate(()=>window.unlockApp?.());
await A.waitForTimeout(5000);
const after = await A.evaluate(async ()=>{
  window.switchTab?.('chat');
  await new Promise(r=>setTimeout(r,800));
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise(r=>setTimeout(r,700));
  document.querySelector('[data-settings-tab="storage"]')?.click();
  await new Promise(r=>setTimeout(r,400));
  document.getElementById('chatFileManagerToggle')?.click();
  await new Promise(r=>setTimeout(r,1500));
  return {rows: document.querySelectorAll('#chatFileManager .chat-files-row').length,
    total: document.querySelector('.chat-files-donut-total')?.textContent||''};
});
console.log('  ' + JSON.stringify(after));
check('the manager still sees the vault after a reload', after.rows>=1 && /\d/.test(after.total), JSON.stringify(after));

await A.evaluate(()=>document.getElementById('chatFileManager')?.scrollIntoView({block:'center'}));
await A.waitForTimeout(600);
await A.evaluate(()=>{const c=document.getElementById('chatFileManager'); c.scrollIntoView({block:'start'}); window.scrollBy(0,-40);});
await A.waitForTimeout(800);
await A.screenshot({path:`${SHOTS}/filemanager.png`}).catch((e)=>console.log('  shot failed', e.message.slice(0,60)));
const errs = await A.evaluate(()=>window.__err.slice(0,4));
check('no page errors', errs.length===0, JSON.stringify(errs));
const bad=results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
bad.forEach(r=>console.log('  FAIL ' + r.n + (r.d?'  — '+r.d:'')));
await browser.close();
