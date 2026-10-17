import assert from 'node:assert/strict';
import test from 'node:test';

import { batchButtonLabel, batchConfirmMessage, BATCH_MAX, nextBatch, topicConfirmMessage, topicsWithoutMaterial } from './examGaps';

const topic = (id: string, hasMaterial: boolean) => ({ id, hasMaterial });

test('tópicos sem material: só os sem cartão, na ordem do edital', () => {
  const topics = [topic('a', true), topic('b', false), topic('c', true), topic('d', false)];
  assert.deepEqual(topicsWithoutMaterial(topics).map((t) => t.id), ['b', 'd']);
  assert.deepEqual(topicsWithoutMaterial([]), []);
  assert.deepEqual(topicsWithoutMaterial([topic('a', true)]), []);
});

test('a rodada em lote pega os primeiros sem material, até o limite, sem mexer na lista', () => {
  const topics = Array.from({ length: 50 }, (_, i) => topic(`t${i}`, i % 5 === 0)); // 10 com material, 40 sem
  const batch = nextBatch(topics);
  assert.equal(batch.length, BATCH_MAX);
  assert.deepEqual(batch.slice(0, 3).map((t) => t.id), ['t1', 't2', 't3']);
  assert.ok(batch.every((t) => !t.hasMaterial));
  assert.equal(nextBatch(topics, 5).length, 5);
  assert.equal(nextBatch([topic('a', false), topic('b', false)]).length, 2, 'cabem todos');
  assert.equal(topics.length, 50);
});

test('depois de gerar uma rodada, a seguinte começa no próximo tópico sem material', () => {
  const topics = Array.from({ length: 30 }, (_, i) => topic(`t${i}`, false));
  const first = nextBatch(topics, 10);
  const after = topics.map((t) => (first.some((f) => f.id === t.id) ? { ...t, hasMaterial: true } : t));
  assert.deepEqual(nextBatch(after, 10).map((t) => t.id), Array.from({ length: 10 }, (_, i) => `t${i + 10}`));
});

test('botão do lote: singular, todos de uma vez, ou a rodada de 20 com o total', () => {
  assert.equal(batchButtonLabel(0), '');
  assert.equal(batchButtonLabel(1), 'Gerar cartões do tópico sem material');
  assert.equal(batchButtonLabel(8), 'Gerar cartões dos 8 tópicos sem material');
  assert.equal(batchButtonLabel(20), 'Gerar cartões dos 20 tópicos sem material');
  assert.equal(batchButtonLabel(111), 'Gerar cartões dos próximos 20 tópicos sem material (de 111)');
});

test('confirmações: dizem quantos, de onde vêm os cartões e o que conferir', () => {
  const batch = batchConfirmMessage(20, 'Conhecimentos Específicos');
  assert.match(batch, /cerca de 12 cartões para cada um de 20 tópicos de "Conhecimentos Específicos"/);
  assert.match(batch, /coleção nova/);
  assert.match(batch, /sem texto-fonte/);
  assert.match(batch, /parar a qualquer momento/);
  assert.match(batchConfirmMessage(1, 'D'), /de 1 tópico de "D"/);

  const single = topicConfirmMessage('Ortografia oficial');
  assert.match(single, /"Ortografia oficial"/);
  assert.match(single, /leis, números e datas/);
});
