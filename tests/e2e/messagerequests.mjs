/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Message requests.
 *
 *   STRANGER holds HOST's card; HOST never added STRANGER. What STRANGER
 *   sends waits under Requests: out of the main list, silent, no read
 *   receipt, files not drawn, calls not rung. Accepting releases all of it,
 *   the held read receipt included. A second stranger is accepted simply by
 *   being answered. Contacts from before the feature are accepted on first
 *   run, so nobody old ends up filed as a stranger.
 */
import { openApp, identity, importIdentity, browser, waitFor, makeFile } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const fingerprintOf = (card) => JSON.parse(atob(card.replace('poorija-chat-v1:', ''))).fingerprint;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const openConversation = (page, fp) => page.evaluate(async (key) => {
  const peer = findPeerByAnyKey(key);
  chatState.activeConversationId = getConversationKey(peer);
  chatState.activePeerClientId = peer.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 500));
}, fp);
const say = (page, text) => page.evaluate((value) => {
  const box = document.getElementById('chatComposer');
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('chatSendMessageBtn').click();
}, text);

const stacks = await startTwoStacks();
try {
  section('a stranger who holds the host\'s card');
  const HOST = await openApp('HOST', { origin: stacks.a.url, relay: stacks.a.url });
  const STRANGER = await openApp('STRANGER', { origin: stacks.a.url, relay: stacks.a.url });
  const cardHost = await identity(HOST);
  const fpHost = fingerprintOf(cardHost);
  const fpStranger = fingerprintOf(await identity(STRANGER));
  await importIdentity(STRANGER, cardHost);
  await waitFor(STRANGER, (fp) => Boolean(findPeerByAnyKey(fp)?.publicKeyData), { timeoutMs: 30000, arg: fpHost });
  await HOST.evaluate(() => {
    window.__sounds = [];
    const original = window.playSound;
    window.playSound = (name) => { window.__sounds.push(name); return original?.(name); };
    playSound = window.playSound;
    window.__notified = 0;
    const appRef = window.PoorijaApp;
    const before = appRef?.showDesktopNotification;
    if (appRef && before) appRef.showDesktopNotification = (...args) => { window.__notified += 1; return before.apply(appRef, args); };
  });

  await openConversation(STRANGER, fpHost);
  const first = `hello-from-a-stranger-${Date.now()}`;
  await say(STRANGER, first);
  const landed = await waitFor(HOST, (value) => Object.values(chatState.history).flat().some((e) => e.text === value), { timeoutMs: 60000, arg: first });
  check('the message arrives', landed === true);
  const listed = await HOST.evaluate((fp) => {
    renderPeers();
    const record = findPeerByAnyKey(fp);
    const key = getConversationKey(record);
    return {
      request: isMessageRequest(record),
      inMainList: Boolean(document.querySelector(`#chatPeerList [data-chat-conversation="${CSS.escape(key)}"]`)),
      chip: document.querySelector('#chatPeerList [data-chat-requests-shelf]')?.textContent || '',
      sounds: window.__sounds.filter((name) => name === 'message').length,
    };
  }, fpStranger);
  check('it is a message request', listed.request === true);
  check('kept out of the main list', listed.inMainList === false);
  check('and counted under Requests', /Requests\s*1/.test(listed.chip), listed.chip);
  check('it made no sound', listed.sounds === 0, String(listed.sounds));
  const shelf = await HOST.evaluate((fp) => {
    document.querySelector('#chatPeerList [data-chat-requests-shelf]')?.click();
    const key = getConversationKey(findPeerByAnyKey(fp));
    return Boolean(document.querySelector(`#chatPeerList [data-chat-conversation="${CSS.escape(key)}"]`));
  }, fpStranger);
  check('the Requests chip shows it', shelf === true);

  section('opening it');
  await openConversation(HOST, fpStranger);
  await sleep(3000);
  const opened = await HOST.evaluate(() => ({
    bar: !document.getElementById('chatRequestBar')?.classList.contains('hidden'),
    pendingSeen: Object.values(chatState.history).flat().filter((e) => e.direction === 'in' && !e.seenAckSent).length,
  }));
  check('the request bar offers accept, block and delete', opened.bar === true);
  /* Centred over the messages, whole, with every button where a finger can
     reach it — on a phone and on a desktop. It used to sit in the composer's
     footer, which cut its buttons in half. */
  const placement = async (width, height) => {
    await HOST.setViewportSize({ width, height });
    await sleep(700);
    return HOST.evaluate(() => {
      const bar = document.getElementById('chatRequestBar');
      const panel = document.getElementById('chatMessages');
      const b = bar.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const buttons = [...bar.querySelectorAll('[data-request-action]')].map((button) => {
        const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { action: button.dataset.requestAction, whole: r.height > 20 && r.bottom <= b.bottom + 1 && r.top >= b.top - 1, tappable: Boolean(hit && button.contains(hit)) };
      });
      return {
        inside: b.top >= p.top - 1 && b.bottom <= p.bottom + 1 && b.left >= p.left - 1 && b.right <= p.right + 1,
        centred: Math.abs((b.top + b.bottom) / 2 - (p.top + p.bottom) / 2) <= 4 && Math.abs((b.left + b.right) / 2 - (p.left + p.right) / 2) <= 4,
        buttons,
      };
    });
  };
  for (const [width, height, label] of [[390, 844, 'on a phone'], [1440, 900, 'on a desktop']]) {
    const placed = await placement(width, height);
    check(`${label} the request sits in the middle of the messages, every button whole and tappable`,
      placed.inside && placed.centred && placed.buttons.length === 3 && placed.buttons.every((button) => button.whole && button.tappable),
      JSON.stringify(placed));
  }
  const status = await STRANGER.evaluate((value) => Object.values(chatState.history).flat().find((e) => e.text === value)?.status, first);
  check('reading it sends no read receipt', status !== 'seen', status);

  section('a file from the stranger');
  const picture = makeFile('stranger.png', 2048);
  await STRANGER.evaluate(async () => {
    const bytes = new Uint8Array(2048);
    crypto.getRandomValues(bytes);
    await sendEncryptedBlob(new File([bytes], 'stranger.png', { type: 'image/png' }), 'file');
  });
  const fileLanded = await waitFor(HOST, () => Object.values(chatState.history).flat().some((e) => e.type === 'file' && e.name === 'stranger.png'), { timeoutMs: 60000 });
  check('the file arrives', fileLanded === true, picture.file);
  const masked = await HOST.evaluate(() => {
    renderMessages();
    return {
      masked: document.querySelectorAll('#chatMessages .chat-request-masked').length,
      links: document.querySelectorAll('#chatMessages a[data-chat-download-message]').length,
    };
  });
  check('but is not drawn until accepted', masked.masked >= 1 && masked.links === 0, JSON.stringify(masked));

  section('a call from the stranger');
  await STRANGER.evaluate(() => { try { startCall('voice'); } catch (_error) { /* rings or not */ } });
  await sleep(6000);
  const rang = await HOST.evaluate(() => {
    const visible = (el) => Boolean(el) && !el.classList.contains('hidden') && el.offsetParent !== null;
    return {
      ringing: visible(document.getElementById('chatModalAcceptBtn')) || visible(document.getElementById('chatAcceptCallBtn')),
      missed: (chatState.calls || []).some((call) => call.status === 'missed' && call.direction === 'in'),
    };
  });
  check('it does not ring', rang.ringing === false);
  check('it is written down as missed', rang.missed === true);
  await STRANGER.evaluate(() => { try { endCall?.(); } catch (_error) { /* gone */ } });

  section('accepting');
  await HOST.evaluate(() => document.querySelector('#chatRequestBar [data-request-action="accept"]')?.click());
  await sleep(1500);
  const accepted = await HOST.evaluate((fp) => {
    const record = findPeerByAnyKey(fp);
    chatState.showRequests = false;
    renderPeers();
    renderMessages();
    return {
      request: isMessageRequest(record),
      accepted: Boolean(record.accepted),
      inMainList: Boolean(document.querySelector(`#chatPeerList [data-chat-conversation="${CSS.escape(getConversationKey(record))}"]`)),
      bar: !document.getElementById('chatRequestBar')?.classList.contains('hidden'),
      masked: document.querySelectorAll('#chatMessages .chat-request-masked').length,
    };
  }, fpStranger);
  check('it is no longer a request', accepted.request === false && accepted.accepted === true);
  check('and joins the main list', accepted.inMainList === true);
  check('the bar goes away and the file is drawn', accepted.bar === false && accepted.masked === 0, JSON.stringify(accepted));
  const seenNow = await waitFor(STRANGER, (value) => Object.values(chatState.history).flat().find((e) => e.text === value)?.status === 'seen', { timeoutMs: 30000, arg: first });
  check('the held read receipt goes out now', seenNow === true);
  const persisted = await HOST.evaluate((fp) => {
    saveContacts();
    const stored = loadEncrypted(CHAT_CONTACTS_STORAGE_KEY, []);
    return Boolean(stored.find((p) => p.fingerprint === fp)?.accepted);
  }, fpStranger);
  check('the answer survives a reload', persisted === true);

  section('answering is accepting');
  const SECOND = await openApp('SECOND', { origin: stacks.a.url, relay: stacks.a.url });
  const fpSecond = fingerprintOf(await identity(SECOND));
  await importIdentity(SECOND, cardHost);
  await waitFor(SECOND, (fp) => Boolean(findPeerByAnyKey(fp)?.publicKeyData), { timeoutMs: 30000, arg: fpHost });
  await openConversation(SECOND, fpHost);
  const knock = `knock-${Date.now()}`;
  await say(SECOND, knock);
  await waitFor(HOST, (value) => Object.values(chatState.history).flat().some((e) => e.text === value), { timeoutMs: 60000, arg: knock });
  const beforeReply = await HOST.evaluate((fp) => isMessageRequest(findPeerByAnyKey(fp)), fpSecond);
  await openConversation(HOST, fpSecond);
  await say(HOST, `welcome-${Date.now()}`);
  await sleep(1500);
  const afterReply = await HOST.evaluate((fp) => isMessageRequest(findPeerByAnyKey(fp)), fpSecond);
  check('a second stranger is a request until answered', beforeReply === true && afterReply === false);

  section('a stranger who makes a group around the host');
  const GROUPER = await openApp('GROUPER', { origin: stacks.a.url, relay: stacks.a.url });
  const fpGrouper = fingerprintOf(await identity(GROUPER));
  await importIdentity(GROUPER, cardHost);
  await waitFor(GROUPER, (fp) => Boolean(findPeerByAnyKey(fp)?.publicKeyData), { timeoutMs: 30000, arg: fpHost });
  const groupText = `group-from-a-stranger-${Date.now()}`;
  await GROUPER.evaluate(async ({ host, me, text }) => {
    const member = findPeerByAnyKey(host);
    let session = await ensureStoredSession(member);
    if (!session?.cryptoKey) session = await ensureDirectSession(member, { silent: true });
    const spaceId = `space-stranger-${Date.now()}`;
    const payload = await encryptForSession(session, new TextEncoder().encode(JSON.stringify({
      spaceId, spaceType: 'group', spaceName: 'Free prizes', members: [host, me], ownerFingerprint: me,
      messageId: `g-${Date.now()}`, text, senderFingerprint: me, createdAt: new Date().toISOString(),
    })));
    const outbound = { id: `g-${Date.now()}`, type: 'space-message', createdAt: new Date().toISOString(), payload };
    if (session.connection?.open) safeConnectionSend(session.connection, outbound, 'group-message');
    else await sendSealedRelay(member, session, outbound, { createdAt: outbound.createdAt, scope: 'group' });
  }, { host: fpHost, me: fpGrouper, text: groupText });
  const groupLanded = await waitFor(HOST, (value) => Object.values(chatState.history).flat().some((e) => e.text === value), { timeoutMs: 60000, arg: groupText });
  check('the group message arrives', groupLanded === true);
  const groupState = await HOST.evaluate((value) => {
    const space = chatState.spaces.groups.find((g) => (chatState.history[g.conversationId] || []).some((e) => e.text === value));
    chatState.activeView = 'groups';
    renderPeers();
    const inGroups = Boolean(space && document.querySelector(`#chatPeerList [data-chat-conversation="${CSS.escape(space.conversationId)}"]`));
    chatState.activeView = 'chats';
    renderPeers();
    return {
      request: Boolean(space) && isMessageRequest(space),
      inGroups,
      sounds: window.__sounds.filter((name) => name === 'message').length,
      memberStillStranger: isMessageRequest({ ...findPeerByAnyKey(space?.ownerFingerprint || ''), groupMember: true }) || !findPeerByAnyKey(space?.ownerFingerprint || ''),
    };
  }, groupText);
  check('a group a stranger made around you is a request too', groupState.request === true, JSON.stringify(groupState));
  check('it is kept out of the Groups list', groupState.inGroups === false);
  check('and it was silent', groupState.sounds === 0, String(groupState.sounds));
  /* The same stranger, now claiming the group belongs to somebody the host
     accepted — and then to the host itself. The claim is a field in the
     record; who put the host in the group is what the session proved. */
  const claimOwner = async (owner, text) => {
    await GROUPER.evaluate(async ({ host, me, text: body, ownerFp }) => {
      const member = findPeerByAnyKey(host);
      let session = await ensureStoredSession(member);
      if (!session?.cryptoKey) session = await ensureDirectSession(member, { silent: true });
      const payload = await encryptForSession(session, new TextEncoder().encode(JSON.stringify({
        spaceId: `space-claim-${Date.now()}`, spaceType: 'group', spaceName: 'Trust me', members: [host, me, ownerFp], ownerFingerprint: ownerFp,
        messageId: `c-${Date.now()}`, text: body, senderFingerprint: me, createdAt: new Date().toISOString(),
      })));
      const outbound = { id: `c-${Date.now()}`, type: 'space-message', createdAt: new Date().toISOString(), payload };
      if (session.connection?.open) safeConnectionSend(session.connection, outbound, 'group-message');
      else await sendSealedRelay(member, session, outbound, { createdAt: outbound.createdAt, scope: 'group' });
    }, { host: fpHost, me: fpGrouper, text, ownerFp: owner });
    await waitFor(HOST, (value) => Object.values(chatState.history).flat().some((e) => e.text === value), { timeoutMs: 60000, arg: text });
    return HOST.evaluate((value) => {
      const space = chatState.spaces.groups.find((g) => (chatState.history[g.conversationId] || []).some((e) => e.text === value));
      return { found: Boolean(space), request: Boolean(space) && isMessageRequest(space), addedBy: space?.addedBy || '' };
    }, text);
  };
  const claimsContact = await claimOwner(fpStranger, `claims-a-contact-${Date.now()}`);
  check('claiming an accepted contact as the owner does not make it accepted', claimsContact.found && claimsContact.request && claimsContact.addedBy === fpGrouper, JSON.stringify(claimsContact));
  const claimsHost = await claimOwner(fpHost, `claims-the-host-${Date.now()}`);
  check('nor does claiming the host itself as the owner', claimsHost.found && claimsHost.request, JSON.stringify(claimsHost));
  const spoofedCall = await HOST.evaluate((contactFp) => ({
    metadataClaim: callFromMessageRequest(`poorija-peer-nobody-${Date.now()}`, {}),
    suffixClaim: callFromMessageRequest(`${findPeerByAnyKey(contactFp).peerId}~evil`, {}),
    realContact: callFromMessageRequest(findPeerByAnyKey(contactFp).peerId, {}),
  }), fpStranger);
  check('a call is screened on the id it came from, not on what the caller says about itself',
    spoofedCall.metadataClaim === true && spoofedCall.suffixClaim === true && spoofedCall.realContact === false, JSON.stringify(spoofedCall));
  const forgedAccept = await HOST.evaluate(() => {
    const space = upsertSharedSpace({ type: 'group', conversationId: `space-forged-${Date.now()}`, name: 'Forged', members: [chatState.identity.fingerprint, 'ab'.repeat(32)], ownerFingerprint: 'ab'.repeat(32), accepted: true });
    return { accepted: Boolean(space?.accepted), request: isMessageRequest(space) };
  });
  check('a group record cannot arrive already accepted', forgedAccept.accepted === false && forgedAccept.request === true, JSON.stringify(forgedAccept));

  section('contacts from before the feature');
  const seeded = await HOST.evaluate(() => {
    const record = normalizePeerRecord({ peerId: `poorija-peer-old-${Date.now()}`, fingerprint: 'ef'.repeat(32), publicKeyData: btoa('old-friend') });
    chatState.peers.push(record);
    chatState.history[getConversationKey(record)] = [{ id: `old-${Date.now()}`, direction: 'in', type: 'text', text: 'from long ago', createdAt: new Date().toISOString() }];
    const wasRequest = isMessageRequest(record);
    seedAcceptedConversations({ requestsSeeded: false });
    return { wasRequest, now: isMessageRequest(record), flag: chatState.prefs.requestsSeeded };
  });
  check('an old conversation is accepted on first run, once', seeded.wasRequest === true && seeded.now === false && seeded.flag === true, JSON.stringify(seeded));

  check('no page errors', [HOST, STRANGER, SECOND, GROUPER].every((p) => !(p.__errors || []).length), [HOST, STRANGER, SECOND, GROUPER].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
