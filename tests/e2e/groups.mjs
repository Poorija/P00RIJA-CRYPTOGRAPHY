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
const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok,d});console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);};
async function app(tag){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900},permissions:['microphone']});
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

const A=await app('ALPHA'); const B=await app('BETA'); const C=await app('GAMMA');
const idA=await id(A), idB=await id(B), idC=await id(C);
await imp(A,idB); await imp(A,idC);
await imp(B,idA); await imp(B,idC);
await imp(C,idA); await imp(C,idB);
await A.waitForTimeout(4000);

console.log('\n===== 1. creating a group =====');
await A.evaluate(()=>document.querySelector('[data-chat-view="groups"]')?.click());
await A.waitForTimeout(1200);
await A.evaluate(()=>document.getElementById('chatStartChatBtn')?.click());
await A.waitForTimeout(800);
const composer = await A.evaluate(()=>({
  nameInput: Boolean(document.getElementById('chatGroupNameInput')),
  memberPicker: Boolean(document.getElementById('chatGroupMembersPanel')),
  members: document.querySelectorAll('#chatGroupMembersPanel input[type="checkbox"], #chatGroupMembersPanel [data-space-member]').length,
  html: document.getElementById('chatGroupMembersPanel')?.innerHTML.slice(0,180),
}));
await A.evaluate(()=>document.querySelector('[data-group-maker-close]')?.click());
await A.waitForTimeout(400);
console.log('  ' + JSON.stringify(composer));
check('the group composer offers a name field and a member picker', composer.nameInput && composer.memberPicker, JSON.stringify({n:composer.nameInput,m:composer.memberPicker}));
check('it lists the contacts to pick from', composer.members >= 2, `${composer.members} selectable`);

/* Making a group is a dialog now, opened from the heading button above the
   list - not a fold that had to be prised open first. */
await A.evaluate(()=>document.getElementById('chatStartChatBtn')?.click());
await A.waitForTimeout(800);
await A.fill('#chatGroupNameInput','تیم امنیت');
// Identify peers by fingerprint, not by display name: the relay also
// advertises real devices and every harness peer boots with the same default
// name, so a name filter picks the wrong people.
const fpB = JSON.parse(atob(idB.replace('poorija-chat-v1:',''))).fingerprint;
const fpC = JSON.parse(atob(idC.replace('poorija-chat-v1:',''))).fingerprint;
const picked = await A.evaluate(({b,c})=>{
  const chosen=[];
  document.querySelectorAll('#chatGroupMembersPanel input[type="checkbox"]').forEach((box)=>{
    const want = box.value===b || box.value===c;
    box.checked = want;
    box.dispatchEvent(new Event('change',{bubbles:true}));
    if (want) chosen.push(box.value.slice(0,10));
  });
  return chosen;
}, {b:fpB, c:fpC});
console.log('  picked members: ' + JSON.stringify(picked));
await A.waitForTimeout(600);
await A.evaluate(()=>document.getElementById('chatCreateGroupBtn')?.click());
await A.waitForTimeout(3000);
const made = await A.evaluate(()=>({
  name: [...document.querySelectorAll('#chatPeerList .chat-peer-card')].map(c=>c.textContent.replace(/\s+/g,' ').trim().slice(0,30)).join(' | '),
  cards: document.querySelectorAll('#chatPeerList .chat-peer-card').length,
}));
console.log('  A: ' + JSON.stringify(made));
check('the group is created locally', made.cards >= 1 && /تیم امنیت/.test(made.name||''), JSON.stringify(made));

await B.waitForTimeout(5000); await C.waitForTimeout(5000);
const bSees = await B.evaluate(()=>{
  const btn=document.querySelector('[data-chat-view="groups"]'); btn?.click();
  return new Promise(r=>setTimeout(()=>r({
    cards: document.querySelectorAll('#chatPeerList .chat-peer-card').length,
    text: [...document.querySelectorAll('#chatPeerList .chat-peer-card')].map(c=>c.textContent.replace(/\s+/g,' ').trim().slice(0,30)),
  }),1200));
});
const cSees = await C.evaluate(()=>{
  const btn=document.querySelector('[data-chat-view="groups"]'); btn?.click();
  return new Promise(r=>setTimeout(()=>r({
    cards: document.querySelectorAll('#chatPeerList .chat-peer-card').length,
    text: [...document.querySelectorAll('#chatPeerList .chat-peer-card')].map(c=>c.textContent.replace(/\s+/g,' ').trim().slice(0,30)),
  }),1200));
});
console.log('  B: ' + JSON.stringify(bSees));
console.log('  C: ' + JSON.stringify(cSees));
check('member B receives the group', bSees.text.some(x=>/تیم امنیت/.test(x)), JSON.stringify(bSees.text));
check('member C receives the group', cSees.text.some(x=>/تیم امنیت/.test(x)), JSON.stringify(cSees.text));

