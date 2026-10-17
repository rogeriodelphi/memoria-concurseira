import assert from 'node:assert/strict';
import test from 'node:test';

import { disciplineCollectionIds, MAX_STUDY_COLLECTIONS, safeReturnPath, studyHref } from './examLinks';

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
