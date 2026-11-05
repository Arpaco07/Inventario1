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

const CACHE = 'pares-inv-v3';
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
  // 1 nov 2026: Arturo publicaba y seguia viendo la version vieja. Era el
  // cache HTTP del navegador, que se mete ANTES que este fetch. Se arreglo
  // pidiendo el HTML con cache:'no-store' y un parametro que cambia cada vez.
  //
  // 4 nov 2026, EL MISMO SINTOMA POR OTRA CAUSA, y esta la provoque yo:
  //
  // El 2 de noviembre el inventario tomo dominio propio
  // (inventario.lospares.com) y GitHub empezo a REDIRIGIR todo lo que llega a
  // arpaco07.github.io/Inventario1/ hacia ese dominio nuevo. Pero aqui el
  // pedido se armaba a mano con url.pathname, o sea "/Inventario1/?v=...",
  // contra el origen viejo. Esa peticion ahora termina en OTRO dominio, el
  // navegador la bloquea por CORS, el fetch truena, y se cae al catch de
  // abajo... que sirve el cache. Para siempre.
  //
  // Resultado: todos los telefonos que ya tenian la app instalada quedaron
  // congelados en la ultima version guardada antes del dominio -- la v9 --
  // y no habia forma de sacarlos de ahi publicando, porque ya ni siquiera
  // llegaban a la red. Tres publicaciones seguidas no le llegaron a nadie.
  //
  // El arreglo: se pide el REQUEST ORIGINAL, no una URL rearmada. Asi el
  // navegador sigue la redireccion el solo, como lo hace con cualquier
  // navegacion normal, y el cache vuelve a ser lo que debe ser: el respaldo
  // de cuando no hay senal, no la fuente.
  const esPagina = (req.mode === 'navigate')
                || /\.html($|\?)/.test(url.pathname)
                || url.pathname === '/' || url.pathname.endsWith('/');

  const pedir = esPagina
    ? fetch(req, { cache: 'no-store' })
    : fetch(req);

  event.respondWith(
    pedir
      .then((res) => {
        // Una redireccion es una respuesta buena: el navegador ya la siguio y
        // esto es el destino. Lo que no sirve es un 404 o un 500.
        if (!res || (!res.ok && res.type !== 'opaqueredirect')) {
          throw new Error('respuesta no utilizable');
        }
        if (res.type === 'opaqueredirect' || res.redirected) return res;
        const copia = res.clone();
        // Se guarda bajo la peticion ORIGINAL, sin el parametro: si no, el
        // respaldo sin internet nunca se encontraria.
        caches.open(CACHE).then((cache) => cache.put(req, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
