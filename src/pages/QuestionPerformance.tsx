import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Play, Target } from 'lucide-react';

import { BankTabs } from '../components/questions/BankTabs';
import { CutoffBar } from '../components/questions/CutoffCard';
import { ApiError } from '../services/api';
import { questionBankApi } from '../services/questionBankApi';
import type { QbCutoffOverview, QbCutoffStatus, QbOverviewDiscipline, QbTrend } from '../types';
import { formatPct, marginText, overviewLine, practiceHref, sparkline, STATUS_LABEL, TREND_LABEL } from '../utils/cutoff';
import { percent } from '../utils/questionBank';

const TONE: Record<QbCutoffStatus, string> = {
  above: 'text-brand-700 dark:text-brand-300',
  below: 'text-red-700 dark:text-red-300',
  unknown: 'text-neutral-500 dark:text-neutral-400',
};

const BADGE: Record<QbCutoffStatus, string> = {
  above: 'bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200',
  below: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  unknown: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

const TREND_ICON: Record<QbTrend, typeof ArrowUpRight> = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };

const SPARK_W = 220;
const SPARK_H = 56;

/** A nota de uma disciplina em cada simulado, com a linha da nota de corte. */
function Spark({ d }: { d: QbOverviewDiscipline }) {
  const spark = sparkline(d.series.map((p) => p.pct), SPARK_W, SPARK_H, d.cutoffPct);
  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className="h-14 w-full max-w-[260px] sm:w-[220px] sm:shrink-0" role="img" aria-label={`Notas nos últimos ${d.series.length} simulados: ${d.series.map((p) => formatPct(p.pct)).join(', ')}`}>
      {spark.cutoffY !== null && <line x1="0" x2={SPARK_W} y1={spark.cutoffY} y2={spark.cutoffY} strokeDasharray="4 3" className="stroke-neutral-400 dark:stroke-neutral-500" strokeWidth="1" />}
      {spark.path && <path d={spark.path} fill="none" strokeWidth="2" strokeLinejoin="round" className="stroke-brand-600 dark:stroke-brand-400" />}
      {spark.dots.map((dot, i) => (
        <circle key={i} cx={dot.x} cy={dot.y} r={i === spark.dots.length - 1 ? 3.5 : 2.5} className="fill-brand-600 dark:fill-brand-400" />
      ))}
    </svg>
  );
}

function DisciplineCard({ d }: { d: QbOverviewDiscipline }) {
  const TrendIcon = d.trend ? TREND_ICON[d.trend] : null;
  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{d.name}</h3>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {d.cutoffPct !== null ? `Nota de corte ${formatPct(d.cutoffPct)}` : d.cutoffText ? `Critério “${d.cutoffText}” (não deu para ler como nota)` : 'Sem critério mínimo cadastrado'}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          {d.recentPct !== null && (
            <>
              <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
                {formatPct(d.recentPct)}
                {TrendIcon && d.trend && (
                  <span className={`ml-2 inline-flex items-center gap-0.5 align-middle text-xs font-medium ${d.trend === 'up' ? 'text-brand-700 dark:text-brand-300' : d.trend === 'down' ? 'text-red-700 dark:text-red-300' : 'text-neutral-500'}`}>
                    <TrendIcon size={14} />
                    {TREND_LABEL[d.trend]}
                  </span>
                )}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {d.recentCorrect} de {d.recentTotal} nos últimos {Math.min(d.series.length, 3)} {d.series.length === 1 ? 'simulado' : 'simulados'}
              </p>
            </>
          )}
          <div className="mt-3 max-w-xs">
            <CutoffBar pct={d.recentPct ?? 0} cutoffPct={d.cutoffPct} status={d.status} />
          </div>
          <p className={`mt-1.5 text-xs ${TONE[d.status]}`}>
            {d.status === 'unknown' ? 'sem critério mínimo para comparar' : marginText({ status: d.status, margin: d.margin, missing: null })}
          </p>
        </div>
        {d.series.length > 0 && <Spark d={d} />}
      </div>

      {d.lowSample && (
        <p className="mt-3 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
          <AlertTriangle size={11} /> poucas questões nos simulados recentes: a situação é só uma pista
        </p>
      )}
      {d.status === 'below' && (
        <p className="mt-3">
          <Link to={practiceHref([d.name])} className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Ver as questões que errei
          </Link>
        </p>
      )}
    </li>
  );
}

