import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';

import { isolateDatabase } from './fakeAnthropic';
import { pcmToWav } from '../tts/audio';

// Importar o provedor abre o banco: isolado num diretório temporário.
const restoreCwd = isolateDatabase();
const gemini = await import('./gemini');
const { db } = await import('../db');

// ---------- servidor falso da API do Gemini ----------
// O SDK de verdade fala com ele (GOOGLE_GEMINI_BASE_URL): o teste cobre a
// requisição montada e o tratamento de cada resposta, sem chave e sem cota.

interface Recorded {
  path: string;
  body: Record<string, any>;
}
interface Reply {
  status: number;
  body: unknown;
}

let requests: Recorded[] = [];
let reply: (call: Recorded) => Reply = () => ({ status: 500, body: {} });

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const call: Recorded = { path: req.url ?? '', body: JSON.parse(Buffer.concat(chunks).toString() || '{}') };
    requests.push(call);
    const out = reply(call);
    res.writeHead(out.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
});

const saved: Record<string, string | undefined> = {};
const MANAGED = ['GOOGLE_GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_TTS_MODEL'];

before(async () => {
  for (const name of MANAGED) saved[name] = process.env[name];
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  process.env.GOOGLE_GEMINI_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.GEMINI_API_KEY = 'chave-de-teste';
  delete process.env.GEMINI_TTS_MODEL;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const name of MANAGED) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  await restoreCwd();
});

function setup(next: (call: Recorded) => Reply) {
  requests = [];
  reply = next;
  db.exec('DELETE FROM ai_provider_status');
}

// As linhas do SQLite vêm sem protótipo; copiadas para objetos comuns, comparam normalmente.
const providerStatuses = () =>
  (db.prepare('SELECT provider, status FROM ai_provider_status').all() as unknown as { provider: string; status: string }[]).map(
    (row) => ({ provider: row.provider, status: row.status }),
  );

const pcm = Buffer.from([1, 0, 2, 0, 3, 0]);
const audioReply = (data: Buffer, mimeType = 'audio/wav') => ({
  status: 200,
  body: {
    candidates: [{ content: { parts: [{ inlineData: { mimeType, data: data.toString('base64') } }] } }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 20, totalTokenCount: 25 },
  },
});
const textReply = (text: string) => ({
  status: 200,
  body: {
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
  },
});
const quotaError = (retryDelay?: string) => ({
  status: 429,
  body: {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'quota',
      details: retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : [],
    },
  },
});
const overloaded = { status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'high demand' } } };

// ---------- voz ----------

test('voz: envia só o texto do cartão, com o modelo, a voz e o áudio pedidos', async () => {
  setup(() => audioReply(pcmToWav(pcm, 24000)));
  const decoded = await gemini.synthesizeSpeechGemini('O que diz a legalidade?', 'Charon');

  assert.deepEqual(decoded.pcm, pcm);
  assert.equal(decoded.sampleRate, 24000);
  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /models\/gemini-3\.8-flash-tts:generateContent/);
  const body = requests[0].body;
  // O modelo lê em voz alta tudo o que recebe: qualquer instrução junto ("leia em tom natural...")
  // seria falada antes do cartão. Só o texto, exatamente como veio.
  assert.deepEqual(body.contents[0].parts, [{ text: 'O que diz a legalidade?' }]);
  assert.deepEqual(body.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Charon');
});

test('voz: aceita também o PCM cru e respeita o modelo configurado', async () => {
  setup(() => audioReply(pcm, 'audio/L16;codec=pcm;rate=16000'));
  process.env.GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
  try {
    const decoded = await gemini.synthesizeSpeechGemini('texto', 'Kore');
    assert.equal(decoded.sampleRate, 16000);
    assert.deepEqual(decoded.pcm, pcm);
    assert.match(requests[0].path, /gemini-3\.8-flash-lite-tts/);
  } finally {
    delete process.env.GEMINI_TTS_MODEL;
  }
});

test('voz: resposta sem áudio vira erro claro', async () => {
  setup(() => textReply('só texto'));
  await assert.rejects(gemini.synthesizeSpeechGemini('texto', 'Charon'), /não retornou áudio/);
});

