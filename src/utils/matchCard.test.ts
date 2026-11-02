import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blankRows,
  emptyPlacement,
  gradePlacement,
  matchPairsOf,
  MAX_PAIRS,
  parseMatchPairs,
  placeDescription,
  removeFromTerm,
  rowsFromAnswer,
  rowsToAnswer,
  serializeMatchPairs,
  spokenMatchAnswer,
  suggestedRating,
  termOfDescription,
  trayOrder,
  type MatchPair,
} from './matchCard';

const PAIRS: MatchPair[] = [
  { term: 'OSPF', description: 'A atualização é feita a cada 30 min' },
  { term: 'BGP', description: 'Roteamento interdomínios' },
  { term: 'EIGRP', description: 'Vetor distância, permite balanceamento de carga' },
];
const ANSWER = serializeMatchPairs(PAIRS);

// Um gerador "aleatório" previsível (LCG), para os embaralhamentos serem repetíveis.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('ler: os pares da resposta, na ordem; serializar e ler de volta dá o mesmo', () => {
  assert.deepEqual(parseMatchPairs(ANSWER), PAIRS);
  assert.deepEqual(parseMatchPairs(serializeMatchPairs(PAIRS)), PAIRS);
  assert.deepEqual(parseMatchPairs('  A :: um \r\n\r\nB::dois a::b '), [
    { term: 'A', description: 'um' },
    { term: 'B', description: 'dois a::b' },
  ]);
});

test('ler: pares inválidos dão null (o cartão é estudado como comum)', () => {
  assert.equal(parseMatchPairs(''), null);
  assert.equal(parseMatchPairs('A::um'), null, 'um par só');
  assert.equal(parseMatchPairs('A::um\nsem separador'), null);
  assert.equal(parseMatchPairs('A::um\nB::'), null);
  assert.equal(parseMatchPairs('A::um\n::dois'), null);
  assert.equal(parseMatchPairs('A::um\na::dois'), null, 'termo repetido');
  assert.equal(parseMatchPairs(`A::um\nB::${'x'.repeat(301)}`), null);
  assert.equal(parseMatchPairs(Array.from({ length: MAX_PAIRS + 1 }, (_, i) => `T${i}::D${i}`).join('\n')), null);
  assert.notEqual(parseMatchPairs(Array.from({ length: MAX_PAIRS }, (_, i) => `T${i}::D${i}`).join('\n')), null);
});

test('cartão: só é de arrastar e soltar com kind "match" e pares válidos', () => {
  assert.deepEqual(matchPairsOf({ kind: 'match', answer: ANSWER }), PAIRS);
  assert.equal(matchPairsOf({ kind: 'basic', answer: ANSWER }), null);
  assert.equal(matchPairsOf({ answer: ANSWER }), null, 'sem kind vale como comum');
  assert.equal(matchPairsOf({ kind: 'match', answer: 'Resposta comum' }), null, 'match com pares inválidos cai para o comum');
});

test('bandeja: é uma permutação das descrições e nunca a ordem dos termos', () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const count of [2, 3, 5, 12]) {
      const order = trayOrder(count, seeded(seed));
      assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i), `permutação (seed ${seed}, n ${count})`);
      assert.ok(!order.every((value, i) => value === i), `fora da ordem dos termos (seed ${seed}, n ${count})`);
    }
  }
  assert.deepEqual(trayOrder(1), [0], 'com um só par não há o que trocar');
  assert.deepEqual(trayOrder(0), []);
});

test('bandeja: sem sorteio fixo, os embaralhamentos variam', () => {
  const orders = new Set(Array.from({ length: 40 }, (_, seed) => trayOrder(5, seeded(seed + 1)).join(',')));
  assert.ok(orders.size > 5);
});

test('posicionar: a descrição vai para o termo e sai de onde estava', () => {
  let p = emptyPlacement(3);
  p = placeDescription(p, 0, 2);
  assert.deepEqual(p, [2, null, null]);
  p = placeDescription(p, 1, 2);
  assert.deepEqual(p, [null, 2, null], 'mover tira do termo anterior');
  assert.equal(termOfDescription(p, 2), 1);
  assert.equal(termOfDescription(p, 0), -1, 'na bandeja');
});

