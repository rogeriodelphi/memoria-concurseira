import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ASK,
  MAX_HISTORY_REPLY_CHARS,
  MAX_SOURCE_CHARS,
  parseTutorResponse,
  TUTOR_JSON_SCHEMA,
  TUTOR_SYSTEM_PROMPT,
  tutorUserPrompt,
  type TutorSource,
} from './tutor';

const source: TutorSource = {
  question: 'O que é quórum em um cluster?',
  answer: 'O número mínimo de elementos operacionais para o cluster funcionar.',
  context: 'Redes de Computadores · Cluster',
  ask: '',
  history: [],
};

const json = (value: unknown) => JSON.stringify(value);
const reply = (over: Record<string, unknown> = {}) => ({ answer: 'O quórum evita que o cluster se divida.', example: '', tip: '', caution: '', ...over });

test('o esquema pede os quatro campos, todos obrigatórios (as três IAs usam o mesmo)', () => {
  assert.deepEqual(Object.keys(TUTOR_JSON_SCHEMA.properties), ['answer', 'example', 'tip', 'caution']);
  assert.deepEqual(TUTOR_JSON_SCHEMA.required, ['answer', 'example', 'tip', 'caution']);
  assert.equal(TUTOR_JSON_SCHEMA.additionalProperties, false);
});

test('o prompt do professor protege o cartão: o aluno manda, e a IA não inventa número, data nem lei', () => {
  assert.match(TUTOR_SYSTEM_PROMPT, /NÃO invente números, datas, artigos de lei/);
  assert.match(TUTOR_SYSTEM_PROMPT, /a resposta do cartão é a referência do aluno/);
  assert.match(TUTOR_SYSTEM_PROMPT, /DÚVIDA/);
});

test('o pedido leva o cartão e onde ele está; sem pergunta, pede a explicação padrão', () => {
  const prompt = tutorUserPrompt(source);
  assert.match(prompt, /Coleção: Redes de Computadores · Cluster/);
  assert.match(prompt, /Pergunta do cartão: O que é quórum em um cluster\?\nResposta do cartão: O número mínimo/);
  assert.ok(prompt.endsWith(`Pedido do aluno: ${DEFAULT_ASK}`));
  assert.doesNotMatch(prompt, /Conversa até aqui/);
  assert.doesNotMatch(tutorUserPrompt({ ...source, context: '' }), /Coleção:/);
});

test('a pergunta do aluno e a conversa anterior entram no pedido, na ordem', () => {
  const prompt = tutorUserPrompt({
    ...source,
    ask: 'Dê um exemplo',
    history: [{ ask: 'Explique melhor', answer: 'O quórum é a maioria.' }, { ask: 'E se faltar?', answer: 'O cluster para.' }],
  });
  assert.ok(prompt.indexOf('Aluno: Explique melhor') < prompt.indexOf('Aluno: E se faltar?'));
  assert.match(prompt, /Professor: O quórum é a maioria\./);
  assert.ok(prompt.endsWith('Pedido do aluno: Dê um exemplo'));
  assert.doesNotMatch(prompt, new RegExp(DEFAULT_ASK));
});

test('um cartão ou uma resposta anterior enormes são cortados no pedido', () => {
  const prompt = tutorUserPrompt({
    ...source,
    question: 'q'.repeat(MAX_SOURCE_CHARS + 500),
    answer: 'a'.repeat(MAX_SOURCE_CHARS + 500),
    history: [{ ask: 'x', answer: 'r'.repeat(MAX_HISTORY_REPLY_CHARS + 500) }],
  });
  assert.ok(prompt.includes(`${'q'.repeat(MAX_SOURCE_CHARS)}…`));
  assert.ok(prompt.includes(`${'a'.repeat(MAX_SOURCE_CHARS)}…`));
  assert.ok(prompt.includes(`${'r'.repeat(MAX_HISTORY_REPLY_CHARS)}…`));
});

test('a resposta válida vira texto limpo, com os parágrafos preservados', () => {
  const parsed = parseTutorResponse(
    json(reply({ answer: '  **Quórum** é a maioria  de votos.\n\n\n\nSem ele, o <b>cluster</b> para.  ', example: 'Exemplo: três nós, dois votam.', tip: 'Macete: maioria manda', caution: 'Atenção: não confunda com quorum de leitura.' })),
  );
  assert.equal(parsed.answer, 'Quórum é a maioria de votos.\n\nSem ele, o cluster para.');
  assert.equal(parsed.example, 'três nós, dois votam.', 'o rótulo "Exemplo:" é tirado: a tela já o põe');
  assert.equal(parsed.tip, 'maioria manda');
  assert.equal(parsed.caution, 'não confunda com quorum de leitura.');
});

test('campos opcionais ausentes ou que não são texto viram vazio; a explicação é obrigatória', () => {
  const parsed = parseTutorResponse(json({ answer: 'Só a explicação.', example: 7, tip: null }));
  assert.deepEqual(parsed, { answer: 'Só a explicação.', example: '', tip: '', caution: '' });
  for (const bad of [undefined, '', 'não é json', json(null), json([]), json(reply({ answer: '   ' })), json(reply({ answer: 5 })), json({})]) {
    assert.throws(() => parseTutorResponse(bad as string | undefined), /nenhuma explicação utilizável/, String(bad));
  }
});

test('textos longos são cortados com reticências, e um símbolo solto (C#, snake_case) não é apagado', () => {
  const long = parseTutorResponse(json(reply({ answer: 'a'.repeat(5000), tip: 'b'.repeat(900) })));
  assert.ok(long.answer.length <= 1800 && long.answer.endsWith('…'));
  assert.ok(long.tip.length <= 400 && long.tip.endsWith('…'));
  assert.equal(parseTutorResponse(json(reply({ answer: 'Em C# use snake_case só em Python.' }))).answer, 'Em C# use snake_case só em Python.');
});
