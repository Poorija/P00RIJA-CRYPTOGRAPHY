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
   Guest mode: another relay of the family while home is unreachable
   ============================================================================

   When the home relay — the configured address, and every backup address and
   front door of it (52-relay-mirrors.js) — has been unreachable for a while,
   the app stays temporarily on another relay of the same operator's signed
   family (61-relay-directory.js) that it can actually reach from where it is.
   It keeps its identity, and it stays a guest: the configured address is never
   overwritten, the card it hands out still names home, and the guest relay
   never claims it as a resident. Home is tried again every minute, and the app
   goes back by itself after two proofs in a row.

   Only relays the operator marked `guests: true` in the signed list are tried,
   at most eight, in parallel, each proven to hold the key the list names. The
   one in home's cluster comes first, then one in home's region, then the
   fastest. A relay filtered for this person does not answer, so it never
   ranks.
   ============================================================================ */

const GUEST_DEFAULTS = {
  downMs: 120000,
  fastProofMs: 8000,
  probeMs: 6000,
  refusedSkipMs: 10 * 60 * 1000,
  homeCheckMs: 60000,
  tickMs: 10000,
  routeMs: 30 * 60 * 1000,
  moveAfterMs: 3 * 24 * 60 * 60 * 1000,
  remindMs: 3 * 24 * 60 * 60 * 1000,
  declineMs: 30 * 24 * 60 * 60 * 1000,
  siblingWaitMs: 30 * 24 * 60 * 60 * 1000,
  siblingRecentMs: 7 * 24 * 60 * 60 * 1000,
};
const GUEST_MAX_CANDIDATES = 8;
const GUEST_HOME_PROOFS = 2;
const GUEST_NOTICE_MS = 24 * 60 * 60 * 1000;

/* Every timing in one place, so the suites can shorten them. */
function guestTiming(name) {
  const override = Number(window.__POORIJA_GUEST_TIMINGS__?.[name]);
  return Number.isFinite(override) && override > 0 ? override : GUEST_DEFAULTS[name];
}

const guestModeState = {
  refused: new Map(),
  queue: [],
  homeProofs: 0,
  downSince: 0,
  lastHomeCheck: 0,
  running: false,
  allRefused: false,
  homeUp: null,
  startChecked: false,
};

function guestStayActive() {
  const stay = chatState.profile?.activeGuest;
  return Boolean(stay && stay.origin && stay.homeOrigin === configuredRelayOrigin());
}

function guestDirectory() {
  return chatState.profile?.relayDirectory?.body || null;
}

function guestHomeEntry() {
  const homeId = relayPinFor(configuredRelayOrigin())?.id || '';
  return (guestDirectory()?.relays || []).find((relay) => relay.id === homeId) || null;
}

/* Family relays that take guests, other than home, revoked ones, and those
   that refused this device in the last ten minutes. */
function guestCandidates({ exclude = [] } = {}) {
  const directory = guestDirectory();
  const homeId = relayPinFor(configuredRelayOrigin())?.id || '';
  if (!directory || !homeId) return [];
  const revoked = new Set(directory.revoked || []);
  const now = Date.now();
  return (directory.relays || [])
    .filter((relay) => relay.guests === true && relay.id !== homeId && !revoked.has(relay.id) && !exclude.includes(relay.id)
      && !(now - (guestModeState.refused.get(relay.id) || 0) < guestTiming('refusedSkipMs')))
    .slice(0, GUEST_MAX_CANDIDATES);
}

function guestPreconditionsMet() {
  if (chatState.profile?.useGuestRelays === false) return false;
  if (chatState.manualOffline || chatState.profile?.chatEnabled === false) return false;
  if (navigator.onLine === false) return false;
  if (!guestHomeEntry()) return false;
  return guestCandidates().length > 0;
}

/* A cluster mate is tried at its inside addresses first, as relays dial each
   other (scripts/lib/relay-directory.js); anyone else at its public ones.
   Only https: the proof of the relay's key is made over HTTP requests, and
   nothing binds it to the socket that follows, so over plain http on a
   private network whoever sits in the middle could pass the proof through.
   Plain http is left for this machine itself, which is how it is tested. */
