import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { loadLeeches } from '../leeches/leeches';
import { LEECH_SCHEMA } from '../leeches/schema';
import { buildDashboard } from '../stats/dashboard';
import { loadExamPlan } from '../studyplan/examPlan';
import { loadFinalStretch, loadFocusCards } from '../studyplan/finalStretch';
import { pickNewCardIdsByExam } from '../studyplan/newOrder';
import { selectDueCards, setDailyNewLimit } from '../studyplan/store';
import { FROZEN_SCHEMA, frozenAt, notFrozen, setCollectionFrozen } from './frozen';

// 17/10/2026, 15:00 no horário local do computador que roda o teste. A prova (06/12) fica a 50 dias.
const NOW = new Date(2026, 9, 17, 15, 0, 0);
const PAST = new Date(2026, 9, 10).toISOString();
const FUTURE = new Date(2026, 9, 25).toISOString();

/**
 * cA (ativa): 3 vencidos e 2 novos, ligada ao tópico da disciplina dA; cF (a que será congelada): 4 vencidos, 3 novos e 2 que
 * vencem só depois, ligada a dF; cX é de outra conta.
 */
function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, daily_new_limit INTEGER, new_card_order TEXT NOT NULL DEFAULT 'created');
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '');
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, question TEXT NOT NULL DEFAULT 'p', answer TEXT NOT NULL DEFAULT 'r',
      format TEXT NOT NULL DEFAULT 'plain', difficulty TEXT NOT NULL DEFAULT 'medio', source_page INTEGER, created_at TEXT NOT NULL,
      ease_factor REAL NOT NULL DEFAULT 2.5, interval_days INTEGER NOT NULL DEFAULT 0, repetitions INTEGER NOT NULL DEFAULT 0,
      due_at TEXT, favorite INTEGER NOT NULL DEFAULT 0, document_id TEXT
    );
    CREATE TABLE study_sessions (id TEXT PRIMARY KEY, flashcard_id TEXT NOT NULL, user_id TEXT NOT NULL, result TEXT NOT NULL, studied_at TEXT NOT NULL, duration_ms INTEGER);
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, exam_date TEXT);
    CREATE TABLE exam_disciplines (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, name TEXT NOT NULL, question_count INTEGER, weight REAL, position INTEGER NOT NULL);
    CREATE TABLE exam_topics (id TEXT PRIMARY KEY, discipline_id TEXT NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE exam_topic_collections (topic_id TEXT NOT NULL, collection_id TEXT NOT NULL, PRIMARY KEY (topic_id, collection_id));

    INSERT INTO users (id, daily_new_limit) VALUES ('u1', NULL), ('u2', NULL);
    INSERT INTO collections (id, user_id, name, subject) VALUES ('cA', 'u1', 'Ativa', 'Redes'), ('cF', 'u1', 'Para congelar', 'Direito'), ('cX', 'u2', 'Alheia', '');
    INSERT INTO exams VALUES ('e1', 'u1', 'Prova', '2026-12-06');
    INSERT INTO exam_disciplines VALUES ('dA', 'e1', 'Redes', 50, NULL, 0), ('dF', 'e1', 'Direito', 50, NULL, 1);
    INSERT INTO exam_topics VALUES ('tA', 'dA', 'Redes', 0), ('tF', 'dF', 'Direito', 0);
    INSERT INTO exam_topic_collections VALUES ('tA', 'cA'), ('tF', 'cF');
  `);
  db.exec(FROZEN_SCHEMA);
  db.exec(LEECH_SCHEMA);
  return db;
}

let counter = 0;
function add(db: DatabaseSync, id: string, collection: string, dueAt: string | null = null) {
  db.prepare('INSERT INTO flashcards (id, collection_id, created_at, due_at) VALUES (?, ?, ?, ?)').run(id, collection, new Date(2026, 8, 1, 0, 0, ++counter).toISOString(), dueAt);
}
const many = (db: DatabaseSync, prefix: string, collection: string, n: number, dueAt: string | null = null) => {
  for (let i = 1; i <= n; i++) add(db, `${prefix}${i}`, collection, dueAt);
};

function seed(db: DatabaseSync) {
  many(db, 'a', 'cA', 3, PAST);
  many(db, 'an', 'cA', 2);
  many(db, 'f', 'cF', 4, PAST);
  many(db, 'fn', 'cF', 3);
  many(db, 'ff', 'cF', 2, FUTURE);
  many(db, 'x', 'cX', 2, PAST);
}

const queueIds = (db: DatabaseSync, options: { collectionIds?: string[] } = {}) => selectDueCards(db, 'u1', NOW, options).cards.map((c) => c.id).sort();
const cardsOf = (db: DatabaseSync) => db.prepare('SELECT * FROM flashcards ORDER BY id').all();

test('congelar: a coleção congelada sai da fila (vencidos e novos), e descongelar devolve exatamente a mesma fila', () => {
  const db = newDb();
  seed(db);
  const before = queueIds(db);
  assert.deepEqual(before, ['a1', 'a2', 'a3', 'an1', 'an2', 'f1', 'f2', 'f3', 'f4', 'fn1', 'fn2', 'fn3']);

  setCollectionFrozen(db, 'cF', true, NOW);
  assert.deepEqual(queueIds(db), ['a1', 'a2', 'a3', 'an1', 'an2']);

  setCollectionFrozen(db, 'cF', false);
  assert.deepEqual(queueIds(db), before);
});

test('congelar não mexe nos cartões: nada muda, nem as datas de vencimento', () => {
  const db = newDb();
  seed(db);
  const before = cardsOf(db);
  setCollectionFrozen(db, 'cF', true, NOW);
  assert.deepEqual(cardsOf(db), before, 'congelada');
  setCollectionFrozen(db, 'cF', false);
  assert.deepEqual(cardsOf(db), before, 'descongelada');
});

test('congelar: a fila de uma disciplina (coleções escolhidas) também a ignora', () => {
  const db = newDb();
  seed(db);
  assert.equal(queueIds(db, { collectionIds: ['cA', 'cF'] }).length, 12);
  setCollectionFrozen(db, 'cF', true);
  assert.deepEqual(queueIds(db, { collectionIds: ['cA', 'cF'] }), ['a1', 'a2', 'a3', 'an1', 'an2']);
  assert.deepEqual(queueIds(db, { collectionIds: ['cF'] }), []);
});

test('congelar: os novos da coleção congelada não entram em "novos aguardando" nem gastam o limite diário', () => {
  const db = newDb();
  seed(db);
  setDailyNewLimit(db, 'u1', 1);
  assert.deepEqual([selectDueCards(db, 'u1', NOW).cards.filter((c) => c.due_at === null).length, selectDueCards(db, 'u1', NOW).waitingNew], [1, 4], 'sem congelar: 1 entra, 4 esperam (2 de cA e 3 de cF, menos o que entrou)');
  setCollectionFrozen(db, 'cF', true);
  const frozen = selectDueCards(db, 'u1', NOW);
  assert.deepEqual([frozen.cards.filter((c) => c.due_at === null).length, frozen.waitingNew], [1, 1], 'congelada: só os 2 novos de cA existem');
  assert.ok(frozen.cards.every((c) => c.collection_id === 'cA'));
});

test('congelar vale só para a coleção congelada e para o dono: a conta de outro usuário não muda', () => {
  const db = newDb();
  seed(db);
  setCollectionFrozen(db, 'cF', true);
  assert.deepEqual(selectDueCards(db, 'u2', NOW).cards.map((c) => c.id).sort(), ['x1', 'x2']);
});

test('frozenAt e setCollectionFrozen: pedir duas vezes não muda nada (a data original fica) e descongelar o que não está congelado é inofensivo', () => {
  const db = newDb();
  assert.equal(frozenAt(db, 'cF'), null);
  setCollectionFrozen(db, 'cF', false);
  assert.equal(frozenAt(db, 'cF'), null);

  setCollectionFrozen(db, 'cF', true, NOW);
  assert.equal(frozenAt(db, 'cF'), NOW.toISOString());
  setCollectionFrozen(db, 'cF', true, new Date(NOW.getTime() + 86_400_000));
  assert.equal(frozenAt(db, 'cF'), NOW.toISOString(), 'congelar de novo mantém a data');
  assert.equal(frozenAt(db, 'cA'), null, 'as outras coleções não foram afetadas');

  setCollectionFrozen(db, 'cF', false);
  assert.equal(frozenAt(db, 'cF'), null);
});

test('apagar a coleção leva a linha do congelamento junto', () => {
  const db = newDb();
  setCollectionFrozen(db, 'cF', true);
  db.prepare("DELETE FROM collections WHERE id = 'cF'").run();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM frozen_collections').get() as { n: number }).n, 0);
});

test('notFrozen: o pedaço de SQL serve para qualquer coluna que traga o id da coleção', () => {
  const db = newDb();
  seed(db);
  setCollectionFrozen(db, 'cF', true);
  const viaCollection = db.prepare(`SELECT COUNT(*) AS n FROM collections c WHERE ${notFrozen('c.id')}`).get() as { n: number };
  const viaCard = db.prepare(`SELECT COUNT(*) AS n FROM flashcards f WHERE ${notFrozen('f.collection_id')}`).get() as { n: number };
  assert.equal(viaCollection.n, 2, 'cA e cX');
  assert.equal(viaCard.n, 5 + 2, 'os 5 de cA e os 2 de cX');
});

test('Painel: cartão congelado conta como maduro, mas não como novo, vencido nem "vence amanhã"', () => {
  const tomorrow = new Date(2026, 9, 18, 10).toISOString();
  const cards = [
    { dueAt: null, repetitions: 0, intervalDays: 0 },
    { dueAt: PAST, repetitions: 3, intervalDays: 30 },
    { dueAt: tomorrow, repetitions: 3, intervalDays: 30 },
  ];
  const open = buildDashboard([], cards, NOW);
  const frozen = buildDashboard([], cards.map((c) => ({ ...c, frozen: true })), NOW);
  assert.deepEqual([open.remaining.new, open.remaining.due, open.remaining.dueTomorrow, open.matureCards], [1, 1, 1, 2]);
  assert.deepEqual([frozen.remaining.new, frozen.remaining.due, frozen.remaining.dueTomorrow, frozen.remaining.total], [0, 0, 0, 0]);
  assert.equal(frozen.matureCards, 2, 'o que já foi aprendido continua contando');
});

test('ordem dos novos pelo edital: os novos da coleção congelada não entram', () => {
  const db = newDb();
  seed(db);
  const all = pickNewCardIdsByExam(db, 'u1', NOW, 20)!;
  assert.ok(all.some((id) => id.startsWith('fn')), 'sem congelar, os novos de cF entram');
  setCollectionFrozen(db, 'cF', true);
  const some = pickNewCardIdsByExam(db, 'u1', NOW, 20)!;
  assert.deepEqual([...some].sort(), ['an1', 'an2']);
});

test('Meta para a prova: os cartões da coleção congelada não entram na carga', () => {
  const db = newDb();
  seed(db);
  const open = loadExamPlan(db, 'u1', NOW)!;
  setCollectionFrozen(db, 'cF', true);
  const frozen = loadExamPlan(db, 'u1', NOW)!;
  assert.equal(open.cards.new, 5, '2 de cA e 3 de cF');
  assert.equal(open.cards.due, 7, '3 de cA e 4 de cF');
  assert.equal(open.cards.learned, 9, '3 de cA e 6 de cF');
  assert.equal(frozen.cards.new, 2, 'só os de cA');
  assert.equal(frozen.cards.due, 3, 'só os de cA');
  assert.equal(frozen.cards.learned, 3, 'cA tem 3 já estudados');
});

test('Reta final: a coleção congelada some da prioridade e da sessão de foco', () => {
  const db = newDb();
  seed(db);
  const open = loadFinalStretch(db, 'u1', NOW);
  assert.equal(open.disciplines.find((d) => d.id === 'dF')!.cards, 9);
  assert.equal(open.frozenCollections, 0);
  assert.ok(loadFocusCards(db, 'u1', NOW).some((c) => c.collectionId === 'cF'));

  setCollectionFrozen(db, 'cF', true);
  const frozen = loadFinalStretch(db, 'u1', NOW);
  assert.equal(frozen.frozenCollections, 1, 'a Reta final conta as congeladas ligadas ao edital, para a tela explicar');
  const direito = frozen.disciplines.find((d) => d.id === 'dF')!;
  assert.deepEqual([direito.cards, direito.dueCards, direito.newCards, direito.hasCards], [0, 0, 0, false]);
  assert.equal(frozen.queue.due, 3);
  assert.ok(!loadFocusCards(db, 'u1', NOW).some((c) => c.collectionId === 'cF'), 'a sessão não traz cartão congelado');
});

test('sanguessugas: a coleção congelada sai da lista e do total, e volta ao descongelar', () => {
  const db = newDb();
  seed(db);
  let n = 0;
  for (const card of ['a1', 'f1']) {
    for (let i = 0; i < 5; i++) {
      db.prepare('INSERT INTO study_sessions (id, flashcard_id, user_id, result, studied_at) VALUES (?, ?, ?, ?, ?)').run(`l${++n}`, card, 'u1', 'errei', new Date(2026, 9, 1, 10, i).toISOString());
    }
  }
  const open = loadLeeches(db, 'u1', 4, NOW);
  assert.deepEqual(open.leeches.map((l) => l.flashcard.id).sort(), ['a1', 'f1']);

  setCollectionFrozen(db, 'cF', true);
  const frozen = loadLeeches(db, 'u1', 4, NOW);
  assert.deepEqual(frozen.leeches.map((l) => l.flashcard.id), ['a1']);
  assert.equal(frozen.total, 1);

  setCollectionFrozen(db, 'cF', false);
  assert.equal(loadLeeches(db, 'u1', 4, NOW).total, 2);
});
