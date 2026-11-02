import assert from 'node:assert/strict';
import test from 'node:test';

import { ankiFieldToLines, matchFromAnki, MAX_PAIRS, prepareMatchCard, serializePairs, validatePairs } from './matchCard';

const OSPF = 'OSPF::A atualização é feita a cada 30 min ou quando ocorrer alterações na rota.';
const BGP = 'BGP::É um protocolo que é responsável pelo roteamento interdomínios e criado para uso nos principais roteadores da Internet.';
const EIGRP = 'EIGRP::Utiliza algoritmo de vetor distância; indentifica a máscara de rede / ClassLess; Permite balancemento de carga.';

test('pares: um por linha, termo e descrição separados pelo primeiro "::"', () => {
  const result = validatePairs([OSPF, BGP, EIGRP].join('\n'));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.map((p) => p.term), ['OSPF', 'BGP', 'EIGRP']);
    assert.equal(result.value[1].description, 'É um protocolo que é responsável pelo roteamento interdomínios e criado para uso nos principais roteadores da Internet.');
  }
});

test('pares: a descrição pode ter "::" dentro; espaços e linhas em branco não contam', () => {
  const result = validatePairs('  IPv6 :: 128 bits, escrito como a::b  \r\n\r\nIPv4::32 bits\n');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, [
      { term: 'IPv6', description: '128 bits, escrito como a::b' },
      { term: 'IPv4', description: '32 bits' },
    ]);
  }
});

test('pares: recusa pouco, muito, linha sem separador, parte vazia, termo repetido e texto longo', () => {
  const erro = (text: unknown) => {
    const r = validatePairs(text);
    return r.ok ? null : r.error;
  };
  assert.equal(erro(''), 'Informe ao menos 2 pares (termo e descrição).');
  assert.equal(erro(undefined), 'Informe ao menos 2 pares (termo e descrição).');
  assert.equal(erro(OSPF), 'Informe ao menos 2 pares (termo e descrição).');
  assert.equal(erro(`${OSPF}\nsem separador`), 'Cada par precisa ter um termo e uma descrição.');
  assert.equal(erro(`${OSPF}\nBGP::`), 'Cada par precisa ter um termo e uma descrição.');
  assert.equal(erro(`${OSPF}\n::sem termo`), 'Cada par precisa ter um termo e uma descrição.');
  assert.equal(erro(`${OSPF}\nospf::outra descrição`), 'O termo "ospf" aparece mais de uma vez.');
  assert.equal(erro(`${OSPF}\nBGP::${'x'.repeat(301)}`), 'Cada termo e cada descrição pode ter até 300 caracteres.');
  const many = Array.from({ length: MAX_PAIRS + 1 }, (_, i) => `T${i}::D${i}`).join('\n');
  assert.equal(erro(many), `Use no máximo ${MAX_PAIRS} pares por cartão.`);
  const exactly = Array.from({ length: MAX_PAIRS }, (_, i) => `T${i}::D${i}`).join('\n');
  assert.equal(erro(exactly), null);
});

test('cartão: o título vira uma linha só e os pares ficam na forma canônica', () => {
  const result = prepareMatchCard('  Protocolos de roteamento\n dinâmico  ', `  OSPF ::  A   atualização  \n\nBGP::  interdomínios `);
  assert.deepEqual(result, {
    ok: true,
    value: { question: 'Protocolos de roteamento dinâmico', answer: 'OSPF::A atualização\nBGP::interdomínios' },
  });
});

test('cartão: título vazio ou longo demais é recusado, e os pares inválidos também', () => {
  const erro = (q: unknown, a: unknown) => {
    const r = prepareMatchCard(q, a);
    return r.ok ? null : r.error;
  };
  assert.equal(erro('', 'A::1\nB::2'), 'Informe o título do cartão.');
  assert.equal(erro('   ', 'A::1\nB::2'), 'Informe o título do cartão.');
  assert.equal(erro(7, 'A::1\nB::2'), 'Informe o título do cartão.');
  assert.equal(erro('x'.repeat(301), 'A::1\nB::2'), 'O título pode ter até 300 caracteres.');
  assert.equal(erro('Título', 'A::1'), 'Informe ao menos 2 pares (termo e descrição).');
  assert.equal(erro('Título', 'A::1\nB::2'), null);
});

test('cartão: guardar e ler de volta dá os mesmos pares', () => {
  const first = validatePairs([OSPF, BGP, EIGRP].join('\n'));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const again = validatePairs(serializePairs(first.value));
  assert.deepEqual(again, first);
});

test('Anki: o campo HTML vira linhas (<br>, </div>, </p>), sem tags nem entidades', () => {
  assert.deepEqual(ankiFieldToLines('A::um<br>B::dois<div>C::tr&ecirc;s &amp; mais</div><p>D::quatro</p>'), [
    'A::um',
    'B::dois',
    'C::tr&ecirc;s & mais',
    'D::quatro',
  ]);
  assert.deepEqual(ankiFieldToLines('<b>x</b>&nbsp;&nbsp;y<br /><br>[sound:a.mp3]z'), ['x y', 'z']);
});

test('Anki: a nota de arrastar e soltar (campos question e items) vira um cartão de pares', () => {
  const front = 'Protocolos de roteamento dinâmico: OSPF , BGP e EIGRP  [sound:googletts-b8fb19a0-ffc93ed7-84ff027f-e65cac31-b3faccec.mp3]';
  const back = [OSPF, BGP, EIGRP].join('<br>');
  const card = matchFromAnki(front, back);
  assert.deepEqual(card, {
    question: 'Protocolos de roteamento dinâmico: OSPF , BGP e EIGRP',
    answer: [OSPF, BGP, EIGRP].join('\n'),
  });
  // com <div> no lugar de <br>, como o editor do Anki grava às vezes
  assert.deepEqual(matchFromAnki(front, [OSPF, BGP, EIGRP].map((l) => `<div>${l}</div>`).join('')), card);
});

test('Anki: nota comum, ou com qualquer linha que não é par, continua um cartão comum (null)', () => {
  assert.equal(matchFromAnki('Qual a porta do HTTPS?', '443'), null);
  assert.equal(matchFromAnki('Pergunta', 'Linha um<br>Linha dois'), null);
  assert.equal(matchFromAnki('Pergunta', `${OSPF}<br>uma linha solta`), null, 'uma linha fora do formato basta para não converter');
  assert.equal(matchFromAnki('Pergunta', OSPF), null, 'um par só não é um cartão de arrastar');
  assert.equal(matchFromAnki('', [OSPF, BGP].join('<br>')), null, 'sem título');
  assert.equal(matchFromAnki('Pergunta', `${OSPF}<br>ospf::repetido`), null, 'termo repetido');
});
