import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lastEntry,
  newSession,
  patchCard,
  rateCurrent,
  skipCurrent,
  studiedCount,
  undoLast,
  type SessionState,
} from './studySession';

interface Card {
  id: string;
  favorite?: boolean;
  question?: string;
}

const cards = (...ids: string[]): Card[] => ids.map((id) => ({ id }));
const ids = (state: SessionState<Card>) => state.queue.map((c) => c.id);

test('avaliar: o cartão sai da frente, a contagem sobe e fica anotado para desfazer', () => {
  const s = rateCurrent(newSession(cards('a', 'b', 'c')), 'bom', 'sess-1');
  assert.deepEqual(ids(s), ['b', 'c']);
  assert.equal(s.counts.bom, 1);
  assert.equal(studiedCount(s), 1);
  assert.deepEqual(lastEntry(s), { kind: 'rate', card: { id: 'a' }, result: 'bom', requeued: false, sessionId: 'sess-1' });
});

test('errei: volta para o fim da fila só na primeira vez', () => {
  let s = rateCurrent(newSession(cards('a', 'b')), 'errei', 's1');
  assert.deepEqual(ids(s), ['b', 'a']);
  s = rateCurrent(s, 'bom', 's2'); // b
  assert.deepEqual(ids(s), ['a']);
  s = rateCurrent(s, 'errei', 's3'); // a de novo: errou outra vez, mas já foi recolocado uma vez
  assert.deepEqual(ids(s), []);
  assert.equal(s.counts.errei, 2);
});

test('pular: sai da fila sem ser avaliado nem contado como estudado', () => {
  const s = skipCurrent(newSession(cards('a', 'b')));
  assert.deepEqual(ids(s), ['b']);
  assert.equal(s.skipped, 1);
  assert.equal(studiedCount(s), 0);
  assert.deepEqual(lastEntry(s), { kind: 'skip', card: { id: 'a' } });
});

test('com a fila vazia, avaliar, pular e voltar não fazem nada', () => {
  const empty = newSession<Card>([]);
  assert.equal(rateCurrent(empty, 'bom', null), empty);
  assert.equal(skipCurrent(empty), empty);
  assert.equal(undoLast(empty), empty);
  assert.equal(lastEntry(empty), null);
});

test('voltar depois de pular: o cartão volta para a frente e a contagem de pulados desce', () => {
  const s = undoLast(skipCurrent(newSession(cards('a', 'b'))));
  assert.deepEqual(s, newSession(cards('a', 'b')));
});

test('voltar depois de avaliar: o cartão volta para a frente e a contagem desce', () => {
  const s = undoLast(rateCurrent(newSession(cards('a', 'b')), 'facil', 'x'));
  assert.deepEqual(s, newSession(cards('a', 'b')));
});

test('voltar depois de um "errei": o cartão sai do fim da fila e deixa de contar como já recolocado', () => {
  const s0 = newSession(cards('a', 'b', 'c'));
  const errei = rateCurrent(s0, 'errei', 'x');
  assert.deepEqual(ids(errei), ['b', 'c', 'a']);

  const back = undoLast(errei);
  assert.deepEqual(back, s0);
  // e errar de novo volta a recolocar, porque o primeiro "errei" foi desfeito
  assert.deepEqual(ids(rateCurrent(back, 'errei', 'y')), ['b', 'c', 'a']);
});

test('voltar um "errei" quando o cartão é o único: não duplica', () => {
  const s0 = newSession(cards('a'));
  const errei = rateCurrent(s0, 'errei', 'x');
  assert.deepEqual(ids(errei), ['a']);
  assert.deepEqual(undoLast(errei), s0);
});

test('voltar várias vezes desfaz uma ação de cada vez, até o começo', () => {
  const s0 = newSession(cards('a', 'b', 'c', 'd'));
  let s = rateCurrent(s0, 'bom', '1'); // a
  s = skipCurrent(s); // b
  s = rateCurrent(s, 'errei', '2'); // c, vai para o fim
  s = rateCurrent(s, 'dificil', '3'); // d
  assert.deepEqual(ids(s), ['c']);

  s = undoLast(s);
  assert.deepEqual(ids(s), ['d', 'c']);
  s = undoLast(s);
  assert.deepEqual(ids(s), ['c', 'd']);
  s = undoLast(s);
  assert.deepEqual(ids(s), ['b', 'c', 'd']);
  assert.equal(s.skipped, 0, 'o pulado voltou, então deixa de contar como pulado');
  s = undoLast(s);
  assert.deepEqual(ids(s), ['a', 'b', 'c', 'd']);
  assert.deepEqual(s, s0);
  assert.equal(undoLast(s), s, 'sem mais nada a desfazer');
});

test('o cartão recolocado pelo "errei" volta com a edição e o favorito feitos depois', () => {
  const errei = rateCurrent(newSession<Card>([{ id: 'a', question: 'antes' }, { id: 'b' }]), 'errei', 'x');
  // a cópia no fim da fila foi favoritada e editada
  const edited = patchCard(patchCard(errei, 'a', { favorite: true }), 'a', { question: 'depois' });
  const back = undoLast(edited);
  assert.deepEqual(back.queue[0], { id: 'a', question: 'depois', favorite: true });
  assert.deepEqual(ids(back), ['a', 'b']);
});

test('editar ou favoritar mexe só no cartão certo, sem mudar a ordem', () => {
  const s = patchCard(newSession(cards('a', 'b', 'c')), 'b', { favorite: true });
  assert.deepEqual(s.queue, [{ id: 'a' }, { id: 'b', favorite: true }, { id: 'c' }]);
});
