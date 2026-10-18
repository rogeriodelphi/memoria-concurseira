import assert from 'node:assert/strict';
import test from 'node:test';

import { ANNULLED, MAX_QUESTIONS_PER_EXAM, type Chunk, type ExtractedQuestion } from '../ai/pastexam';
import { buildDraft, groupByProva, missingNumbers, validateDraft, type Reading } from './draft';

const alts = (n = 4) => ['A', 'B', 'C', 'D', 'E'].slice(0, n).map((letter) => ({ letter, text: `Alternativa ${letter}` }));

const question = (number: number, over: Partial<ExtractedQuestion> = {}): ExtractedQuestion => ({
  number,
  sourceId: '',
  support: '',
  statement: `Enunciado da questão ${number} sobre administração pública`,
  alternatives: alts(),
  discipline: 'Direito',
  subject: 'Atos',
  answer: '',
  comment: '',
  year: null,
  board: '',
  organ: '',
  prova: '',
  needsFigure: false,
  ...over,
});

const chunk = (questions: ExtractedQuestion[], key: [number, string][] = []): Chunk => ({
  meta: { name: 'Prova', board: 'FGV', organ: '', year: 2023, position: '', level: '' },
  questions,
  answerKey: new Map(key),
});

// O texto do PDF que contém as palavras de todas as questões acima.
const PDF = 'Enunciado da questão sobre administração pública Alternativa';

const reading = (questions: ExtractedQuestion[], key: [number, string][] = [], text: string | null = PDF): Reading => ({
  chunks: [chunk(questions, key)],
  text,
});

test('números que faltam entre 1 e a última', () => {
  assert.deepEqual(missingNumbers([1, 2, 3]), []);
  assert.deepEqual(missingNumbers([1, 4, 6]), [2, 3, 5]);
  assert.deepEqual(missingNumbers([3]), [1, 2]);
  assert.deepEqual(missingNumbers([]), []);
});

test('rascunho: o gabarito é aplicado às questões, com anulada e sem gabarito', () => {
  const draft = buildDraft([reading([question(1), question(2), question(3)], [[1, 'C'], [2, ANNULLED]])]);
  assert.deepEqual(draft.questions.map((q) => [q.number, q.answer, q.annulled]), [[1, 'C', false], [2, '', true], [3, '', false]]);
  assert.equal(draft.meta.board, 'FGV');
  assert.ok(draft.warnings.some((w) => /1 questão ficou sem gabarito \(3\)/.test(w)));
});

test('rascunho: o gabarito pode vir de um segundo arquivo', () => {
  const draft = buildDraft([reading([question(1), question(2)]), reading([], [[1, 'A'], [2, 'D']], 'Gabarito 1 A 2 D')]);
  assert.deepEqual(draft.questions.map((q) => q.answer), ['A', 'D']);
  assert.equal(draft.warnings.length, 0);
});

test('rascunho: sem gabarito nenhum, avisa e deixa tudo em branco', () => {
  const draft = buildDraft([reading([question(1), question(2)])]);
  assert.ok(draft.warnings.some((w) => /Não encontrei o gabarito/.test(w)));
  assert.ok(draft.questions.every((q) => q.answer === '' && !q.annulled));
});

test('rascunho: letra do gabarito que a questão não tem é descartada com aviso', () => {
  const draft = buildDraft([reading([question(1, { alternatives: alts(4) })], [[1, 'E']])]);
  assert.equal(draft.questions[0].answer, '');
  assert.ok(draft.warnings.some((w) => /letra que a questão não tem/.test(w)));
});

test('rascunho: avisa de questões que faltam, gabarito conflitante, figura e escaneado', () => {
  const draft = buildDraft([
    {
      chunks: [chunk([question(1), question(4, { needsFigure: true })], [[1, 'A'], [4, 'B']]), chunk([], [[1, 'C']])],
      text: null,
    },
  ]);
  const text = draft.warnings.join('\n');
  assert.match(text, /Não encontrei as questões 2, 3./);
  assert.match(text, /respostas diferentes para a questão 1 /);
  assert.match(text, /1 questão depende de figura ou tabela que não vem no texto \(4\)/);
  assert.match(text, /escaneado/);
  assert.equal(draft.questions[0].answer, 'A', 'vale o primeiro gabarito');
  assert.ok(draft.questions.every((q) => !q.suspect), 'sem texto do PDF não há como suspeitar');
});

