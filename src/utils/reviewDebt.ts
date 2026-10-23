/**
 * Dívida de revisão: os textos do cartão do Painel. Os números vêm do servidor (server/stats/reviewDebt.ts); aqui ficam as
 * frases e as faixas de cor.
 */
import type { ReviewDebt } from '../types';
import { plural } from './performance';

export type DebtTone = 'green' | 'amber' | 'red';

export const DEBT_TONE: Record<ReviewDebt['level'], DebtTone> = { ok: 'green', attention: 'amber', high: 'red' };

/** "393 cartões atrasados". */
export const debtHeadline = (overdue: number) => plural(overdue, 'cartão atrasado', 'cartões atrasados');

/** "O mais antigo está atrasado há 36 dias." */
export function oldestText(days: number | null): string | null {
  return days === null ? null : `O mais antigo está atrasado há ${plural(days, 'dia', 'dias')}.`;
}

/** Quantos atrasados há em cada faixa de atraso, sem as faixas vazias. */
export function lateBreakdown(lateBy: ReviewDebt['lateBy']): { label: string; count: number }[] {
  return [
    { label: '1 a 3 dias', count: lateBy.upTo3 },
    { label: '4 a 7 dias', count: lateBy.upTo7 },
    { label: '8 a 14 dias', count: lateBy.upTo14 },
    { label: 'mais de 14 dias', count: lateBy.over14 },
  ].filter((band) => band.count > 0);
}

/** O que a última semana de estudo foi: quanto de cartão novo e quanto de cartão que já tinha sido estudado. */
export function weekText(d: Pick<ReviewDebt, 'week' | 'newSharePct' | 'oldPerDay'>): string {
  if (d.week.reviews === 0) return 'Você não fez nenhuma revisão na última semana.';
  const perDay = d.oldPerDay.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return `Na última semana você fez ${plural(d.week.reviews, 'revisão', 'revisões')}: ${plural(d.week.newCards, 'de cartão novo', 'de cartões novos')} (${d.newSharePct}%) e ${plural(d.week.oldCards, 'de cartão já estudado', 'de cartões já estudados')} (${perDay} por dia).`;
}

/** O que esse ritmo faz com o atrasado. */
export function clearText(d: Pick<ReviewDebt, 'overdue' | 'daysToClear' | 'week'>): string {
  if (d.overdue === 0) return '';
  if (d.daysToClear === null) {
    return d.week.reviews === 0
      ? 'Sem revisões, o atrasado só cresce.'
      : 'Sem revisão de cartões já estudados na última semana, o atrasado só cresce.';
  }
  return `Nesse ritmo, zerar só o que já está atrasado levaria cerca de ${plural(d.daysToClear, 'dia', 'dias')}, e todo dia chegam mais.`;
}

/**
 * A sugestão sobre o limite de novos: só quando a dívida pede atenção e a maior parte da semana foi de cartão novo.
 * Nunca muda nada sozinha.
 */
export function limitHint(d: Pick<ReviewDebt, 'level' | 'newSharePct' | 'dailyNewLimit'>): string | null {
  if (d.level === 'ok' || d.newSharePct === null || d.newSharePct < 60) return null;
  if (d.dailyNewLimit === null) {
    return 'Sem limite diário, todos os cartões novos entram na fila. Enquanto o atrasado estiver alto, vale definir um limite em Configurações → Plano de estudo.';
  }
  return `Enquanto o atrasado estiver alto, vale baixar o limite diário de novos (hoje ${d.dailyNewLimit}, em Configurações → Plano de estudo) ou revisar os atrasados antes de ver cartões novos.`;
}

/** O botão da sessão: "Pôr em dia: os 25 atrasados mais antigos". */
export function batchLabel(batch: number): string {
  return batch === 1 ? 'Pôr em dia: o atrasado mais antigo' : `Pôr em dia: os ${batch.toLocaleString('pt-BR')} atrasados mais antigos`;
}
