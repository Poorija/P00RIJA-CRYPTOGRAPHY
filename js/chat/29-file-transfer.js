/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 29 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Streaming file transfer
*/

/* ------------------------------------------------------------------
 * Streaming file transfer
 *
 * The wire format is versioned. v1 encrypted the whole file under a single IV
 * and sliced the base64 of that into 48 KB text chunks; v2 slices the file
 * first and gives every chunk its own IV, so nothing larger than one chunk is
 * ever held in memory or turned into a string. `file-start` carries `v: 2`;
 * a transfer without it is read the old way, which is what keeps anything an
 * older client already queued on the relay readable.
 *
 * Over a live data channel a chunk travels as raw bytes in `bin` — PeerJS
 * serialises with BinaryPack, so a Uint8Array survives the trip intact and the
 * 33% base64 tax disappears from the hot path. The relay leg is JSON, so there
 * the same chunk goes as base64 in `chunk`.
 * ------------------------------------------------------------------ */

/* BinaryPack hands back a Uint8Array that is a view into the packet buffer, so
   the view is passed to WebCrypto as-is rather than through `.buffer`, which
   would be the whole packet. */
function chunkCipherBytes(message) {
  const bin = message?.bin;
  if (bin instanceof Uint8Array) return bin;
  if (bin instanceof ArrayBuffer) return new Uint8Array(bin);
  if (ArrayBuffer.isView(bin)) return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
  if (typeof message?.chunk === 'string') return new Uint8Array(app().base64ToArrayBuffer(message.chunk));
  return null;
}

/* Wait until the peer has actually drained what we queued.
 *
 * This is the fix for "stuck in sending". PeerJS's own send path gives up
 * quietly in two ways: past 8 MB of unsent data it pushes frames into an
 * unbounded in-memory array, and if RTCDataChannel.send() throws it calls
 * close() on the connection — the transfer then stops with no error anywhere,
 * which is exactly the intermittent stall that was reported. Staying well
 * under that ceiling means neither branch is ever reached.
 *
 * `bufferedamountlow` is the cheap signal, but WebKitGTK and WKWebView have
 * both shipped builds where it does not fire, and every desktop build here is
 * one of those two engines — hence the poll as a backstop rather than as a
 * belt-and-braces flourish. */
function awaitChannelDrain(connection) {
  const channel = connection?.dataChannel;
  if (!channel || !connection?.open) return Promise.resolve(Boolean(connection?.open));
  const congested = () => channel.bufferedAmount > DATA_CHANNEL_LOW_WATER || (connection.bufferSize || 0) > 0;
  if (channel.bufferedAmount <= DATA_CHANNEL_HIGH_WATER && !(connection.bufferSize || 0)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      channel.removeEventListener('bufferedamountlow', onLow);
      window.clearInterval(poll);
      resolve(ok);
    };
    const onLow = () => finish(true);
    try {
      channel.bufferedAmountLowThreshold = DATA_CHANNEL_LOW_WATER;
      channel.addEventListener('bufferedamountlow', onLow);
    } catch (_error) {
      /* Older engines expose neither; the poll covers it. */
    }
    const poll = window.setInterval(() => {
      if (!connection.open) finish(false);
      else if (!congested()) finish(true);
      else if (Date.now() - startedAt > TRANSFER_STALL_TIMEOUT_MS) finish(false);
    }, 40);
  });
}

/* Moves decrypted chunks out of the JS heap and into the blob store as soon as
   enough of them sit next to each other to be worth one Blob.

   The receiver used to hold every chunk as a Uint8Array until the last one
   landed, so a file's peak cost was the file. At 500 MB that was survivable;
   at the 4 GB the live path now allows it is not, because no tab has a 4 GB
   heap. A Blob's bytes are not heap — the browser keeps them in its blob
   store and pages them to disk once they are large — and building a Blob out
   of Blobs copies nothing, so the assembled file at the end costs no more than
   the pieces already did.

   Only a contiguous run is flushed, because a Blob is an ordered thing and a
   gap cannot be filled in later. Chunks arrive in order on a reliable ordered
   channel, so in practice the run is everything; a hole left for the resend
   path simply holds the flush back until it is filled, which is the same
   memory behaviour as before for that one stretch.

   `force` is for completion, where every index has arrived and the run is by
   definition the whole file. */
function flushReceivedChunks(transfer, { force = false } = {}) {
  if (!transfer || !Array.isArray(transfer.chunks) || !Array.isArray(transfer.parts)) return;
  let run = 0;
  let bytes = 0;
  while (transfer.flushedThrough + run < transfer.meta.totalChunks) {
    const piece = transfer.chunks[transfer.flushedThrough + run];
    if (!piece) break;
    bytes += piece.byteLength;
    run += 1;
  }
  if (!run || (!force && bytes < TRANSFER_FLUSH_BYTES)) return;
  const start = transfer.flushedThrough;
  transfer.parts.push(new Blob(transfer.chunks.slice(start, start + run)));
  /* Dropped only after the Blob exists: the constructor copies, and until it
     returns these are the only reference to the bytes. */
  for (let i = 0; i < run; i += 1) transfer.chunks[start + i] = null;
  transfer.flushedThrough = start + run;
}

/* Speed is averaged over a rolling ~3s window. A figure derived from the last
   64 KB chunk swings by an order of magnitude between frames and is unreadable;
   the window is what makes it sit still enough to be worth showing. */
function createTransferMeter(totalBytes) {
  const samples = [{ at: Date.now(), bytes: 0 }];
  let lastPaintAt = 0;
  return function report(bytes, { force = false } = {}) {
    const at = Date.now();
    samples.push({ at, bytes });
    while (samples.length > 2 && at - samples[0].at > 3000) samples.shift();
    /* The DOM write is throttled, not the sampling: at 64 KB a chunk a fast
       link produces thousands of these a second and layout would dominate. */
    if (!force && at - lastPaintAt < 120) return null;
    lastPaintAt = at;
    const oldest = samples[0];
    const seconds = (at - oldest.at) / 1000;
    const speed = seconds >= 0.25 ? Math.max(0, (bytes - oldest.bytes) / seconds) : 0;
    /* Each part is isolated as a whole, not just the numbers inside it.
       "116 MB / 120 MB" is two isolated runs either side of a neutral slash:
       in a right-to-left line the algorithm swaps them and the reader is told
       120 MB has been sent out of 116. Same for "11 MB/s", where the bare
       "/s" drifts to the front. U+2066 forces the whole run left-to-right;
       the ETA carries Persian words, so it gets U+2068, which takes its
       direction from its own first strong character. */
    const ltr = (text) => `\u2066${text}\u2069`;
    const auto = (text) => (text ? `\u2068${text}\u2069` : '');
    const parts = [ltr(`${app().formatBytes(bytes)} / ${app().formatBytes(totalBytes)}`)];
    if (speed > 0) {
      parts.push(ltr(t(`${app().formatBytes(speed)}/ثانیه`, `${app().formatBytes(speed)}/s`)));
      parts.push(auto(formatTransferEta((totalBytes - bytes) / speed)));
    }
    return {
      percent: totalBytes > 0 ? (bytes / totalBytes) * 100 : 0,
      detail: parts.filter(Boolean).join(' · '),
    };
  };
}

function formatTransferEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return t(`${Math.ceil(seconds)} ثانیه مانده`, `${Math.ceil(seconds)}s left`);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.ceil(seconds % 60);
  if (minutes < 60) return t(`${minutes}:${String(rest).padStart(2, '0')} مانده`, `${minutes}:${String(rest).padStart(2, '0')} left`);
  return t(`${Math.round(minutes / 60)} ساعت مانده`, `${Math.round(minutes / 60)}h left`);
}

/* An incomplete transfer used to sit in `incomingFiles` forever, showing
   nothing and never failing. The watchdog is re-armed by every chunk, so it
   only fires on genuine silence — first to ask for whatever is missing, and
   after three unanswered attempts to give the file up out loud. */
const transferWatchdogs = new Map();
function clearTransferWatchdog(transferId) {
  const timer = transferWatchdogs.get(transferId);
  if (timer) window.clearTimeout(timer);
  transferWatchdogs.delete(transferId);
}
function armTransferWatchdog(transferId) {
  clearTransferWatchdog(transferId);
  transferWatchdogs.set(transferId, window.setTimeout(() => onTransferStalled(transferId), TRANSFER_STALL_TIMEOUT_MS));
}
function onTransferStalled(transferId) {
  transferWatchdogs.delete(transferId);
  const transfer = chatState.incomingFiles.get(transferId);
  if (!transfer) return;
  const missing = [];
  for (let index = 0; index < transfer.meta.totalChunks && missing.length < 256; index += 1) {
    if (!transfer.seen.has(index)) missing.push(index);
  }
  if (transfer.version >= 2 && missing.length && transfer.resendRequests < 3) {
    const request = { type: 'file-resend', transferId, indices: missing };
    let asked = false;
    if (transfer.session?.connection?.open) {
      asked = safeConnectionSend(transfer.session.connection, request, 'file-resend');
    }
    /* A transfer that came over the relay has no channel to ask on. The
       question goes back the same way the chunks came — and across relays
       that is the only way a lost chunk was ever going to be replaced. */
    if (!asked) {
      const sender = findPeerBySession(transfer.session);
      if (sender) asked = relaySessionEvent(sender, { ...request, createdAt: new Date().toISOString() });
    }
    if (asked) {
      transfer.resendRequests += 1;
      armTransferWatchdog(transferId);
      return;
    }
  }
  chatState.incomingFiles.delete(transferId);
  clearTransferBanner(0, `recv:${transferId}`);
  notify(t(
    `دریافت «${transfer.meta.name || 'فایل'}» ناتمام ماند؛ از فرستنده بخواهید دوباره بفرستد.`,
    `"${transfer.meta.name || 'A file'}" did not finish downloading — ask the sender to try again.`,
  ), 'warning');
}

/* Marks that the peer on the other end of this session changed THEIR key (our
   record of them is in the pending state) — no wait, this direction is the
   other one: the frame arrives from a peer whose pinned view of US is
   conflicted, meaning OUR key is the new one and THEY have not accepted it.
   The endless "session key mismatch, renegotiating" toast loop used to be the
   only symptom of that; the honest report is a single, plain sentence. */
function notePeerAwaitingKeyAccept(session) {
  const peer = findPeerBySession(session);
  if (!peer?.peerId || chatState.awaitingKeyAccept.has(peer.peerId)) return;
  chatState.awaitingKeyAccept.add(peer.peerId);
  const conversationId = getConversationKey(peer);
  if (conversationId) {
    appendHistory(conversationId, {
      id: `key-wait-${Date.now()}`,
      type: 'system-note',
      direction: 'in',
      text: t(
        'شما کلید چت خود را عوض کرده‌اید و طرف مقابل هنوز کلید تازه را تأیید نکرده است. تا پذیرش او سشن امن زنده برقرار نمی‌شود؛ به‌محض تأیید، چت به‌طور خودکار ادامه می‌یابد.',
        'You changed your chat key and the other side has not accepted the new one yet. The live secure session cannot come up until they do; the chat resumes automatically once they accept.',
      ),
      createdAt: new Date().toISOString(),
    });
  }
  notify(t(
    'منتظر تأیید کلید تازه توسط طرف مقابل هستید.',
    'Waiting for the other side to accept the new key.',
  ), 'info');
  renderActivePeer();
  renderMessages();
}

/* The recipient's half of the consent gate. Runs detached from the message
   queue on purpose: the sender is the one waiting, not this thread, and a
   dialog must never hold up the messages arriving behind it. */async function decideGatedTransfer(session, transferId, size) {
  const record = chatState.incomingFiles.get(transferId);
  if (!record || record.consent !== 'pending') return;
  /* Nobody answered on either side (the sender gives up after their own
     timeout): drop the held record so an ignored prompt cannot pin memory. */
  const staleTimer = window.setTimeout(() => {
    const held = chatState.incomingFiles.get(transferId);
    if (held && held.consent === 'pending') chatState.incomingFiles.delete(transferId);
  }, TRANSFER_CONSENT_TIMEOUT_MS + 30000);
  const meta = record.meta;
  const quota = chatAutoDownloadLimitBytes();
  const isLarge = size >= LARGE_FILE_CONFIRM_BYTES;
  /* A message request is always asked about, whatever the quota. */
  const fromRequest = typeof isMessageRequest === 'function' && isMessageRequest(findPeerBySession(session));
  let accepted = !fromRequest && !isLarge && quota > 0 && size <= quota;
  if (!accepted) {
    const sizeText = app().formatBytes?.(size) || `${size} B`;
    accepted = await PoorijaDialogs.confirm(fromRequest ? t(
      `کسی که در مخاطبان شما نیست می‌خواهد فایل «${meta.name || 'فایل'}» (${sizeText}) را بفرستد. دریافت شود؟`,
      `Someone who is not in your contacts wants to send "${meta.name || 'a file'}" (${sizeText}). Receive it?`,
    ) : t(
      isLarge
        ? `دریافت فایل «${meta.name || 'فایل'}» (${sizeText})؟\nفایل‌های حجیم فقط وقتی هر دو نفر آنلاین باشند جابه‌جا می‌شوند.`
        : `دریافت فایل «${meta.name || 'فایل'}» (${sizeText})؟ این فایل از سهمیهٔ دانلود خودکار شما بزرگ‌تر است.`,
      isLarge
        ? `Receive "${meta.name || 'this file'}" (${sizeText})?\nLarge files only move while both of you are online.`
        : `Receive "${meta.name || 'this file'}" (${sizeText})? It is larger than your auto-download quota.`,
    ), {
      title: t('دریافت فایل', 'Incoming file'),
      okLabel: t('دریافت', 'Receive'),
      cancelLabel: t('رد کردن', 'Decline'),
    });
  }
  window.clearTimeout(staleTimer);
  const target = chatState.incomingFiles.get(transferId);
  if (!target || target.consent !== 'pending') return;
  if (accepted) {
    target.consent = 'granted';
    /* Straight down the live channel; the relay route would queue an answer
       to a sender who has moved on. */
    if (session?.connection?.open) {
      safeConnectionSend(session.connection, { type: 'file-accept', transferId }, 'file-accept');
    }
    armTransferWatchdog(transferId);
    return;
  }
  target.consent = 'refused';
  chatState.incomingFiles.delete(transferId);
  clearTransferWatchdog(transferId);
  if (session?.connection?.open) {
    safeConnectionSend(session.connection, { type: 'file-decline', transferId }, 'file-decline');
  }
  const conversationKey = getPeerHistoryKey(findPeerBySession(session), session);
  if (conversationKey) {
    appendHistory(conversationKey, {
      id: `file-declined-${transferId}`,
      type: 'system-note',
      direction: 'in',
      text: t(
        `فایل «${meta.name || 'فایل'}» رد شد؛ دانلود و آپلود آن لغو شد.`,
        `"${meta.name || 'A file'}" was declined; its download and upload were both cancelled.`,
      ),
      createdAt: new Date().toISOString(),
    });
  }
  notify(t('فایل رد شد.', 'The file was declined.'), 'info');
}

/* The relay socket drains at the speed of the network, and a sender that
   outruns it does not speed the file up — the bytes simply pile up in the
   browser's own send buffer until the tab has copies of half the file in
   memory. The live channel has awaited this since the beginning; the relay
   leg now waits too, at the same watermarks. */
const RELAY_SEND_HIGH_WATER = DATA_CHANNEL_HIGH_WATER;
const RELAY_SEND_LOW_WATER = DATA_CHANNEL_LOW_WATER;
function waitForRelaySocketDrain() {
return new Promise((resolve) => {
const ws = chatState.ws;
if (!ws || ws.readyState !== WebSocket.OPEN) return resolve(false);
if (ws.bufferedAmount <= RELAY_SEND_HIGH_WATER) return resolve(true);
const started = Date.now();
const poll = window.setInterval(() => {
if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN
|| Date.now() - started > TRANSFER_STALL_TIMEOUT_MS) {
window.clearInterval(poll);
resolve(Boolean(chatState.ws?.readyState === WebSocket.OPEN));
return;
}
if (chatState.ws.bufferedAmount <= RELAY_SEND_LOW_WATER) {
window.clearInterval(poll);
resolve(true);
}
}, 40);
});
}
/* Sends one blob to one session as `file-start` plus N `file-chunk` messages.
   Returns true when every piece was handed off — to the channel or, if the
   channel is not there, to the relay. The route is re-decided per chunk, so a
   connection that drops halfway through finishes over the relay instead of
   leaving the message on "sending" forever.
   A live file-start is also an offer: above FILE_GATE_MIN_BYTES the recipient
   answers file-accept / file-decline before any chunk moves, so the quota they
   set (or a declination) decides whether the upload happens at all. */
