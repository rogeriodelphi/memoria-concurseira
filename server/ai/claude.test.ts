import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { apiError, fastRetry, isolateDatabase, message, startFakeAnthropic, toolUse, type FakeAnthropic, type Recorded, type Reply } from './fakeAnthropic';
import type { GenerationOptions } from './gemini';

// Importar o provedor abre o banco: isolado num diretório temporário, para o teste nunca tocar no real.
const restoreCwd = isolateDatabase();
const claude = await import('./claude');

let fake: FakeAnthropic;

before(async () => {
  fake = await startFakeAnthropic();
});

after(async () => {
  await fake.close();
  await restoreCwd();
});

const OPTIONS: GenerationOptions = { quantity: 'auto', difficulty: 'misto', cardType: 'misto', depth: 'normal' };

function setup(next: (call: Recorded) => Reply) {
  fake.respond(next);
}

// ---------- funções puras ----------

test('erros: cada código da API vira uma mensagem que o usuário entende', () => {
  const f = claude.describeClaudeFailure;
  assert.equal(f(400, 'Your credit balance is too low to access the Anthropic API').status, 'no_credits');
  assert.match(f(400, 'Your credit balance is too low').message, /sem créditos/);
  assert.equal(f(400, 'max_tokens: 99999 > limite').status, null); // 400 comum não é falta de saldo
  assert.equal(f(401, '').status, 'invalid_key');
  assert.equal(f(403, '').status, 'invalid_key');
  assert.equal(f(404, '').status, null);
  assert.match(f(404, '').message, /ANTHROPIC_MODEL/);
  assert.equal(f(429, '').status, 'rate_limited');
  assert.equal(f(529, '').status, 'unavailable');
  assert.equal(f(500, '').status, 'unavailable');
  assert.equal(f(undefined, '').status, null);
});

test('entrada: monta o conteúdo certo para cada tipo de fonte', () => {
  const topic = claude.buildUserContent({ type: 'topic', topic: 'DNS' }, 'Instrução');
  assert.equal(topic, 'Instrução\n\nTópico: "DNS"');

  const text = claude.buildUserContent({ type: 'text', text: 'conteúdo' }, 'Instrução');
  assert.equal(text, 'Instrução\n\n--- TEXTO ---\nconteúdo');

  const pdfText = claude.buildUserContent({ type: 'pdf_text', extractedText: 'abc', filename: 'a.pdf' }, 'Instrução');
  assert.match(String(pdfText), /ARQUIVO "a\.pdf" ---\nabc$/);

  const image = claude.buildUserContent({ type: 'image', base64: 'AAAA', mimeType: 'image/png' }, 'Instrução');
  assert.ok(Array.isArray(image));
  assert.deepEqual(image[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });

  const pdf = claude.buildUserContent({ type: 'pdf', base64: 'BBBB' }, 'Instrução');
  assert.ok(Array.isArray(pdf));
  assert.deepEqual(pdf[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' } });
});

test('imagens: só os formatos que o Claude aceita', () => {
  for (const ok of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) assert.equal(claude.isClaudeImageMime(ok), true);
  for (const no of ['image/bmp', 'image/svg+xml', 'image/heic', 'application/pdf', '']) assert.equal(claude.isClaudeImageMime(no), false);
});

test('configuração: só conta como disponível com a chave definida', () => {
  assert.equal(claude.hasClaude(), true);
  assert.equal(claude.claudeModel(), 'claude-sonnet-5-5');
  process.env.ANTHROPIC_MODEL = '  claude-outro  ';
  assert.equal(claude.claudeModel(), 'claude-outro');
  delete process.env.ANTHROPIC_MODEL;
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(claude.hasClaude(), false);
  process.env.ANTHROPIC_API_KEY = key;
});

// ---------- contra o servidor falso ----------

test('flashcards: pede o resultado por uma ferramenta obrigatória e valida o que volta', async () => {
  setup(() => ({
    status: 200,
    body: toolUse({
      flashcards: [
        { question: ' O que é DNS? ', answer: 'Sistema de nomes.', difficulty: 'facil' },
        { question: '   ', answer: 'sem pergunta', difficulty: 'medio' },
        { question: 'Dificuldade inválida', answer: 'ok', difficulty: 'impossivel' },
      ],
    }),
  }));

  const result = await claude.generateFlashcardsClaude({ type: 'topic', topic: 'DNS' }, OPTIONS);

  assert.deepEqual(result.flashcards, [
    { question: 'O que é DNS?', answer: 'Sistema de nomes.', difficulty: 'facil' },
    { question: 'Dificuldade inválida', answer: 'ok', difficulty: 'medio' },
  ]);
  assert.equal(fake.requests.length, 1);
  const { headers, body } = fake.requests[0];
  assert.equal(headers['x-api-key'], 'chave-de-teste');
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(typeof body.max_tokens, 'number');
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'entregar_resultado' });
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].name, 'entregar_resultado');
  assert.ok(body.tools[0].input_schema.properties.flashcards);
  assert.match(body.system, /flashcards/);
  assert.equal(body.messages[0].role, 'user');
  assert.match(body.messages[0].content, /Tópico: "DNS"/);
});

