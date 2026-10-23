import type { DatabaseSync } from 'node:sqlite';

import { notFrozen } from '../collections/frozen';
import { nextSrsState, type SrsState } from '../srs';
import { buildDashboard, type DashboardCard, type DashboardSession } from '../stats/dashboard';
import { MAX_DAILY_NEW_LIMIT } from './limit';
import { getNewCardOrder, type NewCardOrder } from './newOrder';
import { chooseExam } from './nextExam';
import { getDailyNewLimit } from './store';

/**
 * A "meta para a prova": dado quanto falta para a prova, quantos cartões nunca foram vistos e
 * quantos estão atrasados, quantos cartões novos por dia são preciso para vê-los todos, quanto
 * trabalho isso dá por dia e se o ritmo atual fecha a conta.
 *
 * A carga futura vem de uma SIMULAÇÃO dia a dia com o próprio algoritmo de revisão do app
 * (`nextSrsState`), e não de uma regra de bolso: cada cartão novo volta no dia seguinte, depois
 * em 6 dias, depois em intervalos que crescem.
 */

/** Os últimos dias antes da prova ficam só para revisar: nenhum cartão novo entra. */
export const FINAL_REVIEW_DAYS = 7;
/** Faltando tão pouco, cartão novo já não dá tempo de consolidar: só se revisa. */
export const LAST_DAYS = 3;
/** Em quantos dias os cartões já vencidos são recuperados (todos num dia só não é realista). */
export const RECOVERY_DAYS = 7;
/** A janela, em dias, que mede o ritmo recente do usuário. */
export const PACE_WINDOW_DAYS = 14;
/** Margem sobre o tempo estimado, por causa dos erros ("Errei"), que a simulação não inclui. */
export const LAPSE_MARGIN = 1.15;
/** Não simula além disto: uma prova daqui a anos não precisa de gráfico dia a dia. */
export const MAX_PLAN_DAYS = 400;
const LIMIT_STEP = 5;
/** A facilidade com que o app começa um cartão novo (o padrão da coluna ease_factor). */
const INITIAL_EASE = 2.5;

const clampInt = (value: number, min: number, max: number) => Math.min(Math.max(Math.floor(value), min), max);

// ---------- simulação ----------

export interface SimCard extends SrsState {
  /** Em quantos dias do calendário o cartão vence; 0 ou menos = já venceu (ou vence hoje). */
  dueInDays: number;
}

export interface SimInput {
  /** Dias de estudo antes da prova; hoje é o dia 0 e o da prova não conta. */
  days: number;
  /** Só nos primeiros `newDays` dias entram cartões novos. */
  newDays: number;
  newCards: number;
  /** Quantos cartões novos entram por dia. */
  newPerDay: number;
  learned: SimCard[];
}

export interface SimOutput {
  /** Quantos cartões se estuda em cada dia (revisões mais os novos do dia). */
  perDay: number[];
  /** Quantos desses são novos. */
  newPerDay: number[];
}

/**
 * Simula `days` dias de estudo supondo que o usuário acerta tudo ("Bom"): é o caso base. Errar
 * aumenta a carga; por isso o tempo estimado leva uma margem (`LAPSE_MARGIN`).
 */
