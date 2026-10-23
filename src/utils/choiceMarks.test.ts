import assert from 'node:assert/strict';
import test from 'node:test';

import { crossSelected, NO_MARKS, selectOption, toggleCross, type ChoiceMarks } from './choiceMarks';

const marks = (selected: number | null, ...crossed: number[]): ChoiceMarks => ({ selected, crossed: new Set(crossed) });
const view = (m: ChoiceMarks) => ({ selected: m.selected, crossed: [...m.crossed].sort() });

test('sem marcas: nada selecionado nem tachado', () => {
  assert.deepEqual(view(NO_MARKS), { selected: null, crossed: [] });
});

test('selecionar: escolhe a alternativa, troca para outra, e clicar de novo na mesma tira a seleção', () => {
  let m = selectOption(NO_MARKS, 2);
  assert.equal(m.selected, 2);
  m = selectOption(m, 4);
  assert.equal(m.selected, 4, 'só uma de cada vez');
  m = selectOption(m, 4);
  assert.equal(m.selected, null, 'clicar na selecionada desmarca');
});

test('selecionar uma alternativa tachada a destaca (o usuário mudou de ideia) e mantém as outras tachadas', () => {
  const m = selectOption(marks(null, 1, 3), 1);
  assert.deepEqual(view(m), { selected: 1, crossed: [3] });
});

test('tachar: tacha, e tachar de novo destaca', () => {
  let m = toggleCross(NO_MARKS, 3);
  assert.deepEqual(view(m), { selected: null, crossed: [3] });
  m = toggleCross(m, 0);
  assert.deepEqual(view(m), { selected: null, crossed: [0, 3] });
  m = toggleCross(m, 3);
  assert.deepEqual(view(m), { selected: null, crossed: [0] });
});

test('tachar a selecionada tira a seleção (alternativa eliminada não é a resposta); tachar outra mantém a seleção', () => {
  assert.deepEqual(view(toggleCross(marks(2), 2)), { selected: null, crossed: [2] });
  assert.deepEqual(view(toggleCross(marks(2), 4)), { selected: 2, crossed: [4] });
  assert.deepEqual(view(toggleCross(marks(2, 3), 3)), { selected: 2, crossed: [] }, 'destachar não mexe na seleção');
});

test('o atalho de tachar vale para a selecionada, e sem seleção não faz nada', () => {
  assert.deepEqual(view(crossSelected(marks(1))), { selected: null, crossed: [1] });
  assert.equal(crossSelected(NO_MARKS), NO_MARKS);
  assert.deepEqual(view(crossSelected(marks(null, 2))), { selected: null, crossed: [2] });
});

test('as funções não alteram as marcas recebidas', () => {
  const original = marks(1, 2);
  selectOption(original, 3);
  toggleCross(original, 0);
  crossSelected(original);
  assert.deepEqual(view(original), { selected: 1, crossed: [2] });
});
