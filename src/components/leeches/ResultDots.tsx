import type { StudyResult } from '../../types';
import { OUTCOME_LABEL, resultsSummary } from '../../utils/leeches';

const DOT: Record<StudyResult, string> = {
  errei: 'bg-red-500',
  dificil: 'bg-amber-400',
  bom: 'bg-emerald-500',
  facil: 'bg-sky-400',
};

/** As últimas revisões de um cartão, da mais antiga para a mais nova, uma bolinha por revisão. */
export function ResultDots({ results }: { results: StudyResult[] }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Últimas revisões: ${resultsSummary(results)}`}>
      {results.map((result, i) => (
        <span key={i} title={OUTCOME_LABEL[result]} className={`h-2.5 w-2.5 rounded-full ${DOT[result]}`} />
      ))}
    </span>
  );
}

/** O que cada cor quer dizer. */
export function ResultLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
      {(Object.keys(DOT) as StudyResult[]).map((result) => (
        <span key={result} className="inline-flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${DOT[result]}`} />
          {OUTCOME_LABEL[result]}
        </span>
      ))}
    </p>
  );
}
