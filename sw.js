/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

const CACHE_NAME = 'poorija-cryptography-v2.35.0-chat-v66';

// Live endpoints proxied by nginx: never cached, always straight to the network.
const NETWORK_ONLY_PREFIXES = [
  '/Monitor_Server', '/healthz', '/admin/', '/peerjs', '/chat-signal',
  '/chat-health', '/turn-config', '/cert-status', '/push/'
];
// App shell code: served network-first so a deployed fix reaches installed
// PWAs on the next launch instead of being pinned by the cache-first match
// below (which ignores search params and therefore defeats ?v= busting).
const SHELL_PATTERN = /\.(?:html|css|js|webmanifest)$/i;
const NETWORK_TIMEOUT_MS = 3500;
const SHARE_TARGET_URL = './index.html?share-target=1#share';
const SHARE_TARGET_CACHE_KEY = './__share_target__/latest';

// Core assets required for the app shell and initial lock screen
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/tailwind/tailwind.generated.css',
  './css/styles.css',
  './js/crypto-core.js',
  './js/stego.js',
  './js/qr-kit.js',
  './js/tools-extra.js',
  './js/local-link.js',
  './js/local-mesh.js',
  './js/local-room.js',
  './js/vault-profiles.js',
  './js/crypto-config.js',
  './js/relay-hints.js',
  './js/app.js',
  './sw.js',
  './vendor/fontawesome/css/all.min.css',
  './vendor/hash-wasm/argon2.umd.min.js',
  './assets/icon-app.png',
  './fonts/Vazirmatn/Vazirmatn-VariableFont_wght.ttf',
  './fonts/Inter-Regular.ttf'
];

