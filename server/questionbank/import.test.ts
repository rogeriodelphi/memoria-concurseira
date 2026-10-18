import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { Result } from '../mockexams/store';
import type { DraftQuestion, ValidDraft } from './draft';
import { QUESTION_BANK_SCHEMA, upgradeQuestionBankSchema } from './schema';
import { answerQuestion, getQuestionDetail, saveImport, searchQuestions, updateQuestion } from './store';

// Importação de um site de questões: várias provas numa captura só, código da questão e gabarito comentado.

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('u1'), ('u2');");
  db.exec(QUESTION_BANK_SCHEMA);
  upgradeQuestionBankSchema(db);
  return db;
}

function value<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}
function failure<T>(result: Result<T>, status: number, message?: RegExp): void {
  assert.ok(!result.ok, 'devia falhar');
  assert.equal(result.status, status, result.error);
  if (message) assert.match(result.error, message);
}

const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const alts = () => ['A', 'B', 'C', 'D'].map((letter) => ({ letter, text: `Alternativa ${letter}` }));

const PROVA_A = 'IDHTEC - 2026 - Prefeitura de Santa Filomena - PE - Técnico em Informática';
const PROVA_B = 'INSTITUTO AOCP - 2026 - UNIRIO - Técnico em Tecnologia da Informação';

const question = (number: number, over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  number,
  sourceId: '',
  support: '',
  statement: `Enunciado da questão ${number} sobre redes`,
  alternatives: alts(),
  answer: 'B',
  annulled: false,
  comment: '',
  prova: '',
  board: '',
  organ: '',
  year: null,
  discipline: 'Redes de Computadores',
  subject: '',
  needsFigure: false,
  suspect: false,
  ...over,
});

const site = (number: number, sourceId: string, over: Partial<DraftQuestion> = {}): DraftQuestion =>
  question(number, {
    sourceId,
    prova: PROVA_A,
    board: 'IDHTEC',
    organ: 'Prefeitura de Santa Filomena - PE',
    year: 2026,
    answer: 'C',
    comment: `Gabarito: C\nFundamento decisivo: comentário de ${sourceId}.`,
    ...over,
  });

const imported = (questions: DraftQuestion[], over: Partial<ValidDraft> = {}): ValidDraft => ({
  name: '',
  board: '',
  organ: '',
  year: null,
  position: '',
  level: '',
  questions,
  ...over,
});

const all = (db: DatabaseSync) => searchQuestions(db, 'u1', { filter: {} }).questions;
const bySource = (db: DatabaseSync, sourceId: string) => all(db).find((x) => x.sourceId === sourceId)!;

test('importar de um site: uma prova para cada nome de prova, com o ano, a banca e o órgão de cada uma', () => {
  const db = newDb();
  const saved = value(
    saveImport(db, 'u1', imported([site(1, 'Q1'), site(2, 'Q2', { prova: PROVA_B, board: 'INSTITUTO AOCP', organ: 'UNIRIO' }), site(3, 'Q3')])),
  );
  assert.equal(saved.added, 3);
  assert.equal(saved.skipped, 0);
  assert.deepEqual(
    saved.exams.map((e) => [e.name === PROVA_A, e.questionCount, e.board, e.year]),
    [[true, 2, 'IDHTEC', 2026], [false, 1, 'INSTITUTO AOCP', 2026]],
  );
  const rows = db.prepare('SELECT source_id, number FROM qb_questions ORDER BY source_id').all() as { source_id: string; number: number }[];
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [{ source_id: 'Q1', number: 1 }, { source_id: 'Q2', number: 1 }, { source_id: 'Q3', number: 2 }],
    'numeradas dentro de cada prova',
  );
  const first = bySource(db, 'Q1');
  assert.deepEqual([first.board, first.organ, first.year, first.examName === PROVA_A], ['IDHTEC', 'Prefeitura de Santa Filomena - PE', 2026, true]);
});

test('importar de um site: a questão que já está no banco, pelo código, não entra de novo', () => {
  const db = newDb();
  value(saveImport(db, 'u1', imported([site(1, 'Q1'), site(2, 'Q2')])));
  const again = value(saveImport(db, 'u1', imported([site(1, 'Q1'), site(2, 'Q2'), site(3, 'Q3')])));
  assert.deepEqual([again.added, again.skipped], [1, 2]);
  assert.equal(again.exams.length, 1);
  assert.equal(again.exams[0].questionCount, 3, 'a nova entrou na prova que já existia');
  const numbers = (db.prepare('SELECT number FROM qb_questions ORDER BY number').all() as { number: number }[]).map((r) => r.number);
  assert.deepEqual(numbers, [1, 2, 3], 'o número continua de onde a prova parou');

  const nothing = value(saveImport(db, 'u1', imported([site(1, 'Q1')])));
  assert.deepEqual([nothing.added, nothing.skipped, nothing.exams.length], [0, 1, 0]);
  assert.equal(count(db, 'qb_exams'), 1, 'não cria prova vazia');
  assert.equal(count(db, 'qb_questions'), 3);
});

test('importar de um site: cada usuário tem o seu código; sem código, prova repetida continua recusada', () => {
  const db = newDb();
  value(saveImport(db, 'u1', imported([site(1, 'Q1')])));
  assert.equal(value(saveImport(db, 'u2', imported([site(1, 'Q1')]))).added, 1, 'o outro usuário pode ter a mesma questão');
  failure(saveImport(db, 'u1', imported([question(1)], { name: PROVA_A })), 409, /já tem uma prova/);
  assert.equal(count(db, 'qb_questions'), 2, 'recusada antes de gravar qualquer coisa');
});

