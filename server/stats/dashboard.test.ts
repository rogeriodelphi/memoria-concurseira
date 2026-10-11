import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDashboard, MAX_REVIEW_MS, type DashboardCard, type DashboardSession } from './dashboard';
import type { StudyResult } from '../srs';

// Datas em horário local de propósito: o painel conta "hoje" no dia local do
// servidor, então o teste não pode depender do fuso da máquina.
const NOW = new Date(2026, 9, 10, 15, 0, 0);
const at = (dayOffset: number, h: number, m = 0, s = 0) =>
  new Date(2026, 9, 10 + dayOffset, h, m, s).toISOString();

function session(
  flashcardId: string,
  result: StudyResult,
  studiedAt: string,
  durationMs: number | null = null,
): DashboardSession {
  return { flashcardId, result, studiedAt, durationMs };
}

const card = (dueAt: string | null, repetitions = 0, intervalDays = 0): DashboardCard => ({
  dueAt,
  repetitions,
  intervalDays,
});

test('sem nenhum dado, tudo zerado e sem divisão por zero', () => {
  const d = buildDashboard([], [], NOW);
  assert.equal(d.totalReviews, 0);
  assert.equal(d.today.studied, 0);
  assert.equal(d.today.paceSec, null);
  assert.equal(d.today.cardsPerMin, null);
  assert.equal(d.today.passRatePct, null);
  assert.equal(d.retentionPct, null);
  assert.equal(d.remaining.estimatedMin, null);
  assert.equal(d.totalHours, 0);
  assert.equal(d.consistency.length, 30);
});

test('classifica cada revisão pelo que veio antes no mesmo cartão', () => {
  const d = buildDashboard(
    [
      session('a', 'errei', at(0, 9, 0), 10_000), // nova
      session('a', 'bom', at(0, 9, 5), 10_000), // reaprendizado (anterior foi errei)
      session('a', 'facil', at(0, 9, 10), 10_000), // revisão normal
      session('b', 'bom', at(0, 9, 15), 10_000), // nova
    ],
    [],
    NOW,
  );
  assert.deepEqual(d.doneToday, { newLearned: 2, relearned: 1, reviews: 1, again: 1 });
  assert.equal(d.today.studied, 4);
  assert.equal(d.today.distinctCards, 2);
  assert.equal(d.today.passRatePct, 75);
});

test('só conta como hoje o dia local, não o dia em UTC', () => {
  const d = buildDashboard(
    [
      session('a', 'bom', at(-1, 23, 59, 59), 5000), // ontem
      session('b', 'bom', at(0, 0, 0, 1), 5000), // hoje, logo depois da meia-noite local
    ],
    [],
    NOW,
  );
  assert.equal(d.today.studied, 1);
  assert.equal(d.totalReviews, 2);
});

test('tempo medido é usado e limitado ao teto por revisão', () => {
  const d = buildDashboard(
    [session('a', 'bom', at(0, 9, 0), 30_000), session('b', 'bom', at(0, 9, 10), 9_999_999)],
    [],
    NOW,
  );
  assert.equal(d.estimatedReviews, 0);
  assert.equal(d.today.timeMin, (30_000 + MAX_REVIEW_MS) / 60_000);
  assert.equal(d.today.paceSec, (30_000 + MAX_REVIEW_MS) / 2 / 1000);
});

test('sem tempo medido, estima pelo intervalo até a revisão anterior', () => {
  const d = buildDashboard(
    [
      session('a', 'bom', at(0, 9, 0, 0)), // sem anterior: usa a mediana
      session('b', 'bom', at(0, 9, 0, 20)), // 20 s depois
      session('c', 'bom', at(0, 9, 1, 0)), // 40 s depois
    ],
    [],
    NOW,
  );
  assert.equal(d.estimatedReviews, 3);
  // mediana de {20 s, 40 s} = 30 s para a primeira; 20 s + 40 s para as outras
  assert.equal(d.today.timeMin, (30_000 + 20_000 + 40_000) / 60_000);
});

