import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

// Os testes rodam na raiz do projeto (`npm test`); os arquivos do app instalável ficam em public/.
const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ---------- service worker (o sw.js de verdade, num ambiente simulado) ----------

type Listener = (event: unknown) => void;

function loadWorker(network: (request: unknown) => Promise<Response>) {
  const listeners: Record<string, Listener> = {};
  const caches = new Map<string, Map<string, Response>>();
  const clientsClaimed = { value: false };

  const cacheApi = {
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new Map());
      const store = caches.get(name)!;
      return {
        // O pré-cache de verdade baixa a página; aqui basta guardar o conteúdo dela.
        addAll: async (urls: string[]) => {
          for (const url of urls) store.set(url, new Response(read(`public${url}`), { headers: { 'Content-Type': 'text/html' } }));
        },
      };
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
    match: async (url: string) => {
      for (const store of caches.values()) if (store.has(url)) return store.get(url)!.clone();
      return undefined;
    },
  };

  const self = {
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => void (clientsClaimed.value = true) },
  };

  vm.runInNewContext(read('public/sw.js'), { self, caches: cacheApi, fetch: network, Response, Promise, Set });

  const lifecycle = async (type: 'install' | 'activate') => {
    let work: Promise<unknown> = Promise.resolve();
    listeners[type]({ waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };

  /** Devolve a resposta que o worker deu à navegação, ou `null` se ele não quis tratá-la. */
  const handle = async (request: { mode: string; method: string; url: string }): Promise<Response | null> => {
    let answer: Promise<Response> | null = null;
    listeners.fetch({ request, respondWith: (p: Promise<Response>) => (answer = p) });
    return answer ? await answer : null;
  };

  return { caches, clientsClaimed, lifecycle, handle };
}

const NAVIGATE = { mode: 'navigate', method: 'GET', url: 'https://pc.exemplo.ts.net/painel' };
const app = () => new Response('<html>o app</html>', { status: 200 });
const offlineMarker = 'Não consegui falar com o seu computador';

test('service worker: a instalação guarda a página offline e ativa na hora', async () => {
  const worker = loadWorker(async () => app());
  await worker.lifecycle('install');
  const cache = worker.caches.get('bc-offline-v1');
  assert.ok(cache?.has('/offline.html'), 'a página offline foi para o cache');
});

test('service worker: com o app respondendo, a navegação passa direto, sem cache', async () => {
  const worker = loadWorker(async () => app());
  await worker.lifecycle('install');
  const response = await worker.handle(NAVIGATE);
  assert.equal(response?.status, 200);
  assert.equal(await response?.text(), '<html>o app</html>');
});

test('service worker: PC fora do ar (a rede falha) mostra a página "sem conexão"', async () => {
  const worker = loadWorker(async () => {
    throw new TypeError('Failed to fetch');
  });
  await worker.lifecycle('install');
  const response = await worker.handle(NAVIGATE);
  assert.match((await response?.text()) ?? '', new RegExp(offlineMarker));
});

test('service worker: o proxy dizendo que o app não responde (502, 503, 504) também mostra a página "sem conexão"', async () => {
  for (const status of [502, 503, 504]) {
    const worker = loadWorker(async () => new Response('Bad Gateway', { status }));
    await worker.lifecycle('install');
    const response = await worker.handle(NAVIGATE);
    assert.match((await response?.text()) ?? '', new RegExp(offlineMarker), String(status));
  }
});

test('service worker: erros do próprio app (404, 500) não são "sem conexão": passam como vieram', async () => {
  for (const status of [404, 500]) {
    const worker = loadWorker(async () => new Response('erro do app', { status }));
    await worker.lifecycle('install');
    const response = await worker.handle(NAVIGATE);
    assert.equal(response?.status, status);
    assert.equal(await response?.text(), 'erro do app');
  }
});

test('service worker: só navegações GET são tratadas; API, scripts, imagens e envios de formulário seguem direto para a rede', async () => {
  let networkCalls = 0;
  const worker = loadWorker(async () => {
    networkCalls++;
    return app();
  });
  await worker.lifecycle('install');
  const ignored = [
    { mode: 'cors', method: 'GET', url: 'https://pc.exemplo.ts.net/api/flashcards' },
    { mode: 'no-cors', method: 'GET', url: 'https://pc.exemplo.ts.net/assets/index-abc.js' },
    { mode: 'same-origin', method: 'POST', url: 'https://pc.exemplo.ts.net/api/auth/login' },
    { mode: 'navigate', method: 'POST', url: 'https://pc.exemplo.ts.net/painel' },
  ];
  for (const request of ignored) assert.equal(await worker.handle(request), null, `${request.method} ${request.url}`);
  assert.equal(networkCalls, 0, 'o worker nem tocou na rede dessas');
});

test('service worker: sem a página offline guardada e sem rede, ainda responde algo (503), não quebra', async () => {
  const worker = loadWorker(async () => {
    throw new TypeError('Failed to fetch');
  });
  // Sem `install`: o cache está vazio.
  const response = await worker.handle(NAVIGATE);
  assert.equal(response?.status, 503);
  assert.match((await response?.text()) ?? '', /Sem conexão/);
});

test('service worker: ao ativar, apaga só os caches antigos do app e assume as abas abertas', async () => {
  const worker = loadWorker(async () => app());
  worker.caches.set('bc-offline-v0', new Map());
  worker.caches.set('bc-shell-v1', new Map());
  worker.caches.set('outro-site', new Map());
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  assert.deepEqual([...worker.caches.keys()].sort(), ['bc-offline-v1', 'outro-site']);
  assert.equal(worker.clientsClaimed.value, true);
});

// ---------- página offline ----------

test('página offline: é autocontida (sem recursos externos) e tenta voltar sozinha', () => {
  const html = read('public/offline.html');
  assert.match(html, new RegExp(offlineMarker));
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i, 'sem CSS externo');
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'sem script externo');
  assert.match(html, /\/api\/health/, 'confere se o servidor voltou');
  assert.match(html, /location\.reload\(\)/);
});

