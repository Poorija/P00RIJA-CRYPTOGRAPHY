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

const A = await app('A', 1440, 900);            // desktop, landscape
const B = await app('B', 390, 844, true);       // phone, portrait
const idA = await A.evaluate(async()=>{ await window.copyChatFullIdentity(); return window.__clip.at(-1); });
await B.evaluate(async(x)=>{ document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value=x;
  document.querySelector('[data-chat-manual-submit]')?.click(); }, idA);
await B.waitForTimeout(2500);
await B.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await B.waitForTimeout(4000);
await B.fill('#chatComposer','pairing'); await B.click('#chatSendMessageBtn');
await A.waitForTimeout(4500);
await A.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.waitForTimeout(2500);

/* Where the other side's face sits while the call is still ringing. It has to
   be in the middle of the stage, concentric with the pulse rings -- it was
   landing in the bottom corner, half under the control dock. */
const heroPlacement = (page) => page.evaluate(()=>{
  const centre = (el)=>{ const b=el.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2, w:b.width, h:b.height}; };
  const stage = document.querySelector('#chatFloatingCall .chat-remote-stage');
  const av = document.getElementById('chatFloatingRemoteAvatar');
  const rings = document.querySelector('#chatFloatingCall .chat-call-hero-rings');
  if (!stage || !av || !rings || !av.getBoundingClientRect().width) return null;
  const s = centre(stage); const a = centre(av); const r = centre(rings);
  return {
    offX: Math.round(a.x - s.x), offY: Math.round(a.y - s.y),
    ringOffX: Math.round(a.x - r.x), ringOffY: Math.round(a.y - r.y),
    bandY: +(Math.abs(a.y - s.y) / s.h).toFixed(3),
    stage: `${Math.round(s.w)}x${Math.round(s.h)}`, avatar: Math.round(a.w),
  };
});

console.log('\n===== a video call between two different shapes =====');
await A.evaluate(()=>document.getElementById('chatVideoCallBtn')?.click());
await A.waitForTimeout(2500);
const ringingA = await heroPlacement(A);
console.log('  desktop, ringing', JSON.stringify(ringingA));
check('the person being called is in the middle of the desktop screen',
  Boolean(ringingA) && Math.abs(ringingA.offX) <= 2 && ringingA.bandY <= 0.12,
  JSON.stringify(ringingA));
check('and the pulse rings are drawn around them, not somewhere else',
  Boolean(ringingA) && Math.abs(ringingA.ringOffX) <= 2 && Math.abs(ringingA.ringOffY) <= 2,
  JSON.stringify(ringingA));
await B.waitForTimeout(3000);
await B.evaluate(()=>document.getElementById('chatModalAcceptBtn')?.click());
await B.waitForTimeout(6500);
await A.waitForTimeout(4000);

const stageOf = (page) => page.evaluate(()=>{
  const stage=document.querySelector('#chatFloatingCall .chat-remote-stage');
  if (!stage) return null;
  const video=stage.querySelector('video:not(.chat-stage-backdrop)');
  return { fit: stage.dataset.fit, backdrops: stage.querySelectorAll('video.chat-stage-backdrop').length,
    bg: getComputedStyle(stage).backgroundColor,
    videoRatio: video && video.videoWidth ? +(video.videoWidth/video.videoHeight).toFixed(2) : null,
    boxRatio: +(stage.clientWidth/stage.clientHeight).toFixed(2) };
});
const sa = await stageOf(A); const sb = await stageOf(B);
console.log('  A(desktop)', JSON.stringify(sa));
console.log('  B(phone)  ', JSON.stringify(sb));
check('the two shapes really do differ, so the letterbox is real',
  Boolean(sa && sb) && (sa.fit === 'contain' || sb.fit === 'contain'), `${sa?.fit}/${sb?.fit}`);
check('nothing blurred is drawn behind the letterbox',
  (sa?.backdrops ?? 1) === 0 && (sb?.backdrops ?? 1) === 0, `${sa?.backdrops}/${sb?.backdrops}`);
check('and the surround is black',
  sa?.bg === 'rgb(0, 0, 0)' && sb?.bg === 'rgb(0, 0, 0)', `${sa?.bg} / ${sb?.bg}`);

console.log('\n===== mirroring reaches the other side =====');
const mirrorOf = (page) => page.evaluate(()=>({
  remoteMirrored: Boolean(document.querySelector('#chatFloatingCall .chat-remote-stage.remote-mirrored')
    || document.getElementById('chatFloatingRemoteVideo')?.classList.contains('remote-mirrored')),
  selfMirrored: !document.querySelector('#chatFloatingCall .chat-local-stage')?.classList.contains('mirror-off'),
}));
console.log('  before A', JSON.stringify(await mirrorOf(A)), ' before B', JSON.stringify(await mirrorOf(B)));
await A.evaluate(()=>document.getElementById('chatMirrorVideoBtn')?.click());
await A.waitForTimeout(1200); await B.waitForTimeout(2500);
const afterA = await mirrorOf(A); const afterB = await mirrorOf(B);
console.log('  after  A', JSON.stringify(afterA), ' after  B', JSON.stringify(afterB));
check('turning my mirror off changes my own preview', afterA.selfMirrored === false, JSON.stringify(afterA));
check('and the other side sees the change on the picture of me',
  afterB.remoteMirrored === false, JSON.stringify(afterB));
await A.evaluate(()=>document.getElementById('chatMirrorVideoBtn')?.click());
await A.waitForTimeout(1000); await B.waitForTimeout(2500);
const backB = await mirrorOf(B);
check('and back again when I turn it on', backB.remoteMirrored === true, JSON.stringify(backB));

