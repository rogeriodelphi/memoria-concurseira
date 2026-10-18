/**
 * Simulados contra a nota de corte, sem React: as frases e os números que as telas mostram. Os cálculos
 * (comparação, situação, tendência) vêm prontos do servidor (server/questionbank/cutoff.ts).
 */
import type { QbComparison, QbCutoffStatus, QbDisciplineResult, QbOverviewDiscipline, QbTrend } from '../types';

export const STATUS_LABEL: Record<QbCutoffStatus, string> = {
  above: 'Acima da nota de corte',
  below: 'Abaixo da nota de corte',
  unknown: 'Sem nota de corte',
};

export const TREND_LABEL: Record<QbTrend, string> = {
  up: 'subindo',
  down: 'caindo',
  flat: 'estável',
};

/** "66,7%". */
export function formatPct(value: number): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

const points = (n: number) => `${formatPct(Math.abs(n)).replace('%', '')} ${Math.abs(n) === 1 ? 'ponto' : 'pontos'}`;

/** A distância da nota de corte, em palavras: "na nota de corte", "10 pontos acima", "faltaram 2 acertos". */
export function marginText(d: Pick<QbDisciplineResult, 'status' | 'margin' | 'missing'>): string {
  if (d.status === 'unknown' || d.margin === null) return 'sem critério mínimo para comparar';
  if (d.status === 'above') return d.margin === 0 ? 'exatamente na nota de corte' : `${points(d.margin)} acima`;
  if (d.missing !== null && d.missing > 0) return `faltaram ${d.missing} ${d.missing === 1 ? 'acerto' : 'acertos'} (${points(d.margin)} abaixo)`;
  return `${points(d.margin)} abaixo`;
}

/** A frase do topo do resultado de um simulado. */
export function verdictLine(comparison: QbComparison): string {
  const below = comparison.disciplines.filter((d) => d.status === 'below');
  if (comparison.verdict === 'below') {
    const names = below.map((d) => d.label);
    return `Abaixo da nota de corte em ${below.length} ${below.length === 1 ? 'disciplina' : 'disciplinas'}: ${names.join(', ')}.`;
  }
  if (comparison.verdict === 'above') {
    return 'Acima da nota de corte em todas as disciplinas deste simulado que têm critério mínimo.';
  }
  return 'Este simulado não tem como ser comparado: nenhuma disciplina dele casou com uma do concurso que tenha critério mínimo.';
}

/** A frase do acompanhamento: onde a situação recente está pior. */
export function overviewLine(disciplines: QbOverviewDiscipline[]): string | null {
  const judged = disciplines.filter((d) => d.status !== 'unknown');
  if (judged.length === 0) return null;
  const below = judged.filter((d) => d.status === 'below').sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0));
  if (below.length === 0) return 'Nos últimos simulados, todas as disciplinas com critério mínimo estão na nota de corte ou acima.';
  const worst = below[0];
  const others = below.length - 1;
  return `${worst.name} é onde mais falta: ${formatPct(worst.recentPct ?? 0)} contra ${formatPct(worst.cutoffPct ?? 0)}${
    others > 0 ? `, e mais ${others} ${others === 1 ? 'disciplina' : 'disciplinas'} abaixo` : ''
  }.`;
}

/** O endereço das questões erradas de uma disciplina (com os nomes que as questões usam), para praticar. */
export function practiceHref(disciplines: string[]): string {
  return `/questoes?${disciplines.map((d) => `disciplina=${encodeURIComponent(d)}`).join('&')}&status=errei`;
}

export interface Spark {
  /** Os pontos já em coordenadas do desenho. */
  dots: { x: number; y: number; pct: number }[];
  /** O traçado da linha ("M x y L x y ..."); vazio com menos de 2 pontos. */
  path: string;
  /** A altura da linha da nota de corte; `null` sem nota de corte. */
  cutoffY: number | null;
}

/** As notas (0 a 100) de uma disciplina como um desenho de largura × altura, com margem para os pontos. */
export function sparkline(values: number[], width: number, height: number, cutoffPct: number | null, pad = 4): Spark {
  const y = (pct: number) => pad + (1 - Math.min(100, Math.max(0, pct)) / 100) * (height - pad * 2);
  const x = (i: number) => (values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * (width - pad * 2));
  const dots = values.map((pct, i) => ({ x: x(i), y: y(pct), pct }));
  return {
    dots,
    path: dots.length >= 2 ? dots.map((d, i) => `${i === 0 ? 'M' : 'L'} ${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join(' ') : '',
    cutoffY: cutoffPct === null ? null : y(cutoffPct),
  };
}