function guestOriginUsable(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && isLocalRelayHostname(url.hostname)) return url.origin;
  } catch (_error) { /* not an address */ }
  return '';
}
function guestCandidateOrigins(relay, home) {
  const sameCluster = Boolean(home?.cluster && relay.cluster === home.cluster);
  const ordered = sameCluster ? [...(relay.inside || []), ...(relay.origins || [])] : [...(relay.origins || []), ...(relay.inside || [])];
  return Array.from(new Set(ordered.map(guestOriginUsable).filter(Boolean)));
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => window.setTimeout(() => resolve(null), ms))]);
}

/* Reachable from here, and holding the key the list names. */
async function probeGuestCandidate(relay, home) {
  const attempt = async () => {
    for (const origin of guestCandidateOrigins(relay, home)) {
      const started = performance.now();
      const health = await fetchRelayJson(new URL('/chat-health', origin), guestTiming('probeMs'));
      if (!health?.ok) continue;
      const answer = await fetchRelayJson(new URL('/relay-identity', origin), guestTiming('probeMs'));
      if (!answer?.ok) continue;
      let identity = null;
      try { identity = await verifiedRelayIdentity(await answer.json(), null); } catch (_error) { identity = null; }
      if (!identity || identity.id !== relay.id) continue;
      if (await proveRelayAt(origin, { id: relay.id, publicKey: identity.publicKey })) {
        return { relay, origin, identity, ms: performance.now() - started };
      }
    }
    return null;
  };
  return withTimeout(attempt().catch(() => null), guestTiming('probeMs') * 2);
}

