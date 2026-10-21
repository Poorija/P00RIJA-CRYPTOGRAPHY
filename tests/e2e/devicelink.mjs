/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Linking a device with a QR code, both ways round, and a call's voice and
 * picture.
 *
 * ALI has the account and talks to SARA. DESK and PHONE are new devices.
 *
 *   "add": ALI shows a code, PHONE scans it, ALI approves on seeing the same
 *     six digits PHONE shows — and PHONE is ALI's account, with SARA in its
 *     contacts and the history arriving from ALI;
 *   the code changes every ten seconds; an old one is refused; a code someone
 *     else scanned and ALI declined hands over nothing;
 *   "join": DESK shows a code, ALI scans it, DESK accepts — and DESK is the
 *     account too; nothing of the account crossed the relay readable;
 *   a call: the self-view is not mirrored unless asked for; the microphone
 *     goes through the noise suppressor; Opus is asked for full band without
 *     DTX; and the camera is asked for 60 frames a second.
 */
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 400) : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const fingerprintOf = (card) => JSON.parse(Buffer.from(card.replace('poorija-chat-v1:', ''), 'base64').toString('utf8')).fingerprint;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fingerprintHere = (page) => page.evaluate(() => chatState.identity?.fingerprint || '');
const yesToDialogs = (page) => page.evaluate(() => {
  window.PoorijaDialogs.confirm = async () => true;
  window.PoorijaDialogs.choose = async (_question, options) => options[0]?.value;
});
const qrOf = (page) => page.evaluate(() => window.__deviceLinkProbe.qr());
const click = (page, action) => page.evaluate((name) => document.querySelector(`.chat-link-overlay [data-link-action="${name}"]`)?.click(), action);
const sasOf = (page) => page.evaluate(() => document.querySelector('.chat-link-overlay [data-link-sas]')?.textContent || '');

