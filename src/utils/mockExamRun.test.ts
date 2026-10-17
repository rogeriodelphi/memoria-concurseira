import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerCurrent,
  currentCard,
  formatDuration,
  isFinished,
  percentage,
  runResult,
  startRun,
  undoAnswer,
} from './mockExamRun';

const cards = (...ids: string[]) => ids.map((id) => ({ id }));

test('a prova começa no primeiro cartão, sem respostas', () => {
  const run = startRun(cards('a', 'b', 'c'));
  assert.deepEqual(currentCard(run), { id: 'a' });
  assert.equal(isFinished(run), false);
  assert.deepEqual(run.answers, []);
});

test('responder avança para o próximo cartão e guarda o tempo', () => {
  let run = startRun(cards('a', 'b'));
  run = answerCurrent(run, true, 4200);
  assert.deepEqual(currentCard(run), { id: 'b' });
  assert.deepEqual(run.answers, [{ flashcardId: 'a', correct: true, durationMs: 4200 }]);
});

test('a prova termina quando o último cartão é respondido; depois disso, responder não faz nada', () => {
  let run = startRun(cards('a', 'b'));
  run = answerCurrent(run, true, 1000);
  run = answerCurrent(run, false, 2000);
  assert.equal(isFinished(run), true);
  assert.equal(currentCard(run), null);
  assert.equal(answerCurrent(run, true, 1), run);
});

test('uma prova sem cartões nunca "termina" (não há o que mostrar)', () => {
  const run = startRun(cards());
  assert.equal(isFinished(run), false);
  assert.equal(currentCard(run), null);
});

test('um tempo negativo vira zero', () => {
  assert.equal(answerCurrent(startRun(cards('a')), true, -50).answers[0].durationMs, 0);
});

test('voltar desfaz a última resposta, uma por vez, até o começo', () => {
  const start = startRun(cards('a', 'b', 'c'));
  let run = answerCurrent(answerCurrent(start, true, 1), false, 2);
  assert.deepEqual(currentCard(run), { id: 'c' });

  run = undoAnswer(run);
  assert.deepEqual(currentCard(run), { id: 'b' });
  assert.equal(run.answers.length, 1);
  run = undoAnswer(run);
  assert.deepEqual(run, start);
  assert.equal(undoAnswer(run), run, 'no começo não há o que desfazer');
});

test('voltar depois de terminar reabre o último cartão', () => {
  let run = startRun(cards('a'));
  run = answerCurrent(run, false, 10);
  assert.equal(isFinished(run), true);
  run = undoAnswer(run);
  assert.equal(isFinished(run), false);
  assert.deepEqual(currentCard(run), { id: 'a' });
});

test('resultado: acertos, erros na ordem da prova, porcentagem e tempo médio', () => {
  let run = startRun(cards('a', 'b', 'c', 'd'));
  run = answerCurrent(run, true, 2000);
  run = answerCurrent(run, false, 6000);
  run = answerCurrent(run, true, 4000);
  run = answerCurrent(run, false, 8000);
  assert.deepEqual(runResult(run), {
    total: 4,
    correct: 2,
    wrong: [{ id: 'b' }, { id: 'd' }],
    percent: 50,
    averageMs: 5000,
  });
});

test('resultado sem respostas é tudo zero, sem dividir por zero', () => {
  assert.deepEqual(runResult(startRun(cards('a'))), { total: 0, correct: 0, wrong: [], percent: 0, averageMs: 0 });
});

test('porcentagem arredondada', () => {
  assert.equal(percentage(1, 3), 33);
  assert.equal(percentage(2, 3), 67);
  assert.equal(percentage(3, 3), 100);
  assert.equal(percentage(0, 5), 0);
  assert.equal(percentage(0, 0), 0);
});

test('duração em minutos e segundos, e em horas quando passa de uma', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(5_000), '0:05');
  assert.equal(formatDuration(65_000), '1:05');
  assert.equal(formatDuration(59 * 60_000 + 59_999), '59:59');
  assert.equal(formatDuration(3_723_000), '1:02:03');
  assert.equal(formatDuration(-1000), '0:00');
});
