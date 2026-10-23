import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnlinkedCollection } from '../types';
import { collectionSize, filterTopics, groupTopics, matchLabel, tiedMessage, unlinkedSummary, type TopicOption } from './unlinked';

const base = { id: 'c', name: 'N', subject: 'S', suggestions: [], tied: 0 };

test('collectionSize: cartões, novos e vencidos, sem repetir zeros', () => {
  assert.equal(collectionSize({ cards: 157, newCards: 120, dueCards: 5 }), '157 cartões · 120 novos · 5 vencidos');
  assert.equal(collectionSize({ cards: 1, newCards: 0, dueCards: 1 }), '1 cartão · 1 vencido');
  assert.equal(collectionSize({ cards: 20, newCards: 0, dueCards: 0 }), '20 cartões');
  assert.equal(collectionSize({ cards: 0, newCards: 0, dueCards: 0 }), 'sem cartões');
});

test('matchLabel e tiedMessage', () => {
  assert.equal(matchLabel({ strong: true }), 'quase igual');
  assert.equal(matchLabel({ strong: false }), 'provável');
  assert.match(tiedMessage(10), /casa com 10 tópicos/);
  assert.match(tiedMessage(4), /Escolha o tópico certo/);
});

test('unlinkedSummary soma coleções e cartões, no plural certo', () => {
  const list: UnlinkedCollection[] = [
    { ...base, id: 'a', cards: 157, newCards: 0, dueCards: 0 },
    { ...base, id: 'b', cards: 1, newCards: 0, dueCards: 0 },
  ];
  assert.equal(unlinkedSummary(list), '2 coleções · 158 cartões');
  assert.equal(unlinkedSummary([list[1]]), '1 coleção · 1 cartão');
  assert.equal(unlinkedSummary([]), '0 coleções · 0 cartões');
});

const topics: TopicOption[] = [
  { id: 't1', title: 'Ortografia oficial', discipline: 'Língua Portuguesa' },
  { id: 't2', title: 'Compreensão de textos', discipline: 'Língua Portuguesa' },
  { id: 't3', title: 'Active Directory', discipline: 'Conhecimentos Específicos' },
  { id: 't4', title: 'Ambiente UNIX e LINUX: Instalação e suporte a DHCP', discipline: 'Conhecimentos Específicos' },
];

test('filterTopics: todas as palavras, sem acento nem caixa, no título ou na disciplina; vazio traz tudo', () => {
  assert.deepEqual(filterTopics(topics, 'ortografia').map((t) => t.id), ['t1']);
  assert.deepEqual(filterTopics(topics, 'ORTOGRAFIA OFICIAL').map((t) => t.id), ['t1']);
  assert.deepEqual(filterTopics(topics, 'compreensao').map((t) => t.id), ['t2'], 'sem acento');
  assert.deepEqual(filterTopics(topics, 'linux dhcp').map((t) => t.id), ['t4'], 'palavras em qualquer ordem, todas');
  assert.deepEqual(filterTopics(topics, 'portuguesa').map((t) => t.id), ['t1', 't2'], 'a disciplina também vale');
  assert.deepEqual(filterTopics(topics, '   ').map((t) => t.id), ['t1', 't2', 't3', 't4']);
  assert.deepEqual(filterTopics(topics, 'inexistente'), []);
  assert.deepEqual(filterTopics([], 'x'), []);
});

test('groupTopics agrupa por disciplina, na ordem em que aparecem', () => {
  const groups = groupTopics(topics);
  assert.deepEqual(groups.map((g) => [g.discipline, g.topics.map((t) => t.id)]), [
    ['Língua Portuguesa', ['t1', 't2']],
    ['Conhecimentos Específicos', ['t3', 't4']],
  ]);
  assert.deepEqual(groupTopics([]), []);
  // uma disciplina que volta depois vira outro grupo (a ordem do edital não é reordenada)
  assert.equal(groupTopics([topics[0], topics[2], topics[1]]).length, 3);
});
