import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { GeneratedFlashcard, GenerationOptions } from '../ai/router';
import type { Result } from '../mockexams/store';
import {
  collectionNames,
  DEFAULT_TOPIC_CARDS,
  generateTopicCards,
  parseTopicCardsQuantity,
  topicRequest,
  usableCards,
  type TopicCardsGenerator,
  type TopicCardsResult,
} from './topicCards';

// Banco só em memória, com as colunas reais das tabelas de que isto depende. O concurso e1 é do u1
// (Redes, com um tópico "Grupo: assunto" e um sem grupo, e Direito); o e2 é do u2.
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
      format TEXT NOT NULL DEFAULT 'plain', difficulty TEXT NOT NULL DEFAULT 'medio', source_page INTEGER, created_at TEXT NOT NULL
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
    INSERT INTO exams VALUES ('e1', 'u1', 'TRANSPETRO 2026', 'Analista de Sistemas', 'CESGRANRIO'), ('e2', 'u2', 'Do outro', '', '');
    INSERT INTO exam_disciplines VALUES ('d1', 'e1', 'Conhecimentos Específicos'), ('d2', 'e1', 'Língua Portuguesa'), ('dx', 'e2', 'Alheia');
    INSERT INTO exam_topics VALUES
      ('t1', 'd1', 'Redes de Computadores e Sistemas Distribuídos: Topologias'),
      ('t2', 'd2', 'Ortografia oficial'),
      ('tx', 'dx', 'Alheio');
  `);
  return db;
}

const card = (question: string, answer = 'Resposta', extra: Partial<GeneratedFlashcard> = {}): GeneratedFlashcard => ({
  question,
  answer,
  difficulty: 'medio',
  ...extra,
});

function fakeGenerator(cards: GeneratedFlashcard[] = [card('P1'), card('P2'), card('P3')]) {
  const calls: { topic: string; options: GenerationOptions }[] = [];
  const generate: TopicCardsGenerator = async (topic, options) => {
    calls.push({ topic, options });
    return { flashcards: cards };
  };
  return { generate, calls };
}

function value(result: Result<TopicCardsResult>): TopicCardsResult {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}
function failure(result: Result<TopicCardsResult>, status: number, message?: RegExp): void {
  assert.ok(!result.ok, 'devia falhar');
  assert.equal(result.status, status, result.error);
  if (message) assert.match(result.error, message);
}

const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number }).n;

test('nomes: "Grupo: assunto" vira nome e assunto; sem grupo, o nome é a disciplina', () => {
  assert.deepEqual(collectionNames('Conhecimentos Específicos', 'Redes de Computadores e Sistemas Distribuídos: Topologias'), {
    name: 'Redes de Computadores e Sistemas Distribuídos',
    subject: 'Topologias',
  });
  assert.deepEqual(collectionNames('Língua Portuguesa', 'Ortografia  oficial'), { name: 'Língua Portuguesa', subject: 'Ortografia oficial' });
  // só o primeiro ":" separa; o resto do título fica no assunto
  assert.deepEqual(collectionNames('D', 'Grupo: Tema: detalhe'), { name: 'Grupo', subject: 'Tema: detalhe' });
  // ":" no começo não é um grupo, e "Grupo:" sem assunto não deixa o assunto vazio
  assert.deepEqual(collectionNames('D', ': solto'), { name: 'D', subject: ': solto' });
  assert.deepEqual(collectionNames('D', 'Grupo:'), { name: 'Grupo', subject: 'Grupo:' });
  assert.equal(collectionNames('D', `G: ${'x'.repeat(400)}`).subject.length, 160);
});

test('pedido à IA: disciplina e tópico no texto, contexto da prova no foco, sem "undefined" nem vírgulas soltas', () => {
  const full = topicRequest({ name: 'TRANSPETRO 2026', position: 'Analista de Sistemas', board: 'CESGRANRIO' }, 'Língua Portuguesa', 'Ortografia oficial', 12);
  assert.equal(full.topic, 'Língua Portuguesa — Ortografia oficial');
  assert.equal(full.options.quantity, 12);
  assert.match(full.options.focus!, /concurso TRANSPETRO 2026, cargo Analista de Sistemas, banca CESGRANRIO/);
  assert.match(full.options.focus!, /não invente números de artigos/);

  const bare = topicRequest({ name: 'Concurso', position: '', board: '' }, 'D', 'T', 5);
  assert.match(bare.options.focus!, /\(concurso Concurso\)/);
  assert.doesNotMatch(bare.options.focus!, /undefined|, ,|cargo|banca/);

  assert.equal(topicRequest({ name: 'E', position: '', board: '' }, 'D', 'T'.repeat(400), 5).topic.length, 300);
});

test('quantidade: padrão quando falta; só inteiros entre 5 e 30', () => {
  assert.equal(parseTopicCardsQuantity(undefined), DEFAULT_TOPIC_CARDS);
  assert.equal(parseTopicCardsQuantity(null), DEFAULT_TOPIC_CARDS);
  assert.equal(parseTopicCardsQuantity(''), DEFAULT_TOPIC_CARDS);
  assert.equal(parseTopicCardsQuantity(5), 5);
  assert.equal(parseTopicCardsQuantity('30'), 30);
  for (const bad of [4, 31, 12.5, 'abc', -3, 0, NaN, {}]) assert.equal(parseTopicCardsQuantity(bad), null, String(bad));
});

test('cartões aproveitáveis: sem pergunta ou resposta saem, pergunta repetida sai, e o limite vale', () => {
  const cards = [
    card('  Qual é\n a porta do SSH? ', ' A 22. '),
    card('qual é a porta do ssh?', 'repetida (outra caixa)'),
    card('', 'sem pergunta'),
    card('Sem resposta', '   '),
    { question: 123, answer: 'tipo errado', difficulty: 'medio' } as unknown as GeneratedFlashcard,
    card('Terceira'),
    card('Quarta'),
  ];
  const kept = usableCards(cards, 2);
  assert.deepEqual(kept.map((c) => [c.question, c.answer]), [['Qual é a porta do SSH?', 'A 22.'], ['Terceira', 'Resposta']]);
  assert.equal(usableCards(cards, 10).length, 3);
  assert.deepEqual(usableCards([], 5), []);
});

test('gera: cria a coleção do tópico, com cartões, documento de origem e vínculo', async () => {
  const db = newDb();
  const { generate, calls } = fakeGenerator([card('P1', 'R1', { difficulty: 'facil', sourcePage: 3 }), card('P2', 'R2', { difficulty: 'dificil' }), card('P3')]);
  const result = value(await generateTopicCards(db, 'u1', 'e1', 't1', 10, generate, new Date('2026-10-17T12:00:00Z')));

  assert.equal(result.added, 3);
  assert.deepEqual(
    { name: result.collection.name, subject: result.collection.subject },
    { name: 'Redes de Computadores e Sistemas Distribuídos', subject: 'Topologias' },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].topic, 'Conhecimentos Específicos — Redes de Computadores e Sistemas Distribuídos: Topologias');
  assert.equal(calls[0].options.quantity, 10);

  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(result.collection.id) as Record<string, string>;
  assert.equal(collection.user_id, 'u1');
  assert.equal(collection.category, 'Concursos');
  assert.match(collection.description, /Gerada por IA/);
  assert.match(collection.description, /TRANSPETRO 2026/);
  assert.equal(collection.created_at, '2026-10-17T12:00:00.000Z');

  const document = db.prepare('SELECT * FROM documents WHERE collection_id = ?').get(result.collection.id) as Record<string, string | number>;
  assert.equal(document.source_type, 'topic');
  assert.equal(document.status, 'completed');

  const rows = db.prepare('SELECT question, answer, difficulty, source_page, document_id FROM flashcards WHERE collection_id = ? ORDER BY rowid').all(result.collection.id) as Record<string, unknown>[];
  assert.deepEqual(rows.map((r) => [r.question, r.answer, r.difficulty, r.source_page]), [['P1', 'R1', 'facil', 3], ['P2', 'R2', 'dificil', null], ['P3', 'Resposta', 'medio', null]]);
  assert.ok(rows.every((r) => r.document_id === document.id));

  const links = db.prepare('SELECT topic_id, collection_id FROM exam_topic_collections').all() as Record<string, string>[];
  assert.deepEqual(links.map((l) => [l.topic_id, l.collection_id]), [['t1', result.collection.id]]);
});

test('um tópico sem "Grupo:" usa a disciplina como nome da coleção', async () => {
  const db = newDb();
  const result = value(await generateTopicCards(db, 'u1', 'e1', 't2', undefined, fakeGenerator().generate));
  assert.deepEqual({ name: result.collection.name, subject: result.collection.subject }, { name: 'Língua Portuguesa', subject: 'Ortografia oficial' });
});

test('sem quantidade, usa a padrão; quantidade inválida é recusada antes de chamar a IA', async () => {
  const db = newDb();
  const { generate, calls } = fakeGenerator();
  failure(await generateTopicCards(db, 'u1', 'e1', 't1', 3, generate), 400, /5 a 30/);
  assert.equal(calls.length, 0);
  value(await generateTopicCards(db, 'u1', 'e1', 't1', undefined, generate));
  assert.equal(calls[0].options.quantity, DEFAULT_TOPIC_CARDS);
});

test('não chama a IA para concurso ou tópico que não são do usuário', async () => {
  const db = newDb();
  const { generate, calls } = fakeGenerator();
  failure(await generateTopicCards(db, 'u2', 'e1', 't1', 10, generate), 404, /Concurso/);
  failure(await generateTopicCards(db, 'u1', 'nao-existe', 't1', 10, generate), 404, /Concurso/);
  failure(await generateTopicCards(db, 'u1', 'e1', 'tx', 10, generate), 404, /Tópico/);
  failure(await generateTopicCards(db, 'u1', 'e1', 'nao-existe', 10, generate), 404, /Tópico/);
  assert.equal(calls.length, 0);
  assert.equal(count(db, 'collections'), 0);
});

test('tópico que já tem material: recusa sem chamar a IA e sem criar nada', async () => {
  const db = newDb();
  db.exec(`
    INSERT INTO collections (id, user_id, name, created_at, updated_at) VALUES ('c1', 'u1', 'Minha', 'x', 'x');
    INSERT INTO flashcards (id, collection_id, question, answer, created_at) VALUES ('f1', 'c1', 'P', 'R', 'x');
    INSERT INTO exam_topic_collections VALUES ('t1', 'c1');
  `);
  const { generate, calls } = fakeGenerator();
  failure(await generateTopicCards(db, 'u1', 'e1', 't1', 10, generate), 409, /já tem material/);
  assert.equal(calls.length, 0);
  assert.equal(count(db, 'collections'), 1);
});

test('tópico ligado só a uma coleção vazia ainda recebe cartões, e o vínculo antigo fica', async () => {
  const db = newDb();
  db.exec(`
    INSERT INTO collections (id, user_id, name, created_at, updated_at) VALUES ('vazia', 'u1', 'Vazia', 'x', 'x');
    INSERT INTO exam_topic_collections VALUES ('t1', 'vazia');
  `);
  const result = value(await generateTopicCards(db, 'u1', 'e1', 't1', 10, fakeGenerator().generate));
  const linked = (db.prepare('SELECT collection_id FROM exam_topic_collections WHERE topic_id = ? ORDER BY collection_id').all('t1') as { collection_id: string }[]).map((r) => r.collection_id);
  assert.deepEqual(linked, ['vazia', result.collection.id].sort());
});

test('a IA devolve só lixo: falha com 422 e não cria coleção, documento nem vínculo', async () => {
  const db = newDb();
  failure(await generateTopicCards(db, 'u1', 'e1', 't1', 10, fakeGenerator([card(''), card('P', '  ')]).generate), 422, /não devolveu cartões/);
  failure(await generateTopicCards(db, 'u1', 'e1', 't1', 10, fakeGenerator([]).generate), 422);
  for (const table of ['collections', 'documents', 'flashcards', 'exam_topic_collections']) assert.equal(count(db, table), 0, table);
});

test('a IA falha (cota, rede): o erro sobe e nada é criado', async () => {
  const db = newDb();
  const broken: TopicCardsGenerator = async () => {
    throw new Error('cota diária esgotada');
  };
  await assert.rejects(generateTopicCards(db, 'u1', 'e1', 't1', 10, broken), /cota diária/);
  for (const table of ['collections', 'documents', 'flashcards', 'exam_topic_collections']) assert.equal(count(db, table), 0, table);
});

test('se o tópico ganha material enquanto a IA trabalha, não duplica', async () => {
  const db = newDb();
  const racing: TopicCardsGenerator = async () => {
    db.exec(`
      INSERT INTO collections (id, user_id, name, created_at, updated_at) VALUES ('outra', 'u1', 'Outra', 'x', 'x');
      INSERT INTO flashcards (id, collection_id, question, answer, created_at) VALUES ('fo', 'outra', 'P', 'R', 'x');
      INSERT INTO exam_topic_collections VALUES ('t1', 'outra');
    `);
    return { flashcards: [card('P1'), card('P2')] };
  };
  failure(await generateTopicCards(db, 'u1', 'e1', 't1', 10, racing), 409, /já tem material/);
  assert.equal(count(db, 'collections'), 1, 'só a "outra"');
  assert.equal(count(db, 'flashcards'), 1);
  assert.equal(count(db, 'documents'), 0);
});

test('o limite de quantidade corta o que a IA mandar a mais', async () => {
  const db = newDb();
  const many = Array.from({ length: 40 }, (_, i) => card(`Pergunta ${i}`));
  const result = value(await generateTopicCards(db, 'u1', 'e1', 't1', 8, fakeGenerator(many).generate));
  assert.equal(result.added, 8);
  assert.equal(count(db, 'flashcards'), 8);
});
