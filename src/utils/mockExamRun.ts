/**
 * Uma tentativa de simulado em andamento. Funções puras: a tela guarda o estado num `useState`
 * e só chama estas para mudá-lo.
 *
 * O cartão da vez é sempre `cards[answers.length]`; responder (acertei ou errei) avança, e voltar
 * desfaz a última resposta, para corrigir um clique errado antes de seguir.
 */

interface WithId {
  id: string;
}

export interface RunAnswer {
  flashcardId: string;
  correct: boolean;
  /** Quanto o cartão ficou à frente do usuário até ele marcar acertei ou errei. */
  durationMs: number;
}

export interface RunState<T extends WithId> {
  /** Os cartões, na ordem em que aparecem na prova. */
  cards: T[];
  answers: RunAnswer[];
}

export interface RunResult<T extends WithId> {
  total: number;
  correct: number;
  /** Os cartões que o usuário errou, na ordem da prova. */
  wrong: T[];
  /** Acertos em porcentagem, arredondada (0 se não há respostas). */
  percent: number;
  /** Média de tempo por cartão, em ms (0 se não há respostas). */
  averageMs: number;
}

export function startRun<T extends WithId>(cards: T[]): RunState<T> {
  return { cards, answers: [] };
}

export function currentCard<T extends WithId>(state: RunState<T>): T | null {
  return state.cards[state.answers.length] ?? null;
}

export function isFinished<T extends WithId>(state: RunState<T>): boolean {
  return state.cards.length > 0 && state.answers.length >= state.cards.length;
}

export function answerCurrent<T extends WithId>(state: RunState<T>, correct: boolean, durationMs: number): RunState<T> {
  const card = currentCard(state);
  if (!card) return state;
  return { ...state, answers: [...state.answers, { flashcardId: card.id, correct, durationMs: Math.max(0, durationMs) }] };
}

/** Desfaz a última resposta: o cartão volta a ser o da vez. */
export function undoAnswer<T extends WithId>(state: RunState<T>): RunState<T> {
  if (state.answers.length === 0) return state;
  return { ...state, answers: state.answers.slice(0, -1) };
}

export function percentage(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}

export function runResult<T extends WithId>(state: RunState<T>): RunResult<T> {
  const total = state.answers.length;
  const correct = state.answers.filter((a) => a.correct).length;
  const wrongIds = new Set(state.answers.filter((a) => !a.correct).map((a) => a.flashcardId));
  const spent = state.answers.reduce((sum, a) => sum + a.durationMs, 0);
  return {
    total,
    correct,
    wrong: state.cards.filter((c) => wrongIds.has(c.id)),
    percent: percentage(correct, total),
    averageMs: total === 0 ? 0 : Math.round(spent / total),
  };
}

/** 65000 → "1:05"; a partir de uma hora, "1:02:03". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}
