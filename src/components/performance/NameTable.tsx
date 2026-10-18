import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Filter, Minus, TrendingDown, TrendingUp } from 'lucide-react';

import type { PerformanceCounts, PerformanceName } from '../../types';
import { accuracyTone, trendOf, trendText, type Tone } from '../../utils/performance';

const TONE_CLASS: Record<Tone, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  ok: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
};

/** O acerto de uma linha, colorido, com a seta de tendência em relação ao período anterior. */
function Accuracy({ counts }: { counts: PerformanceCounts }) {
  const trend = trendOf(counts.accuracyPct, counts.previousAccuracyPct);
  return (
    <span className={`inline-flex items-center justify-end gap-1.5 font-semibold ${TONE_CLASS[accuracyTone(counts.accuracyPct)]}`} title={trendText(counts.accuracyPct, counts.previousAccuracyPct)}>
      {counts.accuracyPct}%
      {trend === 'up' && <TrendingUp size={14} aria-label="Subiu em relação ao período anterior" className="text-emerald-500" />}
      {trend === 'down' && <TrendingDown size={14} aria-label="Caiu em relação ao período anterior" className="text-red-500" />}
      {trend === 'flat' && <Minus size={14} aria-label="Estável em relação ao período anterior" className="text-neutral-400" />}
    </span>
  );
}

const CELL = 'px-3 py-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300';

/**
 * O desempenho por nome de coleção: cartões, revisões, acertos, erros e o acerto com a tendência. Cada nome
 * abre e mostra os assuntos dele; o funil liga o filtro daquele nome (ou daquele assunto dentro dele).
 */
export function NameTable({
  rows,
  activeName,
  activeSubject,
  onFilter,
}: {
  rows: PerformanceName[];
  activeName: string | null;
  activeSubject: string | null;
  onFilter: (name: string, subject: string | null) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-neutral-50 text-xs text-neutral-500 dark:bg-neutral-800/50 dark:text-neutral-400">
            <th className="rounded-l-lg px-3 py-2.5 text-left font-medium">Nome da coleção</th>
            <th className="px-3 py-2.5 text-right font-medium">Cartões</th>
            <th className="px-3 py-2.5 text-right font-medium">Revisões</th>
            <th className="px-3 py-2.5 text-right font-medium">Acertos</th>
            <th className="px-3 py-2.5 text-right font-medium">Erros</th>
            <th className="px-3 py-2.5 text-right font-medium">Desempenho</th>
            <th className="w-20 rounded-r-lg px-3 py-2.5" aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = open.has(row.key);
            const filtered = activeName === row.key && activeSubject === null;
            return (
              <Fragment key={row.key}>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                    <button type="button" onClick={() => toggle(row.key)} aria-expanded={expanded} className="flex items-center gap-2 text-left">
                      {expanded ? <ChevronDown size={16} className="shrink-0 text-neutral-400" /> : <ChevronRight size={16} className="shrink-0 text-neutral-400" />}
                      <span className="sr-only">{expanded ? 'Fechar os assuntos de' : 'Abrir os assuntos de'}</span>
                    </button>
                    {row.collectionIds.length === 1 ? (
                      <Link to={`/colecoes/${row.collectionIds[0]}`} className="hover:text-brand-600 dark:hover:text-brand-400">
                        {row.label}
                      </Link>
                    ) : (
                      row.label
                    )}
                    <span className="ml-2 text-xs font-normal text-neutral-400 dark:text-neutral-500">
                      {row.subjects.length} {row.subjects.length === 1 ? 'assunto' : 'assuntos'}
                    </span>
                  </td>
                  <td className={CELL}>{row.cards.toLocaleString('pt-BR')}</td>
                  <td className={CELL}>{row.reviews.toLocaleString('pt-BR')}</td>
                  <td className={`${CELL} text-emerald-600 dark:text-emerald-400`}>{row.good.toLocaleString('pt-BR')}</td>
                  <td className={`${CELL} text-red-600 dark:text-red-400`}>{row.bad.toLocaleString('pt-BR')}</td>
                  <td className={CELL}>
                    <Accuracy counts={row} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onFilter(row.key, null)}
                      aria-pressed={filtered}
                      title={filtered ? 'Tirar este filtro' : 'Filtrar a página por este nome'}
                      aria-label={`${filtered ? 'Tirar o filtro de' : 'Filtrar por'} ${row.label}`}
                      className={`rounded-md p-1.5 transition-colors ${filtered ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'}`}
                    >
                      <Filter size={15} />
                    </button>
                  </td>
                </tr>

                {expanded &&
                  row.subjects.map((subject) => {
                    const subjectFiltered = activeName === row.key && activeSubject === subject.key;
                    return (
                      <tr key={`${row.key}/${subject.key}`} className="border-b border-neutral-100 bg-neutral-50/60 text-[13px] dark:border-neutral-800 dark:bg-neutral-800/20">
                        <td className="py-2.5 pl-12 pr-3 text-neutral-700 dark:text-neutral-300">{subject.label}</td>
                        <td className={`${CELL} py-2.5`}>{subject.cards.toLocaleString('pt-BR')}</td>
                        <td className={`${CELL} py-2.5`}>{subject.reviews.toLocaleString('pt-BR')}</td>
                        <td className={`${CELL} py-2.5 text-emerald-600 dark:text-emerald-400`}>{subject.good.toLocaleString('pt-BR')}</td>
                        <td className={`${CELL} py-2.5 text-red-600 dark:text-red-400`}>{subject.bad.toLocaleString('pt-BR')}</td>
                        <td className={`${CELL} py-2.5`}>
                          <Accuracy counts={subject} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => onFilter(row.key, subject.key)}
                            aria-pressed={subjectFiltered}
                            title={subjectFiltered ? 'Tirar este filtro' : 'Filtrar a página por este nome e assunto'}
                            aria-label={`${subjectFiltered ? 'Tirar o filtro de' : 'Filtrar por'} ${row.label}, ${subject.label}`}
                            className={`rounded-md p-1.5 transition-colors ${subjectFiltered ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'}`}
                          >
                            <Filter size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
