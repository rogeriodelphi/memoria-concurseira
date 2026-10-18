/**
 * "Pontos de atenção" do Meu desempenho: onde o acerto está baixo ou caindo, e para onde o botão "Revisar
 * os errados" leva. A regra é só apresentação: os números vêm do servidor (server/stats/performance.ts).
 */
import type { PerformanceCounts, PerformanceData } from '../types';
import { NO_SUBJECT_KEY, plural } from './performance';

/** Menos revisões que isto num grupo é pouco para dizer qualquer coisa: o acerto balança demais. */
export const MIN_REVIEWS = 6;
/** Acerto abaixo disto pede atenção. */
export const LOW_ACCURACY = 60;
/** Uma queda de tantos pontos (ou mais) em relação ao período anterior pede atenção. */
export const DROP_POINTS = 10;
/** O período anterior só serve de comparação se teve revisões suficientes. */
export const MIN_PREVIOUS_REVIEWS = 6;
/** Quantos pontos aparecem. */
export const MAX_POINTS = 5;

export interface AttentionPoint {
  /** O nome na tela: "Redes de Computadores · DNS", ou só o nome. */
  label: string;
  nameKey: string;
  /** A chave do assunto quando o ponto é um assunto dentro de um nome; `null` quando é o nome todo. */
  subjectKey: string | null;
  counts: PerformanceCounts;
  /** Os motivos, em frases curtas. */
  reasons: string[];
  /** As coleções que o "Revisar os errados" abre. */
  collectionIds: string[];
  /** Quanto mais alto, mais urgente. */
  score: number;
}

/** Baixo, caindo, os dois ou nenhum: o que há de errado no grupo (frases vazias = nada). */
export function attentionReasons(c: PerformanceCounts): { reasons: string[]; score: number } {
  if (c.reviews < MIN_REVIEWS) return { reasons: [], score: 0 };
  const reasons: string[] = [];
  let score = 0;
  if (c.accuracyPct < LOW_ACCURACY) {
    reasons.push(`Acerto de ${c.accuracyPct}%, abaixo de ${LOW_ACCURACY}%`);
    score += LOW_ACCURACY - c.accuracyPct;
  }
  if (c.previousAccuracyPct !== null && c.previousReviews >= MIN_PREVIOUS_REVIEWS) {
    const drop = c.previousAccuracyPct - c.accuracyPct;
    if (drop >= DROP_POINTS) {
      reasons.push(`Caiu ${plural(drop, 'ponto', 'pontos')}: de ${c.previousAccuracyPct}% para ${c.accuracyPct}%`);
      score += drop;
    }
  }
  return { reasons, score };
}

/**
 * Os grupos que merecem atenção, do mais urgente ao menos: cada assunto de cada nome (é o grão que dá para
 * revisar) e, quando o nome todo está mal mas nenhum assunto dele sozinho tem revisões o bastante para
 * apontar, o nome. Só entram os que têm ao menos um cartão errado para rever.
 */
export function attentionPoints(data: Pick<PerformanceData, 'byName'>, max: number = MAX_POINTS): AttentionPoint[] {
  const points: AttentionPoint[] = [];
  for (const name of data.byName) {
    const fromSubjects: AttentionPoint[] = [];
    for (const subject of name.subjects) {
      const { reasons, score } = attentionReasons(subject);
      if (reasons.length === 0 || subject.missedCards === 0) continue;
      const hasSubject = subject.key !== NO_SUBJECT_KEY;
      fromSubjects.push({
        label: hasSubject ? `${name.label} · ${subject.label}` : name.label,
        nameKey: name.key,
        subjectKey: subject.key,
        counts: subject,
        reasons,
        collectionIds: subject.collectionIds,
        score,
      });
    }
    if (fromSubjects.length > 0) {
      points.push(...fromSubjects);
      continue;
    }
    const { reasons, score } = attentionReasons(name);
    if (reasons.length > 0 && name.missedCards > 0) {
      points.push({ label: name.label, nameKey: name.key, subjectKey: null, counts: name, reasons, collectionIds: name.collectionIds, score });
    }
  }
  return points
    .sort((a, b) => b.score - a.score || b.counts.missedCards - a.counts.missedCards || b.counts.reviews - a.counts.reviews || a.label.localeCompare(b.label, 'pt-BR'))
    .slice(0, max);
}

/** Algum grupo tem revisões o bastante para o painel poder opinar? (Sem isso, "nenhum ponto" não quer dizer "tudo bem".) */
export function hasEnoughData(data: Pick<PerformanceData, 'byName'>): boolean {
  return data.byName.some((n) => n.reviews >= MIN_REVIEWS || n.subjects.some((s) => s.reviews >= MIN_REVIEWS));
}

/** O endereço da revisão dos cartões errados de um ponto, no período da página, voltando para `returnTo`. */
export function missedHref(point: AttentionPoint, range: { from: string; to: string }, returnTo: string): string {
  const query = new URLSearchParams({ ids: point.collectionIds.join(','), de: range.from, ate: range.to, nome: point.label, voltar: returnTo });
  return `/revisar-erros?${query.toString()}`;
}
