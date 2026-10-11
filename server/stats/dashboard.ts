import type { StudyResult } from '../srs';

/**
 * Teto de tempo atribuído a uma única revisão. Um cartão que ficou aberto
 * enquanto o usuário foi fazer outra coisa não pode inflar o tempo de estudo.
 */
export const MAX_REVIEW_MS = 120_000;

/** Intervalo (dias) a partir do qual um cartão conta como "maduro", como no Anki. */
const MATURE_INTERVAL_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const FALLBACK_REVIEW_MS = 20_000;

export interface DashboardSession {
  flashcardId: string;
  result: StudyResult;
  studiedAt: string;
  /** Tempo medido no cliente; null nas revisões de antes de existir a medição. */
  durationMs: number | null;
}

export interface DashboardCard {
  dueAt: string | null;
  repetitions: number;
  intervalDays: number;
}

export interface DashboardData {
  /** Revisões por dia (dia local), do mais antigo ao de hoje. */
  consistency: { date: string; count: number }[];
  efficiencyPct: number | null;
  precisionPct: number | null;
  retentionPct: number | null;
  newCardsPct: number | null;
  today: {
    studied: number;
    distinctCards: number;
    timeMin: number;
    paceSec: number | null;
    cardsPerMin: number | null;
    passRatePct: number | null;
  };
  remaining: {
    new: number;
    learning: number;
    due: number;
    total: number;
    dueTomorrow: number;
    estimatedMin: number | null;
  };
  doneToday: { newLearned: number; relearned: number; reviews: number; again: number };
  matureCards: number;
  totalHours: number;
  pastWeekHours: number;
  totalReviews: number;
  /** Quantas revisões tiveram o tempo estimado em vez de medido. */
  estimatedReviews: number;
}

type Kind = 'new' | 'relearn' | 'review';

interface Enriched {
  time: number;
  at: number;
  result: StudyResult;
  flashcardId: string;
  kind: Kind;
  estimated: boolean;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Tudo que o painel mostra, calculado só a partir do histórico de revisões e
 * do estado atual dos cartões. "Hoje" é o dia local do servidor — que roda na
 * máquina do usuário —, não o dia em UTC.
 *
 * Cada revisão é classificada pelo que veio antes dela naquele cartão: sem
 * revisão anterior é "nova"; se a anterior foi "Errei", é reaprendizado; senão
 * é uma revisão normal. O app não tem passos de aprendizado como o Anki, então
 * essa é a leitura equivalente.
 */
export function buildDashboard(sessions: DashboardSession[], cards: DashboardCard[], now: Date): DashboardData {
  const ordered = [...sessions].sort((a, b) => a.studiedAt.localeCompare(b.studiedAt));

  // Tempo de cada revisão: o medido, quando existe; senão o intervalo até a
  // revisão anterior (qualquer cartão), desde que seja plausível. Intervalo
  // longo é pausa, não estudo, e vira a mediana do que foi observado.
  const observed: number[] = [];
  const raw = ordered.map((s, i) => {
    const at = Date.parse(s.studiedAt);
    if (s.durationMs !== null) {
      const time = Math.min(s.durationMs, MAX_REVIEW_MS);
      observed.push(time);
      return { at, time: time as number | null, estimated: false };
    }
    const gap = i > 0 ? at - Date.parse(ordered[i - 1].studiedAt) : Infinity;
    if (gap >= 1000 && gap <= MAX_REVIEW_MS) {
      observed.push(gap);
      return { at, time: gap as number | null, estimated: true };
    }
    return { at, time: null as number | null, estimated: true };
  });
  const fallback = median(observed) ?? FALLBACK_REVIEW_MS;

  const lastResultByCard = new Map<string, StudyResult>();
  const reviews: Enriched[] = ordered.map((s, i) => {
    const previous = lastResultByCard.get(s.flashcardId);
    lastResultByCard.set(s.flashcardId, s.result);
    const kind: Kind = previous === undefined ? 'new' : previous === 'errei' ? 'relearn' : 'review';
    return {
      at: raw[i].at,
      time: raw[i].time ?? fallback,
      result: s.result,
      flashcardId: s.flashcardId,
      kind,
      estimated: raw[i].estimated,
    };
  });

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const startOfDayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime();
  const nowMs = now.getTime();
  const windowStart = nowMs - WINDOW_DAYS * DAY_MS;
  const weekStart = nowMs - 7 * DAY_MS;

  const todays = reviews.filter((r) => r.at >= startOfToday && r.at < startOfTomorrow);
  const todayTime = todays.reduce((sum, r) => sum + r.time, 0);
  const todayAgain = todays.filter((r) => r.result === 'errei').length;

  const recent = reviews.filter((r) => r.at >= windowStart);
  const passed = (r: Enriched) => r.result !== 'errei';
  const passPct = (list: Enriched[]) => pct(list.filter(passed).length, list.length);
  const recentTime = recent.reduce((sum, r) => sum + r.time, 0);
  const recentPassedTime = recent.filter(passed).reduce((sum, r) => sum + r.time, 0);

  const dayCounts = new Map<string, number>();
  for (const r of recent) {
    const key = localDateKey(new Date(r.at));
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }
  const consistency: DashboardData['consistency'] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const key = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    consistency.push({ date: key, count: dayCounts.get(key) ?? 0 });
  }

