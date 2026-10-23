import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScheduleDay, ScheduleSettings, ScheduleSummary, ScheduleTopic } from '../types';
import {
  dayNote,
  dayTitle,
  groupWeeks,
  headline,
  leftOutByDiscipline,
  minutesPerTopicToFit,
  settingsChanged,
  settingsError,
  shortDate,
  topicsPerDayText,
  wholeNumber,
} from './schedule';

// 23/10/2026 é sexta-feira.
const TODAY = '2026-10-23';
const day = (date: string, weekday: number, kind: ScheduleDay['kind'] = 'study', topicIds: string[] = []): ScheduleDay => ({ date, weekday, kind, topicIds, minutes: topicIds.length * 30 });
const settings = (over: Partial<ScheduleSettings> = {}): ScheduleSettings => ({ minutesPerDay: 60, minutesPerTopic: 30, weekdays: [0, 1, 2, 3, 4, 5, 6], ...over });
const summary = (over: Partial<ScheduleSummary> = {}): ScheduleSummary => ({
  daysLeft: 44,
  reviewPhaseDays: 7,
  studyDays: 37,
  reviewDays: 7,
  restDays: 0,
  topicsTotal: 148,
  topicsDone: 0,
  topicsPending: 148,
  topicsScheduled: 148,
  capacityTopics: 148,
  leftOut: [],
  neededMinutesPerDay: null,
  finishDate: '2026-11-20',
  freeStudyDays: 0,
  verdict: 'fits',
  ...over,
});

test('shortDate: dia e mês', () => {
  assert.equal(shortDate('2026-10-23'), '23/10');
  assert.equal(shortDate('2027-01-05'), '05/01');
});

test('dayTitle: hoje, amanhã, os outros dias e o da prova', () => {
  assert.equal(dayTitle(day('2026-10-23', 5), TODAY), 'Hoje · sex 23/10');
  assert.equal(dayTitle(day('2026-10-24', 6), TODAY), 'Amanhã · sáb 24/10');
  assert.equal(dayTitle(day('2026-10-25', 0), TODAY), 'dom 25/10');
  assert.equal(dayTitle(day('2026-12-06', 0, 'exam'), TODAY), 'Dia da prova · dom 06/12');
});

test('dayNote: o que um dia sem tópicos diz de si', () => {
  assert.equal(dayNote(day('2026-10-24', 6, 'rest')), 'Descanso');
  assert.equal(dayNote(day('2026-12-01', 2, 'review')), 'Revisão: sem tópicos novos');
  assert.equal(dayNote(day('2026-12-06', 0, 'exam')), 'Boa prova!');
  assert.equal(dayNote(day('2026-11-20', 5, 'study')), 'Livre: revise os cartões');
  assert.equal(dayNote(day('2026-11-20', 5, 'study', ['t1'])), '');
});

test('topicsPerDayText: a média de tópicos por dia, no singular e no plural', () => {
  assert.equal(topicsPerDayText({ minutesPerDay: 40, minutesPerTopic: 30 }), '1,3 tópicos por dia, em média');
  assert.equal(topicsPerDayText({ minutesPerDay: 60, minutesPerTopic: 30 }), '2 tópicos por dia, em média');
  assert.equal(topicsPerDayText({ minutesPerDay: 30, minutesPerTopic: 30 }), '1 tópico por dia, em média');
});

test('groupWeeks: semanas de segunda a domingo, a de hoje chamada "Esta semana", e a contagem de tópicos', () => {
  const days = [
    day('2026-10-23', 5, 'study', ['a', 'b']),
    day('2026-10-24', 6, 'study', ['c']),
    day('2026-10-25', 0, 'rest'),
    day('2026-10-26', 1, 'study', ['d']),
    day('2026-10-27', 2, 'study', ['e', 'f']),
  ];
  const weeks = groupWeeks(days, TODAY);
  assert.deepEqual(weeks.map((w) => [w.key, w.label, w.days.length, w.topics]), [
    ['2026-10-19', 'Esta semana', 3, 3],
    ['2026-10-26', 'Semana de 26/10 a 01/11', 2, 3],
  ]);
  assert.deepEqual(groupWeeks([], TODAY), []);
});

test('groupWeeks: a virada de mês e de ano e o horário de verão não bagunçam as semanas', () => {
  const dates = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04'];
  const weekdays = [1, 2, 3, 4, 5, 6, 0, 1];
  const weeks = groupWeeks(dates.map((d, i) => day(d, weekdays[i])), '2026-12-28');
  assert.deepEqual(weeks.map((w) => [w.label, w.days.length]), [['Esta semana', 7], ['Semana de 04/01 a 10/01', 1]]);
});

test('headline: cabe, com folga ou no último dia', () => {
  const some = headline({ summary: summary({ topicsPending: 20, finishDate: '2026-11-10', freeStudyDays: 8 }), settings: settings() });
  assert.equal(some.tone, 'green');
  assert.match(some.message, /Os 20 tópicos pendentes terminam em 10\/11; ainda sobram 8 dias de estudo antes da revisão final/);
  const tight = headline({ summary: summary({ topicsPending: 1, finishDate: '2026-11-20', freeStudyDays: 1 }), settings: settings() });
  assert.equal(tight.message, 'O tópico pendente termina em 20/11; ainda sobra 1 dia de estudo antes da revisão final.');
  const last = headline({ summary: summary({ freeStudyDays: 0 }), settings: settings() });
  assert.match(last.message, /no último dia de estudo antes da revisão final/);
});

