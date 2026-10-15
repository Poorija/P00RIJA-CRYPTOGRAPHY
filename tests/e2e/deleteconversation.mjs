/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Deleting a conversation, on a real relay.
 *
 *   AVA has two devices (AVA and AVA2, one identity); BEN is her contact;
 *   CORA is a contact AVA has blocked; there is a group of AVA and BEN.
 *
 *   - AVA deletes her conversation with BEN, keeping him as a contact: the
 *     messages, the file, the drafts, the unread mark, the conversation's lock,
 *     the call log with him, the session keys on disk and the live session in
 *     memory all go, and a live location she was sharing with him stops
 *     without a word; he stays a contact, still verified, still accepted, and
 *     the empty conversation leaves the list;
 *   - nothing changes for BEN, and he is told nothing;
 *   - AVA2 deletes it too, and no sync brings the old messages back to either;
 *   - BEN writes again: it is a conversation, not a message request, and his
 *     calls still ring;
 *   - AVA deletes CORA's conversation and the contact: CORA goes, and is still
 *     blocked when the relay lists her again;
 *   - the group: deleting the history keeps the membership; deleting and
 *     leaving tells BEN she left.
 */
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 260) : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (card) => JSON.parse(Buffer.from(card.replace('poorija-chat-v1:', ''), 'base64').toString('utf8'));
const open = (page, key) => page.evaluate(async (k) => {
  const record = findPeerByAnyKey(k) || conversationRecordById(k);
  chatState.activeConversationId = getConversationKey(record);
  chatState.activePeerClientId = record?.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 300));
}, key);
const say = (page, key, text) => page.evaluate(async ({ k, value }) => {
  const record = findPeerByAnyKey(k) || conversationRecordById(k);
  chatState.activeConversationId = getConversationKey(record);
  chatState.activePeerClientId = record?.clientId || '';
  renderActivePeer();
  const box = document.getElementById('chatComposer');
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('chatSendMessageBtn').click();
}, { k: key, value: text });
const heard = (page, text) => waitFor(page, (value) => Object.values(chatState.history).flat().some((e) => e.text === value), { timeoutMs: 60000, arg: text });
/* Answers the delete dialog the way a person picking one option would. */
const deleteOpen = (page, choice) => page.evaluate(async (value) => {
  const original = PoorijaDialogs.choose;
  PoorijaDialogs.choose = async () => value;
  try { await deleteActiveConversation(); } finally { PoorijaDialogs.choose = original; }
  await new Promise((r) => setTimeout(r, 800));
}, choice);
const mediaCount = (page, conv) => page.evaluate((c) => new Promise((resolve) => openMediaDb().then((db) => {
  const request = db.transaction('blobs').objectStore('blobs').index('conversationId').count(IDBKeyRange.only(c));
  request.onsuccess = () => resolve(request.result);
}).catch(() => resolve(-1))), conv);

