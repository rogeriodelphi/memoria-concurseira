import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { Result } from '../mockexams/store';
import type { ValidDraft, DraftQuestion } from './draft';
import { parseFilter } from './filter';
import {
  addQuestions,
  createNotebook,
  deleteNotebook,
  deleteSavedFilter,
  getNotebookDetail,
  listNotebooks,
  listSavedFilters,
  recordSimulado,
  removeQuestion,
  renameNotebook,
  saveFilter,
} from './notebooks';
import { QUESTION_BANK_SCHEMA } from './schema';
import {
  answerQuestion,
  deleteExam,
  deleteQuestion,
  getFacets,
  getQuestionDetail,
  getTotals,
  gradableIds,
  listExams,
  loadQuestionViews,
  saveExam,
  searchQuestions,
  updateExam,
  updateQuestion,
} from './store';

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('u1'), ('u2');");
  db.exec(QUESTION_BANK_SCHEMA);
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

const alts = (n = 4) => ['A', 'B', 'C', 'D', 'E'].slice(0, n).map((letter) => ({ letter, text: `Alternativa ${letter}` }));

const q = (number: number, over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  number,
  sourceId: '',
  support: '',
  statement: `Enunciado da questão ${number} sobre licitações`,
  alternatives: alts(),
  answer: 'B',
  annulled: false,
  discipline: 'Direito Administrativo',
  subject: 'Licitações',
  comment: '',
  prova: '',
  board: '',
  organ: '',
  year: null,
  needsFigure: false,
  suspect: false,
  ...over,
});

const exam = (over: Partial<ValidDraft> = {}): ValidDraft => ({
  name: 'FGV 2023 - TJ',
  board: 'FGV',
  organ: 'TJ',
  year: 2023,
  position: 'Analista',
  level: 'Superior',
  questions: [q(1), q(2, { answer: 'C' }), q(3, { discipline: 'Língua Portuguesa', subject: 'Crase', answer: 'A' })],
  ...over,
});

const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/** Uma prova importada com três questões; devolve os ids na ordem dos números. */
function seeded(db: DatabaseSync, userId = 'u1', draft: ValidDraft = exam()) {
  const saved = value(saveExam(db, userId, draft));
  const ids = (db.prepare('SELECT id FROM qb_questions WHERE exam_id = ? ORDER BY number').all(saved.id) as { id: string }[]).map((r) => r.id);
  return { examId: saved.id, ids };
}

// ---------- provas ----------

test('importar: grava a prova e as questões, e o resumo conta o gabarito', () => {
  const db = newDb();
  const saved = value(saveExam(db, 'u1', exam({ questions: [q(1), q(2, { answer: '' }), q(3, { annulled: true, answer: '' })] })));
  assert.equal(saved.name, 'FGV 2023 - TJ');
  assert.equal(saved.questionCount, 3);
  assert.equal(saved.withAnswerCount, 1, 'só a primeira pode ser corrigida');
  assert.equal(saved.answeredCount, 0);
  assert.equal(count(db, 'qb_questions'), 3);
});

test('importar: o nome da prova é único por usuário, sem diferenciar caixa', () => {
  const db = newDb();
  seeded(db);
  failure(saveExam(db, 'u1', exam({ name: 'fgv 2023 - tj' })), 409, /já tem uma prova/);
  value(saveExam(db, 'u2', exam()));
  assert.equal(count(db, 'qb_exams'), 2);
});

test('importar: se algo falha no meio, nada fica gravado', () => {
  const db = newDb();
  const bad = exam({ questions: [q(1), q(1)] }); // número repetido viola a unicidade
  assert.throws(() => saveExam(db, 'u1', bad));
  assert.equal(count(db, 'qb_exams'), 0);
  assert.equal(count(db, 'qb_questions'), 0);
});

