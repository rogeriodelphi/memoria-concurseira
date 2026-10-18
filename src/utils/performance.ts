/**
 * "Meu desempenho" sem React: o período e os filtros no endereço da página, a série por dia (com os dias
 * sem estudo preenchidos), as curvas dos gráficos, a rosca e os textos. A conta de quem estudou o quê
 * é do servidor (server/stats/performance.ts).
 */
import type { PerformanceCounts, PerformanceData, PerformanceQuery, StudyResult } from '../types';

export const PERIOD_PRESETS: { days: number; label: string }[] = [
  { days: 1, label: 'Hoje' },
  { days: 7, label: '7 dias' },
  { days: 15, label: '15 dias' },
  { days: 30, label: '30 dias' },
  { days: 0, label: 'Desde o início' },
];

export const DEFAULT_DAYS = 7;
/** Um sinal do endereço para "só os sem assunto" (o mesmo que o servidor usa). */
export const NO_SUBJECT_KEY = '__sem_assunto__';
/** Quantas barras cada gráfico mostra antes de "Ver todos". */
export const TOP_BARS = 10;

export type Metric = 'cards' | 'reviews';
export const METRIC_LABEL: Record<Metric, string> = { cards: 'Cartões', reviews: 'Revisões' };

export const DEFAULT_QUERY: PerformanceQuery = { days: DEFAULT_DAYS, range: null, scope: 'all', name: null, subject: null };

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** AAAA-MM-DD → um `Date` à meia-noite local; `null` se o dia não existe. */
export function parseDay(text: string | null | undefined): Date | null {
  const m = text ? DAY_RE.exec(text) : null;
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const formatIsoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------- o endereço da página ----------

/** O que está no endereço (`?dias=30&escopo=concurso&nome=...`) vira o pedido; qualquer valor estranho cai no padrão. */
export function queryFromParams(params: URLSearchParams): PerformanceQuery {
  const from = params.get('de');
  const to = params.get('ate');
  const start = parseDay(from);
  const end = parseDay(to);
  const range = start && end && start.getTime() <= end.getTime() ? { from: from!, to: to! } : null;

  const daysParam = params.get('dias');
  const days = daysParam !== null && PERIOD_PRESETS.some((p) => String(p.days) === daysParam) ? Number(daysParam) : DEFAULT_DAYS;

  return {
    days,
    range,
    scope: params.get('escopo') === 'concurso' ? 'exam' : 'all',
    name: params.get('nome') || null,
    subject: params.get('assunto') || null,
  };
}

/** O contrário: só o que difere do padrão vai para o endereço, para ele ficar curto. */
export function paramsFromQuery(query: PerformanceQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.range) {
    params.set('de', query.range.from);
    params.set('ate', query.range.to);
  } else if (query.days !== DEFAULT_DAYS) {
    params.set('dias', String(query.days));
  }
  if (query.scope === 'exam') params.set('escopo', 'concurso');
  if (query.name) params.set('nome', query.name);
  if (query.subject) params.set('assunto', query.subject);
  return params;
}

/** Quantos filtros (nome, assunto) estão ligados. */
export function activeFilterCount(query: PerformanceQuery): number {
  return (query.name ? 1 : 0) + (query.subject ? 1 : 0);
}

// ---------- textos ----------

const dayMonth = (isoDay: string) => `${isoDay.slice(8, 10)}/${isoDay.slice(5, 7)}`;

