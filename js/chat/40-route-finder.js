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
   Getting a message to the relay its recipient actually uses.
   ============================================================================

   Three things went wrong between the Finland and the Iran relay, and each of
   them looked, from the sender's chair, like a message that had been sent:

   1. A contact whose home relay this device did not know was written to
      through this device's own relay. That relay had never seen them, queued
      the envelope anyway, answered "queued", and the message showed the
      reassuring "relayed" tick — while it sat in a mailbox its recipient never
      opens. Nothing ever sent it again once the right relay became known.
      The relay now says `known: false` when it queues for a stranger; this
      file treats that as "parked at the wrong place", asks the linked relays
      where the person lives (route-query, one fingerprint, sealed), re-sends
      the parked messages there and withdraws the copies it left behind.

   2. A transit envelope that failed — the link redialling, a slow border — was
      marked failed after three quick tries and waited for the person to press
      send again. The outbox below keeps it queued and re-sends it with
      backoff for up to a day, the moment the link answers again.

   3. A call or a transfer between the two relays needs a TURN server both
      ends can reach; each side only ever had its own. turnServersForContact()
      asks the contact's relay for a short-lived credential (turn-query) so a
      single connection can use both — for that connection only.

   Nothing here gives a relay anything it did not already see: the questions
   name one fingerprint the asker already holds a card for, and they travel
   sealed to the relay they are for, through a carrier that cannot open them.
   ============================================================================ */

/* ---- answers that somebody is waiting for -------------------------------- */

const transitAnswerWaiters = new Map();

/* Resolves with the relay frame that comes back with this tag, or null when
   nothing does in time. */
function awaitTransitAnswer(tag, ms = 15000) {
  if (!tag) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      transitAnswerWaiters.delete(tag);
      resolve(null);
    }, ms);
    transitAnswerWaiters.set(tag, (answer) => {
      window.clearTimeout(timer);
      transitAnswerWaiters.delete(tag);
      resolve(answer);
    });
  });
}

/* Called for every frame the relay sends; true when a waiter took it. */
function settleTransitAnswer(message) {
  const tag = String(message?.tag || '');
  const waiter = tag ? transitAnswerWaiters.get(tag) : null;
  if (!waiter) return false;
  waiter(message);
  return true;
}