test('provas: listar, editar os dados e apagar (leva as questões e as respostas)', () => {
  const db = newDb();
  const { examId, ids } = seeded(db);
  seeded(db, 'u2');
  value(answerQuestion(db, 'u1', ids[0], { chosen: 'B' }));
  assert.equal(listExams(db, 'u1').length, 1);
  assert.equal(listExams(db, 'u1')[0].answeredCount, 1);
  assert.equal(listExams(db, 'u1')[0].correctCount, 1);

  const updated = value(updateExam(db, 'u1', examId, { name: 'Outro nome', year: '2022', level: 'Médio', board: 'Cebraspe' }));
  assert.deepEqual([updated.name, updated.year, updated.level, updated.board, updated.organ], ['Outro nome', 2022, 'Médio', 'Cebraspe', 'TJ']);
  failure(updateExam(db, 'u1', examId, { name: 'x' }), 400, /nome/);
  failure(updateExam(db, 'u2', examId, { name: 'Roubado' }), 404);

  failure(deleteExam(db, 'u2', examId), 404);
  assert.equal(count(db, 'qb_questions'), 6);
  value(deleteExam(db, 'u1', examId));
  assert.equal(count(db, 'qb_questions'), 3, 'só as do outro usuário sobram');
  assert.equal(count(db, 'qb_answers'), 0);
});

// ---------- responder ----------

test('responder: o servidor corrige, e o gabarito só aparece depois de responder', () => {
  const db = newDb();
  const { ids } = seeded(db);

  const before = loadQuestionViews(db, 'u1', [ids[0]])[0];
  assert.equal(before.answer, undefined, 'antes de responder o gabarito não vai para o navegador');
  assert.equal(before.mine, null);
  assert.equal(before.gradable, true);

  const wrong = value(answerQuestion(db, 'u1', ids[0], { chosen: 'a', durationMs: 4_000 }));
  assert.deepEqual(wrong, { correct: false, answer: 'B', chosen: 'A', comment: '' });
  const after = loadQuestionViews(db, 'u1', [ids[0]])[0];
  assert.equal(after.answer, 'B');
  assert.equal(after.mine?.chosen, 'A');
  assert.equal(after.mine?.correct, false);

  value(answerQuestion(db, 'u1', ids[0], { chosen: 'B' }));
  const again = loadQuestionViews(db, 'u1', [ids[0]])[0];
  assert.deepEqual([again.mine?.correct, again.timesAnswered, again.timesCorrect], [true, 2, 1], 'vale a última resposta; o histórico guarda as duas');
});

test('responder: letra inexistente, anulada, sem gabarito e questão alheia são recusadas', () => {
  const db = newDb();
  const { ids } = seeded(db, 'u1', exam({ questions: [q(1), q(2, { answer: '' }), q(3, { annulled: true, answer: '' }), q(4, { alternatives: alts(3), answer: 'C' })] }));
  failure(answerQuestion(db, 'u1', ids[0], { chosen: 'Z' }), 400, /alternativas/);
  failure(answerQuestion(db, 'u1', ids[0], {}), 400);
  failure(answerQuestion(db, 'u1', ids[3], { chosen: 'D' }), 400, /alternativas/); // questão com 3 alternativas não aceita D
  failure(answerQuestion(db, 'u1', ids[1], { chosen: 'A' }), 409, /ainda não tem gabarito/);
  failure(answerQuestion(db, 'u1', ids[2], { chosen: 'A' }), 409, /anulada/);
  failure(answerQuestion(db, 'u2', ids[0], { chosen: 'B' }), 404);
  assert.equal(count(db, 'qb_answers'), 0);
});

// ---------- busca ----------

function search(db: DatabaseSync, filter: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return searchQuestions(db, 'u1', { filter, ...extra });
}

test('busca: sem filtro traz tudo do usuário, em páginas, e só as questões dele', () => {
  const db = newDb();
  seeded(db);
  seeded(db, 'u2');
  const all = search(db, {});
  assert.equal(all.total, 3);
  assert.deepEqual(all.questions.map((x) => x.number), [1, 2, 3]);

  const paged = search(db, {}, { pageSize: 10 });
  assert.equal(paged.pageSize, 10);
  assert.equal(search(db, {}, { pageSize: 7 }).pageSize, 20, 'tamanho inválido volta ao padrão');
  const second = searchQuestions(db, 'u1', { filter: {}, pageSize: 10, page: 99 });
  assert.equal(second.page, 1, 'página além da última volta para a última');
});

