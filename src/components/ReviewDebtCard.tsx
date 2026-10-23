import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, PlayCircle } from 'lucide-react';

import { statsApi } from '../services/api';
import type { ReviewDebt } from '../types';
import { batchLabel, clearText, DEBT_TONE, debtHeadline, lateBreakdown, limitHint, oldestText, weekText, type DebtTone } from '../utils/reviewDebt';

const TONE_CLASS: Record<DebtTone, string> = {
  green: 'border-brand-200 bg-brand-50/60 dark:border-brand-900 dark:bg-brand-950/20',
  amber: 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20',
  red: 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20',
};

const NUMBER_CLASS: Record<DebtTone, string> = {
  green: 'text-brand-700 dark:text-brand-300',
  amber: 'text-amber-700 dark:text-amber-300',
  red: 'text-red-700 dark:text-red-300',
};

/**
 * Dívida de revisão, no Painel: quantos cartões já estudados venceram antes de hoje e ainda não foram revisados, há
 * quantos dias, e como foi a última semana (cartão novo × cartão já estudado). O botão abre uma sessão só com os
 * atrasados há mais tempo. Só leitura: nada aqui muda um cartão. Some quando não há atrasados ou se a leitura falhar
 * (o resto do Painel não depende dela).
 */
export function ReviewDebtCard() {
  const [debt, setDebt] = useState<ReviewDebt | null>(null);

  useEffect(() => {
    let current = true;
    statsApi
      .reviewDebt()
      .then((result) => current && setDebt(result))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  if (!debt || debt.overdue === 0) return null;

  const tone = DEBT_TONE[debt.level];
  const hint = limitHint(debt);
  const oldest = oldestText(debt.oldestDays);

  return (
    <section className={`mb-6 rounded-xl border p-5 ${TONE_CLASS[tone]}`} aria-label="Dívida de revisão">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            <CalendarClock size={16} className="text-neutral-500 dark:text-neutral-400" />
            Dívida de revisão
          </h2>
          <p className={`mt-1 text-2xl font-bold ${NUMBER_CLASS[tone]}`}>{debtHeadline(debt.overdue)}</p>
          {oldest && <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-300">{oldest}</p>}
        </div>
        <Link to="/atrasados/estudar" className="btn-primary shrink-0" title="Uma sessão só com os cartões que venceram há mais tempo. Nenhum cartão novo entra.">
          <PlayCircle size={16} />
          {batchLabel(debt.batch)}
        </Link>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-600 dark:text-neutral-300" aria-label="Atrasados por tempo de atraso">
        {lateBreakdown(debt.lateBy).map((band) => (
          <li key={band.label} className="rounded-full bg-white/70 px-2.5 py-1 dark:bg-neutral-900/40">
            <span className="font-semibold text-neutral-800 dark:text-neutral-100">{band.count.toLocaleString('pt-BR')}</span> há {band.label}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-300">
        {weekText(debt)} {clearText(debt)}
      </p>
      {hint && <p className="mt-2 text-xs font-medium text-neutral-700 dark:text-neutral-200">{hint}</p>}
      <p className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
        Atrasado é o cartão já estudado que venceu antes de hoje (coleções congeladas não contam). Eles também estão em "Revisar pendentes"; aqui vêm
        sozinhos, os mais antigos primeiro, num lote menor.
      </p>
    </section>
  );
}
