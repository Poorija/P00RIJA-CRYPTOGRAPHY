/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Guest mode, the parts a relay decides without touching the network
 * (docs/RELAY-NETWORK.md, "Guest mode").
 *
 * When a person's home relay cannot be reached, their app stays for a while on
 * another relay of the same operator's family: a guest, never a resident. This
 * file holds what such a relay needs to decide about them:
 *
 *   - statements a person signs with their own identity key — "this device is
 *     a guest at G until then" and "my home moves from H to G" — the only
 *     things a relay believes about where someone lives, because no relay can
 *     write one;
 *   - roster copies: an account's device roster kept by the family's other
 *     relays, sealed under a key made from the account's fingerprint, so a
 *     relay learns nothing about an account until that account visits it;
 *   - the guest book: who is a guest here, from which home, until when, and
 *     where their mail goes once they leave;
 *   - whether a guest may be taken in at all.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalJson } = require('./relay-directory.js');

const HEX64 = /^[a-f0-9]{64}$/;
const DEVICE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/* A guest notice covers one day; an hour of slack for clocks. */
const NOTICE_LONGEST_MS = 25 * HOUR;
/* A move statement is acted on within a week of being signed. */
const MOVE_FRESH_MS = 7 * DAY;
const CLOCK_SKEW_MS = 10 * 60 * 1000;
const BOOK_CAP = 20000;
/* An account with more guest devices than this is not a family. */
const DEVICES_PER_ACCOUNT = 8;
/* The book may hold this many times the sockets guests may have: room for
   people coming and going, not for an endless stream of new identities. */
const BOOK_ROOM_FACTOR = 4;
const bookRoomFor = (wsMax, share) => Math.floor(Number(wsMax) * Number(share)) * BOOK_ROOM_FACTOR;

/* ---- statements signed with the identity key ------------------------------ */

const statementText = (statement) => canonicalJson(statement);

function noticeShape(s) {
  return s.v === 1 && HEX64.test(String(s.fp || '')) && DEVICE_ID.test(String(s.deviceId || ''))
    && HEX64.test(String(s.home || '')) && HEX64.test(String(s.guest || '')) && s.home !== s.guest
    && Number.isSafeInteger(s.at) && Number.isSafeInteger(s.until) && s.until > s.at && s.until - s.at <= NOTICE_LONGEST_MS;
}
/* What a guest relay hands to whoever asks where someone is: the person's
   word that they are at G until then, and nothing else. */
function routeShape(s, now) {
  const keys = Object.keys(s).sort().join(',');
  return keys === 'fp,guest,type,until,v' && s.v === 1 && HEX64.test(String(s.fp || '')) && HEX64.test(String(s.guest || ''))
    && Number.isSafeInteger(s.until) && s.until - now <= NOTICE_LONGEST_MS;
}
function moveShape(s) {
  return s.v === 1 && HEX64.test(String(s.fp || '')) && HEX64.test(String(s.from || '')) && HEX64.test(String(s.to || ''))
    && s.from !== s.to && Number.isSafeInteger(s.at);
}

/* RSASSA-PKCS1-v1_5 with SHA-256 over the canonical JSON, the scheme the app
   already signs its offline envelopes with (js/chat/28-offline-envelopes.js). */
