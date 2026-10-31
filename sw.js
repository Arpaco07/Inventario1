// Service worker del Inventario de Los Pares 84x88.
//
// Estrategia: RED PRIMERO, cache de respaldo. Es la misma del hub, y se eligio
// a proposito: con cache primero, Chencho abriria la version vieja despues de
// cada publicacion y habria que andar purgando a mano. Asi siempre ve lo ultimo
// y el cache solo entra cuando no hay senal.
//
// OJO, honestidad sobre lo "offline": esta app LEE Y ESCRIBE en Supabase, que
// vive en otro dominio. El service worker guarda la pantalla, no los datos.
// Sin internet la app abre, pero no puede cargar ni guardar un conteo. Eso es
// inevitable: un conteo que no llega a la base no es un conteo.
// Lo que si esta cubierto es lo importante: cada numero se guarda al momento,
// renglon por renglon. Si la senal se cae a medias, lo ya capturado esta a
// salvo en la base y solo se pierde el renglon que estaba escribiendo.

const CACHE = 'pares-inv-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si UN archivo falla. Se piden uno por uno para que
      // un icono que falte no tumbe la instalacion completa.
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Solo lo propio. Las llamadas a Supabase y al CDN pasan derecho, sin tocar:
  // nunca se debe servir un dato de inventario desde el cache, porque seria un
  // numero viejo presentado como si fuera el de ahorita.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