function rankGuestCandidates(found, home) {
  const score = (entry) => [
    home?.cluster && entry.relay.cluster === home.cluster ? 0 : 1,
    home?.region && entry.relay.region === home.region ? 0 : 1,
    entry.ms,
  ];
  return found.slice().sort((a, b) => {
    const x = score(a);
    const y = score(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
}

function guestB64(buffer) {
  let text = '';
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
  return btoa(text);
}

/* The person's own word that this device is a guest at G until then: the
   guest relay hands it to home, and home sends a copy of their mail there
   (the case of a home filtered for this one person). */
async function signGuestStatement(statement) {
  const key = await importIdentitySigningKey();
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(directoryCanonicalJson(statement)));
  return { statement, sig: guestB64(signature) };
}
async function makeGuestNotice(homeId, guestId) {
  const at = Date.now();
  try {
    return await signGuestStatement({
      v: 1, type: 'guest-at', fp: chatState.identity?.fingerprint || '', deviceId: getDeviceId(), home: homeId, guest: guestId, at, until: at + GUEST_NOTICE_MS,
    });
  } catch (error) {
    console.warn('[Guest] the notice could not be signed:', error?.message || error);
    return null;
  }
}

/* The smaller statement senders are handed: this person is at G until then,
   with no device and no home in it. */
async function makeGuestRoute(guestId) {
  try {
    return await signGuestStatement({ v: 1, type: 'guest-route', fp: chatState.identity?.fingerprint || '', guest: guestId, until: Date.now() + GUEST_NOTICE_MS });
  } catch (_error) {
    return null;
  }
}

function reconnectRelayTransport(delayMs = 0) {
  window.setTimeout(() => {
    try { chatState.ws?.close(); } catch (_error) { /* gone */ }
    chatState.ws = null;
    chatState.shouldReconnect = true;
    connectChatTransport().catch(console.error);
  }, delayMs);
}

async function enterGuestStay(found) {
  const configured = configuredRelayOrigin();
  const pin = relayPinFor(configured);
  if (!pin?.id) return false;
  recordRelayPin(found.origin, found.identity);
  const notice = await makeGuestNotice(pin.id, found.relay.id);
  const route = await makeGuestRoute(found.relay.id);
  chatState.profile.activeGuest = {
    home: pin.id, homeOrigin: configured, id: found.relay.id, key: found.identity.publicKey, origin: found.origin,
    name: String(found.relay.name || ''), since: Date.now(), until: 0, notice, route,
  };
  chatState.profile.lastGuest = { id: found.relay.id, origin: found.origin };
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  guestModeState.homeProofs = 0;
  guestModeState.downSince = 0;
  guestModeState.homeUp = null;
  const name = found.relay.name || new URL(found.origin).host;
  notify(t(`رلهٔ خانهٔ شما در دسترس نیست؛ موقتاً از رلهٔ ${name} از همان خانواده استفاده می‌شود.`,
    `Your home relay is unreachable; temporarily using relay ${name} of the same family.`), 'info');
  if (typeof renderGuestState === 'function') renderGuestState();
  reconnectRelayTransport();
  return true;
}

/* Back home, or off guest mode: G is told first when it can be. */
function leaveGuestStay({ sendEnd = true, reason = 'home' } = {}) {
  if (!chatState.profile.activeGuest) return false;
  if (sendEnd && chatState.ws?.readyState === WebSocket.OPEN) {
    try { chatState.ws.send(JSON.stringify({ type: 'guest-end' })); } catch (_error) { /* gone */ }
  }
  if (typeof guestLeaving === 'function') guestLeaving(chatState.profile.activeGuest);
  chatState.profile.activeGuest = null;
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  guestModeState.homeProofs = 0;
  guestModeState.downSince = 0;
  guestModeState.homeUp = null;
  if (reason === 'home') {
    notify(t('رلهٔ خانهٔ شما دوباره در دسترس است؛ اتصال به آن برگشت.', 'Your home relay is reachable again; switched back to it.'), 'info');
  }
  if (typeof renderGuestState === 'function') renderGuestState();
  reconnectRelayTransport(sendEnd ? 300 : 0);
  return true;
}

async function becomeGuest({ exclude = [] } = {}) {
  if (guestModeState.running) return false;
  guestModeState.running = true;
  try {
    if (!guestPreconditionsMet()) return false;
    const home = guestHomeEntry();
    const candidates = guestCandidates({ exclude });
    const found = (await Promise.all(candidates.map((relay) => probeGuestCandidate(relay, home)))).filter(Boolean);
    let ranked = rankGuestCandidates(found, home);
    /* The relay that took this device last time is tried first. */
    const last = chatState.profile.lastGuest?.id;
    const lastAt = ranked.findIndex((entry) => entry.relay.id === last);
    if (lastAt > 0) ranked = [ranked[lastAt], ...ranked.slice(0, lastAt), ...ranked.slice(lastAt + 1)];
    if (!ranked.length) return false;
    guestModeState.queue = ranked.slice(1);
    guestModeState.allRefused = false;
    return await enterGuestStay(ranked[0]);
  } finally {
    guestModeState.running = false;
  }
}

function guestHelloFields() {
  if (!guestStayActive()) return {};
  const stay = chatState.profile.activeGuest;
  const roster = typeof currentRoster === 'function' ? currentRoster() : null;
  return {
    guestOf: stay.home,
    ...(stay.notice?.statement?.until > Date.now() ? { guestNotice: stay.notice } : {}),
    ...(stay.route?.statement?.until > Date.now() ? { guestRoute: stay.route } : {}),
    ...(roster ? { roster } : {}),
  };
}

function handleGuestFrame(message) {
  const type = String(message?.type || '');
  if (type === 'guest-ok') {
    if (!guestStayActive()) return true;
    guestModeState.allRefused = false;
    chatState.profile.activeGuest.until = Number(message.until) || 0;
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    /* Contacts who share this home may be guests too: where they are is asked
       once now, of this relay first, then of the relays it is linked with. */
    if (typeof askForGuestRoute === 'function') {
      const homeId = chatState.profile.activeGuest.home;
      for (const peer of chatState.peers || []) {
        if (peer.type || !peer.fingerprint) continue;
        const stored = typeof routableHomeRelay === 'function' ? routableHomeRelay(peer) : null;
        if (stored?.id === homeId) askForGuestRoute(peer).catch(() => {});
      }
    }
    if (typeof guestAdmitted === 'function') guestAdmitted(chatState.profile.activeGuest);
    if (typeof renderGuestState === 'function') renderGuestState();
    return true;
  }
  if (type === 'guest-refused') {
    const refusedId = chatState.profile.activeGuest?.id;
    if (refusedId) guestModeState.refused.set(refusedId, Date.now());
    chatState.profile.activeGuest = null;
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    /* The next ranked candidate that has not refused this device within the
       last ten minutes. */
    const recentlyRefused = (id) => Date.now() - (guestModeState.refused.get(id) || 0) < guestTiming('refusedSkipMs');
    let next = guestModeState.queue.shift();
    while (next && recentlyRefused(next.relay.id)) next = guestModeState.queue.shift();
    if (next) {
      enterGuestStay(next).catch(console.error);
    } else {
      guestModeState.allRefused = true;
      if (typeof renderGuestState === 'function') renderGuestState();
      reconnectRelayTransport();
    }
    return true;
  }
  if (type === 'guest-status') {
    guestModeState.homeUp = message.homeUp === true ? true : null;
    return true;
  }
  if (type === 'guest-ended') return true;
  if (type === 'home-move' || type === 'home-move-ok' || type === 'home-move-refused') {
    if (typeof handleHomeMoveFrame === 'function') handleHomeMoveFrame(message);
    return true;
  }
  return false;
}

async function checkHomeWhileGuest() {
  const configured = configuredRelayOrigin();
  const pin = relayPinFor(configured);
  if (!pin?.id) return;
  if (await proveRelayAt(configured, pin)) {
    guestModeState.homeProofs += 1;
    if (typeof guestHomeProven === 'function') guestHomeProven();
    if (guestModeState.homeProofs >= GUEST_HOME_PROOFS && guestStayActive()) leaveGuestStay({ sendEnd: true, reason: 'home' });
  } else {
    guestModeState.homeProofs = 0;
  }
}

/* The guest relay went quiet: home if it answers, otherwise the next relay. */
async function guestRelayDied() {
  const stay = chatState.profile.activeGuest;
  const configured = configuredRelayOrigin();
  const pin = relayPinFor(configured);
  if (pin?.id && await proveRelayAt(configured, pin)) {
    leaveGuestStay({ sendEnd: false, reason: 'home' });
    return;
  }
  await becomeGuest({ exclude: stay?.id ? [stay.id] : [] });
}

async function guestTick() {
  if (typeof renderGuestState === 'function') renderGuestState();
  if (typeof isUnlocked === 'function' && !isUnlocked()) return;
  if (chatState.manualOffline || chatState.profile?.chatEnabled === false) return;
  const now = Date.now();
  if (guestStayActive()) {
    if (chatState.profile.useGuestRelays === false) { leaveGuestStay({ sendEnd: true, reason: 'switch' }); return; }
    /* Opened again during a stay: home is tried once, at once. */
    if (!guestModeState.startChecked) {
      guestModeState.startChecked = true;
      const pin = relayPinFor(configuredRelayOrigin());
      if (pin?.id && await withTimeout(proveRelayAt(configuredRelayOrigin(), pin), guestTiming('fastProofMs'))) {
        leaveGuestStay({ sendEnd: true, reason: 'home' });
        return;
      }
    }
    if (relayTransportUp()) {
      guestModeState.downSince = 0;
      countFilteredTime(now);
      maybeOfferMove().catch(() => {});
      if (now - guestModeState.lastHomeCheck >= guestTiming('homeCheckMs')) {
        guestModeState.lastHomeCheck = now;
        checkHomeWhileGuest().catch(() => {});
      }
      return;
    }
    if (navigator.onLine === false) return;
    if (!guestModeState.downSince) guestModeState.downSince = now;
    if (now - guestModeState.downSince >= guestTiming('downMs')) {
      guestModeState.downSince = now;
      guestRelayDied().catch(() => {});
    }
    return;
  }
  guestModeState.startChecked = true;
  if (relayTransportUp()) { guestModeState.downSince = 0; return; }
  if (navigator.onLine === false || guestModeState.running) return;
  if (!guestModeState.downSince) guestModeState.downSince = now;
  if (now - guestModeState.downSince < guestTiming('downMs')) return;
  if (!guestPreconditionsMet()) return;
  guestModeState.downSince = now;
  /* The backup addresses and front doors come first, once at least. */
  if (typeof attemptRelayFailover === 'function') {
    const switched = await attemptRelayFailover().catch(() => false);
    if (switched || relayTransportUp()) return;
  }
  await becomeGuest();
}

/* Going home: the guest relay stops waking this device (slice c). Home's own
   subscription is renewed by the hello there, as on every connection. */
function guestLeaving(stay) {
  const fingerprint = chatState.identity?.fingerprint;
  const endpoint = app()?.state?.webPush?.endpoint || '';
  if (!fingerprint || !endpoint || !stay?.origin) return;
  fetch(new URL('/push/unsubscribe', stay.origin), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fingerprint, endpoint }),
  }).catch(() => {});
}

