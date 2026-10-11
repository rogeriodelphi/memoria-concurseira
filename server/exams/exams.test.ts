import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanExamDate, LIMITS, normalizeDraft } from './draft';
import { buildExamProgress, daysUntil, type CollectionStat, type ExamStructure } from './progress';
import { MIN_SCORE, STRONG_SCORE, suggestCollections, tokenize } from './suggest';

// ---------- normalizeDraft ----------

test('rascunho: limpa espaços, descarta vazios e tópicos repetidos, mantém a ordem', () => {
  const { draft, truncated } = normalizeDraft({
    name: '  Analista   de TI  ',
    position: 'Analista',
    board: 'Banca X',
    examDate: '2026-12-06',
    disciplines: [
      { name: ' Redes ', topics: ['Modelo OSI', '  modelo   osi ', 'TCP/IP', '', '   '] },
      { name: '   ', topics: ['sem nome'] },
      { name: 'Legislação', topics: [{ title: 'Lei 8.112/90', id: 'abc' }] },
    ],
  });
  assert.equal(truncated, false);
  assert.equal(draft.name, 'Analista de TI');
  assert.equal(draft.examDate, '2026-12-06');
  assert.deepEqual(
    draft.disciplines.map((d) => d.name),
    ['Redes', 'Legislação'],
  );
  assert.deepEqual(
    draft.disciplines[0].topics.map((t) => t.title),
    ['Modelo OSI', 'TCP/IP'],
  );
  assert.equal(draft.disciplines[1].topics[0].id, 'abc');
});

test('rascunho: números e data inválidos viram null em vez de lixo', () => {
  const { draft } = normalizeDraft({
    examDate: '2026-02-31',
    disciplines: [
      { name: 'A', questionCount: 10, weight: '2,5', topics: [] },
      { name: 'B', questionCount: 3.5, weight: -1, topics: [] },
      { name: 'C', questionCount: 'dez', weight: 'x', topics: [] },
      { name: 'D', questionCount: 0, weight: 0, topics: [] },
      { name: 'E', questionCount: 100000, weight: 100000, topics: [] },
    ],
  });
  assert.equal(draft.examDate, null);
  assert.deepEqual(
    draft.disciplines.map((d) => [d.questionCount, d.weight]),
    [[10, 2.5], [null, null], [null, null], [null, null], [null, null]],
  );
});

test('rascunho: entrada que não é objeto vira um rascunho vazio, sem lançar', () => {
  for (const bad of [null, undefined, 'texto', 42, [], { disciplines: 'x' }]) {
    const { draft } = normalizeDraft(bad);
    assert.equal(draft.name, '');
    assert.deepEqual(draft.disciplines, []);
  }
});

test('rascunho: passar dos limites corta e avisa', () => {
  const many = Array.from({ length: LIMITS.topicsPerDiscipline + 5 }, (_, i) => `Tópico ${i}`);
  const { draft, truncated } = normalizeDraft({ name: 'X', disciplines: [{ name: 'Muito', topics: many }] });
  assert.equal(truncated, true);
  assert.equal(draft.disciplines[0].topics.length, LIMITS.topicsPerDiscipline);

  const tooManyDisciplines = Array.from({ length: LIMITS.disciplines + 1 }, (_, i) => ({ name: `D${i}`, topics: [] }));
  assert.equal(normalizeDraft({ name: 'X', disciplines: tooManyDisciplines }).truncated, true);
});

test('data da prova: só datas de calendário que existem', () => {
  assert.equal(cleanExamDate('2026-10-11'), '2026-10-11');
  assert.equal(cleanExamDate('2024-02-29'), '2024-02-29');
  assert.equal(cleanExamDate('2026-02-29'), null);
  assert.equal(cleanExamDate('11/10/2026'), null);
  assert.equal(cleanExamDate('1999-01-01'), null);
  assert.equal(cleanExamDate(20261011), null);
});

// ---------- suggestCollections ----------

const COLLECTIONS = [
  { id: 'imp', name: 'Legislação', subject: 'Lei 8.429/1992' },
  { id: 'virt', name: 'Storage e Virtualização', subject: 'Virtualização' },
  { id: 'wifi', name: 'Infraestrutura', subject: 'Redes Sem Fio' },
  { id: 'redes', name: 'Infraestrutura', subject: 'Arquitetura TCP/IP' },
  { id: 'dns', name: 'Infraestrutura', subject: 'DNS' },
  { id: 'mfa', name: 'Segurança da Informação', subject: 'MFA (Autenticação Multifator)' },
  { id: 'sem-assunto', name: 'Segurança da Informação', subject: '' },
];
const ids = (list: { collectionId: string }[]) => list.map((s) => s.collectionId);

