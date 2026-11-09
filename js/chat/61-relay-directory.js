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
   The operator's relay directory, in the app.
   ============================================================================

   An operator's relays form a family under a list the operator's key signs
   (scripts/lib/relay-directory.js, served at /relay-directory). This file
   gives the app that list, checked the way a relay checks it — the same
   canonical JSON, the same P-256 signature, the same order of refusals — and
   anchored to an operator key the app trusts: the one its first connection
   showed, or the one a scanned QR code named. No relay can change the anchor
   unnoticed: a list signed by another key is followed only through a
   handover the old key signed, or after the person says so.

   The list changes no routing yet; guest mode (phase 2 of
   docs/RELAY-RESILIENCE-ROADMAP.md) will take its relays from here.
   ============================================================================ */

const DIRECTORY_HEX64 = /^[a-f0-9]{64}$/;

/* Keys sorted at every level, no whitespace: the bytes every signer signs. */
function directoryCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(directoryCanonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${directoryCanonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function directoryB64ToBytes(text) {
  const binary = atob(String(text || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* The operator is named the way a relay is: SHA-256 of the key's SPKI bytes. */
async function operatorIdOf(spkiB64) {
  const digest = await crypto.subtle.digest('SHA-256', directoryB64ToBytes(spkiB64));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/* Node signs in DER (SEQUENCE of two INTEGERs); WebCrypto wants r and s side
   by side, 32 bytes each. */
function derSignatureToRaw(der) {
  const bytes = der instanceof Uint8Array ? der : new Uint8Array(der);
  if (bytes[0] !== 0x30) throw new Error('not a DER signature');
  let at = 2;
  if (bytes[1] & 0x80) at = 2 + (bytes[1] & 0x7f);
  const integer = () => {
    if (bytes[at] !== 0x02) throw new Error('not a DER integer');
    const length = bytes[at + 1];
    let value = bytes.slice(at + 2, at + 2 + length);
    at += 2 + length;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) throw new Error('integer too long');
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };
  const r = integer();
  const s = integer();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function directorySignatureHolds(text, sigB64, spkiB64) {
  try {
    const key = await crypto.subtle.importKey('spki', directoryB64ToBytes(spkiB64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derSignatureToRaw(directoryB64ToBytes(sigB64)), new TextEncoder().encode(text));
  } catch (_error) {
    return false;
  }
}

function directoryWebOrigin(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (_error) {
    return false;
  }
}

/* The shape scripts/lib/relay-directory.js wellFormed() accepts. */
function directoryWellFormed(doc) {
  const body = doc?.body;
  if (!body || typeof body !== 'object' || typeof doc.sig !== 'string' || !doc.sig) return false;
  if (body.v !== 1 || !Number.isSafeInteger(body.serial) || body.serial < 1) return false;
  if (typeof body.operator?.key !== 'string' || !DIRECTORY_HEX64.test(String(body.operator?.id || ''))) return false;
  if (!Array.isArray(body.relays) || !Array.isArray(body.revoked)) return false;
  if (!body.relays.every((relay) => relay && DIRECTORY_HEX64.test(String(relay.id || '')) && (relay.origins === undefined || Array.isArray(relay.origins)))) return false;
  if (!body.relays.every((relay) => (relay.cluster === undefined || (typeof relay.cluster === 'string' && relay.cluster.length <= 40))
    && (relay.inside === undefined || (Array.isArray(relay.inside) && relay.inside.length <= 4 && relay.inside.every(directoryWebOrigin)))
    && (relay.guests === undefined || typeof relay.guests === 'boolean'))) return false;
  if (body.admins !== undefined && !(Array.isArray(body.admins) && body.admins.length <= 32)) return false;
  return body.revoked.every((id) => DIRECTORY_HEX64.test(String(id || '')));
}

/* In the relay's order: shape, whose, signature, contradiction, age — and,
   in place of the relay's own membership, whether the list names this app's
   home relay at all. */
async function checkRelayDirectory(doc, { operatorKey = '', operatorId = '', heldSerial = 0, heldBody = null, homeRelayId = '' } = {}) {
  if (!directoryWellFormed(doc)) return { ok: false, reason: 'malformed' };
  const body = doc.body;
  if (body.operator.id !== operatorId || (operatorKey && body.operator.key !== operatorKey)) return { ok: false, reason: 'wrong-operator' };
  if (await operatorIdOf(body.operator.key) !== body.operator.id) return { ok: false, reason: 'wrong-operator' };
  if (!(await directorySignatureHolds(directoryCanonicalJson(body), doc.sig, body.operator.key))) return { ok: false, reason: 'bad-signature' };
  const revoked = new Set(body.revoked);
  if (body.relays.some((relay) => revoked.has(relay.id))) return { ok: false, reason: 'revoked-and-listed' };
  if (body.serial < heldSerial) return { ok: false, reason: 'stale' };
  if (body.serial === heldSerial) {
    const differs = heldBody && directoryCanonicalJson(heldBody) !== directoryCanonicalJson(body);
    return { ok: false, reason: differs ? 'same-serial-different-body' : 'stale' };
  }
  if (homeRelayId && !body.relays.some((relay) => relay.id === homeRelayId)) return { ok: false, reason: 'home-not-listed' };
  return { ok: true, directory: body };
}

/* A handover: the old key's word for the new one. */
async function operatorHandoverHolds(handover) {
  const partyOk = (value) => value && typeof value.key === 'string' && value.key.length <= 400 && DIRECTORY_HEX64.test(String(value.id || ''));
  if (!handover || handover.v !== 1 || !partyOk(handover.from) || !partyOk(handover.to) || typeof handover.at !== 'string' || typeof handover.sig !== 'string') return false;
  if (await operatorIdOf(handover.from.key) !== handover.from.id || await operatorIdOf(handover.to.key) !== handover.to.id) return false;
  const text = directoryCanonicalJson({ v: 1, from: { id: handover.from.id, key: handover.from.key }, to: { id: handover.to.id, key: handover.to.key }, at: handover.at });
  return directorySignatureHolds(text, handover.sig, handover.from.key);
}

/* From one key, as far as valid handovers lead; null when none leaves it. */
async function followOperatorHandovers(handovers, fromId) {
  const valid = [];
  for (const handover of Array.isArray(handovers) ? handovers.slice(0, 16) : []) {
    if (await operatorHandoverHolds(handover)) valid.push(handover);
  }
  const seen = new Set([fromId]);
  let end = null;
  let at = fromId;
  for (;;) {
    const next = valid.find((handover) => handover.from.id === at && !seen.has(handover.to.id));
    if (!next) return end;
    end = { id: next.to.id, key: next.to.key };
    seen.add(next.to.id);
    at = next.to.id;
  }
}

/* ---- the list this app keeps --------------------------------------------- */

const DIRECTORY_REFRESH_MS = 6 * 60 * 60 * 1000;
const DIRECTORY_MAX_BYTES = 512 * 1024;
let directoryRefreshRunning = null;

/* The home relay is the one the configured address is pinned to; on a
   mirror, the address in use leads to the same relay. */
function relayFamilyHomeId() {
  return relayPinFor(configuredRelayOrigin())?.id || relayPinFor(chatServerOrigin())?.id || '';
}

function directoryOriginOf(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
  } catch (_error) {
    return '';
  }
}

/* Where to ask: the home relay, the mirror in use, then the family's relays
   from the list already kept. */
function directoryCandidateOrigins() {
  const list = [];
  const push = (value) => { const origin = directoryOriginOf(value); if (origin && !list.includes(origin)) list.push(origin); };
  push(configuredRelayOrigin());
  push(chatServerOrigin());
  for (const relay of chatState.profile.relayDirectory?.body?.relays || []) for (const origin of relay.origins || []) push(origin);
  return list.slice(0, 6);
}

/* A body read no further than `max` bytes: null when it is longer. A relay
   cannot make the app hold a reply of any size it likes. */
async function readCappedText(response, max) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > max) {
    try { await response.body?.cancel(); } catch (_error) { /* gone */ }
    return null;
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    return text.length > max ? null : text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      try { await reader.cancel(); } catch (_error) { /* gone */ }
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { all.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder().decode(all);
}

/* JSON from a relay, or why not: 404 is "nothing here", 0 is "no answer". */
async function fetchDirectoryJson(url) {
  try {
    const response = await fetchRelayJson(String(url), 5000);
    if (!response?.ok) return { status: Number(response?.status) || 0 };
    const text = await readCappedText(response, DIRECTORY_MAX_BYTES);
    if (text === null) return { status: 200, bad: true };
    try { return { status: 200, json: JSON.parse(text) }; } catch (_error) { return { status: 200, bad: true }; }
  } catch (_error) {
    return { status: 0 };
  }
}

function saveRelayFamily() {
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  if (typeof renderRelayFamily === 'function') renderRelayFamily();
}

function keepRelayDirectory(doc, origin) {
  chatState.profile.relayDirectory = { body: doc.body, sig: doc.sig, fetchedAt: Date.now(), from: origin };
  chatState.relayDirectoryCheckedAt = Date.now();
  saveRelayFamily();
  return { ok: true, serial: doc.body.serial, changed: true };
}

/* One list from one relay, against the anchor. `final` stops the search: the
   person has been asked, and asking again from the next relay helps nobody. */
async function adoptRelayDirectory(doc, origin) {
  if (!directoryWellFormed(doc)) return { ok: false, reason: 'malformed' };
  const body = doc.body;
  const pin = chatState.profile.operatorPin;
  const homeRelayId = relayFamilyHomeId();
  const kept = chatState.profile.relayDirectory;
  const sameOperator = kept?.body?.operator?.id === body.operator.id ? kept : null;
  /* The very list already kept: up to date, nothing to check twice. */
  if (sameOperator && pin?.id === body.operator.id && sameOperator.sig === doc.sig && directoryCanonicalJson(sameOperator.body) === directoryCanonicalJson(body)) {
    sameOperator.fetchedAt = Date.now();
    chatState.relayDirectoryCheckedAt = Date.now();
    saveRelayFamily();
    return { ok: true, serial: body.serial, changed: false };
  }
  const held = { heldSerial: sameOperator?.body?.serial || 0, heldBody: sameOperator?.body || null, homeRelayId };
  if (!pin?.id) {
    /* The first anchor only from the configured address — not a mirror, not
       another relay of the list — over HTTPS or a local network, and from a
       relay whose identity is pinned and named in the list. */
    if (origin !== directoryOriginOf(configuredRelayOrigin()) || isPlaintextPublicRelay(origin) || !homeRelayId) return { ok: false, reason: 'not-anchored' };
    const verdict = await checkRelayDirectory(doc, { operatorId: body.operator.id, operatorKey: body.operator.key, ...held });
    if (!verdict.ok) return verdict;
    chatState.profile.operatorPin = { id: body.operator.id, key: body.operator.key, source: 'first-connection', pinnedAt: new Date().toISOString() };
    return keepRelayDirectory(doc, origin);
  }
  if (body.operator.id === pin.id) {
    const verdict = await checkRelayDirectory(doc, { operatorId: pin.id, operatorKey: pin.key || '', ...held });
    if (!verdict.ok) return verdict;
    /* A QR code names the operator; its key comes with the first list. */
    if (!pin.key) pin.key = body.operator.key;
    return keepRelayDirectory(doc, origin);
  }
  /* Another operator: the old key's handover, or the person's word. */
  const offered = await fetchDirectoryJson(new URL('/operator-handover', origin));
  const end = offered.json ? await followOperatorHandovers(offered.json.handovers, pin.id) : null;
  if (end && end.id === body.operator.id) {
    const verdict = await checkRelayDirectory(doc, { operatorId: end.id, operatorKey: end.key, ...held });
    if (!verdict.ok) return verdict;
    chatState.profile.operatorPin = { id: end.id, key: end.key, source: 'handover', pinnedAt: new Date().toISOString(), previous: pin.id };
    notify(t('کلید اپراتور رله‌های شما عوض شد و کلید قبلی، کلید تازه را تأیید کرده است.',
      'Your relays’ operator key was replaced, and the old key vouched for the new one.'), 'info');
    return keepRelayDirectory(doc, origin);
  }
  /* Only a list that holds by its own key is worth a question. */
  const own = await checkRelayDirectory(doc, { operatorId: body.operator.id, operatorKey: body.operator.key, homeRelayId });
  if (!own.ok) return own;
  /* A question on screen is answered as it was asked: a list from yet
     another key waits until it is closed. */
  if (chatState.operatorPinPromptOpen && chatState.operatorPinAlert && chatState.operatorPinAlert.seen !== body.operator.id) {
    return { ok: false, reason: 'operator-changed', final: true };
  }
  chatState.operatorPinAlert = { expected: pin.id, seen: body.operator.id, doc, origin };
  notify(t('کلید اپراتور رله‌های شما عوض شده است. ممکن است چرخانده شده باشد — یا این اپراتور دیگری باشد.',
    'The operator key of your relays has changed. It may have been rotated — or this may be a different operator.'), 'warning');
  promptOperatorKeyChange().catch(() => {});
  if (typeof renderRelayFamily === 'function') renderRelayFamily();
  return { ok: false, reason: 'operator-changed', final: true };
}

/* A scanned code is held until the app is connected to the address it
   named — scanning a code nobody saved changes nothing. Then the operator it
   names becomes the anchor if there is none. The relay it names is written
   only where nothing is pinned yet; a pin is never replaced by a code (only
   by the person, through the relay-key question). When the relay that
   answered is not the one the code named, that is said and nothing moves. */
function promotePendingRelayCode() {
  const pending = chatState.pendingRelayCode;
  if (!pending || pending.origin !== directoryOriginOf(configuredRelayOrigin())) return false;
  chatState.pendingRelayCode = null;
  if (pending.op) setOperatorAnchorFromCode({ operatorId: pending.op });
  if (pending.relay) {
    if (!chatState.profile.relayPins || typeof chatState.profile.relayPins !== 'object') chatState.profile.relayPins = {};
    const pinned = chatState.profile.relayPins[pending.origin];
    if (!pinned?.id) {
      chatState.profile.relayPins[pending.origin] = { id: pending.relay, pinnedAt: new Date().toISOString(), source: 'qr' };
    } else if (pinned.id === pending.relay) {
      pinned.source = 'qr';
      chatState.relayCodeMismatch = null;
    } else {
      chatState.relayCodeMismatch = { origin: pending.origin, expected: pending.relay, seen: pinned.id, at: Date.now() };
      notify(t('رله‌ای که در این نشانی پاسخ می‌دهد همانی نیست که کد QR نام برده بود. چیزی عوض نشد؛ کد را با مدیر سرور بررسی کنید.',
        'The relay answering at this address is not the one the QR code named. Nothing was changed; check the code with whoever runs the server.'), 'warning');
    }
    saveRelayFamily();
  }
  return true;
}

/* After a connect and every few hours: the newest valid list, from the home
   relay or any relay of the family. */
async function refreshRelayDirectory({ force = false } = {}) {
  if (directoryRefreshRunning) return directoryRefreshRunning;
  directoryRefreshRunning = (async () => {
    if (promotePendingRelayCode()) force = true;
    const kept = chatState.profile.relayDirectory;
    if (!force && kept?.fetchedAt && Date.now() - Number(kept.fetchedAt) < DIRECTORY_REFRESH_MS) {
      return { ok: true, serial: kept.body?.serial || 0, changed: false, cached: true };
    }
    let reason = 'unreachable';
    for (const origin of directoryCandidateOrigins()) {
      const got = await fetchDirectoryJson(new URL('/relay-directory', origin));
      if (got.status === 404) { if (reason === 'unreachable') reason = 'no-directory'; continue; }
      /* No answer, or a proxy's error page in place of one: not this relay's word. */
      if (!got.json && !got.bad) continue;
      if (got.bad) { reason = 'malformed'; continue; }
      const verdict = await adoptRelayDirectory(got.json, origin);
      if (verdict.ok || verdict.final) return verdict;
      reason = verdict.reason;
    }
    chatState.relayDirectoryCheckedAt = Date.now();
    if (typeof renderRelayFamily === 'function') renderRelayFamily();
    return { ok: false, reason };
  })().finally(() => { directoryRefreshRunning = null; });
  return directoryRefreshRunning;
}

/* From a scanned code (js/local-link.js): the operator it names becomes the
   anchor, and only when there is none — a code never replaces one. */
function setOperatorAnchorFromCode({ operatorId } = {}) {
  const id = String(operatorId || '');
  if (!DIRECTORY_HEX64.test(id)) return false;
  const pin = chatState.profile.operatorPin;
  if (pin?.id) {
    if (pin.id !== id) {
      notify(t('این کد برای اپراتور دیگری است و کلید اپراتوری که برنامه به آن اعتماد دارد عوض نشد.',
        'This code is for another operator; the operator key the app trusts was not changed.'), 'warning');
    }
    return false;
  }
  chatState.profile.operatorPin = { id, key: '', source: 'qr', pinnedAt: new Date().toISOString() };
  saveRelayFamily();
  return true;
}

/* The person's yes to the question below — to that question only: a yes to
   one that is no longer open accepts nothing. */
function acceptOperatorKey(alertState = chatState.operatorPinAlert) {
  if (!alertState?.doc?.body?.operator || chatState.operatorPinAlert !== alertState) return false;
  chatState.profile.operatorPin = {
    id: alertState.doc.body.operator.id, key: alertState.doc.body.operator.key, source: 'accepted',
    pinnedAt: new Date().toISOString(), previous: alertState.expected,
  };
  chatState.operatorPinAlert = null;
  keepRelayDirectory(alertState.doc, alertState.origin);
  return true;
}

async function promptOperatorKeyChange() {
  const alertState = chatState.operatorPinAlert;
  if (!alertState || chatState.operatorPinPromptOpen) return;
  chatState.operatorPinPromptOpen = true;
  try {
    const short = (id) => String(id || '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
    const question = t(
      `کلید اپراتور رله‌های شما عوض شده است. ممکن است چرخانده شده باشد — یا این اپراتور دیگری باشد.\n\nکلید قبلی:\n${short(alertState.expected)}\n\nکلید تازه:\n${short(alertState.seen)}\n\nپیام‌ها در هر حال رمزنگاری سرتاسری می‌مانند؛ این فقط تعیین می‌کند برنامه به کدام فهرست رله‌ها اعتماد کند. پیش از پذیرفتن، با اپراتور از راه دیگری بررسی کنید.\n\nکلید تازه پذیرفته شود؟`,
      `The operator key of your relays has changed. It may have been rotated — or this may be a different operator.\n\nBefore:\n${short(alertState.expected)}\n\nNow:\n${short(alertState.seen)}\n\nMessages stay end-to-end encrypted either way; this only decides which relay list the app believes. Check with the operator by some other route before accepting.\n\nAccept the new key?`);
    if (await PoorijaDialogs.confirm(question)) acceptOperatorKey(alertState);
  } finally {
    chatState.operatorPinPromptOpen = false;
  }
}

/* What the settings card shows. */
function relayFamilyView() {
  const kept = chatState.profile.relayDirectory;
  return {
    pin: chatState.profile.operatorPin || null,
    directory: kept?.body || null,
    from: kept?.from || '',
    homeId: relayFamilyHomeId(),
    checkedAt: chatState.relayDirectoryCheckedAt || Number(kept?.fetchedAt) || 0,
    alert: chatState.operatorPinAlert ? { expected: chatState.operatorPinAlert.expected, seen: chatState.operatorPinAlert.seen } : null,
  };
}

/* Every half hour, a look at whether six hours have passed. */
window.setInterval(() => {
  if (typeof relayTransportUp === 'function' && relayTransportUp()) refreshRelayDirectory().catch(() => {});
}, 30 * 60 * 1000);

/* ---- the server code (js/local-link.js) ------------------------------------ */

window.PoorijaRelayDirectory = {
  /* A scanned code: the operator becomes the anchor if there is none, and
     the relay id is pinned for that address if nothing is pinned there yet
     (a different pin is left alone: the relay-key question handles it). */
  adoptCode({ origin, op, relay } = {}) {
    const key = directoryOriginOf(origin);
    if (!key) return;
    chatState.pendingRelayCode = {
      origin: key, op: DIRECTORY_HEX64.test(String(op || '')) ? op : '', relay: DIRECTORY_HEX64.test(String(relay || '')) ? relay : '', at: Date.now(),
    };
  },
  /* What this app can hand on in its own code for an address. */
  codeParts(origin) {
    const pin = chatState.profile.operatorPin;
    return { op: pin?.id || '', relay: relayPinFor(directoryOriginOf(origin))?.id || '' };
  },
};

/* ---- the card in Connection and TURN ---------------------------------------- */

function directoryEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderRelayFamily() {
  const node = document.getElementById('chatRelayFamily');
  if (!node) return;
  const view = relayFamilyView();
  if (!view.pin && !view.directory) {
    node.classList.add('hidden');
    node.innerHTML = '';
    return;
  }
  node.classList.remove('hidden');
  /* English reads left to right even inside the right-to-left page. */
  node.dir = language() === 'fa' ? 'rtl' : 'ltr';
  node.classList.toggle('is-changed', Boolean(view.alert || chatState.relayCodeMismatch));
  const fingerprint = (id) => String(id || '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  const sources = {
    qr: t('کد QR', 'a QR code'),
    'first-connection': t('نخستین اتصال', 'the first connection'),
    handover: t('تحویل امضاشدهٔ کلید قبلی', 'the old key’s signed handover'),
    accepted: t('پذیرش خود شما', 'your own acceptance'),
  };
  const body = view.directory;
  const name = body?.operator?.name ? `${directoryEsc(body.operator.name)} · ` : '';
  const when = view.checkedAt ? new Date(view.checkedAt).toLocaleString(language() === 'fa' ? 'fa-IR' : 'en-GB') : '—';
  const relays = (body?.relays || []).map((relay) => {
    let host = '';
    try { host = relay.origins?.[0] ? new URL(relay.origins[0]).host : ''; } catch (_error) { host = ''; }
    const home = relay.id === view.homeId;
    const guest = Boolean(chatState.profile.activeGuest && chatState.profile.activeGuest.id === relay.id && typeof guestStayActive === 'function' && guestStayActive());
    const place = [relay.region === 'inside-iran' ? t('داخل ایران', 'inside Iran') : relay.region === 'outside-iran' ? t('خارج از ایران', 'outside Iran') : '', relay.cluster || ''].filter(Boolean).join(' · ');
    return `<li data-family-relay class="${home ? 'is-home' : ''}${guest ? ' is-guest' : ''}"><strong>${directoryEsc(relay.name || host || relay.id.slice(0, 12))}</strong>`
      + `${host ? ` <code dir="ltr">${directoryEsc(host)}</code>` : ''}${place ? ` · ${directoryEsc(place)}` : ''}`
      + `${home ? ` · <span class="chat-relay-family-home">${directoryEsc(t('خانه', 'home'))}</span>` : ''}`
      + `${guest ? ` · <span class="chat-relay-family-guest">${directoryEsc(t('مهمان', 'guest'))}</span>` : ''}</li>`;
  }).join('');
  const warnings = [];
  if (view.alert) warnings.push(t('کلید اپراتور عوض شده و منتظر تصمیم شماست.', 'The operator key has changed and waits for your decision.'));
  if (chatState.relayCodeMismatch) warnings.push(t('رلهٔ این نشانی با کد QR اسکن‌شده نمی‌خواند.', 'The relay at this address does not match the scanned QR code.'));
  node.innerHTML = `<span class="chat-relay-identity-title">${directoryEsc(t('خانوادهٔ رله‌ها', 'Relay family'))}</span>`
    + `<p class="chat-settings-hint">${directoryEsc(t('اپراتور', 'Operator'))}: ${name}<code class="chat-relay-identity-value" dir="ltr">${directoryEsc(fingerprint(view.pin?.id || body?.operator?.id))}</code></p>`
    + (view.pin ? `<p class="chat-settings-hint">${directoryEsc(t('اعتماد از', 'Trusted from'))}: ${directoryEsc(sources[view.pin.source] || view.pin.source)}</p>` : '')
    + `<p class="chat-settings-hint">${body ? `${directoryEsc(t('فهرست', 'List'))} #${directoryEsc(body.serial)} · ` : ''}${directoryEsc(t('آخرین بررسی', 'Last checked'))}: ${directoryEsc(when)}</p>`
    + (relays ? `<ul class="chat-relay-family-list">${relays}</ul>` : '')
    + warnings.map((line) => `<p class="chat-settings-hint chat-relay-family-warn">${directoryEsc(line)}</p>`).join('')
    + `<button id="chatRelayFamilyCheck" type="button" class="chat-soft-btn">${directoryEsc(t('بررسی کن', 'Check now'))}</button>`;
}

document.addEventListener('click', (event) => {
  if (!event.target?.closest?.('#chatRelayFamilyCheck')) return;
  refreshRelayDirectory({ force: true }).catch(() => {}).finally(() => renderRelayFamily());
});
window.addEventListener('poorija:language-changed', () => renderRelayFamily());
