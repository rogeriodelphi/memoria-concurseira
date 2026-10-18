import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { Result } from '../mockexams/store';
import type { DraftQuestion, ValidDraft } from './draft';
import {
  attemptCutoff,
  compare,
  cutoffOverview,
  disciplineKey,
  listExamChoices,
  LOW_SAMPLE,
  matchDiscipline,
  OVERVIEW_ATTEMPTS,
  parseCutoff,
  type ExamDiscipline,
} from './cutoff';
import { createNotebook, recordSimulado } from './notebooks';
import { QUESTION_BANK_SCHEMA } from './schema';
import { saveExam } from './store';

const disc = (name: string, cutoff = '', questionCount: number | null = null, weight: number | null = null, id = name): ExamDiscipline => ({
  id,
  name,
  questionCount,
  weight,
  cutoff,
});

// ---------- critério mínimo em texto ----------

test('critério: porcentagem, pontos e questões', () => {
  const none = { questionCount: null, weight: null };
  assert.equal(parseCutoff('mínimo de 50% dos pontos', none), 50);
  assert.equal(parseCutoff('Mínimo de 50,5 %', none), 50.5);
  assert.equal(parseCutoff('acertar 60% (sessenta por cento)', none), 60);
  assert.equal(parseCutoff('30 pontos', { questionCount: 10, weight: 5 }), 60, '30 de 50 pontos');
  assert.equal(parseCutoff('mínimo de 12 pts', { questionCount: 10, weight: 2 }), 60);
  assert.equal(parseCutoff('20 questões', { questionCount: 40, weight: null }), 50);
  assert.equal(parseCutoff('mínimo de 7 acertos', { questionCount: 10, weight: null }), 70);
});

test('critério: o que não dá para ler vira null (sem chute)', () => {
  const none = { questionCount: null, weight: null };
  assert.equal(parseCutoff('', none), null);
  assert.equal(parseCutoff('não eliminatória', none), null);
  assert.equal(parseCutoff('30 pontos', none), null, 'sem o total de pontos não há como converter');
  assert.equal(parseCutoff('30 pontos', { questionCount: 10, weight: null }), null);
  assert.equal(parseCutoff('20 questões', none), null);
  assert.equal(parseCutoff('150%', none), null);
  assert.equal(parseCutoff('mínimo de 40 pontos', { questionCount: 10, weight: 2 }), null, '40 de 20 pontos não faz sentido');
});

// ---------- casar nomes ----------

test('nomes: sem acento nem caixa, e um que contém o outro só se for único', () => {
  assert.equal(disciplineKey('  Língua   PORTUGUESA '), 'lingua portuguesa');
  const list = [disc('Língua Portuguesa'), disc('Direito Administrativo'), disc('Direito Constitucional'), disc('Informática')];
  assert.equal(matchDiscipline('lingua portuguesa', list)?.name, 'Língua Portuguesa');
  assert.equal(matchDiscipline('Informática', list)?.name, 'Informática');
});

test('nomes: casamento por trecho', () => {
  const list = [disc('Língua Portuguesa'), disc('Direito Administrativo'), disc('Direito Constitucional')];
  assert.equal(matchDiscipline('Portuguesa', list)?.name, 'Língua Portuguesa');
  assert.equal(matchDiscipline('Direito', list), null, 'serve para duas: ambíguo');
  assert.equal(matchDiscipline('Direito Administrativo e Controle', list)?.name, 'Direito Administrativo', 'o nome do concurso está dentro do outro');
  assert.equal(matchDiscipline('TI', list), null, 'nome curto demais para casar por trecho');
  assert.equal(matchDiscipline('', list), null);
  assert.equal(matchDiscipline('Biologia', list), null);
  assert.equal(matchDiscipline('Qualquer', []), null);
});

// ---------- comparação ----------