/* ---- a home filtered for this one person: offering a move ---------------------

   Home works for everyone else (the guest relay's own link to it stands) but
   has not been reachable from this device: probably filtered, for this person
   only. After three days of that, counted across sessions, the app says so and
   offers to move home to the guest relay — with the reasons — and the person
   decides. "Remind me later" asks again in three days, "No" not for thirty.
   Unknown never counts: only a guest relay that can see home up does. */
const moveState = { promptOpen: false, lastTick: 0, lastSaved: 0, pending: null };

function moveOffer() {
  if (!chatState.profile.moveOffer || typeof chatState.profile.moveOffer !== 'object') chatState.profile.moveOffer = { nextAt: 0, siblingMovedAt: 0 };
  return chatState.profile.moveOffer;
}

function countFilteredTime(now) {
  const filtered = guestStayActive() && guestModeState.homeUp === true && relayTransportUp();
  if (!filtered) { moveState.lastTick = 0; return; }
  if (moveState.lastTick) {
    const step = Math.min(now - moveState.lastTick, guestTiming('tickMs') * 3);
    chatState.profile.guestFilteredMs = (Number(chatState.profile.guestFilteredMs) || 0) + Math.max(0, step);
    if (now - moveState.lastSaved > 30000) {
      moveState.lastSaved = now;
      saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    }
  }
  moveState.lastTick = now;
}

