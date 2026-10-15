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
   Live location: a position that keeps itself current for a chosen time.
   ============================================================================

   One card is sent — an ordinary encrypted 'rich' message, kind
   'live-location', with the time it ends — and then small encrypted updates
   move the pin on it. The updates are not messages: they are never written
   as entries, never stored by a relay for somebody who is away for longer
   than it takes to deliver them, and never ring a phone.

   The rules that decide what leaves the device:

     - the sender chooses 15 minutes, an hour or eight hours, and can stop it
       at any moment; at the end the share stops by itself and says so;
     - an update goes when the device has moved 25 m, or once a minute while
       it stands still, never more often than every 15 seconds;
     - over a live channel each update goes straight across; to somebody who
       is not connected, at most one update per five minutes is queued, so a
       mailbox never fills with a trail of positions;
     - closing the app ends the share — it does not resume by itself on the
       next start, where nobody would remember having left it running.

   No map tiles are fetched (see the location card in 05): the card draws its
   own marker, and opening a map is a link the person has to press.

   On the receiving side an update is accepted only for a card that arrived
   from the same sender, only with a newer timestamp than the last, and only
   with coordinates that are coordinates.
   ============================================================================ */

const LIVE_LOCATION_DURATIONS = [
  { ms: 15 * 60 * 1000, fa: '۱۵ دقیقه', en: '15 minutes' },
  { ms: 60 * 60 * 1000, fa: '۱ ساعت', en: '1 hour' },
  { ms: 8 * 60 * 60 * 1000, fa: '۸ ساعت', en: '8 hours' },
];
const LIVE_MIN_INTERVAL_MS = 15000;
const LIVE_HEARTBEAT_MS = 60000;
const LIVE_MOVE_METERS = 25;
const LIVE_OFFLINE_INTERVAL_MS = 5 * 60 * 1000;
const LIVE_MAX_DURATION_MS = 8 * 60 * 60 * 1000 + 60000;

const liveShares = new Map();

function liveCoords(position) {
  const { latitude, longitude, accuracy } = position.coords;
  return {
    lat: Number(latitude.toFixed(6)),
    lng: Number(longitude.toFixed(6)),
    accuracy: Math.round(accuracy || 0),
    at: new Date().toISOString(),
  };
}
function metersBetween(a, b) {
  if (!a || !b) return Infinity;
  const r = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}
function liveLocationActive(rich) {
  return Boolean(rich) && !rich.stopped && Date.parse(rich.until || 0) > Date.now();
}
function findLiveEntry(key, shareId) {
  return (chatState.history[key] || []).find((item) => item.id === shareId && item.type === 'rich'
    && (typeof richPayloadOf === 'function' ? richPayloadOf(item) : item.rich)?.kind === 'live-location') || null;
}

/* ---- starting --------------------------------------------------------------- */

function currentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  });
}

async function startLiveLocation() {
  const conversation = getActiveConversation();
  if (!conversation) {
    notify(t('اول یک گفتگو را باز کنید.', 'Open a conversation first.'), 'warning');
    return null;
  }
  if (conversation.type === 'saved' || conversation.system || conversation.clientId === 'system') {
    notify(t('موقعیت زنده در این گفتگو در دسترس نیست.', 'Live location is not available in this conversation.'), 'warning');
    return null;
  }
  if (!navigator.geolocation) {
    notify(t('این دستگاه موقعیت‌یابی ندارد.', 'This device has no geolocation.'), 'warning');
    return null;
  }
  const choice = await PoorijaDialogs.choose(
    t('موقعیت زنده تا چه مدت فرستاده شود؟ هر وقت بخواهید می‌توانید زودتر متوقفش کنید.', 'Share your live location for how long? You can stop it earlier at any time.'),
    LIVE_LOCATION_DURATIONS.map((item) => ({ value: String(item.ms), label: t(item.fa, item.en) })),
    { title: t('موقعیت زنده', 'Live location'), cancelLabel: t('انصراف', 'Cancel') },
  );
  const durationMs = Number(choice);
  if (!durationMs) return null;
  let first;
  try {
    first = liveCoords(await currentPosition());
  } catch (error) {
    notify(error?.code === 1
      ? t('اجازهٔ دسترسی به موقعیت داده نشد.', 'Location permission was denied.')
      : t('موقعیت در دسترس نیست.', 'Location is unavailable.'), 'warning');
    return null;
  }
  return beginLiveShare(conversation, first, durationMs);
}

