import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerformanceCounts, PerformanceName, PerformanceSubject } from '../types';
import {
  attentionPoints,
  attentionReasons,
  DROP_POINTS,
  hasEnoughData,
  LOW_ACCURACY,
  MAX_POINTS,
  MIN_PREVIOUS_REVIEWS,
  MIN_REVIEWS,
  missedHref,
} from './attention';
import { NO_SUBJECT_KEY } from './performance';

const counts = (accuracyPct: number, reviews = 10, extra: Partial<PerformanceCounts> = {}): PerformanceCounts => ({
  cards: Math.max(1, Math.round(reviews / 2)),
  reviews,
  good: Math.round((accuracyPct / 100) * reviews),
  bad: reviews - Math.round((accuracyPct / 100) * reviews),
  accuracyPct,
  missedCards: Math.max(0, Math.round(((100 - accuracyPct) / 100) * reviews)),
  previousAccuracyPct: null,
  previousReviews: 0,
  ...extra,
});
const subject = (key: string, label: string, c: PerformanceCounts, collectionIds = [`c-${key}`]): PerformanceSubject => ({ key, label, collectionIds, ...c });
const name = (key: string, label: string, c: PerformanceCounts, subjects: PerformanceSubject[] = [], collectionIds = [`n-${key}`]): PerformanceName => ({ key, label, collectionIds, subjects, ...c });

test('motivos: acerto baixo, queda ou os dois; revisões de menos não dizem nada', () => {
  assert.deepEqual(attentionReasons(counts(80)), { reasons: [], score: 0 });
  assert.deepEqual(attentionReasons(counts(59)).reasons, ['Acerto de 59%, abaixo de 60%']);
  assert.equal(attentionReasons(counts(60)).reasons.length, 0, 'exatamente 60% está no limite: não é abaixo');
  assert.deepEqual(attentionReasons(counts(70, 10, { previousAccuracyPct: 85, previousReviews: 10 })).reasons, ['Caiu 15 pontos: de 85% para 70%']);
  assert.equal(attentionReasons(counts(72, 10, { previousAccuracyPct: 82, previousReviews: 10 })).reasons.length, 1, 'uma queda de exatamente 10 pontos conta');
  assert.equal(attentionReasons(counts(73, 10, { previousAccuracyPct: 82, previousReviews: 10 })).reasons.length, 0, '9 pontos não');
  const both = attentionReasons(counts(40, 10, { previousAccuracyPct: 70, previousReviews: 10 }));
  assert.equal(both.reasons.length, 2);
  assert.equal(both.score, 20 + 30, 'a pontuação soma o quanto está abaixo de 60 e o quanto caiu');
  assert.deepEqual(attentionReasons(counts(20, MIN_REVIEWS - 1)), { reasons: [], score: 0 }, 'poucas revisões: nada a dizer');
  assert.equal(attentionReasons(counts(20, MIN_REVIEWS)).reasons.length, 1);
  assert.equal(attentionReasons(counts(50, 10, { previousAccuracyPct: 90, previousReviews: MIN_PREVIOUS_REVIEWS - 1 })).reasons.length, 1, 'só o acerto baixo: o período anterior tem pouca base para comparar');
  assert.ok(LOW_ACCURACY === 60 && DROP_POINTS === 10);
});

test('pontos: os assuntos de cada nome, do mais urgente ao menos, com o nome e o assunto no rótulo', () => {
  const data = {
    byName: [
      name('redes', 'Redes de Computadores', counts(65, 30), [subject('dns', 'DNS', counts(45, 10)), subject('tcp', 'TCP/IP', counts(90, 20))]),
      name('seg', 'Segurança da Informação', counts(60, 20), [subject('mfa', 'MFA', counts(30, 8)), subject('sso', 'SSO', counts(80, 12))]),
    ],
  };
  const points = attentionPoints(data);
  assert.deepEqual(points.map((p) => p.label), ['Segurança da Informação · MFA', 'Redes de Computadores · DNS']);
  assert.deepEqual(points.map((p) => [p.nameKey, p.subjectKey]), [['seg', 'mfa'], ['redes', 'dns']]);
  assert.deepEqual(points[0].collectionIds, ['c-mfa']);
  assert.deepEqual(points[0].reasons, ['Acerto de 30%, abaixo de 60%']);
});

