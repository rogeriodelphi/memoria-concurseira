import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_DAILY_NEW_LIMIT, newCardsForToday, parseDailyNewLimit } from './limit';

const value = (raw: unknown) => {
  const result = parseDailyNewLimit(raw);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
};
const refused = (raw: unknown) => assert.equal(parseDailyNewLimit(raw).ok, false, JSON.stringify(raw));

test('limite: vazio, nulo e indefinido significam "sem limite"', () => {
  assert.equal(value(null), null);
  assert.equal(value(undefined), null);
  assert.equal(value(''), null);
});

test('limite: aceita inteiros de 0 a 1000, também escritos como texto', () => {
  assert.equal(value(0), 0, 'zero é um limite válido: nenhum cartão novo');
  assert.equal(value(20), 20);
  assert.equal(value('35'), 35);
  assert.equal(value(MAX_DAILY_NEW_LIMIT), MAX_DAILY_NEW_LIMIT);
});

test('limite: recusa negativo, quebrado, grande demais e lixo, em vez de arredondar', () => {
  for (const raw of [-1, 1.5, '2.5', MAX_DAILY_NEW_LIMIT + 1, 'vinte', NaN, Infinity, true, {}, [], '  ']) refused(raw);
});

test('novos de hoje: o limite menos o que já foi aprendido hoje', () => {
  assert.equal(newCardsForToday(953, 20, 0), 20);
  assert.equal(newCardsForToday(953, 20, 5), 15);
  assert.equal(newCardsForToday(953, 20, 20), 0, 'meta de novos cumprida');
  assert.equal(newCardsForToday(953, 20, 35), 0, 'passou do limite (estudou por conta própria): nunca negativo');
});

test('novos de hoje: nunca mais do que os que existem', () => {
  assert.equal(newCardsForToday(8, 20, 0), 8);
  assert.equal(newCardsForToday(0, 20, 0), 0);
});

test('novos de hoje: sem limite, todos; limite zero, nenhum', () => {
  assert.equal(newCardsForToday(953, null, 0), 953);
  assert.equal(newCardsForToday(953, null, 400), 953, 'sem limite, o que já foi estudado hoje não muda nada');
  assert.equal(newCardsForToday(953, 0, 0), 0);
});