console.log('\n===== a status written on one side shows on the other =====');
/* The status rides with the presence record, which means the relay has to
   carry it: it was added to hello and to the peer list on the server at the
   same time, and this is what proves both halves are in place. */
await A.evaluate(()=>document.getElementById('chatMoodChip')?.click());
await A.waitForTimeout(400);
await A.evaluate(()=>{const input=document.querySelector('.poorija-dialog-input');
  if(input){input.value='در جلسه'; input.dispatchEvent(new Event('input',{bubbles:true}));}
  document.querySelector('.poorija-dialog-ok')?.click();});
await A.waitForTimeout(1500); await B.waitForTimeout(3000);
const moodSeen = await B.evaluate(()=>{
  const chip = document.getElementById('chatActivePeerMood');
  return {
    meta: document.getElementById('chatActivePeerMeta')?.textContent.trim() || '',
    /* One copy on screen: the status line under the name. The chip that used
       to sit beside the name said the same thing twice. */
    chipVisible: chip ? getComputedStyle(chip).display !== 'none' : false,
  };
});
check('the other side sees it at the top of the chat',
  moodSeen.meta.startsWith('در جلسه'), moodSeen.meta.slice(0, 40));
check('and it is shown once, not twice', moodSeen.chipVisible === false, String(moodSeen.chipVisible));

/* Shown once is not the same as shown clearly: as bare text it read like the
   first clause of the line, so it keeps the pill the removed chip had. */
const bubble = await B.evaluate(()=>{
  const el = document.querySelector('#chatActivePeerMeta .chat-meta-mood');
  if (!el) return null;
  const style = getComputedStyle(el);
  return { text: el.textContent.trim(), radius: style.borderRadius,
    bg: style.backgroundColor, colour: style.color, display: style.display };
});
console.log('  bubble', JSON.stringify(bubble));
check('and it sits in its own bubble',
  Boolean(bubble) && bubble.text === 'در جلسه' && parseFloat(bubble.radius) >= 100
  && bubble.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(bubble));

console.log('\n===== a call entry in the thread dials again =====');
/* Hang up and the finished call is written into the thread as one line. That
   line is the redial button: it already names the peer and the kind of call,
   so a tap on it should place the same call rather than send the user back to
   the header icons. Checked on the desktop side, which is the one still
   showing the thread after the call closes. */
await A.evaluate(()=>document.getElementById('chatEndCallBtn')?.click());
await A.waitForTimeout(3000); await B.waitForTimeout(2000);
await A.evaluate(() => { document.querySelector('[data-chat-view="chats"]')?.click(); document.querySelector('#chatPeerList .chat-peer-card')?.click(); });
await A.waitForTimeout(600);
const logRow = await A.evaluate(()=>{
  const row = document.querySelector('#chatMessages [data-call-redial]');
  return row ? { mode: row.dataset.callRedial, text: row.textContent.replace(/\s+/g,' ').trim().slice(0,44),
    role: row.getAttribute('role'), cursor: getComputedStyle(row).cursor,
    redialIcon: Boolean(row.querySelector('.chat-call-message-redial')) } : null;
});
console.log('  row', JSON.stringify(logRow));
check('the finished call is drawn in the thread as a button',
  Boolean(logRow) && logRow.mode === 'video' && logRow.role === 'button'
  && logRow.cursor === 'pointer' && logRow.redialIcon === true, JSON.stringify(logRow));
await A.evaluate(()=>document.querySelector('#chatMessages [data-call-redial]')?.click());
await A.waitForTimeout(4000);
const redialed = await A.evaluate(()=>window.__callStateProbe?.() || null);
console.log('  after tap', JSON.stringify(redialed));
check('and tapping it places that same call again',
  redialed?.busy === true && redialed.mode === 'video' && redialed.direction === 'out',
  JSON.stringify(redialed));
await A.evaluate(()=>document.getElementById('chatEndCallBtn')?.click());
await A.waitForTimeout(1500);

console.log('\n===== and the same call, placed from the phone =====');
/* The phone is where this was reported, and its stage is a tall portrait box
   rather than a wide one, so the centring has to hold in both shapes. The wait
   is for the previous ring to time out on the far side. */
await B.evaluate(()=>document.getElementById('chatModalRejectBtn')?.click());
await A.waitForTimeout(4000); await B.waitForTimeout(4000);
/* A finished call leaves the phone on the call log, which has no peer to dial
   -- open the conversation again first, the way a person would. */
await B.evaluate(()=>document.querySelector('[data-chat-view="chats"]')?.click());
await B.waitForTimeout(800);
await B.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await B.waitForTimeout(1200);
console.log('  B before dialling', JSON.stringify(await B.evaluate(()=>window.__callStateProbe?.())));
await B.evaluate(()=>document.getElementById('chatVideoCallBtn')?.click());
await B.waitForTimeout(4500);
console.log('  B while dialling', JSON.stringify(await B.evaluate(()=>window.__callStateProbe?.())));
const ringingB = await heroPlacement(B);
console.log('  phone, ringing', JSON.stringify(ringingB));
check('the person being called is in the middle of the phone screen too',
  Boolean(ringingB) && Math.abs(ringingB.offX) <= 2 && ringingB.bandY <= 0.12,
  JSON.stringify(ringingB));
await B.evaluate(()=>document.getElementById('chatFloatingEndCallBtn')?.click());
await B.waitForTimeout(1200);

await browser.close();
const bad = results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length?1:0);