/* Home answered from this device: whatever kept it away was not a filter on
   this person, and the count starts again. */
function guestHomeProven() {
  if (chatState.profile.guestFilteredMs) {
    chatState.profile.guestFilteredMs = 0;
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  }
}

function familyRelayLabel(id) {
  const relay = (guestDirectory()?.relays || []).find((entry) => entry.id === id);
  if (relay?.name) return relay.name;
  try { return relay?.origins?.[0] ? new URL(relay.origins[0]).host : String(id || '').slice(0, 12); } catch (_error) { return String(id || '').slice(0, 12); }
}

/* Other devices of the account seen at home in the last week: they move too.
   Seen means a beacon from them; with none to go by (a guest relay holds no
   beacons for the account), every other device on the account's roster is
   named — it moves either way. */
function recentSiblingDevices() {
  const mine = typeof getDeviceId === 'function' ? getDeviceId() : '';
  const since = Date.now() - guestTiming('siblingRecentMs');
  const names = [];
  if (typeof siblingBeacons !== 'undefined') {
    for (const [deviceId, beacon] of siblingBeacons) {
      const at = typeof beacon?.at === 'number' ? beacon.at : Date.parse(beacon?.at || 0);
      if (deviceId !== mine && at > since) names.push(String(beacon?.n || deviceId).slice(0, 48));
    }
  }
  if (!names.length && typeof currentRoster === 'function') {
    for (const member of currentRoster()?.members || []) {
      if (member?.d && member.d !== mine) names.push(String(member.n || member.d).slice(0, 48));
    }
  }
  return names;
}

function movePromptText(homeName, guestName, others) {
  const fa = [
    `رلهٔ خانهٔ شما ${homeName} برای بقیه کار می‌کند، اما ۳ روز است که از اینترنت شما در دسترس نیست؛ احتمالاً فیلتر شده است. در این مدت برنامه مهمانِ رلهٔ ${guestName} بوده است.`,
    'چرا انتقال بهتر است:',
    '• حالا دو رله و پیوند میان آن‌ها باید همه سالم بمانند تا پیامی به شما برسد؛',
    '• همان پیوند هم ممکن است فیلتر شود؛',
    `• مهمان بودن محدودیت دارد و ${guestName} ممکن است روزی شما را نپذیرد؛`,
    '• پیام‌ها دیرتر می‌رسند؛',
    '• اعلان‌ها ضعیف‌ترند.',
    `با انتقال، ${guestName} خانهٔ شما می‌شود، ${homeName} صندوق شما را به آن می‌سپارد و مخاطبانتان نشانی تازه را خودشان یاد می‌گیرند. کلیدها، هویت و گفتگوهای شما عوض نمی‌شوند.`,
    ...(others.length ? [`${others.join('، ')} هم منتقل می‌شود و ممکن است خودش مهمان شود.`] : []),
  ].join('\n');
  const en = [
    `Your home relay ${homeName} works for everyone else, but has not been reachable from your internet for 3 days; it is probably filtered. All this time the app has been a guest on relay ${guestName}.`,
    'Why moving is better:',
    '• two relays and the link between them must all stay up for a message to reach you;',
    '• that link may itself be filtered;',
    `• a guest stay has limits, and ${guestName} may one day refuse you;`,
    '• messages arrive later;',
    '• notifications are weaker.',
    `Moving makes ${guestName} your home, ${homeName} hands your mailbox to it, and your contacts learn the new address by themselves. Your keys, your identity, and your conversations do not change.`,
    ...(others.length ? [`${others.join(', ')} will move too, and may become a guest itself.`] : []),
  ].join('\n');
  return t(fa, en);
}

