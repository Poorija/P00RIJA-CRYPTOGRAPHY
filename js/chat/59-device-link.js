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
   Linking a device with a code — the way Telegram and WhatsApp do it.
   ============================================================================

   One device shows a QR code; the other scans it; the new device becomes a
   device of the account. Either side may be the one showing it, because a
   desktop often has no camera worth scanning with:

     - "add":  a device of the account shows the code, the new one scans it;
     - "join": the new device shows the code, a device of the account scans it.

   What the code holds is a meeting point, not a secret worth stealing: a
   random room name, a fresh ECDH (P-256) public key, and where to reach the
   device showing it (its fingerprint and relay). It changes every ten
   seconds — a new room and a new key each time — and each one is honoured for
   half a minute at most, so a photograph of the screen is worth nothing for
   long. The scanning device makes its own key; the two derive one shared AES
   key from the exchange (HKDF over the room and both public keys) and from
   then on everything between them — names, and in the end the account
   itself — is encrypted with it. The relay carries opaque messages between
   them and sees neither the key nor the account.

   The key on the screen was read by the camera, so the device that scans
   knows it is talking to the device it is pointing at. The device that showed
   the code cannot know who scanned it, so nothing happens until a person
   says so: the account's device asks before it hands the account over, and
   the new device asks before it accepts one — each showing a six-digit code
   both screens derive from the shared key, which only matches if nobody sits
   in between.

   What crosses is what the password-protected portable profile carries — the
   identity, the contacts, the groups, the roster that names the primary —
   and then the history follows as it does for any sibling, device to device.
   ============================================================================ */

const LINK_ROTATE_MS = 10000;
const LINK_OFFERS_VALID = 3;     /* honoured: the current code and the two before it */
const LINK_OFFERS_KEPT = 6;      /* remembered a while longer, to say "expired" */
const LINK_SHOW_MS = 3 * 60 * 1000;
const LINK_SESSION_MS = 2 * 60 * 1000;
const LINK_CHUNK_CHARS = 48 * 1024;
const LINK_QR_PX = 340;
const LINK_MAX_CHARS = 24 * 1024 * 1024;

const linkState = {
  role: '',              /* 'shower' | 'scanner' */
  mode: '',              /* 'add' | 'join' — what the code on the screen is for */
  offers: [],            /* { room, privateKey, pub, at } */
  qrText: '',
  rotateTimer: 0,
  stopTimer: 0,
  sessionTimer: 0,
  session: null,
  scanner: null,
  overlay: null,
};

/* ---- bytes ------------------------------------------------------------------ */

