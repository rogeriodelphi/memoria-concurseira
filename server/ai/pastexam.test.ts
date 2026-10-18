import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANNULLED,
  cleanAlternatives,
  mergeChunks,
  mostCommon,
  normalizeAnswer,
  parsePastExamResponse,
  pastExamUserPrompt,
  PASTEXAM_JSON_SCHEMA,
  sourceMatch,
  splitIntoChunks,
  unifyLabels,
  wordSet,
  type Chunk,
  type ExtractedQuestion,
} from './pastexam';

const alts = (n = 4) => ['A', 'B', 'C', 'D', 'E'].slice(0, n).map((letter) => ({ letter, text: `Alternativa ${letter} do teste` }));

const rawQuestion = (over: Record<string, unknown> = {}) => ({
  number: 1,
  supportId: 0,
  statement: 'Qual é a capital do Brasil, segundo a Constituição?',
  alternatives: alts(),
  discipline: 'Geografia',
  subject: 'Capitais',
  needsFigure: false,
  complete: true,
  ...over,
});

const response = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    exam: { name: 'Prova X', board: 'FGV', organ: 'TJ', year: 2023, position: 'Analista', level: 'Superior' },
    supports: [],
    questions: [rawQuestion()],
    answerKey: [],
    ...over,
  });

const question = (number: number, over: Partial<ExtractedQuestion> = {}): ExtractedQuestion => ({
  number,
  sourceId: '',
  support: '',
  statement: `Enunciado da questão ${number} com texto suficiente`,
  alternatives: alts(),
  discipline: 'Português',
  subject: 'Crase',
  answer: '',
  comment: '',
  year: null,
  board: '',
  organ: '',
  prova: '',
  needsFigure: false,
  ...over,
});

const chunk = (questions: ExtractedQuestion[], over: Partial<Chunk> = {}): Chunk => ({
  meta: { name: '', board: '', organ: '', year: null, position: '', level: '' },
  questions,
  answerKey: new Map(),
  ...over,
});

test('gabarito: letra, anulada ou nada', () => {
  assert.equal(normalizeAnswer('c'), 'C');
  assert.equal(normalizeAnswer(' (B) '), 'B');
  assert.equal(normalizeAnswer('E'), 'E');
  assert.equal(normalizeAnswer('anulada'), ANNULLED);
  assert.equal(normalizeAnswer('X'), ANNULLED);
  assert.equal(normalizeAnswer('*'), ANNULLED);
  assert.equal(normalizeAnswer('F'), '', 'só vão até a E');
  assert.equal(normalizeAnswer(''), '');
  assert.equal(normalizeAnswer(3), '');
  assert.equal(normalizeAnswer(undefined), '');
});

test('alternativas: A.. em sequência, de 2 a 5, ou Certo/Errado', () => {
  assert.equal(cleanAlternatives(alts(5))?.length, 5);
  assert.equal(cleanAlternatives(alts(2))?.length, 2);
  assert.deepEqual(cleanAlternatives([{ letter: 'c', text: 'Certo' }, { letter: 'E', text: 'Errado' }])?.map((a) => a.letter), ['C', 'E']);
  assert.equal(cleanAlternatives(alts(1)), null, 'uma só não é múltipla escolha');
  assert.equal(cleanAlternatives([{ letter: 'A', text: 'a' }, { letter: 'C', text: 'c' }]), null, 'pulou a B');
  assert.equal(cleanAlternatives([{ letter: 'B', text: 'b' }, { letter: 'A', text: 'a' }]), null, 'fora de ordem');
  assert.equal(cleanAlternatives([...alts(5), { letter: 'F', text: 'f' }]), null, 'mais de cinco');
  assert.equal(cleanAlternatives([{ letter: 'A', text: 'a' }, { letter: 'B', text: '  ' }]), null, 'alternativa vazia');
  assert.equal(cleanAlternatives('x'), null);
});

test('resposta da IA: questão, metadados e gabarito limpos', () => {
  const parsed = parsePastExamResponse(
    response({
      supports: [{ id: 1, text: '  Texto   de apoio\n\n sobre o tema  ' }],
      questions: [rawQuestion({ supportId: 1, number: 7, statement: '  Qual   afirmação\n está correta?  ' })],
      answerKey: [{ number: 7, answer: 'd' }, { number: 8, answer: 'ANULADA' }, { number: 9, answer: 'Z' }, { number: 10, answer: '' }],
    }),
  );
  assert.deepEqual(parsed.meta, { name: 'Prova X', board: 'FGV', organ: 'TJ', year: 2023, position: 'Analista', level: 'Superior' });
  assert.equal(parsed.questions.length, 1);
  assert.equal(parsed.questions[0].number, 7);
  assert.equal(parsed.questions[0].support, 'Texto de apoio\nsobre o tema');
  assert.equal(parsed.questions[0].statement, 'Qual afirmação\nestá correta?');
  assert.deepEqual([...parsed.answerKey], [[7, 'D'], [8, ANNULLED]], 'letra inválida e vazia não entram');
});

