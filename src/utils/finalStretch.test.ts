import assert from 'node:assert/strict';
import test from 'node:test';

import type { FinalStretch } from '../types';
import { disciplineFacts, gainText, masteryTone, phaseInfo, queueHeadline, queueNotes, remainingText } from './finalStretch';

const queue = (over: Partial<FinalStretch['queue']> = {}): FinalStretch['queue'] => ({
  total: 15,
  due: 9,
  new: 6,
  limit: null,
  maxCards: 100,
  defaultNew: 15,
  waitingDue: 0,
  waitingNew: 0,
  outsideDue: 0,
  outsideNew: 0,
  ...over,
});

test('remainingText: singular e plural', () => {
  assert.equal(remainingText(1), 'Falta 1 dia');
  assert.equal(remainingText(50), 'Faltam 50 dias');
  assert.equal(remainingText(0), 'Faltam 0 dias');
});

test('phaseInfo: cada fase pede uma coisa e tem uma cor', () => {
  const content = phaseInfo('content', 50);
  assert.equal(content.tone, 'green');
  assert.match(content.message, /Faltam 50 dias/);
  assert.match(content.message, /só revisão/);

  const review = phaseInfo('review', 5);
  assert.equal(review.tone, 'amber');
  assert.equal(review.title, 'Só revisão');
  assert.match(review.message, /cartão novo já não dá tempo/);

  const last = phaseInfo('last', 2);
  assert.equal(last.tone, 'red');
  assert.match(last.message, /Faltam 2 dias/);
  assert.match(last.message, /sem cartões novos/);

  assert.equal(phaseInfo('last', 1).message.startsWith('Falta 1 dia'), true);
  const today = phaseInfo('last', 0);
  assert.equal(today.title, 'Dia da prova');
  assert.match(today.message, /A prova é hoje/);
});

test('disciplineFacts: o peso, o visto e o acerto; sem revisões ou sem cartões, diz isso', () => {
  assert.deepEqual(disciplineFacts({ hasCards: true, sharePct: 24, seenPct: 40, accuracyPct: 55, reviews30: 20 }), [
    'Pesa 24% da prova',
    'viu 40% dos cartões',
    'acerta 55% (20 revisões em 30 dias)',
  ]);
  assert.deepEqual(disciplineFacts({ hasCards: true, sharePct: 10, seenPct: 0, accuracyPct: 100, reviews30: 1 }).at(-1), 'acerta 100% (1 revisão em 30 dias)');
  assert.deepEqual(disciplineFacts({ hasCards: true, sharePct: 10, seenPct: 50, accuracyPct: null, reviews30: 0 }), [
    'Pesa 10% da prova',
    'viu 50% dos cartões',
    'sem revisões nos últimos 30 dias',
  ]);
  assert.deepEqual(disciplineFacts({ hasCards: false, sharePct: 14, seenPct: null, accuracyPct: null, reviews30: 0 }), ['Pesa 14% da prova', 'nenhum cartão ligado a ela']);
});

test('masteryTone: abaixo de 40 é ruim, até 69 médio, 70 ou mais bom; sem cartões, nenhum', () => {
  assert.equal(masteryTone(null), 'none');
  assert.equal(masteryTone(0), 'bad');
  assert.equal(masteryTone(39), 'bad');
  assert.equal(masteryTone(40), 'ok');
  assert.equal(masteryTone(69), 'ok');
  assert.equal(masteryTone(70), 'good');
  assert.equal(masteryTone(100), 'good');
});

test('gainText: inteiro a partir de 10 e uma casa antes disso', () => {
  assert.equal(gainText(24), '24%');
  assert.equal(gainText(21.4), '21%');
  assert.equal(gainText(9.5), '9,5%');
  assert.equal(gainText(0.7), '0,7%');
  assert.equal(gainText(0), '0%');
});

test('queueHeadline resume a sessão', () => {
  assert.equal(queueHeadline(queue()), '9 vencidos e 6 novos');
  assert.equal(queueHeadline(queue({ due: 1, new: 0, total: 1 })), '1 vencido');
  assert.equal(queueHeadline(queue({ due: 0, new: 1, total: 1 })), '1 novo');
  assert.equal(queueHeadline(queue({ due: 0, new: 0, total: 0 })), 'Nada para o foco agora');
});

test('queueNotes: sem nada de fora, nenhum aviso', () => {
  assert.deepEqual(queueNotes(queue(), 'content'), []);
});

test('queueNotes: vencidos que não couberam e vencidos fora do edital', () => {
  const notes = queueNotes(queue({ waitingDue: 140, outsideDue: 3 }), 'content');
  assert.equal(notes.length, 2);
  assert.match(notes[0], /140 vencidos ficaram para a próxima sessão \(cada uma traz no máximo 100 cartões\)/);
  assert.match(notes[1], /3 vencidos estão em coleções fora do edital/);
  assert.match(queueNotes(queue({ outsideDue: 1 }), 'content')[0], /1 vencido está em coleções fora do edital/);
});

test('queueNotes: o motivo dos novos que ficaram de fora depende da fase e do limite', () => {
  assert.match(queueNotes(queue({ waitingNew: 25 }), 'content')[0], /sem limite diário, a sessão traz até 15 cartões novos/);
  assert.match(queueNotes(queue({ waitingNew: 4, limit: 10 }), 'content')[0], /4 novos ficaram de fora: o seu limite diário é 10 .* até um terço dos cartões para novos/);
  assert.match(queueNotes(queue({ waitingNew: 6, new: 0 }), 'review')[0], /6 cartões novos não entram: faltando 7 dias ou menos/);
  assert.match(queueNotes(queue({ waitingNew: 1, new: 0 }), 'last')[0], /1 cartão novo não entra/);
});