export function simulateWorkload(input: SimInput): SimOutput {
  const days = clampInt(input.days, 0, MAX_PLAN_DAYS);
  const perDay = new Array<number>(days).fill(0);
  const newPerDay = new Array<number>(days).fill(0);
  if (days === 0) return { perDay, newPerDay };

  const buckets: SrsState[][] = Array.from({ length: days }, () => []);
  const schedule = (state: SrsState, day: number) => {
    if (day >= 0 && day < days) buckets[day].push(state);
  };
  const afterGoodAnswer = (state: SrsState): { state: SrsState; interval: number } => {
    const next = nextSrsState(state, 'bom');
    return {
      state: { easeFactor: next.easeFactor, intervalDays: next.intervalDays, repetitions: next.repetitions },
      interval: next.intervalDays,
    };
  };

  // Os já vencidos entram espalhados nos primeiros dias, do mais atrasado ao menos.
  const recovery = Math.max(1, Math.min(RECOVERY_DAYS, days));
  input.learned
    .filter((card) => card.dueInDays <= 0)
    .sort((a, b) => a.dueInDays - b.dueInDays)
    .forEach((card, index) => schedule(card, index % recovery));
  for (const card of input.learned) if (card.dueInDays > 0) schedule(card, card.dueInDays);

  let remainingNew = Math.max(0, Math.floor(input.newCards));
  const dailyNew = Math.max(0, Math.floor(input.newPerDay));

  for (let day = 0; day < days; day++) {
    const due = buckets[day];
    for (const card of due) {
      const { state, interval } = afterGoodAnswer(card);
      schedule(state, day + interval);
    }

    const learnNow = day < input.newDays ? Math.min(remainingNew, dailyNew) : 0;
    remainingNew -= learnNow;
    for (let i = 0; i < learnNow; i++) {
      const { state, interval } = afterGoodAnswer({ easeFactor: INITIAL_EASE, intervalDays: 0, repetitions: 0 });
      schedule(state, day + interval);
    }

    perDay[day] = due.length + learnNow;
    newPerDay[day] = learnNow;
    buckets[day] = [];
  }
  return { perDay, newPerDay };
}

// ---------- o plano ----------

export type PlanVerdict = 'on_track' | 'tight' | 'behind' | 'no_pace' | 'last_days' | 'exam_today';

/**
 * Um jeito de chegar à prova: quantos cartões novos entram por dia (o limite diário a configurar) e
 * o que isso custa e cobre. Todos os números são médias até a prova, vindos da simulação.
 */
export interface PlanScenario {
  /** `current`: o que cabe no ritmo atual; `budget`: o que cabe num tempo diário fixo; `all`: ver todos os novos. */
  kind: 'current' | 'budget' | 'all';
  newPerDay: number;
  cardsPerDay: number;
  /** Tempo por dia para esses cartões, com a margem para erros. */
  minutesPerDay: number;
  /** Quantos dos cartões novos são vistos até a prova. */
  newSeen: number;
  /** Isso em % do total de novos (100 se não há novos). */
  coveragePct: number;
  /** A carga de cada dia até a prova. */
  perDay: number[];
}

export interface ExamPlan {
  exam: { id: string; name: string; examDate: string; daysLeft: number };
  verdict: PlanVerdict;
  /** Dias antes da prova reservados só para revisar. */
  finalReviewDays: number;
  /** Dias, a partir de hoje, em que ainda entram cartões novos. */
  newDays: number;
  cards: {
    /** Nunca estudados. */
    new: number;
    /** Vencidos ou que vencem hoje. */
    due: number;
    /** Já estudados (vencidos ou não). */
    learned: number;
  };
  /** O limite diário de cartões novos configurado (`null` = sem limite). */
  currentLimit: number | null;
  /** A ordem em que os novos entram na fila: a de criação ou a do edital (Configurações → Plano de estudo). */
  newOrder: NewCardOrder;
  pace: {
    windowDays: number;
    /** Cartões estudados por dia na janela, contando os dias sem estudo (é o que o usuário realmente faz por dia). */
    reviewsPerDay: number;
    /** Desses, quantos eram novos. */
    newPerDay: number;
    /** Em quantos dias da janela houve algum estudo. */
    activeDays: number;
    secPerReview: number | null;
  };
  /** Novos por dia necessários para ver todos antes dos dias de revisão final (`null` se não se aplica). */
  neededNewPerDay: number | null;
  /** Do mais enxuto ao mais completo; o último é sempre "ver todos" (ou só as revisões, sem novos). */
  scenarios: PlanScenario[];
}

export interface PlanInput {
  exam: ExamPlan['exam'];
  newCount: number;
  learned: SimCard[];
  currentLimit: number | null;
  newOrder: NewCardOrder;
  pace: ExamPlan['pace'];
}

/** Tempos diários, em minutos, oferecidos como cenário (só os que ficam entre o ritmo atual e "ver todos"). */
const BUDGET_MINUTES = [30, 45, 60, 90];
const MAX_BUDGET_SCENARIOS = 2;
/** Usado quando o usuário ainda não tem revisões recentes para medir o próprio tempo por cartão. */
const FALLBACK_SEC_PER_REVIEW = 30;
/** O ritmo é uma média medida, não um limite exato: estourar o orçamento em até 5% ainda "cabe". */
const BUDGET_TOLERANCE = 1.05;

