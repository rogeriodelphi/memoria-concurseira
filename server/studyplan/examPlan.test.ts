import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  buildExamPlan,
  FINAL_REVIEW_DAYS,
  LAPSE_MARGIN,
  loadExamPlan,
  PACE_WINDOW_DAYS,
  simulateWorkload,
  suggestLimit,
  type ExamPlan,
  type PlanInput,
  type SimCard,
} from './examPlan';

const card = (dueInDays: number, extra: Partial<SimCard> = {}): SimCard => ({
  easeFactor: 2.5,
  intervalDays: 10,
  repetitions: 5,
  dueInDays,
  ...extra,
});

// ---------- simulação ----------

test('simulação: sem dias, nada a fazer', () => {
  assert.deepEqual(simulateWorkload({ days: 0, newDays: 0, newCards: 50, newPerDay: 5, learned: [card(0)] }), { perDay: [], newPerDay: [] });
});

test('simulação: um cartão novo volta no dia seguinte e depois só daqui a 6 dias', () => {
  const sim = simulateWorkload({ days: 3, newDays: 3, newCards: 1, newPerDay: 1, learned: [] });
  assert.deepEqual(sim.perDay, [1, 1, 0], 'aprendido no dia 0, revisado no dia 1; a revisão do dia 7 fica depois da prova');
  assert.deepEqual(sim.newPerDay, [1, 0, 0]);
});

test('simulação: um cartão aprendido hoje é revisado nos dias 1, 7 e 22 (intervalos 1, 6 e 15 do algoritmo)', () => {
  const sim = simulateWorkload({ days: 30, newDays: 30, newCards: 1, newPerDay: 1, learned: [] });
  const busy = sim.perDay.map((n, day) => (n > 0 ? day : -1)).filter((day) => day >= 0);
  assert.deepEqual(busy, [0, 1, 7, 22], 'o quinto intervalo (38 dias) já passa da prova');
  assert.ok(sim.perDay.every((n) => n <= 1));
});

