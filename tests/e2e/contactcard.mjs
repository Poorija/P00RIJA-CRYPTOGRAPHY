/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A contact handed on, on two real relays.
 *
 *   ARASH and BITA on relay A, DORNA on relay B; ARASH knows DORNA.
 *
 *   - ARASH sends BITA DORNA's card from the composer's contact picker: it
 *     carries the name, the id, the fingerprint, the key, DORNA's relay
 *     (address, id and key) and her photograph, redrawn;
 *   - BITA adds her from it: the key is pinned, the relay is one messages can
 *     be routed to, the photograph is shown, and a message from BITA reaches
 *     DORNA across the link;
 *   - a card whose fingerprint does not belong to its key is refused, from the
 *     chat and when pasted;
 *   - shared outside the app, the text card, the JSON and the plain text all
 *     name the relay, and the card and the JSON carry the photograph; a
 *     newcomer pasting that card gets all of it.
 */
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 240) : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (card) => JSON.parse(Buffer.from(card.replace('poorija-chat-v1:', ''), 'base64').toString('utf8'));
const openConversation = (page, fp) => page.evaluate(async (key) => {
  const peer = findPeerByAnyKey(key);
  chatState.activeConversationId = getConversationKey(peer);
  chatState.activePeerClientId = peer.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 300));
}, fp);

