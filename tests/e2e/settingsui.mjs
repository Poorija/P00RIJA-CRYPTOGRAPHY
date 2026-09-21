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
async function app(tag, viewport={width:1440,height:900}){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport});
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
  await page.evaluate(()=>{window.__toasts=[];
    document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');});
  await page.waitForTimeout(1200);
  return page;
}
const A=await app('ALPHA');

console.log('\n===== 1. the section is called what it is =====');
const nav = await A.evaluate(()=>[...document.querySelectorAll('.chat-nav-item')].map(b=>({
  view:b.getAttribute('data-chat-view'), label:b.textContent.replace(/\s+/g,' ').trim()})));
console.log('  ' + JSON.stringify(nav));
check('the fourth section is called Settings', /^تنظیمات$/.test((nav.find(n=>n.view==='connection')?.label||'').trim()), JSON.stringify(nav.map(n=>n.label)));

console.log('\n===== 2. the placeholder card is gone =====');
await A.evaluate(()=>document.querySelector('[data-chat-view="connection"]')?.click());
await A.waitForTimeout(900);
const placeholder = await A.evaluate(()=>{
  const heading=document.querySelector('.chat-list-heading');
  const list=document.getElementById('chatPeerList');
  return {
    headingVisible: Boolean(heading && heading.offsetParent !== null),
    listVisible: Boolean(list && list.offsetParent !== null),
    listText: (list?.textContent||'').replace(/\s+/g,' ').trim().slice(0,60),
    startChatVisible: Boolean(document.getElementById('chatStartChatBtn')?.offsetParent),
  };
});
console.log('  ' + JSON.stringify(placeholder));
check('no list heading in the settings view', !placeholder.headingVisible, JSON.stringify(placeholder));
check('no "start chat" button there either', !placeholder.startChatVisible, String(placeholder.startChatVisible));
check('and no explanatory placeholder card', !placeholder.listVisible && !/تنظیمات اتصال/.test(placeholder.listText), JSON.stringify(placeholder.listText));

console.log('\n===== 3. the settings are tabbed =====');
const tabs = await A.evaluate(()=>{
  const bar=document.querySelector('#chatSettingsStage .chat-settings-tabbar, #chatConnectionPanel .chat-settings-tabbar');
  return {
    bar: Boolean(bar),
    tabs: [...document.querySelectorAll('#chatSettingsStage [data-settings-tab], #chatConnectionPanel [data-settings-tab]')].map(b=>b.getAttribute('data-settings-tab')),
    on: document.querySelector('#chatSettingsStage [data-settings-tab], #chatSettingsStage [data-settings-tab].is-on, #chatConnectionPanel [data-settings-tab].is-on')?.getAttribute('data-settings-tab'),
    visiblePanes: [...document.querySelectorAll('#chatSettingsStage [data-settings-pane], #chatConnectionPanel [data-settings-pane]')].filter(p=>!p.classList.contains('hidden')).map(p=>p.getAttribute('data-settings-pane')),
  };
});
console.log('  ' + JSON.stringify(tabs));
/* The tab BAR is gone: settings became a flat list of sections that open as
   full pages, so what has to hold is that every one is reachable and that one
   is open at a time — not that a particular strip element exists.
   Five became eight when Appearance, Chat notifications and Files & privacy
   were split out of Connection & TURN, which had been collecting every card
   the builder was not told where to put. */
check('all eight settings sections are reachable',
  tabs.tabs.join(',')==='appearance,notifications,sounds,privacy,connection,lock,storage,tools',
  JSON.stringify(tabs.tabs));
check('exactly one section is open at a time', tabs.visiblePanes.length===1 && tabs.visiblePanes[0]===tabs.on, JSON.stringify(tabs.visiblePanes));

const where = async (id) => A.evaluate((elId)=>{
  const el=document.getElementById(elId);
  const pane=el?.closest('[data-settings-pane]');
  return {found:Boolean(el), pane:pane?.getAttribute('data-settings-pane')||null};
}, id);
const placements = {
  relay: await where('chatServerUrl'),
  turn: await where('chatTurnUrl'),
  diag: await where('chatDiagBtn'),
  prune: await where('chatPruneContactsBtn'),
  ringtone: await where('chatRingtoneSelect'),
  messageTone: await where('chatMessageToneSelect'),
  lock: await where('chatLockToggle'),
  vault: await where('chatStorageCard'),
  files: await where('chatFileManagerToggle'),
};
console.log('  ' + JSON.stringify(placements));
check('connection keeps only the relay and TURN', placements.relay.pane==='connection' && placements.turn.pane==='connection', JSON.stringify([placements.relay,placements.turn]));
check('the status report and contact cleanup moved to Tools', placements.diag.pane==='tools' && placements.prune.pane==='tools', JSON.stringify([placements.diag,placements.prune]));
check('the ringtone and the message sound moved to Sounds', placements.ringtone.pane==='sounds' && placements.messageTone.pane==='sounds', JSON.stringify([placements.ringtone,placements.messageTone]));
check('the chat lock has its own section', placements.lock.pane==='lock', JSON.stringify(placements.lock));
check('the encrypted vault and the file manager have theirs', placements.vault.pane==='storage' && placements.files.pane==='storage', JSON.stringify([placements.vault,placements.files]));

console.log('\n===== 4. switching tabs works and is remembered =====');
const switched = await A.evaluate(async ()=>{
  document.querySelector('[data-settings-tab="lock"]')?.click();
  await new Promise(r=>setTimeout(r,500));
  const lockVisible = Boolean(document.getElementById('chatLockToggle')?.offsetParent);
  const relayVisible = Boolean(document.getElementById('chatServerUrl')?.offsetParent);
  return {lockVisible, relayVisible, stored: localStorage.getItem('poorija_chat_settings_tab')};
});
console.log('  ' + JSON.stringify(switched));
check('picking a tab shows it and hides the others', switched.lockVisible && !switched.relayVisible, JSON.stringify(switched));
check('the choice is stored', switched.stored==='lock', String(switched.stored));
await A.reload({waitUntil:'load'});
await A.waitForTimeout(2200);
await A.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p;el.dispatchEvent(new Event('input',{bubbles:true}));}},PASS);
await A.evaluate(()=>window.unlockApp?.());
await A.waitForTimeout(4500);
const remembered = await A.evaluate(async ()=>{
  window.switchTab?.('chat');
  await new Promise(r=>setTimeout(r,900));
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise(r=>setTimeout(r,700));
  return {on: document.querySelector('#chatSettingsStage [data-settings-tab], #chatSettingsStage [data-settings-tab].is-on, #chatConnectionPanel [data-settings-tab].is-on')?.getAttribute('data-settings-tab'),
    lockVisible: Boolean(document.getElementById('chatLockToggle')?.offsetParent),
    controlsAlive: Boolean(document.getElementById('chatLockToggle'))};
});
console.log('  ' + JSON.stringify(remembered));
check('it comes back on the same tab after a reload', remembered.on==='lock' && remembered.lockVisible, JSON.stringify(remembered));

