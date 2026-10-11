import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PROVIDER_ORDER,
  NO_PROVIDER_MESSAGE,
  parseProviderOrder,
  runChain,
  UNSUPPORTED,
  type ChainSteps,
  type ProviderName,
} from './chain';

const ok = (value: string) => ({ available: true, run: async () => value });
const failing = (message: string) => ({
  available: true,
  run: async (): Promise<string> => {
    throw new Error(message);
  },
});
const off = { available: false, run: async () => 'nunca' };
const notSupported = { available: true, run: null };

function steps(overrides: Partial<ChainSteps<string>>): ChainSteps<string> {
  return { openai: off, gemini: off, claude: off, ...overrides };
}

test('ordem: padrão mantém OpenAI, Gemini e o Claude só como reserva', () => {
  assert.deepEqual(parseProviderOrder(undefined), ['openai', 'gemini', 'claude']);
  assert.deepEqual(parseProviderOrder(''), [...DEFAULT_PROVIDER_ORDER]);
  assert.deepEqual(parseProviderOrder('   '), [...DEFAULT_PROVIDER_ORDER]);
});

test('ordem: lê a lista, ignora maiúsculas, espaços, repetidos e nomes desconhecidos', () => {
  assert.deepEqual(parseProviderOrder('claude, Gemini ,claude,foo'), ['claude', 'gemini']);
  assert.deepEqual(parseProviderOrder('gemini'), ['gemini']);
  assert.deepEqual(parseProviderOrder('foo,bar'), [...DEFAULT_PROVIDER_ORDER]);
});

test('cadeia: o primeiro provedor disponível que responde vence, sem chamar os seguintes', async () => {
  let secondCalled = false;
  const result = await runChain(['openai', 'gemini', 'claude'], steps({
    openai: ok('openai'),
    gemini: { available: true, run: async () => ((secondCalled = true), 'gemini') },
  }));
  assert.equal(result, 'openai');
  assert.equal(secondCalled, false);
});

test('cadeia: cai para o próximo quando um falha, e avisa quem falhou', async () => {
  const fallbacks: [ProviderName, string][] = [];
  const result = await runChain(
    ['openai', 'gemini', 'claude'],
    steps({ openai: failing('sem créditos'), gemini: failing('alta demanda'), claude: ok('claude') }),
    (provider, err) => fallbacks.push([provider, (err as Error).message]),
  );
  assert.equal(result, 'claude');
  assert.deepEqual(fallbacks, [
    ['openai', 'sem créditos'],
    ['gemini', 'alta demanda'],
  ]);
});

test('cadeia: sem chave ou sem suporte, o provedor é pulado e não conta como falha', async () => {
  const result = await runChain(['openai', 'claude', 'gemini'], steps({
    openai: off,
    claude: notSupported,
    gemini: ok('gemini'),
  }));
  assert.equal(result, 'gemini');
});

test('cadeia: um provedor que declara a entrada como não suportada é pulado em silêncio', async () => {
  const fallbacks: ProviderName[] = [];
  const result = await runChain(
    ['openai', 'gemini'],
    steps({
      openai: { available: true, run: async () => UNSUPPORTED },
      gemini: ok('gemini'),
    }),
    (provider) => fallbacks.push(provider),
  );
  assert.equal(result, 'gemini');
  assert.deepEqual(fallbacks, []);
});

test('cadeia: se todos que tentaram falharam, lança o erro do último', async () => {
  await assert.rejects(
    runChain(['openai', 'gemini', 'claude'], steps({ openai: failing('um'), gemini: failing('dois'), claude: failing('três') })),
    /três/,
  );
  // com o Claude desligado, o último a tentar é o Gemini — a mensagem de sempre
  await assert.rejects(runChain(['openai', 'gemini', 'claude'], steps({ openai: failing('um'), gemini: failing('dois') })), /dois/);
});

test('cadeia: nada disponível dá a mensagem de configuração, não um erro de provedor', async () => {
  await assert.rejects(runChain(['openai', 'gemini', 'claude'], steps({})), (err: Error) => err.message === NO_PROVIDER_MESSAGE);
  await assert.rejects(
    runChain(['openai', 'gemini'], steps({ openai: { available: true, run: async () => UNSUPPORTED } })),
    (err: Error) => err.message === NO_PROVIDER_MESSAGE,
  );
});

test('cadeia: a ordem configurada manda, inclusive colocando o Claude na frente', async () => {
  const result = await runChain(['claude', 'gemini'], steps({ gemini: ok('gemini'), claude: ok('claude'), openai: ok('openai') }));
  assert.equal(result, 'claude');
  // provedor fora da lista nunca é usado, mesmo disponível
  const withoutGemini = await runChain(['claude'], steps({ gemini: ok('gemini'), claude: ok('claude') }));
  assert.equal(withoutGemini, 'claude');
});
