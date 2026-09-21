/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 20 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   One call, one row
*/

/* =====================================================================
   One call, one row
   ---------------------------------------------------------------------
   A call is a sequence of events — ringing, answered, ended — and each
   one used to append a row of its own. One answered call left two rows
   on the caller's side and up to four on the receiver's. Worse, the far
   end's "call-ended" notice was logged with a hard-coded direction of
   'in', so a call you placed also turned up under Incoming.

   Now the first event of a call opens a row and every later event
   updates it. Direction is written once, when the row is opened, and
   never rewritten: who placed the call is not something a later message
   from the other side gets a vote on.
   ===================================================================== */
const CALL_FINAL_STATUSES = new Set(['ended', 'missed', 'rejected', 'failed', 'busy', 'declined', 'cancelled']);
/* Half a minute: long enough to cover a ring timeout and the notices that
   follow it, short enough that a deliberate redial is its own row. */
const CALL_MERGE_WINDOW_MS = 30000;

function callsViewVisible() {
  if (chatState.activeView !== 'calls') return false;
  const panel = document.getElementById('chatCallsPanel');
  const list = document.getElementById('chatPeerList');
  const shown = (node) => Boolean(node) && !node.classList.contains('hidden') && node.getBoundingClientRect().height > 0;
  return shown(panel) || shown(list);
}

/* Opening the log is reading it. Without this the badge counted every missed
   call the profile had ever taken and never came down. */
function markCallsRead() {
  const unread = (chatState.calls || []).filter((call) => call?.unread !== false);
  if (!unread.length) return;
  unread.forEach((call) => { call.unread = false; });
  saveCalls();
  renderChatNavBadges();
}
function isFinalCallStatus(status) {
return CALL_FINAL_STATUSES.has(String(status || ''));
}
function callLogKey(entry) {
return String(entry.conversationId || entry.peerId || entry.name || 'unknown');
}
function closeActiveCallLog() {
chatState.activeCallLog = null;
}