/** O limite sugerido: a necessidade arredondada para cima, de 5 em 5 (e dentro do que o app aceita). */
export function suggestLimit(neededPerDay: number): number {
  const rounded = Math.ceil(neededPerDay / LIMIT_STEP) * LIMIT_STEP;
  return Math.min(Math.max(rounded, LIMIT_STEP), MAX_DAILY_NEW_LIMIT);
}

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);

export function buildExamPlan(input: PlanInput): ExamPlan {
  const { exam, newCount, learned, currentLimit, newOrder, pace } = input;
  const daysLeft = Math.max(0, exam.daysLeft);
  const days = Math.min(daysLeft, MAX_PLAN_DAYS);
  const finalReviewDays = days <= LAST_DAYS ? days : Math.min(FINAL_REVIEW_DAYS, Math.floor(days / 3));
  const newDays = days - finalReviewDays;

  const secPerReview = pace.secPerReview ?? FALLBACK_SEC_PER_REVIEW;
  const toMinutes = (cardsPerDay: number) => (cardsPerDay * secPerReview * LAPSE_MARGIN) / 60;
  const toCards = (minutes: number) => (minutes * 60) / (secPerReview * LAPSE_MARGIN);

  const neededNewPerDay = newCount > 0 && newDays > 0 ? Math.ceil(newCount / newDays) : null;
  const allLimit = neededNewPerDay === null ? 0 : suggestLimit(neededNewPerDay);

  const run = (limit: number) => simulateWorkload({ days, newDays, newCards: newCount, newPerDay: limit, learned });
  const scenario = (kind: PlanScenario['kind'], limit: number): PlanScenario => {
    const sim = run(limit);
    const cardsPerDay = days > 0 ? sum(sim.perDay) / days : 0;
    const newSeen = sum(sim.newPerDay);
    return {
      kind,
      newPerDay: limit,
      cardsPerDay,
      minutesPerDay: toMinutes(cardsPerDay),
      newSeen,
      coveragePct: newCount === 0 ? 100 : Math.round((newSeen / newCount) * 100),
      perDay: sim.perDay,
    };
  };
  /** O maior limite diário cujo trabalho médio por dia cabe em `budgetCards` (0 se nem as revisões já existentes cabem). */
  const largestLimitWithin = (budgetCards: number): number => {
    let low = 0;
    let high = allLimit;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (sum(run(mid).perDay) / days <= budgetCards * BUDGET_TOLERANCE) low = mid;
      else high = mid - 1;
    }
    return low;
  };

  const scenarios: PlanScenario[] = [];
  if (days > 0) {
    const everything = scenario('all', allLimit);
    if (neededNewPerDay !== null) {
      const taken = new Set<number>();
      const add = (item: PlanScenario) => {
        if (taken.has(item.newPerDay)) return;
        taken.add(item.newPerDay);
        scenarios.push(item);
      };
      if (pace.reviewsPerDay > 0) add(scenario('current', largestLimitWithin(pace.reviewsPerDay)));
      const floor = scenarios[0]?.minutesPerDay ?? 0;
      let offered = 0;
      for (const minutes of BUDGET_MINUTES) {
        if (offered >= MAX_BUDGET_SCENARIOS) break;
        // Só tempos que o ritmo atual não cobre e que "ver todos" não dispensa; e sem repetir um cenário já listado.
        if (minutes <= floor + 5 || minutes >= everything.minutesPerDay * 0.95) continue;
        const item = scenario('budget', largestLimitWithin(toCards(minutes)));
        if (!taken.has(item.newPerDay)) {
          add(item);
          offered++;
        }
      }
      // Se o ritmo atual já cobre tudo, "ver todos" é o mesmo cenário: não repete.
      if (!taken.has(everything.newPerDay)) add(everything);
    } else {
      scenarios.push(everything);
    }
  }

  let verdict: PlanVerdict;
  const current = scenarios.find((item) => item.kind === 'current');
  if (daysLeft === 0) verdict = 'exam_today';
  else if (newCount === 0) verdict = 'on_track';
  else if (newDays === 0) verdict = 'last_days';
  else if (!current) verdict = 'no_pace';
  else if (current.coveragePct >= 100) verdict = 'on_track';
  else if (current.coveragePct >= 80) verdict = 'tight';
  else verdict = 'behind';

  return {
    exam,
    verdict,
    finalReviewDays,
    newDays,
    cards: { new: newCount, due: learned.filter((card) => card.dueInDays <= 0).length, learned: learned.length },
    currentLimit,
    newOrder,
    pace,
    neededNewPerDay,
    scenarios,
  };
}

