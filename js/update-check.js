/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Tells a native build when a newer release exists.
 *
 * WHY THIS IS OPT-OUT AND DISCLOSED, NOT SILENT
 *
 * This suite advertises no telemetry, and an update check is the one place an
 * offline-first app deliberately reaches the network without the person asking
 * for anything. GitHub learns an IP ran this app at a moment in time. That is
 * not telemetry -- nothing about the person or their data is sent, there is no
 * identifier, and the request is the same one any visitor to the releases page
 * makes -- but it IS an outbound call, so it is named in the settings, it can
 * be turned off, and it never runs in the browser build.
 *
 * The browser and Home Screen builds are excluded because they already update
 * themselves: the service worker swaps its cache when the asset tag changes,
 * which is what the tag is for. Only the native shells, which carry a frozen
 * copy of the app inside a signed bundle, have anything to learn here.
 *
 * WHAT IT DOES NOT DO
 *
 * It installs nothing, ever, and runs nothing it downloaded. Neither Android
 * nor iOS permits an app to replace itself, and on the desktop a self-updater
 * that fetches and executes a binary is a remote code execution channel into a
 * cryptography app -- worth avoiding even when it is convenient. Accepting the
 * offer downloads the file for this machine -- the same kind as the one
 * installed -- through the app's own proxy, checks it against the release's
 * SHA256SUMS, and leaves it in Downloads for the person to open (js/app.js
 * offerUpdate); on a phone, or where that fails, the browser gets the link.
 */