async function sendBlobChunks(blob, { session, peerRecord, transferId, startMessage, createdAt, onProgress, scope = '' }) {
  if (!session?.cryptoKey) return false;
  const totalChunks = Math.max(1, Math.ceil(blob.size / FILE_CHUNK_BYTES));
  let startWentLive = false;
  const deliver = async (build, onLive = null) => {
    if (session.connection?.open) {
      await awaitChannelDrain(session.connection);
      if (session.connection?.open && safeConnectionSend(session.connection, build(true), 'file')) {
        if (onLive) onLive();
        return true;
      }
    }
    if (!peerRecord) return false;
    /* Paced, not blasted: the relay socket has a buffer of its own, and the
       browser holds whatever it is handed faster than the network drains. */
    if (!await waitForRelaySocketDrain()) return false;
    /* Across relays the bottleneck is the link between them, not this
       socket: only a window of chunks may be unanswered at once, so a slow
       border paces the upload instead of refusing hundreds of chunks. */
    const farRelay = transitRouteFor(peerRecord);
    if (farRelay && typeof awaitTransitWindow === 'function' && !await awaitTransitWindow(farRelay.id)) return false;
    const message = build(false);
    return sendSealedRelay(peerRecord, session, message, {
      createdAt: message.createdAt || createdAt,
      messageClass: 'media',
      /* The start of a transfer rings; its chunks do not. */
      notify: message.type === 'file-start',
      scope,
      /* Each chunk is named, so a refused one is matched and sent again. */
      relayTag: message.type === 'file-chunk' ? `${transferId}-c${message.index}` : '',
    });
  };
  const started = await deliver(() => ({ ...startMessage, v: 2, totalChunks, chunkBytes: FILE_CHUNK_BYTES }), () => { startWentLive = true; });
  if (!started) return false;
  /* Kept so a receiver that ends up with a gap can ask for those chunks again.
     The blob costs nothing to hold — it is a handle to the file on disk. The
     message id rides along so the banner can find this transfer to cancel it. */
  chatState.outgoingFiles.set(transferId, { blob, session, peerRecord, messageId: startMessage.messageId || '' });
  if (startWentLive && blob.size >= FILE_GATE_MIN_BYTES) {
    const consent = await waitForTransferConsent(transferId, session, blob.size, startMessage);
    if (consent !== 'accepted') {
      chatState.outgoingFiles.delete(transferId);
      const declined = consent === 'declined';
      /* The callers read this to keep their own failure wording honest: a
         refused transfer has already been explained to the user here. */
      chatState.transferRefusalReason = { transferId, declined, at: Date.now() };
      notify(declined
        ? t(`گیرنده «${startMessage.name || 'فایل'}» را رد کرد؛ آپلود لغو شد.`, `The recipient declined "${startMessage.name || 'the file'}"; the upload was cancelled.`)
        : t('در مهلت مقرر پاسخی از گیرنده نرسید؛ ارسال لغو شد.', 'No answer arrived from the recipient in time; the transfer was cancelled.'), 'warning');
      const senderKey = peerRecord ? getConversationKey(peerRecord) : session?.conversationId || '';
      if (senderKey) {
        appendHistory(senderKey, {
          id: `file-refused-${transferId}`,
          type: 'system-note',
          direction: 'out',
          text: declined
            ? t(`گیرنده «${startMessage.name || 'فایل'}» را رد کرد؛ دانلود و آپلود دو طرف لغو شد.`, `The recipient declined "${startMessage.name || 'the file'}"; both directions of the transfer were cancelled.`)
            : t('پاسخی از گیرنده نرسید؛ ارسال لغو شد.', 'No answer arrived from the recipient; the transfer was cancelled.'),
          createdAt: new Date().toISOString(),
        });
      }
      return false;
    }
  }
  let sent = 0;
  /* The loop used to run bare: one exception — a file handle the picker had
     already revoked, a key renegotiated mid-transfer — left the caller's
     banner stuck at its last percentage for ever, because the failure path
     that clears it only ran on a clean false. Nothing here may throw past
     the transfer's own accounting. */
  try {
  for (let index = 0; index < totalChunks; index += 1) {
    /* A decline can land mid-upload too — the moment the recipient refuses,
     the upload stops rather than filling their channel with bytes they asked
     not to receive. */
    if (chatState.outgoingFiles.get(transferId)?.aborted) {
      chatState.outgoingFiles.delete(transferId);
      chatState.transferRefusalReason = { transferId, declined: true, at: Date.now() };
      setTransferBanner(t('گیرنده فایل را رد کرد', 'The recipient declined the file'), 100, { owner: `send:${startMessage.messageId || transferId}` });
      clearTransferBanner(700, `send:${startMessage.messageId || transferId}`);
      return false;
    }
    const slice = blob.slice(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES);
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const iv = app().generateSecureRandomBytes(12);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.cryptoKey, bytes);
    const ivArray = Array.from(iv);
    const ok = await deliver((binary) => (binary
      ? { type: 'file-chunk', transferId, index, iv: ivArray, bin: new Uint8Array(cipher) }
      : { type: 'file-chunk', transferId, index, iv: ivArray, chunk: app().arrayBufferToBase64(cipher) }));
    if (!ok) {
      chatState.outgoingFiles.delete(transferId);
      return false;
    }
    sent += slice.size;
    onProgress?.(sent, blob.size);
  }
  } catch (error) {
    console.warn('[Chat] the upload stopped on an error:', error);
    chatState.outgoingFiles.delete(transferId);
    return false;
  }
  /* The window starts once the last chunk is out, not when the first was: a
     450 MB transfer takes longer than the window itself. */
  window.setTimeout(() => chatState.outgoingFiles.delete(transferId), TRANSFER_STALL_TIMEOUT_MS * 5);
  return true;
}
/* The sender's own way out. A decline stops an upload; this is the same flag
   from this side — the banner is one tap, rather than a reload. */
function cancelOutgoingTransfer(transferId) {
const entry = transferId ? chatState.outgoingFiles.get(transferId) : null;
if (!entry) return false;
entry.aborted = true;
return true;
}
/* Waits for the recipient's answer to a live file-start. 'accepted' lets the
   chunks flow; anything else cancels the upload before it begins. The banner
   tells the sender why their screen went quiet for a moment. */
function waitForTransferConsent(transferId, session, size, startMessage) {
  return new Promise((resolve) => {
    setTransferBanner(t('در انتظار تأیید گیرنده…', 'Waiting for the recipient to accept…'), 0, { owner: `send:${startMessage.messageId || transferId}` });
    const settle = (answer) => {
      const entry = chatState.transferConsentWaiters.get(transferId);
      if (!entry) return;
      chatState.transferConsentWaiters.delete(transferId);
      window.clearTimeout(entry.timer);
      resolve(answer);
    };
    chatState.transferConsentWaiters.set(transferId, {
      resolve: settle,
      timer: window.setTimeout(() => settle('timeout'), TRANSFER_CONSENT_TIMEOUT_MS),
    });
  });
}
// Where each state sits in the delivery lifecycle. Receipts genuinely arrive
// out of order — the read receipt is emitted by the render pass, which runs
// before the arrival handler gets to send its 'delivered' — so a message that
// has been read must not be walked back to merely delivered.
/* The ladder itself lives in 01-constants.js; this name is kept because the
   call sites below read better with it. */
const statusRank = chatStatusRank;
function markMessageStatus(conversationId, messageId, status) {
if (!conversationId || !messageId) return;
const entry = (chatState.history[conversationId] || []).find((item) => item.id === messageId);
if (!entry) return;
// A failure is always worth reporting; anything else may only move forward.
if (status !== 'failed' && statusRank(status) < statusRank(entry.status)) return;
let needsFullRender = false;
// If message is being delivered and has a timer but no expiry yet, start it now.
if ((status === 'delivered' || status === 'seen' || status === 'sent') && entry.direction === 'out' && entry.timerSeconds > 0 && !entry.expiresAt) {
entry.expiresAt = new Date(Date.now() + entry.timerSeconds * 1000).toISOString();
needsFullRender = true;
}
entry.status = status;
storeHistory();
const statusEl = document.querySelector(`[data-chat-message-status="${CSS.escape(messageId)}"]`);
if (statusEl && getConversationKey(getActiveConversation()) === conversationId && !needsFullRender) {
const meta = statusMeta(status);
statusEl.textContent = meta.label;
statusEl.className = `chat-msg-status ${meta.cls}`;
statusEl.title = meta.title;
} else {
renderMessages();
}
renderPeers();
scheduleExpirySweep();
}
function deleteMessageEntry(conversationId, messageId, { broadcast = false, peerRecord = null } = {}) {
if (!conversationId || !messageId) return;
const current = chatState.history[conversationId] || [];
const next = current.filter((item) => item.id !== messageId);
if (next.length === current.length) return;
chatState.history[conversationId] = next;
dropMessageMedia(messageId);
storeHistory();
renderPeers();
renderMessages();
if (broadcast) {
const targetPeer = peerRecord || findPeerByConversationKey(conversationId) || activePeer();
relaySessionEvent(targetPeer, {
type: 'delete',
messageId,
createdAt: new Date().toISOString(),
});
}
}
/* Everything one conversation or one group leaves behind.
 *
 * deleteActiveConversation() does this for whatever is on screen, behind a
 * question; the lockout does it with no question for a conversation that is
 * not the open one; a sibling device does it when this account deleted the
 * conversation on another machine. The work lives here once, because a second
 * copy of a deletion routine is how a wipe ends up leaving the session keys
 * behind.
 *
 * Local, always: nothing here is sent to the other person and nothing of theirs
 * changes. What goes is everything this device holds about the conversation —
 * the messages, the files, the drafts, the session keys on disk and the live
 * session in memory with its open channel, the call log with them, the
 * conversation's lock, its unread mark, a live location still being shared.
 *
 *   contact: 'keep'   the default for "delete conversation": the person stays a
 *                     contact — accepted, blocked or muted as before, verified
 *                     as before — and the empty conversation leaves the list
 *                     until something new arrives. Deleting a conversation used
 *                     to delete the contact too, which quietly turned them into
 *                     a stranger: their calls stopped ringing, their receipts
 *                     stopped, and a blocked person was unblocked.
 *   contact: 'remove' the person goes as well, with what belongs to them alone
 *                     (the verified mark, the TURN and path memory). A block
 *                     outlives them on the block list.
 *   group:   'keep'   the history goes and the membership stays;
 *   group:   'leave'  the history goes and this account leaves the group;
 *   group:   'remove' the group goes from this device without a word (the
 *                     lockout: there is nobody to ask).
 *
 * The default is the lockout's, the most thorough.
 */
function purgeConversationEverywhere(conversationId, { contact = 'remove', group = 'remove', fromSibling = false, before = '' } = {}) {
  /* A deletion made on another device of this account reaches this one later,
     and what arrived here after that moment was not part of what was deleted. */
  const beforeMs = before ? (Date.parse(before) || 0) : 0;
  const entryTime = (entry) => Date.parse(entry?.createdAt || entry?.timestamp || 0) || 0;
  const groups = chatState.spaces?.groups || [];
  const groupIndex = groups.findIndex((space) => space.conversationId === conversationId);
  const isGroup = groupIndex >= 0;
  const space = isGroup ? groups[groupIndex] : null;

  /* Every name this conversation answers to.
   *
   * A conversation is reachable by its id, its peer id, its fingerprint and the
   * key getConversationKey() builds, and different parts of the app hold
   * different ones. Matching on a single field found the history and missed the
   * contact and the session key — a wipe that leaves the session key behind has
   * not wiped anything, because the ciphertext already sent is still readable
   * with it. So every identifier is collected first and everything holding any
   * of them goes. */
  const names = new Set([conversationId]);
  const records = isGroup ? [] : chatState.peers.filter((p) => {
    const key = (() => { try { return getConversationKey(p); } catch (error) { return ''; } })();
    return key === conversationId
      || p.conversationId === conversationId
      || p.peerId === conversationId
      || p.clientId === conversationId
      || p.fingerprint === conversationId;
  });
  records.forEach((p) => {
    [p.peerId, p.clientId, p.fingerprint, p.conversationId, p.trustedFingerprint].forEach((n) => { if (n) names.add(n); });
    try { const key = getConversationKey(p); if (key) names.add(key); } catch (error) { /* unkeyed */ }
  });

  /* The live session first: its key is in memory and its channel is open, and
     a deleted conversation must not go on being readable — or writable — over
     either until the app happens to be restarted. */
  for (const [sessionKey, session] of Array.from(chatState.sessions || [])) {
    const owned = [sessionKey, session?.peerId, session?.remoteFingerprint, session?.conversationId].some((n) => n && names.has(n));
    if (!owned) continue;
    try { session.connection?.close?.(); } catch (error) { /* already gone */ }
    if (session) { session.cryptoKey = null; session.connection = null; }
    chatState.sessions.delete(sessionKey);
  }
  /* A live location still going to them stops here, without a last word:
     nothing about this deletion is announced to the other side. */
  if (typeof stopLiveSharesFor === 'function') stopLiveSharesFor(names);

  names.forEach((name) => {
    if (beforeMs && Array.isArray(chatState.history[name])) {
      const kept = [];
      for (const entry of chatState.history[name]) {
        if (entryTime(entry) > beforeMs) kept.push(entry);
        else if (entry?.id) { try { dropMessageMedia(entry.id); } catch (error) { /* nothing stored */ } }
      }
      if (kept.length) chatState.history[name] = kept;
      else delete chatState.history[name];
    } else {
      delete chatState.history[name];
      try { dropConversationMedia(name); } catch (error) { /* nothing stored */ }
    }
    try { if (chatState.drafts) delete chatState.drafts[name]; } catch (error) { /* no drafts */ }
    try { if (chatState.manualUnread) delete chatState.manualUnread[name]; } catch (error) { /* no flags */ }
    /* The session key under every name it might be filed under. */
    if (chatState.sessionKeys && chatState.sessionKeys[name] !== undefined) {
      delete chatState.sessionKeys[name];
    }
    try { if (typeof dropConversationLockRecord === 'function') dropConversationLockRecord(name); } catch (error) { /* no lock */ }
  });
  try { saveChatDrafts(); } catch (error) { /* nothing to persist to */ }
  /* The call log with them is part of what was said. */
  const callsBefore = (chatState.calls || []).length;
  chatState.calls = (chatState.calls || []).filter((call) => ![call?.peerId, call?.fingerprint, call?.conversationId, call?.spaceId]
    .some((n) => n && names.has(n)) || (beforeMs && entryTime(call) > beforeMs));
  if (chatState.calls.length !== callsBefore) {
    try { saveCalls(); } catch (error) { /* nothing to persist to */ }
  }
  /* Frames still waiting for an answer about this conversation. */
  for (const [tag, pending] of Array.from(chatState.pendingRelayTags || [])) {
    if (pending && names.has(pending.conversationKey)) chatState.pendingRelayTags.delete(tag);
  }
  for (const [tag, pending] of Array.from(chatState.pendingTransit || [])) {
    if (pending && names.has(pending.peerId)) chatState.pendingTransit.delete(tag);
  }

  if (isGroup) {
    if (group === 'leave' && typeof leaveSpace === 'function') {
      leaveSpace(space);
    } else if (group === 'remove') {
      groups.splice(groupIndex, 1);
      saveSpaces();
    }
  }
  if (records.length) {
    if (contact === 'keep') {
      /* Still a contact, no longer a conversation: off the list until there is
         something in it again, and not pinned or archived in the meantime. */
      const clearedAt = new Date().toISOString();
      records.forEach((p) => {
        p.chatClearedAt = clearedAt;
        p.pinned = false;
        p.pinOrder = 0;
        p.archived = false;
      });
    } else {
      records.forEach((p) => {
        /* A block is this account's decision about a person, not part of the
           conversation, so it outlives the contact. */
        if (p.blocked && typeof rememberBlocked === 'function') rememberBlocked(p);
        [p.fingerprint, p.trustedFingerprint].forEach((fp) => {
          if (fp && typeof isPeerVerified === 'function' && isPeerVerified(fp)) setPeerVerified(fp, false);
        });
        const index = chatState.peers.indexOf(p);
        if (index >= 0) chatState.peers.splice(index, 1);
      });
      /* What this device learnt about reaching them. */
      let prefsChanged = false;
      ['turnChoices', 'pathChoices'].forEach((field) => {
        const memory = chatState.prefs?.[field];
        if (!memory || typeof memory !== 'object') return;
        names.forEach((name) => {
          if (memory[name] !== undefined) { delete memory[name]; prefsChanged = true; }
        });
      });
      if (prefsChanged) {
        try { saveChatPrefs(); } catch (error) { /* nothing to persist to */ }
      }
    }
    saveContacts();
  }
  try { saveEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, chatState.sessionKeys); }
  catch (error) { /* nothing to persist to */ }

  storeHistory({ immediate: true });
  /* Remembered as gone, so a sibling's next sync does not bring the old
     messages back — and told to those siblings, unless that is where the
     deletion came from. */
  const deletion = {
    names: Array.from(names),
    contact: isGroup ? 'keep' : contact,
    group: isGroup ? group : '',
    deletedAt: before || new Date().toISOString(),
  };
  if (typeof noteConversationDeleted === 'function') {
    noteConversationDeleted(deletion, { announce: !fromSibling }).catch((error) => console.warn('[Chat] noting a deletion failed:', error));
  }
  if (names.has(chatState.activeConversationId) || names.has(chatState.activePeerClientId)) {
    chatState.activePeerClientId = '';
    chatState.activeConversationId = '';
    chatState.activeReactionMessageId = '';
    try { clearMessageContext(); } catch (error) { /* nothing open */ }
  }
  try { updateChatShellMode(); } catch (error) { /* not mounted */ }
  try { renderPeers(); renderActivePeer(); renderMessages(); } catch (error) { /* not mounted */ }
  return isGroup ? 'group' : 'conversation';
}

