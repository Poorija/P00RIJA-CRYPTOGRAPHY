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
   Which devices are part of the account, and which one is its primary.
   ============================================================================

   Every device of an account holds the same identity key — that is what makes
   them one account to everybody else — so that key cannot be what tells the
   first device from the ones added after it. Each install therefore also has
   a key of its own (ECDSA P-256), made on it, kept in its encrypted storage,
   and never exported: not in the portable profile, not in a sync bundle.

   The roster is the account's list of devices, written by its primary:
     - the primary is named by its device key, with a certificate the identity
       key signed — only a device of this account can make one, so neither the
       relay nor anybody else can put a primary of their own in;
     - the roster itself is signed with the primary's device key, so no other
       device of the account can write a valid one either;
     - a successor must be signed by the primary the previous one names, with
       a higher sequence number (handing the role on is that primary signing a
       roster that names another device), and every device and the relay keep
       the first primary they saw and refuse a roster from anyone else.

   What the primary can do with it, and only the primary:
     - revoke a device. The relay shuts the revoked device out the moment it
       proves the account's identity (by its id, and by its key once proven),
       drops its beacon and whatever was held for it, and closes a socket of
       it that is open; the account's other devices stop syncing with it and
       will not hand it a file. The revoked device itself, told so with a
       roster it can verify, removes the account from itself and starts again
       with an identity of its own.
     - hand the primary role to another device.

   What any other device can do: leave. It tells the account so (signed with
   its own key), removes the account from itself and starts again with an
   identity of its own — the way it was before it was linked. It cannot
   revoke anybody.

   A device added with the portable profile from the primary carries the
   roster in that file, and so knows the primary from its first moment. One
   added before this existed learns it from the relay or from a sibling.

   What this cannot do, and does not pretend to: a device that was revoked
   still knows the identity key it once held. Modified to ignore its
   revocation, it could come back as a new device — which the primary sees in
   this list and can revoke again — and it can read anything sealed to that
   key that it gets hold of. If a device was stolen AND its app password is
   known, the complete answer is a new identity for the account.
   ============================================================================ */

const DEVICE_ROSTER_MAX_MEMBERS = 32;
const DEVICE_ROSTER_MAX_REVOKED = 128;
const DEVICE_INTRO_INTERVAL_MS = 10 * 60 * 1000;
const KNOWN_DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ROSTER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const ROSTER_KEY_PATTERN = /^[A-Za-z0-9+/=]{40,400}$/;

const deviceRosterState = {
  key: null,              /* { deviceId, publicKeyData, privateKey } */
  keyPromise: null,
  answeredWs: null,       /* the connection on which the relay said what roster it holds */
  relayRoster: null,
  askTimer: 0,
  founding: false,
  publishTimer: 0,
  pendingEdits: [],
  introSentAt: 0,
  conflict: null,
};

/* ---- this install's own key ----------------------------------------------- */

function ensureDeviceKey() {
  const deviceId = getDeviceId();
  if (deviceRosterState.key?.deviceId === deviceId) return Promise.resolve(deviceRosterState.key);
  if (deviceRosterState.keyPromise) return deviceRosterState.keyPromise;
  deviceRosterState.keyPromise = (async () => {
    let stored = loadEncrypted(CHAT_DEVICE_KEY_STORAGE_KEY, null);
    if (!stored?.publicKeyData || !stored?.privateKeyData || stored.deviceId !== deviceId) {
      if (!isUnlocked()) return null;
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      stored = {
        deviceId,
        publicKeyData: app().arrayBufferToBase64(await crypto.subtle.exportKey('spki', pair.publicKey)),
        privateKeyData: app().arrayBufferToBase64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
        createdAt: new Date().toISOString(),
      };
      saveEncrypted(CHAT_DEVICE_KEY_STORAGE_KEY, stored);
    }
    const privateKey = await crypto.subtle.importKey(
      'pkcs8', app().base64ToArrayBuffer(stored.privateKeyData), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    deviceRosterState.key = { deviceId, publicKeyData: stored.publicKeyData, privateKey };
    return deviceRosterState.key;
  })().finally(() => { deviceRosterState.keyPromise = null; });
  return deviceRosterState.keyPromise;
}

/* What the hello carries. The connection loads the key before its first
   hello; one sent before that (the vault was still shut) goes without it, and
   the next hello carries it. */
function deviceHelloKey() {
  if (deviceRosterState.key?.deviceId === getDeviceId()) return deviceRosterState.key.publicKeyData;
  ensureDeviceKey().catch(() => null);
  return '';
}

async function deviceSign(text) {
  const key = await ensureDeviceKey();
  if (!key) return '';
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, new TextEncoder().encode(text));
  return app().arrayBufferToBase64(signature);
}
async function deviceVerify(publicKeyData, text, signature) {
  try {
    if (!ROSTER_KEY_PATTERN.test(String(publicKeyData || '')) || !signature) return false;
    const key = await crypto.subtle.importKey(
      'spki', app().base64ToArrayBuffer(publicKeyData), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, app().base64ToArrayBuffer(signature), new TextEncoder().encode(text));
  } catch (_error) {
    return false;
  }
}

/* The relay's identity challenge, answered with this device's key as well:
   it proves which install is speaking, not only which account. */
async function deviceChallengeSignature(nonceBase64) {
  if (!deviceRosterState.key) return '';
  return deviceSign(`poorija-device-proof|${chatState.identity?.fingerprint || ''}|${getDeviceId()}|${nonceBase64}`);
}

/* ---- the roster ------------------------------------------------------------ */

