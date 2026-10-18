import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accuracyTone,
  activeFilterCount,
  areaPath,
  barPercent,
  bucketSeries,
  countsDetail,
  DEFAULT_DAYS,
  DEFAULT_QUERY,
  donutSegments,
  fillDays,
  MAX_SERIES_POINTS,
  namesLabel,
  niceScale,
  paramsFromQuery,
  parseDay,
  PERIOD_PRESETS,
  pointLabel,
  pointTitle,
  queryFromParams,
  rangeLabel,
  rankBars,
  smoothPath,
  studiedShare,
  tickIndexes,
  trendOf,
  trendText,
  type DayPoint,
} from './performance';

const params = (text: string) => new URLSearchParams(text);

// ---------- o endereço ----------

test('presets: Hoje, 7, 15, 30 dias e desde o início', () => {
  assert.deepEqual(PERIOD_PRESETS.map((p) => p.days), [1, 7, 15, 30, 0]);
  assert.deepEqual(PERIOD_PRESETS.map((p) => p.label), ['Hoje', '7 dias', '15 dias', '30 dias', 'Desde o início']);
  assert.ok(PERIOD_PRESETS.some((p) => p.days === DEFAULT_DAYS));
});

test('endereço → pedido: sem nada é o padrão; os parâmetros certos são lidos', () => {
  assert.deepEqual(queryFromParams(params('')), DEFAULT_QUERY);
  assert.deepEqual(queryFromParams(params('dias=30&escopo=concurso&nome=redes&assunto=dns')), { days: 30, range: null, scope: 'exam', name: 'redes', subject: 'dns' });
  assert.equal(queryFromParams(params('dias=0')).days, 0, 'desde o início é válido');
  assert.deepEqual(queryFromParams(params('de=2026-10-01&ate=2026-10-17')).range, { from: '2026-10-01', to: '2026-10-17' });
});

test('endereço → pedido: valor estranho cai no padrão, sem quebrar a página', () => {
  for (const bad of ['dias=5', 'dias=abc', 'dias=-1', 'dias=7.5']) assert.equal(queryFromParams(params(bad)).days, DEFAULT_DAYS, bad);
  assert.equal(queryFromParams(params('escopo=qualquer')).scope, 'all');
  for (const bad of ['de=2026-10-01', 'ate=2026-10-01', 'de=2026-13-01&ate=2026-10-01', 'de=2026-10-10&ate=2026-10-01', 'de=x&ate=y']) {
    assert.equal(queryFromParams(params(bad)).range, null, bad);
  }
  assert.equal(queryFromParams(params('nome=')).name, null);
});

test('pedido → endereço: só o que difere do padrão, e o caminho de volta dá o mesmo pedido', () => {
  assert.equal(paramsFromQuery(DEFAULT_QUERY).toString(), '');
  for (const query of [
    { days: 30, range: null, scope: 'exam' as const, name: 'seguranca da informacao', subject: '__sem_assunto__' },
    { days: 0, range: null, scope: 'all' as const, name: null, subject: null },
    { days: 7, range: { from: '2026-10-01', to: '2026-10-17' }, scope: 'all' as const, name: 'a & b', subject: null },
  ]) {
    assert.deepEqual(queryFromParams(paramsFromQuery(query)), query);
  }
  assert.equal(paramsFromQuery({ ...DEFAULT_QUERY, range: { from: '2026-10-01', to: '2026-10-17' } }).has('dias'), false, 'o período personalizado dispensa "dias"');
  assert.equal(activeFilterCount(DEFAULT_QUERY), 0);
  assert.equal(activeFilterCount({ ...DEFAULT_QUERY, name: 'a' }), 1);
  assert.equal(activeFilterCount({ ...DEFAULT_QUERY, name: 'a', subject: 'b' }), 2);
});

test('dia: só datas que existem', () => {
  assert.ok(parseDay('2026-10-17'));
  for (const bad of ['2026-02-30', '2026-13-01', '17/10/2026', '', null, undefined, '2026-1-1']) assert.equal(parseDay(bad as string), null, String(bad));
});