function verifyIdentityStatement(signed, { type, now = Date.now() } = {}) {
  const statement = signed?.statement;
  const sig = signed?.sig;
  const publicKeyData = signed?.publicKeyData;
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)) return { ok: false, reason: 'malformed' };
  if (typeof sig !== 'string' || !sig || sig.length > 1100 || typeof publicKeyData !== 'string' || !publicKeyData || publicKeyData.length > 4096) {
    return { ok: false, reason: 'malformed' };
  }
  if (statement.type !== type) return { ok: false, reason: 'wrong-type' };
  const shaped = type === 'guest-at' ? noticeShape(statement) : type === 'home-move' ? moveShape(statement) : type === 'guest-route' ? routeShape(statement, now) : false;
  if (!shaped) return { ok: false, reason: 'malformed' };
  let keyBytes;
  try { keyBytes = Buffer.from(publicKeyData, 'base64'); } catch (_error) { return { ok: false, reason: 'malformed' }; }
  if (crypto.createHash('sha256').update(keyBytes).digest('hex') !== statement.fp) return { ok: false, reason: 'key-not-fp' };
  try {
    const key = crypto.createPublicKey({ key: keyBytes, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'rsa') return { ok: false, reason: 'bad-signature' };
    if (!crypto.verify('sha256', Buffer.from(statementText(statement), 'utf8'), key, Buffer.from(sig, 'base64'))) return { ok: false, reason: 'bad-signature' };
  } catch (_error) {
    return { ok: false, reason: 'bad-signature' };
  }
  if ((type === 'guest-at' || type === 'guest-route') && statement.until <= now) return { ok: false, reason: 'expired' };
  if (type === 'home-move' && (now - statement.at > MOVE_FRESH_MS || statement.at - now > CLOCK_SKEW_MS)) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/* ---- roster copies, blinded ------------------------------------------------ */

const rosterCopyIndex = (fp) => crypto.createHash('sha256').update(`poorija-roster-copy|${fp}`, 'utf8').digest('hex');
const rosterCopyKey = (fp) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(fp), 'utf8'), Buffer.alloc(0), 'poorija-roster-copy', 32));

/* The sequence number stays outside, so a relay keeps only the newest copy
   without being able to read any of them; it is bound in as associated data,
   so it cannot be changed either. The identity key travels inside: a relay
   that opens a copy checks the roster's certificate with it, and it must hash
   to the fingerprint the copy was opened with. */
function sealRosterCopy(fp, roster, publicKeyData) {
  const i = rosterCopyIndex(fp);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', rosterCopyKey(fp), iv);
  cipher.setAAD(Buffer.from(`${i}|${roster.seq}`, 'utf8'));
  const ct = Buffer.concat([cipher.update(JSON.stringify({ roster, publicKeyData }), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, i, seq: roster.seq, iv: iv.toString('base64'), ct: ct.toString('base64') };
}

function rosterCopyShape(copy) {
  return Boolean(copy && typeof copy === 'object' && HEX64.test(String(copy.i || '')) && Number.isSafeInteger(copy.seq) && copy.seq >= 1
    && typeof copy.iv === 'string' && copy.iv.length <= 24 && typeof copy.ct === 'string' && copy.ct.length > 0 && copy.ct.length <= 64 * 1024);
}

/* { roster, publicKeyData }, or null for anything that does not hold. */
function openRosterCopy(fp, copy) {
  try {
    if (!rosterCopyShape(copy) || copy.i !== rosterCopyIndex(fp)) return null;
    const iv = Buffer.from(copy.iv, 'base64');
    const body = Buffer.from(copy.ct, 'base64');
    if (iv.length !== 12 || body.length < 17) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', rosterCopyKey(fp), iv);
    decipher.setAAD(Buffer.from(`${copy.i}|${copy.seq}`, 'utf8'));
    decipher.setAuthTag(body.subarray(body.length - 16));
    const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
    const { roster, publicKeyData } = JSON.parse(plain) || {};
    if (!roster || roster.fp !== fp || roster.seq !== copy.seq || typeof publicKeyData !== 'string') return null;
    if (crypto.createHash('sha256').update(Buffer.from(publicKeyData, 'base64')).digest('hex') !== fp) return null;
    return { roster, publicKeyData };
  } catch (_error) {
    return null;
  }
}

/* Copies as they arrive, one slot per relay that sent them: a copy cannot be
   read where it is kept, so nothing about it can be checked but its shape —
   and a relay that sends a copy with an enormous sequence number and nothing
   inside must not be able to push out another relay's real one. Each relay
   replaces only its own copy, only with a newer one. */
function createRosterCopyStore({ dir, ttlMs = 90 * DAY, now = Date.now } = {}) {
  const live = (copy) => copy && Number(copy.receivedAt) + ttlMs > now();
  const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; } };
  return {
    keep(copy, from) {
      if (!rosterCopyShape(copy) || !HEX64.test(String(from || ''))) return false;
      const file = path.join(dir, copy.i, `${from}.json`);
      const held = read(file);
      if (live(held) && Number(held.seq) >= copy.seq) return false;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(temp, JSON.stringify({ v: 1, i: copy.i, seq: copy.seq, iv: copy.iv, ct: copy.ct, receivedAt: now() }), { mode: 0o600 });
        fs.renameSync(temp, file);
        return true;
      } catch (_error) { return false; }
    },
    /* Every live copy of one account, newest first. */
    copies(index) {
      if (!HEX64.test(String(index || ''))) return [];
      let names = [];
      try { names = fs.readdirSync(path.join(dir, index)); } catch (_error) { return []; }
      const out = [];
      for (const name of names) {
        const match = /^([a-f0-9]{64})\.json$/.exec(name);
        if (!match) continue;
        const copy = read(path.join(dir, index, name));
        if (live(copy) && rosterCopyShape(copy)) out.push({ copy, from: match[1] });
      }
      return out.sort((a, b) => b.copy.seq - a.copy.seq);
    },
    sweep() {
      let indexes = [];
      try { indexes = fs.readdirSync(dir); } catch (_error) { return; }
      for (const index of indexes) {
        const folder = path.join(dir, index);
        let names = [];
        try { names = fs.readdirSync(folder); } catch (_error) { continue; }
        for (const name of names) if (!live(read(path.join(folder, name)))) fs.rmSync(path.join(folder, name), { force: true });
        try { if (!fs.readdirSync(folder).length) fs.rmdirSync(folder); } catch (_error) { /* in use */ }
      }
    },
  };
}