test('resposta da IA: questão cortada, sem alternativas boas ou com número ruim é descartada', () => {
  const parsed = parsePastExamResponse(
    response({
      questions: [
        rawQuestion({ number: 1 }),
        rawQuestion({ number: 2, complete: false }),
        rawQuestion({ number: 3, alternatives: alts(1) }),
        rawQuestion({ number: 0 }),
        rawQuestion({ number: 1000 }),
        rawQuestion({ number: 4, statement: 'curto' }),
        rawQuestion({ number: 5, supportId: 99 }),
      ],
    }),
  );
  assert.deepEqual(parsed.questions.map((q) => q.number), [1, 5]);
  assert.equal(parsed.questions[1].support, '', 'apoio que não existe vira sem apoio');
});

test('resposta da IA: ano e nível inválidos viram vazio; formato errado é erro', () => {
  const parsed = parsePastExamResponse(response({ exam: { name: 'P', board: '', organ: '', year: 3000, position: '', level: 'Pós' } }));
  assert.equal(parsed.meta.year, null);
  assert.equal(parsed.meta.level, '');
  assert.throws(() => parsePastExamResponse(undefined), /formato esperado/);
  assert.throws(() => parsePastExamResponse('não é json'), /formato esperado/);
  assert.throws(() => parsePastExamResponse(JSON.stringify({ questions: 'x', answerKey: [] })), /formato esperado/);
  assert.throws(() => parsePastExamResponse(JSON.stringify({ questions: [] })), /formato esperado/);
  assert.equal(parsePastExamResponse(response({ questions: [] })).questions.length, 0, 'um trecho sem questões é válido');
});

test('o esquema pede todos os campos (a OpenAI exige no modo estrito)', () => {
  const props = PASTEXAM_JSON_SCHEMA.properties;
  assert.deepEqual(PASTEXAM_JSON_SCHEMA.required, Object.keys(props));
  const q = props.questions.items;
  assert.deepEqual(q.required, Object.keys(q.properties));
  assert.deepEqual(props.exam.required, Object.keys(props.exam.properties));
  assert.equal(q.additionalProperties, false);
});

test('pedido ao modelo: o que o usuário informou, as disciplinas e o lugar do trecho', () => {
  const plain = pastExamUserPrompt({}, null);
  assert.doesNotMatch(plain, /banca:|Disciplinas sugeridas|trecho \d/);
  const full = pastExamUserPrompt(
    { board: ' FGV ', year: 2022, position: 'Analista', disciplines: ['Português', ' ', 'Direito Constitucional'] },
    { index: 1, total: 4 },
  );
  assert.match(full, /banca: FGV; ano: 2022; cargo: Analista/);
  assert.match(full, /Disciplinas sugeridas: Português; Direito Constitucional\./);
  assert.match(full, /trecho 2 de 4/);
  assert.doesNotMatch(pastExamUserPrompt({}, { index: 0, total: 1 }), /trecho 1 de 1/, 'um trecho só não precisa avisar');
});

test('trechos: texto curto fica inteiro, vazio não gera nada', () => {
  assert.deepEqual(splitIntoChunks('  curto  '), ['curto']);
  assert.deepEqual(splitIntoChunks('   '), []);
  assert.throws(() => splitIntoChunks('x', 100, 100), /menor que o trecho/);
});

test('trechos: cortam em quebra de linha, repetem a emenda e cobrem o texto inteiro', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `linha ${String(i).padStart(3, '0')} com algum texto de prova`);
  const text = lines.join('\n');
  const chunks = splitIntoChunks(text, 2000, 600);
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(c.length <= 2000, `trecho de ${c.length}`);
  // Nenhum trecho começa ou termina no meio de uma linha.
  for (const c of chunks) for (const line of c.split('\n')) assert.ok(lines.includes(line), `linha cortada: ${line}`);
  // Todas as linhas aparecem em algum trecho.
  const seen = new Set(chunks.flatMap((c) => c.split('\n')));
  for (const line of lines) assert.ok(seen.has(line));
  // Cada trecho repete o fim do anterior.
  for (let i = 1; i < chunks.length; i++) {
    const previousLines = chunks[i - 1].split('\n');
    assert.ok(chunks[i].split('\n').some((l) => previousLines.includes(l)), `trecho ${i} não repete nada do anterior`);
  }
});