async function deleteActiveConversation() {
const conversation = getActiveConversation();
if (!conversation) return;
const key = getConversationKey(conversation);
const isGroup = conversation.type === 'group';
const label = conversation.username || conversation.name || conversation.peerId || key;
/* PoorijaDialogs, not window.confirm: the native desktop shell has no window
   dialogs, so confirm() there returns false without showing anything. The
   question says what goes and what does not: the conversation, on every
   device of this account; nothing on the other person's side. */
const choice = isGroup
? await PoorijaDialogs.choose(
t(`تاریخچهٔ گروه «${label}» از همهٔ دستگاه‌های شما پاک شود؟ برای بقیهٔ اعضا چیزی پاک نمی‌شود.`,
  `Delete the history of "${label}" from all your devices? Nothing is deleted for the other members.`),
[
{ value: 'keep', label: t('فقط پاک کردن تاریخچه', 'Delete only the history') },
{ value: 'leave', label: t('پاک کردن تاریخچه و خروج از گروه', 'Delete the history and leave the group') },
],
{ cancelLabel: t('انصراف', 'Cancel'), danger: true })
: await PoorijaDialogs.choose(
t(`گفتگوی «${label}» از همهٔ دستگاه‌های شما پاک شود؟ پیام‌ها، فایل‌ها، تماس‌ها و کلیدهای این گفتگو حذف می‌شوند؛ برای «${label}» چیزی پاک نمی‌شود و خبری هم به او نمی‌رسد.`,
  `Delete the conversation with "${label}" from all your devices? Its messages, files, calls and keys go; nothing is deleted for "${label}", and they are not told.`),
[
{ value: 'keep', label: t('فقط حذف گفتگو', 'Delete only the conversation') },
{ value: 'remove', label: t('حذف گفتگو و مخاطب', 'Delete the conversation and the contact') },
],
{ cancelLabel: t('انصراف', 'Cancel'), danger: true });
if (!choice) return;
purgeConversationEverywhere(conversation.conversationId || key, isGroup ? { group: choice } : { contact: choice });
notify(isGroup
? (choice === 'leave' ? t('تاریخچه پاک شد و از گروه خارج شدید.', 'History deleted, and you left the group.') : t('تاریخچه گروه حذف شد.', 'Group history deleted.'))
: (choice === 'remove' ? t('گفتگو و مخاطب حذف شدند.', 'Conversation and contact deleted.') : t('گفتگو حذف شد.', 'Conversation deleted.')), 'success');
}
// Arrival now acks 'delivered' and nothing more. Read is a separate question:
// the old test was `activeTab === 'chat' && !document.hidden`, which claimed a
// message was read while the user was looking at someone else's conversation,
// and never claimed it at all for anything that arrived in the background.
// Sends the read receipts owed for whatever is currently on screen. Runs after
// every render, so a message that arrived while the app was backgrounded still
// turns blue for the sender the moment its conversation is opened.
let lastSeenFlushAt = 0;
const SEEN_RECEIPT_BURST_LIMIT = 20;
function flushSeenReceipts() {
if (document.hidden || appState()?.activeTab !== 'chat') return;
/* "Seen" is a claim that a person read the words. Under the app's lock
   screen, behind the Secure Chat gate, or behind this conversation's own
   padlock nobody has read anything — sending the receipt anyway told the
   sender ✓✓ for words nobody saw, which is the one lie a lock must never
   tell. Arrival already sent its honest 'delivered'. */
if (appState()?.isLocked) return;
if (typeof chatLockEnabled === 'function' && chatLockEnabled() && !chatState.chatUnlocked) return;
const peer = getActiveConversation();
if (!peer?.peerId) return;
if (typeof conversationLocked === 'function' && conversationLocked(peer.conversationId || getConversationKey(peer))) return;
/* A message request gets no read receipt until it is accepted; the receipts
   stay pending and go out then. */
if (typeof isMessageRequest === 'function' && isMessageRequest(peer)) return;
// renderMessages() runs on almost every state change; without this the same
// pass could fire repeatedly within a frame.
const now = Date.now();
if (now - lastSeenFlushAt < 400) return;
lastSeenFlushAt = now;
const key = getConversationKey(peer);
const pending = (chatState.history[key] || [])
.filter((entry) => entry && entry.direction === 'in' && entry.id && !entry.seenAckSent);
if (!pending.length) return;
const session = chatState.sessions.get(peer.peerId);
// Every message already in history predates this field, so the first render
// after an update would otherwise fire one receipt per stored message — a
// burst big enough to flood the relay and take the session down with it.
// Acknowledge the tail and quietly settle the rest.
if (pending.length > SEEN_RECEIPT_BURST_LIMIT) {
pending.slice(0, pending.length - SEEN_RECEIPT_BURST_LIMIT)
.forEach((entry) => { entry.seenAckSent = true; });
}
pending.slice(-SEEN_RECEIPT_BURST_LIMIT).forEach((entry) => {
/* seenAckSent is the "never send this again" bit, so it is only set when the
   receipt actually went out. A failed send leaves it clear and the next
   render pass tries again — the sender's ✓✓ must not depend on luck. */
const sent = session
? sendDeliveryAck(session, entry.id, 'seen')
: (!receiptsEnabled() || relaySessionEvent(peer, {
type: 'receipt',
messageId: entry.id,
status: 'seen',
createdAt: new Date().toISOString(),
}));
if (sent) entry.seenAckSent = true;
});
storeHistory();
}
/* How long a 'delivered' receipt waits before it goes.
 *
 * The attack receiptsEnabled() describes works on the reply being IMMEDIATE
 * and guaranteed: arrival and answer land close enough together to be paired
 * by an observer who can read neither. A few seconds of jitter does not
 * defeat somebody watching both ends — nothing here does, and the design says
 * so plainly — but it stops the pairing being free.
 *
 * Only on 'delivered'. A 'seen' receipt already waits for a render pass that
 * checks visibility and burst-limits, so its timing is loose already, and its
 * caller reads the return value to decide whether to try again — which a
 * delayed send cannot answer honestly. */
const DELIVERED_RECEIPT_JITTER_MS = 4000;
function sendDeliveryAck(session, messageId, status) {
if (!session || !messageId) return false;
/* Turned off means the automatic reply does not happen, not that it happens
   and is hidden — see receiptsEnabled(). Answered as "sent", so the caller
   marks it done and does not retry on every render. */
if (!receiptsEnabled()) return true;
const payload = {
type: 'receipt',
messageId,
status,
createdAt: new Date().toISOString(),
};
const put = () => {
/* Re-checked at the moment of sending: the switch may have been turned off
   while this was waiting, and a receipt that goes out after that would make
   the setting a lie. */
if (!receiptsEnabled()) return false;
if (session.connection?.open) {
return safeConnectionSend(session.connection, payload, 'delivery-ack');
}
const peerRecord = findPeerBySession(session);
if (peerRecord) return relaySessionEvent(peerRecord, payload);
return false;
};
if (status === 'delivered') {
setTimeout(put, Math.floor(Math.random() * DELIVERED_RECEIPT_JITTER_MS));
return true;
}
return put();
}
function safeConnectionSend(connection, payload, context = 'data') {
if (!connection?.open) return false;
try {
/* Small frames are rounded to fixed sizes (51-envelope-privacy.js), so a
   TURN server or anybody on the path sees a few sizes instead of lengths. */
connection.send(typeof padLiveFrame === 'function' ? padLiveFrame(payload) : payload);
return true;
} catch (error) {
console.warn(`Chat ${context} send failed:`, error);
return false;
}
}
/* The offline counterpart of sendRelayEnvelope: encrypts `message` under a
   throwaway key wrapped to the recipient, then queues it. Returns false when
   the recipient's public key is unknown, which is the one case where an
   offline send genuinely cannot be made. */
async function sendSealedRelay(peerRecord, session, message, { createdAt, messageClass = 'text', notify, scope = '', relayTag: explicitTag = '' } = {}) {
if (!peerRecord) return false;
/* The body is already ciphertext — the send paths encrypt with the session
   key before they get here. All this adds is that key, wrapped to the
   recipient, so they can open it without ever having negotiated with us.
   When we have no public key for them the envelope goes out unsealed, which
   still works for a peer whose stored session key they kept. */
/* Prekey first: it is the only one of the two that expires.
   The envelope gets a key of its OWN, not the session's. Sealing the session
   key to the prekey would have achieved nothing — the recipient still holds
   that session key on disk and would open the body with it directly, prekey or
   no prekey. A throwaway key that exists nowhere else is what makes the
   fifteen-day window real: when the prekey goes, the only copy of this
   envelope's key goes with it.
   The RSA seal stays as the fallback for a peer whose build predates prekeys. */
let kex = null;
let envelopeKey = null;
if (peerRecord?.prekeyPublic) {
try {
envelopeKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const rawKey = await crypto.subtle.exportKey('raw', envelopeKey);
kex = await sealWithPrekey(peerRecord, rawKey);
if (!kex) envelopeKey = null;
} catch (error) {
console.warn('[Chat] could not build a prekey envelope; falling back:', error);
envelopeKey = null;
kex = null;
}
}
const seal = kex ? '' : await sealSessionKeyFor(session, peerRecord).catch(() => '');
/* Where to write back, inside whichever seal is used.
 *
 * Without it a reply can only be sent by somebody who already holds the
 * sender's card, so two people who met through one person's code could talk in
 * one direction and not the other. It rides INSIDE the seal rather than on the
 * envelope, so no relay on the way can read it or write it.
 *
 * It used to ride only in the prekey envelope, and that is precisely the one
 * that a cross-relay contact never gets: the prekey travels with presence, in
 * the hello frame, and a relay broadcasts its own clients and nobody else's. So
 * for the only pair of people who actually need a return route, there was never
 * one -- messages went one way, and the receipts, the files and the calls that
 * all route the same way went nowhere at all.
 *
 * Not on media. A file is a stream of chunks, each its own sealed envelope, so
 * repeating this on all of them would add a few hundred bytes per chunk -- most
 * of a megabyte on a large file -- to say the same thing thousands of times.
 * Every ordinary message carries it, which includes the text that goes with a
 * file. */
const returnRoute = messageClass === 'media' ? undefined : myHomeRelay();
/* Encrypt the envelope's own contents, not just what is inside it. With no
   seal there is no key to do it with, and the message then travels the way it
   always did rather than not at all. */
let body = null;
if (kex && envelopeKey) {
try {
/* The envelope also carries the key its *contents* were encrypted under.
 *
 * Everything in `message` was already encrypted with the session key before
 * it got here, and the receiver opens an envelope by installing whatever key
 * the seal gave it. Those two only agree while the session key has not moved,
 * which is precisely what forward secrecy makes it do - so a message queued
 * for somebody who then restarted came back as OperationError and stayed in
 * the mailbox forever.
 *
 * Putting the session key *inside* the encrypted envelope costs nothing: it
 * is reachable only through the throwaway key, which is reachable only
 * through the prekey. When the prekey goes at fifteen days, this goes with
 * it, exactly as before. */
let sessionKeyRaw = '';
if (session?.cryptoKey) {
try {
sessionKeyRaw = app().arrayBufferToBase64(await crypto.subtle.exportKey('raw', session.cryptoKey));
} catch (_error) {
sessionKeyRaw = '';
}
}
const iv = app().generateSecureRandomBytes(12);
/* What the return route cannot do is prove who sent it; see the trust
   ladder in 18-file-manager-2.js for what that means and why a card wins. */
const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, envelopeKey,
/* Padded to a fixed size and carrying what this build can read
   (51-envelope-privacy.js): the length says nothing, and the capability
   arrives under the sender's own signature. */
new TextEncoder().encode(paddedEnvelopeJson({ message, sessionKeyRaw, homeRelay: returnRoute, caps: localEnvelopeCaps() })));
body = { iv: Array.from(iv), cipher: app().arrayBufferToBase64(cipher), v: 2 };
} catch (error) {
console.warn('[Chat] could not encrypt under the envelope key; falling back', error);
body = null;
kex = null;
}
}
if (!body && seal && session?.cryptoKey) {
try {
/* The same wrapper the prekey path uses, and marked v2 for the same reason:
   the receiver decides by the shape and the version, and a build that predates
   the return route reads this correctly as well -- it takes the v2 branch,
   finds no sessionKeyRaw, and the guard on that is already an `if`. What it
   does not do is carry the session key, because on this path the body is
   encrypted with the session key itself; enclosing it would be telling
   somebody who already has it. */
body = await encryptForSession(session,
new TextEncoder().encode(paddedEnvelopeJson({
message,
homeRelay: returnRoute,
/* A per-sender counter, inside the authenticated body: a relay that
   replays an envelope it once carried hands back a number the receiver
   has already seen, and ordering games become visible instead of free. */
seq: session.sendSeq = (session.sendSeq || 0) + 1,
caps: localEnvelopeCaps(),
})));
body.v = 2;
} catch (error) {
console.warn('[Chat] could not seal the envelope metadata; sending it plainly', error);
body = null;
}
}
/* Media is a stream of chunks; only the first of them is worth a notification,
   and the caller says which one that is. */
const wakesTheDevice = notify === undefined ? messageClass !== 'media' : notify;
const envelope = offlineEnvelope(message, {
createdAt, seal, messageClass, body, kex, notify: wakesTheDevice, scope,
});
/* The sealed body hides the message id from the relay, so the tag it echoes
   in queued/error frames has to ride on the envelope itself. */
/* A file chunk has no message id of its own; its caller names it, so a
   refusal for one chunk can be matched to that chunk and the chunk sent
   again instead of leaving a hole in the file. */
const relayTag = sanitizeRemoteId(explicitTag || message?.id || message?.messageId || '');
if (relayTag) envelope.tag = relayTag;
/* Sealed sender (51-envelope-privacy.js): only with a sealed body to borrow
   the key from, and only toward a build that reads it. The recipient is
   named in what gets signed, so this envelope cannot be re-sealed to anybody
   else and pass as written to them. */
const sealSender = Boolean(body) && Boolean(peerRecord.fingerprint)
&& typeof sealEnvelopeSender === 'function' && peerSupports(peerRecord, 'ss1');
if (sealSender) envelope.to = peerRecord.fingerprint;
/* The sender's key vouches for the sender's name. Best effort: an old
   receiver ignores the field, and a first contact has no pin to check
   against yet. */
await signOfflineEnvelope(envelope);
if (sealSender) {
try {
await sealEnvelopeSender(envelope, kex ? envelopeKey : session.cryptoKey, {
ephemeral: EPHEMERAL_RELAY_TYPES.has(String(message?.type || '')),
});
} catch (error) {
console.warn('[Chat] could not seal the sender; it travels named:', error);
}
}
return sendRelayEnvelope(peerRecord, envelope);
}
function paddedEnvelopeJson(object) {
return typeof paddedJson === 'function' ? paddedJson(object) : JSON.stringify(object);
}
function localEnvelopeCaps() {
return typeof LOCAL_CAPS !== 'undefined' ? LOCAL_CAPS.slice() : [];
}
/* Everything the hello frame carries, sent to somebody the hello frame cannot
   reach.
 *
 * A relay turns hello into its presence broadcast, and that broadcast is how a
 * contact learns your display name, your photograph, your mood, your public key
 * and your prekey. A relay broadcasts its own clients and nobody else's, so a
 * contact on another relay received none of it: no picture, no name changes, and
 * -- the expensive one -- no prekey, which is what the forward-secret envelope is
 * built from.
 *
 * The requirement is that two people on two relays notice no difference from two
 * people on one, so the same facts travel the same distance by another road: a
 * relay payload, sealed to their relay, carried by ours.
 *
 * What it is NOT is proof. A relay payload is not signed, exactly as a hello is
 * not signed, so the name and the picture are worth what they are worth on one
 * relay too -- and the KEY goes through mergePeerRecord, which pins on first
 * sight and holds a differing one as pending rather than replacing it. Nothing
 * here can quietly change who you are talking to. */
const PROFILE_CARD_MIN_MS = 60000;
const profileCardSentAt = new Map();

/* The prekey is NOT in here, and that is the point of this comment.
 *
 * It was, for one deployment, because the prekey rides the hello frame with
 * everything else this card carries. The result was that cross-relay messages
 * stopped arriving at all: with a prekey in hand the sender builds the
 * forward-secret envelope instead of the RSA-sealed one, and when the recipient
 * cannot open that envelope the code does the careful thing -- says nothing,
 * acknowledges nothing, and leaves it queued for redelivery, on the reasoning
 * that a recent envelope failing to open is usually something local and
 * temporary. Across relays it was neither: every message went into that queue
 * and none of them ever came out, silently.
 *
 * A prekey is only safe to act on when its freshness is guaranteed, which is
 * what presence gives it on one relay and what an unsigned relay payload cannot
 * give it across two. So this card carries the things whose worst case is a
 * stale display name, and the RSA seal -- which has no window and cannot go
 * stale -- keeps carrying the messages. */
function myProfileCard(askForTheirs = false) {
  return {
    type: 'profile-card',
    /* Which save of the profile this is. A card older than the one already
       kept is ignored, so a late one cannot put back an old photograph. */
    version: String(chatState.profile.updatedAt || ''),
    /* Named the way the presence record names them, so the receiving side can
       hand the whole thing to mergePeerRecord untouched. */
    username: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
    avatarData: chatState.profile.avatarData || '',
    mood: String(chatState.profile.mood || '').slice(0, 40),
    publicKeyData: chatState.identity?.publicKeyData || '',
    fingerprint: chatState.identity?.fingerprint || '',
    peerId: chatState.peerId || chatState.profile.stablePeerId || '',
    homeRelay: myHomeRelay(),
    /* One round trip, not a conversation: the first card asks for one back, the
       reply does not ask again. */
    pleaseReply: askForTheirs === true,
    createdAt: new Date().toISOString(),
  };
}

/* Who this account's photograph, name and status go to on a card: the people
 * it chose. The relay lists everybody connected to it, and every one of them
 * becomes a record here — that is how the online list is built — so sending
 * the card to "every peer who is here" sent the photograph to every stranger
 * on the relay, which is exactly what keeping avatars out of the presence
 * table was meant to stop. A contact, somebody this account has written to,
 * a member of a shared group, or the conversation open right now; never a
 * message request this account has not answered, and never a blocked one. */
function isProfileAudience(peer) {
  if (!peer || peer.type || peer.system || peer.blocked) return false;
  if (typeof isSelfPeerRecord === 'function' && isSelfPeerRecord(peer)) return false;
  if (typeof isMessageRequest === 'function' && isMessageRequest(peer)) return false;
  if (chatState.activeConversationId && chatState.activeConversationId === getConversationKey(peer)) return true;
  return typeof isStoredContact === 'function'
    ? isStoredContact(peer)
    : Boolean(peer.manual || peer.accepted || peer.pinned || peer.groupMember);
}

/* The bytes a card's owner vouches for. Everything a receiver acts on is in
 * them: whose card it is, who it is for, the name, the status, the whole
 * photograph and the version. Signed with the identity key, the same as an
 * offline envelope, so a card can only change what a contact looks like on
 * this device if that contact wrote it. Before, a card naming somebody's
 * fingerprint was believed whoever sent it: anybody on the relay could give
 * a contact another face and another name. */
function profileCardSignBytes(card) {
  return new TextEncoder().encode([
    'profile-card/1',
    String(card?.fingerprint || ''),
    String(card?.peerId || ''),
    String(card?.to || ''),
    String(card?.username || ''),
    String(card?.mood || ''),
    String(card?.avatarData || ''),
    String(card?.version || ''),
    String(card?.createdAt || ''),
  ].join('\n'));
}
async function signProfileCard(card) {
  try {
    const key = await importIdentitySigningKey();
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, profileCardSignBytes(card));
    card.sig = app().arrayBufferToBase64(signature);
    card.sigv = 1;
  } catch (error) {
    /* Unsigned still travels; a receiver that has this account's key pinned
       will not let it change anything, which is the safe way round. */
    console.warn('[Chat] could not sign the profile card:', error);
  }
  return card;
}

function sendProfileCard(peerRecord, { askForTheirs = false, force = false, viaRoute = null } = {}) {
  if (!peerRecord?.fingerprint && !peerRecord?.clientId) return false;
  if (!isProfileAudience(peerRecord)) return false;
  const known = transitRouteFor(peerRecord);
  /* viaRoute is for the REPLY, and only for the reply.
   *
   * Somebody answering a card on a first contact has nothing routable for the
   * person who sent it -- that is the whole reason they were sent a card -- so
   * without this the exchange is one-sided and the photograph only ever travels
   * in the direction that already worked. The route comes out of the card being
   * answered and is used once, for that answer; it is never written onto the
   * record, because a relay payload is not signed and the trust ladder exists to
   * stop an unproved claim becoming durable. What a forged one would receive is a
   * display name, a photograph and a prekey -- the same things the card says to
   * anybody who asks. */
  /* Unless the road it names is this device's own relay: a card asking for
     ours from somebody on the same relay names that relay as its home, and
     the answer was sealed to it as transit — to the relay it was already
     on, which does not carry to itself — and never arrived. That was a new
     conversation on one server opening without the other person's photograph. */
  const ownRelay = typeof relayPinFor === 'function' ? (relayPinFor(chatServerOrigin())?.id || '') : '';
  const reply = viaRoute && !(ownRelay && viaRoute.id === ownRelay) ? viaRoute : null;
  const route = known || reply;
  /* A contact on THIS relay is somebody to reach too. The presence table
     stopped carrying avatars (it says who is here, not what they look like),
     which made the card the only carrier of a photograph — and this guard
     used to refuse the card for exactly the people this relay CAN deliver
     to, so a changed avatar reached nobody who already had one at all. Any
     identified record goes on below; sendRelayEnvelope picks the transit leg
     by itself when the contact lives elsewhere. */
  if (!route && !peerRecord?.clientId && !peerRecord?.fingerprint) return false;
  const key = peerRecord.fingerprint || peerRecord.clientId;
  const last = profileCardSentAt.get(key) || 0;
  if (!force && Date.now() - last < PROFILE_CARD_MIN_MS) return false;
  profileCardSentAt.set(key, Date.now());
  const card = myProfileCard(askForTheirs);
  card.to = String(peerRecord.fingerprint || '');
  /* Signing is asynchronous and the callers want an answer now; what they
     are told is that the card has been taken on, the promise every send
     path here makes. */
  signProfileCard(card).then(() => {
    if (known || !route) {
      sendRelayEnvelope(peerRecord, card);
      return;
    }
    sendViaTransit({
      type: 'relay',
      toClientId: peerRecord.clientId || '',
      toFingerprint: peerRecord.fingerprint || '',
      payload: card,
      persist: false,
    }, route, peerRecord);
  });
  return true;
}

