import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FROZEN_SCHEMA, setCollectionFrozen } from '../collections/frozen';
import {
  buildReviewDebt,
  DEBT_ATTENTION,
  DEBT_BATCH,
  DEBT_HIGH,
  debtLevel,
  lateBuckets,
  loadOverdueCards,
  loadReviewDebt,
} from './reviewDebt';

// 23/10/2026, 15:00 no horário local do computador que roda o teste.
const NOW = new Date(2026, 9, 23, 15, 0, 0);
const at = (dayOffset: number, hour = 10, minute = 0) => new Date(2026, 9, 23 + dayOffset, hour, minute, 0).toISOString();

// ---------- o cálculo, puro ----------

test('nível: abaixo de 25 atrasados está ok, de 25 a 99 pede atenção, 100 ou mais é alta', () => {
  assert.equal(DEBT_ATTENTION, 25);
  assert.equal(DEBT_HIGH, 100);
  assert.deepEqual([0, 24, 25, 99, 100, 393].map(debtLevel), ['ok', 'ok', 'attention', 'attention', 'high', 'high']);
});

test('lateBuckets: 1 a 3, 4 a 7, 8 a 14 e mais de 14 dias de atraso', () => {
  assert.deepEqual(lateBuckets([1, 3, 4, 7, 8, 14, 15, 36]), { upTo3: 2, upTo7: 2, upTo14: 2, over14: 2 });
  assert.deepEqual(lateBuckets([]), { upTo3: 0, upTo7: 0, upTo14: 0, over14: 0 });
});

test('buildReviewDebt: conferido à mão (atrasados, ritmo da semana, dias para zerar)', () => {
  const debt = buildReviewDebt({ daysLate: [1, 1, 5, 10, 20], weekReviews: 20, weekNewCards: 14, dailyNewLimit: 30 });
  assert.equal(debt.overdue, 5);
  assert.equal(debt.oldestDays, 20);
  assert.deepEqual(debt.lateBy, { upTo3: 2, upTo7: 1, upTo14: 1, over14: 1 });
  assert.deepEqual(debt.week, { days: 7, reviews: 20, newCards: 14, oldCards: 6 });
  assert.equal(debt.oldPerDay, 0.9, '6 revisões de cartões antigos em 7 dias');
  assert.equal(debt.newSharePct, 70);
  assert.equal(debt.daysToClear, 6, '5 atrasados ÷ (6 ÷ 7) = 5,8 dias, arredondado para cima');
  assert.equal(debt.level, 'ok');
  assert.equal(debt.batch, 5);
  assert.equal(debt.dailyNewLimit, 30);
});

test('buildReviewDebt: o lote é no máximo 25, e sem atrasados nada fica "infinito" nem negativo', () => {
  const many = buildReviewDebt({ daysLate: Array.from({ length: 393 }, () => 2), weekReviews: 191, weekNewCards: 149, dailyNewLimit: null });
  assert.equal(many.batch, DEBT_BATCH);
  assert.equal(many.level, 'high');
  assert.equal(many.newSharePct, 78);
  assert.equal(many.week.oldCards, 42);
  assert.equal(many.daysToClear, 66, '393 ÷ 6 por dia');
  assert.equal(many.dailyNewLimit, null);

  const none = buildReviewDebt({ daysLate: [], weekReviews: 10, weekNewCards: 4, dailyNewLimit: 20 });
  assert.deepEqual([none.overdue, none.oldestDays, none.daysToClear, none.batch, none.level], [0, null, null, 0, 'ok']);
});

test('buildReviewDebt: sem revisões de cartões antigos na semana não há estimativa; sem revisões nenhuma, nem a fatia', () => {
  const onlyNew = buildReviewDebt({ daysLate: [3, 4], weekReviews: 12, weekNewCards: 12, dailyNewLimit: null });
  assert.equal(onlyNew.daysToClear, null);
  assert.equal(onlyNew.newSharePct, 100);
  assert.equal(onlyNew.oldPerDay, 0);

  const idle = buildReviewDebt({ daysLate: [3, 4], weekReviews: 0, weekNewCards: 0, dailyNewLimit: null });
  assert.deepEqual([idle.newSharePct, idle.daysToClear], [null, null]);

  const clamped = buildReviewDebt({ daysLate: [1], weekReviews: 5, weekNewCards: 9, dailyNewLimit: null });
  assert.deepEqual(clamped.week, { days: 7, reviews: 5, newCards: 5, oldCards: 0 }, 'novos nunca passam do total');
});