function appendCall(entry) {
const key = callLogKey(entry);
const final = isFinalCallStatus(entry.status);
/* A group-call row is complete the moment it is written — nothing later
   reports back on it — so it never becomes the open row. */
/* `standalone` says "this is a finished call in its own right" — a seeded
   history row, or a group call that nothing reports back on. */
const oneShot = Boolean(entry.conversationId) || Boolean(entry.standalone);
const active = entry.standalone ? null : chatState.activeCallLog;
const existing = active && active.key === key
? chatState.calls.find((call) => call.id === active.id)
: null;

if (!existing && entry.updateOnly) {
/* The far side telling us a call ended is an update, not a call. Without
   this it invented a row — and, being hard-coded 'in', invented it in the
   wrong section. */
return null;
}

let record;
/* One unanswered attempt reaches this function from several directions: the
   local ring timeout, the far end's call-missed, its call-cancel, and a
   call-ended that arrives afterwards. Each of those is a FINAL status, and a
   final status closes the open row — so every one after the first opened a
   row of its own. Two missed calls showed up as seven.

   A call carries no id on the wire, so identity is reconstructed: the same
   peer, the same mode, an unanswered outcome, within half a minute. Redials
   further apart than that stay separate calls, which is what they are. */
const recentUnanswered = (!existing && final && !entry.standalone)
? chatState.calls.find((call) => (
  callLogKey(call) === key
  /* The row being merged into has to be an UNANSWERED one. An answered call
     is a thing in its own right and never absorbs a later event. */
  && (isMissedCallStatus(call.status) || String(call.status) === 'cancelled')
  && !call.durationMs
  && (!entry.mode || !call.mode || call.mode === entry.mode)
  && Math.abs(Date.parse(entry.createdAt || new Date().toISOString()) - Date.parse(call.createdAt)) < CALL_MERGE_WINDOW_MS
))
: null;
/* A notice from the other side that a call went unanswered, arriving for a
   call THIS side already completed, is bookkeeping — not a second call.
 *
 * It happens whenever the far end tears down with its own answered-at clock
 * still zero: the call was up on the signalling layer but its media `stream`
 * event never fired, which is ordinary on a relayed or one-way-media link.
 * endCurrentCall() then logs its own row as missed AND sends call-cancel, and
 * the handler here turned that into a missed row on a call the user had just
 * finished talking through. The answered row is closed and carries a duration,
 * so recentUnanswered above refuses to absorb it — correctly, that guard
 * exists to stop an answered call being rewritten — and a fresh row opened
 * instead. One call, logged twice, the second time as missed.
 *
 * The open-row case already encodes this rule as `vaguer` below: a late,
 * vaguer notice never overwrites what the row knows. This is the same
 * judgement for the case where the row has already closed. The test is WHEN,
 * not where from: a no-answer landing inside a completed call's own span is
 * that call — and outside it, a call of its own. A new call cannot begin
 * inside the previous one anyway: the line is busy.
 *
 * It happens on the near side too, with no envelope involved. That side learns
 * the call ended from the far end, which closes its row with a real duration,
 * and then its own endCurrentCall runs with answered-at still zero and writes
 * a missed call for the call it has just finished. */
const supersededByAnsweredCall = (!existing && final && !entry.durationMs
  && isMissedCallStatus(entry.status))
? chatState.calls.find((call) => {
  if (callLogKey(call) !== key) return false;
  if (isMissedCallStatus(call.status) || !(Number(call.durationMs) > 0)) return false;
  /* Measured against the WHOLE call, not its first instant. These notices
     carry the SENDER'S clock, and the moment it gave up is not the moment the
     call began: a ring timeout fires forty seconds in, and a hang-up notice
     for an hour-long call is an hour late. Comparing against createdAt alone
     let both of those fall outside the window and open a row — which is the
     shape people actually see, because a queued envelope can also arrive long
     after the call it is about, still carrying that original time. */
  const noticeAt = Date.parse(entry.createdAt || new Date().toISOString());
  if (!Number.isFinite(noticeAt)) return false;
  const startedAt = Date.parse(call.createdAt);
  if (!Number.isFinite(startedAt)) return false;
  const endedAt = startedAt + (Number(call.durationMs) || 0);
  return noticeAt >= startedAt - CALL_MERGE_WINDOW_MS && noticeAt <= endedAt + CALL_MERGE_WINDOW_MS;
})
: null;
if (supersededByAnsweredCall) return supersededByAnsweredCall;

const target = existing || recentUnanswered;
if (target) {
/* A later, vaguer notice must not overwrite what the row already knows:
   "ended" arriving after "missed", with no duration on it, is the far end
   tidying up, not news that the call was answered. */
const vaguer = isMissedCallStatus(target.status) && !isMissedCallStatus(entry.status) && !entry.durationMs;
if (entry.status && !vaguer) target.status = entry.status;
target.mode = entry.mode || target.mode;
if (entry.name) target.name = entry.name;
if (entry.peerId && !target.peerId) target.peerId = entry.peerId;
if (entry.durationMs) target.durationMs = entry.durationMs;
if (entry.bytesIn) target.bytesIn = entry.bytesIn;
if (entry.bytesOut) target.bytesOut = entry.bytesOut;
/* A row usually opens on "ringing", which is not yet a missed call — the
   badge is earned when the status turns unanswered, which happens here. */
if (isMissedCallStatus(target.status) && target.direction === 'in' && !callsViewVisible()) {
target.unread = true;
}
record = target;
} else {
record = {
id: generateId('call'),
createdAt: new Date().toISOString(),
/* Only an unanswered incoming call is worth a badge, and only while the
   user is not already looking at the log. */
unread: entry.direction === 'in' && isMissedCallStatus(entry.status) && !callsViewVisible(),
...entry,
};
delete record.logToChat;
delete record.updateOnly;
delete record.standalone;
chatState.calls.unshift(record);
chatState.calls = chatState.calls.slice(0, CALL_LOG_LIMIT);
}

if (final || oneShot) closeActiveCallLog();
else chatState.activeCallLog = { key, id: record.id };

saveCalls();
/* The thread gets one line per call, when the call is over — not one per
   lifecycle event. */
if ((final || oneShot) && entry.logToChat !== false) {
appendCallHistory(record);
}
renderCalls();
return record;
}
function formatCallStatus(status) {
switch (status) {
case 'missed':
return t('بی‌پاسخ', 'Missed');
case 'incoming':
return t('ورودی', 'Incoming');
case 'outgoing':
return t('خروجی', 'Outgoing');
case 'answered':
return t('پاسخ داده شد', 'Answered');
case 'ringing':
return t('در حال زنگ', 'Ringing');
case 'failed':
return t('ناموفق', 'Failed');
case 'rejected':
return t('رد شد', 'Rejected');
case 'ended':
return t('پایان‌یافته', 'Ended');
default:
return status || '-';
}
}
function isMissedCallStatus(status) {
return ['missed', 'failed', 'rejected'].includes(String(status || '').toLowerCase());
}
function callHistoryText(entry = {}) {
const modeLabel = entry.mode === 'video' ? t('تماس تصویری', 'Video call') : t('تماس صوتی', 'Voice call');
const status = String(entry.status || '');
if (status === 'ended' || status === 'answered') {
return t(
`${modeLabel} برقرار شد - مدت ${formatDuration(entry.durationMs)}`,
`${modeLabel} connected - ${formatDuration(entry.durationMs)}`
);
}
if (status === 'rejected') return t(`${modeLabel} رد شد`, `${modeLabel} rejected`);
if (status === 'missed') return t(`${modeLabel} بی‌پاسخ`, `${modeLabel} missed`);
if (status === 'outgoing') return t(`${modeLabel} خروجی`, `${modeLabel} outgoing`);
if (status === 'incoming' || status === 'ringing') return t(`${modeLabel} ورودی`, `${modeLabel} incoming`);
return `${modeLabel} - ${formatCallStatus(status)}`;
}
function appendCallHistory(entry = {}) {
const peer = entry.peerId ? findPeerRecordByPeerId(entry.peerId) : null;
const conversationId = entry.conversationId || getConversationKey(peer) || entry.peerId || entry.fingerprint || '';
if (!conversationId) return;
// Use a stable ID for call logs to prevent duplicates (peerId + status + time-truncated)
// We truncate to minute precision to avoid double logs from near-simultaneous end-call events
const timeBucket = Math.floor(Date.parse(entry.createdAt || new Date()) / 60000);
const stableId = entry.historyId || `call-log-${entry.peerId}-${entry.status}-${timeBucket}`;
appendHistory(conversationId, {
id: stableId,
direction: entry.direction || (entry.status === 'incoming' || entry.status === 'ringing' || entry.status === 'missed' ? 'in' : 'out'),
type: 'call-log',
mode: entry.mode || 'voice',
status: entry.status || 'ended',
durationMs: Number(entry.durationMs || 0),
/* What the call actually moved, in each direction. Kept on the record rather
   than recomputed, because the connection it came from is closed by the time
   anybody looks at the list. */
bytesIn: Number(entry.bytesIn || 0),
bytesOut: Number(entry.bytesOut || 0),
/* No `text`. It used to hold callHistoryText(entry) — the sentence, already
   rendered, in whichever language happened to be on at the time. Every reader
   prefers entry.text when it is there, so a call placed in Persian stayed
   Persian forever and switching the app to English did nothing to it. The
   record above already carries mode, status and durationMs, which is
   everything the sentence is made of, so storing the sentence too was storing
   the same fact twice and only one of the copies could follow the language. */
createdAt: entry.createdAt || new Date().toISOString(),
});
}
function shortSecurityValue(value, lead = 12, tail = 10) {
const text = String(value || '').trim();
if (!text || text === '-') return '-';
if (text.length <= lead + tail + 1) return text;
return `${text.slice(0, lead)}...${text.slice(-tail)}`;
}
let historyStorageOwner = '';
function flushHistoryStore() {
if (!isUnlocked() || historyStorageOwner !== chatStorageAddress(CHAT_HISTORY_STORAGE_KEY)) return false;
if (chatState.historySaveTimer) {
clearTimeout(chatState.historySaveTimer);
chatState.historySaveTimer = null;
}
return saveEncrypted(CHAT_HISTORY_STORAGE_KEY, chatState.history);
}
function storeHistory({ immediate = false } = {}) {
pruneExpiredHistory();
// Persist in the same turn as the mutation: iOS may terminate a background
// process without pagehide, and auto-lock can run before a deferred timer.
flushHistoryStore();
scheduleExpirySweep();
}
/* Ages out stored session keys wherever they are read from disk, so a key
   nobody has touched for a week does not sit in the vault waiting to be
   useful to somebody who opens the device. */