const stacks = await startTwoStacks();
let FAR = null;
try {
  section('an account with a contact and a conversation');
  const ALI = await openApp('ALI', { origin: stacks.a.url, relay: stacks.a.url });
  const SARA = await openApp('SARA', { origin: stacks.a.url, relay: stacks.a.url });
  const cardAli = await identity(ALI);
  const fpAli = fingerprintOf(cardAli);
  const cardSara = await identity(SARA);
  const fpSara = fingerprintOf(cardSara);
  await importIdentity(SARA, cardAli);
  await importIdentity(ALI, cardSara);
  await ALI.evaluate(async (fp) => {
    const peer = findPeerByAnyKey(fp);
    const key = getConversationKey(peer);
    appendHistory(key, { id: `before-link-${Date.now()}`, type: 'text', direction: 'out', text: 'said before linking', createdAt: new Date().toISOString(), status: 'sent' });
  }, fpSara);
  await yesToDialogs(ALI);

  section('"add": the account shows a code, the new device scans it');
  await ALI.evaluate(() => window.openLinkChooser('account'));
  const chooser = await ALI.evaluate(() => [...document.querySelectorAll('.chat-link-overlay [data-link-action]')].map((node) => node.getAttribute('data-link-action')));
  check('"Add a device" offers showing a code, scanning one, and the profile file', ['show-add', 'scan', 'export'].every((name) => chooser.includes(name)), JSON.stringify(chooser));
  await click(ALI, 'show-add');
  await waitFor(ALI, () => Boolean(window.__deviceLinkProbe.qr()), { timeoutMs: 20000 });
  const firstCode = await qrOf(ALI);
  const drawn = await ALI.evaluate(() => Boolean(document.querySelector('.chat-link-overlay [data-link-qr] canvas, .chat-link-overlay [data-link-qr] img')));
  check('a QR code is on the screen', Boolean(firstCode) && drawn, String(firstCode).slice(0, 40));
  const readable = await ALI.evaluate(async (text) => {
    const report = await window.PoorijaQR.audit(text, { px: 340, level: 'L', preset: 'classic', quiet: 4 });
    return { grade: report.grade, modules: report.modules, chars: report.chars, resilience: report.resilience, findings: (report.findings || []).map((f) => f.id) };
  }, firstCode);
  check('and a phone camera can read it, damaged or at an angle', readable.grade !== 'fail', JSON.stringify(readable));
  await sleep(10800);
  const secondCode = await qrOf(ALI);
  check('and it changes every ten seconds', Boolean(secondCode) && secondCode !== firstCode);

  const STRANGER = await openApp('STRANGER', { origin: stacks.a.url, relay: stacks.a.url });
  await identity(STRANGER);
  await yesToDialogs(STRANGER);
  await sleep(20500);
  await STRANGER.evaluate((code) => window.__deviceLinkProbe.scan(code), firstCode);
  const stale = await waitFor(STRANGER, () => window.__deviceLinkProbe.state().outcome === 'expired', { timeoutMs: 15000 });
  const askedForStale = await ALI.evaluate(() => Boolean(document.querySelector('.chat-link-overlay [data-link-action="approve"]')));
  check('a code from half a minute ago is refused, and the device that scanned it is told', stale === true && !askedForStale, JSON.stringify(await STRANGER.evaluate(() => window.__deviceLinkProbe.state())));

  const current = await qrOf(ALI);
  await STRANGER.evaluate((code) => window.__deviceLinkProbe.scan(code), current);
  const askedAli = await waitFor(ALI, () => Boolean(document.querySelector('.chat-link-overlay [data-link-action="approve"]')), { timeoutMs: 20000 });
  const strangerSas = await sasOf(STRANGER);
  const aliSasForStranger = await sasOf(ALI);
  check('whoever scans, the account\'s device asks first, showing the same six digits', askedAli === true && /^\d{3} \d{3}$/.test(aliSasForStranger) && aliSasForStranger === strangerSas, `${aliSasForStranger} / ${strangerSas}`);
  await click(ALI, 'deny');
  await sleep(2500);
  check('declined: the scanning device gets nothing of the account', (await fingerprintHere(STRANGER)) !== fpAli);

  const PHONE = await openApp('PHONE', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
  await identity(PHONE);
  await yesToDialogs(PHONE);
  await waitFor(ALI, (old) => { const code = window.__deviceLinkProbe.qr(); return Boolean(code && code !== old && !document.querySelector('.chat-link-overlay [data-link-action="approve"]')); }, { timeoutMs: 20000, arg: current });
  const freshCode = await qrOf(ALI);
  await ALI.evaluate(() => {
    window.__linkFrames = [];
    const realSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function send(data) {
      if (typeof data === 'string' && data.includes('device-link')) window.__linkFrames.push(data);
      return realSend.call(this, data);
    };
  });
  const scanned = await PHONE.evaluate((code) => window.__deviceLinkProbe.scan(code), freshCode);
  await waitFor(ALI, () => Boolean(document.querySelector('.chat-link-overlay [data-link-action="approve"]')), { timeoutMs: 20000 });
  const phoneSas = await sasOf(PHONE);
  const aliSas = await sasOf(ALI);
  check('the two screens show the same code', scanned.ok && aliSas === phoneSas && aliSas === scanned.sas, `${aliSas} / ${phoneSas}`);
  await click(ALI, 'approve');
  const joined = await waitFor(PHONE, (fp) => chatState.identity?.fingerprint === fp, { timeoutMs: 45000, arg: fpAli });
  check('approved: the new device is the account', joined === true);
  const phoneHas = await waitFor(PHONE, (fp) => (chatState.peers || []).some((peer) => peer.fingerprint === fp && isStoredContact(peer)), { timeoutMs: 20000, arg: fpSara });
  check('with the account\'s contacts', phoneHas === true);
  const history = await waitFor(PHONE, (fp) => (chatState.history[getConversationKey(findPeerByAnyKey(fp))] || []).some((e) => e.text === 'said before linking'), { timeoutMs: 60000, arg: fpSara });
  check('and the history arrives from the other device', history === true);
  const aliDone = await waitFor(ALI, () => Boolean(document.querySelector('.chat-link-overlay .chat-link-done')), { timeoutMs: 20000 });
  check('the account\'s device says it is done', aliDone === true);
  const relayFrames = await ALI.evaluate(() => window.__linkFrames || []);
  const sawAccount = relayFrames.some((frame) => frame.includes('privateKeyData') || frame.includes(fpSara) || frame.includes('said before linking'));
  check('and nothing of the account crossed the relay readable', relayFrames.some((frame) => frame.includes('"s":"account"')) && !sawAccount, `${relayFrames.length} frame(s)`);

  section('"join": the new device shows a code, the account scans it');
  await ALI.evaluate(() => window.__deviceLinkProbe.stop());
  const DESK = await openApp('DESK', { origin: stacks.a.url, relay: stacks.a.url });
  await identity(DESK);
  await yesToDialogs(DESK);
  await DESK.evaluate(() => window.openLinkChooser('new'));
  const deskChooser = await DESK.evaluate(() => [...document.querySelectorAll('.chat-link-overlay [data-link-action]')].map((node) => node.getAttribute('data-link-action')));
  check('"Link this device" offers showing a code, scanning one, and the profile file', ['show-join', 'scan', 'import'].every((name) => deskChooser.includes(name)), JSON.stringify(deskChooser));
  await click(DESK, 'show-join');
  await waitFor(DESK, () => Boolean(window.__deviceLinkProbe.qr()), { timeoutMs: 20000 });
  const deskCode = await qrOf(DESK);
  const aliScan = await ALI.evaluate((code) => window.__deviceLinkProbe.scan(code), deskCode);
  await waitFor(DESK, () => Boolean(document.querySelector('.chat-link-overlay [data-link-action="approve"]')), { timeoutMs: 20000 });
  const deskSas = await sasOf(DESK);
  check('the new device asks before it joins, with the same code', aliScan.ok && deskSas === aliScan.sas, `${aliScan.sas} / ${deskSas}`);
  await ALI.evaluate(() => window.__deviceLinkProbe.pushAccountNow());
  await sleep(2500);
  check('an account pushed before the new device said "Join" is ignored', (await fingerprintHere(DESK)) !== fpAli);
  await click(DESK, 'approve');
  const deskJoined = await waitFor(DESK, (fp) => chatState.identity?.fingerprint === fp, { timeoutMs: 45000, arg: fpAli });
  check('accepted: the desktop is the account', deskJoined === true);
  const listed = await waitFor(ALI, () => window.__deviceRosterProbe.devices().length >= 3, { timeoutMs: 45000 });
  check('and the account lists all three devices', listed === true, JSON.stringify(await ALI.evaluate(() => window.__deviceRosterProbe.summary())));

  section('across the two relays');
  FAR = await openApp('FAR', { origin: stacks.b.url, relay: stacks.b.url });
  await identity(FAR);
  await yesToDialogs(FAR);
  await ALI.evaluate(() => { window.__deviceLinkProbe.stop(); window.openLinkChooser('account'); document.querySelector('.chat-link-overlay [data-link-action="show-add"]').click(); });
  await waitFor(ALI, () => Boolean(window.__deviceLinkProbe.qr()), { timeoutMs: 20000 });
  const farScan = await FAR.evaluate(async (code) => window.__deviceLinkProbe.scan(code), await qrOf(ALI));
  const farAsked = await waitFor(ALI, () => Boolean(document.querySelector('.chat-link-overlay [data-link-action="approve"]')), { timeoutMs: 30000 });
  check('a device on the other relay reaches the code\'s device over transit', farScan.ok && farAsked === true, JSON.stringify(farScan));
  if (farAsked === true) {
    check('with the same six digits', (await sasOf(ALI)) === farScan.sas);
    await click(ALI, 'approve');
    const farJoined = await waitFor(FAR, (fp) => chatState.identity?.fingerprint === fp, { timeoutMs: 60000, arg: fpAli });
    check('and joins the account', farJoined === true);
  }
  await ALI.evaluate(() => window.__deviceLinkProbe.stop());

  section('a call\'s voice and picture');
  const call = await ALI.evaluate(async () => {
    const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let asked = null;
    navigator.mediaDevices.getUserMedia = (constraints) => { if (!asked && constraints?.video) asked = constraints.video; return realGum(constraints); };
    const enabled = window.__callAudioProbe.enabled();
    const prepared = await window.__callAudioProbe.prepare();
    const constraints = window.__callAudioProbe.constraints();
    const stream = await requestCallMedia('video');
    const audio = stream.getAudioTracks()[0];
    const video = stream.getVideoTracks()[0];
    const pipelines = window.__callAudioProbe.active();
    const settings = video?.getSettings?.() || {};
    const opus = (() => {
      const lines = ['a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1'];
      tuneOpus(lines, [['111', 'opus']]);
      return lines[1];
    })();
    const mirrorDefault = chatState.profile?.mirrorSelfVideo === true;
    stream.getTracks().forEach((track) => track.stop());
    await new Promise((r) => setTimeout(r, 300));
    navigator.mediaDevices.getUserMedia = realGum;
    return { enabled, prepared, constraints, audioLabel: audio?.label || '', pipelines, after: window.__callAudioProbe.active().length, fps: settings.frameRate || 0, askedFps: asked?.frameRate?.ideal || 0, opus, mirrorDefault };
  });
  check('noise removal is on by default and loads', call.enabled === true && call.prepared === true, JSON.stringify({ enabled: call.enabled, prepared: call.prepared }));
  check('the microphone goes through it, at 48 kHz in one channel, without the browser\'s own suppression doubling it',
    call.pipelines.length === 1 && call.pipelines[0].state === 'running' && call.constraints.noiseSuppression === false && call.constraints.sampleRate?.ideal === 48000, JSON.stringify({ pipelines: call.pipelines, constraints: call.constraints }));
  check('and ending the call closes it, microphone and all', call.after === 0, String(call.after));
  check('Opus is asked for full band, mono, without DTX, with FEC', /usedtx=0/.test(call.opus) && /maxplaybackrate=48000/.test(call.opus) && /stereo=0/.test(call.opus) && /useinbandfec=1/.test(call.opus), call.opus);
  check('the camera is asked for 60 frames a second', call.askedFps === 60, `asked ${call.askedFps}, the test camera gave ${call.fps}`);
  check('the self-view is not mirrored by default', call.mirrorDefault === false && (await ALI.evaluate(() => chatState.callMirrorSelf)) === false);

  const errors = [ALI, SARA, PHONE, DESK, STRANGER, FAR].filter(Boolean).flatMap((page) => page.__errors || []);
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
