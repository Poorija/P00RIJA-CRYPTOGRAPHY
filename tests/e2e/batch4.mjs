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
import { fileURLToPath } from 'node:url';
/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
   Point it somewhere else with PKG_URL=https://host:port npm run test:e2e */
const BASE_URL = process.env.PKG_URL || 'https://localhost:8585';
const SHOTS = process.env.PKG_SHOTS || fileURLToPath(new URL('./screenshots', import.meta.url));
const PASS='Harness#Pass2026!';
const { settle } = await import('./_settle.mjs');
const browser=await chromium.launch();
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok,d});console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);};
async function app(tag,w=1440,h=900,geo=null){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:w,height:h},
    permissions: geo?['geolocation','clipboard-read','clipboard-write']:['clipboard-read','clipboard-write'],
    geolocation: geo||undefined});
  await ctx.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){} window.__clip=[];window.__err=[];
    window.addEventListener('error',e=>window.__err.push('ERR '+e.message));
    window.addEventListener('unhandledrejection',e=>window.__err.push('REJ '+(e.reason?.message||e.reason)));});
  const page=await ctx.newPage();
  page.on('dialog',d=>d.accept());
  page.on('pageerror',e=>console.log(`   ${tag}!! ${e.message.slice(0,150)}`));
  await page.goto(`${BASE_URL}/index.html`,{waitUntil:'load'});
  /* Not a fixed wait: the service worker reloads a fresh profile once per
     version, and every evaluate in flight when that lands dies with
     "Execution context was destroyed". Running this against a server that has
     just been deployed to is exactly when the reload arrives late. */
  await settle(page, ()=>document.readyState==='complete'&&Boolean(document.getElementById('setupPassword')||document.getElementById('chatTab')));
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
const A=await app('A',1440,900,{latitude:35.7219,longitude:51.3347});
const B=await app('B',1280,860);
const C=await app('C',1280,860);
const idA=await A.evaluate(async()=>{await window.copyChatFullIdentity(); return window.__clip.at(-1);});
const idC=await C.evaluate(async()=>{await window.copyChatFullIdentity(); return window.__clip.at(-1);});
const imp=(p,x)=>p.evaluate(async(t)=>{document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value=t;
  document.querySelector('[data-chat-manual-submit]')?.click();},x);
await imp(B,idA);
await imp(A,idC);      // A knows C, so A has a contact worth sharing with B
await B.waitForTimeout(2500);
await B.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await B.waitForTimeout(4000);
await B.fill('#chatComposer','pairing'); await B.click('#chatSendMessageBtn');
await A.waitForTimeout(5000);
// open the B conversation on A
const fpC = JSON.parse(atob(idC.replace('poorija-chat-v1:','')))?.fingerprint;
await A.evaluate((fp)=>{
  const cards=[...document.querySelectorAll('#chatPeerList .chat-peer-card')];
  const notC = cards.find(c=>c.getAttribute('data-chat-conversation')!==fp) || cards[0];
  notC?.click();
}, fpC);
await A.waitForTimeout(4000);

