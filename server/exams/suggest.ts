/**
 * Sugere, para um tópico do edital, as coleções do usuário que provavelmente
 * tratam dele — comparando o texto do tópico com o assunto e o nome da coleção.
 * Sem IA: é rápido, de graça e dá sempre o mesmo resultado. É só sugestão; quem
 * decide o vínculo é o usuário.
 */

export interface SuggestableCollection {
  id: string;
  name: string;
  subject: string;
}

export interface CollectionSuggestion {
  collectionId: string;
  /** 0 a 1. */
  score: number;
}

/** A partir daqui o vínculo é tão provável que dá pra aceitar em lote. */
export const STRONG_SCORE = 0.85;
/** Abaixo disso a sugestão nem aparece. */
export const MIN_SCORE = 0.5;

// Só palavras que não dizem nada sobre o assunto. "lei", "decreto" e afins
// ficam: num edital, "Lei 8.429/1992" é justamente o que identifica o tópico.
const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'por', 'com', 'sem', 'ao', 'aos', 'que', 'se', 'ou', 'sobre', 'entre', 'seu', 'sua',
]);

export function tokenize(text: string): Set<string> {
  const normalized = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // "8.429/1992" e "1.171/1994": o ponto é separador de milhar, não de palavra
    .replace(/(\d)\.(?=\d)/g, '$1');
  const tokens = normalized.split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Quanto do menor dos dois textos está contido no outro. Um único token em
 * comum só vale quando ele é o texto inteiro de um dos lados ("DNS", "Telnet",
 * "Virtualização"): "Redes de computadores" e "Redes sem fio" dividem só a
 * palavra "redes" e não são o mesmo assunto.
 */
function overlapScore(topic: Set<string>, other: Set<string>): number {
  if (topic.size === 0 || other.size === 0) return 0;
  let shared = 0;
  for (const token of topic) if (other.has(token)) shared++;
  if (shared === 0) return 0;
  if (shared === 1 && Math.min(topic.size, other.size) > 1) return 0;
  return Math.max(shared / topic.size, shared / other.size);
}

// O nome da coleção costuma ser a disciplina inteira ("Segurança da Informação"),
// o que casaria com qualquer tópico dela — por isso só conta com desconto, e
// nunca chega ao nível de aceitação automática.
const NAME_DISCOUNT = 0.8;

export function suggestCollections(
  topicTitle: string,
  collections: SuggestableCollection[],
  options: { exclude?: Set<string>; max?: number } = {},
): CollectionSuggestion[] {
  const topic = tokenize(topicTitle);
  const suggestions: CollectionSuggestion[] = [];

  for (const collection of collections) {
    if (options.exclude?.has(collection.id)) continue;
    const bySubject = overlapScore(topic, tokenize(collection.subject));
    const byName = overlapScore(topic, tokenize(collection.name)) * NAME_DISCOUNT;
    const score = Math.max(bySubject, byName);
    if (score >= MIN_SCORE) suggestions.push({ collectionId: collection.id, score });
  }

  // Empate de pontuação desempata pelo id, só pra o resultado ser sempre o mesmo.
  return suggestions
    .sort((a, b) => b.score - a.score || a.collectionId.localeCompare(b.collectionId))
    .slice(0, options.max ?? 3);
}