function linkB64url(bytes) {
  return bytesToBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function linkHexToB64url(hex) {
  const bytes = new Uint8Array(String(hex).match(/../g).map((pair) => parseInt(pair, 16)));
  return linkB64url(bytes);
}
function linkB64urlToHex(text) {
  return Array.from(base64ToBytes(text), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function linkRandom(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function linkKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return { privateKey: pair.privateKey, pub: linkB64url(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

/* The shared key and the six-digit code, from one ECDH exchange. Bound to the
   room and to both public keys in order, so neither can be swapped. */
async function linkDerive(privateKey, theirPub, room, showerPub, scannerPub) {
  const theirs = await crypto.subtle.importKey('raw', base64ToBytes(theirPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: base64ToBytes(room),
    info: new TextEncoder().encode(`poorija-link-v1|${showerPub}|${scannerPub}`),
  }, hkdf, 320));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const number = ((bits[32] << 16) | (bits[33] << 8) | bits[34]) % 1000000;
  const digits = String(number).padStart(6, '0');
  return { key, sas: `${digits.slice(0, 3)} ${digits.slice(3)}` };
}
async function linkSeal(key, aad, data) {
  const iv = linkRandom(12);
  const plain = data instanceof Uint8Array ? data : new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, plain);
  return { iv: linkB64url(iv), c: linkB64url(cipher) };
}
async function linkOpen(key, aad, box, { raw = false } = {}) {
  const plain = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(box.iv), additionalData: new TextEncoder().encode(aad) },
    key,
    base64ToBytes(box.c),
  ));
  return raw ? plain : JSON.parse(new TextDecoder().decode(plain));
}

/* ---- the wire ---------------------------------------------------------------- */

/* Straight to the other device's fingerprint on this relay, or sealed for its
   own relay over transit when it lives on another one. Live only: nothing of
   this is ever kept for later. */
function linkSend(target, payload) {
  if (!target?.fp) return false;
  const frame = { type: 'relay', toClientId: '', toFingerprint: target.fp, payload: { ...payload, type: 'device-link', v: 1 }, persist: false };
  const home = typeof normalizeHomeRelay === 'function' ? normalizeHomeRelay(target.home, 'session') : null;
  const mine = relayPinFor(chatServerOrigin())?.id || '';
  if (home?.id && home.key && mine && home.id !== mine && chatState.profile.crossRelayComm !== false) {
    sendViaTransit(frame, home, null);
    return true;
  }
  if (chatState.ws?.readyState !== WebSocket.OPEN) return false;
  chatState.ws.send(JSON.stringify(frame));
  return true;
}
async function linkSendStep(step, data, extra = {}) {
  const session = linkState.session;
  if (!session) return false;
  const box = await linkSeal(session.key, `${session.room}|${step}|0`, data);
  return linkSend(session.peer, { r: session.room, s: step, box, ...(linkState.role === 'scanner' ? { k: session.myPub } : {}), ...extra });
}

/* The account, as the portable profile has it: compressed, encrypted once,
   and sent in pieces small enough for any relay frame. */
async function linkSendAccount() {
  const session = linkState.session;
  const payload = typeof buildPortableProfilePayload === 'function' ? buildPortableProfilePayload() : null;
  if (!session || !payload) return false;
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const { bytes, packed } = typeof compressBytes === 'function' ? await compressBytes(json) : { bytes: json, packed: false };
  const sealed = await linkSeal(session.key, `${session.room}|account|${packed ? 1 : 0}`, bytes);
  const text = JSON.stringify(sealed);
  if (text.length > LINK_MAX_CHARS) return false;
  const parts = Math.ceil(text.length / LINK_CHUNK_CHARS);
  for (let index = 0; index < parts; index += 1) {
    const ok = linkSend(session.peer, {
      r: session.room, s: 'account', i: index, n: parts, z: packed ? 1 : 0,
      part: text.slice(index * LINK_CHUNK_CHARS, (index + 1) * LINK_CHUNK_CHARS),
      ...(linkState.role === 'scanner' ? { k: session.myPub } : {}),
    });
    if (!ok) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }
  return true;
}

/* ---- the device showing the code -------------------------------------------- */

async function linkWaitForRelay(ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (chatState.connected && chatState.ws?.readyState === WebSocket.OPEN && chatState.identity?.fingerprint) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return false;
}

async function startLinkShow(mode) {
  stopLink();
  linkState.role = 'shower';
  linkState.mode = mode;
  renderLinkOverlay();
  if (!chatState.profile.chatEnabled && typeof applyChatEnabled === 'function') applyChatEnabled(true, { silent: true });
  if (!await linkWaitForRelay()) {
    renderLinkStatus(t('به سرور چت وصل نیستیم؛ اتصال را بررسی کنید و دوباره امتحان کنید.', 'Not connected to the chat server; check the connection and try again.'), 'error');
    return;
  }
  await rotateLinkOffer();
  linkState.rotateTimer = window.setInterval(() => { rotateLinkOffer().catch(() => {}); }, LINK_ROTATE_MS);
  linkState.stopTimer = window.setTimeout(() => {
    stopLinkRotation();
    linkState.offers = [];
    renderLinkExpired();
  }, LINK_SHOW_MS);
  window.PoorijaQR?.holdScreenAwake?.().catch?.(() => {});
}

async function rotateLinkOffer() {
  if (linkState.role !== 'shower' || linkState.session) return;
  const pair = await linkKeyPair();
  const room = linkB64url(linkRandom(16));
  const now = Date.now();
  linkState.offers.push({ room, privateKey: pair.privateKey, pub: pair.pub, at: now });
  while (linkState.offers.length > LINK_OFFERS_KEPT) linkState.offers.shift();
  /* As few characters as will do: a phone has to resolve every module of the
     code from across a desk. Hex fingerprints travel as base64, and the relay
     is an array rather than an object with long names. */
  const home = typeof myHomeRelay === 'function' ? myHomeRelay() : null;
  const code = {
    t: 'pl',
    v: 1,
    m: linkState.mode,
    r: room,
    k: pair.pub,
    f: linkHexToB64url(chatState.identity.fingerprint),
    h: home?.origin ? [home.origin, home.id ? linkHexToB64url(home.id) : '', home.key || ''] : null,
    n: (typeof deviceLabel === 'function' ? deviceLabel() : '').slice(0, 24),
    e: Math.floor((now + LINK_ROTATE_MS * LINK_OFFERS_VALID) / 1000),
  };
  const json = JSON.stringify(code);
  linkState.qrText = window.PoorijaQR?.pack ? await window.PoorijaQR.pack(json) : json;
  renderLinkCode();
}
function linkOfferFor(room) {
  return linkState.offers.find((offer) => offer.room === room) || null;
}
function linkOfferValid(offer) {
  return Date.now() - offer.at < LINK_ROTATE_MS * LINK_OFFERS_VALID + 2000;
}
function stopLinkRotation() {
  window.clearInterval(linkState.rotateTimer);
  window.clearTimeout(linkState.stopTimer);
  linkState.rotateTimer = 0;
  linkState.stopTimer = 0;
}

/* ---- the device scanning it --------------------------------------------------- */

async function parseLinkCode(text) {
  let value = String(text || '').trim();
  if (window.PoorijaQR?.unpack) value = await window.PoorijaQR.unpack(value);
  let code;
  try { code = JSON.parse(value); } catch (_error) { return null; }
  if (!code || code.t !== 'pl' || code.v !== 1 || !['add', 'join'].includes(code.m)) return null;
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(String(code.r || '')) || !/^[A-Za-z0-9_-]{80,100}$/.test(String(code.k || ''))) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(code.f || ''))) return null;
  code.f = linkB64urlToHex(code.f);
  if (!/^[a-f0-9]{64}$/.test(code.f)) return null;
  const home = Array.isArray(code.h) ? code.h : null;
  code.h = home && typeof home[0] === 'string'
    ? { origin: home[0], id: /^[A-Za-z0-9_-]{43}$/.test(String(home[1] || '')) ? linkB64urlToHex(home[1]) : '', key: String(home[2] || '') }
    : null;
  return code;
}

