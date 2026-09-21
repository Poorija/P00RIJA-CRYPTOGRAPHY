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
async function boot(ctx, tag){
  const page=await ctx.newPage();
  page.on('dialog',d=>d.accept());
  page.on('pageerror',e=>console.log(`   ${tag}!! ${e.message.slice(0,150)}`));
  await page.goto(`${BASE_URL}/index.html`,{waitUntil:'load'});
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  return page;
}
async function setup(page){
  await page.evaluate((pass)=>{
    const set=(id,v)=>{const el=document.getElementById(id); if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
    set('setupPassword',pass); set('confirmPassword',pass);
    document.querySelectorAll('#initialSetup select').forEach((s,i)=>{if(s.options.length>i+1){s.selectedIndex=i+1;s.dispatchEvent(new Event('change',{bubbles:true}));}});
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp,i)=>{inp.value='answer'+i;inp.dispatchEvent(new Event('input',{bubbles:true}));});
    const cb=document.getElementById('acceptTermsCheckbox'); if(cb&&!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}
  },PASS);
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(4000);
  await page.evaluate(()=>{window.__toasts=[];window.__err=[];
    window.addEventListener('error',e=>window.__err.push('ERR '+e.message));
    const o=window.PoorijaApp.showNotification?.bind(window.PoorijaApp);
    window.PoorijaApp.showNotification=(m,t)=>{window.__toasts.push(`${t}: ${m}`);return o?.(m,t);};
    const w=navigator.clipboard.writeText.bind(navigator.clipboard);
    window.__clip=[]; navigator.clipboard.writeText=(t)=>{window.__clip.push(t);return w(t).catch(()=>{});};
    document.getElementById('mobileInstallGate')?.classList.add('hidden');});
}

console.log('\n===== 1. master password now uses Argon2id =====');
const ctxA=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']});
await ctxA.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){}});
let A=await boot(ctxA,'A');
await setup(A);
/* There is deliberately no password record any more. poorija_master_hash was
   the thing that sat beside poorija_panic_hash and announced a duress password
   existed; both are gone, replaced by two slots that nothing distinguishes.
   So the question is no longer "is the record Argon2id" but "is there no
   record, and does the vault that replaced it use Argon2id". */
const record = await A.evaluate(()=>{
  let vault=null; try{vault=JSON.parse(localStorage.getItem('poorija_vault'));}catch(e){}
  return {
    noMasterHash: !localStorage.getItem('poorija_master_hash'),
    noPanicHash: !localStorage.getItem('poorija_panic_hash'),
    kdf: vault?.kdf?.alg, slots: vault?.slots?.length,
    memoryKiB: vault?.kdf?.m, passes: vault?.kdf?.t,
    slotSizes: (vault?.slots||[]).map(x=>atob(x.ct).length)
  };
});
console.log('  ' + JSON.stringify(record));
check('no password record of any kind is stored', record.noMasterHash && record.noPanicHash, JSON.stringify(record));
check('the vault derives its key with Argon2id', record.kdf==='argon2id', String(record.kdf));
check('at a memory cost worth having', record.memoryKiB>=65536 && record.passes>=3, `m=${record.memoryKiB} t=${record.passes}`);
check('and holds two slots of identical length', record.slots===2 && record.slotSizes[0]===record.slotSizes[1], JSON.stringify(record.slotSizes));

console.log('\n===== 2. a legacy SHA-256 install still unlocks, and is upgraded =====');
/* The vault has to go too, or this is not a legacy install: hasLegacyVault()
   is `no vault AND a master hash`, so leaving the vault in place meant the
   migration never ran and the check below passed for the wrong reason. */