function pruneStoredSessionKeys() {
  const now = Date.now();
  let dropped = 0;
  Object.entries(chatState.sessionKeys || {}).forEach(([alias, record]) => {
    const bornAt = Date.parse(record?.createdAt || record?.updatedAt || 0);
    if (bornAt && now - bornAt > SESSION_KEY_LIFETIME_MS) {
      delete chatState.sessionKeys[alias];
      dropped += 1;
    }
  });
  if (dropped) saveSessionKeys();
  return dropped;
}

/* Refuses to run before the vault is open, rather than loading nothing.
 *
 * This is called twice: once from initChatModule() as the scripts finish
 * loading, and again on poorija:unlock. The first call happens while
 * state.activeProfile is still null, so decryptStorageData returns null for
 * every key, loadEncrypted quietly hands back its fallback, and the effect was
 * to REPLACE whatever was in memory with empty objects — an empty history, an
 * empty contact list, and a freshly generated stablePeerId that would have
 * orphaned every contact keyed on the old one.
 *
 * The unlock call usually put it all back, which is why this mostly went
 * unnoticed. But between the two there is a window where chatState says there
 * is no history, and anything that saved in that window would have written
 * that emptiness over the real thing. saveEncrypted already refuses to write
 * with the vault shut — this closes the other half, so the in-memory state is
 * never quietly emptied either.
 *
 * The one thing still done unconditionally is the render, so a locked app
 * shows its lock screen rather than a half-built chat. */
