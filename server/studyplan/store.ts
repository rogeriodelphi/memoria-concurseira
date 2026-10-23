import type { DatabaseSync } from 'node:sqlite';

import { notFrozen } from '../collections/frozen';
import type { FlashcardRow } from '../mappers';
import { newCardsForToday, parseDailyNewLimit } from './limit';
import { getNewCardOrder, pickNewCardIdsByExam } from './newOrder';

export type DueRow = FlashcardRow & { collection_name: string; collection_subject: string };

export function getDailyNewLimit(db: DatabaseSync, userId: string): number | null {
  const row = db.prepare('SELECT daily_new_limit AS limit_value FROM users WHERE id = ?').get(userId) as unknown as
    | { limit_value: number | null }
    | undefined;
  return row?.limit_value ?? null;
}

export function setDailyNewLimit(db: DatabaseSync, userId: string, raw: unknown) {
  const parsed = parseDailyNewLimit(raw);
  if (!parsed.ok) return parsed;
  db.prepare('UPDATE users SET daily_new_limit = ? WHERE id = ?').run(parsed.value, userId);
  return parsed;
}

/** O começo do dia local (do servidor, que é o mesmo computador do navegador) e o do dia seguinte. */
export function localDayBounds(now: Date): { start: string; end: string } {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(),
  };
}

/**
 * Quantos cartões foram estudados pela PRIMEIRA vez hoje: os que têm a primeira revisão de todos
 * os tempos dentro do dia. É a mesma definição de "novo aprendido" do painel. Desfazer uma
 * avaliação apaga a revisão e o cartão volta a contar como novo.
 */
export function countNewLearnedToday(db: DatabaseSync, userId: string, now: Date): number {
  const { start, end } = localDayBounds(now);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT MIN(studied_at) AS first_review FROM study_sessions WHERE user_id = ? GROUP BY flashcard_id
       ) WHERE first_review >= ? AND first_review < ?`,
    )
    .get(userId, start, end) as unknown as { n: number };
  return row.n;
}

export const SELECT_CARDS = `SELECT f.*, c.name AS collection_name, c.subject AS collection_subject FROM flashcards f JOIN collections c ON c.id = f.collection_id`;

/**
 * Os `count` novos que entram hoje na ordem do edital (ver `pickByExamWeight`), ou `null` para o
 * chamador usar a ordem de criação: quando não há concurso com data, e também se algo falhar. Uma falha
 * aqui não pode derrubar a fila de estudo.
 */
function newCardsByExam(db: DatabaseSync, userId: string, now: Date, count: number): DueRow[] | null {
  try {
    const ids = pickNewCardIdsByExam(db, userId, now, count);
    if (ids === null || ids.length === 0) return null;
    const rows = db
      .prepare(`${SELECT_CARDS} WHERE f.id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids) as unknown as DueRow[];
    const position = new Map(ids.map((id, i) => [id, i]));
    return rows.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  } catch (err) {
    console.error('  ✗ A ordem dos novos pelo edital falhou; usando a ordem de criação:', err);
    return null;
  }
}

export interface DueSelection {
  /** Os cartões da fila de revisão: os novos primeiro, depois os vencidos. */
  cards: DueRow[];
  /** Cartões novos que ficaram de fora por causa do limite diário (0 sem limite). */
  waitingNew: number;
}

/**
 * A fila da revisão global: todos os cartões já estudados e vencidos, mais os novos — todos eles
 * sem limite diário, ou só quantos ainda cabem hoje. Os novos que entram são os mais antigos
 * (na ordem em que foram criados ou importados), para um lote de cartões ser estudado
 * por inteiro antes do seguinte. Coleções congeladas ficam de fora (também de `waitingNew`).
 */
export function selectDueCards(
  db: DatabaseSync,
  userId: string,
  now: Date = new Date(),
  options: { collectionIds?: string[] } = {},
): DueSelection {
  // Com coleções escolhidas (estudar uma disciplina inteira) a fila é só delas, e sem limite
  // diário: quem escolhe o que estudar não é contido pelo limite — como estudar uma coleção direto.
  const only = options.collectionIds;
  const scope = only ? `AND c.id IN (${only.map(() => '?').join(', ')})` : '';
  const scopeArgs = only ?? [];
  const limit = only ? null : getDailyNewLimit(db, userId);

  const totalNew = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM flashcards f JOIN collections c ON c.id = f.collection_id
         WHERE c.user_id = ? ${scope} AND f.due_at IS NULL AND ${notFrozen('c.id')}`,
      )
      .get(userId, ...scopeArgs) as unknown as { n: number }
  ).n;
  const allowed = newCardsForToday(totalNew, limit, limit === null ? 0 : countNewLearnedToday(db, userId, now));

  // A ordem dos novos só muda quem entra quando eles não cabem todos: com limite, e só na fila geral
  // (com coleções escolhidas entram todos).
  const byExam = allowed > 0 && allowed < totalNew && limit !== null && getNewCardOrder(db, userId) === 'exam';
  const newCards =
    allowed === 0
      ? []
      : (byExam ? newCardsByExam(db, userId, now, allowed) : null) ??
        (db
          .prepare(
            `${SELECT_CARDS} WHERE c.user_id = ? ${scope} AND f.due_at IS NULL AND ${notFrozen('c.id')} ORDER BY f.created_at ASC, f.rowid ASC LIMIT ?`,
          )
          .all(userId, ...scopeArgs, allowed) as unknown as DueRow[]);
  const dueCards = db
    .prepare(`${SELECT_CARDS} WHERE c.user_id = ? ${scope} AND f.due_at IS NOT NULL AND f.due_at <= ? AND ${notFrozen('c.id')} ORDER BY f.due_at ASC`)
    .all(userId, ...scopeArgs, now.toISOString()) as unknown as DueRow[];

  return { cards: [...newCards, ...dueCards], waitingNew: totalNew - newCards.length };
}
