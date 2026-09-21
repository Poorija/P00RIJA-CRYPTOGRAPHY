/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 1 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   constants
*/

const CHAT_PROFILE_STORAGE_KEY = 'poorija_chat_profile';
const CHAT_IDENTITY_STORAGE_KEY = 'poorija_chat_identity';
const CHAT_HISTORY_STORAGE_KEY = 'poorija_chat_history';
const CHAT_SESSION_KEYS_STORAGE_KEY = 'poorija_chat_session_keys';
const CHAT_SPACES_STORAGE_KEY = 'poorija_chat_spaces';
const CHAT_CALLS_STORAGE_KEY = 'poorija_chat_calls';
const CHAT_CONTACTS_STORAGE_KEY = 'poorija_chat_contacts';
/* Declared here, not next to the waveform helpers further down: renderMessages
   reads voiceWaveCache while drawing a voice bubble, which sits ABOVE that
   point in the file. A `const` is hoisted but not initialised, so the read hit
   the temporal dead zone and threw "Cannot access 'voiceWaveCache' before
   initialization" — aborting the entire thread render for good the moment any
   voice message existed in history. */
const voiceWaveCache = new Map();
const VOICE_WAVE_BARS = 42;
/* ------------------------------------------------------------------
 * File transfer sizing
 *
 * The old path read the whole file with arrayBuffer(), encrypted that in one
 * go, and base64-encoded the result into a single JS string — about 3.3x the
 * file in memory, and above roughly 384 MB the string crosses V8's maximum
 * length and simply throws. Chunks are now sliced off the Blob, encrypted one
 * at a time, and sent as binary, so peak memory is one chunk regardless of how
 * large the file is.
 *
 * 64 KB per chunk: comfortably under the 256 KB an SCTP data channel will
 * accept, and few enough messages that a 500 MB file is ~8000 of them rather
 * than ~14000.
 *
 * It is NOT under PeerJS's own chunker, whose chunkedMTU is 16300 bytes, so
 * each of these is split into five on the wire and concatenated back on the
 * far side. Measured, that costs nothing worth having: the encrypt-and-slice
 * path runs at ~278 MB/s while the data channel itself tops out around
 * 8-11 MB/s between two processes, so the transport is the wall and every
 * message size from 16 KB to 256 KB lands within the noise of it.
 * ------------------------------------------------------------------ */
const FILE_CHUNK_BYTES = 64 * 1024;
/* The live path only. Both people are connected, the bytes go peer to peer,
   and nothing is stored on the relay — so the ceiling is what the two devices
   can hold and how long they are willing to wait, not what a server can carry.
   MAX_OFFLINE_FILE_BYTES below is the one that guards the relay's mailbox and
   it is deliberately left where it is. */
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
/* Queued through the relay rather than sent over a live channel. The relay
   allows 512 MB per recipient, so one 500 MB file would take essentially all
   of it and evict everything else waiting for that person. */
const MAX_OFFLINE_FILE_BYTES = 100 * 1024 * 1024;
/* Above this a received file is handed over as a download instead of being
   kept in the on-device vault, whose whole budget is 512 MB. */
const MEDIA_VAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
/* How much may sit unsent in the data channel before the sender waits. Chrome
   starts dropping or closing somewhere past 16 MB; staying an order of
   magnitude below that leaves room for everything else sharing the channel. */
const DATA_CHANNEL_HIGH_WATER = 4 * 1024 * 1024;
const DATA_CHANNEL_LOW_WATER = 1 * 1024 * 1024;
/* How much of a received file may sit in the JS heap before it is moved into a
   Blob. The receiver used to keep every decrypted chunk as a Uint8Array until
   the last one arrived, so the peak was the whole file: fine at 500 MB, fatal
   at 4 GB, because a tab's heap does not go there. A Blob's bytes live in the
   browser's blob store instead — paged to disk once it is large — so the heap
   now holds one of these buffers rather than the file. */
const TRANSFER_FLUSH_BYTES = 4 * 1024 * 1024;
/* How long a transfer may make no progress before it is called a failure
   rather than sitting on "sending" indefinitely, which is what it did. */
const TRANSFER_STALL_TIMEOUT_MS = 60000;
/* ---- incoming-transfer consent --------------------------------------------
   A live file-start is an offer, not a delivery: the recipient answers before
   the bytes start moving. Under FILE_GATE_MIN_BYTES the offer costs more than
   the file, so small media still streams the old way; the quota the recipient
   set (chat prefs) decides silently above that, and only what exceeds the
   quota — or is large enough to matter, see LARGE_FILE_CONFIRM_BYTES — is
   put to a person. Declining cancels both ends: the recipient drops the
   transfer and the sender stops uploading. */