const legacySha = await A.evaluate(async (p)=>{
  localStorage.removeItem('poorija_vault');
  const bytes = new TextEncoder().encode(p);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  localStorage.setItem('poorija_master_hash', hex);
  return hex;
}, PASS);
await A.reload({waitUntil:'load'});
await A.waitForTimeout(1800);
await A.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p;el.dispatchEvent(new Event('input',{bubbles:true}));}},PASS);
await A.evaluate(()=>window.unlockApp?.());
await A.waitForTimeout(4000);
const upgraded = await A.evaluate(()=>{
  let vault=null; try{vault=JSON.parse(localStorage.getItem('poorija_vault'));}catch(e){}
  return {
    locked: document.body.classList.contains('app-locked'),
    mainVisible: getComputedStyle(document.getElementById('mainApp')).opacity !== '0',
    legacyGone: !localStorage.getItem('poorija_master_hash'),
    vaultSlots: vault?.slots?.length || 0,
    vaultKdf: vault?.kdf?.alg,
    profiles: new Set(Object.keys(localStorage).filter(k=>k.startsWith('poorija_p_'))
      .map(k=>k.slice(10).split('_')[0])).size
  };
});
console.log('  ' + JSON.stringify(upgraded));
check('a legacy record still unlocks the app', upgraded.mainVisible && !upgraded.locked, JSON.stringify(upgraded));
check('and is converted into the two-slot vault', upgraded.vaultSlots===2 && upgraded.vaultKdf==='argon2id', JSON.stringify(upgraded));
check('the legacy record is deleted once it has been converted', upgraded.legacyGone, JSON.stringify(upgraded));
check('and the converted install has both profiles like any other', upgraded.profiles===2, String(upgraded.profiles));

const wrongPw = await A.evaluate(async ()=>{
  const before = localStorage.getItem('poorija_failed_logins')||'0';
  const el=document.getElementById('unlockPassword');
  return { before };
});
console.log('\n===== 3. a wrong password is still refused =====');
await A.reload({waitUntil:'load'});
await A.waitForTimeout(1800);
await A.evaluate(()=>{const el=document.getElementById('unlockPassword'); if(el){el.value='definitely-not-it';el.dispatchEvent(new Event('input',{bubbles:true}));}});
await A.evaluate(()=>window.unlockApp?.());
await A.waitForTimeout(3500);
const refused = await A.evaluate(()=>({
  stillLocked: getComputedStyle(document.getElementById('mainApp')).opacity === '0' || document.getElementById('mainApp').classList.contains('hidden'),
  failed: localStorage.getItem('poorija_failed_logins'),
}));
check('the wrong password does not get in', refused.stillLocked, JSON.stringify(refused));
await A.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p;el.dispatchEvent(new Event('input',{bubbles:true}));}},PASS);
await A.evaluate(()=>window.unlockApp?.());
await A.waitForTimeout(3500);
await A.evaluate(()=>{window.__toasts=[];window.__err=[];
  const o=window.PoorijaApp.showNotification?.bind(window.PoorijaApp);
  window.PoorijaApp.showNotification=(m,t)=>{window.__toasts.push(`${t}: ${m}`);return o?.(m,t);};
  const w=navigator.clipboard.writeText.bind(navigator.clipboard);
  window.__clip=[]; navigator.clipboard.writeText=(t)=>{window.__clip.push(t);return w(t).catch(()=>{});};
  document.getElementById('mobileInstallGate')?.classList.add('hidden');});

console.log('\n===== 4. seed some real data, then back it all up =====');
await A.evaluate(()=>window.switchTab?.('chat'));
await A.waitForTimeout(1500);
await A.evaluate(()=>document.getElementById('chatConnectBtn')?.click());
await A.waitForTimeout(6000);
const ctxB=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:860}});
await ctxB.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){}});
const B=await boot(ctxB,'B'); await setup(B);
await B.evaluate(()=>window.switchTab?.('chat'));
await B.waitForTimeout(1200);
await B.evaluate(()=>document.getElementById('chatConnectBtn')?.click());
await B.waitForTimeout(6000);
const idA=await A.evaluate(async()=>{await window.copyChatFullIdentity(); return window.__clip.at(-1);});
await B.evaluate(async(t)=>{document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value=t;
  document.querySelector('[data-chat-manual-submit]')?.click();},idA);
