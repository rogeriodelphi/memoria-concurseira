import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, BookOpen, Flame, Layers, Repeat } from 'lucide-react';

import { statsApi } from '../services/api';
import type { StatsData, StudyResult } from '../types';

const RESULT_TILES: { result: StudyResult; label: string; className: string }[] = [
  { result: 'errei', label: 'Errei', className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
  {
    result: 'dificil',
    label: 'Difícil',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  },
  { result: 'bom', label: 'Bom', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  {
    result: 'facil',
    label: 'Fácil',
    className: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  },
];

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Layers;
  label: string;
  value: number;
}) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{value}</p>
        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      </div>
    </div>
  );
}

function formatDayLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return `${day}/${month}`;
}

function ActivityChart({ dailyActivity }: { dailyActivity: StatsData['dailyActivity'] }) {
  const max = Math.max(...dailyActivity.map((d) => d.count), 1);

  return (
    <div className="card p-6">
      <h2 className="mb-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Atividade — últimos 14 dias
      </h2>
      <div className="flex h-32 items-end gap-1.5">
        {dailyActivity.map((d) => {
          const heightPct = (d.count / max) * 100;
          return (
            <div
              key={d.date}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${formatDayLabel(d.date)}: ${d.count} ${d.count === 1 ? 'revisão' : 'revisões'}`}
            >
              <div
                className={`w-full rounded-t ${d.count > 0 ? 'bg-brand-500' : 'bg-neutral-100 dark:bg-neutral-800'}`}
                style={{ height: d.count > 0 ? `${Math.max(heightPct, 4)}%` : '2px' }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {dailyActivity.map((d) => (
          <span
            key={d.date}
            className="flex-1 text-center text-[10px] text-neutral-400 dark:text-neutral-500"
          >
            {formatDayLabel(d.date)}
          </span>
        ))}
      </div>
    </div>
  );
}

function CollectionRanking({ byCollection }: { byCollection: StatsData['byCollection'] }) {
  const max = Math.max(...byCollection.map((c) => c.reviews), 1);

  return (
    <div className="card p-6">
      <h2 className="mb-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Coleções mais estudadas</h2>
      <div className="space-y-4">
        {byCollection.map((c) => (
          <div key={c.name}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              {c.id ? (
                <Link
                  to={`/colecoes/${c.id}`}
                  className="truncate font-medium text-neutral-800 hover:text-brand-600 dark:text-neutral-200 dark:hover:text-brand-400"
                >
                  {c.name}
                </Link>
              ) : (
                <span
                  className="truncate font-medium text-neutral-800 dark:text-neutral-200"
                  title="Nome usado por mais de uma coleção"
                >
                  {c.name}
                </span>
              )}
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                {c.reviews} {c.reviews === 1 ? 'revisão' : 'revisões'} · {c.accuracyPct}% de acerto
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${(c.reviews / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Stats() {
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    statsApi
      .get()
      .then(setData)
      .catch(() => setError('Não foi possível carregar as estatísticas.'));
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Estatísticas</h1>
      <p className="mb-8 text-sm text-neutral-500 dark:text-neutral-400">
        Seu progresso de estudo em todas as coleções.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!data && !error && <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>}

      {data && data.totals.reviews === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <BarChart3 size={22} />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Você ainda não estudou nenhum flashcard — as estatísticas aparecem aqui assim que você começar.
          </p>
          <Link to="/colecoes" className="btn-primary mt-2">
            Ver minhas coleções
          </Link>
        </div>
      )}

      {data && data.totals.reviews > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile icon={Layers} label="Coleções" value={data.totals.collections} />
            <StatTile icon={BookOpen} label="Flashcards" value={data.totals.flashcards} />
            <StatTile icon={Repeat} label="Revisões" value={data.totals.reviews} />
            <StatTile icon={Flame} label="Sequência (dias)" value={data.totals.streakDays} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RESULT_TILES.map(({ result, label, className }) => {
              const count = data.byResult[result];
              const pct = data.totals.reviews > 0 ? Math.round((count / data.totals.reviews) * 100) : 0;
              return (
                <div key={result} className={`rounded-xl p-4 ${className}`}>
                  <p className="text-xl font-bold">{count}</p>
                  <p className="text-xs font-medium">
                    {label} · {pct}%
                  </p>
                </div>
              );
            })}
          </div>

          <ActivityChart dailyActivity={data.dailyActivity} />

          {data.byCollection.length > 0 && <CollectionRanking byCollection={data.byCollection} />}
        </div>
      )}
    </div>
  );
}
