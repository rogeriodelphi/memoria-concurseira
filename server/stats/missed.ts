/**
 * Os cartões que o usuário errou (Errei ou Difícil) num período, em coleções escolhidas: é a lista de "Revisar só
 * isso" dos pontos de atenção do "Meu desempenho". Vale para qualquer cartão, vencido ou não: quem escolhe revisar
 * os que errou não é contido pela data de vencimento (revisar antes do prazo é o mesmo que "estudar tudo mesmo
 * assim" de uma coleção). Coleções congeladas ficam de fora, como em toda revisão (o histórico delas continua valendo no
 * Meu desempenho, e o número de errados dos pontos de atenção já as desconta). Só leitura: nada muda até o usuário avaliar
 * os cartões na revisão.
 */
import type { DatabaseSync } from 'node:sqlite';

import { notFrozen } from '../collections/frozen';
import type { FlashcardRow } from '../mappers';
import { parseDay } from './performance';

export type MissedRow = FlashcardRow & { collection_name: string; collection_subject: string };

/** Quantos cartões uma revisão de errados traz, no máximo: uma sessão com mais que isso deixa de ser "só os que errou". */
export const MAX_MISSED_CARDS = 200;
export const MAX_MISSED_COLLECTIONS = 200;

export type MissedQuery = { ok: true; collectionIds: string[]; from: string; to: string } | { ok: false; error: string };

/** Os parâmetros do endereço: `collectionIds` (separados por vírgula), `from` e `to` (AAAA-MM-DD, locais, os dois inclusive). */
export function parseMissedQuery(raw: Record<string, unknown>): MissedQuery {
  const ids = typeof raw.collectionIds === 'string' ? [...new Set(raw.collectionIds.split(',').map((id) => id.trim()).filter(Boolean))] : [];
  if (ids.length === 0 || ids.length > MAX_MISSED_COLLECTIONS || ids.some((id) => id.length > 64)) {
    return { ok: false, error: 'Escolha de uma a 200 coleções.' };
  }
  const from = parseDay(raw.from);
  const to = parseDay(raw.to);
  if (!from || !to || from.getTime() > to.getTime()) return { ok: false, error: 'Período inválido: use from e to (AAAA-MM-DD).' };
  return { ok: true, collectionIds: ids, from: raw.from as string, to: raw.to as string };
}

export function loadMissedCards(db: DatabaseSync, userId: string, collectionIds: string[], range: { from: string; to: string }): MissedRow[] {
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  if (!from || !to || collectionIds.length === 0) return [];
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  return db
    .prepare(
      `SELECT f.*, c.name AS collection_name, c.subject AS collection_subject
       FROM flashcards f
       JOIN collections c ON c.id = f.collection_id
       JOIN (
         SELECT flashcard_id, COUNT(*) AS misses, MAX(studied_at) AS last_miss
         FROM study_sessions
         WHERE user_id = ? AND result IN ('errei', 'dificil') AND studied_at >= ? AND studied_at < ?
         GROUP BY flashcard_id
       ) m ON m.flashcard_id = f.id
       WHERE c.user_id = ? AND c.id IN (${collectionIds.map(() => '?').join(', ')}) AND ${notFrozen('c.id')}
       ORDER BY m.misses DESC, m.last_miss DESC, f.rowid
       LIMIT ${MAX_MISSED_CARDS}`,
    )
    .all(userId, from.toISOString(), end.toISOString(), userId, ...collectionIds) as unknown as MissedRow[];
}