test('trechos: texto sem quebra de linha ainda é cortado e termina', () => {
  const text = 'palavra '.repeat(1000);
  const chunks = splitIntoChunks(text, 1000, 200);
  assert.ok(chunks.length >= 8);
  assert.ok(chunks.every((c) => c.length <= 1000));
});

test('mais comum: ignora acento e caixa, vazio nunca vence, empate fica com o primeiro', () => {
  assert.equal(mostCommon(['Língua Portuguesa', 'língua portuguesa', 'Inglês']), 'Língua Portuguesa');
  assert.equal(mostCommon(['', '', 'FGV']), 'FGV');
  assert.equal(mostCommon(['', ' ']), '');
  assert.equal(mostCommon(['A', 'B']), 'A');
  assert.equal(mostCommon([]), '');
});

test('junção: sem número repetido (vale a mais completa), em ordem, com metadados e gabarito', () => {
  const cut = question(3, { alternatives: alts(2), statement: 'Enunciado da questão 3 que ficou pela metade' });
  const whole = question(3, { alternatives: alts(4) });
  const merged = mergeChunks([
    chunk([question(1), question(2), cut], { meta: { name: 'Prova A', board: 'FGV', organ: '', year: 2023, position: '', level: 'Superior' }, answerKey: new Map([[1, 'A']]) }),
    chunk([whole, question(4)], { meta: { name: 'prova a', board: 'FGV', organ: 'TJ', year: 2023, position: '', level: '' }, answerKey: new Map([[2, 'B'], [1, 'A']]) }),
  ]);
  assert.deepEqual(merged.questions.map((q) => q.number), [1, 2, 3, 4]);
  assert.equal(merged.questions[2].alternatives.length, 4, 'ficou a versão inteira');
  assert.deepEqual(merged.meta, { name: 'Prova A', board: 'FGV', organ: 'TJ', year: 2023, position: '', level: 'Superior' });
  assert.deepEqual([...merged.answerKey], [[1, 'A'], [2, 'B']]);
  assert.deepEqual(merged.conflictingKeys, []);
});

test('junção: gabaritos diferentes para a mesma questão são sinalizados e vale o primeiro', () => {
  const merged = mergeChunks([chunk([], { answerKey: new Map([[5, 'A'], [6, 'C']]) }), chunk([], { answerKey: new Map([[5, 'B'], [6, 'C']]) })]);
  assert.equal(merged.answerKey.get(5), 'A');
  assert.deepEqual(merged.conflictingKeys, [5]);
});

test('nomes de disciplina e assunto: "Língua portuguesa" e "língua Portuguesa" viram um só', () => {
  const unified = unifyLabels([
    question(1, { discipline: 'Língua Portuguesa', subject: 'Crase' }),
    question(2, { discipline: 'língua portuguesa', subject: 'crase' }),
    question(3, { discipline: 'Língua Portuguesa', subject: 'Crase' }),
    question(4, { discipline: '', subject: '' }),
  ]);
  assert.deepEqual(unified.map((q) => q.discipline), ['Língua Portuguesa', 'Língua Portuguesa', 'Língua Portuguesa', '']);
  assert.deepEqual(unified.map((q) => q.subject), ['Crase', 'Crase', 'Crase', '']);
});

test('conferência com o PDF: a questão fiel bate, a reescrita não', () => {
  const pdf = wordSet(
    'Qual das alternativas apresenta corretamente a concordância verbal? Os estudantes chegaram cedo. Aquele aluno chegaram tarde. Ninguém sabiam a resposta.',
  );
  const faithful = question(1, {
    statement: 'Qual das alternativas apresenta corretamente a concordância verbal?',
    alternatives: [
      { letter: 'A', text: 'Os estudantes chegaram cedo.' },
      { letter: 'B', text: 'Aquele aluno chegaram tarde.' },
      { letter: 'C', text: 'Ninguém sabiam a resposta.' },
    ],
  });
  assert.equal(sourceMatch(faithful, pdf), 1);

  const rewritten = question(2, {
    statement: 'Identifique a frase gramaticalmente adequada quanto ao acordo entre sujeito e predicado.',
    alternatives: [
      { letter: 'A', text: 'Os discentes compareceram antecipadamente.' },
      { letter: 'B', text: 'O estudante compareceram tarde demais.' },
    ],
  });
  assert.ok(sourceMatch(rewritten, pdf) < 0.5);

  // Hifenização e colunas embaralhadas não derrubam: a ordem das palavras não conta.
  const shuffled = wordSet('verbal concordância corretamente apresenta alternativas das Qual');
  assert.equal(sourceMatch(question(3, { statement: 'Qual das alternativas apresenta corretamente a concordância verbal?', alternatives: alts(2).map((a) => ({ ...a, text: 'sim' })) }), shuffled), 1);
});