console.log('\n===== 5. the controls still work after being moved =====');
const stillWired = await A.evaluate(async ()=>{
  document.querySelector('[data-settings-tab="tools"]')?.click();
  await new Promise(r=>setTimeout(r,400));
  const body=document.getElementById('chatDiagBody');
  const before=body?.hidden;
  document.getElementById('chatDiagBtn')?.click();
  await new Promise(r=>setTimeout(r,1200));
  return {before, after: body?.hidden, text: (body?.textContent||'').slice(0,40)};
});
console.log('  ' + JSON.stringify(stillWired));
check('the status report still runs from its new home', stillWired.before===true && stillWired.after===false && stillWired.text.length>5, JSON.stringify(stillWired));
const storageWorks = await A.evaluate(async ()=>{
  document.querySelector('[data-settings-tab="storage"]')?.click();
  await new Promise(r=>setTimeout(r,1200));
  return {rows: document.querySelectorAll('#chatStorageStats .chat-storage-row').length,
    fileBtn: Boolean(document.getElementById('chatFileManagerToggle')?.offsetParent)};
});
console.log('  ' + JSON.stringify(storageWorks));
check('the vault card still draws its numbers', storageWorks.rows>=3 && storageWorks.fileBtn, JSON.stringify(storageWorks));

console.log('\n===== 6. every pane holds its contents =====');
/* A real TURN list is long enough to have dragged the whole pane sideways. */
await A.evaluate(()=>{
  const el=document.getElementById('chatTurnUrl');
  if(el){el.value='turn:chat.example.com:3478?transport=udp,turn:chat.example.com:3478?transport=tcp,turns:chat.example.com:5349?transport=tcp';el.dispatchEvent(new Event('input',{bubbles:true}));}
  const s=document.getElementById('chatServerUrl'); if(s){s.value='https://chat.example.com:8585';s.dispatchEvent(new Event('input',{bubbles:true}));}
});
const overflow = [];
for (const tab of ['connection','sounds','lock','storage','tools']) {
  // eslint-disable-next-line no-await-in-loop
  overflow.push(await A.evaluate((id)=>{
    document.querySelector(`[data-settings-tab="${id}"]`)?.click();
    const pane=document.querySelector(`[data-settings-pane="${id}"]`);
    const pr=pane.getBoundingClientRect();
    let worst=0; let who='';
    pane.querySelectorAll('*').forEach((el)=>{
      const r=el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const out=Math.max(pr.left-r.left, r.right-pr.right);
      if (out>worst) { worst=Math.round(out); who=(el.id||el.className||el.tagName).toString().slice(0,26); }
    });
    return {pane:id, w:Math.round(pr.width), scrollW:pane.scrollWidth, worst, who};
  }, tab));
  // eslint-disable-next-line no-await-in-loop
  await A.waitForTimeout(200);
}
console.log('  ' + JSON.stringify(overflow));
check('nothing spills out of any pane', overflow.every(o=>o.worst<=2), JSON.stringify(overflow.filter(o=>o.worst>2)));
check('and no pane scrolls sideways', overflow.every(o=>o.scrollW<=o.w+2), JSON.stringify(overflow.map(o=>[o.pane,o.scrollW,o.w])));
const connect = await A.evaluate(()=>{
  document.querySelector('[data-settings-tab="connection"]')?.click();
  const pane=document.querySelector('[data-settings-pane="connection"]');
  const pr=pane.getBoundingClientRect();
  const inside=(el)=>{const r=el.getBoundingClientRect(); return r.left>=pr.left-2 && r.right<=pr.right+2 && r.width>0;};
  return {
    turn: inside(document.getElementById('chatTurnUrl')),
    relay: inside(document.getElementById('chatServerUrl')),
    connectBtn: inside(document.getElementById('chatConnectBtn')),
    discoverBtn: inside(document.getElementById('chatDiscoverLocalBtn')),
    switchVisible: inside(document.querySelector('#chatAutoConnect')?.closest('.chat-settings-switch')),
  };
});
console.log('  ' + JSON.stringify(connect));
check('the TURN and relay fields are reachable inside the card', connect.turn && connect.relay, JSON.stringify(connect));
check('so are all three connection buttons', connect.connectBtn && connect.discoverBtn, JSON.stringify(connect));
check('and the toggles show their switches', connect.switchVisible, String(connect.switchVisible));

