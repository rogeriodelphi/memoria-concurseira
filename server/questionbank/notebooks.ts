/**
 * Cadernos (listas de questões que o usuário monta a partir de um filtro), tentativas de simulado feitas sobre um
 * caderno e filtros salvos. Cada um só enxerga o que é seu: todo acesso passa pelo `userId`.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { oneLine } from '../ai/pastexam';
import { fail, ok, type Result } from '../mockexams/store';
import { buildWhere, parseFilter, QUESTION_FROM, orderSql, activeCount, type QuestionFilter } from './filter';
import { loadQuestionViews } from './store';
import type { Alternative, QuestionView } from './types';

export const MIN_NAME_CHARS = 2;
export const MAX_NAME_CHARS = 80;
/** Mais que isto num caderno só (uma prova grande tem 120) vira lista difícil de percorrer. */
export const MAX_NOTEBOOK_QUESTIONS = 300;
export const MAX_SAVED_FILTERS = 100;
const MAX_ATTEMPT_MS = 24 * 60 * 60 * 1000;
const ATTEMPTS_IN_DETAIL = 20;

// ---------- cadernos ----------

export interface AttemptSummary {
  id: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  correct: number;
}

export interface NotebookSummary {
  id: string;
  name: string;
  questionCount: number;
  /** Questões do caderno com ao menos uma resposta, e quantas dessas a última resposta acertou. */
  answeredCount: number;
  correctCount: number;
  attemptCount: number;
  lastAttempt: AttemptSummary | null;
  /** Só quando a listagem foi pedida para uma questão: ela já está neste caderno? */
  containsQuestion?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface NotebookRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  question_count: number;
  answered: number | null;
  correct: number | null;
  attempt_count: number;
  contains: number | null;
}

const NOT_FOUND = 'Caderno não encontrado.';
const DUPLICATE_NAME = 'Você já tem um caderno com esse nome.';

function cleanName(raw: unknown, what: string): Result<string> {
  const name = oneLine(raw, 200);
  if (name.length < MIN_NAME_CHARS) return fail(400, `O nome ${what} precisa ter pelo menos ${MIN_NAME_CHARS} caracteres.`);
  if (name.length > MAX_NAME_CHARS) return fail(400, `O nome ${what} passa de ${MAX_NAME_CHARS} caracteres.`);
  return ok(name);
}

function lastAttempt(db: DatabaseSync, notebookId: string): AttemptSummary | null {
  const row = db
    .prepare(
      'SELECT id, finished_at, duration_ms, total, correct FROM qb_attempts WHERE notebook_id = ? ORDER BY finished_at DESC, rowid DESC LIMIT 1',
    )
    .get(notebookId) as unknown as
    | { id: string; finished_at: string; duration_ms: number; total: number; correct: number }
    | undefined;
  return row ? { id: row.id, finishedAt: row.finished_at, durationMs: row.duration_ms, total: row.total, correct: row.correct } : null;
}

function notebookSelect(withContains: boolean): string {
  return `
    SELECT n.id, n.name, n.created_at, n.updated_at,
           COUNT(nq.question_id) AS question_count,
           SUM(CASE WHEN la.id IS NOT NULL THEN 1 ELSE 0 END) AS answered,
           SUM(CASE WHEN la.correct = 1 AND q.annulled = 0 THEN 1 ELSE 0 END) AS correct,
           (SELECT COUNT(*) FROM qb_attempts t WHERE t.notebook_id = n.id) AS attempt_count,
           ${withContains ? 'EXISTS(SELECT 1 FROM qb_notebook_questions x WHERE x.notebook_id = n.id AND x.question_id = ?)' : 'NULL'} AS contains
    FROM qb_notebooks n
    LEFT JOIN qb_notebook_questions nq ON nq.notebook_id = n.id
    LEFT JOIN qb_questions q ON q.id = nq.question_id
    LEFT JOIN qb_answers la ON la.id = (
      SELECT a.id FROM qb_answers a WHERE a.question_id = q.id ORDER BY a.answered_at DESC, a.rowid DESC LIMIT 1
    )`;
}