test('comparação: acima, abaixo e sem critério, com quantas faltaram', () => {
  const exam = [disc('Português', 'mínimo de 50%', 20, 1), disc('Direito', 'mínimo de 60%', 30, 2), disc('Informática', '', 10, 1)];
  const result = compare(
    [
      { label: 'Português', total: 10, correct: 6 },
      { label: 'Direito', total: 10, correct: 5 },
      { label: 'Informática', total: 4, correct: 1 },
      { label: 'Biologia', total: 3, correct: 3 },
    ],
    exam,
  );
  const byName = Object.fromEntries(result.disciplines.map((d) => [d.label, d]));
  assert.deepEqual([byName.Português.status, byName.Português.margin, byName.Português.missing], ['above', 10, 0]);
  assert.deepEqual([byName.Direito.status, byName.Direito.margin, byName.Direito.missing], ['below', -10, 1], 'faltou 1 acerto para 60% de 10');
  assert.deepEqual([byName.Informática.status, byName.Informática.cutoffPct, byName.Informática.margin], ['unknown', null, null]);
  assert.equal(result.verdict, 'below');
  assert.deepEqual(result.unmatched.map((u) => [u.label, u.pct]), [['Biologia', 100]]);
  assert.deepEqual(result.disciplines.map((d) => d.label), ['Direito', 'Português', 'Informática'], 'abaixo da corte primeiro; o resto na ordem do edital');
});

test('comparação: nada abaixo → acima; sem nenhum critério → sem veredito', () => {
  const exam = [disc('Português', '50%'), disc('Direito', '')];
  assert.equal(compare([{ label: 'Português', total: 10, correct: 5 }], exam).verdict, 'above', 'exatamente na nota de corte passa');
  assert.equal(compare([{ label: 'Direito', total: 10, correct: 9 }], exam).verdict, 'unknown');
  assert.equal(compare([{ label: 'Biologia', total: 10, correct: 9 }], exam).verdict, 'unknown');
  assert.equal(compare([{ label: 'Português', total: 10, correct: 4 }], exam).verdict, 'below');
});

test('comparação: questões que faltam para a nota de corte são arredondadas para cima', () => {
  const exam = [disc('Direito', '70%')];
  const missing = (total: number, correct: number) => compare([{ label: 'Direito', total, correct }], exam).disciplines[0].missing;
  assert.equal(missing(10, 7), 0);
  assert.equal(missing(10, 6), 1);
  assert.equal(missing(5, 3), 1, '70% de 5 = 3,5: precisa de 4');
  assert.equal(missing(10, 0), 7);
});

test('comparação: nomes diferentes da mesma disciplina do concurso se juntam', () => {
  const exam = [disc('Língua Portuguesa', '50%', 10, 1)];
  const result = compare(
    [
      { label: 'Língua Portuguesa', total: 6, correct: 3 },
      { label: 'língua portuguesa ', total: 2, correct: 2 },
      { label: 'Portuguesa', total: 2, correct: 0 },
    ],
    exam,
  );
  assert.equal(result.disciplines.length, 1);
  assert.deepEqual([result.disciplines[0].total, result.disciplines[0].correct, result.disciplines[0].pct], [10, 5, 50]);
  assert.deepEqual(result.disciplines[0].sourceLabels, ['Língua Portuguesa', 'língua portuguesa', 'Portuguesa'], 'guarda os nomes das questões');
  assert.equal(result.unmatched.length, 0);
});

test('comparação: a nota estimada pesa as disciplinas pelo que valem na prova', () => {
  const exam = [disc('Português', '', 10, 1, 'p'), disc('Direito', '', 30, 2, 'd')]; // 10 pontos e 60 pontos
  const result = compare(
    [
      { label: 'Português', total: 10, correct: 10 }, // 100%
      { label: 'Direito', total: 10, correct: 5 }, // 50%
    ],
    exam,
  );
  assert.equal(result.estimatedPct, 57.1, '(100×10 + 50×60) / 70');
  assert.equal(compare([{ label: 'Biologia', total: 5, correct: 5 }], exam).estimatedPct, null);
});

test('comparação: poucas questões numa disciplina é sinalizado; disciplina do concurso não cobrida também', () => {
  const exam = [disc('Português', '50%'), disc('Direito', '60%'), disc('Informática', 'não eliminatória')];
  const result = compare([{ label: 'Português', total: LOW_SAMPLE - 1, correct: 2 }], exam);
  assert.equal(result.disciplines[0].lowSample, true);
  assert.deepEqual(result.notCovered.map((n) => [n.name, n.cutoffPct]), [['Direito', 60], ['Informática', null]]);
  assert.equal(compare([{ label: 'Português', total: LOW_SAMPLE, correct: 2 }], exam).disciplines[0].lowSample, false);
});

test('comparação: sem concurso, tudo fica sem correspondência mas o placar aparece', () => {
  const result = compare([{ label: '', total: 4, correct: 1 }, { label: 'Direito', total: 6, correct: 6 }], null);
  assert.equal(result.disciplines.length, 0);
  assert.deepEqual(result.unmatched.map((u) => u.label), ['Direito', 'Sem disciplina']);
  assert.equal(result.verdict, 'unknown');
});

