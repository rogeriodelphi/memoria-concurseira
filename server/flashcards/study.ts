import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { nextSrsState, type StudyResult } from '../srs';

/** O que `recordStudy` precisa saber do cartão: o agendamento de antes da avaliação. */
export interface StudiedCard {
  id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_at: string | null;
}

/**
 * Grava uma avaliação: o registro da revisão e o novo agendamento do cartão. O registro
 * guarda o agendamento de ANTES, e é com ele que `undoStudy` desfaz a avaliação.
 * As duas escritas juntas, ou nenhuma.
 */
export function recordStudy(
  db: DatabaseSync,
  userId: string,
  card: StudiedCard,
  result: StudyResult,
  durationMs: number | null,
  now: Date = new Date(),
): { sessionId: string; dueAt: string } {
  const sessionId = crypto.randomUUID();
  const next = nextSrsState(
    { easeFactor: card.ease_factor, intervalDays: card.interval_days, repetitions: card.repetitions },
    result,
  );

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO study_sessions
         (id, flashcard_id, user_id, result, studied_at, duration_ms,
          prev_ease_factor, prev_interval_days, prev_repetitions, prev_due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      card.id,
      userId,
      result,
      now.toISOString(),
      durationMs,
      card.ease_factor,
      card.interval_days,
      card.repetitions,
      card.due_at,
    );
    db.prepare('UPDATE flashcards SET ease_factor = ?, interval_days = ?, repetitions = ?, due_at = ? WHERE id = ?').run(
      next.easeFactor,
      next.intervalDays,
      next.repetitions,
      next.dueAt,
      card.id,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { sessionId, dueAt: next.dueAt };
}

export type UndoResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

interface SessionRow {
  prev_ease_factor: number | null;
  prev_interval_days: number | null;
  prev_repetitions: number | null;
  prev_due_at: string | null;
}

/**
 * Desfaz uma avaliação: devolve ao cartão o agendamento que ele tinha antes e apaga o
 * registro da revisão (o painel deixa de contá-la). Só desfaz a ÚLTIMA avaliação do cartão:
 * se ele foi estudado de novo depois (em outra aba, por exemplo), restaurar o estado antigo
 * apagaria essa revisão mais nova.
 */
export function undoStudy(db: DatabaseSync, userId: string, flashcardId: string, sessionId: string): UndoResult {
  const session = db
    .prepare(
      `SELECT prev_ease_factor, prev_interval_days, prev_repetitions, prev_due_at
       FROM study_sessions WHERE id = ? AND flashcard_id = ? AND user_id = ?`,
    )
    .get(sessionId, flashcardId, userId) as unknown as SessionRow | undefined;
  if (!session) return { ok: false, status: 404, error: 'Avaliação não encontrada.' };

  if (session.prev_ease_factor === null || session.prev_interval_days === null || session.prev_repetitions === null) {
    return { ok: false, status: 409, error: 'Esta avaliação é antiga demais para ser desfeita.' };
  }

  const latest = db
    .prepare('SELECT id FROM study_sessions WHERE flashcard_id = ? ORDER BY studied_at DESC, rowid DESC LIMIT 1')
    .get(flashcardId) as unknown as { id: string };
  if (latest.id !== sessionId) {
    return { ok: false, status: 409, error: 'Este cartão foi estudado de novo depois dessa avaliação.' };
  }

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE flashcards SET ease_factor = ?, interval_days = ?, repetitions = ?, due_at = ? WHERE id = ?').run(
      session.prev_ease_factor,
      session.prev_interval_days,
      session.prev_repetitions,
      session.prev_due_at,
      flashcardId,
    );
    db.prepare('DELETE FROM study_sessions WHERE id = ?').run(sessionId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
}
