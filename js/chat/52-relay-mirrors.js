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
   Other addresses of the same relay, for when the configured one is blocked.
   ============================================================================

   A relay can publish further addresses that reach it — a second domain, a
   CDN in front of it (CHAT_MIRROR_ORIGINS, served at /relay-mirrors). The
   client learns the list while the configured address works, and keeps it.

   The list itself is authenticated by the relay's key (an HMAC under a
   secret sealed to that key), so it holds exactly the addresses the operator
   declared — nobody on the path to the main address can add one.

   When the configured address stops answering for long enough, each mirror is
   asked to prove it reaches the same relay before anything is sent to it: the
   client seals a fresh nonce to the relay key it pinned and the mirror has to
   give the nonce back, which only the holder of that relay's private key can
   do. What that proves, said plainly: the mirror leads to the key's holder.
   It cannot prove the mirror is not a proxy in front of it — that is what a
   CDN mirror is — and a browser has no way to bind a proof to the TLS
   connection that would. A mirror is therefore trusted exactly as far as the
   operator who listed it: it carries sealed envelopes it cannot open and sees
   the traffic a relay sees, which is why only listed mirrors are ever used.

   Once on a mirror, the configured address is tried again every few minutes,
   with the same proof, and the client goes back to it the moment it answers.
   The configured address is never overwritten: the mirror is a detour, and the
   person's own setting stays theirs.
   ============================================================================ */

const MIRROR_LEARN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIRROR_DOWN_BEFORE_FAILOVER_MS = 25000;
const MIRROR_FAILOVER_RETRY_MS = 2 * 60 * 1000;
const MIRROR_PRIMARY_RETRY_MS = 5 * 60 * 1000;
const MIRROR_PROOF_TIMEOUT_MS = 8000;

let relayLastUpAt = Date.now();
let relayLastFailoverAt = 0;
let relayLastPrimaryCheckAt = 0;
let relayFailoverRunning = false;

function cleanMirrorOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && (isLocalRelayHostname(url.hostname) || isPrivateIpv4(url.hostname))) return url.origin;
  } catch (_error) { /* not an address */ }
  return '';
}

/* The mirrors known for the relay this device is pinned to. */
function knownMirrorsFor(relayId) {
  const entry = (chatState.profile.relayMirrors || {})[String(relayId || '')];
  return Array.isArray(entry?.origins) ? entry.origins.filter(Boolean) : [];
}

