import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { LeechFix, LeechFixSource } from '../ai/leechfix';
import { recordStudy } from '../flashcards/study';
import type { StudyResult } from '../srs';
import { resetLeech, type Result } from './leeches';
import { LEECH_SCHEMA } from './schema';
import { suggestFix } from './suggest';

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u1'), ('u2');
    CREATE TABLE collections (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes', 'DNS', 'x', 'x'), ('c2', 'u2', 'Outra', '', 'x', 'x'), ('c3', 'u1', 'Sem assunto', '', 'x', 'x');
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      document_id TEXT, question TEXT NOT NULL, answer TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'plain', difficulty TEXT NOT NULL DEFAULT 'medio', source_page INTEGER, created_at TEXT NOT NULL,
      ease_factor REAL NOT NULL DEFAULT 2.5, interval_days INTEGER NOT NULL DEFAULT 0, repetitions INTEGER NOT NULL DEFAULT 0,
      due_at TEXT, favorite INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE study_sessions (
      id TEXT PRIMARY KEY, flashcard_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, result TEXT NOT NULL, studied_at TEXT NOT NULL,
      duration_ms INTEGER, prev_ease_factor REAL, prev_interval_days INTEGER, prev_repetitions INTEGER, prev_due_at TEXT
    );
  `);
  db.exec(LEECH_SCHEMA);
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

const BASE = Date.UTC(2026, 9, 1, 10, 0, 0);
const at = (i: number) => new Date(BASE + i * 60_000);

function addCard(db: DatabaseSync, id: string, question: string, answer: string, over: { format?: string; collection?: string } = {}): string {
  db.prepare(
    'INSERT INTO flashcards (id, collection_id, question, answer, format, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, over.collection ?? 'c1', question, answer, over.format ?? 'html', 'x');
  return id;
}

function review(db: DatabaseSync, cardId: string, results: StudyResult[], from = 0): void {
  results.forEach((result, i) => {
    const card = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(cardId) as never;
    recordStudy(db, 'u1', card, result, null, at(from + i));
  });
}

const FIX: LeechFix = { diagnosis: 'Traz duas ideias.', macete: 'SOS', split: [] };

/** Uma IA falsa que guarda o que recebeu. */
function fakeSuggester(reply: LeechFix = FIX) {
  const calls: LeechFixSource[] = [];
  const suggester = async (source: LeechFixSource) => {
    calls.push(source);
    return reply;
  };
  return { suggester, calls };
}

test('monta o pedido com o texto puro do cartão, onde ele está e o histórico de erros', async () => {
  const db = newDb();
  const id = addCard(db, 'f1', '<p>O que é <b>quórum</b> &amp; para que serve?</p>', '<div>O número mínimo.</div><ul><li>de nós</li><li>de discos</li></ul>');
  review(db, id, ['errei', 'errei', 'bom', 'errei']);
  const { suggester, calls } = fakeSuggester();

  const result = value(await suggestFix(db, 'u1', id, suggester));
  assert.deepEqual(result.suggestion, FIX);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    question: 'O que é quórum & para que serve?',
    answer: 'O número mínimo. de nós de discos',
    context: 'Redes · DNS',
    errors: 3,
    reviews: 4,
  });
});

test('cartão de texto simples chega como está, e coleção sem assunto não deixa "·" sobrando', async () => {
  const db = newDb();
  const id = addCard(db, 'f1', 'Quando usar a < ou a > ?', 'Depende.', { format: 'plain', collection: 'c3' });
  const { suggester, calls } = fakeSuggester();
  value(await suggestFix(db, 'u1', id, suggester));
  assert.equal(calls[0].question, 'Quando usar a < ou a > ?');
  assert.equal(calls[0].context, 'Sem assunto');
  assert.deepEqual([calls[0].errors, calls[0].reviews], [0, 0], 'sem revisões ainda');
});

test('o histórico considera só o que vale: depois de recomeçar a contagem, os erros de antes não entram', async () => {
  const db = newDb();
  const id = addCard(db, 'f1', 'P?', 'R.');
  review(db, id, ['errei', 'errei', 'errei', 'errei']);
  value(resetLeech(db, 'u1', id, at(10)));
  review(db, id, ['errei', 'bom'], 20);
  const { suggester, calls } = fakeSuggester();
  value(await suggestFix(db, 'u1', id, suggester));
  assert.deepEqual([calls[0].errors, calls[0].reviews], [1, 2]);
});

test('só propõe: nada é gravado e o agendamento do cartão não muda', async () => {
  const db = newDb();
  const id = addCard(db, 'f1', 'P?', 'R.');
  review(db, id, ['errei', 'errei', 'errei', 'errei']);
  const snapshot = () => ({
    cards: db.prepare('SELECT * FROM flashcards ORDER BY id').all(),
    sessions: (db.prepare('SELECT COUNT(*) AS n FROM study_sessions').get() as { n: number }).n,
    state: (db.prepare('SELECT COUNT(*) AS n FROM leech_state').get() as { n: number }).n,
  });
  const before = snapshot();
  const { suggester } = fakeSuggester({ diagnosis: 'd', macete: 'm', split: [{ question: 'a?', answer: 'a' }, { question: 'b?', answer: 'b' }] });
  value(await suggestFix(db, 'u1', id, suggester));
  assert.deepEqual(snapshot(), before);
});

test('cartão de outro usuário ou inexistente é 404, e a IA nem é chamada', async () => {
  const db = newDb();
  const theirs = addCard(db, 'f9', 'P?', 'R.', { collection: 'c2' });
  const { suggester, calls } = fakeSuggester();
  failure(await suggestFix(db, 'u1', theirs, suggester), 404);
  failure(await suggestFix(db, 'u1', 'nao-existe', suggester), 404);
  assert.equal(calls.length, 0);
});

test('cartão só com figura não tem texto para a IA: 422, sem chamar a IA', async () => {
  const db = newDb();
  const onlyImage = addCard(db, 'f1', '<img src="data:image/png;base64,AAAA">', '<div>Resposta</div>');
  const emptyAnswer = addCard(db, 'f2', 'Pergunta?', '<div><br></div>');
  const { suggester, calls } = fakeSuggester();
  failure(await suggestFix(db, 'u1', onlyImage, suggester), 422, /só figura/);
  failure(await suggestFix(db, 'u1', emptyAnswer, suggester), 422, /só figura/);
  assert.equal(calls.length, 0);
});

test('a falha da IA sobe como erro, para a rota mostrar o motivo', async () => {
  const db = newDb();
  const id = addCard(db, 'f1', 'P?', 'R.');
  await assert.rejects(
    suggestFix(db, 'u1', id, async () => {
      throw new Error('Limite de uso gratuito da IA atingido.');
    }),
    /Limite de uso gratuito/,
  );
});