test('rascunho: questão que não bate com o texto do PDF fica suspeita', () => {
  const faithful = question(1);
  const invented = question(2, { statement: 'Redija uma dissertação argumentativa sobre mobilidade urbana sustentável', alternatives: [{ letter: 'A', text: 'Bicicletas elétricas compartilhadas' }, { letter: 'B', text: 'Corredores exclusivos' }] });
  const draft = buildDraft([reading([faithful, invented], [[1, 'A'], [2, 'B']])]);
  assert.deepEqual(draft.questions.map((q) => q.suspect), [false, true]);
  assert.ok(draft.warnings.some((w) => /da questão 2 não bate com o do PDF/.test(w)));
});

test('rascunho: passou do limite de questões, mantém as primeiras e avisa', () => {
  const many = Array.from({ length: MAX_QUESTIONS_PER_EXAM + 5 }, (_, i) => question(i + 1));
  const draft = buildDraft([reading(many)]);
  assert.equal(draft.questions.length, MAX_QUESTIONS_PER_EXAM);
  assert.ok(draft.warnings.some((w) => /mais de 200 questões/.test(w)));
});

test('rascunho: nomes de disciplina de trechos diferentes são unificados', () => {
  const draft = buildDraft([
    { chunks: [chunk([question(1, { discipline: 'Língua Portuguesa' })]), chunk([question(2, { discipline: 'língua portuguesa' }), question(3, { discipline: 'Língua Portuguesa' })])], text: PDF },
  ]);
  assert.deepEqual(new Set(draft.questions.map((q) => q.discipline)), new Set(['Língua Portuguesa']));
});

// ---------- confirmação ----------

const valid = (over: Record<string, unknown> = {}) => ({
  name: '  Prova   FGV 2023 ',
  board: 'FGV',
  organ: 'TJ',
  year: 2023,
  position: 'Analista',
  level: 'Superior',
  questions: [{ number: 1, support: '', statement: 'Qual é a resposta certa?', alternatives: alts(), answer: 'b', annulled: false, discipline: 'Direito', subject: 'Atos', needsFigure: false, suspect: false }],
  ...over,
});

test('confirmação: aceita o rascunho revisado e uniformiza os campos', () => {
  const result = validateDraft(valid());
  assert.ok(result.ok);
  assert.equal(result.draft.name, 'Prova FGV 2023');
  assert.equal(result.draft.questions[0].answer, 'B');
  assert.equal(result.draft.level, 'Superior');
});

test('confirmação: ordena as questões, ano fora do intervalo vira vazio, nível desconhecido vira vazio', () => {
  const q = valid().questions[0];
  const result = validateDraft(valid({ year: 1800, level: 'Pós', questions: [{ ...q, number: 5 }, { ...q, number: 2 }] }));
  assert.ok(result.ok);
  assert.equal(result.draft.year, null);
  assert.equal(result.draft.level, '');
  assert.deepEqual(result.draft.questions.map((x) => x.number), [2, 5]);
});

test('confirmação: anulada vale pela letra ANULADA ou pela marca, e não guarda letra', () => {
  const q = valid().questions[0];
  const byLetter = validateDraft(valid({ questions: [{ ...q, answer: 'ANULADA' }] }));
  const byFlag = validateDraft(valid({ questions: [{ ...q, answer: 'B', annulled: true }] }));
  for (const result of [byLetter, byFlag]) {
    assert.ok(result.ok);
    assert.equal(result.draft.questions[0].annulled, true);
    assert.equal(result.draft.questions[0].answer, '');
  }
});

