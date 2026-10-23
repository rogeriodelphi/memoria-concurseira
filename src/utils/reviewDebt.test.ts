import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReviewDebt } from '../types';
import { batchLabel, clearText, DEBT_TONE, debtHeadline, lateBreakdown, limitHint, oldestText, weekText } from './reviewDebt';

const debt = (over: Partial<ReviewDebt> = {}): ReviewDebt => ({
  overdue: 393,
  lateBy: { upTo3: 52, upTo7: 129, upTo14: 167, over14: 45 },
  oldestDays: 36,
  week: { days: 7, reviews: 191, newCards: 149, oldCards: 42 },
  oldPerDay: 6,
  newSharePct: 78,
  daysToClear: 66,
  level: 'high',
  batch: 25,
  dailyNewLimit: 30,
  ...over,
});

test('cor pelo nível: verde, âmbar e vermelho', () => {
  assert.deepEqual([DEBT_TONE.ok, DEBT_TONE.attention, DEBT_TONE.high], ['green', 'amber', 'red']);
});

test('manchete e o mais antigo, no singular e no plural', () => {
  assert.equal(debtHeadline(393), '393 cartões atrasados');
  assert.equal(debtHeadline(1), '1 cartão atrasado');
  assert.equal(oldestText(36), 'O mais antigo está atrasado há 36 dias.');
  assert.equal(oldestText(1), 'O mais antigo está atrasado há 1 dia.');
  assert.equal(oldestText(null), null);
});

test('lateBreakdown: as faixas de atraso, sem as vazias', () => {
  assert.deepEqual(lateBreakdown(debt().lateBy), [
    { label: '1 a 3 dias', count: 52 },
    { label: '4 a 7 dias', count: 129 },
    { label: '8 a 14 dias', count: 167 },
    { label: 'mais de 14 dias', count: 45 },
  ]);
  assert.deepEqual(lateBreakdown({ upTo3: 2, upTo7: 0, upTo14: 0, over14: 1 }).map((b) => b.label), ['1 a 3 dias', 'mais de 14 dias']);
});

test('weekText: o que a semana foi, novo × já estudado', () => {
  assert.equal(
    weekText(debt()),
    'Na última semana você fez 191 revisões: 149 de cartões novos (78%) e 42 de cartões já estudados (6 por dia).',
  );
  assert.match(weekText(debt({ week: { days: 7, reviews: 1, newCards: 1, oldCards: 0 }, newSharePct: 100, oldPerDay: 0 })), /1 revisão: 1 de cartão novo \(100%\) e 0 de cartões já estudados \(0 por dia\)/);
  assert.match(weekText(debt({ oldPerDay: 0.9 })), /\(0,9 por dia\)/);
  assert.equal(weekText(debt({ week: { days: 7, reviews: 0, newCards: 0, oldCards: 0 }, newSharePct: null })), 'Você não fez nenhuma revisão na última semana.');
});

test('clearText: quanto levaria, ou por que só cresce', () => {
  assert.equal(clearText(debt()), 'Nesse ritmo, zerar só o que já está atrasado levaria cerca de 66 dias, e todo dia chegam mais.');
  assert.equal(clearText(debt({ daysToClear: null })), 'Sem revisão de cartões já estudados na última semana, o atrasado só cresce.');
  assert.equal(clearText(debt({ daysToClear: null, week: { days: 7, reviews: 0, newCards: 0, oldCards: 0 } })), 'Sem revisões, o atrasado só cresce.');
  assert.equal(clearText(debt({ overdue: 0, daysToClear: null })), '');
});

test('limitHint: só com a dívida em atenção e a semana feita sobretudo de cartões novos', () => {
  assert.match(limitHint(debt())!, /baixar o limite diário de novos \(hoje 30, em Configurações → Plano de estudo\)/);
  assert.match(limitHint(debt({ dailyNewLimit: null }))!, /Sem limite diário, todos os cartões novos entram na fila/);
  assert.equal(limitHint(debt({ level: 'ok' })), null, 'dívida pequena: nada a sugerir');
  assert.equal(limitHint(debt({ newSharePct: 59 })), null, 'a semana não foi só de novos');
  assert.equal(limitHint(debt({ newSharePct: null })), null);
  assert.ok(limitHint(debt({ level: 'attention', newSharePct: 60 })));
});

test('batchLabel: o botão diz quantos atrasados a sessão traz', () => {
  assert.equal(batchLabel(25), 'Pôr em dia: os 25 atrasados mais antigos');
  assert.equal(batchLabel(1), 'Pôr em dia: o atrasado mais antigo');
});