async function beginLiveShare(conversation, first, durationMs) {
  const key = getConversationKey(conversation);
  const until = new Date(Date.now() + Math.min(durationMs, LIVE_MAX_DURATION_MS)).toISOString();
  const before = new Set((chatState.history[key] || []).map((item) => item.id));
  await sendRichMessage('live-location', { ...first, until, live: true, sharedBy: getDeviceId() });
  const entry = (chatState.history[key] || []).find((item) => !before.has(item.id) && item.type === 'rich'
    && richPayloadOf(item)?.kind === 'live-location' && item.direction === 'out');
  if (!entry) return null;
  const share = {
    id: entry.id,
    key,
    until: Date.parse(until),
    last: first,
    lastSentAt: Date.now(),
    lastRelayAt: Date.now(),
    latest: first,
    watchId: null,
    stopTimer: null,
    deferTimer: null,
    heartbeatTimer: null,
  };
  liveShares.set(entry.id, share);
  try {
    share.watchId = navigator.geolocation.watchPosition(
      (position) => onLivePosition(share, liveCoords(position)),
      () => { /* a lost fix is not the end of the share: the last position stands */ },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
  } catch (_error) { share.watchId = null; }
  share.stopTimer = window.setTimeout(() => stopLiveLocation(entry.id, 'expired'), share.until - Date.now());
  /* Standing still produces no new fix; the heartbeat keeps "updated just
     now" honest on the other side. */
  share.heartbeatTimer = window.setInterval(() => maybeSendLive(share, { heartbeat: true }), LIVE_HEARTBEAT_MS);
  notify(t('موقعیت زنده فرستاده می‌شود.', 'Live location is being shared.'), 'success');
  return entry.id;
}

/* ---- keeping it current ------------------------------------------------------ */

function onLivePosition(share, coords) {
  if (!liveShares.has(share.id)) return;
  if (Date.now() >= share.until) { stopLiveLocation(share.id, 'expired'); return; }
  const entry = findLiveEntry(share.key, share.id);
  const rich = entry ? richPayloadOf(entry) : null;
  if (!rich || rich.stopped) { stopLiveLocation(share.id, 'gone'); return; }
  Object.assign(rich, { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy, at: coords.at });
  entry.rich = rich;
  share.latest = coords;
  maybeSendLive(share);
}

/* Decides whether the newest fix goes now, later, or not at all. A move that
   lands inside the minimum interval is not dropped: it goes when the
   interval is up, so the last position a person stopped at is the one the
   other side ends up seeing. */
function maybeSendLive(share, { heartbeat = false } = {}) {
  if (!liveShares.has(share.id)) return;
  const coords = share.latest || share.last;
  if (!coords) return;
  const since = Date.now() - share.lastSentAt;
  const moved = metersBetween(share.last, coords);
  if (!heartbeat && moved < LIVE_MOVE_METERS && since < LIVE_HEARTBEAT_MS) return;
  if (heartbeat && since < LIVE_HEARTBEAT_MS) return;
  if (since < LIVE_MIN_INTERVAL_MS) {
    if (!share.deferTimer) {
      share.deferTimer = window.setTimeout(() => {
        share.deferTimer = null;
        maybeSendLive(share);
      }, LIVE_MIN_INTERVAL_MS - since + 50);
    }
    return;
  }
  const fresh = { ...coords, at: heartbeat ? new Date().toISOString() : coords.at };
  share.last = fresh;
  share.lastSentAt = Date.now();
  const entry = findLiveEntry(share.key, share.id);
  const rich = entry ? richPayloadOf(entry) : null;
  if (rich) { rich.at = fresh.at; entry.rich = rich; }
  storeHistory();
  refreshLiveCards();
  sendLiveUpdate(share, { lat: fresh.lat, lng: fresh.lng, accuracy: fresh.accuracy, at: fresh.at }).catch(() => {});
}

async function liveRichSignal(member, body, extra = {}, { allowQueue = true } = {}) {
  let session = await ensureStoredSession(member);
  if (!session?.cryptoKey) session = await ensureDirectSession(member, { silent: true });
  if (!session?.cryptoKey) return false;
  const payload = await encryptForSession(session, new TextEncoder().encode(JSON.stringify(body)));
  const outbound = { type: 'rich', id: generateId('live'), createdAt: new Date().toISOString(), payload, ...extra };
  if (session.connection?.open && safeConnectionSend(session.connection, outbound, 'live-location')) return true;
  if (!allowQueue) return false;
  return Boolean(await sendSealedRelay(member, session, outbound, { createdAt: outbound.createdAt, notify: false, scope: extra.spaceId ? 'group' : '' }));
}

async function sendLiveUpdate(share, fields, { final = false } = {}) {
  const conversation = typeof conversationRecordById === 'function' ? conversationRecordById(share.key) : null;
  if (!conversation) return;
  const body = { kind: 'live-location-update', shareId: share.id, ...fields };
  /* Somebody not connected gets at most one queued position per window —
     the last word, a stop, always goes. */
  const mayQueue = final || Date.now() - share.lastRelayAt >= LIVE_OFFLINE_INTERVAL_MS;
  let queued = false;
  if (conversation.type === 'group') {
    const extra = {
      spaceId: conversation.conversationId,
      spaceType: 'group',
      spaceName: conversation.name,
      members: normalizeSpaceMembers(conversation.members),
      senderName: chatState.profile.name || '',
      senderPeerId: chatState.peerId || '',
      senderFingerprint: chatState.identity?.fingerprint || '',
    };
    for (const memberKey of groupDeliveryMemberKeys(conversation)) {
      const member = findPeerByAnyKey(memberKey);
      if (!member?.publicKeyData || isSelfPeerRecord(member)) continue;
      const live = Boolean(chatState.sessions.get(member.peerId)?.connection?.open);
      if (await liveRichSignal(member, body, extra, { allowQueue: mayQueue }) && !live) queued = true;
    }
  } else {
    const live = Boolean(chatState.sessions.get(conversation.peerId)?.connection?.open);
    if (await liveRichSignal(conversation, body, {}, { allowQueue: mayQueue || peerLooksOnline(conversation) }) && !live) queued = true;
  }
  if (queued) share.lastRelayAt = Date.now();
}

/* ---- stopping ---------------------------------------------------------------- */

/* Every share going to a conversation that is being deleted, ended without
   the closing update: the deletion is this device's business, and the other
   side hears nothing about it. Their card ends on its own when its time runs
   out. */
function stopLiveSharesFor(names) {
  for (const share of Array.from(liveShares.values())) {
    if (share?.key && names.has(share.key)) stopLiveLocation(share.id, 'deleted', { silent: true });
  }
}

function stopLiveLocation(shareId, reason = 'stopped', { silent = false } = {}) {
  const share = liveShares.get(shareId);
  if (share) {
    if (share.watchId !== null) { try { navigator.geolocation.clearWatch(share.watchId); } catch (_error) { /* gone */ } }
    if (share.stopTimer) window.clearTimeout(share.stopTimer);
    if (share.deferTimer) window.clearTimeout(share.deferTimer);
    if (share.heartbeatTimer) window.clearInterval(share.heartbeatTimer);
    liveShares.delete(shareId);
  }
  if (silent) return Boolean(share);
  const key = share?.key || Object.keys(chatState.history || {}).find((k) => findLiveEntry(k, shareId));
  const entry = key ? findLiveEntry(key, shareId) : null;
  const rich = entry ? richPayloadOf(entry) : null;
  if (!rich || rich.stopped) return false;
  rich.stopped = true;
  rich.stoppedAt = new Date().toISOString();
  rich.stopReason = reason;
  entry.rich = rich;
  storeHistory();
  refreshLiveCards();
  sendLiveUpdate(share || { id: shareId, key, lastRelayAt: 0 }, { stopped: true, at: rich.stoppedAt }, { final: true }).catch(() => {});
  return true;
}

/* A share this device started and is no longer watching — the app was
   closed and opened again — is ended rather than resumed. */
function endOrphanedLiveShares() {
  if (typeof isUnlocked === 'function' && !isUnlocked()) return;
  const mine = getDeviceId();
  for (const entries of Object.values(chatState.history || {})) {
    for (const entry of entries || []) {
      if (entry?.type !== 'rich' || entry.direction !== 'out') continue;
      const rich = richPayloadOf(entry);
      if (rich?.kind !== 'live-location' || rich.stopped || rich.sharedBy !== mine) continue;
      if (liveShares.has(entry.id)) continue;
      if (!liveLocationActive(rich)) {
        rich.stopped = true;
        rich.stopReason = 'expired';
        entry.rich = rich;
        storeHistory();
        continue;
      }
      stopLiveLocation(entry.id, 'app-closed');
    }
  }
}

/* ---- receiving ----------------------------------------------------------------- */

function applyLiveLocationUpdate(historyKey, body, session) {
  const entry = findLiveEntry(historyKey, String(body?.shareId || ''));
  if (!entry || entry.direction !== 'in') return false;
  /* In a group the card names who sent it, and only that sender moves its
     pin: both sides of the comparison must be known, or nothing moves. In a
     conversation the thread itself is the sender's (historyKey came from
     the session that delivered this). */
  const senderFp = typeof authenticatedSenderOf === 'function' ? authenticatedSenderOf(session) : (session?.remoteFingerprint || '');
  const isGroupThread = (chatState.spaces?.groups || []).some((space) => space.conversationId === historyKey);
  if (isGroupThread && (!entry.senderFingerprint || !senderFp || entry.senderFingerprint !== senderFp)) return false;
  if (!isGroupThread && entry.senderFingerprint && senderFp && entry.senderFingerprint !== senderFp) return false;
  const rich = richPayloadOf(entry);
  if (!rich || rich.stopped) return false;
  const at = Date.parse(body.at || 0);
  if (!Number.isFinite(at) || at > Date.now() + 120000) return false;
  if (Date.parse(rich.at || 0) >= at) return false;
  if (body.stopped) {
    rich.stopped = true;
    rich.stoppedAt = new Date(at).toISOString();
  } else {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
    rich.lat = Number(lat.toFixed(6));
    rich.lng = Number(lng.toFixed(6));
    rich.accuracy = Math.max(0, Math.min(100000, Math.round(Number(body.accuracy) || 0)));
    rich.at = new Date(at).toISOString();
    if (Date.parse(rich.until || 0) <= Date.now()) rich.stopped = true;
  }
  entry.rich = rich;
  storeHistory();
  if (chatState.activeConversationId === historyKey) renderMessages();
  return true;
}

/* ---- drawing ------------------------------------------------------------------- */

function liveAgoText(at) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(at || 0)) / 1000));
  if (seconds < 45) return t('همین حالا', 'just now');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t(`${minutes} دقیقه پیش`, `${minutes} min ago`);
  return t(`${Math.round(minutes / 60)} ساعت پیش`, `${Math.round(minutes / 60)} h ago`);
}