// Assets that can be loaded lazily in the background
const LAZY_ASSETS = [
  './js/chat/01-constants.js',
  './js/chat/02-media-vault.js',
  './js/chat/03-call-screen.js',
  './js/chat/04-call-layout.js',
  './js/chat/05-structured-messages.js',
  './js/chat/06-groups.js',
  './js/chat/07-conversation-lock.js',
  './js/chat/08-global-search.js',
  './js/chat/09-the-emoji-key.js',
  './js/chat/10-selection.js',
  './js/chat/11-group-permissions.js',
  './js/chat/12-group-call-mesh.js',
  './js/chat/13-group-call-stage.js',
  './js/chat/14-group-call-roster.js',
  './js/chat/15-group-call-render.js',
  './js/chat/16-group-call-signalling.js',
  './js/chat/17-file-manager.js',
  './js/chat/18-file-manager-2.js',
  './js/chat/19-forward-secrecy.js',
  './js/chat/20-call-rows.js',
  './js/chat/21-chat-list-filters.js',
  './js/chat/22-drafts.js',
  './js/chat/23-export-import.js',
  './js/chat/24-settings-panels.js',
  './js/chat/25-call-log.js',
  './js/chat/26-contacts.js',
  './js/chat/27-message-render.js',
  './js/chat/28-offline-envelopes.js',
  './js/chat/29-file-transfer.js',
  './js/chat/30-file-transfer-2.js',
  './js/chat/31-file-transfer-3.js',
  './js/chat/32-file-transfer-4.js',
  './js/chat/33-rail-header.js',
  './js/chat/34-sheets-profile-clocks.js',
  './js/chat/35-sheets-profile-clocks-2.js',
  './js/chat/36-sheets-profile-clocks-3.js',
  './js/chat/37-chat-tools.js',
  './js/dialogs.js',
  './js/desktop-bridge.js',
  './js/metadata.js',
  './js/voice-changer.js',
  './js/help-content.js',
  './js/games.js',
  './assets/pwa-icons/apple-touch-icon.png',
  './js/ssh-keys.js',
  './js/advanced-crypto.js',
  './js/backup.js',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './vendor/fontawesome/webfonts/fa-regular-400.woff2',
  './vendor/fontawesome/webfonts/fa-brands-400.woff2',
  './vendor/jszip/jszip.min.js',
  './vendor/lottie/lottie_light.min.js',
  './vendor/qrcodejs/qrcode.min.js',
  './vendor/jsqr/jsQR.js',
  './vendor/peerjs/peerjs.min.js',
  './vendor/otpauth/otpauth.umd.min.js',
  './assets/desktop-icons/system-settings.svg',
  './assets/desktop-icons/system-terminal.svg',
  './assets/desktop-icons/system-notes.svg',
  './assets/desktop-icons/system-folder.svg',
  './assets/profile-avatars/aegis.svg',
  './assets/profile-avatars/cipher.svg',
  './assets/profile-avatars/nebula.svg',
  './assets/profile-avatars/onyx.svg',
  './assets/profile-avatars/saffron.svg',
  './assets/profile-avatars/teal.svg',
  './fonts/BYekan.ttf',
  './fonts/tahoma.ttf'
];

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Only pre-cache core assets
    await cache.addAll(CORE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    );
    
    // Background cache lazy assets
    const cache = await caches.open(CACHE_NAME);
    cache.addAll(LAZY_ASSETS).catch(err => console.warn('Lazy caching failed:', err));
    
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.searchParams.has('share-target')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const formData = await event.request.formData();
      const files = formData.getAll('files');
      const title = formData.get('title') || '';
      const text = formData.get('text') || '';
      const urlParam = formData.get('url') || '';

      const sharedData = {
        title,
        text,
        url: urlParam,
        files: await Promise.all(files.map(async (f) => {
          const encoded = arrayBufferToBase64(await f.arrayBuffer());
          // Both keys, one value: the page reader looks for `base64`, while a
          // still-cached older page reads `content`. Cheaper than a lost file.
          return { name: f.name, type: f.type, size: f.size, lastModified: f.lastModified, base64: encoded, content: encoded };
        }))
      };

      await cache.put(SHARE_TARGET_CACHE_KEY, new Response(JSON.stringify(sharedData)));
      return Response.redirect(SHARE_TARGET_URL, 303);
    })());
    return;
  }

  if (event.request.method !== 'GET') return;

  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return; // let the browser talk to the signalling/TURN/admin services directly
  }

  const isNavigation = event.request.mode === 'navigate';
  const isShell = sameOrigin && (isNavigation || SHELL_PATTERN.test(url.pathname));

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    const fromNetwork = async () => {
      const response = await fetch(event.request);
      if (response && response.status === 200 && (url.protocol === 'http:' || url.protocol === 'https:')) {
        cache.put(event.request, response.clone()).catch(() => { /* quota */ });
      }
      return response;
    };

    if (isShell) {
      // Network-first with a short leash: a slow or offline network falls back
      // to the cached shell, a reachable one always wins so updates land.
      try {
        const raced = await Promise.race([
          fromNetwork(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('slow-network')), NETWORK_TIMEOUT_MS))
        ]);
        if (raced) return raced;
      } catch (error) { /* fall through to the cache */ }
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      if (isNavigation) {
        const shell = await cache.match('./index.html', { ignoreSearch: true });
        if (shell) return shell;
      }
      return fromNetwork();
    }

    // Immutable-ish assets (fonts, vendor bundles, icons): cache-first.
    const cachedResponse = await cache.match(event.request, { ignoreSearch: true });
    if (cachedResponse) return cachedResponse;
    try {
      return await fromNetwork();
    } catch (e) {
      if (isNavigation) {
        return cache.match('./index.html', { ignoreSearch: true });
      }
      throw e;
    }
  })());
});


self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* The delivery end of Web Push. Without this listener the browser receives the
   message, finds nothing to display it with, and — because the subscription is
   userVisibleOnly — falls back to its own "this site was updated in the
   background" notice or penalises the subscription outright. The server never
   sends anything but a fixed line: no sender, no preview, no message text, so
   there is nothing here to leak on a locked screen. */
