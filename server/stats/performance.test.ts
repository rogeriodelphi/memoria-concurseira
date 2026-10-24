import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FROZEN_SCHEMA, setCollectionFrozen } from '../collections/frozen';
import {
  groupKey,
  loadPerformance,
  MAX_CUSTOM_DAYS,
  NO_SUBJECT_KEY,
  NO_SUBJECT_LABEL,
  parsePerformanceQuery,
  pickMainExam,
  resolveWindow,
  type PerformanceQuery,
} from './performance';

const NOW = new Date(2026, 9, 17, 15, 0, 0); // 17/10/2026, 15h (hora local)
const at = (daysAgo: number, hour = 10, minute = 0) => new Date(2026, 9, 17 - daysAgo, hour, minute).toISOString();

interface Seed {
  collections?: { id: string; user?: string; name: string; subject: string }[];
  cards?: { id: string; collection: string }[];
  sessions?: { card: string; result?: string; when: string; user?: string }[];
  exams?: { id: string; user?: string; name: string; date: string | null; created?: string; collections?: string[] }[];
}

function build(seed: Seed): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '');
    CREATE TABLE flashcards (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE);
    CREATE TABLE study_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, flashcard_id TEXT NOT NULL, user_id TEXT NOT NULL, result TEXT NOT NULL, studied_at TEXT NOT NULL);
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, exam_date TEXT, created_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE exam_disciplines (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE exam_topics (id TEXT PRIMARY KEY, discipline_id TEXT NOT NULL, title TEXT NOT NULL);
    CREATE TABLE exam_topic_collections (topic_id TEXT NOT NULL, collection_id TEXT NOT NULL);
  `);
  db.exec(FROZEN_SCHEMA);
  for (const c of seed.collections ?? []) db.prepare('INSERT INTO collections (id, user_id, name, subject) VALUES (?, ?, ?, ?)').run(c.id, c.user ?? 'u1', c.name, c.subject);
  for (const f of seed.cards ?? []) db.prepare('INSERT INTO flashcards (id, collection_id) VALUES (?, ?)').run(f.id, f.collection);
  for (const s of seed.sessions ?? []) db.prepare('INSERT INTO study_sessions (flashcard_id, user_id, result, studied_at) VALUES (?, ?, ?, ?)').run(s.card, s.user ?? 'u1', s.result ?? 'bom', s.when);
  for (const e of seed.exams ?? []) {
    db.prepare('INSERT INTO exams (id, user_id, name, exam_date, created_at) VALUES (?, ?, ?, ?, ?)').run(e.id, e.user ?? 'u1', e.name, e.date, e.created ?? '2026-01-01');
    db.prepare('INSERT INTO exam_disciplines (id, exam_id, name) VALUES (?, ?, ?)').run(`d-${e.id}`, e.id, 'Disciplina');
    db.prepare('INSERT INTO exam_topics (id, discipline_id, title) VALUES (?, ?, ?)').run(`t-${e.id}`, `d-${e.id}`, 'Tópico');
    for (const c of e.collections ?? []) db.prepare('INSERT INTO exam_topic_collections (topic_id, collection_id) VALUES (?, ?)').run(`t-${e.id}`, c);
  }
  return db;
}

const query = (extra: Partial<PerformanceQuery> = {}): PerformanceQuery => ({ days: 30, range: null, scope: 'all', name: null, subject: null, ...extra });
const parse = (raw: Record<string, unknown>) => {
  const r = parsePerformanceQuery(raw);
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.value;
};
const refused = (raw: Record<string, unknown>, message?: RegExp) => {
  const r = parsePerformanceQuery(raw);
  assert.ok(!r.ok, JSON.stringify(raw));
  if (message) assert.match(r.error, message);
};

// ---------- o endereço ----------

test('endereço: sem nada, o padrão é 7 dias, tudo, sem filtros', () => {
  assert.deepEqual(parse({}), { days: 7, range: null, scope: 'all', name: null, subject: null, exam: null });
});

test('endereço: períodos prontos, escopo e filtros', () => {
  for (const days of [1, 7, 15, 30, 0]) assert.equal(parse({ days: String(days) }).days, days);
  assert.equal(parse({ scope: 'exam' }).scope, 'exam');
  assert.equal(parse({ scope: '' }).scope, 'all');
  assert.equal(parse({ name: 'redes', subject: NO_SUBJECT_KEY }).name, 'redes');
  assert.equal(parse({ name: '' }).name, null, 'vazio = sem filtro');
  assert.equal(parse({ name: ['a', 'b'] }).name, 'a', 'parâmetro repetido vale o primeiro');
  assert.equal(parse({ name: 'x'.repeat(500) }).name?.length, 200);
});

test('endereço: o concurso escolhido (exam) é um texto curto; vazio ou comprido demais não vale', () => {
  assert.equal(parse({ exam: 'abc-123' }).exam, 'abc-123');
  assert.equal(parse({ exam: '' }).exam, null);
  assert.equal(parse({ exam: 'x'.repeat(65) }).exam, null);
  assert.equal(parse({ exam: ['a', 'b'] }).exam, 'a');
});

test('endereço: valores estranhos são recusados', () => {
  for (const days of ['5', '31', '-1', 'abc', '7.5', '1e1']) refused({ days }, /Período inválido/);
  refused({ scope: 'tudo' }, /Escopo/);
  refused({ from: '2026-10-01' }, /Datas inválidas/);
  refused({ to: '2026-10-01' }, /Datas inválidas/);
  refused({ from: '2026-13-01', to: '2026-10-01' }, /Datas inválidas/);
  refused({ from: '2026-02-30', to: '2026-03-01' }, /Datas inválidas/);
  refused({ from: '17/10/2026', to: '18/10/2026' }, /Datas inválidas/);
  refused({ from: '2026-10-10', to: '2026-10-01' }, /depois da final/);
  refused({ from: '2000-01-01', to: '2026-10-01' }, /10 anos/);
});

test('endereço: período personalizado, de um dia ou de até 10 anos', () => {
  assert.deepEqual(parse({ from: '2026-10-01', to: '2026-10-17' }).range, { from: '2026-10-01', to: '2026-10-17' });
  assert.deepEqual(parse({ from: '2026-10-17', to: '2026-10-17' }).range, { from: '2026-10-17', to: '2026-10-17' }, 'um dia só');
  assert.ok(MAX_CUSTOM_DAYS >= 3650);
  assert.ok(parsePerformanceQuery({ from: '2016-10-18', to: '2026-10-17' }).ok);
});

test('janela: hoje, 7 dias e o período anterior de mesma duração', () => {
  const today = resolveWindow(query({ days: 1 }), NOW);
  assert.equal(today.current.start?.getTime(), new Date(2026, 9, 17).getTime());
  assert.equal(today.current.end.getTime(), new Date(2026, 9, 18).getTime());
  assert.equal(today.previous?.start?.getTime(), new Date(2026, 9, 16).getTime(), 'o anterior de "hoje" é ontem');

  const week = resolveWindow(query({ days: 7 }), NOW);
  assert.equal(week.current.start?.getTime(), new Date(2026, 9, 11).getTime());
  assert.equal(week.previous?.start?.getTime(), new Date(2026, 9, 4).getTime());
  assert.equal(week.previous?.end.getTime(), new Date(2026, 9, 11).getTime());

  const all = resolveWindow(query({ days: 0 }), NOW);
  assert.equal(all.current.start, null);
  assert.equal(all.previous, null);

  const custom = resolveWindow(query({ range: { from: '2026-10-05', to: '2026-10-09' } }), NOW);
  assert.equal(custom.current.start?.getTime(), new Date(2026, 9, 5).getTime());
  assert.equal(custom.current.end.getTime(), new Date(2026, 9, 10).getTime(), 'o dia final entra inteiro');
  assert.equal(custom.previous?.start?.getTime(), new Date(2026, 9, 0).getTime(), '5 dias antes: 30/09');
});

test('chave: sem acentos, maiúsculas nem espaços repetidos', () => {
  assert.equal(groupKey('  Língua   PORTUGUESA '), 'lingua portuguesa');
  assert.equal(groupKey(''), '');
});

// ---------- os números ----------

const BASE: Seed = {
  collections: [
    { id: 'c1', name: 'Redes', subject: 'DNS' },
    { id: 'c2', name: 'Redes', subject: 'Wi-Fi' },
    { id: 'c3', name: 'Direito', subject: '' },
  ],
  cards: ['f1:c1', 'f2:c1', 'f3:c2', 'f4:c3', 'f5:c3'].map((s) => ({ id: s.split(':')[0], collection: s.split(':')[1] })),
};

test('cartão estudado conta uma vez; revisões, acertos e erros à parte; Difícil é erro', () => {
  const db = build({
    ...BASE,
    sessions: [
      { card: 'f1', result: 'bom', when: at(0, 9) }, { card: 'f1', result: 'errei', when: at(0, 11) }, { card: 'f1', result: 'facil', when: at(2) },
      { card: 'f2', result: 'dificil', when: at(1) },
    ],
  });
  const { totals, totalCards } = loadPerformance(db, 'u1', NOW, query({ days: 7 }));
  assert.deepEqual(totals, { cards: 2, reviews: 4, good: 2, bad: 2, accuracyPct: 50, byResult: { errei: 1, dificil: 1, bom: 1, facil: 1 } });
  assert.equal(totalCards, 5, 'o total conta também os não estudados');
});

test('sem estudo: tudo zerado, acerto vazio e listas vazias', () => {
  const db = build(BASE);
  const result = loadPerformance(db, 'u1', NOW, query({ days: 7 }));
  assert.deepEqual([result.totals.cards, result.totals.reviews, result.totals.accuracyPct], [0, 0, null]);
  assert.deepEqual([result.daily, result.byName, result.bySubject], [[], [], []]);
  assert.equal(result.options.names.length, 2, 'os filtros mostram tudo mesmo sem estudo');
});

test('período: hoje e os 6 dias anteriores; o dia anterior ao começo fica de fora; "desde o início" pega tudo', () => {
  const db = build({
    ...BASE,
    sessions: [
      { card: 'f1', when: at(0, 0, 1) }, // 1 min depois da meia-noite de hoje
      { card: 'f2', when: at(6, 0, 0) }, // exatamente a meia-noite do 1º dos 7 dias
      { card: 'f3', when: at(7, 23, 59) }, // o último minuto do dia anterior
      { card: 'f4', when: at(200) },
    ],
  });
  const cards = (days: number) => loadPerformance(db, 'u1', NOW, query({ days })).totals.cards;
  assert.equal(cards(1), 1);
  assert.equal(cards(7), 2);
  assert.equal(cards(15), 3);
  assert.equal(cards(0), 4);
  assert.deepEqual(loadPerformance(db, 'u1', NOW, query({ days: 7 })).range, { from: '2026-10-11', to: '2026-10-17' });
  // Desde o início: começa no primeiro dia com estudo (200 dias antes de 17/10/2026 = 31/03/2026).
  assert.deepEqual(loadPerformance(db, 'u1', NOW, query({ days: 0 })).range, { from: '2026-03-31', to: '2026-10-17' });
});

test('período personalizado: os dois dias entram inteiros', () => {
  const db = build({
    ...BASE,
    sessions: [
      { card: 'f1', when: at(8, 0, 0) }, // 09/10 00:00: entra
      { card: 'f2', when: at(5, 23, 59) }, // 12/10 23:59: entra
      { card: 'f3', when: at(4, 0, 0) }, // 13/10: fora
      { card: 'f4', when: at(9, 23, 59) }, // 08/10: fora
    ],
  });
  const result = loadPerformance(db, 'u1', NOW, query({ range: { from: '2026-10-09', to: '2026-10-12' } }));
  assert.equal(result.totals.cards, 2);
  assert.equal(result.days, null);
  assert.deepEqual(result.range, { from: '2026-10-09', to: '2026-10-12' });
});

test('série por dia: só os dias com estudo, em ordem, separando acertos e erros (dia local)', () => {
  const db = build({
    ...BASE,
    sessions: [
      { card: 'f1', result: 'bom', when: at(3, 23, 59) },
      { card: 'f2', result: 'errei', when: at(3, 0, 1) },
      { card: 'f1', result: 'facil', when: at(1, 9) },
      { card: 'f2', result: 'dificil', when: at(1, 10) },
      { card: 'f3', result: 'dificil', when: at(1, 11) },
    ],
  });
  assert.deepEqual(loadPerformance(db, 'u1', NOW, query({ days: 7 })).daily, [
    { date: '2026-10-14', good: 1, bad: 1 },
    { date: '2026-10-16', good: 1, bad: 2 },
  ]);
});

test('por nome: junta maiúsculas e acentos, e traz os assuntos dentro de cada nome', () => {
  const db = build({
    collections: [
      { id: 'c1', name: 'Segurança da Informação', subject: 'MFA' },
      { id: 'c2', name: 'seguranca da informacao', subject: 'SSO' },
      { id: 'c3', name: 'Segurança da Informação', subject: 'mfa' },
      { id: 'c4', name: 'Linux', subject: '' },
    ],
    cards: [['f1', 'c1'], ['f2', 'c2'], ['f3', 'c3'], ['f4', 'c3'], ['f5', 'c4']].map(([id, collection]) => ({ id, collection })),
    sessions: ['f1', 'f2', 'f3', 'f4', 'f5'].map((card) => ({ card, when: at(1) })),
  });
  const { byName } = loadPerformance(db, 'u1', NOW, query());
  assert.deepEqual(byName.map((n) => [n.label, n.cards]), [['Segurança da Informação', 4], ['Linux', 1]]);
  assert.deepEqual([...byName[0].collectionIds].sort(), ['c1', 'c2', 'c3']);
  assert.deepEqual(byName[0].subjects.map((s) => [s.label, s.cards]), [['mfa', 3], ['SSO', 1]], 'MFA e mfa são um assunto só, escrito como a maioria dos cartões estudados o escreve (2 de 3)');
  assert.deepEqual(byName[1].subjects.map((s) => [s.key, s.label]), [[NO_SUBJECT_KEY, NO_SUBJECT_LABEL]]);
});

test('por assunto: agrupa pelo assunto e diz de quais nomes ele vem; os sem assunto ficam juntos', () => {
  const db = build({
    collections: [
      { id: 'c1', name: 'Redes', subject: 'Variadas' },
      { id: 'c2', name: 'Linux', subject: 'variadas' },
      { id: 'c3', name: 'Redes', subject: 'Wi-Fi' },
      { id: 'c4', name: 'Direito', subject: '' },
      { id: 'c5', name: 'Inglês', subject: '   ' },
    ],
    cards: [['f1', 'c1'], ['f2', 'c1'], ['f3', 'c2'], ['f4', 'c3'], ['f5', 'c4'], ['f6', 'c5']].map(([id, collection]) => ({ id, collection })),
    sessions: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((card) => ({ card, when: at(0) })),
  });
  const { bySubject } = loadPerformance(db, 'u1', NOW, query({ days: 7 }));
  assert.deepEqual(bySubject.map((s) => [s.label, s.cards]), [['Variadas', 3], ['Sem assunto', 2], ['Wi-Fi', 1]]);
  assert.deepEqual(bySubject[0].names, ['Redes', 'Linux'], 'Redes tem mais cartões estudados neste assunto');
  assert.deepEqual(bySubject[1].names, ['Direito', 'Inglês']);
});

test('ordem: mais cartões primeiro; empate, mais revisões; depois o nome', () => {
  const db = build({
    collections: ['Zeta', 'Alfa', 'Beta', 'Gama'].map((name, i) => ({ id: `c${i}`, name, subject: '' })),
    cards: [['z1', 'c0'], ['a1', 'c1'], ['b1', 'c2'], ['b2', 'c2'], ['g1', 'c3']].map(([id, collection]) => ({ id, collection })),
    sessions: [
      { card: 'z1', when: at(0) }, { card: 'a1', when: at(0) }, { card: 'a1', when: at(1) },
      { card: 'b1', when: at(0) }, { card: 'b2', when: at(0) }, { card: 'g1', when: at(0) },
    ],
  });
  assert.deepEqual(loadPerformance(db, 'u1', NOW, query()).byName.map((n) => n.label), ['Beta', 'Alfa', 'Gama', 'Zeta']);
});

test('só conta os estudos e as coleções do próprio usuário', () => {
  const db = build({
    collections: [{ id: 'c1', name: 'A', subject: '' }, { id: 'cx', user: 'u2', name: 'A', subject: '' }],
    cards: [{ id: 'f1', collection: 'c1' }, { id: 'fx', collection: 'cx' }],
    sessions: [{ card: 'f1', when: at(0) }, { card: 'fx', when: at(0), user: 'u2' }, { card: 'fx', when: at(1), user: 'u2' }],
  });
  const result = loadPerformance(db, 'u1', NOW, query());
  assert.deepEqual([result.totals.cards, result.totals.reviews, result.totalCards], [1, 1, 1]);
  assert.equal(result.options.names.length, 1);
});

test('resultado desconhecido não entra nas contas', () => {
  const db = build({ ...BASE, sessions: [{ card: 'f1', result: 'bom', when: at(0) }, { card: 'f1', result: 'estranho', when: at(0) }] });
  const { totals } = loadPerformance(db, 'u1', NOW, query());
  assert.deepEqual([totals.reviews, totals.good, totals.bad], [1, 1, 0]);
});

// ---------- filtros ----------

const FILTERED: Seed = {
  ...BASE,
  sessions: [
    { card: 'f1', result: 'bom', when: at(1) }, { card: 'f2', result: 'errei', when: at(1) },
    { card: 'f3', result: 'facil', when: at(2) }, { card: 'f4', result: 'bom', when: at(2) }, { card: 'f5', result: 'bom', when: at(0) },
  ],
};

test('filtro por nome: totais, série, assuntos e listas só desse nome', () => {
  const db = build(FILTERED);
  const result = loadPerformance(db, 'u1', NOW, query({ name: 'redes' }));
  assert.deepEqual([result.totals.cards, result.totals.reviews], [3, 3]);
  assert.deepEqual(result.byName.map((n) => n.label), ['Redes']);
  assert.deepEqual(result.bySubject.map((s) => s.label).sort(), ['DNS', 'Wi-Fi']);
  assert.equal(result.daily.reduce((n, d) => n + d.good + d.bad, 0), 3);
  assert.equal(result.options.names.length, 2, 'as opções não encolhem com o filtro');
  assert.equal(result.totalCards, 3, 'o total de cartões também acompanha o filtro (os 3 da Redes, não os 5 de tudo)');
});

test('filtro por assunto, inclusive "sem assunto", e os dois juntos', () => {
  const db = build(FILTERED);
  assert.deepEqual(loadPerformance(db, 'u1', NOW, query({ subject: 'dns' })).byName.map((n) => n.label), ['Redes']);
  const none = loadPerformance(db, 'u1', NOW, query({ subject: NO_SUBJECT_KEY }));
  assert.deepEqual([none.totals.cards, none.byName[0].label], [2, 'Direito']);
  assert.equal(loadPerformance(db, 'u1', NOW, query({ name: 'redes', subject: 'dns' })).totals.cards, 2);
  assert.equal(loadPerformance(db, 'u1', NOW, query({ name: 'redes', subject: 'dns' })).totalCards, 2);
  assert.equal(loadPerformance(db, 'u1', NOW, query({ name: 'nao-existe' })).totalCards, 0);
  assert.equal(loadPerformance(db, 'u1', NOW, query({ name: 'direito', subject: 'dns' })).totals.cards, 0, 'combinação que não existe');
  assert.equal(loadPerformance(db, 'u1', NOW, query({ name: 'nao-existe' })).totals.reviews, 0);
});

// ---------- tendência ----------

test('tendência: o acerto do período anterior de mesma duração, por nome, por assunto e por assunto dentro do nome', () => {
  const db = build({
    collections: [{ id: 'c1', name: 'Redes', subject: 'DNS' }, { id: 'c2', name: 'Direito', subject: 'CF' }],
    cards: [{ id: 'f1', collection: 'c1' }, { id: 'f2', collection: 'c2' }],
    sessions: [
      // 7 dias atuais (11 a 17/10): Redes 3 de 4 (75%); Direito 1 de 2 (50%)
      { card: 'f1', result: 'bom', when: at(0) }, { card: 'f1', result: 'bom', when: at(1) }, { card: 'f1', result: 'facil', when: at(2) }, { card: 'f1', result: 'errei', when: at(3) },
      { card: 'f2', result: 'bom', when: at(0) }, { card: 'f2', result: 'errei', when: at(1) },
      // 7 dias anteriores (4 a 10/10): Redes 1 de 4 (25%); Direito não estudou
      { card: 'f1', result: 'bom', when: at(7) }, { card: 'f1', result: 'errei', when: at(8) }, { card: 'f1', result: 'errei', when: at(9) }, { card: 'f1', result: 'dificil', when: at(10) },
      // antes disso, não conta para nada
      { card: 'f2', result: 'bom', when: at(20) },
    ],
  });
  const result = loadPerformance(db, 'u1', NOW, query({ days: 7 }));
  const redes = result.byName.find((n) => n.label === 'Redes')!;
  const direito = result.byName.find((n) => n.label === 'Direito')!;
  assert.deepEqual([redes.accuracyPct, redes.previousAccuracyPct], [75, 25]);
  assert.deepEqual([direito.accuracyPct, direito.previousAccuracyPct], [50, null], 'sem estudo no período anterior não há tendência');
  assert.deepEqual([redes.subjects[0].accuracyPct, redes.subjects[0].previousAccuracyPct], [75, 25]);
  assert.equal(result.bySubject.find((s) => s.label === 'DNS')!.previousAccuracyPct, 25);
  assert.equal(loadPerformance(db, 'u1', NOW, query({ days: 0 })).byName[0].previousAccuracyPct, null, 'desde o início não tem período anterior');
});

test('tendência: o período anterior respeita os filtros', () => {
  const db = build({
    collections: [{ id: 'c1', name: 'Redes', subject: 'DNS' }, { id: 'c2', name: 'Redes', subject: 'Wi-Fi' }],
    cards: [{ id: 'f1', collection: 'c1' }, { id: 'f2', collection: 'c2' }],
    sessions: [
      { card: 'f1', result: 'bom', when: at(0) },
      { card: 'f1', result: 'bom', when: at(8) }, { card: 'f2', result: 'errei', when: at(8) }, { card: 'f2', result: 'errei', when: at(9) },
    ],
  });
  const filtered = loadPerformance(db, 'u1', NOW, query({ days: 7, subject: 'dns' }));
  assert.equal(filtered.byName[0].previousAccuracyPct, 100, 'só o DNS conta no anterior');
  assert.equal(loadPerformance(db, 'u1', NOW, query({ days: 7 })).byName[0].previousAccuracyPct, 33);
});

// ---------- meu concurso ----------

const WITH_EXAMS: Seed = {
  ...BASE,
  sessions: [{ card: 'f1', when: at(0) }, { card: 'f3', when: at(0) }, { card: 'f4', when: at(0) }],
  exams: [
    { id: 'e1', name: 'Concurso A', date: '2026-12-06', created: '2026-01-01', collections: ['c1', 'c2'] },
    { id: 'e2', name: 'Concurso B', date: '2027-03-01', created: '2026-02-01', collections: ['c3'] },
  ],
};

test('"meu concurso": só as coleções ligadas ao concurso de data mais próxima; os filtros e o total acompanham', () => {
  const db = build(WITH_EXAMS);
  const all = loadPerformance(db, 'u1', NOW, query());
  assert.deepEqual([all.scope, all.totals.cards, all.totalCards], ['all', 3, 5]);
  assert.deepEqual(all.exam, { id: 'e1', name: 'Concurso A' }, 'o botão aparece nos dois escopos');

  const mine = loadPerformance(db, 'u1', NOW, query({ scope: 'exam' }));
  assert.equal(mine.scope, 'exam');
  assert.deepEqual([mine.totals.cards, mine.totalCards], [2, 3]);
  assert.deepEqual(mine.byName.map((n) => n.label), ['Redes']);
  assert.deepEqual(mine.options.names.map((o) => o.label), ['Redes'], 'os filtros só oferecem o que é do concurso');
});

test('"meu concurso" escolhido: o pedido vale sobre o de data mais próxima, e as coleções, os totais e os filtros são os dele', () => {
  const db = build(WITH_EXAMS);
  const chosen = loadPerformance(db, 'u1', NOW, query({ scope: 'exam', exam: 'e2' }));
  assert.deepEqual(chosen.exam, { id: 'e2', name: 'Concurso B' });
  assert.equal(chosen.scope, 'exam');
  assert.deepEqual([chosen.totals.cards, chosen.totalCards], [1, 2], 'só a coleção Direito (f4 e f5; f4 estudado)');
  assert.deepEqual(chosen.byName.map((n) => n.label), ['Direito']);
  assert.deepEqual(chosen.options.names.map((o) => o.label), ['Direito']);

  // sem pedido, continua o de data mais próxima
  assert.equal(loadPerformance(db, 'u1', NOW, query({ scope: 'exam' })).exam?.id, 'e1');
  // o escolhido também aparece no escopo "todos os dados" (o botão e o nome), sem mudar os totais
  const all = loadPerformance(db, 'u1', NOW, query({ exam: 'e2' }));
  assert.deepEqual([all.scope, all.exam?.id, all.totals.cards], ['all', 'e2', 3]);
});

test('"meu concurso" escolhido: um concurso sem data também vale (aqui a data não importa), mas o de outra conta ou inexistente cai no principal', () => {
  const db = build({
    ...WITH_EXAMS,
    exams: [
      { id: 'e1', name: 'Concurso A', date: '2026-12-06', collections: ['c1', 'c2'] },
      { id: 'e2', name: 'Sem data', date: null, collections: ['c3'] },
      { id: 'e9', user: 'u2', name: 'Do outro', date: '2026-11-01', collections: ['c3'] },
    ],
  });
  assert.equal(loadPerformance(db, 'u1', NOW, query({ scope: 'exam', exam: 'e2' })).exam?.id, 'e2');
  assert.equal(loadPerformance(db, 'u1', NOW, query({ scope: 'exam', exam: 'e9' })).exam?.id, 'e1', 'de outra conta');
  assert.equal(loadPerformance(db, 'u1', NOW, query({ scope: 'exam', exam: 'não-existe' })).exam?.id, 'e1');
  assert.equal(pickMainExam(db, 'u1', NOW, null)?.id, 'e1');
  assert.equal(pickMainExam(db, 'u1', NOW, undefined)?.id, 'e1');
});

test('"meu concurso": sem data futura, vale o último criado; concurso passado não é o principal se há um futuro', () => {
  const db = build({
    ...WITH_EXAMS,
    exams: [
      { id: 'e1', name: 'Velho', date: '2026-01-10', created: '2026-01-01', collections: ['c1'] },
      { id: 'e2', name: 'Novo sem data', date: null, created: '2026-06-01', collections: ['c3'] },
    ],
  });
  assert.equal(loadPerformance(db, 'u1', NOW, query()).exam?.id, 'e2', 'o último criado');
  const withFuture = build({ ...WITH_EXAMS, exams: [{ id: 'e1', name: 'Velho', date: '2026-01-10', collections: ['c1'] }, { id: 'e3', name: 'Futuro', date: '2027-01-01', collections: ['c3'] }] });
  assert.equal(loadPerformance(withFuture, 'u1', NOW, query()).exam?.id, 'e3');
});

test('"meu concurso" sem concurso cadastrado cai em "todos os dados"; concurso sem coleções ligadas fica vazio', () => {
  const none = build({ ...BASE, sessions: [{ card: 'f1', when: at(0) }] });
  const r = loadPerformance(none, 'u1', NOW, query({ scope: 'exam' }));
  assert.deepEqual([r.exam, r.scope, r.totals.cards], [null, 'all', 1]);

  const unlinked = build({ ...BASE, sessions: [{ card: 'f1', when: at(0) }], exams: [{ id: 'e1', name: 'Sem vínculos', date: '2026-12-06' }] });
  const empty = loadPerformance(unlinked, 'u1', NOW, query({ scope: 'exam' }));
  assert.deepEqual([empty.scope, empty.totals.cards, empty.totalCards, empty.options.names], ['exam', 0, 0, []]);
});

test('concurso de outro usuário não vira o "meu concurso"', () => {
  const db = build({ ...BASE, sessions: [{ card: 'f1', when: at(0) }], exams: [{ id: 'ex', user: 'u2', name: 'Do outro', date: '2026-12-06', collections: ['c1'] }] });
  assert.equal(loadPerformance(db, 'u1', NOW, query({ scope: 'exam' })).exam, null);
});

// ---------- pontos de atenção: cartões errados, base da comparação e coleções ----------

test('cartões errados: os que têm ao menos um Errei ou Difícil no período, contados uma vez; Bom e Fácil não entram', () => {
  const db = build({
    collections: [{ id: 'c1', name: 'Redes', subject: 'DNS' }],
    cards: [{ id: 'f1', collection: 'c1' }, { id: 'f2', collection: 'c1' }, { id: 'f3', collection: 'c1' }],
    sessions: [
      { card: 'f1', result: 'errei', when: at(1) }, { card: 'f1', result: 'dificil', when: at(2) }, { card: 'f1', result: 'bom', when: at(3) },
      { card: 'f2', result: 'bom', when: at(1) }, { card: 'f2', result: 'facil', when: at(2) },
      { card: 'f3', result: 'dificil', when: at(40) }, // fora do período
    ],
  });
  const result = loadPerformance(db, 'u1', NOW, query({ days: 7 }));
  assert.equal(result.byName[0].missedCards, 1, 'só o f1, mesmo com dois erros');
  assert.equal(result.byName[0].subjects[0].missedCards, 1);
  assert.equal(result.bySubject[0].missedCards, 1);
  assert.equal(loadPerformance(db, 'u1', NOW, query({ days: 0 })).byName[0].missedCards, 2, 'desde o início, o f3 também');
});

test('cartões errados: os de coleção congelada não contam (não há o que rever), mas o acerto e as revisões continuam os mesmos', () => {
  const db = build({
    collections: [{ id: 'c1', name: 'Redes', subject: 'DNS' }, { id: 'c2', name: 'Redes', subject: 'Cluster' }],
    cards: [{ id: 'f1', collection: 'c1' }, { id: 'f2', collection: 'c2' }],
    sessions: [{ card: 'f1', result: 'errei', when: at(1) }, { card: 'f2', result: 'errei', when: at(1) }, { card: 'f2', result: 'bom', when: at(2) }],
  });
  const before = loadPerformance(db, 'u1', NOW, query({ days: 7 }));
  assert.equal(before.byName[0].missedCards, 2);
  setCollectionFrozen(db, 'c2', true);
  const after = loadPerformance(db, 'u1', NOW, query({ days: 7 }));
  assert.equal(after.byName[0].missedCards, 1, 'só o f1 pode ser revisto');
  const cluster = after.byName[0].subjects.find((s) => s.label === 'Cluster')!;
  assert.equal(cluster.missedCards, 0, 'o assunto congelado não tem errados para rever');
  assert.deepEqual([cluster.reviews, cluster.good, cluster.bad, cluster.accuracyPct], [2, 1, 1, 50], 'mas a história dele continua nas contas');
  assert.equal(after.byName[0].reviews, before.byName[0].reviews);
  assert.equal(after.byName[0].accuracyPct, before.byName[0].accuracyPct);
  assert.equal(after.bySubject.reduce((n, s) => n + s.missedCards, 0), 1);
  setCollectionFrozen(db, 'c2', false);
  assert.equal(loadPerformance(db, 'u1', NOW, query({ days: 7 })).byName[0].missedCards, 2, 'descongelada, volta');
});

test('base da comparação: quantas revisões o período anterior teve (zero sem período anterior)', () => {
  const db = build({
    collections: [{ id: 'c1', name: 'Redes', subject: 'DNS' }],
    cards: [{ id: 'f1', collection: 'c1' }],
    sessions: [
      { card: 'f1', when: at(0) }, { card: 'f1', when: at(1) },
      { card: 'f1', when: at(8) }, { card: 'f1', when: at(9) }, { card: 'f1', when: at(10) },
    ],
  });
  const week = loadPerformance(db, 'u1', NOW, query({ days: 7 }));
  assert.equal(week.byName[0].previousReviews, 3);
  assert.equal(week.byName[0].subjects[0].previousReviews, 3);
  assert.equal(week.bySubject[0].previousReviews, 3);
  assert.equal(loadPerformance(db, 'u1', NOW, query({ days: 0 })).byName[0].previousReviews, 0);
  assert.equal(loadPerformance(db, 'u1', NOW, query({ days: 1 })).byName[0].previousReviews, 1, 'o anterior de hoje é ontem');
});

test('coleções do grupo: as que tiveram estudo, por nome, por assunto dentro do nome e por assunto', () => {
  const db = build({
    collections: [
      { id: 'c1', name: 'Redes', subject: 'DNS' },
      { id: 'c2', name: 'Redes', subject: 'dns' },
      { id: 'c3', name: 'Redes', subject: 'Wi-Fi' },
      { id: 'c4', name: 'Linux', subject: 'DNS' },
      { id: 'c5', name: 'Linux', subject: 'Usuários' }, // sem estudo no período
    ],
    cards: [['f1', 'c1'], ['f2', 'c2'], ['f3', 'c3'], ['f4', 'c4'], ['f5', 'c5']].map(([id, collection]) => ({ id, collection })),
    sessions: ['f1', 'f2', 'f3', 'f4'].map((card) => ({ card, when: at(0) })),
  });
  const result = loadPerformance(db, 'u1', NOW, query({ days: 7 }));
  const redes = result.byName.find((n) => n.label === 'Redes')!;
  assert.deepEqual([...redes.collectionIds].sort(), ['c1', 'c2', 'c3']);
  assert.deepEqual([...redes.subjects.find((s) => s.key === 'dns')!.collectionIds].sort(), ['c1', 'c2'], 'DNS e dns são um assunto só dentro do nome');
  assert.deepEqual(redes.subjects.find((s) => s.key === 'wi-fi')!.collectionIds, ['c3']);
  const dns = result.bySubject.find((s) => s.key === 'dns')!;
  assert.deepEqual([...dns.collectionIds].sort(), ['c1', 'c2', 'c4'], 'o assunto DNS vem de dois nomes');
  assert.ok(!result.bySubject.some((s) => s.key === 'usuarios'), 'assunto sem estudo não aparece');
});
