/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* ============================================================================
   Verifying a contact by scanning their code, and what a verified contact's
   key change costs.
   ============================================================================

   Comparing sixty digits aloud works and nobody does it. Pointing one phone
   at the other does the same comparison in a second: each side shows a code
   holding both fingerprints in its own order, and the scanner accepts only a
   code that names the scanner's key as the other half. A relay that handed
   each side its own key produces two codes that do not fit together, and the
   scan says so instead of turning green.

       poorija-verify:1:<the shower's fingerprint>:<the fingerprint they hold for you>

   Nothing secret is in it — fingerprints are public — and nothing leaves the
   two screens: the comparison happens in the scanning device.

   The camera is the only way in. A picture of a code proves nothing about
   who is holding the phone it came from: whoever sits in the middle can
   send a perfectly fitting image of their own code over the very channel
   being checked. What makes a scan worth anything is that the other screen
   is in front of you.

   A verified contact is also held to a stricter rule. An unverified contact
   whose key changes is shown the existing warning and can keep writing. One
   that was verified is the case where a change matters most, so sending to
   them stops until the new key is checked: scanning their new code accepts
   and verifies it in one step, and accepting it without that is possible
   but asked for in so many words.
   ============================================================================ */

const VERIFY_QR_PREFIX = 'poorija-verify:1:';

function verificationQrText(localFp, remoteFp) {
  return `${VERIFY_QR_PREFIX}${String(localFp || '').toLowerCase()}:${String(remoteFp || '').toLowerCase()}`;
}
function parseVerificationQr(text) {
  const raw = String(text || '').trim();
  if (!raw.toLowerCase().startsWith(VERIFY_QR_PREFIX)) return null;
  const [owner, other] = raw.slice(VERIFY_QR_PREFIX.length).toLowerCase().split(':');
  if (!/^[a-f0-9]{16,128}$/.test(owner || '') || !/^[a-f0-9]{16,128}$/.test(other || '')) return null;
  return { owner, other };
}
/* 'match' — their code names them and names you, both as this device holds
   them. 'mismatch' — a verification code whose keys do not fit: one of the
   two devices holds a key the other side does not have. 'not-a-code' —
   somebody scanned something else. */
function judgeScannedCode(text, localFp, remoteFp) {
  const parsed = parseVerificationQr(text);
  if (!parsed) return 'not-a-code';
  const local = String(localFp || '').toLowerCase();
  const remote = String(remoteFp || '').toLowerCase();
  return parsed.owner === remote && parsed.other === local ? 'match' : 'mismatch';
}

/* ---- the strict rule ------------------------------------------------------ */

function verifiedKeyChangePending(peer) {
  return Boolean(peer && !peer.type && peer.keyChangedAt && peer.keyChangeWasVerified);
}
/* Called from guardGroupSend, the gate every send path already goes
   through — and again by each path against the record it is actually about
   to send to (refuseIfVerifiedKeyChanged), because the open conversation at
   the gate is not always the one at the send: a scheduled message goes to
   whoever it was written to, and a conversation can be switched while a
   file is being prepared. */
function verifiedKeyChangeBlocksSend() {
  const peer = typeof activePeer === 'function' ? activePeer() : null;
  return refuseIfVerifiedKeyChanged(peer);
}
function refuseIfVerifiedKeyChanged(peer, { quiet = false } = {}) {
  if (!verifiedKeyChangePending(peer)) return false;
  if (quiet) return true;
  notify(t(
    'کلید این مخاطب تأییدشده عوض شده است. تا کلید تازه را بررسی نکنید، چیزی برایش فرستاده نمی‌شود — کد او را اسکن کنید یا شمارهٔ امنیتی را بسنجید.',
    'This verified contact\'s key has changed. Nothing is sent to them until the new key is checked — scan their code or compare the safety number.',
  ), 'warning');
  return true;
}

/* ---- the panel ------------------------------------------------------------ */

let safetyScanner = null;
function stopSafetyScanner() {
  if (safetyScanner) {
    safetyScanner.stop().catch(() => {});
    safetyScanner = null;
  }
  const video = document.querySelector('#chatSafetyPanel .chat-safety-video');
  video?.classList.add('hidden');
}

