import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FROZEN_SCHEMA, setCollectionFrozen } from '../collections/frozen';
import {
  ACCURACY_PRIOR,
  computeFinalStretch,
  coverageFactor,
  DEFAULT_FOCUS_NEW,
  FOCUS_TOP,
  loadFinalStretch,
  loadFocusCards,
  MAX_FOCUS_CARDS,
  NEW_SHARE_OF_SESSION,
  phaseFor,
  rankDisciplines,
  selectFocus,
  smoothedAccuracy,
  STATS_WINDOW_DAYS,
  type DisciplineStats,
} from './finalStretch';
import type { NewCardRef } from './newOrder';

// ---------- a prioridade, pura ----------

const stats = (over: Partial<DisciplineStats> & { id: string }): DisciplineStats => ({
  name: over.id,
  points: 10,
  cards: 10,
  newCards: 0,
  dueCards: 0,
  reviews: 0,
  hits: 0,
  ...over,
});

test('acerto suavizado: sem revisões vale 60%, e com muitas revisões se aproxima do acerto de verdade', () => {
  assert.equal(smoothedAccuracy(0, 0), ACCURACY_PRIOR);
  assert.ok(Math.abs(smoothedAccuracy(10, 10) - 13 / 15) < 1e-9);
  assert.ok(Math.abs(smoothedAccuracy(0, 10) - 3 / 15) < 1e-9);
  assert.ok(Math.abs(smoothedAccuracy(30, 30) - 33 / 35) < 1e-9);
  // 3 acertos em 3 não viram 100%: pouca revisão não convence
  assert.ok(smoothedAccuracy(3, 3) < 0.85);
});

test('fases: mais de 7 dias é conteúdo; de 7 a 4 só revisão; de 3 a 0 a última semana', () => {
  assert.equal(phaseFor(50), 'content');
  assert.equal(phaseFor(8), 'content');
  assert.equal(phaseFor(7), 'review');
  assert.equal(phaseFor(4), 'review');
  assert.equal(phaseFor(3), 'last');
  assert.equal(phaseFor(0), 'last');
});

test('prioridade: o que ainda está em aberto na prova (fatia × o que falta dominar), conferido à mão', () => {
  const ranked = rankDisciplines([
    stats({ id: 'A', points: 50, cards: 10, newCards: 0, dueCards: 2, reviews: 20, hits: 10 }),
    stats({ id: 'B', points: 30, cards: 10, newCards: 5, reviews: 0, hits: 0 }),
    stats({ id: 'C', points: 20, cards: 0 }),
  ]);
  // A: fatia .5, viu 100%, acerto suavizado (10+3)/25 = .52 → domínio 52% → em aberto .5 × .48 = 24%
  // B: fatia .3, viu 50%, sem revisões (60%) → domínio 30% → em aberto .3 × .7 = 21%
  // C: fatia .2, sem cartões → domínio 0 → em aberto 20%, mas fora da ordem (não há o que revisar)
  assert.deepEqual(ranked.map((d) => d.id), ['A', 'B', 'C']);
  assert.deepEqual(ranked.map((d) => d.rank), [1, 2, null]);
  assert.deepEqual(ranked.map((d) => d.sharePct), [50, 30, 20]);
  assert.deepEqual(ranked.map((d) => d.seenPct), [100, 50, null]);
  assert.deepEqual(ranked.map((d) => d.accuracyPct), [50, null, null]);
  assert.deepEqual(ranked.map((d) => d.masteryPct), [52, 30, null]);
  assert.deepEqual(ranked.map((d) => d.gainPct), [24, 21, 20]);
  assert.deepEqual(ranked.map((d) => d.hasCards), [true, true, false]);
  assert.equal(ranked[0].reviews30, 20);
});

test('prioridade: uma disciplina leve e fraca passa uma pesada que já está dominada', () => {
  const ranked = rankDisciplines([
    stats({ id: 'pesada', points: 40, cards: 40, newCards: 0, reviews: 40, hits: 40 }),
    stats({ id: 'leve', points: 10, cards: 10, newCards: 10, reviews: 0, hits: 0 }),
  ]);
  assert.deepEqual(ranked.map((d) => d.id), ['leve', 'pesada']);
});