console.log('\n===== 2. a message reaches every member =====');
await A.evaluate(()=>{
  const card=[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(c=>/تیم امنیت/.test(c.textContent));
  card?.click();
});
await A.waitForTimeout(2500);
await A.fill('#chatComposer','سلام به همهٔ اعضا');
await A.click('#chatSendMessageBtn',{timeout:15000}).catch(e=>console.log('   send blocked:', e.message.split('\n')[0].slice(0,60)));
await A.waitForTimeout(3000);
await B.waitForTimeout(6000); await C.waitForTimeout(6000);
const grab = (p) => p.evaluate(()=>{
  const card=[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(c=>/تیم امنیت/.test(c.textContent));
  card?.click();
  return new Promise(r=>setTimeout(()=>r({
    texts: [...document.querySelectorAll('.chat-message-text')].map(e=>e.textContent.trim().slice(0,30)),
    senders: [...document.querySelectorAll('.chat-message-sender, .chat-sender-name')].map(e=>e.textContent.trim()),
  }),2000));
});
const bMsg = await grab(B), cMsg = await grab(C);
console.log('  B: ' + JSON.stringify(bMsg));
console.log('  C: ' + JSON.stringify(cMsg));
check('B receives the group message', bMsg.texts.some(x=>/سلام به همهٔ اعضا/.test(x)), JSON.stringify(bMsg.texts));
check('C receives the group message', cMsg.texts.some(x=>/سلام به همهٔ اعضا/.test(x)), JSON.stringify(cMsg.texts));
check('the message shows who sent it', bMsg.senders.length>0, JSON.stringify(bMsg.senders));

console.log('\n===== 3. a member replies and everyone sees it =====');
await B.fill('#chatComposer','بتا اینجاست');
await B.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
await B.waitForTimeout(3000);
await A.waitForTimeout(6000); await C.waitForTimeout(6000);
const aBack = await A.evaluate(()=>[...document.querySelectorAll('.chat-message-text')].map(e=>e.textContent.trim().slice(0,30)));
const cBack = await C.evaluate(()=>[...document.querySelectorAll('.chat-message-text')].map(e=>e.textContent.trim().slice(0,30)));
console.log('  A: ' + JSON.stringify(aBack));
console.log('  C: ' + JSON.stringify(cBack));
check("the owner sees B's reply", aBack.some(x=>/بتا اینجاست/.test(x)), JSON.stringify(aBack));
check("the other member sees B's reply (member to member)", cBack.some(x=>/بتا اینجاست/.test(x)), JSON.stringify(cBack));

console.log('\n===== 4. media in a group =====');
await A.setInputFiles('#chatFileInput', `${FIX}/loose1.png`);
await A.waitForTimeout(5000);
await B.waitForTimeout(6000);
const bFile = await B.evaluate(()=>({
  files: document.querySelectorAll('[data-chat-download-message]').length,
  missing: document.querySelectorAll('.chat-media-missing').length,
}));
console.log('  B: ' + JSON.stringify(bFile));
check('a file sent to the group arrives', bFile.files >= 1, JSON.stringify(bFile));

console.log('\n===== 5. group management =====');
const openInfo = async (p) => { await p.evaluate(()=>document.getElementById('chatSpaceInfoBtn')?.click()); await p.waitForTimeout(900); };
await openInfo(A);
const ui = await A.evaluate(()=>({
  panelOpen: !document.getElementById('chatSpaceInfo').classList.contains('hidden'),
  members: document.querySelectorAll('.chat-space-member').length,
  roles: [...document.querySelectorAll('.chat-space-member-role')].map(e=>e.textContent.trim()),
  canRename: Boolean(document.querySelector('[data-space-rename]')),
  canAdd: Boolean(document.querySelector('[data-space-add]')),
  canLeave: Boolean(document.querySelector('[data-space-leave]')),
  canAvatar: Boolean(document.querySelector('[data-space-avatar]')),
  canDesc: Boolean(document.querySelector('[data-space-desc]')),
  removeBtns: document.querySelectorAll('[data-space-remove]').length,
  adminBtns: document.querySelectorAll('[data-space-admin]').length,
}));
console.log('  owner sees: ' + JSON.stringify(ui));
check('the info panel opens from the header', ui.panelOpen);
check('the roster shows all three including the owner', ui.members===3 && ui.roles.includes('سازنده'), JSON.stringify(ui.roles));
check('the owner can rename, describe, re-picture, add and leave',
  ui.canRename && ui.canDesc && ui.canAvatar && ui.canAdd && ui.canLeave, JSON.stringify(ui));
check('the owner can remove and promote the other two', ui.removeBtns===2 && ui.adminBtns===2, JSON.stringify([ui.removeBtns,ui.adminBtns]));

await openInfo(B);
const bUi = await B.evaluate(()=>({
  members: document.querySelectorAll('.chat-space-member').length,
  canRename: Boolean(document.querySelector('[data-space-rename]')),
  canLeave: Boolean(document.querySelector('[data-space-leave]')),
  removeBtns: document.querySelectorAll('[data-space-remove]').length,
}));
console.log('  member sees: ' + JSON.stringify(bUi));
check('a plain member sees the roster but no management controls',
  bUi.members>=2 && !bUi.canRename && bUi.removeBtns===0, JSON.stringify(bUi));
check('a plain member can still leave', bUi.canLeave);
await B.evaluate(()=>document.querySelector('[data-space-info-close]')?.click());


/* The app stopped using window.confirm and window.prompt when the native shell
   turned out to implement neither — everything managerial now goes through the
   in-page dialog. This suite still stubbed the browser ones, so every rename,
   removal and departure was clicked into a question nobody answered. */
async function answerDialog(page, value) {
  await page.waitForTimeout(500);
  await page.evaluate((text) => {
    const input = document.querySelector('.poorija-dialog-input:not(.hidden)');
    if (input && text != null) { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); }
    document.querySelector('.poorija-dialog-ok')?.click();
  }, value ?? null);
  await page.waitForTimeout(800);
}
console.log('\n===== 5b. renaming propagates =====');
await A.evaluate(()=>document.querySelector('[data-space-rename]')?.click());
await answerDialog(A, 'تیم قرمز');
await A.waitForTimeout(2500);
await B.waitForTimeout(6000);
const renamed = await B.evaluate(()=>({
  cards: [...document.querySelectorAll('#chatPeerList .chat-peer-card')].map(c=>c.textContent.replace(/\s+/g,' ').trim().slice(0,24)),
  note: [...document.querySelectorAll('.chat-system-note')].map(e=>e.textContent.trim().slice(0,50)),
}));
console.log('  B: ' + JSON.stringify(renamed));
check('the new name reaches the members', renamed.cards.some(c=>/تیم قرمز/.test(c)), JSON.stringify(renamed.cards));

console.log('\n===== 5c. promoting an admin =====');
await A.evaluate((fp)=>document.querySelector(`[data-space-admin="${fp}"]`)?.click(), fpB);
await A.waitForTimeout(2000);
const promoted = await A.evaluate(()=>[...document.querySelectorAll('.chat-space-member-role')].map(e=>e.textContent.trim()));
console.log('  roles: ' + JSON.stringify(promoted));
check('a member becomes an admin', promoted.filter(r=>/ادمین/.test(r)).length===1, JSON.stringify(promoted));

console.log('\n===== 5f. member count in the header =====');
await A.evaluate(()=>{
  const card=[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(c=>/تیم امنیت|تیم قرمز/.test(c.textContent));
  card?.click();
});
await A.waitForTimeout(2000);
const header = await A.evaluate(()=>document.getElementById('chatActivePeerMeta')?.textContent.trim()||'');
console.log('  ' + header);
check('the header shows the member and online counts', /عضو/.test(header) && /آنلاین/.test(header), header);

console.log('\n===== 5g. mentions =====');
await A.evaluate(()=>document.getElementById('chatSpaceInfoBtn')?.click());
await A.waitForTimeout(700);
const memberName = await A.evaluate(()=>{
  const row=[...document.querySelectorAll('.chat-space-member')].find(r=>!/شما/.test(r.textContent));
  const n = row?.querySelector('.chat-space-member-name')?.textContent.trim();
  document.querySelector('[data-space-info-close]')?.click();
  return n;
});
console.log('  will mention: ' + memberName);
console.log('  mention debug: ' + JSON.stringify(await A.evaluate(()=>{
  const c=document.getElementById('chatComposer');
  c.value='سلام @'; c.setSelectionRange(c.value.length,c.value.length);
  return window.__mentionDebug();
})));
const mention = await A.evaluate(async ()=>{
  const composer=document.getElementById('chatComposer');
  composer.value='سلام @';
  composer.setSelectionRange(composer.value.length, composer.value.length);
  composer.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,500));
  const box=document.getElementById('chatMentionPicker');
  const open=!box.classList.contains('hidden');
  const rows=box.querySelectorAll('[data-mention-name]').length;
  box.querySelector('[data-mention-name]')?.click();
  await new Promise(r=>setTimeout(r,400));
  return { open, rows, value: composer.value, closed: box.classList.contains('hidden') };
});
console.log('  ' + JSON.stringify(mention));
check('typing @ opens a member picker', mention.open && mention.rows>=1, JSON.stringify(mention));
check('picking one inserts the token', /@\S+\s$/.test(mention.value), JSON.stringify(mention.value));
check('the picker closes afterwards', mention.closed);
await A.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
await A.waitForTimeout(2500);
await B.waitForTimeout(6000);
const mentionSeen = await B.evaluate(()=>{
  const card=[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(c=>/تیم امنیت|تیم قرمز/.test(c.textContent));
  card?.click();
  return new Promise(r=>setTimeout(()=>r({
    spans: document.querySelectorAll('.chat-mention').length,
    mineHighlighted: document.querySelectorAll('.chat-mention.is-me').length,
    bubbleMarked: document.querySelectorAll('.chat-message-bubble.mentions-me').length,
  }),2000));
});
console.log('  B: ' + JSON.stringify(mentionSeen));
check('the mention renders as a highlighted token on the far side', mentionSeen.spans>=1, JSON.stringify(mentionSeen));

console.log('\n===== 5g2. who said it, and the row of actions =====');
/* A group with several people in it reads as one wall of text when every line
   carries only a name. The face goes beside the name, everywhere the name is
   already drawn. */
const faces = await A.evaluate(() => {
  const senders = [...document.querySelectorAll('#chatMessages .chat-message-sender')];
  return {
    senders: senders.length,
    withFace: senders.filter((el) => el.querySelector('.chat-message-avatar')).length,
    named: senders.filter((el) => (el.querySelector('span')?.textContent || '').trim().length > 0).length,
  };
});
console.log('  ' + JSON.stringify(faces));
check('a group message says who sent it', faces.senders > 0, `${faces.senders} sender line(s)`);
check('and shows their face beside the name', faces.senders > 0 && faces.withFace === faces.senders, JSON.stringify(faces));
check('the name is still there', faces.senders > 0 && faces.named === faces.senders, JSON.stringify(faces));

/* Seven small buttons on a card: they were wrapping onto a second line on a
   tablet and on a small desktop window, which pushed "block" off on its own. */
const rows = {};
for (const width of [1440, 1180, 1024, 900, 820]) {
  await A.setViewportSize({ width, height: 900 });
  await A.waitForTimeout(600);
  await A.evaluate(() => document.querySelector('[data-chat-view="chats"]')?.click());
  await A.waitForTimeout(700);
  rows[width] = await A.evaluate(() => {
    const row = document.querySelector('#chatPeerList .chat-pin-actions');
    if (!row) return { missing: true };
    const tops = [...row.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top));
    const box = row.getBoundingClientRect();
    return { buttons: tops.length, lines: new Set(tops).size, fits: box.right <= window.innerWidth + 1 };
  });
}
console.log('  ' + JSON.stringify(rows));
const measured = Object.entries(rows).filter(([, v]) => !v.missing);
check('the action row is there to measure at every width', measured.length === 5, `${measured.length} of 5`);
check('every action sits on one line, at every width',
  measured.length === 5 && measured.every(([, v]) => v.lines === 1), JSON.stringify(rows));