test('posicionar: num termo já ocupado, a descrição que estava lá volta para a bandeja', () => {
  let p = placeDescription(placeDescription(emptyPlacement(3), 0, 0), 1, 1);
  p = placeDescription(p, 0, 2);
  assert.deepEqual(p, [2, 1, null]);
  assert.equal(termOfDescription(p, 0), -1, 'a 0 voltou para a bandeja');
});

test('posicionar: colocar a descrição de um termo em outro troca de lugar sem perder nenhuma', () => {
  let p = placeDescription(placeDescription(emptyPlacement(2), 0, 0), 1, 1);
  p = placeDescription(p, 1, 0); // a descrição 0, que estava no termo 0, vai para o termo 1 (onde estava a 1)
  assert.deepEqual(p, [null, 0]);
  assert.equal(termOfDescription(p, 1), -1, 'a 1 voltou para a bandeja');
});

test('posicionar: não muda o estado anterior (devolve outro)', () => {
  const before = emptyPlacement(3);
  const after = placeDescription(before, 1, 1);
  assert.deepEqual(before, [null, null, null]);
  assert.deepEqual(removeFromTerm(after, 1), [null, null, null]);
  assert.deepEqual(after, [null, 1, null]);
});

test('corrigir: certo é a descrição do próprio par; vazio e trocado contam como erro', () => {
  assert.deepEqual(gradePlacement(PAIRS, [0, 1, 2]), { correct: [true, true, true], wrong: 0 });
  assert.deepEqual(gradePlacement(PAIRS, [1, 0, 2]), { correct: [false, false, true], wrong: 2 });
  assert.deepEqual(gradePlacement(PAIRS, [0, null, null]), { correct: [true, false, false], wrong: 2 });
  assert.deepEqual(gradePlacement(PAIRS, emptyPlacement(3)), { correct: [false, false, false], wrong: 3 });
});

test('corrigir: duas descrições idênticas em pares diferentes são intercambiáveis', () => {
  const same: MatchPair[] = [
    { term: 'TCP', description: 'Camada de transporte' },
    { term: 'UDP', description: 'Camada de transporte' },
    { term: 'IP', description: 'Camada de rede' },
  ];
  assert.equal(gradePlacement(same, [1, 0, 2]).wrong, 0);
  // TCP recebe "rede" (errado), UDP recebe a descrição 0, que também é "transporte" (certo), IP recebe "transporte" (errado)
  assert.deepEqual(gradePlacement(same, [2, 0, 1]), { correct: [false, true, false], wrong: 2 });
});

test('nota sugerida: tudo certo é Bom, um erro é Difícil, dois ou mais é Errei', () => {
  assert.equal(suggestedRating(0), 'bom');
  assert.equal(suggestedRating(1), 'dificil');
  assert.equal(suggestedRating(2), 'errei');
  assert.equal(suggestedRating(7), 'errei');
});

test('formulário: linhas a partir da resposta e de volta; resposta inválida abre com duas linhas em branco', () => {
  assert.deepEqual(rowsFromAnswer(ANSWER), PAIRS);
  assert.deepEqual(rowsFromAnswer('Resposta comum'), blankRows());
  assert.equal(blankRows().length, 2);
  assert.equal(rowsToAnswer(PAIRS), ANSWER);
  assert.deepEqual(parseMatchPairs(rowsToAnswer(rowsFromAnswer(ANSWER))), PAIRS);
});

test('formulário: linhas em branco somem, linha pela metade segue (o servidor recusa), "::" no termo vira ":"', () => {
  const rows: MatchPair[] = [
    { term: '  A  ', description: ' um ' },
    { term: '', description: '' },
    { term: 'B', description: '' },
    { term: 'C::D', description: 'três' },
  ];
  assert.equal(rowsToAnswer(rows), 'A::um\nB::\nC:D::três');
  assert.equal(parseMatchPairs(rowsToAnswer(rows)), null, 'a linha pela metade impede o cartão');
  assert.deepEqual(parseMatchPairs(rowsToAnswer([rows[0], rows[3]])), [
    { term: 'A', description: 'um' },
    { term: 'C:D', description: 'três' },
  ]);
  assert.equal(rowsToAnswer([{ term: ' ', description: ' ' }]), '');
});

test('voz: "termo: descrição" por par, sem os dois-pontos duplos', () => {
  assert.equal(
    spokenMatchAnswer(PAIRS),
    'OSPF: A atualização é feita a cada 30 min. BGP: Roteamento interdomínios. EIGRP: Vetor distância, permite balanceamento de carga',
  );
});