test('prioridade: empate em aberto vale a de mais pontos, e depois a ordem da prova; sem cartões vai para o fim', () => {
  const same = { cards: 10, newCards: 0, reviews: 0, hits: 0 };
  // fatias 40% e 20% com o mesmo domínio não empatam; para empatar o "em aberto", o domínio compensa: A (20, visto 0%) e B (10, visto 0%)
  // têm em aberto 66,7% e 33,3%. Aqui o empate exato vem de duas disciplinas idênticas.
  const ranked = rankDisciplines([
    stats({ id: 'sem', points: 90, cards: 0 }),
    stats({ id: 'primeira', points: 10, ...same }),
    stats({ id: 'segunda', points: 10, ...same }),
  ]);
  assert.deepEqual(ranked.map((d) => d.id), ['primeira', 'segunda', 'sem'], 'a sem cartões, mesmo valendo mais, fica por último');
  assert.deepEqual(ranked.map((d) => d.rank), [1, 2, null]);
});

test('prioridade: sem pontos nem cartões não quebra nada', () => {
  assert.deepEqual(rankDisciplines([]), []);
  const [only] = rankDisciplines([stats({ id: 'X', points: 0, cards: 0 })]);
  assert.equal(only.sharePct, 0);
  assert.equal(only.gainPct, 0);
  assert.equal(only.rank, null);
});

// ---------- a fila, pura ----------

const group = (g: string, ...ids: string[]): NewCardRef[] => ids.map((id) => ({ id, group: g }));
const weights = (entries: [string, number][]) => new Map(entries);
const countOf = (ids: string[], prefix: string) => ids.filter((id) => id.startsWith(prefix)).length;

test('fila: os vencidos se repartem pela prioridade (3 para 1) e o mais atrasado de cada disciplina entra primeiro', () => {
  const due = [...group('A', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'), ...group('B', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6')];
  const picked = selectFocus({ due, fresh: [], weights: weights([['A', 3], ['B', 1]]), maxCards: 8, newAllowed: 0 });
  assert.deepEqual(picked.due, ['a1', 'a2', 'b1', 'a3', 'a4', 'a5', 'b2', 'a6']);
  assert.equal(countOf(picked.due, 'a'), 6);
  assert.equal(countOf(picked.due, 'b'), 2);
  assert.deepEqual(picked.fresh, []);
  assert.equal(picked.waitingDue, 4);
});

