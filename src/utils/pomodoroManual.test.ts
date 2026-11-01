import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDateKey, formatMinutes, localDateKey, MAX_MINUTES, rangeIncluding, totalMinutes } from './pomodoroManual';

test('horas e minutos viram minutos no total; campo vazio vale zero', () => {
  assert.equal(totalMinutes('1', '30'), 90);
  assert.equal(totalMinutes('2', ''), 120);
  assert.equal(totalMinutes('', '45'), 45);
  assert.equal(totalMinutes(' 0 ', ' 5 '), 5);
  assert.equal(totalMinutes('0', '90'), 90, 'passar de 59 minutos é aceito: 1h30 digitado como 90 min');
  assert.equal(totalMinutes('24', '0'), MAX_MINUTES);
});

test('sem tempo nenhum, com texto, negativo, decimal ou acima de 24 horas, não é um tempo válido', () => {
  for (const [h, m] of [['', ''], ['0', '0'], ['0', ''], ['abc', '10'], ['1', 'x'], ['-1', '30'], ['1', '-5'], ['1,5', '0'], ['1.5', '0'], ['24', '1'], ['25', '0'], ['0', '1441'], ['99999', '0']]) {
    assert.equal(totalMinutes(h, m), null, `${h} h ${m} min`);
  }
});

test('o dia local é o do relógio do usuário, e não o do UTC', () => {
  // 23h30 de 30/10 no horário local: o dia local é 30, mesmo que o UTC já esteja no 31.
  assert.equal(localDateKey(new Date(2026, 9, 30, 23, 30)), '2026-10-30');
  assert.equal(localDateKey(new Date(2026, 0, 5, 0, 5)), '2026-01-05');
  assert.match(localDateKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('o período só cresce o necessário para conter a data lançada', () => {
  const range = { from: '2026-10-01', to: '2026-10-30' };
  assert.deepEqual(rangeIncluding(range, '2026-10-15'), range, 'dentro do período: nada muda');
  assert.deepEqual(rangeIncluding(range, '2026-10-01'), range, 'no limite de baixo');
  assert.deepEqual(rangeIncluding(range, '2026-10-30'), range, 'no limite de cima');
  assert.deepEqual(rangeIncluding(range, '2026-09-20'), { from: '2026-09-20', to: '2026-10-30' });
  assert.deepEqual(rangeIncluding(range, '2026-11-02'), { from: '2026-10-01', to: '2026-11-02' });
});

test('a data para exibir: dia/mês/ano', () => {
  assert.equal(formatDateKey('2026-10-25'), '25/10/2026');
});

test('o tempo para exibir: horas e minutos, sem "0min" sobrando', () => {
  assert.equal(formatMinutes(90), '1h 30min');
  assert.equal(formatMinutes(60), '1h');
  assert.equal(formatMinutes(45), '45min');
  assert.equal(formatMinutes(1), '1min');
  assert.equal(formatMinutes(MAX_MINUTES), '24h');
});