test('sugestão: números de lei casam mesmo com pontuação diferente', () => {
  const [top] = suggestCollections('Improbidade administrativa (Lei nº 8.429/1992)', COLLECTIONS);
  assert.equal(top.collectionId, 'imp');
  assert.ok(top.score >= STRONG_SCORE);
  assert.deepEqual(tokenize('Lei 8.429/1992'), tokenize('lei 8429 1992'));
});

test('sugestão: assunto de uma palavra só casa quando é o tópico todo ou está contido nele', () => {
  assert.equal(suggestCollections('Virtualização de servidores e hypervisors', COLLECTIONS)[0].collectionId, 'virt');
  assert.equal(suggestCollections('DNS', COLLECTIONS)[0].collectionId, 'dns');
});

test('sugestão: uma palavra genérica em comum não basta', () => {
  // "Redes de computadores" divide só "redes" com o assunto "Redes Sem Fio"
  const result = suggestCollections('Redes de computadores', COLLECTIONS);
  assert.ok(!ids(result).includes('wifi'));
  assert.ok(!ids(result).includes('redes'));
});

test('sugestão: o nome da coleção só conta com desconto e nunca vira aceitação automática', () => {
  const result = suggestCollections('Segurança da Informação', COLLECTIONS);
  assert.ok(ids(result).includes('sem-assunto'));
  for (const s of result) assert.ok(s.score < STRONG_SCORE, `${s.collectionId} passou de ${STRONG_SCORE}`);
});

test('sugestão: ordem por pontuação, no máximo 3, e respeita exclusões', () => {
  const lots = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: 'X', subject: 'Autenticação multifator MFA' }));
  const result = suggestCollections('Autenticação multifator (MFA)', lots);
  assert.equal(result.length, 3);
  const excluded = suggestCollections('Autenticação multifator (MFA)', lots, { exclude: new Set(['c0', 'c1', 'c2']) });
  assert.ok(ids(excluded).every((id) => !['c0', 'c1', 'c2'].includes(id)));
  assert.ok(result.every((s) => s.score >= MIN_SCORE));
});

test('sugestão: sem coleções ou sem texto, nada', () => {
  assert.deepEqual(suggestCollections('qualquer coisa', []), []);
  assert.deepEqual(suggestCollections('', COLLECTIONS), []);
  assert.deepEqual(suggestCollections('de da do', COLLECTIONS), []);
});

// ---------- buildExamProgress ----------

const stat = (id: string, over: Partial<CollectionStat> = {}): CollectionStat => ({
  id,
  cards: 0,
  newCards: 0,
  dueCards: 0,
  reviews30: 0,
  passed30: 0,
  ...over,
});

const STRUCTURE: ExamStructure = {
  disciplines: [
    {
      id: 'd1',
      name: 'Redes',
      questionCount: 10,
      weight: 2,
      cutoff: '',
      topics: [
        { id: 't1', title: 'TCP/IP' },
        { id: 't2', title: 'DNS' },
        { id: 't3', title: 'Roteamento' },
        { id: 't4', title: 'QoS' },
      ],
    },
    {
      id: 'd2',
      name: 'Legislação',
      questionCount: 30,
      weight: null,
      cutoff: 'mín. 50%',
      topics: [{ id: 't5', title: 'Lei 8.429/1992' }],
    },
    { id: 'd3', name: 'Vazia', questionCount: null, weight: null, cutoff: '', topics: [] },
  ],
};

test('progresso: cobertura por tópico e disciplina vem do material vinculado', () => {
  const links = new Map([
    ['t1', ['c1']],
    ['t2', ['c2']],
    ['t3', ['c3']], // coleção vinculada mas sem cartões: não conta como material
  ]);
  const progress = buildExamProgress(STRUCTURE, links, [
    stat('c1', { cards: 10, newCards: 4, dueCards: 2, reviews30: 10, passed30: 8 }),
    stat('c2', { cards: 5, reviews30: 5, passed30: 1 }),
    stat('c3', { cards: 0 }),
  ]);

  const redes = progress.disciplines[0];
  assert.equal(redes.topicCount, 4);
  assert.equal(redes.coveredTopics, 2);
  assert.equal(redes.coveragePct, 50);
  assert.deepEqual(
    redes.topics.map((t) => t.hasMaterial),
    [true, true, false, false],
  );
  assert.equal(redes.cards, 15);
  assert.equal(redes.dueCards, 2);
  assert.equal(redes.newCards, 4);
  assert.equal(redes.approvalPct, 60); // 9 de 15 revisões não foram "Errei"
  assert.equal(redes.topics[0].approvalPct, 80);
  assert.equal(progress.disciplines[1].coveragePct, 0);
  assert.equal(progress.disciplines[2].coveragePct, null);
});