const FILE_GATE_MIN_BYTES = 512 * 1024;
const LARGE_FILE_CONFIRM_BYTES = 25 * 1024 * 1024;
const TRANSFER_CONSENT_TIMEOUT_MS = 60000;
const DEFAULT_AUTO_DOWNLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const CHAT_PREFS_STORAGE_KEY = 'poorija_chat_prefs';
const MAX_PROFILE_AVATAR_BYTES = 5 * 1024 * 1024;
const SESSION_READY_TIMEOUT_MS = 8000;
/* How long a phone rings before the call gives up. The same number on both
   sides, and on group calls: a ring that never stops is worse than a missed
   call, and the caller had no timer at all - their side rang until they
   pressed the button themselves. */
const CALL_RING_TIMEOUT_MS = 40000;
/* After somebody answers, how long the media has to actually arrive. Longer
   than a ring, because a connection that has to go the long way round through
   TURN is slow rather than broken. */
const CALL_CONNECT_TIMEOUT_MS = 25000;
const CHAT_RENDER_WINDOW_SIZE = 80;
/* ------------------------------------------------------------------
 * Remote-value sanitizers.
 *
 * Message ids, reaction emoji, avatars and coordinates all arrive from peers
 * and used to flow into panel.innerHTML raw. Escaping at render time covers
 * the drawing; these gate what is allowed INTO state at all, so a value that
 * fails them never reaches a template literal anywhere downstream.
 * ------------------------------------------------------------------ */
/* Returns the id only when it is made of identifier-safe characters. Anything
   else (markup, quotes, spaces) becomes '' and the caller regenerates a local
   id. Local ids are `prefix-<digits>-<base36>`, which always pass. */
function sanitizeRemoteId(value) {
  const text = String(value || '');
  return /^[A-Za-z0-9_-]{1,96}$/.test(text) ? text : '';
}
/* Avatars are only ever rendered when they are a base64 data: URL of a raster
   format. SVG is deliberately absent: a data:image/svg+xml payload executes
   script when opened, and avatar strings travel through presence, contact
   cards and archives from people who have never been verified. */
function sanitizeAvatarData(value) {
  const text = String(value || '');
  if (!text || text.length > 2_100_000) return '';
  return /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/.test(text) ? text : '';
}
/* Blob and download URLs that came off the wire (system broadcasts, imports)
   must be one of these schemes before they land in an href or src. */
function safeMediaUrl(value) {
  const text = String(value || '');
  try {
    const parsed = new URL(text, location.href);
    return ['https:', 'blob:', 'data:'].includes(parsed.protocol) ? text : '';
  } catch (_error) {
    return '';
  }
}
/* Mime types that may be opened as a document in a new tab. SVG and anything
   HTML- or XML-flavoured are excluded on purpose: a blob: URL inherits the
   creating page's origin, so script inside such a file runs as the app. */
