/*
 * Service worker da Memória Concurseira. Faz duas coisas:
 *  1. quando o celular não consegue falar com o PC (desligado, suspenso, Tailscale inativo), mostra a
 *     página "Sem conexão" em vez do erro do navegador. Não guarda dados nem código do app: toda tela e
 *     toda chamada à API vão sempre à rede, então um deploy novo vale na hora e não existe "versão velha
 *     presa no celular";
 *  2. mostra o lembrete de estudo (notificação push) e abre o app ao tocar nele.
 *
 * Fica em /sw.js (a raiz do site) para poder controlar todas as telas.
 */

const CACHE = 'bc-offline-v1';
const OFFLINE_URL = '/offline.html';

// Respostas de um proxy (o `tailscale serve`) dizendo que o app por trás dele não responde.
const BACKEND_DOWN = new Set([502, 503, 504]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('bc-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function offlinePage() {
  const cached = await caches.match(OFFLINE_URL);
  return (
    cached ??
    new Response('Sem conexão com o computador.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  );
}

async function navigate(request) {
  try {
    const response = await fetch(request);
    return BACKEND_DOWN.has(response.status) ? offlinePage() : response;
  } catch {
    return offlinePage();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Só as navegações (abrir ou recarregar uma tela) ganham a página offline. O resto (API, scripts,
  // imagens, outros sites) segue direto para a rede, sem passar por aqui.
  if (request.mode === 'navigate' && request.method === 'GET') {
    event.respondWith(navigate(request));
  }
});

// ---------- lembrete de estudo (push) ----------

const NOTIFICATION_ICON = '/icons/icon-192.png';

/** O toque na notificação só abre uma tela do próprio app: um caminho simples, nunca outro site. */
function appPath(value) {
  return typeof value === 'string' && /^\/(?!\/)[A-Za-z0-9\-_/]*$/.test(value) ? value : '/painel';
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 80) : 'Memória Concurseira';
  const options = {
    body: typeof data.body === 'string' ? data.body.slice(0, 200) : '',
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    data: { url: appPath(data.url) },
  };
  // Com a mesma "tag", um lembrete novo substitui o que ainda está na tela em vez de empilhar.
  if (typeof data.tag === 'string' && data.tag) options.tag = data.tag.slice(0, 64);
  // Todo push precisa terminar numa notificação visível: sem isso o navegador mostra uma genérica.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = appPath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Se o app já está aberto, usa a janela dele em vez de abrir outra.
      for (const window of windows) {
        if ('focus' in window) {
          return window.focus().then((focused) => (focused && 'navigate' in focused ? focused.navigate(url) : focused));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
