/**
 * Reta final: para onde olhar nas últimas semanas antes da prova. Só leitura: nada aqui altera um cartão, o
 * agendamento ou o limite diário. Duas coisas, as duas sobre as coleções LIGADAS ao edital do concurso de data mais
 * próxima (o mesmo que a "Meta para a prova" e a ordem pelo edital usam):
 *
 *  1. a PRIORIDADE de cada disciplina: quanto da prova ainda está em aberto nela, ou seja, o peso na prova vezes o
 *     que falta dominar. Dominar = quanto dos cartões já foi visto × o acerto dos últimos 30 dias;
 *  2. a FILA DO FOCO: os cartões vencidos e, enquanto falta mais de uma semana, alguns novos, repartidos entre as
 *     disciplinas na proporção dessa prioridade, e não do peso puro.
 *
 * É uma estimativa para decidir onde gastar o tempo, não uma previsão de nota.
 */
import type { DatabaseSync } from 'node:sqlite';

import { mapFlashcard } from '../mappers';
import { FINAL_REVIEW_DAYS, LAST_DAYS } from './examPlan';
import { newCardsForToday } from './limit';
import { loadExamOrderContext, pickByExamWeight, type NewCardRef } from './newOrder';
import { chooseExam, type NextExam } from './nextExam';
import { countNewLearnedToday, getDailyNewLimit, type DueRow } from './store';

/** A janela, em dias, do acerto de cada disciplina. */
export const STATS_WINDOW_DAYS = 30;
/**
 * O acerto de quem tem poucas revisões balança demais: ele é puxado para 60% como se houvesse mais 5 revisões
 * (3 acertos). Com 30 revisões o peso desse "empurrão" já é pequeno.
 */
export const ACCURACY_PRIOR = 0.6;
export const ACCURACY_PRIOR_REVIEWS = 5;
/** Quantos cartões, no máximo, uma sessão do foco traz: mais que isso deixa de ser "o foco de hoje". */
export const MAX_FOCUS_CARDS = 100;
/** Quantos cartões novos a sessão traz quando o usuário não definiu limite diário (e ainda falta mais de uma semana). */
export const DEFAULT_FOCUS_NEW = 15;
/** Quantas disciplinas aparecem como "foco". */
export const FOCUS_TOP = 3;
/**
 * A parte da sessão (até 1/3) reservada aos cartões novos quando eles são permitidos. Sem isso, quem tem muitos vencidos
 * passaria dias só revisando e nunca veria cartão novo, e nas últimas semanas é a cobertura (quanto já foi visto) que
 * costuma pesar mais do que o acerto do que já se revisa. Se os vencidos não ocupam o resto, os novos também o recebem.
 */
export const NEW_SHARE_OF_SESSION = 1 / 3;

/**
 * Em que fase está a preparação, pelos dias que faltam: `content` (mais de 7 dias: ainda dá para ver conteúdo
 * novo), `review` (de 7 a 4: só revisão, como a "Meta para a prova" supõe) e `last` (3 ou menos).
 */
export type Phase = 'content' | 'review' | 'last';

export function phaseFor(daysLeft: number): Phase {
  if (daysLeft > FINAL_REVIEW_DAYS) return 'content';
  if (daysLeft > LAST_DAYS) return 'review';
  return 'last';
}

// ---------- a prioridade, pura ----------

/** O acerto (0 a 1) com o empurrão para 60% de quem tem poucas revisões. */
export function smoothedAccuracy(hits: number, reviews: number): number {
  return (hits + ACCURACY_PRIOR * ACCURACY_PRIOR_REVIEWS) / (reviews + ACCURACY_PRIOR_REVIEWS);
}

export interface DisciplineStats {
  id: string;
  name: string;
  /** Os pontos da disciplina na prova (questões vezes peso). */
  points: number;
  cards: number;
  newCards: number;
  dueCards: number;
  /** Revisões dos últimos 30 dias e quantas foram "Bom" ou "Fácil". */
  reviews: number;
  hits: number;
}

export interface RankedDiscipline {
  id: string;
  name: string;
  /** A fatia da prova, em %. */
  sharePct: number;
  cards: number;
  newCards: number;
  dueCards: number;
  /** Cartões que o usuário já viu ao menos uma vez, em % de todos os da disciplina. `null` sem cartões. */
  seenPct: number | null;
  /** O acerto dos últimos 30 dias (Bom ou Fácil). `null` sem revisões no período. */
  accuracyPct: number | null;
  reviews30: number;
  /** Quanto já está dominado: o visto vezes o acerto (suavizado), em %. `null` sem cartões. */
  masteryPct: number | null;
  /** Quanto da prova ainda está em aberto nesta disciplina (peso × o que falta dominar), em % da prova. */
  gainPct: number;
  /** A posição entre as que têm cartões (1 = a mais urgente); `null` se não tem cartões. */
  rank: number | null;
  hasCards: boolean;
}