await B.waitForTimeout(2500);
await B.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await B.waitForTimeout(4000);
for (const m of ['پیام اول برای پشتیبان','پیام دوم برای پشتیبان','پیام سوم برای پشتیبان']) {
  await B.fill('#chatComposer', m); await B.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
  await B.waitForTimeout(600);
}
await A.waitForTimeout(6000);
await A.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.waitForTimeout(2500);
await A.setInputFiles('#chatFileInput', `${FIX}/loose1.png`);
await A.waitForTimeout(4000);
await A.evaluate(()=>document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(300);
await A.click('#chatStickerBtn'); await A.waitForTimeout(400);
await A.setInputFiles('#chatStickerInput', `${FIX}/pack.wastickers`);
await A.waitForTimeout(3000);
await A.evaluate(()=>setStickerPanelVisibleProbe?.()).catch(()=>{});
await A.evaluate(()=>document.getElementById('chatStickerCloseBtn')?.click());
const seeded = await A.evaluate(async ()=>{
  const count = (db,store)=>new Promise(res=>{
    const r=indexedDB.open(db); r.onsuccess=()=>{const d=r.result;
      if(!d.objectStoreNames.contains(store)){d.close();return res(0);}
      const q=d.transaction(store,'readonly').objectStore(store).count();
      q.onsuccess=()=>{res(q.result); d.close();};};
    r.onerror=()=>res(0);});
  return { media: await count('poorija-media','blobs'), packs: await count('poorija-stickers','packs'),
    texts: document.querySelectorAll('.chat-message-text').length };
});
console.log('  seeded: ' + JSON.stringify(seeded));
check('there is real data to back up', seeded.media>=1 && seeded.packs>=1 && seeded.texts>=3, JSON.stringify(seeded));

await A.evaluate(()=>window.switchTab?.('migration'));
await A.waitForTimeout(1500);
const snapKeys = await A.evaluate(async ()=>{
  const snap = await window.PoorijaVaultBackup.collectSnapshot();
  const hist = snap.localStorage['poorija_chat_history']||'';
  return { keys: Object.keys(snap.localStorage), histLen: hist.length };
});
console.log('  snapshot keys: ' + JSON.stringify(snapKeys.keys));
console.log('  chat history bytes in snapshot: ' + snapKeys.histLen);
const dl = A.waitForEvent('download', { timeout: 90000 });
await A.fill('#vaultBackupPassword','backup-pass-2026');
await A.fill('#vaultBackupPasswordConfirm','backup-pass-2026');
await A.click('#vaultBackupExportBtn');
const download = await dl;
const backupPath = `${SHOTS}/vault-test.pkgvault`;
await download.saveAs(backupPath);
await A.waitForTimeout(1200);
const exported = await A.evaluate(()=>document.getElementById('vaultBackupStatus')?.textContent||'');
console.log('  ' + exported);
check('the backup file downloads and reports what it holds', /پیوست|attachments/.test(exported), exported.slice(0,120));
const { statSync } = await import('node:fs');
const size = statSync(backupPath).size;
check('the file is non-trivial in size', size > 2000, `${size} bytes`);
const { readFileSync } = await import('node:fs');
const head = readFileSync(backupPath).subarray(0, 14).toString();
check('it carries the vault magic header', head === 'P00RIJA-VAULT ', JSON.stringify(head));
const raw = readFileSync(backupPath).toString('latin1');
check('the plaintext is nowhere in the file', !raw.includes('پیام اول برای پشتیبان') && !/poorija_chat_history/.test(raw.slice(300)), 'no plaintext markers');

console.log('\n===== 5. restore onto a device that has never seen this vault =====');
const ctxC=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:960},acceptDownloads:true});
await ctxC.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){}});
const C=await boot(ctxC,'C');
await setup(C);
await C.evaluate(()=>window.switchTab?.('migration'));
await C.waitForTimeout(1500);

/* Restoring asks first - it replaces everything on the device, so the app
   confirms through its own modal. Left unanswered, the backdrop swallows the
   next click and the run stalls with no explanation. */
const okModal = async (p) => {
  await p.waitForSelector('.poorija-dialog-backdrop.is-open .poorija-dialog-ok', { timeout: 5000 }).catch(()=>{});
  await p.evaluate(()=>document.querySelector('.poorija-dialog-backdrop.is-open .poorija-dialog-ok')?.click());
  await p.waitForTimeout(600);
};

