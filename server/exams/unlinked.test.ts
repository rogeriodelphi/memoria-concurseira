import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  buildUnlinked,
  IGNORED_COLLECTIONS_SCHEMA,
  loadIgnoredIds,
  MAX_SUGGESTIONS,
  setCollectionIgnored,
  suggestTopics,
  type CollectionRef,
  type TopicRef,
} from './unlinked';

const topic = (id: string, title: string, over: Partial<TopicRef> = {}): TopicRef => ({ id, title, discipline: 'Conhecimentos Específicos', hasMaterial: false, ...over });
const coll = (id: string, name: string, subject: string, cards = 10, over: Partial<CollectionRef> = {}): CollectionRef => ({ id, name, subject, cards, newCards: cards, dueCards: 0, ...over });

test('a coleção cujo assunto é o tópico (MFA): sugestão forte, e os tópicos sem parecido não entram', () => {
  const c = coll('c1', 'Segurança da Informação', 'MFA (Autenticação Multifator)');
  const { suggestions, tied } = suggestTopics(c, [topic('t1', 'Ambiente Microsoft Windows 11: IIS'), topic('t2', 'MFA'), topic('t3', 'SSO')]);
  assert.equal(tied, 0);
  assert.deepEqual(suggestions.map((s) => [s.topicId, s.strong, s.score]), [['t2', true, 1]]);
  assert.equal(suggestions[0].title, 'MFA');
  assert.equal(suggestions[0].discipline, 'Conhecimentos Específicos');
});

test('o nome da coleção pesa menos que o assunto: casa, mas não passa de "provável"', () => {
  const c = coll('c1', 'Segurança da Informação', 'Variadas');
  const { suggestions } = suggestTopics(c, [topic('t1', 'Segurança da Informação: Criptografia')]);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].score, 0.8);
  assert.equal(suggestions[0].strong, false);
});

test('a coleção que trata da disciplina toda casa com muitos tópicos empatados: sem sugestão, só o número', () => {
  const c = coll('c1', 'Redes de Computadores', 'Variadas');
  const topics = ['Modelo OSI da ISO', 'Noções básicas de IPv6', 'Equipamentos de conexão', 'Redes sem fio', 'Protocolos TCP/IP'].map((s, i) =>
    topic(`t${i}`, `Redes de Computadores e Sistemas Distribuídos: ${s}`),
  );
  const many = suggestTopics(c, topics);
  assert.deepEqual(many, { suggestions: [], tied: 5 });

  // Até o limite de sugestões, não é sorteio: entram todos, na ordem do edital.
  const few = suggestTopics(c, topics.slice(0, MAX_SUGGESTIONS));
  assert.equal(few.tied, 0);
  assert.deepEqual(few.suggestions.map((s) => s.topicId), ['t0', 't1', 't2']);
});

test('um parecido mais forte vence o empate de muitos fracos', () => {
  const c = coll('c1', 'Redes de Computadores', 'Redes Sem Fio');
  const topics = [
    ...['A', 'B', 'C', 'D'].map((s, i) => topic(`r${i}`, `Redes de Computadores e Sistemas Distribuídos: ${s}`)),
    topic('wifi', 'Redes Sem Fio'),
  ];
  const { suggestions, tied } = suggestTopics(c, topics);
  assert.equal(tied, 0, 'o topo é um só (o assunto bate)');
  assert.equal(suggestions[0].topicId, 'wifi');
  assert.equal(suggestions[0].strong, true);
  assert.equal(suggestions.length, 1, 'com um forte, os parecidos só pelo nome (a disciplina toda) não aparecem');
});

test('sem nenhum forte, os prováveis aparecem até o limite, do mais parecido ao menos', () => {
  const c = coll('c1', 'Redes de Computadores', 'Variadas');
  const { suggestions, tied } = suggestTopics(c, [
    topic('t1', 'Redes de Computadores e Sistemas Distribuídos: Modelo OSI'),
    topic('t2', 'Redes de Computadores: Cabeamento'),
    topic('t3', 'Redes de Computadores'),
  ]);
  assert.equal(tied, 0);
  assert.ok(suggestions.length >= 1 && suggestions.length <= MAX_SUGGESTIONS);
  assert.ok(suggestions.every((s) => !s.strong));
  assert.ok(suggestions.every((s, i) => i === 0 || suggestions[i - 1].score >= s.score));
});

test('sem parecido por palavras (Acentuação Gráfica x Ortografia oficial) não há sugestão: fica para o usuário escolher', () => {
  const c = coll('c1', 'Língua Portuguesa', 'Acentuação Gráfica', 157);
  assert.deepEqual(suggestTopics(c, [topic('t1', 'Ortografia oficial'), topic('t2', 'Compreensão de textos')]), { suggestions: [], tied: 0 });
  assert.deepEqual(suggestTopics(c, []), { suggestions: [], tied: 0 });
});

test('um tópico que já tem coleção ainda pode receber outra, e vem marcado', () => {
  const c = coll('c1', 'Segurança da Informação', 'SSO (Single Sign-On)');
  const { suggestions } = suggestTopics(c, [topic('t1', 'SSO', { hasMaterial: true })]);
  assert.deepEqual(suggestions.map((s) => [s.topicId, s.linked, s.strong]), [['t1', true, true]]);
});

