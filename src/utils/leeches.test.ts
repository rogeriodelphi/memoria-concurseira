import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendMacete,
  emptySplitDraft,
  leechHeadline,
  MAX_MACETE_CHARS,
  MAX_SPLIT_CARDS,
  resultsSummary,
  shortDate,
  snoozedLabel,
  splitProblem,
} from './leeches';

test('appendMacete põe o macete numa linha própria em itálico, depois da resposta', () => {
  assert.equal(appendMacete('<div>Resposta</div>', 'DNS = nomes'), '<div>Resposta</div><div><br></div><div><i>Macete: DNS = nomes</i></div>');
});

test('appendMacete sem texto devolve a resposta como está', () => {
  assert.equal(appendMacete('<div>Resposta</div>', ''), '<div>Resposta</div>');
  assert.equal(appendMacete('<div>Resposta</div>', '   \n  '), '<div>Resposta</div>');
});

test('appendMacete trata o macete como texto: tags viram texto e as quebras viram <br>', () => {
  assert.equal(appendMacete('x', 'a <b>b</b> & c\nlinha 2'), 'x<div><br></div><div><i>Macete: a &lt;b&gt;b&lt;/b&gt; &amp; c<br>linha 2</i></div>');
});

test('appendMacete corta o macete grande demais', () => {
  const out = appendMacete('x', 'a'.repeat(MAX_MACETE_CHARS + 50));
  assert.equal(out, `x<div><br></div><div><i>Macete: ${'a'.repeat(MAX_MACETE_CHARS)}</i></div>`);
});

test('leechHeadline conta os erros e as revisões, no plural certo', () => {
  assert.equal(leechHeadline({ errors: 4, reviews: 5 }), 'Errou 4 das últimas 5 revisões');
  assert.equal(leechHeadline({ errors: 2, reviews: 2 }), 'Errou 2 das últimas 2 revisões');
  assert.equal(leechHeadline({ errors: 1, reviews: 1 }), 'Errou 1 das últimas 1 revisão');
});

test('shortDate dá dia/mês com dois dígitos', () => {
  assert.equal(shortDate('2026-11-02T12:00:00.000Z'), '02/11');
  assert.equal(shortDate('2026-12-25T12:00:00.000Z'), '25/12');
});

test('snoozedLabel só aparece quando o cartão está adiado e tem data', () => {
  assert.equal(snoozedLabel({ snoozed: true, snoozedUntil: '2026-11-02T12:00:00.000Z' }), 'Adiado até 02/11');
  assert.equal(snoozedLabel({ snoozed: false, snoozedUntil: null }), '');
  assert.equal(snoozedLabel({ snoozed: true, snoozedUntil: null }), '');
});

test('resultsSummary nomeia cada revisão, da mais antiga para a mais nova', () => {
  assert.equal(resultsSummary(['errei', 'dificil', 'bom', 'facil']), 'Errei, Difícil, Bom, Fácil');
  assert.equal(resultsSummary([]), '');
});

test('splitProblem pede ao menos 2 cartões, no máximo 6, e os dois campos de cada um', () => {
  const ok = { question: '<div>Pergunta</div>', answer: '<div>Resposta</div>' };
  assert.equal(splitProblem([ok, ok]), null);
  assert.equal(splitProblem(Array(MAX_SPLIT_CARDS).fill(ok)), null);
  assert.match(splitProblem([ok])!, /pelo menos 2/);
  assert.match(splitProblem(Array(MAX_SPLIT_CARDS + 1).fill(ok))!, /No máximo 6/);
  assert.match(splitProblem([ok, emptySplitDraft()])!, /cartão 2/);
  assert.match(splitProblem([{ question: '', answer: 'x' }, ok])!, /cartão 1/);
  assert.match(splitProblem([ok, { question: 'x', answer: '<div><br></div>' }])!, /cartão 2/);
  assert.equal(splitProblem([ok, { question: '<img src="x">', answer: 'y' }]), null, 'uma figura conta como conteúdo');
});
