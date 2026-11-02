import type { Flashcard, StudyResult } from '../types';

/**
 * O cartão "Arrastar e soltar" (`kind = 'match'`): a pergunta é o título e a resposta guarda os pares, uma linha
 * "termo::descrição" por par. Estas são as regras de ler os pares e de jogar (as mesmas do servidor, que é quem
 * valida o que se grava): aqui um cartão com pares inválidos simplesmente é mostrado como um cartão comum.
 */

export interface MatchPair {
  term: string;
  description: string;
}

export const MIN_PAIRS = 2;
export const MAX_PAIRS = 12;
/** O limite de cada termo, de cada descrição e do título. */
export const MAX_PART_CHARS = 300;

const SEPARATOR = '::';
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Os pares guardados na resposta, ou null se não formam um cartão válido. */
export function parseMatchPairs(answer: string): MatchPair[] | null {
  const lines = answer.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < MIN_PAIRS || lines.length > MAX_PAIRS) return null;
  const pairs: MatchPair[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const at = line.indexOf(SEPARATOR);
    if (at < 0) return null;
    const term = collapse(line.slice(0, at));
    const description = collapse(line.slice(at + SEPARATOR.length));
    if (!term || !description || term.length > MAX_PART_CHARS || description.length > MAX_PART_CHARS) return null;
    const key = term.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) return null;
    seen.add(key);
    pairs.push({ term, description });
  }
  return pairs;
}

export const serializeMatchPairs = (pairs: readonly MatchPair[]): string => pairs.map((p) => `${p.term}${SEPARATOR}${p.description}`).join('\n');

/** Os pares do cartão, se ele é de arrastar e soltar e tem pares válidos; senão null (estuda-se como um cartão comum). */
export function matchPairsOf(card: Pick<Flashcard, 'kind' | 'answer'>): MatchPair[] | null {
  return card.kind === 'match' ? parseMatchPairs(card.answer) : null;
}

// ---------- o formulário ----------

export const blankRows = (): MatchPair[] => [
  { term: '', description: '' },
  { term: '', description: '' },
];

/** As linhas do formulário a partir da resposta guardada; se ela não tem pares válidos, duas linhas em branco. */
export const rowsFromAnswer = (answer: string): MatchPair[] => parseMatchPairs(answer) ?? blankRows();

/**
 * A resposta a gravar a partir das linhas do formulário: linhas totalmente em branco somem; uma linha pela metade segue
 * (o servidor recusa com a mensagem certa). Um "::" dentro do termo viraria um separador, então vira um ":" só.
 */
export function rowsToAnswer(rows: readonly MatchPair[]): string {
  return rows
    .map((row) => ({ term: row.term.trim().replace(/:{2,}/g, ':'), description: row.description.trim() }))
    .filter((row) => row.term || row.description)
    .map((row) => `${row.term}${SEPARATOR}${row.description}`)
    .join('\n');
}

/** A resposta para a voz: "termo: descrição" por par, sem os dois-pontos duplos. */
export const spokenMatchAnswer = (pairs: readonly MatchPair[]): string => pairs.map((p) => `${p.term}: ${p.description}`).join('. ');

// ---------- o jogo ----------

/** `placement[i]` é a descrição (o índice do par a que ela pertence) que está no termo `i`, ou null se está vazio. */
export type Placement = (number | null)[];

export const emptyPlacement = (count: number): Placement => Array.from({ length: count }, () => null);

/**
 * A ordem das descrições na bandeja: embaralhada, e nunca a ordem dos termos (com dois ou mais pares), senão a primeira
 * olhada já entregaria a resposta.
 */
export function trayOrder(count: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (count > 1 && order.every((value, i) => value === i)) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

/**
 * Põe a descrição no termo. Se ela estava em outro termo, sai de lá; se o termo já tinha outra descrição, essa volta
 * para a bandeja (fica sem termo).
 */
export function placeDescription(placement: Placement, termIndex: number, descriptionIndex: number): Placement {
  const next = placement.map((d) => (d === descriptionIndex ? null : d));
  next[termIndex] = descriptionIndex;
  return next;
}

/** Tira a descrição do termo e a devolve à bandeja. */
export function removeFromTerm(placement: Placement, termIndex: number): Placement {
  const next = [...placement];
  next[termIndex] = null;
  return next;
}

/** Em qual termo está a descrição, ou -1 se está na bandeja. */
export const termOfDescription = (placement: Placement, descriptionIndex: number): number => placement.indexOf(descriptionIndex);

export interface Grade {
  /** Por termo: a descrição que está nele é a certa. Termo vazio nunca está certo. */
  correct: boolean[];
  /** Quantos termos não estão certos (os vazios contam). */
  wrong: number;
}

/**
 * Corrige: compara o TEXTO da descrição posta com o do par, então duas descrições idênticas em pares diferentes são
 * intercambiáveis (trocá-las não é erro).
 */
export function gradePlacement(pairs: readonly MatchPair[], placement: Placement): Grade {
  const correct = pairs.map((pair, i) => {
    const placed = placement[i];
    return placed !== null && placed !== undefined && pairs[placed]?.description === pair.description;
  });
  return { correct, wrong: correct.filter((ok) => !ok).length };
}

/** A nota sugerida: tudo certo é "Bom", um erro "Difícil", dois ou mais "Errei". Quem decide é o usuário. */
export function suggestedRating(wrong: number): StudyResult {
  if (wrong <= 0) return 'bom';
  return wrong === 1 ? 'dificil' : 'errei';
}