check('and none of them is pushed off the edge',
  measured.length === 5 && measured.every(([, v]) => v.fits && v.buttons >= 6), JSON.stringify(rows));

console.log('\n===== 5g3. verifying a key opens something you can see =====');
/* .chat-shell is overflow:hidden, so a fixed panel inside it is clipped
   however high its z-index. The panel opened and nobody could see it. */
const safety = await A.evaluate(async () => {
  document.querySelector('#chatPeerList .chat-peer-card')?.click();
  await new Promise((r) => setTimeout(r, 1200));
  document.getElementById('chatThreadMenuBtn')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const btn = document.getElementById('chatVerifyKeyBtn');
  const offered = Boolean(btn && !btn.classList.contains('hidden'));
  btn?.click();
  await new Promise((r) => setTimeout(r, 1000));
  const panel = document.getElementById('chatSafetyPanel');
  if (!panel) return { missing: true };
  const box = panel.getBoundingClientRect();
  return {
    offered,
    open: !panel.classList.contains('hidden'),
    onBody: panel.parentElement === document.body,
    onScreen: box.width > 0 && box.height > 0 && box.top < window.innerHeight && box.left < window.innerWidth,
  };
});
console.log('  ' + JSON.stringify(safety));
check('a direct conversation offers to verify the key', safety.offered === true, JSON.stringify(safety));
check('and pressing it opens a panel that is on screen, not clipped away',
  safety.open === true && safety.onBody === true && safety.onScreen === true, JSON.stringify(safety));