/** "11/10 a 17/10/2026"; um dia só: "17/10/2026". Quando cruza o ano, os dois anos aparecem. */
export function rangeLabel(range: { from: string; to: string }): string {
  const fromYear = range.from.slice(0, 4);
  const toYear = range.to.slice(0, 4);
  if (range.from === range.to) return `${dayMonth(range.to)}/${toYear}`;
  return fromYear === toYear
    ? `${dayMonth(range.from)} a ${dayMonth(range.to)}/${toYear}`
    : `${dayMonth(range.from)}/${fromYear} a ${dayMonth(range.to)}/${toYear}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

/** "12 cartões · 30 revisões · 77% de acerto". */
export function countsDetail(c: PerformanceCounts): string {
  return `${plural(c.cards, 'cartão', 'cartões')} · ${plural(c.reviews, 'revisão', 'revisões')} · ${c.accuracyPct}% de acerto`;
}

/** "Redes, Linux e mais 2": os nomes que trazem um assunto, sem ocupar a linha toda. */
export function namesLabel(names: string[], show = 2): string {
  if (names.length <= show) return names.join(', ');
  return `${names.slice(0, show).join(', ')} e mais ${names.length - show}`;
}

// ---------- tendência e cor do acerto ----------

export type Trend = 'up' | 'down' | 'flat';
/** Menos que isto de diferença (em pontos percentuais) é estabilidade, não tendência. */
export const TREND_THRESHOLD = 2;

/** O acerto subiu, caiu ou ficou parecido em relação ao período anterior; `null` sem período anterior para comparar. */
export function trendOf(current: number, previous: number | null): Trend | null {
  if (previous === null) return null;
  const diff = current - previous;
  if (diff >= TREND_THRESHOLD) return 'up';
  if (diff <= -TREND_THRESHOLD) return 'down';
  return 'flat';
}

export const TREND_LABEL: Record<Trend, string> = { up: 'Subiu', down: 'Caiu', flat: 'Estável' };

/** "Subiu 12 pontos em relação ao período anterior (63%)". */
export function trendText(current: number, previous: number | null): string {
  const trend = trendOf(current, previous);
  if (trend === null || previous === null) return 'Sem período anterior para comparar';
  const points = Math.abs(current - previous);
  if (trend === 'flat') return `Estável em relação ao período anterior (${previous}%)`;
  return `${TREND_LABEL[trend]} ${plural(points, 'ponto', 'pontos')} em relação ao período anterior (${previous}%)`;
}

export type Tone = 'good' | 'ok' | 'bad';
/** A cor do acerto: 80% ou mais é bom, de 60% a 79% é razoável, abaixo disso pede atenção. */
export function accuracyTone(pct: number): Tone {
  if (pct >= 80) return 'good';
  if (pct >= 60) return 'ok';
  return 'bad';
}

// ---------- série por dia ----------

export interface DayPoint {
  date: string;
  good: number;
  bad: number;
}

/** Todos os dias de `range` (os dois inclusive), com zero nos que não tiveram estudo. */
export function fillDays(range: { from: string; to: string }, daily: DayPoint[]): DayPoint[] {
  const start = parseDay(range.from);
  const end = parseDay(range.to);
  if (!start || !end || start.getTime() > end.getTime()) return [];
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const days: DayPoint[] = [];
  // Passo em dias de calendário (e não em 24 h), para o horário de verão não repetir nem pular um dia.
  for (let i = 0; i < 3700; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (day.getTime() > end.getTime()) break;
    const key = formatIsoDay(day);
    const found = byDate.get(key);
    days.push({ date: key, good: found?.good ?? 0, bad: found?.bad ?? 0 });
  }
  return days;
}

export interface SeriesPoint {
  /** O primeiro e o último dia do grupo (iguais quando o ponto é um dia só). */
  from: string;
  to: string;
  good: number;
  bad: number;
}

/** Quantos pontos o gráfico aguenta antes de os dias serem agrupados. */
export const MAX_SERIES_POINTS = 45;

/** Os dias em no máximo `maxPoints` pontos: até lá, um por dia; acima, grupos de dias seguidos (somados). */
export function bucketSeries(days: DayPoint[], maxPoints: number = MAX_SERIES_POINTS): SeriesPoint[] {
  if (days.length === 0) return [];
  const size = Math.max(1, Math.ceil(days.length / maxPoints));
  const points: SeriesPoint[] = [];
  for (let i = 0; i < days.length; i += size) {
    const group = days.slice(i, i + size);
    points.push({
      from: group[0].date,
      to: group[group.length - 1].date,
      good: group.reduce((n, d) => n + d.good, 0),
      bad: group.reduce((n, d) => n + d.bad, 0),
    });
  }
  return points;
}

/** O rótulo de um ponto: "17" (um dia, no mesmo mês dos vizinhos) ou "17/10" (quando o mês muda ou o ponto reúne dias). */
export function pointLabel(point: SeriesPoint, index: number, points: SeriesPoint[]): string {
  const day = point.from.slice(8, 10);
  const monthChanged = index === 0 || points[index - 1].from.slice(5, 7) !== point.from.slice(5, 7);
  return point.from !== point.to || monthChanged ? `${day}/${point.from.slice(5, 7)}` : day;
}

/** O texto do ponto ao passar o mouse: "13/10: 4 acertos, 2 erros" (grupos: "13/10 a 19/10"). */
export function pointTitle(point: SeriesPoint): string {
  const when = point.from === point.to ? dayMonth(point.from) : `${dayMonth(point.from)} a ${dayMonth(point.to)}`;
  return `${when}: ${plural(point.good, 'acerto', 'acertos')}, ${plural(point.bad, 'erro', 'erros')}`;
}

/** Os índices dos rótulos do eixo: no máximo `maxTicks`, espalhados por igual, sempre com o primeiro e o último. */
export function tickIndexes(count: number, maxTicks = 8): number[] {
  if (count <= 0) return [];
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  const indexes = new Set<number>();
  for (let i = 0; i < maxTicks; i++) indexes.add(Math.round((i * (count - 1)) / (maxTicks - 1)));
  return [...indexes].sort((a, b) => a - b);
}

/** O teto do eixo vertical e as linhas de grade: um passo inteiro e fácil de ler, em quatro faixas. */
export function niceScale(max: number, bands = 4): { top: number; step: number; ticks: number[] } {
  const needed = Math.max(1, Math.ceil(Math.max(0, max) / bands));
  const magnitude = 10 ** Math.floor(Math.log10(needed));
  // Passos inteiros e fáceis de ler (1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25...): o teto não fica muito acima do maior valor.
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).filter(Number.isInteger).find((s) => s >= needed)!;
  return { top: step * bands, step, ticks: Array.from({ length: bands + 1 }, (_, i) => i * step) };
}

// ---------- curvas ----------

export interface XY {
  x: number;
  y: number;
}

const fmt = (n: number) => n.toFixed(1);

/**
 * Uma curva suave pelos pontos (Catmull-Rom convertida em Bézier), sem passar de `minY`/`maxY`: o
 * suavizado não cria valores negativos nem acima do teto. Um ponto só vira um traço de largura zero.
 */
export function smoothPath(points: XY[], minY: number, maxY: number): string {
  if (points.length === 0) return '';
  const clamp = (y: number) => Math.min(maxY, Math.max(minY, y));
  const first = points[0];
  let path = `M${fmt(first.x)},${fmt(first.y)}`;
  if (points.length === 1) return path;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: clamp(p1.y + (p2.y - p0.y) / 6) };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: clamp(p2.y - (p3.y - p1.y) / 6) };
    path += ` C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  return path;
}

