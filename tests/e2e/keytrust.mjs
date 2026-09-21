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
/* Trust on first use, and what happens when the key underneath a contact
   changes.
 *
 *   npm run relay                 # terminal 1
 *   PORT=8123 npm run dev         # terminal 2
 *   npm run test:keytrust
 *
 * The relay hands every client the public keys of everyone online, so a
 * hostile relay could swap one for its own and read everything from then on —
 * the single attack end-to-end encryption cannot see by itself. The app pins
 * the key a contact was first seen with; this drives a real key change through
 * a real relay and checks that the swap is refused, reported, and recoverable.
 */
const BASE = process.env.PKG_URL || 'http://localhost:8123';
/* Reachable FROM THE PAGE, not just from here: an https page cannot fetch
   http://localhost:9000 or open a ws:// socket to it — the browser blocks it as
   mixed content and the suite reads that as a relay that is down. When the app
   is served over https the relay defaults to that same origin, which is the
   container serving both halves. The env var still wins. */
const RELAY = process.env.PKG_RELAY
  || (/^https:/i.test(BASE) ? String(BASE).replace(/\/+$/, '') : 'http://localhost:9000');
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d='') => { results.push({n, ok}); console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const browser = await chromium.launch();

async function boot(tag) {
  const ctx = await browser.newContext({ viewport:{width:1280,height:900} });
  await ctx.addInitScript(()=>{try{localStorage.setItem('poorija_lang','fa');}catch(e){} window.__clip=[];});
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`   ${tag}!! ${e.message.slice(0,120)}`));
  await page.goto(`${BASE}/index.html`, { waitUntil:'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((pass)=>{const set=(id,v)=>{const el=document.getElementById(id);if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
    set('setupPassword',pass); set('confirmPassword',pass);
    document.querySelectorAll('#initialSetup select').forEach((s,i)=>{if(s.options.length>i+1){s.selectedIndex=i+1;s.dispatchEvent(new Event('change',{bubbles:true}));}});
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp,i)=>{inp.value='answer'+i;inp.dispatchEvent(new Event('input',{bubbles:true}));});
    const cb=document.getElementById('acceptTermsCheckbox'); if(cb&&!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}}, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(3500);
  await page.evaluate(()=>{document.getElementById('mobileInstallGate')?.classList.add('hidden');
    const w=navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText=(t)=>{window.__clip.push(t);return w(t).catch(()=>{});};
    window.switchTab?.('chat');});
  await page.waitForTimeout(1200);
  await page.evaluate((relay)=>{const u=document.getElementById('chatServerUrl');
    if(u){u.value=relay;u.dispatchEvent(new Event('input',{bubbles:true}));u.dispatchEvent(new Event('change',{bubbles:true}));}
    document.getElementById('chatConnectBtn')?.click();}, RELAY);
  await page.waitForTimeout(5500);
  return { ctx, page };
}

console.log('\n===== two people meet, and the first key is the pinned one =====');
const A = await boot('A');
const B = await boot('B');
const idB = await B.page.evaluate(async()=>{ await window.copyChatFullIdentity(); return window.__clip.at(-1); });
await A.page.evaluate(async(x)=>{ document.getElementById('chatStartChatBtn')?.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelector('[data-chat-manual-json]').value = x;
  document.querySelector('[data-chat-manual-submit]')?.click(); }, idB);