async function handleScannedLink(text) {
  const code = await parseLinkCode(text);
  if (!code) return { ok: false, reason: 'not-a-link-code' };
  if (linkState.session) return { ok: false, reason: 'busy' };
  /* A minute's grace either way for clocks that disagree; the device that
     showed the code is the one that really decides, by its own clock. */
  if (Number(code.e || 0) * 1000 < Date.now() - 60000) {
    renderLinkStatus(t('این کد منقضی شده است؛ کد تازه‌ای را که روی صفحهٔ دیگر است اسکن کنید.', 'This code has expired; scan the fresh one on the other screen.'), 'error');
    return { ok: false, reason: 'expired' };
  }
  const mine = chatState.identity?.fingerprint || '';
  if (code.f === mine) {
    renderLinkStatus(t('این دستگاه همین حالا هم جزو همین حساب است.', 'This device is already part of that account.'), 'info');
    return { ok: false, reason: 'same-account' };
  }
  await stopLinkScanner();
  /* Scanning needs a relay to answer through, as showing does. */
  if (!chatState.profile.chatEnabled && typeof applyChatEnabled === 'function') applyChatEnabled(true, { silent: true });
  if (!await linkWaitForRelay()) {
    renderLinkStatus(t('به سرور چت وصل نیستیم؛ اتصال را بررسی کنید و دوباره امتحان کنید.', 'Not connected to the chat server; check the connection and try again.'), 'error');
    return { ok: false, reason: 'offline' };
  }
  if (code.m === 'add') {
    /* This device is the new one: what it holds now is replaced. */
    const holdsSomething = Object.values(chatState.history || {}).some((list) => (list || []).length) || (chatState.peers || []).length;
    if (holdsSomething) {
      const ok = await PoorijaDialogs.confirm(
        t('پیوستن به آن حساب، هویت فعلی این دستگاه و گفتگوها و مخاطبین آن را جایگزین می‌کند. ادامه می‌دهید؟', 'Joining that account replaces this device\'s current identity, with its conversations and contacts. Continue?'),
        { danger: true, okLabel: t('ادامه', 'Continue') },
      );
      if (!ok) { stopLink(); return { ok: false, reason: 'declined' }; }
    }
  } else {
    /* This device has the account: adding somebody is a decision. */
    const ok = await PoorijaDialogs.confirm(
      t(`دستگاه «${typeof deviceLabelText === 'function' ? deviceLabelText(code.n) : code.n}» به این حساب اضافه شود؟ آن دستگاه همهٔ گفتگوها و مخاطبین این حساب را خواهد داشت.`,
        `Add "${typeof deviceLabelText === 'function' ? deviceLabelText(code.n) : code.n}" to this account? That device will have all of this account's conversations and contacts.`),
      { okLabel: t('افزودن', 'Add') },
    );
    if (!ok) { stopLink(); return { ok: false, reason: 'declined' }; }
  }
  const pair = await linkKeyPair();
  const derived = await linkDerive(pair.privateKey, code.k, code.r, code.k, pair.pub);
  linkState.role = 'scanner';
  linkState.mode = code.m;
  linkState.session = {
    room: code.r,
    key: derived.key,
    sas: derived.sas,
    myPub: pair.pub,
    peer: { fp: code.f, home: code.h || null, label: String(code.n || '') },
    expected: code.m === 'add' ? code.f : '',
    parts: [],
  };
  armLinkSessionTimeout();
  const me = { fp: chatState.identity.fingerprint, home: typeof myHomeRelay === 'function' ? myHomeRelay() : null, n: typeof deviceLabel === 'function' ? deviceLabel() : '' };
  if (code.m === 'add') {
    await linkSendStep('hello', me);
    renderLinkWaiting(t('روی دستگاه دیگر، اضافه شدن این دستگاه را تأیید کنید. همین کد باید آنجا هم دیده شود:', 'Approve this device on your other device. It should show this same code:'));
  } else {
    await linkSendStep('offer', { ...me, name: chatState.profile.name || '' });
    renderLinkWaiting(t('روی دستگاه جدید، پیوستن به این حساب را تأیید کنید. همین کد باید آنجا هم دیده شود:', 'Accept on the new device. It should show this same code:'));
  }
  return { ok: true, sas: derived.sas };
}

