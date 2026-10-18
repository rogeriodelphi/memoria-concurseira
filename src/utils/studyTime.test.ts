import assert from 'node:assert/strict';
import test from 'node:test';

import type { StudyTimeDisciplineRow } from '../types';
import { balanceOf, BALANCE_LABEL, formatDuration, headline, insights, isPriority, MIN_TOTAL_SEC, stackShares, timeSharePct } from './studyTime';

const row = (label: string, totalSec: number, weightPct: number | null, accuracyPct: number | null = null): StudyTimeDisciplineRow => ({
  key: label,
  label,
  pomodoroSec: 0,
  cardSec: totalSec,
  totalSec,
  tasks: 0,
  reviews: 10,
  accuracyPct,
  subjects: [],
  disciplineId: weightPct === null ? null : label,
  questions: null,
  weight: null,
  weightPct,
});

test('duração: minutos, horas e o que é menos de um minuto', () => {
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(20), '<1 min');
  assert.equal(formatDuration(29), '<1 min');
  assert.equal(formatDuration(30), '1 min', 'arredonda para o minuto mais próximo');
  assert.equal(formatDuration(45 * 60), '45 min');
  assert.equal(formatDuration(59 * 60 + 29), '59 min');
  assert.equal(formatDuration(3600), '1 h');
  assert.equal(formatDuration(7500), '2 h 05');
  assert.equal(formatDuration(36_000), '10 h');
  assert.equal(formatDuration(-50), '0 min');
});

test('fatia do tempo', () => {
  assert.equal(timeSharePct(30, 120), 25);
  assert.equal(timeSharePct(0, 100), 0);
  assert.equal(timeSharePct(5, 0), 0);
});

test('equilíbrio: pouco tempo para o peso, tempo de sobra, ou equilibrado', () => {
  const total = 10 * 3600;
  assert.equal(balanceOf(5, 60, total), 'low', '5% do tempo para 60% da prova');
  assert.equal(balanceOf(41, 60, total), 'low', '41 é menos que 70% de 60 (42) e a diferença passa de 5 pontos');
  assert.equal(balanceOf(42, 60, total), 'balanced');
  assert.equal(balanceOf(60, 60, total), 'balanced');
  assert.equal(balanceOf(77, 60, total), 'balanced', '77 é 128% do peso');
  assert.equal(balanceOf(79, 60, total), 'high');
  assert.equal(balanceOf(1, 3, total), 'balanced', 'diferença de 2 pontos: não é um problema');
  assert.equal(balanceOf(10, 14, total), 'balanced', '10 está abaixo de 70% de 14 (9,8)? não: 10 é maior');
  assert.equal(balanceOf(9, 14, total), 'low', '9 < 9,8 e a diferença é de 5 pontos');
  assert.equal(balanceOf(30, 20, total), 'high', '30% contra 20%: 150% e 10 pontos a mais');
  assert.equal(balanceOf(26, 20, total), 'balanced', 'exatamente 130%: não passa');
  assert.equal(balanceOf(25, 20, total), 'balanced', '125% e só 5 pontos');
  assert.equal(balanceOf(27, 20, total), 'high', '135% e 7 pontos');
});

test('equilíbrio: sem peso, sem peso positivo ou com pouco tempo no total, não se opina', () => {
  assert.equal(balanceOf(50, null, 10 * 3600), 'unknown');
  assert.equal(balanceOf(50, 0, 10 * 3600), 'unknown');
  assert.equal(balanceOf(0, 60, MIN_TOTAL_SEC - 1), 'unknown');
  assert.equal(balanceOf(0, 60, MIN_TOTAL_SEC), 'low');
  assert.deepEqual(Object.keys(BALANCE_LABEL).sort(), ['balanced', 'high', 'low']);
});

test('prioridade: pouco tempo e acerto baixo', () => {
  assert.equal(isPriority('low', 69), true);
  assert.equal(isPriority('low', 70), false);
  assert.equal(isPriority('low', null), false, 'sem cartões estudados não há acerto');
  assert.equal(isPriority('balanced', 10), false);
  assert.equal(isPriority('high', 10), false);
  assert.equal(isPriority('unknown', 10), false);
});

test('leitura das disciplinas: fatia, equilíbrio, prioridade e a diferença em tempo para ter o do peso', () => {
  const total = 10 * 3600; // 10 h
  const rows = [row('Específicos', 8 * 3600, 60, 85), row('Português', 3600, 30, 55), row('Inglês', 3600, 10, 90), row('Fora', 0, null)];
  const [esp, por, ing, fora] = insights(rows, total);
  assert.deepEqual([esp.timePct, esp.balance, esp.priority], [80, 'high', false]);
  assert.deepEqual([por.timePct, por.balance, por.priority], [10, 'low', true]);
  assert.equal(por.gapSec, 2 * 3600, 'Português devia ter 30% de 10 h = 3 h, tem 1 h: faltam 2 h');
  assert.equal(esp.gapSec, -2 * 3600, 'Específicos devia ter 6 h e tem 8 h: 2 h a mais');
  assert.deepEqual([ing.timePct, ing.balance], [10, 'balanced']);
  assert.deepEqual([fora.balance, fora.gapSec], ['unknown', 0]);
});

test('frase do topo: a prioridade primeiro, depois só o pouco tempo, depois o equilibrado; ou nada', () => {
  const total = 10 * 3600;
  const withPriority = insights([row('Específicos', 7 * 3600, 50, 85), row('Português', 1800, 30, 55), row('Inglês', 1800, 20, 90)], total);
  assert.match(headline(withPriority)!, /Português pesa 30% da prova e levou 5% do seu tempo, com 55% de acerto: é onde mais falta/);

  const onlyLow = insights([row('Específicos', 8 * 3600, 50, 85), row('Português', 3600, 30, 80), row('Inglês', 3600, 20, 90)], total);
  assert.match(headline(onlyLow)!, /Português pesa 30% da prova e levou 10% do seu tempo\.$/);

  const balanced = insights([row('A', 5 * 3600, 50, 80), row('B', 5 * 3600, 50, 80)], total);
  assert.equal(headline(balanced), 'O seu tempo está bem repartido em relação ao peso das disciplinas.');

  assert.equal(headline(insights([row('A', 100, 50, 80)], 100)), null, 'pouco tempo no total: nada a dizer');
  assert.equal(headline([]), null);
  // "fora do edital" nunca é prioridade
  const outside = insights([row('Fora', 9 * 3600, null, 10), row('Português', 3600, 100, 80)], total);
  assert.equal(outside.find((i) => i.row.label === 'Fora')!.priority, false);
});

test('maior prioridade: a que mais falta em tempo', () => {
  const total = 10 * 3600;
  const items = insights([row('Pequena', 1800, 20, 50), row('Grande', 1800, 50, 50), row('Resto', 6 * 3600 + 1800, 30, 90)], total);
  assert.match(headline(items)!, /^Grande pesa/);
});

test('barra empilhada: a parte do Pomodoro e a dos cartões', () => {
  assert.deepEqual(stackShares({ pomodoroSec: 300, cardSec: 100 }), { pomodoro: 75, cards: 25 });
  assert.deepEqual(stackShares({ pomodoroSec: 0, cardSec: 0 }), { pomodoro: 0, cards: 0 });
  assert.deepEqual(stackShares({ pomodoroSec: 0, cardSec: 50 }), { pomodoro: 0, cards: 100 });
});