/**
 * Ordena as disciplinas da mais urgente à menos: a que tem mais "pontos em aberto" (`gain = fatia da prova ×
 * (1 − domínio)`) vem primeiro; empate, a de mais pontos, e depois a ordem da prova. Disciplina sem nenhum cartão
 * vai para o fim e não recebe posição: não há o que revisar nela (o domínio dela é zero e a fatia inteira está em
 * aberto, mas o remédio é ligar coleções ao tópico, não revisar).
 */
export function rankDisciplines(inputs: DisciplineStats[]): RankedDiscipline[] {
  const total = inputs.reduce((sum, d) => sum + d.points, 0);
  const rows = inputs.map((d, index) => {
    const share = total > 0 ? d.points / total : 0;
    const hasCards = d.cards > 0;
    const seen = hasCards ? (d.cards - d.newCards) / d.cards : 0;
    const mastery = hasCards ? seen * smoothedAccuracy(d.hits, d.reviews) : 0;
    return { d, index, share, hasCards, seen, mastery, gain: share * (1 - mastery) };
  });
  const order = [...rows].sort(
    (a, b) =>
      Number(b.hasCards) - Number(a.hasCards) || b.gain - a.gain || b.d.points - a.d.points || a.index - b.index,
  );
  let rank = 0;
  return order.map((r): RankedDiscipline => ({
    id: r.d.id,
    name: r.d.name,
    sharePct: Math.round(r.share * 100),
    cards: r.d.cards,
    newCards: r.d.newCards,
    dueCards: r.d.dueCards,
    seenPct: r.hasCards ? Math.round(r.seen * 100) : null,
    accuracyPct: r.d.reviews > 0 ? Math.round((r.d.hits / r.d.reviews) * 100) : null,
    reviews30: r.d.reviews,
    masteryPct: r.hasCards ? Math.round(r.mastery * 100) : null,
    gainPct: Math.round(r.gain * 1000) / 10,
    rank: r.hasCards ? ++rank : null,
    hasCards: r.hasCards,
  }));
}

// ---------- a fila, pura ----------

export interface FocusSelection {
  due: string[];
  fresh: string[];
  /** Vencidos e novos elegíveis que ficaram de fora desta sessão (pelo teto de cartões ou pelo limite de novos). */
  waitingDue: number;
  waitingNew: number;
}

/**
 * Escolhe os cartões da sessão, até o teto. Os novos (até `newAllowed`) têm reservada uma parte do teto
 * (`NEW_SHARE_OF_SESSION`); os vencidos ficam com o resto, o mais atrasado de cada disciplina primeiro, e o que os
 * vencidos não usarem também vai para os novos. Em cada grupo, as disciplinas dividem as vagas na
 * proporção do seu `weight` (a prioridade), pela mesma escolha por cota da ordem pelo edital
 * (`pickByExamWeight`, sem "já estudados": a prioridade já os leva em conta). A sessão depois é embaralhada pela tela
 * de revisão, então só importa QUAIS cartões entram.
 *
 * @param due os vencidos de disciplinas do edital, do mais atrasado ao menos
 * @param fresh os novos de disciplinas do edital, na ordem de criação
 * @param weights a prioridade de cada disciplina (maior = mais vagas)
 */
export function selectFocus(input: {
  due: readonly NewCardRef[];
  fresh: readonly NewCardRef[];
  weights: ReadonlyMap<string, number>;
  maxCards: number;
  newAllowed: number;
}): FocusSelection {
  const max = Math.max(0, Math.floor(input.maxCards));
  const none = new Map<string, number>();
  const newWanted = Math.max(0, Math.min(Math.floor(input.newAllowed), input.fresh.length));
  const reserve = Math.min(newWanted, Math.floor(max * NEW_SHARE_OF_SESSION));
  const due = pickByExamWeight({ newCards: input.due, learnedByGroup: none, points: input.weights, count: Math.min(max - reserve, input.due.length) });
  const newCount = Math.min(newWanted, max - due.length);
  const fresh = newCount === 0 ? [] : pickByExamWeight({ newCards: input.fresh, learnedByGroup: none, points: input.weights, count: newCount });
  return {
    due,
    fresh,
    waitingDue: input.due.length - due.length,
    waitingNew: input.fresh.length - fresh.length,
  };
}

