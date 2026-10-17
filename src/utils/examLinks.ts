/**
 * Os links da página do concurso para estudar ou ouvir uma disciplina do edital: as telas de "estudar a
 * disciplina" e de mãos livres já recebem as coleções pelo endereço; aqui se escolhe quais, e para onde
 * o "voltar" deve levar (a página do concurso, em vez da lista de coleções).
 */

/** O servidor aceita de 1 a 200 coleções por pedido. */
export const MAX_STUDY_COLLECTIONS = 200;

/** As coleções ligadas aos tópicos, sem repetir (uma coleção ligada a vários tópicos conta uma vez), na ordem do edital. */
export function disciplineCollectionIds(topics: { collectionIds: string[] }[]): string[] {
  const ids = new Set<string>();
  for (const topic of topics) for (const id of topic.collectionIds) ids.add(id);
  return [...ids].slice(0, MAX_STUDY_COLLECTIONS);
}

export type StudyKind = 'study' | 'listen';

const PAGE: Record<StudyKind, string> = { study: '/disciplina/estudar', listen: '/maos-livres' };

/** O endereço de estudar (revisão) ou ouvir (mãos livres) as coleções de uma disciplina, voltando para `returnTo`. */
export function studyHref(kind: StudyKind, collectionIds: string[], name: string, returnTo: string): string {
  const query = new URLSearchParams({ ids: collectionIds.join(','), nome: name, voltar: returnTo });
  return `${PAGE[kind]}?${query.toString()}`;
}

/**
 * O "voltar" vem do endereço, que qualquer um pode escrever: só vale um caminho interno simples
 * (`/concursos/abc-123`). Link externo, `//site`, `javascript:` e afins viram `null`.
 */
export function safeReturnPath(raw: string | null): string | null {
  if (!raw || raw.length > 200) return null;
  return /^\/(?!\/)[A-Za-z0-9\-_/]*$/.test(raw) ? raw : null;
}