/* Exactly what the relay checks (scripts/server.js, rosterSignedText). */
function rosterSignedText(roster) {
  return 'poorija-roster|1|' + JSON.stringify([
    roster.fp, roster.seq, roster.at,
    [roster.primary.d, roster.primary.k, roster.primary.n],
    roster.cert,
    roster.members.map((member) => [member.d, member.k, member.n, member.at]),
    roster.revoked.map((entry) => [entry.d, entry.k, entry.at, entry.why]),
    roster.signer,
  ]);
}
function rosterCertText(fingerprint, deviceId, key) {
  return `poorija-roster-primary|${fingerprint}|${deviceId}|${key}`;
}
function rosterLabel(text) {
  return String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 48);
}
function rosterShapeValid(roster, fingerprint) {
  if (!roster || typeof roster !== 'object' || roster.v !== 1 || roster.fp !== fingerprint) return false;
  if (!Number.isSafeInteger(roster.seq) || roster.seq < 1 || !Number.isSafeInteger(roster.at)) return false;
  const primary = roster.primary;
  if (!primary || !ROSTER_ID_PATTERN.test(String(primary.d || '')) || !ROSTER_KEY_PATTERN.test(String(primary.k || ''))) return false;
  if (typeof primary.n !== 'string' || !ROSTER_KEY_PATTERN.test(String(roster.signer || '')) || !roster.cert || !roster.sig) return false;
  if (!Array.isArray(roster.members) || roster.members.length > DEVICE_ROSTER_MAX_MEMBERS) return false;
  if (!Array.isArray(roster.revoked) || roster.revoked.length > DEVICE_ROSTER_MAX_REVOKED) return false;
  if (!roster.members.every((member) => member && ROSTER_ID_PATTERN.test(String(member.d || '')) && ROSTER_KEY_PATTERN.test(String(member.k || '')) && typeof member.n === 'string' && Number.isSafeInteger(member.at))) return false;
  if (!roster.revoked.every((entry) => entry && ROSTER_ID_PATTERN.test(String(entry.d || '')) && (entry.k === '' || ROSTER_KEY_PATTERN.test(String(entry.k || ''))) && Number.isSafeInteger(entry.at) && (entry.why === 'revoked' || entry.why === 'left'))) return false;
  return !roster.revoked.some((entry) => entry.d === primary.d || (entry.k && entry.k === primary.k));
}
/* Signed as it says: the primary's certificate by the account's identity key,
   the roster by the key it names as its signer. Whether that signer may
   write it is rosterMayFollow's question. */
async function rosterSignaturesValid(roster, fingerprint) {
  const identity = chatState.identity;
  if (!identity?.publicKeyData || !rosterShapeValid(roster, fingerprint)) return false;
  try {
    const certOk = await verifyIdentitySignature(
      identity.publicKeyData,
      app().base64ToArrayBuffer(roster.cert),
      new TextEncoder().encode(rosterCertText(roster.fp, roster.primary.d, roster.primary.k)),
    );
    if (!certOk) return false;
  } catch (_error) {
    return false;
  }
  return deviceVerify(roster.signer, rosterSignedText(roster), roster.sig);
}
/* With a roster in hand, only its primary writes the next one. With none,
   the first one taken must be signed by the primary it names: a relay holds
   the account's genuine certificate, and could sign a roster of its own
   around it — but never with the primary's key. */
function rosterMayFollow(next, current) {
  if (!current) return next.signer === next.primary.k;
  return next.seq > current.seq && next.signer === current.primary.k;
}

function currentRoster() {
  const fingerprint = chatState.identity?.fingerprint || '';
  if (!fingerprint) return null;
  if (chatState.deviceRoster?.fp === fingerprint) return chatState.deviceRoster;
  const stored = loadEncrypted(CHAT_DEVICE_ROSTER_STORAGE_KEY, null);
  chatState.deviceRoster = stored?.fp === fingerprint ? stored : null;
  return chatState.deviceRoster;
}
function storeRoster(roster) {
  chatState.deviceRoster = roster;
  saveEncrypted(CHAT_DEVICE_ROSTER_STORAGE_KEY, roster);
}
function isPrimaryDevice() {
  const roster = currentRoster();
  const key = deviceRosterState.key;
  return Boolean(roster && key && roster.primary.d === getDeviceId() && roster.primary.k === key.publicKeyData);
}
function deviceRevoked(deviceId, key = '') {
  const roster = currentRoster();
  if (!roster) return false;
  return roster.revoked.some((entry) => (deviceId && entry.d === deviceId) || (key && entry.k && entry.k === key));
}
function rosterHasRevocations() {
  return Boolean(currentRoster()?.revoked?.length);
}
function rosterRevokesThisDevice(roster) {
  const mine = getDeviceId();
  const key = deviceRosterState.key?.publicKeyData || '';
  return roster.revoked.some((entry) => entry.d === mine || (key && entry.k && entry.k === key));
}

async function signRoster({ seq, primary, cert, members, revoked }) {
  const key = await ensureDeviceKey();
  if (!key) throw new Error('this device has no key yet');
  const roster = {
    v: 1,
    fp: chatState.identity.fingerprint,
    seq,
    at: Date.now(),
    primary: { d: primary.d, k: primary.k, n: rosterLabel(primary.n) },
    cert,
    members: members.slice(0, DEVICE_ROSTER_MAX_MEMBERS).map((member) => ({ d: member.d, k: member.k, n: rosterLabel(member.n), at: Number(member.at) || Date.now() })),
    revoked: revoked.slice(-DEVICE_ROSTER_MAX_REVOKED).map((entry) => ({ d: entry.d, k: entry.k || '', at: Number(entry.at) || Date.now(), why: entry.why === 'left' ? 'left' : 'revoked' })),
    signer: key.publicKeyData,
    sig: '',
  };
  roster.sig = await deviceSign(rosterSignedText(roster));
  return roster;
}
async function primaryCertificate(deviceId, key) {
  const signingKey = await importIdentitySigningKey();
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey,
    new TextEncoder().encode(rosterCertText(chatState.identity.fingerprint, deviceId, key)));
  return app().arrayBufferToBase64(signature);
}

function sendRosterToRelay(roster) {
  if (roster && chatState.ws?.readyState === WebSocket.OPEN) chatState.ws.send(JSON.stringify({ type: 'roster-put', roster }));
}
/* Kept here, given to the relay, and sealed to every sibling — including the
   ones that are away, so each finds it when it comes back. */
async function publishRoster(roster) {
  storeRoster(roster);
  sendRosterToRelay(roster);
  if (typeof sendDeviceBundles === 'function') {
    await sendDeviceBundles([{ roster }], { hold: true }).catch(() => false);
  }
  forgetGoneDevices(roster);
  renderAccountDeviceViews();
}

/* The primary's edits to its roster, gathered over a moment and signed once. */
function editRoster(edit) {
  deviceRosterState.pendingEdits.push(edit);
  if (deviceRosterState.publishTimer) return;
  deviceRosterState.publishTimer = window.setTimeout(async () => {
    deviceRosterState.publishTimer = 0;
    const edits = deviceRosterState.pendingEdits.splice(0);
    const roster = currentRoster();
    if (!roster || !isPrimaryDevice() || !edits.length) return;
    const draft = { members: roster.members.map((member) => ({ ...member })), revoked: roster.revoked.map((entry) => ({ ...entry })) };
    let changed = false;
    for (const apply of edits) changed = apply(draft) || changed;
    if (!changed) return;
    try {
      await publishRoster(await signRoster({ seq: roster.seq + 1, primary: roster.primary, cert: roster.cert, members: draft.members, revoked: draft.revoked }));
    } catch (error) {
      console.warn('[Devices] the roster could not be signed:', error?.message || error);
    }
  }, 400);
}
function upsertMember(draft, member) {
  if (draft.revoked.some((entry) => entry.d === member.d || (entry.k && entry.k === member.k))) return false;
  const existing = draft.members.find((item) => item.d === member.d);
  if (existing && existing.k === member.k && existing.n === rosterLabel(member.n)) return false;
  if (existing) Object.assign(existing, { k: member.k, n: rosterLabel(member.n) });
  else draft.members.push({ d: member.d, k: member.k, n: rosterLabel(member.n), at: Date.now() });
  return true;
}

