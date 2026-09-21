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
   local-link.js — working with no infrastructure at all.
   ============================================================================

   Two features share this file because they share a problem and a transport.

   1. LAN PAIRING. The chat already works over a relay on the local network —
      someone runs the server on a laptop and everyone else types its address
      into the server box. Typing `http://192.168.1.34:9000` correctly on a
      phone keypad, read out loud across a room, is the step that fails. So the
      machine that has the address shows it as a QR code and the others read it
      with a camera.

   2. DIRECT LINK. No relay at all. Two devices on the same Wi-Fi exchange
      WebRTC session descriptions through QR codes and then talk over an
      encrypted data channel with nothing in between.

   WHY (2) IS POSSIBLE

   Something has to introduce two peers before WebRTC can connect them, and
   that introduction is normally the one part that needs a server. It does not
   need to be a server: it needs a channel the two devices already share. A
   screen and a camera are such a channel.

   MEASURED BEFORE IT WAS BUILT

   Browsers replace local IP addresses in ICE candidates with mDNS names
   (`3efc59db-….local`), which sounds like it should defeat this outright. It
   does not — both sides resolve each other's names on the same network and the
   connection completes. The two descriptions come to roughly 1 550 characters
   together, which fits in one QR code in each direction at the 700-character
   chunk size the QR bridge already uses.

   What this cannot survive is a network configured to stop devices from seeing
   each other at all — "client isolation", the default on most guest and public
   Wi-Fi. Nothing inside a browser can work around that, so the interface says
   so rather than spinning forever.

   WHY THE KEY TRAVELS IN THE QR TOO

   WebRTC encrypts the channel with DTLS, but DTLS alone only proves you are
   talking to whoever answered — not to whoever you meant. Over the relay this
   app answers that with published identities and trust on first use.

   Here it is answered better. Each side's ECDH public key rides inside its own
   QR code, so the key arrives through a camera pointed at a screen you can see
   rather than over any wire. Nothing in the middle can substitute it without
   you pointing the camera somewhere else. That makes this the strongest trust
   model in the application rather than the weakest, and the six-word safety
   phrase below is derived from both keys so two people can compare it aloud.
   ============================================================================ */