/* One that arrived. Merged the same way a presence record is, so the photograph,
   the name and the prekey land where every part of the interface already looks
   for them -- and the key lands through the same pinning. Status is deliberately
   NOT touched: whether they are there is answered by their relay, not claimed by
   them.

   Before any of it is believed, the card has to be the named contact's own:
   - a relay that vouches for the sender (this relay, for somebody connected to
     it) must vouch for the fingerprint the card names;
   - the key it presents must be the one that fingerprint is the hash of;
   - a signature must verify against the key pinned for that contact, or for a
     first contact against the key presented — a bad one drops the card;
   - an unsigned card that nobody vouches for changes nothing about a contact
     whose key is pinned (an older build, over transit), and is believed for a
     first contact only, the way a hello is.
   The card is also the profile's own word on it, so an empty photograph or an
   empty status means "removed" rather than "not said" — unless an older card
   arrives after a newer one, in which case it changes nothing. */
async function noteProfileCard(payload, peerRecord, { relayFingerprint = '' } = {}) {
  if (!payload || typeof payload !== 'object') return;
  const claimed = String(payload.fingerprint || '');
  if (!/^[a-f0-9]{16,128}$/i.test(claimed)) return;
  const mine = String(chatState.identity?.fingerprint || '');
  if (claimed === mine) return;
  if (payload.to && mine && payload.to !== mine) return;
  if (relayFingerprint && relayFingerprint !== claimed) return;
  const presentedKey = String(payload.publicKeyData || '');
  if (presentedKey) {
    let computed = '';
    try { computed = await sha256Hex(app().base64ToArrayBuffer(presentedKey)); } catch (_error) { computed = ''; }
    if (computed !== claimed) return;
  }
  const record = (chatState.peers || []).find((peer) => (
    !peer.type && (peer.fingerprint === claimed || peer.trustedFingerprint === claimed)
  )) || null;
  const pinnedKey = String(record?.trustedKey || record?.publicKeyData || '');
  let signed = false;
  if (payload.sig) {
    const key = pinnedKey || presentedKey;
    if (!key) return;
    try {
      signed = await verifyIdentitySignature(key, app().base64ToArrayBuffer(String(payload.sig)), profileCardSignBytes(payload));
    } catch (_error) {
      signed = false;
    }
    if (!signed) return;
  }
  const attested = Boolean(relayFingerprint) && relayFingerprint === claimed;
  const believed = signed || attested || !pinnedKey;
  const version = String(payload.version || '').slice(0, 40);
  const stale = Boolean(version && record?.profileVersion && version < record.profileVersion);
  const takeProfile = believed && !stale;
  const avatarData = String(payload.avatarData || '');
  const mood = String(payload.mood || '').slice(0, 40);
  const merged = mergePeerRecord({
    peerId: payload.peerId || peerRecord?.peerId || '',
    clientId: peerRecord?.clientId || payload.peerId || '',
    username: takeProfile ? (payload.username || peerRecord?.username || '') : '',
    publicKeyData: presentedKey || peerRecord?.publicKeyData || '',
    fingerprint: claimed,
    avatarData: takeProfile ? avatarData : '',
    mood: takeProfile ? mood : '',
    /* Deliberately no prekey. One arriving here is ignored rather than stored:
       acting on a prekey whose freshness nothing guarantees is what silently
       swallowed every cross-relay message. */
    homeRelay: payload.homeRelay || peerRecord?.homeRelay || null,
    /* The claim came through a relay and nothing about it is proved, so it is
       filed at the bottom of the ladder. If a session already raised this to
       something routable, betterHomeRelay keeps that. */
    homeRelaySource: 'presence',
    status: peerRecord?.status || 'offline',
  }, { online: false, profile: takeProfile ? { avatarData, mood } : null });
  if (merged && takeProfile && version) merged.profileVersion = version;
  saveContacts();
  renderPeers?.();
  renderActivePeer?.();
  /* Answer once, so the two sides end up knowing the same amount -- and answer it
     down the road the card itself named, since on a first contact there is no
     other. normalizeHomeRelay is what decides the claim is even shaped like a
     route; it returns null for anything that is not. Only somebody this account
     shares its profile with is answered: asking is not a way for a stranger to
     collect photographs. */
  if (payload.pleaseReply && merged && believed && isProfileAudience(merged)) {
    const replyRoute = typeof normalizeHomeRelay === 'function'
      ? normalizeHomeRelay(payload.homeRelay, 'session')
      : null;
    sendProfileCard(merged, { askForTheirs: false, force: true, viaRoute: replyRoute });
  }
}

/* Their card, asked for when it is missing.
 *
 * Opening a conversation is the moment a missing photograph is noticed. The
 * relay's presence table never carries one, and a contact's own device only
 * pushes its card to the people it shares its profile with, so a conversation
 * this account has just started showed initials until the other side happened
 * to save their profile again. Asking hands over this account's card too, with
 * pleaseReply; the other side answers if this account is somebody it shares
 * its profile with. Once per contact until a card with a version has come
 * back, and never more than every few minutes. */
const PROFILE_ASK_MIN_MS = 5 * 60 * 1000;
/* The conversation somebody is looking at asks sooner: that is where a
   missing photograph is noticed, and an answer lost on the way should not
   leave it missing for five minutes. */
const PROFILE_ASK_OPEN_MS = 30 * 1000;
const profileAskedAt = new Map();
function askForProfileIfMissing(peer, { minMs = PROFILE_ASK_MIN_MS } = {}) {
  if (!peer || peer.type || peer.system) return false;
  if (peer.profileVersion) return false;
  if (!isProfileAudience(peer)) return false;
  if (typeof peerLooksOnline === 'function' && !peerLooksOnline(peer)) return false;
  const key = getConversationKey(peer);
  if (!key) return false;
  const last = profileAskedAt.get(key) || 0;
  if (Date.now() - last < minMs) return false;
  profileAskedAt.set(key, Date.now());
  return sendProfileCard(peer, { askForTheirs: true, force: true });
}

/* Asking the other relay whether somebody is there.
 *
 * Presence is per relay: a relay hands every one of ITS clients to every other
 * one, and knows nothing about anybody else's. So a contact on another relay
 * was shown offline for ever -- not because they were, but because nobody had
 * asked. The application read that as knowledge and acted on it, which is how a
 * cross-relay call rang for thirty seconds and logged itself as missed while
 * the other person sat looking at it.
 *
 * The question goes the way a message goes: sealed to THEIR relay, carried by
 * ours, which cannot read it. The far relay answers for that one fingerprint.
 * Nothing new is given away — the relay that answers already sees that
 * fingerprint every time a message is carried to it, and asking requires
 * holding the fingerprint, which means holding the card.
 *
 * Asked when a conversation is opened and then on a slow timer while it stays
 * open. Not on a global sweep: polling every contact on every relay, for ever,
 * would say far more about who talks to whom than any single answer does. */
/* How often the same contact may be asked about.
 *
 * Twelve seconds, not twenty-five. The relay this device is connected to pushes
 * its own presence the instant it changes, so a contact on it turns green with
 * no delay at all; a contact elsewhere only changes when we ask, and at
 * twenty-five seconds plus a thirty-second timer somebody could be gone for the
 * better part of a minute while the interface still said they were there. The
 * cost is one small sealed frame per contact in view per twelve seconds, which
 * is the same order as the typing indicator. */
const PRESENCE_ASK_MIN_MS = 12000;

/* At most this many contacts are asked about in one sweep of the list.
 *
 * A sweep is bounded because it is the one thing here that scales with the
 * address book: asking about everybody, for ever, tells the far relay far more
 * about who this person knows than any single answer does. The ones in view are
 * the ones that matter, and the list is already ordered with them first. */
const PRESENCE_SWEEP_MAX = 12;
const presenceAsked = new Map();

function askIfPeerIsThere(peerRecord, { force = false } = {}) {
  const home = transitRouteFor(peerRecord);
  if (!home) return false;
  const fingerprint = String(peerRecord?.fingerprint || '');
  if (!fingerprint) return false;
  const last = presenceAsked.get(fingerprint) || 0;
  if (!force && Date.now() - last < PRESENCE_ASK_MIN_MS) return false;
  presenceAsked.set(fingerprint, Date.now());
  keepAskingAboutTheOpenConversation();
  /* And hand them ours, asking for theirs, when something is missing. Opening a
     conversation is the moment a missing photograph is noticed, so it is the
     moment to fix it — but only for somebody who can answer. A card to an
     absent contact is a queued envelope with the whole avatar inside, and
     this runs on the presence loop: one a minute, for a person who cannot
     reply until they return, is a thousand-odd envelopes a day landing in
     their mailbox and evicting the mail that was real. Their presence
     answer is what says they are there; the card follows it. */
  askForProfileIfMissing(peerRecord);
  /* And ours, whenever it changed since this contact last heard it — the
     presence question is already the once-every-twelve-seconds moment this
     contact is thought about, which is cheap enough to piggyback the
     "here is what I look like now" on. */
  announceProfileCardIfStale(peerRecord);
  const tag = `presence-${fingerprint.slice(0, 12)}-${Date.now().toString(36)}`;
  sendViaTransit({ type: 'presence-query', toFingerprint: fingerprint, tag }, home, peerRecord);
  return true;
}

/* Everybody the list is currently showing, asked about together.
 *
 * Until this existed the question was only asked from renderActivePeer, so a
 * contact on another relay stayed grey until their conversation was opened --
 * which on a phone means the list is wrong every time the application starts.
 * The answer was always available; nobody had asked for it.
 *
 * Throttled per contact by askIfPeerIsThere and capped per sweep, so a long
 * address book costs the same as a short one. */
function askAboutTheVisibleContacts() {
  const peers = Array.isArray(chatState.peers) ? chatState.peers : [];
  let asked = 0;
  for (const peer of peers) {
    if (asked >= PRESENCE_SWEEP_MAX) break;
    if (!peer || peer.type) continue;
    /* Only conversations the list actually shows: a group member this device
       has never written to, or an archived chat, is nobody to keep asking
       a far relay about every twelve seconds. */
    if (peer.archived || (typeof shouldShowConversation === 'function' && !shouldShowConversation(peer))) continue;
    if (!transitRouteFor(peer)) continue;
    if (askIfPeerIsThere(peer)) asked += 1;
  }
  return asked;
}

/* A conversation that stays open is asked about again, slowly.
 *
 * One interval for the whole application, started the first time it is needed
 * and asking only about the conversation that is open. A sweep over every
 * contact on every relay would say far more about who talks to whom than any
 * single answer does, and it would say it continuously. */
let presenceTimer = null;
function keepAskingAboutTheOpenConversation() {
  if (presenceTimer) return;
  presenceTimer = setInterval(() => {
    const peer = typeof getActiveConversation === 'function' ? getActiveConversation() : null;
    if (peer && !peer.type) askIfPeerIsThere(peer);
    /* And the list behind it, so closing a conversation does not freeze every
       other contact at whatever they were when it was opened. */
    askAboutTheVisibleContacts();
  }, PRESENCE_ASK_MIN_MS);
  presenceTimer.unref?.();
}

/* Everybody who can be told that this profile changed, told in the way that
 * reaches them — which since the presence table dropped avatars is the card,
 * for contacts on this relay exactly as much as for contacts on another.
 *
 * The `force` in announceProfileCardIfStale is because a profile change is the
 * one moment the send-throttle is wrong: the throttle exists to stop a card
 * being re-sent for no reason, and this is the reason. It asks for nothing
 * back -- the other side already has whatever it needs from us, and a reply
 * would turn one save into a round trip per contact. */
/* Which profile version each conversation was last told about. In memory on
   purpose: a fresh session may fairly re-tell, because a contact who was
   replaced by a reinstall never says so. */
const profileCardVersionSent = new Map();
function announceProfileCardIfStale(peerRecord) {
if (!peerRecord || peerRecord.type || peerRecord.system) return false;
const conversationKey = getConversationKey(peerRecord);
const version = String(chatState.profile?.updatedAt || '');
if (!conversationKey || !version) return false;
/* Never queue a card for somebody absent: cards are persist:false by design
   (a photograph is not mail), and a card into an empty room is traffic for
   nothing. Their presence is what says the room is occupied — and when it
   later does, this is called again and the version still disagrees. */
if (typeof peerLooksOnline === 'function' && !peerLooksOnline(peerRecord)) return false;
/* Only to the people this profile is shared with — not the strangers the
   relay lists beside them. */
if (!isProfileAudience(peerRecord)) return false;
if (profileCardVersionSent.get(conversationKey) === version) return false;
profileCardVersionSent.set(conversationKey, version);
return sendProfileCard(peerRecord, { askForTheirs: false, force: true });
}
function announceProfileToContacts() {
  for (const peer of chatState.peers || []) {
    if (peer?.type) continue;
    announceProfileCardIfStale(peer);
  }
}

/* Whether this contact's presence is somebody else's relay to answer.
 *
 * Used by the peers broadcast, which marks everybody it did not mention offline.
 * A relay lists its own clients and nobody else's, so doing that to a contact
 * elsewhere made the status flicker -- and flicker towards offline, because the
 * broadcast arrives far more often than the question is asked. */
function presenceAnsweredElsewhere(peer) {
  return Boolean(peer && typeof transitRouteFor === 'function' && transitRouteFor(peer));
}

/* What came back, kept OUT of `status`.
 *
 * This looked like the same fact presence carries and it is not. In this
 * application `status` does not mean "they are there", it means "you can reach
 * them from here": scheduleSessionWarmup opens a direct PeerJS data channel the
 * moment a contact reads online, and every path that prefers the direct route
 * over the relay asks the same field. Writing the far relay's answer into it
 * told the application it could dial a PeerJS id that only exists on the other
 * server -- so the moment cross-relay presence started working, cross-relay
 * MESSAGES stopped, which is a bad trade for a coloured dot.
 *
 * It lives in its own field. Whoever draws the dot reads it; nothing that routes
 * does. remotePresenceOf is the one place that decides, so there is one answer
 * rather than nine. */
const REMOTE_PRESENCE_STALE_MS = 120000;

function notePeerPresenceAnswer(fingerprint, up) {
  const peer = chatState.peers.find((record) => record.fingerprint === fingerprint);
  if (!peer) return;
  /* Somebody on another relay being rung while away has just come back:
     their relay said so, which is the only way this side can know. Checked
     before anything else, because an unchanged answer returns early below. */
  if (up && chatState.offlineRing?.peerId === peer.peerId && typeof offlineRingPeerArrived === 'function') {
    peer.remotePresence = 'online';
    peer.remotePresenceAt = Date.now();
    offlineRingPeerArrived(peer);
  }
  const next = up ? 'online' : 'offline';
  if (peer.remotePresence === next && peer.remotePresenceAt) {
    peer.remotePresenceAt = Date.now();
    return;
  }
  peer.remotePresence = next;
  peer.remotePresenceAt = Date.now();
  renderPeers?.();
  renderActivePeer?.();
}

/* Whether to show this contact as being there, and where that belief came from.
 *
 * A contact on this relay is answered by this relay's own presence, which is
 * authoritative and constant. A contact elsewhere is answered by their relay,
 * and that answer goes stale: if nothing has come back for two minutes the
 * honest thing is to stop claiming they are there. */
function remotePresenceOf(peer) {
  if (!peer || peer.type) return null;
  if (!peer.remotePresence || !peer.remotePresenceAt) return null;
  if (Date.now() - peer.remotePresenceAt > REMOTE_PRESENCE_STALE_MS) return null;
  return peer.remotePresence;
}

/* The one question every dot, every sort and every label should ask. */
function peerLooksOnline(peer) {
  const remote = remotePresenceOf(peer);
  if (remote) return remote === 'online';
  return peer?.status === 'online';
}

/* The sender said where to reach them. Written straight onto the record
   through the ladder rather than through mergePeerRecord: a partial record
   run through the merge would carry blocked, muted and archived as false and
   quietly clear all three. */
function noteSenderHomeRelay(payload, homeRelay) {
const fingerprint = String(payload?.fromFingerprint || '');
const peerId = String(payload?.fromPeerId || '');
const peer = chatState.peers.find((record) => (fingerprint && record.fingerprint === fingerprint)
|| (peerId && record.peerId === peerId));
if (!peer) return;
const next = betterHomeRelay(peer.homeRelay, { ...homeRelay, source: 'session' });
if (!next) return;
/* Compared field by field rather than as JSON: betterHomeRelay hands back a
   NORMALISED copy even when it kept what was already there, which differs
   from the stored object by key order and by a filled-in timestamp. Writing
   on that would save the contact book on every message that changed
   nothing. */
const same = (left, right) => Boolean(left) && Boolean(right)
&& left.origin === right.origin && left.id === right.id
&& left.key === right.key && left.source === right.source;
if (same(next, peer.homeRelay)) return;
const wasRoutable = typeof routableHomeRelay === 'function' ? Boolean(routableHomeRelay(peer)) : true;
peer.homeRelay = next;
saveContacts();
/* The first route this contact has ever had: whatever was written to them
   before it was known may be sitting at a relay they never visit. */
if (!wasRoutable && routableHomeRelay(peer) && typeof noteRouteBecameRoutable === 'function') {
  noteRouteBecameRoutable(peer);
}
}
/* Signals that only mean something in the moment. Storing them is pointless —
   nobody wants to be told, on returning, that someone was typing an hour ago —
   and asking the relay to store them is what made it wake the other device for
   every keystroke burst. The relay enforces this too; this is the client half
   so an up-to-date app never even asks. */