function applyScanVerdict(verdict, { peer, localFp, remoteFp, pending }) {
  const out = document.querySelector('#chatSafetyPanel .chat-safety-scan-result');
  const say = (text, cls) => {
    if (!out) return;
    out.textContent = text;
    out.className = `chat-safety-scan-result ${cls}`;
  };
  if (verdict === 'not-a-code') {
    say(t('این کد تأیید هویت نیست. کدی را اسکن کنید که در همین صفحه روی گوشی او نمایش داده می‌شود.', 'That is not a verification code. Scan the code shown on this same screen on their phone.'), 'is-warn');
    return false;
  }
  if (verdict === 'mismatch') {
    stopSafetyScanner();
    say(t('کدها با هم جور نیستند: کلیدی که شما از او دارید با کلیدی که او دارد یکی نیست. ممکن است کسی میان شما باشد — چیز حساسی نفرستید.', 'The codes do not fit: the key you hold for them is not the key they have. Somebody may be in the middle — send nothing sensitive.'), 'is-bad');
    notify(t('کد تأیید جور نبود.', 'The verification code did not match.'), 'error');
    return false;
  }
  stopSafetyScanner();
  /* What matched is the key in the code, and what gets accepted or marked
     must be that same key. The panel was drawn a while ago; another key
     change may have landed since, and accepting "whatever is pending now"
     would accept a key nobody scanned. So the live record is read again and
     the action is taken only when it still names the scanned fingerprint. */
  const live = (peer && typeof findPeerByAnyKey === 'function'
    ? (findPeerByAnyKey(peer.conversationId || getConversationKey(peer)) || peer) : peer);
  const scanned = String(remoteFp || '').toLowerCase();
  const stillPending = Boolean(pending && live?.pendingKey && String(live.pendingFingerprint || '').toLowerCase() === scanned);
  const stillCurrent = Boolean(!pending && String(live?.fingerprint || '').toLowerCase() === scanned);
  if (!stillPending && !stillCurrent) {
    say(t('کلید این مخاطب از وقتی این صفحه باز شد دوباره عوض شده. صفحه را ببندید و دوباره اسکن کنید.', 'This contact\'s key changed again since this panel opened. Close it and scan again.'), 'is-warn');
    return false;
  }
  if (stillPending && typeof resolveKeyChange === 'function') resolveKeyChange(live, true);
  setPeerVerified(remoteFp, true);
  notify(t('کدها جور بودند؛ این مخاطب تأیید شد.', 'The codes match; this contact is verified.'), 'success');
  return true;
}

/* Runs after renderSafetyPanel has written the card. */
function decorateSafetyPanel(panel, { localFp, remoteFp, offeredFp, peer }) {
  stopSafetyScanner();
  const card = panel?.querySelector('.chat-safety-card');
  if (!card || !localFp || !remoteFp) return;
  const pending = Boolean(offeredFp);
  const context = { peer, localFp, remoteFp, pending };
  const section = document.createElement('div');
  section.className = 'chat-safety-qr';
  section.innerHTML = `
    <p class="chat-safety-hint">${app().escapeHTML(t(
      'یا سریع‌تر: یکی کد دیگری را با دوربین اسکن کند. اگر جور باشد، مخاطب خودکار تأیید می‌شود.',
      'Or faster: one of you scans the other\'s code. If it fits, the contact is verified automatically.',
    ))}</p>
    <div class="chat-safety-qr-box" aria-label="${app().escapeHTML(t('کد تأیید شما', 'Your verification code'))}"></div>
    <div class="chat-safety-qr-actions">
      <button type="button" class="chat-safety-btn" data-safety-scan><i class="fas fa-camera"></i> ${app().escapeHTML(t('اسکن کد او', 'Scan their code'))}</button>
    </div>
    <video class="chat-safety-video hidden" playsinline muted></video>
    <p class="chat-safety-scan-result" aria-live="polite"></p>
    ${pending && peer?.keyChangeWasVerified ? `<button type="button" class="chat-safety-btn is-undo" data-safety-accept-unverified>${app().escapeHTML(t('پذیرفتن کلید تازه بدون اسکن', 'Accept the new key without scanning'))}</button>` : ''}`;
  card.appendChild(section);
  const box = section.querySelector('.chat-safety-qr-box');
  try {
    window.PoorijaQR?.render(box, verificationQrText(localFp, remoteFp), { px: 220 });
  } catch (error) {
    console.warn('[Verify] the code could not be drawn:', error);
  }
  section.querySelector('[data-safety-scan]')?.addEventListener('click', async () => {
    if (!window.PoorijaQR?.Scanner) return;
    const video = section.querySelector('.chat-safety-video');
    if (safetyScanner) { stopSafetyScanner(); return; }
    video?.classList.remove('hidden');
    safetyScanner = new window.PoorijaQR.Scanner({
      video,
      onResult: (text) => { applyScanVerdict(judgeScannedCode(text, localFp, remoteFp), context); },
      onError: (error) => {
        const said = window.describeMediaError?.(error, 'video');
        notify(said || t('دسترسی به دوربین داده نشد.', 'Camera access was refused.'), 'error');
        stopSafetyScanner();
      },
    });
    const started = await safetyScanner.start();
    if (!started) stopSafetyScanner();
  });
  section.querySelector('[data-safety-accept-unverified]')?.addEventListener('click', async () => {
    const ok = await PoorijaDialogs.confirm(t(
      'این مخاطب را قبلاً تأیید کرده بودید و حالا کلیدش عوض شده. بدون اسکن یا مقایسه، نمی‌دانید کلید تازه مال خود اوست. باز هم پذیرفته شود؟',
      'You had verified this contact and their key has now changed. Without a scan or a comparison you cannot know the new key is theirs. Accept it anyway?',
    ), { danger: true });
    if (!ok || !peer) return;
    resolveKeyChange(peer, true);
    closeSafetyPanel();
  });
}

/* The key-change banner's own Accept button, for a contact that was
   verified: the safety panel opens instead, where the new code can be
   scanned — the one-tap accept is the path this rule exists to slow down. */
document.getElementById('chatKeyAcceptBtn')?.addEventListener('click', (event) => {
  const peer = typeof activePeer === 'function' ? activePeer() : null;
  if (!verifiedKeyChangePending(peer)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openSafetyPanel();
}, true);
document.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-safety-close]')) stopSafetyScanner();
}, true);

window.verificationQrText = verificationQrText;
window.judgeScannedCode = judgeScannedCode;
window.refuseIfVerifiedKeyChanged = refuseIfVerifiedKeyChanged;
