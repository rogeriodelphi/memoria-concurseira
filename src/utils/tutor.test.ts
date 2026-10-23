import assert from 'node:assert/strict';
import test from 'node:test';

import type { TutorReply } from '../types';
import { cleanAsk, historyFor, MAX_ASK_CHARS, MAX_HISTORY_TURNS, QUICK_ASKS, replyNotes, type TutorTurn } from './tutor';

const reply = (over: Partial<TutorReply> = {}): TutorReply => ({ answer: 'Explicação.', example: '', tip: '', caution: '', ...over });
const turn = (id: number, ask: string, over: Partial<TutorTurn> = {}): TutorTurn => ({ id, ask, reply: reply({ answer: `R${id}` }), ...over });

test('os atalhos de pergunta têm rótulo curto e um pedido completo, e cabem no limite', () => {
  assert.ok(QUICK_ASKS.length >= 3);
  for (const { label, ask } of QUICK_ASKS) {
    assert.ok(label.length > 0 && label.length <= 24, label);
    assert.ok(ask.length > label.length && ask.length <= MAX_ASK_CHARS, ask);
  }
  assert.equal(new Set(QUICK_ASKS.map((q) => q.label)).size, QUICK_ASKS.length, 'sem rótulo repetido');
});

test('historyFor: só as trocas respondidas, as últimas, com o texto principal da resposta', () => {
  const turns = [turn(1, 'a'), turn(2, 'b', { reply: undefined, error: 'Cota esgotada.' }), turn(3, 'c'), turn(4, 'd'), turn(5, 'e'), turn(6, 'f', { reply: undefined })];
  assert.deepEqual(historyFor(turns), [
    { ask: 'c', answer: 'R3' },
    { ask: 'd', answer: 'R4' },
    { ask: 'e', answer: 'R5' },
  ]);
  assert.equal(historyFor(turns).length, MAX_HISTORY_TURNS);
  assert.deepEqual(historyFor([]), []);
  assert.deepEqual(historyFor([turn(1, 'só uma')]), [{ ask: 'só uma', answer: 'R1' }]);
});

test('cleanAsk: numa linha, aparada e no limite; vazio vira null', () => {
  assert.equal(cleanAsk('  Por que\n  é assim?  '), 'Por que é assim?');
  assert.equal(cleanAsk('   '), null);
  assert.equal(cleanAsk(''), null);
  assert.equal(cleanAsk('a'.repeat(MAX_ASK_CHARS + 50))!.length, MAX_ASK_CHARS);
});

test('replyNotes: só o que a IA trouxe, na ordem exemplo, macete e atenção', () => {
  assert.deepEqual(replyNotes(reply()), []);
  assert.deepEqual(replyNotes(reply({ caution: 'Cuidado.', example: 'Ex.' })), [
    { label: 'Exemplo', text: 'Ex.' },
    { label: 'Atenção', text: 'Cuidado.' },
  ]);
  assert.deepEqual(replyNotes(reply({ example: 'Ex.', tip: 'Dica.', caution: 'Cuidado.' })).map((n) => n.label), ['Exemplo', 'Macete', 'Atenção']);
});
