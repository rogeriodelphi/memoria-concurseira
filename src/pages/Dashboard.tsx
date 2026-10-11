import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Circle, Info, Play } from 'lucide-react';

import { statsApi } from '../services/api';
import type { DashboardData } from '../types';

const NUMBER = new Intl.NumberFormat('pt-BR');

function formatInt(n: number): string {
  return NUMBER.format(Math.round(n));
}

function formatDecimal(n: number | null, digits = 1): string {
  if (n === null) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPct(n: number | null): string {
  return n === null ? '—' : `${n}%`;
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes - hours * 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// Curva suave por pontos médios: nunca passa dos valores mínimo e máximo dos
// pontos, então um dia zerado não vira um "mergulho" abaixo da linha de base.
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2;
    const my = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q ${points[i][0]} ${points[i][1]} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

function Sparkline({ data }: { data: DashboardData['consistency'] }) {
  const width = 240;
  const height = 72;
  const pad = 4;
  const max = Math.max(...data.map((d) => d.count), 1);
  const step = (width - pad * 2) / Math.max(data.length - 1, 1);
  const points = data.map((d, i): [number, number] => [
    pad + i * step,
    height - pad - (d.count / max) * (height - pad * 2),
  ]);
  const line = smoothPath(points);
  const last = points[points.length - 1];
  const baseline = height - pad;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Revisões por dia nos últimos 30 dias">
      <path
        d={`${line} L ${last[0]} ${baseline} L ${points[0][0]} ${baseline} Z`}
        className="fill-brand-500/15"
      />
      <path d={line} fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-brand-600" />
      <circle cx={last[0]} cy={last[1]} r="3.5" className="fill-brand-600" />
    </svg>
  );
}

function Ring({ label, pct }: { label: string; pct: number | null }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <div className="relative h-[76px] w-[76px]">
        <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
          <circle cx="38" cy="38" r={radius} fill="none" strokeWidth="7" className="stroke-neutral-200 dark:stroke-neutral-700" />
          {pct !== null && (
            <circle
              cx="38"
              cy="38"
              r={radius}
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${(circumference * pct) / 100} ${circumference}`}
              className="stroke-brand-600"
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          {formatPct(pct)}
        </span>
      </div>
    </div>
  );
}

function Bar({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-medium text-neutral-700 dark:text-neutral-200">
        {formatPct(pct)}
      </span>
    </div>
  );
}

function Panel({ title, rows }: { title: string; rows: { label: string; value: string; className?: string }[] }) {
  return (
    <div className="card p-6">
      <h2 className="mb-3 border-b border-neutral-200 pb-2 text-center text-sm font-semibold text-neutral-900 dark:border-neutral-700 dark:text-neutral-100">
        {title}
      </h2>
      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-neutral-600 dark:text-neutral-300">{row.label}</dt>
            <dd className={`font-semibold tabular-nums ${row.className ?? 'text-neutral-900 dark:text-neutral-100'}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DAY_LABEL = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DAY_MS = 24 * 60 * 60 * 1000;

// Do dia sem estudo ao mais intenso. No escuro a escala se inverte (mais claro
// = mais estudo) pra continuar "acendendo" contra o fundo.
const LEVEL_CLASSES = [
  'bg-neutral-100 dark:bg-neutral-800',
  'bg-brand-200 dark:bg-brand-900',
  'bg-brand-400 dark:bg-brand-700',
  'bg-brand-600 dark:bg-brand-500',
  'bg-brand-800 dark:bg-brand-300',
];

function levelFor(count: number, max: number): number {
  if (count <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function pluralDays(n: number): string {
  return `${formatInt(n)} ${n === 1 ? 'dia' : 'dias'}`;
}

function HeatmapStat({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <p className="text-sm text-neutral-600 dark:text-neutral-300" title={title}>
      {label}: <span className="font-bold text-brand-600 dark:text-brand-400">{value}</span>
    </p>
  );
}

function Heatmap({ heatmap }: { heatmap: DashboardData['heatmap'] }) {
  const currentYear = Number(heatmap.today.slice(0, 4));
  const firstYear = heatmap.years[0]?.year ?? currentYear;
  const [year, setYear] = useState(currentYear);

  // Em telas estreitas a grade rola na horizontal. No ano atual o que importa
  // é o presente (fim da grade); nos anos passados, o começo.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = year === currentYear ? el.scrollWidth : 0;
  }, [year, currentYear]);

  const counts = useMemo(() => new Map(heatmap.days.map((d) => [d.date, d.count])), [heatmap.days]);
  // Escala única pra todos os anos: o mesmo tom significa a mesma quantidade
  // de revisões, e dá pra comparar um ano com o outro.
  const max = useMemo(() => Math.max(1, ...heatmap.days.map((d) => d.count)), [heatmap.days]);

  // A grade é semana por coluna, começando no domingo: o 1º de janeiro cai no
  // meio da primeira coluna e os espaços antes dele (e depois de 31/12) ficam vazios.
  const jan1 = new Date(year, 0, 1);
  const offset = jan1.getDay();
  const daysInYear = Math.round((new Date(year + 1, 0, 1).getTime() - jan1.getTime()) / DAY_MS);
  const weeks = Math.ceil((offset + daysInYear) / 7);

  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const dayIndex = i - offset;
    if (dayIndex < 0 || dayIndex >= daysInYear) return null;
    const date = new Date(year, 0, 1 + dayIndex);
    return { date, key: dateKey(date) };
  });

  const monthStarts = MONTH_LABELS.map((label, month) => {
    const dayIndex = Math.round((new Date(year, month, 1).getTime() - jan1.getTime()) / DAY_MS);
    return { label, week: Math.floor((offset + dayIndex) / 7) };
  });

  const stat = heatmap.years.find((y) => y.year === year);
  const averagePerDay = stat && stat.activeDays > 0 ? Math.round(stat.reviews / stat.activeDays) : null;
  const daysLearnedPct = stat && stat.periodDays > 0 ? Math.round((stat.activeDays / stat.periodDays) * 100) : null;

  const navButton =
    'flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-neutral-600 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:disabled:hover:bg-neutral-800';

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-center gap-2">
        <button type="button" className={navButton} onClick={() => setYear((y) => y - 1)} disabled={year <= firstYear} aria-label="Ano anterior">
          <ChevronLeft size={16} />
        </button>
        <button type="button" className={navButton} onClick={() => setYear(currentYear)} disabled={year === currentYear} aria-label="Voltar ao ano atual">
          <Circle size={13} />
        </button>
        <button type="button" className={navButton} onClick={() => setYear((y) => y + 1)} disabled={year >= currentYear} aria-label="Próximo ano">
          <ChevronRight size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="overflow-x-auto pb-1 dark:[color-scheme:dark]">
        <div className="min-w-[600px]">
          <div className="mb-1 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
            {monthStarts.map(({ label, week }) => (
              <span
                key={label}
                className="whitespace-nowrap text-[10px] text-neutral-400 dark:text-neutral-500"
                style={{ gridColumnStart: week + 1, gridRowStart: 1 }}
              >
                {label}
              </span>
            ))}
          </div>

          <div
            className="grid grid-flow-col gap-[3px]"
            style={{ gridTemplateRows: 'repeat(7, auto)', gridAutoColumns: 'minmax(0, 1fr)' }}
            role="img"
            aria-label={`Mapa de calor das revisões em ${year}`}
          >
            {cells.map((cell, i) => {
              if (!cell) return <div key={i} />;
              const count = counts.get(cell.key) ?? 0;
              const isFuture = cell.key > heatmap.today;
              const isToday = cell.key === heatmap.today;
              const label = `${DAY_LABEL.format(cell.date)}: ${
                isFuture ? 'ainda não chegou' : `${formatInt(count)} ${count === 1 ? 'revisão' : 'revisões'}`
              }`;
              return (
                <div
                  key={i}
                  title={label}
                  className={`aspect-square rounded-[2px] ${isFuture ? 'bg-neutral-50 dark:bg-neutral-900' : LEVEL_CLASSES[levelFor(count, max)]} ${
                    isToday ? 'ring-1 ring-neutral-800 dark:ring-neutral-100' : ''
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400 dark:text-neutral-500">{year}</p>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
          Menos
          {LEVEL_CLASSES.map((cls) => (
            <span key={cls} className={`h-3 w-3 rounded-[2px] ${cls}`} />
          ))}
          Mais
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-x-8 gap-y-2">
        <HeatmapStat
          label="Média diária"
          value={averagePerDay === null ? '—' : `${formatInt(averagePerDay)} ${averagePerDay === 1 ? 'cartão' : 'cartões'}`}
          title="Revisões por dia, contando só os dias em que você estudou, no ano mostrado"
        />
        <HeatmapStat
          label="Dias estudados"
          value={formatPct(daysLearnedPct)}
          title="Dos dias do ano mostrado (desde 1º de janeiro ou da sua primeira revisão, até hoje), quantos tiveram revisão"
        />
        <HeatmapStat
          label="Maior sequência"
          value={pluralDays(heatmap.longestStreak)}
          title="Mais dias seguidos com revisão, em todo o seu histórico"
        />
        <HeatmapStat
          label="Sequência atual"
          value={pluralDays(heatmap.currentStreak)}
          title="Dias seguidos com revisão até hoje (ou até ontem, se hoje ainda não estudou)"
        />
      </div>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    statsApi
      .dashboard()
      .then(setData)
      .catch(() => setError('Não foi possível carregar o painel.'));
  }, []);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Painel</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Seu estudo de hoje e o panorama dos últimos 30 dias.</p>
        </div>
        {data && data.remaining.total > 0 && (
          <Link to="/revisar" className="btn-primary flex items-center gap-2">
            <Play size={16} />
            Revisar pendentes ({formatInt(data.remaining.total)})
          </Link>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>}

      {data && (
        <div className="space-y-6">
          <div className="card relative grid gap-6 p-6 md:grid-cols-2 xl:grid-cols-[1.4fr_1.2fr_auto] xl:items-center xl:gap-8">
            <div>
              <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">Consistência</p>
              <Sparkline data={data.consistency} />
              <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">Revisões por dia, últimos 30 dias</p>
            </div>

            <div className="md:border-l md:border-neutral-200 md:pl-8 dark:md:border-neutral-700">
              <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">Eficiência</p>
              <div className="space-y-3">
                <Bar label="Efic." pct={data.efficiencyPct} />
                <Bar label="Prec." pct={data.precisionPct} />
              </div>
            </div>

            <div className="flex items-start justify-center gap-6 border-t border-neutral-200 pt-6 dark:border-neutral-700 md:col-span-2 xl:col-span-1 xl:border-l xl:border-t-0 xl:pl-8 xl:pr-8 xl:pt-0">
              <Ring label="Retenção" pct={data.retentionPct} />
              <Ring label="Novos cartões" pct={data.newCardsPct} />
            </div>

            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              aria-label="Como estes números são calculados"
              aria-expanded={showInfo}
              className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
            >
              <Info size={13} />
            </button>
          </div>

          {showInfo && (
            <div className="card space-y-1.5 p-5 text-xs text-neutral-600 dark:text-neutral-300">
              <p>
                <strong>Aprovação</strong>: tudo que não foi &quot;Errei&quot;. Vale para a taxa de hoje, a precisão e os dois círculos.
              </p>
              <p>
                <strong>Retenção</strong>: aprovação nas revisões dos últimos 30 dias, sem contar o primeiro contato
                com o cartão nem o reaprendizado depois de um &quot;Errei&quot;.
              </p>
              <p>
                <strong>Novos cartões</strong>: aprovação na primeira vez que você viu cada cartão, nos últimos 30 dias.
              </p>
              <p>
                <strong>Eficiência</strong>: parcela do seu tempo de estudo (30 dias) gasta em cartões que você não errou.{' '}
                <strong>Precisão</strong>: parcela dos cartões que você não errou.
              </p>
              <p>
                <strong>Aprender</strong>: cartões que você errou e voltam hoje. <strong>Maduros</strong>: cartões com intervalo de 21
                dias ou mais. <strong>Tempo est.</strong>: o que falta revisar, no seu ritmo dos últimos 30 dias.
              </p>
              <p>
                <strong>Mapa de calor</strong>: cada quadrado é um dia, e quanto mais escuro, mais revisões. A cor usa a mesma escala em
                todos os anos. <strong>Média diária</strong> conta só os dias em que você estudou; <strong>Dias estudados</strong> é a
                fração dos dias do ano (a partir da sua primeira revisão, se for o primeiro ano) em que você revisou algo. As duas
                sequências valem para todo o histórico.
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Panel
              title="Progresso de hoje"
              rows={[
                { label: 'Estudados', value: formatInt(data.today.studied) },
                { label: 'Tempo (min)', value: formatDecimal(data.today.timeMin) },
                { label: 'Ritmo (s/cartão)', value: formatDecimal(data.today.paceSec) },
                { label: 'Média (cartões/min)', value: formatDecimal(data.today.cardsPerMin) },
                { label: 'Taxa de aprovação', value: formatPct(data.today.passRatePct) },
              ]}
            />
            <Panel
              title="Restantes"
              rows={[
                { label: 'Novos', value: formatInt(data.remaining.new), className: 'text-blue-500 dark:text-blue-400' },
                { label: 'Aprender', value: formatInt(data.remaining.learning), className: 'text-red-500 dark:text-red-400' },
                { label: 'Revisar', value: formatInt(data.remaining.due), className: 'text-green-600 dark:text-green-400' },
                { label: 'Total', value: formatInt(data.remaining.total), className: 'text-amber-500 dark:text-amber-400' },
                { label: 'Para amanhã', value: formatInt(data.remaining.dueTomorrow) },
                {
                  label: 'Tempo est. (min)',
                  value: data.remaining.estimatedMin === null ? '—' : formatInt(data.remaining.estimatedMin),
                },
              ]}
            />
            <Panel
              title="Feito hoje"
              rows={[
                { label: 'Novos aprendidos', value: formatInt(data.doneToday.newLearned), className: 'text-blue-500 dark:text-blue-400' },
                { label: 'Reaprendizado', value: formatInt(data.doneToday.relearned), className: 'text-red-500 dark:text-red-400' },
                { label: 'Revisões', value: formatInt(data.doneToday.reviews), className: 'text-green-600 dark:text-green-400' },
                { label: 'Cartões maduros', value: formatInt(data.matureCards), className: 'text-indigo-500 dark:text-indigo-400' },
                { label: 'Errei', value: formatInt(data.doneToday.again), className: 'text-orange-500 dark:text-orange-400' },
              ]}
            />
          </div>

          <div className="space-y-4 text-center">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {data.today.studied === 0
                ? 'Você ainda não estudou hoje.'
                : `Hoje: ${formatInt(data.today.distinctCards)} ${
                    data.today.distinctCards === 1 ? 'cartão distinto' : 'cartões distintos'
                  } em ${formatDuration(data.today.timeMin)}.`}
            </p>
            <div className="flex justify-center gap-12">
              <div>
                <p className="text-sm text-neutral-700 dark:text-neutral-200">Total</p>
                <p className="text-lg font-bold text-brand-600 dark:text-brand-400">{formatDecimal(data.totalHours, 2)} h</p>
              </div>
              <div>
                <p className="text-sm text-neutral-700 dark:text-neutral-200">Última semana</p>
                <p className="text-lg font-bold text-brand-600 dark:text-brand-400">
                  {formatDecimal(data.pastWeekHours, 2)} h
                </p>
              </div>
            </div>
            {data.estimatedReviews > 0 && (
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                O tempo de {formatInt(data.estimatedReviews)} das {formatInt(data.totalReviews)} revisões é estimado pelo intervalo
                entre um cartão e o anterior; as novas são medidas.
              </p>
            )}
          </div>

          <Heatmap heatmap={data.heatmap} />
        </div>
      )}
    </div>
  );
}
