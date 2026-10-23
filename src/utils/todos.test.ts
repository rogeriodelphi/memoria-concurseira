import assert from 'node:assert/strict';
import test from 'node:test';

import type { TodoItem } from '../types';
import { orderTodos, todoSummary } from './todos';

const item = (id: string, createdMin: number, doneMin: number | null = null): TodoItem => ({
  id,
  text: id,
  done: doneMin !== null,
  createdAt: new Date(Date.UTC(2026, 9, 23, 12, createdMin)).toISOString(),
  doneAt: doneMin === null ? null : new Date(Date.UTC(2026, 9, 23, 13, doneMin)).toISOString(),
});

test('orderTodos: pendentes na ordem em que foram escritos, depois os feitos com o último feito primeiro', () => {
  const list = [item('feito-cedo', 0, 5), item('d', 4), item('c', 3), item('feito-tarde', 1, 20), item('a', 1)];
  assert.deepEqual(orderTodos(list).map((t) => t.id), ['a', 'c', 'd', 'feito-tarde', 'feito-cedo']);
  assert.deepEqual(orderTodos([]), []);
});

test('orderTodos: não altera a lista recebida', () => {
  const list = [item('b', 2), item('a', 1)];
  orderTodos(list);
  assert.deepEqual(list.map((t) => t.id), ['b', 'a']);
});

test('todoSummary: pendentes e feitos no singular e no plural, ou nada sem lembretes', () => {
  assert.equal(todoSummary([]), '');
  assert.equal(todoSummary([item('a', 1)]), '1 pendente');
  assert.equal(todoSummary([item('a', 1), item('b', 2)]), '2 pendentes');
  assert.equal(todoSummary([item('a', 1), item('b', 2, 3), item('c', 3, 4), item('d', 4, 5)]), '1 pendente · 3 feitos');
  assert.equal(todoSummary([item('a', 1, 2)]), '1 feito');
});
