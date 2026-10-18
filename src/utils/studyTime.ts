/**
 * "Tempo de estudo" do Meu desempenho sem React: como escrever uma duração e o que o tempo gasto diz perto do peso
 * da disciplina na prova. Os números vêm do servidor (server/stats/studyTime.ts).
 */
import type { StudyTimeDisciplineRow, StudyTimeRow } from '../types';

/** 0 → "0 min"; 20 s → "<1 min"; 45 min → "45 min"; 3 600 s → "1 h"; 7 500 s → "2 h 05". */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec / 60));
  if (total === 0) return sec > 0 ? '<1 min' : '0 min';
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** A parte do tempo total que uma linha tem, em % (0 se não houve tempo). */
export function timeSharePct(rowSec: number, totalSec: number): number {
  return totalSec > 0 ? Math.round((rowSec / totalSec) * 100) : 0;
}

/** Menos tempo que isto no recorte inteiro é pouco para dizer se a divisão está certa. */
export const MIN_TOTAL_SEC = 30 * 60;
/** Tempo abaixo de 70% do peso é "pouco"; acima de 130% é "muito". */
export const LOW_RATIO = 0.7;
export const HIGH_RATIO = 1.3;
/** Mas só se a diferença, em pontos percentuais, chegar a isto: 1% contra 2% não é um problema. */
export const MIN_GAP_POINTS = 5;
/** Acerto abaixo disto, junto de pouco tempo, faz da disciplina uma prioridade. */
export const PRIORITY_ACCURACY = 70;

export type Balance = 'low' | 'balanced' | 'high' | 'unknown';

/**
 * O tempo da disciplina perto do peso dela na prova: "low" (pouco tempo para o que vale), "high" (tempo demais) ou
 * "balanced". "unknown" quando não dá para dizer: sem peso (fora do edital) ou pouco tempo estudado no total.
 */
export function balanceOf(timePct: number, weightPct: number | null, totalSec: number): Balance {
  if (weightPct === null || weightPct <= 0 || totalSec < MIN_TOTAL_SEC) return 'unknown';
  if (timePct < weightPct * LOW_RATIO && weightPct - timePct >= MIN_GAP_POINTS) return 'low';
  if (timePct > weightPct * HIGH_RATIO && timePct - weightPct >= MIN_GAP_POINTS) return 'high';
  return 'balanced';
}

export const BALANCE_LABEL: Record<Exclude<Balance, 'unknown'>, string> = {
  low: 'Pouco tempo para o peso',
  balanced: 'Equilibrado',
  high: 'Tempo de sobra',
};

/** Pouco tempo e acerto baixo: é onde falta mais. */
export function isPriority(balance: Balance, accuracyPct: number | null): boolean {
  return balance === 'low' && accuracyPct !== null && accuracyPct < PRIORITY_ACCURACY;
}

export interface DisciplineInsight {
  row: StudyTimeDisciplineRow;
  timePct: number;
  balance: Balance;
  priority: boolean;
  /** Quanto tempo a disciplina precisaria ter a mais (ou a menos, se negativo) no período para ter o tempo do seu peso. */
  gapSec: number;
}

/** A leitura de cada disciplina do edital: a fatia de tempo, o equilíbrio com o peso, se é prioridade e a diferença em tempo. */
export function insights(rows: StudyTimeDisciplineRow[], totalSec: number): DisciplineInsight[] {
  return rows.map((row) => {
    const timePct = timeSharePct(row.totalSec, totalSec);
    const balance = balanceOf(timePct, row.weightPct, totalSec);
    const gapSec = row.weightPct === null ? 0 : Math.round((row.weightPct / 100) * totalSec - row.totalSec);
    return { row, timePct, balance, priority: isPriority(balance, row.accuracyPct), gapSec };
  });
}

/** Uma frase sobre onde falta, para o topo do painel; `null` quando não há o que dizer. */
export function headline(items: DisciplineInsight[]): string | null {
  const real = items.filter((i) => i.row.disciplineId !== null);
  const priority = real.filter((i) => i.priority).sort((a, b) => b.gapSec - a.gapSec);
  if (priority.length > 0) {
    const first = priority[0];
    return `${first.row.label} pesa ${first.row.weightPct}% da prova e levou ${first.timePct}% do seu tempo, com ${first.row.accuracyPct}% de acerto: é onde mais falta.`;
  }
  const low = real.filter((i) => i.balance === 'low').sort((a, b) => b.gapSec - a.gapSec);
  if (low.length > 0) {
    const first = low[0];
    return `${first.row.label} pesa ${first.row.weightPct}% da prova e levou ${first.timePct}% do seu tempo.`;
  }
  if (real.some((i) => i.balance === 'balanced') && !real.some((i) => i.balance === 'high')) {
    return 'O seu tempo está bem repartido em relação ao peso das disciplinas.';
  }
  return null;
}

/** A parte de cada fonte numa barra: o Pomodoro e os cartões, em % da barra. */
export function stackShares(row: Pick<StudyTimeRow, 'pomodoroSec' | 'cardSec'>): { pomodoro: number; cards: number } {
  const total = row.pomodoroSec + row.cardSec;
  return total > 0 ? { pomodoro: (row.pomodoroSec / total) * 100, cards: (row.cardSec / total) * 100 } : { pomodoro: 0, cards: 0 };
}
