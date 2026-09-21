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
   qr-kit.js — one place for every QR code this app draws or reads.
   ============================================================================

   There were four camera scanners and six places that drew a code, each with
   its own settings, and the two things that decide whether a phone can read a
   code at all — how dense it is and how the frame is decoded — were decided
   independently in each of them. This is that decision, made once.

   WHAT MAKES A CODE READABLE, MEASURED

   Module count, not pixel size. A code's difficulty is how many modules fit
   across it, because the camera has to resolve each one. Measured with this
   app's own encoder:

       chars   modules (level L)
         400      69
         600      85
         716      93     <- the Local Link offer, as it was
         882     101     <- the same payload uncompressed, in one code
        1200     117

   The Local Link offer was 882 characters, which did not fit the 700-character
   chunk the QR bridge uses, so it became TWO codes cycling every 1.2 seconds —
   and a cycling code is close to unscannable, because the phone gets a fraction
   of a second per attempt and no chance to lock focus.

   Deflating it first brings 882 characters to 784, which fits in one code at
   93 modules: exactly the density of the first of the two frames it replaces.
   So the cycling goes away and nothing is paid for it. That is what `pack`
   below is for.

   Base64 rather than base45: base45 exists to hit QR's alphanumeric mode, but
   measured against this encoder it came out worse — 880 alphanumeric
   characters take 101 modules where 784 byte-mode characters take 93.

   DECODING

   BarcodeDetector is the platform's own reader, hardware-accelerated where it
   exists, and enormously better than jsQR on a moving handheld frame. It is
   tried first; jsQR remains for Safari and desktop Firefox, and gets several
   passes at different crops and both polarities rather than one guess.

   BRIGHTNESS

   The web cannot set screen brightness. Nothing here pretends to. What it can
   do is stop the screen dimming (Wake Lock) and present the code the way a
   bright screen would help with anyway: full width, pure black on pure white
   regardless of the app's theme, and the largest quiet zone the space allows.
   ============================================================================ */