// ---------- textos ----------

test('período por extenso', () => {
  assert.equal(rangeLabel({ from: '2026-10-11', to: '2026-10-17' }), '11/10 a 17/10/2026');
  assert.equal(rangeLabel({ from: '2026-10-17', to: '2026-10-17' }), '17/10/2026');
  assert.equal(rangeLabel({ from: '2025-12-20', to: '2026-01-10' }), '20/12/2025 a 10/01/2026');
});

test('detalhe e nomes', () => {
  const c = { cards: 12, reviews: 30, good: 23, bad: 7, accuracyPct: 77, missedCards: 5, previousAccuracyPct: null, previousReviews: 0 };
  assert.equal(countsDetail(c), '12 cartões · 30 revisões · 77% de acerto');
  assert.equal(countsDetail({ ...c, cards: 1, reviews: 1 }), '1 cartão · 1 revisão · 77% de acerto');
  assert.equal(namesLabel(['Redes']), 'Redes');
  assert.equal(namesLabel(['Redes', 'Linux']), 'Redes, Linux');
  assert.equal(namesLabel(['Redes', 'Linux', 'Direito', 'Inglês']), 'Redes, Linux e mais 2');
});

// ---------- tendência ----------

test('tendência: sobe, cai ou fica parecido (menos de 2 pontos); sem anterior, nada', () => {
  assert.equal(trendOf(75, 63), 'up');
  assert.equal(trendOf(50, 80), 'down');
  assert.equal(trendOf(70, 69), 'flat');
  assert.equal(trendOf(70, 72), 'down', 'exatamente 2 pontos já é tendência');
  assert.equal(trendOf(72, 70), 'up');
  assert.equal(trendOf(70, 70), 'flat');
  assert.equal(trendOf(80, null), null);
  assert.equal(trendText(75, 63), 'Subiu 12 pontos em relação ao período anterior (63%)');
  assert.equal(trendText(79, 80), 'Estável em relação ao período anterior (80%)');
  assert.equal(trendText(50, 51), 'Estável em relação ao período anterior (51%)');
  assert.equal(trendText(60, 61 + 1), 'Caiu 2 pontos em relação ao período anterior (62%)');
  assert.equal(trendText(80, null), 'Sem período anterior para comparar');
});

test('cor do acerto: 80% ou mais é bom, 60 a 79 razoável, abaixo pede atenção', () => {
  assert.deepEqual([100, 80, 79, 60, 59, 0].map(accuracyTone), ['good', 'good', 'ok', 'ok', 'bad', 'bad']);
});

// ---------- série por dia ----------

const day = (date: string, good = 0, bad = 0): DayPoint => ({ date, good, bad });