/** A área sob a curva, até a linha de base: o preenchimento em degradê. */
export function areaPath(points: XY[], minY: number, maxY: number, baselineY: number): string {
  if (points.length < 2) return '';
  const last = points[points.length - 1];
  return `${smoothPath(points, minY, maxY)} L${fmt(last.x)},${fmt(baselineY)} L${fmt(points[0].x)},${fmt(baselineY)} Z`;
}

// ---------- rosca ----------

export const RESULT_ORDER: StudyResult[] = ['facil', 'bom', 'dificil', 'errei'];
export const RESULT_LABEL: Record<StudyResult, string> = { facil: 'Fácil', bom: 'Bom', dificil: 'Difícil', errei: 'Errei' };

export interface DonutSegment {
  result: StudyResult;
  value: number;
  pct: number;
  /** Comprimento do arco e a distância até o começo dele, para `stroke-dasharray` e `stroke-dashoffset`. */
  length: number;
  offset: number;
}

/** Os arcos da rosca, na ordem dos resultados, começando no topo; resultados com zero não ganham arco. Sem estudo: lista vazia. */
export function donutSegments(byResult: Record<StudyResult, number>, circumference: number): DonutSegment[] {
  const total = RESULT_ORDER.reduce((n, r) => n + byResult[r], 0);
  if (total === 0) return [];
  let used = 0;
  const segments: DonutSegment[] = [];
  for (const result of RESULT_ORDER) {
    const value = byResult[result];
    if (value === 0) continue;
    const length = (value / total) * circumference;
    segments.push({ result, value, pct: Math.round((value / total) * 100), length, offset: -used });
    used += length;
  }
  return segments;
}

// ---------- barras ----------

/** As barras do maior para o menor na métrica escolhida; o empate segue a outra métrica e depois o nome. Não altera a lista recebida. */
export function rankBars<T extends { cards: number; reviews: number; label: string }>(groups: T[], metric: Metric): T[] {
  const other: Metric = metric === 'cards' ? 'reviews' : 'cards';
  return [...groups].sort((a, b) => b[metric] - a[metric] || b[other] - a[other] || a.label.localeCompare(b.label, 'pt-BR'));
}

/** O comprimento de uma barra, em % da maior: quem tem algo nunca some (mínimo de 2%); zero fica em zero. */
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, Math.min(100, (value / max) * 100));
}

/** A parte dos cartões do usuário que foi estudada no período, em %; `null` se ele não tem cartões. */
export function studiedShare(data: Pick<PerformanceData, 'totalCards' | 'totals'>): number | null {
  return data.totalCards > 0 ? Math.round((data.totals.cards / data.totalCards) * 100) : null;
}
