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
const browser=await chromium.launch();
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok,d});console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);};
async function app(tag){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:960}});
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
  await page.evaluate(url => { chatState.profile.serverUrl = url; saveProfile(); document.getElementById('chatConnectBtn')?.click(); }, process.env.RELAY_URL || BASE_URL);
  await page.waitForTimeout(6500);
  return page;
}
const A=await app('A'); const B=await app('B');
const idA=await A.evaluate(async()=>{await window.copyChatFullIdentity(); return window.__clip.at(-1);});
const idB=await B.evaluate(async()=>{await window.copyChatFullIdentity(); return window.__clip.at(-1);});
const imp=(p,x)=>p.evaluate(async(t)=>{document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value=t;
  document.querySelector('[data-chat-manual-submit]')?.click();},x);
await imp(B,idA);
await B.waitForTimeout(2500);
await B.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await B.waitForTimeout(4000);
for (const text of ['قرارداد فروش امضا شد','گزارش ماهانه آماده است','یادت باشد کلید را عوض کنی']) {
  await B.fill('#chatComposer', text);
  await B.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
  await B.waitForTimeout(700);
}
/* Wait for the messages to ARRIVE, not for six seconds to pass.
   A fixed wait is a measurement of one quiet machine baked in as a constant:
   in the full sweep, with other suites loading the same relay, delivery took
   longer than the guess and the search below found nothing — reported as
   "global search is broken" when the messages simply were not there yet. */
await A.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.waitForFunction(
  () => document.body.innerText.includes('گزارش ماهانه آماده است'),
  null, { timeout: 45000 }
).catch(() => console.log('  (the three messages never arrived on A within 45s)'));
await A.waitForTimeout(1200);

console.log('\n===== 1. global search =====');
await A.evaluate(() => openFullSearch());
await A.fill('#chatFsearchInput','گزارش');
await A.waitForTimeout(900);
const search = await A.evaluate(()=>({
  open: !document.getElementById('chatSearchOverlay').classList.contains('hidden'),
  hits: document.querySelectorAll('[data-fsearch-idx]').length,
  head: document.querySelector('.chat-fsearch-count')?.textContent.trim(),
  marks: document.querySelectorAll('.chat-fsearch-hit-snippet mark').length,
  groups: document.querySelectorAll('.chat-fsearch-hit-title').length,
}));
console.log('  ' + JSON.stringify(search));
check('searching finds the message across conversations', search.open && search.hits>=1, JSON.stringify(search));
check('the match is highlighted in the snippet', search.marks>=1, String(search.marks));
check('results identify their conversation', search.groups>=1, String(search.groups));

const jumped = await A.evaluate(async ()=>{
  document.querySelector('[data-fsearch-idx]')?.click();
  document.querySelector('[data-fsearch-jump]')?.click();
  await new Promise(r=>setTimeout(r,1500));
  return { panelClosed: document.getElementById('chatSearchOverlay').classList.contains('hidden'),
    highlighted: document.querySelectorAll('#chatMessages .fsearch-ring').length,
    inputCleared: (document.getElementById('chatFsearchInput')?.value||'')==='' };
});
console.log('  ' + JSON.stringify(jumped));
check('clicking a result jumps to the message and highlights it', jumped.panelClosed && jumped.highlighted>=1, JSON.stringify(jumped));

await A.evaluate(() => openFullSearch());
await A.fill('#chatFsearchInput','چیزی-که-وجود-ندارد');
await A.waitForTimeout(900);
const none = await A.evaluate(()=>document.querySelector('.chat-fsearch-hint')?.textContent.trim()||'');
check('a search with no results says so', none.length>0, none.slice(0,50));
await A.evaluate(()=>closeFullSearch());
await A.waitForTimeout(500);

console.log('\n===== 2. safety numbers =====');
await A.evaluate(()=>document.getElementById('chatVerifyKeyBtn')?.click());
await A.waitForTimeout(1200);
const safeA = await A.evaluate(()=>({
  open: !document.getElementById('chatSafetyPanel').classList.contains('hidden'),
  words: [...document.querySelectorAll('.chat-safety-words span')].map(e=>e.textContent.trim()),
  digits: [...document.querySelectorAll('.chat-safety-digits span')].map(e=>e.textContent.trim()),
  verified: document.querySelector('.chat-safety-state')?.classList.contains('is-verified'),
}));
await B.evaluate(()=>document.getElementById('chatVerifyKeyBtn')?.click());
await B.waitForTimeout(1200);
const safeB = await B.evaluate(()=>({
  words: [...document.querySelectorAll('.chat-safety-words span')].map(e=>e.textContent.trim()),
  digits: [...document.querySelectorAll('.chat-safety-digits span')].map(e=>e.textContent.trim()),
}));
console.log('  A: ' + JSON.stringify(safeA.digits) + ' ' + JSON.stringify(safeA.words));
console.log('  B: ' + JSON.stringify(safeB.digits) + ' ' + JSON.stringify(safeB.words));
check('the panel shows five words and six number groups', safeA.open && safeA.words.length===5 && safeA.digits.length===6, JSON.stringify(safeA));
check('both devices compute the SAME code', JSON.stringify(safeA.digits)===JSON.stringify(safeB.digits) && JSON.stringify(safeA.words)===JSON.stringify(safeB.words),
  `${safeA.digits.join('')} vs ${safeB.digits.join('')}`);