await A.evaluate(() => document.getElementById('chatSafetyPanel')?.classList.add('hidden'));
await A.setViewportSize({ width: 1440, height: 900 });
await A.waitForTimeout(700);
/* Put the app back exactly where the next section expects it: the group open
   and its panel showing. A test that leaves the app somewhere else is a test
   that breaks the one after it. */
await A.evaluate(() => document.querySelector('[data-chat-view="groups"]')?.click());
await A.waitForTimeout(900);
await A.evaluate(() => {
  const card = [...document.querySelectorAll('#chatPeerList .chat-peer-card')]
    .find((x) => x.textContent.includes('تیم'));
  card?.click();
});
await A.waitForTimeout(1600);

console.log('\n===== 5h. permissions =====');
await A.evaluate(()=>document.getElementById('chatSpaceInfoBtn')?.click());
await A.waitForTimeout(700);
/* The rules live in their own dialog now, on both a phone and a desktop, and
   there are twelve of them rather than the four this used to assert. Count
   against the app's own list: a fixed number here is how eight rules went
   missing from the group-wide box without a test noticing. */
await A.evaluate(()=>document.querySelector('[data-space-perms-open]')?.click());
await A.waitForTimeout(700);
const expectedPerms = await A.evaluate(()=>window.__spacePermsProbe?.().length || 0);
const perms = await A.evaluate(()=>{
  const boxes=[...document.querySelectorAll('#chatPermsDialog [data-space-perm]')];
  return {
    boxes: boxes.length,
    keys: boxes.map(b=>b.getAttribute('data-space-perm')),
    allOn: boxes.length>0 && boxes.every(b=>b.checked),
  };
});
console.log('  ' + JSON.stringify(perms));
check('the owner gets every permission switch, open by default',
  expectedPerms>0 && perms.boxes===expectedPerms && perms.allOn, `${perms.boxes} of ${expectedPerms}, allOn=${perms.allOn}`);
