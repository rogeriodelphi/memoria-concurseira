import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const MIN_NAME_CHARS = 2;
export const MAX_NAME_CHARS = 80;
export const MAX_CARDS_PER_REQUEST = 500;
export const MAX_ANSWERS_PER_ATTEMPT = 2000;
/** Uma tentativa não dura mais que isto: um valor absurdo (aba esquecida aberta) não vira "tempo". */
export const MAX_ATTEMPT_MS = 24 * 60 * 60 * 1000;
const MAX_ANSWER_MS = 60 * 60 * 1000;
const ATTEMPTS_IN_DETAIL = 20;

export type Failure = { ok: false; status: 400 | 404 | 409; error: string };
export type Result<T> = { ok: true; value: T } | Failure;

const fail = (status: Failure['status'], error: string): Failure => ({ ok: false, status, error });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export interface MockExamSummary {
  id: string;
  name: string;
  cardCount: number;
  attemptCount: number;
  lastAttempt: { finishedAt: string; total: number; correct: number } | null;
  /** Só quando a listagem foi pedida para um cartão: ele já está nesta lista? */
  containsCard?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MockExamCard {
  id: string;
  question: string;
  answer: string;
  format: 'plain' | 'html';
  collectionId: string;
  collectionName: string;
}

export interface MockExamAttempt {
  id: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  correct: number;
}

export interface MockExamDetail {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cards: MockExamCard[];
  /** As últimas tentativas, da mais recente para a mais antiga. */
  attempts: MockExamAttempt[];
  /** Os cartões (que ainda estão na lista) que o usuário errou na tentativa mais recente. */
  lastWrongFlashcardIds: string[];
}

interface ExamRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  card_count?: number;
  attempt_count?: number;
  contains_card?: number;
}

function cleanName(raw: unknown): Result<string> {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (name.length < MIN_NAME_CHARS) return fail(400, `O nome do simulado precisa ter pelo menos ${MIN_NAME_CHARS} caracteres.`);
  if (name.length > MAX_NAME_CHARS) return fail(400, `O nome do simulado passa de ${MAX_NAME_CHARS} caracteres.`);
  return ok(name);
}

function loadExam(db: DatabaseSync, userId: string, id: string): ExamRow | null {
  const row = db.prepare('SELECT id, name, created_at, updated_at FROM mock_exams WHERE id = ? AND user_id = ?').get(id, userId);
  return (row as unknown as ExamRow | undefined) ?? null;
}

function nameTaken(db: DatabaseSync, userId: string, name: string, exceptId?: string): boolean {
  const row = db
    .prepare('SELECT id FROM mock_exams WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?')
    .get(userId, name, exceptId ?? '');
  return row !== undefined;
}

const NOT_FOUND = 'Simulado não encontrado.';
const DUPLICATE_NAME = 'Você já tem um simulado com esse nome.';

