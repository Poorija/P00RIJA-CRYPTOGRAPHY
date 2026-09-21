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
 * Diagnostic harness for the native shell — injected into dist/tauri only when
 * the bundle is prepared with POORIJA_NATIVE_PROBE=1, and never otherwise.
 *
 *   POORIJA_NATIVE_PROBE=1 npx tauri build --debug --bundles app --target aarch64-apple-darwin
 *   NSAppSleepDisabled=1 "src-tauri/target/<triple>/debug/bundle/macos/P00RIJA Cryptography.app/Contents/MacOS/p00rija-cryptography"
 *
 * Everything it reports goes to the process's stderr through
 * desktop_debug_log, because the webview's own console goes nowhere visible.
 * NSAppSleepDisabled matters: a window that is not frontmost gets its timers
 * coalesced by App Nap and the later reports simply never arrive.
 */
(function () {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) return;
  const say = (note) => {
    try {
      tauri.core.invoke('desktop_debug_log', {
        note: typeof note === 'string' ? note : JSON.stringify(note),
      });
    } catch (error) { /* the bridge is the thing under test */ }
  };

  const errors = [];
  window.addEventListener('error', (event) => {
    errors.push(`${event.message || '?'} @ ${event.filename || '?'}:${event.lineno || 0}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    errors.push('REJECTED ' + String(event.reason?.message || event.reason));
  });

  /* Relay every console warn/error to the shell, and log every WebSocket the
   * app opens or loses. The teardown that drops a working connection never
   * shows in the UI beyond "recovering…" — this is how it gets a name. */
  ['error', 'warn'].forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      try {
        const text = args.map((a) => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch (e) { return String(a); }
        }).join(' ').slice(0, 400);
        say({ stage: 'console.' + level, text });
      } catch (e) { /* reporting must never throw */ }
      original(...args);
    };
  });
  const OriginalWebSocket = window.WebSocket;
  function LoggedWebSocket(url, protocols) {
    const ws = protocols !== undefined ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    const label = String(url).slice(0, 120);
    say({ stage: 'wsCreate', url: label });
    ws.addEventListener('open', () => say({ stage: 'wsOpen', url: label }));
    ws.addEventListener('close', (event) => say({ stage: 'wsClose', url: label, code: event.code, reason: event.reason, wasClean: event.wasClean }));
    ws.addEventListener('error', () => say({ stage: 'wsError', url: label }));
    return ws;
  }
  LoggedWebSocket.prototype = OriginalWebSocket.prototype;
  LoggedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  LoggedWebSocket.OPEN = OriginalWebSocket.OPEN;
  LoggedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
  LoggedWebSocket.CLOSED = OriginalWebSocket.CLOSED;
  window.WebSocket = LoggedWebSocket;

  /* The check that would have caught the CSP failure: a global being defined
     says nothing about whether an inline attribute is allowed to run. */
  function inlineHandlersWork() {
    try {
      const probe = document.createElement('button');
      probe.setAttribute('onclick', 'window.__poorijaInlineFired = true;');
      document.body.appendChild(probe);
      probe.click();
      probe.remove();
      return window.__poorijaInlineFired === true;
    } catch (error) {
      return 'threw: ' + error.message;
    }
  }

  function snapshot(stage) {
    const main = document.getElementById('mainApp');
    return {
      stage,
      readyState: document.readyState,
      /* Secure context is not academic here: without it crypto.subtle is
         undefined and the entire suite is inert. */
      secureContext: window.isSecureContext === true,
      webCrypto: typeof crypto?.subtle?.encrypt === 'function',
      inlineHandlers: document.body ? inlineHandlersWork() : 'no-body',
      bridge: !!window.PoorijaDesktop?.available,
      app: typeof window.PoorijaApp,
      chatLoaded: typeof window.PoorijaChat !== 'undefined' || !!document.getElementById('content-chat'),
      desktopCard: !!document.getElementById('desktopShellCard'),
      lockVisible: !document.getElementById('lockScreen')?.classList.contains('hidden'),
      mainOpacity: main ? getComputedStyle(main).opacity : 'no-main',
      scripts: document.querySelectorAll('script[src]').length,
      errors: errors.slice(0, 6),
    };
  }

  say('probe attached');

  /* Heartbeat.
   *
   * The question this answers cannot be answered by looking at the process
   * list: Android keeps the process alive under a foreground service, but
   * WryActivity.onPause() calls WebView.onPause(), which suspends every timer
   * and all JavaScript. A living process with a frozen webview receives
   * nothing. console.log reaches logcat through RustWebChromeClient, so
   * watching this tick while the app is on the Home screen is the actual
   * proof that the relay connection can still do work. */
  let beat = 0;
  setInterval(() => {
    beat += 1;
    console.log(`[poorija-heartbeat] ${beat} visible=${document.visibilityState} at=${new Date().toISOString()}`);
  }, 2000);
  document.addEventListener('DOMContentLoaded', () => say(snapshot('dom-content-loaded')));
  window.addEventListener('load', () => setTimeout(() => {
    say(snapshot('load+2s'));
    /* Round-trip a real command so a broken IPC path shows up as a failure
       rather than as silence. */
    window.PoorijaDesktop?.platformInfo()
      .then((info) => say({ stage: 'platformInfo', ok: true, info }))
      .catch((error) => say({ stage: 'platformInfo', ok: false, error: String(error) }));
    window.PoorijaDesktop?.getShellSettings()
      .then((settings) => say({ stage: 'shellSettings', ok: true, settings }))
      .catch((error) => say({ stage: 'shellSettings', ok: false, error: String(error) }));
    window.PoorijaDesktop?.sshDirPath()
      .then((path) => say({ stage: 'sshDir', ok: true, path }))
      .catch((error) => say({ stage: 'sshDir', ok: false, error: String(error) }));
    /* Proves the external-link command is registered *and* that its scheme
       guard holds, without actually opening anything: a rejection here is the
       pass. Handing file:// to the system opener would be a way for a chat
       message to make the shell act on a local path. */
    /* The dialogs the native shell cannot draw itself. A confirm that never
       resolves, or resolves false because wry answered for it, is how every
       delete in the app quietly did nothing. */
    (async () => {
      try {
        const pressLater = (selector) => setTimeout(() => document.querySelector(selector)?.click(), 80);
        const confirmPromise = window.PoorijaDialogs.confirm('probe');
        pressLater('.poorija-dialog-ok');
        const confirmed = await confirmPromise;

        const promptPromise = window.PoorijaDialogs.prompt('probe', { password: true });
        setTimeout(() => {
          const field = document.querySelector('.poorija-dialog-input');
          if (field) field.value = '1234';
          document.querySelector('.poorija-dialog-ok')?.click();
        }, 80);
        const typed = await promptPromise;

        say({ stage: 'dialogs', ok: confirmed === true && typed === '1234', confirmed, typed,
              native: (() => {
                try {
                  const r = window.confirm('native probe');
                  return {
                    type: typeof r,
                    isPromise: r instanceof Promise || typeof r?.then === 'function',
                    truthy: Boolean(r),
                    ctor: r?.constructor?.name || String(r),
                    promptType: (() => { const q = window.prompt('p', ''); return { type: typeof q, isNull: q === null, ctor: q?.constructor?.name || String(q) }; })(),
                  };
                } catch (e) { return { threw: String(e) }; }
              })() });
      } catch (error) {
        say({ stage: 'dialogs', ok: false, error: String(error) });
      }
    })();
    window.PoorijaDesktop?.openExternal('file:///etc/passwd')
      .then(() => say({ stage: 'openExternal', ok: false, note: 'file:// was ACCEPTED — that is a bug' }))
      .catch((error) => say({ stage: 'openExternal', ok: true, rejected: String(error) }));

    /* The relay question, answered from inside the webview: can this origin
       actually open the signalling WebSocket and use crypto.subtle? A curl on
       the host proves nothing about either. */
    (async () => {
      const origin = window.PoorijaChat?.serverOrigin?.() || window.__POORIJA_RELAY_HINTS__?.[0] || 'https://chat.example.com:8585';
      say({ stage: 'relayProbe.start', origin, locationOrigin: window.location.origin });
      const wsUrl = origin.replace(/^http/, 'ws') + '/chat-signal';
      await new Promise((resolve) => {
        const started = Date.now();
        let ws;
        try {
          ws = new WebSocket(wsUrl);
        } catch (error) {
          say({ stage: 'relayProbe.ws', ok: false, threw: String(error) });
          return resolve();
        }
        const done = (what, extra) => {
          say({ stage: 'relayProbe.ws.' + what, ok: what === 'open', ms: Date.now() - started, ...(extra || {}) });
          try { ws.close(); } catch (e) { /* noop */ }
          resolve();
        };
        ws.onopen = () => done('open');
        ws.onerror = () => done('error');
        ws.onclose = (event) => done('close', { code: event.code, reason: event.reason });
        setTimeout(() => done('timeout'), 8000);
      });
      try {
        const t0 = Date.now();
        const pair = await crypto.subtle.generateKey(
          { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
          true, ['encrypt', 'decrypt']);
        say({ stage: 'relayProbe.rsa', ok: true, ms: Date.now() - t0, alg: pair.privateKey.algorithm.name });
      } catch (error) {
        say({ stage: 'relayProbe.rsa', ok: false, error: String(error) });
      }
      try {
        const response = await fetch(origin + '/chat-health', { accept: 'application/json' });
        say({ stage: 'relayProbe.fetch', ok: response.ok, status: response.status });
      } catch (error) {
        say({ stage: 'relayProbe.fetch', ok: false, error: String(error) });
      }
    })();

    /* Chat-state watchdog: every 10s report what the chat module is actually
     * using, so an unlock that happens minutes after launch still gets seen.
     * IndexedDB is checked because identity persistence lives there — a
     * stalled ensureIdentity() shows up as "crypto fine but no fingerprint,
     * no dial" and this names it. Once the fingerprint appears (vault opened,
     * identity minted), force the presence dial once via goOnline(). */
    let chatTicks = 0;
    let forcedOnline = false;
    setInterval(() => {
      chatTicks += 1;
      const chat = window.PoorijaChat;
      const summary = {
        stage: 'chatTick' + chatTicks,
        serverOrigin: typeof chat?.serverOrigin === 'function' ? chat.serverOrigin() : null,
        fingerprint: typeof chat?.identityFingerprint === 'function' ? chat.identityFingerprint() : null,
        peerLib: typeof window.Peer,
        peerExists: Boolean(window.PoorijaApp && window.PoorijaChat),
      };
      (async () => {
        try {
          const t0 = Date.now();
          await new Promise((resolve, reject) => {
            const req = indexedDB.open('poorija-probe', 1);
            req.onupgradeneeded = () => { try { req.result.createObjectStore('k'); } catch (e) { /* exists */ } };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('idb open failed'));
            req.onblocked = () => reject(new Error('idb blocked'));
            setTimeout(() => reject(new Error('idb timeout 5s')), 5000);
          });
          summary.idb = 'ok ' + (Date.now() - t0) + 'ms';
        } catch (error) {
          summary.idb = 'FAIL: ' + String(error?.message || error);
        }
        say(summary);
        if (!forcedOnline && summary.fingerprint && typeof chat?.goOnline === 'function') {
          forcedOnline = true;
          try {
            chat.goOnline();
            say({ stage: 'forcedGoOnline', ok: true });
          } catch (error) {
            say({ stage: 'forcedGoOnline', ok: false, error: String(error) });
          }
        }
      })();
    }, 10000);
  }, 2000));
})();
