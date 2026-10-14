import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { recordStudy, undoStudy, type StudiedCard } from './study';

// Banco só em memória, com as tabelas que a avaliação toca (sem as chaves estrangeiras do app).
function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, ease_factor REAL NOT NULL DEFAULT 2.5, interval_days INTEGER NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0, due_at TEXT
    );
    CREATE TABLE study_sessions (
      id TEXT PRIMARY KEY, flashcard_id TEXT NOT NULL, user_id TEXT NOT NULL, result TEXT NOT NULL,
      studied_at TEXT NOT NULL, duration_ms INTEGER,
      prev_ease_factor REAL, prev_interval_days INTEGER, prev_repetitions INTEGER, prev_due_at TEXT
    );
  `);
  return db;
}

const card = (db: DatabaseSync, extra: Partial<StudiedCard> = {}): StudiedCard => {
  const c: StudiedCard = { id: 'c1', ease_factor: 2.5, interval_days: 0, repetitions: 0, due_at: null, ...extra };
  db.prepare('INSERT INTO flashcards (id, ease_factor, interval_days, repetitions, due_at) VALUES (?, ?, ?, ?, ?)').run(
    c.id,
    c.ease_factor,
    c.interval_days,
    c.repetitions,
    c.due_at,
  );
  return c;
};

// As linhas do SQLite vêm sem protótipo: copiadas para objetos comuns, comparam normalmente.
const flashcard = (db: DatabaseSync, id = 'c1') => ({ ...(db.prepare('SELECT * FROM flashcards WHERE id = ?').get(id) as object) });
const sessionCount = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM study_sessions').get() as { n: number }).n;

test('avaliar: grava a revisão e o novo agendamento, e devolve o id para desfazer', () => {
  const db = newDb();
  const c = card(db);
  const { sessionId, dueAt } = recordStudy(db, 'u1', c, 'bom', 4200);

  assert.equal(sessionCount(db), 1);
  const row = db.prepare('SELECT * FROM study_sessions WHERE id = ?').get(sessionId) as Record<string, unknown>;
  assert.equal(row.result, 'bom');
  assert.equal(row.duration_ms, 4200);
  assert.equal(row.user_id, 'u1');
  // guarda o agendamento de ANTES
  assert.equal(row.prev_ease_factor, 2.5);
  assert.equal(row.prev_interval_days, 0);
  assert.equal(row.prev_repetitions, 0);
  assert.equal(row.prev_due_at, null);
  // e o cartão passa a ter o de DEPOIS
  assert.deepEqual(flashcard(db), { id: 'c1', ease_factor: 2.5, interval_days: 1, repetitions: 1, due_at: dueAt });
});

test('desfazer: devolve exatamente o agendamento de antes e apaga a revisão', () => {
  const db = newDb();
  const c = card(db, { ease_factor: 2.3, interval_days: 6, repetitions: 2, due_at: '2026-10-01T00:00:00.000Z' });
  const before = flashcard(db);
  const { sessionId } = recordStudy(db, 'u1', c, 'errei', 3000);
  assert.notDeepEqual(flashcard(db), before, 'errar mexe no agendamento');

  assert.deepEqual(undoStudy(db, 'u1', 'c1', sessionId), { ok: true });
  assert.deepEqual(flashcard(db), before);
  assert.equal(sessionCount(db), 0, 'a revisão desfeita some do histórico (e do painel)');
});

test('desfazer: só a última avaliação do cartão; a anterior fica protegida enquanto houver uma mais nova', () => {
  const db = newDb();
  const c = card(db);
  const t0 = new Date('2026-10-14T10:00:00Z');
  const first = recordStudy(db, 'u1', c, 'bom', 1000, t0);
  const second = recordStudy(
    db,
    'u1',
    { ...c, ease_factor: 2.5, interval_days: 1, repetitions: 1, due_at: first.dueAt },
    'facil',
    1000,
    new Date('2026-10-14T10:05:00Z'),
  );

  const refused = undoStudy(db, 'u1', 'c1', first.sessionId);
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok && refused.status === 409 && /de novo/.test(refused.error));
  assert.equal(sessionCount(db), 2, 'nada foi apagado');

  // desfazendo na ordem (a última primeiro), as duas saem
  assert.deepEqual(undoStudy(db, 'u1', 'c1', second.sessionId), { ok: true });
  assert.deepEqual(undoStudy(db, 'u1', 'c1', first.sessionId), { ok: true });
  assert.deepEqual(flashcard(db), { id: 'c1', ease_factor: 2.5, interval_days: 0, repetitions: 0, due_at: null });
});

test('desfazer: não mexe em avaliação de outro usuário, de outro cartão, nem inexistente', () => {
  const db = newDb();
  const c = card(db);
  card(db, { id: 'c2' });
  const { sessionId } = recordStudy(db, 'u1', c, 'bom', null);
  const state = flashcard(db);

  for (const [user, flashcardId, session] of [
    ['u2', 'c1', sessionId],
    ['u1', 'c2', sessionId],
    ['u1', 'c1', 'nao-existe'],
  ] as const) {
    const result = undoStudy(db, user, flashcardId, session);
    assert.ok(!result.ok && result.status === 404, `${user}/${flashcardId}/${session}`);
  }
  assert.deepEqual(flashcard(db), state);
  assert.equal(sessionCount(db), 1);
});

test('desfazer: revisão antiga, sem o agendamento guardado, é recusada e nada muda', () => {
  const db = newDb();
  card(db, { interval_days: 6, repetitions: 2 });
  db.prepare(
    "INSERT INTO study_sessions (id, flashcard_id, user_id, result, studied_at) VALUES ('velha', 'c1', 'u1', 'bom', '2026-01-01T00:00:00Z')",
  ).run();
  const state = flashcard(db);

  const result = undoStudy(db, 'u1', 'c1', 'velha');
  assert.ok(!result.ok && result.status === 409 && /antiga/.test(result.error));
  assert.deepEqual(flashcard(db), state);
  assert.equal(sessionCount(db), 1);
});

test('avaliar e desfazer seguidos, várias vezes, nunca acumulam nada', () => {
  const db = newDb();
  const c = card(db, { ease_factor: 2.2, interval_days: 3, repetitions: 3, due_at: '2026-10-20T00:00:00.000Z' });
  const before = flashcard(db);
  for (const result of ['errei', 'dificil', 'bom', 'facil'] as const) {
    const { sessionId } = recordStudy(db, 'u1', c, result, 500);
    assert.deepEqual(undoStudy(db, 'u1', 'c1', sessionId), { ok: true });
  }
  assert.deepEqual(flashcard(db), before);
  assert.equal(sessionCount(db), 0);
});