// ---------- com o banco ----------

const alts = () => ['A', 'B', 'C', 'D'].map((letter) => ({ letter, text: `Alternativa ${letter}` }));

const question = (number: number, discipline: string, answer = 'A'): DraftQuestion => ({
  number,
  support: '',
  statement: `Enunciado da questão ${number} sobre ${discipline}`,
  alternatives: alts(),
  answer,
  annulled: false,
  discipline,
  subject: '',
  needsFigure: false,
  suspect: false,
});

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u1'), ('u2');
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, exam_date TEXT, created_at TEXT NOT NULL);
    CREATE TABLE exam_disciplines (
      id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, name TEXT NOT NULL, question_count INTEGER, weight REAL,
      cutoff TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL
    );
  `);
  db.exec(QUESTION_BANK_SCHEMA);
  return db;
}

const NOW = new Date('2026-10-18T12:00:00Z');

function addExam(db: DatabaseSync, id: string, name: string, examDate: string | null, disciplines: [string, string, number, number][], userId = 'u1') {
  db.prepare('INSERT INTO exams (id, user_id, name, exam_date, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, name, examDate, `2026-10-0${id.length}T00:00:00Z`);
  disciplines.forEach(([discName, cutoff, qc, weight], i) => {
    db.prepare('INSERT INTO exam_disciplines (id, exam_id, name, question_count, weight, cutoff, position) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${id}-${i}`, id, discName, qc, weight, cutoff, i);
  });
}

function value<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}

/** Uma prova com 6 de Português e 4 de Direito (gabarito sempre A) e um caderno com todas. */
function seeded(db: DatabaseSync, userId = 'u1', name = 'Prova') {
  const questions = [
    ...[1, 2, 3, 4, 5, 6].map((n) => question(n, 'Língua Portuguesa')),
    ...[7, 8, 9, 10].map((n) => question(n, 'Direito Administrativo')),
  ];
  const draft: ValidDraft = { name, board: '', organ: '', year: null, position: '', level: '', questions };
  const exam = value(saveExam(db, userId, draft));
  const ids = (db.prepare('SELECT id FROM qb_questions WHERE exam_id = ? ORDER BY number').all(exam.id) as { id: string }[]).map((r) => r.id);
  const notebook = value(createNotebook(db, userId, { name: `Simulado ${name}`, questionIds: ids })).notebook;
  return { ids, notebook };
}

/** Faz o simulado marcando A (certo) nas primeiras `right` de cada disciplina e B (errado) no resto; `blank` deixa em branco. */
function takeSimulado(db: DatabaseSync, notebookId: string, ids: string[], hits: { port: number; dir: number }, when: string, userId = 'u1') {
  const answers = ids.map((questionId, i) => {
    const isPort = i < 6;
    const right = isPort ? i < hits.port : i - 6 < hits.dir;
    return { questionId, chosen: right ? 'A' : 'B' };
  });
  return value(recordSimulado(db, userId, notebookId, { answers, durationMs: 1000 }, new Date(when))).attempt;
}

test('simulado: guarda o placar por disciplina, com as em branco no total', () => {
  const db = newDb();
  const { ids, notebook } = seeded(db);
  const answers = [
    { questionId: ids[0], chosen: 'A' },
    { questionId: ids[1], chosen: 'B' },
    // as outras de Português ficam em branco
    { questionId: ids[6], chosen: 'A' },
  ];
  const attempt = value(recordSimulado(db, 'u1', notebook.id, { answers }, new Date('2026-10-10T10:00:00Z'))).attempt;
  const rows = db.prepare('SELECT discipline, total, correct FROM qb_attempt_disciplines WHERE attempt_id = ? ORDER BY rowid').all(attempt.id) as unknown as {
    discipline: string;
    total: number;
    correct: number;
  }[];
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { discipline: 'Língua Portuguesa', total: 6, correct: 1 },
    { discipline: 'Direito Administrativo', total: 4, correct: 1 },
  ]);
  db.prepare('DELETE FROM qb_attempts WHERE id = ?').run(attempt.id);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM qb_attempt_disciplines').get() as { n: number }).n, 0, 'apagar a tentativa leva o placar');
});