test('as soltas: sai quem já está ligado ao concurso, as marcadas "não é deste concurso" ficam à parte', () => {
  const collections = [coll('ligada', 'Redes', 'MFA'), coll('solta', 'Segurança', 'SSO'), coll('outro', 'Legislação', 'Lei 8.429/1992', 20)];
  const result = buildUnlinked({
    collections,
    topics: [topic('t1', 'MFA'), topic('t2', 'SSO')],
    linkedCollectionIds: new Set(['ligada']),
    ignoredIds: new Set(['outro']),
  });
  assert.deepEqual(result.unlinked.map((c) => c.id), ['solta']);
  assert.deepEqual(result.ignored.map((c) => c.id), ['outro']);
  assert.equal(result.unlinked[0].suggestions[0].topicId, 't2');
});

test('uma coleção ligada que também está marcada não aparece em lugar nenhum (a ligação vale)', () => {
  const result = buildUnlinked({ collections: [coll('c1', 'X', 'MFA')], topics: [topic('t1', 'MFA')], linkedCollectionIds: new Set(['c1']), ignoredIds: new Set(['c1']) });
  assert.deepEqual([result.unlinked, result.ignored], [[], []]);
});

test('a ordem: com sugestão primeiro (a mais parecida antes), depois as sem sugestão, da maior para a menor', () => {
  const collections = [
    coll('sem-pequena', 'Português', 'Crase', 5),
    coll('provavel', 'Segurança da Informação', 'Variadas', 3),
    coll('sem-grande', 'Português', 'Acentuação Gráfica', 157),
    coll('forte', 'Qualquer', 'MFA', 1),
  ];
  const { unlinked } = buildUnlinked({
    collections,
    topics: [topic('t1', 'MFA'), topic('t2', 'Segurança da Informação: Criptografia')],
    linkedCollectionIds: new Set(),
    ignoredIds: new Set(),
  });
  assert.deepEqual(unlinked.map((c) => c.id), ['forte', 'provavel', 'sem-grande', 'sem-pequena']);
});

test('as coleções ignoradas saem das maiores para as menores; as contagens de cartões acompanham', () => {
  const { ignored, unlinked } = buildUnlinked({
    collections: [coll('a', 'A', '', 3, { newCards: 1, dueCards: 2 }), coll('b', 'B', '', 9)],
    topics: [],
    linkedCollectionIds: new Set(),
    ignoredIds: new Set(['a', 'b']),
  });
  assert.deepEqual(ignored.map((c) => c.id), ['b', 'a']);
  assert.deepEqual(unlinked, []);
  assert.deepEqual([ignored[1].newCards, ignored[1].dueCards], [1, 2]);
});

test('sem coleções, sem tópicos ou sem nada não quebra', () => {
  assert.deepEqual(buildUnlinked({ collections: [], topics: [], linkedCollectionIds: new Set(), ignoredIds: new Set() }), { unlinked: [], ignored: [] });
  const noTopics = buildUnlinked({ collections: [coll('c', 'X', 'Y')], topics: [], linkedCollectionIds: new Set(), ignoredIds: new Set() });
  assert.deepEqual(noTopics.unlinked.map((c) => [c.id, c.suggestions.length, c.tied]), [['c', 0, 0]]);
});

// ---------- "não é deste concurso" no banco ----------

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE exams (id TEXT PRIMARY KEY);
    CREATE TABLE collections (id TEXT PRIMARY KEY);
    INSERT INTO exams VALUES ('e1'), ('e2');
    INSERT INTO collections VALUES ('c1'), ('c2');
  `);
  db.exec(IGNORED_COLLECTIONS_SCHEMA);
  return db;
}

test('marcar e desmarcar: idempotente, e cada concurso tem a sua lista', () => {
  const db = newDb();
  assert.deepEqual([...loadIgnoredIds(db, 'e1')], []);
  setCollectionIgnored(db, 'e1', 'c1', true);
  setCollectionIgnored(db, 'e1', 'c1', true);
  assert.deepEqual([...loadIgnoredIds(db, 'e1')], ['c1']);
  assert.deepEqual([...loadIgnoredIds(db, 'e2')], [], 'não é deste concurso não é de todos');
  setCollectionIgnored(db, 'e2', 'c1', true);
  setCollectionIgnored(db, 'e1', 'c1', false);
  setCollectionIgnored(db, 'e1', 'c1', false);
  assert.deepEqual([...loadIgnoredIds(db, 'e1')], []);
  assert.deepEqual([...loadIgnoredIds(db, 'e2')], ['c1']);
});

test('apagar o concurso ou a coleção leva a marca junto', () => {
  const db = newDb();
  setCollectionIgnored(db, 'e1', 'c1', true);
  setCollectionIgnored(db, 'e1', 'c2', true);
  setCollectionIgnored(db, 'e2', 'c1', true);
  db.exec("DELETE FROM collections WHERE id = 'c2'");
  assert.deepEqual([...loadIgnoredIds(db, 'e1')], ['c1']);
  db.exec("DELETE FROM exams WHERE id = 'e1'");
  assert.deepEqual([...loadIgnoredIds(db, 'e1')], []);
  assert.deepEqual([...loadIgnoredIds(db, 'e2')], ['c1']);
});
