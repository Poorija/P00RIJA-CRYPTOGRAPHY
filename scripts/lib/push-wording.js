/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

'use strict';
/* What a background notification is allowed to say.
 *
 * The relay cannot see inside a sealed envelope, so everything here is decided
 * from three hints the sender puts on the outside on purpose: whether a group
 * is involved, which call verb it is, and voice or video. None of them names a
 * person, a group, or anything that was said - and without them a group call
 * to a sleeping phone rings as "chat update", which tells the user less while
 * hiding nothing extra.
 *
 * Kept apart from the server so it can be read and tested on its own: the
 * push body itself is encrypted to the subscription's keys, so it cannot be
 * observed from outside once it has been sent. */

/* The kind string the relay derives from an envelope. Shape: verb[:group][:mode] */
function pushKindFor(payloadType, payload = {}) {
  const mode = payload.mode === 'video' ? 'video' : (payload.mode === 'voice' ? 'voice' : '');
  const scope = payload.scope === 'group' ? 'group' : '';
  const signal = typeof payload.signal === 'string' ? payload.signal : '';
  const base = payloadType === 'offline-chat' ? (signal || 'chat') : payloadType;
  return [base, scope, mode].filter(Boolean).join(':');
}

/* The language the device asked for, or English.
 *
 * Every other string a person reads in this product exists in both languages;
 * the one that arrives on a locked phone at two in the morning did not. The
 * relay cannot infer it — it knows nothing about the reader — so the device
 * says which it wants when it subscribes, the choice rides on the subscription
 * row, and the body is built per row rather than once for everybody. */
function normalizePushLang(value) {
  return String(value || '').toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

function pushBodyFor(kind, lang = 'en') {
  const parts = String(kind || '').split(':');
  const base = parts[0];
  const mode = parts.includes('video') ? 'video' : (parts.includes('voice') ? 'voice' : '');
  const group = parts.includes('group');
  if (normalizePushLang(lang) === 'fa') {
    const modeWordFa = mode === 'video' ? 'تصویری' : 'صوتی';
    const callFa = mode
      ? (group ? `تماس گروهی ${modeWordFa}` : `تماس ${modeWordFa}`)
      : (group ? 'تماس گروهی' : 'تماس');
    if (base === 'call-invite' || base === 'gcall-invite') return `${callFa} رمزنگاری‌شدهٔ ورودی.`;
    if (base === 'call-missed' || base === 'call-cancel') return `${callFa} رمزنگاری‌شدهٔ از دست رفته.`;
    return group ? 'پیام تازه در یک گروه رمزنگاری‌شده.' : 'پیام رمزنگاری‌شدهٔ تازه رسید.';
  }
  const modeWord = mode === 'video' ? 'video' : 'voice';
  const callWord = group ? `group ${modeWord}` : modeWord;
  const plainCall = group ? 'group call' : 'call';
  if (base === 'call-invite' || base === 'gcall-invite') {
    return mode ? `Incoming encrypted ${callWord} call.` : `Incoming encrypted ${plainCall}.`;
  }
  if (base === 'call-missed' || base === 'call-cancel') {
    return mode ? `Missed encrypted ${callWord} call.` : `Missed encrypted ${plainCall}.`;
  }
  return group ? 'New message in an encrypted group.' : 'Encrypted chat update received.';
}

/* Calls and messages stack separately, so a missed call is not swallowed by a
   message arriving beside it. */
function pushTagFor(kind) {
  const base = String(kind || '').split(':')[0];
  return base.startsWith('call') || base.startsWith('gcall') ? 'poorija-call' : 'poorija-chat';
}

/* How hard the vendor should try, and for how long.
 *
 * web-push sends an Urgency header on every request whether or not it is given
 * one, and its default is `normal` — so until this existed, every notification
 * this relay sent carried an explicit "this can wait". FCM maps `normal` to a
 * normal-priority message, which Android holds through Doze until the next
 * maintenance window; APNs maps it to priority 5, which it is free to delay to
 * conserve power. The symptom is a phone that stays silent all evening and
 * then lights up with the whole conversation the moment it is picked up: the
 * message had arrived, the ticks were right, and nobody was ever told.
 *
 * RFC 8030 reserves `high` for "incoming phone call or time-sensitive alert"
 * and files chat under `normal`. That table was written before Doze, and for a
 * messenger the notification IS the delivery — a message the reader is not
 * told about has not really been delivered. So conversation and calls both go
 * out as `high`, which costs battery and is the point.
 *
 * An administrative notice is a different thing: worth reading, not worth
 * waking a sleeping phone at three in the morning. It keeps `normal`.
 *
 * TTL is the other half. The library defaults to four weeks, so a phone that
 * was off over a holiday came back to a fortnight of stale banners, and a
 * missed-call notice could ring long after anybody could answer it. */
const PUSH_TTL_SECONDS = {
  call: 180,
  chat: 24 * 60 * 60,
  admin: 24 * 60 * 60,
};

function pushSendOptions(kind) {
  const base = String(kind || '').split(':')[0];
  if (base.startsWith('call') || base.startsWith('gcall')) {
    return { urgency: 'high', TTL: PUSH_TTL_SECONDS.call };
  }
  if (base.startsWith('admin')) {
    return { urgency: 'normal', TTL: PUSH_TTL_SECONDS.admin };
  }
  return { urgency: 'high', TTL: PUSH_TTL_SECONDS.chat };
}

module.exports = { pushKindFor, pushBodyFor, pushTagFor, normalizePushLang, pushSendOptions };