function toSummary(db: DatabaseSync, row: NotebookRow): NotebookSummary {
  return {
    id: row.id,
    name: row.name,
    questionCount: row.question_count,
    answeredCount: row.answered ?? 0,
    correctCount: row.correct ?? 0,
    attemptCount: row.attempt_count,
    lastAttempt: lastAttempt(db, row.id),
    ...(row.contains !== null ? { containsQuestion: row.contains === 1 } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Os cadernos do usuário, em ordem alfabética. Com `questionId`, cada um diz se já tem essa questão. */
export function listNotebooks(db: DatabaseSync, userId: string, questionId?: string): NotebookSummary[] {
  const rows = db
    .prepare(`${notebookSelect(Boolean(questionId))} WHERE n.user_id = ? GROUP BY n.id ORDER BY n.name COLLATE NOCASE`)
    .all(...(questionId ? [questionId, userId] : [userId])) as unknown as NotebookRow[];
  return rows.map((r) => toSummary(db, r));
}

function loadSummary(db: DatabaseSync, userId: string, id: string): NotebookSummary | null {
  const row = db.prepare(`${notebookSelect(false)} WHERE n.user_id = ? AND n.id = ? GROUP BY n.id`).get(userId, id) as unknown as
    | NotebookRow
    | undefined;
  return row ? toSummary(db, row) : null;
}

const nameTaken = (db: DatabaseSync, table: 'qb_notebooks' | 'qb_saved_filters', userId: string, name: string, exceptId = ''): boolean =>
  db.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?`).get(userId, name, exceptId) !== undefined;

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface CreatedNotebook {
  notebook: NotebookSummary;
  added: number;
  /** Questões do filtro que ficaram de fora por não terem gabarito (ou terem sido anuladas): não dá para corrigi-las. */
  skipped: number;
}

/**
 * Cria um caderno com as questões de um filtro (só as que podem ser corrigidas), no máximo `limit`, na ordem
 * pedida ou sorteadas (`shuffle`). Também aceita uma lista de ids de questões do usuário.
 */
export function createNotebook(
  db: DatabaseSync,
  userId: string,
  body: unknown,
  random: () => number = Math.random,
  now: Date = new Date(),
): Result<CreatedNotebook> {
  const input = (body ?? {}) as Record<string, unknown>;
  const name = cleanName(input.name, 'do caderno');
  if (!name.ok) return name;
  if (nameTaken(db, 'qb_notebooks', userId, name.value)) return fail(409, DUPLICATE_NAME);

  const limit =
    typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit > 0
      ? Math.min(input.limit, MAX_NOTEBOOK_QUESTIONS)
      : MAX_NOTEBOOK_QUESTIONS;

  let ids: string[];
  let skipped = 0;
  if (Array.isArray(input.questionIds)) {
    const wanted = [...new Set(input.questionIds.filter((x): x is string => typeof x === 'string'))].slice(0, MAX_NOTEBOOK_QUESTIONS);
    const owned = db.prepare('SELECT id FROM qb_questions WHERE id = ? AND user_id = ?');
    ids = wanted.filter((id) => owned.get(id, userId) !== undefined);
  } else {
    const filter = parseFilter(input.filter);
    const { where, params } = buildWhere(userId, filter);
    const all = db
      .prepare(`SELECT q.id, (q.annulled = 0 AND q.answer != '') AS gradable ${QUESTION_FROM} ${where} ORDER BY ${orderSql(input.order)}`)
      .all(...params) as unknown as { id: string; gradable: number }[];
    ids = all.filter((r) => r.gradable === 1).map((r) => r.id);
    skipped = all.length - ids.length;
  }
  if (ids.length === 0) {
    return fail(422, 'Nenhuma questão com gabarito corresponde a esse filtro, então não há o que colocar no caderno.');
  }
  if (input.shuffle === true) ids = shuffled(ids, random);
  ids = ids.slice(0, limit);

  const id = crypto.randomUUID();
  const stamp = now.toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO qb_notebooks (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, name.value, stamp, stamp);
    const insert = db.prepare('INSERT INTO qb_notebook_questions (notebook_id, question_id, position) VALUES (?, ?, ?)');
    ids.forEach((questionId, position) => insert.run(id, questionId, position));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ok({ notebook: loadSummary(db, userId, id)!, added: ids.length, skipped });
}

export function renameNotebook(db: DatabaseSync, userId: string, id: string, rawName: unknown): Result<NotebookSummary> {
  if (!loadSummary(db, userId, id)) return fail(404, NOT_FOUND);
  const name = cleanName(rawName, 'do caderno');
  if (!name.ok) return name;
  if (nameTaken(db, 'qb_notebooks', userId, name.value, id)) return fail(409, DUPLICATE_NAME);
  db.prepare('UPDATE qb_notebooks SET name = ?, updated_at = ? WHERE id = ?').run(name.value, new Date().toISOString(), id);
  return ok(loadSummary(db, userId, id)!);
}

export function deleteNotebook(db: DatabaseSync, userId: string, id: string): Result<null> {
  if (!loadSummary(db, userId, id)) return fail(404, NOT_FOUND);
  db.prepare('DELETE FROM qb_notebooks WHERE id = ? AND user_id = ?').run(id, userId);
  return ok(null);
}

export interface NotebookDetail {
  notebook: NotebookSummary;
  questions: QuestionView[];
  attempts: AttemptSummary[];
}

export function getNotebookDetail(db: DatabaseSync, userId: string, id: string): Result<NotebookDetail> {
  const notebook = loadSummary(db, userId, id);
  if (!notebook) return fail(404, NOT_FOUND);
  const ids = (
    db.prepare('SELECT question_id FROM qb_notebook_questions WHERE notebook_id = ? ORDER BY position').all(id) as unknown as {
      question_id: string;
    }[]
  ).map((r) => r.question_id);
  const attempts = db
    .prepare(
      'SELECT id, finished_at, duration_ms, total, correct FROM qb_attempts WHERE notebook_id = ? ORDER BY finished_at DESC, rowid DESC LIMIT ?',
    )
    .all(id, ATTEMPTS_IN_DETAIL) as unknown as { id: string; finished_at: string; duration_ms: number; total: number; correct: number }[];
  return ok({
    notebook,
    questions: loadQuestionViews(db, userId, ids),
    attempts: attempts.map((a) => ({ id: a.id, finishedAt: a.finished_at, durationMs: a.duration_ms, total: a.total, correct: a.correct })),
  });
}

/** Põe questões num caderno (as que não são do usuário são ignoradas; as que já estavam lá não duplicam). */
export function addQuestions(db: DatabaseSync, userId: string, id: string, questionIds: unknown): Result<{ added: number; alreadyInside: number }> {
  if (!loadSummary(db, userId, id)) return fail(404, NOT_FOUND);
  if (!Array.isArray(questionIds) || questionIds.length === 0 || !questionIds.every((x) => typeof x === 'string')) {
    return fail(400, 'Escolha ao menos uma questão.');
  }
  if (questionIds.length > MAX_NOTEBOOK_QUESTIONS) return fail(400, `Escolha no máximo ${MAX_NOTEBOOK_QUESTIONS} questões por vez.`);

  const owned = db.prepare('SELECT id FROM qb_questions WHERE id = ? AND user_id = ?');
  const exists = db.prepare('SELECT 1 FROM qb_notebook_questions WHERE notebook_id = ? AND question_id = ?');
  const insert = db.prepare('INSERT INTO qb_notebook_questions (notebook_id, question_id, position) VALUES (?, ?, ?)');
  let position = (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM qb_notebook_questions WHERE notebook_id = ?').get(id) as unknown as { p: number }).p + 1;
  let added = 0;
  let alreadyInside = 0;
  let found = 0;

  db.exec('BEGIN');
  try {
    for (const questionId of new Set(questionIds as string[])) {
      if (!owned.get(questionId, userId)) continue;
      found++;
      if (exists.get(id, questionId)) {
        alreadyInside++;
        continue;
      }
      insert.run(id, questionId, position++);
      added++;
    }
    if (added > 0) db.prepare('UPDATE qb_notebooks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (found === 0) return fail(404, 'Questão não encontrada.');
  return ok({ added, alreadyInside });
}

export function removeQuestion(db: DatabaseSync, userId: string, id: string, questionId: string): Result<null> {
  if (!loadSummary(db, userId, id)) return fail(404, NOT_FOUND);
  db.prepare('DELETE FROM qb_notebook_questions WHERE notebook_id = ? AND question_id = ?').run(id, questionId);
  db.prepare('UPDATE qb_notebooks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  return ok(null);
}

// ---------- simulado ----------

export interface AttemptResult {
  questionId: string;
  /** A letra marcada, ou vazio se ficou em branco. */
  chosen: string;
  correct: boolean;
  answer: string;
}

/**
 * Guarda um simulado concluído no navegador: o placar é refeito aqui, a partir das letras marcadas e do gabarito do
 * servidor. Questão em branco conta como errada; as que perderam o gabarito (ou foram anuladas) depois de entrarem
 * no caderno ficam de fora. Devolve a correção de cada questão, com a alternativa certa.
 */
export function recordSimulado(
  db: DatabaseSync,
  userId: string,
  id: string,
  body: unknown,
  now: Date = new Date(),
): Result<{ attempt: AttemptSummary; results: AttemptResult[] }> {
  if (!loadSummary(db, userId, id)) return fail(404, NOT_FOUND);
  const input = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(input.answers)) return fail(400, 'Não há respostas para guardar.');

  const rows = db
    .prepare(
      `SELECT q.id, q.answer, q.annulled, q.alternatives_json FROM qb_notebook_questions nq
       JOIN qb_questions q ON q.id = nq.question_id WHERE nq.notebook_id = ? AND q.user_id = ? ORDER BY nq.position`,
    )
    .all(id, userId) as unknown as { id: string; answer: string; annulled: number; alternatives_json: string }[];
  const gradable = rows.filter((r) => r.annulled === 0 && r.answer !== '');
  if (gradable.length === 0) return fail(422, 'Este caderno não tem questões com gabarito.');

  const chosenBy = new Map<string, string>();
  for (const item of input.answers as Record<string, unknown>[]) {
    const questionId = item?.questionId;
    const letter = typeof item?.chosen === 'string' ? item.chosen.trim().toUpperCase() : '';
    if (typeof questionId !== 'string' || !letter || chosenBy.has(questionId)) continue;
    chosenBy.set(questionId, letter);
  }

  const results: AttemptResult[] = gradable.map((row) => {
    const alternatives = JSON.parse(row.alternatives_json) as Alternative[];
    const picked = chosenBy.get(row.id) ?? '';
    const chosen = alternatives.some((a) => a.letter === picked) ? picked : '';
    return { questionId: row.id, chosen, correct: chosen !== '' && chosen === row.answer, answer: row.answer };
  });
  if (results.every((r) => r.chosen === '')) return fail(400, 'Responda ao menos uma questão antes de finalizar.');

  const durationMs =
    typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) && input.durationMs >= 0
      ? Math.min(Math.round(input.durationMs), MAX_ATTEMPT_MS)
      : 0;
  const attempt: AttemptSummary = {
    id: crypto.randomUUID(),
    finishedAt: now.toISOString(),
    durationMs,
    total: results.length,
    correct: results.filter((r) => r.correct).length,
  };

  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO qb_attempts (id, notebook_id, user_id, finished_at, duration_ms, total, correct) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      attempt.id,
      id,
      userId,
      attempt.finishedAt,
      attempt.durationMs,
      attempt.total,
      attempt.correct,
    );
    const insert = db.prepare(
      'INSERT INTO qb_answers (id, user_id, question_id, attempt_id, chosen, correct, answered_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
    );
    for (const r of results) if (r.chosen) insert.run(crypto.randomUUID(), userId, r.questionId, attempt.id, r.chosen, r.correct ? 1 : 0, attempt.finishedAt);
    db.prepare('UPDATE qb_notebooks SET updated_at = ? WHERE id = ?').run(attempt.finishedAt, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ok({ attempt, results });
}

// ---------- filtros salvos ----------

export interface SavedFilter {
  id: string;
  name: string;
  filter: QuestionFilter;
  createdAt: string;
}

export function listSavedFilters(db: DatabaseSync, userId: string): SavedFilter[] {
  const rows = db
    .prepare('SELECT id, name, filter_json, created_at FROM qb_saved_filters WHERE user_id = ? ORDER BY name COLLATE NOCASE')
    .all(userId) as unknown as { id: string; name: string; filter_json: string; created_at: string }[];
  return rows.map((r) => {
    let raw: unknown = {};
    try {
      raw = JSON.parse(r.filter_json);
    } catch {
      // um filtro corrompido volta vazio em vez de derrubar a lista
    }
    return { id: r.id, name: r.name, filter: parseFilter(raw), createdAt: r.created_at };
  });
}

export function saveFilter(db: DatabaseSync, userId: string, body: unknown, now: Date = new Date()): Result<SavedFilter> {
  const input = (body ?? {}) as Record<string, unknown>;
  const name = cleanName(input.name, 'do filtro');
  if (!name.ok) return name;
  const filter = parseFilter(input.filter);
  if (activeCount(filter) === 0) return fail(400, 'Marque ao menos um critério antes de salvar o filtro.');
  if (nameTaken(db, 'qb_saved_filters', userId, name.value)) return fail(409, 'Você já tem um filtro com esse nome.');
  const count = (db.prepare('SELECT COUNT(*) AS n FROM qb_saved_filters WHERE user_id = ?').get(userId) as unknown as { n: number }).n;
  if (count >= MAX_SAVED_FILTERS) return fail(409, `Você já tem ${MAX_SAVED_FILTERS} filtros salvos. Apague algum para salvar outro.`);

  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  db.prepare('INSERT INTO qb_saved_filters (id, user_id, name, filter_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    userId,
    name.value,
    JSON.stringify(filter),
    createdAt,
  );
  return ok({ id, name: name.value, filter, createdAt });
}

export function deleteSavedFilter(db: DatabaseSync, userId: string, id: string): Result<null> {
  const removed = db.prepare('DELETE FROM qb_saved_filters WHERE id = ? AND user_id = ?').run(id, userId);
  if (Number(removed.changes) === 0) return fail(404, 'Filtro não encontrado.');
  return ok(null);
}
