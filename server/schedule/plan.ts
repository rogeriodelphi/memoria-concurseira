/**
 * O cronograma até a prova: dia a dia, quais tópicos do edital estudar. Tudo aqui é puro (sem banco, sem relógio): recebe
 * a data de hoje, a da prova, as disciplinas e os tópicos (com os já feitos) e as escolhas do usuário (quantos minutos por
 * dia, quanto leva um tópico, em que dias da semana estuda), e devolve os dias.
 *
 * As regras, todas explicáveis na tela:
 *  - Os últimos dias antes da prova são só de REVISÃO (nenhum tópico novo), a mesma conta da "Meta para a prova"; antes
 *    deles, os dias de semana que o usuário escolheu são de ESTUDO e os outros são de descanso.
 *  - A ordem dos tópicos reparte cada disciplina pela fatia dela na prova (a mesma escolha por cota da ordem dos cartões
 *    novos pelo edital): a disciplina que vale mais recebe mais tópicos, e as outras não ficam para o fim. Dentro de uma
 *    disciplina vale a ordem do edital. Os tópicos já feitos saem da fila e contam para a cota da disciplina deles.
 *  - A capacidade de um dia de estudo é `minutosPorDia / minutosPorTópico` tópicos, com a sobra levada para o dia
 *    seguinte (40 min por dia e 30 por tópico dão 1, 1, 2, 1, 1, 2...: em média 1,33 por dia).
 *  - O que não cabe até a prova fica de fora (`leftOut`), na ordem de prioridade, e o plano diz quantos minutos por dia
 *    seriam precisos para caber tudo. Como o plano é refeito a partir de hoje com o que falta, o tópico que ficou para
 *    trás volta nos próximos dias sozinho.
 */
import { FINAL_REVIEW_DAYS, LAST_DAYS } from '../studyplan/examPlan';
import { pickByExamWeight } from '../studyplan/newOrder';

export const DEFAULT_MINUTES_PER_DAY = 40;
export const DEFAULT_MINUTES_PER_TOPIC = 30;
export const MIN_MINUTES_PER_DAY = 10;
export const MAX_MINUTES_PER_DAY = 480;
export const MIN_MINUTES_PER_TOPIC = 10;
export const MAX_MINUTES_PER_TOPIC = 120;
/** Os dias da semana como `Date.getDay()`: 0 é domingo. */
export const ALL_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
/** Não se planeja além disto: uma prova daqui a anos não precisa de cronograma dia a dia. */
export const MAX_SCHEDULE_DAYS = 400;

export interface ScheduleSettings {
  minutesPerDay: number;
  minutesPerTopic: number;
  /** Em que dias da semana o usuário estuda (0 = domingo). */
  weekdays: number[];
}

export const DEFAULT_SETTINGS: ScheduleSettings = {
  minutesPerDay: DEFAULT_MINUTES_PER_DAY,
  minutesPerTopic: DEFAULT_MINUTES_PER_TOPIC,
  weekdays: [...ALL_WEEKDAYS],
};

export interface ScheduleDiscipline {
  id: string;
  /** Os pontos da disciplina na prova (questões vezes peso): a fatia dela. */
  points: number;
}

export interface ScheduleTopic {
  id: string;
  disciplineId: string;
  done: boolean;
}

export interface ScheduleInput {
  /** AAAA-MM-DD (dia local). */
  today: string;
  /** AAAA-MM-DD. */
  examDate: string;
  settings: ScheduleSettings;
  /** As disciplinas na ordem da prova. */
  disciplines: ScheduleDiscipline[];
  /** Os tópicos na ordem do edital (disciplina por disciplina, cada uma na ordem dos seus tópicos). */
  topics: ScheduleTopic[];
}

/** `study`: dia de tópicos novos; `review`: só revisão; `rest`: dia de semana que o usuário não estuda; `exam`: a prova. */
export type DayKind = 'study' | 'review' | 'rest' | 'exam';

export interface ScheduleDay {
  /** AAAA-MM-DD. */
  date: string;
  /** 0 = domingo. */
  weekday: number;
  kind: DayKind;
  /** Os tópicos do dia, na ordem de prioridade. Só dias `study` têm. */
  topicIds: string[];
  /** O tempo estimado dos tópicos do dia. */
  minutes: number;
}

export type ScheduleVerdict = 'fits' | 'overflow' | 'nothing_left' | 'no_time';

export interface ScheduleSummary {
  /** Dias de calendário até a prova (0 = hoje). */
  daysLeft: number;
  /** Quantos dias, no fim, são só de revisão (sem tópicos novos): a fase, mesmo que o usuário descanse em alguns deles. */
  reviewPhaseDays: number;
  /** Os dias do plano por tipo: de estudo, de revisão (em que o usuário estuda) e de descanso. A soma é o total de dias antes da prova. */
  studyDays: number;
  reviewDays: number;
  restDays: number;
  topicsTotal: number;
  topicsDone: number;
  topicsPending: number;
  /** Quantos dos pendentes cabem no plano, e quantos ficam de fora. */
  topicsScheduled: number;
  /** Quantos tópicos cabem nos dias de estudo, no total. */
  capacityTopics: number;
  /** Os tópicos que não cabem, na ordem de prioridade. */
  leftOut: string[];
  /** Minutos por dia que fariam tudo caber (de 5 em 5), quando algo fica de fora; `null` se tudo cabe. */
  neededMinutesPerDay: number | null;
  /** O dia em que cai o último tópico do plano; `null` sem tópicos agendados. */
  finishDate: string | null;
  /** Dias de estudo que sobram depois do último tópico. */
  freeStudyDays: number;
  verdict: ScheduleVerdict;
}