export function QuestionPerformance() {
  const [examId, setExamId] = useState<string | undefined>(undefined);
  const [data, setData] = useState<QbCutoffOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    questionBankApi
      .cutoff(examId)
      .then((r) => alive && setData(r))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o desempenho.'));
    return () => {
      alive = false;
    };
  }, [examId]);

  const line = data ? overviewLine(data.disciplines) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Desempenho nos simulados</h1>
      <p className="mb-5 mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        As suas notas nos simulados do banco de questões, disciplina por disciplina, contra a nota de corte do concurso.
      </p>
      <BankTabs />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-neutral-400">Carregando...</p>}

      {data && data.attemptCount === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <Target size={24} className="text-neutral-400" />
          <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            Você ainda não fez nenhum simulado do banco de questões. Filtre as questões, use &quot;Criar simulado&quot; e faça um: o resultado aparece aqui, comparado com a nota de corte.
          </p>
          <Link to="/questoes" className="btn-primary">
            <Play size={16} />
            Ir para as questões
          </Link>
        </div>
      )}

      {data && data.attemptCount > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {data.exam ? <>Concurso: <span className="font-semibold">{data.exam.name}</span></> : 'Você ainda não cadastrou um concurso.'}
              <span className="ml-2 text-neutral-400">· {data.attemptCount} {data.attemptCount === 1 ? 'simulado' : 'simulados'}</span>
            </p>
            {data.exams.length > 1 && (
              <select className="input-field w-auto py-1.5 pr-8 text-sm" value={data.exam?.id ?? ''} onChange={(e) => setExamId(e.target.value)} aria-label="Concurso">
                {data.exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {!data.exam && (
            <p className="card mb-4 px-4 py-4 text-sm text-neutral-600 dark:text-neutral-300">
              Cadastre o seu <Link to="/concursos" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">concurso</Link> com o critério mínimo de cada disciplina para comparar com a nota de corte.
            </p>
          )}

          {line && <p className="card mb-4 px-4 py-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100">{line}</p>}

          {data.exam && data.disciplines.length === 0 && (
            <p className="card mb-4 px-4 py-4 text-sm text-neutral-600 dark:text-neutral-300">
              Nenhuma disciplina dos seus simulados casou com uma do concurso. Deixe o nome da disciplina das questões (botão Corrigir) igual ao do concurso.
            </p>
          )}

          {data.disciplines.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {data.disciplines.map((d) => (
                <DisciplineCard key={d.id} d={d} />
              ))}
            </ul>
          )}

          {data.unmatched.length > 0 && data.exam && (
            <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
              Sem correspondência no concurso: {data.unmatched.map((u) => `${u.label} (${u.correct} de ${u.total})`).join('; ')}.
            </p>
          )}

          <section className="mt-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Últimos simulados</h2>
            <ul className="card divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.attempts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-neutral-900 dark:text-neutral-100">{a.notebookName}</span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">{new Date(a.finishedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-neutral-700 dark:text-neutral-200">
                      {a.correct} de {a.total} ({percent(a.correct, a.total)}%)
                    </span>
                    {data.exam && a.verdict !== 'unknown' && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[a.verdict]}`}>{a.verdict === 'above' ? 'passaria' : 'não passaria'}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
              &quot;Passaria&quot; quer dizer acima do critério mínimo em todas as disciplinas que aquele simulado cobriu e que têm critério. É uma estimativa: ela não vê a nota de corte geral nem a classificação.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
