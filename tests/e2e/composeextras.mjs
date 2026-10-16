/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Three things the composer does that it did not before.
 *
 *   - formatting: *bold*, ||spoiler|| and links arrive formatted, a spoiler
 *     stays covered until tapped, and the chat list shows the plain words;
 *   - scheduling: a message waits on the sender's device, is sent when its
 *     time comes, and only by the device that scheduled it;
 *   - Saved Messages: written on one device, never sent to anyone, and
 *     mirrored to the account's other device directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
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
  await new Promise((r) => setTimeout(r, 400));
}, fp);
const type = (page, text) => page.evaluate((value) => {
  const box = document.getElementById('chatComposer');
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}, text);
const send = (page) => page.evaluate(() => document.getElementById('chatSendMessageBtn').click());
const hasText = (page, text, direction = '') => page.evaluate(({ value, dir }) => Object.values(chatState.history)
  .some((list) => list.some((e) => e.text === value && (!dir || e.direction === dir))), { value: text, dir: direction });

const stacks = await startTwoStacks();
try {
  section('two people on one relay, and a second device of the first');
  const ALI = await openApp('ALI', { origin: stacks.a.url, relay: stacks.a.url });
  const SARA = await openApp('SARA', { origin: stacks.a.url, relay: stacks.a.url });
  const cardAli = await identity(ALI);
  const fpAli = fingerprintOf(cardAli);
  const shared = await ALI.evaluate(() => ({
    publicKeyData: chatState.identity.publicKeyData,
    privateKeyData: chatState.identity.privateKeyData,
    fingerprint: chatState.identity.fingerprint,
    createdAt: chatState.identity.createdAt || '',
  }));
  const ALI2 = await openApp('ALI2', { origin: stacks.a.url, relay: stacks.a.url });
  await ALI2.evaluate(async (ident) => {
    chatState.shouldReconnect = false;
    try { chatState.ws?.close(); } catch (_error) { /* gone */ }
    await new Promise((r) => setTimeout(r, 800));
    chatState.identity = { ...ident };
    saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, chatState.identity);
    chatState.shouldReconnect = true;
    renderStaticUi();
    await connectChatTransport();
    await new Promise((r) => setTimeout(r, 600));
    broadcastHello();
  }, shared);
  const cardSara = await identity(SARA);
  const fpSara = fingerprintOf(cardSara);
  await importIdentity(SARA, cardAli);
  await importIdentity(ALI, cardSara);
  await importIdentity(ALI2, cardSara);
  const linked = await waitFor(ALI, () => (chatState.linkedDevices || []).length >= 2, { timeoutMs: 40000 });
  check('ALI and ALI2 see each other as siblings', linked === true);

  section('formatting');
  await openConversation(ALI, fpSara);
  const formatted = `look *here* ||the butler|| https://example.com/a_b_c ${Date.now()}`;
  await type(ALI, formatted);
  await send(ALI);
  const arrived = await waitFor(SARA, (value) => Object.values(chatState.history).some((list) => list.some((e) => e.text === value)), { timeoutMs: 60000, arg: formatted });
  check('the formatted message arrives with its markers intact', arrived === true);
  await openConversation(SARA, fpAli);
  await sleep(500);
  const bubble = await SARA.evaluate((value) => {
    const node = [...document.querySelectorAll('#chatMessages .chat-message-text')].find((el) => el.textContent.includes('look'));
    if (!node) return null;
    const spoiler = node.querySelector('.chat-spoiler');
    const link = node.querySelector('a.chat-msg-link');
    return {
      strong: node.querySelector('strong')?.textContent || '',
      spoilerCovered: Boolean(spoiler) && !spoiler.classList.contains('is-revealed'),
      linkHref: link?.getAttribute('href') || '',
      linkRel: link?.getAttribute('rel') || '',
      italicised: Boolean(node.querySelector('em')),
      raw: value,
    };
  }, formatted);
  check('bold is drawn bold', bubble?.strong === 'here', JSON.stringify(bubble));
  check('the spoiler is covered', bubble?.spoilerCovered === true);
  check('the link is a link, opened without a referrer', bubble?.linkHref === 'https://example.com/a_b_c' && /noopener/.test(bubble?.linkRel) && /noreferrer/.test(bubble?.linkRel));
  check('underscores inside the link are not italics', bubble?.italicised === false);
  const revealed = await SARA.evaluate(() => {
    const spoiler = document.querySelector('#chatMessages .chat-spoiler');
    spoiler?.click();
    return spoiler?.classList.contains('is-revealed');
  });
  check('a tap uncovers it', revealed === true);
  const preview = await SARA.evaluate(() => plainMessageText(Object.values(chatState.history).flat().find((e) => String(e.text || '').startsWith('look *here*'))?.text));
  check('the list and notifications get the words, with the spoiler kept hidden', /^look here ▒+ https:\/\/example\.com\/a_b_c/.test(preview || ''), preview);

  section('a scheduled message');
  await openConversation(ALI, fpSara);
  const later = `later-${Date.now()}`;
  await type(ALI, later);
  const scheduled = await ALI.evaluate(() => {
    const entry = scheduleComposerMessage(new Date(Date.now() + 5 * 60 * 1000));
    return entry ? { id: entry.id, status: entry.status, by: entry.scheduledBy, composer: document.getElementById('chatComposer').value } : null;
  });
  check('it waits on the device that wrote it, marked scheduled', scheduled?.status === 'scheduled' && Boolean(scheduled?.by));
  check('and the composer is clear for the next one', scheduled?.composer === '');
  const chip = await ALI.evaluate((id) => Boolean(document.querySelector(`[data-chat-scheduled="${id}"]`)), scheduled?.id);
  check('its bubble shows when it will go', chip === true);
  await sleep(4000);
  check('nothing has reached the other side yet', !(await hasText(SARA, later)));
  const siblingCopy = await waitFor(ALI2, (value) => Object.values(chatState.history).some((list) => list.some((e) => e.text === value && e.status === 'scheduled')), { timeoutMs: 20000, arg: later });
  check('the other device knows about it, as scheduled', siblingCopy === true);
  await ALI2.evaluate(async (value) => {
    const entry = Object.values(chatState.history).flat().find((e) => e.text === value);
    if (entry) entry.scheduledAt = new Date(Date.now() - 1000).toISOString();
    await dispatchDueScheduled();
  }, later);
  await sleep(3000);
  check('the other device does not send a second copy when it falls due', !(await hasText(SARA, later)));
  await ALI.evaluate(async (value) => {
    const entry = Object.values(chatState.history).flat().find((e) => e.text === value);
    if (entry) entry.scheduledAt = new Date(Date.now() - 1000).toISOString();
    await dispatchDueScheduled();
  }, later);
  const delivered = await waitFor(SARA, (value) => Object.values(chatState.history).some((list) => list.some((e) => e.text === value)), { timeoutMs: 60000, arg: later });
  check('when its time comes, the device that scheduled it sends it', delivered === true);
  const after = await ALI.evaluate((value) => {
    const entry = Object.values(chatState.history).flat().find((e) => e.text === value);
    return { status: entry?.status, last: chatState.history[chatState.activeConversationId].slice(-1)[0]?.text === value };
  }, later);
  check('and it is no longer scheduled, but at the end of the thread', after.status !== 'scheduled' && after.last === true, JSON.stringify(after));
  const copies = await SARA.evaluate((value) => Object.values(chatState.history).flat().filter((e) => e.text === value).length, later);
  check('exactly one copy arrived', copies === 1, String(copies));

  section('a scheduled message taken back');
  const takenBack = `taken-back-${Date.now()}`;
  await type(ALI, takenBack);
  const backId = await ALI.evaluate(() => scheduleComposerMessage(new Date(Date.now() + 10 * 60 * 1000))?.id);
  const cancelled = await ALI.evaluate((id) => {
    const ok = cancelScheduledEntry(chatState.activeConversationId, id);
    return { ok, composer: document.getElementById('chatComposer').value, gone: !Object.values(chatState.history).flat().some((e) => e.id === id) };
  }, backId);
  check('cancelling removes it and puts the text back in the composer', cancelled.ok && cancelled.gone && cancelled.composer === takenBack, JSON.stringify(cancelled));
  await type(ALI, '');

  section('Saved Messages');
  const relayFramesBefore = await ALI.evaluate(() => {
    window.__sentFrames = [];
    const original = chatState.ws.send.bind(chatState.ws);
    chatState.ws.send = (data) => {
      try { window.__sentFrames.push(JSON.parse(data)); } catch (_error) { window.__sentFrames.push({ raw: true }); }
      return original(data);
    };
    return true;
  });
  check('watching what goes to the relay', relayFramesBefore === true);
  await ALI.evaluate(() => openSavedMessages());
  const note = `note-to-self-${Date.now()}`;
  await type(ALI, note);
  await send(ALI);
  await sleep(1500);
  const savedState = await ALI.evaluate((value) => ({
    kept: (chatState.history.saved || []).some((e) => e.text === value && e.direction === 'out'),
    listed: allConversationRecords().some((r) => r.type === 'saved'),
    header: document.getElementById('chatActivePeerName')?.textContent || '',
  }), note);
  check('a note is kept in Saved Messages', savedState.kept === true);
  check('which now appears in the chat list', savedState.listed === true);
  check('under its own name', /Saved Messages/.test(savedState.header), savedState.header);
  const mirroredNote = await waitFor(ALI2, (value) => (chatState.history.saved || []).some((e) => e.text === value), { timeoutMs: 20000, arg: note });
  check('the other device has it, device to device', mirroredNote === true);
  check('nobody else ever receives it', !(await hasText(SARA, note)));
  const frames = await ALI.evaluate((own) => {
    const relayed = window.__sentFrames.filter((frame) => frame?.type === 'relay');
    return {
      total: relayed.length,
      elsewhere: relayed.filter((frame) => frame.toFingerprint && frame.toFingerprint !== own).length,
    };
  }, fpAli);
  check('no relay frame carried anything addressed to another person', frames.elsewhere === 0, `${frames.total} relay frame(s), ${frames.elsewhere} to someone else`);
  const mailbox = path.join(stacks.a.dir, 'mailboxes', `${fpSara}.json`);
  const held = fs.existsSync(mailbox) ? fs.readFileSync(mailbox, 'utf8') : '';
  check('and the relay holds nothing for the other person', !held.includes(note));

  section('forwarding into Saved Messages');
  await openConversation(ALI, fpSara);
  const incoming = `keep-this-${Date.now()}`;
  await openConversation(SARA, fpAli);
  await type(SARA, incoming);
  await send(SARA);
  /* Both of ALI's devices, whichever one SARA's live channel reached: the one
     it reached hands it on to the other (mirrorToSiblings). Before, the other
     device never had it while both were online, and the forward below found
     no message to forward about half the time. */
  const onBoth = await Promise.all([ALI, ALI2].map((page) => waitFor(page, (value) => Object.values(chatState.history).some((list) => list.some((e) => e.text === value && e.direction === 'in')), { timeoutMs: 60000, arg: incoming })));
  check('a message from a contact reaches both of ALI\'s devices', onBoth.every(Boolean), JSON.stringify({ ALI: onBoth[0], ALI2: onBoth[1] }));
  const forwarded = await ALI.evaluate(async (value) => {
    const entry = Object.values(chatState.history).flat().find((e) => e.text === value);
    await forwardEntryToDestination(entry, 'saved');
    const copy = (chatState.history.saved || []).find((e) => e.text === value);
    const source = getActiveConversation();
    return { copied: Boolean(copy), from: copy?.forwardedFrom || '', expected: source?.username || source?.name || '', direction: copy?.direction };
  }, incoming);
  check('the message itself is copied, with where it came from', forwarded.copied && Boolean(forwarded.from) && forwarded.from === forwarded.expected && forwarded.direction === 'out', JSON.stringify(forwarded));

  check('no page errors', [ALI, ALI2, SARA].every((p) => !(p.__errors || []).length), [ALI, ALI2, SARA].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
