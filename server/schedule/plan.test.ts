import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDays,
  ALL_WEEKDAYS,
  buildSchedule,
  daysBetween,
  DEFAULT_SETTINGS,
  formatDay,
  MAX_SCHEDULE_DAYS,
  parseDay,
  reviewDaysFor,
  type ScheduleInput,
  type ScheduleSettings,
  type ScheduleTopic,
} from './plan';

// 23/10/2026 é uma sexta-feira.
const TODAY = '2026-10-23';

const settings = (over: Partial<ScheduleSettings> = {}): ScheduleSettings => ({ ...DEFAULT_SETTINGS, weekdays: [...ALL_WEEKDAYS], ...over });
const topics = (discipline: string, n: number, done = 0): ScheduleTopic[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${discipline}${i + 1}`, disciplineId: discipline, done: i < done }));

function input(over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    today: TODAY,
    examDate: addDays(TODAY, 30),
    settings: settings({ minutesPerDay: 60, minutesPerTopic: 30 }),
    disciplines: [
      { id: 'A', points: 50 },
      { id: 'B', points: 10 },
    ],
    topics: [...topics('A', 20), ...topics('B', 4)],
    ...over,
  };
}

const ids = (days: { topicIds: string[] }[]) => days.flatMap((d) => d.topicIds);

test('datas: somar dias, contar dias e o dia da semana, sem se perder com o horário de verão', () => {
  assert.equal(addDays('2026-10-23', 10), '2026-11-02');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-10-23', '2026-12-06'), 44);
  assert.equal(daysBetween('2026-12-06', '2026-10-23'), -44);
  assert.equal(daysBetween('2026-11-01', '2026-11-01'), 0);
  assert.equal(parseDay('2026-10-23').getDay(), 5, 'sexta');
  assert.equal(formatDay(parseDay('2026-02-09')), '2026-02-09');
  assert.throws(() => parseDay('23/10/2026'), /Dia inválido/);
  // atravessar a virada de horário (outubro/novembro e março/abril) nunca pula nem repete um dia
  for (const start of ['2026-10-15', '2026-11-01', '2026-03-10', '2026-04-01']) {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => addDays(start, i)));
    assert.equal(seen.size, 40, start);
  }
});

test('dias de revisão: a mesma conta da Meta (7 no fim, um terço se faltar pouco, tudo se faltarem 3 ou menos)', () => {
  assert.equal(reviewDaysFor(44), 7);
  assert.equal(reviewDaysFor(21), 7);
  assert.equal(reviewDaysFor(20), 6);
  assert.equal(reviewDaysFor(9), 3);
  assert.equal(reviewDaysFor(3), 3);
  assert.equal(reviewDaysFor(1), 1);
  assert.equal(reviewDaysFor(0), 0);
});

test('o esqueleto: de hoje ao dia antes da prova, a revisão no fim e a prova por último', () => {
  const { days, summary } = buildSchedule(input());
  assert.equal(days.length, 31, '30 dias até a prova + o dia da prova');
  assert.equal(days[0].date, TODAY);
  assert.equal(days[29].date, '2026-11-21');
  assert.deepEqual(days.at(-1), { date: '2026-11-22', weekday: 0, kind: 'exam', topicIds: [], minutes: 0 });
  assert.deepEqual(days.slice(0, 23).map((d) => d.kind), Array(23).fill('study'));
  assert.deepEqual(days.slice(23, 30).map((d) => d.kind), Array(7).fill('review'));
  assert.deepEqual([summary.daysLeft, summary.reviewPhaseDays, summary.reviewDays, summary.studyDays, summary.restDays], [30, 7, 7, 23, 0]);
  assert.ok(days.slice(23).every((d) => d.topicIds.length === 0), 'revisão e prova não têm tópicos novos');
});

test('dias da semana que o usuário não estuda viram descanso (inclusive na revisão), e não recebem tópicos', () => {
  const sundayOff = settings({ minutesPerDay: 60, minutesPerTopic: 30, weekdays: [1, 2, 3, 4, 5, 6] });
  const { days, summary } = buildSchedule(input({ settings: sundayOff }));
  const rest = days.filter((d) => d.kind === 'rest');
  assert.ok(rest.length > 0 && rest.every((d) => d.weekday === 0));
  assert.ok(rest.every((d) => d.topicIds.length === 0 && d.minutes === 0));
  assert.equal(summary.restDays, rest.length);
  assert.equal(summary.reviewPhaseDays, 7, 'a fase de revisão continua tendo 7 dias, mesmo com descansos dentro dela');
  assert.equal(summary.studyDays + summary.reviewDays + summary.restDays, 30, 'todo dia antes da prova é de um dos três tipos, sem contar duas vezes');
});

test('capacidade: 60 min por dia e 30 por tópico são 2 tópicos por dia; os minutos do dia conferem', () => {
  const { days, summary } = buildSchedule(input());
  const study = days.filter((d) => d.kind === 'study');
  // 24 pendentes a 2 por dia ocupam os 12 primeiros dias de estudo; os outros 11 ficam livres
  assert.deepEqual(study.map((d) => d.topicIds.length), [...Array(12).fill(2), ...Array(11).fill(0)]);
  assert.ok(study.slice(0, 12).every((d) => d.minutes === 60));
  assert.equal(summary.capacityTopics, 46, '23 dias × 2');
  assert.equal(summary.topicsScheduled, 24, 'só há 24 pendentes: cabem todos');
  assert.equal(summary.verdict, 'fits');
  assert.equal(summary.neededMinutesPerDay, null);
  assert.deepEqual(summary.leftOut, []);
});

test('capacidade fracionada: 40 min por dia e 30 por tópico dão 1, 1, 2, 1, 1, 2... (a sobra vai para o dia seguinte)', () => {
  const { days } = buildSchedule(input({ settings: settings({ minutesPerDay: 40, minutesPerTopic: 30 }), topics: topics('A', 60), disciplines: [{ id: 'A', points: 10 }] }));
  const counts = days.filter((d) => d.kind === 'study').slice(0, 9).map((d) => d.topicIds.length);
  assert.deepEqual(counts, [1, 1, 2, 1, 1, 2, 1, 1, 2]);
  const total = days.filter((d) => d.kind === 'study').reduce((sum, d) => sum + d.topicIds.length, 0);
  assert.equal(total, Math.floor((23 * 40) / 30), 'a soma é exatamente a capacidade (920 ÷ 30 = 30)');
});

test('ordem: cada disciplina na proporção da fatia dela, e dentro dela a ordem do edital', () => {
  const { days } = buildSchedule(input({ topics: [...topics('A', 10), ...topics('B', 10)] }));
  const order = ids(days);
  // A vale 50 e B vale 10: a cada 6 tópicos, 5 são de A e 1 é de B.
  const firstSix = order.slice(0, 6);
  assert.equal(firstSix.filter((t) => t.startsWith('A')).length, 5);
  assert.equal(firstSix.filter((t) => t.startsWith('B')).length, 1);
  // dentro de cada disciplina, a ordem do edital
  assert.deepEqual(order.filter((t) => t.startsWith('A')), topics('A', 10).map((t) => t.id));
  assert.deepEqual(order.filter((t) => t.startsWith('B')), topics('B', 10).map((t) => t.id));
});

test('uma disciplina pequena não fica para o fim: aparece logo no começo', () => {
  const { days } = buildSchedule(input({ topics: [...topics('A', 20), ...topics('B', 3)] }));
  const firstB = ids(days).findIndex((t) => t.startsWith('B'));
  assert.ok(firstB >= 0 && firstB < 8, `o primeiro tópico de B é o ${firstB + 1}º`);
});

test('os tópicos já feitos saem da fila e contam para a cota: o plano continua de onde parou', () => {
  const base = buildSchedule(input({ topics: [...topics('A', 10), ...topics('B', 10)] }));
  const doneB = buildSchedule(input({ topics: [...topics('A', 10), ...topics('B', 10, 3)] }));
  assert.ok(!ids(doneB.days).includes('B1') && !ids(doneB.days).includes('B3'), 'os feitos não voltam');
  assert.equal(doneB.summary.topicsDone, 3);
  assert.equal(doneB.summary.topicsPending, 17);
  // quem já fez 3 de B está adiantado nela: o próximo tópico de B demora mais a vir do que no plano sem nada feito
  const firstB = (s: typeof base) => ids(s.days).findIndex((t) => t.startsWith('B'));
  assert.ok(firstB(doneB) > firstB(base));
});

test('o que não cabe até a prova fica de fora, na ordem de prioridade, e o plano diz quanto tempo faria caber', () => {
  const { days, summary } = buildSchedule(input({ topics: [...topics('A', 60), ...topics('B', 20)], settings: settings({ minutesPerDay: 60, minutesPerTopic: 30 }) }));
  assert.equal(summary.capacityTopics, 46);
  assert.equal(summary.topicsScheduled, 46);
  assert.equal(summary.leftOut.length, 80 - 46);
  assert.equal(ids(days).length, 46);
  assert.equal(summary.verdict, 'overflow');
  // 80 tópicos × 30 min ÷ 23 dias = 104,3 → 105 min por dia
  assert.equal(summary.neededMinutesPerDay, 105);
  assert.equal(new Set([...ids(days), ...summary.leftOut]).size, 80, 'nenhum tópico se perde nem se repete');
  assert.equal(summary.finishDate, '2026-11-14', 'o último tópico cai no último dia de estudo');
  assert.equal(summary.freeStudyDays, 0);
});

test('com tempo de sobra: termina antes da prova e diz quantos dias de estudo ficam livres', () => {
  const { summary, days } = buildSchedule(input({ topics: topics('A', 10), disciplines: [{ id: 'A', points: 10 }] }));
  assert.equal(summary.verdict, 'fits');
  assert.equal(summary.finishDate, '2026-10-27', '10 tópicos a 2 por dia: 5 dias');
  assert.equal(summary.freeStudyDays, 23 - 5);
  assert.equal(days.filter((d) => d.kind === 'study' && d.topicIds.length === 0).length, 18);
});

test('tudo feito: não há o que agendar', () => {
  const { summary, days } = buildSchedule(input({ topics: topics('A', 5, 5) }));
  assert.equal(summary.verdict, 'nothing_left');
  assert.deepEqual([summary.topicsPending, summary.topicsScheduled, summary.finishDate], [0, 0, null]);
  assert.equal(ids(days).length, 0);
});

test('sem dias de estudo (prova amanhã, ou ninguém estuda em nenhum dia da semana que sobrou): sem tempo', () => {
  const tomorrow = buildSchedule(input({ examDate: addDays(TODAY, 1) }));
  assert.equal(tomorrow.summary.verdict, 'no_time');
  assert.deepEqual(tomorrow.days.map((d) => d.kind), ['review', 'exam']);
  assert.equal(tomorrow.summary.neededMinutesPerDay, null);

  const onlyMonday = buildSchedule(input({ examDate: addDays(TODAY, 2), settings: settings({ weekdays: [1] }) }));
  assert.equal(onlyMonday.summary.verdict, 'no_time');
});

test('prova hoje ou já passada: só o dia da prova, sem tópicos', () => {
  const today = buildSchedule(input({ examDate: TODAY }));
  assert.deepEqual(today.days.map((d) => d.kind), ['exam']);
  assert.equal(today.summary.daysLeft, 0);
  assert.equal(today.summary.verdict, 'no_time');
  const past = buildSchedule(input({ examDate: addDays(TODAY, -5) }));
  assert.equal(past.summary.daysLeft, 0);
  assert.ok(past.days.every((d) => d.topicIds.length === 0));
});

test('prova a mais de 400 dias: o plano cobre só a janela de 400 dias e não inventa dia de revisão nem de prova', () => {
  const { days, summary } = buildSchedule(input({ examDate: addDays(TODAY, 900) }));
  assert.equal(days.length, MAX_SCHEDULE_DAYS);
  assert.ok(days.every((d) => d.kind !== 'exam' && d.kind !== 'review'));
  assert.equal(summary.daysLeft, 900);
  assert.equal(summary.reviewDays, 0);
});

test('disciplina sem pontos ou fora da prova: os tópicos dela vão ao fim, e nenhum se perde', () => {
  const { days, summary } = buildSchedule(
    input({ disciplines: [{ id: 'A', points: 50 }], topics: [...topics('A', 6), ...topics('Z', 3)] }),
  );
  const order = [...ids(days), ...summary.leftOut];
  assert.deepEqual(order.slice(-3), ['Z1', 'Z2', 'Z3']);
  assert.equal(order.length, 9);
});

test('é determinístico: o mesmo pedido dá o mesmo plano, e a entrada não é alterada', () => {
  const given = input({ topics: [...topics('A', 15, 2), ...topics('B', 6, 1)] });
  const snapshot = JSON.stringify(given);
  const first = buildSchedule(given);
  assert.deepEqual(buildSchedule(given), first);
  assert.equal(JSON.stringify(given), snapshot);
});

test('os números do seu caso: 44 dias, 148 tópicos de três disciplinas, 40 min por dia e 30 por tópico', () => {
  const real = input({
    examDate: '2026-12-06',
    settings: settings({ minutesPerDay: 40, minutesPerTopic: 30 }),
    disciplines: [
      { id: 'E', points: 50 },
      { id: 'P', points: 10 },
      { id: 'I', points: 10 },
    ],
    topics: [...topics('E', 134), ...topics('P', 12), ...topics('I', 2)],
  });
  const { summary, days } = buildSchedule(real);
  assert.deepEqual([summary.daysLeft, summary.reviewDays, summary.studyDays], [44, 7, 37]);
  assert.equal(summary.capacityTopics, Math.floor((37 * 40) / 30));
  assert.equal(summary.verdict, 'overflow');
  assert.equal(summary.neededMinutesPerDay, 120, '148 × 30 ÷ 37 = 120 min por dia');
  assert.equal(summary.topicsScheduled + summary.leftOut.length, 148);
  const scheduled = ids(days);
  assert.ok(scheduled.includes('I1') && scheduled.includes('P1'), 'as disciplinas pequenas entram cedo');
});