test('um simulado contra o concurso: usa o "meu concurso" ou o escolhido, e só do dono', () => {
  const db = newDb();
  addExam(db, 'e1', 'Prova A', '2026-12-01', [['Língua Portuguesa', 'mínimo de 50%', 20, 1], ['Direito Administrativo', 'mínimo de 60%', 20, 1]]);
  addExam(db, 'e22', 'Prova B', '2027-03-01', [['Direito Administrativo', 'mínimo de 80%', 20, 1]]);
  const { ids, notebook } = seeded(db);
  const attempt = takeSimulado(db, notebook.id, ids, { port: 4, dir: 2 }, '2026-10-10T10:00:00Z');

  const mine = value(attemptCutoff(db, 'u1', attempt.id, undefined, NOW));
  assert.equal(mine.exam?.name, 'Prova A', 'a de data mais próxima');
  assert.deepEqual(mine.exams.map((e) => e.name), ['Prova A', 'Prova B']);
  assert.equal(mine.hasBreakdown, true);
  const byName = Object.fromEntries(mine.comparison!.disciplines.map((d) => [d.label, d]));
  assert.deepEqual([byName['Língua Portuguesa'].pct, byName['Língua Portuguesa'].status], [66.7, 'above']);
  assert.deepEqual([byName['Direito Administrativo'].pct, byName['Direito Administrativo'].status], [50, 'below']);
  assert.equal(mine.comparison!.verdict, 'below');

  const other = value(attemptCutoff(db, 'u1', attempt.id, 'e22', NOW));
  assert.equal(other.exam?.name, 'Prova B');
  assert.equal(other.comparison!.disciplines.length, 1);
  assert.equal(other.comparison!.unmatched[0].label, 'Língua Portuguesa', 'Português não existe na Prova B');

  assert.equal(value(attemptCutoff(db, 'u1', attempt.id, 'não-existe', NOW)).exam?.name, 'Prova A', 'concurso inválido volta ao padrão');
  const stranger = attemptCutoff(db, 'u2', attempt.id, undefined, NOW);
  assert.ok(!stranger.ok);
  assert.equal(stranger.status, 404);
});

test('simulado antigo, sem o placar por disciplina, só mostra o total', () => {
  const db = newDb();
  const { notebook, ids } = seeded(db);
  const attempt = takeSimulado(db, notebook.id, ids, { port: 3, dir: 3 }, '2026-10-10T10:00:00Z');
  db.prepare('DELETE FROM qb_attempt_disciplines WHERE attempt_id = ?').run(attempt.id);
  const result = value(attemptCutoff(db, 'u1', attempt.id, undefined, NOW));
  assert.equal(result.hasBreakdown, false);
  assert.equal(result.comparison, null);
  assert.equal(cutoffOverview(db, 'u1', undefined, NOW).attemptCount, 0, 'também não entra no acompanhamento');
});

test('escolha de concursos: o "meu concurso" primeiro, com quantas disciplinas têm critério legível', () => {
  const db = newDb();
  addExam(db, 'a', 'Sem data', null, [['Português', '50%', 10, 1]]);
  addExam(db, 'bb', 'Próximo', '2026-11-01', [['Português', 'mínimo de 50%', 10, 1], ['Direito', 'não eliminatória', 10, 1]]);
  addExam(db, 'ccc', 'Outro usuário', '2026-10-20', [['Português', '50%', 10, 1]], 'u2');
  const choices = listExamChoices(db, 'u1', NOW);
  assert.deepEqual(choices.map((c) => [c.name, c.disciplines, c.withCutoff]), [['Próximo', 2, 1], ['Sem data', 1, 1]]);
});