// ---------- com o banco ----------

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
    INSERT INTO users (id, daily_new_limit) VALUES ('u1', 30), ('u2', NULL);
    INSERT INTO collections (id, user_id, name, subject) VALUES ('cA', 'u1', 'Ativa', 'Redes'), ('cF', 'u1', 'Congelada', 'Direito'), ('cX', 'u2', 'Alheia', '');
  `);
  db.exec(FROZEN_SCHEMA);
  return db;
}

let counter = 0;
function add(db: DatabaseSync, id: string, collection: string, dueAt: string | null) {
  db.prepare('INSERT INTO flashcards (id, collection_id, created_at, due_at) VALUES (?, ?, ?, ?)').run(id, collection, new Date(2026, 8, 1, 0, 0, ++counter).toISOString(), dueAt);
}
function review(db: DatabaseSync, id: string, cardId: string, studiedAt: string, user = 'u1') {
  db.prepare('INSERT INTO study_sessions (id, flashcard_id, user_id, result, studied_at) VALUES (?, ?, ?, ?, ?)').run(id, cardId, user, 'bom', studiedAt);
}

/**
 * cA: a1 venceu há 3 dias, a2 ontem à noite, a3 hoje de madrugada (é de hoje, não atrasado), a4 vence amanhã e n1 é novo.
 * cF (congelada): f1 atrasado. cX (outra conta): x1 atrasado.
 */
function seed(db: DatabaseSync) {
  add(db, 'a1', 'cA', at(-3, 9));
  add(db, 'a2', 'cA', at(-1, 23));
  add(db, 'a3', 'cA', at(0, 0, 30));
  add(db, 'a4', 'cA', at(1, 9));
  add(db, 'n1', 'cA', null);
  add(db, 'f1', 'cF', at(-5, 9));
  add(db, 'x1', 'cX', at(-5, 9));
}

test('a dívida lê do banco: só o que venceu antes de hoje, sem novos, congeladas nem outras contas', () => {
  const db = newDb();
  seed(db);
  setCollectionFrozen(db, 'cF', true);
  const debt = loadReviewDebt(db, 'u1', NOW);
  assert.equal(debt.overdue, 2, 'a1 e a2; a3 é de hoje, a4 de amanhã, n1 é novo');
  assert.equal(debt.oldestDays, 3);
  assert.deepEqual(debt.lateBy, { upTo3: 2, upTo7: 0, upTo14: 0, over14: 0 });
  assert.equal(debt.dailyNewLimit, 30);

  setCollectionFrozen(db, 'cF', false);
  assert.equal(loadReviewDebt(db, 'u1', NOW).overdue, 3, 'descongelada, f1 volta à conta (venceu há 5 dias)');
  assert.equal(loadReviewDebt(db, 'u2', NOW).overdue, 1, 'a outra conta tem a dela');
  assert.equal(loadReviewDebt(db, 'u2', NOW).dailyNewLimit, null);
});

test('a dívida: o dia de atraso conta por dia de calendário, não por horas', () => {
  const db = newDb();
  add(db, 'ontem-de-noite', 'cA', at(-1, 23, 59)); // 15 horas antes de agora, mas ontem: 1 dia
  add(db, 'anteontem-de-manha', 'cA', at(-2, 0, 5)); // 2 dias de calendário
  const debt = loadReviewDebt(db, 'u1', NOW);
  assert.deepEqual(debt.lateBy, { upTo3: 2, upTo7: 0, upTo14: 0, over14: 0 });
  assert.equal(debt.oldestDays, 2);
});

test('o ritmo da semana: revisão de cartão novo (a primeira de todos os tempos) separada da de cartão antigo', () => {
  const db = newDb();
  seed(db);
  review(db, 's1', 'a1', at(-10)); // fora da janela de 7 dias, mas é a primeira de a1: a1 já não é "novo" na janela
  review(db, 's2', 'a1', at(-2)); // dentro: cartão antigo
  review(db, 's3', 'a2', at(-1)); // dentro e primeira de a2: novo
  review(db, 's4', 'a2', at(0, 10)); // dentro: antigo
  review(db, 's5', 'x1', at(-1), 'u2'); // de outra conta: não conta
  review(db, 's6', 'a4', at(-7, 9)); // 16/10 às 9h: antes da janela (que começa em 17/10 00:00)
  review(db, 's7', 'n1', at(-6, 9)); // 17/10: dentro da janela, primeira: novo
  const debt = loadReviewDebt(db, 'u1', NOW);
  assert.deepEqual(debt.week, { days: 7, reviews: 4, newCards: 2, oldCards: 2 });
  assert.equal(debt.newSharePct, 50);
  assert.equal(debt.oldPerDay, 0.3);
  assert.equal(debt.overdue, 3, 'a1, a2 e f1 (cF não está congelada neste teste)');
  assert.equal(debt.daysToClear, 11, '3 atrasados ÷ (2 ÷ 7 por dia) = 10,5, arredondado para cima');
});

test('sessão "Pôr em dia": os mais atrasados primeiro, no máximo o lote, sem novos, congeladas nem de hoje', () => {
  const db = newDb();
  seed(db);
  setCollectionFrozen(db, 'cF', true);
  assert.deepEqual(loadOverdueCards(db, 'u1', NOW).map((c) => c.id), ['a1', 'a2'], 'a1 (há 3 dias) antes de a2 (ontem)');
  assert.deepEqual(loadOverdueCards(db, 'u1', NOW, 1).map((c) => c.id), ['a1'], 'o limite vale');
  assert.deepEqual(loadOverdueCards(db, 'u1', NOW, 0), []);
  assert.deepEqual(loadOverdueCards(db, 'u2', NOW).map((c) => c.id), ['x1']);

  for (let i = 1; i <= 30; i++) add(db, `m${i}`, 'cA', at(-20, 8, i));
  const batch = loadOverdueCards(db, 'u1', NOW);
  assert.equal(batch.length, DEBT_BATCH);
  assert.ok(batch.every((c) => c.id.startsWith('m')), 'os de 20 dias de atraso vêm antes de a1 e a2');
  assert.ok(batch[0].collection_name && 'collection_subject' in batch[0], 'cada cartão traz a coleção e o assunto');
});

test('é só leitura: nenhuma tabela muda ao calcular a dívida nem ao montar a sessão', () => {
  const db = newDb();
  seed(db);
  review(db, 's1', 'a1', at(-2));
  const snapshot = () => JSON.stringify({
    cards: db.prepare('SELECT * FROM flashcards ORDER BY id').all(),
    sessions: db.prepare('SELECT * FROM study_sessions ORDER BY id').all(),
    users: db.prepare('SELECT * FROM users ORDER BY id').all(),
    frozen: db.prepare('SELECT * FROM frozen_collections').all(),
  });
  const before = snapshot();
  loadReviewDebt(db, 'u1', NOW);
  loadOverdueCards(db, 'u1', NOW);
  assert.equal(snapshot(), before);
});