// ---------- leitura do banco ----------

const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Quantos dias do calendário (local) faltam para o momento `iso`; negativo se já passou. */
function dayDiff(iso: string, now: Date): number {
  const due = new Date(iso);
  const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueDay - today) / 86_400_000);
}

interface SessionRow {
  flashcard_id: string;
  result: DashboardSession['result'];
  studied_at: string;
  duration_ms: number | null;
}

interface CardRow {
  due_at: string | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
}

/**
 * O plano do usuário para o próximo concurso com data, ou `null` se ele não tem nenhum. Os cartões de coleções
 * congeladas não entram na conta: a meta é a carga das revisões, e congelar tira a coleção delas.
 */
export function loadExamPlan(db: DatabaseSync, userId: string, now: Date = new Date(), examId?: unknown): ExamPlan | null {
  const exam = chooseExam(db, userId, examId, now);
  if (!exam) return null;

  const cardRows = db
    .prepare(
      `SELECT f.due_at, f.ease_factor, f.interval_days, f.repetitions
       FROM flashcards f JOIN collections c ON c.id = f.collection_id WHERE c.user_id = ? AND ${notFrozen('c.id')}`,
    )
    .all(userId) as unknown as CardRow[];
  const sessions = db
    .prepare('SELECT flashcard_id, result, studied_at, duration_ms FROM study_sessions WHERE user_id = ?')
    .all(userId) as unknown as SessionRow[];
  const currentLimit = getDailyNewLimit(db, userId);

  let newCount = 0;
  const learned: SimCard[] = [];
  for (const row of cardRows) {
    if (row.due_at === null) {
      newCount++;
      continue;
    }
    learned.push({
      easeFactor: row.ease_factor,
      intervalDays: row.interval_days,
      repetitions: row.repetitions,
      dueInDays: dayDiff(row.due_at, now),
    });
  }

  // O ritmo recente: a janela termina hoje e conta os dias sem estudo (é o que o usuário realmente faz por dia).
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (PACE_WINDOW_DAYS - 1)).getTime();
  const firstReview = new Map<string, number>();
  const activeDays = new Set<string>();
  let reviewsInWindow = 0;
  for (const session of sessions) {
    const at = Date.parse(session.studied_at);
    const previous = firstReview.get(session.flashcard_id);
    if (previous === undefined || at < previous) firstReview.set(session.flashcard_id, at);
    if (at >= windowStart) {
      reviewsInWindow++;
      activeDays.add(localDateKey(new Date(at)));
    }
  }
  const newInWindow = [...firstReview.values()].filter((at) => at >= windowStart).length;

  const dashboard = buildDashboard(
    sessions.map((s): DashboardSession => ({ flashcardId: s.flashcard_id, result: s.result, studiedAt: s.studied_at, durationMs: s.duration_ms })),
    cardRows.map((c): DashboardCard => ({ dueAt: c.due_at, repetitions: c.repetitions, intervalDays: c.interval_days })),
    now,
    currentLimit,
  );

  return buildExamPlan({
    exam,
    newCount,
    learned,
    currentLimit,
    newOrder: getNewCardOrder(db, userId),
    pace: {
      windowDays: PACE_WINDOW_DAYS,
      reviewsPerDay: reviewsInWindow / PACE_WINDOW_DAYS,
      newPerDay: newInWindow / PACE_WINDOW_DAYS,
      activeDays: activeDays.size,
      secPerReview: dashboard.recentPaceSec,
    },
  });
}
