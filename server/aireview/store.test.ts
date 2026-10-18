import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { Result } from '../mockexams/store';
import { AI_REVIEW_SCHEMA } from './schema';
import {
  approveDrafts,
  countDrafts,
  discardDrafts,
  draftCountsByTopic,
  editDraft,
  GENERATED_DESCRIPTION_PREFIX,
  insertDrafts,
  listDraftGroups,
  MAX_BATCH,
  MAX_DRAFT_CHARS,
} from './store';

// Banco em memória com as colunas reais das tabelas de que isto depende. u1 tem o concurso e1 (tópico t1 em d1,
// t2 em d2) e as coleções g1 (gerada por IA para t1), g2 (gerada para t2) e minha (do usuário); u2 tem g3.
function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE collections (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Outros',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, filename TEXT NOT NULL,
      size INTEGER NOT NULL, pages INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', error_message TEXT,
      source_type TEXT NOT NULL DEFAULT 'file', created_at TEXT NOT NULL
    );
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      document_id TEXT REFERENCES documents(id) ON DELETE SET NULL, question TEXT NOT NULL, answer TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'plain', difficulty TEXT NOT NULL DEFAULT 'medio', source_page INTEGER, due_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, position TEXT NOT NULL DEFAULT '', board TEXT NOT NULL DEFAULT '');
    CREATE TABLE exam_disciplines (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, name TEXT NOT NULL);
    CREATE TABLE exam_topics (id TEXT PRIMARY KEY, discipline_id TEXT NOT NULL REFERENCES exam_disciplines(id) ON DELETE CASCADE, title TEXT NOT NULL);
    CREATE TABLE exam_topic_collections (
      topic_id TEXT NOT NULL REFERENCES exam_topics(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      PRIMARY KEY (topic_id, collection_id)
    );
    INSERT INTO users VALUES ('u1'), ('u2');
    INSERT INTO collections (id, user_id, name, subject, description, created_at, updated_at) VALUES
      ('g1', 'u1', 'Redes', 'Topologias', '${GENERATED_DESCRIPTION_PREFIX} a partir do tópico X', 'x', 'x'),
      ('g2', 'u1', 'Direito', 'Princípios', '${GENERATED_DESCRIPTION_PREFIX} a partir do tópico Y', 'x', 'x'),
      ('minha', 'u1', 'Minha', '', 'Coleção do próprio usuário', 'x', 'x'),
      ('g3', 'u2', 'Do outro', '', '${GENERATED_DESCRIPTION_PREFIX} a partir do tópico Z', 'x', 'x');
    INSERT INTO documents (id, collection_id, filename, size, source_type, created_at) VALUES ('doc1', 'g1', 'Topologias', 0, 'topic', 'x');
    INSERT INTO exams VALUES ('e1', 'u1', 'TRANSPETRO 2026', 'Analista de Sistemas', 'CESGRANRIO'), ('e2', 'u1', 'Outro concurso', '', '');
    INSERT INTO exam_disciplines VALUES ('d1', 'e1', 'Conhecimentos Específicos'), ('d2', 'e1', 'Direito'), ('d3', 'e2', 'Outra');
    INSERT INTO exam_topics VALUES ('t1', 'd1', 'Redes: Topologias'), ('t2', 'd2', 'Princípios fundamentais'), ('t3', 'd3', 'Alheio');
    INSERT INTO exam_topic_collections VALUES ('t1', 'g1'), ('t2', 'g2');
  `);
  db.exec(AI_REVIEW_SCHEMA);
  return db;
}

const NOW = new Date('2026-10-18T09:00:00Z');
const card = (question: string, answer = `R de ${question}`, difficulty = 'medio') => ({ question, answer, difficulty });

/** Rascunhos para a coleção g1 (documento doc1, tópico t1) e devolve os ids. */
function draftsFor(db: DatabaseSync, cards: ReturnType<typeof card>[], collection = 'g1', topic: string | null = 't1', user = 'u1', document: string | null = 'doc1') {
  return insertDrafts(db, user, { collectionId: collection, documentId: document, topicId: topic }, cards, NOW);
}
const count = (db: DatabaseSync, table: string, where = '1=1') => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
const value = <T>(r: Result<T>): T => {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.value;
};
const failure = <T>(r: Result<T>, status: number, message?: RegExp) => {
  assert.ok(!r.ok, 'devia falhar');
  assert.equal(r.status, status, r.error);
  if (message) assert.match(r.error, message);
};

// ---------- guardar e listar ----------

test('guardar: os rascunhos ficam com todos os campos, na ordem, e contam para o usuário', () => {
  const db = newDb();
  const ids = draftsFor(db, [card('P1', 'R1', 'facil'), card('P2'), card('P3')]);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.equal(countDrafts(db, 'u1'), 3);
  assert.equal(countDrafts(db, 'u2'), 0);
  const rows = db.prepare('SELECT * FROM ai_card_drafts ORDER BY rowid').all() as Record<string, unknown>[];
  assert.deepEqual(rows.map((r) => [r.question, r.answer, r.difficulty]), [['P1', 'R1', 'facil'], ['P2', 'R de P2', 'medio'], ['P3', 'R de P3', 'medio']]);
  assert.ok(rows.every((r) => r.user_id === 'u1' && r.collection_id === 'g1' && r.topic_id === 't1' && r.document_id === 'doc1' && r.verdict === null && r.created_at === NOW.toISOString()));
});

test('guardar: sem tópico nem documento também vale', () => {
  const db = newDb();
  draftsFor(db, [card('P1')], 'minha', null, 'u1', null);
  assert.equal(countDrafts(db, 'u1'), 1);
});

test('contagem por tópico: só os do concurso pedido, só os que têm', () => {
  const db = newDb();
  draftsFor(db, [card('A'), card('B')], 'g1', 't1');
  draftsFor(db, [card('C')], 'g2', 't2');
  assert.deepEqual(draftCountsByTopic(db, 'u1', 'e1'), { t1: 2, t2: 1 });
  assert.deepEqual(draftCountsByTopic(db, 'u1', 'e2'), {});
  assert.deepEqual(draftCountsByTopic(db, 'u2', 'e1'), {}, 'de outro usuário não aparece');
});

test('lista: agrupa por coleção, com o tópico, o concurso e os rascunhos na ordem em que a IA escreveu', () => {
  const db = newDb();
  draftsFor(db, [card('A1'), card('A2')], 'g1', 't1');
  insertDrafts(db, 'u1', { collectionId: 'g2', documentId: null, topicId: 't2' }, [card('B1')], new Date('2026-10-19T09:00:00Z'));
  const groups = listDraftGroups(db, 'u1');
  assert.deepEqual(groups.map((g) => g.collection.id), ['g2', 'g1'], 'a geração mais recente primeiro');
  assert.deepEqual(groups[1].topic, { id: 't1', title: 'Redes: Topologias', discipline: 'Conhecimentos Específicos', examId: 'e1', examName: 'TRANSPETRO 2026' });
  assert.deepEqual(groups[1].drafts.map((d) => d.question), ['A1', 'A2']);
  assert.deepEqual(groups[1].collection, { id: 'g1', name: 'Redes', subject: 'Topologias' });
  assert.deepEqual(groups[0].drafts[0], { id: groups[0].drafts[0].id, question: 'B1', answer: 'R de B1', difficulty: 'medio', verdict: null, verdictNote: null });
});

test('lista: só os do próprio usuário; tópico apagado vira "sem tópico"; veredito desconhecido some', () => {
  const db = newDb();
  draftsFor(db, [card('A1')], 'g1', 't1');
  draftsFor(db, [card('X1')], 'g3', null, 'u2', null);
  assert.equal(listDraftGroups(db, 'u1').length, 1);
  assert.equal(listDraftGroups(db, 'u2').length, 1);

  db.exec("DELETE FROM exam_topics WHERE id = 't1'");
  assert.equal(listDraftGroups(db, 'u1')[0].topic, null, 'o rascunho continua, só perde o tópico');
  assert.equal(countDrafts(db, 'u1'), 1);

  db.exec("UPDATE ai_card_drafts SET verdict = 'lixo' WHERE user_id = 'u1'");
  assert.equal(listDraftGroups(db, 'u1')[0].drafts[0].verdict, null);
});

// ---------- editar ----------

test('editar: troca pergunta e resposta, tira espaços e normaliza as quebras de linha', () => {
  const db = newDb();
  const [id] = draftsFor(db, [card('P1', 'R1')]);
  const edited = value(editDraft(db, 'u1', id, { question: '  Nova pergunta?  ', answer: 'Linha 1\r\nLinha 2 ' }));
  assert.deepEqual([edited.question, edited.answer], ['Nova pergunta?', 'Linha 1\nLinha 2']);
  const row = db.prepare('SELECT question, answer FROM ai_card_drafts WHERE id = ?').get(id) as Record<string, string>;
  assert.deepEqual([row.question, row.answer], ['Nova pergunta?', 'Linha 1\nLinha 2']);
  // só um dos lados
  assert.equal(value(editDraft(db, 'u1', id, { answer: 'Outra' })).question, 'Nova pergunta?');
});

test('editar: vazio, grande demais ou de outro usuário é recusado e não muda nada', () => {
  const db = newDb();
  const [id] = draftsFor(db, [card('P1', 'R1')]);
  failure(editDraft(db, 'u1', id, { question: '   ' }), 400, /não podem ficar vazias/);
  failure(editDraft(db, 'u1', id, { answer: '' }), 400);
  failure(editDraft(db, 'u1', id, { question: 42 }), 400);
  failure(editDraft(db, 'u1', id, { answer: 'x'.repeat(MAX_DRAFT_CHARS + 1) }), 400, /no máximo/);
  assert.ok(editDraft(db, 'u1', id, { answer: 'x'.repeat(MAX_DRAFT_CHARS) }).ok);
  failure(editDraft(db, 'u2', id, { question: 'invadido' }), 404, /não encontrado/);
  failure(editDraft(db, 'u1', 'nao-existe', { question: 'x' }), 404);
  const row = db.prepare('SELECT question FROM ai_card_drafts WHERE id = ?').get(id) as Record<string, string>;
  assert.equal(row.question, 'P1');
});

test('editar: mudar o texto apaga a segunda opinião (valia para o texto antigo); não mudar, mantém', () => {
  const db = newDb();
  const [id] = draftsFor(db, [card('P1', 'R1')]);
  db.prepare("UPDATE ai_card_drafts SET verdict = 'erro', verdict_note = 'A lei é outra' WHERE id = ?").run(id);
  const same = value(editDraft(db, 'u1', id, { question: 'P1', answer: 'R1' }));
  assert.deepEqual([same.verdict, same.verdictNote], ['erro', 'A lei é outra']);
  const changed = value(editDraft(db, 'u1', id, { answer: 'R1 corrigida' }));
  assert.deepEqual([changed.verdict, changed.verdictNote], [null, null]);
  const row = db.prepare('SELECT verdict, verdict_note FROM ai_card_drafts WHERE id = ?').get(id) as Record<string, string | null>;
  assert.deepEqual([row.verdict, row.verdict_note], [null, null]);
});

// ---------- aprovar ----------

test('aprovar: o rascunho vira cartão comum na coleção, com o documento, e sai da lista', () => {
  const db = newDb();
  const [a, b, c] = draftsFor(db, [card('P1', 'R1', 'facil'), card('P2'), card('P3')]);
  const result = value(approveDrafts(db, 'u1', { ids: [a, c] }, new Date('2026-10-18T12:00:00Z')));
  assert.deepEqual(result, { approved: 2, duplicates: 0 });
  const cards = db.prepare('SELECT collection_id, document_id, question, answer, format, difficulty, due_at, created_at FROM flashcards ORDER BY rowid').all() as Record<string, unknown>[];
  assert.deepEqual(cards.map((x) => [x.question, x.answer, x.difficulty]), [['P1', 'R1', 'facil'], ['P3', 'R de P3', 'medio']]);
  assert.ok(cards.every((x) => x.collection_id === 'g1' && x.document_id === 'doc1' && x.format === 'plain' && x.due_at === null), 'cartão novo comum: ainda não estudado');
  assert.ok(cards.every((x) => x.created_at === NOW.toISOString()), 'mantém a data em que a IA o escreveu (a ordem dos novos)');
  assert.equal(countDrafts(db, 'u1'), 1);
  assert.deepEqual(listDraftGroups(db, 'u1')[0].drafts.map((d) => d.id), [b]);
  const collection = db.prepare("SELECT updated_at FROM collections WHERE id = 'g1'").get() as Record<string, string>;
  assert.equal(collection.updated_at, '2026-10-18T12:00:00.000Z');
});

test('aprovar todos de uma coleção', () => {
  const db = newDb();
  draftsFor(db, [card('P1'), card('P2'), card('P3')]);
  draftsFor(db, [card('Q1')], 'g2', 't2');
  assert.deepEqual(value(approveDrafts(db, 'u1', { collectionId: 'g1' })), { approved: 3, duplicates: 0 });
  assert.equal(count(db, 'flashcards', "collection_id = 'g1'"), 3);
  assert.equal(count(db, 'ai_card_drafts', "collection_id = 'g2'"), 1, 'a outra coleção não foi tocada');
});

test('aprovar: pergunta que já existe na coleção não duplica (e o rascunho some)', () => {
  const db = newDb();
  db.exec("INSERT INTO flashcards (id, collection_id, question, answer, created_at) VALUES ('f1', 'g1', 'Qual a  topologia   em estrela?', 'x', 'x')");
  draftsFor(db, [card('qual a topologia em ESTRELA?'), card('Outra pergunta')]);
  assert.deepEqual(value(approveDrafts(db, 'u1', { collectionId: 'g1' })), { approved: 1, duplicates: 1 });
  assert.equal(count(db, 'flashcards', "collection_id = 'g1'"), 2);
  assert.equal(countDrafts(db, 'u1'), 0);
});

test('aprovar: só os rascunhos do próprio usuário (ids de outro são ignorados; sem nenhum seu, 404)', () => {
  const db = newDb();
  const mine = draftsFor(db, [card('P1')]);
  const theirs = draftsFor(db, [card('X1')], 'g3', null, 'u2', null);
  assert.deepEqual(value(approveDrafts(db, 'u1', { ids: [...mine, ...theirs] })), { approved: 1, duplicates: 0 });
  assert.equal(count(db, 'ai_card_drafts', "user_id = 'u2'"), 1, 'o do outro continua');
  assert.equal(count(db, 'flashcards', "collection_id = 'g3'"), 0);
  failure(approveDrafts(db, 'u1', { ids: theirs }), 404);
  failure(approveDrafts(db, 'u1', { collectionId: 'g3' }), 404, /não encontrados/);
  failure(approveDrafts(db, 'u1', { collectionId: 'nao-existe' }), 404);
});

test('aprovar: o mesmo id repetido conta uma vez', () => {
  const db = newDb();
  const [id] = draftsFor(db, [card('P1')]);
  assert.deepEqual(value(approveDrafts(db, 'u1', { ids: [id, id, id] })), { approved: 1, duplicates: 0 });
  assert.equal(count(db, 'flashcards'), 1);
});

test('pedido mal formado é recusado: sem escolha, lista vazia, tipos errados, lotes enormes', () => {
  const db = newDb();
  draftsFor(db, [card('P1')]);
  for (const selector of [{}, { ids: [] }, { ids: 'x' }, { ids: [1, 2] }, { ids: [''] }, { ids: ['a'.repeat(65)] }, { ids: Array.from({ length: MAX_BATCH + 1 }, (_, i) => `id${i}`) }, { collectionId: '' }, { collectionId: 5 }]) {
    failure(approveDrafts(db, 'u1', selector), 400, /Escolha os cartões/);
    failure(discardDrafts(db, 'u1', selector), 400);
  }
  assert.equal(countDrafts(db, 'u1'), 1, 'nada mudou');
  assert.equal(count(db, 'flashcards'), 0);
});

// ---------- descartar ----------

test('descartar: apaga só os escolhidos', () => {
  const db = newDb();
  const [a, b, c] = draftsFor(db, [card('P1'), card('P2'), card('P3')]);
  assert.deepEqual(value(discardDrafts(db, 'u1', { ids: [a, c] })), { discarded: 2 });
  assert.deepEqual(listDraftGroups(db, 'u1')[0].drafts.map((d) => d.id), [b]);
  assert.equal(count(db, 'flashcards'), 0, 'descartar não cria cartão');
  assert.equal(count(db, 'collections', "id = 'g1'"), 1, 'ainda há um rascunho: a coleção fica');
});

test('descartar tudo de uma coleção de IA vazia: ela sai, com o vínculo ao tópico (que volta a poder receber cartões)', () => {
  const db = newDb();
  draftsFor(db, [card('P1'), card('P2')]);
  assert.deepEqual(value(discardDrafts(db, 'u1', { collectionId: 'g1' })), { discarded: 2 });
  assert.equal(count(db, 'collections', "id = 'g1'"), 0);
  assert.equal(count(db, 'exam_topic_collections', "topic_id = 't1'"), 0);
  assert.equal(count(db, 'documents', "collection_id = 'g1'"), 0, 'o documento de origem vai junto');
  assert.equal(count(db, 'collections', "id = 'g2'"), 1, 'as outras ficam');
});

test('descartar nunca apaga coleção do usuário, nem uma de IA que já tem cartões', () => {
  const db = newDb();
  draftsFor(db, [card('P1')], 'minha', null, 'u1', null);
  discardDrafts(db, 'u1', { collectionId: 'minha' });
  assert.equal(count(db, 'collections', "id = 'minha'"), 1, 'sem a descrição de geração por IA, é do usuário');

  db.exec("INSERT INTO flashcards (id, collection_id, question, answer, created_at) VALUES ('f1', 'g1', 'Já aprovado', 'R', 'x')");
  draftsFor(db, [card('P2')]);
  discardDrafts(db, 'u1', { collectionId: 'g1' });
  assert.equal(count(db, 'collections', "id = 'g1'"), 1, 'tem cartão aprovado: fica');
});

test('aprovar tudo não apaga a coleção; e se só havia duplicatas, a coleção de IA vazia sai', () => {
  const db = newDb();
  draftsFor(db, [card('P1')]);
  value(approveDrafts(db, 'u1', { collectionId: 'g1' }));
  assert.equal(count(db, 'collections', "id = 'g1'"), 1);

  // g2 (de IA) sem cartões e com um rascunho cuja pergunta "existe": a coleção ainda tem o cartão que causou a duplicata, então fica
  db.exec("INSERT INTO flashcards (id, collection_id, question, answer, created_at) VALUES ('f9', 'g2', 'Igual', 'R', 'x')");
  draftsFor(db, [card('Igual')], 'g2', 't2');
  assert.deepEqual(value(approveDrafts(db, 'u1', { collectionId: 'g2' })), { approved: 0, duplicates: 1 });
  assert.equal(count(db, 'collections', "id = 'g2'"), 1);
});

test('descartar: de outro usuário é 404 e não apaga nada', () => {
  const db = newDb();
  const theirs = draftsFor(db, [card('X1')], 'g3', null, 'u2', null);
  failure(discardDrafts(db, 'u1', { ids: theirs }), 404);
  failure(discardDrafts(db, 'u1', { collectionId: 'g3' }), 404);
  assert.equal(countDrafts(db, 'u2'), 1);
  assert.equal(count(db, 'collections', "id = 'g3'"), 1);
});

// ---------- vida dos rascunhos ----------

test('apagar a coleção, o usuário ou o documento: rascunhos somem com a coleção e o usuário; o documento só solta o vínculo', () => {
  const db = newDb();
  draftsFor(db, [card('P1')], 'g1', 't1');
  db.exec("DELETE FROM documents WHERE id = 'doc1'");
  assert.equal(countDrafts(db, 'u1'), 1, 'sem o documento de origem o rascunho continua');
  assert.equal((db.prepare('SELECT document_id FROM ai_card_drafts').get() as { document_id: string | null }).document_id, null);
  db.exec("DELETE FROM collections WHERE id = 'g1'");
  assert.equal(countDrafts(db, 'u1'), 0);

  draftsFor(db, [card('P2')], 'g2', 't2', 'u1', null); // o documento doc1 já foi apagado acima
  db.exec("DELETE FROM users WHERE id = 'u1'");
  assert.equal(count(db, 'ai_card_drafts'), 0);
});
