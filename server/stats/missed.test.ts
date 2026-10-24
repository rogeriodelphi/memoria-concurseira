import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FROZEN_SCHEMA, setCollectionFrozen } from '../collections/frozen';
import { loadMissedCards, MAX_MISSED_CARDS, parseMissedQuery } from './missed';

const NOW = new Date(2026, 9, 17, 15, 0, 0);
const at = (daysAgo: number, hour = 10) => new Date(2026, 9, 17 - daysAgo, hour).toISOString();
const RANGE = { from: '2026-10-11', to: '2026-10-17' };

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '');
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, document_id TEXT, question TEXT NOT NULL, answer TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'plain', difficulty TEXT NOT NULL DEFAULT 'medio', source_page INTEGER, created_at TEXT NOT NULL DEFAULT '',
      ease_factor REAL NOT NULL DEFAULT 2.5, interval_days INTEGER NOT NULL DEFAULT 0, repetitions INTEGER NOT NULL DEFAULT 0, due_at TEXT, favorite INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE study_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, flashcard_id TEXT NOT NULL, user_id TEXT NOT NULL, result TEXT NOT NULL, studied_at TEXT NOT NULL);
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes', 'DNS'), ('c2', 'u1', 'Direito', 'CF'), ('cx', 'u2', 'Do outro', '');
  `);
  db.exec(FROZEN_SCHEMA);
  return db;
}
const card = (db: DatabaseSync, id: string, collection: string, due: string | null = null) =>
  db.prepare('INSERT INTO flashcards (id, collection_id, question, answer, due_at) VALUES (?, ?, ?, ?, ?)').run(id, collection, `P ${id}`, `R ${id}`, due);
const session = (db: DatabaseSync, cardId: string, result: string, when: string, user = 'u1') =>
  db.prepare('INSERT INTO study_sessions (flashcard_id, user_id, result, studied_at) VALUES (?, ?, ?, ?)').run(cardId, user, result, when);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test('endereço: coleções e período válidos', () => {
  const ok = parseMissedQuery({ collectionIds: 'a, b ,a,,c', from: '2026-10-11', to: '2026-10-17' });
  assert.deepEqual(ok, { ok: true, collectionIds: ['a', 'b', 'c'], from: '2026-10-11', to: '2026-10-17' });
  for (const bad of [
    {}, { collectionIds: '' }, { collectionIds: ',,' }, { collectionIds: 'a'.repeat(65), from: '2026-10-11', to: '2026-10-17' },
    { collectionIds: Array.from({ length: 201 }, (_, i) => `c${i}`).join(','), from: '2026-10-11', to: '2026-10-17' },
    { collectionIds: 'a' }, { collectionIds: 'a', from: '2026-10-11' }, { collectionIds: 'a', from: '2026-13-01', to: '2026-10-17' },
    { collectionIds: 'a', from: '2026-10-17', to: '2026-10-11' }, { collectionIds: ['a'], from: '2026-10-11', to: '2026-10-17' },
  ]) {
    assert.equal(parseMissedQuery(bad as Record<string, unknown>).ok, false, JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(parseMissedQuery({ collectionIds: 'a', from: '2026-10-17', to: '2026-10-17' }).ok, true, 'um dia só');
});

test('traz os cartões com Errei ou Difícil no período, vencidos ou não, e só eles', () => {
  const db = newDb();
  card(db, 'errou', 'c1', '2099-01-01'); // nem vence
  card(db, 'dificil', 'c1');
  card(db, 'acertou', 'c1');
  card(db, 'nunca', 'c1');
  session(db, 'errou', 'errei', at(1));
  session(db, 'dificil', 'dificil', at(2));
  session(db, 'acertou', 'bom', at(1));
  session(db, 'acertou', 'facil', at(2));
  const rows = loadMissedCards(db, 'u1', ['c1'], RANGE);
  assert.deepEqual(ids(rows).sort(), ['dificil', 'errou']);
  assert.ok(rows.every((r) => r.collection_name === 'Redes' && r.collection_subject === 'DNS'));
  assert.equal(rows.find((r) => r.id === 'errou')!.due_at, '2099-01-01', 'os dados do cartão vêm como estão: nada foi remarcado');
  assert.equal(rows.find((r) => r.id === 'errou')!.question, 'P errou');
});

test('coleção congelada fica de fora da revisão dos errados, e volta quando é descongelada', () => {
  const db = newDb();
  card(db, 'redes', 'c1');
  card(db, 'direito', 'c2');
  session(db, 'redes', 'errei', at(1));
  session(db, 'direito', 'errei', at(1));
  assert.deepEqual(ids(loadMissedCards(db, 'u1', ['c1', 'c2'], RANGE)).sort(), ['direito', 'redes']);
  setCollectionFrozen(db, 'c2', true);
  assert.deepEqual(ids(loadMissedCards(db, 'u1', ['c1', 'c2'], RANGE)), ['redes']);
  assert.deepEqual(loadMissedCards(db, 'u1', ['c2'], RANGE), [], 'só a congelada: nada a rever');
  setCollectionFrozen(db, 'c2', false);
  assert.deepEqual(ids(loadMissedCards(db, 'u1', ['c1', 'c2'], RANGE)).sort(), ['direito', 'redes']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM study_sessions').get()!.n, 2, 'o histórico não mudou');
});

test('um erro que o cartão cometeu antes do período, ou depois dele, não conta; os dois dias do período entram inteiros', () => {
  const db = newDb();
  card(db, 'antes', 'c1');
  card(db, 'primeiro-dia', 'c1');
  card(db, 'ultimo-dia', 'c1');
  card(db, 'depois', 'c1');
  session(db, 'antes', 'errei', at(7, 23)); // 10/10, antes do período
  session(db, 'primeiro-dia', 'errei', at(6, 0)); // 11/10 00:00
  session(db, 'ultimo-dia', 'errei', at(0, 23)); // 17/10 23h
  session(db, 'depois', 'errei', new Date(2026, 9, 18, 0, 5).toISOString()); // 18/10
  assert.deepEqual(ids(loadMissedCards(db, 'u1', ['c1'], RANGE)).sort(), ['primeiro-dia', 'ultimo-dia']);
});

test('um cartão que errou antes e acertou depois, dentro do período, ainda é um cartão a rever', () => {
  const db = newDb();
  card(db, 'a', 'c1');
  session(db, 'a', 'errei', at(3));
  session(db, 'a', 'bom', at(1));
  assert.deepEqual(ids(loadMissedCards(db, 'u1', ['c1'], RANGE)), ['a']);
});

test('ordem: quem errou mais vezes primeiro; empate, o erro mais recente; sem repetir cartão', () => {
  const db = newDb();
  for (const id of ['um-antigo', 'um-recente', 'tres']) card(db, id, 'c1');
  session(db, 'um-antigo', 'errei', at(5));
  session(db, 'um-recente', 'dificil', at(1));
  for (const day of [2, 3, 4]) session(db, 'tres', day === 3 ? 'dificil' : 'errei', at(day));
  assert.deepEqual(ids(loadMissedCards(db, 'u1', ['c1'], RANGE)), ['tres', 'um-recente', 'um-antigo']);
});

test('só as coleções pedidas e só do próprio usuário', () => {
  const db = newDb();
  card(db, 'redes', 'c1');
  card(db, 'direito', 'c2');
  card(db, 'alheio', 'cx');
  for (const id of ['redes', 'direito']) session(db, id, 'errei', at(1));
  session(db, 'alheio', 'errei', at(1), 'u2');
  assert.deepEqual(ids(loadMissedCards(db, 'u1', ['c1'], RANGE)), ['redes']);
  assert.deepEqual(ids(loadMissedCards(db, 'u1', ['c1', 'c2'], RANGE)).sort(), ['direito', 'redes']);
  assert.deepEqual(loadMissedCards(db, 'u1', ['cx'], RANGE), [], 'coleção de outro usuário não traz nada');
  assert.deepEqual(loadMissedCards(db, 'u2', ['c1'], RANGE), [], 'e o outro usuário não vê as suas');
  // o erro de outro usuário no MESMO cartão não faz o cartão aparecer
  session(db, 'redes', 'errei', at(1), 'u2');
  assert.deepEqual(ids(loadMissedCards(db, 'u2', ['c1'], RANGE)), [], 'cartão de u1 continua fora das coleções de u2');
});

test('entradas vazias ou inválidas voltam vazio, sem erro', () => {
  const db = newDb();
  card(db, 'a', 'c1');
  session(db, 'a', 'errei', at(1));
  assert.deepEqual(loadMissedCards(db, 'u1', [], RANGE), []);
  assert.deepEqual(loadMissedCards(db, 'u1', ['c1'], { from: 'x', to: RANGE.to }), []);
  assert.deepEqual(loadMissedCards(db, 'u1', ['c1'], { from: RANGE.from, to: '2026-02-30' }), []);
});

test('uma revisão de errados tem teto de cartões', () => {
  const db = newDb();
  db.exec('BEGIN');
  for (let i = 0; i < MAX_MISSED_CARDS + 20; i++) {
    card(db, `f${i}`, 'c1');
    session(db, `f${i}`, 'errei', at(1));
  }
  db.exec('COMMIT');
  assert.equal(loadMissedCards(db, 'u1', ['c1'], RANGE).length, MAX_MISSED_CARDS);
});

test('não altera nada: nenhum cartão é remarcado nem avaliado só por listar', () => {
  const db = newDb();
  card(db, 'a', 'c1', '2026-10-20');
  session(db, 'a', 'errei', at(1));
  const before = JSON.stringify(db.prepare('SELECT * FROM flashcards').all()) + JSON.stringify(db.prepare('SELECT * FROM study_sessions').all());
  loadMissedCards(db, 'u1', ['c1'], RANGE);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM flashcards').all()) + JSON.stringify(db.prepare('SELECT * FROM study_sessions').all()), before);
  assert.ok(NOW);
});
