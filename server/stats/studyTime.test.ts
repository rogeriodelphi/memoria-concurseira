import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { MAX_REVIEW_MS } from './dashboard';
import { type PerformanceQuery } from './performance';
import { insideAny, loadStudyTime, mergeIntervals, NO_DISCIPLINE_LABEL, OUT_OF_SYLLABUS_LABEL, reviewTimes } from './studyTime';

const NOW = new Date(2026, 9, 17, 15, 0, 0);
const at = (daysAgo: number, hour = 10, minute = 0, second = 0) => new Date(2026, 9, 17 - daysAgo, hour, minute, second).toISOString();
const query = (extra: Partial<PerformanceQuery> = {}): PerformanceQuery => ({ days: 7, range: null, scope: 'all', name: null, subject: null, ...extra });

interface Seed {
  collections?: { id: string; user?: string; name: string; subject: string }[];
  cards?: { id: string; collection: string }[];
  /** `ms` = tempo medido (null/omitido = sem medição). */
  sessions?: { card: string; result?: string; when: string; ms?: number | null; user?: string }[];
  tasks?: { discipline: string; subject?: string; sec: number; start: string; end?: string; user?: string }[];
  exams?: { id: string; user?: string; name: string; date?: string | null; created?: string; disciplines: { id: string; name: string; questions?: number | null; weight?: number | null; collections?: string[] }[] }[];
}

