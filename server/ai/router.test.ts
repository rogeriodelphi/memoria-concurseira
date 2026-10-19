import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { NO_PROVIDER_MESSAGE } from './chain';
import { isolateDatabase, startFakeAnthropic, toolUse, type FakeAnthropic } from './fakeAnthropic';
import type { GenerationOptions } from './gemini';
import type { PdfInfo, RouterDeps } from './router';

// Importar o roteador abre o banco: isolado num diretório temporário.
const restoreCwd = isolateDatabase();
const router = await import('./router');

const OPTIONS: GenerationOptions = { quantity: 'auto', difficulty: 'misto', cardType: 'misto', depth: 'normal' };
const FLASHCARDS = { flashcards: [{ question: 'P', answer: 'R', difficulty: 'medio' }] };

let fake: FakeAnthropic;
const saved: Record<string, string | undefined> = {};
const MANAGED = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'AI_PROVIDER_ORDER'];

before(async () => {
  for (const name of MANAGED) saved[name] = process.env[name];
  fake = await startFakeAnthropic();
});

after(async () => {
  await fake.close();
  for (const name of MANAGED) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  await restoreCwd();
});

/** Só o Claude configurado, na ordem padrão, respondendo `reply` a qualquer chamada. */
function onlyClaude(reply: unknown = toolUse(FLASHCARDS)) {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_PROVIDER_ORDER;
  fake.respond(() => ({ status: 200, body: reply }));
}

const notConfigured = (e: Error) => e.message === NO_PROVIDER_MESSAGE;

// ---------- PDFs ----------
// O roteador decide pelo que o leitor de PDF devolve (texto e número de páginas).
// Aqui o leitor é substituído por uma resposta pronta para cada caso, em vez de
// depender de PDFs sintéticos que o leitor real (pdf.js antigo) abre ou não.

const LONG_TEXT = 'Conteudo programatico de redes de computadores, modelo OSI, TCP/IP, DNS e roteamento. '.repeat(3).trim();

function pdfWith(info: PdfInfo, bytes = 1024) {
  const buffer = Buffer.alloc(bytes, 'x');
  let reads = 0;
  const deps: RouterDeps = {
    readPdf: async () => {
      reads++;
      return info;
    },
  };
  return { buffer, deps, reads: () => reads, base64: buffer.toString('base64') };
}

const file = (buffer: Buffer, mimeType: string) => ({ type: 'file' as const, buffer, mimeType });

// ---------- testes ----------

test('só o Claude configurado: tópico, resumo, bullet points e mapa mental passam por ele', async () => {
  onlyClaude();
  const cards = await router.generateFlashcards({ type: 'topic', topic: 'DNS' }, OPTIONS);
  assert.equal(cards.flashcards.length, 1);
  assert.match(fake.requests[0].body.messages[0].content, /Tópico: "DNS"/);

  onlyClaude(toolUse({ title: 'T', content: 'C' }));
  assert.deepEqual(await router.generateSummary('texto', 'padrao'), { title: 'T', content: 'C' });

  onlyClaude(toolUse({ title: 'T', points: ['a'] }));
  assert.deepEqual(await router.generateBulletPoints('texto'), { title: 'T', points: ['a'] });

  onlyClaude(toolUse({ title: 'Raiz', children: [{ title: 'Ramo' }] }));
  assert.deepEqual(await router.generateMindMap({ type: 'topic', topic: 'x' }), {
    title: 'Raiz',
    children: [{ title: 'Ramo' }],
  });
});

test('sugestão para cartão sanguessuga: passa pela cadeia de provedores como as demais gerações', async () => {
  const source = { question: 'Qual o quórum?', answer: 'O mínimo de nós.', context: 'Redes · Cluster', errors: 4, reviews: 6 };
  onlyClaude(toolUse({ diagnosis: 'Traz duas ideias.', macete: 'SOS', split: [] }));
  assert.deepEqual(await router.suggestLeechFix(source), { diagnosis: 'Traz duas ideias.', macete: 'SOS', split: [] });

  // Resposta inutilizável do único provedor: o erro chega a quem chamou, sem inventar sugestão.
  onlyClaude(toolUse({ diagnosis: 'x', macete: '', split: [] }));
  await assert.rejects(router.suggestLeechFix(source), /nenhuma sugestão utilizável/);

  // Sem nenhum provedor configurado.
  onlyClaude();
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(router.suggestLeechFix(source), notConfigured);
  } finally {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  }
});