await A.page.waitForTimeout(2500);
await A.page.evaluate(()=>document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.page.waitForTimeout(2500);
await A.page.fill('#chatComposer', 'first contact');
await A.page.click('#chatSendMessageBtn');
await B.page.waitForTimeout(3500);

const pinned = await A.page.evaluate(()=>{
  const peer = window.__peerProbe?.();
  return peer ? { hasTrusted: Boolean(peer.trustedKey), matches: peer.trustedKey === peer.publicKeyData,
    changed: Boolean(peer.keyChangedAt) } : null;
});
console.log('  ' + JSON.stringify(pinned));
check('the key a contact is first seen with is pinned',
  pinned?.hasTrusted === true && pinned.matches === true && pinned.changed === false, JSON.stringify(pinned));
check('and no alarm is raised when nothing has changed',
  await A.page.evaluate(()=>document.getElementById('chatKeyAlert')?.classList.contains('hidden')) === true, 'quiet');

console.log('\n===== a hostile relay swaps the key underneath the name =====');
/* The attack this exists for. The relay is what hands out public keys, so a
   compromised one can offer its OWN key while keeping the victim's name and
   peer id — and if the app also took the claimed fingerprint at face value,
   the safety numbers on both phones would still match while the relay read
   everything. Delivered here as the relay itself would deliver it: a peers
   frame straight into the socket handler. */
const swap = await A.page.evaluate(async () => {
  const peer = window.__peerProbe();
  /* A key that is genuinely someone else's — generated here, exported the same
     way an identity is. */
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('spki', pair.publicKey);
  const attackerKey = window.PoorijaApp.arrayBufferToBase64(raw);
  const verified = await window.__injectPeersFrame({
    clientId: window.__peerProbe.clientId || '',
    peerId: window.__lastPeerId(),
    username: 'B',
    publicKeyData: attackerKey,
    /* The lie: the victim's fingerprint on the attacker's key. */
    fingerprint: peer.fingerprint,
  });
  await new Promise((r) => setTimeout(r, 1200));
  return { attackerKey, verified };
});
await A.page.waitForTimeout(1500);

const afterChange = await A.page.evaluate(() => {
  const peer = window.__peerProbe();
  const alert = document.getElementById('chatKeyAlert');
  const notes = [...document.querySelectorAll('#chatMessages .chat-system-note')].map((n) => n.textContent.trim());
  return { changed: Boolean(peer?.keyChangedAt), pending: Boolean(peer?.pendingKey),
    stillTrustsOld: peer?.publicKeyData === peer?.trustedKey,
    usesAttackerKey: peer?.publicKeyData === peer?.pendingKey,
    alertVisible: alert ? !alert.classList.contains('hidden') : false,
    note: notes.some((n) => /کلید امنیتی|security key/i.test(n)) };
});
console.log('  ' + JSON.stringify(afterChange));
check('the substituted key is refused, not adopted',
  afterChange.changed === true && afterChange.pending === true
  && afterChange.stillTrustsOld === true && afterChange.usesAttackerKey === false,
  JSON.stringify(afterChange));
check('and the conversation says so, on screen and in its history',
  afterChange.alertVisible === true && afterChange.note === true, JSON.stringify(afterChange));

/* And the reason the pin can be trusted at all: the fingerprint is recomputed
   from the key that arrived, so a relay cannot dress its own key in someone
   else's fingerprint and slip past the safety number. */
const fingerprintCheck = await A.page.evaluate(async (attackerKey) => {
  const raw = window.PoorijaApp.base64ToArrayBuffer(attackerKey);
  const digest = await crypto.subtle.digest('SHA-256', raw);
  const computed = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const peer = window.__peerProbe();
  return { computed, pendingFingerprint: peer.pendingFingerprint || '', claimed: peer.fingerprint };
}, swap.attackerKey);
console.log('  ' + JSON.stringify({ ...fingerprintCheck, computed: fingerprintCheck.computed.slice(0, 16) + '…' }));
check('a claimed fingerprint that its key cannot produce is replaced by the real one',
  fingerprintCheck.pendingFingerprint === fingerprintCheck.computed
  && fingerprintCheck.pendingFingerprint !== fingerprintCheck.claimed,
  `${fingerprintCheck.pendingFingerprint.slice(0, 12)}… vs claimed ${fingerprintCheck.claimed.slice(0, 12)}…`);

console.log('\n===== the person decides =====');
await A.page.evaluate(()=>document.getElementById('chatKeyKeepBtn')?.click());
await A.page.waitForTimeout(1200);
const kept = await A.page.evaluate(()=>{
  const peer = window.__peerProbe?.();
  return { changed: Boolean(peer?.keyChangedAt), pending: Boolean(peer?.pendingKey),
    trustedUnmoved: peer?.publicKeyData === peer?.trustedKey,
    alertVisible: !document.getElementById('chatKeyAlert')?.classList.contains('hidden') };
});
console.log('  ' + JSON.stringify(kept));
check('keeping the old key leaves the pin where it was',
  kept.changed === false && kept.pending === false && kept.trustedUnmoved === true && kept.alertVisible === false,
  JSON.stringify(kept));

/* ---- accepting the new key must not open a new chat ------------------
   The conversation id is fingerprint-first, so an accepted key change used
   to retarget the record at a fresh id: the thread emptied, the history sat
   behind a key nobody reads any more, and the whole thing read as a new
   conversation. The id is anchored now — verify the SAME conversation keeps
   its messages across an accept. */
console.log('\n===== accepting the new key keeps the same conversation =====');
/* The real peer's presence would keep re-arming the alert after a swap — an
   honest app reaction, but noise for this check. They go away first, which is
   also what a reinstall actually looks like: the old presence disappears. */
const beforeAccept = await A.page.evaluate(() => ({
  convKey: window.getConversationKey(window.__peerProbe()),
  bubbles: document.querySelectorAll('#chatMessages [data-id]').length,
  historyLen: (window.chatState?.history?.[window.getConversationKey(window.__peerProbe())] || []).length,
}));
await B.ctx.close();
await A.page.waitForTimeout(3000);
const swapAgain = await A.page.evaluate(async () => {
  const peer = window.__peerProbe();
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('spki', pair.publicKey);
  const attackerKey = window.PoorijaApp.arrayBufferToBase64(raw);
  await window.__injectPeersFrame({
    clientId: window.__peerProbe.clientId || '',
    peerId: window.__lastPeerId(),
    username: 'B',
    publicKeyData: attackerKey,
    fingerprint: peer.fingerprint,
  });
  await new Promise((r) => setTimeout(r, 1200));
  return attackerKey;
});
await A.page.waitForTimeout(600);
/* Accepting goes through a confirmation dialog, the way deleting does. */
await A.page.evaluate(() => document.getElementById('chatKeyAcceptBtn')?.click());
await A.page.waitForTimeout(300);
await A.page.evaluate(() => {
  const ok = document.querySelector('.poorija-dialog:not(.hidden) .poorija-dialog-ok');
  if (ok) ok.click();
});
await A.page.waitForTimeout(1200);
const afterAccept = await A.page.evaluate((attackerKey) => {
  const peer = window.__peerProbe();
  const convKey = window.getConversationKey(peer);
  return {
    adopted: peer?.publicKeyData === attackerKey && peer?.trustedKey === attackerKey,
    alertVisible: !document.getElementById('chatKeyAlert')?.classList.contains('hidden'),
    convKey,
    historyLen: (window.chatState?.history?.[convKey] || []).length,
    bubbles: document.querySelectorAll('#chatMessages [data-id]').length,
    redNote: [...document.querySelectorAll('#chatMessages .chat-system-note.is-key-change')].length,
    threadNote: [...document.querySelectorAll('#chatMessages .chat-system-note')]
      .some((n) => /دیگر نمی‌توان اصالتشان|no longer be verified/i.test(n.textContent || '')),
  };
}, swapAgain);
console.log('  ' + JSON.stringify({ ...afterAccept, convKey: afterAccept.convKey.slice(0, 10) + '…', before: beforeAccept.convKey.slice(0, 10) + '…' }));
check('the offered key becomes the pinned one',
  afterAccept.adopted === true && afterAccept.alertVisible === false, JSON.stringify({ adopted: afterAccept.adopted, alertVisible: afterAccept.alertVisible }));
check('the conversation id does not move when the key does',
  afterAccept.convKey === beforeAccept.convKey, `${beforeAccept.convKey.slice(0, 12)}… -> ${afterAccept.convKey.slice(0, 12)}…`);
check('the old messages are still in that same conversation',
  afterAccept.historyLen >= beforeAccept.historyLen && afterAccept.bubbles >= beforeAccept.bubbles,
  `history ${beforeAccept.historyLen} -> ${afterAccept.historyLen}, bubbles ${beforeAccept.bubbles} -> ${afterAccept.bubbles}`);
check('the trust note rides in the thread, red and explicit',
  afterAccept.redNote >= 1 && afterAccept.threadNote === true,
  `is-key-change notes: ${afterAccept.redNote}`);

await browser.close();
const bad = results.filter(r=>!r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length?1:0);
