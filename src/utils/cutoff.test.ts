import assert from 'node:assert/strict';
import test from 'node:test';

import type { QbComparison, QbDisciplineResult, QbOverviewDiscipline } from '../types';
import { formatPct, marginText, overviewLine, practiceHref, sparkline, verdictLine } from './cutoff';

const result = (over: Partial<QbDisciplineResult> = {}): QbDisciplineResult => ({
  label: 'Direito',
  total: 10,
  correct: 5,
  pct: 50,
  examDisciplineId: 'd1',
  questionCount: 20,
  weight: 1,
  cutoffText: 'mínimo de 60%',
  cutoffPct: 60,
  status: 'below',
  margin: -10,
  missing: 1,
  lowSample: false,
  sourceLabels: ['Direito Administrativo'],
  ...over,
});

const overviewDiscipline = (over: Partial<QbOverviewDiscipline> = {}): QbOverviewDiscipline => ({
  id: 'd1',
  name: 'Direito',
  questionCount: 20,
  weight: 1,
  cutoffText: '60%',
  cutoffPct: 60,
  series: [],
  recentCorrect: 5,
  recentTotal: 10,
  recentPct: 50,
  trend: null,
  status: 'below',
  margin: -10,
  lowSample: false,
  ...over,
});

test('porcentagem em português', () => {
  assert.equal(formatPct(66.7), '66,7%');
  assert.equal(formatPct(50), '50%');
  assert.equal(formatPct(0), '0%');
});

test('distância da nota de corte em palavras', () => {
  assert.equal(marginText(result()), 'faltaram 1 acerto (10 pontos abaixo)');
  assert.equal(marginText(result({ missing: 3, margin: -30 })), 'faltaram 3 acertos (30 pontos abaixo)');
  assert.equal(marginText(result({ missing: 0, margin: -0.5 })), '0,5 pontos abaixo', 'sem acerto inteiro a mais que falte, só a distância');
  assert.equal(marginText(result({ status: 'above', margin: 12.5, missing: 0 })), '12,5 pontos acima');
  assert.equal(marginText(result({ status: 'above', margin: 0, missing: 0 })), 'exatamente na nota de corte');
  assert.equal(marginText(result({ status: 'unknown', margin: null, missing: null })), 'sem critério mínimo para comparar');
});

test('frase do resultado do simulado', () => {
  const base: QbComparison = { disciplines: [], unmatched: [], notCovered: [], estimatedPct: null, verdict: 'unknown' };
  assert.match(
    verdictLine({ ...base, verdict: 'below', disciplines: [result({ label: 'Direito' }), result({ label: 'Português' }), result({ label: 'Info', status: 'above' })] }),
    /^Abaixo da nota de corte em 2 disciplinas: Direito, Português\.$/,
  );
  assert.match(verdictLine({ ...base, verdict: 'below', disciplines: [result()] }), /em 1 disciplina: Direito/);
  assert.match(verdictLine({ ...base, verdict: 'above' }), /^Acima da nota de corte em todas/);
  assert.match(verdictLine(base), /não tem como ser comparado/);
});

test('frase do acompanhamento: a pior primeiro, e o que não tem critério não conta', () => {
  assert.equal(overviewLine([]), null);
  assert.equal(overviewLine([overviewDiscipline({ status: 'unknown', margin: null })]), null);
  assert.match(overviewLine([overviewDiscipline({ status: 'above', margin: 5, recentPct: 65 })])!, /todas as disciplinas com critério mínimo estão na nota de corte ou acima/);
  const line = overviewLine([
    overviewDiscipline({ name: 'Português', recentPct: 55, margin: -5 }),
    overviewDiscipline({ name: 'Direito', recentPct: 40, margin: -20 }),
    overviewDiscipline({ name: 'Info', status: 'above', margin: 10, recentPct: 70 }),
  ]);
  assert.equal(line, 'Direito é onde mais falta: 40% contra 60%, e mais 1 disciplina abaixo.');
  assert.equal(overviewLine([overviewDiscipline({ name: 'Direito', recentPct: 40, margin: -20 })]), 'Direito é onde mais falta: 40% contra 60%.');
});

test('atalho para praticar as erradas de uma disciplina', () => {
  assert.equal(practiceHref(['Direito Administrativo']), '/questoes?disciplina=Direito%20Administrativo&status=errei');
  assert.equal(practiceHref(['Informática & Redes']), '/questoes?disciplina=Inform%C3%A1tica%20%26%20Redes&status=errei');
  assert.equal(practiceHref(['Português', 'Língua Portuguesa']), '/questoes?disciplina=Portugu%C3%AAs&disciplina=L%C3%ADngua%20Portuguesa&status=errei');
});

test('desenho da série: pontos de 0 a 100, linha da nota de corte', () => {
  const spark = sparkline([0, 50, 100], 100, 50, 50, 5);
  assert.deepEqual(spark.dots.map((d) => [d.x, d.y]), [[5, 45], [50, 25], [95, 5]]);
  assert.equal(spark.path, 'M 5.0 45.0 L 50.0 25.0 L 95.0 5.0');
  assert.equal(spark.cutoffY, 25);
  assert.equal(sparkline([40], 100, 50, null).path, '', 'um ponto só não faz linha');
  assert.equal(sparkline([40], 100, 50, null).dots[0].x, 50, 'e fica no meio');
  assert.equal(sparkline([40, 60], 100, 50, null).cutoffY, null);
  const clamped = sparkline([-20, 150], 100, 50, 120, 5);
  assert.deepEqual(clamped.dots.map((d) => d.y), [45, 5], 'valores fora de 0 a 100 ficam dentro do desenho');
  assert.equal(clamped.cutoffY, 5);
});
