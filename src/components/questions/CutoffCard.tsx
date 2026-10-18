import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleHelp, Target, XCircle } from 'lucide-react';

import { ApiError } from '../../services/api';
import { questionBankApi } from '../../services/questionBankApi';
import type { QbAttemptCutoff, QbCutoffStatus, QbDisciplineResult } from '../../types';
import { formatPct, marginText, practiceHref, STATUS_LABEL, verdictLine } from '../../utils/cutoff';

const TONE: Record<QbCutoffStatus, { text: string; bar: string; icon: typeof CheckCircle2 }> = {
  above: { text: 'text-brand-700 dark:text-brand-300', bar: 'bg-brand-600', icon: CheckCircle2 },
  below: { text: 'text-red-700 dark:text-red-300', bar: 'bg-red-500', icon: XCircle },
  unknown: { text: 'text-neutral-500 dark:text-neutral-400', bar: 'bg-neutral-400', icon: CircleHelp },
};

/** A barra de acertos de uma disciplina, com a nota de corte marcada nela. */
export function CutoffBar({ pct, cutoffPct, status }: { pct: number; cutoffPct: number | null; status: QbCutoffStatus }) {
  return (
    <div className="relative h-2.5 rounded-full bg-neutral-100 dark:bg-neutral-800" role="img" aria-label={`${formatPct(pct)} de acertos${cutoffPct !== null ? `, nota de corte ${formatPct(cutoffPct)}` : ''}`}>
      <div className={`h-full rounded-full ${TONE[status].bar}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      {cutoffPct !== null && (
        <div className="absolute -top-1 bottom-[-4px] w-0.5 bg-neutral-800 dark:bg-neutral-200" style={{ left: `${Math.min(100, cutoffPct)}%` }} title={`Nota de corte: ${formatPct(cutoffPct)}`} />
      )}
    </div>
  );
}

function Row({ d }: { d: QbDisciplineResult }) {
  const tone = TONE[d.status];
  const Icon = tone.icon;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          <Icon size={15} className={tone.text} aria-label={STATUS_LABEL[d.status]} />
          {d.label}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {d.correct} de {d.total} · <span className="font-semibold">{formatPct(d.pct)}</span>
        </p>
      </div>
      <div className="mt-2">
        <CutoffBar pct={d.pct} cutoffPct={d.cutoffPct} status={d.status} />
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={tone.text}>
          {d.cutoffPct !== null ? `Nota de corte ${formatPct(d.cutoffPct)}: ` : d.cutoffText ? `Critério “${d.cutoffText}”: ` : ''}
          {marginText(d)}
        </span>
        {d.lowSample && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200" title="Com tão poucas questões a nota balança muito">
            <AlertTriangle size={11} /> poucas questões
          </span>
        )}
        {d.status === 'below' && d.sourceLabels.length > 0 && (
          <Link to={practiceHref(d.sourceLabels)} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Ver as que errei
          </Link>
        )}
      </p>
    </li>
  );
}

/** O resultado de um simulado contra a nota de corte do concurso, disciplina por disciplina. */
export function CutoffCard({ attemptId }: { attemptId: string }) {
  const [examId, setExamId] = useState<string | undefined>(undefined);
  const [data, setData] = useState<QbAttemptCutoff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    questionBankApi
      .attemptCutoff(attemptId, examId)
      .then((r) => alive && setData(r))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Não foi possível comparar com a nota de corte.'));
    return () => {
      alive = false;
    };
  }, [attemptId, examId]);

  if (error) return null; // o resultado do simulado vale sem isto
  if (!data) return null;
  const { comparison } = data;

  return (
    <section className="card mt-6 p-5" aria-label="Nota de corte">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          <Target size={15} />
          Contra a nota de corte
        </h2>
        {data.exams.length > 1 && (
          <select className="input-field w-auto py-1.5 pr-8 text-xs" value={data.exam?.id ?? ''} onChange={(e) => setExamId(e.target.value)} aria-label="Concurso">
            {data.exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {data.exam && data.exams.length <= 1 && <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{data.exam.name}</p>}

      {!data.hasBreakdown && (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">Este simulado foi feito antes de o placar por disciplina ser guardado, então não dá para compará-lo.</p>
      )}
      {data.hasBreakdown && !data.exam && (
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
          Para comparar com a nota de corte, cadastre o seu <Link to="/concursos" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">concurso</Link> com o critério mínimo de cada disciplina.
        </p>
      )}

      {comparison && (
        <>
          {data.exam && (
            <p className={`mt-3 text-sm font-semibold ${TONE[comparison.verdict].text}`}>{verdictLine(comparison)}</p>
          )}
          {comparison.estimatedPct !== null && (
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Nota estimada na prova, pelo peso de cada disciplina: <span className="font-semibold">{formatPct(comparison.estimatedPct)}</span>. É uma estimativa: com poucas questões por disciplina a nota balança.
            </p>
          )}
          {comparison.disciplines.length > 0 && (
            <ul className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
              {comparison.disciplines.map((d) => (
                <Row key={d.examDisciplineId ?? d.label} d={d} />
              ))}
            </ul>
          )}
          {comparison.notCovered.length > 0 && (
            <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
              Com critério mínimo e não cobertas por este simulado: {comparison.notCovered.map((n) => `${n.name} (${n.cutoffText})`).join('; ')}.
            </p>
          )}
          {comparison.unmatched.length > 0 && (
            <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-300">
              <p className="font-semibold">
                {data.exam ? 'Sem correspondência no concurso:' : 'Seu placar por disciplina:'}{' '}
                {comparison.unmatched.map((u) => `${u.label} (${u.correct} de ${u.total})`).join('; ')}.
              </p>
              {data.exam && (
                <p className="mt-1">Para entrarem na comparação, deixe o nome da disciplina das questões (botão Corrigir) igual ao do concurso.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