const stacks = await startTwoStacks();
try {
  section('three people, two relays');
  const ARASH = await openApp('ARASH', { origin: stacks.a.url, relay: stacks.a.url });
  const BITA = await openApp('BITA', { origin: stacks.a.url, relay: stacks.a.url });
  const DORNA = await openApp('DORNA', { origin: stacks.b.url, relay: stacks.b.url });
  const cards = { ARASH: await identity(ARASH), BITA: await identity(BITA), DORNA: await identity(DORNA) };
  const fp = Object.fromEntries(Object.entries(cards).map(([name, card]) => [name, decode(card).fingerprint]));
  /* DORNA has a photograph, and ARASH has it. */
  await DORNA.evaluate(async () => {
    setPendingAvatarData(generatedAvatarData('emerald', 'Dorna'));
    await savePendingAvatar();
  });
  await importIdentity(ARASH, cards.BITA);
  await importIdentity(BITA, cards.ARASH);
  await importIdentity(ARASH, cards.DORNA);
  await importIdentity(DORNA, cards.ARASH);
  const dornaAvatar = await DORNA.evaluate(() => chatState.profile.avatarData);
  check('ARASH has DORNA\'s photograph and her relay',
    await waitFor(ARASH, ({ key, want }) => {
      const peer = findPeerByAnyKey(key);
      return Boolean(peer) && peer.avatarData === want && Boolean(transitRouteFor(peer));
    }, { timeoutMs: 90000, arg: { key: fp.DORNA, want: dornaAvatar } }));

  section('handed on in the chat');
  await openConversation(ARASH, fp.BITA);
  const sent = await ARASH.evaluate(async (dorna) => {
    document.getElementById('chatContactBtn')?.click();
    await new Promise((r) => setTimeout(r, 400));
    const pick = [...document.querySelectorAll('#chatContactPickerList [data-contact-key]')]
      .find((node) => node.getAttribute('data-contact-key') === getConversationKey(findPeerByAnyKey(dorna)));
    pick?.click();
    await new Promise((r) => setTimeout(r, 2500));
    const entry = Object.values(chatState.history).flat().filter((e) => e.type === 'rich').pop();
    return { picked: Boolean(pick), rich: entry ? richPayloadOf(entry) : null };
  }, fp.DORNA);
  const rich = sent.rich || {};
  const dornaCard = decode(cards.DORNA);
  check('the card was picked and sent', sent.picked && rich.kind === 'contact', JSON.stringify(Object.keys(rich)));
  check('it carries the name, the id, the fingerprint and the key',
    Boolean(rich.name) && rich.peerId === dornaCard.peerId && rich.fingerprint === fp.DORNA && rich.publicKeyData === dornaCard.publicKeyData);
  check('and DORNA\'s relay — address, id and key',
    rich.homeRelay?.origin === dornaCard.homeRelay?.origin && rich.homeRelay?.id === stacks.b.identity.id && Boolean(rich.homeRelay?.key),
    JSON.stringify(rich.homeRelay || null).slice(0, 160));
  const photo = await ARASH.evaluate(async (data) => {
    const raw = atob(String(data || '').split(',')[1] || '');
    const size = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve([i.naturalWidth, i.naturalHeight]); i.onerror = () => resolve([0, 0]); i.src = data; });
    return { head: String(data || '').slice(0, 23), size, exif: raw.includes('Exif'), bytes: raw.length };
  }, rich.avatarData || '');
  check('and her photograph, a redrawn JPEG with nothing else inside', photo.head === 'data:image/jpeg;base64,' && !photo.exif && photo.size[0] === photo.size[1] && photo.size[0] >= 96, JSON.stringify(photo));

  const arrived = await waitFor(BITA, (key) => Object.values(chatState.history).flat().some((e) => e.type === 'rich' && richPayloadOf(e)?.fingerprint === key), { timeoutMs: 60000, arg: fp.DORNA });
  check('BITA receives it', arrived);
  await openConversation(BITA, fp.ARASH);
  const shown = await BITA.evaluate(() => {
    const card = [...document.querySelectorAll('#chatMessages .chat-contactcard')].pop();
    const img = card?.querySelector('.chat-contactcard-avatar img');
    return { card: Boolean(card), photo: Boolean(img?.getAttribute('src')?.startsWith('data:image/jpeg')), add: Boolean(card?.querySelector('[data-chat-adopt-contact]')) };
  });
  check('it shows as a card with her photograph and an Add button', shown.card && shown.photo && shown.add, JSON.stringify(shown));

  section('added from it');
  const added = await BITA.evaluate(async (key) => {
    const entry = Object.values(chatState.history).flat().filter((e) => e.type === 'rich' && richPayloadOf(e)?.fingerprint === key).pop();
    await adoptSharedContact(entry.id);
    const peer = findPeerByAnyKey(key);
    return peer ? {
      pinned: peer.trustedKey === peer.publicKeyData && Boolean(peer.trustedKey) && peer.trustedFingerprint === key,
      route: Boolean(transitRouteFor(peer)),
      source: peer.homeRelay?.source || '',
      photo: (peer.avatarData || '').startsWith('data:image/jpeg'),
      manual: peer.manual === true,
    } : null;
  }, fp.DORNA);
  check('BITA has her, with her key pinned', Boolean(added?.pinned) && added.manual, JSON.stringify(added));
  check('with a relay messages can be routed to, filed as a card\'s', added?.route === true && added?.source === 'card', JSON.stringify(added));
  check('and her photograph', added?.photo === true);
  const hello = `card-hello-${Date.now()}`;
  await openConversation(BITA, fp.DORNA);
  await BITA.evaluate(async (text) => {
    const box = document.getElementById('chatComposer');
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('chatSendMessageBtn')?.click();
  }, hello);
  check('and a message from BITA reaches DORNA across the link',
    await waitFor(DORNA, (text) => Object.values(chatState.history).flat().some((e) => e.text === text && e.direction === 'in'), { timeoutMs: 90000, arg: hello }));

  section('a card whose fingerprint is not its key\'s');
  const forged = await BITA.evaluate(async ({ victim, arashKey }) => {
    const notes = [];
    const original = window.notify;
    window.notify = (message) => notes.push(String(message));
    try {
      const fake = { kind: 'contact', id: 'forged-card', name: 'Forged', peerId: 'forged-peer', fingerprint: victim, publicKeyData: arashKey };
      const conversation = chatState.activeConversationId;
      chatState.history[conversation].push({ id: 'forged-card', type: 'rich', direction: 'in', rich: fake, createdAt: new Date().toISOString() });
      await adoptSharedContact('forged-card');
      const fromChat = findPeerByAnyKey('forged-peer');
      const pasted = await addIdentityAsConversation({ peerId: 'forged-paste', fingerprint: victim, publicKeyData: arashKey, name: 'Pasted' }, { startSession: false });
      return { fromChat: Boolean(fromChat), pasted: Boolean(pasted), notes };
    } finally {
      window.notify = original;
    }
  }, { victim: 'f'.repeat(64), arashKey: decode(cards.ARASH).publicKeyData });
  check('refused from the chat, and refused when pasted, with the reason given',
    !forged.fromChat && !forged.pasted && forged.notes.filter((note) => /fingerprint|اثرانگشت/.test(note)).length >= 2, JSON.stringify(forged));

  section('shared outside the app');
  const shapes = await ARASH.evaluate(async (key) => {
    const peer = findPeerByAnyKey(key);
    const avatarData = await contactCardAvatar(peer.avatarData, CONTACT_SHARE_TEXT_AVATAR_PX);
    return contactShareShapes(peer, { avatarData });
  }, fp.DORNA);
  const textCard = decode(shapes.card);
  const json = JSON.parse(shapes.json);
  check('the text card names her relay and carries her photograph',
    textCard.homeRelay?.id === stacks.b.identity.id && String(textCard.avatarData || '').startsWith('data:image/jpeg'), JSON.stringify({ relay: textCard.homeRelay?.origin, photo: String(textCard.avatarData || '').slice(0, 24) }));
  check('so does the JSON', json.homeRelay?.origin === dornaCard.homeRelay?.origin && String(json.avatarData || '').startsWith('data:image/jpeg'));
  check('and the plain text names the relay', shapes.plain.includes(dornaCard.homeRelay?.origin || 'missing'), shapes.plain);
  const NEW = await openApp('NEWCOMER', { origin: stacks.a.url, relay: stacks.a.url });
  await importIdentity(NEW, shapes.card);
  const imported = await waitFor(NEW, (key) => {
    const peer = findPeerByAnyKey(key);
    return Boolean(peer) && Boolean(transitRouteFor(peer)) && (peer.avatarData || '').startsWith('data:image/jpeg');
  }, { timeoutMs: 20000, arg: fp.DORNA });
  check('a newcomer who pastes it gets her relay and her photograph', imported);

  const errors = [];
  for (const page of [ARASH, BITA, DORNA, NEW]) errors.push(...(page.__errors || []));
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
