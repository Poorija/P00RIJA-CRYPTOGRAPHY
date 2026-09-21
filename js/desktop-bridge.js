/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/*
 * The single place that knows the app is running inside Tauri.
 *
 * Everything else in js/ asks this file rather than poking at window.__TAURI__,
 * so the web build and the native build load the same app.js and chat.js. In a
 * browser every call here is a no-op that resolves to a neutral value, which is
 * why the callers do not need their own `if (native)` branches.
 */
(function () {
  const tauri = window.__TAURI__;
  const core = tauri?.core || tauri?.tauri || null;
  const dialog = tauri?.dialog || null;
  const notification = tauri?.notification || null;
  const isDesktop = Boolean(tauri && core?.invoke);
  /* "Desktop" here used to mean "a Tauri runtime" — which the phone shells
     are too: core.invoke exists in the iOS and Android webviews, so the app
     wore the desktop-runtime class on a 390-point screen and every
     desktop-shaped decision that keys on it followed. The phone is its own
     runtime: native-mobile marks it, and the mobile/standalone classification
     in app.js reads that instead of guessing from the window size alone. */
  const isPhoneShell = isDesktop
    && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

  window.__POORIJA_DESKTOP__ = isDesktop;
  window.__POORIJA_NATIVE_MOBILE__ = isPhoneShell;

  if (!isDesktop) {
    window.PoorijaDesktop = { available: false };
    return;
  }

  document.documentElement.classList.add(isPhoneShell ? 'native-mobile' : 'desktop-runtime');

  const invoke = (command, payload) => core.invoke(command, payload || {});

  window.__POORIJA_DESKTOP_INVOKE__ = function invokeDesktopCommand(command, payload) {
    return invoke(command, payload);
  };

  window.__POORIJA_DESKTOP_DIALOG__ = {
    open(options) {
      if (!dialog?.open) return Promise.resolve(null);
      return dialog.open(options || {});
    },
    save(options) {
      if (!dialog?.save) return Promise.resolve(null);
      return dialog.save(options || {});
    },
    message(text, options) {
      if (!dialog?.message) return Promise.resolve();
      return dialog.message(text, options || {});
    },
    confirm(text, options) {
      if (!dialog?.confirm) return Promise.resolve(false);
      return dialog.confirm(text, options || {});
    }
  };

  window.__POORIJA_DESKTOP_NOTIFICATION__ = {
    isPermissionGranted() {
      if (!notification?.isPermissionGranted) return Promise.resolve(false);
      return notification.isPermissionGranted();
    },
    requestPermission() {
      if (!notification?.requestPermission) return Promise.resolve('denied');
      return notification.requestPermission();
    },
    sendNotification(options) {
      if (!notification?.sendNotification) return Promise.resolve();
      return notification.sendNotification(options || {});
    }
  };

  /* Base64 for the vault snapshot. The payload is already ciphertext by the
     time it reaches here, and it can be tens of megabytes — btoa() on a single
     string built with String.fromCharCode(...bytes) blows the argument limit
     somewhere around 100k bytes, hence the chunking. */
  const CHUNK = 0x8000;
  function bytesToBase64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    for (let offset = 0; offset < view.length; offset += CHUNK) {
      binary += String.fromCharCode.apply(null, view.subarray(offset, offset + CHUNK));
    }
    return btoa(binary);
  }
  function base64ToBytes(text) {
    const binary = atob(String(text || ''));
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      out[index] = binary.charCodeAt(index);
    }
    return out;
  }

  /* Every external link in the UI is target="_blank", and Tauri denies new
     windows — so those links silently did nothing here. Intercepting the click
     and handing the URL to the system browser is both the working behaviour
     and the safe one: letting it navigate in place would replace the app with
     a web page in a window that has no back button and no way home.

     Bound on the document in the capture phase, not on the links: the chat
     thread rebuilds every bubble on each render, so per-element listeners
     would not survive, and composedPath() is read at dispatch and therefore
     still correct even when the handler's own re-render detached the node. */
  document.addEventListener('click', (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const link = path.find((node) => node?.tagName === 'A' && node.getAttribute?.('href'))
      || (event.target?.closest ? event.target.closest('a[href]') : null);
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    invoke('desktop_open_external', { url: href }).catch((error) => {
      console.error('Could not open the link externally:', error);
    });
  }, true);

  window.PoorijaDesktop = {
    available: true,
    invoke,

    /* ---- window & shell ---- */
    showWindow: () => invoke('desktop_show_window'),
    hideWindow: () => invoke('desktop_hide_window'),
    quit: () => invoke('desktop_quit'),
    setBadgeCount: (count) => invoke('desktop_set_badge_count', { count: count || null }),
    platformInfo: () => invoke('desktop_platform_info'),

    /* ---- background / tray behaviour ---- */
    getShellSettings: () => invoke('desktop_get_shell_settings'),
    setShellSettings: (settings) => invoke('desktop_set_shell_settings', {
      settings: {
        closeBehavior: settings.closeBehavior === 'quit' ? 'quit' : 'tray',
        startMinimized: Boolean(settings.startMinimized),
        autostart: Boolean(settings.autostart)
      }
    }),

    /* ---- on-system encrypted vault copy ---- */
    vaultDir: () => invoke('desktop_vault_dir'),
    appDataDir: () => invoke('desktop_app_data_dir'),
    listVaultFiles: () => invoke('desktop_list_app_files'),
    deleteVaultFile: (name) => invoke('desktop_delete_app_file', { name }),
    writeVaultFile(name, bytes) {
      return invoke('desktop_write_app_file', { name, dataB64: bytesToBase64(bytes) });
    },
    async readVaultFile(name) {
      const payload = await invoke('desktop_read_app_file', { name });
      return payload ? base64ToBytes(payload) : null;
    },

    /* ---- ~/.ssh ---- */
    sshDirPath: () => invoke('desktop_ssh_dir_path'),
    sshList: (subpath) => invoke('desktop_ssh_list_entries', { subpath: subpath || null }),
    sshRead: (name, subpath) =>
      invoke('desktop_ssh_read_file', { name, subpath: subpath || null }),
    sshWrite: (name, contents, isPrivate = true) =>
      invoke('desktop_ssh_write_file', { name, contents, private: isPrivate }),
    sshDelete: (name) => invoke('desktop_ssh_delete_file', { name }),
    sshAppendAuthorizedKey: (line) => invoke('desktop_ssh_append_authorized_key', { line }),

    /* ---- secure deletion ---- */
    shredFile: (path, removeAfterShred = true) =>
      invoke('desktop_shred_file', { path, removeAfterShred }),

    /* ---- relay discovery ---- */
    probeRelayOrigin: (origin) => invoke('desktop_probe_relay_origin', { origin }),

    /* ---- external links ---- */
    openExternal: (url) => invoke('desktop_open_external', { url }),

    bytesToBase64,
    base64ToBytes
  };
})();
