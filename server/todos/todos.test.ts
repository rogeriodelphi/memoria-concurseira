import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { TODO_SCHEMA } from './schema';
import { addTodo, clearDone, listTodos, MAX_ITEMS, MAX_TEXT, parseText, removeTodo, setDone, type Result } from './todos';

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u1'), ('u2');
  `);
  db.exec(TODO_SCHEMA);
  return db;
}

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 23, 12, minutes, 0));

function value<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}
function failure<T>(result: Result<T>, status: number, message?: RegExp): void {
  assert.ok(!result.ok, 'devia falhar');
  assert.equal(result.status, status, result.error);
  if (message) assert.match(result.error, message);
}

test('parseText: apara, junta os espaços e as quebras de linha, e recusa vazio, não texto e texto grande demais', () => {
  assert.equal(value(parseText('  INSCRIÇÃO   DO CONCURSO\n do STF ')), 'INSCRIÇÃO DO CONCURSO do STF');
  for (const bad of ['', '   ', '\n\t', undefined, null, 42, {}, ['x']]) failure(parseText(bad), 400, /Escreva o lembrete/);
  assert.equal(value(parseText('a'.repeat(MAX_TEXT))).length, MAX_TEXT);
  failure(parseText('a'.repeat(MAX_TEXT + 1)), 400, /até 200 caracteres/);
});

test('escrever: o lembrete nasce pendente e aparece na lista', () => {
  const db = newDb();
  const { todo } = value(addTodo(db, 'u1', 'Inscrição do concurso do STF', at(0)));
  assert.deepEqual({ ...todo, id: 'x' }, { id: 'x', text: 'Inscrição do concurso do STF', done: false, createdAt: at(0).toISOString(), doneAt: null });
  assert.deepEqual(listTodos(db, 'u1').map((t) => t.text), ['Inscrição do concurso do STF']);
  assert.deepEqual(listTodos(db, 'u2'), [], 'o de outro usuário não aparece');
});

test('a lista: pendentes na ordem em que foram escritos, depois os feitos, o último feito primeiro', () => {
  const db = newDb();
  const a = value(addTodo(db, 'u1', 'A', at(0))).todo.id;
  const b = value(addTodo(db, 'u1', 'B', at(1))).todo.id;
  const c = value(addTodo(db, 'u1', 'C', at(2))).todo.id;
  const d = value(addTodo(db, 'u1', 'D', at(3))).todo.id;
  value(setDone(db, 'u1', b, true, at(10)));
  value(setDone(db, 'u1', a, true, at(20)));
  assert.deepEqual(listTodos(db, 'u1').map((t) => t.text), ['C', 'D', 'A', 'B'], 'C e D pendentes; A (feito por último) antes de B');
  assert.deepEqual(listTodos(db, 'u1').map((t) => t.done), [false, false, true, true]);
  assert.ok(c && d);
});

test('marcar como feito e desmarcar: guarda quando foi feito e limpa ao voltar a pendente', () => {
  const db = newDb();
  const id = value(addTodo(db, 'u1', 'Pedir documento', at(0))).todo.id;
  const done = value(setDone(db, 'u1', id, true, at(5))).todo;
  assert.deepEqual([done.done, done.doneAt], [true, at(5).toISOString()]);
  const back = value(setDone(db, 'u1', id, false, at(6))).todo;
  assert.deepEqual([back.done, back.doneAt], [false, null]);
  assert.equal(listTodos(db, 'u1')[0].done, false);
});

test('marcar: precisa de verdadeiro ou falso, e só vale para o lembrete do próprio usuário', () => {
  const db = newDb();
  const id = value(addTodo(db, 'u1', 'Meu', at(0))).todo.id;
  for (const bad of [undefined, 'true', 1, 0, null]) failure(setDone(db, 'u1', id, bad), 400, /feito ou não/);
  failure(setDone(db, 'u2', id, true), 404, /não encontrado/);
  failure(setDone(db, 'u1', 'nao-existe', true), 404);
  assert.equal(listTodos(db, 'u1')[0].done, false, 'nada mudou');
});

test('apagar: só o do próprio usuário, e apagar de novo é 404', () => {
  const db = newDb();
  const id = value(addTodo(db, 'u1', 'Apagar', at(0))).todo.id;
  failure(removeTodo(db, 'u2', id), 404);
  assert.equal(listTodos(db, 'u1').length, 1);
  value(removeTodo(db, 'u1', id));
  assert.deepEqual(listTodos(db, 'u1'), []);
  failure(removeTodo(db, 'u1', id), 404);
});

test('limpar os feitos: tira só os feitos do usuário e diz quantos', () => {
  const db = newDb();
  const a = value(addTodo(db, 'u1', 'A', at(0))).todo.id;
  const b = value(addTodo(db, 'u1', 'B', at(1))).todo.id;
  value(addTodo(db, 'u1', 'C', at(2)));
  const other = value(addTodo(db, 'u2', 'D', at(3))).todo.id;
  value(setDone(db, 'u1', a, true, at(5)));
  value(setDone(db, 'u1', b, true, at(6)));
  value(setDone(db, 'u2', other, true, at(7)));
  assert.equal(value(clearDone(db, 'u1')).removed, 2);
  assert.deepEqual(listTodos(db, 'u1').map((t) => t.text), ['C']);
  assert.deepEqual(listTodos(db, 'u2').map((t) => t.text), ['D'], 'o feito do outro usuário continua lá');
  assert.equal(value(clearDone(db, 'u1')).removed, 0);
});

test('limite: no máximo 200 lembretes por usuário (feitos ou não), e apagar libera vaga', () => {
  const db = newDb();
  for (let i = 0; i < MAX_ITEMS; i++) value(addTodo(db, 'u1', `Lembrete ${i}`, at(0)));
  failure(addTodo(db, 'u1', 'Mais um', at(1)), 400, /já tem 200 lembretes/);
  value(addTodo(db, 'u2', 'Outro usuário não é afetado', at(1)));
  value(removeTodo(db, 'u1', listTodos(db, 'u1')[0].id));
  value(addTodo(db, 'u1', 'Agora cabe', at(2)));
  assert.equal(listTodos(db, 'u1').length, MAX_ITEMS);
});

test('apagar o usuário leva os lembretes dele junto', () => {
  const db = newDb();
  value(addTodo(db, 'u1', 'Do u1', at(0)));
  value(addTodo(db, 'u2', 'Do u2', at(0)));
  db.prepare("DELETE FROM users WHERE id = 'u1'").run();
  assert.deepEqual(listTodos(db, 'u1'), []);
  assert.equal(listTodos(db, 'u2').length, 1);
});

test('o texto nunca é interpretado: aspas e HTML ficam como texto', () => {
  const db = newDb();
  const { todo } = value(addTodo(db, 'u1', `<img src=x onerror="alert(1)"> '; DROP TABLE todo_items; --`, at(0)));
  assert.equal(listTodos(db, 'u1')[0].text, todo.text);
  assert.match(todo.text, /^<img src=x onerror="alert\(1\)"> '; DROP TABLE todo_items; --$/);
  assert.equal(listTodos(db, 'u1').length, 1, 'a tabela segue de pé');
});