(function (global) {
  'use strict';

  const SETTINGS_KEY = 'poorija_qr_appearance';
  const PACK_PREFIX = 'P0Z1:';        /* deflated + base64 payload */

  /* ---- appearance -------------------------------------------------------- */

  const PRESETS = {
    classic: { dark: '#000000', light: '#ffffff', fa: 'کلاسیک', en: 'Classic' },
    ink: { dark: '#0f172a', light: '#f8fafc', fa: 'جوهری', en: 'Ink' },
    ocean: { dark: '#0c4a6e', light: '#f0f9ff', fa: 'اقیانوس', en: 'Ocean' },
    forest: { dark: '#14532d', light: '#f0fdf4', fa: 'جنگل', en: 'Forest' },
    plum: { dark: '#4a044e', light: '#fdf4ff', fa: 'ارغوانی', en: 'Plum' },
    /* Inverted deliberately: some readers cope, many do not, and the ones that
       do not fail silently. It is offered because people ask for it, with the
       warning attached rather than hidden. */
    inverted: { dark: '#e2e8f0', light: '#0f172a', fa: 'وارونه (ممکن است خوانده نشود)', en: 'Inverted (may not scan)' },
  };

  const DEFAULTS = { preset: 'classic', level: 'M', quiet: 4, size: 'auto' };

  function readSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch (error) {
      return { ...DEFAULTS };
    }
  }

  function writeSettings(next) {
    const merged = { ...readSettings(), ...next };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); }
    catch (error) { /* private mode; the choice lasts the session */ }
    global.dispatchEvent(new CustomEvent('poorija:qr-appearance', { detail: merged }));
    return merged;
  }

  /* ---- payload packing --------------------------------------------------- */

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function deflate(bytes) {
    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }

  async function inflate(bytes) {
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }

  const toBase64 = (bytes) => {
    let binary = '';
    /* In chunks: String.fromCharCode.apply on a large array overflows the
       argument limit, which is a crash rather than a wrong answer. */
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  };
  const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  /* Compress only when it actually helps. Short payloads and already-random
     ones (a key, a fingerprint) come out larger deflated, and a bigger code is
     the whole problem this is here to solve. */
  async function pack(text) {
    const plain = String(text);
    if (typeof CompressionStream !== 'function') return plain;
    try {
      const packed = PACK_PREFIX + toBase64(await deflate(enc.encode(plain)));
      return packed.length < plain.length ? packed : plain;
    } catch (error) {
      return plain;
    }
  }

  async function unpack(text) {
    const value = String(text || '');
    if (!value.startsWith(PACK_PREFIX)) return value;
    if (typeof DecompressionStream !== 'function') return value;
    try {
      return dec.decode(await inflate(fromBase64(value.slice(PACK_PREFIX.length))));
    } catch (error) {
      return value;
    }
  }

  /* ---- drawing ----------------------------------------------------------- */

  const LEVELS = () => ({
    L: global.QRCode?.CorrectLevel?.L,
    M: global.QRCode?.CorrectLevel?.M,
    Q: global.QRCode?.CorrectLevel?.Q,
    H: global.QRCode?.CorrectLevel?.H,
  });

  /* The quiet zone is not decoration. The specification requires four modules
     of blank on every side, and a reader that cannot find it often will not
     even try — this was drawn hard against the edge of its container
     everywhere in the app. */
  function render(box, text, options = {}) {
    if (!box || typeof global.QRCode !== 'function') return null;
    const settings = { ...readSettings(), ...options };
    const preset = PRESETS[settings.preset] || PRESETS.classic;
    const level = LEVELS()[settings.level] ?? LEVELS().M ?? 0;
    const requested = Number(settings.px) || 320;
    /* Number(0) || 4 is 4, so an explicit "no quiet zone" used to come out as
       the default and the setting could not say what it meant — which also
       made it impossible for the audit to prove it catches a missing one. */
    const quiet = Number.isFinite(Number(settings.quiet)) ? Math.max(0, Number(settings.quiet)) : 4;

    /* The encoder is used for the maths and nothing else.
     *
     * Left to manage its own DOM it produces two elements and swaps between
     * them ASYNCHRONOUSLY: it draws into a <canvas>, then some time later sets
     * an <img> to the canvas's data URL, shows the image and hides the canvas.
     * Two things went wrong with that, and both were reported from a phone.
     *
     * The picture sat wrong in its frame, because this file's own CSS says
     * `.qr-plate img, .qr-plate canvas { display: block }` — which overrides
     * the display:none the library had just set, leaving BOTH elements in the
     * plate. One code, one empty box above it, and a white card that looked
     * offset.
     *
     * Worse, "bigger and brighter" showed a code that would not connect. The
     * image's src is set from a callback; render the next code before that
     * callback lands and the visible <img> is still carrying the PREVIOUS
     * code's pixels. It scans perfectly and means nothing.
     *
     * So the matrix is read out and drawn here. One element, nothing
     * asynchronous, the quiet zone inside the bitmap rather than in CSS
     * padding — a screenshot of just this canvas is a scannable code — and
     * whole device pixels per module, so nothing is resampled into a blur.
     */
    const staging = document.createElement('div');
    let matrix = null;
    let modules = 0;
    try {
      const code = new global.QRCode(staging, {
        text: String(text),
        width: requested,
        height: requested,
        colorDark: preset.dark,
        colorLight: preset.light,
        correctLevel: level,
      });
      modules = code._oQRCode.getModuleCount();
      matrix = code._oQRCode;
    } catch (error) {
      return null;
    } finally {
      /* Detached and emptied, so the library's later callback has nothing on
         the page to reach: it may still set the src of an <img> nobody can
         see, and that is the end of it. */
      staging.innerHTML = '';
    }
    if (!matrix || !modules) return null;

    box.innerHTML = '';
    const plate = document.createElement('div');
    plate.className = 'qr-plate';
    plate.style.background = preset.light;
    box.appendChild(plate);

    const cells = modules + quiet * 2;

    /* The size the layout will actually give it, measured rather than assumed.
     *
     * `.qr-plate canvas { max-width: 100% }` exists so a code cannot push itself
     * off the side of a narrow dialog, and it does that by SHRINKING the canvas
     * — which is exactly the resampling this function exists to avoid. The
     * identity card asks for 280 css pixels and, inside a padded dialog on a
     * phone, got about 240: 735 bitmap pixels quietly scaled into 660 device
     * ones, every module edge blurred into grey.
     *
     * What gets measured is the CONTAINER the caller handed over, minus its own
     * padding. Measuring inside the plate does not work: the plate is
     * inline-block, so it is shrink-to-fit, and a child asking for 100% of a
     * shrink-to-fit parent gets whatever that parent negotiated — which for the
     * pairing card came out at 210 pixels for a 97-module code, about two
     * pixels a module.
     *
     * A container with no width yet — drawn while its dialog is still hidden —
     * has nothing to report, and the requested size stands. */
    const boxStyle = global.getComputedStyle ? global.getComputedStyle(box) : null;
    const padding = boxStyle
      ? (parseFloat(boxStyle.paddingInlineStart) || 0) + (parseFloat(boxStyle.paddingInlineEnd) || 0)
      : 0;
    const room = Math.floor(box.getBoundingClientRect().width - padding);
    const side = room > 40 ? Math.min(requested, room) : requested;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    plate.appendChild(canvas);

    /* Whole device pixels per module, and the bitmap mapped one-to-one onto
       them. Both halves matter and the second one is what was missing.
     *
     * The ratio is used as it is. Rounding it — 2.75 became 3 — made the bitmap
     * bigger than the area it is drawn into, so the browser resampled it DOWN
     * to fit: 1421 bitmap pixels squeezed into 1320 device pixels, every module
     * edge landing on a fraction of a pixel and blending to grey. A screenshot
     * still decodes that, because a screenshot is the same resampled image the
     * decoder was given; a camera pointed at the glass sees soft edges and a
     * moiré against its own sensor grid, and gives up. That is the whole
     * difference between "our tests pass" and "it will not scan on my phone",
     * and it only appears on the fractional ratios real phones have — 2.75 on
     * this Android, 3 on that iPhone, and 1 on every desktop this was written
     * on.
     *
     * So: fit an integer module size INSIDE the device pixels available, then
     * set the CSS size to exactly bitmap ÷ ratio. The element ends up no wider
     * than asked for, and one bitmap pixel is one pixel of the screen. */
    const dpr = Math.max(1, Math.min(4, Number(global.devicePixelRatio) || 1));
    let scale = Math.max(1, Math.floor((side * dpr) / cells));
    let bitmap = cells * scale;
    canvas.width = bitmap;
    canvas.height = bitmap;
    const css = bitmap / dpr;
    canvas.style.width = `${css}px`;
    canvas.style.height = `${css}px`;

    /* One correction pass, because a measurement can be taken a moment before
       the layout settles — a pane that has just been switched to, a dialog
       mid-open — and a canvas that then gets shrunk by max-width is resampled
       again. Asking the browser what it actually did, and rebuilding once if
       the answer is smaller, costs a reflow and removes the guess. It cannot
       loop: the second width is the constrained one. */
    const painted = canvas.getBoundingClientRect().width;
    if (painted > 40 && painted < css - 0.5) {
      const fitted = Math.max(1, Math.floor((painted * dpr) / cells));
      if (fitted !== scale) {
        scale = fitted;
        bitmap = cells * scale;
        canvas.width = bitmap;
        canvas.height = bitmap;
        canvas.style.width = `${bitmap / dpr}px`;
        canvas.style.height = `${bitmap / dpr}px`;
      }
    }

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = preset.light;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = preset.dark;
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!matrix.isDark(row, col)) continue;
        ctx.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
      }
    }

    /* modules is reported so a caller can say "this is dense, hold the phone
       closer" rather than leaving the reader to guess why nothing happens. */
    return {
      modules, drawable: canvas, plate, canvas,
      /* Reported so a caller — or an audit — can check the mapping rather than
         trust it: modulePx is device pixels per module, and cssWidth × dpr
         should equal the bitmap width exactly. */
      scale, bitmap, cssWidth: bitmap / dpr, dpr,
      level: settings.level, preset: settings.preset, quiet, chars: String(text).length,
    };
  }

  /* ---- decoding ---------------------------------------------------------- */

  let detector = null;
  let detectorTried = false;

  async function nativeDetector() {
    if (detectorTried) return detector;
    detectorTried = true;
    try {
      if (typeof global.BarcodeDetector !== 'function') return null;
      const formats = await global.BarcodeDetector.getSupportedFormats();
      if (!formats.includes('qr_code')) return null;
      detector = new global.BarcodeDetector({ formats: ['qr_code'] });
    } catch (error) {
      detector = null;
    }
    return detector;
  }

  /* Several passes rather than one guess: a handheld frame has the code in the
     middle and a lot of room around it, and jsQR does worst exactly there.
     Cheapest first, stop at the first hit. */
  const PASSES = [
    { crop: 1, maxSide: 640 },
    { crop: 0.6, maxSide: 640 },
    { crop: 1, maxSide: 1024 },
    { crop: 0.4, maxSide: 512 },
  ];

  function frameToImageData(source, width, height, { crop = 1, maxSide = 640 } = {}) {
    if (!width || !height) return null;
    const sw = Math.round(width * crop);
    const sh = Math.round(height * crop);
    if (sw < 24 || sh < 24) return null;
    const sx = Math.round((width - sw) / 2);
    const sy = Math.round((height - sh) / 2);
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const dw = Math.max(24, Math.round(sw * scale));
    const dh = Math.max(24, Math.round(sh * scale));
    const canvas = frameToImageData.canvas || (frameToImageData.canvas = document.createElement('canvas'));
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
    return ctx.getImageData(0, 0, dw, dh);
  }

  /* `source` is a video, canvas or ImageBitmap. Returns the decoded string. */
  async function decode(source, width, height) {
    const native = await nativeDetector();
    if (native) {
      try {
        const found = await native.detect(source);
        if (found?.length && found[0].rawValue) return found[0].rawValue;
      } catch (error) { /* fall through to jsQR */ }
    }
    if (typeof global.jsQR !== 'function') return '';
    for (const pass of PASSES) {
      const image = frameToImageData(source, width, height, pass);
      if (!image) continue;
      for (const inversionAttempts of ['dontInvert', 'onlyInvert']) {
        try {
          const code = global.jsQR(image.data, image.width, image.height, { inversionAttempts });
          if (code?.data) return code.data;
        } catch (error) { /* jsQR throws on degenerate dimensions */ }
      }
    }
    return '';
  }

  /* ---- the camera -------------------------------------------------------- */

  class Scanner {
    constructor({ video, onResult, onError, onCameras } = {}) {
      this.video = video;
      this.onResult = onResult || (() => {});
      this.onError = onError || (() => {});
      this.onCameras = onCameras || (() => {});
      this.stream = null;
      this.timer = null;
      this.cameras = [];
      this.index = 0;
      this.busy = false;
      this.torchOn = false;
    }

    async listCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        this.cameras = devices.filter((d) => d.kind === 'videoinput');
      } catch (error) {
        this.cameras = [];
      }
      this.onCameras(this.cameras, this.index);
      return this.cameras;
    }

    async start(deviceId = null) {
      await this.stop();
      /* Resolution matters more than frame rate for a dense code: the limit is
         whether one module lands on more than one sensor pixel. Asked for, not
         demanded — a camera that cannot do it gives what it has. */
      const video = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (error) {
        this.onError(error);
        return false;
      }
      /* Labels are empty until permission is granted, so enumerate after. */
      await this.listCameras();
      if (deviceId) this.index = Math.max(0, this.cameras.findIndex((c) => c.deviceId === deviceId));

      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', 'true');
      this.video.muted = true;
      await this.video.play().catch(() => {});
      await this.applyFocus();

      this.timer = setInterval(() => this.tick(), 180);
      return true;
    }

    /* Continuous autofocus where the platform exposes it; without it a phone
       locks focus on whatever was in frame first, which for a code held up
       later is the wrong distance. */
    async applyFocus() {
      const track = this.stream?.getVideoTracks?.()[0];
      if (!track?.applyConstraints) return;
      const caps = track.getCapabilities?.() || {};
      const advanced = [];
      if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
      if (caps.exposureMode?.includes('continuous')) advanced.push({ exposureMode: 'continuous' });
      if (!advanced.length) return;
      try { await track.applyConstraints({ advanced }); } catch (error) { /* not supported */ }
    }

    hasTorch() {
      const track = this.stream?.getVideoTracks?.()[0];
      return Boolean(track?.getCapabilities?.().torch);
    }

    async toggleTorch() {
      const track = this.stream?.getVideoTracks?.()[0];
      if (!track?.getCapabilities?.().torch) return false;
      this.torchOn = !this.torchOn;
      try {
        await track.applyConstraints({ advanced: [{ torch: this.torchOn }] });
        return this.torchOn;
      } catch (error) {
        this.torchOn = false;
        return false;
      }
    }

    async switchCamera() {
      if (this.cameras.length < 2) await this.listCameras();
      if (this.cameras.length < 2) return null;
      this.index = (this.index + 1) % this.cameras.length;
      const next = this.cameras[this.index];
      await this.start(next.deviceId);
      return next;
    }

    async tick() {
      if (this.busy || !this.video?.videoWidth) return;
      this.busy = true;
      try {
        const text = await decode(this.video, this.video.videoWidth, this.video.videoHeight);
        if (text) this.onResult(text);
      } catch (error) {
        /* a frame that could not be read is not an error worth reporting */
      } finally {
        this.busy = false;
      }
    }

    async stop() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.stream) {
        this.stream.getTracks().forEach((track) => { try { track.stop(); } catch (error) { /* gone */ } });
        this.stream = null;
      }
      this.torchOn = false;
      if (this.video) this.video.srcObject = null;
    }
  }

  /* ---- presenting a code for someone else's camera ----------------------- */

  let wakeLock = null;

  async function holdScreenAwake() {
    try {
      if (!navigator.wakeLock?.request) return false;
      wakeLock = await navigator.wakeLock.request('screen');
      return true;
    } catch (error) {
      return false;
    }
  }

  function releaseScreen() {
    try { wakeLock?.release(); } catch (error) { /* already gone */ }
    wakeLock = null;
  }

  /* The web has no brightness API, so this does the two things that are
     actually available and actually help: it stops the screen dimming, and it
     shows the code as large as the display allows on pure white with pure
     black modules, whatever theme the app is wearing. On a phone that is the
     difference between a reader locking on and hunting. */
  async function present(text, { title = '', note = '' } = {}) {
    /* One at a time, whoever asks. A caller that had accidentally accumulated
       listeners opened one of these per listener, stacked, and every close
       press dismissed only the topmost — so the reader had to press the cross
       as many times as the button had been wired. That particular caller is
       fixed, but a presentation that can silently stack is a trap for the next
       one, so the invariant lives here instead. */
    document.querySelectorAll('.qr-boost').forEach((old) => old.remove());
    releaseScreen();

    const host = document.createElement('div');
    host.className = 'qr-boost';
    host.setAttribute('role', 'dialog');
    host.innerHTML = `
      <div class="qr-boost-inner">
        <div class="qr-boost-code"></div>
        <p class="qr-boost-title"></p>
        <p class="qr-boost-note"></p>
        <button type="button" class="qr-boost-close">✕</button>
      </div>`;
    host.querySelector('.qr-boost-title').textContent = title;
    host.querySelector('.qr-boost-note').textContent = note;
    document.body.appendChild(host);

    const side = Math.min(window.innerWidth, window.innerHeight) - 96;
    const info = render(host.querySelector('.qr-boost-code'), text, {
      preset: 'classic',      /* maximum contrast wins over the chosen palette */
      px: Math.max(240, Math.min(720, side)),
      quiet: 4,
    });

    const kept = await holdScreenAwake();
    const close = () => {
      releaseScreen();
      host.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    host.querySelector('.qr-boost-close').addEventListener('click', close);
    host.addEventListener('click', (event) => { if (event.target === host) close(); });
    document.addEventListener('keydown', onKey);
    return { close, wakeLock: kept, ...info };
  }

  /* ---- the strict audit -------------------------------------------------
   *
   * "It looks like a QR code" is not the same as "a phone across the table can
   * read it", and the gap between those two is where every complaint about
   * this app's codes has lived. So the kit can grade its own output: draw the
   * code, then attack it the way a real camera does and see what survives.
   *
   * The measurements are the ones that decide readability in practice:
   *
   *   MODULES. The version, not the pixel size. A 105-module card at 300 px is
   *   2.8 px per module before the camera has resampled anything; the same card
   *   printed huge is still 105 modules of detail for the lens to resolve.
   *
   *   PIXELS PER MODULE. Below about three, a camera sensor and a JPEG encoder
   *   between them smear neighbouring modules into each other.
   *
   *   CONTRAST. Relative luminance, the sRGB definition, because a palette that
   *   looks tasteful on a monitor can fall under what a binarizer can split.
   *
   *   QUIET ZONE. Four modules, per the specification. Readers use it to find
   *   the symbol at all; without it many never start.
   *
   *   POLARITY. Light modules on a dark ground is legal and widely unreadable.
   *
   * Then the degradations. Each one is a thing that actually happens when
   * somebody holds up a phone, and each is applied on its own so a failure
   * names its cause instead of producing one useless "did not scan".
   */

  const AUDIT = {
    minContrast: 4.5,
    minModulePx: 3,
    comfortModules: 57,   /* version 10 */
    hardModules: 105,     /* version 25 */
    quietModules: 4,
  };

  const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

  function relativeLuminance(hex) {
    const value = String(hex).replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrastRatio(a, b) {
    const x = relativeLuminance(a);
    const y = relativeLuminance(b);
    const [hi, lo] = x > y ? [x, y] : [y, x];
    return (hi + 0.05) / (lo + 0.05);
  }

  /* Draw the code into a canvas we own, so the degradations have something to
     work on that is not the live element on the page. */
  function snapshotCanvas(drawable, side) {
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(drawable, 0, 0, side, side);
    return canvas;
  }

  /* Every transform here answers a question a person would ask out loud:
     "does it still scan from across the room / at an angle / in the dark /
     with the edge cut off / on a screen with a reflection on it?"

     Each one first CAPTURES: a camera resolves a fixed budget of pixels across
     whatever it is framing, and never more detail than the screen is showing.
     Drawing a code larger than that budget buys nothing at a distance, which is
     itself worth knowing. Modelling the degradations as a fraction of the drawn
     size instead — as this did at first — confounds two variables and punishes a
     big code for being big: the first version shrank a 420 px code to 75 px and
     then called the result "out of focus", when nothing could have read it.

     The budgets: ~300 px across for a code sitting small in the viewfinder,
     ~640 px for one the person has deliberately framed. */

  const capture = (source, budget) => (source.width <= budget
    ? source
    : resample(source, budget / source.width));

  const DEGRADATIONS = [
    {
      id: 'clean', fa: 'بدون تغییر', en: 'As drawn',
      apply: (source) => source,
    },
    {
      id: 'distance', fa: 'از فاصله', en: 'From across the room',
      apply: (source) => capture(source, 300),
    },
    {
      id: 'blur', fa: 'فوکوس نامناسب', en: 'Out of focus',
      /* Down and back up: a cheap, honest low-pass. At 0.45 the point spread is
         a bit over two captured pixels, which is a soft phone lens, not a
         destroyed picture. */
      apply: (source) => {
        const framed = capture(source, 640);
        return resample(resample(framed, 0.45), 1 / 0.45);
      },
    },
    {
      id: 'tilt', fa: 'کج گرفتن گوشی', en: 'Phone held at an angle',
      apply: (source) => rotate(capture(source, 640), 12),
    },
    {
      id: 'dim', fa: 'نور کم', en: 'Low light',
      apply: (source) => brightness(capture(source, 640), 0.4),
    },
    {
      id: 'glare', fa: 'انعکاس نور روی صفحه', en: 'Reflection on the screen',
      apply: (source) => glare(capture(source, 640)),
    },
    {
      id: 'cropped-quiet-zone', fa: 'حاشیهٔ سفید بریده', en: 'Quiet zone cut off',
      /* Not a defect of ours — a test of how much margin the symbol has left
         when a container, a screenshot or a photo trims the border. */
      apply: (source) => crop(capture(source, 640), 0.9),
    },
  ];

  function surface(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(8, Math.round(width));
    canvas.height = Math.max(8, Math.round(height));
    return canvas;
  }

  function resample(source, factor) {
    const out = surface(source.width * factor, source.height * factor);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, out.width, out.height);
    return out;
  }

  function rotate(source, degrees) {
    const radians = (degrees * Math.PI) / 180;
    const span = Math.ceil(
      Math.abs(source.width * Math.cos(radians)) + Math.abs(source.height * Math.sin(radians)));
    const out = surface(span, span);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, span, span);
    ctx.translate(span / 2, span / 2);
    ctx.rotate(radians);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    return out;
  }

  function brightness(source, factor) {
    const out = surface(source.width, source.height);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const frame = ctx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < frame.data.length; i += 4) {
      frame.data[i] *= factor;
      frame.data[i + 1] *= factor;
      frame.data[i + 2] *= factor;
    }
    ctx.putImageData(frame, 0, 0);
    return out;
  }

  function glare(source) {
    const out = surface(source.width, source.height);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const wash = ctx.createLinearGradient(0, 0, out.width, out.height);
    wash.addColorStop(0, 'rgba(255,255,255,0)');
    wash.addColorStop(0.45, 'rgba(255,255,255,0.62)');
    wash.addColorStop(0.75, 'rgba(255,255,255,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, out.width, out.height);
    return out;
  }

  function crop(source, keep) {
    const side = Math.round(source.width * keep);
    const offset = Math.round((source.width - side) / 2);
    const out = surface(side, side);
    out.getContext('2d', { willReadFrequently: true })
      .drawImage(source, offset, offset, side, side, 0, 0, side, side);
    return out;
  }

  /* One audit of one payload at one appearance. */
  async function audit(text, options = {}) {
    const settings = { ...readSettings(), ...options };
    const px = Number(settings.px) || 320;
    const stage = document.createElement('div');
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden';
    document.body.appendChild(stage);

    const findings = [];
    try {
      const drawn = render(stage, text, { ...settings, px });
      if (!drawn || !drawn.drawable) {
        return {
          ok: false, grade: 'fail', findings: [{
            id: 'not-drawn', severity: 'fail',
            fa: 'کد اصلاً کشیده نشد.', en: 'The code was not drawn at all.',
          }],
        };
      }

      const preset = PRESETS[settings.preset] || PRESETS.classic;
      const contrast = contrastRatio(preset.dark, preset.light);
      const inverted = relativeLuminance(preset.dark) > relativeLuminance(preset.light);
      const modules = drawn.modules || 0;
      const modulePx = modules ? px / modules : 0;
      const quiet = drawn.quiet;

      if (contrast < AUDIT.minContrast) {
        findings.push({
          id: 'contrast', severity: 'fail', value: Number(contrast.toFixed(2)),
          fa: `کنتراست ${contrast.toFixed(1)}:۱ است و برای دوربین کم است.`,
          en: `Contrast is ${contrast.toFixed(1)}:1, too little for a camera to split.`,
        });
      }
      if (inverted) {
        findings.push({
          id: 'polarity', severity: 'warn',
          fa: 'ماژول‌های روشن روی زمینهٔ تیره؛ بسیاری از خواننده‌ها این را نمی‌خوانند.',
          en: 'Light modules on a dark ground; many readers will not take it.',
        });
      }
      if (quiet < AUDIT.quietModules) {
        findings.push({
          id: 'quiet-zone', severity: 'fail', value: quiet,
          fa: `حاشیهٔ خالی ${quiet} ماژول است؛ استاندارد ۴ ماژول می‌خواهد.`,
          en: `The quiet zone is ${quiet} modules; the specification requires 4.`,
        });
      }
      if (modulePx && modulePx < AUDIT.minModulePx) {
        findings.push({
          id: 'module-size', severity: 'fail', value: Number(modulePx.toFixed(2)),
          fa: `هر ماژول ${modulePx.toFixed(1)} پیکسل است؛ زیر ${AUDIT.minModulePx} پیکسل ماژول‌ها در هم می‌روند.`,
          en: `Each module is ${modulePx.toFixed(1)} px; below ${AUDIT.minModulePx} they smear together.`,
        });
      }
      if (modules > AUDIT.hardModules) {
        findings.push({
          id: 'density-hard', severity: 'fail', value: modules,
          fa: `${modules} ماژول؛ این‌قدر متراکم است که گوشی باید خیلی نزدیک بیاید.`,
          en: `${modules} modules; dense enough that a phone has to come very close.`,
        });
      } else if (modules > AUDIT.comfortModules) {
        findings.push({
          id: 'density', severity: 'warn', value: modules,
          fa: `${modules} ماژول؛ خوانده می‌شود ولی از فاصلهٔ کم.`,
          en: `${modules} modules; readable, but only from close up.`,
        });
      }

      /* The part that cannot be reasoned about: read it back. */
      const shot = snapshotCanvas(drawn.drawable, px);
      const expected = String(text);
      const trials = [];
      for (const step of DEGRADATIONS) {
        let survived = false;
        let exact = false;
        try {
          const image = step.apply(shot);
          const got = await decode(image, image.width, image.height);
          survived = Boolean(got);
          exact = got === expected;
        } catch (error) { survived = false; }
        trials.push({ id: step.id, fa: step.fa, en: step.en, survived, exact });
      }

      const clean = trials.find((t) => t.id === 'clean');
      if (!clean || !clean.exact) {
        findings.push({
          id: 'round-trip', severity: 'fail',
          fa: 'کدی که کشیده شد، خوانده که شد همان متن نبود.',
          en: 'The code that was drawn did not read back as the same text.',
        });
      }
      /* A cropped quiet zone is a hazard, not a defect of the drawing, so it
         is reported but never counted against the grade. */
      const graded = trials.filter((t) => t.id !== 'cropped-quiet-zone');
      const lost = graded.filter((t) => !t.exact);
      lost.filter((t) => t.id !== 'clean').forEach((t) => findings.push({
        id: `survives-${t.id}`, severity: 'warn',
        fa: `«${t.fa}» را رد نمی‌کند.`,
        en: `Does not survive: ${t.en.toLowerCase()}.`,
      }));

      const worst = findings.some((f) => f.severity === 'fail') ? 'fail'
        : findings.length ? 'warn' : 'pass';
      return {
        ok: worst !== 'fail',
        grade: worst,
        modules,
        modulePx: Number(modulePx.toFixed(2)),
        contrast: Number(contrast.toFixed(2)),
        quiet,
        inverted,
        chars: expected.length,
        level: settings.level,
        preset: settings.preset,
        resilience: `${graded.length - lost.length}/${graded.length}`,
        trials,
        findings,
      };
    } finally {
      stage.remove();
    }
  }

  /* Every code the app can put on a screen, at every appearance offered, so a
     palette that cannot be read is found here and not by a person holding a
     phone up to a monitor. */
  async function auditAll(samples, options = {}) {
    const presets = options.presets || Object.keys(PRESETS);
    const report = [];
    for (const sample of samples) {
      for (const preset of presets) {
        /* A code's readability is a property of where it is drawn, not of the
           audit: the same payload is comfortable full-screen and unreadable in
           a 200 px box. So each sample carries its own call site's size. */
        const outcome = await audit(sample.text, { ...options, ...(sample.options || {}), preset });
        report.push({ sample: sample.name, preset, ...outcome });
      }
    }
    return {
      report,
      failures: report.filter((r) => r.grade === 'fail'),
      warnings: report.filter((r) => r.grade === 'warn'),
    };
  }

  global.PoorijaQR = {
    PRESETS, DEFAULTS,
    readSettings, writeSettings,
    pack, unpack, PACK_PREFIX,
    render, decode, frameToImageData, nativeDetector,
    Scanner, present, holdScreenAwake, releaseScreen,
    audit, auditAll, AUDIT, DEGRADATIONS, contrastRatio, relativeLuminance,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
