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
