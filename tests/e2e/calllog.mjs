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
const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});
await ctx.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){} window.__err=[];
  window.addEventListener('error',e=>window.__err.push('ERR '+e.message));});
const page=await ctx.newPage();
page.on('dialog',d=>d.accept());
page.on('pageerror',e=>console.log('  !! '+e.message.slice(0,140)));
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
await page.waitForTimeout(3000);
await page.evaluate(()=>{document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');});
await page.waitForTimeout(1200);

const seed = async () => page.evaluate(()=>{
  window.__seedCallLog([]);            // ensure the hook exists
  const now = Date.now();
  const day = 86400000;
  const rows = [
    {peerId:'p-ali', name:'Ali',  direction:'in',  status:'incoming', mode:'voice', durationMs:65000, createdAt:new Date(now-1*3600e3).toISOString()},
    {peerId:'p-ali', name:'Ali',  direction:'in',  status:'missed',   mode:'video', createdAt:new Date(now-2*3600e3).toISOString()},
    {peerId:'p-ali', name:'Ali',  direction:'out', status:'outgoing', mode:'voice', durationMs:12000, createdAt:new Date(now-3*3600e3).toISOString()},
    {peerId:'p-sara',name:'Sara', direction:'out', status:'outgoing', mode:'video', durationMs:300000,createdAt:new Date(now-4*3600e3).toISOString()},
    {peerId:'p-sara',name:'Sara', direction:'in',  status:'missed',   mode:'voice', createdAt:new Date(now-5*3600e3).toISOString()},
    {peerId:'p-reza',name:'Reza', direction:'in',  status:'incoming', mode:'voice', durationMs:9000, createdAt:new Date(now-40*day).toISOString()},
    {peerId:'p-reza',name:'Reza', direction:'out', status:'outgoing', mode:'voice', durationMs:4000, createdAt:new Date(now-45*day).toISOString()},
  ];
  return window.__seedCallLog(rows);
});
const openCalls = async () => { await page.evaluate(()=>document.querySelector('[data-chat-view="calls"]')?.click()); await page.waitForTimeout(700); };
const view = () => page.evaluate(()=>{
  const scope=document.querySelector('[data-calls-work]');
  return {
    total: window.__callCount ? window.__callCount() : null,
    tabs: [...scope.querySelectorAll('[data-chat-call-filter]')].map(b=>({id:b.getAttribute('data-chat-call-filter'), n:b.querySelector('strong')?.textContent})),
    active: scope.querySelector('.chat-call-filter-tab.active')?.getAttribute('data-chat-call-filter'),
    groups: [...scope.querySelectorAll('.chat-call-accordion')].map(a=>({
      name:a.querySelector('.font-semibold')?.textContent.trim(),
      count:Number(a.querySelector('.chat-call-count')?.textContent||0),
      rows:a.querySelectorAll('.chat-call-log-row').length })),
    rows: scope.querySelectorAll('.chat-call-log-row').length,
    delButtons: scope.querySelectorAll('[data-chat-call-delete]').length,
    groupDel: scope.querySelectorAll('[data-chat-call-group-delete]').length,
    selectBar: Boolean(scope.querySelector('.chat-call-selectbar')),
    checks: scope.querySelectorAll('[data-chat-call-select]').length,
    empty: Boolean(scope.querySelector('.chat-empty-state')),
  };
});
const stored = () => page.evaluate(()=>document.querySelectorAll('[data-calls-work] .chat-call-log-row').length);


/* Destructive actions go through the app's own modal (js/dialogs.js), not
   window.confirm - so accepting a native dialog confirms nothing. Press the
   modal's OK the way a person would. */
const confirmModal = async () => {
  await page.waitForSelector('.poorija-dialog-backdrop:not(.hidden) .poorija-dialog-ok', { timeout: 4000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('.poorija-dialog-backdrop:not(.hidden) .poorija-dialog-ok')?.click());
  await page.waitForTimeout(500);
};

console.log('\n===== 1. the log lists, groups and filters =====');
const seeded = await seed();
await openCalls();
const v1 = await view();
console.log('  ' + JSON.stringify(v1).slice(0,420));
check('seven calls are staged', seeded===7, String(seeded));
check('there are four sections including All', v1.tabs.map(t=>t.id).join(',')==='all,incoming,outgoing,missed', JSON.stringify(v1.tabs.map(t=>t.id)));
check('All is the default and shows every call', v1.active==='all' && v1.rows===7, JSON.stringify({active:v1.active,rows:v1.rows}));
check('calls are grouped per person', v1.groups.length===3 && v1.groups.every(g=>g.count===g.rows), JSON.stringify(v1.groups));
check('the section counts add up', v1.tabs.find(t=>t.id==='missed').n==='2' && v1.tabs.find(t=>t.id==='outgoing').n==='3', JSON.stringify(v1.tabs));
check('every row offers a delete', v1.delButtons===7 && v1.groupDel===3, JSON.stringify({rows:v1.delButtons,groups:v1.groupDel}));
/* fa-phone-arrow-up-right is a FontAwesome Pro glyph and this build ships the
   free set, so the redial button used to render as an empty circle. */
const redial = await page.evaluate(()=>{
  const icon=document.querySelector('[data-calls-work] .chat-call-redial-btn i');
  if(!icon) return null;
  const cs=getComputedStyle(icon,'::before');
  return {cls:icon.className, glyph:cs.content, font:cs.fontFamily};
});
console.log('  ' + JSON.stringify(redial));
check('the redial icon is a glyph that exists in the bundled font',
  redial && redial.glyph && redial.glyph!=='none' && redial.glyph!=='""', JSON.stringify(redial));

await page.screenshot({path:`${SHOTS}/calllog-full.png`});

console.log('\n===== 2. filtering and searching =====');
await page.evaluate(()=>document.querySelector('[data-chat-call-filter="missed"]')?.click());
await page.waitForTimeout(500);
const missed = await view();
check('the missed section shows only missed calls', missed.rows===2 && missed.groups.length===2, JSON.stringify({rows:missed.rows,groups:missed.groups.length}));
await page.evaluate(()=>{const b=document.querySelector('[data-chat-call-search]'); b.value='sara'; b.dispatchEvent(new Event('input',{bubbles:true}));});
await page.waitForTimeout(700);
const searched = await view();
console.log('  ' + JSON.stringify(searched.groups));
check('search narrows within the section', searched.rows===1 && /Sara/i.test(searched.groups[0]?.name||''), JSON.stringify(searched.groups));
await page.evaluate(()=>{const b=document.querySelector('[data-chat-call-search]'); b.value=''; b.dispatchEvent(new Event('input',{bubbles:true}));});
await page.waitForTimeout(700);
await page.evaluate(()=>document.querySelector('[data-chat-call-filter="all"]')?.click());
await page.waitForTimeout(500);

console.log('\n===== 3. deleting one call =====');
const before3 = (await view()).rows;
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-delete]')?.click());
await confirmModal();
await page.waitForTimeout(900);
const after3 = await view();
check('one call disappears', after3.rows===before3-1, `${before3} -> ${after3.rows}`);
await page.reload({waitUntil:'load'});
await page.waitForTimeout(2200);
await page.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p;el.dispatchEvent(new Event('input',{bubbles:true}));}},PASS);
await page.evaluate(()=>window.unlockApp?.());
await page.waitForTimeout(4500);
await page.evaluate(()=>{window.switchTab?.('chat');});
await page.waitForTimeout(1200);
await openCalls();
const afterReload = await view();
check('and stays deleted after a reload', afterReload.rows===before3-1, `${afterReload.rows}`);