async function mirrorMacHex(secretHex, text) {
  const raw = Uint8Array.from(secretHex.match(/../g).map((byte) => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(mac)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Asked while connected, and authenticated by the relay's key: a nonce and a
   one-off secret go sealed to the pinned key, and the list comes back with an
   HMAC under that secret. Only the holder of the relay's private key can
   produce it, so nobody on the path to this address can add an address of
   their own to what is kept. */
async function learnRelayMirrors({ force = false } = {}) {
  const origin = chatServerOrigin();
  const pin = relayPinFor(origin);
  if (!pin?.id || !pin.publicKey) return [];
  const stored = (chatState.profile.relayMirrors || {})[pin.id];
  if (!force && stored && Date.now() - Number(stored.at || 0) < MIRROR_LEARN_INTERVAL_MS) return stored.origins || [];
  const nonce = randomHex(16);
  const secret = randomHex(32);
  let envelope;
  try {
    envelope = await sealTransitEnvelope(pin.id, pin.publicKey, { purpose: 'mirrors', nonce, k: secret }, { ttlMs: 60000 });
  } catch (_error) {
    return stored?.origins || [];
  }
  const body = await postRelayJson(new URL('/relay-mirrors', origin), { envelope });
  if (!body?.ok || String(body.relayId || '') !== pin.id || body.nonce !== nonce || !Array.isArray(body.origins)) return stored?.origins || [];
  const expected = await mirrorMacHex(secret, `poorija-mirrors-v1|${pin.id}|${nonce}|${JSON.stringify(body.origins)}`);
  if (expected !== body.mac) {
    console.warn('[Relay] a mirror list arrived that the relay\'s key did not vouch for; ignored.');
    return stored?.origins || [];
  }
  const configured = configuredRelayOrigin();
  const origins = Array.from(new Set(body.origins
    .map(cleanMirrorOrigin).filter((item) => item && item !== configured))).slice(0, 8);
  chatState.profile.relayMirrors = { ...(chatState.profile.relayMirrors || {}), [pin.id]: { origins, at: Date.now() } };
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  return origins;
}

async function postRelayJson(url, body, timeoutMs = MIRROR_PROOF_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_error) {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/* True only when the address answers with the pinned relay's identity AND
   opens a nonce sealed to the pinned relay's key. */
async function proveRelayAt(origin, pin) {
  if (!origin || !pin?.id || !pin.publicKey) return false;
  const identityResponse = await fetchRelayJson(new URL('/relay-identity', origin), MIRROR_PROOF_TIMEOUT_MS);
  if (!identityResponse?.ok) return false;
  let bundle;
  try { bundle = await identityResponse.json(); } catch (_error) { return false; }
  const identity = await verifiedRelayIdentity(bundle, null);
  if (!identity || identity.id !== pin.id) return false;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
  let envelope;
  try {
    envelope = await sealTransitEnvelope(pin.id, pin.publicKey, { purpose: 'prove', nonce }, { ttlMs: 60000 });
  } catch (_error) {
    return false;
  }
  const answer = await postRelayJson(new URL('/relay-prove', origin), { envelope });
  return Boolean(answer?.ok) && answer.nonce === nonce && answer.relayId === pin.id;
}

/* Moves the connection to `origin` — a proven mirror, or back to the
   configured address. */
function switchRelayOrigin(origin, pin) {
  const configured = configuredRelayOrigin();
  const previous = chatServerOrigin();
  if (origin === previous) return false;
  chatState.profile.activeMirror = origin === configured ? null : { primary: configured, origin, relayId: pin.id, at: Date.now() };
  /* The proof just made is the pin for the new address: same relay, same key. */
  if (typeof recordRelayPin === 'function') recordRelayPin(origin, pin);
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  notify(origin === configured
    ? t('آدرس اصلی سرور دوباره در دسترس است؛ اتصال به آن برگشت.', 'The main relay address is reachable again; switched back to it.')
    : t(`آدرس اصلی سرور در دسترس نبود؛ اتصال از آدرس پشتیبانِ همان سرور (${new URL(origin).host}) برقرار شد.`,
      `The main relay address was unreachable; connected through a backup address of the same relay (${new URL(origin).host}).`), 'info');
  try { chatState.ws?.close(); } catch (_error) { /* gone */ }
  chatState.ws = null;
  chatState.shouldReconnect = true;
  connectChatTransport().catch(console.error);
  return true;
}

/* ---- front doors ------------------------------------------------------------

   A relay people cannot reach can still be reached through another relay that
   answers for it at an address of its own (scripts/lib/relay-front.js) — the
   relay inside Iran, seen from outside, is the case this exists for. Reachable
   relays list the doors they keep at /relay-fronts. A door is used exactly
   like a mirror: only after it proves it leads to the relay this device
   pinned. A device that never reached the relay has no pin to prove against;
   it may then take a door by the relay's name, but only from the relay this
   app was served from or one the build names — the same parties that already
   choose which code runs here — and pins what the door answers with. */
const FRONT_LOOKUP_TIMEOUT_MS = 6000;

function frontLookupOrigins({ trustedOnly = false } = {}) {
  const out = [];
  const exclude = [configuredRelayOrigin(), chatServerOrigin()];
  const push = (value) => {
    const origin = cleanMirrorOrigin(value);
    if (origin && !exclude.includes(origin) && !out.includes(origin)) out.push(origin);
  };
  try {
    if (!isInternalShellOrigin(window.location.origin)) push(window.location.origin);
  } catch (_error) { /* no page origin */ }
  relayHintOrigins().forEach(push);
  if (!trustedOnly) {
    Object.keys(chatState.profile.relayPins || {}).forEach(push);
    /* Contacts' relays too: a phone app has no page origin to ask, and the
       relay a contact lives on is often the very one keeping the door. */
    try {
      (typeof allConversationRecords === 'function' ? allConversationRecords() : [])
        .forEach((record) => push(record?.homeRelay?.origin));
    } catch (_error) { /* no contacts yet */ }
  }
  return out.slice(0, 12);
}

/* The doors that reachable relays keep for `relayId`, or — when `hostname` is
   given — for a relay that names that host as its own. */
async function findFrontDoors({ relayId = '', hostname = '', trustedOnly = false } = {}) {
  const found = [];
  await Promise.all(frontLookupOrigins({ trustedOnly }).map(async (origin) => {
    const response = await fetchRelayJson(new URL('/relay-fronts', origin), FRONT_LOOKUP_TIMEOUT_MS);
    if (!response?.ok) return;
    let body = null;
    try { body = await response.json(); } catch (_error) { return; }
    for (const front of Array.isArray(body?.fronts) ? body.fronts : []) {
      const doorOrigin = cleanMirrorOrigin(front?.origin);
      const id = String(front?.relayId || '').toLowerCase();
      if (!doorOrigin || !/^[a-f0-9]{64}$/.test(id) || found.some((door) => door.origin === doorOrigin)) continue;
      const names = (Array.isArray(front.names) ? front.names : []).map((name) => {
        try { return new URL(String(name)).hostname.toLowerCase(); } catch (_error) { return ''; }
      });
      if ((relayId && id === relayId) || (hostname && names.includes(hostname.toLowerCase()))) found.push({ origin: doorOrigin, relayId: id });
    }
  }));
  return found;
}

/* For a relay this device has never reached: take a door by the relay's name,
   pin the identity the door answers with (for both the relay's own address
   and the door), and connect through it. */
async function adoptFrontDoorByName() {
  const configured = configuredRelayOrigin();
  let hostname = '';
  try { hostname = new URL(configured).hostname; } catch (_error) { return false; }
  if (!hostname || isLocalRelayHostname(hostname) || isPrivateIpv4(hostname)) return false;
  const doors = await findFrontDoors({ hostname, trustedOnly: true });
  for (const door of doors) {
    const response = await fetchRelayJson(new URL('/relay-identity', door.origin), MIRROR_PROOF_TIMEOUT_MS);
    if (!response?.ok) continue;
    let identity = null;
    try { identity = await verifiedRelayIdentity(await response.json(), null); } catch (_error) { identity = null; }
    if (!identity || identity.id !== door.relayId) continue;
    if (typeof recordRelayPin === 'function') {
      recordRelayPin(configured, identity);
      recordRelayPin(door.origin, identity);
    }
    const pin = relayPinFor(configured);
    if (pin?.id !== identity.id) continue;
    if (await proveRelayAt(door.origin, pin)) {
      switchRelayOrigin(door.origin, pin);
      return true;
    }
  }
  return false;
}

async function attemptRelayFailover() {
  if (relayFailoverRunning) return false;
  relayFailoverRunning = true;
  relayLastFailoverAt = Date.now();
  try {
    const configured = configuredRelayOrigin();
    const pin = relayPinFor(configured) || relayPinFor(chatServerOrigin());
    if (!pin?.id) return await adoptFrontDoorByName();
    const current = chatServerOrigin();
    /* On a mirror that has stopped answering, the configured address comes
       first, then the other mirrors, then any door another relay keeps. */
    const candidates = [current !== configured ? configured : '', ...knownMirrorsFor(pin.id)]
      .filter((origin) => origin && origin !== current);
    for (const origin of candidates) {
      if (await proveRelayAt(origin, pin)) {
        switchRelayOrigin(origin, pin);
        return true;
      }
    }
    const doors = await findFrontDoors({ relayId: pin.id });
    for (const door of doors) {
      if (door.origin === current || candidates.includes(door.origin)) continue;
      if (await proveRelayAt(door.origin, pin)) {
        switchRelayOrigin(door.origin, pin);
        return true;
      }
    }
    return false;
  } finally {
    relayFailoverRunning = false;
  }
}

async function checkPrimaryWhileOnMirror() {
  const mirror = chatState.profile.activeMirror;
  if (!mirror) return;
  relayLastPrimaryCheckAt = Date.now();
  const configured = configuredRelayOrigin();
  if (mirror.primary !== configured) {
    chatState.profile.activeMirror = null;
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    return;
  }
  const pin = relayPinFor(configured) || relayPinFor(mirror.origin);
  if (pin && await proveRelayAt(configured, pin)) switchRelayOrigin(configured, pin);
}

/* The line under the relay address: which address is in use, and how many
   backups this device knows for the relay. */
function renderMirrorNote() {
  const note = document.getElementById('chatMirrorNote');
  if (!note) return;
  const pin = relayPinFor(configuredRelayOrigin()) || relayPinFor(chatServerOrigin());
  const known = pin?.id ? knownMirrorsFor(pin.id).length : 0;
  const mirror = chatState.profile.activeMirror;
  if (!known && !mirror) { note.classList.add('hidden'); note.textContent = ''; return; }
  note.classList.remove('hidden');
  let host = '';
  try { host = mirror ? new URL(mirror.origin).host : ''; } catch (_error) { host = ''; }
  note.textContent = mirror
    ? t(`آدرس اصلی در دسترس نیست؛ اتصال از آدرس پشتیبانِ همان سرور (${host}) است و هر چند دقیقه آدرس اصلی دوباره امتحان می‌شود.`,
      `The main address is unreachable; connected through a backup address of the same relay (${host}). The main one is tried again every few minutes.`)
    : t(`${known} آدرس پشتیبان برای این سرور شناخته شده است؛ اگر آدرس اصلی مسدود شود، اتصال خودکار از آن‌ها برقرار می‌شود.`,
      `${known} backup address(es) known for this relay; if the main address is blocked, the app connects through them automatically.`);
}

function relayTransportUp() {
  return Boolean(chatState.connected && chatState.ws?.readyState === WebSocket.OPEN);
}

window.setInterval(() => {
  renderMirrorNote();
  if (typeof isUnlocked === 'function' && !isUnlocked()) return;
  if (chatState.manualOffline || chatState.profile?.chatEnabled === false) return;
  const now = Date.now();
  if (relayTransportUp()) {
    relayLastUpAt = now;
    if (chatState.profile.activeMirror && now - relayLastPrimaryCheckAt > MIRROR_PRIMARY_RETRY_MS) {
      checkPrimaryWhileOnMirror().catch(() => {});
    }
    return;
  }
  if (navigator.onLine === false) return;
  if (now - relayLastUpAt < MIRROR_DOWN_BEFORE_FAILOVER_MS) return;
  if (now - relayLastFailoverAt < MIRROR_FAILOVER_RETRY_MS) return;
  attemptRelayFailover().catch(() => {});
}, 10000);

window.learnRelayMirrors = learnRelayMirrors;
window.proveRelayAt = proveRelayAt;
window.attemptRelayFailover = attemptRelayFailover;
window.findFrontDoors = findFrontDoors;
window.adoptFrontDoorByName = adoptFrontDoorByName;