/* How many arrivals the counter bubble on the installed icon should show.
 *
 * Counted from the notifications the OS is currently holding, not from a
 * variable: that list is the only tally that survives a service-worker
 * restart, and a worker is stopped and restarted between pushes as a matter of
 * course.
 *
 * The number is only reported. It is NOT painted here, and the Badging API is
 * never called from this file, although self.navigator.setAppBadge and
 * clearAppBadge are both present in worker scope and pass a typeof check.
 * Calling either of them from a service worker kills the renderer process
 * outright — the app window disappears, taking the unlocked vault with it. So
 * the worker sends the number to whatever windows exist and the page, where
 * the same API is well behaved and syncAppBadge() has always used it, paints
 * it. When no window exists there is nothing to paint on: the count still
 * reaches the user, in the notification's own "N unread" line, and the page
 * asks for it the moment it opens. */
/* Every row carries the RUNNING TOTAL for its tag, not its own single arrival,
   so rows sharing a tag are folded with max() and never added up. Adding them
   is what produced 1, 2, 4, 8, 16, 32, 64 on a real phone: see the note on
   showPushNotice() below. Rows with different tags — a call beside a chat —
   are genuinely separate and do add. */
async function outstandingNoticeCount() {
  try {
    const showing = await self.registration.getNotifications();
    const highestPerTag = new Map();
    showing.forEach((item) => {
      const key = item.tag || 'poorija-chat';
      const running = Number(item.data?.count) || 1;
      highestPerTag.set(key, Math.max(highestPerTag.get(key) || 0, running));
    });
    return [...highestPerTag.values()].reduce((sum, value) => sum + value, 0);
  } catch (error) {
    return 0;
  }
}
/* An engine check, not a feature check, and the difference matters.
 *
 * self.navigator.setAppBadge and clearAppBadge are PRESENT in worker scope on
 * Chromium and pass a typeof test, and calling either one from there kills the
 * renderer process — the window disappears and the unlocked vault goes with
 * it. That was reproduced in this repository, which is why every other engine
 * is served by posting the number to the page instead.
 *
 * WebKit is the one engine where that does not help. An iOS web app on the
 * Home Screen has no page running when it is closed, and the icon's bubble is
 * the whole point of the feature: there is nothing to post to and nothing else
 * that paints it. So on WebKit, and only on WebKit, the worker paints it
 * itself. If a WebKit build ever behaves like Chromium here, this is the line
 * to take out. */
