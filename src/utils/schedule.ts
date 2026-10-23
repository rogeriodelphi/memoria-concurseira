/**
 * O cronograma até a prova: as partes sem tela. O plano (os dias, os tópicos de cada um, os totais) vem do servidor
 * (server/schedule); aqui ficam os textos, o agrupamento por semana e a conferência das escolhas.
 */
import type { Schedule, ScheduleDay, ScheduleDiscipline, ScheduleSettings, ScheduleSummary, ScheduleTopic } from '../types';
import { plural } from './performance';

export const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
export const WEEKDAY_CHIP = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/** Os limites das escolhas (os mesmos do servidor). */
export const MIN_MINUTES_PER_DAY = 10;
export const MAX_MINUTES_PER_DAY = 480;
export const MIN_MINUTES_PER_TOPIC = 10;
export const MAX_MINUTES_PER_TOPIC = 120;

/** "23/10" a partir de AAAA-MM-DD. */
export function shortDate(day: string): string {
  const [, month, date] = day.split('-');
  return `${date}/${month}`;
}

/** Um dia AAAA-MM-DD como data local (meio-dia, para o horário de verão nunca virar o dia). */
function toDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** O dia de um dia do cronograma: "Hoje · sex 23/10", "Amanhã · sáb 24/10", "dom 25/10" ou "Dia da prova · dom 06/12". */
export function dayTitle(day: Pick<ScheduleDay, 'date' | 'weekday' | 'kind'>, today: string): string {
  const base = `${WEEKDAY_SHORT[day.weekday]} ${shortDate(day.date)}`;
  if (day.kind === 'exam') return `Dia da prova · ${base}`;
  const diff = Math.round((toDate(day.date).getTime() - toDate(today).getTime()) / 86_400_000);
  if (diff === 0) return `Hoje · ${base}`;
  if (diff === 1) return `Amanhã · ${base}`;
  return base;
}

/** O que um dia sem tópicos diz de si mesmo. */
export function dayNote(day: Pick<ScheduleDay, 'kind' | 'topicIds'>): string {
  if (day.kind === 'rest') return 'Descanso';
  if (day.kind === 'review') return 'Revisão: sem tópicos novos';
  if (day.kind === 'exam') return 'Boa prova!';
  return day.topicIds.length === 0 ? 'Livre: revise os cartões' : '';
}

/** Quantos tópicos cabem por dia, em média: "1,3 tópicos por dia". */
export function topicsPerDayText(settings: Pick<ScheduleSettings, 'minutesPerDay' | 'minutesPerTopic'>): string {
  const perDay = settings.minutesPerDay / settings.minutesPerTopic;
  const text = perDay.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return `${text} ${perDay === 1 ? 'tópico' : 'tópicos'} por dia, em média`;
}

export interface Week {
  /** A segunda-feira da semana (AAAA-MM-DD): serve de chave. */
  key: string;
  label: string;
  days: ScheduleDay[];
  /** Quantos tópicos há na semana. */
  topics: number;
}

/** O dia da semana começando na segunda-feira (0 = segunda). */
const mondayIndex = (weekday: number) => (weekday + 6) % 7;

/** Reparte os dias em semanas de segunda a domingo: "Esta semana" (a de hoje) e "Semana de 26/10 a 01/11". */
export function groupWeeks(days: readonly ScheduleDay[], today: string): Week[] {
  const weeks: Week[] = [];
  for (const day of days) {
    const monday = new Date(toDate(day.date));
    monday.setDate(monday.getDate() - mondayIndex(day.weekday));
    const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    let week = weeks.find((w) => w.key === key);
    if (!week) {
      week = { key, label: '', days: [], topics: 0 };
      weeks.push(week);
    }
    week.days.push(day);
    week.topics += day.topicIds.length;
  }
  for (const week of weeks) {
    const sunday = new Date(toDate(week.key));
    sunday.setDate(sunday.getDate() + 6);
    const end = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
    const containsToday = week.days.some((d) => d.date === today);
    week.label = containsToday ? 'Esta semana' : `Semana de ${shortDate(week.key)} a ${shortDate(end)}`;
  }
  return weeks;
}

export type HeadlineTone = 'green' | 'amber' | 'red';

/**
 * Os minutos por tópico que fariam tudo caber mantendo o tempo por dia (de 5 em 5, no mínimo 10), ou `null` se já cabe ou se
 * nem com o mínimo caberia. Serve ao "ou reduza o tempo por tópico para X min".
 */
export function minutesPerTopicToFit(summary: Pick<ScheduleSummary, 'studyDays' | 'topicsPending' | 'leftOut'>, settings: ScheduleSettings): number | null {
  if (summary.leftOut.length === 0 || summary.topicsPending === 0 || summary.studyDays === 0) return null;
  const fit = Math.floor(((summary.studyDays * settings.minutesPerDay) / summary.topicsPending) / 5) * 5;
  return fit >= MIN_MINUTES_PER_TOPIC && fit < settings.minutesPerTopic ? fit : null;
}

