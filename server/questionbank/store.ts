import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { ANNULLED, clean, cleanAlternatives, MAX_COMMENT_CHARS, normalizeAnswer, oneLine, LEVELS } from '../ai/pastexam';
import { fail, ok, type Result } from '../mockexams/store';
import { groupByProva, type ValidDraft } from './draft';
import { buildWhere, orderSql, PAGE_SIZES, parseFilter, QUESTION_FROM } from './filter';
import type { Alternative, BankTotals, Facets, FacetOption, QuestionView } from './types';

export const MAX_EXAM_NAME_CHARS = 120;
const MAX_NOTE_CHARS = 4_000;
const MAX_ANSWER_MS = 60 * 60 * 1000;
const HISTORY_ENTRIES = 30;
const MAX_IDS_PER_LOAD = 400;

// ---------- leitura das questões ----------

interface QuestionRow {
  id: string;
  exam_id: string;
  exam_name: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: string;
  number: number;
  source_id: string;
  support: string;
  statement: string;
  alternatives_json: string;
  answer: string;
  annulled: number;
  comment: string;
  discipline: string;
  subject: string;
  needs_figure: number;
  suspect: number;
  note: string;
  last_chosen: string | null;
  last_correct: number | null;
  last_at: string | null;
  times_answered: number;
  times_correct: number;
  notebook_count: number;
  has_card: number;
}

const VIEW_SELECT = `
  SELECT q.id, q.exam_id, e.name AS exam_name, e.board, e.organ, e.year, e.position, e.level, q.number, q.source_id, q.support,
         q.statement, q.alternatives_json, q.answer, q.annulled, q.comment, q.discipline, q.subject, q.needs_figure, q.suspect,
         q.note, la.chosen AS last_chosen, la.correct AS last_correct, la.answered_at AS last_at,
         (SELECT COUNT(*) FROM qb_answers a WHERE a.question_id = q.id) AS times_answered,
         (SELECT COUNT(*) FROM qb_answers a WHERE a.question_id = q.id AND a.correct = 1) AS times_correct,
         (SELECT COUNT(*) FROM qb_notebook_questions nq WHERE nq.question_id = q.id) AS notebook_count,
         EXISTS(SELECT 1 FROM qb_question_cards c WHERE c.question_id = q.id) AS has_card
  ${QUESTION_FROM}`;

function parseAlternatives(json: string): Alternative[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Alternative[]) : [];
  } catch {
    return [];
  }
}

function toView(row: QuestionRow, revealAnswer = false): QuestionView {
  const annulled = row.annulled === 1;
  const gradable = !annulled && row.answer !== '';
  const mine = row.last_chosen !== null ? { chosen: row.last_chosen, correct: row.last_correct === 1, answeredAt: row.last_at ?? '' } : null;
  return {
    id: row.id,
    examId: row.exam_id,
    examName: row.exam_name,
    board: row.board,
    organ: row.organ,
    year: row.year,
    position: row.position,
    level: row.level,
    number: row.number,
    sourceId: row.source_id,
    support: row.support,
    statement: row.statement,
    alternatives: parseAlternatives(row.alternatives_json),
    discipline: row.discipline,
    subject: row.subject,
    needsFigure: row.needs_figure === 1,
    suspect: row.suspect === 1,
    annulled,
    gradable,
    note: row.note,
    mine,
    ...(gradable && (revealAnswer || mine) ? { answer: row.answer } : {}),
    // O gabarito comentado entrega a resposta: sai junto com ela (e livre quando a questão não tem como ser respondida).
    ...(row.comment && (!gradable || revealAnswer || mine) ? { comment: row.comment } : {}),
    hasComment: row.comment !== '',
    timesAnswered: row.times_answered,
    timesCorrect: row.times_correct,
    notebookCount: row.notebook_count,
    hasCard: row.has_card === 1,
  };
}

/** As questões com esses ids que são do usuário, na ordem dos ids. */
export function loadQuestionViews(db: DatabaseSync, userId: string, ids: string[], reveal = false): QuestionView[] {
  const wanted = ids.slice(0, MAX_IDS_PER_LOAD);
  if (wanted.length === 0) return [];
  const rows = db
    .prepare(`${VIEW_SELECT} WHERE q.user_id = ? AND q.id IN (${wanted.map(() => '?').join(', ')})`)
    .all(userId, ...wanted) as unknown as QuestionRow[];
  const byId = new Map(rows.map((r) => [r.id, toView(r, reveal)]));
  return wanted.map((id) => byId.get(id)).filter((v): v is QuestionView => v !== undefined);
}

