/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 7 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   The app has one password for everything. Conversations are the most
*/

/* =====================================================================
   Chat lock, global search, key verification
   ===================================================================== */

/* ---------------- 1. a separate lock for the chat tab ---------------
   The app has one password for everything. Conversations are the most
   sensitive thing in it and the most likely to be read over a shoulder,
   so they get a second door. The PIN is never stored — only a PBKDF2
   digest of it, salted per install, so the stored value cannot be
   turned back into the PIN. */
const CHAT_LOCK_STORAGE_KEY = 'poorija_chat_lock';
/* What a NEW lock is derived at. 150000 was the old number and is kept as
   LEGACY_LOCK_ITERATIONS below, because every lock already on a device was
   derived with it and re-deriving needs the PIN, which we only have at the
   moment somebody types it.
 *
 * The number matters more here than anywhere else in the app: a conversation
 * PIN is four digits. Ten thousand candidates is nothing to grind offline
 * against a stolen device, so the only thing standing between a copied
 * localStorage and every locked thread is the cost of one derivation — and it
 * was set to a quarter of what the master password (600000) pays, for the
 * weakest secret in the product. OWASP's 2023 floor for PBKDF2-SHA256 is
 * 600000; these now agree with it.
 *
 * Every record written from here on carries the count it was made with, so a
 * later change costs nobody their lock. */
const CHAT_LOCK_ITERATIONS = 600000;
const LEGACY_LOCK_ITERATIONS = 150000;

function chatLockConfig() { return vaultLockConfig(); }
function chatLockEnabled() {
  return Boolean(chatLockConfig().enabled);
}
/* A phone set to a Persian (or Arabic) keyboard types ۱۲۳۴, not 1234, and those
   are different code points entirely -- so the same PIN entered from a
   different keyboard hashed to a different digest and the lock refused it with
   no hint why. Fold both Indic digit blocks onto ASCII before anything hashes
   or compares a PIN, which is one choke point for every path. */