check('it starts unverified', safeA.verified===false);
await A.evaluate(()=>document.querySelector('[data-safety-toggle]')?.click());
await A.waitForTimeout(900);
const marked = await A.evaluate(()=>({
  verified: document.querySelector('.chat-safety-state')?.classList.contains('is-verified'),
  badge: document.getElementById('chatVerifyKeyBtn')?.classList.contains('is-verified'),
}));
check('marking verified sticks and badges the header', marked.verified && marked.badge, JSON.stringify(marked));
await A.evaluate(()=>document.querySelector('[data-safety-close]')?.click());

console.log('\n===== 3. chat lock =====');
await A.evaluate(()=>document.querySelector('[data-chat-view="connection"]')?.click());
await A.waitForTimeout(1000);
/* The PIN is asked for through the app's own modal, not window.prompt - the
   native shell returns null from window.prompt without showing anything, and
   a PIN echoed in a browser prompt is a lock that shows its own key. Type
   into the modal and press its button, the way a person would. */
const answerPrompt = async (p, value) => {
  await p.waitForSelector('.poorija-dialog-backdrop:not(.hidden) .poorija-dialog-input', { timeout: 5000 }).catch(()=>{});
  await p.evaluate((v)=>{
    const input=document.querySelector('.poorija-dialog-backdrop:not(.hidden) .poorija-dialog-input');
    if (input) { input.value=v; input.dispatchEvent(new Event('input',{bubbles:true})); }
    const confirm=document.querySelector('.poorija-dialog-confirm-input'); if(confirm) confirm.value=v;
    document.querySelector('.poorija-dialog-backdrop:not(.hidden) .poorija-dialog-ok')?.click();
  }, value);
  await p.waitForTimeout(800);
};
await A.evaluate(()=>document.getElementById('chatLockToggle').click());
/* Asked twice on purpose: a PIN typed blind and confirmed. */
await answerPrompt(A, 'Shared2468');
await A.waitForTimeout(2000);
const enabled = await A.evaluate(()=>({
  toggle: document.getElementById('chatLockToggle')?.checked,
  toast: (window.__toasts||[]).slice(-1)[0],
  stored: Boolean(localStorage.getItem('poorija_vault_lock')),
  raw: (localStorage.getItem('poorija_vault_lock')||'').includes('2468'),
}));
console.log('  ' + JSON.stringify(enabled));
check('the lock turns on', enabled.toggle && enabled.stored, JSON.stringify(enabled));
check('the PIN itself is never written to storage', enabled.raw===false);

const locked = await A.evaluate(async ()=>{
  lockChatNowProbe?.();
  return null;
}).catch(()=>null);
await A.evaluate(()=>{ document.getElementById('chatLockGate'); });
// leave the tab so the watcher locks it, then come back
await A.evaluate(()=>{ window.__forceLock = true; });
await A.evaluate(()=>{ const g=document.getElementById('chatLockGate'); return g && g.className; });
await A.evaluate(()=>window.switchTab?.('encrypt'));
await A.waitForTimeout(1200);
await A.evaluate(()=>window.switchTab?.('chat'));
await A.waitForTimeout(1200);
// force the lock deterministically instead of waiting five minutes
await A.evaluate(()=>{
  const cfg = JSON.parse(JSON.stringify({}));
  document.getElementById('chatLockMinutes').value='1';
  document.getElementById('chatLockMinutes').dispatchEvent(new Event('change',{bubbles:true}));
});
await A.reload({waitUntil:'load'});
await A.waitForTimeout(1800);
await A.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p;el.dispatchEvent(new Event('input',{bubbles:true}));}},PASS);
await A.evaluate(()=>window.unlockApp?.());
await A.waitForTimeout(3000);
await A.evaluate(()=>{document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');});
await A.waitForTimeout(2500);
const afterReload = await A.evaluate(()=>({
  gateVisible: document.getElementById('content-chat')?.classList.contains('shared-section-locked'),
  messagesHidden: document.querySelectorAll('.chat-message-text').length,
}));
console.log('  after reload: ' + JSON.stringify(afterReload));
check('a fresh session starts locked', afterReload.gateVisible, JSON.stringify(afterReload));

await A.fill('#content-chat [data-shared-password]','0000');
await A.click('#content-chat [data-shared-open]');
await A.waitForTimeout(1500);
const wrong = await A.evaluate(()=>({
  errorShown: vaultLockState().attempts === 1,
  stillLocked: !vaultLockState().unlocked,
}));
check('a wrong PIN is refused', wrong.errorShown && wrong.stillLocked, JSON.stringify(wrong));
await A.fill('#content-chat [data-shared-password]','Shared2468');
await A.click('#content-chat [data-shared-open]');
await A.waitForTimeout(1500);
const right = await A.evaluate(()=>({
  gateHidden: vaultLockState().unlocked,
  cards: document.querySelectorAll('#chatPeerList .chat-peer-card').length,
}));
console.log('  unlocked: ' + JSON.stringify(right));
check('the right PIN opens it', right.gateHidden, JSON.stringify(right));

for (const [tag,p] of [['A',A],['B',B]]) {
  const errs=await p.evaluate(()=>(window.__err||[]).filter(x=>!/SSL|Failed to load resource/.test(x)));
  check(`${tag}: no uncaught errors`, errs.length===0, JSON.stringify(errs.slice(0,2)));
}
const failing=results.filter(r=>!r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach(f=>console.log(`  FAIL ${f.n} — ${f.d}`));
await browser.close();
process.exit(failing.length?1:0);