function build(seed: Seed): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '');
    CREATE TABLE flashcards (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE);
    CREATE TABLE study_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, flashcard_id TEXT NOT NULL, user_id TEXT NOT NULL, result TEXT NOT NULL, studied_at TEXT NOT NULL, duration_ms INTEGER);
    CREATE TABLE pomodoro_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'simples', phase TEXT NOT NULL DEFAULT 'producao', discipline TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', duration_sec INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, exam_date TEXT, created_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE exam_disciplines (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, name TEXT NOT NULL, question_count INTEGER, weight REAL, position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE exam_topics (id TEXT PRIMARY KEY, discipline_id TEXT NOT NULL, title TEXT NOT NULL);
    CREATE TABLE exam_topic_collections (topic_id TEXT NOT NULL, collection_id TEXT NOT NULL);
  `);
  for (const c of seed.collections ?? []) db.prepare('INSERT INTO collections (id, user_id, name, subject) VALUES (?, ?, ?, ?)').run(c.id, c.user ?? 'u1', c.name, c.subject);
  for (const f of seed.cards ?? []) db.prepare('INSERT INTO flashcards (id, collection_id) VALUES (?, ?)').run(f.id, f.collection);
  for (const s of seed.sessions ?? []) db.prepare('INSERT INTO study_sessions (flashcard_id, user_id, result, studied_at, duration_ms) VALUES (?, ?, ?, ?, ?)').run(s.card, s.user ?? 'u1', s.result ?? 'bom', s.when, s.ms ?? null);
  for (const t of seed.tasks ?? []) {
    const end = t.end ?? new Date(Date.parse(t.start) + t.sec * 1000).toISOString();
    db.prepare('INSERT INTO pomodoro_tasks (user_id, discipline, subject, duration_sec, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)').run(t.user ?? 'u1', t.discipline, t.subject ?? '', t.sec, t.start, end);
  }
  for (const e of seed.exams ?? []) {
    db.prepare('INSERT INTO exams (id, user_id, name, exam_date, created_at) VALUES (?, ?, ?, ?, ?)').run(e.id, e.user ?? 'u1', e.name, e.date ?? null, e.created ?? '2026-01-01');
    e.disciplines.forEach((d, i) => {
      db.prepare('INSERT INTO exam_disciplines (id, exam_id, name, question_count, weight, position) VALUES (?, ?, ?, ?, ?, ?)').run(d.id, e.id, d.name, d.questions ?? null, d.weight ?? null, i);
      db.prepare('INSERT INTO exam_topics (id, discipline_id, title) VALUES (?, ?, ?)').run(`t-${d.id}`, d.id, 'Tópico');
      for (const c of d.collections ?? []) db.prepare('INSERT INTO exam_topic_collections (topic_id, collection_id) VALUES (?, ?)').run(`t-${d.id}`, c);
    });
  }
  return db;
}

// ---------- tempo de cada revisão ----------

const T0 = Date.parse('2026-10-17T10:00:00Z');
test('tempo da revisão: o medido (com teto), o intervalo plausível até a anterior, ou a mediana', () => {
  const times = reviewTimes([
    { at: T0, durationMs: 10_000 }, // medido
    { at: T0 + 30_000, durationMs: null }, // 30 s depois da anterior: estimado pelo intervalo
    { at: T0 + 30_500, durationMs: null }, // 0,5 s: implausível (menos de 1 s)
    { at: T0 + 30_500 + 10 * 60_000, durationMs: null }, // 10 min: pausa, não estudo
    { at: T0 + 40 * 60_000, durationMs: 900_000 }, // medido absurdo: vai ao teto
  ]);
  const observed = [10_000, 30_000, MAX_REVIEW_MS]; // o que serviu de base: mediana = 30 000
  assert.deepEqual(times.map((t) => t.time), [10_000, 30_000, 30_000, 30_000, MAX_REVIEW_MS]);
  assert.deepEqual(times.map((t) => t.estimated), [false, true, true, true, false]);
  assert.equal(observed.length, 3);
});

test('tempo da revisão: a primeira sem medida usa a mediana; sem nada observado, 20 s', () => {
  assert.deepEqual(reviewTimes([{ at: T0, durationMs: null }]).map((t) => t.time), [20_000]);
  assert.deepEqual(reviewTimes([]), []);
  const first = reviewTimes([{ at: T0, durationMs: null }, { at: T0 + 10_000, durationMs: 40_000 }]);
  assert.equal(first[0].time, 40_000, 'a mediana do que foi observado (só o 40 s)');
});

// ---------- intervalos dos Pomodoros ----------

test('intervalos: os que se tocam viram um, e os limites contam como dentro', () => {
  const merged = mergeIntervals([
    { startedAt: '2026-10-17T10:00:00Z', endedAt: '2026-10-17T10:25:00Z' },
    { startedAt: '2026-10-17T10:20:00Z', endedAt: '2026-10-17T10:50:00Z' }, // sobrepõe
    { startedAt: '2026-10-17T12:00:00Z', endedAt: '2026-10-17T12:25:00Z' },
    { startedAt: 'lixo', endedAt: '2026-10-17T12:25:00Z' }, // ignorado
    { startedAt: '2026-10-17T13:00:00Z', endedAt: '2026-10-17T12:00:00Z' }, // fim antes do começo: ignorado
  ]);
  assert.equal(merged.length, 2);
  const ms = (iso: string) => Date.parse(iso);
  assert.equal(insideAny(merged, ms('2026-10-17T10:00:00Z')), true, 'exatamente o começo');
  assert.equal(insideAny(merged, ms('2026-10-17T10:50:00Z')), true, 'exatamente o fim');
  assert.equal(insideAny(merged, ms('2026-10-17T10:35:00Z')), true, 'no trecho fundido');
  assert.equal(insideAny(merged, ms('2026-10-17T09:59:59Z')), false);
  assert.equal(insideAny(merged, ms('2026-10-17T10:50:01Z')), false);
  assert.equal(insideAny(merged, ms('2026-10-17T11:30:00Z')), false, 'entre os dois');
  assert.equal(insideAny(merged, ms('2026-10-17T12:25:00Z')), true);
  assert.equal(insideAny([], 5), false);
});

test('intervalos: a busca confere com a conta de força bruta, em qualquer ordem de entrada', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 50; round++) {
    const tasks = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => {
      const start = Math.floor(rnd() * 1000);
      return { startedAt: new Date(start * 60_000).toISOString(), endedAt: new Date((start + Math.floor(rnd() * 60)) * 60_000).toISOString() };
    });
    const merged = mergeIntervals(tasks);
    for (let probe = 0; probe < 60; probe++) {
      const t = Math.floor(rnd() * 1100) * 60_000;
      const brute = tasks.some((x) => t >= Date.parse(x.startedAt) && t <= Date.parse(x.endedAt));
      assert.equal(insideAny(merged, t), brute);
    }
  }
});

// ---------- as fontes ----------

const BASE: Seed = {
  collections: [
    { id: 'c1', name: 'Redes', subject: 'DNS' },
    { id: 'c2', name: 'Redes', subject: 'Wi-Fi' },
    { id: 'c3', name: 'Direito', subject: '' },
  ],
  cards: [['f1', 'c1'], ['f2', 'c2'], ['f3', 'c3']].map(([id, collection]) => ({ id, collection })),
};

test('só cartões: o tempo medido soma por nome, com os assuntos, e o tempo estimado é contado à parte', () => {
  const db = build({
    ...BASE,
    sessions: [
      { card: 'f1', when: at(0, 9, 0, 0), ms: 20_000 },
      { card: 'f1', when: at(0, 9, 1, 0), ms: 40_000 },
      { card: 'f2', when: at(0, 9, 1, 30), ms: null }, // 30 s depois da anterior: estimado em 30 s
      { card: 'f3', when: at(1, 9, 0, 0), ms: 60_000 },
    ],
  });
  const r = loadStudyTime(db, 'u1', NOW, query());
  assert.deepEqual([r.totals.cardSec, r.totals.pomodoroSec, r.totals.totalSec, r.totals.reviews, r.totals.estimatedReviews], [150, 0, 150, 4, 1]);
  assert.deepEqual(r.byName.map((n) => [n.label, n.cardSec, n.pomodoroSec, n.reviews]), [['Redes', 90, 0, 3], ['Direito', 60, 0, 1]]);
  assert.deepEqual(r.byName[0].subjects.map((s) => [s.label, s.sec]), [['DNS', 60], ['Wi-Fi', 30]]);
  assert.deepEqual(r.byName[1].subjects.map((s) => [s.label, s.sec]), [['Sem assunto', 60]]);
  assert.equal(r.byDiscipline, null, 'sem concurso não há linhas do edital');
});

test('só Pomodoro: o tempo vai para a disciplina digitada (sem diferenciar maiúsculas e acentos), com o assunto', () => {
  const db = build({
    tasks: [
      { discipline: 'Língua Portuguesa', subject: 'Crase', sec: 1500, start: at(1, 9) },
      { discipline: 'Língua Portuguesa', subject: 'Crase', sec: 1500, start: at(2, 9) },
      { discipline: 'LINGUA portuguesa', subject: '', sec: 600, start: at(3, 9) },
      { discipline: '', subject: 'Solto', sec: 300, start: at(3, 15) },
    ],
  });
  const r = loadStudyTime(db, 'u1', NOW, query());
  assert.deepEqual([r.totals.pomodoroSec, r.totals.cardSec, r.totals.tasks], [3900, 0, 4]);
  assert.deepEqual(r.byName.map((n) => [n.label, n.pomodoroSec, n.tasks]), [['Língua Portuguesa', 3600, 3], [NO_DISCIPLINE_LABEL, 300, 1]]);
  assert.deepEqual(r.byName[0].subjects.map((s) => [s.label, s.sec]), [['Crase', 3000], ['Sem assunto', 600]]);
  assert.equal(r.byName[0].accuracyPct, null, 'sem cartões, sem acerto');
});

test('as duas fontes no mesmo nome: o Pomodoro "Redes" e a coleção "Redes" são uma linha só, com as duas colunas', () => {
  const db = build({
    ...BASE,
    sessions: [{ card: 'f1', when: at(1, 9), ms: 30_000 }],
    tasks: [{ discipline: 'redes', sec: 1500, start: at(2, 9) }],
  });
  const r = loadStudyTime(db, 'u1', NOW, query());
  assert.deepEqual(r.byName.map((n) => [n.label, n.pomodoroSec, n.cardSec, n.totalSec]), [['Redes', 1500, 30, 1530]], 'no empate de grafia, a que começa com maiúscula');
});

// ---------- sem contar em dobro ----------

test('uma revisão feita DENTRO de um Pomodoro já está no tempo dele: não soma de novo, e o acerto continua contando', () => {
  const db = build({
    ...BASE,
    sessions: [
      { card: 'f1', when: at(1, 9, 10), ms: 30_000, result: 'bom' }, // dentro do Pomodoro (09:00 a 09:25)
      { card: 'f1', when: at(1, 9, 20), ms: 30_000, result: 'errei' }, // dentro
      { card: 'f1', when: at(1, 10, 0), ms: 30_000, result: 'facil' }, // fora
    ],
    tasks: [{ discipline: 'Português', sec: 1500, start: at(1, 9, 0) }],
  });
  const r = loadStudyTime(db, 'u1', NOW, query());
  assert.deepEqual([r.totals.pomodoroSec, r.totals.cardSec, r.totals.totalSec, r.totals.overlapSec], [1500, 30, 1530, 60]);
  assert.equal(r.totals.reviews, 3);
  const redes = r.byName.find((n) => n.label === 'Redes')!;
  assert.deepEqual([redes.cardSec, redes.pomodoroSec, redes.reviews, redes.accuracyPct], [30, 0, 3, 67], 'o acerto vem das 3 revisões; o tempo, só da de fora');
  assert.deepEqual(r.byName.find((n) => n.label === 'Português')!.pomodoroSec, 1500);
});

test('limites do Pomodoro contam como dentro; um Pomodoro de ontem à noite cobre a revisão logo depois da meia-noite', () => {
  const db = build({
    ...BASE,
    sessions: [
      { card: 'f1', when: at(1, 9, 0, 0), ms: 10_000 }, // exatamente o começo
      { card: 'f1', when: at(1, 9, 25, 0), ms: 10_000 }, // exatamente o fim
      { card: 'f1', when: at(1, 9, 25, 1), ms: 10_000 }, // um segundo depois: fora
      { card: 'f2', when: at(6, 0, 10), ms: 20_000 }, // 11/10 00:10: dentro do Pomodoro que começou no dia 10
    ],
    tasks: [
      { discipline: 'X', sec: 1500, start: at(1, 9, 0) },
      { discipline: 'Y', sec: 3600, start: at(7, 23, 30), end: at(6, 0, 30) }, // 10/10 23:30 a 11/10 00:30
    ],
  });
  const r = loadStudyTime(db, 'u1', NOW, query({ days: 7 }));
  assert.equal(r.totals.cardSec, 10, 'só a revisão de um segundo depois do fim');
  assert.equal(r.totals.overlapSec, 40);
  // o Pomodoro Y começou antes do período (10/10): não conta tempo, mas cobre a revisão de dentro
  assert.equal(r.totals.pomodoroSec, 1500);
});

// ---------- período e filtros ----------

test('período: revisões pelo horário da revisão e Pomodoros pelo horário em que começaram', () => {
  const db = build({
    ...BASE,
    sessions: [{ card: 'f1', when: at(2), ms: 10_000 }, { card: 'f1', when: at(10, 12), ms: 99_000 }],
    tasks: [{ discipline: 'A', sec: 100, start: at(3) }, { discipline: 'A', sec: 900, start: at(10) }],
  });
  const week = loadStudyTime(db, 'u1', NOW, query({ days: 7 }));
  assert.deepEqual([week.totals.cardSec, week.totals.pomodoroSec], [10, 100]);
  const all = loadStudyTime(db, 'u1', NOW, query({ days: 0 }));
  assert.deepEqual([all.totals.cardSec, all.totals.pomodoroSec], [109, 1000]);
  assert.deepEqual(all.range, { from: '2026-10-07', to: '2026-10-17' }, 'desde o início: do primeiro dia com tempo');
  assert.deepEqual(week.range, { from: '2026-10-11', to: '2026-10-17' });
  const custom = loadStudyTime(db, 'u1', NOW, query({ range: { from: '2026-10-06', to: '2026-10-08' } }));
  assert.deepEqual([custom.totals.cardSec, custom.totals.pomodoroSec], [99, 900]);
});

test('a revisão logo antes do período só serve para medir o intervalo da primeira de dentro', () => {
  const db = build({
    ...BASE,
    sessions: [
      { card: 'f1', when: new Date(2026, 9, 10, 23, 59, 40).toISOString(), ms: 5_000 }, // antes do período (começa 11/10)
      { card: 'f1', when: new Date(2026, 9, 11, 0, 0, 10).toISOString(), ms: null }, // 30 s depois: estimada em 30 s
    ],
  });
  const r = loadStudyTime(db, 'u1', NOW, query({ days: 7 }));
  assert.deepEqual([r.totals.reviews, r.totals.cardSec, r.totals.estimatedReviews], [1, 30, 1], 'só a de dentro conta, com o intervalo medido pela de fora');
});

test('filtros: o nome e o assunto valem para os cartões (pela coleção) e para o Pomodoro (pelo texto digitado)', () => {
  const db = build({
    ...BASE,
    sessions: [{ card: 'f1', when: at(1), ms: 10_000 }, { card: 'f2', when: at(1, 11), ms: 20_000 }, { card: 'f3', when: at(1, 12), ms: 40_000 }],
    tasks: [{ discipline: 'Redes', subject: 'DNS', sec: 1000, start: at(2, 9) }, { discipline: 'Redes', subject: 'Wi-Fi', sec: 500, start: at(2, 11) }, { discipline: 'Direito', sec: 200, start: at(2, 15) }],
  });
  const redes = loadStudyTime(db, 'u1', NOW, query({ name: 'redes' }));
  assert.deepEqual([redes.totals.cardSec, redes.totals.pomodoroSec], [30, 1500]);
  assert.deepEqual(redes.byName.map((n) => n.label), ['Redes']);
  const dns = loadStudyTime(db, 'u1', NOW, query({ name: 'redes', subject: 'dns' }));
  assert.deepEqual([dns.totals.cardSec, dns.totals.pomodoroSec], [10, 1000]);
  const none = loadStudyTime(db, 'u1', NOW, query({ subject: '__sem_assunto__' }));
  assert.deepEqual([none.totals.cardSec, none.totals.pomodoroSec], [40, 200], 'os sem assunto: a coleção Direito e o Pomodoro de Direito');
  assert.equal(loadStudyTime(db, 'u1', NOW, query({ name: 'nao-existe' })).totals.totalSec, 0);
});

test('só o que é do próprio usuário', () => {
  const db = build({
    collections: [{ id: 'c1', name: 'A', subject: '' }, { id: 'cx', user: 'u2', name: 'A', subject: '' }],
    cards: [{ id: 'f1', collection: 'c1' }, { id: 'fx', collection: 'cx' }],
    sessions: [{ card: 'f1', when: at(1), ms: 10_000 }, { card: 'fx', when: at(1), ms: 99_000, user: 'u2' }],
    tasks: [{ discipline: 'A', sec: 100, start: at(1, 14) }, { discipline: 'A', sec: 9999, start: at(1, 14), user: 'u2' }],
  });
  const r = loadStudyTime(db, 'u1', NOW, query());
  assert.deepEqual([r.totals.cardSec, r.totals.pomodoroSec, r.totals.reviews], [10, 100, 1]);
});

test('Pomodoro com duração zero ou negativa é ignorado; resultado desconhecido não entra', () => {
  const db = build({
    ...BASE,
    sessions: [{ card: 'f1', when: at(1), ms: 10_000, result: 'estranho' }, { card: 'f1', when: at(1, 11), ms: 20_000 }],
    tasks: [{ discipline: 'A', sec: 0, start: at(1) }, { discipline: 'A', sec: -5, start: at(1, 11) }, { discipline: 'A', sec: 60, start: at(1, 12) }],
  });
  const r = loadStudyTime(db, 'u1', NOW, query());
  assert.deepEqual([r.totals.pomodoroSec, r.totals.tasks, r.totals.reviews, r.totals.cardSec], [60, 1, 1, 20]);
});

// ---------- o edital ----------

const EXAM: Seed = {
  collections: [
    { id: 'c1', name: 'Redes', subject: 'DNS' },
    { id: 'c2', name: 'Segurança', subject: 'MFA' },
    { id: 'c3', name: 'Acentuação', subject: 'Gráfica' },
    { id: 'c4', name: 'Legislação', subject: 'LGPD' }, // fora do edital
  ],
  cards: [['f1', 'c1'], ['f2', 'c2'], ['f3', 'c3'], ['f4', 'c4']].map(([id, collection]) => ({ id, collection })),
  exams: [
    {
      id: 'e1', name: 'TRANSPETRO', date: '2026-12-06',
      disciplines: [
        { id: 'd1', name: 'Língua Portuguesa', questions: 10, weight: 1, collections: ['c3'] }, // 10 pontos
        { id: 'd2', name: 'Conhecimentos Específicos', questions: 30, weight: 2, collections: ['c1', 'c2'] }, // 60 pontos
        { id: 'd3', name: 'Língua Inglesa', questions: 5, weight: 2 }, // 10 pontos, sem coleção
      ],
    },
  ],
};

test('por disciplina do edital: o peso (questões x peso), o tempo e o acerto de cada uma, na ordem do edital', () => {
  const db = build({
    ...EXAM,
    sessions: [
      { card: 'f1', when: at(1, 9), ms: 60_000, result: 'bom' },
      { card: 'f2', when: at(1, 9, 5), ms: 30_000, result: 'errei' },
      { card: 'f3', when: at(1, 9, 10), ms: 10_000, result: 'facil' },
      { card: 'f4', when: at(1, 9, 15), ms: 20_000, result: 'bom' },
    ],
  });
  const r = loadStudyTime(db, 'u1', NOW, query());
  assert.deepEqual(r.exam, { id: 'e1', name: 'TRANSPETRO' });
  const rows = r.byDiscipline!;
  assert.deepEqual(rows.map((d) => [d.label, d.weightPct, d.cardSec, d.reviews, d.accuracyPct]), [
    ['Língua Portuguesa', 13, 10, 1, 100], // 10 de 80 pontos
    ['Conhecimentos Específicos', 75, 90, 2, 50], // 60 de 80
    ['Língua Inglesa', 13, 0, 0, null], // 10 de 80, sem estudo
    [OUT_OF_SYLLABUS_LABEL, null, 20, 1, 100],
  ]);
  assert.equal(rows[1].disciplineId, 'd2');
  assert.equal(rows[3].disciplineId, null);
  assert.deepEqual([rows[1].questions, rows[1].weight], [30, 2]);
  assert.deepEqual(rows[1].subjects.map((s) => s.label), ['DNS', 'MFA']);
});

test('por disciplina do edital: o Pomodoro casa pelo nome da disciplina ou pelo nome de uma coleção dela; o resto cai fora do edital', () => {
  const db = build({
    ...EXAM,
    tasks: [
      { discipline: 'lingua portuguesa', sec: 1000, start: at(1, 9) }, // nome da disciplina
      { discipline: 'Redes', sec: 2000, start: at(1, 10) }, // nome de uma coleção de Específicos
      { discipline: 'Segurança', sec: 500, start: at(1, 11) },
      { discipline: 'Legislação', sec: 300, start: at(1, 12) }, // coleção fora do edital
      { discipline: 'Culinária', sec: 100, start: at(1, 13) }, // sem correspondência
      { discipline: '', sec: 50, start: at(1, 14) }, // sem disciplina
    ],
  });
  const rows = loadStudyTime(db, 'u1', NOW, query()).byDiscipline!;
  assert.deepEqual(rows.map((d) => [d.label, d.pomodoroSec]), [['Língua Portuguesa', 1000], ['Conhecimentos Específicos', 2500], ['Língua Inglesa', 0], [OUT_OF_SYLLABUS_LABEL, 450]]);
});

test('"Meu concurso": só o que é do edital; a linha "Fora do edital" some', () => {
  const db = build({
    ...EXAM,
    sessions: [{ card: 'f1', when: at(1, 9), ms: 60_000 }, { card: 'f4', when: at(1, 9, 5), ms: 20_000 }],
    tasks: [{ discipline: 'Redes', sec: 1000, start: at(1, 10) }, { discipline: 'Culinária', sec: 100, start: at(1, 13) }],
  });
  const r = loadStudyTime(db, 'u1', NOW, query({ scope: 'exam' }));
  assert.equal(r.scope, 'exam');
  assert.deepEqual([r.totals.cardSec, r.totals.pomodoroSec], [60, 1000], 'a coleção de fora e o Pomodoro sem correspondência não contam');
  assert.ok(!r.byDiscipline!.some((d) => d.label === OUT_OF_SYLLABUS_LABEL));
  assert.deepEqual(r.byName.map((n) => n.label), ['Redes']);
});

test('uma coleção ligada a mais de uma disciplina conta para a de maior peso', () => {
  const db = build({
    collections: [{ id: 'c1', name: 'Mista', subject: '' }],
    cards: [{ id: 'f1', collection: 'c1' }],
    sessions: [{ card: 'f1', when: at(1), ms: 10_000 }],
    exams: [{ id: 'e1', name: 'E', date: '2026-12-06', disciplines: [{ id: 'd1', name: 'Leve', questions: 5, weight: 1, collections: ['c1'] }, { id: 'd2', name: 'Pesada', questions: 20, weight: 2, collections: ['c1'] }] }],
  });
  assert.deepEqual(loadStudyTime(db, 'u1', NOW, query()).byDiscipline!.map((d) => [d.label, d.cardSec]), [['Leve', 0], ['Pesada', 10]]);
});

test('edital sem número de questões nem peso: as disciplinas dividem por igual', () => {
  const db = build({ exams: [{ id: 'e1', name: 'E', date: '2026-12-06', disciplines: [{ id: 'd1', name: 'A' }, { id: 'd2', name: 'B' }, { id: 'd3', name: 'C' }, { id: 'd4', name: 'D' }] }] });
  assert.deepEqual(loadStudyTime(db, 'u1', NOW, query()).byDiscipline!.map((d) => d.weightPct), [25, 25, 25, 25]);
});

test('sem concurso, ou com o concurso de outro usuário: não há linhas do edital', () => {
  const db = build({ ...BASE, exams: [{ id: 'ex', user: 'u2', name: 'Do outro', date: '2026-12-06', disciplines: [{ id: 'dx', name: 'X' }] }] });
  const r = loadStudyTime(db, 'u1', NOW, query({ scope: 'exam' }));
  assert.deepEqual([r.exam, r.byDiscipline, r.scope], [null, null, 'all']);
});

test('sem nenhum tempo: tudo zerado e listas vazias (o edital continua com as suas disciplinas, sem tempo)', () => {
  const none = loadStudyTime(build(BASE), 'u1', NOW, query());
  assert.deepEqual([none.totals.totalSec, none.byName, none.byDiscipline], [0, [], null]);
  const exam = loadStudyTime(build(EXAM), 'u1', NOW, query({ days: 0 }));
  assert.deepEqual(exam.byDiscipline!.map((d) => [d.label, d.totalSec]), [['Língua Portuguesa', 0], ['Conhecimentos Específicos', 0], ['Língua Inglesa', 0]]);
  assert.deepEqual(exam.range, { from: '2026-10-17', to: '2026-10-17' }, 'desde o início sem nada: só hoje');
});

test('os assuntos de uma linha: do que mais tomou tempo ao que menos, no máximo oito, sem os de tempo zero', () => {
  const db = build({
    tasks: [
      ...Array.from({ length: 10 }, (_, i) => ({ discipline: 'A', subject: `Assunto ${i}`, sec: (i + 1) * 100, start: at(1, 8 + (i % 8), i) })),
      { discipline: 'A', subject: 'Zero', sec: 0, start: at(1, 20) },
    ],
  });
  const subjects = loadStudyTime(db, 'u1', NOW, query()).byName[0].subjects;
  assert.equal(subjects.length, 8);
  assert.deepEqual(subjects.slice(0, 3).map((s) => s.label), ['Assunto 9', 'Assunto 8', 'Assunto 7']);
  assert.ok(!subjects.some((s) => s.label === 'Zero'));
});