function liveLocationCardHtml(entry, { bubbleClassName, senderHtml = '', reactionToolbar = '', meta = '', mine = false }) {
  const rich = richPayloadOf(entry) || {};
  const lat = Number(rich.lat);
  const lng = Number(rich.lng);
  const coordsOk = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const accuracy = Math.max(0, Math.round(Number(rich.accuracy) || 0));
  const active = liveLocationActive(rich);
  const maps = coordsOk ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}` : '';
  const until = new Date(rich.until || 0);
  const untilText = Number.isNaN(until.getTime()) ? '' : until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const id = app().escapeHTML(String(entry.id || ''));
  const canStop = mine && active && liveShares.has(entry.id);
  return `
<div class="${bubbleClassName} chat-location-bubble chat-live-location ${active ? 'is-live' : 'is-ended'}" data-id="${id}">
${senderHtml}
<div class="chat-location">
<div class="chat-location-map" aria-hidden="true">
<span class="chat-location-grid"></span>
<span class="chat-location-pin"><i class="fas fa-location-crosshairs"></i></span>
<span class="chat-location-halo" style="--halo: ${Math.min(70, Math.max(18, Math.round(accuracy / 4)))}px"></span>
</div>
<div class="chat-location-body">
<div class="chat-location-title">${active
  ? `<span class="chat-live-dot"></span> ${app().escapeHTML(t('موقعیت زنده', 'Live location'))}`
  : `<i class="fas fa-location-dot"></i> ${app().escapeHTML(t('موقعیت زنده — پایان یافت', 'Live location — ended'))}`}</div>