test('importar: se uma prova do lote é recusada, nenhuma é gravada', () => {
  const db = newDb();
  value(saveImport(db, 'u1', imported([site(1, 'Q1')])));
  const batch = imported([site(1, 'Q9', { prova: PROVA_B }), question(2, { prova: PROVA_A })]); // a segunda repete a prova A sem código
  failure(saveImport(db, 'u1', batch), 409);
  assert.equal(count(db, 'qb_exams'), 1);
  assert.equal(count(db, 'qb_questions'), 1);
});

test('gabarito comentado: só aparece depois de responder; livre se a questão não pode ser respondida', () => {
  const db = newDb();
  const saved = value(
    saveImport(
      db,
      'u1',
      imported([site(1, 'Q1'), site(2, 'Q2', { answer: '' }), site(3, 'Q3', { annulled: true, answer: '' }), site(4, 'Q4', { comment: '' })]),
    ),
  );
  assert.equal(saved.added, 4);
  const q1 = bySource(db, 'Q1');
  assert.deepEqual([q1.hasComment, q1.comment, q1.answer], [true, undefined, undefined], 'antes de responder o comentário não vai: ele entrega a resposta');
  assert.equal(bySource(db, 'Q2').comment?.startsWith('Gabarito: C'), true, 'sem gabarito não há o que estragar');
  assert.equal(bySource(db, 'Q3').comment?.startsWith('Gabarito: C'), true, 'anulada também');
  assert.deepEqual([bySource(db, 'Q4').hasComment, bySource(db, 'Q4').comment], [false, undefined]);

  const answered = value(answerQuestion(db, 'u1', q1.id, { chosen: 'A' }));
  assert.match(answered.comment, /comentário de Q1/, 'a própria correção já traz o comentário, para a tela mostrá-lo sem recarregar');
  assert.match(bySource(db, 'Q1').comment!, /Fundamento decisivo/, 'depois de responder vem junto com o gabarito');
  const detail = value(getQuestionDetail(db, 'u1', q1.id));
  assert.match(detail.question.comment!, /comentário de Q1/, 'quem pede a questão para editar a vê inteira');
});

test('gabarito comentado: dá para corrigir, filtrar e buscar', () => {
  const db = newDb();
  value(saveImport(db, 'u1', imported([site(1, 'Q1'), site(2, 'Q2', { comment: '' })])));
  const first = bySource(db, 'Q1');
  const second = bySource(db, 'Q2');
  assert.deepEqual(searchQuestions(db, 'u1', { filter: { onlyWithComment: true } }).questions.map((x) => x.sourceId), ['Q1']);
  assert.equal(searchQuestions(db, 'u1', { filter: { q: 'fundamento decisivo' } }).total, 1, 'a busca olha o comentário');
  assert.equal(searchQuestions(db, 'u1', { filter: { q: 'fundamento', onlyWithComment: true } }).total, 1);

  const fixed = value(updateQuestion(db, 'u1', second.id, { comment: '  Gabarito: C.\n\n  A banca cobrou o resolvedor.  ' }));
  assert.equal(fixed.comment, 'Gabarito: C.\nA banca cobrou o resolvedor.');
  assert.equal(searchQuestions(db, 'u1', { filter: { onlyWithComment: true } }).total, 2);
  assert.equal(value(updateQuestion(db, 'u1', first.id, { comment: '' })).hasComment, false);
  failure(updateQuestion(db, 'u2', first.id, { comment: 'x' }), 404);
});

test('banco antigo: a atualização acrescenta o código e o comentário sem mexer nas questões que já existem', () => {
  const old = new DatabaseSync(':memory:');
  old.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('u1');");
  old.exec(`
    CREATE TABLE qb_exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, board TEXT NOT NULL DEFAULT '', organ TEXT NOT NULL DEFAULT '',
      year INTEGER, position TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE qb_questions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, exam_id TEXT NOT NULL, number INTEGER NOT NULL, support TEXT NOT NULL DEFAULT '',
      statement TEXT NOT NULL, alternatives_json TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', annulled INTEGER NOT NULL DEFAULT 0,
      discipline TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', needs_figure INTEGER NOT NULL DEFAULT 0, suspect INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE (exam_id, number));
    INSERT INTO qb_exams (id, user_id, name, created_at) VALUES ('e1', 'u1', 'Prova antiga', 'x');
    INSERT INTO qb_questions (id, user_id, exam_id, number, statement, alternatives_json, answer, created_at) VALUES ('q1', 'u1', 'e1', 1, 'Enunciado antigo', '[]', 'B', 'x');
  `);
  upgradeQuestionBankSchema(old);
  upgradeQuestionBankSchema(old); // rodar de novo não faz mal
  const row = old.prepare('SELECT source_id, comment, answer, statement FROM qb_questions').get() as { source_id: string; comment: string; answer: string; statement: string };
  assert.deepEqual({ ...row }, { source_id: '', comment: '', answer: 'B', statement: 'Enunciado antigo' });

  const insert = (id: string, number: number, sourceId: string) =>
    old.exec(`INSERT INTO qb_questions (id, user_id, exam_id, number, source_id, statement, alternatives_json, created_at) VALUES ('${id}', 'u1', 'e1', ${number}, '${sourceId}', 's', '[]', 'x')`);
  insert('q2', 2, 'Q5');
  assert.throws(() => insert('q3', 3, 'Q5'), /UNIQUE/, 'o mesmo código não entra duas vezes');
  insert('q4', 4, '');
  insert('q5', 5, '');
  assert.equal((old.prepare('SELECT COUNT(*) AS n FROM qb_questions').get() as { n: number }).n, 4, 'sem código não há limite de repetição');
});