/* A roster from the relay or from a sibling. Taken only when it verifies and
   follows from the one this device holds. */
async function adoptRoster(next) {
  const fingerprint = chatState.identity?.fingerprint || '';
  if (!fingerprint || !next) return false;
  const current = currentRoster();
  if (current && next.seq === current.seq && next.sig === current.sig) return true;
  if (!await rosterSignaturesValid(next, fingerprint)) {
    console.warn('[Devices] a roster arrived that does not verify; ignored');
    return false;
  }
  if (!rosterMayFollow(next, current)) {
    if (current && next.seq > current.seq) {
      /* Newer, but not written by the primary this device knows. */
      deviceRosterState.conflict = { primary: next.primary.d, at: Date.now() };
      renderAccountDeviceViews();
      console.warn('[Devices] a roster from a primary this device does not know; ignored');
    }
    return false;
  }
  deviceRosterState.conflict = null;
  storeRoster(next);
  await ensureDeviceKey();
  if (rosterRevokesThisDevice(next)) {
    const leftOnItsOwn = next.revoked.find((entry) => entry.d === getDeviceId())?.why === 'left';
    if (!leftOnItsOwn) await obeyRevocation({ pinned: Boolean(current) });
    return true;
  }
  /* Handed the role: say so in a roster this device signs itself, which a
     relay that never knew the old primary can take too. */
  if (isPrimaryDevice() && next.signer !== next.primary.k) {
    editRoster((draft) => { void draft; return true; });
  }
  forgetGoneDevices(next);
  renderAccountDeviceViews();
  maybeIntroduceDevice();
  return true;
}

/* What the relay holds, answered after every proof and on request. */
/* Answered on THIS connection: a reconnect asks again. */
function rosterAnswered() {
  return Boolean(chatState.ws) && deviceRosterState.answeredWs === chatState.ws;
}
async function handleRelayRoster(remote) {
  deviceRosterState.answeredWs = chatState.ws;
  deviceRosterState.relayRoster = remote || null;
  const local = currentRoster();
  if (remote && (!local || remote.seq > local.seq)) await adoptRoster(remote);
  else if (local && (!remote || local.seq > remote.seq)) sendRosterToRelay(local);
  await maybeFoundRoster();
  maybeIntroduceDevice();
  renderAccountDeviceViews();
}
async function handleRosterRefused(message) {
  const remote = message.roster || null;
  const local = currentRoster();
  /* Founded here a moment ago, while another device of the account got its
     roster to the relay first: the relay's stands, and this device takes it
     the way it would have if it had arrived second. */
  if (remote && local && local.seq === 1 && deviceRosterState.founding && local.primary.d === getDeviceId()) {
    deviceRosterState.founding = false;
    chatState.deviceRoster = null;
    saveEncrypted(CHAT_DEVICE_ROSTER_STORAGE_KEY, null);
    await adoptRoster(remote);
    return;
  }
  if (remote) await adoptRoster(remote);
  if (message.reason === 'not-primary' && remote && currentRoster()?.primary.d !== remote.primary.d) {
    deviceRosterState.conflict = { primary: remote.primary.d, at: Date.now() };
    renderAccountDeviceViews();
  }
}
function handleRosterStored() {
  deviceRosterState.founding = false;
}

/* The device revoked here, by a roster this device can check for itself. A
   refusal that does not verify is not obeyed: the relay can keep a device
   out, but it cannot make one wipe itself. */
async function handleDeviceRevokedNotice(message) {
  const roster = message.roster;
  const fingerprint = chatState.identity?.fingerprint || '';
  const refusedWithoutReason = () => {
    console.warn('[Devices] the relay refused this device without a roster that verifies');
    notify(t('سرور این دستگاه را نپذیرفت، اما دلیلی قابل‌تأیید ارائه نکرد؛ هیچ داده‌ای پاک نشد.',
      'The relay refused this device but gave no reason that verifies; nothing was removed.'), 'warning');
  };
  if (!roster || !fingerprint) { refusedWithoutReason(); return; }
  /* Exactly the rules any roster is taken by (adoptRoster): signed by the
     primary this device knows, and newer than what it holds. Taking it is
     what removes the account, if it revokes this device. */
  const current = currentRoster();
  if (current && roster.seq === current.seq && roster.sig === current.sig) {
    await ensureDeviceKey();
    if (rosterRevokesThisDevice(current)) await obeyRevocation({ pinned: true });
    return;
  }
  if (!await adoptRoster(roster)) refusedWithoutReason();
}

/* A revocation signed by the primary this device already knew is obeyed at
   once. One that arrived on a roster this device is taking for the first
   time is real too — only the account's own devices can sign one — but a
   device that knew no primary cannot tell the account's primary from another
   device of it, so the person is asked before the account is removed. The
   relay keeps the device out either way. */
async function obeyRevocation({ pinned }) {
  if (!pinned) {
    const ok = await PoorijaDialogs.confirm(
      t('دستگاه اصلی این حساب اعلام کرده که دسترسی این دستگاه لغو شده است، و سرور دیگر آن را راه نمی‌دهد. حساب از روی این دستگاه پاک شود و این دستگاه با هویتی تازه ادامه دهد؟',
        'This account\'s primary device says this device was revoked, and the relay no longer lets it in. Remove the account from this device and carry on with a new identity?'),
      { danger: true, okLabel: t('پاک کن و ادامه بده', 'Remove and carry on') },
    ).catch(() => false);
    if (!ok) return;
  }
  await leaveAccount({ reason: 'revoked' });
}

/* ---- the first roster ------------------------------------------------------ */

/* Who founds it without being asked: the device that made the identity, and
   a device that has only ever been alone with it. A device of an account
   that already had several before this existed waits to be told which one
   is the primary (claimPrimaryDevice) — guessing would be a coin toss. */