function normalizePinDigits(value) {
  return String(value ?? '').replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (char) => {
    const code = char.charCodeAt(0);
    return String(code >= 0x06F0 ? code - 0x06F0 : code - 0x0660);
  });
}
async function derivePinDigest(pin, saltB64, iterations = CHAT_LOCK_ITERATIONS) {
  const salt = Uint8Array.from(atob(saltB64), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: Number(iterations) || CHAT_LOCK_ITERATIONS, hash: 'SHA-256' }, key, 256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

/* What a stored record was derived with. A record written before the count was
   recorded has no field, and the only honest reading of that is the old
   number — guessing the new one would lock every existing PIN out. */
function recordIterations(record) {
  return Number(record?.iterations) || LEGACY_LOCK_ITERATIONS;
}

/* Verify, and quietly re-derive at the current cost when the record is old.
   This is the one moment the plaintext PIN exists, so it is the only moment an
   upgrade is possible; doing it here means a device catches up the first time
   its owner opens the lock, with nothing to notice and nothing to re-enter. */
async function verifyPinAndUpgrade(pin, record, persist) {
  const stored = recordIterations(record);
  const digest = await derivePinDigest(pin, record.salt, stored);
  if (!digestMatches(digest, record.digest)) return false;
  if (stored < CHAT_LOCK_ITERATIONS && typeof persist === 'function') {
    try {
      persist({
        ...record,
        digest: await derivePinDigest(pin, record.salt, CHAT_LOCK_ITERATIONS),
        iterations: CHAT_LOCK_ITERATIONS,
      });
    } catch (error) { /* an upgrade that fails must never fail the unlock */ }
  }
  return true;
}
/* A passphrase on the file manager.
 *
 * Be clear about what this is. Every file in the vault is already encrypted
 * with a key derived from the master password - that is the wall. This is a
 * curtain in front of the list, for a device that is already unlocked and in
 * somebody else's hand for a moment. It adds no cryptography, and the interface
 * says so rather than letting a second password imply a second layer.
 *
 * What is stored is a salt and a digest, never the passphrase. */
const VAULT_LOCK_STORAGE_KEY = 'poorija_vault_lock';
let vaultUnlocked = false;
let vaultLockGeneration = 0;

// Shared sensitive-section lock. Existing file-manager passwords retain priority;
// an existing chat-only PIN is migrated without changing its derivation.
let vaultAttemptBusy = false;
let vaultWiping = false;
function vaultLockConfig() {
  const fallback = { enabled: false };
  const config = loadEncrypted(VAULT_LOCK_STORAGE_KEY, fallback);
  if (unreadableChatStores.has(chatStorageAddress(VAULT_LOCK_STORAGE_KEY))) return { enabled: true, unreadable: true };
  if (config?.enabled || config?.sharedVersion) return config;
  const legacy = loadEncrypted(CHAT_LOCK_STORAGE_KEY, fallback);
  if (unreadableChatStores.has(chatStorageAddress(CHAT_LOCK_STORAGE_KEY))) return { enabled: true, unreadable: true };
  if (legacy?.enabled && isUnlocked()) {
    const migrated = { ...legacy, sharedVersion: 1, legacyPin: true, attempts: 0, wipeAfterThree: false };
    if (saveEncrypted(VAULT_LOCK_STORAGE_KEY, migrated)) return migrated;
    return { enabled: true, unreadable: true };
  }
  return config || fallback;
}
function vaultLockState() {
  const config = vaultLockConfig();
  return { enabled: Boolean(config.enabled), unlocked: !vaultWiping && Boolean(!config.enabled || vaultUnlocked),
    wiping: vaultWiping, attempts: Number(config.attempts) || 0, wipeAfterThree: !!config.wipeAfterThree, unreadable: !!config.unreadable };
}
/* Which OTHER tabs this one lock also covers.
 *
 * Files, Secure Chat and Settings are not in here and cannot be: they hold the
 * lock's own controls, the storage it protects and the file manager, so a lock
 * that could be lifted off them would be a lock with a door beside it. They are
 * added back by the caller; this list is only what the user chose on top.
 *
 * It rides in the lock's own encrypted record rather than in a store of its
 * own, because it is part of the lock: a record that says "enabled" and a
 * separate one that says what that covers can disagree, and the disagreement
 * that matters — a tab the user believed was locked and is not — is silent. */
function vaultLockExtraTabs() {
  const raw = vaultLockConfig()?.extraTabs;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id) => typeof id === 'string' && /^[a-z0-9-]+$/i.test(id)))];
}
function setVaultLockExtraTabs(ids) {
  if (!isUnlocked()) return false;
  const config = vaultLockConfig();
  if (config.unreadable) return false;
  const clean = [...new Set((Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && /^[a-z0-9-]+$/i.test(id)))];
  if (!saveEncrypted(VAULT_LOCK_STORAGE_KEY, { ...config, extraTabs: clean })) return false;
  publishVaultLockState();
  return true;
}
function publishVaultLockState() {
  if (typeof chatState !== 'undefined') chatState.chatUnlocked = vaultLockState().unlocked;
  window.dispatchEvent(new Event('poorija:section-lock'));
}
async function enableVaultLock(passphrase) {
  if (!isUnlocked() || vaultLockConfig().enabled || vaultWiping) return false;
  const clean = String(passphrase || '');
  if (clean.length < 8) return false;
  const generation = vaultLockGeneration;
  const address = chatStorageAddress(VAULT_LOCK_STORAGE_KEY);
  const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const digest = await derivePinDigest(clean, salt);
  if (!isUnlocked() || generation !== vaultLockGeneration || address !== chatStorageAddress(VAULT_LOCK_STORAGE_KEY) || vaultLockConfig().enabled) return false;
  /* The tabs chosen BEFORE the password was set have to survive it. This wrote
     a fresh record, which is right for everything derived from the passphrase
     and wrong for the one field that is not: picking the extra tabs first and
     then setting the password — the order the card invites, since the picker
     is offered before any lock exists — silently dropped the choice, and the
     lock came up covering only the default three. */
  const extraTabs = vaultLockExtraTabs();
  if (!saveEncrypted(VAULT_LOCK_STORAGE_KEY, { enabled: true, sharedVersion: 1, salt, digest,
    iterations: CHAT_LOCK_ITERATIONS, attempts: 0, wipeAfterThree: true, autoLockMinutes: 5,
    ...(extraTabs.length ? { extraTabs } : {}) })) return false;
  lockVaultNow();
  return true;
}
async function verifyVaultPassword(passphrase, { remove = false, activatePolicy = false } = {}) {
  if (!isUnlocked() || vaultWiping || vaultAttemptBusy) return false;
  vaultAttemptBusy = true;
  const generation = vaultLockGeneration;
  const address = chatStorageAddress(VAULT_LOCK_STORAGE_KEY);
  const perform = async () => {
    if (!isUnlocked() || generation !== vaultLockGeneration || address !== chatStorageAddress(VAULT_LOCK_STORAGE_KEY)) return false;
    // Read other windows' counters while preserving any failed pending write.
    if (!encryptedStoreCache.get(address)?.dirty) encryptedStoreCache.delete(address);
    const config = vaultLockConfig();
    if (!config.enabled || config.unreadable) return false;
    if (config.wipeAfterThree && Number(config.attempts) >= 3) { startSharedLockWipe(); return false; }
    const typed = config.sharedVersion && !config.legacyPin ? String(passphrase || '') : String(passphrase || '').trim();
    let ok = await verifyPinAndUpgrade(typed, config);
    if (!ok && config.legacyPin && normalizePinDigits(typed) !== typed) ok = await verifyPinAndUpgrade(normalizePinDigits(typed), config);
    if (!isUnlocked() || generation !== vaultLockGeneration || address !== chatStorageAddress(VAULT_LOCK_STORAGE_KEY)) return false;
    if (!ok) {
      const attempts = (Number(config.attempts) || 0) + 1;
      saveEncrypted(VAULT_LOCK_STORAGE_KEY, { ...config, attempts });
      if (config.wipeAfterThree && attempts >= 3) startSharedLockWipe();
      else publishVaultLockState();
      return false;
    }
    /* Removing the lock keeps the tab choice, for the same reason enabling it
       does: the picker is offered with no lock in place, so the choice is not
       a property of this particular password. Removing and setting a new one
       would otherwise drop it without saying so. */
    const keptTabs = vaultLockExtraTabs();
    if (!saveEncrypted(VAULT_LOCK_STORAGE_KEY, remove
      ? { enabled: false, sharedVersion: 1, attempts: 0, ...(keptTabs.length ? { extraTabs: keptTabs } : {}) }
      : { ...config, attempts: 0, ...(activatePolicy ? { wipeAfterThree: true } : {}) })) return false;
    vaultUnlocked = !remove;
    if (remove) saveEncrypted(CHAT_LOCK_STORAGE_KEY, { enabled: false });
    publishVaultLockState();
    return true;
  };
  try {
    return navigator.locks?.request ? await navigator.locks.request('poorija-shared-lock-' + address, perform) : await perform();
  } finally { vaultAttemptBusy = false; }
}
function disableVaultLock(passphrase) { return verifyVaultPassword(passphrase, { remove: true }); }
function tryUnlockVault(passphrase) { return verifyVaultPassword(passphrase); }
async function tryUnlockVaultBiometric() {
  if (!isUnlocked() || vaultWiping || vaultAttemptBusy || !vaultLockConfig().enabled) return false;
  vaultAttemptBusy = true;
  const generation = vaultLockGeneration;
  const address = chatStorageAddress(VAULT_LOCK_STORAGE_KEY);
  try {
    if (!await unlockWithBiometric() || !isUnlocked() || generation !== vaultLockGeneration
        || address !== chatStorageAddress(VAULT_LOCK_STORAGE_KEY) || vaultWiping) return false;
    const config = vaultLockConfig();
    if (config.unreadable || !config.enabled || (config.wipeAfterThree && config.attempts >= 3)) return false;
    if (!saveEncrypted(VAULT_LOCK_STORAGE_KEY, { ...config, attempts: 0 })) return false;
    vaultUnlocked = true;
    publishVaultLockState();
    return true;
  } finally { vaultAttemptBusy = false; }
}
function startSharedLockWipe() {
  if (vaultWiping) return;
  vaultWiping = true;
  lockVaultNow();
  window.wipeAllData(true);
}
function lockVaultNow() {
  vaultLockGeneration++;
  vaultUnlocked = false;
  document.querySelectorAll('[data-shared-password]').forEach(input => { input.value = ''; input.type = 'password'; });
  document.querySelectorAll('[data-shared-eye]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  const manager = document.getElementById('vaultFileManager');
  if (manager) { manager.classList.add('hidden'); manager.innerHTML = ''; }
  if (vaultLockConfig().enabled) {
    chatState.activeConversationId = '';
    chatState.activePeerClientId = '';
    try { closeFullSheet({ silent: true }); } catch (_) {}
    try { closeFullSearch(); } catch (_) {}
    try { closeSpaceInfoPanel(); } catch (_) {}
  }
  publishVaultLockState();
}
window.addEventListener('poorija:lock', lockVaultNow);
window.addEventListener('storage', event => {
  if (event.key === null || event.key === chatStorageAddress(VAULT_LOCK_STORAGE_KEY)) {
    encryptedStoreCache.delete(chatStorageAddress(VAULT_LOCK_STORAGE_KEY));
    lockVaultNow();
  }
});
/* Probes can set, open and clear locks straight from the console, which in a
   build somebody actually ships is a bypass rather than a diagnostic. They
   exist for the automated suite, so they are wired only when that suite has
   asked for them by setting this flag before the page loads. */
const DEBUG_PROBES_ON = (() => {
  try { return localStorage.getItem('poorija-debug-probes') === '1'; } catch (_error) { return false; }
})();
if (DEBUG_PROBES_ON) {
  window.__vaultLockProbe = {
    enable: (p) => enableVaultLock(p),
    disable: p => disableVaultLock(p),
    tryUnlock: (p) => tryUnlockVault(p),
    state: () => vaultLockState(),
    lock: () => lockVaultNow(),
  };
}

/* A lock on one conversation.
 *
 * The app-wide chat lock is all or nothing: either Secure Chat is behind a PIN
 * or it is not. What people actually want is one thread behind one - the
 * conversation you would not want read over your shoulder, while the rest stay
 * open.
 *
 * What this is, plainly: the history is ALREADY encrypted on this device under
 * the master password. This PIN does not add encryption. It hides one thread
 * on a device that is already unlocked, and re-hides it after a period of not
 * being used. That is a real thing to want and it is worth saying exactly what
 * it is, because a lock described as more than it is would be worse than none.
 *
 * The PIN is never stored: a random salt plus a derived digest, the same shape
 * the app-wide lock uses. Forgetting it means the thread can only be reopened
 * by removing the lock, which needs the master password - so nothing is ever
 * lost, and nothing is opened by forgetting.
 */
const CONVO_LOCK_STORAGE_KEY = 'poorija_convo_locks';
const CONVO_AUTOLOCK_CHOICES = [1, 5, 15, 60, 0];
/* conversationId -> the moment it re-locks. Memory only: a reload locks
   everything again, which is the behaviour a lock should have. */
const convoLockOpenUntil = new Map();
let convoLockTicker = 0;

function convoLocks() {
  return loadEncrypted(CONVO_LOCK_STORAGE_KEY, {}) || {};
}
function saveConvoLocks(next) {
  saveEncrypted(CONVO_LOCK_STORAGE_KEY, next || {});
}
function conversationHasLock(conversationId) {
  return Boolean(convoLocks()[conversationId]);
}
/* Locked means: a lock is set AND it is not currently open. */
function conversationLocked(conversationId) {
  if (!conversationHasLock(conversationId)) return false;
  const until = convoLockOpenUntil.get(conversationId);
  if (!until) return true;
  if (until === Infinity) return false;
  if (Date.now() < until) return false;
  convoLockOpenUntil.delete(conversationId);
  return true;
}
/* Whether the conversation on screen right now is locked — the one question
   every send path has to ask before it does anything. Works for direct chats
   and groups alike, because both lock under the same conversation key. */
function activeConversationIsLocked() {
  const peer = (typeof getActiveConversation === 'function') ? getActiveConversation() : null;
  if (!peer) return false;
  const key = peer.conversationId || getConversationKey(peer);
  return Boolean(key) && conversationLocked(key);
}
/* Using a thread keeps it open. Called from rendering and from sending, so
   reading a long conversation does not lock in the middle of it. */
function touchConversationLock(conversationId) {
  const record = convoLocks()[conversationId];
  if (!record) return;
  if (!convoLockOpenUntil.has(conversationId)) return;
  const minutes = Number(record.autoLockMinutes || 0);
  convoLockOpenUntil.set(conversationId, minutes > 0 ? Date.now() + minutes * 60000 : Infinity);
}
async function setConversationLock(conversationId, pin, autoLockMinutes) {
  const clean = normalizePinDigits(pin).trim();
  if (clean.length < 4) {
    notify(t('رمز باید حداقل ۴ رقم باشد.', 'The PIN must be at least 4 digits.'), 'warning');
    return false;
  }
  const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const all = { ...convoLocks() };
  all[conversationId] = {
    salt,
    digest: await derivePinDigest(clean, salt),
    iterations: CHAT_LOCK_ITERATIONS,
    autoLockMinutes: CONVO_AUTOLOCK_CHOICES.includes(Number(autoLockMinutes)) ? Number(autoLockMinutes) : 5,
    setAt: new Date().toISOString(),
  };
  saveConvoLocks(all);
  /* Open right after setting it: locking somebody out of the thread they are
     reading, the instant they lock it, helps nobody. */
  convoLockOpenUntil.set(conversationId, Number(all[conversationId].autoLockMinutes) > 0
    ? Date.now() + all[conversationId].autoLockMinutes * 60000
    : Infinity);
  startConvoLockTicker();
  renderPeers();
  return true;
}
/* Opening a conversation, once the person has proved who they are.
 *
 * The PIN and the biometric both end here, so the two ways in cannot drift.
 * The biometric path used to call touchConversationLock() instead — and that
 * function's second line is `if (!convoLockOpenUntil.has(id)) return`, because
 * its job is EXTENDING a window that is already open. On a locked conversation
 * there is no window to extend, so it did nothing at all and the sensor
 * appeared to succeed while the thread stayed shut. */
function openConversationLock(conversationId) {
  const record = convoLocks()[conversationId];
  const minutes = Number(record?.autoLockMinutes || 0);
  convoLockOpenUntil.set(conversationId, minutes > 0 ? Date.now() + minutes * 60000 : Infinity);
  startConvoLockTicker();
}

async function unlockConversation(conversationId, pin) {
  const record = convoLocks()[conversationId];
  if (!record) return true;
  const clean = normalizePinDigits(String(pin || '')).trim();
  const ok = await verifyPinAndUpgrade(clean, record, (next) => {
    saveConvoLocks({ ...convoLocks(), [conversationId]: next });
  });
  if (!ok) return false;
  openConversationLock(conversationId);
  return true;
}
/* Take the lock off, with no question asked.
 *
 * Split out of removeConversationLock so the two callers stop fighting over
 * one function. The wipe path needs a silent removal — it is destroying the
 * conversation, and prompting for the PIN of the thread being destroyed asks
 * a question whose answer cannot matter. The user-facing path needs the PIN.
 *
 * The counters and the biometric choice go WITH the lock, so that a fresh lock
 * is not held responsible for an old one's wrong answers — but only once the
 * lock is actually gone. They used to be cleared at the top of
 * removeConversationLock, before the PIN was asked for, which turned
 * "remove lock, then cancel the prompt" into a free reset of the brute-force
 * ladder: tap, cancel, guess, repeat, against a four-digit PIN. It also turned
 * biometrics off for a lock the user had just decided to keep. */
function dropConversationLockRecord(conversationId) {
  const all = { ...convoLocks() };
  const existed = Object.prototype.hasOwnProperty.call(all, conversationId);
  delete all[conversationId];
  saveConvoLocks(all);
  convoLockOpenUntil.delete(conversationId);
  clearLockout(lockTargetConversation(conversationId));
  clearLockout(lockTargetGroup(conversationId));
  setLockBiometric(lockTargetConversation(conversationId), false);
  setLockBiometric(lockTargetGroup(conversationId), false);
  return existed;
}

async function removeConversationLock(conversationId) {
  const record = convoLocks()[conversationId];
  if (!record) {
    /* Nothing to prove and nothing to reset: no lock means no counters worth
       keeping either. */
    dropConversationLockRecord(conversationId);
    return true;
  }
  /* A lockout in force applies here too. Otherwise "remove the lock" is a
     second, uncounted guessing window onto the same PIN. */
  const waiting = lockoutState(lockTargetConversation(conversationId));
  if (waiting.blocked) {
    notify(t(`قفل موقت است. ${describeWait(waiting.remainingMs)} دیگر امتحان کنید.`,
      `Locked for now. Try again in ${describeWait(waiting.remainingMs)}.`), 'warning');
    return false;
  }
  /* Removing the lock needs the PIN. Otherwise the lock is a decoration:
     anybody holding the unlocked phone could take it off and read the thread. */
  const pin = await PoorijaDialogs.prompt(
    t('برای برداشتن قفل، رمز این گفتگو را وارد کنید.', 'Enter this conversation\'s PIN to remove the lock.'),
    { password: true, inputMode: 'numeric' },
  );
  if (pin === null) return false;
  if (!await unlockConversation(conversationId, pin)) {
    /* A wrong PIN here counts exactly as a wrong PIN at the lock card does. */
    const verdict = noteWrongUnlock(lockTargetConversation(conversationId));
    notify(verdict.blocked
      ? t(`رمز درست نیست. ${describeWait(verdict.remainingMs)} دیگر امتحان کنید.`,
        `That PIN is not right. Try again in ${describeWait(verdict.remainingMs)}.`)
      : t('رمز درست نیست.', 'That PIN is not right.'), 'warning');
    if (verdict.wipe) await wipeLockTarget(lockTargetConversation(conversationId));
    return false;
  }
  dropConversationLockRecord(conversationId);
  notify(t('قفل این گفتگو برداشته شد.', 'The lock on this conversation is off.'), 'success');
  renderPeers();
  renderMessages();
  return true;
}
function lockConversationNow(conversationId) {
  convoLockOpenUntil.delete(conversationId);
  /* The messages go either way. What differs is what is left in their place.
   *
   * A phone has one panel, so the thread IS the screen: leaving the
   * conversation selected would leave a lock card where the conversation was,
   * with no way back to the list except the back button. Closing it puts the
   * person where they can go somewhere else.
   *
   * A desktop has two, and the list is already there on the left. Clearing the
   * selection as well would blank the right-hand panel to the empty state and
   * throw away the one thing worth showing: a lock, with a button on it. So the
   * conversation stays selected and renderMessages() draws the lock card —
   * which never renders the messages, because conversationLocked() is checked
   * before anything is read.
   *
   * Either way nothing readable stays on screen, which is the part that
   * matters. */
  const narrow = typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 767px)').matches;
  if (narrow && chatState.activeConversationId === conversationId) {
    chatState.activeConversationId = '';
    chatState.activePeerClientId = '';
  }
  renderPeers();
  renderActivePeer();
  renderMessages();
  try { updateChatShellMode(); } catch (error) { /* not mounted */ }
}
/* One timer for every open thread, rather than one each. It only has to be
   accurate to a few seconds, and it stops itself when nothing is open. */
