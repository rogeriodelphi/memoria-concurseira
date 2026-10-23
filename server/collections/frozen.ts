import type { DatabaseSync } from 'node:sqlite';

/**
 * Coleção congelada: sai das revisões automáticas (a fila global, a de uma disciplina, os lembretes, o Painel, a
 * Meta para a prova, a Reta final, a ordem dos novos, os favoritos e as sanguessugas) sem mexer em nada dos cartões.
 * Só uma tabela nova, uma linha por coleção congelada: nem a data de vencimento nem o agendamento dos cartões mudam,
 * então descongelar devolve tudo exatamente como estava. O histórico de estudo continua valendo (progresso do concurso e
 * Meu desempenho), e a coleção segue estudável pelo botão "Estudar" dela.
 *
 * Apagar a coleção leva a linha junto.
 */
export const FROZEN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS frozen_collections (
    collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
    frozen_at     TEXT NOT NULL
  );
`;

/**
 * O pedaço de SQL "esta coleção NÃO está congelada", para a coluna que traz o id da coleção (`c.id`,
 * `f.collection_id`...). Toda consulta que monta uma fila ou uma contagem de revisão usa este mesmo pedaço, para
 * nenhuma esquecer o congelamento.
 */
export const notFrozen = (collectionColumn: string): string =>
  `NOT EXISTS (SELECT 1 FROM frozen_collections fz WHERE fz.collection_id = ${collectionColumn})`;

/** Quando a coleção foi congelada, ou `null` se não está congelada. */
export function frozenAt(db: DatabaseSync, collectionId: string): string | null {
  const row = db.prepare('SELECT frozen_at FROM frozen_collections WHERE collection_id = ?').get(collectionId) as unknown as
    | { frozen_at: string }
    | undefined;
  return row?.frozen_at ?? null;
}

/** Congela (ou descongela) a coleção. Congelar uma coleção já congelada mantém a data original; descongelar uma que não está congelada não muda nada. */
export function setCollectionFrozen(db: DatabaseSync, collectionId: string, frozen: boolean, now: Date = new Date()): void {
  if (frozen) db.prepare('INSERT OR IGNORE INTO frozen_collections (collection_id, frozen_at) VALUES (?, ?)').run(collectionId, now.toISOString());
  else db.prepare('DELETE FROM frozen_collections WHERE collection_id = ?').run(collectionId);
}
