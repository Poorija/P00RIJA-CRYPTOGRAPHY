/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* One account, several devices, one of them its primary.
 *
 * ALI made the identity; ALI2, ALI3, ALI5 and ALI6 were added to it the way
 * the portable profile adds a device. SARA is a contact.
 *
 *   - ALI is the primary, the relay holds the roster it signed, and every
 *     other device introduces itself and is listed by it;
 *   - a device that is away is still listed, as offline, and the count says
 *     how many there are and how many are online;
 *   - only the primary is offered "revoke"; another device forging a roster
 *     that revokes somebody is refused by the relay and by the siblings;
 *   - a file not on this device: one line, and a button that is a button;
 *   - "sync all content", switched on on one device, is the account's: the
 *     files the other has come over by themselves, device to device;
 *   - the primary revokes a device that is online: it is shut out, removes the
 *     account from itself and carries on with an identity of its own;
 *   - a device carrying a revoked device's id is refused at the door;
 *   - a device revoked while it was away learns it when it comes back;
 *   - a device detaches itself, and the primary lists it as gone;
 *   - the primary hands its role on, and the old primary can no longer revoke;
 *   - a manual sync still works; and an unproven socket cannot purge anybody.
 */
import fs from 'node:fs';
import path from 'node:path';
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

/* What the portable profile does on the new device: the identity, marked as
   made elsewhere, and the roster the file carries. */
const joinAccount = (page, ident, roster) => page.evaluate(async ({ ident, roster }) => {
  chatState.shouldReconnect = false;
  try { chatState.ws?.close(); } catch (_error) { /* gone */ }
  await new Promise((r) => setTimeout(r, 800));
  chatState.identity = { ...ident, origin: 'imported' };
  saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, chatState.identity);
  chatState.deviceRoster = null;
  if (roster) await adoptRoster(roster);
  chatState.shouldReconnect = true;
  renderStaticUi();
  await connectChatTransport();
  await new Promise((r) => setTimeout(r, 600));
  broadcastHello();
}, { ident, roster });
const openConversation = (page, fp) => page.evaluate(async (key) => {
  const peer = findPeerByAnyKey(key);
  chatState.activeConversationId = getConversationKey(peer);
  chatState.activePeerClientId = peer.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 400));
}, fp);
const sendText = (page, text) => page.evaluate(async (value) => {
  const box = document.getElementById('chatComposer');
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('chatSendMessageBtn').click();
  await new Promise((r) => setTimeout(r, 300));
}, text);
const hasText = (page, fp, text) => waitFor(page, ({ key, value }) => (chatState.history[getConversationKey(findPeerByAnyKey(key))] || []).some((e) => e.text === value), { timeoutMs: 45000, arg: { key: fp, value: text } });
const relayRoster = (dir, fp) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'rosters', `${fp}.json`), 'utf8')); } catch (_error) { return null; }
};
const relayBeaconIds = (dir, fp) => {
  try { return Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'beacons', `${fp}.json`), 'utf8'))); } catch (_error) { return []; }
};
const deviceIdOf = (page) => page.evaluate(() => getDeviceId());
const fingerprintHere = (page) => page.evaluate(() => chatState.identity?.fingerprint || '');
const yesToDialogs = (page) => page.evaluate(() => {
  window.PoorijaDialogs.confirm = async () => true;
  window.PoorijaDialogs.choose = async (_question, options) => options[0]?.value;
});

