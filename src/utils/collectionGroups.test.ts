import assert from 'node:assert/strict';
import test from 'node:test';

import {
  disciplineKey,
  groupByDiscipline,
  groupTotals,
  loadExpandedGroups,
  saveExpandedGroups,
} from './collectionGroups';

interface C {
  id: number;
  name: string;
  flashcardCount?: number;
  dueCount?: number;
  updatedAt?: string;
}
const c = (id: number, name: string, extra: Partial<C> = {}): C => ({ id, name, ...extra });

test('a chave da disciplina ignora maiúsculas, acentos e espaços repetidos', () => {
  assert.equal(disciplineKey('Língua Portuguesa'), 'lingua portuguesa');
  assert.equal(disciplineKey('  LINGUA   portuguesa '), 'lingua portuguesa');
  assert.notEqual(disciplineKey('Língua Portuguesa'), disciplineKey('Língua Inglesa'));
});

test('nome que aparece uma vez só continua sendo uma coleção sozinha', () => {
  const entries = groupByDiscipline([c(1, 'Redes de Computadores'), c(2, 'Direito')]);
  assert.deepEqual(entries.map((e) => e.kind), ['single', 'single']);
});

test('duas ou mais coleções com o mesmo nome viram uma disciplina, na ordem de entrada', () => {
  const entries = groupByDiscipline([
    c(1, 'Língua Portuguesa'),
    c(2, 'Língua Portuguesa'),
    c(3, 'Língua Portuguesa'),
  ]);
  assert.equal(entries.length, 1);
  const group = entries[0];
  assert.ok(group.kind === 'group');
  assert.equal(group.name, 'Língua Portuguesa');
  assert.equal(group.key, 'lingua portuguesa');
  assert.deepEqual(group.items.map((i) => i.id), [1, 2, 3]);
});

test('nomes que só diferem em maiúsculas, acento ou espaços são a mesma disciplina', () => {
  const entries = groupByDiscipline([c(1, 'Segurança da Informação'), c(2, 'seguranca da  informacao'), c(3, 'SEGURANÇA DA INFORMAÇÃO ')]);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].kind === 'group' && entries[0].items.length === 3);
  assert.equal(entries[0].kind === 'group' && entries[0].name, 'Segurança da Informação', 'o nome mostrado é o da primeira coleção');
});

test('cada disciplina ocupa o lugar da sua primeira coleção, e a ordem da lista é respeitada', () => {
  const entries = groupByDiscipline([
    c(1, 'Direito'),
    c(2, 'Língua Portuguesa'),
    c(3, 'Redes'),
    c(4, 'Língua Portuguesa'),
    c(5, 'Direito'),
    c(6, 'Matemática'),
  ]);
  assert.deepEqual(
    entries.map((e) => (e.kind === 'single' ? `1:${e.item.id}` : `${e.items.map((i) => i.id).join('+')}`)),
    ['1+5', '2+4', '1:3', '1:6'],
  );
});

test('lista vazia não gera linhas', () => {
  assert.deepEqual(groupByDiscipline([]), []);
});

test('totais do grupo: flashcards, pendentes e a atualização mais recente', () => {
  const totals = groupTotals([
    { flashcardCount: 10, dueCount: 5, updatedAt: '2026-10-15T10:00:00.000Z' },
    { flashcardCount: 42, dueCount: 37, updatedAt: '2026-10-16T09:00:00.000Z' },
    { flashcardCount: 58, dueCount: 0, updatedAt: '2026-10-01T09:00:00.000Z' },
  ]);
  assert.deepEqual(totals, { flashcards: 110, due: 42, updatedAt: '2026-10-16T09:00:00.000Z' });
});

test('totais de um grupo vazio são zero', () => {
  assert.deepEqual(groupTotals([]), { flashcards: 0, due: 0, updatedAt: '' });
});

// ---------- disciplinas abertas ----------

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
};

test('disciplinas abertas: o que foi salvo volta igual, e sem nada salvo não há nenhuma aberta', () => {
  const storage = fakeStorage();
  assert.deepEqual([...loadExpandedGroups(storage)], []);
  saveExpandedGroups(new Set(['lingua portuguesa', 'redes de computadores']), storage);
  assert.deepEqual([...loadExpandedGroups(storage)], ['lingua portuguesa', 'redes de computadores']);
});

test('disciplinas abertas: dado corrompido ou de outro tipo vira "nenhuma", sem quebrar', () => {
  assert.deepEqual([...loadExpandedGroups(fakeStorage({ 'bc-expanded-disciplines': '{não é json' }))], []);
  assert.deepEqual([...loadExpandedGroups(fakeStorage({ 'bc-expanded-disciplines': '{"a":1}' }))], []);
  assert.deepEqual([...loadExpandedGroups(fakeStorage({ 'bc-expanded-disciplines': '["ok", 3, null, "tambem"]' }))], ['ok', 'tambem']);
});

test('disciplinas abertas: sem armazenamento (ou com ele bloqueado) nada quebra', () => {
  assert.deepEqual([...loadExpandedGroups(undefined)], []);
  assert.doesNotThrow(() => saveExpandedGroups(new Set(['x']), undefined));
  const blocked = {
    getItem: () => {
      throw new Error('bloqueado');
    },
    setItem: () => {
      throw new Error('bloqueado');
    },
  };
  assert.deepEqual([...loadExpandedGroups(blocked)], []);
  assert.doesNotThrow(() => saveExpandedGroups(new Set(['x']), blocked));
});

test('o nome da disciplina é o que a maioria das coleções usa; no empate, o da primeira', () => {
  const majority = groupByDiscipline([c(1, 'seguranca da informacao'), c(2, 'Segurança da Informação'), c(3, 'Segurança da  Informação ')]);
  assert.ok(majority[0].kind === 'group');
  assert.equal(majority[0].kind === 'group' && majority[0].name, 'Segurança da Informação');

  const tie = groupByDiscipline([c(1, 'Redes de Computadores'), c(2, 'redes de computadores')]);
  assert.equal(tie[0].kind === 'group' && tie[0].name, 'Redes de Computadores');
});