await C.setInputFiles('#vaultRestoreFile', backupPath);
await C.waitForTimeout(1500);
const preview = await C.evaluate(()=>document.getElementById('vaultRestoreStatus')?.textContent||'');
console.log('  preview: ' + preview);
check('picking the file previews what is inside it', /پیوست|attachments/.test(preview), preview.slice(0,100));
await C.fill('#vaultRestorePassword','wrong-password-here');
await C.click('#vaultRestoreBtn');
await okModal(C);
await C.waitForTimeout(9000);
const badPw = await C.evaluate(()=>document.getElementById('vaultRestoreStatus')?.textContent||'');
check('a wrong backup password is refused', /اشتباه|Wrong/.test(badPw), badPw.slice(0,80));
await C.fill('#vaultRestorePassword','backup-pass-2026');
await C.click('#vaultRestoreBtn');
await okModal(C);
await C.waitForTimeout(9000);
const midRestore = await C.evaluate(()=>({
  hist: (localStorage.getItem('poorija_chat_history')||'').length,
  salt: (localStorage.getItem('poorija_storage_key_salt_v3')||'').slice(0,10),
  status: document.getElementById('vaultRestoreStatus')?.textContent||'',
})).catch(()=>({gone:true}));
console.log('  right after restore, before reload: ' + JSON.stringify(midRestore));
await C.waitForTimeout(6000);
// the app reloads itself after restore
await C.waitForTimeout(3000);
await C.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p;el.dispatchEvent(new Event('input',{bubbles:true}));}},PASS);
await C.evaluate(()=>window.unlockApp?.());
await C.waitForTimeout(4000);
await C.evaluate(()=>{document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');});
await C.waitForTimeout(3500);
const restored = await C.evaluate(async ()=>{
  // Pick the card that actually has history, not whatever the relay just
  // advertised: after a restore this device carries the original identity and
  // will re-discover strangers within seconds.
  const cards=[...document.querySelectorAll('#chatPeerList .chat-peer-card')];
  const withHistory = cards.find(c=>!/عدم اتصال\s*$/.test(c.textContent)) || cards[0];
  withHistory?.click();
  await new Promise(r=>setTimeout(r,2500));
  const count = (db,store)=>new Promise(res=>{
    const r=indexedDB.open(db); r.onsuccess=()=>{const d=r.result;
      if(!d.objectStoreNames.contains(store)){d.close();return res(0);}
      const q=d.transaction(store,'readonly').objectStore(store).count();
      q.onsuccess=()=>{res(q.result); d.close();};};
    r.onerror=()=>res(0);});
  // The decisive evidence is the stored history itself, not what is painted.
  const historyRaw = localStorage.getItem('poorija_chat_history')||'';
  let threads = 0, totalMessages = 0, sample = [];
  try {
    const decoded = window.PoorijaApp.decryptStorageData(historyRaw) || {};
    threads = Object.keys(decoded).length;
    Object.values(decoded).forEach(list=>{ totalMessages += (list||[]).length;
      (list||[]).forEach(e=>{ if(e.text) sample.push(String(e.text).slice(0,24)); }); });
  } catch (e) { sample = ['DECRYPT_FAILED: '+e.message]; }
  return { cards: document.querySelectorAll('#chatPeerList .chat-peer-card').length,
    threads, totalMessages, sample: sample.slice(0,4),
    texts: [...document.querySelectorAll('.chat-message-text')].map(e=>e.textContent.trim().slice(0,24)),
    files: document.querySelectorAll('[data-chat-download-message]').length,
    missing: document.querySelectorAll('.chat-media-missing').length,
    media: await count('poorija-media','blobs'), packs: await count('poorija-stickers','packs') };
});
console.log('  restored: ' + JSON.stringify(restored));
check('the encrypted history decrypts on the new device', restored.threads>=1 && restored.totalMessages>=3, JSON.stringify({t:restored.threads,m:restored.totalMessages,s:restored.sample}));
check('the restored conversation renders its messages', restored.texts.length>=3, JSON.stringify(restored.texts));
check('the media vault comes back', restored.media>=1, String(restored.media));
check('sticker packs come back', restored.packs>=1, String(restored.packs));
check('the restored attachment actually opens (no "not stored here")', restored.files>=1 && restored.missing===0, JSON.stringify([restored.files, restored.missing]));

console.log('\n===== 6. swipe to reply and multi-select =====');
const swipe = await A.evaluate(async ()=>{
  window.switchTab?.('chat');
  await new Promise(r=>setTimeout(r,1500));
  document.querySelector('#chatPeerList .chat-peer-card')?.click();
  await new Promise(r=>setTimeout(r,2000));
  const bubble=[...document.querySelectorAll('#chatMessages .chat-message-bubble')].at(-1);
  if(!bubble) return {none:true};
  const r=bubble.getBoundingClientRect();
  const cx=r.left+r.width/2, cy=r.top+r.height/2;
  const fire=(type,x,y)=>bubble.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:5,button:0}));
  fire('pointerdown',cx,cy);
  fire('pointermove',cx+30,cy);
  fire('pointermove',cx+75,cy);
  const armed=bubble.classList.contains('is-swipe-armed');
  fire('pointerup',cx+75,cy);
  await new Promise(r2=>setTimeout(r2,600));
  return { armed, bound: bubble.dataset.swipeBound==='1',
    contextShown: !document.getElementById('chatComposerContext')?.classList.contains('hidden') };
});
console.log('  ' + JSON.stringify(swipe));
check('dragging a bubble arms the reply', swipe.bound && swipe.armed===true, JSON.stringify(swipe));
check('releasing it opens the reply context', swipe.contextShown===true, JSON.stringify(swipe));
await A.evaluate(()=>document.getElementById('chatCancelContextBtn')?.click());