function isInlineSafeMediaType(mime) {
  const text = String(mime || '').toLowerCase();
  return /^(image\/(?:png|jpe?g|gif|webp|bmp)|video\/(?:mp4|webm|ogg)|audio\/(?:mpeg|mp3|ogg|wav|webm|mp4)|application\/pdf|text\/plain)$/.test(text);
}
const CHAT_REACTION_GROUPS = [
{ labelFa: 'پرکاربرد', labelEn: 'Frequent', emojis: ['❤️', '👍', '🙏', '😂', '🔥', '😁', '😮', '😢'] },
{ labelFa: 'احساسات', labelEn: 'Mood', emojis: ['😍', '🥰', '🤩', '😎', '🤔', '😐', '😡', '😭'] },
{ labelFa: 'تایید', labelEn: 'Signals', emojis: ['✅', '👏', '🙌', '👌', '🤝', '💯', '⭐', '⚡'] },
];
const CHAT_REACTION_EMOJIS = CHAT_REACTION_GROUPS.flatMap((group) => group.emojis);
const CHAT_RINGTONE_OPTIONS = [
{ id: 'classic', labelFa: 'کلاسیک', labelEn: 'Classic', gap: 1550, wave: 'sine', tones: [[440, 0, 190], [660, 210, 210], [880, 460, 260]] },
{ id: 'pulse', labelFa: 'پالس آرام', labelEn: 'Soft pulse', gap: 1850, wave: 'sine', tones: [[523, 0, 260], [523, 340, 260], [784, 720, 320]] },
{ id: 'signal', labelFa: 'سیگنال سریع', labelEn: 'Quick signal', gap: 1200, wave: 'sine', tones: [[740, 0, 110], [988, 150, 110], [740, 300, 110], [988, 450, 160]] },
{ id: 'soft', labelFa: 'زنگ نرم', labelEn: 'Gentle chime', gap: 2100, wave: 'triangle', tones: [[392, 0, 330], [587, 420, 330], [784, 860, 420]] },
{ id: 'aurora', labelFa: 'شفق', labelEn: 'Aurora', gap: 2400, wave: 'triangle', tones: [[523, 0, 300], [659, 200, 300], [784, 400, 300], [1046, 620, 520]] },
{ id: 'orbit', labelFa: 'مدار', labelEn: 'Orbit', gap: 1900, wave: 'sine', tones: [[880, 0, 140], [660, 170, 140], [880, 340, 140], [1174, 520, 340]] },
{ id: 'nocturne', labelFa: 'شبانه', labelEn: 'Nocturne', gap: 2600, wave: 'sine', tones: [[349, 0, 420], [440, 300, 420], [523, 620, 520]] },
{ id: 'marimba', labelFa: 'ماریمبا', labelEn: 'Marimba', gap: 1700, wave: 'triangle', tones: [[784, 0, 130], [1046, 130, 130], [880, 270, 130], [1318, 400, 220]] },
{ id: 'telegraph', labelFa: 'تلگراف', labelEn: 'Telegraph', gap: 1500, wave: 'square', tones: [[1046, 0, 70], [1046, 120, 70], [1046, 240, 70], [784, 400, 180]] },
{ id: 'ripple', labelFa: 'موج', labelEn: 'Ripple', gap: 2200, wave: 'sine', tones: [[659, 0, 200], [988, 180, 200], [659, 380, 200], [988, 560, 200], [1318, 760, 380]] },
];
const CHAT_MESSAGE_TONE_OPTIONS = [
{ id: 'chime', labelFa: 'چایم کوتاه', labelEn: 'Short chime', tones: [[740, 0, 130], [988, 120, 150]], type: 'sine' },
{ id: 'pop', labelFa: 'پاپ نرم', labelEn: 'Soft pop', tones: [[520, 0, 90], [620, 95, 90]], type: 'triangle' },
{ id: 'ping', labelFa: 'پینگ سریع', labelEn: 'Quick ping', tones: [[1046, 0, 120]], type: 'sine' },
{ id: 'bell', labelFa: 'بل آرام', labelEn: 'Gentle bell', tones: [[659, 0, 180], [880, 190, 210]], type: 'triangle' },
{ id: 'droplet', labelFa: 'قطره', labelEn: 'Droplet', tones: [[1318, 0, 70], [880, 70, 160]], type: 'sine' },
{ id: 'glass', labelFa: 'شیشه', labelEn: 'Glass', tones: [[1568, 0, 90], [2093, 80, 120], [1568, 200, 160]], type: 'sine' },
{ id: 'knock', labelFa: 'تق‌تق', labelEn: 'Knock', tones: [[220, 0, 60], [196, 110, 80]], type: 'square' },
{ id: 'triad', labelFa: 'سه‌نوا', labelEn: 'Triad', tones: [[523, 0, 100], [659, 90, 100], [784, 180, 190]], type: 'triangle' },
{ id: 'silent', labelFa: 'بی‌صدا', labelEn: 'Silent', tones: [], type: 'sine' },
];

/* How far along a sent message is. One ladder, because there were two and they
   disagreed: the copy inside appendHistory()'s duplicate-merge had no rung for
   'seen' at all, so `CHAT_STATUS_RANK[seen] ?? 0` read as 0 and a retried
   message — the sender resending after a lost receipt, which is the ordinary
   case this merge exists for — demoted a read message back to delivered. The
   read tick vanished on the sender's screen and the receipt was re-armed.
   'opened' and 'seen' share a rung: both mean the message was on the reader's
   screen, and which word arrives depends only on which path reported it. */
const CHAT_STATUS_RANK = { failed: 0, queued: 1, relayed: 2, sent: 3, delivered: 4, opened: 5, seen: 5 };
function chatStatusRank(status) {
  return CHAT_STATUS_RANK[status] ?? 0;
}
