/**
 * Os textos e números da "Meta para a prova", sem React: o que cada veredito diz, como se escreve um
 * tempo e como o gráfico de carga por dia é agrupado. O cálculo do plano em si é do servidor
 * (server/studyplan/examPlan.ts); aqui só se apresenta.
 */
import type { ExamPlan, PlanScenario, PlanVerdict } from '../types';

export type VerdictTone = 'green' | 'amber' | 'red' | 'neutral';

/** 61 → "1 h 01"; 90 → "1 h 30"; 45.4 → "45 min". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

const int = (n: number) => Math.round(n).toLocaleString('pt-BR');

/** "1 cartão/dia", "23 cartões/dia": o número arredondado, com o plural certo. */
export function cardsPerDayLabel(n: number): string {
  const rounded = Math.round(n);
  return rounded === 1 ? '1 cartão/dia' : `${int(rounded)} cartões/dia`;
}

export const VERDICT_LABEL: Record<PlanVerdict, { label: string; tone: VerdictTone }> = {
  on_track: { label: 'No ritmo', tone: 'green' },
  tight: { label: 'Apertado', tone: 'amber' },
  behind: { label: 'Atrasado', tone: 'red' },
  no_pace: { label: 'Sem ritmo medido', tone: 'neutral' },
  last_days: { label: 'Reta final', tone: 'amber' },
  exam_today: { label: 'Hoje', tone: 'green' },
};

/** A frase que diz como o ritmo atual se compara com o que a prova pede. */
export function verdictMessage(plan: ExamPlan): string {
  const current = plan.scenarios.find((s) => s.kind === 'current');
  switch (plan.verdict) {
    case 'on_track':
      return plan.cards.new === 0
        ? 'Todos os seus cartões já foram vistos. Daqui até a prova, o trabalho é manter as revisões em dia.'
        : 'No seu ritmo atual dá para ver todos os cartões novos até a prova, sem deixar as revisões para trás.';
    case 'tight':
      return `No seu ritmo atual você veria cerca de ${current?.coveragePct ?? 0}% dos cartões novos até a prova: quase todos, mas sem folga.`;
    case 'behind': {
      const seen = current?.coveragePct ?? 0;
      const share =
        seen === 0
          ? `não conseguiria ver nenhum dos ${int(plan.cards.new)} cartões novos`
          : `veria cerca de ${seen}% dos ${int(plan.cards.new)} cartões novos`;
      return `No seu ritmo atual (cerca de ${cardsPerDayLabel(plan.pace.reviewsPerDay).replace('/dia', ' por dia')}) você ${share} até a prova. As revisões que vão vencendo também tomam tempo.`;
    }
    case 'no_pace':
      return `Você não estudou nos últimos ${plan.pace.windowDays} dias, então não dá para medir o seu ritmo. Veja quanto tempo por dia cada meta pede:`;
    case 'last_days':
      return 'Faltam poucos dias: cartão novo já não dá tempo de consolidar. O melhor agora é revisar o que você já estudou.';
    case 'exam_today':
      return 'A prova é hoje. Bons estudos e boa prova!';
  }
}

/** O nome de um cenário, na lista de opções. */
export function scenarioLabel(scenario: PlanScenario, newCount: number): string {
  if (scenario.kind === 'current') return 'No seu ritmo atual';
  if (scenario.kind === 'all') return newCount === 0 ? 'Só as revisões' : 'Ver todos os cartões novos';
  return `Cerca de ${formatMinutes(scenario.minutesPerDay)} por dia`;
}

/** O que um cenário faz: "8 novos por dia · cobre 38% (344 de 912)". */
export function scenarioSummary(scenario: PlanScenario, newCount: number): string {
  if (newCount === 0) return 'sem cartões novos';
  const perDay = scenario.newPerDay === 1 ? '1 novo por dia' : `${int(scenario.newPerDay)} novos por dia`;
  return `${perDay} · cobre ${scenario.coveragePct}% (${int(scenario.newSeen)} de ${int(newCount)})`;
}

/**
 * Agrupa a carga por dia em no máximo `maxBars` barras (média de cada grupo de dias seguidos): com uma
 * prova a meses de distância, uma barra por dia não caberia.
 */
export function chartBars(perDay: number[], maxBars = 60): number[] {
  if (perDay.length <= maxBars) return [...perDay];
  const size = Math.ceil(perDay.length / maxBars);
  const bars: number[] = [];
  for (let start = 0; start < perDay.length; start += size) {
    const group = perDay.slice(start, start + size);
    bars.push(group.reduce((sum, n) => sum + n, 0) / group.length);
  }
  return bars;
}