test('headline: não cabe, com o tempo que faria caber (por dia, e por tópico quando dá)', () => {
  const over = summary({ topicsPending: 148, topicsScheduled: 49, leftOut: Array.from({ length: 99 }, (_, i) => `t${i}`), neededMinutesPerDay: 120, verdict: 'overflow', studyDays: 37 });
  const text = headline({ summary: over, settings: settings({ minutesPerDay: 40, minutesPerTopic: 30 }) });
  assert.equal(text.tone, 'red');
  assert.equal(text.title, 'Não cabe tudo até a prova');
  assert.match(text.message, /Com 40 min por dia cabem 49 dos 148 tópicos pendentes; 99 ficam de fora/);
  assert.match(text.message, /cerca de 120 min por dia ou 10 min por tópico \(mantendo 40 min por dia\)/);
  // sem opção por tópico (nem com o mínimo cabe), só o tempo por dia
  const hopeless = headline({ summary: { ...over, studyDays: 5 }, settings: settings({ minutesPerDay: 40, minutesPerTopic: 30 }) });
  assert.doesNotMatch(hopeless.message, /por tópico/);
});

test('headline: tudo feito e sem tempo', () => {
  const done = headline({ summary: summary({ verdict: 'nothing_left', topicsTotal: 12 }), settings: settings() });
  assert.equal(done.tone, 'green');
  assert.match(done.message, /os 12 tópicos do edital/);
  const none = headline({ summary: summary({ verdict: 'no_time' }), settings: settings() });
  assert.equal(none.tone, 'amber');
  assert.match(none.message, /Reta final/);
});

test('minutesPerTopicToFit: arredonda para baixo de 5 em 5, não passa de quem já cabe nem do mínimo de 10', () => {
  const base = { studyDays: 37, topicsPending: 148, leftOut: ['x'] };
  assert.equal(minutesPerTopicToFit(base, settings({ minutesPerDay: 40, minutesPerTopic: 30 })), 10, '37 × 40 ÷ 148 = 10');
  assert.equal(minutesPerTopicToFit({ ...base, studyDays: 30, topicsPending: 100 }, settings({ minutesPerDay: 60, minutesPerTopic: 30 })), 15, '18 → 15');
  assert.equal(minutesPerTopicToFit({ ...base, studyDays: 5 }, settings({ minutesPerDay: 40, minutesPerTopic: 30 })), null, 'nem com 10 caberia');
  assert.equal(minutesPerTopicToFit({ ...base, leftOut: [] }, settings()), null, 'já cabe');
  assert.equal(minutesPerTopicToFit({ ...base, topicsPending: 0 }, settings()), null);
  assert.equal(minutesPerTopicToFit({ ...base, studyDays: 0 }, settings()), null);
});

test('leftOutByDiscipline: contagem por disciplina na ordem da prova, só das que perderam tópicos', () => {
  const topic = (id: string, disciplineId: string): ScheduleTopic => ({ id, title: id, disciplineId, done: false, cards: 0, seenPct: null, collectionIds: [] });
  const topics = [topic('e1', 'E'), topic('e2', 'E'), topic('p1', 'P'), topic('i1', 'I')];
  const disciplines = [
    { id: 'E', name: 'Específicos', sharePct: 70, topics: 2, done: 0 },
    { id: 'P', name: 'Português', sharePct: 15, topics: 1, done: 0 },
    { id: 'I', name: 'Inglês', sharePct: 15, topics: 1, done: 0 },
  ];
  assert.deepEqual(leftOutByDiscipline(['p1', 'e1', 'e2', 'desconhecido'], topics, disciplines), [
    { id: 'E', name: 'Específicos', count: 2 },
    { id: 'P', name: 'Português', count: 1 },
  ]);
  assert.deepEqual(leftOutByDiscipline([], topics, disciplines), []);
});

test('settingsError: as mesmas regras do servidor, com a mensagem do problema', () => {
  assert.equal(settingsError(settings()), null);
  assert.match(settingsError(settings({ minutesPerDay: 5 }))!, /tempo por dia/);
  assert.match(settingsError(settings({ minutesPerDay: 500 }))!, /tempo por dia/);
  assert.match(settingsError(settings({ minutesPerDay: Number.NaN }))!, /tempo por dia/);
  assert.match(settingsError(settings({ minutesPerTopic: 9 }))!, /tempo por tópico/);
  assert.match(settingsError(settings({ minutesPerTopic: 121, minutesPerDay: 480 }))!, /tempo por tópico/);
  assert.match(settingsError(settings({ minutesPerDay: 30, minutesPerTopic: 45 }))!, /caber em um dia/);
  assert.match(settingsError(settings({ weekdays: [] }))!, /ao menos um dia/);
});

test('settingsChanged: ignora a ordem dos dias e acende com qualquer mudança real', () => {
  assert.equal(settingsChanged(settings({ weekdays: [1, 2, 3] }), settings({ weekdays: [3, 2, 1] })), false);
  assert.equal(settingsChanged(settings(), settings({ minutesPerDay: 90 })), true);
  assert.equal(settingsChanged(settings(), settings({ minutesPerTopic: 20 })), true);
  assert.equal(settingsChanged(settings(), settings({ weekdays: [1, 2] })), true);
});

test('wholeNumber: só dígitos valem; o resto vira NaN', () => {
  assert.equal(wholeNumber(' 45 '), 45);
  for (const bad of ['', '4,5', '4.5', '-3', 'abc', '1e2']) assert.ok(Number.isNaN(wholeNumber(bad)), bad);
});