export interface SearchResult {
  questions: QuestionView[];
  total: number;
  page: number;
  pageSize: number;
}

/** As questões de um filtro, uma página por vez. */
export function searchQuestions(db: DatabaseSync, userId: string, body: unknown): SearchResult {
  const input = (body ?? {}) as Record<string, unknown>;
  const filter = parseFilter(input.filter);
  const pageSize = (PAGE_SIZES as readonly unknown[]).includes(input.pageSize) ? (input.pageSize as number) : 20;
  const requested = typeof input.page === 'number' && Number.isInteger(input.page) && input.page > 0 ? input.page : 1;
  const { where, params } = buildWhere(userId, filter);

  const total = (db.prepare(`SELECT COUNT(*) AS n ${QUESTION_FROM} ${where}`).get(...params) as unknown as { n: number }).n;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, lastPage);
  const rows = db
    .prepare(`${VIEW_SELECT} ${where} ORDER BY ${orderSql(input.order)} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as unknown as QuestionRow[];
  return { questions: rows.map((r) => toView(r)), total, page, pageSize };
}

/** Os ids das questões de um filtro que podem ser corrigidas (têm gabarito e não foram anuladas), na ordem pedida. */
export function gradableIds(db: DatabaseSync, userId: string, rawFilter: unknown, order?: unknown): string[] {
  const { where, params } = buildWhere(userId, parseFilter(rawFilter));
  const rows = db
    .prepare(`SELECT q.id ${QUESTION_FROM} ${where} AND q.annulled = 0 AND q.answer != '' ORDER BY ${orderSql(order)}`)
    .all(...params) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

// ---------- opções do filtro e totais ----------

function facet(db: DatabaseSync, userId: string, column: string): FacetOption[] {
  const rows = db
    .prepare(
      `SELECT ${column} AS value, COUNT(*) AS count FROM qb_questions q JOIN qb_exams e ON e.id = q.exam_id
       WHERE q.user_id = ? GROUP BY ${column} COLLATE NOCASE ORDER BY ${column} COLLATE NOCASE`,
    )
    .all(userId) as unknown as { value: string | number | null; count: number }[];
  return rows.filter((r) => r.value !== null).map((r) => ({ value: String(r.value), count: r.count }));
}

export function getFacets(db: DatabaseSync, userId: string): Facets {
  const subject = db
    .prepare(
      `SELECT q.subject AS value, q.discipline, COUNT(*) AS count FROM qb_questions q
       WHERE q.user_id = ? GROUP BY q.discipline COLLATE NOCASE, q.subject COLLATE NOCASE
       ORDER BY q.discipline COLLATE NOCASE, q.subject COLLATE NOCASE`,
    )
    .all(userId) as unknown as { value: string; discipline: string; count: number }[];
  const exam = db
    .prepare(
      `SELECT e.id, e.name AS value, COUNT(q.id) AS count FROM qb_exams e
       LEFT JOIN qb_questions q ON q.exam_id = e.id WHERE e.user_id = ? GROUP BY e.id ORDER BY e.name COLLATE NOCASE`,
    )
    .all(userId) as unknown as { id: string; value: string; count: number }[];
  const years = facet(db, userId, 'e.year').sort((a, b) => Number(b.value) - Number(a.value));
  return {
    discipline: facet(db, userId, 'q.discipline'),
    subject,
    board: facet(db, userId, 'e.board'),
    organ: facet(db, userId, 'e.organ'),
    year: years,
    position: facet(db, userId, 'e.position'),
    level: facet(db, userId, 'e.level'),
    exam,
  };
}

export function getTotals(db: DatabaseSync, userId: string): BankTotals {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS questions,
              (SELECT COUNT(*) FROM qb_exams WHERE user_id = ?) AS exams,
              SUM(CASE WHEN la.id IS NOT NULL THEN 1 ELSE 0 END) AS answered,
              SUM(CASE WHEN la.correct = 1 AND q.annulled = 0 THEN 1 ELSE 0 END) AS correct,
              SUM(q.annulled) AS annulled,
              SUM(CASE WHEN q.answer = '' AND q.annulled = 0 THEN 1 ELSE 0 END) AS without_answer
       ${QUESTION_FROM} WHERE q.user_id = ?`,
    )
    .get(userId, userId) as unknown as {
    questions: number;
    exams: number;
    answered: number | null;
    correct: number | null;
    annulled: number | null;
    without_answer: number | null;
  };
  return {
    questions: row.questions,
    exams: row.exams,
    answered: row.answered ?? 0,
    correct: row.correct ?? 0,
    annulled: row.annulled ?? 0,
    withoutAnswer: row.without_answer ?? 0,
  };
}

