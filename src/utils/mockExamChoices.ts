/**
 * Peças puras da prova de múltipla escolha: montar a questão (embaralhar as alternativas), sortear
 * os cartões, dividir a preparação em lotes e oferecer quantidades de questões. Sem React nem rede,
 * para testar.
 */
import type { ChoiceQuestion } from '../types';

/** O servidor aceita preparar até isto por pedido (MAX_CARDS_PER_PREPARE em server/mockexams/choices.ts). */
export const PREPARE_BATCH_SIZE = 8;

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

export const optionLetter = (index: number): string => OPTION_LETTERS[index] ?? String(index + 1);

export interface BuiltQuestion {
  /** As alternativas na ordem em que aparecem: a correta fica num lugar sorteado a cada prova. */
  options: string[];
  correctIndex: number;
}

export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Embaralha a correta e as erradas. A posição da correta muda a cada prova, então decorar a letra não ajuda. */
export function buildQuestion(choice: Pick<ChoiceQuestion, 'correct' | 'wrong'>, random: () => number = Math.random): BuiltQuestion {
  const tagged = shuffled(
    [{ text: choice.correct, correct: true }, ...choice.wrong.map((text) => ({ text, correct: false }))],
    random,
  );
  return { options: tagged.map((o) => o.text), correctIndex: tagged.findIndex((o) => o.correct) };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `amount` cartões do conjunto: sorteados, ou os primeiros se o usuário pediu para manter a ordem. */
export function pickSample<T>(items: readonly T[], amount: number, randomOrder: boolean, random: () => number = Math.random): T[] {
  const size = Math.max(0, Math.min(amount, items.length));
  return (randomOrder ? shuffled(items, random) : [...items]).slice(0, size);
}

const AMOUNT_STEPS = [10, 20, 30, 50];

/** As quantidades oferecidas para um conjunto de `total` cartões: os degraus que cabem e, no fim, "todos". */
export function amountOptions(total: number): number[] {
  if (total <= 0) return [];
  const steps = AMOUNT_STEPS.filter((n) => n < total);
  return [...steps, total];
}

/** A quantidade já marcada ao abrir: dez questões, ou todas se são menos que isso. */
export function defaultAmount(total: number): number {
  return Math.min(10, total);
}

/**
 * Quantas chamadas de IA a preparação vai fazer (só para cartões sem alternativas guardadas).
 * Serve para a tela avisar o que vai acontecer antes de gastar cota.
 */
export function batchesNeeded(missing: number): number {
  return Math.ceil(Math.max(0, missing) / PREPARE_BATCH_SIZE);
}