test('modelo: ANTHROPIC_MODEL troca o modelo da requisição', async () => {
  setup(() => ({ status: 200, body: toolUse({ title: 'Resumo', content: 'Texto do resumo.' }) }));
  process.env.ANTHROPIC_MODEL = 'claude-haiku-5-5';
  try {
    const summary = await claude.generateSummaryClaude('texto longo', 'padrao');
    assert.deepEqual(summary, { title: 'Resumo', content: 'Texto do resumo.' });
    assert.equal(fake.requests[0].body.model, 'claude-haiku-5-5');
    assert.match(fake.requests[0].body.messages[0].content, /--- TEXTO ---\ntexto longo$/);
  } finally {
    delete process.env.ANTHROPIC_MODEL;
  }
});

test('PDF escaneado e imagem seguem como blocos de documento e de imagem', async () => {
  setup(() => ({ status: 200, body: toolUse({ flashcards: [{ question: 'P', answer: 'R', difficulty: 'medio' }] }) }));

  await claude.generateFlashcardsClaude({ type: 'pdf', base64: 'QUJD' }, OPTIONS);
  const pdfBlocks = fake.requests[0].body.messages[0].content;
  assert.equal(pdfBlocks[0].type, 'document');
  assert.deepEqual(pdfBlocks[0].source, { type: 'base64', media_type: 'application/pdf', data: 'QUJD' });
  assert.equal(pdfBlocks[1].type, 'text');

  await claude.generateFlashcardsClaude({ type: 'image', base64: 'REVG', mimeType: 'image/jpeg' }, OPTIONS);
  const imageBlocks = fake.requests[1].body.messages[0].content;
  assert.deepEqual(imageBlocks[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'REVG' } });
});

test('mapa mental e bullet points passam pela mesma validação dos outros provedores', async () => {
  setup(() => ({
    status: 200,
    body: toolUse({ title: 'Redes', children: [{ title: 'TCP', children: [{ title: 'Handshake' }] }, { title: '   ' }] }),
  }));
  const map = await claude.generateMindMapClaude({ type: 'topic', topic: 'Redes' });
  assert.deepEqual(map, { title: 'Redes', children: [{ title: 'TCP', children: [{ title: 'Handshake' }] }] });

  setup(() => ({ status: 200, body: toolUse({ title: 'Pontos', points: [' um ', '', 'dois'] }) }));
  const bullets = await claude.generateBulletPointsClaude('texto');
  assert.deepEqual(bullets, { title: 'Pontos', points: ['um', 'dois'] });
});

test('alternativas: os cartões vão numerados no pedido e a resposta passa pela validação compartilhada', async () => {
  const sources = [
    { n: 1, question: 'Qual protocolo resolve nomes?', answer: 'O DNS.' },
    { n: 2, question: 'Qual a porta do SSH?', answer: 'A porta TCP 22.' },
  ];
  setup(() => ({
    status: 200,
    body: toolUse({
      questions: [
        { n: 1, correct: 'a) O DNS', wrong: ['O DHCP', 'O ARP', 'Todas as anteriores', 'O ICMP', 'O DHCP'] },
        { n: 2, correct: 'A porta 22', wrong: ['A porta 23'] }, // poucas erradas: fica de fora
      ],
    }),
  }));

  const choices = await claude.generateChoicesClaude(sources);
  assert.deepEqual(choices, [{ n: 1, correct: 'O DNS', wrong: ['O DHCP', 'O ARP', 'O ICMP'] }]);

  const body = fake.requests[0].body;
  assert.match(body.system, /múltipla escolha/);
  assert.match(body.messages[0].content, /\[n=1\]\nPergunta: Qual protocolo resolve nomes\?\nResposta: O DNS\./);
  assert.match(body.messages[0].content, /\[n=2\]/);
  assert.equal(body.tools[0].input_schema.properties.questions.items.required.join(','), 'n,correct,wrong');
});