async function maybeOfferMove() {
  if (moveState.promptOpen || moveState.pending || !guestStayActive()) return;
  if ((Number(chatState.profile.guestFilteredMs) || 0) < guestTiming('moveAfterMs')) return;
  const offer = moveOffer();
  const now = Date.now();
  if (offer.nextAt && now < offer.nextAt) return;
  if (offer.siblingMovedAt && now - offer.siblingMovedAt < guestTiming('siblingWaitMs')) return;
  if (typeof PoorijaDialogs === 'undefined' || typeof PoorijaDialogs.choose !== 'function') return;
  const stay = chatState.profile.activeGuest;
  const homeName = familyRelayLabel(stay.home);
  const guestName = stay.name || familyRelayLabel(stay.id);
  moveState.promptOpen = true;
  try {
    const answer = await PoorijaDialogs.choose(movePromptText(homeName, guestName, recentSiblingDevices()), [
      { value: 'move', label: t(`انتقال به ${guestName}`, `Move to ${guestName}`) },
      { value: 'later', label: t('بعداً یادآوری کن', 'Remind me later') },
      { value: 'no', label: t('نه، خانه‌ام بماند', 'No, keep my home') },
    ], { cancelLabel: t('بعداً یادآوری کن', 'Remind me later') });
    if (answer === 'move' && guestStayActive()) {
      await moveHomeTo();
    } else {
      offer.nextAt = Date.now() + guestTiming(answer === 'no' ? 'declineMs' : 'remindMs');
      saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    }
  } finally {
    moveState.promptOpen = false;
  }
}

/* The person's own signed statement, to the guest relay; it hands it to the
   old home. The configured address changes only once the guest relay says it
   took it. */