function startConvoLockTicker() {
  if (convoLockTicker) return;
  convoLockTicker = window.setInterval(() => {
    if (!convoLockOpenUntil.size) {
      window.clearInterval(convoLockTicker);
      convoLockTicker = 0;
      return;
    }
    let closedAny = false;
    convoLockOpenUntil.forEach((until, id) => {
      if (until !== Infinity && Date.now() >= until) {
        convoLockOpenUntil.delete(id);
        closedAny = true;
      }
    });
    if (closedAny) { renderPeers(); renderMessages(); }
  }, 5000);
}
/* Whatever locks the app locks these too. */
function lockAllConversationsNow() {
  if (!convoLockOpenUntil.size) return;
  convoLockOpenUntil.clear();
  renderPeers();
  renderMessages();
}
window.addEventListener('poorija:lock', lockAllConversationsNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) lockAllConversationsNow(); });

/* Setting one up: the PIN, then how long it stays open. */
async function askForConversationLock(conversationId) {
  const pin = await PoorijaDialogs.prompt(
    t('یک رمز عددی برای این گفتگو بگذارید (حداقل ۴ رقم).', 'Set a numeric PIN for this conversation (at least 4 digits).'),
    { password: true, inputMode: 'numeric' },
  );
  if (pin === null) return;
  const again = await PoorijaDialogs.prompt(t('دوباره وارد کنید.', 'Enter it again.'), { password: true, inputMode: 'numeric' });
  if (again === null) return;
  if (normalizePinDigits(pin).trim() !== normalizePinDigits(again).trim()) {
    notify(t('دو رمز یکی نیستند.', 'Those two do not match.'), 'warning');
    return;
  }
  const minutes = await PoorijaDialogs.choose(
    t('بعد از چقدر بی‌استفاده ماندن دوباره قفل شود؟', 'Re-lock after how long without use?'),
    [
      { value: '1', label: t('۱ دقیقه', 'One minute') },
      { value: '5', label: t('۵ دقیقه', 'Five minutes'), hint: t('پیشنهادی', 'suggested') },
      { value: '15', label: t('۱۵ دقیقه', 'Fifteen minutes') },
      { value: '60', label: t('۱ ساعت', 'One hour') },
      { value: '0', label: t('فقط با بستن برنامه', 'Only when the app closes'), hint: t('تا وقتی برنامه باز است، باز می‌ماند', 'stays open while the app is') },
    ],
    { okLabel: t('انصراف', 'Cancel') },
  );
  if (minutes === null) return;
  if (!await setConversationLock(conversationId, pin, Number(minutes))) return;

  /* Offered here, where the person has just proved they own this lock, rather
     than buried in a settings panel they would have to go looking for. */
  const group = (chatState.spaces?.groups || [])
    .some((space) => space.conversationId === conversationId);
  await offerLockBiometric(group ? lockTargetGroup(conversationId)
    : lockTargetConversation(conversationId));

  /* Now, or later.
   *
   * Setting a lock left the thread open — reasonable, since locking somebody
   * out of what they are reading the instant they lock it helps nobody. But it
   * was the ONLY behaviour, so somebody who set a lock precisely because they
   * were about to hand the phone over had to wait out a timer. Both readings
   * are right; which one applies is theirs to say. */
  const when = await PoorijaDialogs.choose(
    t('همین حالا قفل شود؟', 'Lock it now?'),
    [
      { value: 'now', label: t('همین حالا قفل کن', 'Lock it now'),
        hint: t('برای باز کردن رمز می‌خواهد', 'the PIN is needed to open it') },
      { value: 'later', label: t('فعلاً باز بماند', 'Leave it open for now'),
        hint: t('طبق زمانی که انتخاب کردید قفل می‌شود', 'it locks on the timer you chose') },
    ],
    { okLabel: t('انصراف', 'Cancel') },
  );
  if (when === 'now') {
    lockConversationNow(conversationId);
    notify(t('این گفتگو قفل شد.', 'This conversation is locked.'), 'success');
  } else {
    notify(t('قفل این گفتگو تنظیم شد.', 'A lock is set on this conversation.'), 'success');
  }
  renderMessages();
}

