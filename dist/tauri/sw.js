const CACHE_NAME = 'poorija-cryptography-v2.99.0-mobile-connection-turn-v1';
const SHARE_TARGET_URL = './index.html?share-target=1#share';
const SHARE_TARGET_CACHE_KEY = './__share_target__/latest';

// Core assets required for the app shell and initial lock screen
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/tailwind/tailwind.generated.css',
  './css/styles.css',
  './js/crypto-config.js',
  './js/relay-hints.js',
  './js/app.js',
  './sw.js',
  './vendor/fontawesome/css/all.min.css',
  './vendor/crypto-js/crypto-js.min.js',
  './assets/icon-app.png',
  './fonts/Vazirmatn/Vazirmatn-VariableFont_wght.ttf',
  './fonts/Inter-Regular.ttf'
];

// Assets that can be loaded lazily in the background
const LAZY_ASSETS = [
  './js/chat.js',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './vendor/fontawesome/webfonts/fa-regular-400.woff2',
  './vendor/fontawesome/webfonts/fa-brands-400.woff2',
  './vendor/jszip/jszip.min.js',
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
        files: await Promise.all(files.map(async (f) => ({
          name: f.name,
          type: f.type,
          size: f.size,
          lastModified: f.lastModified,
          content: arrayBufferToBase64(await f.arrayBuffer())
        })))
      };

      await cache.put(SHARE_TARGET_CACHE_KEY, new Response(JSON.stringify(sharedData)));
      return Response.redirect(SHARE_TARGET_URL, 303);
    })());
    return;
  }

  if (event.request.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(event.request, { ignoreSearch: true });
    if (cachedResponse) return cachedResponse;

    try {
      const networkResponse = await fetch(event.request);
      if (networkResponse && networkResponse.status === 200) {
        const url = new URL(event.request.url);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          cache.put(event.request, networkResponse.clone());
        }
      }
      return networkResponse;
    } catch (e) {
      if (event.request.mode === 'navigate') {
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let chatClient = null;

    for (const client of allClients) {
      const url = new URL(client.url);
      if (url.pathname.includes('index.html') || url.pathname === '/') {
        chatClient = client;
        break;
      }
    }

    const targetUrl = './index.html#chat';
    if (chatClient) {
      if ('focus' in chatClient) {
        await chatClient.focus();
      }
      if ('navigate' in chatClient) {
        await chatClient.navigate(targetUrl);
      }
      return;
    }

    await self.clients.openWindow(targetUrl);
  })());
});
