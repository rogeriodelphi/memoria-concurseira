import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { insertManualTask, localDateKey, MAX_MINUTES, prepareManualTask, type ManualTask } from './manual';

const NOW = new Date(2026, 9, 30, 10, 0, 0); // 30/10/2026, 10h (horário local)

const ok = (body: unknown, now = NOW): ManualTask => {
  const result = prepareManualTask(body, now);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
};
const error = (body: unknown, now = NOW): string => {
  const result = prepareManualTask(body, now);
  assert.equal(result.ok, false);
  return result.ok ? '' : result.error;
};

test('lançamento válido: o tempo vira segundos e o registro fica ao meio-dia local do dia escolhido', () => {
  const task = ok({ date: '2026-10-25', minutes: 90, discipline: 'Direito Administrativo', subject: 'Poder de polícia' });
  assert.equal(task.mode, 'manual');
  assert.equal(task.phase, 'lancamento');
  assert.equal(task.durationSec, 5400);
  assert.equal(task.discipline, 'Direito Administrativo');
  assert.equal(task.subject, 'Poder de polícia');
  const start = new Date(task.startedAt);
  assert.deepEqual([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()], [2026, 9, 25, 12, 0]);
});

test('início e fim iguais: a janela de duração zero não esconde revisão de cartão nenhuma', () => {
  const task = ok({ date: '2026-10-25', minutes: 45 });
  assert.equal(task.startedAt, task.endedAt);
});

test('o registro cai no dia escolhido também na data em UTC (é por ela que as estatísticas agrupam os dias)', () => {
  for (const date of ['2026-01-01', '2026-10-25', '2026-12-31']) {
    const task = ok({ date, minutes: 10 }, new Date(2027, 0, 5));
    assert.equal(task.startedAt.slice(0, 10), date);
  }
});

test('disciplina e assunto são opcionais, perdem os espaços a mais e têm limite de tamanho', () => {
  const sem = ok({ date: '2026-10-25', minutes: 10 });
  assert.deepEqual([sem.discipline, sem.subject], ['', '']);
  const sujo = ok({ date: '2026-10-25', minutes: 10, discipline: '  Direito   Penal \n', subject: 42 });
  assert.deepEqual([sujo.discipline, sujo.subject], ['Direito Penal', '']);
  assert.equal(ok({ date: '2026-10-25', minutes: 10, discipline: 'x'.repeat(500) }).discipline.length, 120);
});

test('o tempo é arredondado ao minuto e fica entre 1 minuto e 24 horas', () => {
  assert.equal(ok({ date: '2026-10-25', minutes: 29.6 }).durationSec, 30 * 60);
  assert.equal(ok({ date: '2026-10-25', minutes: 1 }).durationSec, 60);
  assert.equal(ok({ date: '2026-10-25', minutes: MAX_MINUTES }).durationSec, 86_400);
  for (const minutes of [0, 0.4, -5, MAX_MINUTES + 1, 100_000]) {
    assert.match(error({ date: '2026-10-25', minutes }), /entre 1 minuto e 24 horas/, String(minutes));
  }
});

test('tempo que não é número é recusado (inclusive número escrito como texto e NaN)', () => {
  for (const minutes of [undefined, null, '90', NaN, Infinity, {}, [90]]) {
    assert.match(error({ date: '2026-10-25', minutes }), /Informe o tempo/, String(minutes));
  }
});

test('a data precisa existir no calendário', () => {
  for (const date of [undefined, null, '', 'ontem', '2026-10-5', '25/10/2026', '2026-13-01', '2026-02-30', '2026-00-10', '2026-10-32', 20261025]) {
    assert.match(error({ date, minutes: 30 }), /data válida/, String(date));
  }
  assert.equal(ok({ date: '2028-02-29', minutes: 30 }, new Date(2029, 0, 1)).startedAt.slice(0, 10), '2028-02-29', 'ano bissexto existe');
  assert.match(error({ date: '2027-02-29', minutes: 30 }, new Date(2029, 0, 1)), /data válida/, 'e 2027 não é bissexto');
});

test('a data não pode ser futura, mas hoje vale, e muito antiga é engano', () => {
  assert.equal(ok({ date: '2026-10-30', minutes: 30 }).startedAt.slice(0, 10), '2026-10-30');
  assert.match(error({ date: '2026-10-31', minutes: 30 }), /futuro/);
  assert.match(error({ date: '2030-01-01', minutes: 30 }), /futuro/);
  assert.match(error({ date: '1999-12-31', minutes: 30 }), /antiga demais/);
  // Ano de 2 dígitos digitado pela metade (0026): o calendário do JavaScript o lê como 1926, e a data é recusada de qualquer jeito.
  assert.match(error({ date: '0026-10-25', minutes: 30 }), /data válida|antiga demais/);
  assert.equal(ok({ date: '2000-01-01', minutes: 30 }).durationSec, 1800);
});

test('hoje, às 23h59 ou à 0h, é o mesmo dia local (o futuro se decide pelo dia, não pela hora)', () => {
  assert.equal(localDateKey(new Date(2026, 9, 30, 0, 0, 1)), '2026-10-30');
  assert.equal(localDateKey(new Date(2026, 9, 30, 23, 59, 59)), '2026-10-30');
  ok({ date: '2026-10-30', minutes: 30 }, new Date(2026, 9, 30, 0, 0, 1));
  ok({ date: '2026-10-30', minutes: 30 }, new Date(2026, 9, 30, 23, 59, 59));
});

test('corpo ausente ou sem forma de objeto dá erro, não exceção', () => {
  for (const body of [undefined, null, 'texto', 42, []]) assert.match(error(body), /data válida/);
});

// ---------- gravação ----------

const SCHEMA = `CREATE TABLE pomodoro_tasks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mode TEXT NOT NULL, phase TEXT NOT NULL DEFAULT '', discipline TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '', duration_sec INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, created_at TEXT NOT NULL)`;

test('grava uma linha na tabela do Pomodoro, só do usuário, com os campos do lançamento', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const task = ok({ date: '2026-10-25', minutes: 60, discipline: 'Português', subject: 'Crase' });
  const row = insertManualTask(db, 'u1', task, NOW);
  const saved = db.prepare('SELECT * FROM pomodoro_tasks').all() as unknown as Record<string, unknown>[];
  assert.equal(saved.length, 1);
  assert.deepEqual(
    { id: saved[0].id, user: saved[0].user_id, mode: saved[0].mode, phase: saved[0].phase, d: saved[0].discipline, s: saved[0].subject, sec: saved[0].duration_sec },
    { id: row.id, user: 'u1', mode: 'manual', phase: 'lancamento', d: 'Português', s: 'Crase', sec: 3600 },
  );
  assert.equal(saved[0].started_at, task.startedAt);
  assert.equal(saved[0].ended_at, task.endedAt);
  assert.equal(saved[0].created_at, NOW.toISOString());
});

test('dois lançamentos iguais são dois registros (não há duplicata a esconder)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const task = ok({ date: '2026-10-25', minutes: 30 });
  insertManualTask(db, 'u1', task, NOW);
  insertManualTask(db, 'u1', task, NOW);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pomodoro_tasks').get() as { n: number }).n, 2);
});