await A.evaluate(()=>document.querySelector('#chatPermsDialog [data-space-perm="sendMessages"]')?.click());
await A.waitForTimeout(2500);
await A.evaluate(()=>document.querySelector('[data-perms-close]')?.click());
await A.waitForTimeout(400);
await A.evaluate(()=>document.querySelector('[data-space-info-close]')?.click());
/* C, not B: 5c promoted B to admin and never took it back, so "admins only"
   is supposed to let B through. Asserting on B here only ever passed because
   a member's own copy of the group had their own key stripped out of the
   admin list, so an admin mistook itself for a plain member and silenced
   itself. C has been a plain member throughout. */
await C.waitForTimeout(6000);
await C.fill('#chatComposer','این نباید برود');
const cBefore = await C.evaluate(()=>({n:document.querySelectorAll('.chat-message-text').length, t:(window.__toasts||[]).length}));
await C.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
await C.waitForTimeout(2500);
const blocked = await C.evaluate((before)=>({
  before: before.n,
  after: document.querySelectorAll('.chat-message-text').length,
  blockedToast: (window.__toasts||[]).slice(before.t).some(x=>/ادمین‌ها/.test(x)),
  newToasts: (window.__toasts||[]).slice(before.t),
  composerKept: document.getElementById('chatComposer').value,
}), cBefore);
console.log('  C (plain member): ' + JSON.stringify(blocked));