test('busca: disciplina, assunto, banca, ano e prova', () => {
  const db = newDb();
  seeded(db);
  seeded(db, 'u1', exam({ name: 'Cebraspe 2020', board: 'Cebraspe', year: 2020, organ: 'PF', questions: [q(1, { discipline: 'Informática', subject: 'Redes' })] }));
  assert.equal(search(db, { discipline: ['língua portuguesa'] }).total, 1, 'sem diferenciar caixa');
  assert.equal(search(db, { discipline: ['Informática'], subject: ['Redes'] }).total, 1);
  assert.equal(search(db, { subject: ['Licitações'] }).total, 2);
  assert.equal(search(db, { board: ['Cebraspe'] }).total, 1);
  assert.equal(search(db, { year: [2023] }).total, 3);
  assert.equal(search(db, { year: [2023, 2020] }).total, 4);
  assert.equal(search(db, { organ: ['pf'] }).total, 1);
  assert.equal(search(db, { discipline: ['Direito Administrativo'], board: ['Cebraspe'] }).total, 0, 'critérios se somam');
  const first = search(db, {}).questions[0];
  assert.equal(search(db, { exam: [first.examId] }).total, 3);
});

test('busca: "minhas questões" — resolvidas, não resolvidas, acertei e errei pela última resposta', () => {
  const db = newDb();
  const { ids } = seeded(db);
  value(answerQuestion(db, 'u1', ids[0], { chosen: 'B' })); // acertou
  value(answerQuestion(db, 'u1', ids[1], { chosen: 'A' })); // errou
  value(answerQuestion(db, 'u1', ids[1], { chosen: 'C' })); // e depois acertou
  value(answerQuestion(db, 'u1', ids[2], { chosen: 'D' })); // errou

  const numbers = (status: string[]) => search(db, { status }).questions.map((x) => x.number);
  assert.deepEqual(numbers(['resolvidas']), [1, 2, 3]);
  assert.deepEqual(numbers(['nao_resolvidas']), []);
  assert.deepEqual(numbers(['acertei']), [1, 2], 'a questão 2 conta pela última resposta');
  assert.deepEqual(numbers(['errei']), [3]);
  assert.deepEqual(numbers(['acertei', 'errei']), [1, 2, 3], 'os marcados se somam (ou)');
  assert.deepEqual(numbers([]), [1, 2, 3]);
});

test('busca: palavras-chave (todas), com curingas tratados como texto', () => {
  const db = newDb();
  seeded(db, 'u1', exam({ questions: [q(1, { statement: 'A licitação dispensada pela lei 8.666 é válida?' }), q(2, { statement: 'Desconto de 50% no contrato' }), q(3, { statement: 'Prazo_de entrega', support: 'texto sobre pregão eletrônico' })] }));
  assert.equal(search(db, { q: 'licitação lei' }).total, 1);
  assert.equal(search(db, { q: 'pregão' }).total, 1, 'acha no texto de apoio');
  assert.equal(search(db, { q: 'alternativa c' }).total, 3, 'acha nas alternativas');
  assert.equal(search(db, { q: '50%' }).total, 1);
  assert.equal(search(db, { q: '%' }).total, 1, 'o % não é curinga');
  assert.equal(search(db, { q: '_' }).total, 1, 'o _ não é curinga');
  assert.equal(search(db, { q: 'xyz' }).total, 0);
  assert.equal(search(db, { q: "'; DROP TABLE qb_questions; --" }).total, 0);
  assert.equal(count(db, 'qb_questions'), 3);
});

test('busca: excluir anuladas, sem gabarito e as que já estão em cadernos; só com anotação', () => {
  const db = newDb();
  const { ids } = seeded(db, 'u1', exam({ questions: [q(1), q(2, { answer: '' }), q(3, { annulled: true, answer: '' }), q(4)] }));
  assert.equal(search(db, { excludeAnnulled: true }).total, 3);
  assert.equal(search(db, { excludeNoAnswer: true }).total, 3, 'sem gabarito sai; anulada fica (tem destino)');
  assert.equal(search(db, { excludeAnnulled: true, excludeNoAnswer: true }).total, 2);

  value(createNotebook(db, 'u1', { name: 'Meu caderno', questionIds: [ids[0]] }));
  assert.equal(search(db, { excludeInNotebooks: true }).total, 3);

  value(updateQuestion(db, 'u1', ids[3], { note: 'revisar a Lei 14.133' }));
  assert.deepEqual(search(db, { onlyWithNote: true }).questions.map((x) => x.number), [4]);
});