// ---------- manifest, ícones e index.html ----------

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Icon[];
  shortcuts: { name: string; url: string; icons?: Icon[] }[];
};

/** Largura e altura de um PNG, lidas do cabeçalho do arquivo. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${file} não é um PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('manifest: é instalável (nome, tela cheia, escopo, início e cores)', () => {
  assert.equal(manifest.name, 'Base Concurseira');
  assert.ok(manifest.short_name.length > 0 && manifest.short_name.length <= 12, 'nome curto cabe embaixo do ícone');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});

test('manifest: tem ícones de 192 e 512 e um mascarável de 512, e cada arquivo existe com o tamanho declarado', () => {
  const find = (size: string, purpose: string) => manifest.icons.find((i) => i.sizes === size && (i.purpose ?? 'any') === purpose);
  assert.ok(find('192x192', 'any'));
  assert.ok(find('512x512', 'any'));
  assert.ok(find('512x512', 'maskable'));
  for (const icon of manifest.icons) {
    const { width, height } = pngSize(`public${icon.src}`);
    assert.equal(`${width}x${height}`, icon.sizes, icon.src);
    assert.equal(icon.type, 'image/png');
  }
});

test('manifest: o início e os atalhos apontam para telas que existem no app', () => {
  const routes = [...read('src/App.tsx').matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  for (const url of [manifest.start_url, ...manifest.shortcuts.map((s) => s.url)]) {
    assert.ok(routes.includes(url), `${url} não é uma rota do app`);
  }
  for (const shortcut of manifest.shortcuts) {
    for (const icon of shortcut.icons ?? []) assert.ok(fs.existsSync(path.join(ROOT, 'public', icon.src)), icon.src);
  }
});

test('index.html: liga o manifest, a cor do tema, o favicon e o ícone do iPhone, e os arquivos existem', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.ok(html.includes(`<meta name="theme-color" content="${manifest.theme_color}"`), 'mesma cor do manifest');
  for (const [, href] of html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public', href)), href);
  }
  assert.deepEqual(pngSize('public/icons/apple-touch-icon.png'), { width: 180, height: 180 });
  assert.match(html, /apple-mobile-web-app-capable/);
});