function loadPersistedChatState() {
if (!isUnlocked()) {
  console.warn('[chat] not loading persisted state: the vault is not open yet.');
  return false;
}
// Reload authenticated data from disk, retaining only writes queued while
// locked. A clean cache must not conceal corrupted/replaced ciphertext.
for (const [address, entry] of encryptedStoreCache) {
  if (!entry.dirty) encryptedStoreCache.delete(address);
}
unreadableChatStores.clear();
const savedProfile = loadEncrypted(CHAT_PROFILE_STORAGE_KEY, null);
if (savedProfile) {
chatState.profile = { ...chatState.profile, ...savedProfile };
} else {
/* A fresh profile takes the shell's hinted relay. It must NEVER take
   window.location.origin: in the native shells that is the webview's own
   origin, which survives origin normalization as a one-label host and then
   starves every connect attempt in DNS. In a browser the page origin IS the
   relay, which is what defaultRelayOriginForShell returns there. */
chatState.profile.serverUrl = defaultRelayOriginForShell();
chatState.profile.name = language() === 'fa' ? 'کاربر P00RIJA' : 'P00RIJA User';
}
/* Repair vaults written before the guard above: a stored server address that
   points at the shell itself or never names a real host is replaced by the
   hinted default, so an existing install heals on first unlock. */
if (!isUsableRelayOrigin(chatState.profile.serverUrl)) {
chatState.profile.serverUrl = defaultRelayOriginForShell();
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
}
/* Cached endpoints from an older setup would keep dialing the old server
   behind the address in the box — clear whichever does not belong to the
   configured server so every dial is derived from what the user sees. */
if (isUsableRelayOrigin(chatState.profile.serverUrl)) {
try {
const expectedOrigin = new URL(chatServerOrigin()).origin;
const sameOrigin = (value) => {
try { return new URL(value).origin === expectedOrigin; } catch (_error) { return false; }
};
let cleaned = false;
if (chatState.profile.presenceUrl && !sameOrigin(chatState.profile.presenceUrl)) {
chatState.profile.presenceUrl = '';
cleaned = true;
}
if (chatState.profile.peerOrigin && !sameOrigin(chatState.profile.peerOrigin)) {
chatState.profile.peerOrigin = '';
cleaned = true;
}
if (cleaned) saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
} catch (_error) { /* unusable address — the honest-fail path handles it */ }
}
/* The messenger switch. A profile that never recorded a choice keeps the
   messenger ON exactly when its saved relay is usable — which is every
   working install (PWA included) and none of the broken ones. Native fresh
   profiles get serverUrl '' above, so they start OFF and stay silent until
   the user answers the first-run question. A saved OFF is respected; the
   usable address stays stored so flipping back on connects without re-entry. */
if (typeof chatState.profile.chatEnabled !== 'boolean') {
chatState.profile.chatEnabled = isUsableRelayOrigin(chatState.profile.serverUrl);
}
/* The wire identity belongs to the profile, not to the browsing session.
   Switching to the decoy used to carry the real profile's stablePeerId over
   in memory (the decoy's stored profile has none), announce the REAL identity
   on the decoy's connection, and save it under the decoy's key. Clearing it
   here is safe: the block right below mints a fresh one through the same
   path a brand-new profile uses, and identityCreatedAt is recreated lazily
   the first time it is asked for. */
if (!savedProfile || typeof savedProfile.stablePeerId !== 'string' || !savedProfile.stablePeerId) {
chatState.profile.stablePeerId = '';
}
if (!savedProfile || !savedProfile.identityCreatedAt) {
chatState.profile.identityCreatedAt = '';
}
if (!chatState.profile.stablePeerId) {
chatState.profile.stablePeerId = generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
}
const savedHistory = loadEncrypted(CHAT_HISTORY_STORAGE_KEY, {});
if (savedHistory && typeof savedHistory === 'object') {
Object.keys(savedHistory).forEach((key) => {
if (!Array.isArray(savedHistory[key])) {
savedHistory[key] = [];
return;
}
/* An object URL only exists for the lifetime of the page that made it. One
   saved in a previous session is a dead pointer, and rendering it is what
   produced a broken image, a player that would not start and a download
   link to nowhere. Clear it; hydrateConversationMedia refills it from the
   vault when the thread is opened. */
savedHistory[key].forEach((entry) => {
if (entry && typeof entry.downloadUrl === 'string' && entry.downloadUrl.startsWith('blob:')) {
entry.downloadUrl = '';
}
/* Call logs written before the language fix carry a frozen sentence in
   `text`, and readers prefer it over deriving a fresh one — so an old log
   would keep answering in the language it was made in while every log made
   since followed the switch. Dropping it here rather than at each of the six
   reading sites means one place has to be right, and the entry loses nothing:
   mode, status and durationMs still say everything it said. */
if (entry && entry.type === 'call-log' && 'text' in entry) delete entry.text;
});
});
chatState.history = mergeLockedIntervalHistory(chatState.history, savedHistory);
historyStorageOwner = chatStorageAddress(CHAT_HISTORY_STORAGE_KEY);
}
const savedSessionKeys = loadEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, {});
if (savedSessionKeys && typeof savedSessionKeys === 'object') {
chatState.sessionKeys = savedSessionKeys;
pruneStoredSessionKeys();
}
/* Expired prekeys go at the same moment, for the same reason. */
const livePrekeys = prunePrekeys(loadPrekeys());
chatState.prekeys = livePrekeys;
savePrekeys(livePrekeys);
const savedSpaces = loadEncrypted(CHAT_SPACES_STORAGE_KEY, null);
const spacesLoaded = Boolean(savedSpaces?.groups || savedSpaces?.channels);
if (spacesLoaded) {
chatState.spaces = {
groups: Array.isArray(savedSpaces.groups) ? savedSpaces.groups : [],
channels: [],
};
/* Groups stored by the older rule are missing the reader from their own
   roster. The record is in this device's vault, which is only true because
   the membership test passed when it arrived, so putting the key back is
   restoring what was dropped rather than granting anything. */
/* Fingerprint only, and only once it is loaded. Falling back to a peerId
   would put a volatile id into the roster, which is the exact thing the
   delivery list is kept derived to avoid. A profile whose identity is not
   hydrated yet is healed on the next load instead. */
const myKey = chatState.identity?.fingerprint || '';
if (myKey) {
let healed = 0;
chatState.spaces.groups.forEach((space) => {
if (!space || space.deleted) return;
const mine = localMembershipKeys();
const isOwner = (space.ownerFingerprint && space.ownerFingerprint === chatState.identity?.fingerprint)
|| (space.ownerPeerId && mine.has(space.ownerPeerId));
if (isOwner) return;
const members = Array.isArray(space.members) ? space.members : [];
if (members.some((member) => mine.has(member))) return;
space.members = normalizeSpaceMembers([...members, myKey]);
healed += 1;
});
if (healed) saveSpaces();
}
} else {
/* Nothing stored under THIS profile's key: start from an empty space list,
   not from whatever the previously-open profile left in memory. Keeping it
   would re-save the real profile's groups under the decoy's namespace a few
   lines below, which is the isolation this whole branch protects. */
chatState.spaces = { groups: [], channels: [] };
}
loadChatDrafts();
const savedCalls = loadEncrypted(CHAT_CALLS_STORAGE_KEY, []);
if (Array.isArray(savedCalls)) {
chatState.calls = savedCalls.slice(0, CALL_LOG_LIMIT);
}
const savedContacts = loadEncrypted(CHAT_CONTACTS_STORAGE_KEY, []);
const contactsLoaded = Array.isArray(savedContacts) && savedContacts.length > 0;if (contactsLoaded) {
chatState.peers = savedContacts
.map((peer) => normalizePeerRecord(peer))
.filter((peer) => peer.peerId && !isSelfPeerRecord(peer))
.map((peer) => ({
...peer,
status: peer.status || 'offline',
}));
} else {
/* Same rule as the spaces above: a profile with no stored book gets an empty
   one, never the previous profile's contact list from memory. */
chatState.peers = [];
}
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
flushHistoryStore();
saveEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, chatState.sessionKeys);
if (spacesLoaded) saveEncrypted(CHAT_SPACES_STORAGE_KEY, chatState.spaces);
/* Newest first, so the cap takes from the front — saveCalls() applies the
   same cut, and slice(-80) here was keeping the OLDEST eighty on the reload
   path, silently dropping every recent call the moment the app restarted. */
saveEncrypted(CHAT_CALLS_STORAGE_KEY, chatState.calls.slice(0, CALL_LOG_LIMIT));
if (contactsLoaded) saveContacts();
/* Per-device chat choices (the auto-download quota). Read after the contact
   book so a partial boot cannot leave the quota at its default silently. */
const savedPrefs = loadEncrypted(CHAT_PREFS_STORAGE_KEY, null);
if (savedPrefs && typeof savedPrefs === 'object') {
const limit = Number(savedPrefs.autoDownloadLimitBytes);
chatState.prefs.autoDownloadLimitBytes = Number.isFinite(limit) && limit >= 0
? limit
: DEFAULT_AUTO_DOWNLOAD_LIMIT_BYTES;
chatState.prefs.relayOnboardAsked = Boolean(savedPrefs.relayOnboardAsked);
}
/* Last step of every unlock: whatever the chat received while the vault was
   shut is sitting in the store cache marked dirty — land it in localStorage
   now that the key exists. */