console.log('\n===== 4. deleting a whole run =====');
const before4 = await view();
/* The delete button clicked below belongs to the first group in the DOM, so
   that is the run whose size the assertion has to use. */
const firstGroup = before4.groups[0];
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-group-delete]')?.click());
await confirmModal();
await page.waitForTimeout(1000);
const after4 = await view();
console.log('  ' + JSON.stringify({before:before4.rows, firstGroup, after:after4.rows, groups:after4.groups.map(g=>g.name)}));
check('a whole person\'s run goes at once',
  after4.rows===before4.rows-firstGroup.rows
  && after4.groups.length===before4.groups.length-1
  && !after4.groups.some(g=>g.name===firstGroup.name),
  JSON.stringify({b:before4.rows,a:after4.rows,gone:firstGroup.name}));

console.log('\n===== 5. select mode =====');
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-select-mode]')?.click());
await page.waitForTimeout(700);
const sel1 = await view();
check('select mode shows a checkbox on every row', sel1.selectBar && sel1.checks===sel1.rows, JSON.stringify({bar:sel1.selectBar,checks:sel1.checks,rows:sel1.rows}));
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-select]')?.click());
await page.waitForTimeout(600);
const counted = await page.evaluate(()=>document.querySelector('[data-calls-work] .chat-call-selectcount')?.textContent.trim());
check('picking one is counted', /1/.test(counted||''), counted);
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-select-all]')?.click());
await page.waitForTimeout(600);
const allCount = await page.evaluate(()=>document.querySelector('[data-calls-work] .chat-call-selectcount')?.textContent.trim());
const rowsNow = (await view()).rows;
check('select-all takes everything visible', new RegExp(String(rowsNow)).test(allCount||''), `${allCount} vs ${rowsNow} rows`);
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-delete-selected]')?.click());
await confirmModal();
await page.waitForTimeout(1200);
const after5 = await view();
check('deleting the selection empties the section', after5.rows===0 && after5.empty, JSON.stringify({rows:after5.rows,empty:after5.empty}));