async function maybeFoundRoster() {
  if (currentRoster() || !rosterAnswered() || deviceRosterState.relayRoster || deviceRosterState.founding) return;
  const origin = chatState.identity?.origin || '';
  const neverHadSiblings = !origin && !chatState.hasLinkedDevices && !chatState.profile.hasLinkedDevices
    && (typeof siblingBeacons === 'undefined' || siblingBeacons.size === 0)
    && (chatState.linkedDevices || []).length <= 1;
  if (origin !== 'generated' && !neverHadSiblings) return;
  await foundRoster();
}
async function foundRoster() {
  const key = await ensureDeviceKey();
  if (!key || !chatState.identity?.fingerprint) return false;
  deviceRosterState.founding = true;
  const me = { d: getDeviceId(), k: key.publicKeyData, n: deviceLabel() };
  const roster = await signRoster({
    seq: 1,
    primary: me,
    cert: await primaryCertificate(me.d, me.k),
    members: [{ ...me, at: Date.now() }],
    revoked: [],
  });
  await publishRoster(roster);
  return true;
}
async function claimPrimaryDevice() {
  if (currentRoster()) return;
  const ok = await PoorijaDialogs.confirm(
    t('این دستگاه «دستگاه اصلی» این حساب شود؟ فقط دستگاه اصلی می‌تواند دستگاه‌های دیگر را لغو دسترسی کند یا این نقش را به دستگاه دیگری بسپارد.',
      'Make this device the primary device of this account? Only the primary can revoke the other devices or hand this role to another device.'),
    { okLabel: t('دستگاه اصلی شود', 'Make primary') },
  );
  if (!ok) return;
  await foundRoster();
  notify(t('این دستگاه، دستگاه اصلی حساب شد.', 'This device is now the account\'s primary device.'), 'success');
}

/* ---- each device introduces itself to the primary -------------------------- */

function deviceIntroText(fingerprint, intro) {
  return `poorija-device-intro|${fingerprint}|${intro.d}|${intro.k}|${intro.n}|${intro.at}`;
}
function deviceLeftText(fingerprint, left) {
  return `poorija-device-left|${fingerprint}|${left.d}|${left.k}|${left.at}`;
}
async function maybeIntroduceDevice() {
  const roster = currentRoster();
  if (!roster) return;
  const key = await ensureDeviceKey();
  if (!key || rosterRevokesThisDevice(roster)) return;
  const me = { d: getDeviceId(), k: key.publicKeyData, n: deviceLabel() };
  const listed = roster.members.find((member) => member.d === me.d);
  if (listed && listed.k === me.k && listed.n === rosterLabel(me.n)) return;
  if (isPrimaryDevice()) {
    editRoster((draft) => upsertMember(draft, me));
    return;
  }
  if (deviceRosterState.introducing || Date.now() - deviceRosterState.introSentAt < DEVICE_INTRO_INTERVAL_MS) return;
  if (typeof sendDeviceBundles !== 'function') return;
  deviceRosterState.introducing = true;
  try {
    const intro = { ...me, n: rosterLabel(me.n), at: Date.now() };
    intro.s = await deviceSign(deviceIntroText(roster.fp, intro));
    /* Counted only once it went: offline, it goes on the next connection. */
    if (await sendDeviceBundles([{ deviceIntro: intro }], { hold: true }).catch(() => false)) deviceRosterState.introSentAt = Date.now();
  } finally {
    deviceRosterState.introducing = false;
  }
}

/* Roster traffic inside a sealed sync bundle (mergeDeviceSyncBundle hands
   every bundle here first). */
async function handleRosterBundle(bundle) {
  if (bundle?.roster) await adoptRoster(bundle.roster);
  const fingerprint = chatState.identity?.fingerprint || '';
  if (bundle?.deviceIntro && fingerprint) {
    const intro = bundle.deviceIntro;
    if (isPrimaryDevice() && ROSTER_ID_PATTERN.test(String(intro.d || '')) && !deviceRevoked(intro.d, intro.k)
      && await deviceVerify(intro.k, deviceIntroText(fingerprint, intro), intro.s)) {
      editRoster((draft) => upsertMember(draft, { d: intro.d, k: intro.k, n: intro.n }));
    }
  }
  if (bundle?.deviceLeft && fingerprint) {
    const left = bundle.deviceLeft;
    if (ROSTER_ID_PATTERN.test(String(left.d || '')) && await deviceVerify(left.k, deviceLeftText(fingerprint, left), left.s)) {
      forgetKnownDevice(left.d);
      if (isPrimaryDevice()) {
        editRoster((draft) => {
          const listed = draft.members.find((member) => member.d === left.d);
          /* Only the device itself can say it left: its own key, or, for one
             never listed, the key it signed with. */
          if (listed && listed.k !== left.k) return false;
          draft.members = draft.members.filter((member) => member.d !== left.d);
          if (!draft.revoked.some((entry) => entry.d === left.d)) draft.revoked.push({ d: left.d, k: left.k, at: Date.now(), why: 'left' });
          return true;
        });
      }
      renderAccountDeviceViews();
    }
  }
}

/* ---- what the primary does --------------------------------------------------- */

async function revokeAccountDevice(deviceId) {
  if (!isPrimaryDevice()) {
    notify(t('فقط دستگاه اصلی می‌تواند دستگاه دیگری را لغو دسترسی کند.', 'Only the primary device can revoke another device.'), 'warning');
    return;
  }
  if (!deviceId || deviceId === getDeviceId()) return;
  const device = accountDevices().find((item) => item.deviceId === deviceId);
  const label = device ? deviceLabelText(device.label) : deviceId.slice(-6);
  const ok = await PoorijaDialogs.confirm(
    t(`دسترسی «${label}» به این حساب لغو شود؟\n\nآن دستگاه دیگر پیام، همگام‌سازی یا فایلی از این حساب نمی‌گیرد؛ سرور آن را راه نمی‌دهد و خودِ آن دستگاه، به‌محض باخبر شدن، حساب را از روی خودش پاک می‌کند و با هویتی تازه ادامه می‌دهد. این کار برگشت‌پذیر نیست.`,
      `Revoke "${label}" from this account?\n\nThat device will get no more messages, sync or files from this account; the relay refuses it, and the device itself, as soon as it learns of it, removes the account from itself and carries on with a new identity of its own. This cannot be undone.`),
    { danger: true, okLabel: t('لغو دسترسی', 'Revoke') },
  );
  if (!ok) return;
  const roster = currentRoster();
  const listed = roster.members.find((member) => member.d === deviceId);
  editRoster((draft) => {
    draft.members = draft.members.filter((member) => member.d !== deviceId);
    if (draft.revoked.some((entry) => entry.d === deviceId)) return false;
    draft.revoked.push({ d: deviceId, k: listed?.k || '', at: Date.now(), why: 'revoked' });
    return true;
  });
  forgetKnownDevice(deviceId);
  notify(t(`دسترسی «${label}» لغو شد.`, `"${label}" was revoked.`), 'success');
}