test('busca: anulada nunca conta como acerto ou erro', () => {
  const db = newDb();
  const { ids } = seeded(db);
  value(answerQuestion(db, 'u1', ids[0], { chosen: 'A' }));
  value(updateQuestion(db, 'u1', ids[0], { annulled: true }));
  assert.equal(search(db, { status: ['errei'] }).total, 0);
  assert.equal(search(db, { status: ['resolvidas'] }).total, 1, 'continua resolvida');
  assert.equal(getTotals(db, 'u1').correct, 0);
});

test('busca: ordens', () => {
  const db = newDb();
  seeded(db, 'u1', exam({ name: 'Antiga', year: 2019, questions: [q(1)] }));
  seeded(db, 'u1', exam({ name: 'Nova', year: 2024, questions: [q(1, { discipline: 'Informática' })] }));
  seeded(db, 'u1', exam({ name: 'Sem ano', year: null, questions: [q(1, { discipline: 'Biologia' })] }));
  assert.deepEqual(search(db, {}).questions.map((x) => x.examName), ['Nova', 'Antiga', 'Sem ano'], 'ano mais novo primeiro, sem ano por último');
  assert.deepEqual(search(db, {}, { order: 'disciplina' }).questions.map((x) => x.discipline), ['Biologia', 'Direito Administrativo', 'Informática']);
  assert.equal(search(db, {}, { order: 'qualquer coisa' }).total, 3, 'ordem desconhecida volta à padrão');
});

test('filtro: o que vem de fora é limpo e nunca quebra a consulta', () => {
  const filter = parseFilter({
    status: ['errei', 'hacker', 3],
    q: '  duas   palavras  ',
    discipline: ['A', 'A', 5, null, ' B '],
    year: ['2020', 'abc', 1800, 2020.5, 2021],
    excludeAnnulled: 'sim',
    notebook: 'x'.repeat(500),
    inexistente: 1,
  });
  assert.deepEqual(filter.status, ['errei']);
  assert.equal(filter.q, 'duas palavras');
  assert.deepEqual(filter.discipline, ['A', 'B']);
  assert.deepEqual(filter.year, [2020, 2021]);
  assert.equal(filter.excludeAnnulled, false, 'só true literal liga');
  assert.equal(filter.notebook.length, 100);
  const db = newDb();
  assert.doesNotThrow(() => searchQuestions(db, 'u1', { filter: 'lixo', page: 'x', pageSize: {} }));
  assert.doesNotThrow(() => searchQuestions(db, 'u1', null));
});

test('opções do filtro e totais', () => {
  const db = newDb();
  const { ids } = seeded(db);
  seeded(db, 'u2');
  value(answerQuestion(db, 'u1', ids[0], { chosen: 'B' }));
  const facets = getFacets(db, 'u1');
  assert.deepEqual(facets.discipline, [{ value: 'Direito Administrativo', count: 2 }, { value: 'Língua Portuguesa', count: 1 }]);
  assert.deepEqual(facets.subject.map((s) => [s.discipline, s.value, s.count]), [['Direito Administrativo', 'Licitações', 2], ['Língua Portuguesa', 'Crase', 1]]);
  assert.deepEqual(facets.board, [{ value: 'FGV', count: 3 }]);
  assert.deepEqual(facets.year, [{ value: '2023', count: 3 }]);
  assert.equal(facets.exam.length, 1);
  assert.deepEqual(getTotals(db, 'u1'), { questions: 3, exams: 1, answered: 1, correct: 1, annulled: 0, withoutAnswer: 0 });
});

// ---------- corrigir uma questão ----------