/* Everything about a call that is meaningless once the moment passes.
 *
 * A call frame that is STORED is a call that rings again later. It happened: two
 * people on different relays finished a call, one of them reconnected, and the
 * relay redelivered the offer from its mailbox -- so the phone rang with nothing
 * behind it. Declining logged a missed call that never happened; answering
 * produced a call with no sound, because the description it was built from had
 * been dead for minutes.
 *
 * call-invite is deliberately NOT here: it is the one call frame that is worth
 * keeping, because it is what rings somebody who was away and it carries its own
 * staleness check on arrival. */
const EPHEMERAL_RELAY_TYPES = new Set([
  'typing', 'receipt', 'ping', 'pong', 'relay-ack', 'call-reaction', 'call-busy',
  'call-relay-offer', 'call-relay-answer', 'call-relay-ice', 'call-relay-end',
  'call-ice', 'call-renegotiate', 'call-renegotiate-answer', 'call-accepted', 'call-path-relay',
  /* A cross-relay data link negotiates like a relay call (40-relay-link.js):
     an offer or a candidate is worth nothing a minute later. */
  'link-relay-offer', 'link-relay-answer', 'link-relay-ice', 'link-relay-end',
  /* The group-call verbs carry the same staleness the 1:1 ones do — a stored
     mute-toggle rings nobody and means nothing minutes later — and a group
     call running for an hour emits them continuously. Every one of them used
     to be persisted and pushed, so an offline member's device was woken once
     per reaction per participant, and their mailbox filled with frames whose
     moment had passed until the retention sweep pushed real mail back out.
     gcall-invite stays out for the same reason call-invite does: it is the
     one that rings somebody who was away. */
  'gcall-here', 'gcall-join', 'gcall-leave', 'gcall-react', 'gcall-state',
  /* Device sync is a snapshot, not a letter: whatever device was away
     collects the history from the next sync, so a mailbox copy would only
     be dead weight a sweep would eventually have to carry away. */
  'device-sync',
]);
function sendRelayEnvelope(peerRecord, payload) {
if (hasActiveServerRestriction()) {
notifyRestrictionOnce();
return false;
}
if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN || !peerRecord) return false;
if (!peerRecord.fingerprint && !peerRecord.clientId) return false;
/* The server echoes this tag back in its queued/error frames, so the send
   can be tied to the history entry it belongs to. Ephemeral events (receipts,
   typing) are never persisted, so there is nothing for an echo to report and
   they are left out. Old servers never echo the tag — harmless either way. */
/* A sealed-sender envelope keeps its inner type in the box and says only
   whether it is worth keeping (eph). */
const persist = payload?.eph !== 1 && !EPHEMERAL_RELAY_TYPES.has(String(payload?.inner || payload?.type || ''));
const tag = persist ? sanitizeRemoteId(payload?.tag || payload?.id || payload?.messageId || '') : '';
if (tag) {
chatState.pendingRelayTags.set(tag, { conversationKey: getConversationKey(peerRecord), messageId: tag });
/* Bounded, oldest first: a map that only grew would remember every message
   of the session for no reader. */
while (chatState.pendingRelayTags.size > 500) {
chatState.pendingRelayTags.delete(chatState.pendingRelayTags.keys().next().value);
}
}
const frame = {
type: 'relay',
toClientId: peerRecord.clientId || '',
toFingerprint: peerRecord.fingerprint || '',
payload,
...(tag ? { tag } : {}),
/* An envelope is judged by what it carries, not by the word on the outside:
   every one of them says 'offline-chat', so asking the outer name whether it
   was worth keeping kept the receipts and typing flags too. */
persist,
};
/* Somebody whose relay is not this one cannot be reached by handing this to
   the relay: it has never heard of them. The frame above is sealed to THEIR
   relay instead and this one carries it without being able to open it —
   which is the point, because the relay that can see who a message is for is
   the relay that can assemble who talks to whom. */
const home = transitRouteFor(peerRecord);
if (home) {
/* Sealing is asynchronous and every caller of this function expects an
   answer now. What is returned is "this has been taken on", the same
   promise the direct path makes: the relay's own reply arrives later as a
   queued or error frame either way. */
sendViaTransit(frame, home, peerRecord);
return true;
}
chatState.ws.send(JSON.stringify(frame));
return true;
}
/* The relay a contact's messages have to end up at, when that is not the one
   this device is connected to. Null means the ordinary path.
 *
 * routableHomeRelay is the part that decides whether the claim is worth
 * acting on at all -- a hello is not an address; see 18-file-manager-2.js. */
function transitRouteFor(peerRecord) {
/* The person's own switch. Off means: route everything through the relay I am
   connected to, even for contacts whose home relay is elsewhere — a decision
   about metadata they are entitled to make, taken once in Settings →
   Connection & TURN. Default is on, which is the arrangement the two-relay
   privacy design exists for. The typeof guard keeps the function honest when
   it is lifted out of the page and driven standalone, which the transit
   suite does to test the routing decisions against a real relay. */
if (typeof chatState !== 'undefined' && chatState?.profile?.crossRelayComm === false) return null;
const home = typeof routableHomeRelay === 'function' ? routableHomeRelay(peerRecord) : null;
if (!home) return null;
const mine = relayPinFor(chatServerOrigin())?.id || '';
/* Without a pinned id for the relay in hand there is nothing to compare, and
   guessing wrong sends a message the long way round for no reason. */
if (!mine || home.id === mine) return null;
return home;
}
/* Kept only long enough for the relay to answer. A refusal has to be able to
   find the frame it was about, and nothing else reads this. */
function rememberTransit(tag, frame, peerRecord) {
if (!tag) return;
chatState.pendingTransit = chatState.pendingTransit || new Map();
chatState.pendingTransit.set(tag, { frame, peerId: peerRecord?.peerId || '' });
while (chatState.pendingTransit.size > 200) {
chatState.pendingTransit.delete(chatState.pendingTransit.keys().next().value);
}
}
/* Sealing can fail on this device (a key that does not hash to the route's
   relay id, a socket that is mid-reconnect), so it is tried three times,
   briefly spaced. What the CARRIER says about an envelope — accepted, busy,
   unavailable — is a different matter, answered later by tag; the outbox in
   40-route-finder.js keeps a tagged envelope queued and sends it again until
   it is accepted, rather than failing it on the first refusal. */
const TRANSIT_SEND_ATTEMPTS = 3;
async function sendViaTransit(frame, home, peerRecord, { retry = false } = {}) {
const chunkTag = frame.tag || frame.payload?.tag || '';
/* Questions (presence, route, turn) are answered by tag and never retried:
   a late answer to a question is worth nothing. */
const isQuestion = String(frame.type || '').endsWith('-query');
/* Only what the far relay will KEEP is worth carrying again: a call offer, a
   candidate or a typing flag is marked persist:false and means nothing late. */
const retryable = !isQuestion && frame.persist !== false && Boolean(chunkTag);
if (retryable && typeof trackTransitSend === 'function') {
  trackTransitSend(chunkTag, frame, peerRecord, home);
}
for (let attempt = 0; attempt < TRANSIT_SEND_ATTEMPTS; attempt += 1) {
  if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
  try {
    const envelope = await sealTransitEnvelope(home.id, home.key, frame);
    if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) {
      if (attempt < TRANSIT_SEND_ATTEMPTS - 1) continue;
      throw new Error('the relay went away');
    }
    chatState.ws.send(JSON.stringify({ ...envelope, ...(chunkTag ? { tag: chunkTag } : {}) }));
    return true; /* sent */
  } catch (error) {
    if (attempt === TRANSIT_SEND_ATTEMPTS - 1) {
      console.warn(`[Transit] could not hand the envelope over after ${TRANSIT_SEND_ATTEMPTS} attempts:`, error?.message || error);
      /* A tagged envelope stays in the outbox and is tried again later; an
         untagged one (a typing flag, a candidate) is simply dropped, as it
         always was worth nothing late. */
      if (retryable && typeof transitSendRefused === 'function') {
        transitSendRefused(chunkTag, 'transit-unavailable');
      }
      return false;
    }
  }
}
return false;
}
/* Going direct when transit was meant to be used is a real change in who can
   see what, so it is never silent. Once per conversation per session: a note
   on every message would be noise, and noise is how a warning stops being
   read. */
function fallBackToDirect(frame, peerRecord, reason = '') {
/* Only an ordinary relay frame can go through this relay at all; a question
   meant for another relay (route, presence, TURN) means nothing here. */
if (!frame || frame.type !== 'relay') return;
/* A contact whose home relay is elsewhere is never sent through this one: it
   would sit in a mailbox they never open. The outbox has already kept the
   envelope queued and will carry it when the link is back. */
const peerHome = typeof routableHomeRelay === 'function' ? routableHomeRelay(peerRecord) : null;
const anyHome = peerRecord?.homeRelay?.id ? peerRecord.homeRelay : null;
const knownFarRelay = (peerHome || anyHome);
const myPin = typeof relayPinFor === 'function' ? (relayPinFor(chatServerOrigin())?.id || '') : '';
if (knownFarRelay && myPin && knownFarRelay.id !== myPin) return;
let sent = false;
if (chatState.ws?.readyState === WebSocket.OPEN) {
try { chatState.ws.send(JSON.stringify(frame)); sent = true; } catch (_error) { sent = false; }
}
if (!sent) return;
const conversationId = peerRecord ? getConversationKey(peerRecord) : '';
if (!conversationId) return;
/* Find the history entry this frame belongs to and set its flag. The tag on
   the frame is the message id the sender used; without one there is nothing
   to mark, and a system frame that carries no message has no icon to earn. */
const messageId = String(frame?.payload?.tag || frame?.tag || frame?.payload?.id || frame?.payload?.messageId || '');
if (!messageId) return;
const history = chatState.history[conversationId] || [];
const entry = history.find((item) => item.id === messageId);
if (entry) {
entry.transitFallback = true;
storeHistory();
/* Only the visible thread needs the icon — the flag lives in storage. */
if (chatState.activeConversationId === conversationId) renderMessages();
}
}
function relaySessionEvent(peerRecord, message) {
if (!peerRecord || !message) return false;
const session = chatState.sessions.get(peerRecord.peerId);
if (session?.connection?.open) {
return safeConnectionSend(session.connection, message, 'session-event');
}
/* Sealed when it can be: a receipt, an edit or a reaction said in the clear
   told the relay what kind of thing passed and from whom. The prekey gives an
   envelope key of its own, and anything that carries ciphertext travels with
   the session key it was written under, so the far side opens it as before.
   Without a prekey — an old contact — it goes the way it always went. */
if (peerRecord.prekeyPublic && (session?.cryptoKey || !message.payload)) {
sendSealedRelay(peerRecord, session || null, message, {
createdAt: message.createdAt || new Date().toISOString(),
notify: false,
}).catch((error) => console.warn('[Chat] a sealed session event could not be sent:', error));
return true;
}
return sendSignedPlainEnvelope(peerRecord, message);
}
/* An envelope with no seal, signed even so: one naming a pinned contact is
   accepted unsigned only for receipts and typing, so anything else has to
   carry the key's word. */