/* And the other half of the same rule, which nothing pinned before. */
await B.waitForTimeout(2000);
await B.fill('#chatComposer','ادمین باید بتواند');
const bAdminBefore = await B.evaluate(()=>document.querySelectorAll('.chat-message-text').length);
await B.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
await B.waitForTimeout(2500);
const adminPosted = await B.evaluate((n)=>document.querySelectorAll('.chat-message-text').length > n, bAdminBefore);
check('an admin is still allowed while members are muted', adminPosted, String(adminPosted));
check('a muted plain member cannot post', blocked.after===blocked.before && blocked.blockedToast, JSON.stringify(blocked));
await A.fill('#chatComposer','ولی ادمین می‌تواند');
const aBefore2 = await A.evaluate(()=>document.querySelectorAll('.chat-message-text').length);
await A.click('#chatSendMessageBtn',{timeout:15000}).catch(()=>{});
await A.waitForTimeout(3000);
const ownerStill = await A.evaluate((before)=>({
  before, after: document.querySelectorAll('.chat-message-text').length,
  composerAfter: document.getElementById('chatComposer').value,
}), aBefore2);
console.log('  A: ' + JSON.stringify(ownerStill));
check('the owner is not affected by the restriction', ownerStill.after>ownerStill.before, JSON.stringify(ownerStill));
await A.evaluate(async ()=>{
  document.getElementById('chatSpaceInfoBtn')?.click();
  await new Promise(r=>setTimeout(r,700));
  document.querySelector('[data-space-perm="sendMessages"]')?.click();
  await new Promise(r=>setTimeout(r,1500));
  document.querySelector('[data-space-info-close]')?.click();
});
await A.waitForTimeout(1500);

console.log('\n===== 5d. removing a member actually sticks =====');
/* Confirmations are answered through answerDialog() below, not by stubbing. */
await A.evaluate(()=>{
  if (document.getElementById('chatSpaceInfo').classList.contains('hidden')) document.getElementById('chatSpaceInfoBtn')?.click();
});
await A.waitForTimeout(900);
const removeTarget = await A.evaluate((fp)=>{
  const btn = document.querySelector(`[data-space-remove="${fp}"]`);
  const name = btn?.closest('.chat-space-member')?.querySelector('.chat-space-member-name')?.textContent.trim();
  btn?.click();
  return name || fp.slice(0,10);
}, fpC);
await answerDialog(A);
console.log('  removing: ' + removeTarget + '  (fpB=' + fpB.slice(0,10) + ' fpC=' + fpC.slice(0,10) + ')');
await A.waitForTimeout(3000);
// A hidden panel keeps its last innerHTML, so reopen it before counting rows.
await A.evaluate(()=>document.getElementById('chatSpaceInfoBtn')?.click());
await A.waitForTimeout(900);
console.log('  state: ' + JSON.stringify(await A.evaluate(()=>({
  rows: [...document.querySelectorAll('.chat-space-member')].map(r=>({
    name:r.querySelector('.chat-space-member-name')?.textContent.trim().slice(0,18),
    role:r.querySelector('.chat-space-member-role')?.textContent.trim(),
    key:(r.querySelector('[data-space-remove]')||r.querySelector('[data-space-admin]'))?.getAttribute('data-space-remove')
        || (r.querySelector('[data-space-admin]')?.getAttribute('data-space-admin')) || 'self',
  })),
  toasts:(window.__toasts||[]).slice(-2),
  storedMembers: window.__spaceMembers ? window.__spaceMembers() : null,
}))));
const aAfterRemove = await A.evaluate(()=>document.querySelectorAll('.chat-space-member').length);
check('the roster shrinks on the owner side', aAfterRemove===2, String(aAfterRemove));
await C.waitForTimeout(8000);
const cGone = await C.evaluate(()=>{
  document.querySelector('[data-chat-view="groups"]')?.click();
  return new Promise(r=>setTimeout(()=>r({
    cards: [...document.querySelectorAll('#chatPeerList .chat-peer-card')].map(x=>x.textContent.replace(/\s+/g,' ').trim().slice(0,24)),
    toast: (window.__toasts||[]).slice(-1)[0],
  }),1500));
});
console.log('  C: ' + JSON.stringify(cGone));
check('a removed member loses the group (the merge no longer resurrects them)',
  !cGone.cards.some(x=>/تیم قرمز|تیم امنیت/.test(x)), JSON.stringify(cGone));

