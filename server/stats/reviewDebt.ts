/**
 * Dívida de revisão: os cartões já estudados que venceram antes de hoje e ainda não foram revisados, e se o ritmo da
 * última semana dá conta deles. Só leitura: nada aqui muda um cartão, o agendamento ou a fila de ninguém.
 *
 * Um cartão novo que entra todo dia volta nos dias seguintes para revisão; quem gasta quase todo o estudo em cartões
 * novos e pouco em revisões vê o atrasado crescer (e o que não é revisado a tempo se esquece). Este módulo mede isso: o
 * atrasado (e há quantos dias), quanto da última semana foi cartão novo e quanto foi cartão antigo, e quantos dias levaria
 * para zerar o atrasado nesse ritmo.
 */
import type { DatabaseSync } from 'node:sqlite';

import { notFrozen } from '../collections/frozen';
import { SELECT_CARDS, getDailyNewLimit, type DueRow } from '../studyplan/store';

/** Quantos atrasados já pedem atenção, e a partir de quantos a dívida é alta. */
export const DEBT_ATTENTION = 25;
export const DEBT_HIGH = 100;
/** Quantos cartões uma sessão "Pôr em dia" traz: os atrasados há mais tempo. */
export const DEBT_BATCH = 25;
/** A janela, em dias (contando hoje), que mede o ritmo de revisão. */
export const DEBT_WINDOW_DAYS = 7;

export type DebtLevel = 'ok' | 'attention' | 'high';

export function debtLevel(overdue: number): DebtLevel {
  if (overdue >= DEBT_HIGH) return 'high';
  if (overdue >= DEBT_ATTENTION) return 'attention';
  return 'ok';
}

export interface LateBuckets {
  /** Quantos estão atrasados há 1 a 3 dias, 4 a 7, 8 a 14 e mais de 14. */
  upTo3: number;
  upTo7: number;
  upTo14: number;
  over14: number;
}

/** Reparte os atrasados pelos dias de atraso (cada valor é 1 ou mais). */
export function lateBuckets(daysLate: readonly number[]): LateBuckets {
  const buckets: LateBuckets = { upTo3: 0, upTo7: 0, upTo14: 0, over14: 0 };
  for (const days of daysLate) {
    if (days <= 3) buckets.upTo3++;
    else if (days <= 7) buckets.upTo7++;
    else if (days <= 14) buckets.upTo14++;
    else buckets.over14++;
  }
  return buckets;
}

export interface ReviewDebt {
  /** Os cartões estudados que venceram antes de hoje (não conta coleção congelada). */
  overdue: number;
  lateBy: LateBuckets;
  /** Há quantos dias está atrasado o mais antigo; `null` sem atrasados. */
  oldestDays: number | null;
  /** A última semana: revisões feitas, quantas foram a primeira vez de um cartão (novo) e quantas de cartão já estudado. */
  week: { days: number; reviews: number; newCards: number; oldCards: number };
  /** Revisões de cartões já estudados por dia, em média na janela. */
  oldPerDay: number;
  /** O cartão novo em % das revisões da semana; `null` sem revisões na semana. */
  newSharePct: number | null;
  /** Em quantos dias o atrasado acabaria no ritmo da semana (sem contar o que vence nesse meio-tempo); `null` sem revisões de cartões antigos. */
  daysToClear: number | null;
  level: DebtLevel;
  /** Quantos cartões a sessão "Pôr em dia" traz agora. */
  batch: number;
  /** O limite diário de cartões novos do usuário; `null` = sem limite. */
  dailyNewLimit: number | null;
}

export interface DebtInput {
  /** Para cada atrasado, os dias de atraso (1 ou mais). */
  daysLate: readonly number[];
  weekReviews: number;
  weekNewCards: number;
  dailyNewLimit: number | null;
}

/** O resumo da dívida, a partir dos números já lidos (puro). */
export function buildReviewDebt(input: DebtInput): ReviewDebt {
  const overdue = input.daysLate.length;
  const newCards = Math.min(Math.max(input.weekNewCards, 0), input.weekReviews);
  const oldCards = input.weekReviews - newCards;
  const oldPerDay = oldCards / DEBT_WINDOW_DAYS;
  return {
    overdue,
    lateBy: lateBuckets(input.daysLate),
    oldestDays: overdue > 0 ? Math.max(...input.daysLate) : null,
    week: { days: DEBT_WINDOW_DAYS, reviews: input.weekReviews, newCards, oldCards },
    oldPerDay: Math.round(oldPerDay * 10) / 10,
    newSharePct: input.weekReviews > 0 ? Math.round((newCards / input.weekReviews) * 100) : null,
    daysToClear: overdue > 0 && oldPerDay > 0 ? Math.ceil(overdue / oldPerDay) : null,
    level: debtLevel(overdue),
    batch: Math.min(overdue, DEBT_BATCH),
    dailyNewLimit: input.dailyNewLimit,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Dias de calendário (local) entre o dia de `iso` e o começo de hoje, a partir de 1. */
function daysLateOf(iso: string, today: Date): number {
  const due = startOfDay(new Date(iso));
  return Math.max(1, Math.round((today.getTime() - due.getTime()) / DAY_MS));
}

export function loadReviewDebt(db: DatabaseSync, userId: string, now: Date = new Date()): ReviewDebt {
  const today = startOfDay(now);
  const overdueRows = db
    .prepare(
      `SELECT f.due_at AS due_at FROM flashcards f JOIN collections c ON c.id = f.collection_id
       WHERE c.user_id = ? AND f.due_at IS NOT NULL AND f.due_at < ? AND ${notFrozen('c.id')}`,
    )
    .all(userId, today.toISOString()) as unknown as { due_at: string }[];

  const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DEBT_WINDOW_DAYS - 1)).toISOString();
  // Uma revisão é "de cartão novo" quando é a primeira de todos os tempos daquele cartão (a mesma definição do Painel).
  const week = db
    .prepare(
      `SELECT COUNT(*) AS reviews, COALESCE(SUM(CASE WHEN s.studied_at = first.at THEN 1 ELSE 0 END), 0) AS new_cards
       FROM study_sessions s
       JOIN (SELECT flashcard_id, MIN(studied_at) AS at FROM study_sessions WHERE user_id = ? GROUP BY flashcard_id) first
         ON first.flashcard_id = s.flashcard_id
       WHERE s.user_id = ? AND s.studied_at >= ? AND s.studied_at <= ?`,
    )
    .get(userId, userId, windowStart, now.toISOString()) as unknown as { reviews: number; new_cards: number };

  return buildReviewDebt({
    daysLate: overdueRows.map((r) => daysLateOf(r.due_at, today)),
    weekReviews: week.reviews,
    weekNewCards: week.new_cards,
    dailyNewLimit: getDailyNewLimit(db, userId),
  });
}

/**
 * Os `limit` cartões atrasados há mais tempo (venceram antes de hoje), do mais atrasado ao menos, para uma sessão "Pôr
 * em dia". Só cartões já estudados e fora de coleções congeladas; nenhum novo entra.
 */
export function loadOverdueCards(db: DatabaseSync, userId: string, now: Date = new Date(), limit: number = DEBT_BATCH): DueRow[] {
  const today = startOfDay(now);
  return db
    .prepare(
      `${SELECT_CARDS} WHERE c.user_id = ? AND f.due_at IS NOT NULL AND f.due_at < ? AND ${notFrozen('c.id')}
       ORDER BY f.due_at ASC, f.rowid ASC LIMIT ?`,
    )
    .all(userId, today.toISOString(), Math.max(0, Math.floor(limit))) as unknown as DueRow[];
}
