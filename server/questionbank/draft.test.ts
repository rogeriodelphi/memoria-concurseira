import assert from 'node:assert/strict';
import test from 'node:test';

import { ANNULLED, MAX_QUESTIONS_PER_EXAM, type Chunk, type ExtractedQuestion } from '../ai/pastexam';
import { buildDraft, missingNumbers, validateDraft, type Reading } from './draft';

const alts = (n = 4) => ['A', 'B', 'C', 'D', 'E'].slice(0, n).map((letter) => ({ letter, text: `Alternativa ${letter}` }));

const question = (number: number, over: Partial<ExtractedQuestion> = {}): ExtractedQuestion => ({
  number,
  support: '',
  statement: `Enunciado da questão ${number} sobre administração pública`,
  alternatives: alts(),
  discipline: 'Direito',
  subject: 'Atos',
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
  reject(null, /nome/);
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