test('alternativas: passam pela cadeia de provedores como as demais gerações', async () => {
  const sources = [{ n: 1, question: 'P', answer: 'R' }];
  onlyClaude(toolUse({ questions: [{ n: 1, correct: 'Certa', wrong: ['E1', 'E2', 'E3', 'E4'] }] }));
  assert.deepEqual(await router.generateChoices(sources), [{ n: 1, correct: 'Certa', wrong: ['E1', 'E2', 'E3', 'E4'] }]);

  // Resposta inutilizável do único provedor: o erro chega a quem chamou, sem inventar alternativas.
  onlyClaude(toolUse({ questions: [] }));
  await assert.rejects(router.generateChoices(sources), /formato esperado/);

  // Sem nenhum provedor configurado.
  onlyClaude();
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(router.generateChoices(sources), notConfigured);
  } finally {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  }
});

test('mídia que o Claude não processa não é enviada: sem outro provedor, vira erro de configuração', async () => {
  onlyClaude();
  await assert.rejects(router.generateFlashcards({ type: 'youtube', url: 'https://youtu.be/x' }, OPTIONS), notConfigured);
  await assert.rejects(router.generateFlashcards(file(Buffer.from('x'), 'audio/mpeg'), OPTIONS), notConfigured);
  await assert.rejects(router.generateFlashcards(file(Buffer.from('x'), 'video/mp4'), OPTIONS), notConfigured);
  assert.equal(fake.requests.length, 0);
});

test('imagem: formatos aceitos seguem como imagem; os outros são pulados', async () => {
  onlyClaude();
  await router.generateFlashcards(file(Buffer.from('imagem'), 'image/png'), OPTIONS);
  const block = fake.requests[0].body.messages[0].content[0];
  assert.equal(block.type, 'image');
  assert.equal(block.source.media_type, 'image/png');
  assert.equal(block.source.data, Buffer.from('imagem').toString('base64'));

  fake.respond(() => ({ status: 200, body: toolUse(FLASHCARDS) }));
  await assert.rejects(router.generateFlashcards(file(Buffer.from('x'), 'image/bmp'), OPTIONS), notConfigured);
  assert.equal(fake.requests.length, 0);
});

test('o PDF só é lido quando a fonte é um PDF', async () => {
  onlyClaude();
  const pdf = pdfWith({ text: '', pages: 1 });
  await router.generateFlashcards({ type: 'topic', topic: 'x' }, OPTIONS, pdf.deps);
  await router.generateFlashcards(file(Buffer.from('i'), 'image/png'), OPTIONS, pdf.deps);
  assert.equal(pdf.reads(), 0);

  await router.generateFlashcards(file(pdf.buffer, 'application/pdf'), OPTIONS, pdf.deps);
  assert.equal(pdf.reads(), 1);
});

test('PDF com texto vai como texto extraído, não como arquivo', async () => {
  onlyClaude();
  const pdf = pdfWith({ text: LONG_TEXT, pages: 2 });
  await router.generateFlashcards(file(pdf.buffer, 'application/pdf'), OPTIONS, pdf.deps);
  const content = fake.requests[0].body.messages[0].content;
  assert.equal(typeof content, 'string');
  assert.match(content, /ARQUIVO "documento\.pdf"/);
  assert.match(content, /modelo OSI, TCP\/IP, DNS/);
  assert.ok(!content.includes(pdf.base64), 'o arquivo em si não deve ir junto');
});

test('PDF escaneado vai inteiro, como documento', async () => {
  onlyClaude();
  const pdf = pdfWith({ text: '', pages: 3 });
  await router.generateFlashcards(file(pdf.buffer, 'application/pdf'), OPTIONS, pdf.deps);
  const blocks = fake.requests[0].body.messages[0].content;
  assert.equal(blocks[0].type, 'document');
  assert.equal(blocks[0].source.media_type, 'application/pdf');
  assert.equal(blocks[0].source.data, pdf.base64);
});

test('PDF com texto curto demais conta como escaneado', async () => {
  onlyClaude();
  const pdf = pdfWith({ text: 'só um rodapé', pages: 4 });
  await router.generateFlashcards(file(pdf.buffer, 'application/pdf'), OPTIONS, pdf.deps);
  assert.equal(fake.requests[0].body.messages[0].content[0].type, 'document');
});