console.log('\n===== 5e. leaving =====');
await B.evaluate(()=>document.getElementById('chatSpaceInfoBtn')?.click());
await B.waitForTimeout(900);
await B.evaluate(()=>document.querySelector('[data-space-leave]')?.click());
await answerDialog(B);
await B.waitForTimeout(3000);
const bLeft = await B.evaluate(()=>({
  cards: [...document.querySelectorAll('#chatPeerList .chat-peer-card')].map(x=>x.textContent.replace(/\s+/g,' ').trim().slice(0,24)),
  panelHidden: document.getElementById('chatSpaceInfo').classList.contains('hidden'),
}));
console.log('  B: ' + JSON.stringify(bLeft));
check('leaving removes the group from the leaver', !bLeft.cards.some(x=>/تیم قرمز/.test(x)) && bLeft.panelHidden, JSON.stringify(bLeft));
await A.waitForTimeout(6000);
const aNote = await A.evaluate(()=>[...document.querySelectorAll('.chat-system-note')].map(e=>e.textContent.trim().slice(0,40)));
console.log('  A notes: ' + JSON.stringify(aNote));
check('the group is told that somebody left', aNote.some(n=>/ترک کرد/.test(n)), JSON.stringify(aNote));

console.log('\n===== 5i. invite code =====');
await A.evaluate(async ()=>{
  document.getElementById('chatSpaceInfoBtn')?.click();
  await new Promise(r=>setTimeout(r,700));
  document.querySelector('[data-space-invite]')?.click();
});
await A.waitForTimeout(900);
const invite = await A.evaluate(()=>document.querySelector('.chat-space-invite-code')?.value||'');
console.log('  code length: ' + invite.length);
check('an invite code is produced', invite.startsWith('poorija-group-v1:') && invite.length>200, invite.slice(0,40));
await A.evaluate(()=>document.querySelector('[data-space-info-close]')?.click());
const joined = await C.evaluate(async (code)=>{
  const before=[...document.querySelectorAll('#chatPeerList .chat-peer-card')].map(c=>c.textContent.slice(0,20));
  const ok = await window.__redeemGroupInvite(code);
  await new Promise(r=>setTimeout(r,2500));
  return { ok, before, after:[...document.querySelectorAll('#chatPeerList .chat-peer-card')].map(c=>c.textContent.replace(/\s+/g,' ').trim().slice(0,20)),
    toast:(window.__toasts||[]).slice(-1)[0] };
}, invite);
console.log('  C: ' + JSON.stringify(joined));
check('a removed peer can rejoin with the invite code', joined.ok===true && joined.after.some(x=>/تیم قرمز/.test(x)), JSON.stringify(joined));

console.log('\n===== 6. survives a reload =====');
await A.reload({waitUntil:'load'});
await A.waitForTimeout(1800);
await A.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p;el.dispatchEvent(new Event('input',{bubbles:true}));}},PASS);
await A.evaluate(()=>window.unlockApp?.());
await A.waitForTimeout(3000);
await A.evaluate(()=>{document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');});
await A.waitForTimeout(2500);
const bAfter = await A.evaluate(()=>{
  document.querySelector('[data-chat-view="groups"]')?.click();
  return new Promise(r=>setTimeout(()=>{
    const card=[...document.querySelectorAll('#chatPeerList .chat-peer-card')].find(c=>/تیم امنیت|تیم قرمز/.test(c.textContent));
    card?.click();
    setTimeout(()=>r({
      groupVisible: Boolean(card),
      texts: [...document.querySelectorAll('.chat-message-text')].map(e=>e.textContent.trim().slice(0,26)),
    }),1500);
  },1200));
});
console.log('  ' + JSON.stringify(bAfter));
check('the group survives a reload with its history', bAfter.groupVisible && bAfter.texts.length>=2, JSON.stringify(bAfter));

for (const [tag,p] of [['A',A],['B',B],['C',C]]) {
  const errs=await p.evaluate(()=>(window.__err||[]).filter(x=>!/SSL|Failed to load resource/.test(x)));
  check(`${tag}: no uncaught errors`, errs.length===0, JSON.stringify(errs.slice(0,2)));
}
const failing=results.filter(r=>!r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach(f=>console.log(`  FAIL ${f.n} — ${f.d}`));
await browser.close();
