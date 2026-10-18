import assert from 'node:assert/strict';
import test from 'node:test';

import type { QbFacets, QbFilter } from '../types';
import {
  activeCount,
  blockedReason,
  clock,
  breadcrumb,
  chipsFor,
  EMPTY_FILTER,
  filterForExam,
  isEmpty,
  lastPageOf,
  loadLastFilter,
  mergeOptions,
  metaParts,
  pageWindow,
  percent,
  pruneSubjects,
  readFilter,
  saveLastFilter,
  statsLine,
  subjectOptions,
  toggle,
} from './questionBank';

const facets: QbFacets = {
  discipline: [{ value: 'Direito', count: 3 }, { value: 'Português', count: 2 }],
  subject: [
    { value: 'Atos', discipline: 'Direito', count: 2 },
    { value: 'Licitações', discipline: 'Direito', count: 1 },
    { value: 'Crase', discipline: 'Português', count: 2 },
  ],
  board: [],
  organ: [],
  year: [],
  position: [],
  level: [],
  exam: [{ id: 'e1', value: 'FGV 2023', count: 5 }],
};

const filter = (over: Partial<QbFilter> = {}): QbFilter => ({ ...EMPTY_FILTER, ...over });

test('alternar valor numa lista', () => {
  assert.deepEqual(toggle(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggle(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggle<number>([], 2020), [2020]);
});

test('critérios ligados: cada grupo conta uma vez', () => {
  assert.equal(activeCount(EMPTY_FILTER), 0);
  assert.ok(isEmpty(EMPTY_FILTER));
  assert.equal(activeCount(filter({ status: ['errei', 'acertei'] })), 1);
  assert.equal(activeCount(filter({ q: '  ' })), 0, 'só espaços não conta');
  assert.equal(activeCount(filter({ discipline: ['A', 'B'], year: [2020], excludeAnnulled: true, onlyWithNote: true, q: 'x' })), 5);
});

test('chips: um por valor aplicado, e clicar tira só aquele', () => {
  const f = filter({ status: ['errei'], discipline: ['Direito', 'Português'], year: [2023], exam: ['e1'], q: 'prazo', excludeAnnulled: true, onlyWithNote: true });
  const chips = chipsFor(f, facets);
  assert.deepEqual(
    chips.map((c) => c.label),
    ['Errei', '“prazo”', 'Disciplina: Direito', 'Disciplina: Português', 'Ano: 2023', 'Prova: FGV 2023', 'Excluir: Anuladas', 'Só com minhas anotações'],
  );
  const direito = chips.find((c) => c.label === 'Disciplina: Direito')!;
  assert.deepEqual(direito.without(f).discipline, ['Português']);
  assert.deepEqual(chips.find((c) => c.id === 'q')!.without(f).q, '');
  assert.equal(chips.find((c) => c.id === 'excludeAnnulled')!.without(f).excludeAnnulled, false);
  assert.deepEqual(chips.find((c) => c.id === 'year:2023')!.without(f).year, []);
  // Tirar todos os chips um a um deixa o filtro vazio.
  let rest = f;
  for (const chip of chipsFor(f, facets)) rest = chip.without(rest);
  assert.deepEqual(rest, EMPTY_FILTER);
  assert.equal(chipsFor(filter({ discipline: [''] }), facets)[0].label, 'Disciplina: Não informado');
  assert.equal(chipsFor(filter({ exam: ['x'] }), null)[0].label, 'Prova: Prova');
});

test('ler o filtro guardado: completa o que falta e ignora o que não é reconhecido', () => {
  assert.deepEqual(readFilter(null), EMPTY_FILTER);
  assert.deepEqual(readFilter('lixo'), EMPTY_FILTER);
  const read = readFilter({ status: ['errei', 'hacker', 4], discipline: ['A', 3], year: [2020, '2021'], excludeAnnulled: true, outro: 1 });
  assert.deepEqual(read.status, ['errei']);
  assert.deepEqual(read.discipline, ['A']);
  assert.deepEqual(read.year, [2020]);
  assert.equal(read.excludeAnnulled, true);
  assert.equal(read.onlyWithNote, false);
  assert.ok(!('outro' in read));
});

test('último filtro: guarda e lê; armazenamento quebrado ou ausente não derruba', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  saveLastFilter(filter({ status: ['errei'] }), storage);
  assert.deepEqual(loadLastFilter(storage)?.status, ['errei']);
  assert.equal(loadLastFilter({ getItem: () => null }), null);
  assert.equal(loadLastFilter({ getItem: () => '{não é json' }), null);
  assert.equal(loadLastFilter({ getItem: () => { throw new Error('bloqueado'); } }), null);
  assert.doesNotThrow(() => saveLastFilter(EMPTY_FILTER, { setItem: () => { throw new Error('cheio'); } }));
  assert.doesNotThrow(() => saveLastFilter(EMPTY_FILTER, null));
  assert.equal(loadLastFilter(null), null);
});

test('atalho para uma prova', () => {
  assert.deepEqual(filterForExam('e1').exam, ['e1']);
  assert.equal(activeCount(filterForExam('e1')), 1);
});

test('paginação: primeira, última e vizinhas, com salto marcado', () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(1, 10), [1, 2, null, 10]);
  assert.deepEqual(pageWindow(5, 10), [1, null, 4, 5, 6, null, 10]);
  assert.deepEqual(pageWindow(10, 10), [1, null, 9, 10]);
  assert.deepEqual(pageWindow(3, 5), [1, 2, 3, 4, 5]);
  assert.equal(lastPageOf(0, 20), 1);
  assert.equal(lastPageOf(41, 20), 3);
  assert.equal(lastPageOf(40, 20), 2);
});