test('alternativas: resposta sem nenhuma questão aproveitável é erro (a cadeia tenta o próximo provedor)', async () => {
  setup(() => ({ status: 200, body: toolUse({ questions: [{ n: 9, correct: 'x', wrong: ['a', 'b', 'c'] }] }) }));
  await assert.rejects(
    claude.generateChoicesClaude([{ n: 1, question: 'P', answer: 'R' }]),
    /formato esperado/,
  );
});

test('sugestão para cartão sanguessuga: o pedido leva o cartão e o esquema; a resposta passa pela validação', async () => {
  setup(() => ({
    status: 200,
    body: toolUse({ diagnosis: 'Traz duas ideias.', macete: 'Macete: SOS = Salvar', split: [{ question: 'P1?', answer: 'R1' }, { question: 'P2?', answer: 'R2' }] }),
  }));
  const fix = await claude.suggestLeechFixClaude({ question: 'Qual o quórum?', answer: 'O mínimo de nós.', context: 'Redes · Cluster', errors: 4, reviews: 6 });
  assert.deepEqual(fix, {
    diagnosis: 'Traz duas ideias.',
    macete: 'SOS = Salvar',
    split: [{ question: 'P1?', answer: 'R1' }, { question: 'P2?', answer: 'R2' }],
  });

  const body = fake.requests[0].body;
  assert.match(body.system, /tutor de estudos/);
  assert.match(body.messages[0].content, /Coleção: Redes · Cluster/);
  assert.match(body.messages[0].content, /errou este cartão 4 das últimas 6 revisões/);
  assert.match(body.messages[0].content, /Pergunta: Qual o quórum\?\nResposta: O mínimo de nós\./);
  assert.equal(body.tools[0].input_schema.required.join(','), 'diagnosis,macete,split');
});

test('sugestão para cartão sanguessuga: resposta sem macete nem divisão é erro (a cadeia tenta o próximo provedor)', async () => {
  setup(() => ({ status: 200, body: toolUse({ diagnosis: 'Só o diagnóstico.', macete: '', split: [] }) }));
  await assert.rejects(claude.suggestLeechFixClaude({ question: 'Qual o quórum?', answer: 'O mínimo de nós.', context: 'Redes · Cluster', errors: 4, reviews: 6 }), /nenhuma sugestão utilizável/);
});

test('edital: texto e PDF escaneado, com o cargo pedido na instrução', async () => {
  setup(() => ({
    status: 200,
    body: toolUse({ name: 'Concurso', disciplines: [{ name: 'Redes', questionCount: 10, weight: null, cutoff: '', topics: ['DNS'] }] }),
  }));

  const fromText = await claude.extractSyllabusClaude({ type: 'text', text: 'CONTEÚDO PROGRAMÁTICO ...' }, 'Analista de TI');
  assert.equal((fromText.disciplines as unknown[]).length, 1);
  assert.match(fake.requests[0].body.system, /editais/);
  assert.match(fake.requests[0].body.messages[0].content, /cargo "Analista de TI"/);
  assert.match(fake.requests[0].body.messages[0].content, /--- DOCUMENTO ---\nCONTEÚDO PROGRAMÁTICO/);

  await claude.extractSyllabusClaude({ type: 'pdf', base64: 'UERG' }, '');
  assert.equal(fake.requests[1].body.messages[0].content[0].type, 'document');
});

test('falha: saldo esgotado vem como 400 com o aviso no texto', async () => {
  setup(() => ({ status: 400, body: apiError('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.') }));
  await assert.rejects(claude.generateSummaryClaude('x', 'padrao'), /sem créditos/);
  assert.equal(fake.requests.length, 1); // não insiste: saldo não se resolve tentando de novo
});

test('falha: chave inválida e modelo inexistente', async () => {
  setup(() => ({ status: 401, body: apiError('authentication_error', 'invalid x-api-key') }));
  await assert.rejects(claude.generateSummaryClaude('x', 'padrao'), /inválida/);

  setup(() => ({ status: 404, body: apiError('not_found_error', 'model: claude-xyz') }));
  await assert.rejects(claude.generateSummaryClaude('x', 'padrao'), /ANTHROPIC_MODEL/);
});