test('PDF que o leitor do app não abre (0 páginas) ainda é tentado como documento', async () => {
  onlyClaude();
  const pdf = pdfWith({ text: '', pages: 0 });
  await router.generateFlashcards(file(pdf.buffer, 'application/pdf'), OPTIONS, pdf.deps);
  assert.equal(fake.requests[0].body.messages[0].content[0].type, 'document');
});

test('limite do Claude: 100 páginas passam, 101 não; arquivo acima de 20 MB também não', async () => {
  onlyClaude();
  const atLimit = pdfWith({ text: '', pages: 100 });
  await router.generateFlashcards(file(atLimit.buffer, 'application/pdf'), OPTIONS, atLimit.deps);
  assert.equal(fake.requests.length, 1);

  onlyClaude();
  const tooManyPages = pdfWith({ text: '', pages: 101 });
  await assert.rejects(router.generateFlashcards(file(tooManyPages.buffer, 'application/pdf'), OPTIONS, tooManyPages.deps), notConfigured);

  const tooBig = pdfWith({ text: '', pages: 5 }, 20 * 1024 * 1024 + 1);
  await assert.rejects(router.generateFlashcards(file(tooBig.buffer, 'application/pdf'), OPTIONS, tooBig.deps), notConfigured);
  assert.equal(fake.requests.length, 0);

  // o limite de páginas é só para o PDF inteiro: com texto extraído, qualquer tamanho segue como texto
  const longWithText = pdfWith({ text: LONG_TEXT, pages: 400 });
  await router.generateFlashcards(file(longWithText.buffer, 'application/pdf'), OPTIONS, longWithText.deps);
  assert.equal(typeof fake.requests[0].body.messages[0].content, 'string');
});

test('ordem configurada: um provedor fora da lista nunca é usado', async () => {
  onlyClaude();
  process.env.AI_PROVIDER_ORDER = 'gemini,openai';
  await assert.rejects(router.generateSummary('texto', 'padrao'), notConfigured);
  assert.equal(fake.requests.length, 0);

  process.env.AI_PROVIDER_ORDER = 'gemini,claude';
  fake.respond(() => ({ status: 200, body: toolUse({ title: 'T', content: 'C' }) }));
  assert.deepEqual(await router.generateSummary('texto', 'padrao'), { title: 'T', content: 'C' });
  assert.equal(fake.requests.length, 1);
});

const SYLLABUS = toolUse({
  name: 'Concurso',
  position: 'Analista',
  board: 'Banca',
  examDate: '2026-12-06',
  disciplines: [{ name: 'Redes', questionCount: 10, weight: 2, cutoff: '', topics: ['DNS'] }],
});

test('edital: texto colado, PDF com texto e PDF escaneado, cada um do jeito certo', async () => {
  onlyClaude(SYLLABUS);
  const fromText = await router.extractSyllabus({ type: 'text', text: 'CONTEÚDO PROGRAMÁTICO\nRedes: DNS' }, 'Analista');
  assert.equal((fromText.disciplines as unknown[]).length, 1);
  assert.match(fake.requests[0].body.messages[0].content, /--- DOCUMENTO ---\nCONTEÚDO PROGRAMÁTICO/);
  assert.match(fake.requests[0].body.messages[0].content, /cargo "Analista"/);

  onlyClaude(SYLLABUS);
  const withText = pdfWith({ text: LONG_TEXT, pages: 30 });
  await router.extractSyllabus(file(withText.buffer, 'application/pdf'), '', withText.deps);
  assert.match(fake.requests[0].body.messages[0].content, /--- DOCUMENTO ---\nConteudo programatico de redes/);

  onlyClaude(SYLLABUS);
  const scanned = pdfWith({ text: '', pages: 12 });
  await router.extractSyllabus(file(scanned.buffer, 'application/pdf'), '', scanned.deps);
  const blocks = fake.requests[0].body.messages[0].content;
  assert.equal(blocks[0].type, 'document');
  assert.equal(blocks[0].source.data, scanned.base64);
});