function armLinkSessionTimeout() {
  window.clearTimeout(linkState.sessionTimer);
  linkState.sessionTimer = window.setTimeout(() => {
    if (!linkState.session || linkState.session.finished) return;
    renderLinkStatus(t('دستگاه دیگر جواب نداد؛ دوباره امتحان کنید.', 'The other device did not answer; try again.'), 'error');
    linkState.session = null;
  }, LINK_SESSION_MS);
}

/* ---- what arrives ------------------------------------------------------------- */

async function handleDeviceLinkEnvelope(message) {
  const payload = message?.payload || {};
  if (payload.type !== 'device-link' || payload.v !== 1 || !payload.r || !payload.s) return;
  try {
    if (linkState.role === 'shower') await handleLinkAtShower(payload);
    else if (linkState.role === 'scanner') await handleLinkAtScanner(payload);
  } catch (error) {
    console.warn('[Link] a message could not be read:', error?.message || error);
  }
}

async function handleLinkAtShower(payload) {
  let session = linkState.session;
  if (!session) {
    const offer = linkOfferFor(payload.r);
    const first = linkState.mode === 'add' ? 'hello' : 'offer';
    if (!offer || payload.s !== first || !/^[A-Za-z0-9_-]{80,100}$/.test(String(payload.k || ''))) return;
    const derived = await linkDerive(offer.privateKey, payload.k, offer.room, offer.pub, payload.k);
    let opened;
    try { opened = await linkOpen(derived.key, `${offer.room}|${first}|0`, payload.box); } catch (_error) { return; }
    if (!/^[a-f0-9]{64}$/.test(String(opened?.fp || ''))) return;
    /* A code that is no longer honoured: the scanning device is told so,
       rather than left waiting, and nothing else happens. */
    if (!linkOfferValid(offer)) {
      const box = await linkSeal(derived.key, `${offer.room}|expired|0`, { at: Date.now() });
      linkSend({ fp: opened.fp, home: opened.home || null }, { r: offer.room, s: 'expired', box });
      return;
    }
    /* Taken: no other code on this screen is honoured while this is decided. */
    stopLinkRotation();
    session = linkState.session = {
      room: offer.room,
      key: derived.key,
      sas: derived.sas,
      peerPub: payload.k,
      peer: { fp: opened.fp, home: opened.home || null, label: String(opened.n || '') },
      expected: linkState.mode === 'join' ? opened.fp : '',
      accountName: String(opened.name || ''),
      parts: [],
    };
    armLinkSessionTimeout();
    if (linkState.mode === 'add') renderLinkApproval('add');
    else renderLinkApproval('join');
    return;
  }
  if (payload.r !== session.room || payload.k !== session.peerPub) return;
  /* An account is taken only after the person here said "Join": one pushed
     before that is somebody trying to put their account on this device. */
  if (payload.s === 'account' && linkState.mode === 'join') {
    if (!session.approved) return;
    await collectLinkAccount(payload);
  }
  else if (payload.s === 'done' && linkState.mode === 'add') {
    session.finished = true;
    renderLinkDone(t('دستگاه جدید به این حساب اضافه شد. تاریخچه و فایل‌ها از دستگاه به دستگاه همگام می‌شوند.', 'The new device was added to this account. The history and files sync device to device.'));
  }
}

