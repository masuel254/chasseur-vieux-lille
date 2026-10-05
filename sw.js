// Service worker : coquille de l'appli en cache, données toujours demandées au serveur.
// À CHAQUE MISE EN LIGNE : changer VERSION, sinon les téléphones gardent l'ancienne version.
const VERSION = 'v1.6.0';
const CACHE = 'chasseur-' + VERSION;
const COQUILLE = ['./', 'index.html', 'app.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('chasseur-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API, photos, polices : réseau direct
  // Réseau d'abord pour avoir la dernière version, cache en secours hors ligne.
  // cache: 'no-cache' : GitHub Pages autorise 10 min de cache navigateur, on revalide à chaque fois
  // pour qu'une mise à jour s'affiche tout de suite.
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((r) => {
    if (r.ok) { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
    return r;
  }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
});
