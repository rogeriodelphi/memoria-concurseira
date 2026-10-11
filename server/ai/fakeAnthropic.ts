/**
 * Servidor que imita a API da Anthropic, só para testes. O SDK de verdade fala
 * com ele no lugar do serviço (ANTHROPIC_BASE_URL), então os testes cobrem a
 * requisição montada e a resposta tratada de ponta a ponta, sem chave e sem custo.
 *
 * Não importa nada do app (nem o banco): quem usa precisa isolar o banco antes
 * de importar o que depende dele — ver `isolateDatabase`.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export interface Recorded {
  headers: http.IncomingHttpHeaders;
  body: Record<string, any>;
}

export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface FakeAnthropic {
  requests: Recorded[];
  /** Define como responder daqui em diante e zera o registro de requisições. */
  respond(next: (call: Recorded) => Reply): void;
  close(): Promise<void>;
}

export async function startFakeAnthropic(): Promise<FakeAnthropic> {
  const fake: FakeAnthropic = {
    requests: [],
    respond(next) {
      fake.requests = [];
      reply = next;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  let reply: (call: Recorded) => Reply = () => ({ status: 500, body: {} });

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const call: Recorded = { headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') };
      fake.requests.push(call);
      const out = reply(call);
      res.writeHead(out.status, { 'content-type': 'application/json', ...out.headers });
      res.end(JSON.stringify(out.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  delete process.env.ANTHROPIC_MODEL;
  return fake;
}

/**
 * O banco do app abre `data/app.db` relativo ao diretório atual, no momento do
 * import. Chame isto ANTES de importar qualquer módulo que dependa dele: o
 * teste passa a rodar num diretório temporário e nunca encosta no banco real.
 * Devolve a função que desfaz — fecha o banco (no Windows ele segura o arquivo
 * aberto e o diretório não sairia), volta ao diretório de origem e apaga o temporário.
 */
export function isolateDatabase(): () => Promise<void> {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-test-'));
  process.chdir(tmpDir);
  return async () => {
    try {
      const { db } = await import('../db');
      db.close();
    } catch {
      // já fechado, ou nunca aberto
    }
    process.chdir(originalCwd);
    try {
      // No Windows, o antivírus pode segurar o arquivo por um instante: tenta algumas vezes.
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // é só um diretório temporário
    }
  };
}

export const message = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-teste',
  content,
  stop_reason: 'tool_use',
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 7 },
  ...extra,
});

export const toolUse = (input: unknown) =>
  message([{ type: 'tool_use', id: 'toolu_1', name: 'entregar_resultado', input }]);

export const apiError = (type: string, text: string) => ({ type: 'error', error: { type, message: text } });

/** Faz o SDK repetir quase na hora em vez de esperar o tempo de espera normal. */
export const fastRetry = { 'retry-after-ms': '1', 'x-should-retry': 'true' };