/* Opening one. */
/* Asking for a PIN, and remembering how badly it has been going.
 *
 * Every unlock in the app goes through here so the ladder, the biometric offer
 * and the wipe all behave the same whether the thing being opened is one
 * conversation, one group, or Secure Chat itself. Three copies of this logic
 * would be three chances for one of them to keep letting somebody guess.
 */
async function askToUnlock(target, { title } = {}) {
  const waiting = lockoutState(target);
  if (waiting.blocked) {
    notify(t(`قفل موقت است. ${describeWait(waiting.remainingMs)} دیگر دوباره امتحان کنید.`,
      `Locked for now. Try again in ${describeWait(waiting.remainingMs)}.`), 'warning');
    return { ok: false, blocked: true };
  }

  /* No biometric attempt here.
   *
   * This used to try the sensor before showing the PIN field, which made sense
   * while the sensor was the only way to reach it. It stopped making sense the
   * moment the lock card grew its own biometric button: pressing "Unlock" then
   * raised a fingerprint prompt nobody had asked for, and the PIN field only
   * appeared after cancelling it. Two buttons, two paths — the one that says
   * Unlock asks for the PIN, and the one with the fingerprint on it asks for a
   * fingerprint. */

  const left = lockoutState(target).triesLeft;
  const hint = left > 0 && left <= LOCKOUT_FREE_TRIES
    ? t(` (${left} تلاش تا قفل موقت)`, ` (${left} left before a wait)`) : '';
  const pin = await PoorijaDialogs.prompt(String(title || '') + hint,
    { password: true, inputMode: 'numeric' });
  if (pin === null) return { ok: false, cancelled: true };
  return { ok: false, pin };
}