console.log('\n===== 7. the chat lock reads as rows, not a jumble =====');
const lock = await A.evaluate(()=>{
  document.querySelector('[data-settings-tab="lock"]')?.click();
  /* Settings sections were moved out of #chatConnectionPanel and into
     #chatSettingsStage when they became full-page sections; this suite still
     looked in the old container and silently found nothing.

     And scoped to the CHAT LOCK CARD, not to the whole stage. `.chat-lock-row`
     is a layout primitive — label on one line, control at the end — and the
     storage card uses it too, for the auto-download limit. Selecting it stage
     wide pulled that row in as well: three rows where two were asserted, and
     the extra one measured zero-height because its card is hidden while the
     lock tab is showing, which then failed every per-row assertion for a
     reason that had nothing to do with the chat lock. */
  const card = document.getElementById('chatLockToggle')?.closest('.chat-storage-card');
  const rows=[...(card ? card.querySelectorAll('.chat-lock-row') : [])].map((row)=>{
    const rr=row.getBoundingClientRect();
    const label=row.querySelector('span, label');
    const control=row.querySelector('input, select');
    const lr=label?.getBoundingClientRect(); const cr=control?.getBoundingClientRect();
    return {
      h:Math.round(rr.height),
      sameLine: Boolean(lr&&cr) && Math.abs((lr.top+lr.height/2)-(cr.top+cr.height/2)) < 8,
      controlAtEnd: Boolean(lr&&cr) && cr.left < lr.left,
      usesWidth: Boolean(lr) && lr.width > rr.width*0.5,
      controlW: cr?Math.round(cr.width):0,
    };
  });
  return rows;
});
console.log('  ' + JSON.stringify(lock));
check('each setting is one line: label, then its control', lock.length===2 && lock.every(r=>r.sameLine), JSON.stringify(lock));
check('the control sits at the far end of the row', lock.every(r=>r.controlAtEnd), JSON.stringify(lock.map(r=>r.controlAtEnd)));
check('the label uses the width instead of wrapping into a sliver', lock.every(r=>r.usesWidth && r.h<=56), JSON.stringify(lock.map(r=>[r.usesWidth,r.h])));
check('the checkbox is a checkbox, not a stretched bar',
  lock.length>0 && lock[0].controlW>10 && lock[0].controlW<40, JSON.stringify(lock.map(r=>r.controlW)));