async function makeAccountDevicePrimary(deviceId, { quiet = false } = {}) {
  if (!isPrimaryDevice()) return false;
  const roster = currentRoster();
  const member = roster.members.find((item) => item.d === deviceId);
  if (!member || deviceId === getDeviceId()) {
    if (!quiet) notify(t('این دستگاه هنوز خودش را به دستگاه اصلی معرفی نکرده است؛ وقتی هر دو آنلاین بودند دوباره امتحان کنید.', 'That device has not introduced itself to the primary yet; try again when both are online.'), 'warning');
    return false;
  }
  if (!quiet) {
    const ok = await PoorijaDialogs.confirm(
      t(`«${deviceLabelText(member.n)}» دستگاه اصلی شود؟ از این پس فقط آن دستگاه می‌تواند دستگاه‌ها را لغو دسترسی کند.`,
        `Make "${deviceLabelText(member.n)}" the primary device? From then on only that device can revoke devices.`),
      { okLabel: t('انتقال نقش اصلی', 'Hand over') },
    );
    if (!ok) return false;
  }
  const next = await signRoster({
    seq: roster.seq + 1,
    primary: { d: member.d, k: member.k, n: member.n },
    cert: await primaryCertificate(member.d, member.k),
    members: roster.members,
    revoked: roster.revoked,
  });
  await publishRoster(next);
  if (!quiet) notify(t('نقش دستگاه اصلی منتقل شد.', 'The primary role was handed over.'), 'success');
  return true;
}

/* ---- leaving ----------------------------------------------------------------- */

async function detachThisDevice() {
  const roster = currentRoster();
  const others = accountDevices().filter((device) => !device.isSelf);
  const ok = await PoorijaDialogs.confirm(
    t('این دستگاه از این حساب جدا شود؟\n\nهویت، گفتگوها، مخاطبین و فایل‌های این حساب از روی همین دستگاه پاک می‌شود و این دستگاه با یک هویت تازه، مثل قبل از اتصال، جداگانه ادامه می‌دهد. دستگاه‌های دیگر حساب بی‌تغییر ادامه می‌دهند. این کار برگشت‌پذیر نیست.',
      'Detach this device from this account?\n\nThe account\'s identity, conversations, contacts and files are removed from this device, and it carries on separately with a new identity, as it was before it was linked. The account\'s other devices carry on unchanged. This cannot be undone.'),
    { danger: true, okLabel: t('جدا کن', 'Detach') },
  );
  if (!ok) return;
  if (roster && isPrimaryDevice()) {
    const heirs = roster.members.filter((member) => member.d !== getDeviceId());
    if (heirs.length) {
      const choice = heirs.length === 1 ? heirs[0].d : await PoorijaDialogs.choose(
        t('پیش از جدا شدن، کدام دستگاه دستگاه اصلی شود؟', 'Before leaving, which device becomes the primary?'),
        heirs.map((member) => ({ value: member.d, label: `${deviceLabelText(member.n)} · ${member.d.slice(-6)}` })),
        { cancelLabel: t('انصراف', 'Cancel') },
      );
      if (!choice) return;
      if (!await makeAccountDevicePrimary(choice, { quiet: true })) return;
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    } else if (others.length) {
      notify(t('دستگاه دیگر هنوز به دستگاه اصلی معرفی نشده؛ حساب بدون دستگاه اصلی ادامه می‌دهد.', 'The other device has not introduced itself yet; the account carries on without a primary.'), 'info');
    }
  }
  await announceLeaving();
  await leaveAccount({ reason: 'left' });
}

async function announceLeaving() {
  const key = await ensureDeviceKey();
  const fingerprint = chatState.identity?.fingerprint || '';
  if (!key || !fingerprint) return;
  const left = { d: getDeviceId(), k: key.publicKeyData, at: Date.now() };
  left.s = await deviceSign(deviceLeftText(fingerprint, left));
  if (typeof sendDeviceBundles === 'function') await sendDeviceBundles([{ deviceLeft: left }], { hold: true }).catch(() => false);
  if (chatState.ws?.readyState === WebSocket.OPEN) chatState.ws.send(JSON.stringify({ type: 'beacon-drop' }));
  await new Promise((resolve) => window.setTimeout(resolve, 900));
}

/* The account, off this device: its identity and keys, its conversations,
   calls, contacts, groups and files — and this install's own device id and
   key, so what comes next is a new device as well as a new identity. The
   preferences that are this device's own (its relay, its TURN settings, the
   display name) stay. */
async function leaveAccount({ reason }) {
  if (leaveAccount.running) return;
  leaveAccount.running = true;
  try {
    const previous = chatState.identity?.fingerprint || '';
    chatState.shouldReconnect = false;
    try { clearReconnectTimer(); } catch (_error) { /* none scheduled */ }
    try { chatState.sessions.forEach((session) => { try { session.connection?.close?.(); } catch (_error) { /* gone */ } }); } catch (_error) { /* none */ }
    try { chatState.peer?.destroy?.(); } catch (_error) { /* gone */ }
    try { chatState.ws?.close?.(); } catch (_error) { /* gone */ }
    chatState.history = {};
    try { await clearMediaVault(); } catch (_error) { /* nothing stored */ }

    [
      CHAT_IDENTITY_STORAGE_KEY, CHAT_SESSION_KEYS_STORAGE_KEY, CHAT_HISTORY_STORAGE_KEY, CHAT_CALLS_STORAGE_KEY,
      CHAT_CONTACTS_STORAGE_KEY, CHAT_SPACES_STORAGE_KEY, CHAT_PREKEY_STORAGE_KEY, CHAT_DRAFTS_STORAGE_KEY,
      CHAT_UNREAD_FLAGS_STORAGE_KEY, CHAT_DELETED_STORAGE_KEY, CHAT_BLOCKLIST_STORAGE_KEY, CHAT_LOCK_STORAGE_KEY,
      CHAT_DEVICE_KEY_STORAGE_KEY, CHAT_DEVICE_ROSTER_STORAGE_KEY, CHAT_KNOWN_DEVICES_STORAGE_KEY,
    ].forEach(forgetEncrypted);
    try {
      localStorage.removeItem(CHAT_DEVICE_ID_STORAGE_KEY);
      localStorage.removeItem(CHAT_DEVICE_SYNC_ALL_STORAGE_KEY);
    } catch (_error) { /* private mode */ }

    chatState.identity = null;
    chatState.sessionKeys = {};
    chatState.sessions.clear();
    chatState.history = {};
    chatState.calls = [];
    chatState.peers = [];
    chatState.drafts = {};
    chatState.prekeys = [];
    chatState.spaces = { groups: [], channels: [] };
    chatState.linkedDevices = [];
    chatState.hasLinkedDevices = false;
    chatState.deviceRoster = null;
    chatState.deviceSyncBehind = null;
    chatState.remoteSiblings = new Set();
    chatState.activeConversationId = null;
    chatState.activePeerClientId = '';
    chatState.mediaUrls.forEach((url) => { try { URL.revokeObjectURL(url); } catch (_error) { /* gone */ } });
    chatState.mediaUrls.clear();
    if (typeof siblingBeacons !== 'undefined') siblingBeacons.clear();
    if (typeof siblingJournal !== 'undefined') Object.assign(siblingJournal, { signatures: new Map(), ids: new Map(), baseline: false });
    Object.assign(deviceRosterState, { key: null, answeredWs: null, relayRoster: null, founding: false, pendingEdits: [], introSentAt: 0, conflict: null });
    chatState.profile = {
      ...chatState.profile,
      avatarData: '',
      mood: '',
      stablePeerId: '',
      peerIdSuffix: false,
      hasLinkedDevices: false,
    };
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);

    await ensureIdentity();
    renderStaticUi();
    renderPeers();
    renderActivePeer();
    renderMessages();
    renderAccountDeviceViews();
    notify(reason === 'revoked'
      ? t('دستگاه اصلیِ حساب، دسترسی این دستگاه را لغو کرد. حساب از روی این دستگاه پاک شد و این دستگاه با هویتی تازه ادامه می‌دهد.',
        'The account\'s primary device revoked this device. The account was removed from this device, which carries on with a new identity.')
      : t('این دستگاه از حساب جدا شد و با هویتی تازه ادامه می‌دهد.', 'This device left the account and carries on with a new identity.'),
    reason === 'revoked' ? 'warning' : 'success');
    console.log(`[Devices] left ${previous.slice(0, 12)} (${reason}); now ${String(chatState.identity?.fingerprint || '').slice(0, 12)}`);
    if (chatState.profile.chatEnabled && isUsableRelayOrigin(chatState.profile.serverUrl)) {
      chatState.shouldReconnect = true;
      chatState.reconnectAttempt = 0;
      await connectChatTransport().catch((error) => console.warn('[Devices] reconnect after leaving failed:', error?.message || error));
    }
  } finally {
    leaveAccount.running = false;
  }
}