function workerMayPaintBadge() {
  const agent = String(self.navigator?.userAgent || '');
  if (!/AppleWebKit/i.test(agent)) return false;
  if (/Chrome|Chromium|Edg|OPR|SamsungBrowser/i.test(agent)) return false;
  return typeof self.navigator?.setAppBadge === 'function';
}
async function paintBadgeHere(count) {
  if (!workerMayPaintBadge()) return;
  try {
    if (count > 0) await self.navigator.setAppBadge(Math.min(99, count));
    else if (typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge();
  } catch (error) {
    /* A badge is a nicety; it is never a reason for a message not to arrive. */
  }
}
async function reportBadgeCount() {
  const count = await outstandingNoticeCount();
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach((client) => {
    try { client.postMessage({ type: 'poorija-badge', count }); } catch (error) { /* gone */ }
  });
  /* A page that is running paints it too, and setting the same number twice is
     harmless. When the app is shut this is the only one that happens. */
  await paintBadgeHere(count);
  return count;
}

/* The relay knows which language the device asked for when it subscribed and
   says so in the payload, so the count line does not have to be guessed here
   — the service worker has no access to the app's language setting. */
function unreadCountLine(count, lang) {
  if (count < 2) return '';
  return String(lang || '').toLowerCase().startsWith('fa')
    ? `${count} پیام خوانده‌نشده.`
    : `${count} unread.`;
}

/* One arrival, one notice — and never the same arrival twice.
 *
 * A message that lands while the app is on screen is already announced by the
 * page itself, with the sender's name and the text, neither of which a
 * background notice is allowed to carry. Raising a system banner beside that
 * toast showed the user the same message twice. A window that is open but
 * hidden behind another app is not on screen and suppresses nothing.
 *
 * When the banner is warranted, the tag makes it replace its predecessor
 * instead of stacking identical rows, and renotify makes the device alert
 * again for each one, so every message is still announced. The running total
 * is read back off the row about to be replaced and carried on the new one. */
async function showPushNotice(payload) {
  const tag = payload.tag || 'poorija-chat';
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const onScreen = windows.some((client) => client.visibilityState === 'visible' && client.focused);
  if (onScreen) {
    await reportBadgeCount();
    return;
  }
  /* Two things were assumed here and neither is true on WebKit.
     The first: that showing a notification with a tag REPLACES the one already
     carrying it. Chromium does; iOS does not, so the rows stacked up. They are
     closed by hand instead, which is correct on both.
     The second: that the rows could be added up to get a total. Each row holds
     the running total for its tag, so adding rows that are all still on screen
     squares the problem — 1, then 1+1, then 1+2+1, then 1+2+4+1: the sum of
     2^0..2^(n-1) plus one is 2^n, which is exactly the 1, 2, 4, 8, 16, 32, 64
     a phone reported. The newest row already knows the total, so the highest
     one is the answer and the new count is that plus this single arrival. */
  const showing = await self.registration.getNotifications({ tag });
  const running = showing.reduce((highest, item) => Math.max(highest, Number(item.data?.count) || 1), 0);
  const count = running + 1;
  showing.forEach((item) => item.close());
  const body = [payload.body || '', unreadCountLine(count, payload.lang)].filter(Boolean).join(' ');
  await self.registration.showNotification(payload.title || 'P00RIJA Cryptography', {
    body,
    tag,
    renotify: true,
    icon: './assets/pwa-icons/icon-192.png',
    badge: './assets/pwa-icons/icon-192.png',
    data: { url: payload.url || './index.html#chat', ...(payload.data || {}), count },
  });
  await reportBadgeCount();
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(showPushNotice(payload));
});

/* Swiping a notice away is the user saying they have seen it; the bubble has
   to agree or it counts things that are no longer anywhere on the device. */
self.addEventListener('notificationclose', (event) => {
  event.waitUntil(reportBadgeCount());
});

/* Two questions only the page can answer, so it asks rather than being asked:
   whether the chat has actually been read (it can see that the conversation is
   open and unlocked, which nothing in here can), and what the counter should
   say when a window has just opened onto a pile of notices that arrived while
   the app was shut. */
self.addEventListener('message', (event) => {
  const kind = event.data?.type;
  if (kind === 'poorija-clear-notifications') {
    event.waitUntil((async () => {
      const showing = await self.registration.getNotifications();
      showing.forEach((item) => item.close());
      await reportBadgeCount();
    })());
    return;
  }
  if (kind === 'poorija-badge-query') {
    event.waitUntil(reportBadgeCount());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    await reportBadgeCount();
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let chatClient = null;

    for (const client of allClients) {
      const url = new URL(client.url);
      if (url.pathname.includes('index.html') || url.pathname === '/') {
        chatClient = client;
        break;
      }
    }

    /* Where the relay asked us to land. It has been setting this on every push
       and nothing read it; the hard-coded path below disagreed with it too. */
    const targetUrl = event.notification?.data?.url || './index.html#chat';
    if (chatClient) {
      if ('focus' in chatClient) {
        await chatClient.focus();
      }
      /* FOCUS ONLY. navigate() on a client that is already showing the app is
         a full reload: the page is torn down and rebuilt, which in this app
         means the vault closes and the person is back at the lock screen —
         for the crime of tapping the notification that told them a message had
         arrived. Navigate only when the window is somewhere else entirely. */
      const alreadyHere = (() => {
        try {
          const here = new URL(chatClient.url);
          const want = new URL(targetUrl, self.location.href);
          return here.origin === want.origin && here.pathname === want.pathname;
        } catch (_error) {
          return true;
        }
      })();
      if (!alreadyHere && 'navigate' in chatClient) {
        await chatClient.navigate(targetUrl);
      }
      return;
    }

    await self.clients.openWindow(targetUrl);
  })());
});