test('progresso: uma coleção em vários tópicos não conta os cartões duas vezes na disciplina', () => {
  const links = new Map([
    ['t1', ['c1']],
    ['t2', ['c1']],
    ['t3', ['c1', 'c1']],
  ]);
  const progress = buildExamProgress(STRUCTURE, links, [stat('c1', { cards: 10, dueCards: 3, reviews30: 4, passed30: 2 })]);
  const redes = progress.disciplines[0];
  assert.equal(redes.cards, 10);
  assert.equal(redes.dueCards, 3);
  assert.equal(redes.approvalPct, 50);
  assert.equal(redes.coveredTopics, 3); // cada tópico tem material
  assert.equal(progress.overall.cards, 10);
});

test('progresso: vínculo com coleção que não existe mais é ignorado', () => {
  const progress = buildExamProgress(STRUCTURE, new Map([['t1', ['apagada']]]), []);
  assert.equal(progress.disciplines[0].topics[0].hasMaterial, false);
  assert.deepEqual(progress.disciplines[0].topics[0].collectionIds, []);
});

test('progresso: cobertura geral pesa pelas questões quando todas as disciplinas têm', () => {
  const links = new Map([
    ['t1', ['c1']],
    ['t2', ['c1']], // Redes: 2 de 4 tópicos = 50%
    ['t5', ['c2']], // Legislação: 1 de 1 = 100%
  ]);
  const progress = buildExamProgress(STRUCTURE, links, [stat('c1', { cards: 3 }), stat('c2', { cards: 3 })]);
  // a disciplina vazia não entra na conta, então 10 e 30 questões estão em jogo:
  // (10 × 0,5 + 30 × 1) / 40 = 87,5% → 88
  assert.equal(progress.overall.weightedByQuestions, true);
  assert.equal(progress.overall.coveragePct, 88);
  assert.equal(progress.overall.coveredTopics, 3);
  assert.equal(progress.overall.topicCount, 5);
});

test('progresso: sem questões em alguma disciplina, a cobertura geral é a contagem simples de tópicos', () => {
  const noQuestions: ExamStructure = {
    disciplines: [{ ...STRUCTURE.disciplines[0], questionCount: null }, STRUCTURE.disciplines[1]],
  };
  const links = new Map([['t5', ['c2']]]);
  const progress = buildExamProgress(noQuestions, links, [stat('c2', { cards: 1 })]);
  assert.equal(progress.overall.weightedByQuestions, false);
  assert.equal(progress.overall.coveragePct, 20); // 1 de 5 tópicos
});

test('progresso: concurso vazio não divide por zero', () => {
  const progress = buildExamProgress({ disciplines: [] }, new Map(), []);
  assert.equal(progress.overall.coveragePct, null);
  assert.equal(progress.overall.approvalPct, null);
  assert.equal(progress.overall.topicCount, 0);
});

// ---------- daysUntil ----------

test('dias até a prova: dia de calendário local, negativo se já passou', () => {
  const now = new Date(2026, 9, 11, 23, 30); // 11/10/2026 à noite
  assert.equal(daysUntil('2026-10-11', now), 0);
  assert.equal(daysUntil('2026-10-12', now), 1);
  assert.equal(daysUntil('2026-12-06', now), 56);
  assert.equal(daysUntil('2026-10-10', now), -1);
  assert.equal(daysUntil(null, now), null);
  assert.equal(daysUntil('lixo', now), null);
});

test('dias até a prova: atravessa a virada do horário de verão sem ficar com 23h/25h', () => {
  // Brasil não tem mais horário de verão, mas a conta não pode depender disso
  assert.equal(daysUntil('2026-11-01', new Date(2026, 9, 25, 12)), 7);
  assert.equal(daysUntil('2027-03-15', new Date(2026, 9, 25, 12)), 141);
});