test('edital: texto grande demais é recusado antes de qualquer chamada', async () => {
  onlyClaude(SYLLABUS);
  await assert.rejects(
    router.extractSyllabus({ type: 'text', text: 'a'.repeat(router.MAX_SYLLABUS_CHARS + 1) }, ''),
    /longo demais/,
  );
  const hugeText = pdfWith({ text: 'b'.repeat(router.MAX_SYLLABUS_CHARS + 1), pages: 900 });
  await assert.rejects(router.extractSyllabus(file(hugeText.buffer, 'application/pdf'), '', hugeText.deps), /longo demais/);
  assert.equal(fake.requests.length, 0);
});

test('edital escaneado com páginas demais não vai ao Claude', async () => {
  onlyClaude(SYLLABUS);
  const tooMany = pdfWith({ text: '', pages: 101 });
  await assert.rejects(router.extractSyllabus(file(tooMany.buffer, 'application/pdf'), '', tooMany.deps), notConfigured);
  assert.equal(fake.requests.length, 0);
});

test('conferência de cartões: passa pela cadeia de provedores, e uma resposta inutilizável vira erro', async () => {
  const sources = [{ n: 1, question: 'P', answer: 'R' }];
  onlyClaude(toolUse({ checks: [{ n: 1, verdict: 'erro', note: 'Está errado.' }] }));
  assert.deepEqual(await router.verifyCards(sources, 'concurso X'), [{ n: 1, verdict: 'erro', note: 'Está errado.' }]);

  onlyClaude(toolUse({ checks: [] }));
  await assert.rejects(router.verifyCards(sources, ''), /não retornou a conferência/);

  onlyClaude();
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(router.verifyCards(sources, ''), notConfigured);
  } finally {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  }
});

test('ordem da conferência: o contrário da geração (para tender a ser outro provedor), ou a de AI_VERIFY_ORDER', () => {
  assert.deepEqual(router.verifyProviderOrder({}), ['claude', 'gemini', 'openai']);
  assert.deepEqual(router.verifyProviderOrder({ AI_PROVIDER_ORDER: 'claude,gemini' }), ['gemini', 'claude']);
  assert.deepEqual(router.verifyProviderOrder({ AI_PROVIDER_ORDER: 'gemini' }), ['gemini']);
  assert.deepEqual(router.verifyProviderOrder({ AI_VERIFY_ORDER: 'openai,claude' }), ['openai', 'claude']);
  assert.deepEqual(router.verifyProviderOrder({ AI_PROVIDER_ORDER: 'gemini', AI_VERIFY_ORDER: 'claude' }), ['claude'], 'a variável própria vale mais');
  assert.deepEqual(router.verifyProviderOrder({ AI_VERIFY_ORDER: '  ' }), ['claude', 'gemini', 'openai'], 'vazia = padrão');
  assert.deepEqual(router.verifyProviderOrder({ AI_VERIFY_ORDER: 'lixo' }), ['openai', 'gemini', 'claude'], 'só lixo cai na ordem padrão de geração');
});

// ---------- provas anteriores ----------

const examReply = (numbers: number[], extra: Record<string, unknown> = {}) =>
  toolUse({
    exam: { name: 'Prova Teste', board: 'FGV', organ: '', year: 2023, position: '', level: 'Superior' },
    supports: [],
    questions: numbers.map((number) => ({
      number,
      supportId: 0,
      statement: `Enunciado da questão ${number} sobre licitações públicas`,
      alternatives: ['A', 'B', 'C', 'D'].map((letter) => ({ letter, text: `Alternativa ${letter}` })),
      discipline: 'Direito',
      subject: 'Licitações',
      needsFigure: false,
      complete: true,
    })),
    answerKey: [],
    ...extra,
  });

test('prova: texto curto vai num trecho só e o progresso é avisado', async () => {
  onlyClaude(examReply([1, 2]));
  const progress: [number, number][] = [];
  const reading = await router.extractPastExam({ type: 'text', text: 'QUESTÃO 1 ... QUESTÃO 2 ...' }, { board: 'FGV' }, { onProgress: (d, t) => progress.push([d, t]) });
  assert.equal(fake.requests.length, 1);
  assert.deepEqual(reading.chunks[0].questions.map((q) => q.number), [1, 2]);
  assert.equal(reading.text, 'QUESTÃO 1 ... QUESTÃO 2 ...');
  assert.deepEqual(progress, [[0, 1], [1, 1]]);
  const content = fake.requests[0].body.messages[0].content as string;
  assert.match(content, /banca: FGV/);
  assert.match(content, /--- TEXTO DO PDF ---\nQUESTÃO 1/);
  assert.doesNotMatch(content, /trecho 1 de/, 'trecho único não precisa dizer a posição');
});