function sendSignedPlainEnvelope(peerRecord, message) {
const plainEnvelope = offlineEnvelope(message, {
createdAt: message.createdAt || new Date().toISOString(),
});
signOfflineEnvelope(plainEnvelope)
.then(() => sendRelayEnvelope(peerRecord, plainEnvelope))
.catch(() => sendRelayEnvelope(peerRecord, plainEnvelope));
return Boolean(chatState.ws && chatState.ws.readyState === WebSocket.OPEN);
}
function waitForSessionReady(peerRecord, timeoutMs = SESSION_READY_TIMEOUT_MS) {
return new Promise((resolve) => {
const startedAt = Date.now();
const tick = () => {
const session = peerRecord ? chatState.sessions.get(peerRecord.peerId) : null;
if (session?.cryptoKey) {
resolve(session);
return;
}
if (Date.now() - startedAt >= timeoutMs) {
resolve(session || null);
return;
}
setTimeout(tick, 150);
};
tick();
});
}
function waitForDirectConnection(peerRecord, timeoutMs = SESSION_READY_TIMEOUT_MS) {
return new Promise((resolve) => {
const startedAt = Date.now();
const tick = () => {
const session = peerRecord ? chatState.sessions.get(peerRecord.peerId) : null;
if (session?.connection?.open) {
resolve(session);
return;
}
if (Date.now() - startedAt >= timeoutMs) {
resolve(session || null);
return;
}
setTimeout(tick, 150);
};
tick();
});
}
async function ensureStoredSession(peerRecord) {
if (!peerRecord?.peerId) return null;
let session = chatState.sessions.get(peerRecord.peerId) || null;
if (!session) {
session = {
peerId: peerRecord.peerId,
remoteClientId: peerRecord.clientId || '',
remoteFingerprint: peerRecord.fingerprint || '',
remotePublicKeyData: peerRecord.publicKeyData || '',
conversationId: getConversationKey(peerRecord),
connection: null,
};
chatState.sessions.set(peerRecord.peerId, session);
} else {
session.remoteClientId = peerRecord.clientId || session.remoteClientId || '';
session.remoteFingerprint = peerRecord.fingerprint || session.remoteFingerprint || '';
session.remotePublicKeyData = peerRecord.publicKeyData || session.remotePublicKeyData || '';
session.conversationId = getConversationKey(peerRecord) || session.conversationId || '';
}
await hydrateSessionKey(session);
return session;
}
async function ensureDirectSession(peerRecord, { silent = false } = {}) {
if (!peerRecord) return null;
let session = await ensureStoredSession(peerRecord);
if (session?.cryptoKey) return session;
/* A contact on another relay always reads 'offline' in the raw field —
   presence is per relay. Their own relay's answer is what says whether they
   are there; when it says so, a live channel is worth trying before falling
   back to a sealed envelope. */
const crossRelayAndThere = typeof sessionNeedsRelayLink === 'function' && sessionNeedsRelayLink(peerRecord)
  && typeof peerLooksOnline === 'function' && peerLooksOnline(peerRecord);
if (crossRelayAndThere) {
  await startSecureSession(peerRecord, { silent });
  session = await waitForSessionReady(peerRecord, 8000);
  if (session?.cryptoKey) return session;
  session = await ensureStoredSession(peerRecord);
  await prepareOfflineSession(session, peerRecord);
  return session;
}
if (peerRecord.status === 'offline') {
/* This used to return a session with no key, and every caller then bailed
   with "the secure session is not ready" — which is why a message to an
   offline contact was never sent and never queued. There is nothing to
   negotiate with someone who is not there, so mint a key locally instead:
   the envelope will carry it, wrapped to their public key. */
await prepareOfflineSession(session, peerRecord);
return session;
}
/* Not when somebody pressed Disconnect: a session being warmed up in the
   background is not a reason to go back online behind their back, which is
   exactly what this did a few seconds after every Disconnect. */
if ((!chatState.peer || !chatState.connected) && !chatState.manualOffline) {
await connectChatTransport();
}
if (chatState.manualOffline) {
await prepareOfflineSession(session, peerRecord);
return session;
}
session = await ensureStoredSession(peerRecord);
if (session?.cryptoKey) return session;
await startSecureSession(peerRecord, { silent });
session = await waitForSessionReady(peerRecord);
return session;
}
async function handleOfflineRelayMessage(message) {
let payload = message.payload || {};
try {
/* A sealed-sender envelope names nobody on the outside. The box opens with
   the key that opens the body; what is inside goes back where it always was,
   and everything below reads the envelope it always read. A box that will not
   open is treated exactly like a body that will not open. */
if (payload.ss === 1) {
const opened = typeof openSealedSender === 'function' ? await openSealedSender(payload) : null;
if (!opened) {
const ageMs = Date.now() - Date.parse(message.queuedAt || '');
if (payload.kex && ageMs > 24 * 60 * 60 * 1000) return true;
chatState.unopenedEnvelopes = (chatState.unopenedEnvelopes || 0) + 1;
return false;
}
payload = opened;
message = { ...message, payload };
}
const fromId = payload.fromPeerId || message.fromFingerprint || message.fromClientId;
let session = chatState.sessions.get(fromId);
if (!session) {
session = {
peerId: fromId,
/* The relay's word when it has one; for a sealed sender only the signed
   claim inside the box exists, and the signature check below is what it
   rests on. */
remoteFingerprint: message.fromFingerprint || (payload.ss === 1 ? String(payload.fromFingerprint || '') : ''),
};
	chatState.sessions.set(fromId, session);
	}
	/* Who this claims to be, vouched for — or not — by the key that name is
	   pinned to. Checked before anything is opened: the signature covers the
	   sealed body and the claim, neither of which needs decrypting first. A
	   verdict of forged means a pinned key disagrees with what arrived, and
	   the envelope is acknowledged away rather than rendered: it can never
	   become genuine by being redelivered. */
	const senderVerdict = await verifyOfflineEnvelopeSender(payload, fromId, { relayFingerprint: String(message.fromFingerprint || '') });
	if (senderVerdict === 'forged') {
	chatState.forgedEnvelopes = (chatState.forgedEnvelopes || 0) + 1;
	console.warn(`[Chat] an envelope arrived claiming to be ${fromId} whose signature the pinned key refuses`);
	if (chatState.forgedEnvelopes === 1) {
	notify(t(
	'پیامی رسید که خودش را یک مخاطب جا زده و امضایش رد شد؛ نادیده گرفته شد.',
	'A message arrived posing as a contact and its signature was refused; it was ignored.',
	), 'warning');
	}
	return true;
	}
	/* A sealed envelope keeps its contents in `body`; only the seal opens it, and
   only the recipient's private key opens the seal. `message` is the older,
   plaintext shape — still read so anything already queued keeps working. */
let innerMessage = payload.message;
let enclosedSessionKeyRaw = '';
/* The sender's return route, kept until after the message is handled: on a
   first contact the record it belongs on does not exist until then. */
let openedHomeRelay = null;
if (!innerMessage && payload.body) {
/* Two ways in: the prekey the sender wrote to, or the older RSA seal. A
   prekey that has expired is gone from this device, and then the envelope
   cannot be opened by anybody — which is the point of the window, not a
   failure to work around. */
const key = payload.kex
? await openPrekeySeal(payload.kex).catch(() => null)
: await openOfflineSeal(payload.seal).catch(() => null);
	if (!key) {
	const envelopeAgeMs = Date.now() - Date.parse(payload.createdAt || message.queuedAt || '');
	if (payload.kex && envelopeAgeMs > 24 * 60 * 60 * 1000) {
	console.warn('[Chat] an envelope arrived whose prekey window has closed; it can no longer be opened.');
	noteExpiredEnvelope(session, payload);
	} else {
	/* A RECENT envelope that will not open is not "expired" — that note is a
	   promise about fifteen days, and minutes-old mail failing to open meant
	   something local could not read its own prekeys (a locked vault once did
	   exactly that). Destroying it here is irreversible, so instead: say
	   nothing, ACK NOTHING, and leave it in the mailbox — it is redelivered on
	   the next connect, by which time whatever was unreadable usually is not. */
	/* Counted, and said out loud once it stops looking temporary.
	 *
	 * "Leave it queued and say nothing" is right for an envelope that fails once
	 * because something local was not ready. It is wrong for one that will never
	 * open, and the two are indistinguishable from here -- so the count is what
	 * tells them apart. A message that has failed to open five times is not a
	 * hiccup, and a person who is told nothing concludes the application is
	 * working and the other person is not writing. */
	chatState.unopenedEnvelopes = (chatState.unopenedEnvelopes || 0) + 1;
	console.warn('[Chat] a recent sealed envelope could not be opened yet; leaving it queued for redelivery.'
	  + ` (${chatState.unopenedEnvelopes} so far)`);
	if (chatState.unopenedEnvelopes === 5 && !chatState.unopenedEnvelopesTold) {
	chatState.unopenedEnvelopesTold = true;
	notify(t(
	'چند پیام رسیده که باز نمی‌شوند. اگر ادامه داشت، یک بار برنامه را ببندید و باز کنید.',
	'Several messages have arrived that cannot be opened. If it continues, close and reopen the app once.',
	), 'warning');
	}
	}
	/* Genuinely stale envelopes stay acknowledged — the relay redelivering
	   them forever, to a device that can never open them, served nobody. */
	if (payload.kex && envelopeAgeMs > 24 * 60 * 60 * 1000) return true;
	return false;
	}
try {
const plain = await crypto.subtle.decrypt(
{ name: 'AES-GCM', iv: new Uint8Array(payload.body.iv || []) },
key,
app().base64ToArrayBuffer(payload.body.cipher),
);
const opened = JSON.parse(new TextDecoder().decode(plain));
/* v2 envelopes wrap the message together with the key its contents were
   encrypted under; v1 held the message alone. */
	if (payload.body.v === 2 && opened && typeof opened === 'object' && 'message' in opened) {
	/* The counter travels inside the authenticated body, so the relay cannot
	   subtract from it or reset it. A number the session has already passed is
	   a replay of something already rendered — dropped and acknowledged,
	   because redelivery will not make it newer. */
	if (typeof opened.seq === 'number' && Number.isFinite(opened.seq)) {
	if (typeof session.recvSeq === 'number' && opened.seq <= session.recvSeq) {
		console.warn(`[Chat] dropped a replayed envelope from ${fromId} (seq ${opened.seq} <= ${session.recvSeq})`);
		return true;
	}
	session.recvSeq = opened.seq;
	}
	innerMessage = opened.message;
	enclosedSessionKeyRaw = String(opened.sessionKeyRaw || '');
	/* What the sender's build reads, under the sender's own signature. */
	if (Array.isArray(opened.caps) && typeof noteSenderCaps === 'function') {
	noteSenderCaps(String(payload.fromFingerprint || message.fromFingerprint || ''), opened.caps);
	}
	if (opened.homeRelay) {
	openedHomeRelay = opened.homeRelay;
	noteSenderHomeRelay(payload, opened.homeRelay);
	}
	} else {
innerMessage = opened;
}
	} catch (error) {
	console.warn('[Chat] a sealed envelope could not be decrypted:', error);
	/* A body that fails its GCM tag will fail it on every redelivery too.
	   Say so in the thread once — the same way noteExpiredEnvelope does for a
	   closed window — and ack, so the server stops resending a message this
	   device will never be able to open. */
	const undecryptablePeer = findPeerBySession(session);
	const undecryptableKey = getPeerHistoryKey(undecryptablePeer, session)
	|| session?.conversationId
	|| (payload.fromPeerId ? `peer:${payload.fromPeerId}` : '')
	|| payload.fromFingerprint
	|| '';
	if (undecryptableKey) {
	appendHistory(undecryptableKey, {
	id: `unreadable-${payload.createdAt || Date.now()}`,
	type: 'system-note',
	direction: 'in',
	text: t(
	'یک پیام رمزنگاری‌شده نتوانست باز شود.',
	'A sealed message could not be opened.',
	),
	createdAt: new Date().toISOString(),
	});
	renderPeers();
	renderMessages();
	}
	return true;
	}
}
	if (!innerMessage) return;
	const innerType = innerMessage.type;
	/* A pinned contact's name on an envelope nobody signed: a receipt or a
	   typing flag is let through (an older build sent those unsigned), and
	   nothing that could put words, files or calls in their mouth is. */
	if (senderVerdict === 'unsigned-pinned' && !['receipt', 'typing', 'ping', 'pong'].includes(String(innerType || ''))) {
	console.warn(`[Chat] an unsigned ${innerType || 'envelope'} named a pinned contact; refused`);
	return true;
	}
	/* A group-call invite that sat in the mailbox past the ring window is a
	   missed call, not a ring — the 1:1 path already treats its stale invites
	   this way, and a group invite ringing minutes after the caller gave up is
	   the same wrong answer with more people in it. */
	if (innerType === 'gcall-invite') {
	const queuedAt = Date.parse(message.queuedAt || '');
	if (queuedAt && Date.now() - queuedAt > CALL_RING_TIMEOUT_MS) {
	appendCall({
	name: innerMessage.fromName || t('تماس گروهی', 'Group call'),
	conversationId: innerMessage.spaceId || '',
	mode: innerMessage.mode || 'voice',
	status: 'missed',
	direction: 'in',
	createdAt: message.queuedAt,
	});
	return true;
	}
	}
	const requiresCrypto = ['text', 'space-message', 'file', 'voice', 'edit', 'file-start', 'file-chunk', 'rich'].includes(innerType);
await hydrateSessionKey(session);

/* A sealed envelope carries the key it was encrypted under, wrapped to us.
   Using it only for this message — and putting the session's own key back
   afterwards — is what keeps two peers who wrote to each other while both
   were offline from overwriting one another's keys and losing both. */
let sealKey = null;
if (enclosedSessionKeyRaw) {
/* The envelope said which key its contents were written with. That beats
   guessing: the throwaway key opened the envelope, not what is inside it. */
try {
sealKey = await crypto.subtle.importKey('raw', app().base64ToArrayBuffer(enclosedSessionKeyRaw),
{ name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
} catch (error) {
console.warn('[Chat] the key enclosed with an offline envelope could not be imported:', error);
}
}
if (!sealKey && payload.kex) {
try {
sealKey = await openPrekeySeal(payload.kex);
} catch (error) {
console.warn('[Chat] An offline envelope could not be opened with its prekey:', error);
}
} else if (!sealKey && payload.seal) {
try {
sealKey = await openOfflineSeal(payload.seal);
} catch (error) {
console.warn('[Chat] An offline envelope could not be unsealed:', error);
}
}
// De-duplication check: only for types that create new history entries.
// We don't want to skip receipts, reactions, or edits which refer to existing IDs.
const historyKey = getPeerHistoryKey(findPeerBySession(session), session);
const isHistoryType = ['text', 'space-message', 'voice', 'file-start', 'rich', 'space-note'].includes(innerType);
if (isHistoryType) {
const isDuplicate = (chatState.history[historyKey] || []).some(m => m.id === (innerMessage.id || innerMessage.messageId));
if (isDuplicate) return true;
}
if (requiresCrypto && !session.cryptoKey && !sealKey) {
const peer = findPeerBySession(session);
appendHistory(peer ? getConversationKey(peer) : session.peerId, {
id: generateId('notice'),
direction: 'in',
type: 'text',
text: t('یک پیام آفلاین رسید، اما کلید سشن قبلی برای بازکردن آن موجود نیست.', 'An offline message arrived, but the previous session key is not available.'),
status: 'delivered',
createdAt: payload.createdAt || new Date().toISOString(),
});
return true;
}
if (sealKey) {
const previousKey = session.cryptoKey;
const previousSource = session.keySource;
session.cryptoKey = sealKey;
session.keySource = 'sealed';
/* Marks what follows as relay-mailbox delivery rather than a live offer: the
   consent gate must not fire for bytes that already sit on the server — the
   ack that follows processing is what frees that space. */
session.viaRelayMail = true;
try {
await handleSessionMessage(session, innerMessage);
} finally {
session.cryptoKey = previousKey;
session.keySource = previousSource;
session.viaRelayMail = false;
}
if (openedHomeRelay) noteSenderHomeRelay(payload, openedHomeRelay);
return true;
}
session.viaRelayMail = true;
try {
await handleSessionMessage(session, innerMessage);
} finally {
session.viaRelayMail = false;
}
if (openedHomeRelay) noteSenderHomeRelay(payload, openedHomeRelay);
return true;
} catch (error) {
console.error('Failed to process offline relay message:', error);
return false;
}
}
/* The sender a session stands for, as this device knows it: the record the
   session resolves to, or the fingerprint the key exchange or the envelope
   signature established. Never a field the far side filled in. */
function authenticatedSenderOf(session) {
const fingerprint = String(findPeerBySession(session)?.fingerprint || session?.remoteFingerprint || '');
/* Never this account itself: a session does not stand for its own owner,
   and a name that says so is somebody borrowing it. */
return fingerprint && fingerprint === chatState.identity?.fingerprint ? '' : fingerprint;
}
function clearSessionKeyFallback(session) {
if (session?.keyFallbackTimer) {
clearTimeout(session.keyFallbackTimer);
session.keyFallbackTimer = null;
}
}
// A session without a key is useless, so waiting forever is never the right
// answer. If the owner's key has not arrived shortly after we asked, mint one
// ourselves and hand it over. The owner rule still breaks ties on incoming
// keys, so this can only unblock the pair, never split it.
function scheduleSessionKeyFallback(session, remotePeerRecord) {
clearSessionKeyFallback(session);
session.keyFallbackTimer = setTimeout(() => {
session.keyFallbackTimer = null;
if (session.cryptoKey || !session.connection?.open) return;
console.warn('[Chat] Session key never arrived; minting one locally so the session cannot deadlock.');
mintSessionKey(session, remotePeerRecord).catch(console.error);
/* The exchange adds a round trip; 3.5s was tuned for a single message. */
}, 6000);
}
/* Gives an offline session a key of its own so the send paths can encrypt.
   It is deliberately not persisted or announced: each envelope re-seals with a
   fresh key, and storing this one would resurrect the split-brain that
   sealForOfflinePeer() exists to avoid. */
async function prepareOfflineSession(session, peerRecord) {
if (!session || session.cryptoKey) return session;
const publicKeyData = peerRecord?.publicKeyData || session.remotePublicKeyData || '';
if (!publicKeyData) return session;
session.remotePublicKeyData = publicKeyData;
session.remoteFingerprint = peerRecord?.fingerprint || session.remoteFingerprint || '';
session.cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
session.keyReady = true;
session.keySource = 'offline';
return session;
}
/* A live session's key, derived rather than delivered.
   The old shape generated an AES key and shipped it wrapped to the peer's
   identity key. Whoever recovered that identity key later — from a seized
   device, a stolen backup — could unwrap every session key they had ever
   recorded, and read the lot.
   Now each side contributes an ephemeral ECDH key and the session key is the
   HKDF of the two. The identity key still protects the exchange, but what it
   carries is a PUBLIC value: learning it afterwards yields nothing, because
   the ephemeral private halves were dropped when the session ended and the
   secret cannot be recomputed without them.
   The initiator sends its half here; the answer completes it. */
async function mintSessionKey(session, remotePeerRecord) {
const publicKeyData = remotePeerRecord?.publicKeyData || session.remotePublicKeyData;
if (!publicKeyData) return;
/* One exchange per connection. mintSessionKey is reached from several places
   — the connection opening, ensureSessionKey, a key request — and each extra
   offer made the far side answer again with a NEW ephemeral, so it moved to a
   key this side had already replaced. Both ends then reported a healthy
   negotiated session while holding different keys. */
if (session.kexPrivate && session.kexSentFor === session.connection) return;
if (session.keyReady && session.keyNegotiatedFor === session.connection) return;
/* Exactly one side offers. Both offering means both derive from the exchange
   they started, and the two keys differ — which is precisely how the first
   attempt at this failed: each end reported a healthy negotiated key and
   neither could read the other. sessionKeyOwner is the same deterministic
   rule the previous design used, so the choice needs no round trip. */
if (session.connection?.open && sessionKeyOwner(session)) {
try {
const ephemeral = await generateEcdhPair();
session.kexPrivate = ephemeral.privateKeyData;
session.kexSentFor = session.connection;
/* Nothing may be sent under the key being replaced. Senders wait on
   keyReady, and leaving it true here is what let a message go out under the
   old key while the other side had already switched to the new one. */
clearSessionKeyFallback(session);
session.cryptoKey = null;
session.keyReady = false;
session.keySource = '';
/* A peer whose build has no kex will never answer. Fall back rather than
   leave the conversation unable to send. */
if (session.kexTimer) clearTimeout(session.kexTimer);
session.kexTimer = setTimeout(() => {
if (session.keyReady || !session.kexPrivate) return;
session.kexPrivate = '';
console.warn('[Chat] no key-exchange answer; falling back to the identity-wrapped key.');
mintSessionKeyLegacy(session, remotePeerRecord).catch(console.error);
}, 4000);
const remotePublicKey = await importIdentityPublicKey(publicKeyData);
/* Encrypted to the pinned identity key, so only the real peer can read our
   contribution — that is what binds this exchange to who they are. */
const sealed = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, remotePublicKey,
new TextEncoder().encode(ephemeral.publicKeyData));
safeConnectionSend(session.connection, {
type: 'kex-offer',
pub: app().arrayBufferToBase64(sealed),
fingerprint: chatState.identity?.fingerprint || '',
}, 'kex-offer');
return;
} catch (error) {
console.warn('[Chat] ephemeral key exchange unavailable; using the identity-wrapped path:', error);
}
}
/* Fallback: no open channel, or a peer whose build has no kex. */
return mintSessionKeyLegacy(session, remotePeerRecord);
}

/* The pre-forward-secrecy path, kept for peers that cannot do the exchange. */
async function mintSessionKeyLegacy(session, remotePeerRecord) {
const publicKeyData = remotePeerRecord?.publicKeyData || session.remotePublicKeyData;
if (!publicKeyData) return;
const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const rawKey = await crypto.subtle.exportKey('raw', cryptoKey);
const remotePublicKey = await importIdentityPublicKey(publicKeyData);
const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, remotePublicKey, rawKey);
clearSessionKeyFallback(session);
session.cryptoKey = cryptoKey;
session.keyReady = true;
/* Named for what it is: a key wrapped to a never-changing public key is no
   forward secrecy at all, whatever the word that used to sit here. The name
   is what tells the far side whether to accept a chat-key from this
   connection, so it must not flatter the path that produced it. */
session.keySource = 'legacy';
session.keyNegotiatedFor = session.connection;
await persistSessionKey(session, rawKey);
if (session.connection?.open) {
safeConnectionSend(session.connection, {
type: 'chat-key',
wrappedKey: app().arrayBufferToBase64(wrapped),
fingerprint: chatState.identity?.fingerprint || '',
}, 'chat-key');
}
renderActivePeer();
}