test('acompanhamento: série por disciplina, situação pelos últimos 3, tendência e o que não casou', () => {
  const db = newDb();
  addExam(db, 'e1', 'Prova A', '2026-12-01', [['Língua Portuguesa', 'mínimo de 50%', 20, 1], ['Direito Administrativo', 'mínimo de 75%', 20, 1]]);
  const { ids, notebook } = seeded(db);
  takeSimulado(db, notebook.id, ids, { port: 2, dir: 1 }, '2026-10-01T10:00:00Z'); // 33% / 25%
  takeSimulado(db, notebook.id, ids, { port: 4, dir: 2 }, '2026-10-05T10:00:00Z'); // 67% / 50%
  takeSimulado(db, notebook.id, ids, { port: 5, dir: 3 }, '2026-10-09T10:00:00Z'); // 83% / 75%
  takeSimulado(db, notebook.id, ids, { port: 6, dir: 4 }, '2026-10-12T10:00:00Z'); // 100% / 100%

  const overview = cutoffOverview(db, 'u1', undefined, NOW);
  assert.equal(overview.attemptCount, 4);
  const port = overview.disciplines.find((d) => d.name === 'Língua Portuguesa')!;
  assert.deepEqual(port.series.map((p) => p.pct), [33.3, 66.7, 83.3, 100], 'do mais antigo ao mais recente');
  // Os 3 últimos: 4+5+6 de 18 = 83,3%
  assert.deepEqual([port.recentCorrect, port.recentTotal, port.recentPct], [15, 18, 83.3]);
  assert.deepEqual([port.status, port.margin, port.trend, port.lowSample], ['above', 33.3, 'up', false]);

  const dir = overview.disciplines.find((d) => d.name === 'Direito Administrativo')!;
  assert.deepEqual([dir.recentCorrect, dir.recentTotal, dir.recentPct], [9, 12, 75]);
  assert.deepEqual([dir.status, dir.margin, dir.lowSample], ['above', 0, false]);
  assert.equal(overview.attempts[0].finishedAt, '2026-10-12T10:00:00.000Z', 'o mais recente primeiro');
  assert.equal(overview.attempts[0].verdict, 'above');
  assert.equal(overview.attempts[3].verdict, 'below');
  assert.equal(overview.unmatched.length, 0);
});

test('acompanhamento: poucas questões recentes sinaliza incerteza, e queda é queda', () => {
  const db = newDb();
  addExam(db, 'e1', 'Prova A', '2026-12-01', [['Língua Portuguesa', '60%', 20, 1]]);
  const { ids, notebook } = seeded(db);
  takeSimulado(db, notebook.id, ids, { port: 6, dir: 0 }, '2026-10-01T10:00:00Z');
  takeSimulado(db, notebook.id, ids, { port: 1, dir: 0 }, '2026-10-05T10:00:00Z');
  const overview = cutoffOverview(db, 'u1', undefined, NOW);
  const port = overview.disciplines[0];
  assert.equal(port.recentTotal, 12);
  assert.equal(port.lowSample, false);
  assert.equal(port.trend, 'down');
  assert.equal(port.recentPct, 58.3, '7 de 12');
  assert.equal(port.status, 'below', '58,3% contra 60%');
});

test('acompanhamento: só os últimos simulados, e cada usuário vê os seus', () => {
  const db = newDb();
  addExam(db, 'e1', 'Prova A', '2026-12-01', [['Língua Portuguesa', '50%', 20, 1]]);
  const mine = seeded(db, 'u1', 'Minha');
  const theirs = seeded(db, 'u2', 'Dele');
  for (let i = 0; i < OVERVIEW_ATTEMPTS + 3; i++) takeSimulado(db, mine.notebook.id, mine.ids, { port: 3, dir: 2 }, `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`);
  takeSimulado(db, theirs.notebook.id, theirs.ids, { port: 6, dir: 4 }, '2026-10-02T10:00:00Z', 'u2');
  const overview = cutoffOverview(db, 'u1', undefined, NOW);
  assert.equal(overview.attemptCount, OVERVIEW_ATTEMPTS);
  assert.equal(overview.disciplines[0].series.length, OVERVIEW_ATTEMPTS);
  assert.equal(cutoffOverview(db, 'u2', undefined, NOW).attemptCount, 1);
  assert.equal(cutoffOverview(db, 'u2', undefined, NOW).exam, null, 'o outro usuário não tem concurso e não enxerga o meu');
});

test('acompanhamento: disciplina do simulado que não casa com o concurso fica à parte', () => {
  const db = newDb();
  addExam(db, 'e1', 'Prova A', '2026-12-01', [['Informática', '50%', 20, 1]]);
  const { ids, notebook } = seeded(db);
  takeSimulado(db, notebook.id, ids, { port: 3, dir: 2 }, '2026-10-01T10:00:00Z');
  takeSimulado(db, notebook.id, ids, { port: 6, dir: 4 }, '2026-10-02T10:00:00Z');
  const overview = cutoffOverview(db, 'u1', undefined, NOW);
  assert.equal(overview.disciplines.length, 0);
  assert.deepEqual(overview.unmatched.map((u) => [u.label, u.total, u.correct, u.pct]), [
    ['Língua Portuguesa', 12, 9, 75],
    ['Direito Administrativo', 8, 6, 75],
  ]);
});