flushEncryptedStoreCache();
}
/* Messages that arrived while the app was locked live only in memory: writes
   are refused while the vault is shut, so storage stopped at the moment of
   the lock. A plain load would replace memory with that older copy and
   silently erase every one of those arrivals — the very notifications the
   user was promised. The merge keeps storage as the base and appends what
   memory alone has, by id, back in time order. At a cold boot memory is
   empty and the merge is a no-op, so nothing else changes. */
function mergeLockedIntervalHistory(memoryHistory, savedHistory) {
const merged = savedHistory && typeof savedHistory === 'object' ? savedHistory : {};
if (!memoryHistory || typeof memoryHistory !== 'object') return merged;
let added = 0;
Object.keys(memoryHistory).forEach((key) => {
const memoryEntries = Array.isArray(memoryHistory[key]) ? memoryHistory[key] : [];
if (!memoryEntries.length) return;
const saved = Array.isArray(merged[key]) ? merged[key] : (merged[key] = []);
const knownIds = new Set(saved.map((entry) => entry?.id).filter(Boolean));
const arrivals = memoryEntries.filter((entry) => entry?.id && !knownIds.has(entry.id));
if (!arrivals.length) return;
merged[key] = saved.concat(arrivals).sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')));
added += arrivals.length;
});
if (added) {
try { storeHistory(); } catch (_error) { /* persisted on the next change */ }
}
return merged;
}
function saveProfile() {
const profile = buildProfileDraft();
if (chatState.pendingAvatarData) {
profile.avatarData = chatState.pendingAvatarData;
chatState.pendingAvatarData = '';
}
chatState.profile = profile;
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, profile);
renderStaticUi();
broadcastHello();
notify(t('پروفایل چت ذخیره شد', 'Chat profile saved'), 'success');
}
function sessionSecurityText(session) {
if (!session?.cryptoKey) {
return t('منتظر تبادل کلید RSA -> AES-GCM', 'Waiting for RSA -> AES-GCM key exchange');
}
return t('RSA-OAEP-3072 + AES-256-GCM', 'RSA-OAEP-3072 + AES-256-GCM');
}
/* Three states, not two. "Not connected" covers both "trying" and "gave up",
   and they deserve different colours: amber while something is still in
   flight, red only once nothing is. The label already distinguishes them, so
   the state is read from it rather than threaded through twenty call sites. */
const CONNECTING_LABEL = /connect|restor|reclaim|updat|در حال|به‌روزرسان/i;
function setConnectionState(connected, label) {
chatState.connected = connected;
const dot = document.getElementById('chatConnectionDot');
const status = document.getElementById('chatConnectionStatus');
const state = connected ? 'online' : (CONNECTING_LABEL.test(String(label || '')) ? 'connecting' : 'offline');
chatState.connectionState = state;
if (dot) {
dot.style.background = '';
dot.style.boxShadow = '';
dot.classList.toggle('online', state === 'online');
dot.classList.toggle('connecting', state === 'connecting');
dot.classList.toggle('offline', state === 'offline');
}
/* The collapsed header shows only the dot, so it carries the state too — an
   avatar with a coloured ring is the whole status indicator up there. */
document.querySelector('#content-chat .chat-profile-avatar-stack')?.setAttribute('data-connection', state);
/* The card's own status line follows the same state. */
if (typeof renderProfileSummary === 'function') renderProfileSummary();
if (status) {
status.textContent = label || (connected ? t('متصل', 'Connected') : t('عدم اتصال', 'Disconnected'));
status.title = label || '';
}
}
function syncComposerDirection() {
const composer = document.getElementById('chatComposer');
if (!composer) return;
const nextDir = detectComposerDirection(composer.value);
composer.dir = nextDir;
// html[lang="fa"] #chatComposer pins direction and text-align with
// !important, so the app's language beat whatever was actually being typed:
// the dir attribute was set correctly and then ignored. An inline
// !important declaration is the only thing that outranks it.
composer.style.setProperty('direction', nextDir, 'important');
composer.style.setProperty('text-align', nextDir === 'rtl' ? 'right' : 'left', 'important');
}
let composerFocusGraceTimer = 0;
function syncComposerViewportFocus(focused = false, isTyping = false) {
const html = document.documentElement;
const shouldFocus = Boolean(focused && isCompactChatLayout() && appState()?.activeTab === 'chat');
if (shouldFocus) {
window.clearTimeout(composerFocusGraceTimer);
html.classList.add('chat-composer-focused');
runComposerKeyboardServo();
} else {
/* On the phone, the first tap outside the input is the keyboard's own
   dismissal, and iOS delivers that blur between touchstart and pointerdown.
   Dropping the class in that instant re-flowed the whole pinned layout
   before the tap could be hit-tested, so the activation never reached the
   button — nothing was sent, the keys folded, and the second tap did the
   work. The class now leaves on a short grace instead: the layout holds
   still through the tap, and focus coming straight back cancels the
   teardown entirely. */
window.clearTimeout(composerFocusGraceTimer);
stopComposerKeyboardServo();
composerFocusGraceTimer = window.setTimeout(() => {
if (document.activeElement?.id === 'chatComposer') return;
html.classList.remove('chat-composer-focused');
stopComposerKeyboardServo();
}, 350);
return;
}
const syncFocusLayout = () => {
const panel = document.getElementById('chatMessages');
if (!panel) return;
// If typing, only scroll if we are already near the bottom to avoid jitter
if (isTyping) {
const isNearBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 40;
if (isNearBottom) {
panel.scrollTop = panel.scrollHeight;
}
} else {
panel.scrollTop = panel.scrollHeight;
}
};
// Single sync for typing, multiple for initial focus/resizing
if (isTyping) {
window.requestAnimationFrame(syncFocusLayout);
} else {
window.setTimeout(syncFocusLayout, 40);
window.setTimeout(syncFocusLayout, 150);
window.setTimeout(syncFocusLayout, 300);
}
}
/* iOS reports neither an innerHeight change nor a visualViewport resize when
   the keyboard grows mid-focus — switching to the emoji panel is the usual
   case, and its extra height simply overlays the composer while every signal
   the layout listens to stays quiet. The previous fix pinned the composer's
   `bottom` from arithmetic on html.clientHeight and the visual viewport — but
   every number in that sum is a story iOS tells differently per mode (browser
   tab, standalone PWA, emoji panel), and whichever one lied, the pin repeated
   the lie forever: too high and a dead strip opened between bar and keyboard,
   too low and the bar sat buried under the keys. The honest geometry is the
   bar's own rect versus where the visible area ends — measure the error,
   step the pin by exactly that much, and let each pass correct the last one
   until the error is zero. Two regimes move the bar, so the servo speaks
   both: a bar that is itself fixed takes an inline pin, and the phone's
   in-flow bar is moved through the keyboard inset its fixed shell stands on.
   Runs on every visualViewport event and on a short interval while the
   composer is focused; the inline pin comes off when focus leaves and the
   stylesheet rules own the bar again. */
