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
 * It downloads nothing by itself and installs nothing, ever. Neither Android
 * nor iOS permits an app to replace itself, and on the desktop a self-updater
 * that fetches and executes a binary is a remote code execution channel into a
 * cryptography app -- worth avoiding even when it is convenient. Accepting the
 * offer opens the release asset for this platform in the system browser; the
 * download lands wherever downloads land, and the person installs it.
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
    // Apple Silicon reports as Intel in the webview, so the universal build is
    // offered on macOS rather than guessing wrong in either direction.
    return /aarch64|arm64|aarch/i.test(ua);
  }

  /**
   * Picks the asset a person on this machine should be given.
   *
   * Returns the releases page when nothing matches, which is the honest answer
   * for iOS -- where there is nothing to side-load -- and for any platform
   * whose artefact did not make it into a particular release.
   */
  function pickAsset(assets) {
    const names = (assets || []).map((asset) => ({
      name: String(asset.name || ''),
      url: String(asset.browser_download_url || ''),
    })).filter((asset) => asset.url);
    const find = (pattern) => names.find((asset) => pattern.test(asset.name));
    switch (platform()) {
      case 'android':
        return find(/\.apk$/i);
      case 'macos':
        return find(/universal.*\.dmg$/i) || find(/\.dmg$/i);
      case 'windows':
        return arm() ? find(/arm64.*\.exe$/i) || find(/\.exe$/i)
                     : find(/x64.*\.exe$/i) || find(/\.exe$/i);
      case 'linux':
        return arm() ? find(/(aarch64|arm64).*\.(deb|rpm|tar\.gz)$/i)
                     : find(/(x86_64|amd64).*\.(deb|rpm|tar\.gz)$/i);
      default:
        // iOS included: the App Store is the only route, so send them to the
        // page rather than to a file they cannot open.
        return null;
    }
  }

  /**
   * Asks GitHub what the latest release is.
   *
   * Resolves to null rather than throwing on every failure -- no network, a
   * rate limit, a repository with no releases yet. A checker that interrupts
   * someone because it could not reach the internet is worse than one that
   * says nothing.
   */
  async function fetchLatest() {
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
        asset: pickAsset(release?.assets),
      };
    } catch (_error) {
      return null;
    }
  }

  function currentVersion() {
    return app()?.APP_VERSION_SEMVER || window.APP_VERSION_SEMVER || '0.0.0';
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
    const latest = await fetchLatest();
    try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch (_error) { /* ignore */ }
    if (!latest) return manual ? { error: true } : null;
    if (!isNewer(latest.version, currentVersion())) {
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
    platform,
    releasesPage: RELEASES_PAGE,
    t,
  };
})();