// ---------- o banco ----------

export interface FocusQueueSummary {
  /** Quantos cartões a sessão traz, e quantos são vencidos e quantos são novos. */
  total: number;
  due: number;
  new: number;
  /** O limite diário de novos do usuário (`null` = sem limite: entram até `defaultNew`). */
  limit: number | null;
  /** O teto de cartões de uma sessão e quantos novos entram por sessão sem limite diário (para a tela explicar). */
  maxCards: number;
  defaultNew: number;
  /** Vencidos e novos do edital que ficaram para outra sessão. */
  waitingDue: number;
  waitingNew: number;
  /** Vencidos e novos que não estão em nenhuma coleção ligada ao edital (não entram na sessão). */
  outsideDue: number;
  outsideNew: number;
}

export interface FinalStretch {
  /** O concurso de data mais próxima; `null` se nenhum tem data futura. */
  exam: NextExam | null;
  phase: Phase | null;
  /** As disciplinas do edital, da mais urgente à menos (as sem cartões por último). */
  disciplines: RankedDiscipline[];
  /** Os ids das `FOCUS_TOP` mais urgentes com cartões. */
  focus: string[];
  /** A fatia da prova (em %) das disciplinas que não têm nenhum cartão. */
  uncoveredSharePct: number;
  queue: FocusQueueSummary;
}

const EMPTY_QUEUE: FocusQueueSummary = {
  total: 0,
  due: 0,
  new: 0,
  limit: null,
  maxCards: MAX_FOCUS_CARDS,
  defaultNew: DEFAULT_FOCUS_NEW,
  waitingDue: 0,
  waitingNew: 0,
  outsideDue: 0,
  outsideNew: 0,
};

interface CardIdRow {
  id: string;
  collection_id: string;
}

/**
 * A reta final do usuário, e os ids dos cartões da sessão (vencidos e novos). Só leitura. `examId` é o concurso que o usuário
 * escolheu (se não vale, o de data mais próxima).
 */