async function handleLinkAtScanner(payload) {
  const session = linkState.session;
  if (!session || payload.r !== session.room) return;
  if (payload.s === 'denied') {
    session.finished = true;
    renderLinkStatus(t('دستگاه دیگر این اتصال را رد کرد.', 'The other device declined.'), 'error');
    return;
  }
  if (payload.s === 'expired') {
    try { await linkOpen(session.key, `${session.room}|expired|0`, payload.box); } catch (_error) { return; }
    linkState.lastOutcome = 'expired';
    linkState.session = null;
    window.clearTimeout(linkState.sessionTimer);
    renderLinkStatus(t('این کد منقضی شده است؛ کد تازه‌ای را که روی صفحهٔ دیگر است اسکن کنید.', 'This code has expired; scan the fresh one on the other screen.'), 'error');
    return;
  }
  if (payload.s === 'accept' && linkState.mode === 'join') {
    try { await linkOpen(session.key, `${session.room}|accept|0`, payload.box); } catch (_error) { return; }
    renderLinkStatus(t('در حال فرستادن حساب به دستگاه جدید…', 'Sending the account to the new device…'), 'info');
    if (await linkSendAccount()) {
      session.finished = true;
      renderLinkDone(t('حساب به دستگاه جدید رسید. تاریخچه و فایل‌ها از دستگاه به دستگاه همگام می‌شوند.', 'The account reached the new device. The history and files sync device to device.'));
    } else {
      renderLinkStatus(t('فرستادن حساب ناموفق بود؛ دوباره امتحان کنید.', 'Sending the account failed; try again.'), 'error');
    }
    return;
  }
  if (payload.s === 'account' && linkState.mode === 'add') await collectLinkAccount(payload);
}

/* The pieces of the account, put together, opened and checked before anything
   on this device changes: it must be the account the code named (or the one
   the offer named and the person accepted), and its key must be its own. */
async function collectLinkAccount(payload) {
  const session = linkState.session;
  const count = Number(payload.n) || 0;
  const index = Number(payload.i);
  if (!count || count > Math.ceil(LINK_MAX_CHARS / LINK_CHUNK_CHARS) || !Number.isInteger(index) || index < 0 || index >= count) return;
  if (typeof payload.part !== 'string') return;
  session.parts[index] = payload.part;
  session.partCount = count;
  session.packed = payload.z === 1;
  const have = session.parts.filter((part) => typeof part === 'string').length;
  renderLinkStatus(t(`در حال دریافت حساب… ${Math.round((have / count) * 100)}٪`, `Receiving the account… ${Math.round((have / count) * 100)}%`), 'info');
  if (have < count || session.applying) return;
  session.applying = true;
  let account;
  try {
    const sealed = JSON.parse(session.parts.join(''));
    let bytes = await linkOpen(session.key, `${session.room}|account|${session.packed ? 1 : 0}`, sealed, { raw: true });
    if (session.packed && typeof decompressBytes === 'function') bytes = await decompressBytes(bytes);
    account = JSON.parse(new TextDecoder().decode(bytes));
  } catch (_error) {
    renderLinkStatus(t('حساب دریافت‌شده خوانا نبود؛ دوباره امتحان کنید.', 'The account that arrived could not be read; try again.'), 'error');
    session.applying = false;
    return;
  }
  const identity = account?.identity || {};
  let keyMatches = false;
  try {
    keyMatches = (await sha256Hex(app().base64ToArrayBuffer(identity.publicKeyData))) === identity.fingerprint;
  } catch (_error) { keyMatches = false; }
  if (!keyMatches || identity.fingerprint !== session.expected) {
    renderLinkStatus(t('حسابی که رسید با کدی که اسکن شد یکی نیست؛ چیزی تغییر نکرد.', 'The account that arrived is not the one the code named; nothing was changed.'), 'error');
    return;
  }
  /* Told first, while the old identity still has a socket to say it on. */
  await linkSendStep('done', { at: Date.now() });
  session.finished = true;
  await new Promise((resolve) => window.setTimeout(resolve, 400));
  chatState.shouldReconnect = false;
  try { chatState.ws?.close(); } catch (_error) { /* gone */ }
  try { chatState.peer?.destroy?.(); } catch (_error) { /* gone */ }
  chatState.connected = false;
  const applied = typeof applyPortableProfilePayload === 'function'
    ? await applyPortableProfilePayload(account, { confirmed: true })
    : false;
  if (!applied) {
    renderLinkStatus(t('حساب روی این دستگاه فعال نشد.', 'The account could not be activated on this device.'), 'error');
    chatState.shouldReconnect = true;
    connectChatTransport().catch(() => {});
    return;
  }
  renderLinkDone(t('این دستگاه به حساب پیوست. تاریخچه و فایل‌ها از دستگاه دیگر همگام می‌شوند.', 'This device joined the account. The history and files sync from your other device.'));
}