test('pontos: quando nenhum assunto aponta sozinho, o nome todo aponta (sem repetir o que os assuntos já disseram)', () => {
  const data = {
    byName: [
      // o nome está mal, mas cada assunto tem poucas revisões para apontar
      name('linux', 'Linux', counts(40, 12), [subject('a', 'Usuários', counts(40, 4)), subject('b', 'Permissões', counts(40, 4)), subject('c', 'Redes', counts(40, 4))], ['n-linux']),
      // aqui o assunto aponta: o nome não aparece de novo
      name('dir', 'Direito', counts(50, 20), [subject('cf', 'CF', counts(40, 10))]),
    ],
  };
  const points = attentionPoints(data);
  assert.deepEqual(points.map((p) => p.label).sort(), ['Direito · CF', 'Linux']);
  assert.deepEqual(points.find((p) => p.label === 'Linux')!.collectionIds, ['n-linux']);
  assert.equal(points.find((p) => p.label === 'Linux')!.subjectKey, null);
});

test('pontos: assunto "sem assunto" aparece só com o nome', () => {
  const data = { byName: [name('dir', 'Direito', counts(50, 20), [subject(NO_SUBJECT_KEY, 'Sem assunto', counts(40, 10))])] };
  assert.deepEqual(attentionPoints(data).map((p) => [p.label, p.subjectKey]), [['Direito', NO_SUBJECT_KEY]]);
});

test('pontos: sem cartão errado para rever, não há o que o botão abrir', () => {
  const data = { byName: [name('a', 'A', counts(40, 10, { missedCards: 0 }), [subject('x', 'X', counts(40, 10, { missedCards: 0 }))])] };
  assert.deepEqual(attentionPoints(data), []);
});

test('pontos: no máximo cinco, e a ordem é estável (urgência, depois mais errados, mais revisões, nome)', () => {
  const many = Array.from({ length: 9 }, (_, i) => name(`n${i}`, `Nome ${i}`, counts(50 - i, 10), [], [`c${i}`]));
  const points = attentionPoints({ byName: many });
  assert.equal(points.length, MAX_POINTS);
  assert.deepEqual(points.map((p) => p.label), ['Nome 8', 'Nome 7', 'Nome 6', 'Nome 5', 'Nome 4'], 'quanto mais baixo o acerto, mais urgente');

  const tie = attentionPoints({ byName: [name('b', 'Beta', counts(50, 10)), name('a', 'Alfa', counts(50, 10))] });
  assert.deepEqual(tie.map((p) => p.label), ['Alfa', 'Beta']);
  assert.deepEqual(attentionPoints({ byName: [] }), []);
  assert.equal(attentionPoints({ byName: many }, 2).length, 2);
});

test('dados suficientes: algum grupo com revisões o bastante', () => {
  assert.equal(hasEnoughData({ byName: [] }), false);
  assert.equal(hasEnoughData({ byName: [name('a', 'A', counts(90, MIN_REVIEWS - 1))] }), false);
  assert.equal(hasEnoughData({ byName: [name('a', 'A', counts(90, MIN_REVIEWS))] }), true);
  assert.equal(hasEnoughData({ byName: [name('a', 'A', counts(90, 3), [subject('x', 'X', counts(90, MIN_REVIEWS))])] }), true);
});

test('endereço do "Revisar os errados": coleções, período, nome e voltar', () => {
  const point = attentionPoints({ byName: [name('seg', 'Segurança & Redes', counts(40, 10), [], ['c1', 'c2'])] })[0];
  const href = missedHref(point, { from: '2026-10-11', to: '2026-10-17' }, '/desempenho?dias=7');
  assert.ok(href.startsWith('/revisar-erros?'));
  const params = new URL(href, 'http://x').searchParams;
  assert.equal(params.get('ids'), 'c1,c2');
  assert.equal(params.get('de'), '2026-10-11');
  assert.equal(params.get('ate'), '2026-10-17');
  assert.equal(params.get('nome'), 'Segurança & Redes');
  assert.equal(params.get('voltar'), '/desempenho?dias=7');
});