function transitQueryTag(kind) {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---- the relays this one is linked with --------------------------------- */

const LINKED_RELAYS_TTL_MS = 5 * 60 * 1000;
let linkedRelaysCache = { at: 0, origin: '', peers: [] };

/* Only relays whose key hashes to their id are kept: the list arrives from our
   own relay over HTTPS, and a key that is not the named relay's would seal a
   question to whoever handed it over. */
async function linkedRelays({ force = false } = {}) {
  const origin = chatServerOrigin();
  if (!force && linkedRelaysCache.origin === origin && Date.now() - linkedRelaysCache.at < LINKED_RELAYS_TTL_MS) {
    return linkedRelaysCache.peers;
  }
  let peers = [];
  try {
    const response = await fetchRelayJson(new URL('/transit-peers', origin), 5000);
    if (response.ok) {
      const body = await response.json();
      for (const entry of Array.isArray(body?.peers) ? body.peers : []) {
        const id = String(entry?.id || '').toLowerCase();
        const key = String(entry?.key || '');
        if (!/^[a-f0-9]{64}$/.test(id) || !key) continue;
        if (!await relayKeyMatchesId(key, id)) continue;
        peers.push({ id, key, origin: String(entry?.origin || '') });
      }
    }
  } catch (_error) { /* an older relay has no list; discovery simply finds nothing */ }
  linkedRelaysCache = { at: Date.now(), origin, peers };
  return peers;
}

/* ---- where does this person live? ---------------------------------------- */

const ROUTE_DISCOVERY_COOLDOWN_MS = 10 * 60 * 1000;
const routeDiscoveries = new Map();

function peerRecordsForFingerprint(fingerprint) {
  if (!fingerprint) return [];
  return (chatState.peers || []).filter((peer) => peer.fingerprint === fingerprint && !peer.type);
}

/* Asks every linked relay, in parallel, whether this fingerprint lives there.
   Resolves with the route it installed, or null. One question per contact at
   a time, and a negative answer is not asked again for ten minutes. */
function discoverHomeRelay(peerRecord, { force = false } = {}) {
  const fingerprint = String(peerRecord?.fingerprint || '');
  if (!fingerprint || peerRecord.type) return Promise.resolve(null);
  if (typeof chatState !== 'undefined' && chatState?.profile?.crossRelayComm === false) return Promise.resolve(null);
  const known = typeof routableHomeRelay === 'function' ? routableHomeRelay(peerRecord) : null;
  if (known && !force) return Promise.resolve(known);
  const previous = routeDiscoveries.get(fingerprint);
  if (previous?.promise) return previous.promise;
  if (!force && previous && Date.now() - previous.at < ROUTE_DISCOVERY_COOLDOWN_MS) return Promise.resolve(previous.found || null);
  const promise = (async () => {
    const relays = await linkedRelays();
    if (!relays.length || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return null;
    const asked = relays.map((relay) => {
      const tag = transitQueryTag('route');
      const answer = awaitTransitAnswer(tag, 15000);
      sendViaTransit({ type: 'route-query', toFingerprint: fingerprint, tag }, { id: relay.id, key: relay.key }, peerRecord);
      return answer.then((reply) => ({ relay, reply }));
    });
    const results = await Promise.all(asked);
    const hit = results.find(({ reply }) => reply?.type === 'route' && reply.home === true && reply.origin);
    if (!hit) return null;
    const home = { origin: hit.reply.origin, id: hit.relay.id, key: hit.relay.key, source: 'presence', updatedAt: new Date().toISOString() };
    applyDiscoveredRoute(fingerprint, home, { override: force });
    return home;
  })().catch((error) => {
    console.warn('[Route] discovery failed:', error?.message || error);
    return null;
  });
  routeDiscoveries.set(fingerprint, { promise, at: Date.now(), found: null });
  promise.then((found) => routeDiscoveries.set(fingerprint, { promise: null, at: Date.now(), found }));
  return promise;
}

/* Written through the trust ladder, so a route a card or a session already
   established is never displaced by one a relay answered. */
function applyDiscoveredRoute(fingerprint, home, { override = false } = {}) {
  const records = peerRecordsForFingerprint(fingerprint);
  let changed = false;
  for (const record of records) {
    const before = typeof routableHomeRelay === 'function' ? routableHomeRelay(record) : null;
    /* A forced rediscovery runs because the relay the stored route names said
       it does not know this person — so that route, however well it was
       established, is the stale one, and the relay that answered "home" wins. */
    const next = override && before && before.id !== home.id
      ? normalizeHomeRelay(home, 'presence')
      : betterHomeRelay(record.homeRelay, home);
    if (next && JSON.stringify(next) !== JSON.stringify(normalizeHomeRelay(record.homeRelay))) {
      record.homeRelay = next;
      changed = true;
    }
    const moved = override && before && before.id !== home.id;
    if ((!before || moved) && routableHomeRelay(record)) noteRouteBecameRoutable(record);
  }
  if (changed) saveContacts();
}

/* The moment a contact's messages can finally be sent the right way. Whatever
   was parked at a relay they never visit goes again, over the link, and the
   parked copies are taken back. Called from every place a route is learned. */
const routeResendInFlight = new Set();
function noteRouteBecameRoutable(peerRecord) {
  const fingerprint = String(peerRecord?.fingerprint || '');
  if (!fingerprint || routeResendInFlight.has(fingerprint)) return;
  routeResendInFlight.add(fingerprint);
  window.setTimeout(() => {
    resendParkedMessages(peerRecord)
      .catch((error) => console.warn('[Route] re-sending parked messages failed:', error?.message || error))
      .finally(() => routeResendInFlight.delete(fingerprint));
  }, 300);
}

/* ---- messages parked at a relay their recipient never visits ------------- */

/* How far back a newly routable contact's unacknowledged messages are sent
   again. A receipt would have moved anything that arrived to delivered; what
   is still short of that after a week is not worth re-sending. */
const PARKED_RESEND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/* The relay queued something for a recipient it has never met. */
function noteQueuedForStranger(message, { carried = false } = {}) {
  const fingerprint = String(message?.toFingerprint || '');
  const tag = String(message?.tag || '');
  if (!fingerprint) return;
  const entryRef = tag ? chatState.pendingRelayTags?.get(tag) : null;
  if (entryRef) {
    const list = chatState.history[entryRef.conversationKey] || [];
    const entry = list.find((item) => item.id === entryRef.messageId);
    if (entry && entry.direction === 'out') {
      entry.parkedFor = Array.from(new Set([...(Array.isArray(entry.parkedFor) ? entry.parkedFor : []), fingerprint]));
      storeHistory();
    }
  }
  const record = peerRecordsForFingerprint(fingerprint)[0] || { fingerprint };
  /* Carried, and still a stranger where it landed: the route this device
     holds is out of date (they moved, or a relay was reinstalled), so it is
     asked again rather than trusted. */
  discoverHomeRelay(record, { force: carried }).then((home) => {
    if (home || !entryRef) return;
    /* Nobody linked to this relay knows them either. The copy stays where it
       is — they may yet come here — and the person is told once, in words,
       what would get the message moving. */
    noteRouteUnknownOnce(entryRef.conversationKey);
  });
}

const routeUnknownWarned = new Set();
function noteRouteUnknownOnce(conversationKey) {
  if (!conversationKey || routeUnknownWarned.has(conversationKey)) return;
  routeUnknownWarned.add(conversationKey);
  notify(t(
    'رلهٔ این مخاطب معلوم نیست؛ پیام روی رلهٔ شما نگه داشته شده تا او وصل شود. اگر روی سرور دیگری است، کارت هویتش را یک بار از او بگیرید.',
    'This contact\'s relay is unknown; the message is held on your relay until they connect. If they use another server, get their identity card once.',
  ), 'warning');
}

/* Outgoing entries for this person that may never have reached them: flagged
   as parked, or simply not yet acknowledged, within the window. */
function parkedEntriesFor(peerRecord) {
  const fingerprint = peerRecord?.fingerprint || '';
  const cutoff = Date.now() - PARKED_RESEND_WINDOW_MS;
  const pending = (entry) => entry?.direction === 'out'
    && ['queued', 'relayed', 'sent', 'failed'].includes(entry.status)
    && Date.parse(entry.createdAt || 0) > cutoff;
  const out = [];
  const directKey = getConversationKey(peerRecord);
  for (const entry of chatState.history[directKey] || []) {
    if (pending(entry) && entry.type === 'text') out.push({ conversationKey: directKey, entry, space: null });
  }
  for (const space of chatState.spaces?.groups || []) {
    const members = groupDeliveryMemberKeys(space).map((key) => findPeerByAnyKey(key)).filter(Boolean);
    if (!members.some((member) => member.fingerprint === fingerprint)) continue;
    for (const entry of chatState.history[space.conversationId] || []) {
      if (entry.direction !== 'out' || entry.type !== 'text' || Date.parse(entry.createdAt || 0) <= cutoff) continue;
      const parked = Array.isArray(entry.parkedFor) && entry.parkedFor.includes(fingerprint);
      if (parked || entry.status === 'queued') out.push({ conversationKey: space.conversationId, entry, space });
    }
  }
  return out;
}

async function resendParkedMessages(peerRecord) {
  const home = transitRouteFor(peerRecord);
  if (!home) return 0;
  const parked = parkedEntriesFor(peerRecord);
  if (!parked.length) return 0;
  let session = await ensureStoredSession(peerRecord);
  if (!session?.cryptoKey) session = await ensureDirectSession(peerRecord, { silent: true });
  if (!session?.cryptoKey) return 0;
  const withdrawTags = [];
  let resent = 0;
  for (const { conversationKey, entry, space } of parked) {
    const outbound = space
      ? await groupTextOutboundFor(space, entry, session)
      : await directTextOutboundFor(entry, session);
    if (!outbound) continue;
    const ok = await sendSealedRelay(peerRecord, session, outbound, {
      createdAt: outbound.createdAt,
      ...(space ? { scope: 'group' } : {}),
    });
    if (!ok) continue;
    resent += 1;
    withdrawTags.push(entry.id);
    if (Array.isArray(entry.parkedFor)) {
      entry.parkedFor = entry.parkedFor.filter((value) => value !== peerRecord.fingerprint);
      if (!entry.parkedFor.length) delete entry.parkedFor;
    }
    if (!space && entry.status === 'failed') entry.status = 'queued';
    if (conversationKey === chatState.activeConversationId) renderMessages();
  }
  if (resent) storeHistory();
  /* The copies left at this relay will never be collected; taking them back
     frees the recipient's mailbox there and keeps the relay from holding
     anything it no longer needs to. */
  if (withdrawTags.length && chatState.ws?.readyState === WebSocket.OPEN) {
    /* A sealed envelope is not filed under its sender, so it is taken back by
       a secret only the sender can derive for that message (51-envelope-privacy.js). */
    const secrets = typeof withdrawSecretFor === 'function'
      ? await Promise.all(withdrawTags.map((tag) => withdrawSecretFor(tag)))
      : [];
    try {
      chatState.ws.send(JSON.stringify({ type: 'relay-withdraw', toFingerprint: peerRecord.fingerprint, tags: withdrawTags, secrets }));
    } catch (_error) { /* retention sweeps them in the end */ }
  }
  if (resent) console.log(`[Route] re-sent ${resent} parked message(s) to ${String(peerRecord.fingerprint).slice(0, 12)} over the relay link`);
  return resent;
}

async function directTextOutboundFor(entry, session) {
  const payload = await encryptForSession(session, new TextEncoder().encode(entry.text || ''));
  return {
    type: 'text',
    id: entry.id,
    createdAt: entry.createdAt || new Date().toISOString(),
    expiresAt: '',
    timerSeconds: Number(entry.timerSeconds || 0),
    replyToId: entry.replyToId || '',
    hidden: Boolean(entry.hidden),
    payload,
  };
}

async function groupTextOutboundFor(space, entry, session) {
  const spacePayload = {
    spaceId: space.conversationId,
    spaceType: 'group',
    spaceName: space.name,
    members: normalizeSpaceMembers(space.members),
    ownerPeerId: space.ownerPeerId || '',
    ownerClientId: space.ownerClientId || '',
    ownerFingerprint: space.ownerFingerprint || '',
    messageId: entry.id,
    text: entry.text || '',
    senderName: entry.senderName || chatState.profile.name || '',
    senderPeerId: entry.senderPeerId || chatState.peerId || '',
    senderFingerprint: entry.senderFingerprint || chatState.identity?.fingerprint || '',
    createdAt: entry.createdAt,
    expiresAt: '',
    timerSeconds: Number(entry.timerSeconds || 0),
    replyToId: entry.replyToId || '',
    hidden: Boolean(entry.hidden),
  };
  const payload = await encryptForSession(session, new TextEncoder().encode(JSON.stringify(spacePayload)));
  return { id: entry.id, type: 'space-message', createdAt: entry.createdAt, payload };
}

/* ---- the transit outbox -------------------------------------------------- */

/* Envelopes handed to the carrier and not yet answered for, by tag. A
   retryable refusal (the link redialling, a backlog) schedules the same frame
   again — re-sealed, because a seal is single use — with backoff, until it is
   accepted or a day has passed. Only frames that carry a tag can be matched to
   their answer, and only those are kept: a typing flag or an ICE candidate is
   worth nothing late. */
const TRANSIT_RETRY_STEPS_MS = [2000, 5000, 15000, 30000, 60000, 120000, 300000];
const TRANSIT_RETRY_CEILING_MS = 24 * 60 * 60 * 1000;
const TRANSIT_MEDIA_WINDOW = 24;
const transitOutbox = new Map();
let transitOutboxTimer = null;

function trackTransitSend(tag, frame, peerRecord, home) {
  if (!tag || !frame) return;
  const existing = transitOutbox.get(tag);
  transitOutbox.set(tag, {
    frame,
    home: { id: home.id, key: home.key },
    peerId: peerRecord?.peerId || '',
    fingerprint: peerRecord?.fingerprint || frame.toFingerprint || '',
    media: frame?.payload?.class === 'media',
    attempts: existing ? existing.attempts : 0,
    firstAt: existing ? existing.firstAt : Date.now(),
    sentAt: Date.now(),
    nextAt: 0,
  });
  ensureTransitOutboxTimer();
}

function transitTagInFlight(tag) {
  return Boolean(tag && transitOutbox.has(tag));
}

function transitSendSettled(tag) {
  if (tag) transitOutbox.delete(tag);
}

/* A refusal came back for a carried envelope. True when the outbox took it. */
function transitSendRefused(tag, reason) {
  const item = tag ? transitOutbox.get(tag) : null;
  if (!item) return false;
  item.attempts += 1;
  const peerRecord = (chatState.peers || []).find((peer) => peer.peerId === item.peerId)
    || peerRecordsForFingerprint(item.fingerprint)[0] || null;
  /* The far relay would not open it: its key is not the one this contact's
     route names, which happens when that relay was reinstalled. Asking again
     where they live is the fix; the same frame sealed to the same stale key
     never will be. */
  if (reason === 'transit-rejected') {
    if (item.attempts >= 2) {
      transitOutbox.delete(tag);
      markTransitFrameFailed(item, peerRecord, reason);
      if (peerRecord) discoverHomeRelay(peerRecord, { force: true });
      return true;
    }
  }
  if (Date.now() - item.firstAt > TRANSIT_RETRY_CEILING_MS) {
    transitOutbox.delete(tag);
    markTransitFrameFailed(item, peerRecord, reason);
    return true;
  }
  const step = TRANSIT_RETRY_STEPS_MS[Math.min(item.attempts - 1, TRANSIT_RETRY_STEPS_MS.length - 1)];
  item.nextAt = Date.now() + step;
  noteTransitLinkTroubleOnce(peerRecord);
  ensureTransitOutboxTimer();
  return true;
}

function markTransitFrameFailed(item, peerRecord, reason) {
  const conversationKey = peerRecord ? getConversationKey(peerRecord) : '';
  const messageId = String(item.frame?.payload?.tag || item.frame?.tag || '');
  if (!conversationKey || !messageId) return;
  const entry = (chatState.history[conversationKey] || []).find((candidate) => candidate.id === messageId);
  if (!entry || entry.status === 'failed') return;
  entry.status = 'failed';
  entry.failureReason = reason || 'transit-down';
  storeHistory();
  if (chatState.activeConversationId === conversationKey) renderMessages();
}

/* Said once per conversation per session, and as what it is: a delay, not a
   loss. The message is still queued and goes by itself when the link is back. */
const transitTroubleWarned = new Set();
function noteTransitLinkTroubleOnce(peerRecord) {
  const key = peerRecord ? getConversationKey(peerRecord) : '';
  if (!key || transitTroubleWarned.has(key)) return;
  transitTroubleWarned.add(key);
  if (typeof notify === 'function') {
    notify(t(
      'ارتباط بین دو رله لحظه‌ای قطع است؛ پیام در صف ماند و به‌محض برقراری دوباره خودکار فرستاده می‌شود.',
      'The link between the two relays is down for a moment; the message is queued and goes by itself as soon as it is back.',
    ), 'info');
  }
}

function ensureTransitOutboxTimer() {
  if (transitOutboxTimer) return;
  transitOutboxTimer = window.setInterval(pumpTransitOutbox, 1000);
}

/* Anything waiting is brought forward the moment a carried envelope is
   answered: an answer is the best evidence there is that the link is up. */
function transitLinkAnswered() {
  const now = Date.now();
  for (const item of transitOutbox.values()) {
    if (item.nextAt && item.nextAt > now + 1000) item.nextAt = now + 250;
  }
}

function pumpTransitOutbox() {
  if (!transitOutbox.size) {
    window.clearInterval(transitOutboxTimer);
    transitOutboxTimer = null;
    return;
  }
  if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  for (const [tag, item] of transitOutbox) {
    /* An answer that never came: the carrier's own wait is a minute, so two
       minutes of silence means the frame and its answer are both gone. */
    if (!item.nextAt && now - item.sentAt > 120000) {
      transitSendRefused(tag, 'transit-unavailable');
      continue;
    }
    if (!item.nextAt || item.nextAt > now) continue;
    item.nextAt = 0;
    item.sentAt = now;
    const peerRecord = (chatState.peers || []).find((peer) => peer.peerId === item.peerId) || null;
    const home = (peerRecord && transitRouteFor(peerRecord)) || item.home;
    sendViaTransit(item.frame, home, peerRecord, { retry: true });
  }
}

/* How many media frames are still unanswered towards one relay. A file is a
   stream of chunks, and handing all of them to the carrier at once is how a
   slow border turned into hundreds of envelopes refused together. */
function transitMediaInFlight(relayId) {
  let count = 0;
  for (const item of transitOutbox.values()) {
    if (item.media && item.home?.id === relayId && !item.nextAt) count += 1;
  }
  return count;
}
async function awaitTransitWindow(relayId, timeoutMs = 120000) {
  const started = Date.now();
  while (transitMediaInFlight(relayId) >= TRANSIT_MEDIA_WINDOW) {
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return true;
}

/* ---- TURN for a connection that crosses relays --------------------------- */

const farTurnCache = new Map();

/* An ICE server entry for the contact's home relay TURN, or null. Used by a
   single connection and never written into the profile: the device's own
   TURN stays its own, and this one lasts as long as the call or transfer that
   asked for it. */
async function turnServersForContact(peerRecord) {
  const home = transitRouteFor(peerRecord);
  if (!home) return null;
  const cached = farTurnCache.get(home.id);
  if (cached && cached.expiresAt - 60000 > Date.now()) return cached.server;
  if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return cached?.server || null;
  const tag = transitQueryTag('turn');
  const answer = awaitTransitAnswer(tag, 8000);
  sendViaTransit({ type: 'turn-query', tag }, home, peerRecord);
  const reply = await answer;
  if (reply?.type !== 'turn' || !reply.enabled || !Array.isArray(reply.urls) || !reply.urls.length
    || !reply.username || !reply.credential) {
    return cached?.server || null;
  }
  const server = { urls: reply.urls.slice(0, 6), username: reply.username, credential: reply.credential };
  const expiresAt = Number(reply.expiresAt) > Date.now() ? Number(reply.expiresAt) : Date.now() + 30 * 60 * 1000;
  farTurnCache.set(home.id, { server, expiresAt });
  return server;
}

/* While an offline ring is waiting for somebody on another relay, ask their
   relay every few seconds whether they are back — presence is the only way
   the arrival can be noticed from here, and the ring lasts thirty seconds. */
function keepAskingWhileRinging(peerRecord) {
  if (!peerRecord?.fingerprint) return;
  const timer = window.setInterval(() => {
    if (chatState.offlineRing?.peerId !== peerRecord.peerId) {
      window.clearInterval(timer);
      return;
    }
    askIfPeerIsThere(peerRecord, { force: true });
  }, 3000);
}

window.discoverHomeRelay = discoverHomeRelay;
window.turnServersForContact = turnServersForContact;
