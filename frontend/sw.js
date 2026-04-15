// Service Worker fuer entlast.de - Reines Asset-Caching (kein IndexedDB-Sync)
const CACHE_NAME = 'entlast-app-v62';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './login.html',
    './pages/kunden.html',
    './pages/leistung.html',
    './pages/fahrten.html',
    './pages/termine.html',
    './pages/abtretung.html',
    './pages/rechnung.html',
    './pages/entlastung.html',
    './pages/settings.html',
    './css/style.css',
    './css/patches.css',
    './js/auth.js',
    './js/db.js',
    './js/app-init.js',
    './js/app.js',
    './js/kunden.js',
    './js/leistung.js',
    './js/fahrten.js',
    './js/termine.js',
    './js/abtretung.js',
    './js/rechnung.js',
    './js/settings.js',
    './js/signature.js',
    './js/pdf.js',
    './js/entlastung.js',
    './js/services-shim.js',
    './manifest.json'
];

// CDN-Ressourcen (kein Dexie mehr!)
const CDN_ASSETS = [
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/signature_pad@4.1.7/dist/signature_pad.umd.min.js'
];

// Installation: Alle Assets cachen
self.addEventListener('install', event => {
    console.log('[SW] Installation gestartet');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            const localPromise = cache.addAll(ASSETS_TO_CACHE).catch(err => {
                console.warn('[SW] Einige lokale Assets konnten nicht gecacht werden:', err);
            });
            const cdnPromises = CDN_ASSETS.map(url =>
                cache.add(url).catch(err => {
                    console.warn('[SW] CDN-Asset konnte nicht gecacht werden:', url, err);
                })
            );
            return Promise.all([localPromise, ...cdnPromises]);
        })
    );
    self.skipWaiting();
});

// Aktivierung: Alte Caches loeschen
self.addEventListener('activate', event => {
    console.log('[SW] Aktiviert');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(name => {
                    if (name !== CACHE_NAME) {
                        console.log('[SW] Alter Cache geloescht:', name);
                        return caches.delete(name);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch: Network-First fuer HTML/API, Cache-First fuer Assets
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // API-Requests NICHT cachen - direkt ans Netzwerk
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
        return;
    }

    event.respondWith(
        fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseClone);
                });
            }
            return networkResponse;
        }).catch(() => {
            return caches.match(event.request).then(cachedResponse => {
                if (cachedResponse) return cachedResponse;
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
                return new Response('Offline - Ressource nicht verfuegbar', {
                    status: 503,
                    statusText: 'Service Unavailable'
                });
            });
        })
    );
});