/* A person's answer on the device that showed the code. */
async function answerLink(approved) {
  const session = linkState.session;
  if (!session || session.answered) return;
  session.answered = true;
  if (!approved) {
    await linkSendStep('denied', { at: Date.now() });
    linkState.session = null;
    renderLinkStatus(t('رد شد. کد تازه‌ای نمایش داده می‌شود.', 'Declined. A fresh code is shown.'), 'info');
    linkState.offers = [];
    window.setTimeout(() => {
      if (linkState.role !== 'shower') return;
      rotateLinkOffer().catch(() => {});
      linkState.rotateTimer = window.setInterval(() => { rotateLinkOffer().catch(() => {}); }, LINK_ROTATE_MS);
      linkState.stopTimer = window.setTimeout(() => {
        stopLinkRotation();
        linkState.offers = [];
        renderLinkExpired();
      }, LINK_SHOW_MS);
    }, 1200);
    return;
  }
  session.approved = true;
  if (linkState.mode === 'add') {
    renderLinkStatus(t('در حال فرستادن حساب به دستگاه جدید…', 'Sending the account to the new device…'), 'info');
    if (!await linkSendAccount()) renderLinkStatus(t('فرستادن حساب ناموفق بود؛ دوباره امتحان کنید.', 'Sending the account failed; try again.'), 'error');
  } else {
    await linkSendStep('accept', { at: Date.now() });
    renderLinkStatus(t('در حال دریافت حساب…', 'Receiving the account…'), 'info');
  }
}

/* ---- on screen --------------------------------------------------------------- */