test('frases da questão', () => {
  assert.deepEqual(
    metaParts({ year: 2023, board: 'FGV', organ: '', position: 'Analista', examName: 'Prova X' }).map((p) => `${p.label}: ${p.value}`),
    ['Ano: 2023', 'Banca: FGV', 'Cargo: Analista', 'Prova: Prova X'],
  );
  assert.equal(breadcrumb({ discipline: 'Direito', subject: 'Atos' }), 'Direito › Atos');
  assert.equal(breadcrumb({ discipline: 'Direito', subject: '' }), 'Direito');
  assert.equal(breadcrumb({ discipline: '', subject: '' }), '');
  assert.equal(statsLine({ timesAnswered: 0, timesCorrect: 0 }), 'Você ainda não respondeu esta questão.');
  assert.equal(statsLine({ timesAnswered: 1, timesCorrect: 1 }), 'Respondida 1 vez · 100% de acerto');
  assert.equal(statsLine({ timesAnswered: 3, timesCorrect: 2 }), 'Respondida 3 vezes · 67% de acerto');
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(0, 0), 0);
});

test('por que não dá para responder', () => {
  assert.match(blockedReason({ annulled: true, gradable: false })!, /anulada/);
  assert.match(blockedReason({ annulled: false, gradable: false })!, /não tem gabarito/);
  assert.equal(blockedReason({ annulled: false, gradable: true }), null);
});

test('assuntos: só os das disciplinas escolhidas, e a escolha velha sai ao trocar de disciplina', () => {
  assert.equal(subjectOptions(facets, []).length, 3);
  assert.deepEqual(subjectOptions(facets, ['direito']).map((s) => s.value), ['Atos', 'Licitações']);
  const f = filter({ discipline: ['Português'], subject: ['Atos', 'Crase'] });
  assert.deepEqual(pruneSubjects(f, facets).subject, ['Crase']);
  const untouched = filter({ discipline: ['Direito'], subject: ['Atos'] });
  assert.equal(pruneSubjects(untouched, facets), untouched, 'nada a podar: devolve o mesmo objeto');
  assert.equal(pruneSubjects(filter({ subject: ['Qualquer'] }), facets).subject.length, 1, 'sem disciplina escolhida, não poda');
});

test('opções repetidas entre disciplinas se juntam', () => {
  assert.deepEqual(mergeOptions([{ value: 'Crase', count: 2 }, { value: 'crase', count: 1 }, { value: 'Atos', count: 4 }]), [
    { value: 'Crase', count: 3 },
    { value: 'Atos', count: 4 },
  ]);
});

test('cronômetro do simulado', () => {
  assert.equal(clock(0), '00:00');
  assert.equal(clock(999), '00:00');
  assert.equal(clock(61_000), '01:01');
  assert.equal(clock(59 * 60_000 + 59_000), '59:59');
  assert.equal(clock(3_600_000), '1:00:00');
  assert.equal(clock(3_725_000), '1:02:05');
  assert.equal(clock(-5), '00:00');
});
