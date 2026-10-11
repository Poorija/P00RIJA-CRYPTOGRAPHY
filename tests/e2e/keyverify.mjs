/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Verifying a contact by scanning their code, and the rule for a verified
 * contact whose key then changes.
 *
 *   - the code one side shows is decoded by the other side's real QR reader
 *     and verifies the contact only when both halves fit;
 *   - a code that does not fit says so, and verifies nothing;
 *   - a verified contact appears verified in the chat list;
 *   - when that contact's key changes, sending stops until the new key is
 *     checked, the banner's one-tap accept opens the check instead, and a
 *     scan of the new key accepts and verifies it in one step;
 *   - a group message that names a conversation of this device's own (Saved
 *     Messages) is refused rather than written into it.
 */
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

const stacks = await startTwoStacks();
try {
  section('two people who have swapped cards');
  const NIMA = await openApp('NIMA', { origin: stacks.a.url, relay: stacks.a.url });
  const LEILA = await openApp('LEILA', { origin: stacks.a.url, relay: stacks.a.url });
  const cardNima = await identity(NIMA);
  const cardLeila = await identity(LEILA);
  const fpNima = fingerprintOf(cardNima);
  const fpLeila = fingerprintOf(cardLeila);
  await importIdentity(NIMA, cardLeila);
  await importIdentity(LEILA, cardNima);
  await waitFor(NIMA, (fp) => Boolean(findPeerByAnyKey(fp)?.publicKeyData), { timeoutMs: 30000, arg: fpLeila });
  await waitFor(LEILA, (fp) => Boolean(findPeerByAnyKey(fp)?.publicKeyData), { timeoutMs: 30000, arg: fpNima });

  section('the code NIMA shows');
  await openConversation(NIMA, fpLeila);
  const shown = await NIMA.evaluate(async () => {
    openSafetyPanel();
    await new Promise((r) => setTimeout(r, 1200));
    const box = document.querySelector('#chatSafetyPanel .chat-safety-qr-box');
    const canvas = box?.querySelector('canvas');
    const img = box?.querySelector('img');
    let dataUrl = '';
    if (canvas) dataUrl = canvas.toDataURL('image/png');
    else if (img) dataUrl = img.src;
    return {
      hasBox: Boolean(box),
      hasScan: Boolean(document.querySelector('#chatSafetyPanel [data-safety-scan]')),
      dataUrl,
    };
  });
  check('the safety panel carries a code and a scan button', shown.hasBox && shown.hasScan);
  check('the code is drawn as an image a camera can read', /^data:image\//.test(shown.dataUrl), shown.dataUrl.slice(0, 30));

  section('LEILA scans it with the real reader');
  await openConversation(LEILA, fpNima);
  const scanned = await LEILA.evaluate(async (dataUrl) => {
    openSafetyPanel();
    await new Promise((r) => setTimeout(r, 1000));
    /* The camera's own decoder on the picture NIMA's screen drew, then the
       verdict path a camera frame takes. No fetch: the page's CSP keeps
       data: out of connect-src. */
    const [, body] = dataUrl.split(',');
    const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const text = await window.PoorijaQR.decode(canvas, canvas.width, canvas.height);
    const peer = activePeer();
    const verdict = judgeScannedCode(text, chatState.identity.fingerprint, peer.fingerprint);
    applyScanVerdict(verdict, { peer, localFp: chatState.identity.fingerprint, remoteFp: peer.fingerprint, pending: false });
    return {
      decoded: Boolean(text),
      verdict,
      verified: isPeerVerified(peer.fingerprint),
      imageInput: Boolean(document.querySelector('#chatSafetyPanel input[type="file"]')),
    };
  }, shown.dataUrl);
  check('the real reader decodes the code NIMA drew', scanned.decoded === true && scanned.verdict === 'match', JSON.stringify(scanned));
  check('there is no way in through a picture — only the camera', scanned.imageInput === false);
  check('the code fits, and NIMA is verified on LEILA\'s side', scanned.verified === true);
  const badge = await LEILA.evaluate((fp) => {
    closeSafetyPanel();
    renderPeers();
    const card = document.querySelector(`#chatPeerList [data-chat-conversation="${CSS.escape(getConversationKey(findPeerByAnyKey(fp)))}"]`);
    return Boolean(card?.querySelector('.chat-verified-badge'));
  }, fpNima);
  check('and shown as verified in the chat list', badge === true);

  section('codes that do not fit');
  const verdicts = await LEILA.evaluate(({ nima, leila }) => {
    const genuine = verificationQrText(nima, leila);
    const swapped = verificationQrText(nima, 'ab'.repeat(32));
    return {
      genuine: judgeScannedCode(genuine, leila, nima),
      relayInTheMiddle: judgeScannedCode(swapped, leila, nima),
      ownCode: judgeScannedCode(verificationQrText(leila, nima), leila, nima),
      notACode: judgeScannedCode('https://example.com', leila, nima),
    };
  }, { nima: fpNima, leila: fpLeila });
  check('the genuine code matches', verdicts.genuine === 'match');
  check('a code holding a different key for the scanner does not', verdicts.relayInTheMiddle === 'mismatch');
  check('scanning your own code does not verify anybody', verdicts.ownCode === 'mismatch');
  check('something that is not a code is said to be so', verdicts.notACode === 'not-a-code');

  section('a stranger\'s message cannot land in Saved Messages');
  await openConversation(NIMA, fpLeila);
  const craft = (page, spaceId, text) => page.evaluate(async ({ leila, nima, id, body }) => {
    const member = findPeerByAnyKey(leila);
    let session = await ensureStoredSession(member);
    if (!session?.cryptoKey) session = await ensureDirectSession(member, { silent: true });
    const payload = await encryptForSession(session, new TextEncoder().encode(JSON.stringify({
      spaceId: id, spaceType: 'group', spaceName: 'Crafted', members: [leila, nima],
      messageId: `inject-${Date.now()}`, text: body, senderFingerprint: nima, createdAt: new Date().toISOString(),
    })));
    const outbound = { id: `inject-${Date.now()}`, type: 'space-message', createdAt: new Date().toISOString(), payload };
    if (session.connection?.open) safeConnectionSend(session.connection, outbound, 'group-message');
    else await sendSealedRelay(member, session, outbound, { createdAt: outbound.createdAt, scope: 'group' });
    return true;
  }, { leila: fpLeila, nima: fpNima, id: spaceId, body: text });
  /* The control first: the same crafted shape under an ordinary group id does
     arrive, so a refusal below is the refusal and not a lost message. */
  await craft(NIMA, `space-control-${Date.now()}`, 'control-group-message');
  const control = await waitFor(LEILA, () => Object.values(chatState.history).flat().some((e) => e.text === 'control-group-message'), { timeoutMs: 30000 });
  check('the same shape under an ordinary group id is delivered', control === true);
  const injected = await craft(NIMA, 'saved', 'injected-into-saved');
  check('the crafted message was sent', injected === true);
  await sleep(5000);
  const intact = await LEILA.evaluate(() => ({
    saved: (chatState.history.saved || []).some((e) => e.text === 'injected-into-saved'),
    anywhere: Object.values(chatState.history).flat().some((e) => e.text === 'injected-into-saved'),
    groupNamedSaved: (chatState.spaces.groups || []).some((g) => g.conversationId === 'saved'),
  }));
  check('it is not in Saved Messages, nor anywhere else', !intact.saved && !intact.anywhere, JSON.stringify(intact));
  check('and no group took the name', intact.groupNamedSaved === false);

  section('NIMA\'s key changes after LEILA verified it');
  const changed = await LEILA.evaluate(async (fp) => {
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki));
    const newFp = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    let binary = '';
    spki.forEach((b) => { binary += String.fromCharCode(b); });
    const record = findPeerByAnyKey(fp);
    mergePeerRecord({ ...record, publicKeyData: btoa(binary), fingerprint: newFp });
    const after = findPeerByAnyKey(fp) || chatState.peers.find((p) => p.pendingFingerprint === newFp);
    renderActivePeer();
    return {
      newFp,
      pending: Boolean(after?.keyChangedAt),
      strict: Boolean(after?.keyChangeWasVerified),
      stillVerified: isPeerVerified(fp),
      strictBanner: !document.getElementById('chatKeyAlertStrict')?.classList.contains('hidden'),
    };
  }, fpNima);
  check('the change is held aside as pending', changed.pending === true);
  check('and remembered as the change of a verified contact', changed.strict === true);
  check('the old verification no longer stands', changed.stillVerified === false);
  check('the banner says sending is held', changed.strictBanner === true);
  const blocked = await LEILA.evaluate(async () => {
    const before = (chatState.history[chatState.activeConversationId] || []).length;
    const box = document.getElementById('chatComposer');
    box.value = 'should not leave';
    await sendMessage();
    const after = (chatState.history[chatState.activeConversationId] || []).length;
    box.value = '';
    return { guard: guardGroupSend('sendMessages'), wrote: after > before };
  });
  check('nothing is sent while the new key is unchecked', blocked.guard === false && blocked.wrote === false, JSON.stringify(blocked));
  const acceptOpensCheck = await LEILA.evaluate(async () => {
    document.getElementById('chatKeyAcceptBtn').click();
    await new Promise((r) => setTimeout(r, 900));
    const peer = activePeer();
    return {
      panelOpen: !document.getElementById('chatSafetyPanel')?.classList.contains('hidden'),
      stillPending: Boolean(peer?.keyChangedAt),
      offersUnscanned: Boolean(document.querySelector('#chatSafetyPanel [data-safety-accept-unverified]')),
    };
  });
  check('the banner\'s accept opens the check instead of accepting', acceptOpensCheck.panelOpen && acceptOpensCheck.stillPending, JSON.stringify(acceptOpensCheck));
  check('where accepting without a scan is possible but separate', acceptOpensCheck.offersUnscanned === true);
  const raced = await LEILA.evaluate(async ({ leila, scannedFp }) => {
    /* The panel was drawn for scannedFp; a second key lands before the scan. */
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki));
    const otherFp = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    let binary = '';
    spki.forEach((b) => { binary += String.fromCharCode(b); });
    const peer = activePeer();
    const saved = { pendingKey: peer.pendingKey, pendingFingerprint: peer.pendingFingerprint };
    peer.pendingKey = btoa(binary);
    peer.pendingFingerprint = otherFp;
    const verdict = judgeScannedCode(verificationQrText(scannedFp, leila), leila, scannedFp);
    applyScanVerdict(verdict, { peer, localFp: leila, remoteFp: scannedFp, pending: true });
    const after = activePeer();
    const result = {
      verdict,
      stillPending: Boolean(after?.keyChangedAt),
      acceptedOther: after?.fingerprint === otherFp,
      verifiedScanned: isPeerVerified(scannedFp),
    };
    after.pendingKey = saved.pendingKey;
    after.pendingFingerprint = saved.pendingFingerprint;
    return result;
  }, { leila: fpLeila, scannedFp: changed.newFp });
  check('a key that changed again during the scan is not accepted on the strength of the earlier one', raced.stillPending && !raced.acceptedOther && !raced.verifiedScanned, JSON.stringify(raced));
  const injectedFlag = await LEILA.evaluate(() => {
    const record = mergePeerRecord({
      peerId: `poorija-peer-stranger-${Date.now()}`,
      fingerprint: 'cd'.repeat(32),
      publicKeyData: btoa('stranger-key'),
      keyChangedAt: new Date().toISOString(),
      keyChangeWasVerified: true,
    });
    return { flag: Boolean(record?.keyChangeWasVerified) };
  });
  check('a record from outside cannot arrive carrying the verified-change flag', injectedFlag.flag === false);
  const rescanned = await LEILA.evaluate(({ nima, leila, newFp }) => {
    const peer = activePeer();
    const verdict = judgeScannedCode(verificationQrText(newFp, leila), leila, newFp);
    applyScanVerdict(verdict, { peer, localFp: leila, remoteFp: newFp, pending: true });
    const after = activePeer();
    return {
      verdict,
      resolved: !after?.keyChangedAt,
      fingerprint: after?.fingerprint,
      verified: isPeerVerified(newFp),
      sendOpen: guardGroupSend('sendMessages'),
    };
  }, { nima: fpNima, leila: fpLeila, newFp: changed.newFp });
  check('scanning the new key accepts it and verifies it in one step', rescanned.resolved && rescanned.verified && rescanned.fingerprint === changed.newFp, JSON.stringify(rescanned));
  check('and sending is open again', rescanned.sendOpen === true);

  check('no page errors', [NIMA, LEILA].every((p) => !(p.__errors || []).length), [NIMA, LEILA].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
