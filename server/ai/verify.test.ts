import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_VERIFY_PER_CALL, parseVerifyResponse, VERIFY_JSON_SCHEMA, VERIFY_SYSTEM_PROMPT, verifyUserPrompt, type VerifySource } from './verify';

const SOURCES: VerifySource[] = [
  { n: 1, question: 'Qual a porta do SSH?', answer: 'A porta TCP 22.' },
  { n: 2, question: 'Prazo da LGPD para comunicar incidente?', answer: '48 horas.' },
];
const reply = (checks: unknown) => JSON.stringify({ checks });

test('pedido: cada cartão vai numerado, com o contexto da prova antes', () => {
  const prompt = verifyUserPrompt(SOURCES, 'concurso TRANSPETRO 2026, banca CESGRANRIO');
  assert.match(prompt, /Contexto: concurso TRANSPETRO 2026, banca CESGRANRIO/);
  assert.match(prompt, /\[n=1\]\nPergunta: Qual a porta do SSH\?\nResposta: A porta TCP 22\./);
  assert.match(prompt, /\[n=2\]\nPergunta: Prazo da LGPD/);
  assert.doesNotMatch(verifyUserPrompt(SOURCES, '  '), /Contexto:/);
});

test('pedido: um cartão enorme é cortado, sem derrubar o pedido', () => {
  const prompt = verifyUserPrompt([{ n: 1, question: 'P', answer: 'x'.repeat(5000) }], '');
  assert.ok(prompt.length < 2000);
  assert.match(prompt, /…/);
});

test('instruções: conservadora, atenta a artigo/prazo/valor, sem inventar correção', () => {
  assert.match(VERIFY_SYSTEM_PROMPT, /Seja conservador/);
  assert.match(VERIFY_SYSTEM_PROMPT, /número de\s+artigo, prazo, valor/);
  assert.match(VERIFY_SYSTEM_PROMPT, /Nunca invente uma correção/);
  assert.deepEqual(VERIFY_JSON_SCHEMA.properties.checks.items.properties.verdict.enum, ['ok', 'duvida', 'erro']);
  assert.ok(MAX_VERIFY_PER_CALL >= 5);
});

test('validação: devolve as conferências com veredito e motivo, sem espaços repetidos', () => {
  const result = parseVerifyResponse(reply([
    { n: 1, verdict: 'ok', note: '' },
    { n: 2, verdict: 'erro', note: '  O   prazo é de 3 dias úteis,\nsegundo a ANPD.  ' },
  ]), SOURCES);
  assert.deepEqual(result, [{ n: 1, verdict: 'ok', note: '' }, { n: 2, verdict: 'erro', note: 'O prazo é de 3 dias úteis, segundo a ANPD.' }]);
});

test('validação: número desconhecido, repetido ou veredito inválido ficam de fora, sem derrubar o resto', () => {
  const result = parseVerifyResponse(reply([
    { n: 99, verdict: 'ok', note: '' },
    { n: 1, verdict: 'talvez', note: 'x' },
    { n: 1, verdict: 'duvida', note: 'primeira vale' },
    { n: 1, verdict: 'erro', note: 'repetida' },
    { n: '2', verdict: 'ok', note: '' },
    null,
    { verdict: 'ok' },
  ]), SOURCES);
  assert.deepEqual(result, [{ n: 1, verdict: 'duvida', note: 'primeira vale' }]);
});

test('validação: nota que não é texto vira vazia; nota enorme é cortada', () => {
  const result = parseVerifyResponse(reply([{ n: 1, verdict: 'duvida', note: 42 }, { n: 2, verdict: 'erro', note: 'x'.repeat(2000) }]), SOURCES);
  assert.equal(result[0].note, '');
  assert.equal(result[1].note.length, 401, '400 caracteres e a reticência');
  assert.ok(result[1].note.endsWith('…'));
});

test('validação: resposta que não é o JSON esperado, ou sem nenhuma conferência útil, é erro (a cadeia tenta o próximo provedor)', () => {
  for (const bad of [undefined, '', 'isto não é json', '{}', '{"checks": "x"}', reply([]), reply([{ n: 9, verdict: 'ok', note: '' }]), reply([{ n: 1, verdict: 'nope' }])]) {
    assert.throws(() => parseVerifyResponse(bad, SOURCES), /não retornou a conferência/, String(bad));
  }
});
