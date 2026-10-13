/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A profile, as the people who see it see it — two real relays, five people.
 *
 *   ALI and BAHAR on relay A are contacts; DARA on relay B is ALI's contact
 *   across the link; CYRUS is a stranger on relay A; ELHAM turns up later.
 *
 *   - a photograph chosen straight from a camera, EXIF and GPS inside, is
 *     saved without the crop step and what is stored and sent has none of it;
 *   - BAHAR and DARA get the whole photograph, byte for byte, without asking,
 *     and keep it after the relay's peer list arrives (the relay used to cut
 *     its copy at 100,000 characters and hand that out over the real one);
 *   - a status set, then cleared, and a photograph removed, reach both;
 *   - a preset avatar is a JPEG contacts can see, not an SVG they refuse;
 *   - a stranger on the same relay gets neither the card nor the photograph
 *     from the peer list;
 *   - a card forged in ALI's name — on the relay, or over transit, unsigned or
 *     signed with the wrong key — changes nothing anywhere;
 *   - opening a conversation fetches a missing photograph; somebody who is not
 *     a contact gets it only once they are added.
 */
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 220) : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fingerprintOf = (card) => JSON.parse(Buffer.from(card.replace('poorija-chat-v1:', ''), 'base64').toString('utf8')).fingerprint;

/* What one page holds about another. */
const viewOf = (page, fp) => page.evaluate((key) => {
  const peer = findPeerByAnyKey(key);
  return peer ? { avatar: peer.avatarData || '', mood: peer.mood || '', name: peer.username || '', version: peer.profileVersion || '' } : null;
}, fp);
/* Waits until the page's record of `fp` has every field in `want`. */
const FIELDS = { avatar: 'avatarData', mood: 'mood' };
const until = (page, fp, want, timeoutMs = 45000) => waitFor(page, ({ key, fields, wanted }) => {
  const peer = findPeerByAnyKey(key);
  return Boolean(peer) && Object.entries(wanted).every(([name, value]) => String(peer[fields[name]] || '') === value);
}, { timeoutMs, arg: { key: fp, fields: FIELDS, wanted: want } });
const openConversation = (page, fp) => page.evaluate(async (key) => {
  const peer = findPeerByAnyKey(key);
  chatState.activeConversationId = getConversationKey(peer);
  chatState.activePeerClientId = peer.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 300));
}, fp);
const myAvatar = (page) => page.evaluate(() => chatState.profile.avatarData || '');