function summarize(db: DatabaseSync, row: ExamRow): MockExamSummary {
  const last = db
    .prepare(
      'SELECT finished_at, total, correct FROM mock_exam_attempts WHERE mock_exam_id = ? ORDER BY finished_at DESC, rowid DESC LIMIT 1',
    )
    .get(row.id) as unknown as { finished_at: string; total: number; correct: number } | undefined;
  return {
    id: row.id,
    name: row.name,
    cardCount: row.card_count ?? 0,
    attemptCount: row.attempt_count ?? 0,
    lastAttempt: last ? { finishedAt: last.finished_at, total: last.total, correct: last.correct } : null,
    ...(row.contains_card !== undefined ? { containsCard: row.contains_card === 1 } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Os simulados do usuário, em ordem alfabética. Com `flashcardId`, cada um diz se já tem esse cartão. */
export function listMockExams(db: DatabaseSync, userId: string, flashcardId?: string): MockExamSummary[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.name, m.created_at, m.updated_at,
         (SELECT COUNT(*) FROM mock_exam_cards c WHERE c.mock_exam_id = m.id) AS card_count,
         (SELECT COUNT(*) FROM mock_exam_attempts a WHERE a.mock_exam_id = m.id) AS attempt_count,
         ${
           flashcardId
             ? 'EXISTS(SELECT 1 FROM mock_exam_cards c WHERE c.mock_exam_id = m.id AND c.flashcard_id = ?)'
             : 'NULL'
         } AS contains_card
       FROM mock_exams m WHERE m.user_id = ? ORDER BY m.name COLLATE NOCASE`,
    )
    .all(...(flashcardId ? [flashcardId, userId] : [userId])) as unknown as ExamRow[];
  return rows.map((row) => summarize(db, row.contains_card === null ? { ...row, contains_card: undefined } : row));
}

export function createMockExam(db: DatabaseSync, userId: string, rawName: unknown): Result<MockExamSummary> {
  const name = cleanName(rawName);
  if (!name.ok) return name;
  if (nameTaken(db, userId, name.value)) return fail(409, DUPLICATE_NAME);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO mock_exams (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    userId,
    name.value,
    now,
    now,
  );
  return ok(summarize(db, { id, name: name.value, created_at: now, updated_at: now }));
}

export function renameMockExam(db: DatabaseSync, userId: string, id: string, rawName: unknown): Result<MockExamSummary> {
  const exam = loadExam(db, userId, id);
  if (!exam) return fail(404, NOT_FOUND);
  const name = cleanName(rawName);
  if (!name.ok) return name;
  if (nameTaken(db, userId, name.value, id)) return fail(409, DUPLICATE_NAME);

  const now = new Date().toISOString();
  db.prepare('UPDATE mock_exams SET name = ?, updated_at = ? WHERE id = ?').run(name.value, now, id);
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM mock_exam_cards WHERE mock_exam_id = ?) AS card_count,
              (SELECT COUNT(*) FROM mock_exam_attempts WHERE mock_exam_id = ?) AS attempt_count`,
    )
    .get(id, id) as unknown as { card_count: number; attempt_count: number };
  return ok(summarize(db, { ...exam, name: name.value, updated_at: now, ...counts }));
}

export function deleteMockExam(db: DatabaseSync, userId: string, id: string): Result<null> {
  if (!loadExam(db, userId, id)) return fail(404, NOT_FOUND);
  db.prepare('DELETE FROM mock_exams WHERE id = ?').run(id);
  return ok(null);
}

export function getMockExamDetail(db: DatabaseSync, userId: string, id: string): Result<MockExamDetail> {
  const exam = loadExam(db, userId, id);
  if (!exam) return fail(404, NOT_FOUND);

  const cards = db
    .prepare(
      `SELECT f.id, f.question, f.answer, f.format, f.collection_id, c.name AS collection_name
       FROM mock_exam_cards mc
       JOIN flashcards f ON f.id = mc.flashcard_id
       JOIN collections c ON c.id = f.collection_id
       WHERE mc.mock_exam_id = ?
       ORDER BY mc.added_at, mc.rowid`,
    )
    .all(id) as unknown as {
    id: string;
    question: string;
    answer: string;
    format: string;
    collection_id: string;
    collection_name: string;
  }[];

  const attempts = db
    .prepare(
      `SELECT id, finished_at, duration_ms, total, correct FROM mock_exam_attempts
       WHERE mock_exam_id = ? ORDER BY finished_at DESC, rowid DESC LIMIT ?`,
    )
    .all(id, ATTEMPTS_IN_DETAIL) as unknown as {
    id: string;
    finished_at: string;
    duration_ms: number;
    total: number;
    correct: number;
  }[];

  const wrong =
    attempts.length === 0
      ? []
      : (db
          .prepare(
            `SELECT a.flashcard_id FROM mock_exam_answers a
             JOIN mock_exam_cards mc ON mc.flashcard_id = a.flashcard_id AND mc.mock_exam_id = ?
             WHERE a.attempt_id = ? AND a.correct = 0`,
          )
          .all(id, attempts[0].id) as unknown as { flashcard_id: string }[]);

  return ok({
    id: exam.id,
    name: exam.name,
    createdAt: exam.created_at,
    updatedAt: exam.updated_at,
    cards: cards.map((c) => ({
      id: c.id,
      question: c.question,
      answer: c.answer,
      format: c.format === 'html' ? 'html' : 'plain',
      collectionId: c.collection_id,
      collectionName: c.collection_name,
    })),
    attempts: attempts.map((a) => ({
      id: a.id,
      finishedAt: a.finished_at,
      durationMs: a.duration_ms,
      total: a.total,
      correct: a.correct,
    })),
    lastWrongFlashcardIds: wrong.map((w) => w.flashcard_id),
  });
}

/** Põe cartões numa lista. Os que não são do usuário são ignorados; os que já estavam lá não duplicam. */
export function addCards(
  db: DatabaseSync,
  userId: string,
  id: string,
  flashcardIds: unknown,
): Result<{ added: number; alreadyInside: number }> {
  if (!loadExam(db, userId, id)) return fail(404, NOT_FOUND);
  if (!Array.isArray(flashcardIds) || flashcardIds.length === 0 || !flashcardIds.every((x) => typeof x === 'string')) {
    return fail(400, 'Escolha ao menos um cartão.');
  }
  if (flashcardIds.length > MAX_CARDS_PER_REQUEST) {
    return fail(400, `Escolha no máximo ${MAX_CARDS_PER_REQUEST} cartões por vez.`);
  }

  const owned = db.prepare(
    `SELECT f.id FROM flashcards f JOIN collections c ON c.id = f.collection_id WHERE f.id = ? AND c.user_id = ?`,
  );
  const insert = db.prepare('INSERT OR IGNORE INTO mock_exam_cards (mock_exam_id, flashcard_id, added_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  let added = 0;
  let alreadyInside = 0;
  let found = 0;

  db.exec('BEGIN');
  try {
    for (const flashcardId of new Set(flashcardIds as string[])) {
      if (!owned.get(flashcardId, userId)) continue;
      found++;
      const changes = Number(insert.run(id, flashcardId, now).changes);
      if (changes > 0) added++;
      else alreadyInside++;
    }
    if (added > 0) db.prepare('UPDATE mock_exams SET updated_at = ? WHERE id = ?').run(now, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (found === 0) return fail(404, 'Cartão não encontrado.');
  return ok({ added, alreadyInside });
}

export function removeCard(db: DatabaseSync, userId: string, id: string, flashcardId: string): Result<null> {
  if (!loadExam(db, userId, id)) return fail(404, NOT_FOUND);
  db.prepare('DELETE FROM mock_exam_cards WHERE mock_exam_id = ? AND flashcard_id = ?').run(id, flashcardId);
  db.prepare('UPDATE mock_exams SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  return ok(null);
}

/**
 * Guarda uma tentativa já concluída no navegador: o placar e, por cartão, se acertou. Só contam
 * respostas de cartões que ainda estão na lista (alguém pode ter tirado um no meio da prova), e
 * o mesmo cartão duas vezes vale uma. O servidor refaz o placar a partir das respostas, em vez de
 * acreditar num total enviado.
 */
export function recordAttempt(
  db: DatabaseSync,
  userId: string,
  id: string,
  body: unknown,
  now: Date = new Date(),
): Result<MockExamAttempt> {
  if (!loadExam(db, userId, id)) return fail(404, NOT_FOUND);

  const { durationMs, answers } = (body ?? {}) as { durationMs?: unknown; answers?: unknown };
  if (!Array.isArray(answers) || answers.length === 0) return fail(400, 'Não há respostas para guardar.');
  if (answers.length > MAX_ANSWERS_PER_ATTEMPT) return fail(400, 'Respostas demais para uma tentativa.');

  const inside = new Set(
    (
      db.prepare('SELECT flashcard_id FROM mock_exam_cards WHERE mock_exam_id = ?').all(id) as unknown as {
        flashcard_id: string;
      }[]
    ).map((r) => r.flashcard_id),
  );

  const valid = new Map<string, { correct: boolean; durationMs: number | null }>();
  for (const answer of answers as Record<string, unknown>[]) {
    const flashcardId = answer?.flashcardId;
    if (typeof flashcardId !== 'string' || typeof answer.correct !== 'boolean') continue;
    if (!inside.has(flashcardId) || valid.has(flashcardId)) continue;
    const ms = answer.durationMs;
    valid.set(flashcardId, {
      correct: answer.correct,
      durationMs: typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? Math.min(Math.round(ms), MAX_ANSWER_MS) : null,
    });
  }
  if (valid.size === 0) return fail(400, 'Nenhuma resposta é de um cartão deste simulado.');

  const total = valid.size;
  const correct = [...valid.values()].filter((v) => v.correct).length;
  const duration =
    typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
      ? Math.min(Math.round(durationMs), MAX_ATTEMPT_MS)
      : 0;
  const attemptId = crypto.randomUUID();
  const finishedAt = now.toISOString();

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO mock_exam_attempts (id, mock_exam_id, user_id, finished_at, duration_ms, total, correct) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(attemptId, id, userId, finishedAt, duration, total, correct);
    const insert = db.prepare(
      'INSERT INTO mock_exam_answers (attempt_id, flashcard_id, correct, duration_ms) VALUES (?, ?, ?, ?)',
    );
    for (const [flashcardId, v] of valid) insert.run(attemptId, flashcardId, v.correct ? 1 : 0, v.durationMs);
    db.prepare('UPDATE mock_exams SET updated_at = ? WHERE id = ?').run(finishedAt, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ok({ id: attemptId, finishedAt, durationMs: duration, total, correct });
}