test('intervalo maior que o teto é pausa, não estudo', () => {
  const d = buildDashboard(
    [
      session('a', 'bom', at(0, 9, 0, 0)),
      session('b', 'bom', at(0, 9, 0, 10)), // 10 s: único intervalo plausível
      session('c', 'bom', at(0, 12, 0, 0)), // três horas depois: pausa
    ],
    [],
    NOW,
  );
  // primeira e terceira usam a mediana (10 s); a segunda, os 10 s reais
  assert.equal(d.today.timeMin, 30_000 / 60_000);
});

test('restantes seguem a revisão global: nunca estudado ou vencido', () => {
  const d = buildDashboard(
    [],
    [
      card(null), // novo
      card(null), // novo
      card(at(-2, 10), 0, 1), // venceu e está reaprendendo
      card(at(-1, 10), 3, 6), // venceu
      card(at(0, 14), 2, 6), // venceu há pouco
      card(at(0, 20), 2, 6), // vence mais tarde hoje: ainda não conta
      card(at(1, 8), 2, 6), // amanhã
      card(at(1, 23), 2, 6), // amanhã
      card(at(2, 8), 2, 6), // depois de amanhã
    ],
    NOW,
  );
  assert.deepEqual(
    { n: d.remaining.new, l: d.remaining.learning, due: d.remaining.due, total: d.remaining.total },
    { n: 2, l: 1, due: 2, total: 5 },
  );
  assert.equal(d.remaining.dueTomorrow, 2);
});

test('cartões maduros são os de intervalo de 21 dias ou mais', () => {
  const d = buildDashboard([], [card(at(5, 8), 5, 21), card(at(5, 8), 5, 20), card(at(30, 8), 8, 90)], NOW);
  assert.equal(d.matureCards, 2);
});

test('retenção só olha revisões; cartões novos têm o próprio índice', () => {
  const d = buildDashboard(
    [
      session('a', 'bom', at(-3, 9), 5000), // nova, passou
      session('b', 'errei', at(-3, 9, 1), 5000), // nova, errou
      session('a', 'bom', at(-1, 9), 5000), // revisão, passou
      session('a', 'errei', at(0, 9), 5000), // revisão, errou
      session('a', 'bom', at(0, 9, 5), 5000), // reaprendizado: fora da retenção
    ],
    [],
    NOW,
  );
  assert.equal(d.newCardsPct, 50);
  assert.equal(d.retentionPct, 50);
  assert.equal(d.precisionPct, 60);
});

test('eficiência é a fatia do tempo gasta em cartões que passaram', () => {
  const d = buildDashboard(
    [session('a', 'bom', at(0, 9, 0), 30_000), session('b', 'errei', at(0, 9, 5), 10_000)],
    [],
    NOW,
  );
  assert.equal(d.efficiencyPct, 75);
});

test('a consistência cobre 30 dias locais terminando hoje', () => {
  const d = buildDashboard([session('a', 'bom', at(0, 9), 5000), session('b', 'bom', at(-2, 9), 5000)], [], NOW);
  assert.equal(d.consistency.length, 30);
  assert.equal(d.consistency[29].count, 1);
  assert.equal(d.consistency[27].count, 1);
  assert.equal(d.consistency[28].count, 0);
  assert.equal(d.consistency[29].date, '2026-10-10');
});

test('horas totais e da última semana', () => {
  const d = buildDashboard(
    [
      session('a', 'bom', at(-20, 9), 3_600_000 / 2), // 2 min por causa do teto
      session('b', 'bom', at(-2, 9), 60_000),
    ],
    [],
    NOW,
  );
  assert.equal(d.totalHours, (MAX_REVIEW_MS + 60_000) / 3_600_000);
  assert.equal(d.pastWeekHours, 60_000 / 3_600_000);
});

test('tempo estimado para o que falta usa o ritmo recente', () => {
  const d = buildDashboard(
    [session('a', 'bom', at(0, 9, 0), 30_000)],
    [card(null), card(null), card(null)],
    NOW,
  );
  assert.equal(d.remaining.estimatedMin, (3 * 30_000) / 60_000);
});