const stacks = await startTwoStacks();
try {
  section('five people, two relays');
  const ALI = await openApp('ALI', { origin: stacks.a.url, relay: stacks.a.url });
  const BAHAR = await openApp('BAHAR', { origin: stacks.a.url, relay: stacks.a.url });
  const CYRUS = await openApp('CYRUS', { origin: stacks.a.url, relay: stacks.a.url });
  const DARA = await openApp('DARA', { origin: stacks.b.url, relay: stacks.b.url });
  const cards = { ALI: await identity(ALI), BAHAR: await identity(BAHAR), CYRUS: await identity(CYRUS), DARA: await identity(DARA) };
  const fp = Object.fromEntries(Object.entries(cards).map(([name, card]) => [name, fingerprintOf(card)]));
  await importIdentity(ALI, cards.BAHAR);
  await importIdentity(BAHAR, cards.ALI);
  await importIdentity(ALI, cards.DARA);
  await importIdentity(DARA, cards.ALI);
  /* CYRUS knows DARA (to have a road across the link) and nobody knows him. */
  await importIdentity(CYRUS, cards.DARA);
  await sleep(2500);
  /* A log of every card each page sends and reads, for when a check fails. */
  const tap = (page) => page.evaluate(() => {
    window.__cardLog = [];
    const t0 = Date.now();
    const original = window.noteProfileCard;
    window.noteProfileCard = async (payload, record, options) => {
      const before = findPeerByAnyKey(payload?.fingerprint || '')?.avatarData?.length || 0;
      await original(payload, record, options);
      window.__cardLog.push({ t: Date.now() - t0, in: String(payload?.fingerprint || '').slice(0, 6), please: Boolean(payload?.pleaseReply), v: String(payload?.version || '').slice(11, 19), relay: String(options?.relayFingerprint || '').slice(0, 6), avatar: String(payload?.avatarData || '').length, before, after: findPeerByAnyKey(payload?.fingerprint || '')?.avatarData?.length || 0 });
    };
    const direct = window.sendRelayEnvelope;
    window.sendRelayEnvelope = (peer, payload) => {
      const ok = direct(peer, payload);
      if (payload?.type === 'profile-card') window.__cardLog.push({ t: Date.now() - t0, out: String(peer?.fingerprint || '').slice(0, 6), via: 'relay', please: Boolean(payload.pleaseReply), ok, open: chatState.ws?.readyState });
      return ok;
    };
    const carried = window.sendViaTransit;
    window.sendViaTransit = (frame, route, peer) => {
      if (frame?.payload?.type === 'profile-card') window.__cardLog.push({ t: Date.now() - t0, out: String(peer?.fingerprint || '').slice(0, 6), via: 'transit', please: Boolean(frame.payload.pleaseReply) });
      return carried(frame, route, peer);
    };
    const asking = window.askForProfileIfMissing;
    window.askForProfileIfMissing = (peer, options) => {
      const sent = asking(peer, options);
      if (sent) window.__cardLog.push({ t: Date.now() - t0, ask: String(peer?.fingerprint || '').slice(0, 6), minMs: options?.minMs || 0 });
      return sent;
    };
  });
  await Promise.all([ALI, BAHAR].map(tap));
  check('everybody is connected', (await Promise.all([ALI, BAHAR, CYRUS, DARA].map((p) => p.evaluate(() => chatState.connected === true)))).every(Boolean));

  section('a photograph straight from a camera');
  const picked = await ALI.evaluate(async () => {
    /* A noisy photograph, so the redraw is well over the 100,000 characters
       the relay used to cut at, with an EXIF block naming a camera and a place. */
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1200;
    const g = c.getContext('2d');
    const img = g.createImageData(1600, 1200);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 7) % 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = (i >> 9) % 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const exif = new TextEncoder().encode('Exif\0\0MM\0*\0\0\0\x08 Make=CANON-EOS-SECRET GPSLatitude=35.6892N GPSLongitude=51.3890E');
    const seg = new Uint8Array(4 + exif.length);
    seg[0] = 0xff; seg[1] = 0xe1; seg[2] = (exif.length + 2) >> 8; seg[3] = (exif.length + 2) & 255; seg.set(exif, 4);
    const out = new Uint8Array(bytes.length + seg.length);
    out.set(bytes.subarray(0, 2)); out.set(seg, 2); out.set(bytes.subarray(2), 2 + seg.length);
    const file = new File([out], 'IMG_0001.JPG', { type: 'image/jpeg' });
    const raw = new TextDecoder('latin1').decode(out);
    await updateProfileAvatar(file);
    for (let i = 0; i < 100 && !chatState.avatarEditor; i += 1) await new Promise((r) => setTimeout(r, 100));
    /* Saved without the crop: the path that used to keep the original. */
    await savePendingAvatar();
    const stored = chatState.profile.avatarData || '';
    const decoded = atob(stored.split(',')[1] || '');
    const shown = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve([i.naturalWidth, i.naturalHeight]); i.onerror = () => resolve([0, 0]); i.src = stored; });
    return {
      originalHadExif: raw.includes('CANON-EOS-SECRET') && raw.includes('GPSLatitude'),
      head: stored.slice(0, 23),
      length: stored.length,
      exif: decoded.includes('Exif') || decoded.includes('CANON-EOS-SECRET') || decoded.includes('GPS'),
      app1: decoded.slice(2, 4) === '\xff\xe1',
      size: shown,
      clean: chatState.profile.avatarClean,
    };
  });
  check('the chosen file did carry a camera and a GPS position', picked.originalHadExif);
  check('what is stored is a JPEG', picked.head === 'data:image/jpeg;base64,', picked.head);
  check('with no EXIF, no camera, no GPS and no APP1 block in it', !picked.exif && !picked.app1, JSON.stringify(picked));
  check('square, and no larger than 640 pixels', picked.size[0] === picked.size[1] && picked.size[0] > 0 && picked.size[0] <= 640, JSON.stringify(picked.size));
  check('and bigger than the 100,000 characters the relay used to cut at', picked.length > 100000, `${picked.length} chars`);
  const aliAvatar = await myAvatar(ALI);

  section('delivered, whole, without asking');
  check('BAHAR, on the same relay, gets the photograph byte for byte', await until(BAHAR, fp.ALI, { avatar: aliAvatar }));
  check('DARA, across the link, gets it too', await until(DARA, fp.ALI, { avatar: aliAvatar }, 90000));
  const afterList = await BAHAR.evaluate(async (key) => {
    chatState.ws.send(JSON.stringify({ type: 'get-peers' }));
    await new Promise((r) => setTimeout(r, 2500));
    return findPeerByAnyKey(key)?.avatarData || '';
  }, fp.ALI);
  check('and the relay\'s peer list does not replace it with a cut copy', afterList === aliAvatar, `${afterList.length} chars kept of ${aliAvatar.length}`);

  section('what a stranger on the same relay sees');
  const stranger = await CYRUS.evaluate(async (key) => {
    const raw = [];
    const listen = (event) => { try { const frame = JSON.parse(event.data); if (frame.type === 'peers') raw.push(frame); } catch (_e) { /* not json */ } };
    chatState.ws.addEventListener('message', listen);
    chatState.ws.send(JSON.stringify({ type: 'get-peers' }));
    await new Promise((r) => setTimeout(r, 2500));
    chatState.ws.removeEventListener('message', listen);
    const listed = raw.flatMap((frame) => frame.peers || []).find((peer) => peer.fingerprint === key) || null;
    return { record: findPeerByAnyKey(key)?.avatarData || '', listedAvatar: listed ? String(listed.avatarData || '') : 'not listed' };
  }, fp.ALI);
  check('the relay\'s peer list carries no photograph of ALI', stranger.listedAvatar === '', stranger.listedAvatar.slice(0, 40));
  check('and no card brought it to him either', stranger.record === '', `${stranger.record.length} chars`);

  section('status');
  const setMood = (page, text) => page.evaluate(async (value) => {
    const original = PoorijaDialogs.prompt;
    PoorijaDialogs.prompt = async () => value;
    try { await editMood(); } finally { PoorijaDialogs.prompt = original; }
  }, text);
  await setMood(ALI, 'سر کار');
  check('a status reaches BAHAR', await until(BAHAR, fp.ALI, { mood: 'سر کار' }));
  check('and DARA across the link', await until(DARA, fp.ALI, { mood: 'سر کار' }, 90000));
  await setMood(ALI, '');
  check('cleared, it is cleared for BAHAR', await until(BAHAR, fp.ALI, { mood: '' }));
  check('and for DARA', await until(DARA, fp.ALI, { mood: '' }, 90000));

  section('a photograph removed, and a preset chosen');
  await ALI.evaluate(() => setProfileAvatarData(''));
  check('removed, it is gone for BAHAR', await until(BAHAR, fp.ALI, { avatar: '' }));
  check('and for DARA', await until(DARA, fp.ALI, { avatar: '' }, 90000));
  const preset = await ALI.evaluate(async () => {
    await selectPresetAvatar('assets/profile-avatars/aegis.svg');
    await savePendingAvatar();
    return chatState.profile.avatarData || '';
  });
  check('a preset is stored as a JPEG, not an SVG', preset.startsWith('data:image/jpeg;base64,'), preset.slice(0, 30));
  check('and BAHAR sees it', await until(BAHAR, fp.ALI, { avatar: preset }));
  check('and DARA sees it', await until(DARA, fp.ALI, { avatar: preset }, 90000));
  const generated = await ALI.evaluate(async () => {
    setPendingAvatarData(generatedAvatarData('violet', 'Ali'));
    await savePendingAvatar();
    return chatState.profile.avatarData || '';
  });
  check('so is a generated initial', generated.startsWith('data:image/jpeg;base64,'), generated.slice(0, 30));
  check('which BAHAR sees', await until(BAHAR, fp.ALI, { avatar: generated }));

  section('a card forged in ALI\'s name');
  const before = { bahar: await viewOf(BAHAR, fp.ALI), dara: await viewOf(DARA, fp.ALI) };
  const forged = await CYRUS.evaluate(async ({ ali, aliKey, bahar, dara }) => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#f00'; g.fillRect(0, 0, 64, 64);
    const face = c.toDataURL('image/jpeg', 0.8);
    const card = (to) => ({
      type: 'profile-card', version: '2999-01-01T00:00:00.000Z', fingerprint: ali, publicKeyData: aliKey,
      peerId: 'forged', username: 'Mallory', mood: 'forged', avatarData: face, to, createdAt: new Date().toISOString(),
    });
    /* On the relay, to BAHAR: the relay vouches for CYRUS, not ALI. */
    chatState.ws.send(JSON.stringify({ type: 'relay', toClientId: '', toFingerprint: bahar, payload: card(bahar), persist: false }));
    /* Over the link to DARA: unsigned, then signed with CYRUS's own key. */
    const daraRecord = findPeerByAnyKey(dara);
    const route = transitRouteFor(daraRecord);
    sendViaTransit({ type: 'relay', toClientId: '', toFingerprint: dara, payload: card(dara), persist: false }, route, daraRecord);
    const signed = await signProfileCard(card(dara));
    sendViaTransit({ type: 'relay', toClientId: '', toFingerprint: dara, payload: signed, persist: false }, route, daraRecord);
    return { route: Boolean(route), face: face.length };
  }, { ali: fp.ALI, aliKey: JSON.parse(Buffer.from(cards.ALI.replace('poorija-chat-v1:', ''), 'base64').toString('utf8')).publicKeyData, bahar: fp.BAHAR, dara: fp.DARA });
  check('CYRUS had a road to DARA for the transit forgeries', forged.route);
  await sleep(8000);
  const after = { bahar: await viewOf(BAHAR, fp.ALI), dara: await viewOf(DARA, fp.ALI) };
  check('BAHAR still sees ALI as ALI wrote himself', JSON.stringify(after.bahar) === JSON.stringify(before.bahar), JSON.stringify({ name: after.bahar?.name, mood: after.bahar?.mood }));
  check('and so does DARA, unsigned or signed with the wrong key', JSON.stringify(after.dara) === JSON.stringify(before.dara), JSON.stringify({ name: after.dara?.name, mood: after.dara?.mood }));

  section('opening a conversation');
  await BAHAR.evaluate((key) => {
    const peer = findPeerByAnyKey(key);
    peer.avatarData = ''; peer.profileVersion = '';
    /* As though the last time it asked was a while ago: the ask throttles
       itself, and this whole suite runs inside a minute. */
    profileAskedAt.delete(getConversationKey(peer));
    renderPeers();
  }, fp.ALI);
  await openConversation(BAHAR, fp.ALI);
  const fetched = await until(BAHAR, fp.ALI, { avatar: generated }, 30000);
  check('a contact whose photograph is missing has it fetched when the chat opens', fetched);
  if (!fetched) {
    console.log(`    ALI=${fp.ALI.slice(0, 6)} BAHAR=${fp.BAHAR.slice(0, 6)}`);
    console.log('    BAHAR:', JSON.stringify(await BAHAR.evaluate((key) => {
      const peer = findPeerByAnyKey(key);
      return { log: window.__cardLog.slice(-16), now: Date.now(), asked: profileAskedAt.get(getConversationKey(peer)) ? Date.now() - profileAskedAt.get(getConversationKey(peer)) : null, version: peer.profileVersion };
    }, fp.ALI)));
    console.log('    ALI:', JSON.stringify(await ALI.evaluate(() => window.__cardLog.slice(-16))));
  }
  const ELHAM = await openApp('ELHAM', { origin: stacks.a.url, relay: stacks.a.url });
  const cardE = await identity(ELHAM);
  await importIdentity(ELHAM, cards.ALI);
  await sleep(1500);
  await openConversation(ELHAM, fp.ALI);
  await sleep(8000);
  check('somebody ALI has not added does not get his photograph by asking', ((await viewOf(ELHAM, fp.ALI))?.avatar || '') === '');
  await importIdentity(ALI, cardE);
  await sleep(1500);
  await openConversation(ALI, fingerprintOf(cardE));
  check('once ALI adds her, it arrives', await until(ELHAM, fp.ALI, { avatar: generated }, 45000));

  const errors = [];
  for (const page of [ALI, BAHAR, CYRUS, DARA, ELHAM]) errors.push(...(page.__errors || []));
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