  // Mesmos critérios da revisão global (due_at nulo ou vencido), separados em
  // novos / reaprendendo (último resultado foi "Errei") / revisões.
  let newCount = 0;
  let learning = 0;
  let due = 0;
  let dueTomorrow = 0;
  let matureCards = 0;
  for (const card of cards) {
    if (card.intervalDays >= MATURE_INTERVAL_DAYS) matureCards++;
    if (card.dueAt === null) {
      newCount++;
      continue;
    }
    const dueMs = Date.parse(card.dueAt);
    if (dueMs <= nowMs) {
      if (card.repetitions === 0) learning++;
      else due++;
    } else if (dueMs >= startOfTomorrow && dueMs < startOfDayAfter) {
      dueTomorrow++;
    }
  }
  const total = newCount + learning + due;

  const recentPace = recent.length > 0 ? recentTime / recent.length : null;

  return {
    consistency,
    efficiencyPct: pct(recentPassedTime, recentTime),
    precisionPct: passPct(recent),
    retentionPct: passPct(recent.filter((r) => r.kind === 'review')),
    newCardsPct: passPct(recent.filter((r) => r.kind === 'new')),
    today: {
      studied: todays.length,
      distinctCards: new Set(todays.map((r) => r.flashcardId)).size,
      timeMin: todayTime / 60_000,
      paceSec: todays.length > 0 ? todayTime / todays.length / 1000 : null,
      cardsPerMin: todays.length > 0 && todayTime > 0 ? todays.length / (todayTime / 60_000) : null,
      passRatePct: pct(todays.length - todayAgain, todays.length),
    },
    remaining: {
      new: newCount,
      learning,
      due,
      total,
      dueTomorrow,
      estimatedMin: recentPace !== null ? (total * recentPace) / 60_000 : null,
    },
    doneToday: {
      newLearned: todays.filter((r) => r.kind === 'new').length,
      relearned: todays.filter((r) => r.kind === 'relearn').length,
      reviews: todays.filter((r) => r.kind === 'review').length,
      again: todayAgain,
    },
    matureCards,
    totalHours: reviews.reduce((sum, r) => sum + r.time, 0) / 3_600_000,
    pastWeekHours: reviews.filter((r) => r.at >= weekStart).reduce((sum, r) => sum + r.time, 0) / 3_600_000,
    totalReviews: reviews.length,
    estimatedReviews: reviews.filter((r) => r.estimated).length,
  };
}
