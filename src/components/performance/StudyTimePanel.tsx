import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Info, Layers, Timer } from 'lucide-react';

import type { StudyTimeData, StudyTimeRow } from '../../types';
import { barPercent } from '../../utils/performance';
import {
  BALANCE_LABEL,
  formatDuration,
  headline,
  insights,
  stackShares,
  timeSharePct,
  type DisciplineInsight,
} from '../../utils/studyTime';

const POMODORO_COLOR = '#f59e0b';
const CARDS_COLOR = '#10b981';

type View = 'discipline' | 'name';

const BALANCE_CLASS = {
  low: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  balanced: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  high: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
} as const;

function Legend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: POMODORO_COLOR }} /> Pomodoro
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CARDS_COLOR }} /> Cartões
      </span>
    </p>
  );
}

/** Uma barra empilhada: o tempo da linha, do Pomodoro e dos cartões, no comprimento proporcional à maior linha. */
function TimeBar({ row, max }: { row: Pick<StudyTimeRow, 'pomodoroSec' | 'cardSec' | 'totalSec' | 'label'>; max: number }) {
  const shares = stackShares(row);
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
      role="img"
      aria-label={`${row.label}: ${formatDuration(row.pomodoroSec)} de Pomodoro e ${formatDuration(row.cardSec)} em cartões`}
    >
      <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${barPercent(row.totalSec, max)}%` }}>
        <span className="h-full" style={{ width: `${shares.pomodoro}%`, backgroundColor: POMODORO_COLOR }} />
        <span className="h-full" style={{ width: `${shares.cards}%`, backgroundColor: CARDS_COLOR }} />
      </div>
    </div>
  );
}

function SubjectsLine({ row }: { row: StudyTimeRow }) {
  if (row.subjects.length === 0) return null;
  return (
    <p className="mt-1 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
      {row.subjects.slice(0, 4).map((s) => `${s.label} ${formatDuration(s.sec)}`).join(' · ')}
    </p>
  );
}

function DisciplineList({ items }: { items: DisciplineInsight[] }) {
  const max = Math.max(1, ...items.map((i) => i.row.totalSec));
  return (
    <ul className="space-y-4">
      {items.map(({ row, timePct, balance, priority, gapSec }) => (
        <li key={row.key || 'fora'} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-neutral-900 dark:text-neutral-100">{row.label}</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {row.weightPct !== null ? (
                  <>
                    Pesa <strong className="font-semibold text-neutral-700 dark:text-neutral-200">{row.weightPct}%</strong> da prova
                    {row.questions !== null && <> ({row.questions.toLocaleString('pt-BR')} {row.questions === 1 ? 'questão' : 'questões'})</>}
                  </>
                ) : (
                  'Sem peso na prova'
                )}
                {' · '}levou <strong className="font-semibold text-neutral-700 dark:text-neutral-200">{timePct}%</strong> do seu tempo
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {priority && <span className="rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white">Prioridade</span>}
              {balance !== 'unknown' && (
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${BALANCE_CLASS[balance]}`}>{BALANCE_LABEL[balance]}</span>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatDuration(row.totalSec)}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {row.reviews > 0 && row.accuracyPct !== null ? `${row.accuracyPct}% de acerto em ${row.reviews.toLocaleString('pt-BR')} ${row.reviews === 1 ? 'revisão' : 'revisões'}` : 'sem revisões de cartões'}
            </span>
          </div>
          <TimeBar row={row} max={max} />

          {/* A barra do peso, na mesma régua do tempo, para ver a diferença */}
          {row.weightPct !== null && (
            <div className="mt-2" aria-hidden="true">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div className="h-full rounded-full bg-neutral-400 dark:bg-neutral-500" style={{ width: `${barPercent(row.weightPct, Math.max(1, ...items.map((i) => i.row.weightPct ?? 0)))}%` }} />
              </div>
              <p className="mt-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">peso na prova, na mesma escala entre as disciplinas</p>
            </div>
          )}

          <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            {row.pomodoroSec > 0 && <>Pomodoro {formatDuration(row.pomodoroSec)}</>}
            {row.pomodoroSec > 0 && row.cardSec > 0 && ' · '}
            {row.cardSec > 0 && <>Cartões {formatDuration(row.cardSec)}</>}
            {row.totalSec === 0 && 'Nenhum tempo neste período'}
            {balance === 'low' && gapSec > 0 && <> · para ter o tempo do peso, faltariam {formatDuration(gapSec)} neste período</>}
            {balance === 'high' && gapSec < 0 && <> · {formatDuration(-gapSec)} a mais do que o peso pede</>}
          </p>
          <SubjectsLine row={row} />
        </li>
      ))}
    </ul>
  );
}