test('confirmação: sem gabarito é permitido (a questão fica sem correção)', () => {
  const q = valid().questions[0];
  const result = validateDraft(valid({ questions: [{ ...q, answer: '' }] }));
  assert.ok(result.ok);
  assert.equal(result.draft.questions[0].answer, '');
});

test('confirmação: recusa o que não presta, dizendo qual questão', () => {
  const q = valid().questions[0];
  const reject = (body: unknown, message: RegExp) => {
    const result = validateDraft(body);
    assert.ok(!result.ok, 'devia recusar');
    assert.match(result.error, message);
  };
  reject(null, /ao menos uma questão/);
  reject(valid({ name: 'x' }), /nome/);
  reject(valid({ questions: [] }), /ao menos uma questão/);
  reject(valid({ questions: 'x' }), /ao menos uma questão/);
  reject(valid({ questions: Array.from({ length: MAX_QUESTIONS_PER_EXAM + 1 }, (_, i) => ({ ...q, number: i + 1 })) }), /passa de 200/);
  reject(valid({ questions: [{ ...q, number: 0 }] }), /número válido/);
  reject(valid({ questions: [q, q] }), /questão 1 aparece mais de uma vez/);
  reject(valid({ questions: [{ ...q, statement: 'curto' }] }), /questão 1 está sem enunciado/);
  reject(valid({ questions: [{ ...q, alternatives: alts(1) }] }), /alternativas da questão 1/);
  reject(valid({ questions: [{ ...q, alternatives: alts(3), answer: 'D' }] }), /gabarito da questão 1 \(D\)/);
});

// ---------- captura de um site de questões ----------

const PROVA_A = 'IDHTEC - 2026 - Prefeitura de Santa Filomena - PE - Técnico em Informática';
const PROVA_B = 'INSTITUTO AOCP - 2026 - UNIRIO - Técnico em Tecnologia da Informação';

const site = (id: string, over: Partial<ExtractedQuestion> = {}): ExtractedQuestion =>
  question(1, { sourceId: id, answer: 'C', comment: `Gabarito: C. Comentário de ${id}.`, prova: PROVA_A, board: 'IDHTEC', organ: 'Prefeitura de Santa Filomena - PE', year: 2026, ...over });

test('site de questões: renumera pela ordem, sem avisar de "questões que faltam", e a resposta vem da própria questão', () => {
  const draft = buildDraft([{ chunks: [chunk([site('Q10', { number: 1 }), site('Q11', { number: 2 }), site('Q99', { number: 7 })])], text: null }]);
  assert.deepEqual(draft.questions.map((q) => [q.number, q.sourceId, q.answer]), [[1, 'Q10', 'C'], [2, 'Q11', 'C'], [3, 'Q99', 'C']]);
  const text = draft.warnings.join('\n');
  assert.doesNotMatch(text, /Não encontrei as questões/, 'a numeração de um site não é a de uma prova');
  assert.doesNotMatch(text, /Não encontrei o gabarito/, 'a resposta veio escrita junto da questão');
  assert.match(text, /escaneado ou é uma imagem/);
  assert.equal(draft.questions[0].comment, 'Gabarito: C. Comentário de Q10.');
  assert.equal(draft.questions[0].board, 'IDHTEC');
});

test('site de questões: questão sem resposta escrita fica sem gabarito e é nomeada pelo código', () => {
  const draft = buildDraft([{ chunks: [chunk([site('Q1'), site('Q2', { answer: '', comment: '' })])], text: null }]);
  assert.equal(draft.questions[1].answer, '');
  assert.ok(draft.warnings.some((w) => /1 questão ficou sem gabarito \(Q2\)/.test(w)));
});

test('site de questões: resposta com letra que a questão não tem e questão sem o campo Prova são avisadas', () => {
  const draft = buildDraft([{ chunks: [chunk([site('Q1', { answer: 'E', alternatives: alts(4) }), site('Q2', { prova: '' })])], text: null }]);
  assert.equal(draft.questions[0].answer, '');
  const text = draft.warnings.join('\n');
  assert.match(text, /letra que a questão não tem/);
  assert.match(text, /Não consegui ler o campo Prova da questão Q2/);
});

