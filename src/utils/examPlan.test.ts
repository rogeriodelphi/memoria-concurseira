import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExamPlan, PlanScenario, PlanVerdict } from '../types';
import { cardsPerDayLabel, chartBars, formatMinutes, scenarioLabel, scenarioSummary, verdictMessage, VERDICT_LABEL } from './examPlan';

const scenario = (extra: Partial<PlanScenario> = {}): PlanScenario => ({
  kind: 'budget',
  newPerDay: 8,
  cardsPerDay: 45,
  minutesPerDay: 31,
  newSeen: 344,
  coveragePct: 38,
  perDay: [],
  ...extra,
});

function plan(verdict: PlanVerdict, extra: Partial<ExamPlan> = {}): ExamPlan {
  return {
    exam: { id: 'e', name: 'Concurso', examDate: '2026-12-06', daysLeft: 50 },
    verdict,
    finalReviewDays: 7,
    newDays: 43,
    cards: { new: 912, due: 286, learned: 339 },
    currentLimit: null,
    pace: { windowDays: 14, reviewsPerDay: 22.9, newPerDay: 20, activeDays: 9, secPerReview: 36 },
    neededNewPerDay: 22,
    scenarios: [scenario({ kind: 'current', newPerDay: 1, coveragePct: 5, newSeen: 43 })],
    ...extra,
  };
}

test('tempo: minutos até uma hora, e depois horas e minutos', () => {
  assert.equal(formatMinutes(0), '0 min');
  assert.equal(formatMinutes(45.4), '45 min');
  assert.equal(formatMinutes(59.6), '1 h');
  assert.equal(formatMinutes(60), '1 h');
  assert.equal(formatMinutes(61), '1 h 01');
  assert.equal(formatMinutes(90), '1 h 30');
  assert.equal(formatMinutes(-5), '0 min');
});

test('veredito: cada um tem rótulo e cor, e a mensagem cita os números certos', () => {
  for (const verdict of Object.keys(VERDICT_LABEL) as PlanVerdict[]) {
    assert.ok(VERDICT_LABEL[verdict].label.length > 0);
    assert.ok(verdictMessage(plan(verdict)).length > 20, verdict);
  }
  assert.equal(VERDICT_LABEL.behind.tone, 'red');
  assert.equal(VERDICT_LABEL.on_track.tone, 'green');

  const behind = verdictMessage(plan('behind'));
  assert.match(behind, /cerca de 23 cartões por dia/);
  assert.match(behind, /5%/);
  assert.match(behind, /912/);
  assert.match(verdictMessage(plan('tight', { scenarios: [scenario({ kind: 'current', coveragePct: 87 })] })), /87%/);
  assert.match(verdictMessage(plan('no_pace')), /14 dias/);
});

test('veredito "atrasado": com cobertura zero diz "nenhum", e o plural acompanha o ritmo', () => {
  const none = verdictMessage(plan('behind', { scenarios: [scenario({ kind: 'current', coveragePct: 0, newSeen: 0 })] }));
  assert.match(none, /não conseguiria ver nenhum dos 912 cartões novos/);
  assert.doesNotMatch(none, /0%/);

  const slow = plan('behind', { pace: { windowDays: 14, reviewsPerDay: 1.2, newPerDay: 1, activeDays: 2, secPerReview: 30 } });
  assert.match(verdictMessage(slow), /cerca de 1 cartão por dia/);
});

test('cartões por dia: arredonda e usa o singular', () => {
  assert.equal(cardsPerDayLabel(1), '1 cartão/dia');
  assert.equal(cardsPerDayLabel(1.4), '1 cartão/dia');
  assert.equal(cardsPerDayLabel(22.9), '23 cartões/dia');
  assert.equal(cardsPerDayLabel(0), '0 cartões/dia');
  assert.equal(cardsPerDayLabel(1500), '1.500 cartões/dia');
});

test('veredito "no ritmo" muda o texto quando não há mais cartões novos', () => {
  assert.match(verdictMessage(plan('on_track')), /todos os cartões novos/);
  assert.match(verdictMessage(plan('on_track', { cards: { new: 0, due: 0, learned: 10 } })), /já foram vistos/);
});

test('cenários: nome e resumo', () => {
  assert.equal(scenarioLabel(scenario({ kind: 'current' }), 912), 'No seu ritmo atual');
  assert.equal(scenarioLabel(scenario({ kind: 'all' }), 912), 'Ver todos os cartões novos');
  assert.equal(scenarioLabel(scenario({ kind: 'all' }), 0), 'Só as revisões');
  assert.equal(scenarioLabel(scenario({ kind: 'budget', minutesPerDay: 31 }), 912), 'Cerca de 31 min por dia');
  assert.equal(scenarioLabel(scenario({ kind: 'budget', minutesPerDay: 61 }), 912), 'Cerca de 1 h 01 por dia');

  assert.equal(scenarioSummary(scenario(), 912), '8 novos por dia · cobre 38% (344 de 912)');
  assert.equal(scenarioSummary(scenario({ newPerDay: 1, newSeen: 43, coveragePct: 5 }), 912), '1 novo por dia · cobre 5% (43 de 912)');
  assert.equal(scenarioSummary(scenario(), 0), 'sem cartões novos');
});

test('gráfico: poucas barras ficam como estão; muitas são agrupadas pela média', () => {
  assert.deepEqual(chartBars([1, 2, 3], 60), [1, 2, 3]);
  const many = Array.from({ length: 200 }, (_, i) => (i < 100 ? 10 : 30));
  const bars = chartBars(many, 50);
  assert.ok(bars.length <= 50);
  assert.equal(bars[0], 10);
  assert.equal(bars.at(-1), 30);
  assert.deepEqual(chartBars([], 60), []);
  const original = [5, 6, 7];
  chartBars(original, 1);
  assert.deepEqual(original, [5, 6, 7], 'não altera o que recebeu');
});