export interface Schedule {
  days: ScheduleDay[];
  summary: ScheduleSummary;
}

// ---------- datas ----------

/** Um dia AAAA-MM-DD como data local (meio-dia, para o horário de verão nunca virar o dia). */
export function parseDay(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Dia inválido: ${day}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

export function formatDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** O dia `offset` dias depois de `day` (AAAA-MM-DD). */
export function addDays(day: string, offset: number): string {
  const date = parseDay(day);
  date.setDate(date.getDate() + offset);
  return formatDay(date);
}

/** Quantos dias de calendário vão de `from` até `to` (negativo se `to` é antes). */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}

/** Os dias de revisão no fim: a mesma conta da "Meta para a prova". */
export function reviewDaysFor(days: number): number {
  return days <= LAST_DAYS ? days : Math.min(FINAL_REVIEW_DAYS, Math.floor(days / 3));
}

const ceilTo5 = (n: number) => Math.ceil(n / 5) * 5;

// ---------- o plano ----------

export function buildSchedule(input: ScheduleInput): Schedule {
  const { settings } = input;
  const daysLeft = Math.max(0, daysBetween(input.today, input.examDate));
  const span = Math.min(daysLeft, MAX_SCHEDULE_DAYS);
  // Os dias de revisão são os últimos antes da prova: uma prova além da janela do plano ainda não tem revisão nela.
  const reviewDays = daysLeft > MAX_SCHEDULE_DAYS ? 0 : reviewDaysFor(span);
  const studyUntil = span - reviewDays; // os `studyUntil` primeiros dias são de conteúdo
  const weekdays = new Set(settings.weekdays);

  // O esqueleto dos dias: hoje até o dia antes da prova, e a prova.
  const days: ScheduleDay[] = [];
  for (let i = 0; i < span; i++) {
    const date = addDays(input.today, i);
    const weekday = parseDay(date).getDay();
    const kind: DayKind = !weekdays.has(weekday) ? 'rest' : i >= studyUntil ? 'review' : 'study';
    days.push({ date, weekday, kind, topicIds: [], minutes: 0 });
  }
  if (daysLeft <= MAX_SCHEDULE_DAYS) days.push({ date: input.examDate, weekday: parseDay(input.examDate).getDay(), kind: 'exam', topicIds: [], minutes: 0 });

  const studyDays = days.filter((d) => d.kind === 'study');
  const restDays = days.filter((d) => d.kind === 'rest').length;

  // A ordem de prioridade dos pendentes: cada disciplina na proporção da sua fatia, o que já foi feito contando para a cota.
  const pending = input.topics.filter((t) => !t.done);
  const doneByDiscipline = new Map<string, number>();
  for (const topic of input.topics) if (topic.done) doneByDiscipline.set(topic.disciplineId, (doneByDiscipline.get(topic.disciplineId) ?? 0) + 1);
  const ordered = pickByExamWeight({
    newCards: pending.map((t) => ({ id: t.id, group: t.disciplineId })),
    learnedByGroup: doneByDiscipline,
    points: new Map(input.disciplines.map((d) => [d.id, d.points])),
    count: pending.length,
  });
  // Disciplina sem pontos (ou fora da prova) não entra na cota: os tópicos dela vão ao fim, na ordem do edital.
  const seen = new Set(ordered);
  for (const topic of pending) if (!seen.has(topic.id)) ordered.push(topic.id);

  // Reparte pelos dias de estudo: a capacidade de cada dia é `minutosPorDia / minutosPorTópico`, levando a sobra adiante.
  let next = 0;
  let credit = 0;
  for (const day of studyDays) {
    credit += settings.minutesPerDay;
    const count = Math.min(Math.floor(credit / settings.minutesPerTopic), ordered.length - next);
    credit -= count * settings.minutesPerTopic;
    day.topicIds = ordered.slice(next, next + count);
    day.minutes = count * settings.minutesPerTopic;
    next += count;
    // Uma sobra que já não leva a um tópico a mais não se acumula além de um dia (sem tópicos para dar, não há o que guardar).
    if (next >= ordered.length) credit = 0;
  }

  const scheduled = next;
  const leftOut = ordered.slice(scheduled);
  const capacityTopics = Math.floor((studyDays.length * settings.minutesPerDay) / settings.minutesPerTopic);
  const lastWithTopics = [...studyDays].reverse().find((d) => d.topicIds.length > 0);
  const lastIndex = lastWithTopics ? studyDays.indexOf(lastWithTopics) : -1;

  let verdict: ScheduleVerdict;
  if (pending.length === 0) verdict = 'nothing_left';
  else if (studyDays.length === 0) verdict = 'no_time';
  else if (leftOut.length > 0) verdict = 'overflow';
  else verdict = 'fits';

  return {
    days,
    summary: {
      daysLeft,
      reviewPhaseDays: reviewDays,
      studyDays: studyDays.length,
      reviewDays: days.filter((d) => d.kind === 'review').length,
      restDays,
      topicsTotal: input.topics.length,
      topicsDone: input.topics.length - pending.length,
      topicsPending: pending.length,
      topicsScheduled: scheduled,
      capacityTopics,
      leftOut,
      neededMinutesPerDay: leftOut.length > 0 && studyDays.length > 0 ? ceilTo5((pending.length * settings.minutesPerTopic) / studyDays.length) : null,
      finishDate: lastWithTopics?.date ?? null,
      freeStudyDays: lastIndex >= 0 ? studyDays.length - 1 - lastIndex : studyDays.length,
      verdict,
    },
  };
}
