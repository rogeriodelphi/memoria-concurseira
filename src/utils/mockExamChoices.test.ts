import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amountOptions,
  batchesNeeded,
  buildQuestion,
  chunk,
  defaultAmount,
  optionLetter,
  pickSample,
  PREPARE_BATCH_SIZE,
  shuffled,
} from './mockExamChoices';

/** Um gerador pseudo-aleatório determinístico (mulberry32), para os testes não dependerem de sorte. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHOICE = { correct: 'O DNS', wrong: ['O DHCP', 'O ARP', 'O ICMP', 'O SNMP'] };

test('questão: guarda as cinco alternativas e aponta onde está a correta', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const q = buildQuestion(CHOICE, seeded(seed));
    assert.equal(q.options.length, 5);
    assert.deepEqual([...q.options].sort(), ['O ARP', 'O DHCP', 'O DNS', 'O ICMP', 'O SNMP']);
    assert.equal(q.options[q.correctIndex], 'O DNS');
  }
});

test('questão: a correta cai em todos os lugares, com frequência parecida (decorar a letra não ajuda)', () => {
  const random = seeded(2026);
  const counts = [0, 0, 0, 0, 0];
  const trials = 5000;
  for (let i = 0; i < trials; i++) counts[buildQuestion(CHOICE, random).correctIndex]++;
  for (const n of counts) assert.ok(n > trials / 5 * 0.85 && n < trials / 5 * 1.15, `distribuição torta: ${counts}`);
});

test('questão: com três erradas ficam quatro alternativas', () => {
  const q = buildQuestion({ correct: 'Certa', wrong: ['E1', 'E2', 'E3'] }, seeded(7));
  assert.equal(q.options.length, 4);
  assert.equal(q.options[q.correctIndex], 'Certa');
});

test('questão: não altera a lista de erradas recebida', () => {
  const wrong = ['E1', 'E2', 'E3', 'E4'];
  buildQuestion({ correct: 'Certa', wrong }, seeded(3));
  assert.deepEqual(wrong, ['E1', 'E2', 'E3', 'E4']);
});

test('embaralhar: não perde nem duplica itens e não mexe no original', () => {
  const items = [1, 2, 3, 4, 5, 6];
  const out = shuffled(items, seeded(9));
  assert.deepEqual([...out].sort(), items);
  assert.deepEqual(items, [1, 2, 3, 4, 5, 6]);
});

test('letras: A a E; depois disso, o número', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(optionLetter), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(optionLetter(5), '6');
});

test('lotes: divide mantendo a ordem, com o último menor', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 8), []);
  assert.deepEqual(chunk([1, 2], 8), [[1, 2]]);
});

test('lotes necessários: arredonda para cima', () => {
  assert.equal(batchesNeeded(0), 0);
  assert.equal(batchesNeeded(1), 1);
  assert.equal(batchesNeeded(PREPARE_BATCH_SIZE), 1);
  assert.equal(batchesNeeded(PREPARE_BATCH_SIZE + 1), 2);
  assert.equal(batchesNeeded(-3), 0);
});

test('amostra: pega a quantidade pedida, sem passar do que existe', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(pickSample(items, 3, false), ['a', 'b', 'c'], 'sem sortear: os primeiros');
  assert.equal(pickSample(items, 3, true, seeded(1)).length, 3);
  assert.deepEqual([...pickSample(items, 99, true, seeded(1))].sort(), items, 'pediu demais: pega todos');
  assert.deepEqual(pickSample(items, 0, true), []);
  assert.deepEqual(pickSample(items, -2, false), []);
});

test('amostra sorteada: sem repetir cartão, e nem sempre os mesmos', () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  const seen = new Set<number>();
  for (let seed = 1; seed <= 20; seed++) {
    const sample = pickSample(items, 10, true, seeded(seed));
    assert.equal(new Set(sample).size, 10);
    sample.forEach((n) => seen.add(n));
  }
  assert.ok(seen.size > 20, 'o sorteio alcança cartões variados');
});

test('quantidades oferecidas: os degraus que cabem e, no fim, todos', () => {
  assert.deepEqual(amountOptions(0), []);
  assert.deepEqual(amountOptions(1), [1]);
  assert.deepEqual(amountOptions(8), [8]);
  assert.deepEqual(amountOptions(10), [10]);
  assert.deepEqual(amountOptions(25), [10, 20, 25]);
  assert.deepEqual(amountOptions(30), [10, 20, 30]);
  assert.deepEqual(amountOptions(120), [10, 20, 30, 50, 120]);
});

test('quantidade inicial: dez, ou todos se são menos', () => {
  assert.equal(defaultAmount(120), 10);
  assert.equal(defaultAmount(4), 4);
  assert.equal(defaultAmount(0), 0);
});
