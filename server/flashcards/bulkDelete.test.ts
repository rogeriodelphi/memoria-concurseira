import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { deleteOwnedFlashcards, MAX_BULK_DELETE, prepareBulkDelete } from './bulkDelete';

// Banco em memória com as chaves estrangeiras do app que importam aqui: o que depende do cartão sai junto com ele.
function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE flashcards (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE);
    CREATE TABLE study_sessions (id TEXT PRIMARY KEY, flashcard_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE);
  `);
  return db;
}

function seed(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO collections (id, user_id) VALUES ('mine', 'u1'), ('mine2', 'u1'), ('theirs', 'u2');
    INSERT INTO flashcards (id, collection_id) VALUES ('a', 'mine'), ('b', 'mine'), ('c', 'mine'), ('d', 'mine2'), ('x', 'theirs'), ('y', 'theirs');
    INSERT INTO study_sessions (id, flashcard_id) VALUES ('s1', 'a'), ('s2', 'a'), ('s3', 'c'), ('s4', 'x');
  `);
}

const ids = (db: DatabaseSync) => (db.prepare('SELECT id FROM flashcards ORDER BY id').all() as { id: string }[]).map((r) => r.id);
const sessions = (db: DatabaseSync) => (db.prepare('SELECT id FROM study_sessions ORDER BY id').all() as { id: string }[]).map((r) => r.id);

test('validar: aceita uma lista de textos e junta os repetidos', () => {
  assert.deepEqual(prepareBulkDelete({ flashcardIds: ['a', 'b', 'a'] }), { ok: true, value: ['a', 'b'] });
});

test('validar: sem lista, lista vazia ou corpo vazio é recusado e nada é apagado', () => {
  for (const body of [undefined, null, {}, { flashcardIds: [] }, { flashcardIds: 'a' }, { flashcardIds: { 0: 'a' } }]) {
    const result = prepareBulkDelete(body);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, 'Selecione ao menos um flashcard.');
    }
  }
});

test('validar: um item que não é texto (ou é vazio) recusa o pedido inteiro', () => {
  for (const flashcardIds of [['a', 7], ['a', null], ['a', ''], ['a', { id: 'b' }], [['a']]]) {
    const result = prepareBulkDelete({ flashcardIds });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'Lista de flashcards inválida.');
  }
});

test('validar: o teto do pedido (repetidos contam no teto, porque o corpo já veio grande)', () => {
  const cheio = Array.from({ length: MAX_BULK_DELETE }, (_, i) => `id${i}`);
  assert.equal(prepareBulkDelete({ flashcardIds: cheio }).ok, true);
  const result = prepareBulkDelete({ flashcardIds: [...cheio, 'a mais'] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /^Selecione no máximo 5000 flashcards por vez\.$/);
});

test('apagar: só os cartões pedidos saem, e o histórico deles vai junto', () => {
  const db = newDb();
  seed(db);
  assert.equal(deleteOwnedFlashcards(db, 'u1', ['a', 'c']), 2);
  assert.deepEqual(ids(db), ['b', 'd', 'x', 'y']);
  assert.deepEqual(sessions(db), ['s4'], 'as revisões de a e c saíram; a de outro usuário ficou');
});

test('apagar: cartões de coleções diferentes do mesmo usuário saem na mesma chamada', () => {
  const db = newDb();
  seed(db);
  assert.equal(deleteOwnedFlashcards(db, 'u1', ['b', 'd']), 2);
  assert.deepEqual(ids(db), ['a', 'c', 'x', 'y']);
});

test('apagar: cartão de outro usuário nunca é apagado, mesmo que o id venha no pedido', () => {
  const db = newDb();
  seed(db);
  assert.equal(deleteOwnedFlashcards(db, 'u1', ['x', 'y']), 0);
  assert.deepEqual(ids(db), ['a', 'b', 'c', 'd', 'x', 'y']);
  assert.equal(deleteOwnedFlashcards(db, 'u1', ['a', 'x']), 1, 'conta só o que era dele');
  assert.deepEqual(ids(db), ['b', 'c', 'd', 'x', 'y']);
});

test('apagar: ids que não existem não contam e não atrapalham', () => {
  const db = newDb();
  seed(db);
  assert.equal(deleteOwnedFlashcards(db, 'u1', ['nao-existe', 'b']), 1);
  assert.deepEqual(ids(db), ['a', 'c', 'd', 'x', 'y']);
  assert.equal(deleteOwnedFlashcards(db, 'u1', ['b']), 0, 'pedir de novo não muda nada');
});

test('apagar: uma lista maior que o bloco da consulta (500) é apagada inteira', () => {
  const db = newDb();
  db.exec(`INSERT INTO collections (id, user_id) VALUES ('big', 'u1'), ('other', 'u2')`);
  const insert = db.prepare('INSERT INTO flashcards (id, collection_id) VALUES (?, ?)');
  const todos = Array.from({ length: 1234 }, (_, i) => `f${i}`);
  for (const id of todos) insert.run(id, 'big');
  insert.run('keep', 'other');
  assert.equal(deleteOwnedFlashcards(db, 'u1', todos), 1234);
  assert.deepEqual(ids(db), ['keep']);
});

test('apagar: se um bloco falha, o que os blocos anteriores já apagaram é desfeito (tudo ou nada)', () => {
  const db = newDb();
  db.exec(`INSERT INTO collections (id, user_id) VALUES ('big', 'u1')`);
  const insert = db.prepare('INSERT INTO flashcards (id, collection_id) VALUES (?, ?)');
  const todos = Array.from({ length: 1000 }, (_, i) => `f${i}`);
  for (const id of todos) insert.run(id, 'big');
  db.exec(`INSERT INTO study_sessions (id, flashcard_id) VALUES ('s0', 'f0'), ('s9', 'f999')`);
  // O cartão f700 cai no segundo bloco (de 500 a 999): o primeiro já foi apagado quando o segundo derruba o pedido.
  db.exec(`CREATE TRIGGER bloqueia BEFORE DELETE ON flashcards WHEN OLD.id = 'f700' BEGIN SELECT RAISE(ABORT, 'bloqueado'); END;`);
  assert.throws(() => deleteOwnedFlashcards(db, 'u1', todos), /bloqueado/);
  assert.equal(ids(db).length, 1000, 'nenhum cartão saiu, nem os do bloco que tinha dado certo');
  assert.deepEqual(sessions(db), ['s0', 's9']);
  // e a conexão continua utilizável (a transação foi desfeita, não ficou aberta)
  db.exec('DROP TRIGGER bloqueia');
  assert.equal(deleteOwnedFlashcards(db, 'u1', ['f0']), 1);
});