test('site de questões: a tabela de gabarito não vale para elas (o número é só a posição); prova comum continua valendo pela tabela', () => {
  const withTable = buildDraft([{ chunks: [chunk([site('Q1', { number: 1, answer: 'A' })], [[1, 'D']])], text: null }]);
  assert.equal(withTable.questions[0].answer, 'A');
  const plain = buildDraft([reading([question(1, { answer: 'B' })], [[1, 'D']])]);
  assert.equal(plain.questions[0].answer, 'D', 'a tabela vale; e diz que difere do escrito junto da questão');
  assert.ok(plain.warnings.some((w) => /difere do que está escrito junto da questão 1/.test(w)));
});

// ---------- agrupar em provas ----------

const base = (over: Record<string, unknown> = {}) => ({
  name: '',
  board: '',
  organ: '',
  year: null,
  position: '',
  level: '',
  ...over,
});

const qd = (number: number, over: Record<string, unknown> = {}) => ({
  number,
  sourceId: '',
  support: '',
  statement: `Enunciado da questão ${number}`,
  alternatives: alts(),
  answer: 'A',
  annulled: false,
  comment: '',
  prova: '',
  board: '',
  organ: '',
  year: null,
  discipline: 'Informática',
  subject: '',
  needsFigure: false,
  suspect: false,
  ...over,
});

test('confirmação de um site: sem nome da importação, cada questão traz a prova; agrupa por nome (sem acento nem caixa)', () => {
  const result = validateDraft({
    ...base(),
    questions: [
      qd(1, { sourceId: 'q1', prova: PROVA_A, board: 'IDHTEC', year: 2026 }),
      qd(2, { sourceId: 'Q2', prova: PROVA_B, board: 'INSTITUTO AOCP', organ: 'UNIRIO', year: 2026 }),
      qd(3, { sourceId: 'Q3', prova: PROVA_A.toLowerCase(), organ: 'Prefeitura de Santa Filomena - PE' }),
    ],
  });
  assert.ok(result.ok, result.ok ? '' : result.error);
  assert.equal(result.draft.questions[0].sourceId, 'Q1');
  const groups = groupByProva(result.draft);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => [g.name === PROVA_A, g.questions.length]), [[true, 2], [false, 1]]);
  assert.deepEqual([groups[0].board, groups[0].organ, groups[0].year], ['IDHTEC', 'Prefeitura de Santa Filomena - PE', 2026], 'o que a primeira não trazia vem da outra');
});

test('confirmação de um site: o que a questão não diz vale o da importação; sem nome nenhum é recusado', () => {
  const ok = validateDraft({ ...base({ name: 'Minhas questões', board: 'FGV', year: 2020 }), questions: [qd(1, { sourceId: 'Q1' }), qd(2, { sourceId: 'Q2', prova: PROVA_A, board: 'IDHTEC' })] });
  assert.ok(ok.ok);
  const groups = groupByProva(ok.draft);
  assert.deepEqual(groups.map((g) => [g.name === 'Minhas questões', g.board, g.year]), [[true, 'FGV', 2020], [false, 'IDHTEC', 2020]]);

  const missing = validateDraft({ ...base(), questions: [qd(1, { sourceId: 'Q7' })] });
  assert.ok(!missing.ok);
  assert.match(missing.error, /Dê um nome à prova da questão Q7/);
});

test('confirmação: o mesmo código duas vezes é recusado, e o comentário é limpo', () => {
  const dup = validateDraft({ ...base({ name: 'Prova P' }), questions: [qd(1, { sourceId: 'Q1' }), qd(2, { sourceId: 'q1' })] });
  assert.ok(!dup.ok);
  assert.match(dup.error, /A questão Q1 aparece mais de uma vez/);
  const clean = validateDraft({ ...base({ name: 'Prova P' }), questions: [qd(1, { comment: '  Fundamento:   o X.\n\n  Dica:  Y  ' })] });
  assert.ok(clean.ok);
  assert.equal(clean.draft.questions[0].comment, 'Fundamento: o X.\nDica: Y');
});
