/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Everything forwards as itself.
 *
 *   A forwarded sticker pack used to arrive as the words "Forwarded:
 *   pack.wastickers" and nothing else; a poll, a location or a contact card as
 *   a line naming it. ARIF forwards one of every kind to BAHAR, from his Saved
 *   Messages, and BAHAR gets:
 *
 *   - the sticker pack, with its title, its count and its bytes;
 *   - the file, the voice note, the sticker and the GIF (with its size);
 *   - the poll as a poll with no votes, the location as a location, a live
 *     location as the place it last was, and the contact card as a card;
 *   - a text as text;
 *   and a view-once message, or one whose file is not on the device, is
 *   refused with a word rather than sent empty.
 */
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 260) : ''}`);
};
const decode = (card) => JSON.parse(Buffer.from(card.replace('poorija-chat-v1:', ''), 'base64').toString('utf8'));

const stacks = await startTwoStacks();
try {
  const ARIF = await openApp('ARIF', { origin: stacks.a.url, relay: stacks.a.url });
  const BAHAR = await openApp('BAHAR', { origin: stacks.a.url, relay: stacks.a.url });
  const cards = { ARIF: await identity(ARIF), BAHAR: await identity(BAHAR) };
  const fp = { ARIF: decode(cards.ARIF).fingerprint, BAHAR: decode(cards.BAHAR).fingerprint };
  await importIdentity(ARIF, cards.BAHAR);
  await importIdentity(BAHAR, cards.ARIF);
  await waitFor(ARIF, (key) => Boolean(findPeerByAnyKey(key)), { timeoutMs: 30000, arg: fp.BAHAR });

  const plan = await ARIF.evaluate(async ({ bahar, arif }) => {
    window.__notes = [];
    const original = window.notify;
    window.notify = (m, k) => { window.__notes.push(`${k}: ${m}`); return original?.(m, k); };
    const png = (hue, size = 64) => new Promise((resolve) => {
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const g = c.getContext('2d'); g.fillStyle = `hsl(${hue} 80% 50%)`; g.fillRect(0, 0, size, size);
      c.toBlob(resolve, 'image/png');
    });
    const zip = new window.JSZip();
    zip.file('contents.json', JSON.stringify({ name: 'Fwd Pack', stickers: [{ image_file: '1.png' }, { image_file: '2.png' }] }));
    zip.file('1.png', await png(10)); zip.file('2.png', await png(200));
    const pack = new File([await zip.generateAsync({ type: 'blob' })], 'Fwd Pack.wastickers', { type: 'application/zip' });
    const me = chatState.identity;
    const kept = {
      pack: await keepBlobInSaved(pack, 'stickerpack', 0, { packTitle: 'Fwd Pack', packCount: 2 }),
      file: await keepBlobInSaved(new File([new TextEncoder().encode('forwarded notes')], 'notes.txt', { type: 'text/plain' }), 'file'),
      voice: await keepBlobInSaved(new File([new Uint8Array(4000).fill(7)], 'voice.webm', { type: 'audio/webm' }), 'voice', 1500),
      sticker: await keepBlobInSaved(new File([await png(120)], 'sticker.png', { type: 'image/png' }), 'sticker', 0, { stickerKind: 'image' }),
      gif: await keepBlobInSaved(new File([await png(300, 90)], 'animation.gif', { type: 'image/gif' }), 'sticker', 0, { stickerKind: 'gif', mediaWidth: 90, mediaHeight: 90 }),
      poll: keepRichInSaved({ kind: 'poll', question: 'Tea or coffee?', options: ['Tea', 'Coffee'], multi: false, votes: { someone: [0] }, closed: false }),
      location: keepRichInSaved({ kind: 'location', lat: 35.6892, lng: 51.389, accuracy: 12, at: new Date().toISOString() }),
      live: keepRichInSaved({ kind: 'live-location', lat: 35.7, lng: 51.4, accuracy: 9, at: new Date().toISOString(), until: new Date(Date.now() + 3600000).toISOString(), live: true }),
      contact: keepRichInSaved({ kind: 'contact', name: 'Arif himself', fingerprint: me.fingerprint, peerId: chatState.peerId, publicKeyData: me.publicKeyData }),
      text: await keepTextInSaved('hello forwarded'),
      once: await keepBlobInSaved(new File([await png(50)], 'secret.png', { type: 'image/png' }), 'file', 0, {}, true),
    };
    /* A row whose bytes are nowhere on this device. */
    const ghost = { ...kept.file, id: 'ghost-file', downloadUrl: '', name: 'gone.txt' };
    chatState.history.saved.push(ghost);
    const target = getConversationKey(findPeerByAnyKey(bahar));
    for (const name of ['pack', 'file', 'voice', 'sticker', 'gif', 'poll', 'location', 'live', 'contact', 'text']) {
      openSavedMessages();
      await new Promise((r) => setTimeout(r, 200));
      await forwardEntryToDestination(kept[name], target);
      await new Promise((r) => setTimeout(r, 900));
    }
    const sentBefore = (chatState.history[target] || []).length;
    openSavedMessages();
    await forwardEntryToDestination(kept.once, target);
    openSavedMessages();
    await forwardEntryToDestination(ghost, target);
    await new Promise((r) => setTimeout(r, 500));
    return { sentBefore, sentAfter: (chatState.history[target] || []).length, notes: window.__notes.slice(), packSize: pack.size };
  }, { bahar: fp.BAHAR, arif: fp.ARIF });
  check('a view-once message and a file not on this device are refused, with a word, and nothing is sent',
    plan.sentAfter === plan.sentBefore && plan.notes.some((n) => /view-once|یک‌بار مصرف/.test(n)) && plan.notes.some((n) => /not on this device|روی این دستگاه نیست/.test(n)), JSON.stringify(plan.notes.slice(-3)));

  const got = await waitFor(BAHAR, (key) => {
    const list = chatState.history[getConversationKey(findPeerByAnyKey(key))] || [];
    return list.filter((e) => e.direction === 'in').length >= 10;
  }, { timeoutMs: 90000, arg: fp.ARIF });
  check('BAHAR receives all ten', got);
  const inbox = await BAHAR.evaluate(async (key) => {
    const list = (chatState.history[getConversationKey(findPeerByAnyKey(key))] || []).filter((e) => e.direction === 'in');
    const size = async (entry) => { try { return (await (await fetch(entry.downloadUrl)).blob()).size; } catch (_e) { return 0; } };
    const pack = list.find((e) => e.type === 'stickerpack');
    const file = list.find((e) => e.type === 'file');
    const rich = list.filter((e) => e.type === 'rich').map((e) => richPayloadOf(e));
    return {
      pack: pack ? { title: pack.packTitle, count: pack.packCount, bytes: await size(pack) } : null,
      file: file ? { name: file.name, bytes: await size(file) } : null,
      voice: list.some((e) => e.type === 'voice'),
      sticker: list.some((e) => e.type === 'sticker' && e.stickerKind !== 'gif'),
      gif: list.filter((e) => isGifEntry(e)).map((e) => [e.mediaWidth, e.mediaHeight])[0] || null,
      poll: rich.find((r) => r?.kind === 'poll'),
      locations: rich.filter((r) => r?.kind === 'location').length,
      live: rich.filter((r) => r?.kind === 'live-location').length,
      contact: rich.find((r) => r?.kind === 'contact')?.name || '',
      text: list.filter((e) => e.type === 'text').map((e) => e.text),
    };
  }, fp.ARIF);
  check('the sticker pack arrives as a pack, with its title, count and bytes', inbox.pack?.title === 'Fwd Pack' && inbox.pack.count === 2 && inbox.pack.bytes === plan.packSize, JSON.stringify(inbox.pack));
  check('the file, the voice note and the sticker arrive as themselves', inbox.file?.name === 'notes.txt' && inbox.file.bytes === 15 && inbox.voice && inbox.sticker, JSON.stringify({ file: inbox.file, voice: inbox.voice, sticker: inbox.sticker }));
  check('the GIF arrives with its size', JSON.stringify(inbox.gif) === '[90,90]', JSON.stringify(inbox.gif));
  check('the poll arrives as a poll, with its votes cleared', inbox.poll?.question === 'Tea or coffee?' && inbox.poll.options?.length === 2 && Object.keys(inbox.poll.votes || {}).length === 0, JSON.stringify(inbox.poll));
  check('the location, and the live location as the place it last was, arrive as locations', inbox.locations === 2 && inbox.live === 0, JSON.stringify({ locations: inbox.locations, live: inbox.live }));
  check('the contact card arrives as a card', inbox.contact === 'Arif himself', inbox.contact);
  check('a text arrives as text', inbox.text.some((text) => text.includes('hello forwarded')), JSON.stringify(inbox.text));

  const errors = [...(ARIF.__errors || []), ...(BAHAR.__errors || [])];
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
