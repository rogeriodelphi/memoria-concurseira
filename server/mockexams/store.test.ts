import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { MOCK_EXAM_SCHEMA } from './schema';
import {
  addCards,
  createMockExam,
  deleteMockExam,
  getMockExamDetail,
  listMockExams,
  MAX_ATTEMPT_MS,
  MAX_NAME_CHARS,
  recordAttempt,
  removeCard,
  renameMockExam,
  type Result,
} from './store';

// Banco só em memória: as tabelas de que os simulados dependem, simplificadas, e o esquema real
// dos simulados. As chaves estrangeiras ficam ligadas (o padrão do node:sqlite) para provar as exclusões.
function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL);
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      question TEXT NOT NULL, answer TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'plain'
    );
    INSERT INTO users VALUES ('u1'), ('u2');
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes'), ('c2', 'u1', 'Direito'), ('c3', 'u2', 'Do outro');
    INSERT INTO flashcards (id, collection_id, question, answer) VALUES
      ('f1', 'c1', 'Pergunta 1', 'Resposta 1'), ('f2', 'c1', 'Pergunta 2', 'Resposta 2'),
      ('f3', 'c2', 'Pergunta 3', 'Resposta 3'), ('f4', 'c2', 'Pergunta 4', 'Resposta 4'),
      ('x1', 'c3', 'Cartão alheio', 'Resposta alheia');
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

const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

// ---------- listas ----------

test('criar: o nome é aparado e os espaços repetidos viram um', () => {
  const db = newDb();
  const created = value(createMockExam(db, 'u1', '  Direito   Administrativo '));
  assert.equal(created.name, 'Direito Administrativo');
  assert.equal(created.cardCount, 0);
  assert.equal(created.attemptCount, 0);
  assert.equal(created.lastAttempt, null);
});

test('criar: nome curto, vazio ou longo demais é recusado', () => {
  const db = newDb();
  failure(createMockExam(db, 'u1', 'a'), 400, /pelo menos/);
  failure(createMockExam(db, 'u1', '   '), 400);
  failure(createMockExam(db, 'u1', undefined), 400);
  failure(createMockExam(db, 'u1', 'a'.repeat(MAX_NAME_CHARS + 1)), 400, /passa de/);
  assert.ok(createMockExam(db, 'u1', 'a'.repeat(MAX_NAME_CHARS)).ok);
});

test('criar: o nome é único por usuário, sem diferenciar maiúsculas; outro usuário pode repetir', () => {
  const db = newDb();
  value(createMockExam(db, 'u1', 'Redes'));
  failure(createMockExam(db, 'u1', 'redes'), 409, /já tem/);
  failure(createMockExam(db, 'u1', '  REDES  '), 409);
  assert.ok(createMockExam(db, 'u2', 'Redes').ok);
});

test('listar: ordem alfabética, só do usuário, com contagens', () => {
  const db = newDb();
  const b = value(createMockExam(db, 'u1', 'banco de dados'));
  const a = value(createMockExam(db, 'u1', 'Algoritmos'));
  value(createMockExam(db, 'u2', 'De outro usuário'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2']));

  const list = listMockExams(db, 'u1');
  assert.deepEqual(
    list.map((m) => [m.name, m.cardCount]),
    [['Algoritmos', 2], [b.name, 0]],
  );
  assert.ok(list.every((m) => m.containsCard === undefined), 'sem cartão perguntado, não há "contém"');
});

test('listar para um cartão: cada simulado diz se já o tem', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Alfa'));
  const b = value(createMockExam(db, 'u1', 'Beta'));
  value(addCards(db, 'u1', b.id, ['f1']));

  const forF1 = listMockExams(db, 'u1', 'f1');
  assert.deepEqual(forF1.map((m) => [m.name, m.containsCard]), [['Alfa', false], ['Beta', true]]);
  assert.deepEqual(listMockExams(db, 'u1', 'f2').map((m) => m.containsCard), [false, false]);
  assert.equal(a.id !== b.id, true);
});

test('renomear: troca o nome, aceita só mudar maiúsculas, recusa nome de outra lista e lista alheia', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(createMockExam(db, 'u1', 'Direito'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2']));

  const renamed = value(renameMockExam(db, 'u1', a.id, 'Redes de computadores'));
  assert.equal(renamed.name, 'Redes de computadores');
  assert.equal(renamed.cardCount, 2, 'as contagens continuam certas');
  assert.equal(value(renameMockExam(db, 'u1', a.id, 'REDES DE COMPUTADORES')).name, 'REDES DE COMPUTADORES');
  failure(renameMockExam(db, 'u1', a.id, 'direito'), 409);
  failure(renameMockExam(db, 'u1', a.id, 'x'), 400);
  failure(renameMockExam(db, 'u2', a.id, 'Roubado'), 404);
  failure(renameMockExam(db, 'u1', 'nao-existe', 'Qualquer'), 404);
});

test('excluir: leva a lista, os cartões dela e o histórico, mas nunca os cartões em si', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2']));
  value(recordAttempt(db, 'u1', a.id, { durationMs: 1000, answers: [{ flashcardId: 'f1', correct: true }] }));

  failure(deleteMockExam(db, 'u2', a.id), 404);
  assert.equal(count(db, 'mock_exams'), 1, 'outro usuário não apaga');
  value(deleteMockExam(db, 'u1', a.id));
  assert.equal(count(db, 'mock_exams'), 0);
  assert.equal(count(db, 'mock_exam_cards'), 0);
  assert.equal(count(db, 'mock_exam_attempts'), 0);
  assert.equal(count(db, 'mock_exam_answers'), 0);
  assert.equal(count(db, 'flashcards'), 5, 'os cartões continuam existindo');
});

// ---------- cartões na lista ----------

test('adicionar: conta o que entrou e o que já estava, sem duplicar', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  assert.deepEqual(value(addCards(db, 'u1', a.id, ['f1', 'f2'])), { added: 2, alreadyInside: 0 });
  assert.deepEqual(value(addCards(db, 'u1', a.id, ['f2', 'f3', 'f3'])), { added: 1, alreadyInside: 1 });
  assert.equal(count(db, 'mock_exam_cards'), 3);
});

