import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { disciplineMockExamName, mockExamFromDiscipline } from './fromDiscipline';
import { MOCK_EXAM_SCHEMA } from './schema';
import { getMockExamDetail, listMockExams, MAX_NAME_CHARS, removeCard, renameMockExam, type Result } from './store';

// Banco só em memória: as tabelas de que isto depende, simplificadas, e o esquema real dos
// simulados. Duas disciplinas: Redes (tópicos ligados às coleções c1 e c2) e Direito (nenhuma ligação).
function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL);
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      question TEXT NOT NULL, answer TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'plain'
    );
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL);
    CREATE TABLE exam_disciplines (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, name TEXT NOT NULL);
    CREATE TABLE exam_topics (id TEXT PRIMARY KEY, discipline_id TEXT NOT NULL REFERENCES exam_disciplines(id) ON DELETE CASCADE, title TEXT NOT NULL);
    CREATE TABLE exam_topic_collections (
      topic_id TEXT NOT NULL REFERENCES exam_topics(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      PRIMARY KEY (topic_id, collection_id)
    );
    INSERT INTO users VALUES ('u1'), ('u2');
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes A'), ('c2', 'u1', 'Redes B'), ('c3', 'u1', 'Sem ligação'), ('cx', 'u2', 'Do outro');
    INSERT INTO flashcards (id, collection_id, question, answer) VALUES
      ('f1', 'c1', 'P1', 'R1'), ('f2', 'c1', 'P2', 'R2'), ('f3', 'c2', 'P3', 'R3'),
      ('f4', 'c3', 'P4', 'R4'), ('fx', 'cx', 'Alheio', 'Alheio');
    INSERT INTO exams VALUES ('e1', 'u1', 'TRT-4 2026'), ('e2', 'u2', 'Do outro');
    INSERT INTO exam_disciplines VALUES ('d1', 'e1', 'Redes de Computadores'), ('d2', 'e1', 'Direito'), ('dx', 'e2', 'Alheia');
    INSERT INTO exam_topics VALUES ('t1', 'd1', 'DNS'), ('t2', 'd1', 'TCP'), ('t3', 'd2', 'Princípios'), ('tx', 'dx', 'Alheio');
    -- t1 e t2 apontam para a mesma coleção c1 (cartões não podem duplicar); t2 também para c2
    INSERT INTO exam_topic_collections VALUES ('t1', 'c1'), ('t2', 'c1'), ('t2', 'c2'), ('tx', 'cx');
  `);
  db.exec(MOCK_EXAM_SCHEMA);
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

test('nome: a disciplina vem primeiro; espaços repetidos viram um; nome longo é cortado no limite', () => {
  assert.equal(disciplineMockExamName('Redes  de Computadores', ' TRT-4 2026 '), 'Redes de Computadores — TRT-4 2026');
  const long = disciplineMockExamName('D'.repeat(60), 'E'.repeat(60));
  assert.equal(long.length, MAX_NAME_CHARS);
  assert.ok(long.endsWith('…'));
});

test('cria o simulado com os cartões das coleções ligadas, sem duplicar os de coleções ligadas a mais de um tópico', () => {
  const db = newDb();
  const result = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));

  assert.equal(result.created, true);
  assert.equal(result.added, 3);
  assert.equal(result.mockExam.name, 'Redes de Computadores — TRT-4 2026');
  assert.equal(result.mockExam.cardCount, 3);
  const detail = value(getMockExamDetail(db, 'u1', result.mockExam.id));
  assert.deepEqual(detail.cards.map((c) => c.id), ['f1', 'f2', 'f3'], 'por coleção, na ordem dos cartões');
});

test('chamar de novo atualiza o mesmo simulado: só entram os cartões novos', () => {
  const db = newDb();
  const first = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));

  const again = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));
  assert.equal(again.created, false);
  assert.equal(again.added, 0);
  assert.equal(again.mockExam.id, first.mockExam.id);

  db.prepare("INSERT INTO flashcards (id, collection_id, question, answer) VALUES ('f9', 'c2', 'Novo', 'Novo')").run();
  const updated = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));
  assert.equal(updated.added, 1);
  assert.equal(updated.mockExam.cardCount, 4);
  assert.equal(listMockExams(db, 'u1').length, 1, 'continua um só simulado');
});

test('atualizar não remove cartões; o que o usuário tirou à mão volta enquanto a coleção segue ligada', () => {
  const db = newDb();
  const first = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));
  value(removeCard(db, 'u1', first.mockExam.id, 'f1'));

  db.prepare("DELETE FROM exam_topic_collections WHERE collection_id = 'c2'").run(); // c2 deixou de estar ligada
  const again = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));
  assert.equal(again.added, 1, 'f1 volta');
  assert.deepEqual(value(getMockExamDetail(db, 'u1', first.mockExam.id)).cards.map((c) => c.id).sort(), ['f1', 'f2', 'f3'], 'f3 (da coleção desligada) continua lá');
});

test('um simulado do usuário com o mesmo nome é reaproveitado, sem diferenciar maiúsculas', () => {
  const db = newDb();
  const first = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));
  value(renameMockExam(db, 'u1', first.mockExam.id, 'REDES DE COMPUTADORES — trt-4 2026'));

  const again = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));
  assert.equal(again.created, false);
  assert.equal(again.mockExam.id, first.mockExam.id);
});

test('disciplina sem coleção ligada, ou ligada só a coleções vazias, é recusada e nada é criado', () => {
  const db = newDb();
  failure(mockExamFromDiscipline(db, 'u1', 'e1', 'd2'), 400, /Nenhuma coleção/);
  db.prepare("INSERT INTO collections VALUES ('c4', 'u1', 'Vazia')").run();
  db.prepare("INSERT INTO exam_topic_collections VALUES ('t3', 'c4')").run();
  failure(mockExamFromDiscipline(db, 'u1', 'e1', 'd2'), 400, /Nenhuma coleção/);
  assert.equal(listMockExams(db, 'u1').length, 0);
});

test('concurso ou disciplina inexistente, ou de outro usuário, dá 404', () => {
  const db = newDb();
  failure(mockExamFromDiscipline(db, 'u1', 'nao-existe', 'd1'), 404, /Concurso/);
  failure(mockExamFromDiscipline(db, 'u2', 'e1', 'd1'), 404, /Concurso/); // concurso de outro usuário
  failure(mockExamFromDiscipline(db, 'u1', 'e1', 'nao-existe'), 404, /Disciplina/);
  failure(mockExamFromDiscipline(db, 'u1', 'e1', 'dx'), 404, /Disciplina/); // disciplina de outro concurso
  assert.equal(listMockExams(db, 'u1').length, 0);
});

test('só entram cartões do próprio usuário, mesmo que o vínculo aponte para uma coleção alheia', () => {
  const db = newDb();
  db.prepare("INSERT INTO exam_topic_collections VALUES ('t1', 'cx')").run();
  const result = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));
  assert.deepEqual(value(getMockExamDetail(db, 'u1', result.mockExam.id)).cards.map((c) => c.id), ['f1', 'f2', 'f3']);
});

test('uma disciplina com mais de 500 cartões entra inteira, em mais de um lote', () => {
  const db = newDb();
  db.exec('BEGIN');
  const insert = db.prepare("INSERT INTO flashcards (id, collection_id, question, answer) VALUES (?, 'c1', 'P', 'R')");
  for (let i = 0; i < 600; i++) insert.run(`bulk${i}`);
  db.exec('COMMIT');
  const result = value(mockExamFromDiscipline(db, 'u1', 'e1', 'd1'));
  assert.equal(result.added, 603);
  assert.equal(result.mockExam.cardCount, 603);
});
