import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { countNewLearnedToday, getDailyNewLimit, localDayBounds, selectDueCards, setDailyNewLimit } from './store';

// 14/10/2026, 15:00 no horário local do computador que roda o teste.
const NOW = new Date(2026, 9, 14, 15, 0, 0);
const at = (hour: number, dayOffset = 0) => new Date(2026, 9, 14 + dayOffset, hour, 0, 0).toISOString();

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, daily_new_limit INTEGER);
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '');
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id), question TEXT NOT NULL DEFAULT 'p',
      answer TEXT NOT NULL DEFAULT 'r', format TEXT NOT NULL DEFAULT 'plain', difficulty TEXT NOT NULL DEFAULT 'medio',
      source_page INTEGER, created_at TEXT NOT NULL, ease_factor REAL NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 0, repetitions INTEGER NOT NULL DEFAULT 0, due_at TEXT,
      favorite INTEGER NOT NULL DEFAULT 0, document_id TEXT
    );
    CREATE TABLE study_sessions (
      id TEXT PRIMARY KEY, flashcard_id TEXT NOT NULL, user_id TEXT NOT NULL, result TEXT NOT NULL,
      studied_at TEXT NOT NULL, duration_ms INTEGER
    );
    INSERT INTO users VALUES ('u1', NULL), ('u2', NULL);
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes', 'Protocolos'), ('c2', 'u1', 'Direito', ''), ('cx', 'u2', 'Alheia', '');
  `);
  return db;
}

let counter = 0;
const addCard = (db: DatabaseSync, id: string, extra: { collection?: string; createdAt?: string; dueAt?: string | null } = {}) =>
  db
    .prepare('INSERT INTO flashcards (id, collection_id, created_at, due_at) VALUES (?, ?, ?, ?)')
    .run(id, extra.collection ?? 'c1', extra.createdAt ?? new Date(2026, 8, 1, 0, 0, ++counter).toISOString(), extra.dueAt ?? null);
const addReview = (db: DatabaseSync, cardId: string, studiedAt: string, user = 'u1') =>
  db
    .prepare('INSERT INTO study_sessions (id, flashcard_id, user_id, result, studied_at) VALUES (?, ?, ?, ?, ?)')
    .run(`s${++counter}`, cardId, user, 'bom', studiedAt);
const ids = (db: DatabaseSync, now = NOW) => selectDueCards(db, 'u1', now).cards.map((c) => c.id);

test('limite: começa sem limite, é gravado, trocado e apagado; valor inválido não grava nada', () => {
  const db = newDb();
  assert.equal(getDailyNewLimit(db, 'u1'), null);
  assert.deepEqual(setDailyNewLimit(db, 'u1', 20), { ok: true, value: 20 });
  assert.equal(getDailyNewLimit(db, 'u1'), 20);
  assert.equal(setDailyNewLimit(db, 'u1', -3).ok, false);
  assert.equal(setDailyNewLimit(db, 'u1', 'x').ok, false);
  assert.equal(getDailyNewLimit(db, 'u1'), 20, 'o inválido não mexeu');
  assert.deepEqual(setDailyNewLimit(db, 'u1', null), { ok: true, value: null });
  assert.equal(getDailyNewLimit(db, 'u1'), null);
  assert.equal(getDailyNewLimit(db, 'u2'), null, 'outro usuário não foi afetado');
});

test('novos de hoje: conta só os cartões cuja PRIMEIRA revisão foi hoje', () => {
  const db = newDb();
  for (const id of ['a', 'b', 'c', 'd']) addCard(db, id, { dueAt: at(9, 5) });
  addReview(db, 'a', at(9)); // primeira vez hoje: conta
  addReview(db, 'a', at(10)); // segunda revisão do mesmo cartão: não conta de novo
  addReview(db, 'b', at(8, -1)); // primeira vez ontem...
  addReview(db, 'b', at(9)); // ...e hoje só revisou: não é novo
  addReview(db, 'c', at(0)); // meia-noite em ponto de hoje: conta
  addReview(db, 'd', at(23, -1)); // ontem à noite: não conta
  assert.equal(countNewLearnedToday(db, 'u1', NOW), 2);
});

test('novos de hoje: revisão de outro usuário não conta, e o dia é o dia local', () => {
  const db = newDb();
  addCard(db, 'x', { collection: 'cx' });
  addReview(db, 'x', at(9), 'u2');
  assert.equal(countNewLearnedToday(db, 'u1', NOW), 0);
  const { start, end } = localDayBounds(NOW);
  assert.equal(start, new Date(2026, 9, 14).toISOString());
  assert.equal(end, new Date(2026, 9, 15).toISOString());
});

test('fila sem limite: todos os novos e todos os vencidos, os novos primeiro (como sempre foi)', () => {
  const db = newDb();
  addCard(db, 'novo1');
  addCard(db, 'novo2');
  addCard(db, 'vencido', { dueAt: at(8, -1) });
  addCard(db, 'futuro', { dueAt: at(9, 3) });
  const selection = selectDueCards(db, 'u1', NOW);
  assert.deepEqual(selection.cards.map((c) => c.id), ['novo1', 'novo2', 'vencido']);
  assert.equal(selection.waitingNew, 0);
  assert.equal(selection.cards[0].collection_name, 'Redes');
});

test('fila com limite: só quantos novos cabem hoje, os mais antigos primeiro; os vencidos nunca são limitados', () => {
  const db = newDb();
  setDailyNewLimit(db, 'u1', 2);
  addCard(db, 'n3', { createdAt: at(3, -30) });
  addCard(db, 'n1', { createdAt: at(1, -30) });
  addCard(db, 'n2', { createdAt: at(2, -30) });
  addCard(db, 'n4', { createdAt: at(4, -30) });
  for (const id of ['v1', 'v2', 'v3']) addCard(db, id, { dueAt: at(8, -1) });

  const selection = selectDueCards(db, 'u1', NOW);
  assert.deepEqual(selection.cards.map((c) => c.id), ['n1', 'n2', 'v1', 'v2', 'v3']);
  assert.equal(selection.waitingNew, 2, 'n3 e n4 esperam');
});

test('fila com limite: o que já foi aprendido hoje desconta do limite', () => {
  const db = newDb();
  setDailyNewLimit(db, 'u1', 3);
  for (const id of ['n1', 'n2', 'n3', 'n4']) addCard(db, id);
  // dois cartões foram estudados pela primeira vez hoje (e por isso já não são novos)
  addCard(db, 'hoje1', { dueAt: at(9, 2) });
  addCard(db, 'hoje2', { dueAt: at(9, 2) });
  addReview(db, 'hoje1', at(9));
  addReview(db, 'hoje2', at(10));

  const selection = selectDueCards(db, 'u1', NOW);
  assert.deepEqual(selection.cards.map((c) => c.id), ['n1'], 'limite 3 menos 2 já aprendidos = 1 novo');
  assert.equal(selection.waitingNew, 3);
});

test('fila com limite já cumprido: nenhum novo, só os vencidos; limite zero, também', () => {
  const db = newDb();
  setDailyNewLimit(db, 'u1', 1);
  addCard(db, 'n1');
  addCard(db, 'hoje', { dueAt: at(9, 2) });
  addReview(db, 'hoje', at(9));
  addCard(db, 'vencido', { dueAt: at(8, -1) });
  assert.deepEqual(ids(db), ['vencido']);
  assert.equal(selectDueCards(db, 'u1', NOW).waitingNew, 1);

  setDailyNewLimit(db, 'u1', 0);
  assert.deepEqual(ids(db), ['vencido']);
});

test('amanhã o limite recomeça: o que foi aprendido hoje já não desconta', () => {
  const db = newDb();
  setDailyNewLimit(db, 'u1', 1);
  addCard(db, 'n1');
  addCard(db, 'n2');
  addCard(db, 'hoje', { dueAt: at(9, 2) });
  addReview(db, 'hoje', at(9));
  assert.deepEqual(ids(db, NOW), [], 'hoje o limite já foi usado');
  const tomorrow = new Date(2026, 9, 15, 8, 0, 0);
  assert.deepEqual(ids(db, tomorrow), ['n1'], 'amanhã entra um novo de novo');
});

test('a fila é só do usuário: cartões de outro usuário não entram nem contam', () => {
  const db = newDb();
  setDailyNewLimit(db, 'u1', 5);
  addCard(db, 'meu');
  addCard(db, 'alheio', { collection: 'cx' });
  const selection = selectDueCards(db, 'u1', NOW);
  assert.deepEqual(selection.cards.map((c) => c.id), ['meu']);
  assert.equal(selection.waitingNew, 0);
});

// ---------- fila de uma disciplina (coleções escolhidas) ----------

const idsOf = (db: DatabaseSync, collectionIds: string[]) =>
  selectDueCards(db, 'u1', NOW, { collectionIds }).cards.map((c) => c.id);

test('fila por coleções: só os pendentes (novos e vencidos) das coleções escolhidas', () => {
  const db = newDb();
  addCard(db, 'r-novo', { collection: 'c1' });
  addCard(db, 'r-vencido', { collection: 'c1', dueAt: at(8, -1) });
  addCard(db, 'r-futuro', { collection: 'c1', dueAt: at(9, 3) });
  addCard(db, 'd-novo', { collection: 'c2' });

  assert.deepEqual(idsOf(db, ['c1']), ['r-novo', 'r-vencido']);
  assert.deepEqual(idsOf(db, ['c2']), ['d-novo']);
  assert.deepEqual(idsOf(db, ['c1', 'c2']), ['r-novo', 'd-novo', 'r-vencido'], 'os novos primeiro, depois os vencidos');
});

test('fila por coleções: o limite diário de novos não se aplica, porque quem escolhe o que estudar não é contido', () => {
  const db = newDb();
  setDailyNewLimit(db, 'u1', 1);
  for (const id of ['n1', 'n2', 'n3']) addCard(db, id, { collection: 'c1' });

  assert.equal(selectDueCards(db, 'u1', NOW).cards.length, 1, 'a fila global respeita o limite');
  const disciplina = selectDueCards(db, 'u1', NOW, { collectionIds: ['c1'] });
  assert.deepEqual(disciplina.cards.map((c) => c.id), ['n1', 'n2', 'n3']);
  assert.equal(disciplina.waitingNew, 0);
});

test('fila por coleções: coleção de outro usuário ou inexistente não traz cartão nenhum', () => {
  const db = newDb();
  addCard(db, 'meu', { collection: 'c1' });
  addCard(db, 'alheio', { collection: 'cx' });
  assert.deepEqual(idsOf(db, ['cx']), []);
  assert.deepEqual(idsOf(db, ['nao-existe']), []);
  assert.deepEqual(idsOf(db, ['cx', 'c1']), ['meu']);
});

test('as linhas da fila trazem o nome e o assunto da coleção', () => {
  const db = newDb();
  addCard(db, 'a', { collection: 'c1' });
  addCard(db, 'b', { collection: 'c2' });
  const rows = selectDueCards(db, 'u1', NOW).cards;
  assert.deepEqual(rows.map((r) => [r.collection_name, r.collection_subject]), [['Redes', 'Protocolos'], ['Direito', '']]);
});