export function computeFinalStretch(
  db: DatabaseSync,
  userId: string,
  now: Date = new Date(),
  examId?: unknown,
): { overview: FinalStretch; dueIds: string[]; newIds: string[] } {
  const context = loadExamOrderContext(db, userId, now, chooseExam(db, userId, examId, now));
  if (!context) {
    return { overview: { exam: null, phase: null, disciplines: [], focus: [], uncoveredSharePct: 0, queue: EMPTY_QUEUE }, dueIds: [], newIds: [] };
  }
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const cardStats = db
    .prepare(
      `SELECT f.collection_id AS collection_id, COUNT(*) AS cards,
              SUM(CASE WHEN f.due_at IS NULL THEN 1 ELSE 0 END) AS new_cards,
              SUM(CASE WHEN f.due_at IS NOT NULL AND f.due_at <= ? THEN 1 ELSE 0 END) AS due_cards
       FROM flashcards f JOIN collections c ON c.id = f.collection_id
       WHERE c.user_id = ? GROUP BY f.collection_id`,
    )
    .all(nowIso, userId) as unknown as { collection_id: string; cards: number; new_cards: number; due_cards: number }[];
  const reviewStats = db
    .prepare(
      `SELECT f.collection_id AS collection_id, COUNT(*) AS reviews,
              SUM(CASE WHEN s.result IN ('bom', 'facil') THEN 1 ELSE 0 END) AS hits
       FROM study_sessions s
       JOIN flashcards f ON f.id = s.flashcard_id
       JOIN collections c ON c.id = f.collection_id
       WHERE s.user_id = ? AND c.user_id = ? AND s.studied_at >= ? AND s.studied_at <= ?
       GROUP BY f.collection_id`,
    )
    .all(userId, userId, since, nowIso) as unknown as { collection_id: string; reviews: number; hits: number }[];

  const byDiscipline = new Map<string, DisciplineStats>(
    context.disciplines.map((d) => [d.id, { id: d.id, name: d.name, points: d.points, cards: 0, newCards: 0, dueCards: 0, reviews: 0, hits: 0 }]),
  );
  let outsideDue = 0;
  let outsideNew = 0;
  for (const row of cardStats) {
    const group = context.collectionGroup.get(row.collection_id);
    const stats = group ? byDiscipline.get(group) : undefined;
    if (!stats) {
      outsideDue += row.due_cards;
      outsideNew += row.new_cards;
      continue;
    }
    stats.cards += row.cards;
    stats.newCards += row.new_cards;
    stats.dueCards += row.due_cards;
  }
  for (const row of reviewStats) {
    const stats = byDiscipline.get(context.collectionGroup.get(row.collection_id) ?? '');
    if (!stats) continue;
    stats.reviews += row.reviews;
    stats.hits += row.hits;
  }

  const disciplines = rankDisciplines([...byDiscipline.values()]);
  const phase = phaseFor(context.exam.daysLeft);

  // Os candidatos da sessão: só cartões de coleções ligadas ao edital.
  const refs = (rows: CardIdRow[]): NewCardRef[] =>
    rows.flatMap((r) => {
      const group = context.collectionGroup.get(r.collection_id);
      return group ? [{ id: r.id, group }] : [];
    });
  const dueCards = refs(
    db
      .prepare(
        `SELECT f.id AS id, f.collection_id AS collection_id FROM flashcards f JOIN collections c ON c.id = f.collection_id
         WHERE c.user_id = ? AND f.due_at IS NOT NULL AND f.due_at <= ? ORDER BY f.due_at ASC, f.rowid ASC`,
      )
      .all(userId, nowIso) as unknown as CardIdRow[],
  );
  const freshCards = refs(
    db
      .prepare(
        `SELECT f.id AS id, f.collection_id AS collection_id FROM flashcards f JOIN collections c ON c.id = f.collection_id
         WHERE c.user_id = ? AND f.due_at IS NULL ORDER BY f.created_at ASC, f.rowid ASC`,
      )
      .all(userId) as unknown as CardIdRow[],
  );

  // Cartão novo só entra enquanto falta mais de uma semana (depois, só se revisa). Com limite diário, vale o que ainda
  // cabe hoje (contando o que já foi estudado pela primeira vez hoje); sem limite, um punhado.
  const limit = getDailyNewLimit(db, userId);
  const newAllowed =
    phase !== 'content'
      ? 0
      : limit === null
        ? DEFAULT_FOCUS_NEW
        : newCardsForToday(freshCards.length, limit, countNewLearnedToday(db, userId, now));

  const weights = new Map(disciplines.filter((d) => d.hasCards).map((d) => [d.id, Math.max(d.gainPct, 0.01)]));
  const picked = selectFocus({ due: dueCards, fresh: freshCards, weights, maxCards: MAX_FOCUS_CARDS, newAllowed });

  const withCards = disciplines.filter((d) => d.hasCards);
  const uncoveredSharePct = disciplines.filter((d) => !d.hasCards).reduce((sum, d) => sum + d.sharePct, 0);
  return {
    overview: {
      exam: context.exam,
      phase,
      disciplines,
      focus: withCards.slice(0, FOCUS_TOP).map((d) => d.id),
      uncoveredSharePct,
      queue: {
        total: picked.due.length + picked.fresh.length,
        due: picked.due.length,
        new: picked.fresh.length,
        limit,
        maxCards: MAX_FOCUS_CARDS,
        defaultNew: DEFAULT_FOCUS_NEW,
        waitingDue: picked.waitingDue,
        waitingNew: picked.waitingNew,
        outsideDue,
        outsideNew,
      },
    },
    dueIds: picked.due,
    newIds: picked.fresh,
  };
}

/** O resumo para a tela. */
export function loadFinalStretch(db: DatabaseSync, userId: string, now: Date = new Date(), examId?: unknown): FinalStretch {
  return computeFinalStretch(db, userId, now, examId).overview;
}

export type FocusCard = ReturnType<typeof mapFlashcard> & { collectionName: string; collectionSubject: string };

/** Os cartões da sessão do foco, prontos para a tela de revisão (a tela os embaralha). */
export function loadFocusCards(db: DatabaseSync, userId: string, now: Date = new Date(), examId?: unknown): FocusCard[] {
  const { dueIds, newIds } = computeFinalStretch(db, userId, now, examId);
  const ids = [...dueIds, ...newIds];
  if (ids.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT f.*, c.name AS collection_name, c.subject AS collection_subject
       FROM flashcards f JOIN collections c ON c.id = f.collection_id
       WHERE c.user_id = ? AND f.id IN (${ids.map(() => '?').join(', ')})`,
    )
    .all(userId, ...ids) as unknown as DueRow[];
  const position = new Map(ids.map((id, i) => [id, i]));
  return rows
    .sort((a, b) => position.get(a.id)! - position.get(b.id)!)
    .map((row) => ({ ...mapFlashcard(row), collectionName: row.collection_name, collectionSubject: row.collection_subject }));
}
