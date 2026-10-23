import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FROZEN_SCHEMA } from '../collections/frozen';
import {
  disciplinePoints,
  getNewCardOrder,
  loadExamOrderContext,
  loadNewOrderOverview,
  parseNewCardOrder,
  pickByExamWeight,
  pickNewCardIdsByExam,
  setNewCardOrder,
  type NewCardRef,
} from './newOrder';
import { setDailyNewLimit, selectDueCards } from './store';

// ---------- a escolha, pura ----------

const cards = (group: string | null, ...ids: string[]): NewCardRef[] => ids.map((id) => ({ id, group }));
const pts = (entries: [string, number][]) => new Map(entries);

test('escolha: sem histórico, cada disciplina recebe a sua fatia (3 para 1), e o resultado confere à mão', () => {
  const picked = pickByExamWeight({
    newCards: [...cards('A', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'), ...cards('B', 'b1', 'b2')],
    learnedByGroup: new Map(),
    points: pts([['A', 3], ['B', 1]]),
    count: 8,
  });
  // Cota a cada passo (A: 3/4, B: 1/4): A, A (empate, vence o de mais pontos), B, A, A, A (empate), B, e a fila de A termina.
  assert.deepEqual(picked, ['a1', 'a2', 'b1', 'a3', 'a4', 'a5', 'b2', 'a6']);
});

test('escolha: uma disciplina que ficou para trás é alcançada primeiro (o histórico conta)', () => {
  const picked = pickByExamWeight({
    newCards: [...cards('A', 'a1', 'a2', 'a3'), ...cards('B', 'b1', 'b2', 'b3')],
    learnedByGroup: new Map([['A', 4]]),
    points: pts([['A', 1], ['B', 1]]),
    count: 4,
  });
  assert.deepEqual(picked, ['b1', 'b2', 'b3', 'a1'], 'B tem 0 estudados contra 4 de A: entra tudo de B antes de A voltar');
});

test('escolha: lotes pequenos dia após dia dão a mesma divisão de um lote grande (ninguém passa fome)', () => {
  const all = [...cards('A', ...Array.from({ length: 40 }, (_, i) => `a${i}`)), ...cards('B', ...Array.from({ length: 40 }, (_, i) => `b${i}`))];
  const points = pts([['A', 5], ['B', 1]]);

  // Um lote de 30 de uma vez.
  const big = pickByExamWeight({ newCards: all, learnedByGroup: new Map(), points, count: 30 });
  assert.equal(big.filter((id) => id.startsWith('b')).length, 5);

  // O mesmo em dez dias de 3 cartões: o que foi estudado ontem entra na conta de hoje.
  const learned = new Map<string, number>();
  const remaining = [...all];
  const studied: string[] = [];
  for (let day = 0; day < 10; day++) {
    const picks = pickByExamWeight({ newCards: remaining, learnedByGroup: learned, points, count: 3 });
    for (const id of picks) {
      studied.push(id);
      remaining.splice(remaining.findIndex((c) => c.id === id), 1);
      const group = id.startsWith('a') ? 'A' : 'B';
      learned.set(group, (learned.get(group) ?? 0) + 1);
    }
  }
  assert.equal(studied.filter((id) => id.startsWith('b')).length, 5, 'B aparece nos dias em que chega a sua vez, não nunca');
  assert.equal(studied.length, 30);
});

test('escolha: dentro de cada disciplina vale a ordem recebida (a de criação)', () => {
  const picked = pickByExamWeight({
    newCards: [...cards('A', 'a3', 'a1', 'a2')],
    learnedByGroup: new Map(),
    points: pts([['A', 1]]),
    count: 3,
  });
  assert.deepEqual(picked, ['a3', 'a1', 'a2']);
});

test('escolha: cartões sem disciplina só entram depois que os das disciplinas acabam', () => {
  const input = {
    newCards: [...cards(null, 'x1', 'x2'), ...cards('A', 'a1')],
    learnedByGroup: new Map<string, number>(),
    points: pts([['A', 1]]),
  };
  assert.deepEqual(pickByExamWeight({ ...input, count: 1 }), ['a1'], 'com espaço para um só, o da disciplina');
  assert.deepEqual(pickByExamWeight({ ...input, count: 3 }), ['a1', 'x1', 'x2'], 'sobrando espaço, entram os sem disciplina, na ordem');
  assert.deepEqual(pickByExamWeight({ ...input, count: 2 }), ['a1', 'x1']);
});

test('escolha: uma disciplina fora da lista de pontos (ou com 0) conta como "sem disciplina"', () => {
  const picked = pickByExamWeight({
    newCards: [...cards('Z', 'z1'), ...cards('A', 'a1'), ...cards('W', 'w1')],
    learnedByGroup: new Map(),
    points: pts([['A', 1], ['W', 0]]),
    count: 3,
  });
  assert.deepEqual(picked, ['a1', 'z1', 'w1']);
});

test('escolha: pontos iguais alternam as disciplinas na ordem da prova', () => {
  const picked = pickByExamWeight({
    newCards: [...cards('A', 'a1', 'a2', 'a3'), ...cards('B', 'b1', 'b2', 'b3')],
    learnedByGroup: new Map(),
    points: pts([['A', 1], ['B', 1]]),
    count: 6,
  });
  assert.deepEqual(picked, ['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
});

test('escolha: sem cartões, sem cota ou sem pontos, devolve o que dá (nada de erro)', () => {
  const empty = pickByExamWeight({ newCards: [], learnedByGroup: new Map(), points: pts([['A', 1]]), count: 5 });
  assert.deepEqual(empty, []);
  assert.deepEqual(pickByExamWeight({ newCards: cards('A', 'a1'), learnedByGroup: new Map(), points: pts([['A', 1]]), count: 0 }), []);
  assert.deepEqual(pickByExamWeight({ newCards: cards('A', 'a1'), learnedByGroup: new Map(), points: pts([['A', 1]]), count: -3 }), []);
  assert.deepEqual(pickByExamWeight({ newCards: cards('A', 'a1', 'a2'), learnedByGroup: new Map(), points: new Map(), count: 2 }), ['a1', 'a2'], 'sem pontos, tudo é "sem disciplina"');
  assert.deepEqual(pickByExamWeight({ newCards: cards('A', 'a1'), learnedByGroup: new Map(), points: pts([['A', 1]]), count: 99 }), ['a1']);
});

test('escolha: não altera o que recebeu e dá sempre o mesmo resultado', () => {
  const newCards = [...cards('A', 'a1', 'a2'), ...cards('B', 'b1')];
  const snapshot = JSON.stringify(newCards);
  const first = pickByExamWeight({ newCards, learnedByGroup: new Map(), points: pts([['A', 2], ['B', 1]]), count: 3 });
  const second = pickByExamWeight({ newCards, learnedByGroup: new Map(), points: pts([['A', 2], ['B', 1]]), count: 3 });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(newCards), snapshot);
});

test('pontos: questões vezes peso; sem número de questões vale a média; sem nada, partes iguais', () => {
  const rows = (...r: [number | null, number | null][]) => r.map(([question_count, weight], i) => ({ id: `d${i}`, name: `D${i}`, question_count, weight }));
  assert.deepEqual(disciplinePoints(rows([50, null], [10, 2])).map((d) => d.points), [50, 20]);
  assert.deepEqual(disciplinePoints(rows([40, null], [20, null], [null, null])).map((d) => d.points), [40, 20, 30], 'a média de 40 e 20');
  assert.deepEqual(disciplinePoints(rows([null, null], [null, null])).map((d) => d.points), [1, 1]);
  assert.deepEqual(disciplinePoints(rows([10, 0], [10, -1])).map((d) => d.points), [10, 10], 'peso zero ou negativo vale 1');
  assert.deepEqual(disciplinePoints(rows([0, null], [10, null])).map((d) => d.points), [10, 10], 'zero questões vale como "não informado"');
});

test('ordem escolhida: só "created" e "exam" valem', () => {
  assert.deepEqual(parseNewCardOrder('created'), { ok: true, value: 'created' });
  assert.deepEqual(parseNewCardOrder('exam'), { ok: true, value: 'exam' });
  for (const bad of [null, undefined, '', 'EXAM', 'edital', 1, {}]) assert.equal(parseNewCardOrder(bad).ok, false, String(bad));
});

// ---------- com o banco ----------

// 17/10/2026, 15:00 no horário local do computador que roda o teste. A prova (06/12) fica a 50 dias.
const NOW = new Date(2026, 9, 17, 15, 0, 0);

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(FROZEN_SCHEMA);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, daily_new_limit INTEGER, new_card_order TEXT NOT NULL DEFAULT 'created');
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '');
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, question TEXT NOT NULL DEFAULT 'p', answer TEXT NOT NULL DEFAULT 'r',
      format TEXT NOT NULL DEFAULT 'plain', difficulty TEXT NOT NULL DEFAULT 'medio', source_page INTEGER, created_at TEXT NOT NULL,
      ease_factor REAL NOT NULL DEFAULT 2.5, interval_days INTEGER NOT NULL DEFAULT 0, repetitions INTEGER NOT NULL DEFAULT 0,
      due_at TEXT, favorite INTEGER NOT NULL DEFAULT 0, document_id TEXT
    );
    CREATE TABLE study_sessions (id TEXT PRIMARY KEY, flashcard_id TEXT NOT NULL, user_id TEXT NOT NULL, result TEXT NOT NULL, studied_at TEXT NOT NULL, duration_ms INTEGER);
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, exam_date TEXT);
    CREATE TABLE exam_disciplines (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, name TEXT NOT NULL, question_count INTEGER, weight REAL, position INTEGER NOT NULL);
    CREATE TABLE exam_topics (id TEXT PRIMARY KEY, discipline_id TEXT NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE exam_topic_collections (topic_id TEXT NOT NULL, collection_id TEXT NOT NULL, PRIMARY KEY (topic_id, collection_id));

    INSERT INTO users (id, daily_new_limit) VALUES ('u1', NULL), ('u2', NULL);
    INSERT INTO collections (id, user_id, name) VALUES ('cS', 'u1', 'Específicos'), ('cP', 'u1', 'Português'), ('cU', 'u1', 'Solta'), ('cX', 'u2', 'Alheia');
    INSERT INTO exams VALUES ('e1', 'u1', 'Prova', '2026-12-06'), ('e2', 'u2', 'Alheia', '2026-12-06');
    INSERT INTO exam_disciplines VALUES ('dS', 'e1', 'Conhecimentos Específicos', 50, NULL, 0), ('dP', 'e1', 'Língua Portuguesa', 10, NULL, 1), ('dI', 'e1', 'Língua Inglesa', 10, NULL, 2);
    INSERT INTO exam_topics VALUES ('tS', 'dS', 'Redes', 0), ('tP', 'dP', 'Concordância', 0), ('tI', 'dI', 'Reading', 0);
    INSERT INTO exam_topic_collections VALUES ('tS', 'cS'), ('tP', 'cP');
  `);
  return db;
}

let counter = 0;
/** Os cartões são criados na ordem dos ids (o `created_at` cresce a cada chamada). */
function add(db: DatabaseSync, id: string, collection: string, dueAt: string | null = null) {
  db.prepare('INSERT INTO flashcards (id, collection_id, created_at, due_at) VALUES (?, ?, ?, ?)').run(id, collection, new Date(2026, 8, 1, 0, 0, ++counter).toISOString(), dueAt);
}
const many = (db: DatabaseSync, prefix: string, collection: string, n: number, dueAt: string | null = null) => {
  for (let i = 1; i <= n; i++) add(db, `${prefix}${i}`, collection, dueAt);
};
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const count = (list: string[], prefix: string) => list.filter((id) => id.startsWith(prefix)).length;

/** Os soltos são os mais antigos, depois Português e depois Específicos: a ordem de criação dá uma disciplina por vez. */
function seedCards(db: DatabaseSync) {
  many(db, 'u', 'cU', 3);
  many(db, 'p', 'cP', 4);
  many(db, 's', 'cS', 12);
}

test('ordem no banco: começa em "created", grava "exam" e volta; valor inválido não grava nada', () => {
  const db = newDb();
  assert.equal(getNewCardOrder(db, 'u1'), 'created');
  assert.deepEqual(setNewCardOrder(db, 'u1', 'exam'), { ok: true, value: 'exam' });
  assert.equal(getNewCardOrder(db, 'u1'), 'exam');
  assert.equal(getNewCardOrder(db, 'u2'), 'created', 'só da própria conta');
  assert.equal(setNewCardOrder(db, 'u1', 'qualquer').ok, false);
  assert.equal(getNewCardOrder(db, 'u1'), 'exam');
  setNewCardOrder(db, 'u1', 'created');
  assert.equal(getNewCardOrder(db, 'u1'), 'created');
  assert.equal(getNewCardOrder(db, 'não-existe'), 'created');
});

test('edital: sem concurso com data não há contexto; com data, vem o do usuário', () => {
  const db = newDb();
  db.prepare("UPDATE exams SET exam_date = NULL WHERE id = 'e1'").run();
  assert.equal(loadExamOrderContext(db, 'u1', NOW), null);
  assert.equal(pickNewCardIdsByExam(db, 'u1', NOW, 5), null);

  db.prepare("UPDATE exams SET exam_date = '2026-12-06' WHERE id = 'e1'").run();
  const context = loadExamOrderContext(db, 'u1', NOW)!;
  assert.equal(context.exam.id, 'e1');
  assert.deepEqual(context.disciplines.map((d) => [d.id, d.points]), [['dS', 50], ['dP', 10], ['dI', 10]]);
  assert.deepEqual([...context.collectionGroup], [['cS', 'dS'], ['cP', 'dP']], 'a coleção solta não tem disciplina');
});

test('edital: uma coleção ligada a mais de uma disciplina fica com a de mais pontos (empate: a primeira da prova)', () => {
  const db = newDb();
  db.prepare("INSERT INTO exam_topic_collections VALUES ('tP', 'cS')").run(); // cS agora também no Português (10 pontos)
  assert.equal(loadExamOrderContext(db, 'u1', NOW)!.collectionGroup.get('cS'), 'dS');

  db.prepare("INSERT INTO exam_topic_collections VALUES ('tI', 'cP')").run(); // cP também no Inglês (10 pontos, empate)
  assert.equal(loadExamOrderContext(db, 'u1', NOW)!.collectionGroup.get('cP'), 'dP', 'empate: vale a que vem antes na prova');

  db.prepare('UPDATE exam_disciplines SET weight = 3 WHERE id = ?').run('dI'); // Inglês passa a valer 30
  assert.equal(loadExamOrderContext(db, 'u1', NOW)!.collectionGroup.get('cP'), 'dI', 'o peso conta');
});

test('edital: o peso multiplica as questões, e coleção de outra conta não entra', () => {
  const db = newDb();
  db.prepare("UPDATE exam_disciplines SET weight = 2 WHERE id = 'dP'").run();
  db.prepare("INSERT INTO exam_topic_collections VALUES ('tP', 'cX')").run(); // coleção da conta u2 ligada ao concurso de u1
  const context = loadExamOrderContext(db, 'u1', NOW)!;
  assert.equal(context.disciplines.find((d) => d.id === 'dP')!.points, 20);
  assert.ok(!context.collectionGroup.has('cX'));
});

test('novos pelo edital: com limite de 6, a fatia de cada disciplina entra e os sem disciplina ficam para depois', () => {
  const db = newDb();
  seedCards(db);
  const picked = pickNewCardIdsByExam(db, 'u1', NOW, 6)!;
  assert.equal(picked.length, 6);
  assert.equal(count(picked, 's'), 5, 'Específicos: 50 de 60 pontos (o Inglês não tem cartões e não entra na conta)');
  assert.equal(count(picked, 'p'), 1);
  assert.equal(count(picked, 'u'), 0, 'os soltos só entram quando o resto acaba');
  assert.deepEqual(picked.filter((id) => id.startsWith('s')), ['s1', 's2', 's3', 's4', 's5'], 'dentro da disciplina, a ordem de criação');
});

test('novos pelo edital: o que já foi estudado entra na conta (a disciplina atrasada é alcançada)', () => {
  const db = newDb();
  many(db, 'sOld', 'cS', 30, new Date(2026, 9, 10).toISOString()); // 30 de Específicos já estudados, nenhum de Português
  many(db, 'p', 'cP', 6);
  many(db, 's', 'cS', 6);
  const picked = pickNewCardIdsByExam(db, 'u1', NOW, 6)!;
  assert.equal(count(picked, 'p'), 6, 'Português está atrás da sua cota: entra primeiro');
});

test('novos pelo edital: sobrando espaço, os soltos entram por último', () => {
  const db = newDb();
  seedCards(db);
  const picked = pickNewCardIdsByExam(db, 'u1', NOW, 18)!;
  assert.equal(picked.length, 18);
  assert.deepEqual(picked.slice(-2), ['u1', 'u2'], 'os soltos ficam no fim, os mais antigos primeiro');
  assert.equal(count(picked, 'u'), 2, 'cabem 16 das disciplinas + 2 soltos');
  assert.equal(count(picked.slice(0, 16), 'u'), 0, 'nenhum solto antes de acabarem os das disciplinas');
});

// ---------- a fila ----------

test('fila: com a ordem pelo edital e limite, entram as fatias; sem a opção, entram os mais antigos como sempre', () => {
  const db = newDb();
  seedCards(db);
  setDailyNewLimit(db, 'u1', 6);

  const created = ids(selectDueCards(db, 'u1', NOW).cards);
  assert.deepEqual(created, ['u1', 'u2', 'u3', 'p1', 'p2', 'p3'], 'a ordem de criação, como sempre foi');

  setNewCardOrder(db, 'u1', 'exam');
  const exam = selectDueCards(db, 'u1', NOW);
  assert.equal(exam.cards.length, 6);
  assert.equal(count(ids(exam.cards), 's'), 5);
  assert.equal(count(ids(exam.cards), 'p'), 1);
  assert.equal(exam.waitingNew, 13, '19 novos, 6 entram');
  assert.ok(exam.cards.every((c) => c.collection_name !== undefined), 'as linhas continuam trazendo o nome da coleção');
});

test('fila: a ordem pelo edital só vale com limite, e só muda quem entra quando os novos não cabem todos', () => {
  const db = newDb();
  seedCards(db);
  setNewCardOrder(db, 'u1', 'exam');

  assert.equal(selectDueCards(db, 'u1', NOW).cards.length, 19, 'sem limite entram todos');
  setDailyNewLimit(db, 'u1', 500);
  assert.equal(selectDueCards(db, 'u1', NOW).cards.length, 19, 'limite que cabe todos: entram todos');
});

test('fila: sem concurso com data, a opção "edital" cai na ordem de criação', () => {
  const db = newDb();
  seedCards(db);
  setDailyNewLimit(db, 'u1', 6);
  setNewCardOrder(db, 'u1', 'exam');
  db.prepare("UPDATE exams SET exam_date = NULL WHERE id = 'e1'").run();
  assert.deepEqual(ids(selectDueCards(db, 'u1', NOW).cards), ['u1', 'u2', 'u3', 'p1', 'p2', 'p3']);
});

test('fila: estudar coleções escolhidas não é contido pela ordem nem pelo limite', () => {
  const db = newDb();
  seedCards(db);
  setDailyNewLimit(db, 'u1', 2);
  setNewCardOrder(db, 'u1', 'exam');
  const only = selectDueCards(db, 'u1', NOW, { collectionIds: ['cU', 'cP'] });
  assert.deepEqual(ids(only.cards).sort(), ['p1', 'p2', 'p3', 'p4', 'u1', 'u2', 'u3']);
});

test('fila: se a ordem pelo edital falhar, o estudo não quebra: cai na ordem de criação', () => {
  const db = newDb();
  seedCards(db);
  setDailyNewLimit(db, 'u1', 6);
  setNewCardOrder(db, 'u1', 'exam');
  db.exec('DROP TABLE exam_topic_collections'); // simula um banco com defeito

  const silenced = console.error;
  let logged = 0;
  console.error = () => void logged++;
  try {
    assert.deepEqual(ids(selectDueCards(db, 'u1', NOW).cards), ['u1', 'u2', 'u3', 'p1', 'p2', 'p3']);
  } finally {
    console.error = silenced;
  }
  assert.equal(logged, 1, 'a falha é registrada no log do servidor');
});

test('fila: a ordem é só do usuário', () => {
  const db = newDb();
  seedCards(db);
  many(db, 'x', 'cX', 5);
  setDailyNewLimit(db, 'u1', 6);
  setNewCardOrder(db, 'u2', 'exam'); // a outra conta escolheu o edital; a u1 não
  assert.deepEqual(ids(selectDueCards(db, 'u1', NOW).cards), ['u1', 'u2', 'u3', 'p1', 'p2', 'p3']);
});

// ---------- o resumo para a tela ----------

test('resumo: sem concurso com data, só diz a ordem escolhida', () => {
  const db = newDb();
  db.prepare("UPDATE exams SET exam_date = NULL").run();
  setNewCardOrder(db, 'u1', 'exam');
  assert.deepEqual(loadNewOrderOverview(db, 'u1', NOW), { order: 'exam', exam: null, disciplines: [], unlinkedNew: 0 });
});

test('resumo: a fatia de cada disciplina, quantos cartões ela tem e quantos novos estão soltos', () => {
  const db = newDb();
  seedCards(db);
  many(db, 'sOld', 'cS', 3, new Date(2026, 9, 10).toISOString());
  const overview = loadNewOrderOverview(db, 'u1', NOW);

  assert.equal(overview.order, 'created');
  assert.equal(overview.exam!.id, 'e1');
  assert.deepEqual(
    overview.disciplines.map((d) => [d.name, d.sharePct, d.newCards, d.learnedCards]),
    [['Conhecimentos Específicos', 71, 12, 3], ['Língua Portuguesa', 14, 4, 0], ['Língua Inglesa', 14, 0, 0]],
    'a fatia é da prova toda (50/70, 10/70, 10/70); o Inglês aparece sem nenhum cartão',
  );
  assert.deepEqual(
    overview.disciplines.map((d) => [d.quotaPct, d.learnedSharePct]),
    [[83, 100], [17, 0], [null, null]],
    'a cota só reparte entre as disciplinas com cartões (50/60 e 10/60); o Inglês, sem cartões, não tem cota',
  );
  assert.equal(overview.unlinkedNew, 3);
});