test('fila: os vencidos vêm antes dos novos, e os novos só ocupam o que sobra do teto', () => {
  const picked = selectFocus({
    due: group('A', 'a1', 'a2', 'a3'),
    fresh: group('A', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10'),
    weights: weights([['A', 1]]),
    maxCards: 5,
    newAllowed: 10,
  });
  assert.deepEqual(picked.due, ['a1', 'a2', 'a3']);
  assert.deepEqual(picked.fresh, ['n1', 'n2']);
  assert.equal(picked.waitingDue, 0);
  assert.equal(picked.waitingNew, 8);
});

test('fila: com vencidos de sobra, os novos ainda têm 1/3 da sessão reservado (senão a cobertura nunca avança)', () => {
  assert.equal(NEW_SHARE_OF_SESSION, 1 / 3);
  const picked = selectFocus({
    due: group('A', ...Array.from({ length: 283 }, (_, i) => `a${i}`)),
    fresh: group('A', ...Array.from({ length: 748 }, (_, i) => `n${i}`)),
    weights: weights([['A', 1]]),
    maxCards: 100,
    newAllowed: 50,
  });
  assert.equal(picked.fresh.length, 33, 'o terço reservado (o limite diário de 50 não é atingido, o teto manda)');
  assert.equal(picked.due.length, 67);
  assert.equal(picked.waitingDue, 216);
  assert.equal(picked.waitingNew, 715);
  // poucos novos permitidos: reservam só o que pedem, e o resto do teto vai para os vencidos
  const few = selectFocus({ due: group('A', ...Array.from({ length: 283 }, (_, i) => `a${i}`)), fresh: group('A', 'n1', 'n2', 'n3'), weights: weights([['A', 1]]), maxCards: 100, newAllowed: 3 });
  assert.deepEqual([few.due.length, few.fresh.length], [97, 3]);
});

test('fila: o teto pequeno também reserva a parte dos novos, e arredonda para baixo', () => {
  const picked = selectFocus({
    due: group('A', ...Array.from({ length: 10 }, (_, i) => `a${i}`)),
    fresh: group('A', 'n1', 'n2'),
    weights: weights([['A', 1]]),
    maxCards: 4,
    newAllowed: 5,
  });
  assert.equal(picked.fresh.length, 1, '4 ÷ 3 = 1');
  assert.equal(picked.due.length, 3);
  assert.equal(picked.waitingDue, 7);
  assert.equal(picked.waitingNew, 1);
});

test('fila: sem permissão para novos o teto inteiro é dos vencidos', () => {
  const picked = selectFocus({ due: group('A', ...Array.from({ length: 150 }, (_, i) => `a${i}`)), fresh: group('A', 'n1'), weights: weights([['A', 1]]), maxCards: 100, newAllowed: 0 });
  assert.equal(picked.due.length, 100);
  assert.deepEqual(picked.fresh, []);
});

test('fila: sem permissão para novos (última semana), nenhum entra', () => {
  const picked = selectFocus({ due: group('A', 'a1'), fresh: group('A', 'n1', 'n2'), weights: weights([['A', 1]]), maxCards: 10, newAllowed: 0 });
  assert.deepEqual(picked.fresh, []);
  assert.equal(picked.waitingNew, 2);
});

test('fila: os novos também se repartem pela prioridade, na ordem de criação dentro de cada disciplina', () => {
  const picked = selectFocus({
    due: [],
    fresh: [...group('A', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'), ...group('B', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6')],
    weights: weights([['A', 3], ['B', 1]]),
    maxCards: 100,
    newAllowed: 8,
  });
  assert.deepEqual(picked.fresh, ['a1', 'a2', 'b1', 'a3', 'a4', 'a5', 'b2', 'a6']);
});

test('fila: números estranhos (zero, negativos, quebrados) não derrubam nada', () => {
  const input = { due: group('A', 'a1', 'a2'), fresh: group('A', 'n1'), weights: weights([['A', 1]]) };
  assert.deepEqual(selectFocus({ ...input, maxCards: 0, newAllowed: 5 }), { due: [], fresh: [], waitingDue: 2, waitingNew: 1 });
  assert.deepEqual(selectFocus({ ...input, maxCards: -3, newAllowed: -1 }).due, []);
  assert.equal(selectFocus({ ...input, maxCards: 2.9, newAllowed: 0.7 }).due.length, 2);
});

// ---------- com o banco ----------

// 17/10/2026, 15:00 no horário local do computador que roda o teste. A prova (06/12) fica a 50 dias.
const NOW = new Date(2026, 9, 17, 15, 0, 0);
const PAST = new Date(2026, 9, 10).toISOString();
const FUTURE = new Date(2026, 9, 25).toISOString();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(FROZEN_SCHEMA);
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
    INSERT INTO collections (id, user_id, name, subject) VALUES ('cS', 'u1', 'Específicos', 'Redes'), ('cP', 'u1', 'Português', ''), ('cU', 'u1', 'Solta', ''), ('cX', 'u2', 'Alheia', '');
    INSERT INTO exams VALUES ('e1', 'u1', 'Prova', '2026-12-06'), ('e2', 'u2', 'Alheia', '2026-12-06');
    INSERT INTO exam_disciplines VALUES ('dS', 'e1', 'Conhecimentos Específicos', 50, NULL, 0), ('dP', 'e1', 'Língua Portuguesa', 10, NULL, 1), ('dI', 'e1', 'Língua Inglesa', 10, NULL, 2);
    INSERT INTO exam_topics VALUES ('tS', 'dS', 'Redes', 0), ('tP', 'dP', 'Concordância', 0), ('tI', 'dI', 'Reading', 0);
    INSERT INTO exam_topic_collections VALUES ('tS', 'cS'), ('tP', 'cP');
  `);
  return db;
}

let counter = 0;
function add(db: DatabaseSync, id: string, collection: string, dueAt: string | null = null) {
  db.prepare('INSERT INTO flashcards (id, collection_id, created_at, due_at) VALUES (?, ?, ?, ?)').run(id, collection, new Date(2026, 8, 1, 0, 0, ++counter).toISOString(), dueAt);
}
const many = (db: DatabaseSync, prefix: string, collection: string, n: number, dueAt: string | null = null) => {
  for (let i = 1; i <= n; i++) add(db, `${prefix}${i}`, collection, dueAt);
};
let sessionCounter = 0;
function review(db: DatabaseSync, cardId: string, result: string, at: string, user = 'u1') {
  db.prepare('INSERT INTO study_sessions (id, flashcard_id, user_id, result, studied_at) VALUES (?, ?, ?, ?, ?)').run(`s${++sessionCounter}`, cardId, user, result, at);
}
const setExam = (db: DatabaseSync, date: string | null) => db.prepare("UPDATE exams SET exam_date = ? WHERE id = 'e1'").run(date);

/** cS: 4 vencidos e 6 novos; cP: 5 vencidos; cU (fora do edital): 3 vencidos. */
function seed(db: DatabaseSync) {
  many(db, 's', 'cS', 4, PAST);
  many(db, 'sn', 'cS', 6);
  many(db, 'p', 'cP', 5, PAST);
  many(db, 'u', 'cU', 3, PAST);
}

test('sem concurso com data não há reta final: tudo vazio, e nada quebra', () => {
  const db = newDb();
  seed(db);
  setExam(db, null);
  const overview = loadFinalStretch(db, 'u1', NOW);
  assert.equal(overview.exam, null);
  assert.equal(overview.phase, null);
  assert.deepEqual(overview.disciplines, []);
  assert.deepEqual(overview.focus, []);
  assert.equal(overview.queue.total, 0);
  assert.deepEqual(loadFocusCards(db, 'u1', NOW), []);
});

test('uma prova que já passou também não conta', () => {
  const db = newDb();
  seed(db);
  setExam(db, '2026-10-10');
  assert.equal(loadFinalStretch(db, 'u1', NOW).exam, null);
});

/**
 * Um segundo concurso do mesmo usuário (UFBA, daqui a 95 dias) com o edital dele: duas disciplinas (Informática 30 questões, Legislação 10).
 * Liga a coleção cS (a mesma do primeiro concurso: os cartões servem aos dois) à Informática e uma coleção cL à Legislação.
 */
function addSecondExam(db: DatabaseSync) {
  db.exec(`
    INSERT INTO collections (id, user_id, name, subject) VALUES ('cL', 'u1', 'Legislação', '');
    INSERT INTO exams VALUES ('e3', 'u1', 'UFBA - Analista de TI', '2027-01-20');
    INSERT INTO exam_disciplines VALUES ('dU1', 'e3', 'Informática', 30, NULL, 0), ('dU2', 'e3', 'Legislação', 10, NULL, 1);
    INSERT INTO exam_topics VALUES ('tU1', 'dU1', 'Redes', 0), ('tU2', 'dU2', 'Lei 8.112', 0);
    INSERT INTO exam_topic_collections VALUES ('tU1', 'cS'), ('tU2', 'cL');
  `);
}

test('com dois concursos, sem pedido vale o de data mais próxima, como sempre foi', () => {
  const db = newDb();
  seed(db);
  addSecondExam(db);
  const overview = loadFinalStretch(db, 'u1', NOW);
  assert.equal(overview.exam?.id, 'e1');
  assert.deepEqual(overview.disciplines.map((d) => d.id), ['dS', 'dP', 'dI']);
});

test('o concurso escolhido traz o edital dele: disciplinas, pesos, dias, fase e a fila das coleções ligadas a ele', () => {
  const db = newDb();
  seed(db);
  addSecondExam(db);
  many(db, 'l', 'cL', 5, PAST); // vencidos da Legislação, que só o segundo concurso liga
  const first = loadFinalStretch(db, 'u1', NOW);
  const second = loadFinalStretch(db, 'u1', NOW, 'e3');

  assert.equal(second.exam?.id, 'e3');
  assert.equal(second.exam?.daysLeft, 95);
  assert.equal(second.phase, 'content');
  assert.deepEqual(second.disciplines.map((d) => [d.id, d.sharePct]), [['dU1', 75], ['dU2', 25]]);
  assert.ok(second.disciplines.every((d) => d.hasCards));
  assert.deepEqual(second.uncoveredSharePct, 0);

  // Os cartões de cS servem aos dois concursos: aparecem nos dois. cP (só do primeiro) não aparece no segundo; cL (só do segundo), no primeiro.
  const dU1 = second.disciplines.find((d) => d.id === 'dU1')!;
  assert.deepEqual([dU1.cards, dU1.dueCards, dU1.newCards], [10, 4, 6], 'a coleção compartilhada');
  assert.equal(first.disciplines.find((d) => d.id === 'dS')!.cards, 10, 'e no primeiro concurso também');
  assert.equal(second.disciplines.find((d) => d.id === 'dU2')!.dueCards, 5);

  assert.deepEqual([first.queue.due, second.queue.due], [9, 9], 'primeiro: cS 4 + cP 5; segundo: cS 4 + cL 5');
  assert.equal(second.queue.outsideDue, 5 + 3, 'cP e cU ficam fora do edital da UFBA');
  assert.equal(first.queue.outsideDue, 5 + 3, 'cL e cU ficam fora do edital do primeiro');

  const cards = loadFocusCards(db, 'u1', NOW, 'e3');
  assert.ok(cards.every((c) => ['cS', 'cL'].includes(c.collectionId)), 'a sessão traz só cartões do edital escolhido');
  assert.ok(!loadFocusCards(db, 'u1', NOW).some((c) => c.collectionId === 'cL'));
});

test('o pedido que não vale (sem data, passou, de outra conta, inexistente) cai no mais próximo', () => {
  const db = newDb();
  seed(db);
  addSecondExam(db);
  db.exec("INSERT INTO exams VALUES ('sem', 'u1', 'Sem data', NULL), ('velho', 'u1', 'Velho', '2026-01-10')");
  for (const requested of ['sem', 'velho', 'e2', 'nao-existe', '', null, 7]) {
    assert.equal(loadFinalStretch(db, 'u1', NOW, requested).exam?.id, 'e1', String(requested));
  }
  assert.equal(loadFocusCards(db, 'u1', NOW, 'e2').length, loadFocusCards(db, 'u1', NOW).length, 'e2 é de outra conta');
});

test('a fase segue o concurso escolhido, não o mais próximo', () => {
  const db = newDb();
  seed(db);
  addSecondExam(db);
  setExam(db, '2026-10-20'); // o primeiro, a 3 dias: últimos dias
  assert.equal(loadFinalStretch(db, 'u1', NOW).phase, 'last');
  assert.equal(loadFinalStretch(db, 'u1', NOW, 'e3').phase, 'content');
  assert.equal(loadFinalStretch(db, 'u1', NOW, 'e3').queue.new, 6, 'com 95 dias entram novos, mesmo com a outra prova a 3 dias');
});

test('o resumo: concurso, fase, disciplinas em ordem, as sem cartões à parte e a fila só com o que é do edital', () => {
  const db = newDb();
  seed(db);
  const overview = loadFinalStretch(db, 'u1', NOW);

  assert.equal(overview.exam?.id, 'e1');
  assert.equal(overview.exam?.daysLeft, 50);
  assert.equal(overview.phase, 'content');

  // pontos 50 / 10 / 10 → fatias 71%, 14%, 14%; a Língua Inglesa não tem coleção ligada
  assert.deepEqual(overview.disciplines.map((d) => [d.id, d.sharePct, d.hasCards, d.rank]), [
    ['dS', 71, true, 1],
    ['dP', 14, true, 2],
    ['dI', 14, false, null],
  ]);
  assert.equal(overview.uncoveredSharePct, 14);
  assert.deepEqual(overview.focus, ['dS', 'dP']);

  const dS = overview.disciplines[0];
  assert.deepEqual([dS.cards, dS.newCards, dS.dueCards, dS.seenPct], [10, 6, 4, 40]);

  // 4 + 5 vencidos do edital; novos até 15 (só há 6); cU (3 vencidos) fica fora
  assert.deepEqual(overview.queue, {
    total: 15,
    due: 9,
    new: 6,
    limit: null,
    maxCards: MAX_FOCUS_CARDS,
    defaultNew: DEFAULT_FOCUS_NEW,
    waitingDue: 0,
    waitingNew: 0,
    outsideDue: 3,
    outsideNew: 0,
  });

  const cards = loadFocusCards(db, 'u1', NOW);
  assert.equal(cards.length, 15);
  assert.ok(cards.every((c) => c.collectionId === 'cS' || c.collectionId === 'cP'), 'nada de coleção fora do edital');
  assert.ok(cards.find((c) => c.collectionId === 'cS')!.collectionName === 'Específicos');
  assert.equal(cards.find((c) => c.collectionId === 'cS')!.collectionSubject, 'Redes');
});

test('as fases mudam a fila: faltando 7 dias ou menos, nenhum cartão novo entra', () => {
  const db = newDb();
  seed(db);
  const expectations: [string, string, number][] = [
    ['2026-10-25', 'content', 6], // 8 dias
    ['2026-10-24', 'review', 0], // 7 dias
    ['2026-10-21', 'review', 0], // 4 dias
    ['2026-10-20', 'last', 0], // 3 dias
    ['2026-10-17', 'last', 0], // hoje
  ];
  for (const [date, phase, newCards] of expectations) {
    setExam(db, date);
    const { phase: got, queue } = loadFinalStretch(db, 'u1', NOW);
    assert.equal(got, phase, date);
    assert.equal(queue.new, newCards, `${date}: novos`);
    assert.equal(queue.due, 9, `${date}: os vencidos sempre entram`);
    assert.equal(queue.waitingNew, 6 - newCards, `${date}: novos que ficaram para depois`);
  }
});

test('o limite diário de novos vale, descontando o que já foi estudado pela primeira vez hoje', () => {
  const db = newDb();
  seed(db);
  db.prepare("UPDATE users SET daily_new_limit = 4 WHERE id = 'u1'").run();
  assert.equal(loadFinalStretch(db, 'u1', NOW).queue.new, 4);
  assert.equal(loadFinalStretch(db, 'u1', NOW).queue.limit, 4);

  // dois cartões estudados hoje pela primeira vez
  add(db, 'k1', 'cS', FUTURE);
  add(db, 'k2', 'cS', FUTURE);
  review(db, 'k1', 'bom', new Date(2026, 9, 17, 9, 0).toISOString());
  review(db, 'k2', 'bom', new Date(2026, 9, 17, 9, 5).toISOString());
  assert.equal(loadFinalStretch(db, 'u1', NOW).queue.new, 2);

  db.prepare("UPDATE users SET daily_new_limit = 0 WHERE id = 'u1'").run();
  const none = loadFinalStretch(db, 'u1', NOW).queue;
  assert.equal(none.new, 0);
  assert.equal(none.waitingNew, 6);
});

test('sem limite entram até 15 novos', () => {
  const db = newDb();
  many(db, 's', 'cS', 3, PAST);
  many(db, 'sn', 'cS', 40);
  const { queue } = loadFinalStretch(db, 'u1', NOW);
  assert.equal(queue.new, DEFAULT_FOCUS_NEW);
  assert.equal(queue.waitingNew, 25);
});

test('o acerto conta só os últimos 30 dias, e Bom e Fácil são acerto (Errei e Difícil, não)', () => {
  const db = newDb();
  many(db, 's', 'cS', 6, PAST);
  const inWindow = daysAgo(5);
  review(db, 's1', 'bom', inWindow);
  review(db, 's2', 'facil', inWindow);
  review(db, 's3', 'dificil', inWindow);
  review(db, 's4', 'errei', inWindow);
  review(db, 's5', 'errei', daysAgo(STATS_WINDOW_DAYS + 1)); // velha demais
  review(db, 's6', 'bom', daysAgo(STATS_WINDOW_DAYS + 20));
  const dS = loadFinalStretch(db, 'u1', NOW).disciplines.find((d) => d.id === 'dS')!;
  assert.equal(dS.reviews30, 4);
  assert.equal(dS.accuracyPct, 50);
});

test('a disciplina mais fraca recebe mais vagas na fila (a prioridade, não só o peso)', () => {
  const db = newDb();
  // Mesmas fatias (50 contra 10 pontos) mas, com os mesmos cartões e o mesmo acerto, a razão das vagas é a das fatias, 5 para 1.
  many(db, 's', 'cS', 120, PAST);
  many(db, 'p', 'cP', 120, PAST);
  const { queue } = loadFinalStretch(db, 'u1', NOW);
  assert.equal(queue.total, MAX_FOCUS_CARDS);
  assert.equal(queue.due, MAX_FOCUS_CARDS);
  assert.equal(queue.waitingDue, 140);
  const cards = loadFocusCards(db, 'u1', NOW);
  const fromS = cards.filter((c) => c.collectionId === 'cS').length;
  assert.ok(Math.abs(fromS - 83) <= 1, `Específicos deveria ter ~83 das 100 vagas e tem ${fromS}`);
  assert.equal(cards.length - fromS, MAX_FOCUS_CARDS - fromS);

  // Português com acerto péssimo passa a valer mais vagas do que o seu peso sozinho dava
  for (let i = 1; i <= 40; i++) review(db, `p${i}`, 'errei', daysAgo(2));
  for (let i = 1; i <= 40; i++) review(db, `s${i}`, 'facil', daysAgo(2));
  const after = loadFocusCards(db, 'u1', NOW);
  const fromP = after.filter((c) => c.collectionId === 'cP').length;
  assert.ok(fromP > 100 - fromS, `Português deveria ganhar vagas (${fromP} contra ${100 - fromS} antes)`);
});

test('cada conta vê só a sua: cartões, concurso e coleções de outra conta não entram', () => {
  const db = newDb();
  seed(db);
  many(db, 'x', 'cX', 5, PAST);
  db.prepare("INSERT INTO exam_topic_collections VALUES ('tS', 'cX')").run(); // coleção de u2 ligada ao concurso de u1
  const mine = computeFinalStretch(db, 'u1', NOW);
  assert.equal(mine.overview.queue.due, 9);
  assert.ok(![...mine.dueIds, ...mine.newIds].some((id) => id.startsWith('x')));

  // u2 tem concurso, mas sem disciplinas: a reta final existe e está vazia, sem erro
  const theirs = loadFinalStretch(db, 'u2', NOW);
  assert.equal(theirs.exam?.id, 'e2');
  assert.deepEqual(theirs.disciplines, []);
  assert.equal(theirs.queue.total, 0);
  assert.deepEqual(loadFocusCards(db, 'u2', NOW), []);
});

test('é só leitura: nenhuma tabela muda ao calcular a reta final nem ao montar a fila', () => {
  const db = newDb();
  seed(db);
  review(db, 's1', 'bom', daysAgo(2));
  const snapshot = () => ({
    cards: db.prepare('SELECT * FROM flashcards ORDER BY id').all(),
    sessions: db.prepare('SELECT * FROM study_sessions ORDER BY id').all(),
    users: db.prepare('SELECT * FROM users ORDER BY id').all(),
  });
  const before = JSON.stringify(snapshot());
  loadFinalStretch(db, 'u1', NOW);
  loadFocusCards(db, 'u1', NOW);
  assert.equal(JSON.stringify(snapshot()), before);
});

test('as primeiras disciplinas do foco são no máximo 3', () => {
  assert.equal(FOCUS_TOP, 3);
});

// ---------- a cobertura do edital ----------

test('coverageFactor: a fração dos tópicos com cartão; sem tópicos cadastrados nada é descontado', () => {
  assert.equal(coverageFactor(10, 5), 0.5);
  assert.equal(coverageFactor(10, 0), 0);
  assert.equal(coverageFactor(10, 10), 1);
  assert.equal(coverageFactor(10, 14), 1, 'nunca passa de 100%');
  assert.equal(coverageFactor(0, 0), 1, 'edital sem tópicos');
  assert.equal(coverageFactor(undefined, undefined), 1, 'dado ausente não desconta');
  assert.equal(coverageFactor(10, undefined), 0);
});

test('prioridade: o domínio é descontado pela cobertura do edital, e a disciplina mal coberta sobe na ordem', () => {
  // Mesmos cartões, todos vistos, mesmo acerto (sem revisões: 60%); só a cobertura difere.
  const base = { cards: 12, newCards: 0, reviews: 0, hits: 0 };
  const ranked = rankDisciplines([
    stats({ id: 'inteira', points: 10, ...base, topics: 4, coveredTopics: 4 }),
    stats({ id: 'metade', points: 10, ...base, topics: 4, coveredTopics: 2 }),
    stats({ id: 'sem-edital', points: 10, ...base }),
  ]);
  const by = Object.fromEntries(ranked.map((d) => [d.id, d]));
  assert.equal(by.inteira.masteryPct, 60, 'cobertura total: o domínio de sempre (100% visto × 60%)');
  assert.equal(by.metade.masteryPct, 30, 'metade dos tópicos sem cartão: o domínio cai à metade');
  assert.equal(by['sem-edital'].masteryPct, 60, 'sem tópicos cadastrados não há desconto');
  assert.ok(by.metade.gainPct > by.inteira.gainPct, 'a mal coberta tem mais prova em aberto');
  assert.equal(ranked[0].id, 'metade', 'e vem primeiro na ordem');
  assert.deepEqual([by.metade.topics, by.metade.coveredTopics, by.metade.coveragePct], [4, 2, 50]);
  assert.deepEqual([by['sem-edital'].topics, by['sem-edital'].coveredTopics, by['sem-edital'].coveragePct], [0, 0, null]);
});

test('prioridade: sem os campos da cobertura o resultado é o de antes (nada muda para quem não tem tópicos)', () => {
  const ranked = rankDisciplines([stats({ id: 'A', points: 50, cards: 10, newCards: 0, reviews: 20, hits: 10 })]);
  assert.equal(ranked[0].masteryPct, 52);
  assert.equal(ranked[0].gainPct, 48);
});

test('cobertura com o banco: conta os tópicos com cartão por disciplina, e coleção congelada não cobre', () => {
  const db = newDb();
  seed(db);
  const before = loadFinalStretch(db, 'u1', NOW);
  const dSBefore = before.disciplines.find((d) => d.id === 'dS')!;
  assert.deepEqual([dSBefore.topics, dSBefore.coveredTopics, dSBefore.coveragePct], [1, 1, 100]);
  assert.deepEqual([before.topics, before.coveredTopics], [3, 2], 'Redes e Concordância têm cartão; Reading não');

  // Um segundo tópico de Específicos, sem coleção ligada: a cobertura da disciplina cai a 50% e o domínio com ela.
  db.exec("INSERT INTO exam_topics VALUES ('tS2', 'dS', 'Sistemas distribuídos', 1)");
  const half = loadFinalStretch(db, 'u1', NOW);
  const dS = half.disciplines.find((d) => d.id === 'dS')!;
  assert.deepEqual([dS.topics, dS.coveredTopics, dS.coveragePct], [2, 1, 50]);
  assert.ok(Math.abs(dS.masteryPct! - dSBefore.masteryPct! / 2) <= 1, `${dSBefore.masteryPct}% → ${dS.masteryPct}%`);
  assert.ok(dS.gainPct > dSBefore.gainPct);
  assert.deepEqual([half.topics, half.coveredTopics], [4, 2]);

  // Congelar a coleção de Específicos: o único tópico com cartão deixa de ter, como o resto da reta final a trata.
  setCollectionFrozen(db, 'cS', true);
  const frozen = loadFinalStretch(db, 'u1', NOW);
  assert.equal(frozen.disciplines.find((d) => d.id === 'dS')!.coveredTopics, 0);
  assert.equal(frozen.coveredTopics, 1);
});

test('cobertura: tópico ligado a uma coleção vazia ou de outra conta não conta como coberto', () => {
  const db = newDb();
  seed(db);
  db.exec(`
    INSERT INTO collections (id, user_id, name, subject) VALUES ('cVazia', 'u1', 'Vazia', '');
    INSERT INTO exam_topics VALUES ('tV', 'dI', 'Writing', 1), ('tX', 'dI', 'Listening', 2);
    INSERT INTO exam_topic_collections VALUES ('tV', 'cVazia'), ('tX', 'cX');
  `);
  const dI = loadFinalStretch(db, 'u1', NOW).disciplines.find((d) => d.id === 'dI')!;
  assert.deepEqual([dI.topics, dI.coveredTopics], [3, 0], 'sem cartão numa coleção vazia e com a coleção de outra conta, ninguém cobre');
});