test('dias sem estudo entram com zero, na ordem, dos dois extremos inclusive', () => {
  const days = fillDays({ from: '2026-10-11', to: '2026-10-17' }, [day('2026-10-13', 4, 2), day('2026-10-17', 1, 0)]);
  assert.deepEqual(days.map((d) => d.date), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.deepEqual(days.map((d) => d.good + d.bad), [0, 0, 6, 0, 0, 0, 1]);
  assert.deepEqual(fillDays({ from: '2026-10-17', to: '2026-10-17' }, []).length, 1);
  assert.deepEqual(fillDays({ from: '2026-10-17', to: '2026-10-11' }, []), [], 'período invertido');
  assert.deepEqual(fillDays({ from: 'x', to: '2026-10-11' }, []), []);
});

test('dias sem estudo: cruza meses e anos, e o horário de verão não repete nem pula dias', () => {
  const across = fillDays({ from: '2026-12-30', to: '2027-01-02' }, []);
  assert.deepEqual(across.map((d) => d.date), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  const leap = fillDays({ from: '2028-02-27', to: '2028-03-01' }, []);
  assert.deepEqual(leap.map((d) => d.date), ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
  const long = fillDays({ from: '2025-01-01', to: '2026-12-31' }, []);
  assert.equal(long.length, 730);
  assert.equal(new Set(long.map((d) => d.date)).size, 730, 'nenhum dia repetido');
});

test('agrupamento: até 45 dias, um ponto por dia; acima, grupos de dias seguidos que somam', () => {
  const week = fillDays({ from: '2026-10-11', to: '2026-10-17' }, [day('2026-10-13', 4, 2)]);
  const daily = bucketSeries(week);
  assert.equal(daily.length, 7);
  assert.ok(daily.every((p) => p.from === p.to));

  const year = fillDays({ from: '2026-01-01', to: '2026-12-31' }, [day('2026-03-10', 5, 1), day('2026-03-11', 2, 2)]);
  const grouped = bucketSeries(year);
  assert.ok(grouped.length <= MAX_SERIES_POINTS);
  assert.equal(grouped[0].from, '2026-01-01');
  assert.equal(grouped[grouped.length - 1].to, '2026-12-31');
  assert.equal(grouped.reduce((n, p) => n + p.good, 0), 7, 'nada se perde ao agrupar');
  assert.equal(grouped.reduce((n, p) => n + p.bad, 0), 3);
  // sem buracos nem sobreposição entre os grupos
  for (let i = 1; i < grouped.length; i++) assert.ok(grouped[i].from > grouped[i - 1].to);
  assert.deepEqual(bucketSeries([]), []);
});

test('rótulos e títulos dos pontos', () => {
  const points = bucketSeries(fillDays({ from: '2026-10-29', to: '2026-11-02' }, [day('2026-10-30', 3, 1)]));
  assert.deepEqual(points.map((p, i) => pointLabel(p, i, points)), ['29/10', '30', '31', '01/11', '02']);
  assert.equal(pointTitle(points[1]), '30/10: 3 acertos, 1 erro');
  assert.equal(pointTitle({ from: '2026-10-01', to: '2026-10-07', good: 1, bad: 0 }), '01/10 a 07/10: 1 acerto, 0 erros');
});

test('rótulos do eixo: poucos, espalhados, com o primeiro e o último', () => {
  assert.deepEqual(tickIndexes(0), []);
  assert.deepEqual(tickIndexes(1), [0]);
  assert.deepEqual(tickIndexes(5), [0, 1, 2, 3, 4]);
  const many = tickIndexes(45);
  assert.equal(many.length, 8);
  assert.equal(many[0], 0);
  assert.equal(many[many.length - 1], 44);
  assert.deepEqual([...many].sort((a, b) => a - b), many, 'em ordem');
  assert.equal(new Set(many).size, many.length, 'sem repetir');
});

test('escala vertical: passo redondo e quatro faixas, nunca abaixo do maior valor', () => {
  assert.deepEqual(niceScale(0), { top: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(niceScale(3), { top: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(niceScale(7), { top: 8, step: 2, ticks: [0, 2, 4, 6, 8] });
  assert.deepEqual(niceScale(9), { top: 12, step: 3, ticks: [0, 3, 6, 9, 12] }, 'o teto não fica muito acima do maior valor');
  assert.deepEqual(niceScale(48), { top: 60, step: 15, ticks: [0, 15, 30, 45, 60] });
  assert.deepEqual(niceScale(18), { top: 20, step: 5, ticks: [0, 5, 10, 15, 20] });
  assert.deepEqual(niceScale(74), { top: 80, step: 20, ticks: [0, 20, 40, 60, 80] });
  for (const max of [0, 1, 4, 5, 9, 10, 37, 100, 101, 999, 12345]) assert.ok(niceScale(max).top >= max, String(max));
  assert.equal(niceScale(-5).top, 4);
});

// ---------- curvas ----------

test('curva suave: parte do primeiro ponto, passa por todos e não sai da faixa do gráfico', () => {
  assert.equal(smoothPath([], 0, 100), '');
  assert.equal(smoothPath([{ x: 10, y: 20 }], 0, 100), 'M10.0,20.0');
  const points = [{ x: 0, y: 90 }, { x: 10, y: 10 }, { x: 20, y: 90 }, { x: 30, y: 90 }, { x: 40, y: 0 }];
  const path = smoothPath(points, 0, 90);
  assert.ok(path.startsWith('M0.0,90.0'));
  assert.equal((path.match(/C/g) ?? []).length, points.length - 1);
  const numbers = (path.match(/-?\d+\.\d/g) ?? []).map(Number);
  assert.ok(numbers.every(Number.isFinite));
  const ys = numbers.filter((_, i) => i % 2 === 1);
  assert.ok(ys.every((y) => y >= 0 && y <= 90), 'sem valores abaixo de zero nem acima do teto');
  // termina no último ponto
  assert.ok(path.endsWith('40.0,0.0'));
});

test('área sob a curva: fecha na linha de base', () => {
  assert.equal(areaPath([{ x: 0, y: 5 }], 0, 10, 10), '', 'um ponto só não tem área');
  const area = areaPath([{ x: 0, y: 5 }, { x: 10, y: 2 }], 0, 10, 10);
  assert.ok(area.endsWith('L10.0,10.0 L0.0,10.0 Z'));
  assert.ok(area.startsWith('M0.0,5.0'));
});

// ---------- rosca ----------

test('rosca: um arco por resultado que existe, na ordem; os comprimentos fecham o círculo', () => {
  const segments = donutSegments({ errei: 10, dificil: 20, bom: 30, facil: 40 }, 100);
  assert.deepEqual(segments.map((s) => s.result), ['facil', 'bom', 'dificil', 'errei']);
  assert.deepEqual(segments.map((s) => s.length), [40, 30, 20, 10]);
  assert.deepEqual(segments.map((s) => s.offset), [-0, -40, -70, -90]);
  assert.deepEqual(segments.map((s) => s.pct), [40, 30, 20, 10]);
  assert.equal(segments.reduce((n, s) => n + s.length, 0), 100);

  const some = donutSegments({ errei: 0, dificil: 0, bom: 3, facil: 1 }, 200);
  assert.deepEqual(some.map((s) => s.result), ['facil', 'bom'], 'sem arco para quem tem zero');
  assert.deepEqual(some.map((s) => s.length), [50, 150]);
  assert.deepEqual(donutSegments({ errei: 0, dificil: 0, bom: 0, facil: 0 }, 100), []);
});

// ---------- barras ----------

test('barras: ordem pela métrica, empate pela outra e pelo nome; a lista original não muda', () => {
  const groups = [
    { label: 'Zeta', cards: 5, reviews: 50 }, { label: 'Alfa', cards: 5, reviews: 50 },
    { label: 'Beta', cards: 2, reviews: 90 }, { label: 'Gama', cards: 5, reviews: 60 },
  ];
  assert.deepEqual(rankBars(groups, 'cards').map((g) => g.label), ['Gama', 'Alfa', 'Zeta', 'Beta']);
  assert.deepEqual(rankBars(groups, 'reviews').map((g) => g.label), ['Beta', 'Gama', 'Alfa', 'Zeta']);
  assert.deepEqual(groups.map((g) => g.label), ['Zeta', 'Alfa', 'Beta', 'Gama']);
});

test('comprimento da barra: proporcional à maior, com um mínimo para quem tem algo', () => {
  assert.equal(barPercent(50, 100), 50);
  assert.equal(barPercent(1, 1000), 2);
  assert.equal(barPercent(0, 100), 0);
  assert.equal(barPercent(5, 0), 0);
  assert.equal(barPercent(200, 100), 100);
});

test('parte estudada: dos cartões do usuário, em %', () => {
  const data = (cards: number, totalCards: number) => ({ totalCards, totals: { cards } }) as Parameters<typeof studiedShare>[0];
  assert.equal(studiedShare(data(340, 1537)), 22);
  assert.equal(studiedShare(data(0, 10)), 0);
  assert.equal(studiedShare(data(5, 0)), null);
});
