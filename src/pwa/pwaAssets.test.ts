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

/** Uma janela do app aberta no aparelho, como o worker a enxerga. */
interface FakeWindow {
  focused: boolean;
  navigated: string[];
  focus(): Promise<FakeWindow>;
  navigate(url: string): Promise<unknown>;
}

function fakeWindow(): FakeWindow {
  const window: FakeWindow = {
    focused: false,
    navigated: [],
    focus: async () => {
      window.focused = true;
      return window;
    },
    navigate: async (url: string) => void window.navigated.push(url),
  };
  return window;
}

function loadWorker(network: (request: unknown) => Promise<Response>, windows: FakeWindow[] = []) {
  const listeners: Record<string, Listener> = {};
  const shown: { title: string; options: Record<string, any> }[] = [];
  const opened: string[] = [];
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
    clients: {
      claim: async () => void (clientsClaimed.value = true),
      matchAll: async () => windows,
      openWindow: async (url: string) => void opened.push(url),
    },
    registration: { showNotification: async (title: string, options: Record<string, any>) => void shown.push({ title, options }) },
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

  /** Entrega um push ao worker (`payload` é o que o servidor mandou; `undefined` = push sem conteúdo) e espera a notificação aparecer. */
  const push = async (payload: unknown, raw?: string) => {
    let work: Promise<unknown> = Promise.resolve();
    const data = raw !== undefined || payload !== undefined ? { json: () => (raw !== undefined ? JSON.parse(raw) : payload) } : null;
    listeners.push({ data, waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };

  /** O toque numa notificação (com o `data` que o worker pôs nela). */
  const click = async (notificationData: unknown) => {
    let work: Promise<unknown> = Promise.resolve();
    const closed = { value: false };
    listeners.notificationclick({
      notification: { data: notificationData, close: () => void (closed.value = true) },
      waitUntil: (p: Promise<unknown>) => (work = p),
    });
    await work;
    return closed.value;
  };

  return { caches, clientsClaimed, lifecycle, handle, push, click, shown, opened };
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
  assert.equal(manifest.name, 'Memória Concurseira');
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

// ---------- lembrete de estudo (push) ----------

const REMINDER = { title: 'Hora de estudar', body: '42 cartões para revisar hoje', url: '/revisar', tag: 'lembrete-diario' };

test('push: o lembrete vira uma notificação com título, texto, ícone, tag e o destino', async () => {
  const worker = loadWorker(async () => app());
  await worker.push(REMINDER);
  assert.equal(worker.shown.length, 1);
  const { title, options } = worker.shown[0];
  assert.equal(title, 'Hora de estudar');
  assert.equal(options.body, '42 cartões para revisar hoje');
  assert.equal(options.tag, 'lembrete-diario');
  assert.equal(options.icon, '/icons/icon-192.png');
  assert.equal(options.data.url, '/revisar');
  assert.ok(fs.existsSync(path.join(ROOT, 'public', options.icon)), 'o ícone da notificação existe');
});

test('push: sem conteúdo, ou com conteúdo que não é JSON, ainda mostra uma notificação (o navegador exige)', async () => {
  const empty = loadWorker(async () => app());
  await empty.push(undefined);
  assert.equal(empty.shown.length, 1);
  assert.equal(empty.shown[0].title, 'Memória Concurseira');
  assert.equal(empty.shown[0].options.data.url, '/painel');
  assert.equal(empty.shown[0].options.tag, undefined);

  const broken = loadWorker(async () => app());
  await broken.push(undefined, 'isto não é json');
  assert.equal(broken.shown.length, 1);
  assert.equal(broken.shown[0].title, 'Memória Concurseira');
});

test('push: textos de tamanho absurdo são cortados e tipos errados caem no padrão', async () => {
  const worker = loadWorker(async () => app());
  await worker.push({ title: 'T'.repeat(500), body: 'B'.repeat(900), tag: 'x'.repeat(300), url: '/revisar' });
  const { title, options } = worker.shown[0];
  assert.equal(title.length, 80);
  assert.equal(options.body.length, 200);
  assert.equal(options.tag.length, 64);

  const wrongTypes = loadWorker(async () => app());
  await wrongTypes.push({ title: 123, body: { x: 1 }, tag: 5, url: ['/revisar'] });
  assert.equal(wrongTypes.shown[0].title, 'Memória Concurseira');
  assert.equal(wrongTypes.shown[0].options.body, '');
  assert.equal(wrongTypes.shown[0].options.tag, undefined);
  assert.equal(wrongTypes.shown[0].options.data.url, '/painel');
});

test('push: o destino só pode ser uma tela do próprio app (nunca outro site)', async () => {
  for (const url of ['https://evil.com', '//evil.com', 'javascript:alert(1)', '/a?x=1', 'revisar', '/a\\b', '/a:b']) {
    const worker = loadWorker(async () => app());
    await worker.push({ ...REMINDER, url });
    assert.equal(worker.shown[0].options.data.url, '/painel', url);
  }
  for (const url of ['/revisar', '/colecoes/abc-123/estudar', '/concursos/x']) {
    const worker = loadWorker(async () => app());
    await worker.push({ ...REMINDER, url });
    assert.equal(worker.shown[0].options.data.url, url);
  }
});

test('toque na notificação: fecha, e abre o app na tela do lembrete quando não há janela aberta', async () => {
  const worker = loadWorker(async () => app());
  assert.equal(await worker.click({ url: '/revisar' }), true, 'a notificação some');
  assert.deepEqual([...worker.opened], ['/revisar']);
});

test('toque na notificação: com o app já aberto, usa a janela dele e vai para a tela do lembrete', async () => {
  const window = fakeWindow();
  const worker = loadWorker(async () => app(), [window]);
  await worker.click({ url: '/revisar' });
  assert.equal(window.focused, true);
  assert.deepEqual([...window.navigated], ['/revisar']);
  assert.equal(worker.opened.length, 0, 'não abriu uma segunda janela');
});

test('toque na notificação: dado ausente ou fora do padrão abre o painel, nunca um endereço de fora', async () => {
  for (const data of [undefined, null, {}, { url: 'https://evil.com' }, { url: '//evil.com' }]) {
    const worker = loadWorker(async () => app());
    await worker.click(data);
    assert.deepEqual([...worker.opened], ['/painel'], JSON.stringify(data));
  }
});