console.log('\n===== 8. making a group is a dialog, not a fold =====');
/* It used to be a name field folded into an accordion above the list, with the
   picture, the description and the permissions each somewhere else afterwards
   - so a group was made half-finished and then repaired. The fold is gone; the
   question these checks ask is whether the one dialog covers the whole
   decision. */
const groups = await A.evaluate(async ()=>{
  document.querySelector('[data-chat-view="groups"]')?.click();
  await new Promise(r=>setTimeout(r,900));
  const btn=document.getElementById('chatStartChatBtn');
  const label=btn?.querySelector('span')?.textContent?.trim()||'';
  const action=btn?.dataset.action||'';
  const listBefore=document.getElementById('chatPeerList')?.getBoundingClientRect().height||0;
  const hiddenBefore=document.getElementById('chatGroupMaker')?.classList.contains('hidden');
  btn?.click();
  await new Promise(r=>setTimeout(r,800));
  const open=!document.getElementById('chatGroupMaker')?.classList.contains('hidden');
  const fields={
    name:Boolean(document.getElementById('chatGroupNameInput')),
    about:Boolean(document.getElementById('chatGroupMakerAbout')),
    avatar:Boolean(document.getElementById('chatGroupMakerAvatarBtn')),
    perms:document.querySelectorAll('[data-group-maker-perm]').length,
    /* Presence, not population: this suite runs one browser, so there is
       nobody to pick and the panel shows its empty state instead of rows. */
    picker:Boolean(document.getElementById('chatGroupMembersPanel')),
    pickerRows:document.querySelectorAll('#chatGroupMembersPanel input[type=checkbox]').length,
  };
  document.querySelector('[data-group-maker-close]')?.click();
  await new Promise(r=>setTimeout(r,400));
  const closed=document.getElementById('chatGroupMaker')?.classList.contains('hidden');
  const listAfter=document.getElementById('chatPeerList')?.getBoundingClientRect().height||0;
  return {label,action,hiddenBefore,open,closed,fields,listBefore:Math.round(listBefore),listAfter:Math.round(listAfter)};
});
console.log('  ' + JSON.stringify(groups));
check('the button above the group list offers a group, not a chat',
  groups.action==='new-group' && /گروه|group/i.test(groups.label), JSON.stringify({a:groups.action,l:groups.label}));
check('nothing takes room from the list until it is asked for',
  groups.hiddenBefore===true && groups.listBefore===groups.listAfter,
  JSON.stringify({hidden:groups.hiddenBefore,b:groups.listBefore,a:groups.listAfter}));
check('it opens as a dialog and closes again', groups.open && groups.closed, JSON.stringify({o:groups.open,c:groups.closed}));

console.log('\n===== 9. the dialog covers the whole decision =====');
console.log('  ' + JSON.stringify(groups.fields));
check('name, picture and description are all in it',
  groups.fields.name && groups.fields.avatar && groups.fields.about, JSON.stringify(groups.fields));
check('so are the members and what they may do',
  groups.fields.picker && groups.fields.perms >= 6, JSON.stringify(groups.fields));

const errs = await A.evaluate(()=>window.__err.slice(0,4));
check('no page errors', errs.length===0, JSON.stringify(errs));
await A.evaluate(()=>document.querySelector('[data-chat-view="connection"]')?.click());
await A.waitForTimeout(700);
await A.screenshot({path:`${SHOTS}/settings-tabs.png`});
const bad=results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
bad.forEach(r=>console.log('  FAIL ' + r.n + (r.d?'  — '+r.d:'')));
await browser.close();