/* What a wrong answer costs, said out loud, and the wipe when it comes to it. */
async function punishWrongUnlock(target, label) {
  const outcome = noteWrongUnlock(target);
  if (outcome.wipe) {
    const what = await wipeLockTarget(target);
    notify(t(
      `پس از تلاش‌های پیاپی نادرست، ${label} به‌کلی پاک شد.`,
      `After repeated wrong answers, ${label} was wiped.`), 'error');
    return { wiped: what };
  }
  if (outcome.blocked) {
    notify(t(
      `رمز درست نیست. ${describeWait(outcome.remainingMs)} دیگر دوباره امتحان کنید.`,
      `That is not right. Try again in ${describeWait(outcome.remainingMs)}.`), 'error');
    return { blocked: true };
  }
  notify(t(
    `رمز درست نیست. ${outcome.triesLeft} تلاش دیگر مانده.`,
    `That is not right. ${outcome.triesLeft} tries left.`), 'warning');
  return { blocked: false };
}

async function promptUnlockConversation(conversationId) {
  const group = (chatState.spaces?.groups || [])
    .some((space) => space.conversationId === conversationId);
  const target = group ? lockTargetGroup(conversationId) : lockTargetConversation(conversationId);
  /* renderActivePeer() as well as the other two, every time.
   *
   * The thread menu's state — whether "Lock this chat" is available — is
   * computed inside renderActivePeer(), and this path called only renderPeers()
   * and renderMessages(). So after unlocking, the menu still believed the
   * conversation was locked and kept the item greyed out until something else
   * happened to redraw the header: clicking the conversation in the list again,
   * or on a phone leaving for the list and coming back. */
  const redraw = () => {
    renderPeers();
    renderActivePeer();
    renderMessages();
  };
  const asked = await askToUnlock(target, {
    title: t('رمز این گفتگو را وارد کنید.', "Enter this conversation's PIN."),
  });
  if (asked.ok) { redraw(); return true; }
  if (asked.blocked || asked.cancelled) return false;
  if (!await unlockConversation(conversationId, asked.pin)) {
    await punishWrongUnlock(target, group
      ? t('این گروه', 'this group') : t('این گفتگو', 'this conversation'));
    redraw();
    return false;
  }
  clearLockout(target);
  redraw();
  return true;
}
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-unlock-conversation]');
  if (!button) return;
  promptUnlockConversation(button.getAttribute('data-unlock-conversation'));
});
window.__activeConversationProbe = () => chatState.activeConversationId || '';
/* The layout arithmetic on its own, so the shape it picks can be checked
   without three browsers and a live call. */
/* Who this device thinks it is in a call with, and whether a picture is
   actually arriving from each of them. The mesh is the part that breaks
   quietly: everybody's stage looks right and nobody's video moves. */
window.__ringTimeoutProbe = () => CALL_RING_TIMEOUT_MS;
window.__gcallMeshProbe = () => ({
  active: groupCallActive(),
  callId: chatState.groupCall.callId || '',
  roster: (chatState.groupCall.roster || []).slice(),
  participants: [...chatState.groupCall.participants.entries()].map(([key, entry]) => ({
    key: String(key).slice(0, 12),
    name: entry?.name || '',
    hasStream: Boolean(entry?.stream),
    tracks: entry?.stream ? entry.stream.getTracks().length : 0,
    live: entry?.stream ? entry.stream.getTracks().some((tr) => tr.readyState === 'live') : false,
  })),
});
window.__gcallFitProbe = (count, width, height, aspect) => fitGroupCallGrid(count, width, height, aspect);
/* Same gate as the vault probe: this object can open a locked conversation
   and clear the lockout ladder straight from the console, so it is wired only
   for the automated suite, never in a build somebody ships. */