(function () {
  'use strict';

  const REPO = 'Poorija/P00RIJA-Cryptography';
  const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
  const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
  const SETTING_KEY = 'poorija_update_check';
  const LAST_SEEN_KEY = 'poorija_update_last_seen';
  /* GitHub allows sixty unauthenticated calls an hour per address. One a day
     is far inside that and still catches a release the day it lands. */
  const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

  function app() { return window.PoorijaApp; }
  function t(fa, en) { return app()?.state?.language === 'fa' ? fa : en; }

  /** Native shells only: see the note above. */
  function eligible() {
    return Boolean(window.__POORIJA_DESKTOP__);
  }

  function enabled() {
    try {
      // Absent means yes. The person has to have turned it off for it to stop.
      return localStorage.getItem(SETTING_KEY) !== 'off';
    } catch (_error) {
      return false;
    }
  }

  function setEnabled(on) {
    try { localStorage.setItem(SETTING_KEY, on ? 'on' : 'off'); } catch (_error) { /* private mode */ }
  }

  /* Compares two dotted versions numerically, so 2.35.0 beats 2.9.0 -- which
     a string comparison gets backwards, and which is exactly the bug that
     makes an update checker tell people to downgrade. */
  function isNewer(candidate, current) {
    const parse = (value) => String(value).replace(/^v/i, '').split('.').map((part) => parseInt(part, 10) || 0);
    const a = parse(candidate);
    const b = parse(current);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const left = a[i] || 0;
      const right = b[i] || 0;
      if (left !== right) return left > right;
    }
    return false;
  }

  /** What this machine is, in the words the release assets are named with. */
  function platform() {
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Linux/i.test(ua)) return 'linux';
    return 'unknown';
  }

  function arm() {
    const ua = navigator.userAgent || '';
    return /aarch64|arm64|aarch/i.test(ua);
  }

  /* What this build is, as the shell says it (desktop_platform_info): the
     operating system, the architecture it was built for, how it was
     installed (Tauri marks the bundle into the binary: deb, rpm, appimage,
     nsis, msi, app), whether the Mac binary is universal, and on Linux the
     distribution. The webview's user agent calls an Apple Silicon Mac Intel
     and Windows on ARM x64, so it is only the last resort. */
  const ARCH = { x86_64: 'x86_64', amd64: 'x86_64', x64: 'x86_64', aarch64: 'aarch64', arm64: 'aarch64' };
  function machine(info) {
    const os = info?.os === 'darwin' ? 'macos' : String(info?.os || '') || platform();
    return {
      os,
      arch: ARCH[String(info?.arch || '').toLowerCase()] || (arm() ? 'aarch64' : 'x86_64'),
      bundle: String(info?.bundle || '').toLowerCase() || null,
      universal: Boolean(info?.universal),
      distro: String(info?.distro || '').toLowerCase(),
      known: Boolean(info),
    };
  }

  /**
   * Picks the file a person on this machine should be given: the same kind
   * as the one installed, for the same architecture.
   *
   * Null when the release has nothing for it, which is the honest answer for
   * iOS -- where there is nothing to side-load -- and for any platform whose
   * file did not make it into a particular release; the page is offered then.
   */
  function pickAsset(assets, info = null) {
    const names = (assets || []).map((asset) => ({
      name: String(asset.name || ''),
      url: String(asset.browser_download_url || ''),
    })).filter((asset) => asset.url);
    const find = (pattern) => names.find((asset) => pattern.test(asset.name)) || null;
    const m = machine(info);
    const words = m.arch === 'aarch64' ? '(?:aarch64|arm64)' : '(?:x86_64|amd64|x64)';
    switch (m.os) {
      case 'android':
        return find(/\.apk$/i);
      case 'macos':
        // A universal install, or a machine that could not say, keeps to the
        // universal build; otherwise the build for its own chip.
        if (!m.known || m.universal) return find(/universal\.dmg$/i) || find(/\.dmg$/i);
        return find(new RegExp(`[._-]${words}\\.dmg$`, 'i')) || find(/universal\.dmg$/i);
      case 'windows': {
        if (m.bundle === 'msi') {
          const msi = find(new RegExp(`${words}[^/]*\\.msi$`, 'i'));
          if (msi) return msi;
        }
        // Windows on ARM runs the x64 installer when there is no arm64 one.
        return find(new RegExp(`[._-]${words}-setup\\.exe$`, 'i'))
          || (m.arch === 'aarch64' ? find(/[._-](?:x86_64|amd64|x64)-setup\.exe$/i) : null);
      }
      case 'linux': {
        const ending = { deb: '\\.deb', rpm: '\\.rpm', appimage: '\\.AppImage' }[m.bundle];
        if (ending) return find(new RegExp(`[._-]${words}${ending}$`, 'i'));
        if (/^(arch|manjaro|endeavouros|garuda|artix)$/.test(m.distro)) return find(new RegExp(`-${words}\\.pkg\\.tar\\.zst$`, 'i'));
        return find(new RegExp(`linux-${words}\\.tar\\.gz$`, 'i'));
      }
      default:
        return null;
    }
  }

  /** The release's checksums, which a download is checked against. */
  function sumsAsset(assets) {
    const found = (assets || []).find((asset) => /^SHA256SUMS(\.txt)?$/i.test(String(asset.name || '')));
    return found ? { name: String(found.name), url: String(found.browser_download_url || '') } : null;
  }

  /**
   * Asks GitHub what the latest release is.
   *
   * Resolves to null rather than throwing on every failure -- no network, a
   * rate limit, a repository with no releases yet. A checker that interrupts
   * someone because it could not reach the internet is worse than one that
   * says nothing.
   */
  async function fetchLatest(info = null) {
    try {
      const response = await fetch(LATEST, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const release = await response.json();
      const version = String(release?.tag_name || '').replace(/^v/i, '');
      if (!version) return null;
      return {
        version,
        notes: String(release?.body || '').trim(),
        page: String(release?.html_url || RELEASES_PAGE),
        asset: pickAsset(release?.assets, info),
        sums: sumsAsset(release?.assets),
      };
    } catch (_error) {
      return null;
    }
  }

  /**
   * What this build is, or empty when it cannot be established.
   *
   * Never a default. The first version of this returned '0.0.0' when it could
   * not read the real number, which made every published release newer than
   * the running one -- so a build announced an update over itself. A checker
   * that does not know what it is running has nothing useful to say, and
   * saying nothing is the correct behaviour rather than a missed opportunity.
   */
  function currentVersion() {
    const fromApp = app()?.APP_VERSION_SEMVER;
    if (typeof fromApp === 'string' && fromApp) return fromApp;
    const fromWindow = window.APP_VERSION_SEMVER;
    if (typeof fromWindow === 'string' && fromWindow) return fromWindow;
    return '';
  }

  /**
   * @param {boolean} manual - a person pressed the button, so say something
   *   either way and ignore both the interval and the dismissal.
   */
  async function check(manual) {
    if (!manual && (!eligible() || !enabled())) return null;
    if (!manual) {
      try {
        const last = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
        if (Date.now() - last < MIN_INTERVAL_MS) return null;
      } catch (_error) { /* private mode: check every launch */ }
    }
    const running = currentVersion();
    /* Nothing sensible to compare against. Say so when somebody pressed the
       button, and stay quiet otherwise -- announcing an update on the strength
       of a version we could not read is how this went wrong the first time. */
    if (!running) return manual ? { error: true } : null;
    /* The shell's own word on what it is, so the file offered is the one installed. */
    let info = null;
    try { info = window.PoorijaDesktop?.platformInfo ? await window.PoorijaDesktop.platformInfo() : null; } catch (_error) { info = null; }
    const latest = await fetchLatest(info);
    try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch (_error) { /* ignore */ }
    if (!latest) return manual ? { error: true } : null;
    if (!isNewer(latest.version, running)) {
      return manual ? { upToDate: true, version: latest.version } : null;
    }
    return latest;
  }

  window.PoorijaUpdate = {
    check,
    enabled,
    setEnabled,
    eligible,
    isNewer,
    pickAsset,
    sumsAsset,
    platform,
    releasesPage: RELEASES_PAGE,
    t,
  };
})();