test('falha: limite de uso e sobrecarga são repetidos pelo SDK antes de desistir', async () => {
  setup(() => ({ status: 429, body: apiError('rate_limit_error', 'rate limited'), headers: fastRetry }));
  await assert.rejects(claude.generateSummaryClaude('x', 'padrao'), /Limite de uso/);
  assert.equal(fake.requests.length, 4); // a original + 3 repetições

  setup(() => ({ status: 529, body: apiError('overloaded_error', 'Overloaded'), headers: fastRetry }));
  await assert.rejects(claude.generateSummaryClaude('x', 'padrao'), /alta demanda/);
  assert.equal(fake.requests.length, 4);
});

test('falha: uma repetição que dá certo devolve o resultado normalmente', async () => {
  let calls = 0;
  setup(() => {
    calls++;
    return calls === 1
      ? { status: 529, body: apiError('overloaded_error', 'Overloaded'), headers: fastRetry }
      : { status: 200, body: toolUse({ title: 'T', content: 'C' }) };
  });
  assert.deepEqual(await claude.generateSummaryClaude('x', 'padrao'), { title: 'T', content: 'C' });
  assert.equal(fake.requests.length, 2);
});

test('resposta cortada ou sem o resultado vira erro claro, não dado quebrado', async () => {
  setup(() => ({ status: 200, body: message([{ type: 'tool_use', id: 't', name: 'entregar_resultado', input: { flashcards: [] } }], { stop_reason: 'max_tokens' }) }));
  await assert.rejects(claude.generateFlashcardsClaude({ type: 'topic', topic: 'x' }, OPTIONS), /cortada/);

  setup(() => ({ status: 200, body: message([{ type: 'text', text: 'não usei a ferramenta' }], { stop_reason: 'end_turn' }) }));
  await assert.rejects(claude.generateFlashcardsClaude({ type: 'topic', topic: 'x' }, OPTIONS), /formato esperado/);

  setup(() => ({ status: 200, body: toolUse({ flashcards: [] }) }));
  await assert.rejects(claude.generateFlashcardsClaude({ type: 'topic', topic: 'x' }, OPTIONS), /não conseguiu gerar/);
});

test('sem chave configurada, a chamada falha antes de sair da máquina', async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    setup(() => ({ status: 200, body: toolUse({}) }));
    await assert.rejects(claude.generateSummaryClaude('x', 'padrao'), /ANTHROPIC_API_KEY/);
    assert.equal(fake.requests.length, 0);
  } finally {
    process.env.ANTHROPIC_API_KEY = key;
  }
});

test('conferência: o pedido leva o contexto e o esquema, e a resposta passa pela validação', async () => {
  const sources = [{ n: 1, question: 'Prazo da LGPD?', answer: '48 horas.' }, { n: 2, question: 'Porta do SSH?', answer: '22.' }];
  setup(() => ({
    status: 200,
    body: toolUse({ checks: [{ n: 1, verdict: 'duvida', note: 'Confirme o prazo na norma.' }, { n: 7, verdict: 'ok', note: '' }, { n: 2, verdict: 'ok', note: '' }] }),
  }));

  const result = await claude.verifyCardsClaude(sources, 'concurso TRANSPETRO 2026');
  assert.deepEqual(result, [{ n: 1, verdict: 'duvida', note: 'Confirme o prazo na norma.' }, { n: 2, verdict: 'ok', note: '' }]);

  const body = fake.requests[0].body;
  assert.match(body.system, /revisor técnico/);
  assert.match(body.messages[0].content, /Contexto: concurso TRANSPETRO 2026/);
  assert.match(body.messages[0].content, /\[n=2\]\nPergunta: Porta do SSH\?\nResposta: 22\./);
  assert.equal(body.tools[0].input_schema.properties.checks.items.required.join(','), 'n,verdict,note');
});

test('conferência: resposta sem nenhuma conferência aproveitável é erro (a cadeia tenta o próximo provedor)', async () => {
  setup(() => ({ status: 200, body: toolUse({ checks: [{ n: 9, verdict: 'ok', note: '' }] }) }));
  await assert.rejects(claude.verifyCardsClaude([{ n: 1, question: 'P', answer: 'R' }], ''), /não retornou a conferência/);
});