function ensureLinkOverlay() {
  if (linkState.overlay?.isConnected) return linkState.overlay;
  const overlay = document.createElement('div');
  overlay.className = 'chat-link-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="chat-link-card">
  <button type="button" class="chat-link-close" data-link-close aria-label="${app().escapeHTML(t('بستن', 'Close'))}"><i class="fas fa-xmark"></i></button>
  <h3 class="chat-link-title"></h3>
  <div class="chat-link-body"></div>
</div>`;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-link-close]')) stopLink();
    const action = event.target.closest('[data-link-action]')?.getAttribute('data-link-action');
    if (!action) return;
    if (action === 'show-add') startLinkShow('add');
    else if (action === 'show-join') startLinkShow('join');
    else if (action === 'scan') startLinkScanner();
    else if (action === 'export') { stopLink(); exportPortableProfileFile(); }
    else if (action === 'import') { stopLink(); document.getElementById('chatProfileImportInput')?.click(); }
    else if (action === 'approve') answerLink(true);
    else if (action === 'deny') answerLink(false);
    else if (action === 'again') startLinkShow(linkState.mode || 'add');
  });
  document.body.appendChild(overlay);
  linkState.overlay = overlay;
  return overlay;
}
function linkBody(title, html) {
  const overlay = ensureLinkOverlay();
  if (title) overlay.querySelector('.chat-link-title').textContent = title;
  overlay.querySelector('.chat-link-body').innerHTML = html;
  return overlay.querySelector('.chat-link-body');
}

/* The first screen: on a device of the account ("add") or on a new one
   ("join"). Both ways are offered on both, because which device can scan is
   a question of which one has a camera. */
function openLinkChooser(side) {
  stopLink();
  const escape = (text) => app().escapeHTML(text);
  const account = side === 'account';
  linkState.chooserSide = side;
  linkBody(account ? t('افزودن دستگاه', 'Add a device') : t('اتصال این دستگاه به حساب', 'Link this device to an account'), `
<p class="chat-link-note">${escape(account
    ? t('دستگاه جدید را مثل تلگرام و واتس‌اپ با یک کد QR وصل کنید. کدام دستگاه دوربین دارد؟ همان اسکن کند.', 'Link the new device with a QR code, the way Telegram and WhatsApp do. Whichever device has a camera does the scanning.')
    : t('این دستگاه را با یک کد QR به حسابی که روی دستگاه دیگرتان دارید وصل کنید. کدام دستگاه دوربین دارد؟ همان اسکن کند.', 'Link this device to the account on your other device with a QR code. Whichever device has a camera does the scanning.'))}</p>
<button type="button" class="chat-link-option" data-link-action="${account ? 'show-add' : 'show-join'}">
  <i class="fas fa-qrcode"></i>
  <span><strong>${escape(t('نمایش کد روی این دستگاه', 'Show a code on this device'))}</strong>
  <small>${escape(account
    ? t('با دستگاه جدید اسکنش کنید: «هویت شما در چت › اتصال به حساب › اسکن کد».', 'Scan it with the new device: "Your chat identity › Link to an account › Scan a code".')
    : t('با دستگاه دیگرتان اسکنش کنید: «دستگاه‌های من › افزودن دستگاه › اسکن کد».', 'Scan it with your other device: "My devices › Add a device › Scan a code".'))}</small></span>
</button>
<button type="button" class="chat-link-option" data-link-action="scan">
  <i class="fas fa-camera"></i>
  <span><strong>${escape(t('اسکن کد با دوربین این دستگاه', 'Scan a code with this device\'s camera'))}</strong>
  <small>${escape(account
    ? t('کدی که دستگاه جدید نشان می‌دهد («اتصال به حساب › نمایش کد»).', 'The code the new device shows ("Link to an account › Show a code").')
    : t('کدی که دستگاه دیگرتان نشان می‌دهد («افزودن دستگاه › نمایش کد»).', 'The code your other device shows ("Add a device › Show a code").'))}</small></span>
</button>
<button type="button" class="chat-link-option is-quiet" data-link-action="${account ? 'export' : 'import'}">
  <i class="fas ${account ? 'fa-file-export' : 'fa-file-import'}"></i>
  <span><strong>${escape(account ? t('خروجی پروفایل همراه (فایل)', 'Export the portable profile (file)') : t('ایمپورت پروفایل همراه (فایل)', 'Import a portable profile (file)'))}</strong>
  <small>${escape(t('راه قدیمی، بدون دوربین و بدون اتصال هم‌زمان.', 'The old way: no camera, and no need for both to be online.'))}</small></span>
</button>`);
}

function renderLinkOverlay() {
  linkBody(linkState.mode === 'add' ? t('افزودن دستگاه', 'Add a device') : t('اتصال این دستگاه به حساب', 'Link this device to an account'), `
<div class="chat-link-qr"><div class="chat-link-qr-box" data-link-qr></div><div class="chat-link-countdown"><span></span></div></div>
<p class="chat-link-note" data-link-note>${app().escapeHTML(t('در حال آماده کردن کد…', 'Preparing the code…'))}</p>
<p class="chat-link-status" data-link-status aria-live="polite"></p>`);
}
function renderLinkCode() {
  const body = linkState.overlay?.querySelector('.chat-link-body');
  const box = body?.querySelector('[data-link-qr]');
  if (!box) return;
  box.innerHTML = '';
  /* Low error correction is right for a code on a screen — nothing scratches
     it — and keeps it to fewer, larger modules; drawn as large as the card
     allows. */
  const room = (linkState.overlay?.querySelector('.chat-link-card')?.clientWidth || 400) - 60;
  window.PoorijaQR?.render(box, linkState.qrText, { px: Math.max(232, Math.min(LINK_QR_PX, room)), level: 'L', preset: 'classic', quiet: 4 });
  box.setAttribute('data-link-text', linkState.qrText);
  const bar = body.querySelector('.chat-link-countdown span');
  if (bar) {
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = `chat-link-countdown ${LINK_ROTATE_MS}ms linear forwards`;
  }
  const note = body.querySelector('[data-link-note]');
  if (note) {
    note.textContent = linkState.mode === 'add'
      ? t('این کد را با دستگاه جدید اسکن کنید. برای امنیت، کد هر ده ثانیه عوض می‌شود.', 'Scan this code with the new device. For safety, it changes every ten seconds.')
      : t('این کد را با دستگاه دیگرتان (که حساب روی آن است) اسکن کنید. برای امنیت، کد هر ده ثانیه عوض می‌شود.', 'Scan this code with your other device, the one that has the account. For safety, it changes every ten seconds.');
  }
}
function renderLinkExpired() {
  linkBody('', `<p class="chat-link-note">${app().escapeHTML(t('زمان نمایش کد تمام شد.', 'The code is no longer shown.'))}</p>
<button type="button" class="chat-link-option" data-link-action="again"><i class="fas fa-rotate"></i><span><strong>${app().escapeHTML(t('نمایش کد تازه', 'Show a fresh code'))}</strong></span></button>`);
}
function renderLinkStatus(text, tone = 'info') {
  ensureLinkOverlay();
  let line = linkState.overlay.querySelector('[data-link-status]');
  if (!line) {
    line = document.createElement('p');
    line.className = 'chat-link-status';
    line.setAttribute('data-link-status', '');
    line.setAttribute('aria-live', 'polite');
    linkState.overlay.querySelector('.chat-link-body').appendChild(line);
  }
  line.textContent = text;
  line.dataset.tone = tone;
}
function linkSasHtml(sas) {
  return `<div class="chat-link-sas" data-link-sas>${app().escapeHTML(sas)}</div>`;
}
function renderLinkWaiting(text) {
  linkBody('', `<p class="chat-link-note">${app().escapeHTML(text)}</p>${linkSasHtml(linkState.session.sas)}
<p class="chat-link-status" data-link-status aria-live="polite"></p>`);
}
function renderLinkApproval(mode) {
  const session = linkState.session;
  const escape = (text) => app().escapeHTML(text);
  const label = typeof deviceLabelText === 'function' ? deviceLabelText(session.peer.label) : session.peer.label;
  const question = mode === 'add'
    ? t(`دستگاه «${label}» می‌خواهد به این حساب اضافه شود. اگر همین کد روی آن دستگاه هم دیده می‌شود، تأیید کنید؛ آن دستگاه همهٔ گفتگوها و مخاطبین این حساب را خواهد داشت.`,
      `"${label}" wants to join this account. Approve only if it shows this same code; it will have all of this account's conversations and contacts.`)
    : t(`به حساب «${session.accountName || label}» (کلید ${session.peer.fp.slice(0, 8)}…) بپیوندید؟ اگر همین کد روی دستگاه دیگرتان هم دیده می‌شود، تأیید کنید. هویت فعلی این دستگاه جایگزین می‌شود.`,
      `Join the account "${session.accountName || label}" (key ${session.peer.fp.slice(0, 8)}…)? Accept only if your other device shows this same code. This device's current identity is replaced.`);
  linkBody('', `<p class="chat-link-note">${escape(question)}</p>${linkSasHtml(session.sas)}
<div class="chat-link-actions">
  <button type="button" class="chat-link-option is-primary" data-link-action="approve"><i class="fas fa-check"></i><span><strong>${escape(mode === 'add' ? t('تأیید و افزودن', 'Approve') : t('پیوستن', 'Join'))}</strong></span></button>
  <button type="button" class="chat-link-option is-danger" data-link-action="deny"><i class="fas fa-xmark"></i><span><strong>${escape(t('رد', 'Decline'))}</strong></span></button>
</div>
<p class="chat-link-status" data-link-status aria-live="polite"></p>`);
}
function renderLinkDone(text) {
  linkBody('', `<div class="chat-link-done"><i class="fas fa-circle-check"></i></div><p class="chat-link-note">${app().escapeHTML(text)}</p>
<button type="button" class="chat-link-option is-primary" data-link-close><span><strong>${app().escapeHTML(t('بستن', 'Close'))}</strong></span></button>`);
  if (typeof renderAccountDeviceViews === 'function') renderAccountDeviceViews();
}