test('voz: cota esgotada falha na hora, sem esperar nem repetir, mesmo com tempo de espera sugerido', async () => {
  setup(() => quotaError('30s'));
  const t0 = Date.now();
  await assert.rejects(gemini.synthesizeSpeechGemini('texto', 'Charon'), /Limite de uso gratuito/);
  assert.equal(requests.length, 1);
  assert.ok(Date.now() - t0 < 2000, 'não pode ter aguardado os 30 s sugeridos');
});

test('voz: a falha diz o motivo e, na cota, quando ela volta', async () => {
  setup(() => quotaError('30948s'));
  await assert.rejects(gemini.synthesizeSpeechGemini('texto', 'Charon'), (err: unknown) => {
    assert.ok(err instanceof gemini.GeminiError);
    assert.equal(err.kind, 'quota');
    assert.equal(err.retryAfterSeconds, 30948);
    return true;
  });

  setup(() => quotaError()); // sem tempo informado
  await assert.rejects(gemini.synthesizeSpeechGemini('texto', 'Charon'), (err: unknown) => {
    assert.ok(err instanceof gemini.GeminiError);
    assert.equal(err.kind, 'quota');
    assert.equal(err.retryAfterSeconds, undefined);
    return true;
  });

  setup(() => ({ status: 500, body: { error: { code: 500, status: 'INTERNAL', message: 'erro' } } }));
  await assert.rejects(gemini.synthesizeSpeechGemini('texto', 'Charon'), (err: unknown) => {
    assert.ok(err instanceof gemini.GeminiError);
    assert.equal(err.kind, 'other');
    return true;
  });
});

test('voz: sobrecarga tem uma única repetição, não quatro', async () => {
  setup(() => overloaded);
  await assert.rejects(gemini.synthesizeSpeechGemini('texto', 'Charon'), (err: unknown) => {
    assert.ok(err instanceof gemini.GeminiError);
    assert.equal(err.kind, 'overloaded');
    assert.match(err.message, /alta demanda/);
    return true;
  });
  assert.equal(requests.length, 2);
});

test('voz: não mexe no indicador de saúde do Gemini, nem no sucesso nem na falha', async () => {
  setup(() => audioReply(pcmToWav(pcm, 24000)));
  await gemini.synthesizeSpeechGemini('texto', 'Charon');
  assert.deepEqual(providerStatuses(), []);

  setup(() => quotaError());
  await assert.rejects(gemini.synthesizeSpeechGemini('texto', 'Charon'));
  assert.deepEqual(providerStatuses(), []);

  setup(() => ({ status: 401, body: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'API_KEY_INVALID' } } }));
  await assert.rejects(gemini.synthesizeSpeechGemini('texto', 'Charon'));
  assert.deepEqual(providerStatuses(), []);
});

// ---------- o resto das gerações: comportamento de sempre ----------

test('geração comum: sucesso marca o Gemini como funcionando', async () => {
  setup(() => textReply(JSON.stringify({ title: 'Título', content: 'Conteúdo' })));
  const summary = await gemini.generateSummaryGemini('texto longo', 'padrao');
  assert.deepEqual(summary, { title: 'Título', content: 'Conteúdo' });
  assert.deepEqual(providerStatuses(), [{ provider: 'gemini', status: 'ok' }]);
});

test('geração comum: cota esgotada espera o tempo sugerido, tenta mais uma vez e marca o status', async () => {
  setup(() => quotaError('0.05s'));
  await assert.rejects(gemini.generateSummaryGemini('texto longo', 'padrao'), /Limite de uso gratuito/);
  assert.equal(requests.length, 2, 'uma tentativa original e uma depois da espera');
  assert.deepEqual(providerStatuses(), [{ provider: 'gemini', status: 'quota_exhausted' }]);
});

test('geração comum: a repetição depois da espera pode dar certo', async () => {
  let calls = 0;
  setup(() => (++calls === 1 ? quotaError('0.05s') : textReply(JSON.stringify({ title: 'T', content: 'C' }))));
  assert.deepEqual(await gemini.generateSummaryGemini('texto longo', 'padrao'), { title: 'T', content: 'C' });
  assert.equal(requests.length, 2);
  assert.deepEqual(providerStatuses(), [{ provider: 'gemini', status: 'ok' }]);
});

test('geração comum: chave inválida marca o status', async () => {
  setup(() => ({ status: 401, body: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'API_KEY_INVALID' } } }));
  await assert.rejects(gemini.generateSummaryGemini('texto longo', 'padrao'));
  assert.deepEqual(providerStatuses(), [{ provider: 'gemini', status: 'invalid_key' }]);
});

