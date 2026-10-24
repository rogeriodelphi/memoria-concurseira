import { Link } from 'react-router-dom';
import { AlertTriangle, BookX, CheckCircle2, Filter } from 'lucide-react';

import type { PerformanceData } from '../../types';
import { attentionPoints, hasEnoughData, LOW_ACCURACY, MIN_REVIEWS, missedHref } from '../../utils/attention';
import { plural } from '../../utils/performance';

/**
 * "Pontos de atenção": onde o acerto está baixo ou caindo no período, do mais urgente ao menos. Cada ponto traz o
 * motivo e dois botões: "Revisar os errados" abre só os cartões que você errou ali (vencidos ou não) e "Filtrar"
 * leva a página inteira para aquele grupo.
 */
export function AttentionPoints({
  data,
  returnTo,
  onFilter,
}: {
  data: PerformanceData;
  /** O endereço desta página com o período e os filtros de agora, para o "voltar" da revisão. */
  returnTo: string;
  onFilter: (nameKey: string, subjectKey: string | null) => void;
}) {
  const points = attentionPoints(data);

  return (
    <section className="card p-6" aria-label="Pontos de atenção">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        <AlertTriangle size={16} className="text-amber-500" />
        Pontos de atenção
      </h2>
      <p className="mb-4 mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        Onde o acerto está abaixo de {LOW_ACCURACY}% ou caiu bastante em relação ao período anterior (só com {MIN_REVIEWS} revisões ou mais). Os cartões de coleções congeladas não entram nos errados para rever.
      </p>

      {points.length === 0 ? (
        <p className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          {hasEnoughData(data) ? (
            <>
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
              Nenhum ponto de atenção neste período: nenhum assunto com revisões suficientes está abaixo de {LOW_ACCURACY}% ou em queda forte.
            </>
          ) : (
            'Ainda há poucas revisões neste período para apontar pontos de atenção. Escolha um período maior ou continue estudando.'
          )}
        </p>
      ) : (
        <ul className="space-y-3">
          {points.map((point) => (
            <li key={`${point.nameKey}/${point.subjectKey ?? ''}`} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{point.label}</p>
                  <ul className="mt-1 space-y-0.5">
                    {point.reasons.map((reason) => (
                      <li key={reason} className="text-xs text-red-600 dark:text-red-400">
                        {reason}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {plural(point.counts.missedCards, 'cartão errado', 'cartões errados')} · {plural(point.counts.reviews, 'revisão', 'revisões')} no período
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to={missedHref(point, data.range, returnTo)} className="btn-primary !py-1.5 text-xs">
                    <BookX size={14} />
                    Revisar os {point.counts.missedCards.toLocaleString('pt-BR')} {point.counts.missedCards === 1 ? 'errado' : 'errados'}
                  </Link>
                  <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => onFilter(point.nameKey, point.subjectKey)}>
                    <Filter size={14} />
                    Filtrar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
