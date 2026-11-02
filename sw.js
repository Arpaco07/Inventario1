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

const CACHE = 'pares-inv-v2';
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

  // LA PAGINA SIEMPRE FRESCA, SIN DEPENDER DE NADIE.
  //
  // 1 nov 2026: Arturo publicaba y seguia viendo la version vieja. No era el
  // service worker ni Cloudflare (arpaco07.github.io NO pasa por Cloudflare,
  // lo sirve GitHub directo): era el cache HTTP del navegador, que se mete
  // ANTES que este fetch y le devuelve lo que ya tenia guardado.
  //
  // Por eso el HTML se pide con cache:'no-store' y un parametro que cambia
  // cada vez: asi ninguna capa intermedia puede contestar con lo viejo. Son
  // ~150 KB una vez al abrir; a cambio, nadie vuelve a trabajar con una
  // version de ayer sin enterarse, que es mucho mas caro.
  //
  // El resto (iconos, manifest) si se deja cachear normal: no cambian.
  const esPagina = (req.mode === 'navigate')
                || /\.html($|\?)/.test(url.pathname)
                || url.pathname === '/' || url.pathname.endsWith('/');

  const pedir = esPagina
    ? fetch(url.pathname + '?v=' + Date.now(), { cache: 'no-store' })
    : fetch(req);

  event.respondWith(
    pedir
      .then((res) => {
        if (!res || !res.ok) throw new Error('respuesta no utilizable');
        const copia = res.clone();
        // Se guarda bajo la peticion ORIGINAL, sin el parametro: si no, el
        // respaldo sin internet nunca se encontraria.
        caches.open(CACHE).then((cache) => cache.put(req, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