async function startLinkScanner() {
  stopLink({ keepOverlay: true });
  linkState.role = 'scanner';
  const body = linkBody(t('اسکن کد', 'Scan the code'), `
<video class="chat-link-video" playsinline muted></video>
<p class="chat-link-note">${app().escapeHTML(t('دوربین را به سمت کدی بگیرید که روی دستگاه دیگر نمایش داده می‌شود.', 'Point the camera at the code on the other device.'))}</p>
<p class="chat-link-status" data-link-status aria-live="polite"></p>`);
  if (!window.PoorijaQR?.Scanner) {
    renderLinkStatus(t('اسکنر QR در این مرورگر در دسترس نیست.', 'The QR scanner is not available in this browser.'), 'error');
    return;
  }
  let handling = false;
  linkState.scanner = new window.PoorijaQR.Scanner({
    video: body.querySelector('video'),
    onResult: async (text) => {
      if (handling) return;
      handling = true;
      const outcome = await handleScannedLink(text);
      if (!outcome.ok && outcome.reason === 'not-a-link-code') {
        renderLinkStatus(t('این کد مربوط به اتصال دستگاه نیست.', 'That is not a device-link code.'), 'error');
        handling = false;
      }
    },
    onError: (error) => {
      const said = window.describeMediaError?.(error, 'video');
      renderLinkStatus(said || t('دسترسی به دوربین داده نشد.', 'Camera access was refused.'), 'error');
    },
  });
  await linkState.scanner.start();
}
async function stopLinkScanner() {
  const scanner = linkState.scanner;
  linkState.scanner = null;
  if (scanner) await scanner.stop().catch(() => {});
}

function stopLink({ keepOverlay = false } = {}) {
  stopLinkRotation();
  window.clearTimeout(linkState.sessionTimer);
  stopLinkScanner();
  linkState.offers = [];
  linkState.session = null;
  linkState.role = '';
  linkState.qrText = '';
  window.PoorijaQR?.releaseScreen?.();
  if (!keepOverlay && linkState.overlay) {
    linkState.overlay.remove();
    linkState.overlay = null;
  }
}

window.openLinkChooser = openLinkChooser;
window.__deviceLinkProbe = {
  qr: () => linkState.qrText,
  scan: (text) => handleScannedLink(text),
  state: () => ({ role: linkState.role, mode: linkState.mode, offers: linkState.offers.length, session: Boolean(linkState.session), sas: linkState.session?.sas || '', finished: Boolean(linkState.session?.finished), outcome: linkState.lastOutcome || '' }),
  show: (mode) => startLinkShow(mode),
  /* What a device that scanned a code would do to skip the other side's
     consent: push its account straight away. It must be ignored. */
  pushAccountNow: () => linkSendAccount(),
  stop: () => stopLink(),
};
