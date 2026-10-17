import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { ChoiceSource, GeneratedChoice } from '../ai/choices';
import { listChoices, MAX_CARDS_PER_PREPARE, plainText, prepareChoices, sourceHash, type ChoiceGenerator } from './choices';
import { MOCK_EXAM_SCHEMA } from './schema';
import { addCards, createMockExam, type Result } from './store';

// Banco só em memória, como em store.test.ts: tabelas de que os simulados dependem, simplificadas,
// e o esquema real. As chaves estrangeiras ficam ligadas para provar as exclusões em cascata.
function newDb(): { db: DatabaseSync; examId: string } {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL);
    CREATE TABLE flashcards (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      question TEXT NOT NULL, answer TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'plain'
    );
    INSERT INTO users VALUES ('u1'), ('u2');
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes'), ('c3', 'u2', 'Do outro');
    INSERT INTO flashcards (id, collection_id, question, answer, format) VALUES
      ('f1', 'c1', 'Qual protocolo resolve nomes?', 'O DNS.', 'plain'),
      ('f2', 'c1', 'Qual a porta do SSH?', 'A porta TCP 22.', 'plain'),
      ('f3', 'c1', '<p>Sigla de <b>HTTP</b>?</p>', '<div>HyperText&nbsp;Transfer Protocol</div>', 'html'),
      ('f4', 'c1', '<img src="x.png">', '<img src="y.png">', 'html'),
      ('f5', 'c1', 'Pergunta fora do simulado', 'Resposta', 'plain'),
      ('x1', 'c3', 'Cartão alheio', 'Resposta alheia', 'plain');
  `);
  db.exec(MOCK_EXAM_SCHEMA);
  const created = createMockExam(db, 'u1', 'Redes');
  assert.ok(created.ok);
  const examId = created.value.id;
  assert.ok(addCards(db, 'u1', examId, ['f1', 'f2', 'f3', 'f4']).ok);
  return { db, examId };
}

function value<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}
function failure<T>(result: Result<T>, status: number): void {
  assert.ok(!result.ok, 'devia falhar');
  assert.equal(result.status, status, result.error);
}

/** Um gerador falso: responde a todo cartão pedido com alternativas previsíveis e guarda o que recebeu. */
function fakeGenerator(options: { skip?: number[] } = {}): ChoiceGenerator & { calls: ChoiceSource[][] } {
  const calls: ChoiceSource[][] = [];
  const generate = (async (sources: ChoiceSource[]): Promise<GeneratedChoice[]> => {
    calls.push(sources);
    return sources
      .filter((s) => !options.skip?.includes(s.n))
      .map((s) => ({ n: s.n, correct: `certa de ${s.answer}`, wrong: ['errada 1', 'errada 2', 'errada 3', 'errada 4'] }));
  }) as ChoiceGenerator & { calls: ChoiceSource[][] };
  generate.calls = calls;
  return generate;
}

const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

// ---------- texto e impressão digital ----------

test('texto: o HTML vira texto puro de uma linha; imagens somem; texto simples só é aparado', () => {
  assert.equal(plainText('<p>Sigla de <b>HTTP</b>?</p><p>Segunda&nbsp;linha &amp; mais</p>', 'html'), 'Sigla de HTTP ? Segunda linha & mais');
  assert.equal(plainText('<img src="a.png">', 'html'), '');
  assert.equal(plainText('  uma   <b>linha</b>\n outra ', 'plain'), 'uma <b>linha</b> outra');
});

test('impressão digital: depende da pergunta e da resposta, e não confunde onde uma termina e a outra começa', () => {
  assert.equal(sourceHash('a', 'b'), sourceHash('a', 'b'));
  assert.notEqual(sourceHash('a', 'b'), sourceHash('a', 'c'));
  assert.notEqual(sourceHash('ab', 'c'), sourceHash('a', 'bc'));
});

// ---------- preparar ----------

test('preparar: gera numa só chamada, guarda, e devolve as questões na ordem da lista', async () => {
  const { db, examId } = newDb();
  const generate = fakeGenerator();
  const { questions, failed } = value(await prepareChoices(db, 'u1', examId, ['f2', 'f1'], generate));

  assert.equal(generate.calls.length, 1, 'uma chamada de IA para o lote todo');
  assert.deepEqual(
    generate.calls[0].map((s) => [s.n, s.question, s.answer]),
    [[1, 'Qual protocolo resolve nomes?', 'O DNS.'], [2, 'Qual a porta do SSH?', 'A porta TCP 22.']],
  );
  assert.deepEqual(questions.map((q) => q.flashcardId), ['f1', 'f2'], 'ordem da lista, não a do pedido');
  assert.deepEqual(questions[0], { flashcardId: 'f1', correct: 'certa de O DNS.', wrong: ['errada 1', 'errada 2', 'errada 3', 'errada 4'] });
  assert.deepEqual(failed, []);
  assert.equal(count(db, 'card_choices'), 2);
});

test('preparar: o que já está guardado não gasta IA de novo', async () => {
  const { db, examId } = newDb();
  const generate = fakeGenerator();
  value(await prepareChoices(db, 'u1', examId, ['f1', 'f2'], generate));
  assert.equal(generate.calls.length, 1);

  const again = value(await prepareChoices(db, 'u1', examId, ['f1', 'f2'], generate));
  assert.equal(generate.calls.length, 1, 'nenhuma chamada nova');
  assert.equal(again.questions.length, 2);

  const mixed = value(await prepareChoices(db, 'u1', examId, ['f1', 'f3'], generate));
  assert.equal(generate.calls.length, 2);
  assert.deepEqual(generate.calls[1].map((s) => s.question), ['Sigla de HTTP ?'], 'só o cartão novo vai para a IA');
  assert.deepEqual(mixed.questions.map((q) => q.flashcardId), ['f1', 'f3']);
});

test('preparar: editar o cartão invalida as alternativas; mexer só na formatação, não', async () => {
  const { db, examId } = newDb();
  const generate = fakeGenerator();
  value(await prepareChoices(db, 'u1', examId, ['f3'], generate));
  assert.equal(generate.calls.length, 1);

  db.prepare("UPDATE flashcards SET question = '<p>Sigla   de   <i>HTTP</i>?</p>' WHERE id = 'f3'").run();
  value(await prepareChoices(db, 'u1', examId, ['f3'], generate));
  assert.equal(generate.calls.length, 1, 'só a formatação mudou: continua valendo');

  db.prepare("UPDATE flashcards SET answer = '<div>Protocolo de Transferência de Hipertexto</div>' WHERE id = 'f3'").run();
  assert.deepEqual(value(listChoices(db, 'u1', examId)).missing.includes('f3'), true, 'a listagem já enxerga como faltando');
  const regenerated = value(await prepareChoices(db, 'u1', examId, ['f3'], generate));
  assert.equal(generate.calls.length, 2, 'o texto mudou: gera de novo');
  assert.equal(regenerated.questions[0].correct, 'certa de Protocolo de Transferência de Hipertexto');
  assert.equal(count(db, 'card_choices'), 1, 'substitui, não acumula');
});

test('preparar: cartão que a IA não devolveu, ou que não tem texto (só imagem), vai para "failed"', async () => {
  const { db, examId } = newDb();
  const generate = fakeGenerator({ skip: [2] });
  const result = value(await prepareChoices(db, 'u1', examId, ['f1', 'f2', 'f3', 'f4'], generate));

  assert.deepEqual(generate.calls[0].map((s) => s.n), [1, 2, 3], 'o cartão só de imagem nem é enviado');
  assert.deepEqual(result.questions.map((q) => q.flashcardId), ['f1', 'f3']);
  assert.deepEqual([...result.failed].sort(), ['f2', 'f4']);
  assert.equal(count(db, 'card_choices'), 2, 'só o que voltou foi guardado');
});

test('preparar: se a IA falha de vez, o erro sobe e nada é guardado; o que já estava guardado continua', async () => {
  const { db, examId } = newDb();
  value(await prepareChoices(db, 'u1', examId, ['f1'], fakeGenerator()));

  const broken: ChoiceGenerator = async () => {
    throw new Error('Cota do Gemini esgotada.');
  };
  await assert.rejects(prepareChoices(db, 'u1', examId, ['f1', 'f2'], broken), /Cota do Gemini esgotada/);
  assert.equal(count(db, 'card_choices'), 1);
  assert.deepEqual(value(listChoices(db, 'u1', examId)).questions.map((q) => q.flashcardId), ['f1']);
});

test('preparar: pedidos inválidos são recusados sem chamar a IA', async () => {
  const { db, examId } = newDb();
  const generate = fakeGenerator();

  failure(await prepareChoices(db, 'u1', 'nao-existe', ['f1'], generate), 404);
  failure(await prepareChoices(db, 'u2', examId, ['f1'], generate), 404); // simulado de outro usuário
  failure(await prepareChoices(db, 'u1', examId, [], generate), 400);
  failure(await prepareChoices(db, 'u1', examId, 'f1', generate), 400);
  failure(await prepareChoices(db, 'u1', examId, ['f1', 7], generate), 400);
  failure(await prepareChoices(db, 'u1', examId, Array.from({ length: MAX_CARDS_PER_PREPARE + 1 }, (_, i) => `x${i}`), generate), 400);
  failure(await prepareChoices(db, 'u1', examId, ['f5'], generate), 404); // existe, mas não está neste simulado
  failure(await prepareChoices(db, 'u1', examId, ['x1'], generate), 404); // de outro usuário
  assert.equal(generate.calls.length, 0);
  assert.equal(count(db, 'card_choices'), 0);
});

test('preparar: ids repetidos contam uma vez, e ids de fora do simulado são ignorados quando há outros válidos', async () => {
  const { db, examId } = newDb();
  const generate = fakeGenerator();
  const result = value(await prepareChoices(db, 'u1', examId, ['f1', 'f1', 'f5', 'x1'], generate));
  assert.deepEqual(generate.calls[0].map((s) => s.question), ['Qual protocolo resolve nomes?']);
  assert.deepEqual(result.questions.map((q) => q.flashcardId), ['f1']);
});

// ---------- listar ----------

test('listar: separa o que está pronto do que falta, só dos cartões do simulado', async () => {
  const { db, examId } = newDb();
  assert.deepEqual(value(listChoices(db, 'u1', examId)), { questions: [], missing: ['f1', 'f2', 'f3', 'f4'] });

  value(await prepareChoices(db, 'u1', examId, ['f2'], fakeGenerator()));
  const listed = value(listChoices(db, 'u1', examId));
  assert.deepEqual(listed.questions.map((q) => q.flashcardId), ['f2']);
  assert.deepEqual(listed.missing, ['f1', 'f3', 'f4']);

  failure(listChoices(db, 'u2', examId), 404);
  failure(listChoices(db, 'u1', 'nao-existe'), 404);
});

test('listar: alternativas guardadas com defeito (JSON ruim) contam como faltando em vez de quebrar', () => {
  const { db, examId } = newDb();
  const hash = sourceHash('Qual protocolo resolve nomes?', 'O DNS.');
  db.prepare("INSERT INTO card_choices VALUES ('f1', ?, 'certa', 'isto não é json', 'x')").run(hash);
  db.prepare("INSERT INTO card_choices VALUES ('f2', ?, 'certa', '[]', 'x')").run(sourceHash('Qual a porta do SSH?', 'A porta TCP 22.'));
  assert.deepEqual(value(listChoices(db, 'u1', examId)).missing, ['f1', 'f2', 'f3', 'f4']);
});

test('apagar o cartão leva junto as alternativas dele', async () => {
  const { db, examId } = newDb();
  value(await prepareChoices(db, 'u1', examId, ['f1', 'f2'], fakeGenerator()));
  db.prepare("DELETE FROM flashcards WHERE id = 'f1'").run();
  assert.equal(count(db, 'card_choices'), 1);
});