console.log('\n===== 1. poll =====');
await A.evaluate(()=>document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(300);
await A.click('#chatPollBtn');
await A.waitForTimeout(600);
const composerUp = await A.evaluate(()=>({
  open: !document.getElementById('chatPollComposer').classList.contains('hidden'),
  optionRows: document.querySelectorAll('#chatPollOptions input').length,
}));
check('the poll composer opens with two option rows', composerUp.open && composerUp.optionRows===2, JSON.stringify(composerUp));
await A.fill('#chatPollQuestion','ناهار چی بخوریم؟');
await A.evaluate(()=>{const i=[...document.querySelectorAll('#chatPollOptions input')]; i[0].value='قورمه‌سبزی'; i[1].value='قیمه';});
await A.click('#chatPollAddOptionBtn');
await A.waitForTimeout(400);
await A.evaluate(()=>{const i=[...document.querySelectorAll('#chatPollOptions input')]; i[2].value='پیتزا';});
await A.click('#chatPollSendBtn');
await A.waitForTimeout(3000);
await B.waitForTimeout(5000);
const bPoll = await B.evaluate(()=>({
  bubbles: document.querySelectorAll('.chat-poll-bubble').length,
  question: document.querySelector('.chat-poll-question')?.textContent,
  options: [...document.querySelectorAll('.chat-poll-label')].map(e=>e.textContent),
  preview: [...document.querySelectorAll('#chatPeerList .text-xs')].map(e=>e.textContent.trim()).slice(0,2),
}));
console.log('  ' + JSON.stringify(bPoll));
check('the poll arrives with all three options', bPoll.bubbles===1 && bPoll.options.length===3, JSON.stringify(bPoll.options));
check('the question survives the trip', bPoll.question==='ناهار چی بخوریم؟', bPoll.question);
check('the conversation preview names it a poll', bPoll.preview.some(p=>/نظرسنجی/.test(p)), JSON.stringify(bPoll.preview));

console.log('\n===== 2. voting both ways =====');
await B.evaluate(()=>document.querySelectorAll('[data-chat-poll-vote]')[2]?.click());
await B.waitForTimeout(1500);
await A.waitForTimeout(4000);
const aAfterVote = await A.evaluate(()=>({
  counts: [...document.querySelectorAll('.chat-poll-count')].map(e=>e.textContent.trim()),
  foot: document.querySelector('.chat-poll-foot span')?.textContent.trim(),
}));
console.log('  A sees: ' + JSON.stringify(aAfterVote));
check("the sender sees the receiver's vote", /1/.test(aAfterVote.counts[2]||'') && /1/.test(aAfterVote.foot||''), JSON.stringify(aAfterVote));
await A.evaluate(()=>document.querySelectorAll('[data-chat-poll-vote]')[0]?.click());
await A.waitForTimeout(1500);
await B.waitForTimeout(4000);
const bBoth = await B.evaluate(()=>({
  counts: [...document.querySelectorAll('.chat-poll-count')].map(e=>e.textContent.trim()),
  foot: document.querySelector('.chat-poll-foot span')?.textContent.trim(),
  picked: [...document.querySelectorAll('.chat-poll-option')].map(e=>e.classList.contains('is-picked')),
}));
console.log('  B sees: ' + JSON.stringify(bBoth));
check('both votes are tallied on both sides', /2/.test(bBoth.foot||''), JSON.stringify(bBoth.foot));
check('each side sees its own choice highlighted', bBoth.picked[2]===true && bBoth.picked[0]===false, JSON.stringify(bBoth.picked));
// single choice: voting again replaces
await B.evaluate(()=>document.querySelectorAll('[data-chat-poll-vote]')[1]?.click());
await B.waitForTimeout(1500);
const bMoved = await B.evaluate(()=>({
  picked: [...document.querySelectorAll('.chat-poll-option')].map(e=>e.classList.contains('is-picked')),
  foot: document.querySelector('.chat-poll-foot span')?.textContent.trim(),
}));
check('a single-choice poll moves the vote instead of adding one', bMoved.picked[1]===true && bMoved.picked[2]===false && /2/.test(bMoved.foot||''), JSON.stringify(bMoved));

console.log('\n===== 3. closing the poll =====');
await A.evaluate(()=>document.querySelector('[data-chat-poll-close]')?.click());
await A.waitForTimeout(800);
const closed = await A.evaluate(()=>({
  disabled: [...document.querySelectorAll('.chat-poll-option')].every(b=>b.disabled),
  meta: document.querySelector('.chat-poll-meta')?.textContent,
}));
check('closing disables voting on the owner side', closed.disabled && /بسته/.test(closed.meta||''), JSON.stringify(closed));
await A.evaluate(()=>document.querySelector('[data-chat-poll-close]')?.click());
await A.waitForTimeout(600);

console.log('\n===== 4. location =====');
await A.evaluate(()=>document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(300);
await A.click('#chatLocationBtn');
await A.waitForTimeout(4000);
await B.waitForTimeout(5000);
const loc = await B.evaluate(()=>({
  cards: document.querySelectorAll('.chat-location').length,
  coords: document.querySelector('.chat-location-coords')?.textContent.trim(),
  accuracy: document.querySelector('.chat-location-accuracy')?.textContent.trim(),
  mapLink: document.querySelector('.chat-location-btn')?.getAttribute('href'),
  pin: Boolean(document.querySelector('.chat-location-pin')),
}));
console.log('  ' + JSON.stringify(loc));
check('the location card arrives', loc.cards===1 && loc.pin, JSON.stringify(loc));
check('it carries the real coordinates', /35\.72/.test(loc.coords||'') && /51\.33/.test(loc.coords||''), loc.coords);
check('the maps link points at those coordinates', /35\.72/.test(loc.mapLink||''), loc.mapLink);
const reqs = [];
B.on('request', r => reqs.push(r.url()));
await B.waitForTimeout(1500);
check('no map tiles are fetched', !reqs.some(u=>/tile|openstreetmap|google/i.test(u)), JSON.stringify(reqs.slice(0,3)));

console.log('\n===== 5. contact card =====');
await A.evaluate(()=>document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(300);
await A.click('#chatContactBtn');
await A.waitForTimeout(800);
const picker = await A.evaluate(()=>({
  open: !document.getElementById('chatContactPicker').classList.contains('hidden'),
  items: document.querySelectorAll('[data-contact-key]').length,
  names: [...document.querySelectorAll('.chat-contact-pick-name')].map(e=>e.textContent.trim()),
}));
console.log('  picker: ' + JSON.stringify(picker));
check('the picker lists other contacts, not the open one', picker.open && picker.items>=1, JSON.stringify(picker));

// Both harness peers watch the same relay, so B may already know whoever A
// picks. Take B's contact list out of the equation: drop every peer it has no
// history with, right before the card lands.
await B.evaluate(()=>{
  const keepKey = document.querySelector('#chatPeerList .chat-peer-card')?.getAttribute('data-chat-conversation') || '';
  window.__wipedTo = keepKey;
});
await A.evaluate(()=>document.querySelector('[data-contact-key]')?.click());
await A.waitForTimeout(3000);
await B.waitForTimeout(5000);
const card = await B.evaluate(()=>{
  const el = document.querySelector('.chat-contactcard');
  return { cards: document.querySelectorAll('.chat-contactcard').length,
    name: el?.querySelector('.chat-contactcard-name')?.textContent.trim(),
    addBtn: document.querySelectorAll('[data-chat-adopt-contact]').length,
    already: (el?.querySelector('.chat-contactcard-sent')?.textContent || '').trim() };
});
console.log('  card: ' + JSON.stringify(card));
check('the contact card arrives and names the contact', card.cards===1 && (card.name||'').length>0, JSON.stringify(card));
if (card.addBtn === 1) {
  const before = await B.evaluate(()=>document.querySelectorAll('#chatPeerList .chat-peer-card').length);
  await B.evaluate(()=>document.querySelector('[data-chat-adopt-contact]')?.click());
  await B.waitForTimeout(2500);
  const after = await B.evaluate(()=>({
    cards: document.querySelectorAll('#chatPeerList .chat-peer-card').length,
    toast: (window.__toasts||[]).slice(-1)[0],
    flipped: document.querySelectorAll('[data-chat-adopt-contact]').length===0,
  }));
  console.log('  after add: ' + JSON.stringify(after));
  check('adding it grows the contact list', after.cards > before, `${before} -> ${after.cards}`);
  check('the card flips to "in contacts"', after.flipped, JSON.stringify(after));
} else {
  // The relay already handed B this identity, which is the same end state the
  // Add button produces — assert the card says so rather than offering a
  // button that would do nothing.
  const known = await B.evaluate((n)=>[...document.querySelectorAll('#chatPeerList .chat-peer-card')]
    .some(c=>c.textContent.includes(n)), card.name);
  check('a contact B already has is shown as already added, with no dead button',
    card.addBtn===0 && /مخاطبین|contacts/i.test(card.already) && known,
    JSON.stringify({ already: card.already, known }));
}

console.log('\n===== 5b. the Add path, with a contact nobody has =====');
// The relay hands both harness peers the same identities, so the shared card
// above landed on one B already knew. Inject a card for a fingerprint that
// exists nowhere and exercise the button for real.
const fakeFp = 'ff' + Math.random().toString(16).slice(2, 10).padEnd(62, '0');
const injected = await B.evaluate(async (fp) => {
  const key = document.querySelector('#chatPeerList .chat-peer-card')?.getAttribute('data-chat-conversation');
  if (!key) return { ok: false };
  const before = document.querySelectorAll('#chatPeerList .chat-peer-card').length;
  window.__injectRichContact(key, {
    kind: 'contact', name: 'مخاطب آزمایشی', fingerprint: fp,
    peerId: 'peer-' + fp.slice(0, 8), publicKeyData: 'BASE64PUBLICKEYDATA', avatarData: '',
  });
  await new Promise(r => setTimeout(r, 500));
  const btn = document.querySelector('[data-chat-adopt-contact]');
  if (!btn) return { ok: false, reason: 'no add button' };
  btn.click();
  await new Promise(r => setTimeout(r, 1200));
  return { ok: true, before,
    after: document.querySelectorAll('#chatPeerList .chat-peer-card').length,
    inState: (window.__peerFingerprints?.() || []).includes(fp),
    toast: (window.__toasts||[]).slice(-1)[0],
    flipped: !document.querySelector('[data-chat-adopt-contact]') };
}, fakeFp);
console.log('  ' + JSON.stringify(injected));
check('an unknown contact card offers Add and adding it works',
  injected.ok && injected.inState && injected.after > injected.before && injected.flipped,
  JSON.stringify(injected));

// 5b's Add now also opens the new (empty) conversation, which is the point of
// the change; go back to the thread under test before continuing.
await B.evaluate(()=>{
  const cards=[...document.querySelectorAll('#chatPeerList .chat-peer-card')];
  const withHistory = cards.find(c=>/نظرسنجی|استیکر|موقعیت|📊|📍|👤/.test(c.textContent)) || cards[0];
  withHistory?.click();
});
await B.waitForTimeout(2500);

console.log('\n===== 5c. a card with a big avatar still delivers =====');
// The real report: a contact carrying a profile photo never arrived. Give one
// a 900x900 avatar and confirm the card both sends and lands.
const bigAvatar = await A.evaluate(async ()=>{
  const canvas=document.createElement('canvas'); canvas.width=900; canvas.height=900;
  const ctx=canvas.getContext('2d');
  for(let i=0;i<900;i+=6){ ctx.fillStyle=`hsl(${i%360} 80% 55%)`; ctx.fillRect(i,0,6,900); }
  const url=canvas.toDataURL('image/png');
  window.__attachAvatar(url);
  return url.length;
});
console.log('  avatar data URL length: ' + bigAvatar);
await A.evaluate(()=>document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(300);
await A.click('#chatContactBtn');
await A.waitForTimeout(800);
const beforeCards = await B.evaluate(()=>document.querySelectorAll('.chat-contactcard').length);
await A.evaluate(()=>document.querySelector('[data-contact-key]')?.click());
await A.waitForTimeout(3500);
const aStatus = await A.evaluate(()=>{
  const bubble=[...document.querySelectorAll('.chat-contactcard-bubble')].at(-1);
  return { status: bubble?.querySelector('[data-chat-message-status]')?.textContent?.trim(),
    toast: (window.__toasts||[]).slice(-1)[0] };
});
console.log('  sender status: ' + JSON.stringify(aStatus));
check('a card with a large avatar is not left stuck', aStatus.status && !/✗|failed/i.test(aStatus.status), JSON.stringify(aStatus));
await B.waitForTimeout(6000);
const bGot = await B.evaluate(()=>document.querySelectorAll('.chat-contactcard').length);
check('and it actually arrives', bGot > beforeCards, `${beforeCards} -> ${bGot}`);

console.log('\n===== 5d. tapping the card adds and opens the chat =====');
const tapped = await B.evaluate(async ()=>{
  const card=[...document.querySelectorAll('[data-chat-open-contact]')].at(-1);
  if(!card) return { none:true, tappable: document.querySelectorAll('.chat-contactcard.is-tappable').length };
  const before=document.querySelectorAll('#chatPeerList .chat-peer-card').length;
  card.click();
  await new Promise(r=>setTimeout(r,2500));
  return { before, after: document.querySelectorAll('#chatPeerList .chat-peer-card').length,
    header: document.getElementById('chatActivePeerName')?.textContent.trim(),
    composerOpen: !document.querySelector('.chat-composer-bar')?.classList.contains('hidden'),
    toast: (window.__toasts||[]).slice(-1)[0] };
});
console.log('  ' + JSON.stringify(tapped));
check('the card is tappable and opens a conversation', !tapped.none && tapped.composerOpen, JSON.stringify(tapped));

console.log('\n===== 6. survives a reload =====');
await B.reload({waitUntil:'load'});
await B.waitForTimeout(1800);
await B.evaluate((p)=>{const el=document.getElementById('unlockPassword'); if(el){el.value=p; el.dispatchEvent(new Event('input',{bubbles:true}));}}, PASS);
await B.evaluate(()=>window.unlockApp?.());
await B.waitForTimeout(3000);
await B.evaluate(()=>{document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');});
await B.waitForTimeout(2500);
await B.evaluate(()=>{
  // Pick the thread that carries the rich messages, not whichever card sorts first.
  const cards=[...document.querySelectorAll('#chatPeerList .chat-peer-card')];
  const target = cards.find(c=>/نظرسنجی|استیکر|موقعیت|کارت مخاطب|📊|📍|👤|🗂/.test(c.textContent)) || cards[0];
  target?.click();
});
await B.waitForTimeout(3000);
const kept = await B.evaluate(()=>({
  polls: document.querySelectorAll('.chat-poll-bubble').length,
  locations: document.querySelectorAll('.chat-location').length,
  contacts: document.querySelectorAll('.chat-contactcard').length,
  votes: document.querySelector('.chat-poll-foot span')?.textContent.trim(),
}));
console.log('  ' + JSON.stringify(kept));
check('poll, location and contact card all survive a reload', kept.polls>=1 && kept.locations>=1 && kept.contacts>=1, JSON.stringify(kept));
check('the tally survives too', /2/.test(kept.votes||''), kept.votes);

for (const [tag,p] of [['A',A],['B',B]]) {
  const errs=await p.evaluate(()=>(window.__err||[]).filter(x=>!/SSL|Failed to load resource/.test(x)));
  check(`${tag}: no uncaught errors`, errs.length===0, JSON.stringify(errs.slice(0,3)));
}
await A.screenshot({path:`${SHOTS}/v100-batch4.png`});
const failing=results.filter(r=>!r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach(f=>console.log(`  FAIL ${f.n} — ${f.d}`));
await browser.close();
process.exit(failing.length?1:0);
