import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { chooseExam, listExamOptions, nextExam } from './nextExam';

// 17/10/2026, 15:00 no horário local do computador que roda o teste.
const NOW = new Date(2026, 9, 17, 15, 0, 0);

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, position TEXT NOT NULL DEFAULT '', exam_date TEXT, created_at TEXT NOT NULL DEFAULT '')`);
  return db;
}

let counter = 0;
function addExam(db: DatabaseSync, id: string, date: string | null, over: { user?: string; name?: string; position?: string } = {}) {
  db.prepare('INSERT INTO exams (id, user_id, name, position, exam_date, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    over.user ?? 'u1',
    over.name ?? `Prova ${id}`,
    over.position ?? '',
    date,
    new Date(2026, 0, 1, 0, 0, ++counter).toISOString(),
  );
}

test('nextExam: o mais próximo com data de hoje em diante (o de hoje conta)', () => {
  const db = newDb();
  addExam(db, 'longe', '2027-03-01');
  addExam(db, 'perto', '2026-12-06');
  addExam(db, 'ontem', '2026-10-16');
  addExam(db, 'sem', null);
  assert.deepEqual(nextExam(db, 'u1', NOW), { id: 'perto', name: 'Prova perto', examDate: '2026-12-06', daysLeft: 50 });
  addExam(db, 'hoje', '2026-10-17');
  assert.equal(nextExam(db, 'u1', NOW)!.id, 'hoje');
  assert.equal(nextExam(db, 'u2', NOW), null);
});

test('chooseExam: sem pedido, ou com pedido que não é uma string, vale o mais próximo (como sempre foi)', () => {
  const db = newDb();
  addExam(db, 'perto', '2026-12-06');
  addExam(db, 'longe', '2027-03-01');
  for (const requested of [undefined, null, '', 42, {}, ['longe']]) {
    assert.equal(chooseExam(db, 'u1', requested, NOW)!.id, 'perto', String(requested));
  }
});

test('chooseExam: o concurso escolhido vence o mais próximo, com os dias dele', () => {
  const db = newDb();
  addExam(db, 'perto', '2026-12-06');
  addExam(db, 'longe', '2027-03-01');
  const chosen = chooseExam(db, 'u1', 'longe', NOW)!;
  assert.equal(chosen.id, 'longe');
  assert.equal(chosen.examDate, '2027-03-01');
  assert.equal(chosen.daysLeft, 135);
  addExam(db, 'hoje', '2026-10-17');
  assert.equal(chooseExam(db, 'u1', 'hoje', NOW)!.daysLeft, 0, 'o de hoje conta');
});

test('chooseExam: pedido que não vale cai no mais próximo, sem erro', () => {
  const db = newDb();
  addExam(db, 'perto', '2026-12-06');
  addExam(db, 'sem-data', null);
  addExam(db, 'passou', '2026-10-16');
  addExam(db, 'alheio', '2026-11-01', { user: 'u2' });
  for (const requested of ['sem-data', 'passou', 'alheio', 'não-existe']) {
    assert.equal(chooseExam(db, 'u1', requested, NOW)!.id, 'perto', requested);
  }
});

test('chooseExam: sem nenhum concurso com data, é nulo, mesmo com pedido', () => {
  const db = newDb();
  addExam(db, 'sem-data', null);
  assert.equal(chooseExam(db, 'u1', 'sem-data', NOW), null);
  assert.equal(chooseExam(db, 'u1', undefined, NOW), null);
});

test('listExamOptions: só os usáveis por padrão, do mais próximo ao mais distante, com o cargo e os dias', () => {
  const db = newDb();
  addExam(db, 'ufba', '2027-01-20', { name: 'UFBA', position: 'Analista de TI' });
  addExam(db, 'transpetro', '2026-12-06', { name: 'TRANSPETRO', position: 'Análise de Sistemas' });
  addExam(db, 'sem', null);
  addExam(db, 'passou', '2026-09-01');
  addExam(db, 'alheio', '2026-11-01', { user: 'u2' });
  assert.deepEqual(listExamOptions(db, 'u1', NOW), [
    { id: 'transpetro', name: 'TRANSPETRO', position: 'Análise de Sistemas', examDate: '2026-12-06', daysLeft: 50 },
    { id: 'ufba', name: 'UFBA', position: 'Analista de TI', examDate: '2027-01-20', daysLeft: 95 },
  ]);
  assert.deepEqual(listExamOptions(db, 'u2', NOW).map((o) => o.id), ['alheio']);
  assert.deepEqual(listExamOptions(db, 'u3', NOW), []);
});

test('listExamOptions com os sem data: depois dos usáveis, o criado por último primeiro; no fim, os que passaram', () => {
  const db = newDb();
  addExam(db, 'velho-sem-data', null);
  addExam(db, 'passou-ha-muito', '2026-01-10');
  addExam(db, 'prova', '2026-12-06');
  addExam(db, 'novo-sem-data', null);
  addExam(db, 'passou-ontem', '2026-10-16');
  assert.deepEqual(listExamOptions(db, 'u1', NOW, { includeUndated: true }).map((o) => o.id), [
    'prova',
    'novo-sem-data',
    'velho-sem-data',
    'passou-ontem',
    'passou-ha-muito',
  ]);
  const undated = listExamOptions(db, 'u1', NOW, { includeUndated: true }).find((o) => o.id === 'novo-sem-data')!;
  assert.deepEqual([undated.examDate, undated.daysLeft], [null, null]);
  assert.equal(listExamOptions(db, 'u1', NOW, { includeUndated: true }).find((o) => o.id === 'passou-ontem')!.daysLeft, -1);
});

test('listExamOptions: a mesma data fica na ordem de criação (a mais recente primeiro)', () => {
  const db = newDb();
  addExam(db, 'a', '2026-12-06');
  addExam(db, 'b', '2026-12-06');
  assert.deepEqual(listExamOptions(db, 'u1', NOW).map((o) => o.id), ['b', 'a']);
});