/* ---- the account's devices, as this device knows them ------------------------ */

/* Every device this account has had, kept here so one that is away is still
   listed — the relay's presence table only names the ones connected now. */
function knownDevices() {
  const stored = loadEncrypted(CHAT_KNOWN_DEVICES_STORAGE_KEY, null);
  return stored && typeof stored === 'object' && stored.fp === chatState.identity?.fingerprint ? stored : { fp: chatState.identity?.fingerprint || '', devices: {} };
}
function noteKnownDevice(deviceId, { label = '', seenAt = 0 } = {}) {
  if (!deviceId || !chatState.identity?.fingerprint || deviceRevoked(deviceId)) return false;
  const book = knownDevices();
  const before = book.devices[deviceId];
  const next = {
    n: rosterLabel(label || before?.n || ''),
    seen: Math.max(Number(before?.seen || 0), Number(seenAt || 0)),
    first: Number(before?.first || Date.now()),
  };
  /* Seen again within the minute is not news worth a write: the peers table
     is broadcast on every presence change on the relay. */
  if (before && before.n === next.n && next.seen - Number(before.seen || 0) < 60000) return false;
  book.devices[deviceId] = next;
  saveEncrypted(CHAT_KNOWN_DEVICES_STORAGE_KEY, book);
  return true;
}
function forgetKnownDevice(deviceId) {
  const book = knownDevices();
  if (book.devices[deviceId]) {
    delete book.devices[deviceId];
    saveEncrypted(CHAT_KNOWN_DEVICES_STORAGE_KEY, book);
  }
  if (typeof siblingBeacons !== 'undefined') siblingBeacons.delete(deviceId);
}
function forgetGoneDevices(roster) {
  for (const entry of roster?.revoked || []) forgetKnownDevice(entry.d);
}
/* The peers handler and the beacons call this with what they just saw. */
function noteSeenAccountDevices() {
  const now = Date.now();
  let changed = false;
  for (const device of chatState.linkedDevices || []) {
    if (!device.deviceId || device.deviceId === getDeviceId()) continue;
    changed = noteKnownDevice(device.deviceId, { label: siblingBeacons?.get?.(device.deviceId)?.n || '', seenAt: now }) || changed;
  }
  if (typeof siblingBeacons !== 'undefined') {
    for (const [deviceId, beacon] of siblingBeacons) {
      changed = noteKnownDevice(deviceId, { label: beacon?.n || '', seenAt: Number(beacon?.u || 0) * 1000 }) || changed;
    }
  }
  const book = knownDevices();
  for (const [deviceId, entry] of Object.entries(book.devices)) {
    if (now - Number(entry.seen || entry.first || 0) > KNOWN_DEVICE_TTL_MS) { delete book.devices[deviceId]; changed = true; }
  }
  if (changed) saveEncrypted(CHAT_KNOWN_DEVICES_STORAGE_KEY, book);
  return changed;
}

/* One list for the two places that show it: this device first, then the
   primary, then the rest, most recently seen first. */
function accountDevices() {
  const mine = getDeviceId();
  const roster = currentRoster();
  const online = new Set((chatState.linkedDevices || []).map((device) => device.deviceId).filter(Boolean));
  const remote = chatState.remoteSiblings instanceof Set ? chatState.remoteSiblings : new Set();
  const book = knownDevices().devices;
  const byId = new Map();
  const add = (deviceId, fields) => {
    if (!deviceId || deviceRevoked(deviceId)) return;
    const existing = byId.get(deviceId) || { deviceId, label: '', lastSeen: 0, inRoster: false };
    byId.set(deviceId, { ...existing, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== '' && value !== undefined)) });
  };
  add(mine, { label: deviceLabel() });
  for (const member of roster?.members || []) add(member.d, { label: member.n, inRoster: true });
  for (const [deviceId, entry] of Object.entries(book)) add(deviceId, { label: entry.n, lastSeen: Number(entry.seen || 0) });
  if (typeof siblingBeacons !== 'undefined') {
    for (const [deviceId, beacon] of siblingBeacons) add(deviceId, { label: beacon?.n || '', lastSeen: Math.max(Number(beacon?.u || 0) * 1000, byId.get(deviceId)?.lastSeen || 0) });
  }
  for (const deviceId of online) add(deviceId, { lastSeen: Date.now() });
  return [...byId.values()].map((device) => ({
    ...device,
    isSelf: device.deviceId === mine,
    isPrimary: Boolean(roster && roster.primary.d === device.deviceId),
    online: device.deviceId === mine ? Boolean(chatState.connected) : (online.has(device.deviceId) || remote.has(device.deviceId)),
  })).sort((a, b) => (b.isSelf - a.isSelf) || (b.isPrimary - a.isPrimary) || (b.online - a.online) || (b.lastSeen - a.lastSeen));
}

