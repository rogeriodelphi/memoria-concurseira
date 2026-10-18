import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { isolateDatabase, startFakeAnthropic, toolUse, type FakeAnthropic } from './fakeAnthropic';
import type { PdfInfo, RouterDeps } from './router';

// A captura (imagem) de uma página de um site de questões vai inteira ao Claude, que devolve cada questão com o código,
// a resposta escrita junto dela, o gabarito comentado e a prova, o ano, a banca e o órgão dela.
const restoreCwd = isolateDatabase();
const router = await import('./router');
const { buildDraft } = await import('../questionbank/draft');

let fake: FakeAnthropic;
const saved: Record<string, string | undefined> = {};
const MANAGED = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'AI_PROVIDER_ORDER'];

before(async () => {
  for (const name of MANAGED) saved[name] = process.env[name];
  fake = await startFakeAnthropic();
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_PROVIDER_ORDER;
});

after(async () => {
  await fake.close();
  for (const name of MANAGED) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  await restoreCwd();
});

const scannedPdf = (pages = 12) => {
  const buffer = Buffer.alloc(2048, 'x');
  const info: PdfInfo = { text: '', pages };
  const deps: RouterDeps = { readPdf: async () => info };
  return { buffer, deps, base64: buffer.toString('base64') };
};

const alternatives = (prefix: string) => ['A', 'B', 'C', 'D', 'E'].map((letter) => ({ letter, text: `${prefix} ${letter}` }));

const PROVA_A = 'Banca X - 2026 - Prefeitura de Exemplo - SP - Técnico em Informática';
const PROVA_B = 'Banca Y - 2025 - Universidade Exemplo - Técnico de TI';

const raw = (over: Record<string, unknown>) => ({
  number: 1,
  sourceId: '',
  supportId: 0,
  statement: 'Enunciado de uma questão sobre resolução de nomes.',
  alternatives: alternatives('Opção'),
  answer: '',
  comment: '',
  year: 0,
  board: '',
  organ: '',
  prova: '',
  discipline: 'Redes de Computadores',
  subject: 'DNS',
  needsFigure: false,
  complete: true,
  ...over,
});

const SITE_PAGE = toolUse({
  exam: { name: '', board: '', organ: '', year: 0, position: '', level: '' },
  supports: [],
  questions: [
    raw({ number: 1, sourceId: 'Q1000001', answer: 'C', comment: 'Gabarito: C\nFundamento decisivo: o resolvedor é o intermediário.\nAnálise das alternativas: A errada; C certa.', year: 2026, board: 'Banca X', organ: 'Prefeitura de Exemplo - SP', prova: PROVA_A }),
    raw({ number: 2, sourceId: 'Q1000002', answer: 'C', comment: 'Gabarito: C\nFundamento decisivo: associação de protocolos.', year: 2026, board: 'Banca X', organ: 'Prefeitura de Exemplo - SP', prova: PROVA_A }),
    raw({ number: 3, sourceId: 'Q1000003', statement: 'Outra questão, de outra prova, sem gabarito comentado.', year: 2025, board: 'Banca Y', organ: 'Universidade Exemplo', prova: PROVA_B }),
  ],
  answerKey: [],
});

test('captura de um site de questões: o PDF escaneado vai inteiro ao Claude e cada questão volta com os seus dados', async () => {
  fake.respond(() => ({ status: 200, body: SITE_PAGE }));
  const pdf = scannedPdf();
  const reading = await router.extractPastExam({ type: 'file', buffer: pdf.buffer, mimeType: 'application/pdf' }, {}, {}, pdf.deps);

  assert.equal(reading.text, null, 'sem texto para conferir: é imagem');
  assert.equal(fake.requests.length, 1, 'uma chamada só, com o PDF todo');
  const blocks = fake.requests[0].body.messages[0].content;
  assert.equal(blocks[0].type, 'document');
  assert.equal(blocks[0].source.data, pdf.base64);
  assert.match(blocks[1].text, /Transcreva as questões/);
  assert.match(fake.requests[0].body.system as string, /PÁGINAS DE SITE DE QUESTÕES/, 'o pedido ensina a ler esse tipo de página');

  const [q1, q2, q3] = reading.chunks[0].questions;
  assert.deepEqual([q1.sourceId, q1.answer, q1.year, q1.board, q1.organ, q1.prova], ['Q1000001', 'C', 2026, 'Banca X', 'Prefeitura de Exemplo - SP', PROVA_A]);
  assert.match(q1.comment, /^Gabarito: C\nFundamento decisivo/);
  assert.match(q1.comment, /C certa\.$/, 'o comentário vem inteiro');
  assert.equal(q2.sourceId, 'Q1000002');
  assert.deepEqual([q3.prova, q3.year, q3.comment, q3.answer], [PROVA_B, 2025, '', '']);
});

test('captura de um site de questões: vira um rascunho com a resposta de cada questão, sem pedir a tabela do gabarito', async () => {
  fake.respond(() => ({ status: 200, body: SITE_PAGE }));
  const pdf = scannedPdf();
  const reading = await router.extractPastExam({ type: 'file', buffer: pdf.buffer, mimeType: 'application/pdf' }, {}, {}, pdf.deps);
  const draft = buildDraft([reading]);

  assert.deepEqual(draft.questions.map((q) => [q.number, q.sourceId, q.answer, q.annulled]), [[1, 'Q1000001', 'C', false], [2, 'Q1000002', 'C', false], [3, 'Q1000003', '', false]]);
  const text = draft.warnings.join('\n');
  assert.match(text, /1 questão ficou sem gabarito \(Q1000003\)/);
  assert.doesNotMatch(text, /Não encontrei o gabarito\./, 'duas questões trazem a resposta escrita');
  assert.doesNotMatch(text, /Não encontrei as questões/, 'a numeração de um site é só a posição');
  assert.match(text, /escaneado ou é uma imagem/);
  assert.equal(draft.questions[0].comment.startsWith('Gabarito: C'), true);
});

test('o Claude recebe a nova forma do pedido: o esquema pede os campos de site de questões', async () => {
  fake.respond(() => ({ status: 200, body: SITE_PAGE }));
  const pdf = scannedPdf();
  await router.extractPastExam({ type: 'file', buffer: pdf.buffer, mimeType: 'application/pdf' }, {}, {}, pdf.deps);
  const schema = fake.requests[0].body.tools[0].input_schema;
  const required = schema.properties.questions.items.required as string[];
  for (const field of ['sourceId', 'answer', 'comment', 'year', 'board', 'organ', 'prova']) assert.ok(required.includes(field), field);
});