/** A manchete do plano: se o que falta cabe no tempo, e o que fazer quando não cabe. */
export function headline(schedule: Pick<Schedule, 'summary' | 'settings'>): { tone: HeadlineTone; title: string; message: string } {
  const { summary, settings } = schedule;
  if (summary.verdict === 'nothing_left') {
    return { tone: 'green', title: 'Todos os tópicos estudados', message: `Você marcou os ${plural(summary.topicsTotal, 'tópico', 'tópicos')} do edital como estudados. Use os dias que faltam para revisar os cartões.` };
  }
  if (summary.verdict === 'no_time') {
    return {
      tone: 'amber',
      title: 'Sem dias de estudo até a prova',
      message: 'Não sobram dias de estudo antes da revisão final (ou você não estuda nos dias que restam). Vale olhar a Reta final e a revisão dos cartões.',
    };
  }
  if (summary.verdict === 'fits') {
    const finish = summary.finishDate ? shortDate(summary.finishDate) : '';
    const free =
      summary.freeStudyDays === 0
        ? ', no último dia de estudo antes da revisão final'
        : `; ${summary.freeStudyDays === 1 ? 'ainda sobra' : 'ainda sobram'} ${plural(summary.freeStudyDays, 'dia de estudo', 'dias de estudo')} antes da revisão final`;
    const subject = summary.topicsPending === 1 ? 'O tópico pendente termina' : `Os ${plural(summary.topicsPending, 'tópico pendente', 'tópicos pendentes')} terminam`;
    return { tone: 'green', title: 'Cabe tudo no tempo que você tem', message: `${subject} em ${finish}${free}.` };
  }
  const shorter = minutesPerTopicToFit(summary, settings);
  const options = [`cerca de ${summary.neededMinutesPerDay} min por dia`];
  if (shorter !== null) options.push(`${shorter} min por tópico (mantendo ${settings.minutesPerDay} min por dia)`);
  return {
    tone: 'red',
    title: 'Não cabe tudo até a prova',
    message: `Com ${settings.minutesPerDay} min por dia cabem ${summary.topicsScheduled} dos ${plural(summary.topicsPending, 'tópico pendente', 'tópicos pendentes')}; ${summary.leftOut.length} ficam de fora (os menos prioritários). Para caber tudo seriam precisos ${options.join(' ou ')}.`,
  };
}

/** Os tópicos que ficaram de fora, contados por disciplina, na ordem da prova (sem as disciplinas que não perderam nenhum). */
export function leftOutByDiscipline(leftOut: readonly string[], topics: readonly ScheduleTopic[], disciplines: readonly ScheduleDiscipline[]): { id: string; name: string; count: number }[] {
  const disciplineOf = new Map(topics.map((t) => [t.id, t.disciplineId]));
  const counts = new Map<string, number>();
  for (const id of leftOut) {
    const discipline = disciplineOf.get(id);
    if (discipline) counts.set(discipline, (counts.get(discipline) ?? 0) + 1);
  }
  return disciplines.filter((d) => counts.has(d.id)).map((d) => ({ id: d.id, name: d.name, count: counts.get(d.id)! }));
}

/** As escolhas do formulário conferidas como o servidor as confere: a mensagem do problema, ou `null` se estão certas. */
export function settingsError(settings: ScheduleSettings): string | null {
  const whole = (n: number) => Number.isInteger(n);
  if (!whole(settings.minutesPerDay) || settings.minutesPerDay < MIN_MINUTES_PER_DAY || settings.minutesPerDay > MAX_MINUTES_PER_DAY) {
    return `O tempo por dia deve ser de ${MIN_MINUTES_PER_DAY} a ${MAX_MINUTES_PER_DAY} minutos.`;
  }
  if (!whole(settings.minutesPerTopic) || settings.minutesPerTopic < MIN_MINUTES_PER_TOPIC || settings.minutesPerTopic > MAX_MINUTES_PER_TOPIC) {
    return `O tempo por tópico deve ser de ${MIN_MINUTES_PER_TOPIC} a ${MAX_MINUTES_PER_TOPIC} minutos.`;
  }
  if (settings.minutesPerTopic > settings.minutesPerDay) return 'Cada tópico precisa caber em um dia: o tempo por tópico não pode passar do tempo por dia.';
  if (settings.weekdays.length === 0) return 'Escolha ao menos um dia da semana para estudar.';
  return null;
}

/** Se as escolhas do formulário são diferentes das guardadas (para o botão "Salvar" só acender quando há o que salvar). */
export function settingsChanged(a: ScheduleSettings, b: ScheduleSettings): boolean {
  const days = (s: ScheduleSettings) => [...s.weekdays].sort((x, y) => x - y).join(',');
  return a.minutesPerDay !== b.minutesPerDay || a.minutesPerTopic !== b.minutesPerTopic || days(a) !== days(b);
}

/** O número digitado num campo: inteiro, ou `NaN` se vazio ou com lixo (a conferência o recusa). */
export function wholeNumber(raw: string): number {
  return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
}