test('prova: texto longo é lido em vários trechos que se sobrepõem, e o resultado vem na ordem', async () => {
  const lines = Array.from({ length: 1500 }, (_, i) => `linha ${i} do texto da prova com enunciado e alternativas`);
  const text = lines.join('\n'); // ~ 80 mil caracteres
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_PROVIDER_ORDER;
  let call = 0;
  fake.respond(() => ({ status: 200, body: examReply([++call]) }));
  const progress: number[] = [];
  const reading = await router.extractPastExam({ type: 'text', text }, {}, { onProgress: (d) => progress.push(d) });

  assert.ok(reading.chunks.length >= 5, `${reading.chunks.length} trechos`);
  assert.equal(fake.requests.length, reading.chunks.length);
  const prompts = fake.requests.map((r) => r.body.messages[0].content as string);
  assert.ok(prompts.some((p) => new RegExp(`trecho 1 de ${reading.chunks.length}`).test(p)));
  assert.ok(prompts.some((p) => new RegExp(`trecho ${reading.chunks.length} de ${reading.chunks.length}`).test(p)));
  assert.deepEqual(progress.at(-1), reading.chunks.length, 'o último aviso é o total');
  assert.equal(progress.length, reading.chunks.length + 1);
  // Cada linha do texto foi enviada em algum trecho.
  const sent = prompts.join('\n');
  for (const line of [lines[0], lines[700], lines[1499]]) assert.ok(sent.includes(line));
});

test('prova: PDF com texto vai como texto; escaneado vai inteiro ao Claude; texto demais é recusado antes de chamar', async () => {
  onlyClaude(examReply([1]));
  const withText = pdfWith({ text: LONG_TEXT, pages: 30 });
  const read = await router.extractPastExam(file(withText.buffer, 'application/pdf'), {}, {}, withText.deps);
  assert.equal(read.text, LONG_TEXT);
  assert.match(fake.requests[0].body.messages[0].content, /--- TEXTO DO PDF ---\nConteudo programatico/);

  onlyClaude(examReply([1]));
  const scanned = pdfWith({ text: '', pages: 12 });
  const scannedRead = await router.extractPastExam(file(scanned.buffer, 'application/pdf'), {}, {}, scanned.deps);
  assert.equal(scannedRead.text, null);
  const blocks = fake.requests[0].body.messages[0].content;
  assert.equal(blocks[0].type, 'document');
  assert.equal(blocks[0].source.data, scanned.base64);

  onlyClaude(examReply([1]));
  const huge = pdfWith({ text: 'x'.repeat(400_001), pages: 900 });
  await assert.rejects(router.extractPastExam(file(huge.buffer, 'application/pdf'), {}, {}, huge.deps), /longo demais/);
  assert.equal(fake.requests.length, 0);
});

test('prova: um gabarito curto (poucas letras) ainda conta como texto, com o limite menor', async () => {
  onlyClaude(examReply([], { answerKey: [{ number: 1, answer: 'C' }, { number: 2, answer: 'ANULADA' }] }));
  const shortKey = pdfWith({ text: 'GABARITO 1 C 2 X 3 A 4 B 5 D', pages: 1 });
  const read = await router.extractPastExam(file(shortKey.buffer, 'application/pdf'), {}, { minTextChars: 20 }, shortKey.deps);
  assert.equal(read.text, 'GABARITO 1 C 2 X 3 A 4 B 5 D');
  assert.deepEqual([...read.chunks[0].answerKey], [[1, 'C'], [2, 'ANULADA']]);
  assert.match(fake.requests[0].body.messages[0].content, /--- TEXTO DO PDF ---\nGABARITO/);
});

test('prova: se um trecho falha, a leitura toda falha com o motivo e não segue chamando', async () => {
  const lines = Array.from({ length: 1500 }, (_, i) => `linha ${i} do texto da prova com enunciado e alternativas`);
  onlyClaude();
  fake.respond(() => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } }));
  await assert.rejects(router.extractPastExam({ type: 'text', text: lines.join('\n') }, {}), (e: Error) => e.message.length > 0);
  assert.ok(fake.requests.length <= 2, `parou depois de ${fake.requests.length} chamadas`);
});