test('adicionar: ignora cartões de outro usuário; se nenhum é válido, é "não encontrado"', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  assert.deepEqual(value(addCards(db, 'u1', a.id, ['f1', 'x1', 'fantasma'])), { added: 1, alreadyInside: 0 });
  failure(addCards(db, 'u1', a.id, ['x1']), 404, /Cartão/);
  failure(addCards(db, 'u1', a.id, ['fantasma']), 404);
  assert.equal(count(db, 'mock_exam_cards'), 1);
});

test('adicionar: entrada inválida e lista alheia são recusadas', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  failure(addCards(db, 'u1', a.id, []), 400);
  failure(addCards(db, 'u1', a.id, 'f1'), 400);
  failure(addCards(db, 'u1', a.id, [1, 2]), 400);
  failure(addCards(db, 'u1', a.id, Array.from({ length: 501 }, (_, i) => `f${i}`)), 400, /no máximo/);
  failure(addCards(db, 'u2', a.id, ['x1']), 404, /Simulado/);
});

test('tirar um cartão da lista: some de lá, não do app; é idempotente e só no que é seu', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2']));
  value(removeCard(db, 'u1', a.id, 'f1'));
  value(removeCard(db, 'u1', a.id, 'f1'));
  failure(removeCard(db, 'u2', a.id, 'f2'), 404);
  assert.equal(count(db, 'mock_exam_cards'), 1);
  assert.equal(count(db, 'flashcards'), 5);
});

test('apagar um cartão o tira das listas', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2']));
  db.prepare("DELETE FROM flashcards WHERE id = 'f1'").run();
  assert.deepEqual(value(getMockExamDetail(db, 'u1', a.id)).cards.map((c) => c.id), ['f2']);
});

// ---------- detalhe ----------

test('detalhe: os cartões vêm com o texto e a coleção, na ordem em que foram adicionados', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Misto'));
  value(addCards(db, 'u1', a.id, ['f3']));
  value(addCards(db, 'u1', a.id, ['f1']));
  const detail = value(getMockExamDetail(db, 'u1', a.id));
  assert.deepEqual(
    detail.cards.map((c) => ({ ...c })),
    [
      { id: 'f3', question: 'Pergunta 3', answer: 'Resposta 3', format: 'plain', collectionId: 'c2', collectionName: 'Direito' },
      { id: 'f1', question: 'Pergunta 1', answer: 'Resposta 1', format: 'plain', collectionId: 'c1', collectionName: 'Redes' },
    ],
  );
  assert.deepEqual(detail.attempts, []);
  assert.deepEqual(detail.lastWrongFlashcardIds, []);
  failure(getMockExamDetail(db, 'u2', a.id), 404);
});

// ---------- tentativas ----------

test('tentativa: o placar é refeito pelo servidor a partir das respostas', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2', 'f3']));
  const attempt = value(
    recordAttempt(db, 'u1', a.id, {
      durationMs: 65_000,
      total: 99, // o que o navegador "acha" que é o total não conta
      correct: 99,
      answers: [
        { flashcardId: 'f1', correct: true, durationMs: 4000 },
        { flashcardId: 'f2', correct: false, durationMs: 9000 },
        { flashcardId: 'f3', correct: true },
      ],
    }),
  );
  assert.equal(attempt.total, 3);
  assert.equal(attempt.correct, 2);
  assert.equal(attempt.durationMs, 65_000);
  assert.equal(count(db, 'mock_exam_answers'), 3);
});