test('simulação: cartões novos param ao fim dos dias de novos, mesmo havendo mais', () => {
  const sim = simulateWorkload({ days: 10, newDays: 3, newCards: 100, newPerDay: 2, learned: [] });
  assert.deepEqual(sim.newPerDay, [2, 2, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sim.perDay[3], 2, 'no dia 3 só as revisões dos 2 do dia 2: nenhum novo');
});

test('simulação: o último dia de novos leva só o que sobrou', () => {
  const sim = simulateWorkload({ days: 5, newDays: 5, newCards: 3, newPerDay: 2, learned: [] });
  assert.deepEqual(sim.newPerDay, [2, 1, 0, 0, 0]);
});

test('simulação: os vencidos são recuperados ao longo de uma semana, e não todos no primeiro dia', () => {
  // 14 vencidos, cada um com intervalo grande: depois de revisados, só voltam depois da prova.
  const overdue = Array.from({ length: 14 }, () => card(-3));
  const sim = simulateWorkload({ days: 10, newDays: 0, newCards: 0, newPerDay: 0, learned: overdue });
  assert.deepEqual(sim.perDay, [2, 2, 2, 2, 2, 2, 2, 0, 0, 0]);
});

test('simulação: o que vence hoje conta com os vencidos; o que vence mais adiante cai no seu dia', () => {
  const sim = simulateWorkload({ days: 6, newDays: 0, newCards: 0, newPerDay: 0, learned: [card(0), card(4), card(4), card(99)] });
  assert.deepEqual(sim.perDay, [1, 0, 0, 0, 2, 0], 'o que vence depois da prova não entra');
});

test('simulação: com poucos dias, a recuperação cabe neles', () => {
  const sim = simulateWorkload({ days: 2, newDays: 0, newCards: 0, newPerDay: 0, learned: [card(-1), card(-1), card(-1)] });
  assert.deepEqual(sim.perDay, [2, 1]);
});

test('simulação: mais cartões novos por dia nunca dá menos trabalho', () => {
  const learned = Array.from({ length: 40 }, (_, i) => card(i % 10 === 0 ? -2 : (i % 9) + 1, { intervalDays: 3, repetitions: 2 }));
  let previous = -1;
  for (const limit of [0, 3, 6, 12, 25, 50]) {
    const total = simulateWorkload({ days: 40, newDays: 33, newCards: 600, newPerDay: limit, learned }).perDay.reduce((a, b) => a + b, 0);
    assert.ok(total >= previous, `limite ${limit}: ${total} < ${previous}`);
    previous = total;
  }
});

test('limite sugerido: arredonda para cima de 5 em 5 e respeita o teto do app', () => {
  assert.equal(suggestLimit(22), 25);
  assert.equal(suggestLimit(25), 25);
  assert.equal(suggestLimit(26), 30);
  assert.equal(suggestLimit(1), 5);
  assert.equal(suggestLimit(5000), 1000);
});

// ---------- o plano ----------

const EXAM = { id: 'e1', name: 'Concurso', examDate: '2026-12-06', daysLeft: 50 };
const PACE = { windowDays: PACE_WINDOW_DAYS, reviewsPerDay: 20, newPerDay: 10, activeDays: 8, secPerReview: 30 };

function plan(overrides: Omit<Partial<PlanInput>, 'pace'> & { pace?: Partial<PlanInput['pace']>; daysLeft?: number } = {}): ExamPlan {
  const { pace, daysLeft, ...rest } = overrides;
  return buildExamPlan({
    exam: { ...EXAM, daysLeft: daysLeft ?? EXAM.daysLeft },
    newCount: 900,
    learned: [],
    currentLimit: null,
    pace: { ...PACE, ...pace },
    ...rest,
  });
}

test('plano: os últimos dias ficam só para revisão; o resto é de cartões novos', () => {
  const cases: [number, number, number][] = [
    [50, FINAL_REVIEW_DAYS, 43],
    [21, 7, 14],
    [9, 3, 6],
    [4, 1, 3],
    [3, 3, 0], // faltando 3 dias ou menos, só se revisa
    [2, 2, 0],
    [1, 1, 0],
  ];
  for (const [daysLeft, finalReview, newDays] of cases) {
    const p = plan({ daysLeft });
    assert.equal(p.finalReviewDays, finalReview, `${daysLeft} dias`);
    assert.equal(p.newDays, newDays, `${daysLeft} dias`);
  }
});

test('plano: quantos novos por dia para ver todos, e o cenário "ver todos" usa o limite sugerido', () => {
  const p = plan({ newCount: 912 });
  assert.equal(p.neededNewPerDay, 22, '912 em 43 dias');
  const all = p.scenarios.at(-1)!;
  assert.equal(all.kind, 'all');
  assert.equal(all.newPerDay, 25);
  assert.equal(all.newSeen, 912);
  assert.equal(all.coveragePct, 100);
});

test('plano: os cenários vão do mais enxuto ao mais completo, sem repetir, e o custo só cresce', () => {
  const p = plan({ newCount: 900, learned: Array.from({ length: 100 }, (_, i) => card(i % 3 === 0 ? -1 : (i % 12) + 1, { intervalDays: 4, repetitions: 2 })) });
  assert.equal(p.scenarios[0].kind, 'current');
  assert.equal(p.scenarios.at(-1)!.kind, 'all');
  const limits = p.scenarios.map((s) => s.newPerDay);
  assert.deepEqual([...limits].sort((a, b) => a - b), limits, 'ordenados');
  assert.equal(new Set(limits).size, limits.length, 'sem repetir limite');
  for (let i = 1; i < p.scenarios.length; i++) {
    assert.ok(p.scenarios[i].coveragePct >= p.scenarios[i - 1].coveragePct);
    assert.ok(p.scenarios[i].minutesPerDay >= p.scenarios[i - 1].minutesPerDay);
  }
  assert.ok(p.scenarios.length <= 4, 'ritmo atual, no máximo dois tempos e "ver todos"');
});

test('plano: os minutos vêm do tempo por cartão do usuário, com a margem para erros; sem medida, usa 30 s', () => {
  const measured = plan({ pace: { secPerReview: 60 } }).scenarios.at(-1)!;
  assert.ok(Math.abs(measured.minutesPerDay - (measured.cardsPerDay * 60 * LAPSE_MARGIN) / 60) < 1e-9);
  const fallback = plan({ pace: { secPerReview: null } }).scenarios.at(-1)!;
  assert.ok(Math.abs(fallback.minutesPerDay - (fallback.cardsPerDay * 30 * LAPSE_MARGIN) / 60) < 1e-9);
});

test('plano: o ritmo atual define o primeiro cenário: quanto mais o usuário estuda, mais novos cabem', () => {
  const slow = plan({ pace: { reviewsPerDay: 5 } }).scenarios[0];
  const fast = plan({ pace: { reviewsPerDay: 60 } }).scenarios[0];
  assert.equal(slow.kind, 'current');
  assert.ok(fast.newPerDay > slow.newPerDay);
  assert.ok(fast.coveragePct > slow.coveragePct);
});

test('plano: o veredito vai de "atrasado" a "apertado" e a "no ritmo" conforme o ritmo cresce', () => {
  const seen: string[] = [];
  for (let reviewsPerDay = 1; reviewsPerDay <= 200; reviewsPerDay++) {
    seen.push(plan({ newCount: 230, daysLeft: 30, pace: { reviewsPerDay } }).verdict);
  }
  const order = ['behind', 'tight', 'on_track'];
  const ranks = seen.map((verdict) => order.indexOf(verdict));
  assert.ok(ranks.every((rank) => rank >= 0), 'só esses três com ritmo e cartões novos');
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, 'nunca piora quando o ritmo melhora');
  assert.deepEqual(new Set(seen), new Set(order), 'passa pelos três');
});