test('conferência com o PDF: questão só de palavras curtas não é suspeita', () => {
  assert.equal(sourceMatch(question(1, { statement: 'A é B? 1 e 2.', alternatives: [{ letter: 'A', text: 'x' }, { letter: 'B', text: 'y' }] }), new Set()), 1);
});

// ---------- site de questões: código, resposta, comentário e dados de cada questão ----------

const siteQuestion = (over: Record<string, unknown> = {}) =>
  rawQuestion({
    sourceId: ' q4229308 ',
    answer: 'c',
    comment: '  Gabarito: C\n\n  Fundamento decisivo:   o resolvedor atua como intermediário.  ',
    year: 2026,
    board: ' IDHTEC ',
    organ: 'Prefeitura de Santa Filomena - PE',
    prova: 'IDHTEC - 2026 - Prefeitura de Santa Filomena - PE - Técnico em Informática',
    ...over,
  });

test('site de questões: lê o código, a resposta, o comentário e a prova de cada questão', () => {
  const parsed = parsePastExamResponse(response({ questions: [siteQuestion()] }));
  const q = parsed.questions[0];
  assert.equal(q.sourceId, 'Q4229308', 'sem espaços e em maiúsculas');
  assert.equal(q.answer, 'C');
  assert.equal(q.comment, 'Gabarito: C\nFundamento decisivo: o resolvedor atua como intermediário.');
  assert.deepEqual([q.year, q.board, q.organ], [2026, 'IDHTEC', 'Prefeitura de Santa Filomena - PE']);
  assert.match(q.prova, /Técnico em Informática$/);
});

test('site de questões: resposta, ano e código inválidos viram vazio; prova comum não precisa de nada disso', () => {
  const parsed = parsePastExamResponse(response({ questions: [siteQuestion({ answer: 'F', year: 0, sourceId: 5 }), rawQuestion({ number: 2 })] }));
  assert.equal(parsed.questions[0].answer, '', 'F não é alternativa');
  assert.equal(parsed.questions[0].year, null);
  assert.equal(parsed.questions[0].sourceId, '');
  const plain = parsed.questions[1];
  assert.deepEqual([plain.sourceId, plain.answer, plain.comment, plain.prova, plain.board, plain.organ, plain.year], ['', '', '', '', '', '', null]);
});

test('site de questões: anulada escrita junto da questão', () => {
  assert.equal(parsePastExamResponse(response({ questions: [siteQuestion({ answer: 'Anulada' })] })).questions[0].answer, ANNULLED);
});

test('o esquema inclui os campos novos como obrigatórios', () => {
  const required = PASTEXAM_JSON_SCHEMA.properties.questions.items.required;
  for (const field of ['sourceId', 'answer', 'comment', 'year', 'board', 'organ', 'prova']) assert.ok(required.includes(field), field);
});

test('junção: a mesma questão do site em dois trechos vale pelo código, com o comentário mais completo e a resposta que um deles leu', () => {
  const cut = question(1, { sourceId: 'Q1', comment: 'Fundamento: começo', answer: '' });
  const whole = question(1, { sourceId: 'Q1', comment: 'Fundamento: começo e o resto da análise das alternativas', answer: 'C' });
  const other = question(1, { sourceId: 'Q2' }); // mesma posição, outra questão
  const merged = mergeChunks([chunk([cut, other]), chunk([whole])]);
  assert.equal(merged.questions.length, 2, 'não confunde duas questões que têm o mesmo número');
  const q1 = merged.questions.find((q) => q.sourceId === 'Q1')!;
  assert.match(q1.comment, /resto da análise/);
  assert.equal(q1.answer, 'C');
  const reversed = mergeChunks([chunk([whole]), chunk([cut])]).questions.find((q) => q.sourceId === 'Q1')!;
  assert.equal(reversed.answer, 'C', 'a ordem dos trechos não muda o resultado');
  assert.match(reversed.comment, /resto da análise/);
});
