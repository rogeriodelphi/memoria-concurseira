import { useEffect, useRef, useState } from 'react';

import type { PerformanceCounts, PerformanceData, StudyResult } from '../../types';
import {
  areaPath,
  barPercent,
  bucketSeries,
  countsDetail,
  donutSegments,
  fillDays,
  namesLabel,
  niceScale,
  pointLabel,
  pointTitle,
  RESULT_LABEL,
  RESULT_ORDER,
  smoothPath,
  tickIndexes,
  type Metric,
  type XY,
} from '../../utils/performance';

export const GOOD_COLOR = '#22c55e';
export const BAD_COLOR = '#ef4444';
const RESULT_COLOR: Record<StudyResult, string> = { facil: '#10b981', bom: '#6ee7b7', dificil: '#fbbf24', errei: '#ef4444' };

// ---------- revisões por dia ----------

const DEFAULT_WIDTH = 720;
const H = 240;
const PAD = { left: 34, right: 12, top: 14, bottom: 28 };

/** A largura de um elemento, acompanhando o redimensionamento: o gráfico se desenha em pixels reais, e o texto não encolhe no celular. */
function useElementWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * As revisões de cada dia, separadas em acertos (verde) e erros (vermelho): duas curvas suaves com
 * preenchimento. Períodos longos agrupam os dias; com um ou dois pontos só, as curvas dão lugar a barras.
 */
export function DailyChart({ data }: { data: PerformanceData }) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useElementWidth();
  const points = bucketSeries(fillDays(data.range, data.daily));
  const max = Math.max(0, ...points.flatMap((p) => [p.good, p.bad]));
  const scale = niceScale(max);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH - (value / scale.top) * plotH;
  const baseline = PAD.top + plotH;
  const useBars = points.length <= 2;
  const line = (key: 'good' | 'bad'): XY[] => points.map((p, i) => ({ x: x(i), y: y(p[key]) }));
  const ticks = tickIndexes(points.length);
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div ref={boxRef} className="relative w-full" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label="Revisões por dia, separadas em acertos e erros">
        <defs>
          <linearGradient id="perf-good" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOOD_COLOR} stopOpacity="0.28" />
            <stop offset="100%" stopColor={GOOD_COLOR} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="perf-bad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BAD_COLOR} stopOpacity="0.22" />
            <stop offset="100%" stopColor={BAD_COLOR} stopOpacity="0" />
          </linearGradient>
        </defs>

        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-neutral-200 dark:stroke-neutral-800" strokeWidth="1" />
            <text x={PAD.left - 8} y={y(tick) + 3.5} textAnchor="end" className="fill-neutral-400 text-[10px] dark:fill-neutral-500">
              {tick}
            </text>
          </g>
        ))}

        {points.length > 0 && !useBars && (
          <>
            <path d={areaPath(line('good'), PAD.top, baseline, baseline)} fill="url(#perf-good)" />
            <path d={areaPath(line('bad'), PAD.top, baseline, baseline)} fill="url(#perf-bad)" />
            <path d={smoothPath(line('good'), PAD.top, baseline)} fill="none" stroke={GOOD_COLOR} strokeWidth="2" strokeLinecap="round" />
            <path d={smoothPath(line('bad'), PAD.top, baseline)} fill="none" stroke={BAD_COLOR} strokeWidth="2" strokeLinecap="round" />
          </>
        )}

        {useBars &&
          points.map((p, i) => (
            <g key={p.from}>
              <rect x={x(i) - 26} y={y(p.good)} width="24" height={baseline - y(p.good)} rx="3" fill={GOOD_COLOR} />
              <rect x={x(i) + 2} y={y(p.bad)} width="24" height={baseline - y(p.bad)} rx="3" fill={BAD_COLOR} />
            </g>
          ))}

        {hover !== null && hovered && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={baseline} className="stroke-neutral-300 dark:stroke-neutral-600" strokeDasharray="3 3" />
            {!useBars && (
              <>
                <circle cx={x(hover)} cy={y(hovered.good)} r="4" fill={GOOD_COLOR} />
                <circle cx={x(hover)} cy={y(hovered.bad)} r="4" fill={BAD_COLOR} />
              </>
            )}
          </g>
        )}

        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-neutral-400 text-[10px] dark:fill-neutral-500">
            {pointLabel(points[i], i, points)}
          </text>
        ))}

        {points.map((p, i) => {
          const slot = points.length === 1 ? plotW : plotW / (points.length - 1);
          return (
            <rect
              key={p.from}
              x={x(i) - slot / 2}
              y={PAD.top}
              width={slot}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            >
              <title>{pointTitle(p)}</title>
            </rect>
          );
        })}
      </svg>

      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-card dark:border-neutral-700 dark:bg-neutral-800"
          style={{ left: `${Math.min(88, Math.max(12, (x(hover) / W) * 100))}%` }}
        >
          <p className="font-medium text-neutral-800 dark:text-neutral-100">{pointTitle(hovered).split(':')[0]}</p>
          <p className="text-emerald-600 dark:text-emerald-400">{hovered.good.toLocaleString('pt-BR')} {hovered.good === 1 ? 'acerto' : 'acertos'}</p>
          <p className="text-red-600 dark:text-red-400">{hovered.bad.toLocaleString('pt-BR')} {hovered.bad === 1 ? 'erro' : 'erros'}</p>
        </div>
      )}

      <div className="mt-1 flex items-center justify-center gap-5 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GOOD_COLOR }} /> Acertos (Bom ou Fácil)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BAD_COLOR }} /> Erros (Errei ou Difícil)
        </span>
      </div>
    </div>
  );
}