let composerKeyboardServoTimer = 0;
let composerKeyboardServoUnpinTimer = 0;
let composerKeyboardServoBaselineTop = -1;
let composerKeyboardServoRunning = false;
function composerKeyboardOverlapFix() {
const html = document.documentElement;
const vv = window.visualViewport;
const composer = document.querySelector('#content-chat footer.chat-composer-bar');
if (!vv || !composer || !html.classList.contains('chat-composer-focused')) return;
/* Every time the keyboard GROWS mid-focus — text keys to the taller emoji
   panel — iOS scroll-kicks the page to "reveal" the input it now thinks is
   covered. Nothing put that scroll back: the header rode off the top with
   the hamburger (sticky never engages under the overflow-managed app shell),
   and the fixed shell, which does not move with a page scroll, ended up
   sitting lower than the visible area — so the keys landed on the composer,
   which is exactly what the screenshots showed. The focus handler already
   zeroes the scroll once on entry; the same medicine now runs on every
   keyboard move while the composer is focused, before any measuring. */
if (window.scrollY > 0 || html.scrollTop > 0 || document.body.scrollTop > 0) {
try { window.scrollTo(0, 0); } catch (_error) { /* root is frozen */ }
html.scrollTop = 0;
document.body.scrollTop = 0;
}
/* The kick iOS can still leave behind is the visual viewport's own pan
   (offsetTop), which no scrollTo can undo — after it, the top of the page
   sat above the visible window: header gone, thread cut. The pan is measured
   against the lowest offset the viewport has shown during this focus (a
   standalone PWA carries the status bar in offsetTop at rest, and iOS may
   drop that constant the moment a keyboard appears — either way, growth
   from the session's own floor is the pan) and published for the stylesheet,
   which pins the header and shifts the chat shell down by exactly what iOS
   pushed them up. The composer needs no extra help: its target below already
   includes offsetTop, so the pan-corrected bottom is where it lands anyway. */
if (composerKeyboardServoBaselineTop < 0 || vv.offsetTop < composerKeyboardServoBaselineTop) {
composerKeyboardServoBaselineTop = vv.offsetTop;
}
const pan = Math.max(0, Math.round(vv.offsetTop - composerKeyboardServoBaselineTop));
html.style.setProperty('--app-keyboard-pan', `${pan}px`);
/* Rect and visual viewport are both in layout-viewport pixels, so their
   difference is the truth about coverage: positive means keys over the bar,
   negative means a gap between them. */
const visibleBottom = vv.offsetTop + vv.height;
const error = composer.getBoundingClientRect().bottom - visibleBottom;
const clampMax = Math.round(window.innerHeight * 0.6);
const converge = (base) => Math.round(Math.max(0, Math.min(base + error, clampMax)));
const barStyles = getComputedStyle(composer);
if (barStyles.position === 'fixed') {
const currentPin = parseFloat(barStyles.bottom);
const base = Number.isFinite(currentPin) ? currentPin : 0;
const next = converge(base);
if (Math.abs(next - base) <= 1) return;
if (next > 2) {
composer.style.setProperty('bottom', `${next}px`, 'important');
/* The shell under the bar follows the same inset, so they must never be
   told two different numbers about where the keyboard starts. */
html.style.setProperty('--app-keyboard-inset', `${next}px`);
} else {
composer.style.removeProperty('bottom');
}
return;
}
/* The phone's regime: the bar is ordinary flow at the bottom of a shell that
   is itself fixed, with the keyboard inset for a bottom edge. The same
   measured error, applied to the number the shell reads. */
if (!html.classList.contains('keyboard-open')) return;
const shell = document.querySelector('#content-chat > .chat-shell');
if (!shell) return;
const shellStyles = getComputedStyle(shell);
const currentInset = parseFloat(shellStyles.bottom);
if (shellStyles.position !== 'fixed' || !Number.isFinite(currentInset)) return;
const base = currentInset;
const next = converge(base);
if (Math.abs(next - base) <= 1) return;
html.style.setProperty('--app-keyboard-inset', `${next}px`);
/* Kept in step by hand because an inline definition on <html> would otherwise
   keep shadowing the stylesheet rule that reads the inset. */
html.style.setProperty('--mobile-keyboard-bottom', `${next}px`);
}
function runComposerKeyboardServo() {
window.clearInterval(composerKeyboardServoTimer);
/* The floor belongs to a focus session, not to a restart: the servo is
   re-armed on every viewport event while typing, and re-reading the baseline
   mid-pan would call the pan zero. */
if (!composerKeyboardServoRunning) {
composerKeyboardServoRunning = true;
composerKeyboardServoBaselineTop = window.visualViewport?.offsetTop ?? 0;
}
composerKeyboardOverlapFix();
composerKeyboardServoTimer = window.setInterval(() => {
if (!document.documentElement.classList.contains('chat-composer-focused')) {
stopComposerKeyboardServo();
return;
}
composerKeyboardOverlapFix();
}, 300);
}
function stopComposerKeyboardServo() {
window.clearInterval(composerKeyboardServoTimer);
composerKeyboardServoTimer = 0;
composerKeyboardServoRunning = false;
/* The unpin waits a beat. On the phone the first tap on Send can blur the
   input — the keyboard's own dismissal on a tap outside a text field — and
   unpinning in that same instant yanked the bar down out from under the
   finger before the tap's activation arrived: the message went nowhere,
   the keyboard hid, and only the second tap sent. Holding the pin for a
   moment keeps the bar still while the tap finishes; if focus comes straight
   back the servo resumes and nothing changes at all. */
window.clearTimeout(composerKeyboardServoUnpinTimer);
composerKeyboardServoUnpinTimer = window.setTimeout(() => {
const html = document.documentElement;
if (html.classList.contains('chat-composer-focused') || html.classList.contains('keyboard-open')) return;
document.querySelector('#content-chat footer.chat-composer-bar')?.style.removeProperty('bottom');
/* Let the honest signals own the variables again once nobody is typing. */
html.style.setProperty('--app-keyboard-inset', '0px');
html.style.setProperty('--app-keyboard-pan', '0px');
}, 350);
}
function bindComposerDrafts() {
  const composer = document.getElementById('chatComposer');
  if (!composer || composer.dataset.draftsBound) return;
  composer.dataset.draftsBound = '1';
  composer.addEventListener('input', () => {
    setDraft(chatState.activeConversationId, composer.value);
    /* The list shows a draft marker, so it has to know as you type — throttled
       to a frame so a fast typist does not re-render the list per keystroke. */
    if (!composer.__draftPaint) {
      composer.__draftPaint = true;
      requestAnimationFrame(() => { composer.__draftPaint = false; renderPeers(); });
    }
  });
}

