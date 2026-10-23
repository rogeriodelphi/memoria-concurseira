import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FROZEN_SCHEMA } from '../collections/frozen';
import { recordStudy } from '../flashcards/study';
import type { StudyResult } from '../srs';
import {
  CONSOLIDATED_STREAK,
  DEFAULT_MIN_ERRORS,
  LEECH_WINDOW,
  loadLeeches,
  MAX_LEECHES,
  parseMinErrors,
  resetLeech,
  snoozeLeech,
  splitLeech,
  type Result,
} from './leeches';
import { LEECH_SCHEMA } from './schema';

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(FROZEN_SCHEMA);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u1'), ('u2');
    CREATE TABLE collections (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes', 'DNS', 'x', 'x'), ('c2', 'u2', 'Outra', '', 'x', 'x');
    CREATE TABLE documents (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE);
    INSERT INTO documents VALUES ('d1', 'c1');
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      document_id TEXT REFERENCES documents(id) ON DELETE SET NULL, question TEXT NOT NULL, answer TEXT NOT NULL,
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

const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const BASE = Date.UTC(2026, 9, 1, 10, 0, 0);
/** O instante da i-ésima revisão: uma por minuto. */
const at = (i: number) => new Date(BASE + i * 60_000);

let counter = 0;
function addCard(db: DatabaseSync, over: { id?: string; collection?: string; question?: string; difficulty?: string; documentId?: string | null } = {}): string {
  const id = over.id ?? `f${++counter}`;
  db.prepare(
    'INSERT INTO flashcards (id, collection_id, document_id, question, answer, format, difficulty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, over.collection ?? 'c1', over.documentId === undefined ? 'd1' : over.documentId, over.question ?? `Pergunta ${id}`, `Resposta ${id}`, 'html', over.difficulty ?? 'dificil', 'x');
  return id;
}

/** Aplica as avaliações pelo caminho de verdade (`recordStudy`): o agendamento do cartão evolui como no app. */
function review(db: DatabaseSync, cardId: string, results: StudyResult[], opts: { user?: string; from?: number } = {}): void {
  results.forEach((result, i) => {
    const card = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(cardId) as never;
    recordStudy(db, opts.user ?? 'u1', card, result, null, at((opts.from ?? 0) + i));
  });
}

const E: StudyResult = 'errei';
const D: StudyResult = 'dificil';
const B: StudyResult = 'bom';

test('parseMinErrors: 4 por padrão, de 2 a 8, e recusa o resto', () => {
  assert.equal(value(parseMinErrors(undefined)), DEFAULT_MIN_ERRORS);
  assert.equal(value(parseMinErrors('')), DEFAULT_MIN_ERRORS);
  assert.equal(value(parseMinErrors('2')), 2);
  assert.equal(value(parseMinErrors('8')), 8);
  assert.equal(value(parseMinErrors(5)), 5);
  for (const bad of ['1', '9', 'abc', '4.5', '-3', '04x', 3.5, null, {}]) failure(parseMinErrors(bad), 400, /de 2 a 8/);
});

test('o cartão que errou 4 das últimas revisões é sanguessuga; com 3 só se o mínimo for 3', () => {
  const db = newDb();
  const four = addCard(db);
  review(db, four, [E, E, B, E, E]);
  const three = addCard(db);
  review(db, three, [E, E, B, E]);
  assert.deepEqual(loadLeeches(db, 'u1').leeches.map((l) => l.flashcard.id), [four]);
  assert.deepEqual(loadLeeches(db, 'u1', 3).leeches.map((l) => l.flashcard.id), [four, three]);
  assert.equal(loadLeeches(db, 'u1').total, 1);
});

test('"Difícil" não é erro, e cartão sem revisão nenhuma não aparece', () => {
  const db = newDb();
  review(db, addCard(db), [D, D, D, D, D, D]);
  addCard(db);
  const none = loadLeeches(db, 'u1');
  assert.equal(none.total, 0);
  assert.deepEqual(none.leeches, []);
});

test('traz os números do cartão: erros, revisões, sequência de acertos e as últimas revisões em ordem', () => {
  const db = newDb();
  const id = addCard(db, { question: 'O que é DNS?' });
  review(db, id, [E, D, E, E, E, B]);
  const [leech] = loadLeeches(db, 'u1').leeches;
  assert.equal(leech.flashcard.question, 'O que é DNS?');
  assert.equal(leech.flashcard.collectionName, 'Redes');
  assert.equal(leech.flashcard.collectionSubject, 'DNS');
  assert.equal(leech.errors, 4);
  assert.equal(leech.reviews, 6);
  assert.equal(leech.streak, 1);
  assert.deepEqual(leech.results, [E, D, E, E, E, B]);
  assert.equal(leech.lastReviewedAt, at(5).toISOString());
});

test('só as últimas 10 revisões contam: erros antigos demais não fazem sanguessuga', () => {
  const db = newDb();
  const id = addCard(db);
  review(db, id, [E, E, E, E, ...Array<StudyResult>(LEECH_WINDOW).fill(D)]);
  db.prepare('UPDATE flashcards SET repetitions = 0 WHERE id = ?').run(id); // isola a janela da sequência de acertos
  assert.equal(loadLeeches(db, 'u1').total, 0);
  review(db, id, [E, E, E, E], { from: 100 });
  const [leech] = loadLeeches(db, 'u1').leeches;
  assert.equal(leech.errors, 4);
  assert.equal(leech.reviews, LEECH_WINDOW);
  assert.equal(leech.results.length, LEECH_WINDOW);
});

test('acertou 3 vezes seguidas depois do último erro: o cartão fixou e sai da lista sozinho', () => {
  const db = newDb();
  const id = addCard(db);
  review(db, id, [E, E, E, E]);
  assert.equal(loadLeeches(db, 'u1').total, 1);
  review(db, id, [B, B], { from: 10 });
  assert.equal(loadLeeches(db, 'u1').total, 1, 'com 2 acertos seguidos ainda está na lista');
  review(db, id, [B], { from: 20 });
  assert.equal((db.prepare('SELECT repetitions FROM flashcards WHERE id = ?').get(id) as { repetitions: number }).repetitions, CONSOLIDATED_STREAK);
  assert.equal(loadLeeches(db, 'u1').total, 0);
  // errou de novo: a sequência zera e, com 4 erros na janela, volta para a lista
  review(db, id, [E], { from: 30 });
  assert.equal(loadLeeches(db, 'u1').total, 1);
});

test('recomeçar a contagem: os erros de antes deixam de valer, só os novos contam', () => {
  const db = newDb();
  const id = addCard(db);
  review(db, id, [E, E, E, E]);
  assert.equal(loadLeeches(db, 'u1').total, 1);

  const { resetAt } = value(resetLeech(db, 'u1', id, at(10)));
  assert.equal(resetAt, at(10).toISOString());
  assert.equal(loadLeeches(db, 'u1').total, 0);

  review(db, id, [E, E, E], { from: 20 });
  assert.equal(loadLeeches(db, 'u1').total, 0, '3 erros novos ainda não bastam');
  review(db, id, [E], { from: 30 });
  const [leech] = loadLeeches(db, 'u1').leeches;
  assert.equal(leech.errors, 4, 'só os 4 erros de depois do reinício');
  assert.equal(leech.reviews, 4);

  // pedir de novo só atualiza a data
  value(resetLeech(db, 'u1', id, at(40)));
  assert.equal(count(db, 'leech_state'), 1);
  assert.equal(loadLeeches(db, 'u1').total, 0);
});

test('a lista vem do que mais errou ao que menos, e entre iguais do revisado mais recentemente', () => {
  const db = newDb();
  const old = addCard(db);
  review(db, old, [E, E, E, E], { from: 0 });
  const recent = addCard(db);
  review(db, recent, [E, E, E, E], { from: 50 });
  const most = addCard(db);
  review(db, most, [E, E, E, E, E, E], { from: 20 });
  assert.deepEqual(loadLeeches(db, 'u1').leeches.map((l) => l.flashcard.id), [most, recent, old]);
});

test('cada usuário vê só os seus cartões', () => {
  const db = newDb();
  const mine = addCard(db);
  review(db, mine, [E, E, E, E]);
  const theirs = addCard(db, { collection: 'c2' });
  review(db, theirs, [E, E, E, E], { user: 'u2' });
  assert.deepEqual(loadLeeches(db, 'u1').leeches.map((l) => l.flashcard.id), [mine]);
  assert.deepEqual(loadLeeches(db, 'u2').leeches.map((l) => l.flashcard.id), [theirs]);
  // um registro de revisão de outro usuário sobre o meu cartão não conta para mim
  review(db, addCard(db), [E, E, E, E], { user: 'u2' });
  assert.equal(loadLeeches(db, 'u1').total, 1);
});

test('a lista traz no máximo 100 cartões e o total diz quantos são', () => {
  const db = newDb();
  for (let i = 0; i < MAX_LEECHES + 5; i++) review(db, addCard(db), [E, E, E, E], { from: i * 10 });
  const list = loadLeeches(db, 'u1');
  assert.equal(list.leeches.length, MAX_LEECHES);
  assert.equal(list.total, MAX_LEECHES + 5);
});

test('adiar: empurra o vencimento por 7, 14 ou 30 dias e não mexe no agendamento', () => {
  const db = newDb();
  const id = addCard(db);
  review(db, id, [E, E, E, E]);
  const before = db.prepare('SELECT ease_factor, interval_days, repetitions FROM flashcards WHERE id = ?').get(id);
  const now = new Date(); // o vencimento que o recordStudy gravou usa o relógio de verdade

  const { dueAt } = value(snoozeLeech(db, 'u1', id, 14, now));
  assert.equal(dueAt, new Date(now.getTime() + 14 * 86_400_000).toISOString());
  assert.equal((db.prepare('SELECT due_at FROM flashcards WHERE id = ?').get(id) as { due_at: string }).due_at, dueAt);
  assert.deepEqual(db.prepare('SELECT ease_factor, interval_days, repetitions FROM flashcards WHERE id = ?').get(id), before);

  const leech = loadLeeches(db, 'u1', DEFAULT_MIN_ERRORS, now).leeches[0];
  assert.equal(leech.snoozed, true);
  assert.equal(loadLeeches(db, 'u1', DEFAULT_MIN_ERRORS, new Date(now.getTime() + 15 * 86_400_000)).leeches[0].snoozed, false);
});

test('um cartão que só vence amanhã (acabou de ser revisado) NÃO está adiado: adiado é o que o usuário pediu', () => {
  const db = newDb();
  const id = addCard(db);
  review(db, id, [E, E, E, E]);
  const now = new Date();
  const before = loadLeeches(db, 'u1', DEFAULT_MIN_ERRORS, now).leeches[0];
  assert.ok(before.flashcard.dueAt! > now.toISOString(), 'o agendamento já empurrou o vencimento para o futuro');
  assert.equal(before.snoozed, false);
  assert.equal(before.snoozedUntil, null);

  const { dueAt } = value(snoozeLeech(db, 'u1', id, 7, now));
  const after = loadLeeches(db, 'u1', DEFAULT_MIN_ERRORS, now).leeches[0];
  assert.equal(after.snoozed, true);
  assert.equal(after.snoozedUntil, dueAt);

  // passado o prazo, deixa de estar adiado
  const later = loadLeeches(db, 'u1', DEFAULT_MIN_ERRORS, new Date(now.getTime() + 8 * 86_400_000)).leeches[0];
  assert.equal(later.snoozed, false);
  assert.equal(later.snoozedUntil, null);
});

test('adiar e recomeçar a contagem não se desfazem um ao outro', () => {
  const db = newDb();
  const id = addCard(db);
  review(db, id, [E, E, E, E]);
  const now = new Date();

  value(snoozeLeech(db, 'u1', id, 14, now));
  value(resetLeech(db, 'u1', id, now));
  assert.equal(count(db, 'leech_state'), 1);
  const state = db.prepare('SELECT reset_at, snoozed_until FROM leech_state WHERE flashcard_id = ?').get(id) as { reset_at: string; snoozed_until: string };
  assert.equal(state.reset_at, now.toISOString());
  assert.ok(state.snoozed_until > now.toISOString(), 'o recomeço da contagem não cancelou o adiamento');

  // e o contrário: adiar depois de recomeçar não apaga o recomeço
  const other = addCard(db);
  review(db, other, [E, E, E, E]);
  value(resetLeech(db, 'u1', other, now));
  value(snoozeLeech(db, 'u1', other, 7, now));
  const kept = db.prepare('SELECT reset_at, snoozed_until FROM leech_state WHERE flashcard_id = ?').get(other) as { reset_at: string; snoozed_until: string };
  assert.equal(kept.reset_at, now.toISOString());
  assert.ok(kept.snoozed_until);
});

test('adiar nunca antecipa: um cartão que já vence mais tarde fica como está', () => {
  const db = newDb();
  const id = addCard(db);
  const far = new Date(BASE + 90 * 86_400_000).toISOString();
  db.prepare('UPDATE flashcards SET due_at = ? WHERE id = ?').run(far, id);
  assert.equal(value(snoozeLeech(db, 'u1', id, 7, at(0))).dueAt, far);
  assert.equal((db.prepare('SELECT due_at FROM flashcards WHERE id = ?').get(id) as { due_at: string }).due_at, far);
});

test('adiar e recomeçar recusam prazo inválido e cartão de outro usuário', () => {
  const db = newDb();
  const mine = addCard(db);
  const theirs = addCard(db, { collection: 'c2' });
  for (const days of [0, 1, 8, 30.5, '7', null, undefined]) failure(snoozeLeech(db, 'u1', mine, days), 400, /7, 14, 30/);
  failure(snoozeLeech(db, 'u1', theirs, 7), 404);
  failure(snoozeLeech(db, 'u1', 'nao-existe', 7), 404);
  failure(resetLeech(db, 'u1', theirs), 404);
  failure(resetLeech(db, 'u1', 'nao-existe'), 404);
  assert.equal(count(db, 'leech_state'), 0);
  assert.equal((db.prepare('SELECT due_at FROM flashcards WHERE id = ?').get(theirs) as { due_at: string | null }).due_at, null);
});

test('quebrar: cria os cartões menores na mesma coleção e apaga o original com o histórico', () => {
  const db = newDb();
  const id = addCard(db, { difficulty: 'facil' });
  review(db, id, [E, E, E, E]);
  const result = value(
    splitLeech(db, 'u1', id, {
      cards: [
        { question: 'Parte <b>1</b>?', answer: 'Resposta 1' },
        { question: 'Parte 2?', answer: '<p>Resposta 2</p>' },
        { question: 'Parte 3?', answer: 'Resposta 3' },
      ],
    }, at(200)),
  );
  assert.equal(result.originalDeleted, true);
  assert.equal(result.created.length, 3);
  assert.deepEqual(result.created.map((c) => c.collectionId), ['c1', 'c1', 'c1']);
  assert.deepEqual(result.created.map((c) => c.difficulty), ['facil', 'facil', 'facil']);
  assert.deepEqual(result.created.map((c) => c.documentId), ['d1', 'd1', 'd1']);
  assert.deepEqual(result.created.map((c) => c.format), ['html', 'html', 'html']);
  assert.equal(result.created[0].question, 'Parte <b>1</b>?');
  assert.equal(result.created.every((c) => c.dueAt === null), true, 'cartões novos, nunca estudados');

  assert.equal(db.prepare('SELECT id FROM flashcards WHERE id = ?').get(id), undefined);
  assert.equal(count(db, 'study_sessions'), 0, 'o histórico do original vai junto');
  assert.equal(count(db, 'flashcards'), 3);
  assert.equal(loadLeeches(db, 'u1').total, 0);
});

test('quebrar mantendo o original: ele fica e recomeça a contagem', () => {
  const db = newDb();
  const id = addCard(db);
  review(db, id, [E, E, E, E]);
  const result = value(
    splitLeech(db, 'u1', id, { keepOriginal: true, cards: [{ question: 'A?', answer: 'a' }, { question: 'B?', answer: 'b' }] }, at(200)),
  );
  assert.equal(result.originalDeleted, false);
  assert.equal(count(db, 'flashcards'), 3);
  assert.equal(count(db, 'leech_state'), 1);
  assert.equal(loadLeeches(db, 'u1').total, 0);
});

test('quebrar valida tudo antes de criar qualquer coisa', () => {
  const db = newDb();
  const id = addCard(db);
  review(db, id, [E, E, E, E]);
  const one = { question: 'A?', answer: 'a' };
  failure(splitLeech(db, 'u1', id, { cards: [one] }), 400, /2 a 6/);
  failure(splitLeech(db, 'u1', id, { cards: Array(7).fill(one) }), 400, /2 a 6/);
  failure(splitLeech(db, 'u1', id, { cards: 'x' }), 400, /2 a 6/);
  failure(splitLeech(db, 'u1', id, undefined), 400, /2 a 6/);
  failure(splitLeech(db, 'u1', id, { cards: [one, { question: '', answer: 'b' }] }), 400, /pergunta e a resposta/);
  failure(splitLeech(db, 'u1', id, { cards: [one, { question: 'B?', answer: '<p> </p>' }] }), 400, /pergunta e a resposta/);
  failure(splitLeech(db, 'u1', id, { cards: [one, { question: 7, answer: 'b' }] }), 400, /pergunta e a resposta/);
  assert.equal(count(db, 'flashcards'), 1, 'nada foi criado e o original continua');
  assert.equal(count(db, 'study_sessions'), 4);
});

test('quebrar sanitiza o HTML e recusa cartão de outro usuário', () => {
  const db = newDb();
  const id = addCard(db);
  const result = value(
    splitLeech(db, 'u1', id, {
      keepOriginal: true,
      cards: [
        { question: 'A?<script>alert(1)</script>', answer: '<img src="x" onerror="alert(1)">resposta <b onclick="x()">a</b>' },
        { question: 'B?', answer: 'b' },
      ],
    }),
  );
  assert.equal(result.created[0].question, 'A?');
  assert.ok(!/onerror|onclick|script/.test(result.created[0].answer), result.created[0].answer);

  const theirs = addCard(db, { collection: 'c2' });
  failure(splitLeech(db, 'u1', theirs, { cards: [{ question: 'A?', answer: 'a' }, { question: 'B?', answer: 'b' }] }), 404);
  assert.equal(count(db, 'flashcards'), 4);
});

test('apagar o cartão leva a linha do reinício', () => {
  const db = newDb();
  const id = addCard(db);
  value(resetLeech(db, 'u1', id));
  assert.equal(count(db, 'leech_state'), 1);
  db.prepare('DELETE FROM flashcards WHERE id = ?').run(id);
  assert.equal(count(db, 'leech_state'), 0);
});