/* Reads a contribution that was sealed to our identity key. */
async function openKexContribution(sealedBase64) {
  const privateKey = await importIdentityPrivateKey();
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, app().base64ToArrayBuffer(sealedBase64));
  return new TextDecoder().decode(raw);
}
/* Both halves in hand: derive, store, and forget the ephemeral private. */
async function completeKex(session, theirEphemeralPublic, myPrivateBase64) {
  const privateKey = await importEcdhPrivate(myPrivateBase64);
  const theirs = await importEcdhPublic(theirEphemeralPublic);
  const cryptoKey = await deriveSharedAesKey(privateKey, theirs, 'poorija-session-v2');
  clearSessionKeyFallback(session);
  session.cryptoKey = cryptoKey;
  session.keyReady = true;
  session.keySource = 'negotiated';
  session.keyNegotiatedFor = session.connection;
  /* The one thing that must not survive the session. */
  session.kexPrivate = '';
  if (session.kexTimer) { clearTimeout(session.kexTimer); session.kexTimer = null; }
  const raw = await crypto.subtle.exportKey('raw', cryptoKey);
  await persistSessionKey(session, raw);
  renderActivePeer();
  renderMessages();
}
async function ensureSessionKey(session, remotePeerRecord) {
if (!remotePeerRecord?.publicKeyData) return;
session.remoteFingerprint = remotePeerRecord.fingerprint || session.remoteFingerprint || '';
session.remotePublicKeyData = remotePeerRecord.publicKeyData || session.remotePublicKeyData || '';
session.conversationId = getConversationKey(remotePeerRecord) || session.conversationId || session.remoteFingerprint || session.peerId;
if (!sessionKeyOwner(session)) {
// Ask the owner first, but never sit on our hands: the fallback mints a key
// if theirs does not turn up.
if (!session.cryptoKey) {
requestSessionKey(session);
scheduleSessionKeyFallback(session, remotePeerRecord);
}
return;
}
// One fresh key per connection: a key carried over from an earlier session
// may no longer match what the peer holds.
if (session.cryptoKey && session.keyNegotiatedFor === session.connection) return;
await mintSessionKey(session, remotePeerRecord);
}
async function handleSessionMessage(session, message) {
if (!message) return;
/* A blocked peer is dropped before anything is decrypted, stored, rendered or
   acknowledged — nothing about the block is signalled back to them. */
if (isConversationBlocked(findPeerBySession(session))) return;
if (message.type === 'ping') {
try {
session.connection?.send({ type: 'pong', timestamp: Date.now() });
} catch (_e) { /* noop */ }
return;
}
if (message.type === 'pong') {
return;
}
/* A fellow member asking for, or handing over, the cards of a group both are
   in — sealed and authenticated by this session; see 41-member-cards.js. */
if (message.type === 'member-cards' || message.type === 'member-cards-request') {
if (typeof handleMemberCardsMessage === 'function') await handleMemberCardsMessage(session, message);
return;
}
/* The recipient's answer to a gated file-start. Control only — no ciphertext,
   nothing to store. Accept releases the waiting upload; decline also flags the
   outgoing blob so an upload already in flight stops at the next chunk. */
if (message.type === 'file-accept' || message.type === 'file-decline') {
const transferId = sanitizeRemoteId(message.transferId);
if (transferId) {
const waiter = chatState.transferConsentWaiters.get(transferId);
if (message.type === 'file-decline') {
const outgoing = chatState.outgoingFiles.get(transferId);
if (outgoing) outgoing.aborted = true;
}
waiter?.resolve(message.type === 'file-accept' ? 'accepted' : 'declined');
}
return;
}
/* The other side telling us where we stand after OUR key change. They arrive
   over the raw channel, so they work precisely while the session layer
   cannot — which is the only time they matter. */
if (message.type === 'key-accept-wait') {
notePeerAwaitingKeyAccept(session);
return;
}
if (message.type === 'key-accepted') {
const peer = findPeerBySession(session);
if (peer?.peerId && chatState.awaitingKeyAccept.delete(peer.peerId)) {
notify(t('کلید تازه پذیرفته شد؛ سشن امن دوباره برقرار می‌شود.', 'The new key was accepted; the secure session is being re-established.'), 'success');
renderActivePeer();
renegotiateSessionKey(session).catch(console.error);
}
return;
}
	if (message.type === 'session-hello') {
	session.remoteClientId = message.clientId || session.remoteClientId || '';
	session.remoteFingerprint = message.fingerprint || session.remoteFingerprint || '';
	session.remotePublicKeyData = message.publicKeyData || session.remotePublicKeyData || '';
	const peer = findPeerBySession(session);
	if (peer) {
	peer.clientId = message.clientId || peer.clientId;
	peer.username = message.username || peer.username;
	/* The key in a session-hello used to be written straight onto the peer
	   record, which is the one path that bypassed the TOFU pinning the
	   presence merge enforces — a reinstalled-or-impostor peer quietly
	   replaced the pinned key and the safety number followed it. The same
	   merge decides here: a differing key becomes pendingKey plus the
	   key-change note, and the pinned key stays put. */
	mergePeerRecord({
	peerId: peer.peerId,
	clientId: message.clientId || peer.clientId,
	username: message.username || peer.username,
	publicKeyData: message.publicKeyData || peer.publicKeyData,
	fingerprint: message.fingerprint || peer.fingerprint,
	conversationId: peer.conversationId,
	status: peer.status,
	}, { online: true });
	/* The merge may have kept the trusted key over the offered one; the
	   session must negotiate against what the record now holds. */
	session.remotePublicKeyData = peer.publicKeyData || session.remotePublicKeyData;
	session.conversationId = getConversationKey(peer);
	/* Tell the far end they are waiting on a human here. Their side cannot
	   know otherwise: every key they would negotiate with us is wrapped to a
	   key we have deliberately not accepted, so their session just fails over
	   and over and reads as a string of mismatches. */
	if (peer.keyChangedAt && peer.pendingKey && session.connection?.open) {
	safeConnectionSend(session.connection, { type: 'key-accept-wait' }, 'key-accept-wait');
	}
	} else if (message.peerId || session.peerId) {
onPeerDiscovered({
clientId: message.clientId || session.remoteClientId || session.peerId,
peerId: message.peerId || session.peerId,
username: message.username || session.peerId,
publicKeyData: message.publicKeyData || '',
fingerprint: message.fingerprint || '',
status: 'online',
});
}
if (session.connection?.open) {
// ensureSessionKey decides ownership itself, so both ends may call it.
await ensureSessionKey(session, {
peerId: session.peerId,
clientId: session.remoteClientId,
username: message.username || '',
publicKeyData: session.remotePublicKeyData,
fingerprint: session.remoteFingerprint,
});
}
renderPeers();
renderActivePeer();
return;
}
	if (message.type === 'chat-key') {
	// `if (session.cryptoKey) return` used to stand here, and it is what broke
	// the pair for good: a key revived from storage made this side reject the
	// fresh one the peer had just minted, so each end encrypted under a key the
	// other did not hold. Only the owner's own freshly minted key outranks an
	// incoming one — of either kind, now that legacy has its own name.
	if (sessionKeyOwner(session) && session.keyReady
	&& session.keyNegotiatedFor === session.connection) return;
	/* A peer that can do the exchange does not deliver keys this way, and a
	   chat-key from one that can is not an old build being accommodated — it
	   is the exchange being bypassed. The kex path binds both contributions
	   to the pinned identity keys; this path hands the session to whatever
	   key the connection cares to wrap, so for a peer who has offered or
	   answered an exchange — or who publishes a prekey, which no pre-kex
	   build ever did — the answer is no. The 4-second fallback still catches
	   the genuinely old build: it publishes no prekey and speaks no kex. */
	const peerRecord = typeof findPeerRecordByPeerId === 'function'
	? findPeerRecordByPeerId(session.peerId) : null;
	if (session.peerDidKex || peerRecord?.prekeyPublic) {
	console.warn('[Chat] refused a legacy chat-key from a peer that can do the key exchange');
	return;
	}
	const privateKey = await importIdentityPrivateKey();
	const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, app().base64ToArrayBuffer(message.wrappedKey));
	clearSessionKeyFallback(session);
	session.cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
	session.keyReady = true;
	session.keySource = 'legacy';
	session.keyNegotiatedFor = session.connection;
	await persistSessionKey(session, raw);
	renderActivePeer();
	renderMessages();
	return;
	}
if (message.type === 'kex-offer') {
/* Their ephemeral public, sealed to us. Answer with ours, then derive.
   The fallback timer has to stop first: an exchange is a round trip, and the
   non-owner's "the key never arrived" timer would otherwise fire mid-exchange
   and mint a key of its own — which is exactly how the two sides ended up
   holding different keys while both reported a healthy negotiated session. */
	clearSessionKeyFallback(session);
	try {
	const theirPublic = await openKexContribution(message.pub);
	/* They can do this. Remembered, so a chat-key arriving later on the same
	   connection is read as the bypass it would be. */
	session.peerDidKex = true;
	const ephemeral = await generateEcdhPair();
const remotePublicKey = await importIdentityPublicKey(session.remotePublicKeyData);
const sealed = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, remotePublicKey,
new TextEncoder().encode(ephemeral.publicKeyData));
safeConnectionSend(session.connection, {
type: 'kex-answer',
pub: app().arrayBufferToBase64(sealed),
fingerprint: chatState.identity?.fingerprint || '',
}, 'kex-answer');
await completeKex(session, theirPublic, ephemeral.privateKeyData);
} catch (error) {
console.warn('[Chat] could not answer a key exchange:', error);
}
return;
}
	if (message.type === 'kex-answer') {
	try {
	if (!session.kexPrivate) return;
	const theirPublic = await openKexContribution(message.pub);
	/* An answer is proof of the same capability an offer is. */
	session.peerDidKex = true;
	await completeKex(session, theirPublic, session.kexPrivate);
} catch (error) {
console.warn('[Chat] could not finish a key exchange:', error);
}
return;
}
if (message.type === 'chat-key-request') {
// Always honour it. The peer is telling us it cannot read us, and gating
// this on ownership is what let both ends decide the other was responsible
// and leave the session without any key at all.
clearSessionKeyFallback(session);
session.cryptoKey = null;
session.keySource = '';
session.keyNegotiatedFor = null;
await mintSessionKey(session, {
peerId: session.peerId,
clientId: session.remoteClientId,
publicKeyData: session.remotePublicKeyData,
fingerprint: session.remoteFingerprint,
});
return;
}
if (message.type === 'text') {
const decrypted = await decryptForSession(session, message.payload);
const text = new TextDecoder().decode(decrypted);
const timerSeconds = Number(message.timerSeconds || 0);
/* The sender's link preview, under the same key (54-link-preview.js). A
   preview that will not open or does not check out is simply not shown. */
let preview = null;
if (message.previewPayload && typeof sanitizeLinkPreview === 'function') {
try {
preview = sanitizeLinkPreview(JSON.parse(new TextDecoder().decode(await decryptForSession(session, message.previewPayload))));
} catch (_error) { preview = null; }
}
/* The countdown starts when it is read, not when it lands. A message that sat
   three days in the relay queue used to arrive with most of its life already
   spent — sometimes all of it, so it vanished before it could be opened.
   markConversationRead() sets expiresAt instead. */
const expiresAt = message.expiresAt || '';
appendHistory(getPeerHistoryKey(findPeerBySession(session), session), {
id: sanitizeRemoteId(message.id) || generateId('msg'),
direction: 'in',
type: 'text',
text,
...(preview ? { preview } : {}),
status: 'delivered',
expiresAt,
hidden: Boolean(message.hidden),
timerSeconds,
replyToId: message.replyToId || '',
createdAt: message.createdAt || new Date().toISOString(),
});
sendDeliveryAck(session, message.id, 'delivered');
return;
}
/* call-accepted is a one-to-one signal but it is answered in the same place
   as the group ones, so it has to be let through this gate too. Routing by
   prefix alone is what would have quietly dropped it. */
if (String(message.type || '').startsWith('gcall-') || message.type === 'call-accepted') {
if (handleGroupCallSignal(message, { provenFingerprint: authenticatedSenderOf(session) })) return;
}
if (message.type === 'call-reaction') {
/* Only while a call is up: a reaction with nowhere to float is noise. */
if (chatState.currentCall) floatCallReaction(document.getElementById('chatFloatingCall'), message.emoji, message.fromName || '');
return;
}
if (message.type === 'space-note') {
const space = chatState.spaces.groups.find((item) => item.conversationId === message.spaceId);
if (!space) return;
appendHistory(space.conversationId, {
id: generateId('sys'),
direction: 'in',
type: 'system-note',
text: message.text || '',
status: 'delivered',
createdAt: message.createdAt || new Date().toISOString(),
});
return;
}
if (message.type === 'rich') {
const decrypted = await decryptForSession(session, message.payload);
const body = safeJsonParse(new TextDecoder().decode(decrypted));
if (!body) return;
let historyKey = getPeerHistoryKey(findPeerBySession(session), session);
if (isReservedConversationKey(message.spaceId)) return;
if (message.spaceId) {
const space = upsertSharedSpace({
type: message.spaceType || 'group',
name: message.spaceName || t('فضای مشترک', 'Shared space'),
conversationId: message.spaceId,
members: Array.isArray(message.members) ? message.members : [],
createdAt: message.createdAt || new Date().toISOString(),
}, { addedBy: authenticatedSenderOf(session) });
historyKey = space?.conversationId || message.spaceId || historyKey;
}
if (body.kind === 'poll-vote') {
applyIncomingVote(historyKey, body);
return;
}
/* A live location's pin moving: applied to its card, never an entry. */
if (body.kind === 'live-location-update') {
if (typeof applyLiveLocationUpdate === 'function') applyLiveLocationUpdate(historyKey, body, session);
return;
}
if (!RICH_KINDS.has(body.kind)) return;
	const timerSeconds = Number(message.timerSeconds || 0);
	appendHistory(historyKey, {
	id: sanitizeRemoteId(message.id) || sanitizeRemoteId(body.id) || generateId('rich'),
	direction: 'in',
	type: 'rich',
rich: body,
status: 'delivered',
timerSeconds,
// Started on read, not on arrival — see markConversationRead().
expiresAt: '',
createdAt: message.createdAt || new Date().toISOString(),
senderName: message.senderName || '',
senderPeerId: message.senderPeerId || '',
senderFingerprint: message.senderFingerprint || '',
});
sendDeliveryAck(session, message.id, 'delivered');
return;
}
if (message.type === 'space-message') {
const decrypted = await decryptForSession(session, message.payload);
let payload = {};
try {
payload = JSON.parse(new TextDecoder().decode(decrypted));
} catch (error) {
console.warn('Invalid space message payload:', error);
return;
}
const space = upsertSharedSpace({
type: payload.spaceType || 'group',
name: payload.spaceName || t('فضای مشترک', 'Shared space'),
conversationId: payload.spaceId || message.spaceId || generateId('space'),
members: Array.isArray(payload.members) ? payload.members : [],
ownerPeerId: payload.ownerPeerId || '',
ownerClientId: payload.ownerClientId || '',
ownerFingerprint: payload.ownerFingerprint || '',
createdAt: payload.createdAt || message.createdAt || new Date().toISOString(),
}, { addedBy: authenticatedSenderOf(session) });
const conversationId = space?.conversationId || payload.spaceId || message.spaceId;
if (!conversationId || isReservedConversationKey(conversationId)) return;
const timerSeconds = Number(payload.timerSeconds || 0);
// Started on read, not on arrival — see markConversationRead().
const expiresAt = payload.expiresAt || '';
	appendHistory(conversationId, {
	id: sanitizeRemoteId(payload.messageId) || sanitizeRemoteId(message.id) || generateId('msg'),
	direction: 'in',
	type: 'text',
	text: payload.text || '',
	...((typeof sanitizeLinkPreview === 'function' && sanitizeLinkPreview(payload.preview)) ? { preview: sanitizeLinkPreview(payload.preview) } : {}),
senderName: payload.senderName || '',
senderPeerId: payload.senderPeerId || '',
senderFingerprint: payload.senderFingerprint || '',
status: 'delivered',
expiresAt,
hidden: Boolean(payload.hidden),
timerSeconds,
replyToId: payload.replyToId || '',
createdAt: payload.createdAt || message.createdAt || new Date().toISOString(),
});
return;
}
	if (message.type === 'edit') {
	const decrypted = await decryptForSession(session, message.payload);
	const text = new TextDecoder().decode(decrypted);
	/* A group edit names the conversation it belongs to (1:1 edits do not).
	   Only a conversation that already exists locally is accepted, so a
	   fabricated id cannot point an edit at a thread of the sender's choosing. */
	const key = (message.conversationId && !isReservedConversationKey(message.conversationId) && Array.isArray(chatState.history[message.conversationId]))
	? message.conversationId
	: getPeerHistoryKey(findPeerBySession(session), session);
	const entry = (chatState.history[key] || []).find((item) => item.id === message.messageId);
if (entry) {
entry.text = text;
entry.edited = true;
/* A preview for a link the edit took out is a preview of nothing. */
if (entry.preview && !text.includes(new URL(entry.preview.url).host)) delete entry.preview;
storeHistory();
renderPeers();
renderMessages();
}
return;
}
if (message.type === 'pin') {
const key = getPeerHistoryKey(findPeerBySession(session), session);
const entry = (chatState.history[key] || []).find((item) => item.id === message.messageId);
if (entry) {
entry.pinned = Boolean(message.pinned);
storeHistory();
renderMessages();
}
return;
}
if (message.type === 'receipt') {
markMessageStatus(getPeerHistoryKey(findPeerBySession(session), session), message.messageId, message.status || 'delivered');
return;
}
if (message.type === 'reaction') {
const key = getPeerHistoryKey(findPeerBySession(session), session);
const entry = (chatState.history[key] || []).find((item) => item.id === message.messageId);
if (entry) {
if (message.reaction) spawnReactionAnimation(message.reaction, message.messageId);
applyMessageReaction(entry, message.reaction || '', resolveRemoteReactorId(session, message));
storeHistory();
renderPeers();
renderMessages();
}
return;
}
if (message.type === 'delete') {
deleteMessageEntry(getPeerHistoryKey(findPeerBySession(session), session), message.messageId);
return;
}
	if (message.type === 'file-start') {
	/* The transfer record used to take totalChunks and size as claimed, so a
	   hostile or broken peer could pre-allocate an enormous array (or one that
	   never fills and rings the watchdog forever). The chunk count is clamped
	   and an impossible size is refused outright.
	   The clamp and the ceiling have to describe the same file, though: the
	   sender is allowed 4 GB, the clamp here used to allow 20,000 chunks —
	   64 KB each is barely 1.2 GB — so everything above that line was silently
	   truncated on receipt: the first 20,000 chunks assembled into a shorter
	   file, stored, and acknowledged as delivered, and both sides believed a
	   complete transfer had happened. The count is now derived from the same
	   ceiling the sender answers to, and a count that cannot be the claimed
	   size (allowing one short tail chunk) is refused rather than cut to fit. */
	const claimedSize = Number(message.size);
	const claimedChunks = Math.max(1, Number(message.totalChunks) || 0);
	const maxChunks = Math.ceil(MAX_FILE_BYTES / FILE_CHUNK_BYTES);
	const totalChunks = Math.min(claimedChunks, maxChunks);
	if (!Number.isFinite(claimedSize) || claimedSize > MAX_FILE_BYTES
	|| Math.abs(claimedChunks - Math.ceil(claimedSize / FILE_CHUNK_BYTES)) > 1) {
	notify(t(
	'یک فایل با حجم نامعتبر یا بیش از حد مجاز نادیده گرفته شد.',
	'A file with an invalid or oversized length was ignored.',
	), 'warning');
	return;
	}
	const timerSeconds = Number(message.timerSeconds || 0);
/* The countdown starts when it is read, not when it lands. A message that sat
   three days in the relay queue used to arrive with most of its life already
   spent — sometimes all of it, so it vanished before it could be opened.
   markConversationRead() sets expiresAt instead. */
const expiresAt = message.expiresAt || '';
/* A repeated file-start used to replace the transfer in flight, throwing away
   every chunk already received and guaranteeing the file never completed. */
	if (chatState.incomingFiles.has(message.transferId)) return;
	chatState.incomingFiles.set(message.transferId, {
	meta: { ...message, totalChunks, expiresAt, timerSeconds },
	/* v1 put the whole file under one IV and chunked the base64 of it; v2 chunks
	   the file first and gives each piece its own IV. Both shapes have to be
	   readable: a v1 transfer may already be sitting in the relay queue. */
	version: Number(message.v) || 1,
	chunks: new Array(totalChunks).fill(null),
/* `chunks` holds only the tail that has not been flushed yet; `parts` holds
   the Blobs everything before `flushedThrough` was moved into. See
   flushReceivedChunks() for why the file does not live in the heap. */
parts: [],
flushedThrough: 0,
/* Distinct indices, not an arrival count. Counting meant one retransmitted
   chunk "completed" the transfer with a hole in it, and the assembled
   ciphertext then failed to decrypt. */
seen: new Set(),
bytes: 0,
meter: createTransferMeter(Number(message.size) || 0),
resendRequests: 0,
session,
consent: 'auto',
});
/* A live file-start is an offer: the recipient decides before the bytes move.
   Under their auto-download quota (and under the large-file line) the answer
   is sent silently; above it they are asked, and a refusal cancels the
   download here and the upload on the far side. Relay-delivered starts get no
   gate — those bytes already sit in the mailbox, and ack-on-process is what
   frees them, so holding them would only pin server space. */
const viaLiveChannel = !session?.viaRelayMail && Boolean(session?.connection?.open);
if (viaLiveChannel && claimedSize >= FILE_GATE_MIN_BYTES) {
const record = chatState.incomingFiles.get(message.transferId);
record.consent = 'pending';
decideGatedTransfer(session, message.transferId, claimedSize).catch((error) => {
console.warn('[Chat] the transfer consent flow failed:', error);
const pending = chatState.incomingFiles.get(message.transferId);
if (pending) { pending.consent = 'auto'; armTransferWatchdog(message.transferId); }
});
return;
}
armTransferWatchdog(message.transferId);
return;
}
if (message.type === 'file-resend') {
const pending = chatState.outgoingFiles.get(message.transferId);
if (!pending?.session?.cryptoKey) return;
/* Bounded: a peer asking for thousands of chunks is either broken or
   hostile, and re-sending the whole file on request is not a service we
   want to offer. */
for (const index of (Array.isArray(message.indices) ? message.indices : []).slice(0, 256)) {
const offset = Number(index) * FILE_CHUNK_BYTES;
if (!Number.isFinite(offset) || offset < 0 || offset >= pending.blob.size) continue;
const slice = pending.blob.slice(offset, offset + FILE_CHUNK_BYTES);
const iv = app().generateSecureRandomBytes(12);
const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, pending.session.cryptoKey, await slice.arrayBuffer());
if (pending.session.connection?.open) {
await awaitChannelDrain(pending.session.connection);
safeConnectionSend(pending.session.connection, {
type: 'file-chunk', transferId: message.transferId, index: Number(index), iv: Array.from(iv), bin: new Uint8Array(cipher),
}, 'file-resend');
continue;
}
/* No channel: the chunk goes back the way the request came, paced and
   named like every relayed chunk. */
if (!pending.peerRecord) return;
const farRelay = transitRouteFor(pending.peerRecord);
if (farRelay && typeof awaitTransitWindow === 'function' && !await awaitTransitWindow(farRelay.id)) return;
if (!await waitForRelaySocketDrain()) return;
await sendSealedRelay(pending.peerRecord, pending.session, {
type: 'file-chunk', transferId: message.transferId, index: Number(index), iv: Array.from(iv), chunk: app().arrayBufferToBase64(cipher),
}, { messageClass: 'media', notify: false, relayTag: `${message.transferId}-c${Number(index)}` });
}
return;
}
if (message.type === 'file-chunk') {
const transfer = chatState.incomingFiles.get(message.transferId);
if (!transfer) return;
const index = Number(message.index);
if (!Number.isInteger(index) || index < 0 || index >= transfer.meta.totalChunks) return;
armTransferWatchdog(message.transferId);
let blob = null;
if (transfer.version >= 2) {
if (transfer.seen.has(index)) return;
const cipher = chunkCipherBytes(message);
/* The seal key for an offline envelope lives on `session` only while this
   handler runs, so the chunk is decrypted here rather than at completion —
   which is also what keeps peak memory at one chunk. */
const key = session?.cryptoKey || transfer.session?.cryptoKey;
if (!cipher || !key) return;
let plain;
try {
plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(message.iv || []) }, key, cipher);
} catch (error) {
console.warn('[Chat] a file chunk could not be decrypted', transfer.meta.name, index, error);
return;
}
transfer.chunks[index] = new Uint8Array(plain);
transfer.seen.add(index);
transfer.bytes += plain.byteLength;
flushReceivedChunks(transfer);
const painted = transfer.meter(transfer.bytes);
if (painted) {
setTransferBanner(
t(`دریافت ${transfer.meta.name || ''}…`, `Receiving ${transfer.meta.name || ''}…`),
painted.percent,
{ detail: painted.detail, owner: `recv:${message.transferId}`, incoming: true },
);
}
if (transfer.seen.size < transfer.meta.totalChunks) return;
/* One Blob out of the pieces already in the blob store. Concatenating into a
   string is what the old path did, and above ~384 MB that string exceeds
   V8's maximum length and throws; a Blob has no such ceiling. Every index has
   arrived by here, so the forced flush leaves nothing behind. */
