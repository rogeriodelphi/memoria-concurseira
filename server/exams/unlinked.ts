/**
 * Coleções que ainda não estão ligadas a nenhum tópico de um concurso, e para onde elas provavelmente vão. É o caminho
 * contrário da sugestão que já existe (`suggest.ts`, que parte do tópico e procura coleções): aqui se parte da coleção
 * e se procuram os tópicos do edital, para quem tem coleções soltas ligá-las uma a uma. Sem IA: usa a mesma comparação
 * de texto, rápida, grátis e sempre com o mesmo resultado. É só sugestão; quem liga é o usuário.
 *
 * Também cuida de "esta coleção não é deste concurso" (uma coleção de legislação que serve a outro edital, por exemplo),
 * para ela parar de aparecer na lista do concurso.
 */
import type { DatabaseSync } from 'node:sqlite';

import { MIN_SCORE, STRONG_SCORE, suggestCollections } from './suggest';

export interface TopicRef {
  id: string;
  title: string;
  discipline: string;
  /** O tópico já tem alguma coleção ligada (uma segunda coleção ainda pode ser ligada a ele). */
  hasMaterial: boolean;
}

export interface CollectionRef {
  id: string;
  name: string;
  subject: string;
  cards: number;
  newCards: number;
  dueCards: number;
}

export interface TopicSuggestion {
  topicId: string;
  title: string;
  discipline: string;
  /** De 0,5 a 1. */
  score: number;
  /** Tão parecido que é praticamente o mesmo assunto (o mesmo limiar da aceitação em lote). */
  strong: boolean;
  /** O tópico já tem outra coleção ligada. */
  linked: boolean;
}

export interface UnlinkedCollection extends CollectionRef {
  suggestions: TopicSuggestion[];
  /**
   * Quantos tópicos empatam no topo, quando são mais que `MAX_SUGGESTIONS`: a coleção trata da disciplina toda ("Redes de
   * Computadores" casa com todo tópico "Redes de Computadores: ..."), e escolher três deles seria sorteio. Sem sugestões,
   * a tela pede para o usuário escolher. 0 quando não há esse empate.
   */
  tied: number;
}

/** Quantos tópicos, no máximo, se sugerem para uma coleção. */
export const MAX_SUGGESTIONS = 3;

const EPSILON = 1e-9;

/** Os tópicos que combinam com a coleção, do mais parecido ao menos (empate: a ordem do edital). */
export function suggestTopics(collection: Pick<CollectionRef, 'id' | 'name' | 'subject'>, topics: readonly TopicRef[]): { suggestions: TopicSuggestion[]; tied: number } {
  const scored = topics
    .map((topic, order) => ({ topic, order, score: suggestCollections(topic.title, [collection])[0]?.score ?? 0 }))
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  if (scored.length === 0) return { suggestions: [], tied: 0 };

  const top = scored[0].score;
  const tied = scored.filter((entry) => top - entry.score < EPSILON).length;
  if (tied > MAX_SUGGESTIONS) return { suggestions: [], tied };

  // Quando o assunto da coleção é praticamente o tópico, os parecidos só pelo nome (a disciplina toda) são ruído.
  const candidates = top >= STRONG_SCORE ? scored.filter((entry) => entry.score >= STRONG_SCORE) : scored;
  return {
    suggestions: candidates.slice(0, MAX_SUGGESTIONS).map(({ topic, score }) => ({
      topicId: topic.id,
      title: topic.title,
      discipline: topic.discipline,
      score,
      strong: score >= STRONG_SCORE,
      linked: topic.hasMaterial,
    })),
    tied: 0,
  };
}

export interface UnlinkedResult {
  /** As coleções soltas, com sugestão primeiro (as mais parecidas antes) e depois as sem sugestão, da maior para a menor. */
  unlinked: UnlinkedCollection[];
  /** As que o usuário disse que não são deste concurso (e que continuam soltas). */
  ignored: CollectionRef[];
}

/**
 * As coleções do usuário que não estão ligadas a nenhum tópico do concurso, com os tópicos sugeridos para cada uma.
 * `linkedCollectionIds` são as coleções ligadas a algum tópico DESTE concurso; `ignoredIds`, as marcadas como "não é deste
 * concurso".
 */
export function buildUnlinked(input: {
  collections: readonly CollectionRef[];
  topics: readonly TopicRef[];
  linkedCollectionIds: ReadonlySet<string>;
  ignoredIds: ReadonlySet<string>;
}): UnlinkedResult {
  const loose = input.collections.filter((c) => !input.linkedCollectionIds.has(c.id));
  const ignored = loose.filter((c) => input.ignoredIds.has(c.id)).sort(byCardsThenName);
  const unlinked = loose
    .filter((c) => !input.ignoredIds.has(c.id))
    .map((c): UnlinkedCollection => ({ ...c, ...suggestTopics(c, input.topics) }));

  unlinked.sort((a, b) => {
    const hasA = a.suggestions.length > 0 ? 0 : 1;
    const hasB = b.suggestions.length > 0 ? 0 : 1;
    if (hasA !== hasB) return hasA - hasB;
    const bestA = a.suggestions[0]?.score ?? 0;
    const bestB = b.suggestions[0]?.score ?? 0;
    return bestB - bestA || byCardsThenName(a, b);
  });
  return { unlinked, ignored };
}

const byCardsThenName = (a: CollectionRef, b: CollectionRef) => b.cards - a.cards || a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id);

// ---------- "não é deste concurso" ----------

/**
 * Só uma tabela nova, nada que já existe é alterado. Uma linha por (concurso, coleção) que o usuário disse não ser daquele
 * concurso; apagar o concurso ou a coleção leva a linha junto.
 */
export const IGNORED_COLLECTIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS exam_ignored_collections (
    exam_id       TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY (exam_id, collection_id)
  );
`;

export function loadIgnoredIds(db: DatabaseSync, examId: string): Set<string> {
  const rows = db.prepare('SELECT collection_id FROM exam_ignored_collections WHERE exam_id = ?').all(examId) as unknown as { collection_id: string }[];
  return new Set(rows.map((r) => r.collection_id));
}

/** Marca (ou desmarca) a coleção como "não é deste concurso". Pedir duas vezes o mesmo não muda nada. */
export function setCollectionIgnored(db: DatabaseSync, examId: string, collectionId: string, ignored: boolean): void {
  if (ignored) db.prepare('INSERT OR IGNORE INTO exam_ignored_collections (exam_id, collection_id) VALUES (?, ?)').run(examId, collectionId);
  else db.prepare('DELETE FROM exam_ignored_collections WHERE exam_id = ? AND collection_id = ?').run(examId, collectionId);
}