test('detalhe: traz o gabarito e o histórico, e é só do dono', () => {
  const db = newDb();
  const { ids } = seeded(db);
  value(answerQuestion(db, 'u1', ids[0], { chosen: 'A' }));
  const detail = value(getQuestionDetail(db, 'u1', ids[0]));
  assert.equal(detail.question.answer, 'B');
  assert.equal(detail.history.length, 1);
  assert.deepEqual([detail.history[0].chosen, detail.history[0].correct, detail.history[0].inSimulado], ['A', false, false]);
  failure(getQuestionDetail(db, 'u2', ids[0]), 404);
});

test('corrigir: mudar o gabarito refaz o "acertei/errei" das respostas e o placar dos simulados', () => {
  const db = newDb();
  const { ids } = seeded(db);
  const notebook = value(createNotebook(db, 'u1', { name: 'Simulado', questionIds: ids })).notebook;
  const result = value(recordSimulado(db, 'u1', notebook.id, { durationMs: 5000, answers: [{ questionId: ids[0], chosen: 'A' }, { questionId: ids[1], chosen: 'C' }] }));
  assert.equal(result.attempt.correct, 1, 'só a segunda estava certa');

  value(updateQuestion(db, 'u1', ids[0], { answer: 'A' })); // o gabarito correto era A
  assert.equal(loadQuestionViews(db, 'u1', [ids[0]])[0].mine?.correct, true);
  const attempt = db.prepare('SELECT correct, total FROM qb_attempts').get() as { correct: number; total: number };
  assert.deepEqual({ ...attempt }, { correct: 2, total: 3 });

  value(updateQuestion(db, 'u1', ids[0], { answer: 'D' }));
  assert.equal(loadQuestionViews(db, 'u1', [ids[0]])[0].mine?.correct, false);
  assert.equal((db.prepare('SELECT correct FROM qb_attempts').get() as { correct: number }).correct, 1);
});

test('corrigir: gabarito, anulação, texto e anotação', () => {
  const db = newDb();
  const { ids } = seeded(db, 'u1', exam({ questions: [q(1, { answer: '' }), q(2)] }));
  const first = value(updateQuestion(db, 'u1', ids[0], { answer: 'c' }));
  assert.equal(first.gradable, true);
  assert.equal(first.answer, 'C', 'quem edita vê o gabarito');

  const annulled = value(updateQuestion(db, 'u1', ids[0], { answer: 'ANULADA' }));
  assert.deepEqual([annulled.annulled, annulled.gradable], [true, false]);
  const back = value(updateQuestion(db, 'u1', ids[0], { answer: 'D' }));
  assert.deepEqual([back.annulled, back.gradable], [false, true], 'informar a letra desfaz a anulação');

  const text = value(updateQuestion(db, 'u1', ids[1], { statement: 'Novo enunciado corrigido da questão', discipline: ' Direito  Penal ', note: 'anotação minha' }));
  assert.equal(text.statement, 'Novo enunciado corrigido da questão');
  assert.equal(text.discipline, 'Direito Penal');
  assert.equal(text.note, 'anotação minha');
  assert.equal(value(updateQuestion(db, 'u1', ids[1], { note: '' })).note, '');
});

test('corrigir: recusa o que quebraria a questão', () => {
  const db = newDb();
  const { ids } = seeded(db);
  failure(updateQuestion(db, 'u1', ids[0], { answer: 'Z' }), 400, /Gabarito inválido/);
  failure(updateQuestion(db, 'u1', ids[0], { answer: 'E' }), 400, /uma das alternativas/);
  failure(updateQuestion(db, 'u1', ids[0], { alternatives: alts(1) }), 400, /alternativas/);
  failure(updateQuestion(db, 'u1', ids[1], { alternatives: alts(2) }), 400, /uma das alternativas/); // o gabarito dela é C
  failure(updateQuestion(db, 'u1', ids[0], { statement: 'curto' }), 400, /curto/);
  failure(updateQuestion(db, 'u1', ids[0], {}), 400, /Nada para alterar/);
  failure(updateQuestion(db, 'u2', ids[0], { note: 'x' }), 404);
});

