import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { Result } from '../mockexams/store';
import type { DraftQuestion, ValidDraft } from './draft';
import { QUESTION_BANK_SCHEMA, upgradeQuestionBankSchema } from './schema';
import { answerQuestion, deleteQuestion, saveImport, searchQuestions } from './store';
import { cardContent, createCardsFromQuestions, DEFAULT_COLLECTION_NAME, MAX_CARDS_PER_REQUEST, sourceLine, type CardSource } from './toCards';

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u1'), ('u2');
    CREATE TABLE collections (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Outros',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, filename TEXT NOT NULL,
      size INTEGER NOT NULL, pages INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, source_type TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      document_id TEXT REFERENCES documents(id) ON DELETE SET NULL, question TEXT NOT NULL, answer TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'plain', difficulty TEXT NOT NULL DEFAULT 'medio', source_page INTEGER, created_at TEXT NOT NULL
    );
  `);
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

const question = (number: number, over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  number,
  sourceId: `Q${1000 + number}`,
  support: '',
  statement: `Enunciado da questão ${number} sobre redes`,
  alternatives: alts(),
  answer: 'C',
  annulled: false,
  comment: `Gabarito: C\nFundamento: comentário ${number}.`,
  prova: 'Prova de teste',
  board: 'IDHTEC',
  organ: 'Prefeitura',
  year: 2026,
  discipline: 'Redes',
  subject: 'DNS',
  needsFigure: false,
  suspect: false,
  ...over,
});

const imported = (questions: DraftQuestion[]): ValidDraft => ({ name: '', board: '', organ: '', year: null, position: '', level: '', questions });

const all = (db: DatabaseSync, userId = 'u1') => searchQuestions(db, userId, { filter: {} }).questions;
const idOf = (db: DatabaseSync, sourceId: string, userId = 'u1') => all(db, userId).find((q) => q.sourceId === sourceId)!.id;

/** 5 questões; Q1001 e Q1002 erradas, Q1003 certa, Q1004 sem resposta, Q1005 sem gabarito. */
function seeded(db: DatabaseSync) {
  value(saveImport(db, 'u1', imported([question(1), question(2), question(3), question(4), question(5, { answer: '', comment: '' })])));
  value(answerQuestion(db, 'u1', idOf(db, 'Q1001'), { chosen: 'A' }));
  value(answerQuestion(db, 'u1', idOf(db, 'Q1002'), { chosen: 'B' }));
  value(answerQuestion(db, 'u1', idOf(db, 'Q1003'), { chosen: 'C' }));
}

// ---------- o conteúdo do cartão ----------

const source = (over: Partial<CardSource> = {}): CardSource => ({
  statement: 'Qual protocolo traduz nomes em endereços IP?',
  support: '',
  alternatives: [{ letter: 'A', text: 'DNS' }, { letter: 'B', text: 'DHCP' }],
  answer: 'A',
  comment: '',
  sourceId: 'Q4229308',
  number: 1,
  examName: 'IDHTEC - 2026',
  board: 'IDHTEC',
  year: 2026,
  discipline: 'Redes',
  subject: 'DNS',
  ...over,
});

test('cartão: frente com o enunciado e as alternativas, verso com o gabarito, o comentário e a fonte', () => {
  const card = cardContent(source({ comment: 'Gabarito: A\nFundamento: o DNS resolve nomes.' }));
  assert.equal(card.question, '<p>Qual protocolo traduz nomes em endereços IP?</p><p><b>A)</b> DNS</p><p><b>B)</b> DHCP</p>');
  assert.equal(
    card.answer,
    '<p><b>Gabarito: A</b> — DNS</p><p>Gabarito: A<br />Fundamento: o DNS resolve nomes.</p><p><i>IDHTEC · 2026 · Q4229308</i></p>',
  );
});

test('cartão: sem comentário não há parágrafo vazio; o texto de apoio vem em itálico, cortado se for enorme', () => {
  const card = cardContent(source({ support: 'Texto base. '.repeat(400) }));
  assert.match(card.question, /^<p><i>Texto base\./);
  assert.match(card.question, /…<\/i><\/p><p>Qual protocolo/);
  assert.equal((card.answer.match(/<p>/g) ?? []).length, 2, 'gabarito e fonte');
});

test('cartão: o texto da questão não vira HTML (tags e & são escapados)', () => {
  const card = cardContent(source({ statement: 'Se a < b e a & b, então <script>alert(1)</script>?', alternatives: [{ letter: 'A', text: '<b>negrito</b>' }, { letter: 'B', text: 'x' }] }));
  assert.doesNotMatch(card.question, /<script|<b>negrito/);
  assert.match(card.question, /a &lt; b e a &amp; b/);
});

test('fonte do cartão: banca, ano e código; ou a prova e o número', () => {
  assert.equal(sourceLine(source()), 'IDHTEC · 2026 · Q4229308');
  assert.equal(sourceLine(source({ sourceId: '', number: 7 })), 'IDHTEC · 2026 · questão 7');
  assert.equal(sourceLine(source({ board: '', year: null, sourceId: '', number: 7, examName: 'Prova X' })), 'Prova X · questão 7');
});

// ---------- criar os cartões ----------

test('das erradas de um filtro: só as erradas viram cartão, numa coleção criada com o nome padrão', () => {
  const db = newDb();
  seeded(db);
  const result = value(createCardsFromQuestions(db, 'u1', { filter: {} }, new Date('2026-10-18T12:00:00Z')));
  assert.deepEqual([result.created, result.alreadyHad, result.skipped, result.collection.created, result.collection.name], [2, 0, 0, true, DEFAULT_COLLECTION_NAME]);

  const cards = db.prepare('SELECT collection_id, question, answer, format, difficulty FROM flashcards ORDER BY question').all() as {
    collection_id: string;
    question: string;
    answer: string;
    format: string;
    difficulty: string;
  }[];
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => c.collection_id === result.collection.id && c.format === 'html' && c.difficulty === 'medio'));
  assert.match(cards[0].question, /Enunciado da questão 1/);
  assert.match(cards[0].answer, /Gabarito: C/);
  assert.match(cards[0].answer, /comentário 1/);
  assert.equal(count(db, 'qb_question_cards'), 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM documents WHERE source_type = 'manual'").get() as { n: number }).n, 1, 'um documento manual para a coleção');
  assert.equal(all(db).find((q) => q.sourceId === 'Q1001')!.hasCard, true);
  assert.equal(all(db).find((q) => q.sourceId === 'Q1003')!.hasCard, false, 'a certa não virou cartão');
});

test('pedir de novo não duplica: as que já têm cartão são contadas e a coleção é a mesma', () => {
  const db = newDb();
  seeded(db);
  value(createCardsFromQuestions(db, 'u1', { filter: {} }));
  value(answerQuestion(db, 'u1', idOf(db, 'Q1003'), { chosen: 'A' })); // agora errou a terceira também
  const again = value(createCardsFromQuestions(db, 'u1', { filter: {} }));
  assert.deepEqual([again.created, again.alreadyHad, again.collection.created], [1, 2, false]);
  assert.equal(count(db, 'flashcards'), 3);
  assert.equal(count(db, 'collections'), 1);
  assert.equal(count(db, 'documents'), 1);

  const nothing = value(createCardsFromQuestions(db, 'u1', { filter: {} }));
  assert.deepEqual([nothing.created, nothing.alreadyHad], [0, 3]);
  assert.equal(count(db, 'flashcards'), 3);
});

test('o filtro restringe quais erradas viram cartão', () => {
  const db = newDb();
  value(saveImport(db, 'u1', imported([question(1, { discipline: 'Redes' }), question(2, { discipline: 'Direito' })])));
  value(answerQuestion(db, 'u1', idOf(db, 'Q1001'), { chosen: 'A' }));
  value(answerQuestion(db, 'u1', idOf(db, 'Q1002'), { chosen: 'A' }));
  const result = value(createCardsFromQuestions(db, 'u1', { filter: { discipline: ['Direito'], status: ['acertei'] } }));
  assert.equal(result.created, 1, 'mesmo pedindo "acertei", só entra o que foi errado: o estado é sempre "errei"');
  assert.match((db.prepare('SELECT question FROM flashcards').get() as { question: string }).question, /questão 2/);
});

test('por ids: só as respondidas e com gabarito; acertadas também podem virar cartão', () => {
  const db = newDb();
  seeded(db);
  const ids = ['Q1001', 'Q1003', 'Q1004', 'Q1005'].map((s) => idOf(db, s));
  const result = value(createCardsFromQuestions(db, 'u1', { questionIds: [...ids, ids[0], 'nao-existe'] }));
  assert.deepEqual([result.created, result.skipped], [2, 3], 'Q1001 (errada) e Q1003 (certa); Q1004 não foi respondida, Q1005 não tem gabarito, e o id inexistente');
  assert.equal(count(db, 'flashcards'), 2);
});

test('por ids: questão anulada não vira cartão', () => {
  const db = newDb();
  value(saveImport(db, 'u1', imported([question(1, { annulled: true, answer: '' })])));
  const result = value(createCardsFromQuestions(db, 'u1', { questionIds: [idOf(db, 'Q1001')] }));
  assert.deepEqual([result.created, result.skipped], [0, 1]);
  assert.equal(count(db, 'flashcards'), 0);
});

test('coleção: a escolhida, a de nome dado (criada ou reaproveitada), só do dono', () => {
  const db = newDb();
  seeded(db);
  db.exec("INSERT INTO collections (id, user_id, name, created_at, updated_at) VALUES ('c1', 'u1', 'Minha coleção', 'x', 'x'), ('c2', 'u2', 'Do outro', 'x', 'x')");
  const first = value(createCardsFromQuestions(db, 'u1', { questionIds: [idOf(db, 'Q1001')], collectionId: 'c1' }));
  assert.deepEqual([first.collection.id, first.collection.created], ['c1', false]);

  failure(createCardsFromQuestions(db, 'u1', { questionIds: [idOf(db, 'Q1002')], collectionId: 'c2' }), 404, /Coleção não encontrada/);
  assert.equal(count(db, 'flashcards'), 1, 'recusado antes de criar qualquer cartão');

  const named = value(createCardsFromQuestions(db, 'u1', { questionIds: [idOf(db, 'Q1002')], collectionName: '  Erros   de redes ' }));
  assert.deepEqual([named.collection.name, named.collection.created], ['Erros de redes', true]);
  const reused = value(createCardsFromQuestions(db, 'u1', { questionIds: [idOf(db, 'Q1003')], collectionName: 'erros de REDES' }));
  assert.deepEqual([reused.collection.id === named.collection.id, reused.collection.created], [true, false], 'o mesmo nome (sem diferenciar caixa) reaproveita a coleção');
});

test('sem o que criar, não cria coleção vazia', () => {
  const db = newDb();
  value(saveImport(db, 'u1', imported([question(1)])));
  failure(createCardsFromQuestions(db, 'u1', { filter: {} }), 422, /Nenhuma questão errada/);
  assert.equal(count(db, 'collections'), 0);
  failure(createCardsFromQuestions(db, 'u1', {}), 400, /Escolha as questões/);
  failure(createCardsFromQuestions(db, 'u1', null), 400);
  const noneAnswered = value(createCardsFromQuestions(db, 'u1', { questionIds: [idOf(db, 'Q1001')] }));
  assert.deepEqual([noneAnswered.created, noneAnswered.skipped], [0, 1]);
  assert.equal(count(db, 'collections'), 0, 'a coleção também não é criada se nenhuma questão serve');
});

test('limite de cartões por pedido', () => {
  const db = newDb();
  value(saveImport(db, 'u1', imported(Array.from({ length: MAX_CARDS_PER_REQUEST + 20 }, (_, i) => question(i + 1)))));
  for (const row of db.prepare('SELECT id FROM qb_questions').all() as { id: string }[]) value(answerQuestion(db, 'u1', row.id, { chosen: 'A' }));
  const first = value(createCardsFromQuestions(db, 'u1', { filter: {} }));
  assert.equal(first.created, MAX_CARDS_PER_REQUEST);
  const second = value(createCardsFromQuestions(db, 'u1', { filter: {} }));
  assert.equal(second.created, 20, 'o resto vem no pedido seguinte');
});

test('cada usuário só cria cartões das suas questões', () => {
  const db = newDb();
  seeded(db);
  const theirs = idOf(db, 'Q1001');
  assert.equal(value(createCardsFromQuestions(db, 'u2', { questionIds: [theirs] })).skipped, 1);
  failure(createCardsFromQuestions(db, 'u2', { filter: {} }), 422);
  assert.equal(count(db, 'flashcards'), 0);
});

test('apagar o cartão libera a questão para virar cartão de novo; apagar a questão não apaga o cartão', () => {
  const db = newDb();
  seeded(db);
  value(createCardsFromQuestions(db, 'u1', { filter: {} }));
  const q1 = idOf(db, 'Q1001');
  db.prepare('DELETE FROM flashcards WHERE id = (SELECT flashcard_id FROM qb_question_cards WHERE question_id = ?)').run(q1);
  assert.equal(all(db).find((q) => q.id === q1)!.hasCard, false);
  assert.equal(value(createCardsFromQuestions(db, 'u1', { filter: {} })).created, 1);

  value(deleteQuestion(db, 'u1', idOf(db, 'Q1002')));
  assert.equal(count(db, 'flashcards'), 2, 'o cartão da questão apagada continua');
  assert.equal(count(db, 'qb_question_cards'), 1);
});