test('tentativa: ignora cartão que não é da lista, resposta repetida e lixo', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2']));
  const attempt = value(
    recordAttempt(db, 'u1', a.id, {
      durationMs: 1000,
      answers: [
        { flashcardId: 'f1', correct: true },
        { flashcardId: 'f1', correct: false }, // repetido: vale o primeiro
        { flashcardId: 'f3', correct: true }, // existe, mas não está nesta lista
        { flashcardId: 'x1', correct: true }, // de outro usuário
        { flashcardId: 'f2', correct: 'sim' }, // correct não é booleano
        { correct: true },
        null,
      ],
    }),
  );
  assert.equal(attempt.total, 1);
  assert.equal(attempt.correct, 1);
});

test('tentativa: sem nenhuma resposta válida, lista alheia e corpo inválido são recusados', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1']));
  failure(recordAttempt(db, 'u1', a.id, { answers: [] }), 400);
  failure(recordAttempt(db, 'u1', a.id, {}), 400);
  failure(recordAttempt(db, 'u1', a.id, null), 400);
  failure(recordAttempt(db, 'u1', a.id, { answers: [{ flashcardId: 'f3', correct: true }] }), 400, /Nenhuma resposta/);
  failure(recordAttempt(db, 'u2', a.id, { answers: [{ flashcardId: 'f1', correct: true }] }), 404);
  assert.equal(count(db, 'mock_exam_attempts'), 0, 'nada foi gravado');
});

test('tentativa: a duração é limitada e valores absurdos não viram tempo', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1']));
  const answers = [{ flashcardId: 'f1', correct: true }];
  assert.equal(value(recordAttempt(db, 'u1', a.id, { durationMs: 10 ** 12, answers })).durationMs, MAX_ATTEMPT_MS);
  assert.equal(value(recordAttempt(db, 'u1', a.id, { durationMs: -5, answers })).durationMs, 0);
  assert.equal(value(recordAttempt(db, 'u1', a.id, { durationMs: 'rápido', answers })).durationMs, 0);
  assert.equal(value(recordAttempt(db, 'u1', a.id, { answers })).durationMs, 0);
});

test('histórico: a tentativa mais recente vem primeiro, com os cartões errados dela', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2', 'f3']));
  value(
    recordAttempt(db, 'u1', a.id, {
      durationMs: 1000,
      answers: [{ flashcardId: 'f1', correct: false }, { flashcardId: 'f2', correct: false }, { flashcardId: 'f3', correct: true }],
    }, new Date('2026-10-14T10:00:00Z')),
  );
  value(
    recordAttempt(db, 'u1', a.id, {
      durationMs: 2000,
      answers: [{ flashcardId: 'f1', correct: true }, { flashcardId: 'f2', correct: false }, { flashcardId: 'f3', correct: true }],
    }, new Date('2026-10-14T11:00:00Z')),
  );

  const detail = value(getMockExamDetail(db, 'u1', a.id));
  assert.deepEqual(detail.attempts.map((t) => [t.total, t.correct, t.durationMs]), [[3, 2, 2000], [3, 1, 1000]]);
  assert.deepEqual(detail.lastWrongFlashcardIds, ['f2'], 'só o que errou na última vez');

  const summary = listMockExams(db, 'u1')[0];
  assert.equal(summary.attemptCount, 2);
  assert.deepEqual(summary.lastAttempt, { finishedAt: '2026-10-14T11:00:00.000Z', total: 3, correct: 2 });
});

test('os errados da última tentativa não incluem cartões que saíram da lista depois', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2']));
  value(
    recordAttempt(db, 'u1', a.id, {
      durationMs: 1,
      answers: [{ flashcardId: 'f1', correct: false }, { flashcardId: 'f2', correct: false }],
    }),
  );
  value(removeCard(db, 'u1', a.id, 'f1'));
  assert.deepEqual(value(getMockExamDetail(db, 'u1', a.id)).lastWrongFlashcardIds, ['f2']);
});

test('apagar um cartão preserva o placar do histórico; só o detalhe daquele cartão some', () => {
  const db = newDb();
  const a = value(createMockExam(db, 'u1', 'Redes'));
  value(addCards(db, 'u1', a.id, ['f1', 'f2']));
  value(
    recordAttempt(db, 'u1', a.id, {
      durationMs: 1,
      answers: [{ flashcardId: 'f1', correct: true }, { flashcardId: 'f2', correct: false }],
    }),
  );
  db.prepare("DELETE FROM flashcards WHERE id = 'f2'").run();

  const detail = value(getMockExamDetail(db, 'u1', a.id));
  assert.deepEqual(detail.attempts.map((t) => [t.total, t.correct]), [[2, 1]], 'o placar continua 1 de 2');
  assert.equal(count(db, 'mock_exam_answers'), 1);
  assert.deepEqual(detail.lastWrongFlashcardIds, []);
});