test('apagar uma questão leva as respostas e o lugar nos cadernos', () => {
  const db = newDb();
  const { ids } = seeded(db);
  value(answerQuestion(db, 'u1', ids[0], { chosen: 'B' }));
  value(createNotebook(db, 'u1', { name: 'Caderno', questionIds: ids }));
  failure(deleteQuestion(db, 'u2', ids[0]), 404);
  value(deleteQuestion(db, 'u1', ids[0]));
  assert.equal(count(db, 'qb_answers'), 0);
  assert.equal(count(db, 'qb_notebook_questions'), 2);
  assert.equal(listNotebooks(db, 'u1')[0].questionCount, 2);
});

// ---------- cadernos ----------

test('caderno a partir de um filtro: só questões corrigíveis, e diz quantas ficaram de fora', () => {
  const db = newDb();
  seeded(db, 'u1', exam({ questions: [q(1), q(2, { answer: '' }), q(3, { annulled: true, answer: '' }), q(4, { discipline: 'Outra' })] }));
  const created = value(createNotebook(db, 'u1', { name: '  Meu   caderno ', filter: { discipline: ['Direito Administrativo'] } }));
  assert.equal(created.notebook.name, 'Meu caderno');
  assert.equal(created.added, 1);
  assert.equal(created.skipped, 2);
  failure(createNotebook(db, 'u1', { name: 'meu caderno', filter: {} }), 409, /já tem um caderno/);
  failure(createNotebook(db, 'u1', { name: 'Vazio', filter: { discipline: ['Inexistente'] } }), 422, /Nenhuma questão com gabarito/);
  failure(createNotebook(db, 'u1', { name: 'x', filter: {} }), 400, /pelo menos 2/);
  assert.equal(listNotebooks(db, 'u1').length, 1, 'os que falharam não deixam caderno vazio');
});

test('caderno: limite, ordem e sorteio', () => {
  const db = newDb();
  const questions = Array.from({ length: 10 }, (_, i) => q(i + 1));
  const { ids } = seeded(db, 'u1', exam({ questions }));
  const ordered = value(createNotebook(db, 'u1', { name: 'Em ordem', filter: {}, limit: 4 }));
  assert.equal(ordered.added, 4);
  assert.deepEqual(getInOrder(db, ordered.notebook.id), ids.slice(0, 4));

  const reversing = () => 0; // sempre troca com o primeiro: ordem previsível
  const shuffled = value(createNotebook(db, 'u1', { name: 'Sorteado', filter: {}, shuffle: true, limit: 10 }, reversing));
  assert.deepEqual(new Set(getInOrder(db, shuffled.notebook.id)), new Set(ids), 'sorteio não perde nem repete questão');
  assert.notDeepEqual(getInOrder(db, shuffled.notebook.id), ids);

});

function getInOrder(db: DatabaseSync, notebookId: string): string[] {
  return (db.prepare('SELECT question_id FROM qb_notebook_questions WHERE notebook_id = ? ORDER BY position').all(notebookId) as { question_id: string }[]).map((r) => r.question_id);
}

test('caderno a partir de ids: só questões do usuário', () => {
  const db = newDb();
  const mine = seeded(db);
  const theirs = seeded(db, 'u2');
  const created = value(createNotebook(db, 'u1', { name: 'Misturado', questionIds: [mine.ids[0], theirs.ids[0], 'inexistente', mine.ids[0]] }));
  assert.equal(created.added, 1);
  failure(createNotebook(db, 'u1', { name: 'Só alheia', questionIds: [theirs.ids[0]] }), 422);
});

