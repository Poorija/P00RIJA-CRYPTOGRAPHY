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
/* Two peers on genuinely different screen shapes — a desktop in landscape and
   a phone in portrait — so their pictures cannot share an aspect ratio and the
   letterbox is real rather than contrived.

   It covers the two things that were wrong with a call between mismatched
   devices: the filler behind a letterboxed picture (a blurred, moving copy of
   the other person, which is motion at the edge of the eye for the whole call)
   and the mirror setting, which flipped the local preview and never reached
   the other side because nothing broadcast the change.

   Needs a relay: npm run relay, then PKG_URL=http://localhost:8123 node
   tests/e2e/callmirror.mjs
*/
const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
/* Typed into the app's own server field, so it has to be reachable from the
   PAGE: an https page cannot use an http relay, the browser blocks it as mixed
   content, and the app then reports a relay that is simply down. */
const RELAY_FOR_PAGE = process.env.RELAY_URL
  || (/^https:/i.test(BASE_URL) ? String(BASE_URL).replace(/\/+$/, '') : 'http://localhost:9000');
const PASS = 'Harness#Pass2026!';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const results = []; const check = (n, ok, d='') => { results.push({n, ok}); console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

async function app(tag, w, h, mobile=false) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors:true, viewport:{width:w,height:h}, permissions:['microphone','camera'], isMobile:mobile, hasTouch:mobile });
  await ctx.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){} window.__clip=[];});
  const page = await ctx.newPage();
  page.on('pageerror', e=>console.log(`   ${tag}!! ${e.message.slice(0,140)}`));
  await page.goto(`${BASE_URL}/index.html`, {waitUntil:'load'});
  /* A first load from a server registers the service worker, which reloads the
     page out from under the next evaluate. Settle before touching anything. */
  await page.waitForLoadState('load').catch(()=>{});
  await page.waitForTimeout(2200);
  await page.evaluate(()=>{ if (typeof continueInBrowserExperience==='function') continueInBrowserExperience(); });
  await page.waitForTimeout(600);
  await page.evaluate((pass)=>{
    const set=(id,v)=>{const el=document.getElementById(id); if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
    set('setupPassword',pass); set('confirmPassword',pass);
    document.querySelectorAll('#initialSetup select').forEach((s,i)=>{if(s.options.length>i+1){s.selectedIndex=i+1;s.dispatchEvent(new Event('change',{bubbles:true}));}});
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp,i)=>{inp.value='answer'+i;inp.dispatchEvent(new Event('input',{bubbles:true}));});
    const cb=document.getElementById('acceptTermsCheckbox'); if(cb&&!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}
  }, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(2600);
  await page.evaluate(()=>{const w=navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText=(t)=>{window.__clip.push(t);return w(t).catch(()=>{});};
    document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');});
  await page.waitForTimeout(700);
  await page.evaluate((RELAY_FOR_PAGE)=>{
    const url=document.getElementById('chatServerUrl');
    if (url) { url.value=RELAY_FOR_PAGE; url.dispatchEvent(new Event('input',{bubbles:true})); url.dispatchEvent(new Event('change',{bubbles:true})); }
    document.getElementById('chatConnectBtn')?.click();
  }, RELAY_FOR_PAGE);
  await page.waitForTimeout(6500);
  return page;
}


/* Two fresh profiles, no pairing of any kind. Everything either side knows
   about the other came from the relay's presence broadcast. */
const A = await app('A', 430, 932, true);
const B = await app('B', 430, 932, true);
await A.waitForTimeout(3000); await B.waitForTimeout(3000);

const read = (page) => page.evaluate(() => ({
  stored: window.__contactsProbe.stored(),
  book: window.__contactsProbe.book(),
  online: window.__contactsProbe.online(),
}));

console.log('\n===== a fresh install does not collect the people it can see =====');
const fresh = await read(A);
console.log('  A', JSON.stringify(fresh));
check('the relay is seen — the other side is online and listed',
  fresh.online.length === 1, JSON.stringify(fresh.online));
check('but the address book is empty', fresh.book.length === 0, JSON.stringify(fresh.book));
check('and nothing about them was written to storage',
  fresh.stored.length === 0, JSON.stringify(fresh.stored));

console.log('\n===== the address book shows no directory of strangers =====');
const panes = await A.evaluate(async () => {
  document.querySelector('[data-chat-view="calls"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  document.querySelector('[data-calls-pane="contacts"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  return {
    saved: document.querySelectorAll('#content-chat .chat-contact-row:not(.is-discovered)').length,
    discovered: document.querySelectorAll('#content-chat .chat-contact-row.is-discovered').length,
    heading: document.querySelector('#content-chat .chat-contact-subhead span')?.textContent?.trim() || '',
    adoptButton: Boolean(document.querySelector('#content-chat [data-contact-adopt]')),
  };
});
console.log('  ', JSON.stringify(panes));
check('the online-on-relay section is gone — nobody is listed who was not added',
  panes.saved === 0 && panes.discovered === 0 && panes.adoptButton === false && !panes.heading,
  JSON.stringify(panes));

console.log('\n===== adding one is what makes it stick (explicit act only) =====');
const target = fresh.online[0];
await A.evaluate((id) => window.__contactsProbe.adopt(id), target);
await A.waitForTimeout(600);
const added = await read(A);
console.log('  A', JSON.stringify(added));
check('an explicit add moves it into the book', added.book.length === 1 && added.book[0] === target, JSON.stringify(added.book));
check('it is no longer a mere discovered peer', added.online.length === 0, JSON.stringify(added.online));
check('and now it is on disk', added.stored.length === 1 && added.stored[0] === target, JSON.stringify(added.stored));

console.log('\n===== a message also earns a place =====');
/* The other side never added anyone; it only received. */
await A.evaluate(() => {
  document.querySelector('[data-chat-view="chats"]')?.click();
  document.querySelector('#chatPeerList .chat-peer-card')?.click();
});
await A.waitForTimeout(2500);
await A.fill('#chatComposer', 'salam');
await A.click('#chatSendMessageBtn');
await B.waitForTimeout(5000);
const gotMail = await read(B);
console.log('  B', JSON.stringify(gotMail));
check('the side that was written to keeps the sender',
  gotMail.stored.length === 1, JSON.stringify(gotMail.stored));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