// ---------- provas ----------

export interface ExamSummary {
  id: string;
  name: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: string;
  questionCount: number;
  withAnswerCount: number;
  answeredCount: number;
  correctCount: number;
  createdAt: string;
}

interface ExamRow {
  id: string;
  name: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: string;
  created_at: string;
  question_count: number;
  with_answer: number | null;
  answered: number | null;
  correct: number | null;
}

const EXAM_SELECT = `
  SELECT e.id, e.name, e.board, e.organ, e.year, e.position, e.level, e.created_at,
         COUNT(q.id) AS question_count,
         SUM(CASE WHEN q.answer != '' AND q.annulled = 0 THEN 1 ELSE 0 END) AS with_answer,
         SUM(CASE WHEN la.id IS NOT NULL THEN 1 ELSE 0 END) AS answered,
         SUM(CASE WHEN la.correct = 1 AND q.annulled = 0 THEN 1 ELSE 0 END) AS correct
  FROM qb_exams e
  LEFT JOIN qb_questions q ON q.exam_id = e.id
  LEFT JOIN qb_answers la ON la.id = (
    SELECT a.id FROM qb_answers a WHERE a.question_id = q.id ORDER BY a.answered_at DESC, a.rowid DESC LIMIT 1
  )`;

const toExamSummary = (r: ExamRow): ExamSummary => ({
  id: r.id,
  name: r.name,
  board: r.board,
  organ: r.organ,
  year: r.year,
  position: r.position,
  level: r.level,
  questionCount: r.question_count,
  withAnswerCount: r.with_answer ?? 0,
  answeredCount: r.answered ?? 0,
  correctCount: r.correct ?? 0,
  createdAt: r.created_at,
});

export function listExams(db: DatabaseSync, userId: string): ExamSummary[] {
  const rows = db
    .prepare(`${EXAM_SELECT} WHERE e.user_id = ? GROUP BY e.id ORDER BY (e.year IS NULL), e.year DESC, e.name COLLATE NOCASE`)
    .all(userId) as unknown as ExamRow[];
  return rows.map(toExamSummary);
}

function loadExamSummary(db: DatabaseSync, userId: string, id: string): ExamSummary | null {
  const row = db.prepare(`${EXAM_SELECT} WHERE e.user_id = ? AND e.id = ? GROUP BY e.id`).get(userId, id) as unknown as
    | ExamRow
    | undefined;
  return row ? toExamSummary(row) : null;
}

const EXAM_NOT_FOUND = 'Prova não encontrada.';
const DUPLICATE_EXAM = 'Você já tem uma prova com esse nome. Escolha outro nome.';

