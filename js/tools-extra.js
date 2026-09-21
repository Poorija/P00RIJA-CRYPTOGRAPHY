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
   tools-extra.js — four more tools, chosen for the situation this app is for.
   ============================================================================

   The brief was "add some useful tools". Anything can be useful; these four
   were picked because each answers a problem this particular application's
   users actually have, and each is built out of libraries already vendored so
   nothing new arrives over the network.

     QR BRIDGE        Moves a payload between two devices with no network at
                      all — no relay, no Wi-Fi, no Bluetooth. One screen shows
                      a sequence of QR codes, the other reads them with its
                      camera. When the international link is cut and the phone
                      in the room is the only other computer you have, this is
                      the transport. Uses the vendored qrcodejs and jsQR.

     AUTHENTICATOR    TOTP codes, generated on the device, stored in the vault.
                      The point is not convenience: an authenticator app from a
                      store is one more thing that phones home and one more
                      place your second factor lives. otpauth is already here.

     INSPECTOR        Finds characters you cannot see. Zero-width spaces and
                      bidirectional overrides can be sprinkled through a
                      paragraph to make each copy unique, so a leaked document
                      identifies whoever it was given to. This shows them,
                      counts them, and strips them. It also flags Cyrillic and
                      Greek letters wearing Latin shapes, which is how a URL
                      pretends to be a different URL.

     CONVERT          Base64, hex, URL, UTF-8 bytes, binary — both directions,
                      with the byte count. Small, and used constantly the
                      moment anyone works with ciphertext by hand.

   Everything runs locally. Nothing here contacts anything.
   ============================================================================ */

