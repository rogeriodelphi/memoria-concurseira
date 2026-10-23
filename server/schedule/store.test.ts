import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FROZEN_SCHEMA, setCollectionFrozen } from '../collections/frozen';
import { DEFAULT_SETTINGS } from './plan';
import { SCHEDULE_SCHEMA } from './schema';
import { loadSchedule, loadSettings, parseSettings, saveSettings, setTopicDone, type Result } from './store';

// 23/10/2026 às 15:00 (local). A prova de e1 é 06/12/2026: 44 dias.
const NOW = new Date(2026, 9, 23, 15, 0, 0);

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u1'), ('u2');
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, exam_date TEXT);
    CREATE TABLE exam_disciplines (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, name TEXT NOT NULL, question_count INTEGER, weight REAL, position INTEGER NOT NULL);
    CREATE TABLE exam_topics (id TEXT PRIMARY KEY, discipline_id TEXT NOT NULL REFERENCES exam_disciplines(id) ON DELETE CASCADE, title TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE exam_topic_collections (topic_id TEXT NOT NULL REFERENCES exam_topics(id) ON DELETE CASCADE, collection_id TEXT NOT NULL, PRIMARY KEY (topic_id, collection_id));
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '');
    CREATE TABLE flashcards (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, due_at TEXT);

    INSERT INTO exams VALUES ('e1', 'u1', 'Prova', '2026-12-06'), ('e2', 'u2', 'Alheia', '2026-12-06'), ('e3', 'u1', 'Sem data', NULL);
    INSERT INTO exam_disciplines VALUES ('dE', 'e1', 'Específicos', 50, NULL, 0), ('dP', 'e1', 'Português', 10, NULL, 1), ('dX', 'e2', 'Alheia', 10, NULL, 0);
    INSERT INTO exam_topics VALUES
      ('tE1', 'dE', 'Redes', 0), ('tE2', 'dE', 'Segurança', 1), ('tE3', 'dE', 'Banco de dados', 2),
      ('tP1', 'dP', 'Crase', 0), ('tP2', 'dP', 'Pontuação', 1), ('tX1', 'dX', 'De outro usuário', 0);
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes', 'Protocolos'), ('c2', 'u1', 'Crase', ''), ('cx', 'u2', 'Alheia', '');
    INSERT INTO exam_topic_collections VALUES ('tE1', 'c1'), ('tP1', 'c2');
    INSERT INTO flashcards VALUES ('f1', 'c1', NULL), ('f2', 'c1', '2026-10-30T10:00:00.000Z'), ('f3', 'c1', '2026-10-30T10:00:00.000Z'), ('f4', 'c1', NULL), ('g1', 'c2', NULL);
  `);
  db.exec(SCHEDULE_SCHEMA);
  db.exec(FROZEN_SCHEMA);
  return db;
}

function value<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}
function failure<T>(result: Result<T>, status: number, message?: RegExp): void {
  assert.ok(!result.ok, 'devia falhar');
  assert.equal(result.status, status, result.error);
  if (message) assert.match(result.error, message);
}

const good = { minutesPerDay: 60, minutesPerTopic: 30, weekdays: [1, 2, 3, 4, 5] };

test('escolhas: valores válidos passam, com os dias da semana sem repetir e em ordem', () => {
  assert.deepEqual(value(parseSettings(good)), good);
  assert.deepEqual(value(parseSettings({ ...good, weekdays: [6, 0, 6, 3] })).weekdays, [0, 3, 6]);
  assert.deepEqual(value(parseSettings({ minutesPerDay: 10, minutesPerTopic: 10, weekdays: [0] })), { minutesPerDay: 10, minutesPerTopic: 10, weekdays: [0] });
  assert.equal(value(parseSettings({ minutesPerDay: 480, minutesPerTopic: 120, weekdays: [1] })).minutesPerDay, 480);
});

test('escolhas: fora do limite, não inteiro, ausente ou tópico maior que o dia é erro, nunca chute', () => {
  for (const bad of [9, 481, 30.5, '60', null, undefined, NaN]) failure(parseSettings({ ...good, minutesPerDay: bad }), 400, /tempo por dia/);
  for (const bad of [9, 121, 20.5, '30', null, undefined]) failure(parseSettings({ ...good, minutesPerTopic: bad }), 400, /tempo por tópico/);
  failure(parseSettings({ ...good, minutesPerDay: 30, minutesPerTopic: 45 }), 400, /caber em um dia/);
  for (const bad of [[], [7], [-1], [1.5], ['1'], 'todos', null, undefined]) failure(parseSettings({ ...good, weekdays: bad }), 400, /ao menos um dia/);
  failure(parseSettings(null), 400);
  failure(parseSettings('x'), 400);
});

test('guardar as escolhas: vale para o concurso do usuário, troca a anterior e não vaza para outro concurso', () => {
  const db = newDb();
  assert.deepEqual(loadSettings(db, 'e1'), { settings: { ...DEFAULT_SETTINGS }, saved: false });
  value(saveSettings(db, 'u1', 'e1', good, NOW));
  assert.deepEqual(loadSettings(db, 'e1'), { settings: good, saved: true });
  value(saveSettings(db, 'u1', 'e1', { ...good, minutesPerDay: 90 }, NOW));
  assert.equal(loadSettings(db, 'e1').settings.minutesPerDay, 90);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_settings').get()!.n, 1, 'uma linha por concurso');
  assert.equal(loadSettings(db, 'e3').saved, false);
});

test('guardar as escolhas: concurso de outro usuário ou inexistente é 404, e escolha inválida não grava nada', () => {
  const db = newDb();
  failure(saveSettings(db, 'u1', 'e2', good, NOW), 404, /Concurso não encontrado/);
  failure(saveSettings(db, 'u1', 'nao-existe', good, NOW), 404);
  failure(saveSettings(db, 'u1', undefined, good, NOW), 404);
  failure(saveSettings(db, 'u1', 'e1', { ...good, minutesPerDay: 5 }, NOW), 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_settings').get()!.n, 0);
});

test('uma linha estragada no banco cai nas escolhas padrão, sem quebrar o cronograma', () => {
  const db = newDb();
  db.prepare("INSERT INTO schedule_settings VALUES ('e1', 5, 5, '', 'x')").run();
  assert.deepEqual(loadSettings(db, 'e1'), { settings: { ...DEFAULT_SETTINGS }, saved: false });
  assert.ok(loadSchedule(db, 'u1', undefined, NOW));
});

test('marcar um tópico como estudado: grava, desmarca e devolve o concurso dele', () => {
  const db = newDb();
  assert.deepEqual(value(setTopicDone(db, 'u1', 'tE1', true, NOW)), { examId: 'e1', done: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_topic_done').get()!.n, 1);
  value(setTopicDone(db, 'u1', 'tE1', true, new Date(NOW.getTime() + 60_000)));
  assert.equal(db.prepare('SELECT done_at FROM schedule_topic_done').get()!.done_at, NOW.toISOString(), 'marcar de novo mantém a data original');
  assert.deepEqual(value(setTopicDone(db, 'u1', 'tE1', false, NOW)), { examId: 'e1', done: false });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_topic_done').get()!.n, 0);
  value(setTopicDone(db, 'u1', 'tE1', false, NOW)); // desmarcar o que não está marcado é inofensivo
});

test('marcar: precisa de verdadeiro ou falso, e o tópico tem de ser do usuário', () => {
  const db = newDb();
  for (const bad of [undefined, 'true', 1, null]) failure(setTopicDone(db, 'u1', 'tE1', bad, NOW), 400, /estudado ou não/);
  failure(setTopicDone(db, 'u1', 'tX1', true, NOW), 404, /Tópico não encontrado/);
  failure(setTopicDone(db, 'u2', 'tE1', true, NOW), 404);
  failure(setTopicDone(db, 'u1', 'nao-existe', true, NOW), 404);
  failure(setTopicDone(db, 'u1', undefined, true, NOW), 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_topic_done').get()!.n, 0);
});

test('o cronograma lido do banco: concurso, disciplinas com a fatia, tópicos na ordem do edital e o plano', () => {
  const db = newDb();
  const view = loadSchedule(db, 'u1', undefined, NOW)!;
  assert.deepEqual([view.exam.id, view.exam.daysLeft, view.today, view.settingsSaved], ['e1', 44, '2026-10-23', false]);
  assert.deepEqual(view.disciplines.map((d) => [d.name, d.sharePct, d.topics, d.done]), [['Específicos', 83, 3, 0], ['Português', 17, 2, 0]]);
  assert.deepEqual(view.topics.map((t) => t.id), ['tE1', 'tE2', 'tE3', 'tP1', 'tP2']);
  assert.deepEqual([view.summary.topicsTotal, view.summary.topicsPending, view.summary.verdict], [5, 5, 'fits']);
  assert.equal(view.days[0].date, '2026-10-23');
  assert.equal(view.days.at(-1)!.kind, 'exam');
  // 5 tópicos, 1 por dia (40 min / 30), com a fatia de Específicos (5 para 1): Português entra cedo, e a ordem do edital vale dentro de cada
  const order = view.days.flatMap((d) => d.topicIds);
  assert.deepEqual(order.filter((t) => t.startsWith('tE')), ['tE1', 'tE2', 'tE3']);
  assert.deepEqual(order.filter((t) => t.startsWith('tP')), ['tP1', 'tP2']);
});

test('o cronograma: os cartões de cada tópico (quantos e quantos % já vistos) e as coleções para estudá-lo', () => {
  const db = newDb();
  const view = loadSchedule(db, 'u1', undefined, NOW)!;
  const redes = view.topics.find((t) => t.id === 'tE1')!;
  assert.deepEqual([redes.cards, redes.seenPct, redes.collectionIds], [4, 50, ['c1']], '4 cartões, 2 já vistos');
  const seguranca = view.topics.find((t) => t.id === 'tE2')!;
  assert.deepEqual([seguranca.cards, seguranca.seenPct, seguranca.collectionIds], [0, null, []]);
  setCollectionFrozen(db, 'c1', true);
  const frozen = loadSchedule(db, 'u1', undefined, NOW)!.topics.find((t) => t.id === 'tE1')!;
  assert.deepEqual([frozen.cards, frozen.collectionIds], [4, []], 'congelada: os cartões existem, mas o estudo por ela não é oferecido');
});

test('o cronograma respeita as escolhas e as marcas, e o que foi feito sai do plano e do total pendente', () => {
  const db = newDb();
  value(saveSettings(db, 'u1', 'e1', { minutesPerDay: 60, minutesPerTopic: 30, weekdays: [1, 2, 3, 4, 5] }, NOW));
  value(setTopicDone(db, 'u1', 'tE1', true, NOW));
  value(setTopicDone(db, 'u1', 'tP1', true, NOW));
  const view = loadSchedule(db, 'u1', undefined, NOW)!;
  assert.deepEqual([view.settingsSaved, view.settings.minutesPerDay], [true, 60]);
  assert.deepEqual([view.summary.topicsDone, view.summary.topicsPending], [2, 3]);
  const order = view.days.flatMap((d) => d.topicIds);
  assert.ok(!order.includes('tE1') && !order.includes('tP1'));
  assert.deepEqual(view.disciplines.map((d) => d.done), [1, 1]);
  assert.equal(view.topics.find((t) => t.id === 'tE1')!.done, true);
  assert.ok(view.days.filter((d) => d.kind === 'rest').every((d) => [0, 6].includes(d.weekday)), 'só sábado e domingo descansam');
});

test('o concurso escolhido vale; um pedido que não vale cai no mais próximo; sem concurso com data não há cronograma', () => {
  const db = newDb();
  assert.equal(loadSchedule(db, 'u1', 'e1', NOW)!.exam.id, 'e1');
  assert.equal(loadSchedule(db, 'u1', 'e2', NOW)!.exam.id, 'e1', 'o de outro usuário não vale');
  assert.equal(loadSchedule(db, 'u1', 'e3', NOW)!.exam.id, 'e1', 'o sem data não vale');
  assert.equal(loadSchedule(db, 'u1', 123, NOW)!.exam.id, 'e1');
  assert.equal(loadSchedule(db, 'u1', undefined, new Date(2027, 0, 5)), null, 'depois da prova não há mais cronograma');
  db.prepare("DELETE FROM exams WHERE user_id = 'u2'").run();
  assert.equal(loadSchedule(db, 'u2', undefined, NOW), null);
});

test('as marcas de um usuário não aparecem no cronograma de outro, e apagar o concurso leva as escolhas e as marcas', () => {
  const db = newDb();
  value(setTopicDone(db, 'u1', 'tE1', true, NOW));
  value(saveSettings(db, 'u1', 'e1', good, NOW));
  assert.equal(loadSchedule(db, 'u2', undefined, NOW)!.topics.length, 1);
  assert.equal(loadSchedule(db, 'u2', undefined, NOW)!.topics[0].done, false);
  db.prepare("DELETE FROM exams WHERE id = 'e1'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_settings').get()!.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_topic_done').get()!.n, 0);
});

test('ler o cronograma é só leitura: nenhuma tabela muda', () => {
  const db = newDb();
  value(setTopicDone(db, 'u1', 'tE1', true, NOW));
  const snapshot = () => JSON.stringify({ done: db.prepare('SELECT * FROM schedule_topic_done').all(), settings: db.prepare('SELECT * FROM schedule_settings').all(), cards: db.prepare('SELECT * FROM flashcards ORDER BY id').all() });
  const before = snapshot();
  loadSchedule(db, 'u1', undefined, NOW);
  loadSchedule(db, 'u1', 'e1', NOW);
  assert.equal(snapshot(), before);
});