function examNameTaken(db: DatabaseSync, userId: string, name: string, exceptId = ''): boolean {
  return db.prepare('SELECT id FROM qb_exams WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(userId, name, exceptId) !== undefined;
}

export interface ImportResult {
  /** As provas que receberam questões nesta importação (novas ou já existentes). */
  exams: ExamSummary[];
  added: number;
  /** Questões que já estavam no banco (mesmo código do site) e não entraram de novo. */
  skipped: number;
}

const questionExists = (db: DatabaseSync, userId: string, sourceId: string) =>
  db.prepare('SELECT 1 FROM qb_questions WHERE user_id = ? AND source_id = ?').get(userId, sourceId) !== undefined;

/**
 * Grava a importação revisada (já validada por `validateDraft`), de uma vez ou nada. As questões se agrupam por prova:
 * uma prova comum é uma prova só; a captura de um site de questões vira uma prova para cada nome de prova. Se a prova
 * já existe, as questões novas entram nela (só quando têm o código do site, que impede repetir; sem código seria
 * duplicar a prova). Uma questão que já está no banco, pelo código, não entra de novo.
 */
export function saveImport(db: DatabaseSync, userId: string, draft: ValidDraft, now: Date = new Date()): Result<ImportResult> {
  const groups = groupByProva(draft);
  const createdAt = now.toISOString();
  const touched = new Set<string>();
  let added = 0;
  let skipped = 0;

  // Antes de gravar qualquer coisa: o que não pode entrar (prova repetida sem código) derruba a importação toda.
  for (const group of groups) {
    const existing = db.prepare('SELECT id FROM qb_exams WHERE user_id = ? AND name = ? COLLATE NOCASE').get(userId, group.name);
    if (existing && !group.questions.every((q) => q.sourceId)) return fail(409, DUPLICATE_EXAM);
  }

  db.exec('BEGIN');
  try {
    for (const group of groups) {
      const fresh = group.questions.filter((q) => !q.sourceId || !questionExists(db, userId, q.sourceId));
      skipped += group.questions.length - fresh.length;
      if (fresh.length === 0) continue;

      let examId = (
        db.prepare('SELECT id FROM qb_exams WHERE user_id = ? AND name = ? COLLATE NOCASE').get(userId, group.name) as unknown as
          | { id: string }
          | undefined
      )?.id;
      if (!examId) {
        examId = crypto.randomUUID();
        db.prepare(
          'INSERT INTO qb_exams (id, user_id, name, board, organ, year, position, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(examId, userId, group.name, group.board, group.organ, group.year, group.position, group.level, createdAt);
      }

      // Com código do site o número é só a ordem de chegada: continua de onde a prova parou.
      const renumber = fresh.some((q) => q.sourceId);
      let next = (db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM qb_questions WHERE exam_id = ?').get(examId) as unknown as { n: number }).n + 1;
      const insert = db.prepare(
        `INSERT INTO qb_questions (id, user_id, exam_id, number, source_id, support, statement, alternatives_json, answer, annulled,
           comment, discipline, subject, needs_figure, suspect, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const q of fresh) {
        insert.run(
          crypto.randomUUID(),
          userId,
          examId,
          renumber ? next++ : q.number,
          q.sourceId,
          q.support,
          q.statement,
          JSON.stringify(q.alternatives),
          q.answer,
          q.annulled ? 1 : 0,
          q.comment,
          q.discipline,
          q.subject,
          q.needsFigure ? 1 : 0,
          q.suspect ? 1 : 0,
          createdAt,
        );
        added++;
      }
      touched.add(examId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ok({ exams: [...touched].map((id) => loadExamSummary(db, userId, id)!), added, skipped });
}

/** Grava uma prova revisada (a importação de uma prova comum, que é uma só). */
export function saveExam(db: DatabaseSync, userId: string, draft: ValidDraft, now: Date = new Date()): Result<ExamSummary> {
  const saved = saveImport(db, userId, draft, now);
  if (!saved.ok) return saved;
  return saved.value.exams.length === 1 ? ok(saved.value.exams[0]) : fail(409, 'Esta importação tem mais de uma prova.');
}

export function updateExam(db: DatabaseSync, userId: string, id: string, body: unknown): Result<ExamSummary> {
  const current = loadExamSummary(db, userId, id);
  if (!current) return fail(404, EXAM_NOT_FOUND);
  const input = (body ?? {}) as Record<string, unknown>;

  const name = 'name' in input ? oneLine(input.name, MAX_EXAM_NAME_CHARS) : current.name;
  if (name.length < 2) return fail(400, 'Informe um nome para a prova.');
  if (examNameTaken(db, userId, name, id)) return fail(409, DUPLICATE_EXAM);
  const rawYear = 'year' in input ? (typeof input.year === 'number' ? input.year : Number(input.year)) : current.year;
  const year = Number.isInteger(rawYear) && (rawYear as number) >= 1950 && (rawYear as number) <= 2100 ? (rawYear as number) : null;
  const level = 'level' in input ? (LEVELS as readonly string[]).find((l) => l === input.level) ?? '' : current.level;

  db.prepare('UPDATE qb_exams SET name = ?, board = ?, organ = ?, year = ?, position = ?, level = ? WHERE id = ?').run(
    name,
    'board' in input ? oneLine(input.board, 160) : current.board,
    'organ' in input ? oneLine(input.organ, 160) : current.organ,
    year,
    'position' in input ? oneLine(input.position, 160) : current.position,
    level,
    id,
  );
  return ok(loadExamSummary(db, userId, id)!);
}

export function deleteExam(db: DatabaseSync, userId: string, id: string): Result<null> {
  if (!loadExamSummary(db, userId, id)) return fail(404, EXAM_NOT_FOUND);
  db.prepare('DELETE FROM qb_exams WHERE id = ? AND user_id = ?').run(id, userId);
  return ok(null);
}

// ---------- uma questão ----------

const QUESTION_NOT_FOUND = 'Questão não encontrada.';

interface OwnedQuestion {
  id: string;
  answer: string;
  annulled: number;
  alternatives_json: string;
  comment: string;
}

function ownedQuestion(db: DatabaseSync, userId: string, id: string): OwnedQuestion | null {
  const row = db.prepare('SELECT id, answer, annulled, alternatives_json, comment FROM qb_questions WHERE id = ? AND user_id = ?').get(id, userId);
  return (row as unknown as OwnedQuestion | undefined) ?? null;
}

export interface HistoryEntry {
  chosen: string;
  correct: boolean;
  answeredAt: string;
  durationMs: number | null;
  /** Veio de um simulado (e não de uma resposta avulsa). */
  inSimulado: boolean;
}

export interface QuestionDetail {
  /** Com o gabarito: quem pede o detalhe é quem vai editá-la ou conferir o histórico. */
  question: QuestionView;
  history: HistoryEntry[];
}

export function getQuestionDetail(db: DatabaseSync, userId: string, id: string): Result<QuestionDetail> {
  const views = loadQuestionViews(db, userId, [id], true);
  if (views.length === 0) return fail(404, QUESTION_NOT_FOUND);
  const rows = db
    .prepare(
      `SELECT chosen, correct, answered_at, duration_ms, attempt_id FROM qb_answers WHERE question_id = ?
       ORDER BY answered_at DESC, rowid DESC LIMIT ?`,
    )
    .all(id, HISTORY_ENTRIES) as unknown as {
    chosen: string;
    correct: number;
    answered_at: string;
    duration_ms: number | null;
    attempt_id: string | null;
  }[];
  return ok({
    question: views[0],
    history: rows.map((r) => ({
      chosen: r.chosen,
      correct: r.correct === 1,
      answeredAt: r.answered_at,
      durationMs: r.duration_ms,
      inSimulado: r.attempt_id !== null,
    })),
  });
}

/**
 * Responde uma questão. O servidor corrige: o navegador manda só a letra escolhida e recebe se acertou e qual era
 * a certa. Cada resposta fica no histórico (a última é a que vale para "acertei"/"errei").
 */
export function answerQuestion(
  db: DatabaseSync,
  userId: string,
  id: string,
  body: unknown,
  now: Date = new Date(),
): Result<{ correct: boolean; answer: string; chosen: string; comment: string }> {
  const question = ownedQuestion(db, userId, id);
  if (!question) return fail(404, QUESTION_NOT_FOUND);
  if (question.annulled === 1) return fail(409, 'Esta questão foi anulada: não há resposta certa.');
  if (!question.answer) return fail(409, 'Esta questão ainda não tem gabarito. Informe a alternativa certa para poder respondê-la.');

  const input = (body ?? {}) as Record<string, unknown>;
  const chosen = typeof input.chosen === 'string' ? input.chosen.trim().toUpperCase() : '';
  if (!parseAlternatives(question.alternatives_json).some((a) => a.letter === chosen)) {
    return fail(400, 'Escolha uma das alternativas.');
  }
  const ms = input.durationMs;
  const durationMs = typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? Math.min(Math.round(ms), MAX_ANSWER_MS) : null;
  const correct = chosen === question.answer;
  db.prepare(
    'INSERT INTO qb_answers (id, user_id, question_id, attempt_id, chosen, correct, answered_at, duration_ms) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
  ).run(crypto.randomUUID(), userId, id, chosen, correct ? 1 : 0, now.toISOString(), durationMs);
  // O gabarito comentado vai junto: depois de responder ele já não estraga nada.
  return ok({ correct, answer: question.answer, chosen, comment: question.comment });
}

/**
 * Corrige uma questão: o texto lido errado, o gabarito, a disciplina, a anotação. Mudar o gabarito refaz o
 * "acertei/errei" das respostas que já existem (e o placar dos simulados em que a questão entrou), para o histórico
 * não contradizer o gabarito atual.
 */
export function updateQuestion(db: DatabaseSync, userId: string, id: string, body: unknown): Result<QuestionView> {
  const current = ownedQuestion(db, userId, id);
  if (!current) return fail(404, QUESTION_NOT_FOUND);
  const input = (body ?? {}) as Record<string, unknown>;

  const sets: string[] = [];
  const values: (string | number)[] = [];

  let alternatives = parseAlternatives(current.alternatives_json);
  if ('alternatives' in input) {
    const cleaned = cleanAlternatives(input.alternatives);
    if (!cleaned) return fail(400, 'As alternativas precisam estar em ordem (A, B, C...), de 2 a 5, e sem texto vazio.');
    alternatives = cleaned;
    sets.push('alternatives_json = ?');
    values.push(JSON.stringify(cleaned));
  }
  if ('statement' in input) {
    const statement = clean(input.statement, 6_000);
    if (statement.length < 8) return fail(400, 'O enunciado está curto demais.');
    sets.push('statement = ?');
    values.push(statement);
  }
  if ('support' in input) {
    sets.push('support = ?');
    values.push(clean(input.support, 12_000));
  }
  if ('discipline' in input) {
    sets.push('discipline = ?');
    values.push(oneLine(input.discipline, 160));
  }
  if ('subject' in input) {
    sets.push('subject = ?');
    values.push(oneLine(input.subject, 160));
  }
  if ('note' in input) {
    sets.push('note = ?');
    values.push(clean(input.note, MAX_NOTE_CHARS));
  }
  if ('comment' in input) {
    sets.push('comment = ?');
    values.push(clean(input.comment, MAX_COMMENT_CHARS));
  }
  // O aviso "confira o texto" só sai (quem conferiu o texto marca como conferido); ligar à mão não faz sentido.
  if (input.suspect === false) {
    sets.push('suspect = ?');
    values.push(0);
  }

  let annulled = current.annulled === 1;
  let answer = current.answer;
  if ('answer' in input || 'annulled' in input) {
    const sent = typeof input.answer === 'string' ? input.answer.trim() : '';
    const typed = 'answer' in input ? normalizeAnswer(input.answer) : current.answer;
    if ('answer' in input && sent !== '' && typed === '') return fail(400, 'Gabarito inválido: use uma letra de A a E.');
    if (typed === ANNULLED) {
      annulled = true;
      answer = '';
    } else {
      answer = typed;
      if (typeof input.annulled === 'boolean') annulled = input.annulled;
      else if ('answer' in input && typed) annulled = false; // informar a letra desfaz a anulação
    }
    sets.push('answer = ?', 'annulled = ?');
    values.push(answer, annulled ? 1 : 0);
  }
  if (answer && !alternatives.some((a) => a.letter === answer)) {
    return fail(400, `O gabarito (${answer}) precisa ser uma das alternativas da questão.`);
  }
  if (sets.length === 0) return fail(400, 'Nada para alterar.');

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE qb_questions SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    if (answer !== '' && answer !== current.answer) {
      // O que foi marcado antes continua marcado; só muda se contou como acerto.
      db.prepare('UPDATE qb_answers SET correct = (chosen = ?) WHERE question_id = ?').run(answer, id);
      db.prepare(
        `UPDATE qb_attempts SET correct = (SELECT COALESCE(SUM(a.correct), 0) FROM qb_answers a WHERE a.attempt_id = qb_attempts.id)
         WHERE id IN (SELECT attempt_id FROM qb_answers WHERE question_id = ? AND attempt_id IS NOT NULL)`,
      ).run(id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ok(loadQuestionViews(db, userId, [id], true)[0]);
}

export function deleteQuestion(db: DatabaseSync, userId: string, id: string): Result<null> {
  if (!ownedQuestion(db, userId, id)) return fail(404, QUESTION_NOT_FOUND);
  db.prepare('DELETE FROM qb_questions WHERE id = ? AND user_id = ?').run(id, userId);
  return ok(null);
}
