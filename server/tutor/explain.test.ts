import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { MAX_ASK_CHARS, MAX_HISTORY_REPLY_CHARS, MAX_HISTORY_TURNS, type TutorReply, type TutorSource } from '../ai/tutor';
import { explainFlashcard, parseAsk, parseHistory, type Explainer, type Result } from './explain';

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u1'), ('u2');
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '');
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes', 'Cluster'), ('c2', 'u2', 'Alheia', '');
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'plain',
      difficulty TEXT NOT NULL DEFAULT 'medio', source_page INTEGER, created_at TEXT NOT NULL DEFAULT 'x', ease_factor REAL NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 0, repetitions INTEGER NOT NULL DEFAULT 0, due_at TEXT, favorite INTEGER NOT NULL DEFAULT 0, document_id TEXT
    );
    INSERT INTO flashcards (id, collection_id, question, answer, format) VALUES
      ('f1', 'c1', 'O que é <b>quórum</b>?', '<p>O número mínimo de nós.</p>', 'html'),
      ('f2', 'c2', 'De outro usuário?', 'Sim.', 'plain'),
      ('f3', 'c1', '<img src="x.png">', '<img src="y.png">', 'html');
  `);
  return db;
}

const REPLY: TutorReply = { answer: 'Explicação.', example: '', tip: '', caution: '' };

function value<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}
function failure<T>(result: Result<T>, status: number, message?: RegExp): void {
  assert.ok(!result.ok, 'devia falhar');
  assert.equal(result.status, status, result.error);
  if (message) assert.match(result.error, message);
}

/** Um explicador falso que guarda o que recebeu. */
function fake(): { explainer: Explainer; calls: TutorSource[] } {
  const calls: TutorSource[] = [];
  return {
    calls,
    explainer: async (source) => {
      calls.push(source);
      return REPLY;
    },
  };
}

test('parseAsk: vazio vale "explique o cartão"; numa linha, e até o limite', () => {
  assert.equal(value(parseAsk(undefined)), '');
  assert.equal(value(parseAsk(null)), '');
  assert.equal(value(parseAsk('   ')), '');
  assert.equal(value(parseAsk('  Por que\n  é assim? ')), 'Por que é assim?');
  assert.equal(value(parseAsk('a'.repeat(MAX_ASK_CHARS))).length, MAX_ASK_CHARS);
  failure(parseAsk('a'.repeat(MAX_ASK_CHARS + 1)), 400, /até 400 caracteres/);
  for (const bad of [5, true, {}, ['x']]) failure(parseAsk(bad), 400, /texto/);
});

test('parseHistory: só as últimas trocas, cortadas; qualquer coisa fora do formato é erro', () => {
  assert.deepEqual(value(parseHistory(undefined)), []);
  assert.deepEqual(value(parseHistory([])), []);
  const turns = Array.from({ length: 6 }, (_, i) => ({ ask: `p${i}`, answer: `r${i}` }));
  assert.deepEqual(value(parseHistory(turns)).map((t) => t.ask), ['p3', 'p4', 'p5']);
  assert.equal(value(parseHistory(turns)).length, MAX_HISTORY_TURNS);
  const [cut] = value(parseHistory([{ ask: 'a'.repeat(900), answer: 'r'.repeat(MAX_HISTORY_REPLY_CHARS + 700) }]));
  assert.equal(cut.ask.length, MAX_ASK_CHARS);
  assert.equal(cut.answer.length, MAX_HISTORY_REPLY_CHARS);
  for (const bad of ['texto', 5, {}, [null], [{ ask: 'x' }], [{ ask: 1, answer: 'y' }], [{ ask: 'x', answer: 2 }]]) failure(parseHistory(bad), 400, /histórico/);
});

test('o pedido leva o cartão em texto puro, onde ele está, a pergunta e a conversa', async () => {
  const db = newDb();
  const { explainer, calls } = fake();
  const result = value(await explainFlashcard(db, 'u1', 'f1', { ask: ' Dê um exemplo ', history: [{ ask: 'Explique', answer: 'É a maioria.' }] }, explainer));
  assert.deepEqual(result.reply, REPLY);
  assert.deepEqual(calls, [
    {
      question: 'O que é quórum ?',
      answer: 'O número mínimo de nós.',
      context: 'Redes · Cluster',
      ask: 'Dê um exemplo',
      history: [{ ask: 'Explique', answer: 'É a maioria.' }],
    },
  ]);
});

test('sem corpo, pede a explicação padrão (ask vazio) e o histórico fica vazio', async () => {
  const db = newDb();
  const { explainer, calls } = fake();
  value(await explainFlashcard(db, 'u1', 'f1', undefined, explainer));
  assert.deepEqual([calls[0].ask, calls[0].history], ['', []]);
});

test('cartão de outro usuário ou inexistente é 404, e a IA nem é chamada', async () => {
  const db = newDb();
  const { explainer, calls } = fake();
  failure(await explainFlashcard(db, 'u1', 'f2', {}, explainer), 404, /não encontrado/);
  failure(await explainFlashcard(db, 'u1', 'nao-existe', {}, explainer), 404);
  failure(await explainFlashcard(db, 'u2', 'f1', {}, explainer), 404);
  assert.equal(calls.length, 0);
});

test('cartão só com figura é 422 (não há texto para a IA ler), sem chamar a IA', async () => {
  const db = newDb();
  const { explainer, calls } = fake();
  failure(await explainFlashcard(db, 'u1', 'f3', {}, explainer), 422, /só figura/);
  assert.equal(calls.length, 0);
});

test('pergunta ou histórico inválidos são 400 antes de qualquer coisa', async () => {
  const db = newDb();
  const { explainer, calls } = fake();
  failure(await explainFlashcard(db, 'u1', 'f1', { ask: 'x'.repeat(MAX_ASK_CHARS + 1) }, explainer), 400);
  failure(await explainFlashcard(db, 'u1', 'f1', { history: 'não é lista' }, explainer), 400);
  assert.equal(calls.length, 0);
});

test('uma falha da IA sobe como erro (a rota a transforma em mensagem) e nada é gravado', async () => {
  const db = newDb();
  const before = JSON.stringify(db.prepare('SELECT * FROM flashcards ORDER BY id').all());
  await assert.rejects(
    explainFlashcard(db, 'u1', 'f1', {}, async () => {
      throw new Error('Cota esgotada.');
    }),
    /Cota esgotada/,
  );
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM flashcards ORDER BY id').all()), before);
});