/* ---- the guest book -------------------------------------------------------- */

/* Four small maps in one file:
     guests   (fp, device) → home, since, last seen — who is a guest here;
     forward  fp → relay, until — where mail for someone who left goes;
     remote   (fp, device) → guest relay, until — on a home relay: one of its
              people is a guest elsewhere, on their own signed word;
     moved    fp → relay, until — on a home relay: they moved home there. */
function createGuestBook({ file, now = Date.now, ttlMs = DAY, forwardMs = 7 * DAY, saveDelayMs = 0 } = {}) {
  let data = { guests: {}, forward: {}, remote: {}, moved: {}, floors: {}, moveAt: {}, pending: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const name of Object.keys(data)) if (raw && raw[name] && typeof raw[name] === 'object' && !Array.isArray(raw[name])) data[name] = raw[name];
  } catch (_error) { /* none yet, or unreadable: an empty book */ }

  const pair = (fp, deviceId) => `${fp}|${deviceId}`;
  const liveGuest = (entry) => entry && entry.seen + ttlMs > now();
  const live = (entry) => entry && entry.until > now();
  /* Each account's guest records, so a question about one account never walks
     the whole book — it is asked for every message a relay delivers. */
  const byFp = new Map();
  const indexGuest = (key, fp) => { const keys = byFp.get(fp) || new Set(); keys.add(key); byFp.set(fp, keys); };
  const unindexGuest = (key, fp) => { const keys = byFp.get(fp); if (!keys) return; keys.delete(key); if (!keys.size) byFp.delete(fp); };
  const dropGuest = (key) => { const entry = data.guests[key]; if (!entry) return; delete data.guests[key]; unindexGuest(key, entry.fp); };
  for (const [key, entry] of Object.entries(data.guests)) if (entry?.fp) indexGuest(key, entry.fp);
  const cap = (map) => {
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length - BOOK_CAP; i += 1) {
      if (map === data.guests) dropGuest(keys[i]); else delete map[keys[i]];
    }
  };

  /* With a delay, a burst of admissions is one write. */
  let saveTimer = null;
  function persist() {
    if (!saveDelayMs) { save(); return; }
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; save(); }, saveDelayMs);
    saveTimer.unref?.();
  }
  function save() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(temp, file);
    } catch (_error) { /* a full disk loses the book, not the relay */ }
  }

  const guestsOf = (fp) => Array.from(byFp.get(fp) || [], (key) => data.guests[key]).filter(liveGuest);

  const book = {
    admit({ fp, deviceId, home }) {
      const key = pair(fp, deviceId);
      const since = data.guests[key]?.since || now();
      data.guests[key] = { fp, deviceId, home, since, seen: now() };
      indexGuest(key, fp);
      const mine = Array.from(byFp.get(fp) || [], (k) => [k, data.guests[k]]).sort((a, b) => a[1].seen - b[1].seen);
      for (let i = 0; i < mine.length - DEVICES_PER_ACCOUNT; i += 1) dropGuest(mine[i][0]);
      /* Back as a guest: nothing is forwarded away from here meanwhile. */
      delete data.forward[fp];
      cap(data.guests);
      persist();
      return { ...data.guests[key], until: now() + ttlMs };
    },
    end(fp, deviceId) {
      const key = pair(fp, deviceId);
      const home = data.guests[key]?.home || book.homeOf(fp);
      dropGuest(key);
      const last = guestsOf(fp).length === 0;
      if (last && home) data.forward[fp] = { relay: home, until: now() + forwardMs };
      persist();
      return { last, home: home || '' };
    },
    isGuest: (fp) => guestsOf(fp).length > 0,
    homeOf: (fp) => guestsOf(fp)[0]?.home || '',
    devices: (fp) => guestsOf(fp).map((entry) => entry.deviceId),
    liveGuests: () => Object.values(data.guests).filter(liveGuest).map(({ fp, deviceId, home }) => ({ fp, deviceId, home })),
    forwarding(fp) {
      const entry = data.forward[fp];
      return live(entry) ? { relay: entry.relay, until: entry.until } : null;
    },
    forwardingAll: () => Object.entries(data.forward).filter(([, entry]) => live(entry)).map(([fp, entry]) => ({ fp, relay: entry.relay, until: entry.until })),
    setForward(fp, relay, ms) { data.forward[fp] = { relay, until: now() + ms }; cap(data.forward); persist(); },
    clearForward(fp) { if (data.forward[fp]) { delete data.forward[fp]; persist(); } },
    noteRemote({ fp, deviceId, guest, until }) { data.remote[pair(fp, deviceId)] = { fp, deviceId, guest, until }; cap(data.remote); persist(); },
    remoteFor: (fp) => Object.values(data.remote).filter((entry) => entry.fp === fp && live(entry)).map(({ deviceId, guest, until }) => ({ deviceId, guest, until })),
    dropRemote(fp, deviceId) {
      let changed = false;
      for (const [key, entry] of Object.entries(data.remote)) {
        if (entry.fp === fp && (!deviceId || entry.deviceId === deviceId)) { delete data.remote[key]; changed = true; }
      }
      if (changed) persist();
      return changed;
    },
    /* The newest moment a device's guest notices stopped counting (its stay
       ended, or it proved itself at home): a notice signed before it is a
       replay. Kept for as long as a notice could live. */
    noteFloor(fp, deviceId, at) { data.floors[pair(fp, deviceId)] = { at, until: at + 2 * DAY }; cap(data.floors); persist(); },
    floorOf: (fp, deviceId) => (live(data.floors[pair(fp, deviceId)]) ? data.floors[pair(fp, deviceId)].at : 0),
    noteMoved(fp, to, ms, signed = null) { data.moved[fp] = { to, until: now() + ms, signed }; cap(data.moved); persist(); },
    movedTo: (fp) => (live(data.moved[fp]) ? data.moved[fp].to : ''),
    movedStatement: (fp) => (live(data.moved[fp]) ? data.moved[fp].signed || null : null),
    /* The newest move statement taken for an account: anything signed at or
       before it is a replay. Kept as long as a move statement counts. */
    noteMoveAt(fp, at) { data.moveAt[fp] = { at, until: at + 8 * DAY }; cap(data.moveAt); persist(); },
    moveAtOf: (fp) => (live(data.moveAt[fp]) ? data.moveAt[fp].at : 0),
    /* A move taken here, not yet handed to the old home (its link was down). */
    notePendingMove(fp, home, signed, ms) { data.pending[fp] = { home, signed, until: now() + ms }; cap(data.pending); persist(); },
    pendingMoves: () => Object.entries(data.pending).filter(([, entry]) => live(entry)).map(([fp, entry]) => ({ fp, home: entry.home, signed: entry.signed })),
    clearPendingMove(fp) { if (data.pending[fp]) { delete data.pending[fp]; persist(); } },
    /* Moved here: no longer a guest of anybody, and nothing to send home. */
    dropGuests(fp) {
      for (const key of Array.from(byFp.get(fp) || [])) dropGuest(key);
      delete data.forward[fp];
      persist();
    },
    /* Room for a newcomer in a full book: guests with no socket here that
       were last seen longer ago than `olderThanMs` go, oldest first, at most
       `max` — each as an ended stay, so what waits for them goes home. */
    evictStale({ olderThanMs, connected = () => false, max = 1 }) {
      const idle = Object.entries(data.guests)
        .filter(([, entry]) => liveGuest(entry) && now() - entry.seen > olderThanMs && !connected(entry.fp, entry.deviceId))
        .sort((a, b) => a[1].seen - b[1].seen)
        .slice(0, Math.max(0, max));
      const ended = [];
      for (const [key, entry] of idle) {
        dropGuest(key);
        if (guestsOf(entry.fp).length) continue;
        if (entry.home) data.forward[entry.fp] = { relay: entry.home, until: now() + forwardMs };
        ended.push({ fp: entry.fp, home: entry.home });
      }
      if (idle.length) persist();
      return ended;
    },
    /* Guests not seen within the record's time are ended, and what is left
       for them follows them home; everything past its time goes. */
    sweep() {
      const ended = [];
      const touched = new Map();
      let changed = false;
      for (const [key, entry] of Object.entries(data.guests)) {
        if (liveGuest(entry)) continue;
        dropGuest(key);
        touched.set(entry.fp, entry.home);
        changed = true;
      }
      for (const [fp, home] of touched) {
        if (guestsOf(fp).length) continue;
        if (home) data.forward[fp] = { relay: home, until: now() + forwardMs };
        ended.push({ fp, home });
      }
      for (const name of ['forward', 'remote', 'moved', 'floors', 'moveAt', 'pending']) {
        for (const [key, entry] of Object.entries(data[name])) {
          if (!live(entry)) { delete data[name][key]; changed = true; }
        }
      }
      if (changed) persist();
      return { ended };
    },
    /* Counts for the dashboard. */
    stats() {
      const count = (map, test) => Object.values(map).filter(test).length;
      return {
        guests: count(data.guests, liveGuest), forwarding: count(data.forward, live), remote: count(data.remote, live),
        moved: count(data.moved, live), pendingMoves: count(data.pending, live),
      };
    },
    save,
  };
  return book;
}