test('caderno: adicionar, remover, renomear, apagar — e só o dono mexe', () => {
  const db = newDb();
  const { ids } = seeded(db);
  const other = seeded(db, 'u2');
  const notebook = value(createNotebook(db, 'u1', { name: 'Caderno', questionIds: [ids[0]] })).notebook;

  assert.deepEqual(value(addQuestions(db, 'u1', notebook.id, [ids[0], ids[1]])), { added: 1, alreadyInside: 1 });
  failure(addQuestions(db, 'u1', notebook.id, [other.ids[0]]), 404, /Questão não encontrada/);
  failure(addQuestions(db, 'u1', notebook.id, []), 400);
  failure(addQuestions(db, 'u2', notebook.id, [other.ids[0]]), 404, /Caderno não encontrado/);
  assert.equal(listNotebooks(db, 'u1')[0].questionCount, 2);

  const flagged = listNotebooks(db, 'u1', ids[2])[0];
  assert.equal(flagged.containsQuestion, false);
  assert.equal(listNotebooks(db, 'u1', ids[0])[0].containsQuestion, true);

  value(removeQuestion(db, 'u1', notebook.id, ids[0]));
  assert.equal(listNotebooks(db, 'u1')[0].questionCount, 1);
  failure(removeQuestion(db, 'u2', notebook.id, ids[1]), 404);

  assert.equal(value(renameNotebook(db, 'u1', notebook.id, 'Novo nome')).name, 'Novo nome');
  failure(renameNotebook(db, 'u2', notebook.id, 'Roubado'), 404);
  failure(deleteNotebook(db, 'u2', notebook.id), 404);
  value(deleteNotebook(db, 'u1', notebook.id));
  assert.equal(count(db, 'qb_notebook_questions'), 0);
  assert.equal(count(db, 'qb_questions'), 6, 'as questões continuam');
});

test('caderno: detalhe traz as questões na ordem e o progresso', () => {
  const db = newDb();
  const { ids } = seeded(db);
  const notebook = value(createNotebook(db, 'u1', { name: 'Caderno', questionIds: [ids[2], ids[0]] })).notebook;
  value(answerQuestion(db, 'u1', ids[0], { chosen: 'B' }));
  const detail = value(getNotebookDetail(db, 'u1', notebook.id));
  assert.deepEqual(detail.questions.map((x) => x.number), [3, 1], 'na ordem em que foram colocadas');
  assert.deepEqual([detail.notebook.questionCount, detail.notebook.answeredCount, detail.notebook.correctCount], [2, 1, 1]);
  failure(getNotebookDetail(db, 'u2', notebook.id), 404);
  assert.deepEqual(gradableIds(db, 'u1', { notebook: notebook.id }), [ids[0], ids[2]], 'filtrar por caderno');
});

// ---------- simulado ----------

test('simulado: o placar é refeito no servidor e em branco conta como errado', () => {
  const db = newDb();
  const { ids } = seeded(db);
  const notebook = value(createNotebook(db, 'u1', { name: 'Simulado', questionIds: ids })).notebook;
  const now = new Date('2026-10-18T12:00:00Z');
  const result = value(
    recordSimulado(db, 'u1', notebook.id, {
      durationMs: 90_000,
      answers: [
        { questionId: ids[0], chosen: 'b' }, // certa (gabarito B)
        { questionId: ids[1], chosen: 'A' }, // errada (gabarito C)
        { questionId: ids[0], chosen: 'D' }, // repetida: vale a primeira
        { questionId: 'de-outro-caderno', chosen: 'A' }, // ignorada
        { questionId: ids[2], chosen: 'Z' }, // letra que não existe: em branco
      ],
      correct: 3, // um total mandado pelo navegador não vale
    }, now),
  );
  assert.deepEqual({ ...result.attempt }, { id: result.attempt.id, finishedAt: now.toISOString(), durationMs: 90_000, total: 3, correct: 1 });
  assert.deepEqual(result.results.map((r) => [r.chosen, r.correct, r.answer]), [['B', true, 'B'], ['A', false, 'C'], ['', false, 'A']]);
  assert.equal(count(db, 'qb_answers'), 2, 'a em branco não vira resposta');
  assert.equal(loadQuestionViews(db, 'u1', [ids[0]])[0].answer, 'B', 'depois do simulado o gabarito aparece');
  assert.equal(listNotebooks(db, 'u1')[0].attemptCount, 1);
  assert.equal(listNotebooks(db, 'u1')[0].lastAttempt?.correct, 1);
  const history = getQuestionDetail(db, 'u1', ids[0]);
  assert.ok(history.ok && history.value.history[0].inSimulado);
});