function NameList({ rows }: { rows: StudyTimeRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.totalSec));
  const total = rows.reduce((n, r) => n + r.totalSec, 0);
  return (
    <ul className="space-y-3.5">
      {rows.map((row) => (
        <li key={row.key || 'sem'}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium text-neutral-800 dark:text-neutral-200">{row.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
              {formatDuration(row.totalSec)} <span className="font-normal text-neutral-400">· {timeSharePct(row.totalSec, total)}%</span>
            </span>
          </div>
          <TimeBar row={row} max={max} />
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {row.pomodoroSec > 0 && <>Pomodoro {formatDuration(row.pomodoroSec)}</>}
            {row.pomodoroSec > 0 && row.cardSec > 0 && ' · '}
            {row.cardSec > 0 && <>Cartões {formatDuration(row.cardSec)}</>}
            {row.accuracyPct !== null && <> · {row.accuracyPct}% de acerto</>}
          </p>
          <SubjectsLine row={row} />
        </li>
      ))}
    </ul>
  );
}

function Tile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-neutral-50 p-3.5 dark:bg-neutral-800/50">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">{icon}</div>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-tight text-neutral-900 dark:text-neutral-100">{value}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
        {sub && <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * "Tempo de estudo": onde o tempo vai (Pomodoro e cartões) e, com concurso, como ele se compara ao peso de cada
 * disciplina na prova. O tempo dos cartões feitos dentro de um Pomodoro já está no Pomodoro e não é somado de novo.
 */
export function StudyTimePanel({ data }: { data: StudyTimeData }) {
  const hasExam = data.byDiscipline !== null;
  const [view, setView] = useState<View>(hasExam ? 'discipline' : 'name');
  const current: View = hasExam ? view : 'name';
  const { totals } = data;
  const items = data.byDiscipline ? insights(data.byDiscipline, totals.totalSec) : [];
  const summary = headline(items);

  return (
    <section className="card p-6" aria-label="Tempo de estudo">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            <Clock size={16} className="text-brand-600 dark:text-brand-400" />
            Tempo de estudo
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Onde o seu tempo vai, comparado ao peso de cada disciplina na prova.</p>
        </div>
        {hasExam && (
          <div role="radiogroup" aria-label="Agrupar por" className="inline-flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
            {([['discipline', 'Disciplina do edital'], ['name', 'Nome da coleção']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={current === value}
                onClick={() => setView(value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  current === value ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50' : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile icon={<Clock size={17} />} label="Tempo total" value={formatDuration(totals.totalSec)} sub={totals.overlapSec > 0 ? `sem contar ${formatDuration(totals.overlapSec)} em dobro` : undefined} />
        <Tile icon={<Timer size={17} />} label="Pomodoro" value={formatDuration(totals.pomodoroSec)} sub={totals.tasks > 0 ? `${totals.tasks.toLocaleString('pt-BR')} ${totals.tasks === 1 ? 'registro' : 'registros'}` : 'nada registrado'} />
        <Tile
          icon={<Layers size={17} />}
          label="Em cartões"
          value={formatDuration(totals.cardSec)}
          sub={totals.estimatedReviews > 0 ? `${totals.estimatedReviews.toLocaleString('pt-BR')} de ${totals.reviews.toLocaleString('pt-BR')} revisões com tempo estimado` : undefined}
        />
      </div>

      {totals.totalSec === 0 ? (
        <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
          Nenhum tempo neste período e com estes filtros. O tempo vem do <Link to="/pomodoro" className="font-medium text-brand-600 hover:underline dark:text-brand-400">Pomodoro</Link> e
          do tempo que você passa em cada cartão.
        </p>
      ) : (
        <>
          {current === 'discipline' && summary && (
            <p className="mt-5 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{summary}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <Legend />
          </div>
          <div className="mt-4">
            {current === 'discipline' && data.byDiscipline ? (
              <DisciplineList items={items} />
            ) : (
              <NameList rows={data.byName} />
            )}
          </div>
        </>
      )}

      <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          O Pomodoro conta o tempo de foco que você registrou. O tempo dos cartões é o que você passou em cada revisão (quando não foi medido, é estimado
          pelo intervalo até a revisão anterior). Uma revisão feita durante um Pomodoro já está no tempo dele e não é somada de novo. O Pomodoro entra na
          disciplina pelo nome que você digitou: use o mesmo nome do edital ou da coleção (o campo sugere) para ele se juntar aos cartões.
        </span>
      </p>
    </section>
  );
}