<div class="chat-location-coords" dir="ltr">${coordsOk ? `${lat}, ${lng}` : '—'}</div>
<div class="chat-location-accuracy" data-live-updated="${id}">${app().escapeHTML(`${t('به‌روزرسانی', 'Updated')} ${liveAgoText(rich.at)}${active && untilText ? ` · ${t('تا', 'until')} ${untilText}` : ''} · ${t(`دقت ${accuracy} متر`, `±${accuracy} m`)}`)}</div>
<div class="chat-location-actions">
${coordsOk ? `<a href="${maps}" target="_blank" rel="noopener noreferrer" class="chat-location-btn"><i class="fas fa-map"></i> ${app().escapeHTML(t('باز کردن در نقشه', 'Open in maps'))}</a>` : ''}
${coordsOk ? `<button type="button" data-chat-copy-coords="${app().escapeHTML(`${lat},${lng}`)}" class="chat-location-btn is-soft"><i class="fas fa-copy"></i> ${app().escapeHTML(t('کپی مختصات', 'Copy coordinates'))}</button>` : ''}
${canStop ? `<button type="button" data-chat-live-stop="${id}" class="chat-location-btn is-stop"><i class="fas fa-circle-stop"></i> ${app().escapeHTML(t('توقف', 'Stop sharing'))}</button>` : ''}
</div>
</div>
</div>
${reactionToolbar}
${meta}
</div>`;
}

/* The "updated … ago" line ages in place; the thread is not redrawn for it. */
function refreshLiveCards() {
  if (chatState.activeConversationId && document.querySelector('#chatMessages .chat-live-location')) renderMessages();
}

document.getElementById('chatMessages')?.addEventListener('click', (event) => {
  const stop = event.target.closest?.('[data-chat-live-stop]');
  if (!stop) return;
  event.preventDefault();
  event.stopPropagation();
  stopLiveLocation(stop.dataset.chatLiveStop || '', 'stopped');
}, true);
document.getElementById('chatLiveLocationBtn')?.addEventListener('click', () => { startLiveLocation().catch(console.error); });

window.setInterval(() => {
  const live = document.querySelector('#chatMessages .chat-live-location.is-live');
  if (live) refreshLiveCards();
  endOrphanedLiveShares();
  for (const share of liveShares.values()) {
    if (Date.now() >= share.until) stopLiveLocation(share.id, 'expired');
  }
}, 30000);
window.setTimeout(endOrphanedLiveShares, 8000);
/* Leaving the page ends every share it was running; the next start does not
   pick them up again. */
window.addEventListener('pagehide', () => {
  for (const id of Array.from(liveShares.keys())) stopLiveLocation(id, 'app-closed');
});

window.startLiveLocation = startLiveLocation;
window.stopLiveLocation = stopLiveLocation;
window.applyLiveLocationUpdate = applyLiveLocationUpdate;