// ---------- distribuição ----------

const RADIUS = 48;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A rosca com as revisões por resultado (Fácil, Bom, Difícil, Errei) e o total no centro. */
export function DistributionDonut({ byResult, reviews }: { byResult: Record<StudyResult, number>; reviews: number }) {
  const segments = donutSegments(byResult, CIRCUMFERENCE);
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-44 w-44">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label="Distribuição das revisões por resultado">
          <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="16" className="stroke-neutral-100 dark:stroke-neutral-800" />
          {segments.map((s) => (
            <circle
              key={s.result}
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              strokeWidth="16"
              stroke={RESULT_COLOR[s.result]}
              strokeDasharray={`${Math.max(0, s.length - (segments.length > 1 ? 1.5 : 0))} ${CIRCUMFERENCE}`}
              strokeDashoffset={s.offset}
            >
              <title>{`${RESULT_LABEL[s.result]}: ${s.value.toLocaleString('pt-BR')} (${s.pct}%)`}</title>
            </circle>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{reviews.toLocaleString('pt-BR')}</span>
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{reviews === 1 ? 'Revisão' : 'Revisões'}</span>
        </div>
      </div>
      <ul className="mt-4 grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {RESULT_ORDER.map((result) => {
          const value = byResult[result];
          const pct = reviews > 0 ? Math.round((value / reviews) * 100) : 0;
          return (
            <li key={result} className="flex items-center justify-between gap-2 text-neutral-600 dark:text-neutral-300">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: RESULT_COLOR[result] }} />
                {RESULT_LABEL[result]}
              </span>
              <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                {value.toLocaleString('pt-BR')} · {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- barras ----------

interface BarRow extends PerformanceCounts {
  key: string;
  label: string;
  names?: string[];
}

/**
 * Um gráfico de barras horizontais: uma barra por grupo, do maior para o menor. Tocar numa barra liga o
 * filtro daquele grupo (de novo, desliga). Na métrica "Revisões" a barra mostra a parte de acertos e de erros.
 */
export function BarList({
  title,
  rows,
  metric,
  activeKey,
  onPick,
  expanded,
  onToggleExpanded,
  limit,
  emptyText,
}: {
  title: string;
  rows: BarRow[];
  metric: Metric;
  activeKey: string | null;
  onPick: (key: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  limit: number;
  emptyText: string;
}) {
  const shown = expanded ? rows : rows.slice(0, limit);
  const max = Math.max(1, ...rows.map((r) => r[metric]));

  return (
    <section aria-label={title}>
      <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((r) => {
            const value = r[metric];
            const active = activeKey === r.key;
            const goodPct = r.reviews > 0 ? (r.good / r.reviews) * 100 : 0;
            return (
              <li key={r.key || 'vazio'}>
                <button
                  type="button"
                  onClick={() => onPick(r.key)}
                  aria-pressed={active}
                  title={active ? 'Tirar este filtro' : 'Filtrar a página por este grupo'}
                  className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                    active ? 'bg-brand-50 ring-1 ring-brand-300 dark:bg-brand-950/30 dark:ring-brand-700' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                  }`}
                >
                  <span className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate font-medium text-neutral-800 dark:text-neutral-200">{r.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value.toLocaleString('pt-BR')}</span>
                  </span>
                  <span className="block h-2.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" role="img" aria-label={`${r.label}: ${countsDetail(r)}`}>
                    <span className="flex h-full overflow-hidden rounded-full" style={{ width: `${barPercent(value, max)}%` }}>
                      {metric === 'reviews' ? (
                        <>
                          <span className="h-full" style={{ width: `${goodPct}%`, backgroundColor: GOOD_COLOR }} />
                          <span className="h-full flex-1" style={{ backgroundColor: BAD_COLOR }} />
                        </>
                      ) : (
                        <span className="h-full w-full bg-brand-500" />
                      )}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                    {countsDetail(r)}
                    {r.names && r.names.length > 0 && <span className="text-neutral-400 dark:text-neutral-500"> · {namesLabel(r.names)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > limit && (
        <button type="button" onClick={onToggleExpanded} className="mt-2 px-2.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
          {expanded ? `Mostrar só os ${limit} primeiros` : `Ver todos (${rows.length})`}
        </button>
      )}
    </section>
  );
}
