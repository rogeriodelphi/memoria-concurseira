import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEECH_FIX_JSON_SCHEMA,
  LEECH_FIX_SYSTEM_PROMPT,
  leechFixUserPrompt,
  MAX_DIAGNOSIS_CHARS,
  MAX_MACETE_CHARS,
  MAX_SOURCE_CHARS,
  MAX_SUGGESTED_PARTS,
  parseLeechFixResponse,
  type LeechFixSource,
} from './leechfix';

const source: LeechFixSource = {
  question: 'O que é quórum em um cluster?',
  answer: 'O número mínimo de elementos operacionais para o cluster funcionar.',
  context: 'Redes de Computadores · Cluster',
  errors: 5,
  reviews: 8,
};

const json = (value: unknown) => JSON.stringify(value);
const part = (n: number) => ({ question: `Pergunta ${n}?`, answer: `Resposta ${n}.` });

test('o pedido leva o cartão, onde ele está e o quanto o usuário o erra', () => {
  const prompt = leechFixUserPrompt(source);
  assert.match(prompt, /Coleção: Redes de Computadores · Cluster/);
  assert.match(prompt, /errou este cartão 5 das últimas 8 revisões/);
  assert.match(prompt, /Pergunta: O que é quórum em um cluster\?\nResposta: O número mínimo/);
  assert.doesNotMatch(leechFixUserPrompt({ ...source, context: '' }), /Coleção:/);
});

test('um cartão enorme é cortado no pedido', () => {
  const prompt = leechFixUserPrompt({ ...source, question: 'q'.repeat(MAX_SOURCE_CHARS + 500), answer: 'a'.repeat(MAX_SOURCE_CHARS + 500) });
  assert.ok(prompt.includes(`${'q'.repeat(MAX_SOURCE_CHARS)}…`));
  assert.ok(prompt.includes(`${'a'.repeat(MAX_SOURCE_CHARS)}…`));
  assert.ok(prompt.length < MAX_SOURCE_CHARS * 2 + 400);
});

test('as instruções proíbem inventar fatos e o esquema pede os três campos', () => {
  assert.match(LEECH_FIX_SYSTEM_PROMPT, /SEM acrescentar fatos/);
  assert.match(LEECH_FIX_SYSTEM_PROMPT, /UMA ideia só/);
  assert.deepEqual(LEECH_FIX_JSON_SCHEMA.required, ['diagnosis', 'macete', 'split']);
  assert.deepEqual(LEECH_FIX_JSON_SCHEMA.properties.split.items.required, ['question', 'answer']);
});

test('resposta completa: diagnóstico, macete e divisão', () => {
  const fix = parseLeechFixResponse(json({ diagnosis: 'Traz duas ideias.', macete: 'QUÓRUM = mínimo para votar', split: [part(1), part(2)] }));
  assert.deepEqual(fix, { diagnosis: 'Traz duas ideias.', macete: 'QUÓRUM = mínimo para votar', split: [part(1), part(2)] });
});

test('só o macete (sem divisão) ou só a divisão (sem macete) bastam', () => {
  assert.deepEqual(parseLeechFixResponse(json({ diagnosis: 'd', macete: 'm', split: [] })).split, []);
  const onlySplit = parseLeechFixResponse(json({ diagnosis: 'd', macete: '', split: [part(1), part(2)] }));
  assert.equal(onlySplit.macete, '');
  assert.equal(onlySplit.split.length, 2);
});

test('sem macete e sem divisão não há sugestão: é erro (a cadeia tenta o próximo provedor)', () => {
  const unusable = /nenhuma sugestão utilizável/;
  assert.throws(() => parseLeechFixResponse(json({ diagnosis: 'só o diagnóstico', macete: '', split: [] })), unusable);
  assert.throws(() => parseLeechFixResponse(json({ diagnosis: 'd', macete: '   ', split: [part(1)] })), unusable, 'uma divisão em um só cartão não é divisão');
  assert.throws(() => parseLeechFixResponse(json({})), unusable);
  assert.throws(() => parseLeechFixResponse(json([])), unusable);
  assert.throws(() => parseLeechFixResponse('isto não é json'), unusable);
  assert.throws(() => parseLeechFixResponse(''), unusable);
  assert.throws(() => parseLeechFixResponse(undefined), unusable);
  assert.throws(() => parseLeechFixResponse('null'), unusable);
});

test('tira o "Macete:" do começo, a marcação e os espaços repetidos', () => {
  const fix = parseLeechFixResponse(json({ diagnosis: '  **Muita**   coisa\nnum só cartão ', macete: 'Macete: <b>SOS</b> = `Salvar`   Os Sonhos', split: [] }));
  assert.equal(fix.diagnosis, 'Muita coisa num só cartão');
  assert.equal(fix.macete, 'SOS = Salvar Os Sonhos');
  assert.equal(parseLeechFixResponse(json({ diagnosis: '', macete: 'macete - uma sigla', split: [] })).macete, 'uma sigla');
});

test('não apaga símbolos que são texto de verdade (C#, snake_case, #hashtag, 2 * 3)', () => {
  const fix = parseLeechFixResponse(json({ diagnosis: 'Confunde C# com C++', macete: 'use snake_case e #tag, 2 * 3 = 6', split: [] }));
  assert.equal(fix.diagnosis, 'Confunde C# com C++');
  assert.equal(fix.macete, 'use snake_case e #tag, 2 * 3 = 6');
});

test('corta o que passa do limite e descarta o que não é texto', () => {
  const fix = parseLeechFixResponse(json({ diagnosis: 'd'.repeat(MAX_DIAGNOSIS_CHARS + 100), macete: 'm'.repeat(MAX_MACETE_CHARS + 100), split: [] }));
  assert.ok(fix.diagnosis.length <= MAX_DIAGNOSIS_CHARS);
  assert.ok(fix.macete.length <= MAX_MACETE_CHARS);
  assert.ok(fix.macete.endsWith('…'));
  const weird = parseLeechFixResponse(json({ diagnosis: 42, macete: 'ok', split: 'não é lista' }));
  assert.deepEqual(weird, { diagnosis: '', macete: 'ok', split: [] });
});

test('a divisão fica só com os cartões completos e no máximo 4', () => {
  const messy = [part(1), { question: 'Sem resposta?', answer: '' }, { question: '', answer: 'Sem pergunta' }, null, 'x', part(2), part(3), part(4), part(5), part(6)];
  const { split } = parseLeechFixResponse(json({ diagnosis: 'd', macete: '', split: messy }));
  assert.equal(split.length, MAX_SUGGESTED_PARTS);
  assert.deepEqual(split.map((p) => p.question), ['Pergunta 1?', 'Pergunta 2?', 'Pergunta 3?', 'Pergunta 4?']);
  // sobra só um cartão completo: não é divisão
  assert.deepEqual(parseLeechFixResponse(json({ diagnosis: 'd', macete: 'm', split: [part(1), { question: 'x', answer: '' }] })).split, []);
});