/* "macOS app" → "macOS · برنامه". */
function deviceLabelText(label) {
  const parts = String(label || '').trim().split(/\s+/);
  const shell = parts.length > 1 ? parts.pop() : '';
  const platform = parts.join(' ') || t('دستگاه', 'Device');
  const kind = shell === 'app' ? t('برنامه', 'app') : shell === 'web' ? t('وب', 'web') : shell;
  return kind ? `${platform} · ${kind}` : platform;
}
function deviceIconFor(label) {
  const text = String(label || '');
  if (/iOS|Android|iPhone|iPad/i.test(text)) return 'fa-mobile-screen';
  if (/macOS|Windows|Linux/i.test(text)) return 'fa-laptop';
  return 'fa-display';
}
function lastSeenText(at) {
  if (!at) return t('آفلاین', 'offline');
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  const ago = minutes < 1 ? t('همین حالا', 'just now')
    : minutes < 60 ? t(`${minutes} دقیقه پیش`, `${minutes} min ago`)
      : minutes < 1440 ? t(`${Math.round(minutes / 60)} ساعت پیش`, `${Math.round(minutes / 60)} h ago`)
        : t(`${Math.round(minutes / 1440)} روز پیش`, `${Math.round(minutes / 1440)} d ago`);
  return t(`آفلاین · ${ago}`, `offline · ${ago}`);
}
function accountDeviceCounts() {
  const devices = accountDevices();
  return { total: devices.length, online: devices.filter((device) => device.online).length };
}
function accountDeviceSummary() {
  const { total, online } = accountDeviceCounts();
  if (total <= 1) return t('فقط این دستگاه', 'This device only');
  return t(`${total} دستگاه · ${online} آنلاین`, `${total} devices · ${online} online`);
}

/* The list, the role and the switches — the same in Settings › My devices and
   in the identity card's "Linked devices". */
function accountDevicesHtml({ compact = false } = {}) {
  const escape = (text) => app().escapeHTML(String(text ?? ''));
  const roster = currentRoster();
  const primaryHere = isPrimaryDevice();
  const devices = accountDevices();
  const several = devices.length > 1;
  const rows = devices.map((device) => {
    const actions = [];
    if (primaryHere && !device.isSelf) {
      if (device.inRoster) actions.push(`<button type="button" class="chat-device-action" data-device-action="primary" data-device-id="${escape(device.deviceId)}"><i class="fas fa-crown"></i><span>${escape(t('اصلی شود', 'Make primary'))}</span></button>`);
      actions.push(`<button type="button" class="chat-device-action is-danger" data-device-action="revoke" data-device-id="${escape(device.deviceId)}"><i class="fas fa-ban"></i><span>${escape(t('لغو دسترسی', 'Revoke'))}</span></button>`);
    }
    if (device.isSelf && several) {
      actions.push(`<button type="button" class="chat-device-action is-danger" data-device-action="detach"><i class="fas fa-link-slash"></i><span>${escape(t('جدا کردن این دستگاه', 'Detach this device'))}</span></button>`);
    }
    return `<div class="chat-device-row${device.online ? ' is-online' : ''}" data-device-row="${escape(device.deviceId)}">
  <i class="fas ${deviceIconFor(device.label)} chat-device-icon" aria-hidden="true"></i>
  <div class="chat-device-main">
    <div class="chat-device-name">
      <span>${escape(deviceLabelText(device.label))}</span>
      ${device.isPrimary ? `<span class="chat-device-badge is-primary"><i class="fas fa-crown"></i>${escape(t('اصلی', 'Primary'))}</span>` : ''}
      ${device.isSelf ? `<span class="chat-device-badge">${escape(t('این دستگاه', 'This device'))}</span>` : ''}
    </div>
    <div class="chat-device-meta">
      <span class="chat-device-status"><span class="chat-device-dot" aria-hidden="true"></span>${escape(device.online ? t('آنلاین', 'online') : lastSeenText(device.lastSeen))}</span>
      <span class="chat-device-id">${escape(device.deviceId.slice(-6))}</span>
    </div>
  </div>
  ${actions.length ? `<div class="chat-device-actions">${actions.join('')}</div>` : ''}
</div>`;
  }).join('');

  const roleLine = roster
    ? (primaryHere
      ? t('این دستگاه، دستگاه اصلی حساب است: فقط همین دستگاه می‌تواند دستگاه‌های دیگر را لغو دسترسی کند.', 'This is the account\'s primary device: only it can revoke the other devices.')
      : t('دستگاه اصلی می‌تواند دسترسی دستگاه‌ها را لغو کند؛ این دستگاه می‌تواند خودش را از حساب جدا کند.', 'The primary device can revoke devices; this device can detach itself from the account.'))
    : '';
  const claim = !roster && rosterAnswered() && !deviceRosterState.relayRoster
    ? `<div class="chat-device-claim">
  <span>${escape(t('این حساب هنوز دستگاه اصلی ندارد. دستگاهی که اول این هویت را ساخته‌اید را «اصلی» کنید.', 'This account has no primary device yet. Make the device you first created this identity on the primary.'))}</span>
  <button type="button" class="chat-device-action" data-device-action="claim"><i class="fas fa-crown"></i><span>${escape(t('این دستگاه اصلی شود', 'Make this the primary'))}</span></button>
</div>`
    : '';
  const conflict = deviceRosterState.conflict
    ? `<div class="chat-device-claim is-warning"><span>${escape(t('فهرستی از دستگاه‌های این حساب رسید که دستگاه اصلیِ شناخته‌شده امضایش نکرده است؛ پذیرفته نشد.', 'A list of this account\'s devices arrived that the known primary device did not sign; it was not accepted.'))}</span></div>`
    : '';
  const auto = typeof deviceSyncAllEnabled === 'function' && deviceSyncAllEnabled();
  const autoStatus = typeof siblingAutoPullStatus === 'function' ? siblingAutoPullStatus() : '';
  const toggles = `
<label class="chat-device-toggle">
  <input type="checkbox" data-device-toggle="all" ${auto ? 'checked' : ''}>
  <span>
    <strong>${escape(t('همگام‌سازی کامل همهٔ محتوا', 'Sync all content'))}</strong>
    <small>${escape(t('وقتی دستگاه‌ها هم‌زمان آنلاین‌اند، هر فایل، عکس، ویدیو، صدا، استیکر و گیف خودکار و مستقیم دستگاه‌به‌دستگاه منتقل و روی هر دستگاه نگه داشته می‌شود — بدون عبور از سرور.', 'While the devices are online together, every file, photo, video, voice note, sticker and GIF moves automatically, device to device, and is kept on each — never through the relay.'))}${autoStatus ? ` <em>${escape(autoStatus)}</em>` : ''}</small>
  </span>
</label>
<label class="chat-device-toggle">
  <input type="checkbox" data-device-toggle="files" ${deviceSyncFilesEnabled() || auto ? 'checked' : ''} ${auto ? 'disabled' : ''}>
  <span>
    <strong>${escape(t('جابه‌جایی فایل بین دستگاه‌ها', 'Move files between devices'))}</strong>
    <small>${escape(t('این دستگاه فایل‌هایش را به دستگاه‌های دیگرِ همین حساب می‌دهد؛ بقیه با دکمهٔ «دریافت از دستگاه دیگر».', 'This device hands its files to the account\'s other devices; the rest come with the "Fetch from my other device" button.'))}</small>
  </span>
</label>`;
  const intro = compact ? '' : `<p class="chat-device-note">${escape(t('هر دستگاهی که این هویت را دارد پیام‌ها را هم‌زمان می‌گیرد و تاریخچه، تماس‌ها و مخاطبین با آن همگام می‌شود — بسته‌شده و فقط خواندنی برای دستگاه‌های خودتان. برای افزودن دستگاه، پروفایل همراه را از این دستگاه خروجی بگیرید و روی دستگاه جدید وارد کنید.', 'Every device holding this identity receives messages at the same time, and the history, calls and contacts sync with it — sealed, readable only by your own devices. To add a device, export the portable profile from this device and import it on the new one.'))}</p>`;
  return `<div class="chat-account-devices${compact ? ' is-compact' : ''}">
${compact ? '' : `<div class="chat-device-heading">${escape(t('دستگاه‌های متصل به این هویت', 'Devices linked to this identity'))}</div>`}
<div class="chat-device-summary"><i class="fas fa-circle-nodes"></i><span>${escape(accountDeviceSummary())}</span></div>
${intro}
${roleLine ? `<p class="chat-device-role">${escape(roleLine)}</p>` : ''}
${claim}${conflict}
<div class="chat-device-list">${rows}</div>
${toggles}
<div class="chat-device-buttons">
  <button type="button" class="chat-device-action" data-device-action="sync"><i class="fas fa-rotate"></i><span>${escape(t('هم‌اکنون همگام کن', 'Sync now'))}</span></button>
  <button type="button" class="chat-device-action" data-device-action="add"><i class="fas fa-qrcode"></i><span>${escape(t('افزودن دستگاه', 'Add a device'))}</span></button>
</div>
</div>`;
}