if (DEBUG_PROBES_ON) {
window.__convoLockProbe = {
  set: (id, pin, minutes) => setConversationLock(id, pin, minutes),
  unlock: (id, pin) => unlockConversation(id, pin),
  locked: (id) => conversationLocked(id),
  has: (id) => conversationHasLock(id),
  lockNow: (id) => lockConversationNow(id),
  touch: (id) => touchConversationLock(id),
  openUntil: (id) => convoLockOpenUntil.get(id) || 0,
  /* Which conversation is open, and a way to open one. chatState is a
     top-level `const` in a classic script — it lives in the shared global
     lexical environment and never on `window` — and the CSP forbids eval, so a
     test has no other way to see it. */
  activeId: () => chatState.activeConversationId || '',
  activePeer: () => chatState.activePeerClientId || '',
  setActive: (id) => { chatState.activeConversationId = id; },
  lockChat: () => lockChatNow(),
  enableChat: (pin) => enableChatLock(pin),
  chatEnabled: () => chatLockEnabled(),
  /* The lockout ladder and the wipe. Reachable only from here for the same
     reason everything else in this probe is: these live in a classic script's
     module scope, never on `window`, and the CSP forbids eval. */
  wrong: (target) => noteWrongUnlock(target),
  lockoutOf: (target) => lockoutState(target),
  clearLockout: (target) => clearLockout(target),
  wipeTarget: (target) => wipeLockTarget(target),
  /* Functions, not values. This object is BUILT where it appears in the file,
     which is above the const declarations below it — reading one of them here
     threw "Cannot access 'lockTargetSecureChat' before initialization" and took
     the whole module down with it, so nothing in this file ran at all. A getter
     is evaluated when the test asks, by which time everything exists. */
  targets: {
    get secureChat() { return lockTargetSecureChat(); },
    conversation: (id) => lockTargetConversation(id),
    group: (id) => lockTargetGroup(id),
  },
  get freeTries() { return LOCKOUT_FREE_TRIES; },
  get ladder() { return LOCKOUT_LADDER_MS.slice(); },
  biometricOn: (target) => lockBiometricEnabled(target),
  bioAvailable: () => lockBiometricAvailable(),
  bioUnlock: () => unlockWithBiometric(),
  openNow: (id) => openConversationLock(id),
  setBiometric: (target, on) => setLockBiometric(target, on),
  /* What the app holds for one conversation, so a test can prove a wipe left
     nothing rather than that it merely redrew the list. */
  traces: (id, peerKey, fingerprint) => ({
    history: Object.prototype.hasOwnProperty.call(chatState.history, id),
    peer: chatState.peers.some((p) => p.peerId === peerKey || p.fingerprint === fingerprint),
    group: (chatState.spaces?.groups || []).some((g) => g.conversationId === id),
    sessionKey: Boolean(chatState.sessionKeys[peerKey] || chatState.sessionKeys[fingerprint]),
    lock: conversationHasLock(id),
  }),
  /* Seeded the way the app really files a conversation: the record carries the
     conversation id, and getConversationKey() therefore returns it, so the
     history, the session key and the contact all agree on one name. An earlier
     version of this filed the history under one id and the contact under
     another — a state the app cannot produce — and then reported the purge as
     broken for not finding a record that was never there. */
  seedConversation: (id, peerKey, fingerprint) => {
    chatState.history[id] = [{ id: 'seeded', text: 'a message', direction: 'in', at: Date.now() }];
    chatState.peers.push({
      conversationId: id, peerId: peerKey, clientId: peerKey, fingerprint, username: 'Seeded',
    });
    chatState.sessionKeys[peerKey] = 'not-a-real-key';
    chatState.sessionKeys[fingerprint] = 'not-a-real-key';
    return id;
  },
  seedGroup: (id) => {
    chatState.spaces = chatState.spaces || { groups: [] };
    chatState.spaces.groups.push({ conversationId: id, name: 'Seeded group', type: 'group', members: [] });
    chatState.history[id] = [{ id: 'seeded', text: 'a message', direction: 'in', at: Date.now() }];
    return id;
  },
  purge: (id) => purgeConversationEverywhere(id),
};
}

/* ---- opening a lock with a face or a fingerprint ------------------------ */

/* An option, never a replacement.
 *
 * The PIN stays the thing that actually guards the lock: it is what the digest
 * is derived from, and it is what still works when the sensor refuses, the
 * finger is wet, or the person is on a different device. Biometrics here are a
 * quicker way to say "yes, still me" on the device that has already been set
 * up — so a refusal falls through to the PIN and, deliberately, does not count
 * as a wrong answer. Declining a fingerprint is not a guess.
 *
 * This uses the platform authenticator the app already registers for its own
 * quick unlock, so no new credential and no new stored secret: a successful
 * assertion is the proof, and nothing about the lock's own secret changes.
 */
const LOCK_BIOMETRIC_KEY = 'poorija_chat_lock_biometrics';

