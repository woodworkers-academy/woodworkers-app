const CACHE_NAME = 'van-inventory-shell-v1.20.11';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=1.20.11',
  './pwa.js?v=1.20.11',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

async function fetchFresh(requestOrUrl) {
  return fetch(requestOrUrl, { cache: 'no-store' });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Fetch the new shell from the network instead of accepting an old HTTP-cache copy.
    await Promise.all(APP_SHELL.map(async url => {
      const response = await fetchFresh(url);
      if (!response || (!response.ok && response.type !== 'opaque')) {
        throw new Error('Could not cache ' + url);
      }
      await cache.put(url, response.clone());
      // Keep unversioned aliases for offline fallback of the core files.
      if (url.startsWith('./styles.css?')) await cache.put('./styles.css', response.clone());
      if (url.startsWith('./pwa.js?')) await cache.put('./pwa.js', response.clone());
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never cache or intercept the live Apps Script API.
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('googleusercontent.com')) return;

  // APP SHELL: CACHE FIRST, REFRESH IN BACKGROUND.
  // This prevents a weak-but-not-offline connection from making the app appear hung.
  // If a cached shell exists, show it immediately and update the cache asynchronously.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = (await caches.match('./index.html')) || (await caches.match('./'));
      if (cached) {
        event.waitUntil((async () => {
          try {
            const response = await fetchFresh(request);
            if (response && response.ok) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put('./index.html', response.clone());
            }
          } catch (_) {}
        })());
        return cached;
      }

      // First-ever load has no cache, so network is required.
      try {
        const response = await fetchFresh(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('./index.html', response.clone());
          return response;
        }
      } catch (_) {}

      return new Response('Van Inventory is offline and the app shell has not been cached yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    })());
    return;
  }

  // Core code/styles also load from cache immediately and refresh in the background.
  const isCoreAsset = url.origin === self.location.origin &&
    (url.pathname.endsWith('/pwa.js') || url.pathname.endsWith('/styles.css'));

  if (isCoreAsset) {
    event.respondWith((async () => {
      const fallback = url.pathname.endsWith('/pwa.js') ? './pwa.js' : './styles.css';
      const cached = (await caches.match(request)) || (await caches.match(fallback));

      if (cached) {
        event.waitUntil((async () => {
          try {
            const response = await fetchFresh(request);
            if (response && response.ok) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(request, response.clone());
              await cache.put(fallback, response.clone());
            }
          } catch (_) {}
        })());
        return cached;
      }

      // First-ever load of the asset.
      try {
        const response = await fetchFresh(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
          await cache.put(fallback, response.clone());
          return response;
        }
      } catch (_) {}

      return new Response('', { status: 503 });
    })());
    return;
  }

  // Other same-origin/static assets remain cache-first.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