flushReceivedChunks(transfer, { force: true });
blob = new Blob(transfer.parts, { type: transfer.meta.mime || 'application/octet-stream' });
} else {
transfer.chunks[index] = message.chunk;
transfer.seen.add(index);
if (transfer.seen.size < transfer.meta.totalChunks) return;
const decrypted = await decryptForSession(transfer.session, {
iv: transfer.meta.iv,
cipher: transfer.chunks.join(''),
});
blob = new Blob([decrypted], { type: transfer.meta.mime || 'application/octet-stream' });
}
/* Complete: both versions arrive here with one Blob and nothing else held. */
clearTransferWatchdog(message.transferId);
transfer.chunks = null;
transfer.parts = null;
setTransferBanner(t('دریافت شد', 'Received'), 100, { owner: `recv:${message.transferId}`, incoming: true });
clearTransferBanner(700, `recv:${message.transferId}`);
const url = URL.createObjectURL(blob);
let historyKey = getPeerHistoryKey(findPeerBySession(session), session);
if (isReservedConversationKey(transfer.meta.spaceId)) transfer.meta.spaceId = '';
if (transfer.meta.spaceId) {
const space = upsertSharedSpace({
type: transfer.meta.spaceType || 'group',
name: transfer.meta.spaceName || t('فضای مشترک', 'Shared space'),
conversationId: transfer.meta.spaceId,
members: Array.isArray(transfer.meta.members) ? transfer.meta.members : [],
ownerPeerId: transfer.meta.ownerPeerId || '',
ownerClientId: transfer.meta.ownerClientId || '',
ownerFingerprint: transfer.meta.ownerFingerprint || '',
createdAt: transfer.meta.createdAt || new Date().toISOString(),
}, { addedBy: authenticatedSenderOf(session) });
historyKey = space?.conversationId || transfer.meta.spaceId || historyKey;
}
/* A remote message id is only kept when it looks like an id; anything else
   (markup, quotes) is dropped and a local id generated in its place. */
const incomingId = sanitizeRemoteId(transfer.meta.messageId) || generateId('file');
persistMessageMedia(historyKey, {
id: incomingId,
type: incomingBlobType(transfer.meta.kind),
name: transfer.meta.name,
mime: transfer.meta.mime,
stickerKind: transfer.meta.stickerKind || '',
createdAt: transfer.meta.createdAt || new Date().toISOString(),
}, blob);
chatState.mediaUrls.set(incomingId, url);
appendHistory(historyKey, {
id: incomingId,
direction: 'in',
type: incomingBlobType(transfer.meta.kind),
stickerKind: transfer.meta.stickerKind || '',
stickerEmoji: transfer.meta.stickerEmoji || '',
packTitle: transfer.meta.packTitle || '',
packCount: transfer.meta.packCount || 0,
name: transfer.meta.name,
size: transfer.meta.size,
viewOnce: Boolean(transfer.meta.viewOnce),
status: 'delivered',
createdAt: transfer.meta.createdAt || new Date().toISOString(),
downloadUrl: url,
expiresAt: transfer.meta.expiresAt || '',
timerSeconds: transfer.meta.timerSeconds || 0,
senderName: transfer.meta.senderName || '',
senderPeerId: transfer.meta.senderPeerId || '',
senderFingerprint: transfer.meta.senderFingerprint || '',
});
sendDeliveryAck(transfer.session, transfer.meta.messageId, 'delivered');
if (blob.size > MEDIA_VAULT_MAX_FILE_BYTES) {
notify(t(
`«${transfer.meta.name || 'فایل'}» بزرگ‌تر از ${app().formatBytes(MEDIA_VAULT_MAX_FILE_BYTES)} است و در خزانهٔ دستگاه نگه داشته نمی‌شود؛ تا بستن برنامه ذخیره‌اش کنید.`,
`"${transfer.meta.name || 'This file'}" is larger than ${app().formatBytes(MEDIA_VAULT_MAX_FILE_BYTES)} and is not kept in the on-device vault — save it before closing the app.`,
), 'info');
}
chatState.incomingFiles.delete(message.transferId);
return;
}
if (message.type === 'voice' || message.type === 'file' || message.type === 'sticker') {
const decrypted = await decryptForSession(session, message.payload);
const blob = new Blob([decrypted], { type: message.mime || 'application/octet-stream' });
const url = URL.createObjectURL(blob);
	const singleShotId = sanitizeRemoteId(message.messageId) || generateId('file');
const singleShotKey = getPeerHistoryKey(findPeerBySession(session), session);
persistMessageMedia(singleShotKey, {
id: singleShotId,
type: message.type,
name: message.name,
mime: message.mime,
stickerKind: message.stickerKind || '',
createdAt: message.createdAt || new Date().toISOString(),
}, blob);
chatState.mediaUrls.set(singleShotId, url);
appendHistory(singleShotKey, {
id: singleShotId,
direction: 'in',
type: message.type,
stickerKind: message.stickerKind || '',
stickerEmoji: message.stickerEmoji || '',
name: message.name,
size: message.size,
durationMs: message.durationMs || 0,
status: 'delivered',
createdAt: message.createdAt || new Date().toISOString(),
downloadUrl: url,
expiresAt: message.expiresAt || '',
});
sendDeliveryAck(session, message.messageId, 'delivered');
return;
}
}
function sessionForPeer(peerRecord, connection) {
const existing = chatState.sessions.get(peerRecord.peerId) || {};
const session = {
...existing,
peerId: peerRecord.peerId,
remoteClientId: peerRecord.clientId,
remoteFingerprint: peerRecord.fingerprint || '',
remotePublicKeyData: peerRecord.publicKeyData || '',
conversationId: getConversationKey(peerRecord),
connection,
};
chatState.sessions.set(peerRecord.peerId, session);
hydrateSessionKey(session).then(() => renderActivePeer()).catch(console.error);
return session;
}
function bindDataConnection(peerRecord, connection, initiator = false) {
const session = sessionForPeer(peerRecord, connection);
session.initiator = initiator;
session.messageQueue = session.messageQueue || Promise.resolve();
connection.on('open', async () => {
safeConnectionSend(connection, {
type: 'session-hello',
clientId: chatState.clientId || chatState.peerId,
peerId: chatState.peerId,
username: chatState.profile.name,
publicKeyData: chatState.identity?.publicKeyData || '',
fingerprint: chatState.identity?.fingerprint || '',
createdAt: new Date().toISOString(),
}, 'session-hello');
setTimeout(() => {
const latest = chatState.sessions.get(peerRecord.peerId);
if (latest?.connection?.open && peerRecord.publicKeyData) {
ensureSessionKey(latest, peerRecord).catch(console.error);
}
}, 1200);
renderActivePeer();
if (!session.silent) {
notify(t('سشن P2P برقرار شد', 'P2P session established'), 'success');
}
session.silent = false;
});
connection.on('data', (message) => {
session.messageQueue = session.messageQueue
.then(() => handleSessionMessage(session, message))
.catch((error) => {
console.error(error);
if (['receipt', 'ping', 'pong'].includes(String(message?.type || ''))) return;
// AES-GCM rejects the tag when the two ends hold different keys. That is
// recoverable: drop ours and renegotiate, instead of failing every message
// from here on and leaving the user to reset their key by hand.
const failedToDecrypt = error?.name === 'OperationError'
|| /decrypt|operation-specific/i.test(String(error?.message || ''));
if (failedToDecrypt) {
/* A peer still waiting for somebody here to accept a changed key negotiates
   nothing but failures — renegotiating only re-mints the mismatch, and the
   toast-per-message read as the app being broken rather than a person being
   asked to decide. The banner says what is actually going on. */
const peer = findPeerBySession(session);
if (peer?.peerId && chatState.awaitingKeyAccept.has(peer.peerId)) {
  if (session.connection?.open) {
    safeConnectionSend(session.connection, { type: 'key-accept-wait' }, 'key-accept-wait');
  }
  return;
}
renegotiateSessionKey(session).catch(console.error);
notify(t('کلید سشن هماهنگ نبود؛ در حال تبادل دوباره...', 'Session key mismatch; renegotiating...'), 'warning');
return;
}
notify(t('پردازش پیام امن ناموفق بود', 'Failed to process secure message'), 'error');
});
});
connection.on('close', () => {
const existing = chatState.sessions.get(peerRecord.peerId);
if (existing) {
existing.connection = null;
}
renderActivePeer();
});
connection.on('error', (error) => {
console.error(error);
markPeerUnavailable(peerRecord.peerId, t('کانال P2P این کاربر قطع شد؛ برای جلوگیری از ارسال اشتباه از فهرست آنلاین حذف شد.', 'The peer channel dropped; the stale peer was removed from the online list.'));
});
return session;
}
function onPeerDiscovered(peer) {
if (isSelfPeerRecord(peer)) {
chatState.peers = chatState.peers.filter((item) => !isSelfPeerRecord(item));
saveContacts();
renderPeers();
renderActivePeer();
return;
}
mergePeerRecord(peer, { online: true });
chatState.peers = chatState.peers.filter((item) => !isSelfPeerRecord(item));
saveContacts();
/* No auto-seeding of a selected conversation here either: an empty pane that
   waits for the person to choose is the behaviour on every layout now, and a
   peer merely appearing online is not a choice anybody made. */
/* Only the groups this peer is in. Every group used to be pushed at every
   peer that appeared online, members or not — handing strangers the group's
   name, picture and roster. The receiver threw the record away, but it had
   already been read, and by the relay too. */
const peerKeys = [getConversationKey(peer), peer.peerId, peer.clientId, peer.fingerprint].filter(Boolean);
chatState.spaces.groups.forEach((space) => {
const roster = new Set([...normalizeSpaceMembers(space.members), space.ownerFingerprint, space.ownerPeerId].filter(Boolean));
if (!peerKeys.some((key) => roster.has(key))) return;
if (typeof sendSpaceSync === 'function') sendSpaceSync(peer, space);
});
renderPeers();
renderActivePeer();
retryQueuedMessages();
}
function broadcastHello() {
if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN || !chatState.peerId || !chatState.clientId) return;
const identity = chatState.identity;
/* The prekey travels with presence so somebody can write to this device while
   it is asleep. Only the public half goes; the private half never leaves, and
   is deleted the moment it expires. */
const prekey = (chatState.prekeys || []).slice(-1)[0] || null;
chatState.ws.send(JSON.stringify({
type: 'hello',
clientId: chatState.clientId,
username: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
publicKeyData: identity?.publicKeyData || '',
fingerprint: identity?.fingerprint || '',
/* Never the photograph. The relay keeps no use for it — the presence table
   does not carry avatars — and the copy it kept was cut at 100,000
   characters and then handed to anybody who asked for the peer list, where
   it overwrote the whole picture a profile card had delivered: half a
   photograph on every contact's screen, and everybody's photograph for
   strangers on the same relay. Avatars travel on the profile card only. */
avatarData: '',
mood: String(chatState.profile.mood || '').slice(0, 40),
prekeyId: prekey?.id || '',
prekeyPublic: prekey?.publicKeyData || '',
prekeyExpiresAt: prekey?.expiresAt || '',
/* What this build reads (51-envelope-privacy.js): a contact's device uses it
   to decide whether to seal the sender of what it queues here. */
caps: typeof LOCAL_CAPS !== 'undefined' ? LOCAL_CAPS.slice() : [],
/* A hint, and marked as one at the other end. A hello is not signed, so the
   relay forwarding it can write whatever it likes here -- which is exactly
   why the receiving side files it under the lowest rank and will not route
   on it. It is still worth sending: it is how somebody learns their contact
   has moved, and prompts them to ask for a fresh card. */
homeRelay: myHomeRelay(),
/* Which install is speaking: two devices of the same account share the
   fingerprint but never the device id, and the peers table uses this to
   tell them apart. */
deviceId: typeof getDeviceId === 'function' ? getDeviceId() : '',
}));
/* Push is NOT armed from here any more. Subscribing on every hello meant the
   relay was handed a device record before the user had been told that a push
   service is a third party in the path; it is now a switch in Settings that
   asks first. This call only refreshes a subscription the user already chose,
   and returns immediately when they did not. */
registerChatPush(false).catch((error) => console.warn('Web Push refresh skipped:', error));
/* Groups this device owns hand their members everybody's cards, once per
   session, so a group made before member cards existed heals by itself. */
if (typeof healGroupsWithMemberCards === 'function') healGroupsWithMemberCards();
/* After the identity challenge has had its round trip: the beacon store
   answers only a proven socket. */
if (typeof startDeviceBeacon === 'function') window.setTimeout(startDeviceBeacon, 4000);
/* The relay's other addresses, learnt while this one works (52-relay-mirrors.js). */
if (typeof learnRelayMirrors === 'function') window.setTimeout(() => { learnRelayMirrors().catch(() => {}); }, 7000);
}
function ackRelayMessage(relayId) {
if (!relayId || chatState.ws?.readyState !== WebSocket.OPEN) return;
/* Acknowledged at once, whether or not this account has other devices. A
   device with siblings used to hold its acknowledgements while any sibling
   was away, which made the relay keep every message — file chunks included —
   until the last device came back: the mailbox became a sync store. A sibling
   that was away now gets these messages from a sibling, device to device
   (44-device-beacon.js), and the relay keeps nothing for it. */
chatState.ws.send(JSON.stringify({ type: 'relay-ack', ids: [relayId] }));
}
/* The sibling came back: everything held for them can be acked now — they
   drained their own window on connect, and the live frames reach everyone
   that is here. */
function flushDeferredMailAcks() {
const held = chatState.deferredMailAcks || [];
if (!held.length || chatState.ws?.readyState !== WebSocket.OPEN) return;
const batch = held.splice(0, 500);
chatState.ws.send(JSON.stringify({ type: 'relay-ack', ids: batch }));
if (held.length) flushDeferredMailAcks();
}
function clearReconnectTimer() {
if (chatState.reconnectTimer) {
clearTimeout(chatState.reconnectTimer);
chatState.reconnectTimer = null;
}
}
// Exponential backoff with jitter. Without the jitter every client that lost
// the relay at the same instant comes back at the same instant and knocks it
// over again, which is what turned a single blip into a reconnect storm.
function backoffDelay(attempt, base = 1200, cap = 15000) {
const ceiling = Math.min(cap, base * (2 ** Math.min(attempt, 6)));
return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}
// Mobile transports hiccup constantly; only speak up once we have genuinely
// been failing for a while, otherwise every lift ride raises a red toast.
function notifyTransportTrouble(message) {
const now = Date.now();
if (now - (chatState.lastTransportNoticeAt || 0) < 60000) return;
chatState.lastTransportNoticeAt = now;
notify(message, 'warning');
}
function clearPeerHealTimers() {
if (chatState.peerHealTimer) {
clearTimeout(chatState.peerHealTimer);
chatState.peerHealTimer = null;
}
if (chatState.peerVerifyTimer) {
clearTimeout(chatState.peerVerifyTimer);
chatState.peerVerifyTimer = null;
}
}