/* ---- who may be taken in ---------------------------------------------------- */

/* In this order: this relay's own switch, the home's membership, room, the
   device itself. */
function guestRefusal({ directory, selfId, guestOf, guestSockets = 0, wsMax = 0, share = 0.3, deviceRevoked = false, bookEntries = 0, known = false, newcomerLimited = false } = {}) {
  const relays = Array.isArray(directory?.relays) ? directory.relays : [];
  const self = relays.find((relay) => relay?.id === selfId);
  if (!self || self.guests !== true) return 'off';
  const home = String(guestOf || '');
  const revoked = new Set(Array.isArray(directory?.revoked) ? directory.revoked : []);
  if (!HEX64.test(home) || home === selfId || revoked.has(home) || !relays.some((relay) => relay?.id === home)) return 'not-family';
  const room = Math.floor(Number(wsMax) * Number(share));
  if (guestSockets >= room) return 'full';
  if (!known && (newcomerLimited || bookEntries >= room * BOOK_ROOM_FACTOR)) return 'full';
  if (deviceRevoked) return 'revoked';
  return '';
}

module.exports = {
  statementText,
  verifyIdentityStatement,
  rosterCopyIndex,
  sealRosterCopy,
  openRosterCopy,
  createRosterCopyStore,
  createGuestBook,
  guestRefusal,
  bookRoomFor,
};