function lockBiometricStore() {
  try {
    const raw = localStorage.getItem(LOCK_BIOMETRIC_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

/* Whether the app itself already unlocks with a face or a fingerprint.
 *
 * Somebody who has turned that on for the app has already said what they think
 * of biometrics on this device, and making them say it again per lock is a
 * question with a known answer. So it is the default here, and the per-target
 * switch is only consulted to turn it OFF for one particular lock. */
function appBiometricOn() {
  try {
    /* The desktop shell's own local authentication, and the browser's passkey.
       Read from where each is actually kept rather than through a helper:
       getPasskeyRecord() lives in js/app.js's module scope and is not on
       PoorijaApp, so calling it from here would silently be undefined and every
       lock would quietly decide biometrics were off. */
    if (window.PoorijaApp?.state?.desktopAuth?.enabled) return true;
    /* PASSKEY_STORAGE_KEY is js/app.js's own constant and this file loads
       after it, so the name stays in one place — guessing it produced
       'poorija_passkey', which reads nothing and turned biometrics off
       everywhere without a word. */
    return Boolean(JSON.parse(localStorage.getItem(PASSKEY_STORAGE_KEY) || 'null'));
  } catch (error) {
    return false;
  }
}

function lockBiometricEnabled(target) {
  const stored = lockBiometricStore()[target];
  if (stored === false) return false;      /* turned off for this one lock */
  return stored === true || appBiometricOn();
}

function setLockBiometric(target, on) {
  const store = lockBiometricStore();
  /* `false` is recorded rather than deleted: deleting would fall back to the
     app-wide setting, and "no, not for this one" has to survive that. */
  store[target] = Boolean(on);
  try { localStorage.setItem(LOCK_BIOMETRIC_KEY, JSON.stringify(store)); }
  catch (error) { /* private mode: the choice lasts the session */ }
  return Boolean(on);
}

/* Whether this device can offer it at all.
 *
 * Two different mechanisms, because they are two different runtimes. The
 * desktop shell has no WebAuthn at all — wry implements none of it — and
 * answers through its own bridge to the operating system's local
 * authentication. Everywhere else it is a platform authenticator over
 * WebAuthn. Asking only the second question said "no" on every desktop build.
 */
async function lockBiometricAvailable() {
  try {
    const app = window.PoorijaApp;
    if (app?.isDesktopAppRuntime?.()) return Boolean(app?.state?.desktopAuth?.enabled);
    if (!window.isSecureContext) return false;
    if (typeof window.PublicKeyCredential !== 'function') return false;
    if (!navigator.credentials?.get) return false;
    if (!PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    if (!await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) return false;
    /* And a credential to assert against. Without one there is nothing for the
       browser to find, and the prompt fails rather than never appearing —
       which reads to a person as "the button does nothing". */
    return Boolean(app?.getPasskeyRecord?.());
  } catch (error) {
    return false;
  }
}

/* Takes no target on purpose: a lock's biometric is a presence check — "still
   the same person on the same device" — and the lock it was tapped on is
   decided by the caller, which is also what clears that lock's lockout. The
   parameter call sites used to pass was silently ignored, so it is gone rather
   than left as a promise the function does not keep. */
async function unlockWithBiometric() {
  const app = window.PoorijaApp;
  /* No await before the ceremony. isUserVerifyingPlatformAuthenticatorAvailable
     is a promise, and awaiting it between the tap and credentials.get() spends
     the transient user activation the engines that require one are looking
     for. The buttons are only rendered when syncLockBiometricButtons() has
     already answered the same question, so the check here is the cheap,
     synchronous half. */
  if (app?.isDesktopAppRuntime?.()) {
    if (!app?.state?.desktopAuth?.enabled) return false;
  } else if (!window.isSecureContext
      || typeof window.PublicKeyCredential !== 'function'
      || !navigator.credentials?.get
      || !app?.getPasskeyRecord?.()) {
    return false;
  }

  if (app?.isDesktopAppRuntime?.()) {
    try {
      /* The shell returns the recovered secret; for a lock all that is wanted
         is whether the operating system said yes. */
      const answer = await app.invokeDesktopCommand('desktop_unlock_with_biometric');
      return Boolean(answer) && await verifyMasterPassword(String(answer));
    } catch (error) {
      return false;
    }
  }

  try {
    const record = app.getPasskeyRecord();
    /* Assert exactly the way js/app.js does, through js/app.js's own helpers.
       A second, subtly different ceremony here is what this whole function's
       history is: first no allowCredentials at all, then one without the
       registered transports and without the relying-party id the credential
       was created under, and without the watchdog that catches the engines
       which finish the fingerprint and then never answer. Each difference was
       its own silent false, which reads as a button that does nothing. */
    const assertion = await app.webauthnWithWatchdog(() => navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        timeout: 45000,
        ...(app.getExplicitPasskeyRpId?.() ? { rpId: app.getExplicitPasskeyRpId() } : {}),
        allowCredentials: app.passkeyAllowList(record),
        userVerification: 'required',
      },
    }), 45000);
    return Boolean(assertion);
  } catch (error) {
    /* A refusal, a timeout, or no credential: all mean "ask for the PIN", none
       mean "this was a wrong answer". Logged, because a silent false here is
       exactly what made this impossible to diagnose from the outside. */
    console.warn('[Lock] biometric unlock did not complete:', error?.name || error);
    return false;
  }
}

/* Offered once, when a lock is set, and remembered per target. */
async function offerLockBiometric(target) {
  if (!await lockBiometricAvailable()) return false;
  const yes = await PoorijaDialogs.confirm(t(
    'باز کردن این قفل با بایومتریک هم ممکن شود؟ رمز همچنان کار می‌کند.',
    'Also open this lock with biometrics? The PIN keeps working.'),
  { okLabel: t('بله', 'Yes'), cancelLabel: t('فقط رمز', 'PIN only') });
  return setLockBiometric(target, Boolean(yes));
}

/* ---- wrong answers, and what they cost ---------------------------------- */

/* Three tries are free. Fingers slip, a PIN gets typed on a phone in a pocket,
 * and somebody coming back to a conversation after a fortnight genuinely does
 * not remember. From the fourth wrong answer on, each one starts a wait, and
 * the waits grow: one minute, three, six, ten.
 *
 * A fifth wait is never served. At that point whatever was being guarded is
 * destroyed instead — someone who has sat through twenty minutes of escalating
 * delays to keep guessing is not the person who set the PIN, and the honest
 * thing for a lock to do at that point is to make the guessing pointless
 * rather than merely slow.
 *
 * The counters are persisted. A lockout that a restart clears is not a lockout,
 * it is a suggestion, and closing an app is the first thing anybody tries.
 */
const LOCKOUT_FREE_TRIES = 3;
const LOCKOUT_LADDER_MS = [60_000, 180_000, 360_000, 600_000];
const LOCKOUT_STORAGE_KEY = 'poorija_chat_lock_attempts';

/* What a key names, so a wipe destroys the right thing and only that thing. */
const lockTargetSecureChat = () => 'secure-chat';
const lockTargetConversation = (id) => `conversation:${id}`;
const lockTargetGroup = (id) => `group:${id}`;

function lockoutStore() {
  try {
    const raw = localStorage.getItem(LOCKOUT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveLockoutStore(next) {
  try {
    localStorage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify(next || {}));
  } catch (error) { /* private mode: the counters last the session */ }
}

/* Where a target stands right now. `blocked` is the only thing a caller has to
   honour; the rest is for telling somebody what is happening and why. */
function lockoutState(target) {
  const entry = lockoutStore()[target] || {};
  const until = Number(entry.until) || 0;
  const remaining = Math.max(0, until - Date.now());
  return {
    blocked: remaining > 0,
    remainingMs: remaining,
    wrong: Number(entry.wrong) || 0,
    step: Number(entry.step) || 0,
    triesLeft: Math.max(0, LOCKOUT_FREE_TRIES - (Number(entry.wrong) || 0)),
  };
}

function clearLockout(target) {
  const store = lockoutStore();
  if (!store[target]) return;
  delete store[target];
  saveLockoutStore(store);
}

/* Every wrong answer goes through here, and the answer says what to do next. */
function noteWrongUnlock(target) {
  const store = lockoutStore();
  const entry = store[target] || { wrong: 0, step: 0, until: 0 };
  entry.wrong = (Number(entry.wrong) || 0) + 1;

  if (entry.wrong <= LOCKOUT_FREE_TRIES) {
    store[target] = entry;
    saveLockoutStore(store);
    return {
      blocked: false,
      wipe: false,
      triesLeft: LOCKOUT_FREE_TRIES - entry.wrong,
      remainingMs: 0,
    };
  }

  entry.step = (Number(entry.step) || 0) + 1;
  if (entry.step > LOCKOUT_LADDER_MS.length) {
    /* The fifth. Nothing is stored — the target is about to stop existing. */
    delete store[target];
    saveLockoutStore(store);
    return { blocked: false, wipe: true, triesLeft: 0, remainingMs: 0 };
  }
  const wait = LOCKOUT_LADDER_MS[entry.step - 1];
  entry.until = Date.now() + wait;
  store[target] = entry;
  saveLockoutStore(store);
  return { blocked: true, wipe: false, triesLeft: 0, remainingMs: wait, step: entry.step };
}

function describeWait(ms) {
  const minutes = Math.ceil(ms / 60000);
  const seconds = Math.ceil(ms / 1000);
  return seconds > 90
    ? t(`${minutes} دقیقه`, `${minutes} minute${minutes === 1 ? '' : 's'}`)
    : t(`${seconds} ثانیه`, `${seconds} second${seconds === 1 ? '' : 's'}`);
}

/* Destroying what the lock was guarding.
 *
 * Scoped exactly to the target: a group takes the group and nothing else, a
 * conversation takes that conversation, and Secure Chat takes everything —
 * including the session keys and whatever the relay is still holding, because
 * a wipe that leaves the ciphertext queued on a server has not wiped anything.
 */
async function wipeLockTarget(target) {
  clearLockout(target);
  if (target === 'secure-chat') {
    /* The whole thing, relay included. */
    if (typeof emergencyWipeChat === 'function') {
      await emergencyWipeChat({ purgeRelay: true });
      return 'secure-chat';
    }
    return '';
  }
  const id = target.slice(target.indexOf(':') + 1);
  if (!id) return '';
  /* The silent removal, not the one that asks for the PIN: this is the fifth
     wrong answer, the conversation is about to stop existing, and a prompt
     here only offers the attacker one more guess. */
  dropConversationLockRecord(id);
  purgeConversationEverywhere(id);
  return target.startsWith('group:') ? 'group' : 'conversation';
}

async function enableChatLock(pin) { return enableVaultLock(pin); }
function disableChatLock(pin) { return disableVaultLock(pin); }
/* Constant-time-ish compare: both strings are the same length by
   construction, and a mismatch must not leak where it diverged. */
function digestMatches(digest, expected) {
  const other = String(expected);
  if (digest.length !== other.length) return false;
  let diff = 0;
  for (let i = 0; i < digest.length; i++) diff |= digest.charCodeAt(i) ^ other.charCodeAt(i);
  return diff === 0;
}
async function tryUnlockChat(pin) { return tryUnlockVault(pin); }
function lockChatNow() {
  lockVaultNow();
  if (!chatLockEnabled()) return;
  chatState.chatUnlocked = false;
  /* The conversation is closed, not merely covered.
   *
   * The lock used to draw a panel over whatever was on screen and leave the
   * thread open underneath it — so the timer fired while the app was in the
   * background, somebody picked the phone up, and the last conversation was
   * still the thing behind the gate. Unlocking put them straight back into it,
   * which is not what locking a chat is for. Closing it means there is nothing
   * to reveal and nothing to return to but the list. */
  chatState.activeConversationId = '';
  chatState.activePeerClientId = '';
  try { closeSpaceInfoPanel?.(); } catch (error) { /* not open */ }
  try { renderPeers(); renderActivePeer(); renderMessages(); }
  catch (error) { /* the chat pane may not be built yet */ }
  syncChatLockUi();
}
/* The chat module can initialise while the app is still locked, and at that
   point loadEncrypted has no key and reports "no chat lock configured". Re-ask
   once the master password exists, or a configured lock silently never engages. */
function refreshChatLockState() {
  if (!isUnlocked()) return;
  if (chatState.chatLockResolved) return;
  chatState.chatLockResolved = true;
  chatState.chatUnlocked = vaultLockState().unlocked;
  noteChatActivity();
  syncChatLockUi();
}
/* The fingerprint button only exists where a fingerprint does. */
async function syncLockBiometricButtons() {
  const available = await lockBiometricAvailable();
  const button = document.getElementById('chatLockBioBtn');
  if (button) {
    button.classList.toggle('hidden',
      !available || !lockBiometricEnabled(lockTargetSecureChat()));
  }
  document.querySelectorAll('[data-unlock-biometric]').forEach((el) => {
    const id = el.getAttribute('data-unlock-biometric');
    const group = (chatState.spaces?.groups || []).some((sp) => sp.conversationId === id);
    const target = group ? lockTargetGroup(id) : lockTargetConversation(id);
    el.classList.toggle('hidden', !available || !lockBiometricEnabled(target));
  });
}

/* The conversation and group equivalent of the gate's button. */
document.addEventListener('click', async (event) => {
  const button = event.target.closest?.('[data-unlock-biometric]');
  if (!button) return;
  const id = button.getAttribute('data-unlock-biometric');
  const group = (chatState.spaces?.groups || []).some((sp) => sp.conversationId === id);
  const target = group ? lockTargetGroup(id) : lockTargetConversation(id);
  const waiting = lockoutState(target);
  if (waiting.blocked) {
    notify(t(`قفل موقت است. ${describeWait(waiting.remainingMs)} دیگر امتحان کنید.`,
      `Locked for now. Try again in ${describeWait(waiting.remainingMs)}.`), 'warning');
    return;
  }
  if (!await unlockWithBiometric()) {
    notify(t('بایومتریک تأیید نشد؛ رمز را وارد کنید.',
      'Biometrics were not accepted; use the PIN.'), 'info');
    return;
  }
  clearLockout(target);
  openConversationLock(id);
  renderPeers();
  renderActivePeer();
  renderMessages();
});

function syncChatLockUi() {
  syncLockBiometricButtons().catch(() => {});
  const gate = document.getElementById('chatLockGate');
  const shell = document.querySelector('#content-chat > .chat-shell');
  const locked = chatLockEnabled() && !vaultLockState().unlocked;
  gate?.classList.add('hidden'); // The shared gate is outside the chat shell.
  shell?.classList.toggle('is-chat-locked', locked);
  const toggle = document.getElementById('chatLockToggle');
  if (toggle) toggle.checked = chatLockEnabled();
  const minutes = document.getElementById('chatLockMinutes');
  if (minutes) minutes.value = String(chatLockConfig().autoLockMinutes ?? 5);
  if (locked) document.getElementById('chatLockPin')?.focus();
}
/* Re-lock after the tab has been out of sight long enough. Chosen over a
   plain timer so a conversation left open on screen is not interrupted. */
function noteChatActivity() {
  chatState.chatLastSeenAt = Date.now();
}
function startChatLockWatcher() {
  window.clearInterval(chatState.chatLockTimer);
  chatState.chatLockTimer = window.setInterval(() => {
    if (!chatLockEnabled() || !chatState.chatUnlocked) return;
    const minutes = Number(chatLockConfig().autoLockMinutes ?? 5);
    if (!minutes) return;
    const away = document.hidden || !sharedLockTabs().includes(appState()?.activeTab);
    if (!away) {
      noteChatActivity();
      return;
    }
    if (Date.now() - (chatState.chatLastSeenAt || 0) > minutes * 60000) lockChatNow();
  }, 5000);
}
