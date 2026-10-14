import type { StudyResult } from '../types';

/**
 * A fila de uma sessão de estudo e o que dá para desfazer dela. Funções puras: quem estuda
 * (a tela de uma coleção, a revisão global, os favoritos) guarda o estado num `useState` e só
 * chama estas para mudá-lo — a regra de "errei volta para o fim da fila" e a de desfazer
 * ficam num lugar só, e testadas.
 *
 * O cartão que aparece é sempre `queue[0]`. Avaliar ou pular tira esse cartão da frente e
 * anota o que foi feito em `history`; voltar desfaz a anotação mais recente, uma de cada vez.
 */

interface WithId {
  id: string;
}

export type HistoryEntry<T extends WithId> =
  | { kind: 'skip'; card: T }
  | {
      kind: 'rate';
      card: T;
      result: StudyResult;
      /** O "errei" recolocou este cartão no fim da fila (só acontece na primeira vez). */
      requeued: boolean;
      /** A avaliação gravada no servidor; `null` se a gravação falhou (então não há o que desfazer lá). */
      sessionId: string | null;
    };

export interface SessionState<T extends WithId> {
  queue: T[];
  /** Cartões que já voltaram uma vez para o fim da fila depois de um "errei". */
  requeued: ReadonlySet<string>;
  counts: Record<StudyResult, number>;
  skipped: number;
  history: HistoryEntry<T>[];
}

export function newSession<T extends WithId>(queue: T[]): SessionState<T> {
  return {
    queue,
    requeued: new Set(),
    counts: { errei: 0, dificil: 0, bom: 0, facil: 0 },
    skipped: 0,
    history: [],
  };
}

export function studiedCount(state: SessionState<WithId>): number {
  return state.counts.errei + state.counts.dificil + state.counts.bom + state.counts.facil;
}

/** O que "Voltar" desfaria agora, ou `null` se não há nada a desfazer. */
export function lastEntry<T extends WithId>(state: SessionState<T>): HistoryEntry<T> | null {
  return state.history[state.history.length - 1] ?? null;
}

/** Registra a avaliação do cartão atual: ele sai da frente (e, se errou pela primeira vez, vai para o fim). */
export function rateCurrent<T extends WithId>(
  state: SessionState<T>,
  result: StudyResult,
  sessionId: string | null,
): SessionState<T> {
  const [current, ...rest] = state.queue;
  if (!current) return state;

  const requeue = result === 'errei' && !state.requeued.has(current.id);
  return {
    queue: requeue ? [...rest, current] : rest,
    requeued: requeue ? new Set(state.requeued).add(current.id) : state.requeued,
    counts: { ...state.counts, [result]: state.counts[result] + 1 },
    skipped: state.skipped,
    history: [...state.history, { kind: 'rate', card: current, result, requeued: requeue, sessionId }],
  };
}

/** Pula o cartão atual: sai da fila desta sessão sem ser avaliado, e continua pendente para a próxima. */
export function skipCurrent<T extends WithId>(state: SessionState<T>): SessionState<T> {
  const [current, ...rest] = state.queue;
  if (!current) return state;
  return {
    ...state,
    queue: rest,
    skipped: state.skipped + 1,
    history: [...state.history, { kind: 'skip', card: current }],
  };
}

/** Desfaz a ação mais recente: o cartão volta para a frente da fila, como estava antes de ser avaliado ou pulado. */
export function undoLast<T extends WithId>(state: SessionState<T>): SessionState<T> {
  const entry = lastEntry(state);
  if (!entry) return state;
  const history = state.history.slice(0, -1);

  if (entry.kind === 'skip') {
    return { ...state, queue: [entry.card, ...state.queue], skipped: state.skipped - 1, history };
  }

  let queue = state.queue;
  let requeued = state.requeued;
  let card = entry.card;
  if (entry.requeued) {
    // A cópia que o "errei" mandou para o fim da fila sai de lá. Ela pode ter sido editada
    // ou favoritada desde então, então é a versão dela que volta, não a de antes.
    const copyIndex = queue.map((c) => c.id).lastIndexOf(entry.card.id);
    if (copyIndex !== -1) {
      card = queue[copyIndex];
      queue = queue.filter((_, i) => i !== copyIndex);
    }
    const withoutCard = new Set(requeued);
    withoutCard.delete(entry.card.id);
    requeued = withoutCard;
  }

  return {
    queue: [card, ...queue],
    requeued,
    counts: { ...state.counts, [entry.result]: state.counts[entry.result] - 1 },
    skipped: state.skipped,
    history,
  };
}

/** Troca na fila os campos de um cartão que mudaram (edição, favorito); a posição não muda. */
export function patchCard<T extends WithId>(state: SessionState<T>, id: string, patch: Partial<T>): SessionState<T> {
  return { ...state, queue: state.queue.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}