async function moveHomeTo() {
  const stay = chatState.profile.activeGuest;
  if (!stay || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return false;
  let signed;
  try {
    signed = await signGuestStatement({ v: 1, type: 'home-move', fp: chatState.identity?.fingerprint || '', from: stay.home, to: stay.id, at: Date.now() });
  } catch (_error) {
    notify(t('بیانیهٔ انتقال امضا نشد.', 'The move statement could not be signed.'), 'error');
    return false;
  }
  moveState.pending = { to: stay.id, origin: stay.origin, name: stay.name || familyRelayLabel(stay.id) };
  chatState.ws.send(JSON.stringify({ type: 'home-move', statement: signed.statement, sig: signed.sig }));
  window.setTimeout(() => { if (moveState.pending?.to === stay.id) moveState.pending = null; }, 30000);
  return true;
}

function settleHome(origin, name, { sibling = false } = {}) {
  chatState.profile.serverUrl = origin;
  /* One clock for every kind of move (63-relay-choice.js waits a month). */
  chatState.profile.lastHomeMoveAt = Date.now();
  chatState.profile.activeGuest = null;
  chatState.profile.activeMirror = null;
  chatState.profile.guestFilteredMs = 0;
  const offer = moveOffer();
  offer.nextAt = 0;
  if (sibling) offer.siblingMovedAt = Date.now();
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  const field = document.getElementById('chatServerUrl');
  if (field) field.value = origin;
  notify(sibling
    ? t(`خانهٔ این حساب از دستگاه دیگری به رلهٔ ${name} منتقل شد؛ این دستگاه هم به آن رفت.`, `This account's home was moved to relay ${name} from another device; this device has moved too.`)
    : t(`رلهٔ ${name} حالا خانهٔ شماست. مخاطبانتان نشانی تازه را خودشان یاد می‌گیرند.`, `Relay ${name} is now your home. Your contacts learn the new address by themselves.`), 'success');
  renderGuestState();
  if (typeof renderRelayFamily === 'function') renderRelayFamily();
  reconnectRelayTransport(200);
}

/* A move made on another device of this account: the old home hands this
   device the signed statement; checked with the account's own key, it is
   followed, with a notice and no question. */
const MOVE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
async function followSiblingMove(message) {
  const s = message?.statement;
  const fingerprint = chatState.identity?.fingerprint || '';
  if (!s || s.v !== 1 || s.type !== 'home-move' || s.fp !== fingerprint || typeof message.sig !== 'string') return false;
  if (s.from !== relayFamilyHomeId()) return false;
  /* Fresh, and newer than the last move this device followed: an old one
     handed over again is a replay. */
  const at = Number(s.at);
  if (!Number.isSafeInteger(at) || Date.now() - at > MOVE_FRESH_MS || at - Date.now() > 10 * 60 * 1000) return false;
  if (at <= (Number(moveOffer().lastMoveAt) || 0)) return false;
  const target = (guestDirectory()?.relays || []).find((relay) => relay.id === s.to);
  const origin = target ? (target.origins || []).map(guestOriginUsable).find(Boolean) : '';
  if (!origin) return false;
  let holds = false;
  try {
    holds = await verifyIdentitySignature(chatState.identity.publicKeyData, app().base64ToArrayBuffer(message.sig), new TextEncoder().encode(directoryCanonicalJson(s)));
  } catch (_error) { holds = false; }
  if (!holds) return false;
  /* The new home proven and pinned before anything changes; from here, if it
     cannot be reached, the relay id the list names is what the first
     connection must find there (61-relay-directory.js). */
  const proven = await probeGuestCandidate(target, null);
  if (proven) recordRelayPin(proven.origin, proven.identity);
  else if (window.PoorijaRelayDirectory?.adoptCode) window.PoorijaRelayDirectory.adoptCode({ origin, relay: target.id });
  moveOffer().lastMoveAt = at;
  settleHome(proven?.origin || origin, target.name || new URL(origin).host, { sibling: true });
  return true;
}

function handleHomeMoveFrame(message) {
  /* A move straight to a better relay is answered there (63-relay-choice.js). */
  if (typeof handleDirectMoveFrame === 'function' && handleDirectMoveFrame(message)) return;
  if (message.type === 'home-move-ok') {
    const pending = moveState.pending;
    moveState.pending = null;
    if (pending && message.to === pending.to) settleHome(pending.origin, pending.name);
    return;
  }
  if (message.type === 'home-move-refused') {
    moveState.pending = null;
    notify(t('رلهٔ مهمان انتقال را نپذیرفت.', 'The guest relay did not take the move.'), 'warning');
    return;
  }
  if (message.type === 'home-move') followSiblingMove(message).catch(() => {});
}

/* ---- what people see ---------------------------------------------------------- */

function guestRelayName() {
  const stay = chatState.profile.activeGuest;
  if (!stay) return '';
  try { return stay.name || new URL(stay.origin).host; } catch (_error) { return stay.name || ''; }
}
/* The line under the server address (52-relay-mirrors.js reads it). */
function guestNoteLine() {
  if (guestStayActive()) {
    const name = guestRelayName();
    return t(`رلهٔ خانهٔ شما در دسترس نیست؛ موقتاً روی رلهٔ ${name} از همان خانواده هستید و هر دقیقه خانه دوباره امتحان می‌شود.`,
      `Your home relay is unreachable; you are temporarily on relay ${name} of the same family, and home is tried again every minute.`);
  }
  if (guestModeState.allRefused) {
    return t('هیچ رلهٔ دیگری از خانواده نتوانست این دستگاه را بپذیرد.', 'No other relay of the family could take this device.');
  }
  return '';
}
function renderGuestState() {
  const badge = document.getElementById('chatGuestBadge');
  if (badge) {
    const on = guestStayActive();
    badge.classList.toggle('hidden', !on);
    badge.textContent = on ? t(`موقتاً روی رلهٔ ${guestRelayName()}`, `Temporarily on relay ${guestRelayName()}`) : '';
  }
  if (typeof renderMirrorNote === 'function') renderMirrorNote();
}
window.addEventListener('poorija:language-changed', () => renderGuestState());

window.setInterval(() => { guestTick().catch((error) => console.warn('[Guest]', error?.message || error)); }, guestTiming('tickMs'));

window.PoorijaGuestMode = { becomeGuest, leaveGuestStay, guestCandidates, rankGuestCandidates };