(function (global) {
  'use strict';

  const app = () => global.PoorijaApp;
  const t = (fa, en) => (app()?.state?.language === 'fa' ? fa : en);
  const notify = (fa, en, kind = 'info') => app()?.showNotification?.(t(fa, en), kind);
  const el = (id) => document.getElementById(id);
  const esc = (v) => app()?.escapeHTML?.(String(v ?? '')) ?? String(v ?? '');

  /* ======================================================================
     QR BRIDGE
     ======================================================================

     A QR code holds around 2 900 bytes at the lowest error correction, and
     less once the payload is base64. Anything real therefore has to be split,
     and the reader has to be able to tell which piece it just saw and which
     are still missing — a stack of codes with no sequence numbers is not
     recoverable if one is skipped.

     So each frame carries a tiny header:

         P0Q1|<transferId>|<index>/<total>|<payload>

     The transfer id keeps two different transfers from being mixed together
     when someone points the camera at the wrong screen. Frames may arrive in
     any order and more than once; the reader keeps a set and says what is
     still outstanding.
     ====================================================================== */

  const QR_PREFIX = 'P0Q1';
  /* BYTES per frame, not characters.
   *
   * A QR code's capacity is counted in bytes. This counted characters, which
   * is the same number in English and half the number in Persian, so a frame
   * of 700 Persian letters was a 1400-byte payload and the encoder threw
   * "code length overflow". The tool simply did not work for anyone typing
   * Persian into it.
   *
   * (The other half of that bug was in the encoder itself and is fixed in
   * vendor/qrcodejs/qrcode.min.js — see the note at the top of that file.
   * Until it was, no budget here could have been right: the encoder wrote
   * more bytes than the version-picker had reserved, by an amount that
   * depended on where the spaces fell. That is why an earlier attempt to
   * binary-search a safe limit produced nonsense, with 891 passing and 500
   * failing.)
   *
   * 500 is not the ceiling. Level L holds 2 953 bytes at version 40, and the
   * encoder does now reach it. But version 40 is 177 modules across, and a
   * phone reading a screen at an angle cannot resolve them. 500 bytes lands
   * around version 15 — 77 modules — which stays legible on a laptop screen
   * filmed from across a desk. There is no prize for using fewer frames. */
  const QR_CHUNK_BYTES = 500;

  const qrState = {
    frames: [],
    index: 0,
    timer: null,
    received: new Map(),
    expected: 0,
    transferId: '',
    scanner: null,
    stream: null
  };

  /* `chunkBytes` overrides the default for a caller that has measured its own
     payload. The QR bridge keeps the default because it is read across a room;
     the Local Link handshake passes a larger figure because it is read at
     arm's length, where one code that stands still beats two that take turns.

     Two things this has to get right that the character-counting version did
     not:

     WHOLE CODE POINTS. A slice ending between the two halves of a surrogate
     pair decodes to a replacement character on the far side, so an emoji in
     the middle of a message quietly becomes garbage. Iterating the string with
     for..of walks code points rather than UTF-16 units, so a pair is never cut.

     THE HEADER COUNTS. The frame that gets encoded is the slice PLUS
     "P0Q1|<id>|<n>/<total>|", so a budget spent entirely on the slice is
     overspent by the length of that header. It is reserved up front, sized for
     a four-digit frame count so the reservation cannot be outgrown. */
  function qrSplit(text, transferId, chunkBytes = QR_CHUNK_BYTES) {
    const payload = String(text ?? '');
    const header = (index, total) => `${QR_PREFIX}|${transferId}|${index}/${total}|`;
    /* The header is ASCII, so its character count is its byte count. */
    const reserved = header(9999, 9999).length;
    const limit = Math.max(64, (Number(chunkBytes) || QR_CHUNK_BYTES) - reserved);
    const encoder = new TextEncoder();
    const pieces = [];
    let current = '';
    let currentBytes = 0;
    for (const glyph of payload) {
      const size = encoder.encode(glyph).length;
      if (currentBytes + size > limit && current) {
        pieces.push(current);
        current = '';
        currentBytes = 0;
      }
      current += glyph;
      currentBytes += size;
    }
    if (current || !pieces.length) pieces.push(current);
    const total = pieces.length;
    return pieces.map((slice, i) => `${header(i + 1, total)}${slice}`);
  }

  function qrParse(raw) {
    const text = String(raw || '');
    if (!text.startsWith(QR_PREFIX + '|')) return null;
    /* Only the first three separators are structural; the payload may contain
       any character at all, including a pipe. */
    const first = text.indexOf('|');
    const second = text.indexOf('|', first + 1);
    const third = text.indexOf('|', second + 1);
    if (second < 0 || third < 0) return null;
    const transferId = text.slice(first + 1, second);
    const counter = text.slice(second + 1, third);
    const [indexPart, totalPart] = counter.split('/');
    const index = Number(indexPart);
    const total = Number(totalPart);
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) return null;
    return { transferId, index, total, payload: text.slice(third + 1) };
  }

  function qrRenderFrame() {
    const box = el('qrBridgeCanvas');
    if (!box || !qrState.frames.length) return;
    box.innerHTML = '';
    if (typeof global.QRCode === 'undefined') {
      box.innerHTML = `<p class="text-sm text-red-500">${esc(t('کتابخانهٔ QR بارگذاری نشد.', 'The QR library did not load.'))}</p>`;
      return;
    }
    /* Level L: the payload is already error-checked end to end by whoever
       decrypts it, and lower correction means fewer, less dense codes. */
    new global.QRCode(box, {
      text: qrState.frames[qrState.index],
      width: 288,
      height: 288,
      correctLevel: global.QRCode.CorrectLevel.L
    });
    const label = el('qrBridgeCounter');
    if (label) {
      label.textContent = t(
        `قاب ${qrState.index + 1} از ${qrState.frames.length}`,
        `Frame ${qrState.index + 1} of ${qrState.frames.length}`);
    }
  }

  function qrStop() {
    if (qrState.timer) { clearInterval(qrState.timer); qrState.timer = null; }
    const btn = el('qrBridgePlayBtn');
    if (btn) btn.innerHTML = `<i class="fas fa-play ml-1"></i> ${esc(t('پخش خودکار', 'Auto-play'))}`;
  }

  function qrBuild() {
    const source = el('qrBridgeInput')?.value || '';
    if (!source.trim()) {
      notify('چیزی برای تبدیل نیست.', 'There is nothing to encode.', 'warning');
      return;
    }
    qrState.transferId = Math.random().toString(36).slice(2, 8);
    qrState.frames = qrSplit(source, qrState.transferId);
    qrState.index = 0;
    qrRenderFrame();
    el('qrBridgeStage')?.classList.remove('hidden');
    notify(
      `${qrState.frames.length} قاب ساخته شد. دوربین دستگاه دیگر را روبه‌روی صفحه بگیرید.`,
      `${qrState.frames.length} frames ready. Point the other device's camera at this screen.`,
      'success');
  }

  function qrStep(delta) {
    if (!qrState.frames.length) return;
    qrState.index = (qrState.index + delta + qrState.frames.length) % qrState.frames.length;
    qrRenderFrame();
  }

  function qrTogglePlay() {
    if (qrState.timer) { qrStop(); return; }
    if (!qrState.frames.length) return;
    const btn = el('qrBridgePlayBtn');
    if (btn) btn.innerHTML = `<i class="fas fa-pause ml-1"></i> ${esc(t('توقف', 'Pause'))}`;
    /* Slow enough that a camera has time to lock focus and decode. Faster
       looks better and reads worse. */
    qrState.timer = setInterval(() => qrStep(1), 1400);
  }

  function qrResetReceive() {
    qrState.received = new Map();
    qrState.expected = 0;
    qrUpdateProgress();
    const out = el('qrBridgeOutput');
    if (out) out.value = '';
  }

  function qrUpdateProgress() {
    const label = el('qrBridgeProgress');
    if (!label) return;
    if (!qrState.expected) {
      label.textContent = t('هنوز قابی خوانده نشده.', 'No frames read yet.');
      return;
    }
    const missing = [];
    for (let i = 1; i <= qrState.expected; i++) if (!qrState.received.has(i)) missing.push(i);
    label.textContent = missing.length
      ? t(`${qrState.received.size} از ${qrState.expected} — مانده: ${missing.join('، ')}`,
          `${qrState.received.size} of ${qrState.expected} — still missing: ${missing.join(', ')}`)
      : t(`هر ${qrState.expected} قاب خوانده شد.`, `All ${qrState.expected} frames read.`);
  }

  function qrAcceptFrame(raw) {
    const frame = qrParse(raw);
    if (!frame) return false;
    /* A different transfer means the camera moved to another screen; start
       again rather than interleaving two payloads into nonsense. */
    if (qrState.expected && frame.transferId !== qrState.transferId) {
      qrResetReceive();
    }
    qrState.transferId = frame.transferId;
    qrState.expected = frame.total;
    if (!qrState.received.has(frame.index)) {
      qrState.received.set(frame.index, frame.payload);
    }
    qrUpdateProgress();
    if (qrState.received.size === frame.total) {
      const joined = Array.from({ length: frame.total }, (_, i) => qrState.received.get(i + 1)).join('');
      const out = el('qrBridgeOutput');
      if (out) out.value = joined;
      notify('همهٔ قاب‌ها خوانده شد.', 'Every frame was read.', 'success');
      qrStopScanner();
    }
    return true;
  }

  async function qrStartScanner() {
    if (qrState.scanner) return;
    const video = el('qrBridgeVideo');
    const canvas = el('qrBridgeScanCanvas');
    if (!video || !canvas) return;
    if (typeof global.jsQR !== 'function') {
      notify('کتابخانهٔ خواندن QR بارگذاری نشد.', 'The QR reader did not load.', 'error');
      return;
    }
    try {
      qrState.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false
      });
    } catch (error) {
      /* Named, not guessed: "no camera on this machine" and "another app has
         it" are different problems with different answers. */
      const said = global.describeMediaError?.(error, 'video');
      if (said) app()?.showNotification?.(said, 'error');
      else notify('دسترسی به دوربین داده نشد.', 'Camera access was refused.', 'error');
      return;
    }
    video.srcObject = qrState.stream;
    video.setAttribute('playsinline', 'true');
    await video.play().catch(() => {});
    el('qrBridgeScanStage')?.classList.remove('hidden');

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    qrState.scanner = setInterval(() => {
      if (!video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = global.jsQR(image.data, image.width, image.height);
      if (found?.data) qrAcceptFrame(found.data);
    }, 220);
  }

  function qrStopScanner() {
    if (qrState.scanner) { clearInterval(qrState.scanner); qrState.scanner = null; }
    if (qrState.stream) {
      qrState.stream.getTracks().forEach((track) => track.stop());
      qrState.stream = null;
    }
    const video = el('qrBridgeVideo');
    if (video) video.srcObject = null;
    el('qrBridgeScanStage')?.classList.add('hidden');
  }

  /* ======================================================================
     AUTHENTICATOR — TOTP, on this device only
     ====================================================================== */

  const AUTH_STORAGE_KEY = 'poorija_totp_accounts';
  let authTimer = null;

  function authLoad() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return [];
      const parsed = app()?.decryptStorageData?.(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) { return []; }
  }

  function authSave(list) {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, app().encryptStorageData(list));
    } catch (error) {
      console.error('[TOTP] could not save:', error);
      notify('ذخیره نشد — انبار باز نیست.', 'Not saved — the vault is not open.', 'error');
    }
  }

  function authBuild(account) {
    const OTP = global.OTPAuth;
    if (!OTP) return null;
    try {
      return new OTP.TOTP({
        issuer: account.issuer || 'P00RIJA',
        label: account.label || 'account',
        algorithm: account.algorithm || 'SHA1',
        digits: Number(account.digits) || 6,
        period: Number(account.period) || 30,
        secret: OTP.Secret.fromBase32(String(account.secret || '').replace(/\s+/g, '').toUpperCase())
      });
    } catch (error) { return null; }
  }

  function authRender() {
    const list = el('authAccountList');
    if (!list) return;
    const accounts = authLoad();
    if (!accounts.length) {
      list.innerHTML = `<p class="text-sm opacity-60 text-center py-6">${
        esc(t('هنوز حسابی اضافه نشده.', 'No accounts yet.'))}</p>`;
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    list.innerHTML = accounts.map((account, index) => {
      const totp = authBuild(account);
      const code = totp ? totp.generate() : '——————';
      const period = Number(account.period) || 30;
      const left = period - (now % period);
      const pretty = code.replace(/(\d{3})(?=\d)/, '$1 ');
      return `
      <div class="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/60 dark:bg-slate-800/60 border border-gray-200 dark:border-gray-700">
        <div class="min-w-0">
          <div class="font-semibold truncate">${esc(account.issuer || account.label || '—')}</div>
          <div class="text-xs opacity-60 truncate">${esc(account.label || '')}</div>
        </div>
        <div class="text-left">
          <div class="font-mono text-xl tracking-widest ${left <= 5 ? 'text-red-500' : ''}" dir="ltr">${esc(pretty)}</div>
          <div class="text-[11px] opacity-60">${esc(t(`${left} ثانیه`, `${left}s`))}</div>
        </div>
        <button type="button" data-totp-copy="${index}" class="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs" title="${esc(t('کپی', 'Copy'))}"><i class="fas fa-copy"></i></button>
        <button type="button" data-totp-remove="${index}" class="px-2 py-1 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-600 text-xs" title="${esc(t('حذف', 'Remove'))}"><i class="fas fa-trash"></i></button>
      </div>`;
    }).join('');
  }

  function authAdd() {
    const issuer = el('authIssuer')?.value.trim() || '';
    const label = el('authLabel')?.value.trim() || '';
    const secretRaw = el('authSecret')?.value.trim() || '';
    if (!secretRaw) {
      notify('کلید مشترک را وارد کنید.', 'Enter the shared secret.', 'warning');
      return;
    }
    const account = { issuer, label, secret: secretRaw.replace(/\s+/g, '').toUpperCase(), digits: 6, period: 30, algorithm: 'SHA1' };
    if (!authBuild(account)) {
      notify('این کلید base32 معتبر نیست.', 'That is not a valid base32 secret.', 'error');
      return;
    }
    const list = authLoad();
    list.push(account);
    authSave(list);
    ['authIssuer', 'authLabel', 'authSecret'].forEach((id) => { const f = el(id); if (f) f.value = ''; });
    authRender();
    notify('حساب اضافه شد.', 'Account added.', 'success');
  }

  /* otpauth:// URIs are what every other authenticator exports, so pasting one
     should work rather than making the user pick it apart by hand. */
  function authImportUri() {
    const uri = el('authUri')?.value.trim() || '';
    if (!uri) return;
    try {
      const parsed = global.OTPAuth.URI.parse(uri);
      const list = authLoad();
      list.push({
        issuer: parsed.issuer || '',
        label: parsed.label || '',
        secret: parsed.secret.base32,
        digits: parsed.digits,
        period: parsed.period,
        algorithm: parsed.algorithm
      });
      authSave(list);
      const field = el('authUri');
      if (field) field.value = '';
      authRender();
      notify('از روی لینک otpauth افزوده شد.', 'Imported from the otpauth link.', 'success');
    } catch (error) {
      notify('این لینک otpauth خوانده نشد.', 'That otpauth link could not be read.', 'error');
    }
  }

  /* ======================================================================
     INSPECTOR — the characters you cannot see
     ====================================================================== */

  /* Each of these is invisible, or nearly so, and each has a legitimate use
     somewhere — which is exactly why they make good watermarks. A paragraph
     with a zero-width space after the third word and another after the
     eleventh is a paragraph that identifies its reader. */
  const INVISIBLE = [
    ['​', 'ZERO WIDTH SPACE'],
    ['‌', 'ZERO WIDTH NON-JOINER'],
    ['‍', 'ZERO WIDTH JOINER'],
    ['⁠', 'WORD JOINER'],
    ['﻿', 'ZERO WIDTH NO-BREAK SPACE'],
    ['­', 'SOFT HYPHEN'],
    ['᠎', 'MONGOLIAN VOWEL SEPARATOR'],
    ['⁡', 'FUNCTION APPLICATION'],
    ['⁢', 'INVISIBLE TIMES'],
    ['⁣', 'INVISIBLE SEPARATOR'],
    ['⁤', 'INVISIBLE PLUS']
  ];
  const BIDI = [
    ['‪', 'LEFT-TO-RIGHT EMBEDDING'],
    ['‫', 'RIGHT-TO-LEFT EMBEDDING'],
    ['‬', 'POP DIRECTIONAL FORMATTING'],
    ['‭', 'LEFT-TO-RIGHT OVERRIDE'],
    ['‮', 'RIGHT-TO-LEFT OVERRIDE'],
    ['⁦', 'LEFT-TO-RIGHT ISOLATE'],
    ['⁧', 'RIGHT-TO-LEFT ISOLATE'],
    ['⁨', 'FIRST STRONG ISOLATE'],
    ['⁩', 'POP DIRECTIONAL ISOLATE']
  ];
  /* Letters from other alphabets that look like Latin ones. This is how a
     domain or a filename pretends to be a different domain or filename. */
  const CONFUSABLE = {
    'а': 'a (Cyrillic)', 'е': 'e (Cyrillic)', 'о': 'o (Cyrillic)',
    'р': 'p (Cyrillic)', 'с': 'c (Cyrillic)', 'х': 'x (Cyrillic)',
    'у': 'y (Cyrillic)', 'А': 'A (Cyrillic)', 'В': 'B (Cyrillic)',
    'Е': 'E (Cyrillic)', 'К': 'K (Cyrillic)', 'М': 'M (Cyrillic)',
    'Н': 'H (Cyrillic)', 'О': 'O (Cyrillic)', 'Р': 'P (Cyrillic)',
    'С': 'C (Cyrillic)', 'Т': 'T (Cyrillic)', 'Х': 'X (Cyrillic)',
    'Α': 'A (Greek)', 'Β': 'B (Greek)', 'Ε': 'E (Greek)',
    'Ο': 'O (Greek)', 'Ρ': 'P (Greek)', 'Τ': 'T (Greek)',
    'ο': 'o (Greek)', 'ѕ': 's (Cyrillic)', 'і': 'i (Cyrillic)'
  };

  function inspectText(text) {
    const findings = [];
    const counts = new Map();
    const source = String(text ?? '');
    const named = new Map([...INVISIBLE, ...BIDI]);

    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      const name = named.get(ch);
      if (name) {
        counts.set(name, (counts.get(name) || 0) + 1);
        if (findings.length < 200) findings.push({ at: i, kind: BIDI.some(([c]) => c === ch) ? 'bidi' : 'invisible', name, code: ch.codePointAt(0) });
        continue;
      }
      const looksLike = CONFUSABLE[ch];
      if (looksLike) {
        counts.set(`looks like ${looksLike}`, (counts.get(`looks like ${looksLike}`) || 0) + 1);
        if (findings.length < 200) findings.push({ at: i, kind: 'confusable', name: `looks like ${looksLike}`, code: ch.codePointAt(0) });
      }
    }
    return { findings, counts, length: source.length };
  }

  function stripHidden(text) {
    const drop = new Set([...INVISIBLE, ...BIDI].map(([c]) => c));
    let out = '';
    for (const ch of String(text ?? '')) if (!drop.has(ch)) out += ch;
    return out;
  }

  function inspectorRun() {
    const source = el('inspectorInput')?.value || '';
    const report = inspectText(source);
    const box = el('inspectorReport');
    if (!box) return;

    if (!report.findings.length) {
      box.innerHTML = `<div class="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700">
        <div class="font-semibold">${esc(t('چیز پنهانی پیدا نشد', 'Nothing hidden was found'))}</div>
        <div class="text-sm opacity-90">${esc(t(`${report.length} نویسه بررسی شد.`, `${report.length} characters checked.`))}</div>
      </div>`;
      return;
    }
    const rows = [...report.counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `<tr><td class="py-1 pl-3 font-mono text-xs">${esc(name)}</td><td class="py-1 text-right font-bold">${n}</td></tr>`)
      .join('');
    box.innerHTML = `
      <div class="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 border border-amber-300 dark:border-amber-700 space-y-2">
        <div class="font-semibold">${esc(t(`${report.findings.length} نویسهٔ پنهان یا گمراه‌کننده پیدا شد`, `${report.findings.length} hidden or misleading characters found`))}</div>
        <div class="text-sm opacity-90">${esc(t(
          'نویسه‌های نامرئی می‌توانند هر نسخه از یک متن را یکتا کنند، یعنی نشت آن قابل ردیابی شود. نویسه‌های گمراه‌کننده باعث می‌شوند یک نشانی یا نام فایل، چیز دیگری به‌نظر برسد.',
          'Invisible characters can make each copy of a text unique, so a leak points back to whoever received it. Confusable letters make an address or a filename look like something it is not.'))}</div>
        <table class="w-full text-sm"><tbody>${rows}</tbody></table>
      </div>`;
  }

  function inspectorClean() {
    const field = el('inspectorInput');
    if (!field) return;
    const before = field.value.length;
    field.value = stripHidden(field.value);
    inspectorRun();
    notify(`${before - field.value.length} نویسه حذف شد.`,
      `${before - field.value.length} characters removed.`, 'success');
  }

  /* ======================================================================
     CONVERT
     ====================================================================== */

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const CONVERSIONS = {
    'text-base64': (v) => btoa(String.fromCharCode(...enc.encode(v))),
    'base64-text': (v) => dec.decode(Uint8Array.from(atob(v.replace(/\s+/g, '')), (c) => c.charCodeAt(0))),
    'text-hex': (v) => [...enc.encode(v)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    'hex-text': (v) => {
      const clean = v.replace(/[^0-9a-fA-F]/g, '');
      if (clean.length % 2) throw new Error('odd number of hex digits');
      return dec.decode(Uint8Array.from(clean.match(/../g) || [], (h) => parseInt(h, 16)));
    },
    'text-url': (v) => encodeURIComponent(v),
    'url-text': (v) => decodeURIComponent(v),
    'text-binary': (v) => [...enc.encode(v)].map((b) => b.toString(2).padStart(8, '0')).join(' '),
    'binary-text': (v) => {
      const bits = v.replace(/[^01]/g, '');
      if (!bits.length || bits.length % 8) throw new Error('not a whole number of bytes');
      return dec.decode(Uint8Array.from(bits.match(/.{8}/g), (b) => parseInt(b, 2)));
    },
    'base64-hex': (v) => [...Uint8Array.from(atob(v.replace(/\s+/g, '')), (c) => c.charCodeAt(0))]
      .map((b) => b.toString(16).padStart(2, '0')).join(''),
    'hex-base64': (v) => {
      const clean = v.replace(/[^0-9a-fA-F]/g, '');
      return btoa(String.fromCharCode(...Uint8Array.from(clean.match(/../g) || [], (h) => parseInt(h, 16))));
    }
  };

  function convertRun() {
    const mode = el('convertMode')?.value || 'text-base64';
    const input = el('convertInput')?.value ?? '';
    const output = el('convertOutput');
    const info = el('convertInfo');
    if (!output) return;
    if (!input) { output.value = ''; if (info) info.textContent = ''; return; }
    try {
      output.value = CONVERSIONS[mode](input);
      if (info) {
        const bytes = enc.encode(input).length;
        info.textContent = t(
          `ورودی ${input.length} نویسه / ${bytes} بایت · خروجی ${output.value.length} نویسه`,
          `in ${input.length} chars / ${bytes} bytes · out ${output.value.length} chars`);
      }
    } catch (error) {
      output.value = '';
      if (info) {
        info.textContent = t(`ورودی برای این تبدیل معتبر نیست: ${error.message}`,
          `Not valid input for this conversion: ${error.message}`);
      }
    }
  }

  /* ======================================================================
     wiring
     ====================================================================== */

  function bind(id, event, handler) {
    const node = el(id);
    if (node) node.addEventListener(event, handler);
  }

  function init() {
    bind('qrBridgeBuildBtn', 'click', qrBuild);
    bind('qrBridgePlayBtn', 'click', qrTogglePlay);
    bind('qrBridgeNextBtn', 'click', () => { qrStop(); qrStep(1); });
    bind('qrBridgePrevBtn', 'click', () => { qrStop(); qrStep(-1); });
    bind('qrBridgeScanBtn', 'click', qrStartScanner);
    bind('qrBridgeScanStopBtn', 'click', qrStopScanner);
    bind('qrBridgeResetBtn', 'click', qrResetReceive);

    bind('authAddBtn', 'click', authAdd);
    bind('authImportBtn', 'click', authImportUri);
    el('authAccountList')?.addEventListener('click', (event) => {
      const copy = event.target.closest('[data-totp-copy]');
      const remove = event.target.closest('[data-totp-remove]');
      const list = authLoad();
      if (copy) {
        const totp = authBuild(list[Number(copy.getAttribute('data-totp-copy'))]);
        if (totp) {
          navigator.clipboard?.writeText(totp.generate());
          notify('کد کپی شد.', 'Code copied.', 'success');
        }
      }
      if (remove) {
        list.splice(Number(remove.getAttribute('data-totp-remove')), 1);
        authSave(list);
        authRender();
      }
    });

    bind('inspectorRunBtn', 'click', inspectorRun);
    bind('inspectorCleanBtn', 'click', inspectorClean);
    bind('inspectorInput', 'input', () => { if (el('inspectorAuto')?.checked) inspectorRun(); });

    bind('convertRunBtn', 'click', convertRun);
    bind('convertInput', 'input', convertRun);
    bind('convertMode', 'change', convertRun);
    bind('convertSwapBtn', 'click', () => {
      const mode = el('convertMode');
      const input = el('convertInput');
      const output = el('convertOutput');
      if (!mode || !input || !output) return;
      const [from, to] = mode.value.split('-');
      const reversed = `${to}-${from}`;
      if (CONVERSIONS[reversed]) {
        mode.value = reversed;
        input.value = output.value;
        convertRun();
      }
    });

    /* The codes move on their own; nothing should have to be pressed to see
       the current one. Only while the tab is actually open. */
    if (authTimer) clearInterval(authTimer);
    authTimer = setInterval(() => {
      if (app()?.state?.activeTab === 'authenticator' && !app()?.state?.isLocked) authRender();
    }, 1000);

    global.addEventListener('poorija:tab-switched', (event) => {
      const tab = event.detail?.tabName;
      if (tab === 'authenticator') authRender();
      /* A camera left running because someone navigated away is a camera the
         user did not know was on. */
      if (tab !== 'qrbridge') { qrStopScanner(); qrStop(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.PoorijaToolsExtra = {
    qrSplit, qrParse, qrAcceptFrame,
    inspectText, stripHidden,
    CONVERSIONS,
    authBuild, authLoad,
    QR_PREFIX, QR_CHUNK_BYTES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
