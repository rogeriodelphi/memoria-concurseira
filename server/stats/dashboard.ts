import type { StudyResult } from '../srs';
import { newCardsForToday } from '../studyplan/limit';

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
  /** O limite diário de cartões novos (`null` = sem limite). */
  dailyNewLimit: number | null;
  /** Tempo médio por revisão nos últimos 30 dias, em segundos (`null` sem revisões no período). */
  recentPaceSec: number | null;
  remaining: {
    /** Os novos que entram na fila de hoje (todos, sem limite; com limite, só os que ainda cabem). */
    new: number;
    /** Novos que ficaram de fora por causa do limite diário (0 sem limite). */
    newWaiting: number;
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
  heatmap: Heatmap;
}

export interface Heatmap {
  /** Hoje, no dia local do servidor (AAAA-MM-DD). */
  today: string;
  /** Todo dia que teve ao menos uma revisão, do mais antigo ao mais recente. */
  days: { date: string; count: number }[];
  /**
   * Um item por ano, do da primeira revisão até o atual. O período conta do
   * 1º de janeiro (ou da primeira revisão, no primeiro ano) até 31 de dezembro
   * (ou hoje, no ano atual): é o que dá sentido a "% dos dias estudados".
   */
  years: { year: number; reviews: number; activeDays: number; periodDays: number }[];
  longestStreak: number;
  currentStreak: number;
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

// Número do dia a partir de AAAA-MM-DD. Feito em UTC de propósito: dois dias
// do calendário distam sempre exatamente 1, sem o desvio de 23h/25h do horário
// de verão.
function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function keyFromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function buildHeatmap(reviews: Enriched[], now: Date): Heatmap {
  const today = localDateKey(now);

  const counts = new Map<string, number>();
  for (const r of reviews) {
    const key = localDateKey(new Date(r.at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (days.length === 0) return { today, days, years: [], longestStreak: 0, currentStreak: 0 };

  let longestStreak = 0;
  let run = 0;
  let previous = Number.NaN;
  for (const { date } of days) {
    const n = dayNumber(date);
    run = n === previous + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = n;
  }

  // Como na página de Estatísticas: se hoje ainda não teve estudo, a sequência
  // continua valendo a partir de ontem, em vez de zerar no meio do dia.
  const studied = new Set(days.map((d) => d.date));
  let cursor = dayNumber(today);
  if (!studied.has(keyFromDayNumber(cursor))) cursor -= 1;
  let currentStreak = 0;
  while (studied.has(keyFromDayNumber(cursor))) {
    currentStreak++;
    cursor -= 1;
  }

  const firstKey = days[0].date;
  const firstYear = Number(firstKey.slice(0, 4));
  const currentYear = now.getFullYear();
  const years: Heatmap['years'] = [];
  for (let year = firstYear; year <= currentYear; year++) {
    const start = year === firstYear ? dayNumber(firstKey) : dayNumber(`${year}-01-01`);
    const end = year === currentYear ? dayNumber(today) : dayNumber(`${year}-12-31`);
    const inYear = days.filter((d) => d.date.startsWith(`${year}-`));
    years.push({
      year,
      reviews: inYear.reduce((sum, d) => sum + d.count, 0),
      activeDays: inYear.length,
      periodDays: Math.max(end - start + 1, 0),
    });
  }

  return { today, days, years, longestStreak, currentStreak };
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
export function buildDashboard(
  sessions: DashboardSession[],
  cards: DashboardCard[],
  now: Date,
  dailyNewLimit: number | null = null,
): DashboardData {
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
  // Com limite diário de novos, só entram na conta de hoje os que ainda cabem (o limite menos os
  // que já foram estudados pela primeira vez hoje) — a mesma regra da fila da revisão global,
  // para o painel e o botão "Revisar pendentes" nunca discordarem.
  const newLearnedToday = todays.filter((r) => r.kind === 'new').length;
  const newToday = newCardsForToday(newCount, dailyNewLimit, newLearnedToday);
  const total = newToday + learning + due;

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
    dailyNewLimit,
    recentPaceSec: recentPace !== null ? recentPace / 1000 : null,
    remaining: {
      new: newToday,
      newWaiting: newCount - newToday,
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
    heatmap: buildHeatmap(reviews, now),
  };
}