let accountDeviceRenderTimer = 0;
function renderAccountDeviceViews() {
  if (accountDeviceRenderTimer) return;
  accountDeviceRenderTimer = window.setTimeout(() => {
    accountDeviceRenderTimer = 0;
    if (chatState.settingsPane === 'devices' && typeof renderDevicesCard === 'function') renderDevicesCard();
    if (typeof renderLinkedDeviceCount === 'function') renderLinkedDeviceCount();
  }, 60);
}

/* One listener for every button and switch in either list. */
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-device-action]');
  if (!button || !button.closest('.chat-account-devices')) return;
  event.preventDefault();
  const deviceId = button.getAttribute('data-device-id') || '';
  const action = button.getAttribute('data-device-action');
  const run = {
    revoke: () => revokeAccountDevice(deviceId),
    primary: () => makeAccountDevicePrimary(deviceId),
    detach: () => detachThisDevice(),
    claim: () => claimPrimaryDevice(),
    sync: () => sendDeviceSyncFromUi(),
    add: () => (typeof openLinkChooser === 'function' ? openLinkChooser('account') : exportPortableProfileFile()),
  }[action];
  if (run) Promise.resolve(run()).catch((error) => console.warn('[Devices] action failed:', error?.message || error));
});
document.addEventListener('change', (event) => {
  const toggle = event.target.closest?.('[data-device-toggle]');
  if (!toggle || !toggle.closest('.chat-account-devices')) return;
  if (toggle.getAttribute('data-device-toggle') === 'all') setDeviceSyncAllEnabled(toggle.checked);
  else setDeviceSyncFilesEnabled(toggle.checked);
  renderAccountDeviceViews();
});

/* Called when the relay connection is up and this device's identity proven. */
/* The relay says what it holds after every proof of identity; this asks as
   well, and again a few times while there is no answer — a question that
   lands while the relay is re-checking the identity is refused, not queued. */
function startDeviceRoster() {
  ensureDeviceKey().then(() => renderAccountDeviceViews()).catch(() => null);
  let asked = 0;
  const ask = () => {
    deviceRosterState.askTimer = 0;
    if (rosterAnswered() || asked >= 4 || chatState.ws?.readyState !== WebSocket.OPEN) return;
    asked += 1;
    chatState.ws.send(JSON.stringify({ type: 'roster-get' }));
    deviceRosterState.askTimer = window.setTimeout(ask, 3000);
  };
  if (deviceRosterState.askTimer) window.clearTimeout(deviceRosterState.askTimer);
  ask();
}

window.__deviceRosterProbe = {
  roster: () => currentRoster(),
  primary: () => isPrimaryDevice(),
  key: async () => (await ensureDeviceKey())?.publicKeyData || '',
  devices: () => accountDevices(),
  summary: () => accountDeviceSummary(),
  revoke: async (deviceId) => {
    const roster = currentRoster();
    const listed = roster?.members.find((member) => member.d === deviceId);
    editRoster((draft) => {
      draft.members = draft.members.filter((member) => member.d !== deviceId);
      draft.revoked.push({ d: deviceId, k: listed?.k || '', at: Date.now(), why: 'revoked' });
      return true;
    });
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    return currentRoster()?.seq || 0;
  },
  /* What a device that is NOT the primary would have to forge: a roster
     signed with its own key. The relay and the siblings must refuse it. */
  forgeRevoke: async (deviceId) => {
    const roster = currentRoster();
    const forged = await signRoster({
      seq: roster.seq + 1,
      primary: roster.primary,
      cert: roster.cert,
      members: roster.members.filter((member) => member.d !== deviceId),
      revoked: [...roster.revoked, { d: deviceId, k: '', at: Date.now(), why: 'revoked' }],
    });
    sendRosterToRelay(forged);
    if (typeof sendDeviceBundles === 'function') await sendDeviceBundles([{ roster: forged }]);
    return forged.seq;
  },
  leave: async () => { await announceLeaving(); await leaveAccount({ reason: 'left' }); return chatState.identity?.fingerprint || ''; },
  handOver: (deviceId) => makeAccountDevicePrimary(deviceId, { quiet: true }),
};