const stacks = await startTwoStacks();
try {
  section('an account and its devices');
  const ALI = await openApp('ALI', { origin: stacks.a.url, relay: stacks.a.url });
  const SARA = await openApp('SARA', { origin: stacks.a.url, relay: stacks.a.url });
  const cardAli = await identity(ALI);
  const fpAli = fingerprintOf(cardAli);
  const cardSara = await identity(SARA);
  const fpSara = fingerprintOf(cardSara);
  await importIdentity(SARA, cardAli);
  await importIdentity(ALI, cardSara);
  const founded = await waitFor(ALI, () => Boolean(window.__deviceRosterProbe.primary()), { timeoutMs: 30000 });
  const aliId = await deviceIdOf(ALI);
  check('the device that made the identity is its primary', founded === true);
  await sleep(800);
  check('and the relay holds the roster it signed', relayRoster(stacks.a.dir, fpAli)?.primary?.d === aliId, JSON.stringify(relayRoster(stacks.a.dir, fpAli)?.primary || null));

  const shared = await ALI.evaluate(() => ({ ...chatState.identity }));
  const roster = await ALI.evaluate(() => currentRoster());
  const ALI2 = await openApp('ALI2', { origin: stacks.a.url, relay: stacks.a.url });
  const ALI3 = await openApp('ALI3', { origin: stacks.a.url, relay: stacks.a.url });
  for (const page of [ALI2, ALI3]) {
    await joinAccount(page, shared, roster);
    await importIdentity(page, cardSara);
  }
  const ali2Id = await deviceIdOf(ALI2);
  const ali3Id = await deviceIdOf(ALI3);
  const introduced = await waitFor(ALI, (ids) => ids.every((id) => (currentRoster()?.members || []).some((member) => member.d === id)), { timeoutMs: 45000, arg: [ali2Id, ali3Id] });
  check('every added device introduces itself and the primary lists it', introduced === true, JSON.stringify(await ALI.evaluate(() => (currentRoster()?.members || []).map((m) => m.d.slice(-6)))));
  const secondaryRole = await ALI2.evaluate(() => ({ primary: window.__deviceRosterProbe.primary(), knows: currentRoster()?.primary?.d || '' }));
  check('the others know who the primary is, and are not it', secondaryRole.primary === false && secondaryRole.knows === aliId, JSON.stringify(secondaryRole));

  section('the list, with the devices that are away');
  await waitFor(ALI, () => (chatState.linkedDevices || []).length >= 3, { timeoutMs: 40000 });
  await ALI3.evaluate(() => disconnectChat());
  await sleep(3000);
  const listed = await ALI.evaluate((id) => {
    renderStaticUi();
    const device = window.__deviceRosterProbe.devices().find((item) => item.deviceId === id);
    return { device, summary: window.__deviceRosterProbe.summary(), strip: document.getElementById('chatLinkedDeviceCount')?.textContent || '', rows: document.querySelectorAll('#chatIdentityDevicesList .chat-device-row').length };
  }, ali3Id);
  check('a device that is away is still listed, as offline', Boolean(listed.device) && listed.device.online === false, JSON.stringify(listed.device));
  check('the count says how many devices and how many are online, in both places', /3/.test(listed.summary) && /2/.test(listed.summary) && listed.strip === listed.summary && listed.rows === 3, JSON.stringify(listed));

  await yesToDialogs(ALI);
  await yesToDialogs(ALI2);
  const offered = async (page) => page.evaluate(() => {
    setChatSettingsTab('devices');
    const card = document.getElementById('chatDevicesCard');
    return {
      revoke: card.querySelectorAll('[data-device-action="revoke"]').length,
      detach: card.querySelectorAll('[data-device-action="detach"]').length,
      toggle: card.querySelectorAll('[data-device-toggle="all"]').length,
      primaryBadge: card.querySelectorAll('.chat-device-badge.is-primary').length,
    };
  });
  const onPrimary = await offered(ALI);
  const onSecondary = await offered(ALI2);
  check('only the primary is offered "revoke"; every device can detach itself', onPrimary.revoke === 2 && onSecondary.revoke === 0 && onPrimary.detach === 1 && onSecondary.detach === 1, JSON.stringify({ onPrimary, onSecondary }));
  check('the "sync all content" switch is in Settings › My devices, and the primary is marked', onPrimary.toggle === 1 && onSecondary.primaryBadge === 1, JSON.stringify({ onPrimary, onSecondary }));
  const stripToggle = await ALI2.evaluate(() => document.querySelectorAll('#chatIdentityDevicesList [data-device-toggle="all"]').length);
  check('and in the identity card\'s linked devices', stripToggle === 1);

  section('a forged revocation');
  const seqBefore = relayRoster(stacks.a.dir, fpAli)?.seq || 0;
  await ALI2.evaluate((id) => window.__deviceRosterProbe.forgeRevoke(id), aliId);
  await sleep(3000);
  const afterForge = { relay: relayRoster(stacks.a.dir, fpAli)?.seq || 0, onAli: await ALI.evaluate(() => currentRoster()?.seq || 0), aliFp: await fingerprintHere(ALI) };
  check('a roster signed by a device that is not the primary is refused by the relay and by the siblings', afterForge.relay === seqBefore && afterForge.onAli === seqBefore && afterForge.aliFp === fpAli, JSON.stringify({ seqBefore, ...afterForge }));

  /* What a relay that wants a device gone would try: a roster of its own
     making, around the account's genuine certificate, handed over as a
     revocation notice. The device must not wipe itself. */
  const relayForge = await ALI3.evaluate(async (me) => {
    const real = currentRoster();
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const signer = app().arrayBufferToBase64(await crypto.subtle.exportKey('spki', pair.publicKey));
    const forged = { ...real, seq: real.seq + 5, at: Date.now(), revoked: [...real.revoked, { d: me, k: '', at: Date.now(), why: 'revoked' }], signer, sig: '' };
    forged.sig = app().arrayBufferToBase64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(rosterSignedText(forged))));
    const before = chatState.identity?.fingerprint;
    await handleDeviceRevokedNotice({ roster: forged });
    await new Promise((r) => setTimeout(r, 800));
    return { kept: chatState.identity?.fingerprint === before, seq: currentRoster()?.seq === real.seq };
  }, ali3Id);
  check('a revocation notice the relay made up itself does not wipe a device', relayForge.kept && relayForge.seq, JSON.stringify(relayForge));

  section('a file that is not on this device');
  await openConversation(ALI2, fpSara);
  const layout = await ALI2.evaluate(() => {
    const key = chatState.activeConversationId;
    appendHistory(key, { id: `missing-${Date.now()}`, type: 'sticker', direction: 'in', name: 'x.webp', mime: 'image/webp', createdAt: new Date().toISOString(), status: 'delivered' });
    renderMessages();
    const box = [...document.querySelectorAll('.chat-media-missing')].pop();
    const text = box?.querySelector('.chat-media-missing-text')?.getBoundingClientRect();
    const button = box?.querySelector('button.chat-media-fetch');
    const rect = button?.getBoundingClientRect();
    return {
      found: Boolean(box && button),
      sameRow: Boolean(text && rect) && Math.abs((text.top + text.height / 2) - (rect.top + rect.height / 2)) < 4,
      textLines: text ? Math.round(text.height / parseFloat(getComputedStyle(box).lineHeight || '16')) : 0,
      pill: button ? parseFloat(getComputedStyle(button).borderTopLeftRadius) >= rect.height / 2 - 1 : false,
      label: button?.textContent.trim() || '',
      box: box ? Math.round(box.getBoundingClientRect().width) : 0,
      bubble: box ? Math.round(box.closest('.chat-message-bubble')?.getBoundingClientRect().width || 0) : 0,
    };
  });
  check('one line, and a button that is a button, on the same line', layout.found && layout.sameRow && layout.textLines <= 1 && layout.pill, JSON.stringify(layout));

  section('sync all content');
  const consoleOf = new Map();
  for (const [tag, page] of [['ALI', ALI], ['ALI2', ALI2], ['ALI5', null]]) {
    if (!page) continue;
    consoleOf.set(tag, []);
    page.on('console', (message) => { const text = message.text(); if (/\[Devices\]|sibling/i.test(text)) consoleOf.get(tag).push(text.slice(0, 200)); });
  }
  await ALI2.evaluate(() => {
    window.__outcomes = [];
    const real = window.fetchFromSibling;
    window.fetchFromSibling = async (...args) => { const outcome = await real(...args); window.__outcomes.push(`${String(args[1]).slice(0, 12)}:${outcome}`); return outcome; };
    setDeviceSyncAllEnabled(true);
  });
  const spread = await waitFor(ALI, () => deviceSyncAllEnabled(), { timeoutMs: 30000 });
  check('switched on on one device, it is on for the account', spread === true);
  await openConversation(ALI, fpSara);
  const made = await ALI.evaluate(async () => {
    const key = chatState.activeConversationId;
    const make = async (id, type, name, mime, size) => {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(size, i + 65536)));
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
      const entry = { id, type, direction: 'out', name, mime, size, createdAt: new Date().toISOString(), status: 'sent' };
      const blob = new Blob([bytes], { type: mime });
      await persistMessageMedia(key, entry, blob);
      entry.downloadUrl = URL.createObjectURL(blob);
      appendHistory(key, entry);
      return { id, digest, size };
    };
    return [
      await make(`auto-file-${Date.now()}`, 'file', 'report.bin', 'application/octet-stream', 3 * 1024 * 1024),
      await make(`auto-sticker-${Date.now()}`, 'sticker', 'cat.webp', 'image/webp', 40 * 1024),
    ];
  });
  const autoLanded = await waitFor(ALI2, async (items) => {
    for (const item of items) if (!await readMessageMedia(item.id).catch(() => null)) return false;
    return true;
  }, { timeoutMs: 90000, arg: made });
  const autoDigests = await ALI2.evaluate(async (items) => Promise.all(items.map(async (item) => {
    const stored = await readMessageMedia(item.id).catch(() => null);
    if (!stored) return '';
    const bytes = new Uint8Array(await stored.blob.arrayBuffer());
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  })), made);
  check('the other device\'s files come over by themselves, whole, without a click', autoLanded === true && autoDigests.every((digest, index) => digest === made[index].digest),
    JSON.stringify({
      ...await ALI2.evaluate((items) => ({
        auto: window.__siblingFileProbe.auto(),
        outcomes: window.__outcomes,
        online: window.__siblingFileProbe.online(),
        rows: items.map((item) => { const e = Object.values(chatState.history).flat().find((x) => x.id === item.id); return e ? { type: e.type, url: Boolean(e.downloadUrl), missing: e.mediaMissing } : null; }),
      }), made),
      ali: await ALI.evaluate(() => ({ journal: window.__siblingJournalProbe.state(), connected: chatState.connected, linked: (chatState.linkedDevices || []).length })),
      console: consoleOf.get('ALI2').slice(-8),
      aliConsole: consoleOf.get('ALI').slice(-8),
    }));

  section('revoked while online');
  await ALI.evaluate((id) => {
    setChatSettingsTab('devices');
    document.querySelector(`#chatDevicesCard [data-device-action="revoke"][data-device-id="${CSS.escape(id)}"]`)?.click();
  }, ali2Id);
  const ali2Left = await waitFor(ALI2, (old) => Boolean(chatState.identity?.fingerprint) && chatState.identity.fingerprint !== old, { timeoutMs: 45000, arg: fpAli });
  const ali2After = await ALI2.evaluate((fp) => ({
    fingerprint: chatState.identity?.fingerprint || '',
    deviceId: getDeviceId(),
    conversations: Object.keys(chatState.history || {}).length,
    contacts: (chatState.peers || []).filter((peer) => peer.fingerprint === fp).length,
    roster: currentRoster()?.primary?.d === getDeviceId(),
  }), fpSara);
  check('the revoked device removes the account from itself and carries on with its own identity', ali2Left === true && ali2After.conversations === 0 && ali2After.contacts === 0 && ali2After.deviceId !== ali2Id, JSON.stringify(ali2After));
  await sleep(2500);
  const aliView = await ALI.evaluate((id) => ({
    linked: (chatState.linkedDevices || []).some((device) => device.deviceId === id),
    listed: window.__deviceRosterProbe.devices().some((device) => device.deviceId === id),
    revoked: (currentRoster()?.revoked || []).some((entry) => entry.d === id),
  }), ali2Id);
  check('the primary no longer lists it, and the roster says it was revoked', !aliView.linked && !aliView.listed && aliView.revoked, JSON.stringify(aliView));
  check('the relay dropped its beacon', !relayBeaconIds(stacks.a.dir, fpAli).includes(ali2Id), JSON.stringify(relayBeaconIds(stacks.a.dir, fpAli)));
  const freshAli2 = await waitFor(ALI2, () => Boolean(window.__deviceRosterProbe.primary()), { timeoutMs: 30000 });
  check('and, alone with its new identity, it is its own primary', freshAli2 === true);

  section('a revoked device id at the door');
  const ALI4 = await openApp('ALI4', { origin: stacks.a.url, relay: stacks.a.url });
  await ALI4.evaluate(() => {
    window.__asked = 0;
    window.PoorijaDialogs.confirm = async () => { window.__asked += 1; return true; };
  });
  await ALI4.evaluate((id) => {
    localStorage.setItem(CHAT_DEVICE_ID_STORAGE_KEY, JSON.stringify({ id, linkedAt: new Date().toISOString() }));
  }, ali2Id);
  await joinAccount(ALI4, shared, null);
  const turnedAway = await waitFor(ALI4, (old) => chatState.identity?.fingerprint && chatState.identity.fingerprint !== old, { timeoutMs: 45000, arg: fpAli });
  check('a device using a revoked device\'s id is refused, and — knowing no primary before — leaves the account once the person agrees', turnedAway === true && (await ALI4.evaluate(() => window.__asked)) >= 1);

  section('revoked while away');
  await ALI.evaluate((id) => document.querySelector(`#chatDevicesCard [data-device-action="revoke"][data-device-id="${CSS.escape(id)}"]`)?.click(), ali3Id);
  await sleep(2500);
  check('the relay holds the revocation', (relayRoster(stacks.a.dir, fpAli)?.revoked || []).some((entry) => entry.d === ali3Id));
  await ALI3.evaluate(async () => { chatState.shouldReconnect = true; await connectChatTransport(); });
  const ali3Left = await waitFor(ALI3, (old) => chatState.identity?.fingerprint && chatState.identity.fingerprint !== old, { timeoutMs: 45000, arg: fpAli });
  check('a device revoked while away learns it when it comes back, and leaves', ali3Left === true);

  section('a device detaching itself');
  const freshRoster = await ALI.evaluate(() => currentRoster());
  const ALI5 = await openApp('ALI5', { origin: stacks.a.url, relay: stacks.a.url });
  await joinAccount(ALI5, shared, freshRoster);
  const ali5Id = await deviceIdOf(ALI5);
  await waitFor(ALI, (id) => (currentRoster()?.members || []).some((member) => member.d === id), { timeoutMs: 45000, arg: ali5Id });
  const newFp5 = await ALI5.evaluate(async () => {
    window.__leaveLog = [];
    const fp = await window.__deviceRosterProbe.leave();
    return fp || `EMPTY identity=${Boolean(chatState.identity)} wiped=${Boolean(chatState.wiped)} unlocked=${isUnlocked()}`;
  });
  const goneFromList = await waitFor(ALI, (id) => (currentRoster()?.revoked || []).some((entry) => entry.d === id && entry.why === 'left')
    && !window.__deviceRosterProbe.devices().some((device) => device.deviceId === id), { timeoutMs: 45000, arg: ali5Id });
  check('a device that detaches gets an identity of its own', Boolean(newFp5) && !newFp5.startsWith('EMPTY') && newFp5 !== fpAli, newFp5.slice(0, 80));
  check('and the primary lists it as gone', goneFromList === true);

  section('handing the primary role on');
  const ALI6 = await openApp('ALI6', { origin: stacks.a.url, relay: stacks.a.url });
  await joinAccount(ALI6, shared, await ALI.evaluate(() => currentRoster()));
  await importIdentity(ALI6, cardSara);
  const ali6Id = await deviceIdOf(ALI6);
  await waitFor(ALI, (id) => (currentRoster()?.members || []).some((member) => member.d === id), { timeoutMs: 45000, arg: ali6Id });
  await ALI.evaluate((id) => window.__deviceRosterProbe.handOver(id), ali6Id);
  const handed = await waitFor(ALI6, () => Boolean(window.__deviceRosterProbe.primary()), { timeoutMs: 30000 });
  const oldPrimary = await ALI.evaluate(() => window.__deviceRosterProbe.primary());
  check('the primary hands its role to another device', handed === true && oldPrimary === false);
  await sleep(1500);
  const seqHanded = relayRoster(stacks.a.dir, fpAli)?.seq || 0;
  await ALI.evaluate((id) => window.__deviceRosterProbe.forgeRevoke(id), ali6Id);
  await sleep(2500);
  check('and the old primary can no longer revoke anybody', (relayRoster(stacks.a.dir, fpAli)?.seq || 0) === seqHanded && await fingerprintHere(ALI6) === fpAli);

  section('by hand, and at the relay');
  await openConversation(ALI6, fpSara);
  await sendText(SARA, 'after-the-changes');
  await hasText(ALI, fpSara, 'after-the-changes');
  await ALI6.evaluate(() => {
    const key = chatState.activeConversationId;
    chatState.history[key] = (chatState.history[key] || []).filter((e) => e.text !== 'after-the-changes');
    renderMessages();
  });
  await ALI.evaluate(() => sendDeviceSyncFromUi());
  check('a manual sync still brings a sibling everything', await hasText(ALI6, fpSara, 'after-the-changes'));

  const purge = await SARA.evaluate(async (victim) => new Promise((resolve) => {
    const socket = new WebSocket(wsUrl().replace(/fingerprint=[^&]*/, `fingerprint=${victim.fingerprint}`));
    const done = (value) => { try { socket.close(); } catch (_error) { /* gone */ } resolve(value); };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'welcome') {
        socket.send(JSON.stringify({ type: 'hello', clientId: message.clientId, username: 'x', peerId: 'intruder-peer', publicKeyData: victim.publicKeyData, fingerprint: victim.fingerprint, deviceId: 'intruder' }));
        setTimeout(() => socket.send(JSON.stringify({ type: 'purge-me' })), 300);
      }
      if (message.type === 'purged') done(message);
    };
    socket.onerror = () => done({ error: true });
    setTimeout(() => done({ timeout: true }), 8000);
  }), { fingerprint: fpAli, publicKeyData: shared.publicKeyData });
  check('a socket that has not proven an identity cannot purge it', purge.refused === 'identity-unverified', JSON.stringify(purge));
  check('and the account\'s roster is still there', Boolean(relayRoster(stacks.a.dir, fpAli)));

  /* "Reset chat key" used to read the old identity straight back out of the
     live cache and carry on with it. */
  await yesToDialogs(ALI4);
  const beforeReset = await fingerprintHere(ALI4);
  await ALI4.evaluate(() => rotateIdentity());
  const afterReset = await fingerprintHere(ALI4);
  check('resetting the chat key really makes a new one', Boolean(afterReset) && afterReset !== beforeReset, `${beforeReset.slice(0, 8)} → ${afterReset.slice(0, 8)}`);

  const errors = [ALI, ALI2, ALI3, ALI4, ALI5, ALI6, SARA].flatMap((page) => page.__errors || []);
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
