import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { MAX_VERIFY_PER_CALL, type VerifiedCard, type VerifySource } from '../ai/verify';
import type { Result } from '../mockexams/store';
import { AI_REVIEW_SCHEMA } from './schema';
import { countDrafts, editDraft, GENERATED_DESCRIPTION_PREFIX, insertDrafts, listDraftGroups, MAX_VERIFY_DRAFTS, verifyDrafts, type DraftVerifier } from './store';

// O mesmo esquema do banco real, só com o que a conferência usa. u1 tem o concurso e1 (tópico t1, com cargo e banca)
// e as coleções g1 (gerada para t1), g2 (gerada para t2) e minha (do usuário); u2 tem g3.
function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE documents (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE);
    CREATE TABLE flashcards (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE);
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, position TEXT NOT NULL DEFAULT '', board TEXT NOT NULL DEFAULT '');
    CREATE TABLE exam_disciplines (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, name TEXT NOT NULL);
    CREATE TABLE exam_topics (id TEXT PRIMARY KEY, discipline_id TEXT NOT NULL REFERENCES exam_disciplines(id) ON DELETE CASCADE, title TEXT NOT NULL);
    INSERT INTO users VALUES ('u1'), ('u2');
    INSERT INTO collections (id, user_id, name, subject, description, created_at, updated_at) VALUES
      ('g1', 'u1', 'Redes', 'Topologias', '${GENERATED_DESCRIPTION_PREFIX} x', 'x', 'x'),
      ('g2', 'u1', 'Direito', 'Princípios', '${GENERATED_DESCRIPTION_PREFIX} y', 'x', 'x'),
      ('minha', 'u1', 'Minha', '', 'do usuário', 'x', 'x'),
      ('g3', 'u2', 'Do outro', '', '${GENERATED_DESCRIPTION_PREFIX} z', 'x', 'x');
    INSERT INTO exams VALUES ('e1', 'u1', 'TRANSPETRO 2026', 'Analista de Sistemas', 'CESGRANRIO');
    INSERT INTO exam_disciplines VALUES ('d1', 'e1', 'Conhecimentos Específicos'), ('d2', 'e1', 'Direito');
    INSERT INTO exam_topics VALUES ('t1', 'd1', 'Redes: Topologias'), ('t2', 'd2', 'Princípios fundamentais');
  `);
  db.exec(AI_REVIEW_SCHEMA);
  return db;
}

const NOW = new Date('2026-10-18T09:00:00Z');
const card = (question: string, answer = `R de ${question}`) => ({ question, answer, difficulty: 'medio' });
function draftsFor(db: DatabaseSync, cards: ReturnType<typeof card>[], collection = 'g1', topic: string | null = 't1', user = 'u1') {
  return insertDrafts(db, user, { collectionId: collection, documentId: null, topicId: topic }, cards, NOW);
}
const value = <T>(r: Result<T>): T => {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.value;
};
const failure = <T>(r: Result<T>, status: number, message?: RegExp) => {
  assert.ok(!r.ok, 'devia falhar');
  assert.equal(r.status, status, r.error);
  if (message) assert.match(r.error, message);
};
const count = (db: DatabaseSync, table: string, where = '1=1') => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
const verdictOf = (db: DatabaseSync, id: string) => ({ ...(db.prepare('SELECT verdict, verdict_note FROM ai_card_drafts WHERE id = ?').get(id) as { verdict: string | null; verdict_note: string | null }) });

/** Um verificador falso: guarda o que recebeu e responde com o que o teste mandar (por padrão, "ok" para todos). */
function fakeVerifier(answer: (sources: VerifySource[], call: number) => VerifiedCard[] | Error = (sources) => sources.map((s) => ({ n: s.n, verdict: 'ok' as const, note: '' }))) {
  const calls: { sources: VerifySource[]; context: string }[] = [];
  const verify: DraftVerifier = async (sources, context) => {
    calls.push({ sources, context });
    const result = answer(sources, calls.length);
    if (result instanceof Error) throw result;
    return result;
  };
  return { verify, calls };
}

test('conferir: manda os cartões numerados com o contexto da prova e guarda o veredito e o motivo de cada um', async () => {
  const db = newDb();
  const [a, b, c] = draftsFor(db, [card('P1', 'R1'), card('P2', 'R2'), card('P3', 'R3')]);
  const { verify, calls } = fakeVerifier((sources) => [
    { n: sources[0].n, verdict: 'ok', note: '' },
    { n: sources[1].n, verdict: 'erro', note: 'A lei é outra.' },
    { n: sources[2].n, verdict: 'duvida', note: 'Confirme o artigo.' },
  ]);
  const result = value(await verifyDrafts(db, 'u1', { collectionId: 'g1' }, verify));
  assert.deepEqual(result, { checked: 3, unchecked: 0, counts: { ok: 1, duvida: 1, erro: 1 }, error: null });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].sources, [{ n: 1, question: 'P1', answer: 'R1' }, { n: 2, question: 'P2', answer: 'R2' }, { n: 3, question: 'P3', answer: 'R3' }]);
  assert.equal(calls[0].context, 'concurso TRANSPETRO 2026, cargo Analista de Sistemas, banca CESGRANRIO, disciplina Conhecimentos Específicos, tópico "Redes: Topologias"');
  assert.deepEqual(verdictOf(db, a), { verdict: 'ok', verdict_note: null });
  assert.deepEqual(verdictOf(db, b), { verdict: 'erro', verdict_note: 'A lei é outra.' });
  assert.deepEqual(verdictOf(db, c), { verdict: 'duvida', verdict_note: 'Confirme o artigo.' });
  // o veredito é só um alerta: nada foi aprovado nem descartado
  assert.equal(countDrafts(db, 'u1'), 3);
  assert.equal(count(db, 'flashcards'), 0);
  assert.deepEqual(listDraftGroups(db, 'u1')[0].drafts.map((d) => d.verdict), ['ok', 'erro', 'duvida']);
});

test('conferir: sem cargo e banca o contexto não tem vírgulas soltas; sem tópico é vazio', async () => {
  const db = newDb();
  draftsFor(db, [card('P1')], 'g2', 't2');
  db.exec("UPDATE exams SET position = '', board = '' WHERE id = 'e1'");
  const first = fakeVerifier();
  await verifyDrafts(db, 'u1', { collectionId: 'g2' }, first.verify);
  assert.equal(first.calls[0].context, 'concurso TRANSPETRO 2026, disciplina Direito, tópico "Princípios fundamentais"');

  draftsFor(db, [card('P9')], 'minha', null);
  const second = fakeVerifier();
  await verifyDrafts(db, 'u1', { collectionId: 'minha' }, second.verify);
  assert.equal(second.calls[0].context, '');
});

test('conferir: vai em lotes pequenos, e a numeração recomeça em cada lote', async () => {
  const db = newDb();
  draftsFor(db, Array.from({ length: 30 }, (_, i) => card(`P${i + 1}`)));
  const { verify, calls } = fakeVerifier();
  const result = value(await verifyDrafts(db, 'u1', { collectionId: 'g1' }, verify));
  assert.deepEqual(calls.map((c) => c.sources.length), [MAX_VERIFY_PER_CALL, MAX_VERIFY_PER_CALL, 30 - 2 * MAX_VERIFY_PER_CALL]);
  assert.ok(calls.every((c) => c.sources.every((s, i) => s.n === i + 1)));
  assert.equal(result.checked, 30);
  assert.equal(count(db, 'ai_card_drafts', "verdict = 'ok'"), 30);
});

test('conferir: cartão que a IA não devolveu fica sem conferência', async () => {
  const db = newDb();
  const [a, b] = draftsFor(db, [card('P1'), card('P2')]);
  const { verify } = fakeVerifier((sources) => [{ n: sources[0].n, verdict: 'duvida', note: 'x' }]);
  const result = value(await verifyDrafts(db, 'u1', { ids: [a, b] }, verify));
  assert.deepEqual([result.checked, result.unchecked], [1, 1]);
  assert.equal(verdictOf(db, a).verdict, 'duvida');
  assert.equal(verdictOf(db, b).verdict, null);
});

test('conferir: se um lote falha (cota), para; o que já foi conferido fica e o resto segue sem conferência', async () => {
  const db = newDb();
  draftsFor(db, Array.from({ length: 30 }, (_, i) => card(`P${i + 1}`)));
  const { verify, calls } = fakeVerifier((sources, call) => (call === 2 ? new Error('cota diária esgotada') : sources.map((s) => ({ n: s.n, verdict: 'ok' as const, note: '' }))));
  const result = value(await verifyDrafts(db, 'u1', { collectionId: 'g1' }, verify));
  assert.equal(calls.length, 2, 'não insiste depois do erro');
  assert.deepEqual([result.checked, result.unchecked], [MAX_VERIFY_PER_CALL, 30 - MAX_VERIFY_PER_CALL]);
  assert.equal(result.error, 'cota diária esgotada');
  assert.equal(count(db, 'ai_card_drafts', "verdict = 'ok'"), MAX_VERIFY_PER_CALL);
});

test('conferir: cartão editado enquanto a IA trabalhava não recebe o veredito do texto antigo', async () => {
  const db = newDb();
  const [a, b] = draftsFor(db, [card('P1', 'R1'), card('P2', 'R2')]);
  const { verify } = fakeVerifier((sources) => {
    editDraft(db, 'u1', a, { answer: 'R1 corrigida enquanto isso' });
    return sources.map((s) => ({ n: s.n, verdict: 'erro' as const, note: 'errado' }));
  });
  const result = value(await verifyDrafts(db, 'u1', { ids: [a, b] }, verify));
  assert.deepEqual([result.checked, result.unchecked], [1, 1]);
  assert.equal(verdictOf(db, a).verdict, null, 'o texto mudou');
  assert.equal(verdictOf(db, b).verdict, 'erro');
});

test('conferir: só os cartões do próprio usuário; refaz o veredito; pedidos ruins e lotes enormes são recusados sem chamar a IA', async () => {
  const db = newDb();
  const [a] = draftsFor(db, [card('P1')]);
  const theirs = draftsFor(db, [card('X1')], 'g3', null, 'u2');
  const { verify, calls } = fakeVerifier();
  failure(await verifyDrafts(db, 'u1', { ids: theirs }, verify), 404);
  failure(await verifyDrafts(db, 'u1', { collectionId: 'g3' }, verify), 404);
  failure(await verifyDrafts(db, 'u1', {}, verify), 400);
  assert.equal(calls.length, 0);

  value(await verifyDrafts(db, 'u1', { ids: [a, ...theirs] }, verify));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sources.length, 1, 'o rascunho do outro não foi enviado');
  assert.equal(verdictOf(db, theirs[0]).verdict, null);

  const second = fakeVerifier((sources) => sources.map((s) => ({ n: s.n, verdict: 'duvida' as const, note: 'segunda rodada' })));
  value(await verifyDrafts(db, 'u1', { collectionId: 'g1' }, second.verify));
  assert.deepEqual(verdictOf(db, a), { verdict: 'duvida', verdict_note: 'segunda rodada' });

  draftsFor(db, Array.from({ length: MAX_VERIFY_DRAFTS + 1 }, (_, i) => card(`Q${i}`)), 'g2', 't2');
  const many = fakeVerifier();
  failure(await verifyDrafts(db, 'u1', { collectionId: 'g2' }, many.verify), 400, /Confira até 60/);
  assert.equal(many.calls.length, 0);
});