const multi = await A.evaluate(async ()=>{
  const bubbles=[...document.querySelectorAll('#chatMessages .chat-message-bubble')];
  const first=bubbles[0];
  first.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:7,button:0}));
  await new Promise(r=>setTimeout(r,700));
  first.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:7,button:0}));
  await new Promise(r=>setTimeout(r,500));
  const entered = !document.getElementById('chatSelectionBar').classList.contains('hidden');
  document.querySelectorAll('#chatMessages .chat-message-bubble')[1]?.click();
  await new Promise(r=>setTimeout(r,400));
  return { entered, count: document.getElementById('chatSelectionCount')?.textContent,
    selected: document.querySelectorAll('#chatMessages .chat-message-bubble.is-selected').length,
    hasActions: document.querySelectorAll('.chat-selection-actions button').length };
});
console.log('  ' + JSON.stringify(multi));
check('a long press starts multi-select', multi.entered===true, JSON.stringify(multi));
check('tapping a second message adds it', Number(multi.count)>=2 && multi.selected>=2, JSON.stringify(multi));
check('the bar offers copy, forward and delete', multi.hasActions===3, String(multi.hasActions));
const copied = await A.evaluate(async ()=>{
  document.getElementById('chatSelectionCopyBtn')?.click();
  await new Promise(r=>setTimeout(r,900));
  return { clip: (window.__clip||[]).at(-1)||'', toast:(window.__toasts||[]).slice(-1)[0] };
});
console.log('  ' + JSON.stringify(copied).slice(0,160));
check('copying the selection puts both messages on the clipboard', (copied.clip.match(/\n/g)||[]).length>=1, JSON.stringify(copied.clip.slice(0,60)));
await A.evaluate(()=>document.getElementById('chatSelectionCancelBtn')?.click());
await A.waitForTimeout(400);
check('cancelling leaves selection mode', await A.evaluate(()=>document.getElementById('chatSelectionBar').classList.contains('hidden')));

for (const [tag,p] of [['A',A],['C',C]]) {
  const errs=await p.evaluate(()=>(window.__err||[]).filter(x=>!/SSL|Failed to load resource/.test(x)));
  check(`${tag}: no uncaught errors`, errs.length===0, JSON.stringify(errs.slice(0,2)));
}
const failing=results.filter(r=>!r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach(f=>console.log(`  FAIL ${f.n} — ${f.d}`));
await browser.close();
process.exit(failing.length?1:0);