console.log('\n===== 6. clearing older than 30 days =====');
await page.evaluate(()=>{ window.__seedCallLog([]); });
await seed();
await page.waitForTimeout(600);
await openCalls();
const before6 = (await view()).rows;
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-menu]')?.click());
await page.waitForTimeout(400);
const menuOpen = await page.evaluate(()=>{
  const panel=document.querySelector('[data-calls-work] [data-chat-call-menu-panel]');
  return {open: panel && !panel.classList.contains('hidden'),
    options: [...(panel?.querySelectorAll('[data-chat-call-clear]')||[])].map(b=>b.getAttribute('data-chat-call-clear'))};
});
console.log('  ' + JSON.stringify(menuOpen));
check('the cleanup menu offers section, old and everything', menuOpen.open && menuOpen.options.join(',')==='section,old,all', JSON.stringify(menuOpen.options));
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-clear="old"]')?.click());
await confirmModal();
await page.waitForTimeout(1200);
const after6 = await view();
console.log('  ' + JSON.stringify({before:before6, after:after6.rows, groups:after6.groups.map(g=>g.name)}));
check('only the two 40-day-old calls go', after6.rows===before6-2, `${before6} -> ${after6.rows}`);
check('and the recent ones are untouched', after6.groups.some(g=>/Ali/.test(g.name||'')) && !after6.groups.some(g=>/Reza/.test(g.name||'')), JSON.stringify(after6.groups.map(g=>g.name)));

console.log('\n===== 7. clearing one section leaves the others =====');
await page.evaluate(()=>document.querySelector('[data-chat-call-filter="missed"]')?.click());
await page.waitForTimeout(600);
const missedBefore = (await view()).rows;
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-menu]')?.click());
await page.waitForTimeout(300);
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-clear="section"]')?.click());
await confirmModal();
await page.waitForTimeout(1200);
const missedAfter = await view();
await page.evaluate(()=>document.querySelector('[data-chat-call-filter="all"]')?.click());
await page.waitForTimeout(600);
const allAfter = await view();
console.log('  ' + JSON.stringify({missedBefore, missedAfter:missedAfter.rows, allAfter:allAfter.rows}));
check('the missed section empties', missedAfter.rows===0, String(missedAfter.rows));
check('the rest of the log survives', allAfter.rows>0, String(allAfter.rows));

console.log('\n===== 8. erasing the whole log =====');
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-menu]')?.click());
await page.waitForTimeout(300);
await page.evaluate(()=>document.querySelector('[data-calls-work] [data-chat-call-clear="all"]')?.click());
await confirmModal();
await page.waitForTimeout(1200);
const after8 = await view();
check('everything is gone', after8.rows===0 && after8.empty, JSON.stringify({rows:after8.rows,empty:after8.empty}));
check('every section reads zero', after8.tabs.every(t=>t.n==='0'), JSON.stringify(after8.tabs));
await page.reload({waitUntil:'load'});
await page.waitForTimeout(2200);
await page.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p;el.dispatchEvent(new Event('input',{bubbles:true}));}},PASS);
await page.evaluate(()=>window.unlockApp?.());
await page.waitForTimeout(4500);
await page.evaluate(()=>{window.switchTab?.('chat');});
await page.waitForTimeout(1200);
await openCalls();
const finalView = await view();
check('and it stays empty across a reload', finalView.rows===0, String(finalView.rows));

const errs = await page.evaluate(()=>window.__err.slice(0,4));
check('no page errors', errs.length===0, JSON.stringify(errs));
await page.screenshot({path:`${SHOTS}/calllog.png`});
const bad=results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
bad.forEach(r=>console.log('  FAIL ' + r.n + (r.d?'  — '+r.d:'')));
await browser.close();
