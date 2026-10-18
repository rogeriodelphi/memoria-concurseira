import assert from 'node:assert/strict';
import test from 'node:test';

import { groupProvas, isFromSite, provaKey, questionLabel, updateProva } from './questionBank';

const q = (over: Partial<Parameters<typeof updateProva>[0][number]> = {}) => ({ prova: '', board: '', organ: '', year: null as number | null, ...over });

test('nome de prova para agrupar: sem acento, caixa nem espaços repetidos', () => {
  assert.equal(provaKey('  IDHTEC - 2026   Técnico em Informática '), 'idhtec - 2026 tecnico em informatica');
  assert.equal(provaKey(''), '');
});

test('provas de uma importação de site: uma por nome, com os dados da primeira questão que os traz', () => {
  const groups = groupProvas(
    [
      q({ prova: 'Prova A', board: 'IDHTEC', year: 2026 }),
      q({ prova: 'Prova B', board: 'AOCP', organ: 'UNIRIO', year: 2025 }),
      q({ prova: 'prova a', organ: 'Prefeitura' }),
    ],
    '',
  );
  assert.deepEqual(
    groups.map((g) => [g.name, g.count, g.board, g.organ, g.year]),
    [['Prova A', 2, 'IDHTEC', 'Prefeitura', 2026], ['Prova B', 1, 'AOCP', 'UNIRIO', 2025]],
  );
});

test('prova comum: tudo cai no nome da importação, num grupo só', () => {
  const groups = groupProvas([q(), q(), q()], 'FGV 2023');
  assert.deepEqual(groups.map((g) => [g.name, g.count]), [['FGV 2023', 3]]);
  assert.deepEqual(groupProvas([q({ prova: 'Só esta' }), q()], 'FGV 2023').map((g) => [g.name, g.count]), [['Só esta', 1], ['FGV 2023', 1]]);
  assert.deepEqual(groupProvas([], 'x'), []);
});

test('importação de site é reconhecida pelo código ou pela prova de cada questão', () => {
  assert.equal(isFromSite([{ prova: '', sourceId: '' }]), false);
  assert.equal(isFromSite([{ prova: '', sourceId: '' }, { prova: '', sourceId: 'Q1' }]), true);
  assert.equal(isFromSite([{ prova: 'P', sourceId: '' }]), true);
});

test('editar uma prova muda todas as questões dela e só elas', () => {
  const questions = [q({ prova: 'Prova A', board: 'X' }), q({ prova: 'Prova B' }), q({ prova: 'PROVA A' })];
  const renamed = updateProva(questions, provaKey('Prova A'), '', { name: 'IDHTEC - 2026', board: 'IDHTEC', year: 2026 });
  assert.deepEqual(renamed.map((x) => [x.prova, x.board, x.year]), [['IDHTEC - 2026', 'IDHTEC', 2026], ['Prova B', '', null], ['IDHTEC - 2026', 'IDHTEC', 2026]]);
  assert.equal(renamed[1], questions[1], 'a outra prova nem é copiada');
  const withYearOnly = updateProva(questions, provaKey('Prova B'), '', { year: 2020 });
  assert.equal(withYearOnly[1].prova, 'Prova B', 'o que não vem no ajuste fica como está');
});

test('editar a prova de uma importação comum cria o nome em cada questão (que estava vazio)', () => {
  const renamed = updateProva([q(), q()], provaKey('FGV 2023'), 'FGV 2023', { board: 'FGV' });
  assert.deepEqual(renamed.map((x) => [x.prova, x.board]), [['', 'FGV'], ['', 'FGV']]);
});

test('como a questão é chamada', () => {
  assert.equal(questionLabel({ number: 7, sourceId: '' }), 'Questão 7');
  assert.equal(questionLabel({ number: 7, sourceId: 'Q4229308' }), 'Q4229308');
});
