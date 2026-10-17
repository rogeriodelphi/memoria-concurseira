/*
 * Service worker da Memória Concurseira. Faz uma coisa só: quando o celular não consegue falar com o
 * PC (desligado, suspenso, Tailscale inativo), mostra a página "Sem conexão" em vez do erro
 * do navegador. Não guarda dados nem código do app: toda tela e toda chamada à API vão sempre à
 * rede, então um deploy novo vale na hora e não existe "versão velha presa no celular".
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
