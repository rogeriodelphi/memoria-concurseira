import assert from 'node:assert/strict';
import test from 'node:test';

import { CHOICES_SYSTEM_PROMPT, choicesUserPrompt, parseChoicesResponse, WRONG_PER_QUESTION, type ChoiceSource } from './choices';

const SOURCES: ChoiceSource[] = [
  { n: 1, question: 'Qual protocolo resolve nomes?', answer: 'O DNS.' },
  { n: 2, question: 'Qual a porta do SSH?', answer: 'A porta TCP 22.' },
];

const reply = (questions: unknown) => JSON.stringify({ questions });
const q = (n: number, correct: string, wrong: unknown[]) => ({ n, correct, wrong });
const WRONG = ['O DHCP', 'O ARP', 'O ICMP', 'O SNMP'];

test('prompt: cada cartão vai numerado, com pergunta e resposta', () => {
  const prompt = choicesUserPrompt(SOURCES);
  assert.match(prompt, /\[n=1\]\nPergunta: Qual protocolo resolve nomes\?\nResposta: O DNS\./);
  assert.match(prompt, /\[n=2\]\nPergunta: Qual a porta do SSH\?\nResposta: A porta TCP 22\./);
});

test('prompt: um cartão enorme é cortado, sem derrubar o pedido', () => {
  const prompt = choicesUserPrompt([{ n: 1, question: 'p', answer: 'x'.repeat(5000) }]);
  assert.ok(prompt.length < 2000);
  assert.match(prompt, /…/);
});

test('validação: uma questão boa vira correta mais quatro erradas', () => {
  const [one] = parseChoicesResponse(reply([q(1, 'O DNS', WRONG)]), SOURCES);
  assert.deepEqual(one, { n: 1, correct: 'O DNS', wrong: WRONG });
});

test('validação: devolve só as questões que servem; as outras ficam de fora', () => {
  const choices = parseChoicesResponse(
    reply([
      q(1, 'O DNS', WRONG),
      q(2, 'A porta 22', ['A porta 23', 'A porta 21']), // só duas erradas: não serve
      q(9, 'Cartão que ninguém pediu', WRONG), // número desconhecido
    ]),
    SOURCES,
  );
  assert.deepEqual(choices.map((c) => c.n), [1]);
});

test('validação: número repetido vale o primeiro', () => {
  const choices = parseChoicesResponse(reply([q(1, 'O DNS', WRONG), q(1, 'Outra', ['a1', 'b2', 'c3', 'd4'])]), SOURCES);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].correct, 'O DNS');
});

test('validação: erradas repetidas, ou iguais à correta (mesmo com outra caixa/acento/ponto), caem fora', () => {
  const [one] = parseChoicesResponse(
    reply([q(2, 'A porta TCP 22', ['A PORTA TCP 22.', 'A porta TCP 23', 'a porta tcp 23', 'A porta TCP 21', 'A porta TCP 25', 'A porta TCP 80'])]),
    SOURCES,
  );
  assert.deepEqual(one.wrong, ['A porta TCP 23', 'A porta TCP 21', 'A porta TCP 25', 'A porta TCP 80']);
});

test('validação: mais de quatro erradas vira quatro', () => {
  const [one] = parseChoicesResponse(reply([q(1, 'O DNS', [...WRONG, 'O FTP', 'O HTTP'])]), SOURCES);
  assert.equal(one.wrong.length, 4);
});

test('validação: com três erradas distintas ainda serve', () => {
  const [one] = parseChoicesResponse(reply([q(1, 'O DNS', WRONG.slice(0, 3))]), SOURCES);
  assert.equal(one.wrong.length, 3);
});

test('validação: "todas as anteriores" e parentes são descartadas, e as letras que a IA põe, tiradas', () => {
  const [one] = parseChoicesResponse(
    reply([q(1, 'a) O DNS', ['B) O DHCP', 'Todas as anteriores', 'nenhuma das alternativas', '3. O ARP', 'O ICMP', 'Ambas as opções'])]),
    SOURCES,
  );
  assert.equal(one.correct, 'O DNS');
  assert.deepEqual(one.wrong, ['O DHCP', 'O ARP', 'O ICMP']);
});

test('validação: alternativa vazia, grande demais ou que não é texto é descartada', () => {
  const [one] = parseChoicesResponse(
    reply([q(1, 'O DNS', ['', '   ', 'x'.repeat(601), 42, null, 'O DHCP', 'O ARP', 'O ICMP'])]),
    SOURCES,
  );
  assert.deepEqual(one.wrong, ['O DHCP', 'O ARP', 'O ICMP']);
});

test('validação: sem correta, ou sem lista de erradas, a questão não serve', () => {
  assert.throws(() => parseChoicesResponse(reply([q(1, '', WRONG)]), SOURCES), /formato esperado/);
  assert.throws(() => parseChoicesResponse(reply([{ n: 1, correct: 'O DNS' }]), SOURCES), /formato esperado/);
});

test('validação: resposta que não é o JSON esperado, ou sem nenhuma questão útil, é erro (a cadeia tenta o próximo provedor)', () => {
  for (const raw of [undefined, '', 'não é json', '{"questions": "x"}', '{}', reply([])]) {
    assert.throws(() => parseChoicesResponse(raw, SOURCES), /formato esperado/, String(raw));
  }
});

test('instruções à IA: erradas difíceis, no estilo das bancas, sem pistas de tamanho nem de termo absoluto', () => {
  const prompt = CHOICES_SYSTEM_PROMPT;
  assert.match(prompt, new RegExp(`exatamente ${WRONG_PER_QUESTION} alternativas incorretas`));
  assert.match(prompt, /CEBRASPE/);
  assert.match(prompt, /quase certas/, 'erradas que trocam um só elemento da correta');
  assert.match(prompt, /outros cartões deste pedido/, 'conceitos vizinhos vêm dos outros cartões do lote');
  assert.match(prompt, /não pode ser a mais longa/);
  assert.match(prompt, /Termos absolutos/);
  assert.match(prompt, /todas as anteriores/, 'a proibição das "anteriores" continua');
  assert.doesNotMatch(prompt, /${|undefined/, 'nada de interpolação esquecida');
});
