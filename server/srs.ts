export type StudyResult = 'errei' | 'dificil' | 'bom' | 'facil';

export interface SrsState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

export interface SrsUpdate extends SrsState {
  dueAt: string;
}

const MIN_EASE_FACTOR = 1.3;

/**
 * Variante simplificada do SM-2 (mesma família de algoritmo usada pelo Anki):
 * errar zera o progresso e volta a revisar amanhã; acertar aumenta o
 * intervalo progressivamente (1 dia → 6 dias → intervalo anterior × fator de
 * facilidade), que cresce ou encolhe conforme "difícil"/"fácil" indicam o
 * quão bem o conteúdo já está consolidado.
 */
export function nextSrsState(current: SrsState, result: StudyResult): SrsUpdate {
  let { easeFactor, intervalDays, repetitions } = current;

  if (result === 'errei') {
    repetitions = 0;
    intervalDays = 1;
    easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.2);
  } else {
    repetitions += 1;
    if (result === 'dificil') {
      easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.15);
    } else if (result === 'facil') {
      easeFactor = easeFactor + 0.15;
    }

    if (repetitions === 1) {
      intervalDays = 1;
    } else if (repetitions === 2) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
  }

  const dueAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000).toISOString();
  return { easeFactor, intervalDays, repetitions, dueAt };
}
