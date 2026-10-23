/**
 * Reta final: as partes sem tela. Os números (prioridade de cada disciplina, a fila do foco) vêm do servidor
 * (server/studyplan/finalStretch.ts); aqui ficam os textos e as faixas de cor.
 */
import type { FinalStretch, FinalStretchDiscipline, FinalStretchPhase } from '../types';
import { plural } from './performance';

export type Tone = 'green' | 'amber' | 'red';

export interface PhaseInfo {
  title: string;
  message: string;
  tone: Tone;
}

/** "Falta 1 dia." / "Faltam 12 dias.". */
export const remainingText = (daysLeft: number) => `${daysLeft === 1 ? 'Falta' : 'Faltam'} ${plural(daysLeft, 'dia', 'dias')}`;

/** O que a fase da preparação pede (a mesma divisão da "Meta para a prova": nos últimos 7 dias só se revisa). */
export function phaseInfo(phase: FinalStretchPhase, daysLeft: number): PhaseInfo {
  if (phase === 'content') {
    return {
      title: 'Ainda dá para ver conteúdo novo',
      message: `${remainingText(daysLeft)}. Dê prioridade às disciplinas com mais pontos em aberto; a partir dos últimos 7 dias, só revisão.`,
      tone: 'green',
    };
  }
  if (phase === 'review') {
    return {
      title: 'Só revisão',
      message: `${remainingText(daysLeft)}: cartão novo já não dá tempo de consolidar, então o foco traz só o que venceu. Atenção ao que você mais erra.`,
      tone: 'amber',
    };
  }
  if (daysLeft === 0) {
    return { title: 'Dia da prova', message: 'A prova é hoje. Sem cartões novos: se for revisar, passe pelo que você mais erra e preserve o descanso.', tone: 'red' };
  }
  return {
    title: 'Últimos dias',
    message: `${remainingText(daysLeft)}. Só revisão, sem cartões novos: foque no que você mais erra e preserve o descanso.`,
    tone: 'red',
  };
}

/**
 * Os fatos de uma disciplina, em frases curtas. Com tópicos cadastrados no edital, diz quantos têm cartão (é essa
 * cobertura que desconta o domínio: ver os cartões que existem não é dominar uma disciplina de que metade dos tópicos
 * não tem cartão).
 */
export function disciplineFacts(
  d: Pick<FinalStretchDiscipline, 'hasCards' | 'sharePct' | 'seenPct' | 'accuracyPct' | 'reviews30'> & Partial<Pick<FinalStretchDiscipline, 'topics' | 'coveredTopics'>>,
): string[] {
  if (!d.hasCards) return [`Pesa ${d.sharePct}% da prova`, 'nenhum cartão ligado a ela'];
  const facts = [`Pesa ${d.sharePct}% da prova`, `viu ${d.seenPct ?? 0}% dos cartões`];
  if (d.topics) facts.push(`${d.coveredTopics ?? 0} de ${plural(d.topics, 'tópico', 'tópicos')} do edital com cartão`);
  facts.push(d.accuracyPct !== null ? `acerta ${d.accuracyPct}% (${plural(d.reviews30, 'revisão', 'revisões')} em 30 dias)` : 'sem revisões nos últimos 30 dias');
  return facts;
}

/**
 * O aviso da cobertura do edital: quantos dos tópicos têm cartão, quando faltam, e o que isso faz com o domínio.
 * `null` quando o edital não tem tópicos ou todos já têm cartão.
 */
export function coverageNote(topics: number, coveredTopics: number): string | null {
  if (topics <= 0 || coveredTopics >= topics) return null;
  const tail = 'O domínio de cada disciplina é descontado por isso, porque ver todos os cartões que existem não é dominar o que o edital cobra.';
  if (topics === 1) return `O único tópico do edital está sem cartão. ${tail}`;
  const missing = topics - coveredTopics;
  const pct = Math.round((coveredTopics / topics) * 100);
  const lead = coveredTopics === 0 ? `Nenhum dos ${plural(topics, 'tópico', 'tópicos')} do edital tem cartão` : `Só ${coveredTopics.toLocaleString('pt-BR')} dos ${plural(topics, 'tópico', 'tópicos')} do edital ${coveredTopics === 1 ? 'tem' : 'têm'} cartão (${pct}%)`;
  return `${lead}: ${plural(missing, 'tópico está', 'tópicos estão')} sem material. ${tail}`;
}

export type MasteryTone = 'good' | 'ok' | 'bad' | 'none';

/** A cor da barra de domínio. */
export function masteryTone(masteryPct: number | null): MasteryTone {
  if (masteryPct === null) return 'none';
  if (masteryPct < 40) return 'bad';
  if (masteryPct < 70) return 'ok';
  return 'good';
}

/** "21%" (inteiro a partir de 10) ou "0,7%". */
export function gainText(gainPct: number): string {
  return gainPct >= 10 ? `${Math.round(gainPct)}%` : `${gainPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/** O resumo da sessão: "9 vencidos e 6 novos". */
export function queueHeadline(queue: Pick<FinalStretch['queue'], 'total' | 'due' | 'new'>): string {
  if (queue.total === 0) return 'Nada para o foco agora';
  const parts = [];
  if (queue.due > 0) parts.push(plural(queue.due, 'vencido', 'vencidos'));
  if (queue.new > 0) parts.push(plural(queue.new, 'novo', 'novos'));
  return parts.join(' e ');
}

/** Os avisos sobre o que ficou de fora da sessão, e por quê. */
export function queueNotes(queue: FinalStretch['queue'], phase: FinalStretchPhase | null): string[] {
  const notes: string[] = [];
  if (queue.waitingDue > 0) {
    notes.push(`${plural(queue.waitingDue, 'vencido ficou', 'vencidos ficaram')} para a próxima sessão (cada uma traz no máximo ${queue.maxCards} cartões).`);
  }
  if (queue.waitingNew > 0) {
    if (phase !== 'content') {
      notes.push(`${plural(queue.waitingNew, 'cartão novo não entra', 'cartões novos não entram')}: faltando 7 dias ou menos, só se revisa.`);
    } else if (queue.limit === null) {
      notes.push(`${plural(queue.waitingNew, 'novo ficou', 'novos ficaram')} de fora: sem limite diário, a sessão traz até ${queue.defaultNew} cartões novos (defina um limite em Configurações para mudar).`);
    } else {
      notes.push(`${plural(queue.waitingNew, 'novo ficou', 'novos ficaram')} de fora: o seu limite diário é ${queue.limit} (descontado o que você já estudou hoje) e a sessão reserva até um terço dos cartões para novos.`);
    }
  }
  if (queue.outsideDue > 0) {
    notes.push(`${plural(queue.outsideDue, 'vencido está', 'vencidos estão')} em coleções fora do edital e não entram aqui (use "Revisar pendentes" no Painel).`);
  }
  return notes;
}
