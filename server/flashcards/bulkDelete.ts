import type { DatabaseSync } from 'node:sqlite';

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error });

/** Quantos cartões uma exclusão em lote aceita de uma vez (uma coleção grande inteira cabe com folga). */
export const MAX_BULK_DELETE = 5000;

/** Quantos ids entram numa mesma consulta (o SQLite limita as variáveis de uma instrução). */
const CHUNK = 500;

/**
 * Valida o pedido de exclusão em lote: ao menos um id, só textos, até `MAX_BULK_DELETE`. Repetidos contam uma vez. Um
 * pedido com qualquer item fora do formato é recusado inteiro, em vez de apagar só o que deu para entender.
 */
export function prepareBulkDelete(body: unknown): Result<string[]> {
  const ids = (body as { flashcardIds?: unknown } | null | undefined)?.flashcardIds;
  if (!Array.isArray(ids) || ids.length === 0) return fail(400, 'Selecione ao menos um flashcard.');
  if (ids.length > MAX_BULK_DELETE) return fail(400, `Selecione no máximo ${MAX_BULK_DELETE} flashcards por vez.`);
  if (ids.some((id) => typeof id !== 'string' || id === '')) return fail(400, 'Lista de flashcards inválida.');
  return { ok: true, value: [...new Set(ids as string[])] };
}

/**
 * Apaga os cartões da lista que são do usuário e devolve quantos saíram. O filtro por dono está no próprio DELETE: um id
 * de outra pessoa, ou que não existe mais, simplesmente não conta (como o `DELETE /:id`, que responde 404 nesses casos).
 * As chaves estrangeiras levam junto o histórico de revisões, a presença nos simulados e as marcações do cartão, igual
 * à exclusão de um cartão só. Todos os blocos numa transação: apaga tudo ou nada.
 */
export function deleteOwnedFlashcards(db: DatabaseSync, userId: string, ids: readonly string[]): number {
  let removed = 0;
  db.exec('BEGIN');
  try {
    for (let start = 0; start < ids.length; start += CHUNK) {
      const chunk = ids.slice(start, start + CHUNK);
      const marks = chunk.map(() => '?').join(', ');
      const { changes } = db
        .prepare(
          `DELETE FROM flashcards
           WHERE id IN (${marks}) AND collection_id IN (SELECT id FROM collections WHERE user_id = ?)`,
        )
        .run(...chunk, userId);
      removed += Number(changes);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return removed;
}