function focusComposerWithoutPageJump(composer = document.getElementById('chatComposer')) {
if (!composer) return;
try {
composer.focus({ preventScroll: true });
} catch (error) {
composer.focus();
}
window.setTimeout(() => {
if (!isCompactChatLayout()) return;
document.documentElement.scrollTop = 0;
document.body.scrollTop = 0;
window.scrollTo(0, 0);
syncComposerViewportFocus(true);
}, 0);
}
function renderStaticUi() {
if (!document.getElementById('content-chat')) return;
/* Setting .value on an input the user is mid-typing in silently eats their
 * keystrokes — background renders (watchdog ticks, hydration finishing) were
 * literally deleting the address a person had typed into the server box the
 * moment before. A field being edited is the user's, not the renderer's. */
const isBeingEdited = (id) => document.activeElement === document.getElementById(id);
document.getElementById('chatProfileName').value = chatState.profile.name || '';
document.getElementById('chatProfileName').placeholder = t('نام نمایشی', 'Display name');
const serverField = document.getElementById('chatServerUrl');
if (!isBeingEdited('chatServerUrl')) {
serverField.value = chatState.profile.serverUrl || defaultRelayOriginForShell();
}
document.getElementById('chatAutoConnect').checked = Boolean(chatState.profile.autoConnect);
document.getElementById('chatAllowVideo').checked = Boolean(chatState.profile.allowVideo);
document.getElementById('chatAutoDiscovery').checked = Boolean(chatState.profile.autoDiscovery);
/* The master switch mirrors the profile, and everything connection-shaped on
 * this panel dims while it is off. */
const enabledToggle = document.getElementById('chatEnabledToggle');
if (enabledToggle) enabledToggle.checked = Boolean(chatState.profile.chatEnabled);
const offNotice = document.getElementById('chatDisabledNotice');
if (offNotice) offNotice.classList.toggle('hidden', Boolean(chatState.profile.chatEnabled));
['chatConnectBtn', 'chatReconnectBtn', 'chatDiscoverLocalBtn', 'chatConfigExportBtn'].forEach((id) => {
const button = document.getElementById(id);
if (button) button.disabled = !chatState.profile.chatEnabled;
});
const publicStunInput = document.getElementById('chatPublicStun');
if (publicStunInput) {
publicStunInput.checked = shouldUsePublicStun(normalizeIceServerUrls(chatState.profile.turnUrl).length);
}
/* Linux native only: WebKitGTK has no WebRTC, so the calls pane carries the
   "use the PWA for calls" card with a button that opens the relay's own
   address in the system browser. Every other platform never sees it. */
const linuxCallsNotice = document.getElementById('chatCallsLinuxNotice');
if (linuxCallsNotice) {
const showNotice = Boolean(window.PoorijaDesktop?.available) && !webRTCSupported();
linuxCallsNotice.classList.toggle('hidden', !showNotice);
const pwaButton = document.getElementById('chatCallsPwaBtn');
if (pwaButton) pwaButton.disabled = !isUsableRelayOrigin(chatState.profile.serverUrl);
}
document.getElementById('chatShowSuspensionCountdown').checked = chatState.profile.showSuspensionCountdown !== false;
syncChatToggleStates();
if (!isBeingEdited('chatTurnUrl')) document.getElementById('chatTurnUrl').value = chatState.profile.turnUrl || '';
if (!isBeingEdited('chatTurnUsername')) document.getElementById('chatTurnUsername').value = chatState.profile.turnUsername || '';
if (!isBeingEdited('chatTurnCredential')) document.getElementById('chatTurnCredential').value = chatState.profile.turnCredential || '';
document.getElementById('chatComposer').placeholder = t('پیام امن شما…', 'Your secure message...');
bindComposerDrafts();
renderRingtoneSettings();
document.getElementById('chatTimerToggleBtn')?.setAttribute('title', t('پیام خودتخریب', 'Self-destruct message'));
const controlLabels = {
chatStartSessionBtn: t('ساخت سشن امن', 'Create secure session'),
chatVoiceCallBtn: t('تماس صوتی', 'Voice call'),
chatVideoCallBtn: t('تماس تصویری', 'Video call'),
chatEndCallBtn: t('پایان تماس', 'End call'),
chatSendMessageBtn: t('ارسال', 'Send'),
chatSendFileBtn: t('ارسال فایل', 'Send file'),
chatVoiceMessageBtn: t('پیام صوتی', 'Voice message'),
chatMinimizeCallBtn: t('بازگشت به چت / حالت شناور', 'Return to chat / floating mode'),
chatFloatingEndCallBtn: t('پایان تماس', 'End call'),
chatSpeakerToggleBtn: t('اسپیکر', 'Speaker'),
chatHoldToggleBtn: t('هولد', 'Hold'),
chatMuteToggleBtn: t('بی‌صدا', 'Mute'),
chatSwapVideoLayoutBtn: t('سوئیچ نمای اصلی', 'Swap main view'),
chatMirrorVideoBtn: t('نمای آینه‌ای خودم', 'Mirror my preview'),
chatCallScreenshotBtn: t('اسکرین‌شات از تماس (به طرف مقابل اطلاع داده می‌شود)', 'Call screenshot (the other side is notified)'),
chatCallPiPBtn: t('تصویر در تصویر', 'Picture in picture'),
chatCallFullscreenBtn: t('تمام‌صفحه', 'Fullscreen'),
chatCallSettingsBtn: t('انتخاب میکروفون/دوربین/اسپیکر', 'Mic / camera / speaker'),
chatFlipCameraBtn: t('چرخش', 'Flip'),
chatVideoToggleBtn: t('ویدیو', 'Video'),
chatScreenShareBtn: t('اشتراک صفحه', 'Screen share'),
chatDeleteConversationBtn: t('حذف گفتگو', 'Delete conversation'),
chatEndCallControlBtn: t('پایان', 'End'),
};
Object.entries(controlLabels).forEach(([id, label]) => {
const button = document.getElementById(id);
if (!button) return;
button.setAttribute('title', label);
const textNode = button.querySelector('span');
if (textNode) textNode.textContent = label;
});
const localPeerId = chatState.peerId || chatState.clientId || '-';
const localFingerprint = chatState.identity?.fingerprint || '-';
document.getElementById('chatPeerId').textContent = shortSecurityValue(localPeerId);
document.getElementById('chatPeerId').title = localPeerId;
document.getElementById('chatFingerprint').textContent = shortSecurityValue(localFingerprint);
document.getElementById('chatFingerprint').title = localFingerprint;
document.getElementById('chatServerMeta').textContent = t(
`Signal: ${chatServerOrigin()} | WebSocket: ${wsUrl()}`,
`Signal: ${chatServerOrigin()} | WebSocket: ${wsUrl()}`
);
const restrictionBanner = document.getElementById('chatRestrictionBanner');
if (restrictionBanner) {
restrictionBanner.textContent = restrictionText();
restrictionBanner.classList.toggle('hidden', !hasActiveServerRestriction());
}
const avatarText = document.getElementById('chatProfileAvatarText');
const avatarImage = document.getElementById('chatProfileAvatarImage');
if (avatarText) avatarText.textContent = initials(chatState.profile.name);
if (avatarImage) {
const previewAvatar = chatState.pendingAvatarData || chatState.profile.avatarData || '';
avatarImage.src = previewAvatar;
avatarImage.classList.toggle('hidden', !previewAvatar);
avatarText?.classList.toggle('hidden', Boolean(previewAvatar));
}
const saveAvatarBtn = document.getElementById('chatAvatarSaveBtn');
if (saveAvatarBtn) {
saveAvatarBtn.disabled = !chatState.pendingAvatarData;
}
const showQrBtn = document.getElementById('chatShowIdentityQrBtn');
if (showQrBtn) showQrBtn.disabled = false;
syncComposerDirection();
}
// A thread that holds messages is a conversation, full stop. Contact records
// and history are keyed independently (conversationId -> fingerprint -> peerId),
// so a record that loses its fingerprint starts resolving to a different key
// and its history is orphaned: the thread stops being listed even though the
// messages are right there on disk. Re-attach anything history knows about that
// no contact record covers.
function orphanedHistoryRecords(covered) {
// Direct peers are filtered through isSelfPeerRecord; these were not, so a
// thread keyed by our OWN identity came back as a contact — and turned up as a
// forward destination, which quietly sent the message to ourselves.
const mine = new Set([
chatState.identity?.fingerprint,
chatState.peerId,
chatState.clientId,
chatState.profile?.stablePeerId,
].filter(Boolean));
const out = [];
Object.entries(chatState.history || {}).forEach(([key, entries]) => {
if (!key || key === 'system' || !Array.isArray(entries) || !entries.length) return;
if (covered.has(key) || mine.has(key)) return;
const named = [...entries].reverse().find((entry) => entry?.senderName || entry?.username);
out.push({
clientId: key,
peerId: key,
conversationId: key,
fingerprint: key,
username: named?.senderName || named?.username || `${key.slice(0, 10)}…`,
status: 'offline',
manual: true,
recovered: true,
avatarData: '',
});
});
return out;
}
function allConversationRecords() {
const direct = chatState.peers.filter((peer) => peer.peerId && !isSelfPeerRecord(peer));
const result = [
...direct,
...chatState.spaces.groups,
...chatState.spaces.channels,
];
const covered = new Set(result.map((record) => getConversationKey(record)).filter(Boolean));
result.push(...orphanedHistoryRecords(covered));
if (chatState.history['system']?.length > 0) {
result.push({
clientId: 'system',
peerId: 'system',
conversationId: 'system',
type: 'system',
username: t('اعلان‌های سیستم', 'System Broadcasts'),
status: 'online',
system: true,
avatarData: '',
lastSeenAt: chatState.history['system'].slice(-1)[0]?.timestamp || 0
});
}
return result;
}
function conversationRecordById(conversationId) {
return allConversationRecords().find((record) => getConversationKey(record) === conversationId) || null;
}