const stacks = await startTwoStacks();
try {
  section('the people');
  const geo = { geolocation: { latitude: 35.7, longitude: 51.4 }, permissions: ['geolocation'] };
  const AVA = await openApp('AVA', { origin: stacks.a.url, relay: stacks.a.url, context: geo });
  const BEN = await openApp('BEN', { origin: stacks.a.url, relay: stacks.a.url });
  const CORA = await openApp('CORA', { origin: stacks.a.url, relay: stacks.a.url });
  const cards = { AVA: await identity(AVA), BEN: await identity(BEN), CORA: await identity(CORA) };
  const fp = Object.fromEntries(Object.entries(cards).map(([name, card]) => [name, decode(card).fingerprint]));
  await importIdentity(AVA, cards.BEN);
  await importIdentity(BEN, cards.AVA);
  await importIdentity(AVA, cards.CORA);
  await importIdentity(CORA, cards.AVA);
  await sleep(2500);

  section('a conversation worth deleting');
  await say(AVA, fp.BEN, 'ava one');
  await say(BEN, fp.AVA, 'ben one');
  check('they talk', await heard(AVA, 'ben one') && await heard(BEN, 'ava one'));
  await BEN.evaluate(async (key) => {
    const record = findPeerByAnyKey(key);
    chatState.activeConversationId = getConversationKey(record);
    chatState.activePeerClientId = record.clientId || '';
    const bytes = new Uint8Array(4096); crypto.getRandomValues(bytes);
    await sendEncryptedBlob(new File([bytes], 'ben-secret.bin', { type: 'application/octet-stream' }), 'file');
  }, fp.AVA);
  check('a file from BEN', await waitFor(AVA, () => Object.values(chatState.history).flat().some((e) => e.name === 'ben-secret.bin'), { timeoutMs: 60000 }));
  const setup = await AVA.evaluate(async (key) => {
    const record = findPeerByAnyKey(key);
    const conv = getConversationKey(record);
    appendCall({ id: 'call-with-ben', name: record.username, peerId: record.peerId, mode: 'voice', status: 'missed', direction: 'in', createdAt: new Date().toISOString() });
    setPeerVerified(key, true);
    chatState.manualUnread = { ...(chatState.manualUnread || {}), [conv]: true };
    setDraft(conv, 'unsent words');
    await setConversationLock(conv, '246813', 5);
    chatState.prefs.turnChoices = { ...(chatState.prefs.turnChoices || {}), [key]: { rtt: 40 } };
    saveChatPrefs();
    const ask = PoorijaDialogs.choose;
    PoorijaDialogs.choose = async () => String(15 * 60 * 1000);
    try { await startLiveLocation(); } finally { PoorijaDialogs.choose = ask; }
    await new Promise((r) => setTimeout(r, 2500));
    return { conv, peerId: record.peerId, lock: conversationHasLock(conv), live: liveShares.size, session: chatState.sessions.has(record.peerId) };
  }, fp.BEN);
  check('with a call, a draft, an unread mark, a lock, a live location and a session',
    setup.lock && setup.live === 1 && setup.session, JSON.stringify(setup));
  const benLive = await waitFor(BEN, () => Object.values(chatState.history).flat().some((e) => e.type === 'rich' && richPayloadOf(e)?.kind === 'live-location'), { timeoutMs: 45000 });
  check('BEN sees the live location', benLive);
  /* AVA's second device: the same identity in its own storage, holding what a
     sync from AVA gives it — the conversation and the contact — through the
     very merge a sync goes through. (Whether two pages of one identity find
     each other on the relay is devicesync2's to prove.) */
  const AVA2 = await openApp('AVA2', { origin: stacks.a.url, relay: stacks.a.url });
  const synced = await AVA.evaluate(async (key) => {
    const record = findPeerByAnyKey(key);
    const conv = getConversationKey(record);
    return { identity: { ...chatState.identity }, conv, record: normalizePeerRecord(record), entries: (chatState.history[conv] || []).map((e) => ({ ...e, downloadUrl: '' })) };
  }, fp.BEN);
  await AVA2.evaluate(async (data) => {
    chatState.identity = { ...data.identity };
    saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, chatState.identity);
    await mergeDeviceSyncBundle({ contacts: [data.record] });
    await mergeDeviceSyncBundle({ conversation: data.conv, entries: data.entries });
  }, synced);
  check('AVA2 has the conversation too',
    await AVA2.evaluate((c) => (chatState.history[c] || []).some((e) => e.text === 'ben one'), setup.conv));
  const benBefore = await BEN.evaluate((k) => (chatState.history[getConversationKey(findPeerByAnyKey(k))] || []).map((e) => `${e.type}:${e.text || e.name || ''}`), fp.AVA);

  section('AVA deletes it, keeping BEN as a contact');
  await open(AVA, fp.BEN);
  await deleteOpen(AVA, 'keep');
  await sleep(2500);
  const after = await AVA.evaluate(async ({ key, conv, peerId }) => {
    const mention = (value) => { const text = JSON.stringify(value || ''); return text.includes(key) || text.includes(conv); };
    const record = findPeerByAnyKey(key);
    return {
      history: Object.keys(chatState.history).some((k) => k === conv || k === key),
      historyOnDisk: mention(loadEncrypted('poorija_chat_history', null)),
      sessionKeysOnDisk: mention(loadEncrypted('poorija_chat_session_keys', null)),
      liveSession: [...chatState.sessions.values()].some((s) => s.remoteFingerprint === key),
      calls: (chatState.calls || []).some((c) => c.peerId === peerId),
      draft: Boolean(chatState.drafts?.[conv]),
      unread: Boolean(chatState.manualUnread?.[conv]),
      lock: conversationHasLock(conv),
      liveShares: liveShares.size,
      contact: Boolean(record) && isStoredContact(record) && isAcceptedContact(record),
      verified: isPeerVerified(key),
      listed: Boolean(record) && shouldShowConversation(record),
    };
  }, { ...setup, key: fp.BEN });
  check('the messages are gone, in memory and on disk', !after.history && !after.historyOnDisk, JSON.stringify(after));
  check('and the file', await mediaCount(AVA, setup.conv) === 0);
  check('the session keys on disk and the live session in memory', !after.sessionKeysOnDisk && !after.liveSession);
  check('the call log with him, the draft, the unread mark and the lock', !after.calls && !after.draft && !after.unread && !after.lock);
  check('the live location stopped', after.liveShares === 0);
  check('BEN is still a contact — accepted, verified — and the empty conversation left the list',
    after.contact && after.verified && !after.listed, JSON.stringify(after));

  section('nothing happens to BEN');
  await sleep(4000);
  const benAfter = await BEN.evaluate((k) => {
    const list = chatState.history[getConversationKey(findPeerByAnyKey(k))] || [];
    const live = list.find((e) => e.type === 'rich' && richPayloadOf(e)?.kind === 'live-location');
    return { entries: list.map((e) => `${e.type}:${e.text || e.name || ''}`), liveStopped: Boolean(live && richPayloadOf(live).stopped) };
  }, fp.AVA);
  check('his conversation is exactly as it was', JSON.stringify(benAfter.entries) === JSON.stringify(benBefore), JSON.stringify(benAfter.entries));
  check('and nothing told him — not even that the live location stopped', benAfter.liveStopped === false);

  section('AVA\'s other device');
  const told = await AVA.evaluate(() => recentDeletions());
  check('AVA keeps the deletion to tell her other devices — names, kept contact, moment',
    told.length === 1 && told[0].names.includes(fp.BEN) && told[0].contact === 'keep' && Boolean(Date.parse(told[0].deletedAt)), JSON.stringify(told).slice(0, 200));
  const onAva2 = await AVA2.evaluate(async ({ deletions, conv, key }) => {
    /* Something that reached AVA2 after the deletion, which is not part of it. */
    chatState.history[conv] = [...(chatState.history[conv] || []), { id: 'after-the-delete', direction: 'in', type: 'text', text: 'later', createdAt: new Date(Date.now() + 5000).toISOString() }];
    await mergeDeviceSyncBundle({ deletions });
    const second = await applySiblingDeletion(deletions[0]);
    const record = findPeerByAnyKey(key);
    return { left: (chatState.history[conv] || []).map((e) => e.id), contact: Boolean(record) && isStoredContact(record), second };
  }, { deletions: told, conv: setup.conv, key: fp.BEN });
  check('AVA2 deletes it as well, and keeps what came after the deletion', JSON.stringify(onAva2.left) === JSON.stringify(['after-the-delete']), JSON.stringify(onAva2));
  check('and keeps BEN as a contact', onAva2.contact);
  check('a deletion heard twice is done once', onAva2.second === false);
  const resurrect = await AVA.evaluate(async (conv) => {
    const old = new Date(Date.now() - 3600000).toISOString();
    const fresh = new Date(Date.now() + 1000).toISOString();
    await mergeDeviceSyncBundle({ conversation: conv, entries: [
      { id: 'stale-from-a-sibling', direction: 'in', type: 'text', text: 'stale', createdAt: old },
      { id: 'newer-from-a-sibling', direction: 'in', type: 'text', text: 'newer', createdAt: fresh },
    ] });
    return (chatState.history[conv] || []).map((e) => e.id);
  }, setup.conv);
  check('a sibling\'s old copy does not bring the messages back, and something newer still lands',
    !resurrect.includes('stale-from-a-sibling') && resurrect.includes('newer-from-a-sibling'), JSON.stringify(resurrect));
  await AVA.evaluate((conv) => {
    chatState.history[conv] = (chatState.history[conv] || []).filter((e) => e.id !== 'newer-from-a-sibling');
    if (!chatState.history[conv].length) delete chatState.history[conv];
    storeHistory();
  }, setup.conv);

  section('BEN writes again');
  await say(BEN, fp.AVA, 'ben after the delete');
  check('it arrives', await heard(AVA, 'ben after the delete'));
  const again = await AVA.evaluate(({ key, peerId }) => {
    const record = findPeerByAnyKey(key);
    return {
      listed: shouldShowConversation(record),
      request: isMessageRequest(record),
      rings: !callFromMessageRequest(peerId),
      only: (chatState.history[getConversationKey(record)] || []).map((e) => e.text),
    };
  }, { ...setup, key: fp.BEN });
  check('as a conversation in the list holding only what is new', again.listed && JSON.stringify(again.only) === JSON.stringify(['ben after the delete']), JSON.stringify(again));
  check('not as a message request, and his calls still ring', !again.request && again.rings, JSON.stringify(again));

  section('deleting CORA, contact and all, while she is blocked');
  await open(AVA, fp.CORA);
  await AVA.evaluate((k) => toggleConversationBlock(getConversationKey(findPeerByAnyKey(k))), fp.CORA);
  await deleteOpen(AVA, 'remove');
  const cora = await AVA.evaluate(async (k) => {
    const gone = !findPeerByAnyKey(k);
    chatState.ws.send(JSON.stringify({ type: 'get-peers' }));
    await new Promise((r) => setTimeout(r, 3000));
    const back = findPeerByAnyKey(k);
    return { gone, back: Boolean(back), blocked: Boolean(back?.blocked), stored: Boolean(back) && isStoredContact(back) };
  }, fp.CORA);
  check('CORA is gone from the contacts', cora.gone, JSON.stringify(cora));
  check('and when the relay lists her again she is still blocked', cora.back && cora.blocked && !cora.stored, JSON.stringify(cora));

  section('a group');
  const groupId = await AVA.evaluate((b) => {
    const id = generateId('space');
    const space = upsertSharedSpace({
      type: 'group', conversationId: id, name: 'delete-me', members: [chatState.identity.fingerprint, b],
      ownerPeerId: chatState.peerId, ownerFingerprint: chatState.identity.fingerprint, rev: 1, createdAt: new Date().toISOString(),
    });
    broadcastSpaceRecord(space);
    return id;
  }, fp.BEN);
  check('BEN is in it', await waitFor(BEN, (id) => chatState.spaces.groups.some((g) => g.conversationId === id), { timeoutMs: 60000, arg: groupId }));
  await say(AVA, groupId, 'group hello');
  check('a message in it', await heard(BEN, 'group hello'));
  await open(AVA, groupId);
  await deleteOpen(AVA, 'keep');
  const kept = await AVA.evaluate((id) => ({ group: chatState.spaces.groups.some((g) => g.conversationId === id), history: (chatState.history[id] || []).length }), groupId);
  check('deleting the history keeps the membership', kept.group && kept.history === 0, JSON.stringify(kept));
  await open(AVA, groupId);
  await deleteOpen(AVA, 'leave');
  const left = await AVA.evaluate((id) => chatState.spaces.groups.some((g) => g.conversationId === id), groupId);
  check('deleting and leaving takes it off this device', !left);
  check('and BEN hears that she left',
    await waitFor(BEN, ({ id, me }) => {
      const group = chatState.spaces.groups.find((g) => g.conversationId === id);
      return Boolean(group) && !(group.members || []).includes(me);
    }, { timeoutMs: 60000, arg: { id: groupId, me: fp.AVA } }));

  const errors = [];
  for (const page of [AVA, AVA2, BEN, CORA]) errors.push(...(page.__errors || []));
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
