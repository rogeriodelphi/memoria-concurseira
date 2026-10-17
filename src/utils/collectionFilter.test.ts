import assert from 'node:assert/strict';
import test from 'node:test';

import { filterCollections, normalizeForSearch } from './collectionFilter';

const collections = [
  { id: 1, name: 'Segurança da Informação', subject: 'NIDS e HIDS' },
  { id: 2, name: 'Língua Portuguesa', subject: 'Regência Verbal' },
  { id: 3, name: 'Língua Portuguesa', subject: 'Significação das palavras' },
  { id: 4, name: 'Língua Portuguesa', subject: 'Subordinação' },
  { id: 5, name: 'Redes de Computadores', subject: '' },
  { id: 6, name: 'Direito Constitucional', subject: 'Poder Legislativo' },
];

const ids = (items: { id: number }[]) => items.map((c) => c.id);

test('normalizar: sem acentos, sem maiúsculas e com um espaço só entre as palavras', () => {
  assert.equal(normalizeForSearch('  Língua   PORTUGUESA  '), 'lingua portuguesa');
  assert.equal(normalizeForSearch('Segurança da Informação'), 'seguranca da informacao');
  assert.equal(normalizeForSearch('Ação, órgão, ânimo, çedilha, ÜÑ'), 'acao, orgao, animo, cedilha, un');
  assert.equal(normalizeForSearch('   '), '');
});

test('pesquisa vazia ou só de espaços devolve a própria lista', () => {
  assert.equal(filterCollections(collections, ''), collections);
  assert.equal(filterCollections(collections, '   '), collections);
});

test('acha pelo nome, sem diferenciar maiúsculas nem acentos', () => {
  assert.deepEqual(ids(filterCollections(collections, 'lingua')), [2, 3, 4]);
  assert.deepEqual(ids(filterCollections(collections, 'LÍNGUA PORT')), [2, 3, 4]);
  assert.deepEqual(ids(filterCollections(collections, 'seguranca')), [1]);
});

test('acha pelo assunto', () => {
  assert.deepEqual(ids(filterCollections(collections, 'regencia')), [2]);
  assert.deepEqual(ids(filterCollections(collections, 'nids')), [1]);
  assert.deepEqual(ids(filterCollections(collections, 'subordinacao')), [4]);
});

test('achar um pedaço da palavra, em qualquer posição, conta', () => {
  assert.deepEqual(ids(filterCollections(collections, 'compu')), [5]);
  assert.deepEqual(ids(filterCollections(collections, 'ncia')), [2], '"Regência" termina em "ncia"');
});

test('várias palavras: todas precisam aparecer, no nome ou no assunto, em qualquer ordem', () => {
  assert.deepEqual(ids(filterCollections(collections, 'portuguesa verbal')), [2], 'uma no nome, outra no assunto');
  assert.deepEqual(ids(filterCollections(collections, 'verbal portuguesa')), [2], 'a ordem não importa');
  assert.deepEqual(ids(filterCollections(collections, 'portuguesa palavras')), [3]);
  assert.deepEqual(ids(filterCollections(collections, 'portuguesa direito')), [], 'nenhuma coleção tem as duas');
});

test('sem resultado devolve lista vazia; coleção sem assunto é achada só pelo nome', () => {
  assert.deepEqual(filterCollections(collections, 'matematica'), []);
  assert.deepEqual(ids(filterCollections(collections, 'redes')), [5]);
  assert.deepEqual(filterCollections(collections, 'redes assunto'), []);
});

test('a ordem original da lista é mantida', () => {
  assert.deepEqual(ids(filterCollections([...collections].reverse(), 'lingua')), [4, 3, 2]);
});