test('simulado: sem respostas, sem gabarito ou de outro usuário é recusado', () => {
  const db = newDb();
  const { ids } = seeded(db, 'u1', exam({ questions: [q(1), q(2, { answer: '' })] }));
  const notebook = value(createNotebook(db, 'u1', { name: 'Caderno', questionIds: ids })).notebook;
  failure(recordSimulado(db, 'u1', notebook.id, { answers: [] }), 400, /ao menos uma questão/);
  failure(recordSimulado(db, 'u1', notebook.id, {}), 400, /Não há respostas/);
  failure(recordSimulado(db, 'u2', notebook.id, { answers: [{ questionId: ids[0], chosen: 'B' }] }), 404);
  const onlyUngraded = value(createNotebook(db, 'u1', { name: 'Sem gabarito', questionIds: [ids[1]] })).notebook;
  failure(recordSimulado(db, 'u1', onlyUngraded.id, { answers: [{ questionId: ids[1], chosen: 'A' }] }), 422, /não tem questões com gabarito/);
  assert.equal(count(db, 'qb_attempts'), 0);
});

test('simulado: apagar o caderno apaga as tentativas, mas as respostas ficam', () => {
  const db = newDb();
  const { ids } = seeded(db);
  const notebook = value(createNotebook(db, 'u1', { name: 'Caderno', questionIds: ids })).notebook;
  value(recordSimulado(db, 'u1', notebook.id, { answers: [{ questionId: ids[0], chosen: 'B' }] }));
  value(deleteNotebook(db, 'u1', notebook.id));
  assert.equal(count(db, 'qb_attempts'), 0);
  assert.equal(count(db, 'qb_answers'), 1);
  assert.equal(loadQuestionViews(db, 'u1', [ids[0]])[0].mine?.correct, true, 'a questão continua resolvida');
  assert.equal((db.prepare('SELECT attempt_id FROM qb_answers').get() as { attempt_id: unknown }).attempt_id, null);
});

// ---------- filtros salvos ----------

test('filtros salvos: salvar, listar, aplicar o que foi guardado e apagar', () => {
  const db = newDb();
  const saved = value(saveFilter(db, 'u1', { name: ' Minhas  erradas ', filter: { status: ['errei'], discipline: ['Informática'], bobagem: 1 } }));
  assert.equal(saved.name, 'Minhas erradas');
  assert.deepEqual(saved.filter.status, ['errei']);
  assert.equal(listSavedFilters(db, 'u1').length, 1);
  assert.deepEqual(listSavedFilters(db, 'u1')[0].filter.discipline, ['Informática']);
  assert.equal(listSavedFilters(db, 'u2').length, 0);

  failure(saveFilter(db, 'u1', { name: 'minhas erradas', filter: { status: ['errei'] } }), 409, /já tem um filtro/);
  failure(saveFilter(db, 'u1', { name: 'Vazio', filter: {} }), 400, /ao menos um critério/);
  failure(saveFilter(db, 'u1', { name: 'x', filter: { status: ['errei'] } }), 400, /pelo menos 2/);

  failure(deleteSavedFilter(db, 'u2', saved.id), 404);
  value(deleteSavedFilter(db, 'u1', saved.id));
  assert.equal(listSavedFilters(db, 'u1').length, 0);
});

test('filtro salvo corrompido no banco volta vazio em vez de derrubar a lista', () => {
  const db = newDb();
  db.prepare("INSERT INTO qb_saved_filters (id, user_id, name, filter_json, created_at) VALUES ('f1', 'u1', 'Quebrado', '{não é json', 'x')").run();
  const [filter] = listSavedFilters(db, 'u1');
  assert.equal(filter.name, 'Quebrado');
  assert.deepEqual(filter.filter.status, []);
});

test('apagar o usuário leva tudo do banco de questões', () => {
  const db = newDb();
  db.exec('PRAGMA foreign_keys = ON');
  const { ids } = seeded(db);
  const notebook = value(createNotebook(db, 'u1', { name: 'Caderno', questionIds: ids })).notebook;
  value(recordSimulado(db, 'u1', notebook.id, { answers: [{ questionId: ids[0], chosen: 'B' }] }));
  value(saveFilter(db, 'u1', { name: 'Filtro', filter: { status: ['errei'] } }));
  db.exec("DELETE FROM users WHERE id = 'u1'");
  for (const table of ['qb_exams', 'qb_questions', 'qb_notebooks', 'qb_notebook_questions', 'qb_attempts', 'qb_answers', 'qb_saved_filters']) {
    assert.equal(count(db, table), 0, table);
  }
});