test('plano: se o ritmo atual já cobre tudo, "ver todos" não repete o mesmo cenário', () => {
  const p = plan({ newCount: 20, daysLeft: 30, pace: { reviewsPerDay: 80 } });
  assert.equal(p.verdict, 'on_track');
  assert.equal(p.scenarios.length, 1);
  assert.equal(p.scenarios[0].kind, 'current');
  assert.equal(p.scenarios[0].coveragePct, 100);
});

test('plano: sem estudo recente não dá para julgar o ritmo (mas os cenários de tempo continuam)', () => {
  const p = plan({ pace: { reviewsPerDay: 0, activeDays: 0, newPerDay: 0 } });
  assert.equal(p.verdict, 'no_pace');
  assert.ok(!p.scenarios.some((s) => s.kind === 'current'));
  assert.equal(p.scenarios.at(-1)!.kind, 'all');
});

test('plano: sem cartões novos, está em dia, e a carga é só de revisões', () => {
  const p = plan({ newCount: 0, learned: [card(2), card(5)] });
  assert.equal(p.verdict, 'on_track');
  assert.equal(p.neededNewPerDay, null);
  assert.equal(p.scenarios.length, 1);
  assert.equal(p.scenarios[0].newPerDay, 0);
  assert.equal(p.scenarios[0].perDay[2], 1);
});

test('plano: na reta final (sem dias para cartões novos) só se revisa; no dia da prova não há nada a planejar', () => {
  const last = plan({ daysLeft: 3, newCount: 100 });
  assert.equal(last.verdict, 'last_days');
  assert.equal(last.neededNewPerDay, null);
  assert.equal(last.scenarios[0].newSeen, 0);

  const today = plan({ daysLeft: 0 });
  assert.equal(today.verdict, 'exam_today');
  assert.deepEqual(today.scenarios, []);
});

test('plano: o que está na tela de contagens vem dos cartões', () => {
  const p = plan({ newCount: 7, learned: [card(-5), card(0), card(1), card(30)], currentLimit: 15 });
  assert.deepEqual(p.cards, { new: 7, due: 2, learned: 4 });
  assert.equal(p.currentLimit, 15);
});

test('plano: uma prova muito distante não trava (a simulação tem teto)', () => {
  const p = plan({ daysLeft: 5000 });
  assert.ok(p.scenarios.length > 0);
  assert.ok(p.scenarios.every((s) => s.perDay.length <= 400));
});

// ---------- leitura do banco ----------