// ---------- alternativas de múltipla escolha ----------

test('alternativas: o pedido leva os cartões numerados e o esquema; a resposta passa pela validação', async () => {
  const questions = [{ n: 1, correct: 'O DNS', wrong: ['O DHCP', 'O ARP', 'O ICMP', 'O SNMP'] }];
  setup(() => textReply(JSON.stringify({ questions })));

  const choices = await gemini.generateChoicesGemini([
    { n: 1, question: 'Qual protocolo resolve nomes?', answer: 'O DNS.' },
    { n: 2, question: 'Qual a porta do SSH?', answer: 'A porta TCP 22.' },
  ]);
  assert.deepEqual(choices, questions, 'o cartão 2 não voltou e fica de fora, sem derrubar o 1');

  assert.equal(requests.length, 1, 'uma chamada para o lote todo');
  const sent = requests[0].body;
  const prompt: string = sent.contents[0].parts[0].text;
  assert.match(prompt, /\[n=1\]\nPergunta: Qual protocolo resolve nomes\?\nResposta: O DNS\./);
  assert.match(prompt, /\[n=2\]/);
  assert.match(sent.systemInstruction.parts[0].text, /múltipla escolha/);
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(sent.generationConfig.responseSchema.properties.questions.items.required, ['n', 'correct', 'wrong']);
  assert.deepEqual(providerStatuses(), [{ provider: 'gemini', status: 'ok' }]);
});

test('alternativas: JSON fora do formato é erro, e cota esgotada aparece como nas demais gerações', async () => {
  setup(() => textReply('isto não é json'));
  await assert.rejects(gemini.generateChoicesGemini([{ n: 1, question: 'P', answer: 'R' }]), /formato esperado/);

  setup(() => quotaError('0.05s'));
  await assert.rejects(gemini.generateChoicesGemini([{ n: 1, question: 'P', answer: 'R' }]), /Limite de uso gratuito/);
  assert.deepEqual(providerStatuses(), [{ provider: 'gemini', status: 'quota_exhausted' }]);
});

// ---------- conferência de cartões (segunda opinião) ----------

test('conferência: o pedido leva o contexto e os cartões numerados, e a resposta passa pela validação', async () => {
  const checks = [{ n: 1, verdict: 'erro', note: 'A porta do SSH é a 22.' }, { n: 2, verdict: 'ok', note: '' }];
  setup(() => textReply(JSON.stringify({ checks: [...checks, { n: 9, verdict: 'ok', note: 'número que não existe' }] })));

  const result = await gemini.verifyCardsGemini(
    [
      { n: 1, question: 'Qual a porta do SSH?', answer: 'A porta TCP 23.' },
      { n: 2, question: 'Qual protocolo resolve nomes?', answer: 'O DNS.' },
    ],
    'concurso TRANSPETRO 2026',
  );
  assert.deepEqual(result, checks, 'o número 9 não foi pedido e fica de fora');

  assert.equal(requests.length, 1);
  const sent = requests[0].body;
  const prompt: string = sent.contents[0].parts[0].text;
  assert.match(prompt, /Contexto: concurso TRANSPETRO 2026/);
  assert.match(prompt, /\[n=1\]\nPergunta: Qual a porta do SSH\?\nResposta: A porta TCP 23\./);
  assert.match(sent.systemInstruction.parts[0].text, /revisor técnico/);
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(sent.generationConfig.responseSchema.properties.checks.items.required, ['n', 'verdict', 'note']);
  assert.deepEqual(sent.generationConfig.responseSchema.properties.checks.items.properties.verdict.enum, ['ok', 'duvida', 'erro']);
  assert.deepEqual(providerStatuses(), [{ provider: 'gemini', status: 'ok' }]);
});

test('conferência: JSON fora do formato é erro, e cota esgotada aparece como nas demais gerações', async () => {
  setup(() => textReply('isto não é json'));
  await assert.rejects(gemini.verifyCardsGemini([{ n: 1, question: 'P', answer: 'R' }], ''), /não retornou a conferência/);

  setup(() => quotaError('0.05s'));
  await assert.rejects(gemini.verifyCardsGemini([{ n: 1, question: 'P', answer: 'R' }], ''), /Limite de uso gratuito/);
  assert.deepEqual(providerStatuses(), [{ provider: 'gemini', status: 'quota_exhausted' }]);
});
