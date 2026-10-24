import assert from 'node:assert/strict';
import test from 'node:test';

import { crossLetter, crossSelected, NO_LETTER_MARKS, NO_MARKS, pickLetter, selectOption, toggleCross, type ChoiceMarks, type LetterMarks } from './choiceMarks';

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

// ---------- por letra (banco de questões) ----------

const letters = (picked: string, ...crossed: string[]): LetterMarks => ({ picked, crossed: new Set(crossed) });
const letterView = (m: LetterMarks) => ({ picked: m.picked, crossed: [...m.crossed].sort() });

test('por letra: marcar a resposta troca a anterior, e com "toggle" (simulado) tocar de novo a desmarca', () => {
  assert.equal(pickLetter(NO_LETTER_MARKS, 'B', false).picked, 'B');
  assert.equal(pickLetter(letters('B'), 'D', false).picked, 'D');
  assert.equal(pickLetter(letters('B'), 'B', false).picked, 'B', 'na prática, tocar na marcada não a desmarca');
  assert.equal(pickLetter(letters('B'), 'B', true).picked, '', 'no simulado, desmarca');
  assert.equal(pickLetter(letters('B'), 'D', true).picked, 'D');
});

test('por letra: marcar uma alternativa tachada a destaca e mantém as outras tachadas', () => {
  assert.deepEqual(letterView(pickLetter(letters('', 'A', 'C'), 'A', false)), { picked: 'A', crossed: ['C'] });
  assert.deepEqual(letterView(pickLetter(letters('B', 'A'), 'C', true)), { picked: 'C', crossed: ['A'] });
});

test('por letra: tachar tacha, tachar de novo destaca, e tachar a marcada tira a marca', () => {
  assert.deepEqual(letterView(crossLetter(NO_LETTER_MARKS, 'D')), { picked: '', crossed: ['D'] });
  assert.deepEqual(letterView(crossLetter(letters('', 'D'), 'D')), { picked: '', crossed: [] });
  assert.deepEqual(letterView(crossLetter(letters('B'), 'B')), { picked: '', crossed: ['B'] });
  assert.deepEqual(letterView(crossLetter(letters('B'), 'E')), { picked: 'B', crossed: ['E'] });
  assert.deepEqual(letterView(crossLetter(letters('B', 'E'), 'E')), { picked: 'B', crossed: [] }, 'destachar não mexe na marca');
});

test('por letra: as funções não alteram as marcas recebidas', () => {
  const original = letters('B', 'A');
  pickLetter(original, 'C', true);
  crossLetter(original, 'D');
  assert.deepEqual(letterView(original), { picked: 'B', crossed: ['A'] });
});