// 17/10/2026, 15:00 no horário local do computador que roda o teste: a prova (06/12) fica a 50 dias.
const NOW = new Date(2026, 9, 17, 15, 0, 0);
const at = (dayOffset: number, hour = 10) => new Date(2026, 9, 17 + dayOffset, hour, 0, 0).toISOString();

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, daily_new_limit INTEGER);
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, ease_factor REAL NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 0, repetitions INTEGER NOT NULL DEFAULT 0, due_at TEXT
    );
    CREATE TABLE study_sessions (
      id TEXT PRIMARY KEY, flashcard_id TEXT NOT NULL, user_id TEXT NOT NULL, result TEXT NOT NULL,
      studied_at TEXT NOT NULL, duration_ms INTEGER
    );
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, exam_date TEXT);
    INSERT INTO users VALUES ('u1', NULL), ('u2', NULL);
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes'), ('c2', 'u2', 'Alheia');
  `);
  return db;
}

let counter = 0;
const addCard = (db: DatabaseSync, dueAt: string | null, collection = 'c1', extra: { interval?: number; reps?: number } = {}) => {
  const id = `f${++counter}`;
  db.prepare('INSERT INTO flashcards (id, collection_id, interval_days, repetitions, due_at) VALUES (?, ?, ?, ?, ?)').run(id, collection, extra.interval ?? 0, extra.reps ?? 0, dueAt);
  return id;
};
const addReview = (db: DatabaseSync, cardId: string, studiedAt: string, durationMs: number | null = 30_000, user = 'u1') =>
  db.prepare('INSERT INTO study_sessions (id, flashcard_id, user_id, result, studied_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?)').run(`s${++counter}`, cardId, user, 'bom', studiedAt, durationMs);
const addExam = (db: DatabaseSync, id: string, date: string | null, user = 'u1') => db.prepare('INSERT INTO exams VALUES (?, ?, ?, ?)').run(id, user, `Prova ${id}`, date);

test('carregador: sem concurso com data futura não há plano', () => {
  const db = newDb();
  assert.equal(loadExamPlan(db, 'u1', NOW), null, 'nenhum concurso');
  addExam(db, 'sem-data', null);
  addExam(db, 'passado', '2026-10-16');
  addExam(db, 'alheio', '2026-12-06', 'u2');
  assert.equal(loadExamPlan(db, 'u1', NOW), null, 'sem data, já passou, ou é de outra conta');
});

test('carregador: usa o concurso mais próximo que ainda não passou; o de hoje conta', () => {
  const db = newDb();
  addExam(db, 'longe', '2027-03-01');
  addExam(db, 'perto', '2026-12-06');
  addExam(db, 'ontem', '2026-10-16');
  const p = loadExamPlan(db, 'u1', NOW)!;
  assert.equal(p.exam.id, 'perto');
  assert.equal(p.exam.daysLeft, 50);

  addExam(db, 'hoje', '2026-10-17');
  assert.equal(loadExamPlan(db, 'u1', NOW)!.exam.id, 'hoje');
  assert.equal(loadExamPlan(db, 'u1', NOW)!.verdict, 'exam_today');
});

test('carregador: separa cartões novos, vencidos e estudados, só os da própria conta', () => {
  const db = newDb();
  addExam(db, 'p', '2026-12-06');
  addCard(db, null);
  addCard(db, null);
  addCard(db, at(-5), 'c1', { interval: 3, reps: 2 }); // atrasado
  addCard(db, at(0, 9), 'c1', { interval: 3, reps: 2 }); // vence hoje
  addCard(db, at(3), 'c1', { interval: 6, reps: 2 }); // vence em 3 dias
  addCard(db, null, 'c2'); // de outra conta
  addCard(db, at(-1), 'c2');
  const p = loadExamPlan(db, 'u1', NOW)!;
  assert.deepEqual(p.cards, { new: 2, due: 2, learned: 3 });
});

test('carregador: o ritmo conta os últimos 14 dias, com os dias sem estudo, e distingue novo de revisão', () => {
  const db = newDb();
  addExam(db, 'p', '2026-12-06');
  const a = addCard(db, at(1), 'c1', { interval: 1, reps: 1 });
  const b = addCard(db, at(1), 'c1', { interval: 1, reps: 1 });
  const veteran = addCard(db, at(5), 'c1', { interval: 20, reps: 4 });
  // Um cartão visto pela primeira vez há 20 dias (fora da janela), revisado hoje: não é "novo" na janela.
  addReview(db, veteran, at(-20));
  addReview(db, veteran, at(0, 9));
  // Dois cartões vistos pela primeira vez na janela; um deles revisado de novo no mesmo período.
  addReview(db, a, at(-2));
  addReview(db, a, at(-1));
  addReview(db, b, at(0, 8));
  // Outra conta não conta.
  addReview(db, addCard(db, at(1), 'c2'), at(0), 30_000, 'u2');

  const p = loadExamPlan(db, 'u1', NOW)!;
  assert.equal(p.pace.windowDays, 14);
  assert.equal(p.pace.reviewsPerDay, 4 / 14, 'quatro revisões na janela (a de há 20 dias fica de fora)');
  assert.equal(p.pace.newPerDay, 2 / 14, 'a e b foram vistos pela primeira vez na janela; veteran não');
  assert.equal(p.pace.activeDays, 3, 'hoje, ontem e anteontem');
});

test('carregador: o tempo por cartão vem das revisões medidas e o limite diário é o configurado', () => {
  const db = newDb();
  addExam(db, 'p', '2026-12-06');
  db.prepare("UPDATE users SET daily_new_limit = 12 WHERE id = 'u1'").run();
  const c = addCard(db, at(1), 'c1', { interval: 1, reps: 1 });
  addReview(db, c, at(-3), 20_000);
  addReview(db, c, at(-2), 40_000);
  const p = loadExamPlan(db, 'u1', NOW)!;
  assert.equal(p.pace.secPerReview, 30, 'média de 20 s e 40 s');
  assert.equal(p.currentLimit, 12);
});

test('carregador: conta sem nenhum estudo recente fica "sem ritmo", não quebra', () => {
  const db = newDb();
  addExam(db, 'p', '2026-12-06');
  for (let i = 0; i < 30; i++) addCard(db, null);
  const p = loadExamPlan(db, 'u1', NOW)!;
  assert.equal(p.verdict, 'no_pace');
  assert.equal(p.pace.secPerReview, null);
  assert.equal(p.pace.reviewsPerDay, 0);
  assert.equal(p.cards.new, 30);
});
