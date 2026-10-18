import assert from 'node:assert/strict';
import test from 'node:test';

import { disciplineCollectionIds, MAX_STUDY_COLLECTIONS, safeReturnPath, safeReturnUrl, studyHref } from './examLinks';

test('coleções da disciplina: sem repetir, na ordem dos tópicos, e no máximo 200', () => {
  assert.deepEqual(
    disciplineCollectionIds([{ collectionIds: ['a', 'b'] }, { collectionIds: [] }, { collectionIds: ['b', 'c'] }, { collectionIds: ['a'] }]),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(disciplineCollectionIds([]), []);
  const many = Array.from({ length: 250 }, (_, i) => ({ collectionIds: [`c${i}`] }));
  const ids = disciplineCollectionIds(many);
  assert.equal(ids.length, MAX_STUDY_COLLECTIONS);
  assert.equal(ids[0], 'c0');
});

test('endereço: a página certa, as coleções, o nome (com acento e símbolos) e o voltar', () => {
  const study = studyHref('study', ['a', 'b'], 'Conhecimentos Específicos & Gerais', '/concursos/x-1');
  const listen = studyHref('listen', ['a'], 'Português', '/concursos/x-1');
  assert.ok(study.startsWith('/disciplina/estudar?'));
  assert.ok(listen.startsWith('/maos-livres?'));

  const params = new URL(study, 'http://x').searchParams;
  assert.equal(params.get('ids'), 'a,b');
  assert.equal(params.get('nome'), 'Conhecimentos Específicos & Gerais', 'o "&" e os acentos sobrevivem ao endereço');
  assert.equal(params.get('voltar'), '/concursos/x-1');
});

test('voltar: só caminho interno simples', () => {
  assert.equal(safeReturnPath('/concursos/51f58361-227e-4b8c-ad27-051d788e109e'), '/concursos/51f58361-227e-4b8c-ad27-051d788e109e');
  assert.equal(safeReturnPath('/colecoes'), '/colecoes');
  assert.equal(safeReturnPath('/'), '/');
  for (const bad of [null, '', 'concursos', '//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/a?b=1', '/a#x', '/a b', '/../x:y', `/${'a'.repeat(250)}`]) {
    assert.equal(safeReturnPath(bad), null, String(bad));
  }
});

test('voltar com parâmetros: o caminho simples mais um "?" curto; nada que saia do app', () => {
  assert.equal(safeReturnUrl('/desempenho'), '/desempenho');
  assert.equal(safeReturnUrl('/desempenho?dias=30&nome=seguranca+da+informacao&assunto=mfa'), '/desempenho?dias=30&nome=seguranca+da+informacao&assunto=mfa');
  assert.equal(safeReturnUrl('/desempenho?de=2026-10-01&ate=2026-10-17&escopo=concurso'), '/desempenho?de=2026-10-01&ate=2026-10-17&escopo=concurso');
  assert.equal(safeReturnUrl('/desempenho?nome=l%C3%ADngua+portuguesa'), '/desempenho?nome=l%C3%ADngua+portuguesa');
  for (const bad of [null, '', '//evil.com', 'https://evil.com', '/\\evil', '/a\\b?x=1', 'javascript:alert(1)', '/a?x=<script>', '/a?x=1#frag', '/a?x=1 y=2', '/a?x="1"', '/a b?x=1', `/a?${'x'.repeat(400)}`, '/a??', '/a?x=1?y=2']) {
    assert.equal(safeReturnUrl(bad), null, String(bad));
  }
});
