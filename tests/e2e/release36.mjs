/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Production UI regression: no debug probes. Run with E2E_ENGINE=webkit too. */
import { chromium, webkit } from 'playwright';
import fs from 'node:fs/promises';
const engine = process.env.E2E_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
await context.addInitScript(() => {
  localStorage.setItem('poorija_lang', 'en');
  try { delete Navigator.prototype.serviceWorker; } catch (_) {}
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
function check(name, ok, detail = '') { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); }
try {
  await page.goto(process.env.PKG_URL || 'http://localhost:8123');
  await page.evaluate(() => {
    selectLanguage('en');
    const set = (id, value) => { const e = document.getElementById(id); e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('setupPassword', 'Release36#Password!'); set('confirmPassword', 'Release36#Password!');
    const taken = new Set();
    document.querySelectorAll('#initialSetup select').forEach(s => { const o = [...s.options].find(o => o.value && !taken.has(o.value)); if (o) { taken.add(o.value); set(s.id, o.value); } });
    document.querySelectorAll('#initialSetup input[type=text]').forEach((e,i) => set(e.id, `answer${i}`));
    const terms = document.getElementById('acceptTermsCheckbox'); terms.checked = true; terms.dispatchEvent(new Event('change', { bubbles:true }));
    document.getElementById('setupBtn').click();
  });
  await page.waitForFunction(() => window.PoorijaApp?.state?.isLocked === false, { timeout: 90000 });
  const identities = await page.evaluate(async () => {
    await ensureIdentity();
    chatState.identity = null;
    localStorage.removeItem(CHAT_IDENTITY_STORAGE_KEY);
    encryptedStoreCache.delete(chatStorageAddress(CHAT_IDENTITY_STORAGE_KEY));
    return (await Promise.all(Array.from({ length: 4 }, () => ensureIdentity()))).map(i => i?.fingerprint);
  });
  check('concurrent identity requests return one stable identity', identities.every(Boolean) && new Set(identities).size === 1);
  check('production has no vault debug probe', await page.evaluate(() => !window.__vaultLockProbe));
  // Full shared-lock UI and erasure regression lives in release37.
  check('shared lock opens and requires a password for removal', await page.evaluate(async () => {
    const lock = PoorijaChat.vaultLock();
    if (!await lock.enable('file-manager-passphrase')) return false;
    if (!await lock.tryUnlock('file-manager-passphrase')) return false;
    return await lock.disable('file-manager-passphrase');
  }));
  await page.evaluate(() => switchTab('chat'));
  await page.waitForFunction(() => isChatInitialized);
  const shortcuts = await page.evaluate(async () => {
    const oldExport = exportPortableProfileFile;
    let exports = 0, imports = 0;
    exportPortableProfileFile = () => { exports++; };
    const input = document.getElementById('chatProfileImportInput');
    const oldClick = input.click; input.click = () => { imports++; };
    document.getElementById('chatIdentityProfileExportBtn').click();
    document.getElementById('chatIdentityProfileImportBtn').click();
    openIdentitySheet();
    document.querySelector('[data-identity-profile-export]').click();
    document.querySelector('[data-identity-profile-import]').click();
    exportPortableProfileFile = oldExport; input.click = oldClick;
    return { exports, imports, inside: !!document.querySelector('#chatIdentityStrip #chatIdentityProfileExportBtn') };
  });
  check('identity shortcuts use the existing encrypted export and import', shortcuts.exports === 2 && shortcuts.imports === 2 && shortcuts.inside, JSON.stringify(shortcuts));
  await page.evaluate(async () => {
    await ensureIdentity();
    window.__profileFingerprint = chatState.identity.fingerprint;
    window.__savedDialogs = { prompt: PoorijaDialogs.prompt, choose: PoorijaDialogs.choose };
    PoorijaDialogs.prompt = async () => 'portable-test-password';
    PoorijaDialogs.choose = async () => 'yes';
    chatState.profile.chatEnabled = false;
  });
  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-identity-profile-export]');
  const downloaded = await downloadPromise;
  const exported = await fs.readFile(await downloaded.path(), 'utf8');
  check('portable export is an encrypted envelope', JSON.parse(exported).type === 'poorija-portable-profile-enc' && !exported.includes('privateKeyData'));
  const roundtrip = await page.evaluate(async (text) => {
    const file = new File([text], 'profile.p00rijaconf', { type:'application/json' });
    PoorijaDialogs.prompt = async () => 'wrong-password';
    await importPortableProfileFile(file);
    const wrongPreserved = chatState.identity.fingerprint === window.__profileFingerprint;
    chatState.identity = { ...chatState.identity, fingerprint: 'temporary-test-identity' };
    PoorijaDialogs.prompt = async () => 'portable-test-password';
    await importPortableProfileFile(file);
    const restored = chatState.identity.fingerprint === window.__profileFingerprint;
    Object.assign(PoorijaDialogs, window.__savedDialogs);
    return { wrongPreserved, restored };
  }, exported);
  check('wrong portable password preserves the current identity', roundtrip.wrongPreserved);
  check('portable profile round trip restores the identity', roundtrip.restored);
  const adaptation = await page.evaluate(async () => {
    const writes = [];
    const sender = { track: { kind:'video', id:'camera', readyState:'live', contentHint:'motion' }, getParameters: () => ({ encodings:[{ rid:'main' }] }), setParameters: async p => writes.push(structuredClone(p)) };
    const pc = { getSenders: () => [sender] };
    const good = { rtt:40, outboundLoss:0, availableOutgoingBitrate:3000000 };
    await adaptCallSenders(pc, good);
    await adaptCallSenders(pc, { rtt:650, outboundLoss:12, availableOutgoingBitrate:200000 });
    const bad = writes.at(-1);
    await adaptCallSenders(pc, good); await adaptCallSenders(pc, good);
    const held = writes.at(-1).encodings[0].maxBitrate;
    await adaptCallSenders(pc, good);
    const recovery = writes.at(-1);
    sender.track.contentHint = 'detail'; await adaptCallSenders(pc, good);
    const screen = writes.at(-1);
    const absent = { getSenders: () => [{ track: sender.track, getParameters: () => ({encodings:[]}), setParameters: () => { throw Error('must not run'); } }] };
    await adaptCallSenders(absent, good);
    const unsupported = { getSenders: () => [{ track: sender.track, getParameters: () => ({encodings:[{}]}), setParameters: async p => { if ('degradationPreference' in p) throw new DOMException('', 'NotSupportedError'); writes.push(p); } }] };
    await adaptCallSenders(unsupported, good);
    return { bad, held, recovery, screen, fallback: writes.at(-1), initial: writes[0] };
  });
  check('bad network reduces bitrate and preserves camera motion', adaptation.bad.encodings[0].maxBitrate === 150000 && adaptation.bad.degradationPreference === 'maintain-framerate');
  check('recovery waits for three healthy samples', adaptation.held <= 180000 && adaptation.recovery.encodings[0].maxBitrate === 600000);
  check('screen sharing preserves readability', adaptation.screen.degradationPreference === 'maintain-resolution');
  check('unsupported degradation hint retains bitrate fallback', adaptation.fallback.encodings[0].maxBitrate === 2000000 && !adaptation.fallback.degradationPreference);
  const codecs = await page.evaluate(async () => {
    const a = new RTCPeerConnection(), b = new RTCPeerConnection();
    try {
      a.addTransceiver('audio');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d').fillRect(0,0,64,64);
      const stream = canvas.captureStream(5);
      const sender = a.addTrack(stream.getVideoTracks()[0], stream);
      const offer = await a.createOffer();
      const before = offer.sdp;
      offer.sdp = preferCallCodecs(offer.sdp);
      await a.setLocalDescription(offer); await b.setRemoteDescription(offer);
      const answer = await b.createAnswer(); answer.sdp = preferCallCodecs(answer.sdp);
      await b.setLocalDescription(answer); await a.setRemoteDescription(answer);
      await adaptCallSenders(a, { rtt: 40, outboundLoss: 0, availableOutgoingBitrate: 3000000 });
      const appliedBitrate = sender.getParameters().encodings?.[0]?.maxBitrate;
      stream.getTracks().forEach(t => t.stop());
      const payloads = s => s.split('\r\n').filter(l => /^m=(audio|video)/.test(l)).map(l => l.split(' ').slice(3).sort().join(','));
      return { appliedBitrate, samePayloads: JSON.stringify(payloads(before)) === JSON.stringify(payloads(offer.sdp)), stable: a.signalingState === 'stable' && b.signalingState === 'stable', preferred: offer.sdp.match(/^m=(audio|video).*$/gm) };
    } finally { a.close(); b.close(); }
  });
  check('preferred SDP negotiates on real peer connections', codecs.stable, JSON.stringify(codecs.preferred));
  check('codec preference preserves every fallback payload', codecs.samePayloads);
  check('real browser sender accepts the bitrate cap', codecs.appliedBitrate === 2000000, String(codecs.appliedBitrate));
  const interval = await page.evaluate(() => {
    const pc = {};
    const sample = (t,l,r) => new Map([['x',{id:'x',type:'remote-inbound-rtp',timestamp:t,packetsLost:l,packetsReceived:r}]]);
    const first = callIntervalLoss(pc,sample(1,100,900));
    const healthy = callIntervalLoss(pc,sample(2,100,1000));
    const bad = callIntervalLoss(pc,sample(3,120,1080));
    const stale = callIntervalLoss(pc,sample(3,120,1080));
    return {first,healthy,bad,stale};
  });
  check('adaptation uses interval loss, not historic loss', interval.first === null && interval.healthy === 0 && interval.bad === 20 && interval.stale === null);
  const selected = await page.evaluate(async () => {
    const reports = [
      { id:'transport', type:'transport', selectedCandidatePairId:'chosen' },
      { id:'old', type:'candidate-pair', state:'succeeded', currentRoundTripTime:1.2 },
      { id:'chosen', type:'candidate-pair', state:'succeeded', nominated:true, currentRoundTripTime:0.04, availableOutgoingBitrate:1500000 },
    ];
    // RTCStatsReport accessors need not return the same JS object instance.
    const stats = { get:id => structuredClone(reports.find(r => r.id === id)), forEach:cb => reports.forEach(r => cb(structuredClone(r))) };
    return await readCallQuality({getStats:async()=>stats});
  });
  check('quality reads the selected path by ID across distinct stats objects', selected.rtt === 40 && selected.availableOutgoingBitrate === 1500000);
  await page.evaluate(() => closeFullSheet());
  await page.locator('#toastStack').waitFor({state:'detached'}); // Let profile-operation toasts expire.
  // Exercise the shared mobile overlay CSS in both native and standalone modes.
  for (const shell of ['pwa-standalone', 'native-mobile']) {
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150);
      const layout = await page.evaluate(({shell}) => {
        toggleSidebar(false);
        document.documentElement.classList.add(shell);
        document.documentElement.style.setProperty('--pwa-safe-top', '24px');
        const overlay = document.getElementById('chatFloatingCall');
        overlay.classList.remove('hidden', 'chrome-hidden');
        overlay.dataset.callDisplay = 'fullscreen';
        document.getElementById('chatFloatingCallTitle').textContent = 'تماس تصویری فعال';
        document.getElementById('chatFloatingCallStatus').textContent = 'اتصال امن برقرار است';
        const strip = document.getElementById('chatCallVerifyStrip');
        strip.classList.remove('hidden');
        strip.querySelector('.chat-call-verify-emoji').textContent = '🔥 ☂️ 🎂 🎅 ⚓ 🐢';
        document.getElementById('chatCallQualityMineValue').textContent = '145ms';
        document.getElementById('chatCallQualityTheirsValue').textContent = '109ms';
        const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}; };
        return { quality:rect('chatCallQualityBadge'), verify:rect('chatCallVerifyStrip'), end:rect('chatFloatingEndCallBtn'), add:rect('chatCallAddPeopleBtn'), back:rect('chatMinimizeCallBtn'), bounds:rect('chatFloatingCall') };
      }, {shell});
      check(`${shell} ${width}px: diagnostics below left controls without overlap`,
        layout.quality.top >= Math.max(layout.end.bottom, layout.add.bottom)
        && layout.verify.top >= layout.quality.bottom
        && layout.quality.left < layout.back.left
        && layout.verify.right <= layout.bounds.right
        && layout.quality.right <= layout.bounds.right, JSON.stringify(layout));
      if (process.env.E2E_SCREENSHOT && shell === 'pwa-standalone' && width === 390) await page.screenshot({path:process.env.E2E_SCREENSHOT});
      await page.evaluate(shell => {
        document.documentElement.classList.remove(shell);
        document.getElementById('chatFloatingCall').classList.add('hidden');
      }, shell);
    }
  }
  check('no uncaught browser errors', errors.length === 0, errors.join('; '));
} finally { await browser.close(); }
console.log(`\n===== ${results.filter(x => !x).length} failed of ${results.length} =====`);
process.exitCode = results.some(x => !x) ? 1 : 0;