(function (global) {
  'use strict';

  const app = () => global.PoorijaApp;
  const t = (fa, en) => (app()?.state?.language === 'fa' ? fa : en);
  const notify = (fa, en, kind = 'info') => app()?.showNotification?.(t(fa, en), kind);
  const el = (id) => document.getElementById(id);
  /* No raw-string fallback: app() is null during the load-order window the
     sibling module warns about, and a paired peer's name or message went
     into innerHTML unescaped exactly then. Same regex escaper local-room uses. */
  const esc = (value) => {
    const text = String(value ?? '');
    const helper = app();
    if (helper?.escapeHTML) return helper.escapeHTML(text);
    return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  };
  const bytes = (n) => app()?.formatBytes?.(n) ?? `${n} B`;

  const LINK_VERSION = 1;
  const CHUNK_BYTES = 16 * 1024;      /* comfortably inside one data channel frame */
  const BUFFER_CEILING = 1024 * 1024; /* stop queueing above this; see sendFile */
  const GATHER_TIMEOUT_MS = 6000;
  /* Measured, not guessed: 784 characters is 93 modules at level L, the same
     as the 716-character frame this replaces, so one code costs no density. */
  const LINK_CHUNK_BYTES = 1100;
  const FRAME_MARKER = 0xf1;

  const state = {
    pc: null,
    channel: null,
    role: '',                 /* 'offer' on the device that starts, 'answer' on the other */
    myKeys: null,
    theirKeyRaw: null,
    peerMeshId: '',           /* what the other device calls itself inside the room */
    adopted: false,           /* true once the room owns this connection */
    sessionKey: null,
    safety: '',
    frames: [],
    frameIndex: 0,
    frameTimer: null,
    scanner: null,
    scanPurpose: '',          /* 'link' or 'relay' — one camera, two jobs */
    received: new Map(),
    expected: 0,
    transferId: '',
    incoming: new Map(),
    mineText: '',             /* this device's code, for copy/paste pairing */
    lastAccepted: '',         /* the payload already acted on; see onScanned */
    messages: [],
    lastProgressAt: 0
  };

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  /* ---- keys and the safety phrase ---------------------------------------- */

  function makeKeys() {
    return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  }

  /* HKDF over the raw ECDH output rather than using it directly: the shared
     secret is a curve point, not uniform random bytes, and must not be handed
     to AES as though it were a key. */
  async function deriveSessionKey(privateKey, theirRawKey) {
    const theirs = await crypto.subtle.importKey('raw', theirRawKey,
      { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, privateKey, 256);
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('poorija-local-link-v1') },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  const SAFETY_WORDS = [
    'آهو', 'باران', 'پروانه', 'ترانه', 'ثریا', 'جنگل', 'چشمه', 'حریر', 'خورشید', 'دریا',
    'ذرت', 'رودخانه', 'زیتون', 'ژاله', 'سپیده', 'شبنم', 'صنوبر', 'طلوع', 'ظریف', 'عقاب',
    'غنچه', 'فانوس', 'قاصدک', 'کوهستان', 'گندم', 'لاله', 'مهتاب', 'نسیم', 'واژه', 'هلال',
    'یاقوت', 'ابریشم'
  ];

  /* Sorted before hashing so both devices compute the same phrase no matter
     which one started. A phrase that depended on who scanned first would be
     compared, found different, and read as an attack on every single pairing. */
  async function safetyPhrase(aRaw, bRaw) {
    const pair = [b64(aRaw), b64(bRaw)].sort().join('|');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(pair)));
    return Array.from({ length: 6 }, (_, i) => SAFETY_WORDS[digest[i] % SAFETY_WORDS.length]).join(' ');
  }

  /* ---- the connection ---------------------------------------------------- */

  /* No ICE servers at all. The only candidates the browser can then produce are
     host candidates, which makes this structurally incapable of leaving the
     local network — it cannot quietly fall back to the internet it exists to
     work without. */
  function newConnection() {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.onconnectionstatechange = () => {
      renderStatus();
      if (pc.connectionState === 'failed') {
        notify('اتصال برقرار نشد. احتمالاً شبکه اجازهٔ دیدن دستگاه‌ها به یکدیگر را نمی‌دهد.',
          'The connection failed. The network probably does not let devices see each other.', 'error');
      }
    };
    pc.oniceconnectionstatechange = renderStatus;
    return pc;
  }

  /* Trickle ICE has nowhere to trickle to, so gather everything first and put
     the complete set of candidates inside the one description the QR carries. */
  function waitForIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      let timer = null;
      const finish = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
      pc.addEventListener('icegatheringstatechange', check);
      timer = setTimeout(finish, GATHER_TIMEOUT_MS);
    });
  }

  function attachChannel(channel) {
    state.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      renderStatus();
      notify('پیوند برقرار شد.', 'The link is up.', 'success');
      /* Hand the finished link to the mesh, which from here owns the room:
         the roster, the broker that introduces later members, the messages and
         the calls. This module's job ends at the introduction. */
      adoptIntoMesh();
    };
    channel.onclose = renderStatus;
    channel.onerror = renderStatus;
    channel.onmessage = (event) => { handleWire(event.data).catch(() => {}); };
  }

  async function startAsHost() {
    resetLink();
    state.lastAccepted = '';
    state.role = 'offer';
    /* One link is a room of two. Going through the mesh from the first
       handshake means there is no separate two-person code path to keep in
       step with the many-person one — the third person to join uses exactly
       the machinery the second one did. */
    global.PoorijaLocalMesh?.begin({ host: true });
    state.myKeys = await makeKeys();
    state.pc = newConnection();
    attachChannel(state.pc.createDataChannel('poorija-local', { ordered: true }));
    await state.pc.setLocalDescription(await state.pc.createOffer());
    await waitForIce(state.pc);

    await showFrames(JSON.stringify({
      v: LINK_VERSION,
      role: 'offer',
      /* The identity this device is known by inside the room. The mesh keys
         every member on the identifier that member chose for itself, and
         inventing one locally at adoption time meant the two sides used
         different names for the same link: the roster then told each device to
         connect to itself, which arrived as a phantom third member in a room of
         two. It travels with the offer so both sides agree from the start. */
      mesh: meshId(),
      key: b64(await crypto.subtle.exportKey('raw', state.myKeys.publicKey)),
      sdp: state.pc.localDescription.sdp
    }));
    setStep(t('این کد را به دستگاه دیگر نشان بدهید، سپس پاسخ آن را اسکن کنید.',
      'Show this code to the other device, then scan its reply.'));
    renderStatus();
  }

  async function acceptOffer(payload) {
    resetLink();
    state.role = 'answer';
    global.PoorijaLocalMesh?.begin({ host: false });
    state.myKeys = await makeKeys();
    state.pc = newConnection();
    state.pc.ondatachannel = (event) => attachChannel(event.channel);

    await state.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
    await state.pc.setLocalDescription(await state.pc.createAnswer());
    await waitForIce(state.pc);

    state.theirKeyRaw = unb64(payload.key);
    state.peerMeshId = String(payload.mesh || '').slice(0, 64);
    state.sessionKey = await deriveSessionKey(state.myKeys.privateKey, state.theirKeyRaw);
    const mine = new Uint8Array(await crypto.subtle.exportKey('raw', state.myKeys.publicKey));
    state.safety = await safetyPhrase(mine, state.theirKeyRaw);

    await showFrames(JSON.stringify({
      v: LINK_VERSION, role: 'answer', mesh: meshId(), key: b64(mine), sdp: state.pc.localDescription.sdp
    }));
    setStep(t('حالا این کد را به دستگاه اول نشان بدهید.', 'Now show this code to the first device.'));
    renderStatus();
  }

  async function acceptAnswer(payload) {
    if (!state.pc || state.role !== 'offer') {
      notify('اول باید روی این دستگاه یک پیوند تازه بسازید.',
        'Create a new link on this device first.', 'warning');
      return;
    }
    await state.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
    state.theirKeyRaw = unb64(payload.key);
    state.peerMeshId = String(payload.mesh || '').slice(0, 64);
    state.sessionKey = await deriveSessionKey(state.myKeys.privateKey, state.theirKeyRaw);
    const mine = new Uint8Array(await crypto.subtle.exportKey('raw', state.myKeys.publicKey));
    state.safety = await safetyPhrase(mine, state.theirKeyRaw);
    stopFrames();
    hideFrames();
    setStep(t('در حال اتصال…', 'Connecting…'));
    renderStatus();
  }

  /* ---- showing and reading codes ----------------------------------------- */

  /* One code, standing still.
   *
   * This used to produce two, cycling every 1.2 seconds, because the offer is
   * 882 characters and the QR bridge chunks at 700. Two codes taking turns is
   * close to unscannable: the phone gets a fraction of a second per attempt
   * and never holds focus long enough to lock on. It was the single biggest
   * complaint about this screen and it was right.
   *
   * Deflating the payload first brings 882 characters to 784, and 784 in one
   * code measures 93 modules — the exact density of the first of the two
   * frames it replaces. So the cycling disappears and nothing is paid for it.
   * LINK_CHUNK_BYTES is set from that measurement, not guessed. It is in BYTES
   * (it was named ...CHARS while qrSplit counted characters, which is the same
   * number here because the packed offer is base64 and every byte of it is one
   * ASCII character — but the name was a trap for the next payload that is
   * not, so it now says what it means). */
  async function showFrames(text) {
    const bridge = global.PoorijaToolsExtra;
    const kit = global.PoorijaQR;
    const payload = kit ? await kit.pack(text) : text;
    state.transferId = Math.random().toString(36).slice(2, 8);
    state.frames = bridge.qrSplit(payload, state.transferId, LINK_CHUNK_BYTES);
    state.frameIndex = 0;
    el('linkQrStage')?.classList.remove('hidden');
    /* The step moves BEFORE the code is drawn.
       On a phone each block is display:none unless the pane is on its step, and
       an element with no layout has no width to measure — so the code sized
       itself against the fallback, then the block appeared narrower and CSS
       shrank the canvas to fit, which is exactly the resampling the kit goes to
       such trouble to avoid. Draw it into a box that is already on screen. */
    renderStep();
    /* The FRAMES, not the packed payload underneath them. What travels by
       clipboard has to be byte-for-byte what a camera would have read, or the
       receiver has two formats to understand and one of them is undocumented.
       One frame is the normal case; more are joined by newlines and fed in
       order, which is what a camera does anyway. */
    state.mineText = state.frames.join('\n');
    const mine = el('linkMineText');
    if (mine) mine.value = state.mineText;
    el('linkNoCamera')?.classList.remove('hidden');
    drawFrame();
    stopFrames();
    /* Still handled, because a future payload could outgrow one code; it just
       no longer happens for the handshake. */
    if (state.frames.length > 1) {
      state.frameTimer = setInterval(() => {
        state.frameIndex = (state.frameIndex + 1) % state.frames.length;
        drawFrame();
      }, 2600);
    }
  }

  function drawFrame() {
    const box = el('linkQrCanvas');
    if (!box || !state.frames.length) return;
    const kit = global.PoorijaQR;
    const info = kit
      /* 420, not 320: a link offer is the biggest payload the app asks anyone
         to scan, and at 320 the audit measured 4.6 px a module — enough held
         still and close, not enough across a desk or slightly out of focus. */
      ? kit.render(box, state.frames[state.frameIndex], { level: 'L', px: 420, quiet: 4 })
      : null;
    state.lastInfo = info;
    const counter = el('linkQrCounter');
    if (counter) {
      /* The module count is on screen deliberately: it is the number that
         decides whether a camera can read this, so when someone says "it will
         not scan" there is something to say back. */
      const density = info?.modules ? t(`${info.modules} ماژول`, `${info.modules} modules`) : '';
      counter.textContent = state.frames.length > 1
        ? t(`قاب ${state.frameIndex + 1} از ${state.frames.length} · ${density}`,
            `Frame ${state.frameIndex + 1} of ${state.frames.length} · ${density}`)
        : t(`یک کد · ${density}`, `One code · ${density}`);
    }
  }

  /* The same code, as big and as bright as the screen can manage.
   *
   * There is no web API for screen brightness — nothing here pretends there
   * is. What this does is the two things that exist and actually help: it asks
   * for a Wake Lock so the display stops dimming while somebody is aiming a
   * camera at it, and it presents the code full-screen in pure black on pure
   * white regardless of the chosen palette. On a phone that is most of the
   * difference between a reader locking on and hunting. */
  async function presentCurrentFrame() {
    if (!state.frames.length || !global.PoorijaQR) return;
    const many = state.frames.length > 1;
    const shown = await global.PoorijaQR.present(state.frames[state.frameIndex], {
      title: many
        ? t(`قاب ${state.frameIndex + 1} از ${state.frames.length}`,
            `Frame ${state.frameIndex + 1} of ${state.frames.length}`)
        : t('این کد را اسکن کنید', 'Scan this code'),
      note: t('صفحه روشن می‌ماند تا دوربین کارش را بکند.',
        'The screen is kept awake while the camera works.'),
    });
    if (shown && !shown.wakeLock) {
      /* Said out loud rather than assumed: on a browser without Wake Lock the
         screen can still dim mid-scan, and knowing that is what stops someone
         blaming the code. */
      notify('این مرورگر اجازهٔ روشن نگه‌داشتن صفحه را نمی‌دهد؛ اگر کم‌نور شد، صفحه را لمس کنید.',
        'This browser will not keep the screen awake; tap the screen if it dims.', 'info');
    }
  }

  function stopFrames() {
    if (state.frameTimer) { clearInterval(state.frameTimer); state.frameTimer = null; }
  }
  function hideFrames() { el('linkQrStage')?.classList.add('hidden'); }

  async function onScanned(raw) {
    const bridge = global.PoorijaToolsExtra;

    /* The relay-pairing job reads a plain URL, not a chunked bridge frame. */
    if (state.scanPurpose === 'relay') {
      const origin = readRelayCode(raw);
      if (!origin) return;
      stopScanner();
      applyRelayOrigin(origin);
      return;
    }

    const frame = bridge.qrParse(raw);
    if (!frame) return;
    if (state.expected && frame.transferId !== state.transferId) {
      /* A different code came into view mid-read. Starting over beats splicing
         two unrelated halves into one unparsable description. */
      state.received = new Map();
      state.expected = 0;
    }
    state.transferId = frame.transferId;
    state.expected = frame.total;
    state.received.set(frame.index, frame.payload);
    setScanProgress();
    if (state.received.size !== frame.total) return;

    const joined = Array.from({ length: frame.total }, (_, i) => state.received.get(i + 1)).join('');
    state.received = new Map();
    state.expected = 0;
    stopScanner();

    /* A camera reads the same code many times a second, and stopScanner above
       only takes effect after the awaits below — so the same payload can
       arrive twice. Acting on it twice re-runs the handshake, which calls
       resetLink and destroys the connection that was just built.
       This was unreachable while the offer needed two codes: a repeat of frame
       1 of 2 never completed a set. Compressing it into one code made the
       repeat a complete payload, and the connection started tearing itself
       down as fast as it came up. */
    if (state.lastAccepted === joined) return;
    state.lastAccepted = joined;

    /* unpack is a no-op on anything that was not compressed, so a code made by
       an older build still reads. */
    const kit = global.PoorijaQR;
    const text = kit ? await kit.unpack(joined) : joined;
    let payload = null;
    try { payload = JSON.parse(text); } catch (error) { payload = null; }
    if (!payload || payload.v !== LINK_VERSION || !payload.sdp || !payload.key) {
      notify('این کد یک دعوت پیوند محلی نیست.', 'That code is not a local link invitation.', 'error');
      return;
    }
    try {
      if (payload.role === 'offer') await acceptOffer(payload);
      else await acceptAnswer(payload);
    } catch (error) {
      console.error('[LocalLink]', error);
      notify('این دعوت خوانده نشد.', 'That invitation could not be used.', 'error');
    }
  }

  function setScanProgress() {
    const label = el('linkScanProgress');
    if (!label) return;
    label.textContent = state.expected
      ? t(`${state.received.size} از ${state.expected} قاب`,
          `${state.received.size} of ${state.expected} frames`)
      : '';
  }

  /* The camera, through the shared kit.
   *
   * Each scanner in this app used to pass the raw frame to jsQR once, at one
   * polarity, and hope. PoorijaQR.decode tries the platform's own
   * BarcodeDetector first — hardware-accelerated where it exists and far
   * better on a moving handheld frame — and only then falls back to jsQR, with
   * several crops and both polarities instead of one guess. */
  async function startScanner(purpose = 'link') {
    if (state.scanner) return;
    state.scanPurpose = purpose;
    const forRelay = purpose === 'relay';
    const video = forRelay ? el('lanPairVideo') : el('linkVideo');
    if (!video || !global.PoorijaQR) return;

    state.scanner = new global.PoorijaQR.Scanner({
      video,
      onResult: (text) => { onScanned(text).catch(() => {}); },
      onError: (error) => {
        /* PoorijaQR.Scanner passes the rejection through; this used to ignore
           the parameter entirely and report every cause as a refusal. */
        const said = global.describeMediaError?.(error, 'video');
        if (said) app()?.showNotification?.(said, 'error');
        else notify('دسترسی به دوربین داده نشد.', 'Camera access was refused.', 'error');
        stopScanner();
      },
      onCameras: (cameras) => {
        const button = el(forRelay ? 'lanPairSwitchCamBtn' : 'linkSwitchCamBtn');
        /* Hidden rather than disabled when there is only one camera: a control
           that cannot do anything is noise. */
        button?.classList.toggle('hidden', cameras.length < 2);
      },
    });

    /* On screen BEFORE the camera is asked for, not after.
     *
     * Two reasons, and the second one is why scanning stopped working at all
     * on a phone. The stage is tagged with the step it belongs to, and on a
     * phone a block whose step is not the current one is display:none — so
     * revealing it after the fact was not enough, because renderStep() had
     * never been told the scanner exists and the pane was still on `choose`.
     * The person pressed "scan their code" and got the screen they started on.
     *
     * And a <video> with no layout is not merely invisible: it has no size for
     * frames to be read out of, so the camera ran and the decoder saw nothing.
     * Giving it its place first means start() attaches to an element that is
     * actually being drawn. */
    const stage = forRelay ? el('lanPairScanStage') : el('linkScanStage');
    stage?.classList.remove('hidden');
    renderStep();

    const started = await state.scanner.start();
    if (!started) {
      state.scanner = null;
      state.scanPurpose = '';
      stage?.classList.add('hidden');
      renderStep();
      return;
    }
    const torchBtn = el(forRelay ? 'lanPairTorchBtn' : 'linkTorchBtn');
    torchBtn?.classList.toggle('hidden', !state.scanner.hasTorch());
  }

  async function switchCamera() {
    const next = await state.scanner?.switchCamera();
    if (!next) {
      notify('دوربین دیگری پیدا نشد.', 'No other camera was found.', 'info');
      return;
    }
    notify(`دوربین: ${next.label || 'بعدی'}`, `Camera: ${next.label || 'next'}`, 'info');
  }

  async function toggleTorch() {
    const on = await state.scanner?.toggleTorch();
    const button = el(state.scanPurpose === 'relay' ? 'lanPairTorchBtn' : 'linkTorchBtn');
    button?.classList.toggle('is-on', Boolean(on));
  }

  function stopScanner() {
    state.scanner?.stop();
    state.scanner = null;
    el('linkScanStage')?.classList.add('hidden');
    el('lanPairScanStage')?.classList.add('hidden');
    state.scanPurpose = '';
    /* The step follows the scanner both ways, or a phone is left on a camera
       screen with no camera behind it. */
    renderStep();
  }

  /* The link, handed over.
   *
   * Everything the mesh needs already exists here by the time the channel
   * opens: the peer connection, the data channel, the derived key and the
   * safety phrase. Passing them across rather than rebuilding them means the
   * room starts on the connection the two people just verified with their own
   * eyes, not on a second one made behind their backs. */
  const meshId = () => global.PoorijaLocalMesh?.room?.me?.id || '';

  function adoptIntoMesh() {
    const kit = global.PoorijaLocalMesh;
    if (!kit || !state.pc || !state.channel || !state.sessionKey) return false;
    /* After this the room owns the connection, and this module must stop acting
       as though it still does. It does not, in particular, get to close it:
       "invite one more person" calls startAsHost, whose first act is resetLink,
       which closed the channel — and closing a channel now removes that member
       from the room. Inviting a third person hung up on the second. */
    state.adopted = true;
    /* Falling back to a local name only when the other side is too old to send
       one — in which case it is a two-person link and nothing brokers. */
    const id = state.peerMeshId || `peer-${Math.random().toString(36).slice(2, 8)}`;
    const entry = kit.adoptLink({
      id,
      pc: state.pc,
      channel: state.channel,
      key: state.sessionKey,
      safety: state.safety,
      host: state.role === 'offer',
    });
    return Boolean(entry);
  }

  /* ---- pairing without a camera ------------------------------------------- */

  /* A desktop often has no camera worth using — or is a tower with a monitor
     and nothing else — and the handshake is about 790 characters, far past
     what anyone will read aloud or type. So the same bytes travel as text:
     copied to a clipboard, mailed, dropped on a USB stick, or saved as a small
     file the other machine opens. Nothing about it is less safe than the code:
     the payload holds a PUBLIC key and a session description, and the safety
     phrase still has to match on both screens before anyone trusts it. */
  async function useTypedCode(raw) {
    const text = String(raw || '').trim();
    if (!text) {
      notify('چیزی برای خواندن نیست.', 'There is nothing to read.', 'warning');
      return false;
    }
    /* Accepts the QR frames verbatim, so a code copied out of the other
       device's box works whether it came from a camera or a clipboard. More
       than one line is more than one frame, fed in order — the same thing a
       camera does, just without the waiting. */
    const prefix = `${global.PoorijaToolsExtra?.QR_PREFIX || 'P0Q1'}|`;
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length || !lines.every((line) => line.startsWith(prefix))) {
      notify('این متن یک کد پیوند محلی نیست.', 'That text is not a local link code.', 'error');
      return false;
    }
    for (const line of lines) await onScanned(line);
    return true;
  }

  async function pasteTypedCode() {
    try {
      const text = await navigator.clipboard.readText();
      const field = el('linkTheirText');
      if (field) field.value = text;
      return useTypedCode(text);
    } catch (error) {
      notify('کلیپ‌بورد در دسترس نیست؛ متن را دستی بچسبانید.',
        'The clipboard is not available; paste the text by hand.', 'warning');
      return false;
    }
  }

  async function copyMyCode() {
    if (!state.mineText) {
      notify('اول یک پیوند بسازید.', 'Create a link first.', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(state.mineText);
      notify('کد کپی شد.', 'Code copied.', 'success');
    } catch (error) {
      /* Selecting it is the fallback that always works, including in a webview
         that refuses clipboard writes. */
      el('linkMineText')?.select();
      notify('کپی خودکار ممکن نشد؛ متن انتخاب شد.',
        'Could not copy automatically; the text is selected.', 'info');
    }
  }

  function saveMyCode() {
    if (!state.mineText) {
      notify('اول یک پیوند بسازید.', 'Create a link first.', 'warning');
      return;
    }
    const blob = new Blob([state.mineText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `poorija-link-${state.role || 'code'}.poorijalink`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    /* Revoked on a timer rather than immediately: some browsers have not
       finished reading the blob when click() returns. */
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* ---- talking over the link --------------------------------------------- */

  /* Sealed with the ECDH-derived key on top of the channel's own DTLS. Both on
     purpose: DTLS protects the hop, this protects the payload, and only this
     one is bound to a key that arrived through a camera rather than a wire. */
  async function seal(payload, isBinary) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = isBinary ? payload : enc.encode(JSON.stringify(payload));
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.sessionKey, plain);
    const out = new Uint8Array(12 + sealed.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(sealed), 12);
    return out;
  }

  async function unseal(data) {
    const view = new Uint8Array(data);
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: view.subarray(0, 12) }, state.sessionKey, view.subarray(12)));
  }

  function canSend() {
    return Boolean(state.channel && state.channel.readyState === 'open' && state.sessionKey);
  }

  /* Once the room has taken over the link, everything goes through it. The two
     wire formats are compatible, so sending here still ARRIVED — it just landed
     in the other device's room while the sender's own copy went into this
     module's transcript, which nothing shows any more. One sender, one place. */
  const adopted = () => Boolean(global.PoorijaLocalMesh?.room?.active
    && global.PoorijaLocalMesh.room.members.size);

  async function sendText(text) {
    if (!String(text).trim()) return false;
    if (adopted()) return Boolean(await global.PoorijaLocalMesh.sendText(text));
    if (!canSend()) return false;
    state.channel.send(await seal({ kind: 'text', text: String(text), at: Date.now() }, false));
    addMessage({ direction: 'out', kind: 'text', text: String(text), at: Date.now() });
    return true;
  }

  /* Chunk header, inside the sealed frame so none of it is visible on the wire:
       [marker:1][idLength:1][id ascii][index:3 little-endian]
     The id is on every chunk rather than tracked as "the file currently being
     received". Tracking it as state works right up until two transfers overlap,
     and then it silently interleaves one file's bytes into the other. */
  function chunkHeader(id, index) {
    const idBytes = enc.encode(id);
    const header = new Uint8Array(2 + idBytes.length + 3);
    header[0] = FRAME_MARKER;
    header[1] = idBytes.length;
    header.set(idBytes, 2);
    const at = 2 + idBytes.length;
    header[at] = index & 0xff;
    header[at + 1] = (index >> 8) & 0xff;
    header[at + 2] = (index >> 16) & 0xff;
    return header;
  }

  function readChunkHeader(plain) {
    if (plain[0] !== FRAME_MARKER) return null;
    const idLength = plain[1];
    const at = 2 + idLength;
    if (plain.length < at + 3) return null;
    return {
      id: dec.decode(plain.subarray(2, at)),
      index: plain[at] | (plain[at + 1] << 8) | (plain[at + 2] << 16),
      body: plain.subarray(at + 3)
    };
  }

  async function sendFile(file) {
    if (!file) return false;
    if (adopted()) return Boolean(await global.PoorijaLocalMesh.sendFile(file));
    if (!canSend()) return false;
    const id = Math.random().toString(36).slice(2, 10);
    const total = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
    state.channel.send(await seal({
      kind: 'file-start', id, name: file.name, size: file.size, mime: file.type, total
    }, false));

    for (let index = 0; index < total; index++) {
      const slice = new Uint8Array(
        await file.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).arrayBuffer());
      const header = chunkHeader(id, index);
      const framed = new Uint8Array(header.length + slice.length);
      framed.set(header, 0);
      framed.set(slice, header.length);

      /* Backpressure. A data channel written to faster than it drains does not
         report an error — it buffers until the implementation gives up and
         closes it, which is exactly how a large file stalls with the message
         still reading "sending" and nothing in the console. */
      while (state.channel.bufferedAmount > BUFFER_CEILING) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        if (!canSend()) return false;
      }
      state.channel.send(await seal(framed, true));
      throttledProgress(t(`ارسال ${index + 1} از ${total}`, `Sending ${index + 1} of ${total}`));
    }

    state.channel.send(await seal({ kind: 'file-end', id }, false));
    setProgress('');
    addMessage({ direction: 'out', kind: 'file', name: file.name, size: file.size, at: Date.now() });
    return true;
  }

  async function handleWire(data) {
    if (!state.sessionKey) return;
    let plain;
    try { plain = await unseal(data); } catch (error) { return; }

    const chunk = readChunkHeader(plain);
    if (chunk) {
      state.incoming.get(chunk.id)?.chunks.set(chunk.index, chunk.body);
      return;
    }

    let message;
    try { message = JSON.parse(dec.decode(plain)); } catch (error) { return; }

    if (message.kind === 'text') {
      addMessage({ direction: 'in', kind: 'text', text: message.text, at: message.at });
      return;
    }
    if (message.kind === 'file-start') {
      state.incoming.set(message.id, { ...message, chunks: new Map() });
      setProgress(t(`دریافت ${message.name}…`, `Receiving ${message.name}…`));
      return;
    }
    if (message.kind === 'file-end') {
      const entry = state.incoming.get(message.id);
      if (!entry) return;
      state.incoming.delete(message.id);
      setProgress('');
      const ordered = Array.from({ length: entry.total }, (_, i) => entry.chunks.get(i));
      if (ordered.some((part) => !part)) {
        notify(`${entry.name} ناقص رسید و ذخیره نشد.`,
          `${entry.name} arrived incomplete and was not saved.`, 'error');
        return;
      }
      const blob = new Blob(ordered, { type: entry.mime || 'application/octet-stream' });
      addMessage({ direction: 'in', kind: 'file', name: entry.name, size: blob.size,
        url: URL.createObjectURL(blob), at: Date.now() });
    }
  }

  /* ---- LAN pairing: the relay's address as a code ------------------------- */

  const RELAY_PREFIX = 'P0R1|';

  function buildRelayCode(origin) {
    const value = String(origin || '').trim();
    if (!/^https?:\/\//i.test(value)) return '';
    return `${RELAY_PREFIX}${value}`;
  }

  /* Accepts the prefixed form and a bare URL both, because someone will point
     this at a code generated somewhere else and being strict would only make
     that fail without explaining why. */
  function readRelayCode(raw) {
    const text = String(raw || '').trim();
    const candidate = text.startsWith(RELAY_PREFIX) ? text.slice(RELAY_PREFIX.length) : text;
    if (!/^https?:\/\//i.test(candidate)) return '';
    try { return new URL(candidate).origin; } catch (error) { return ''; }
  }

  function showRelayCode() {
    const field = el('chatServerUrl');
    const code = buildRelayCode(field?.value || '');
    if (!code) {
      notify('اول نشانی سرور را در همین صفحه وارد کنید.',
        'Put the server address in the box on this page first.', 'warning');
      return;
    }
    const box = el('lanPairCanvas');
    if (!box) return;
    box.innerHTML = '';
    new global.QRCode(box, {
      text: code, width: 240, height: 240, correctLevel: global.QRCode.CorrectLevel.M
    });
    const caption = el('lanPairCaption');
    if (caption) caption.textContent = field.value.trim();
    el('lanPairStage')?.classList.remove('hidden');
  }

  function applyRelayOrigin(origin) {
    const field = el('chatServerUrl');
    if (!field) return;
    field.value = origin;
    /* The settings pane reads this box on input, not on a timer, so a value set
       from script has to announce itself or it is discarded the next time
       anything else is saved. */
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    notify(`نشانی سرور روی ${origin} تنظیم شد. برای ماندگاری، تنظیمات را ذخیره کنید.`,
      `Server address set to ${origin}. Save the settings to keep it.`, 'success');
  }

  /* ---- rendering --------------------------------------------------------- */

  function addMessage(entry) {
    state.messages.push(entry);
    renderMessages();
  }

  function renderMessages() {
    const box = el('linkMessages');
    if (!box) return;
    box.innerHTML = state.messages.map((message) => {
      const side = message.direction === 'out' ? 'is-out' : 'is-in';
      let body;
      if (message.kind !== 'file') {
        body = esc(message.text);
      } else if (message.url) {
        body = `<a href="${esc(message.url)}" download="${esc(message.name)}" class="link-file">`
          + `<i class="fas fa-file-arrow-down"></i> ${esc(message.name)}`
          + ` <span class="link-size">${esc(bytes(message.size))}</span></a>`;
      } else {
        body = `<span class="link-file"><i class="fas fa-file-arrow-up"></i> ${esc(message.name)}`
          + ` <span class="link-size">${esc(bytes(message.size))}</span></span>`;
      }
      return `<div class="link-bubble ${side}">${body}</div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function setStep(text) { const node = el('linkStep'); if (node) node.textContent = text; }
  function setProgress(text) { const node = el('linkProgress'); if (node) node.textContent = text; }

  /* One DOM write per chunk is thousands of layout invalidations on a large
     file, and the number is unreadable at that rate anyway. */
  function throttledProgress(text) {
    const now = Date.now();
    if (now - state.lastProgressAt < 150) return;
    state.lastProgressAt = now;
    setProgress(text);
  }

  /* One step at a time, on a phone.
   *
   * All of this is one column: an introduction, a status, two buttons, a code,
   * a camera, a text fallback, a transcript and a help note. On a desktop that
   * reads as a page. On a phone it is a long scroll in which the thing you are
   * meant to look at — a QR code somebody is pointing a camera at — is rarely
   * the thing on screen.
   *
   * So each block says which step it belongs to and the phone shows one. The
   * step is DERIVED from what the module is actually doing rather than set by
   * whichever button was pressed, so it cannot drift out of step with the
   * connection: a scanner running means the camera step, frames on screen mean
   * the code step, and anything else is the choice between them.
   *
   * Nothing is hidden on a desktop — there the surrounding context helps. */
  function renderStep() {
    const pane = document.getElementById('content-locallink');
    if (!pane) return;
    const step = state.scanner ? 'scan'
      : (state.frames.length && !el('linkQrStage')?.classList.contains('hidden')) ? 'show'
        : 'choose';
    pane.dataset.linkStep = step;
    el('linkStepBackBtn')?.classList.toggle('hidden', step === 'choose');
  }

  function renderStatus() {
    renderStep();
    const node = el('linkStatus');
    if (!node) return;
    const open = canSend();
    const connecting = Boolean(state.pc)
      && ['new', 'connecting', 'checking'].includes(state.pc.connectionState);
    node.className = `link-status ${open ? 'is-open' : connecting ? 'is-connecting' : 'is-down'}`;
    node.textContent = open
      ? t('متصل — بدون هیچ سروری', 'Connected — with no server at all')
      : connecting ? t('در حال اتصال…', 'Connecting…')
      : t('متصل نیست', 'Not connected');

    /* The step line is a one-shot note — "show this code", "connecting…" — and
       nothing ever cleared it, so a finished link sat under the word
       "connecting" indefinitely while the status above it said connected. Once
       there is a channel the note has nothing left to say. */
    if (open) setStep('');

    const phrase = el('linkSafety');
    if (phrase) {
      phrase.textContent = state.safety
        ? t(`عبارت امنیتی: ${state.safety}`, `Safety phrase: ${state.safety}`)
        : '';
    }
    el('linkComposerRow')?.classList.toggle('hidden', !open);
  }

  function resetLink() {
    stopFrames();
    stopScanner();
    hideFrames();
    /* Only what this module still owns. A connection handed to the room is the
       room's to close, and closing it here dropped the person on the other end
       every time somebody pressed "invite". Leaving the room is a separate act,
       with its own button. */
    if (!state.adopted) {
      try { state.channel?.close(); } catch (error) { /* already closed */ }
      try { state.pc?.close(); } catch (error) { /* already closed */ }
    }
    Object.assign(state, {
      adopted: false,
      pc: null, channel: null, role: '', myKeys: null, theirKeyRaw: null, peerMeshId: '',
      sessionKey: null, safety: '', frames: [], frameIndex: 0,
      received: new Map(), expected: 0, incoming: new Map()
      /* lastAccepted is deliberately NOT cleared here. acceptOffer calls
         resetLink as its first act, so clearing it here reopened the exact
         window the guard closes — the duplicate arrived a moment later and
         tore down the connection anyway. It is cleared where a genuinely new
         pairing begins: startAsHost, and the reset button. */
    });
    renderStatus();
  }

  /* ---- wiring ------------------------------------------------------------ */

  function init() {
    /* Back out of a step. On a phone the other choices are off screen, so
       without this a camera that will not focus is a dead end. */
    el('linkStepBackBtn')?.addEventListener('click', () => {
      stopScanner();
      stopFrames();
      hideFrames();
      renderStep();
    });

    el('linkHostBtn')?.addEventListener('click', () => startAsHost().catch((error) => {
      console.error('[LocalLink]', error);
      notify('ساخت پیوند ناموفق بود.', 'The link could not be created.', 'error');
    }));
    el('linkScanBtn')?.addEventListener('click', () => startScanner('link'));
    el('linkScanStopBtn')?.addEventListener('click', stopScanner);
    el('linkSwitchCamBtn')?.addEventListener('click', switchCamera);
    el('linkTorchBtn')?.addEventListener('click', toggleTorch);
    el('linkBoostBtn')?.addEventListener('click', () => presentCurrentFrame());
    el('linkCopyBtn')?.addEventListener('click', copyMyCode);
    el('linkSaveBtn')?.addEventListener('click', saveMyCode);
    el('linkPasteBtn')?.addEventListener('click', pasteTypedCode);
    el('linkUseTextBtn')?.addEventListener('click',
      () => useTypedCode(el('linkTheirText')?.value));
    el('linkOpenFileBtn')?.addEventListener('click', () => el('linkOpenFileInput')?.click());
    el('linkOpenFileInput')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const text = (await file.text()).trim();
      const field = el('linkTheirText');
      if (field) field.value = text;
      await useTypedCode(text);
    });
    el('linkResetBtn')?.addEventListener('click', () => {
      resetLink();
      state.lastAccepted = '';
      state.messages = [];
      renderMessages();
      setStep('');
      setProgress('');
    });
    el('linkSendBtn')?.addEventListener('click', async () => {
      const field = el('linkComposer');
      if (field && await sendText(field.value)) field.value = '';
    });
    el('linkComposer')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        el('linkSendBtn')?.click();
      }
    });
    el('linkFileBtn')?.addEventListener('click', () => el('linkFileInput')?.click());
    el('linkFileInput')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) await sendFile(file);
      event.target.value = '';
    });

    el('lanPairShowBtn')?.addEventListener('click', showRelayCode);
    el('lanPairScanBtn')?.addEventListener('click', () => startScanner('relay'));
    el('lanPairScanStopBtn')?.addEventListener('click', stopScanner);
    el('lanPairSwitchCamBtn')?.addEventListener('click', switchCamera);
    el('lanPairTorchBtn')?.addEventListener('click', toggleTorch);
    el('lanPairBoostBtn')?.addEventListener('click', () => {
      const field = el('chatServerUrl');
      const code = buildRelayCode(field?.value || '');
      if (code) global.PoorijaQR?.present(code, {
        title: field.value.trim(),
        note: t('دستگاه دیگر این را اسکن کند.', 'Have the other device scan this.'),
      });
    });
    el('lanPairHideBtn')?.addEventListener('click', () => el('lanPairStage')?.classList.add('hidden'));

    /* A camera or a peer connection left running because someone navigated away
       is a resource the user does not know is open. */
    global.addEventListener('poorija:tab-switched', (event) => {
      if (event.detail?.tabName !== 'locallink') {
        stopScanner();
        stopFrames();
      }
    });
    renderStatus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.PoorijaLocalLink = {
    startAsHost, acceptOffer, acceptAnswer, onScanned,
    sendText, sendFile, resetLink, canSend,
    makeKeys, deriveSessionKey, safetyPhrase,
    chunkHeader, readChunkHeader,
    buildRelayCode, readRelayCode, applyRelayOrigin,
    switchCamera, toggleTorch, presentCurrentFrame,
    useTypedCode, pasteTypedCode, copyMyCode, saveMyCode, adoptIntoMesh,
    seal, unseal,
    state,
    LINK_VERSION, CHUNK_BYTES, RELAY_PREFIX
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
