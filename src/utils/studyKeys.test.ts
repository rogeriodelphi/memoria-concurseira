import assert from 'node:assert/strict';
import test from 'node:test';

import {
  choiceShortcut,
  mockExamShortcut,
  studyShortcut,
  type ChoiceShortcutContext,
  type KeyEventLike,
  type MockExamShortcutContext,
  type ShortcutContext,
  type StudyShortcut,
} from './studyKeys';

interface FakeTarget {
  tagName: string;
  isContentEditable?: boolean;
  role?: string;
}

const target = (t: FakeTarget): EventTarget =>
  ({
    tagName: t.tagName,
    isContentEditable: t.isContentEditable ?? false,
    getAttribute: (name: string) => (name === 'role' ? (t.role ?? null) : null),
  }) as unknown as EventTarget;

const BODY: FakeTarget = { tagName: 'BODY' };
const QUESTION: ShortcutContext = { revealed: false, canGoBack: true, keyboardNavigation: false };
const ANSWER: ShortcutContext = { ...QUESTION, revealed: true };

function press(
  key: string,
  context: ShortcutContext = QUESTION,
  extra: Partial<KeyEventLike> = {},
  t: FakeTarget | null = BODY,
): StudyShortcut | null {
  return studyShortcut(
    { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, target: t ? target(t) : null, ...extra },
    context,
  );
}

test('Enter com a resposta escondida mostra a resposta; já mostrada, não faz nada', () => {
  assert.deepEqual(press('Enter'), { type: 'reveal' });
  assert.deepEqual(press('Enter', QUESTION, {}, null), { type: 'reveal' });
  assert.deepEqual(press('Enter', QUESTION, { target: {} as EventTarget }), { type: 'reveal' }, 'document/window');
  assert.equal(press('Enter', ANSWER), null, 'Enter nunca avalia');
});

test('1 a 4 avaliam, só com a resposta à mostra', () => {
  assert.deepEqual(press('1', ANSWER), { type: 'rate', result: 'errei' });
  assert.deepEqual(press('2', ANSWER), { type: 'rate', result: 'dificil' });
  assert.deepEqual(press('3', ANSWER), { type: 'rate', result: 'bom' });
  assert.deepEqual(press('4', ANSWER), { type: 'rate', result: 'facil' });
  for (const key of ['1', '2', '3', '4']) assert.equal(press(key, QUESTION), null, `${key} antes de ver a resposta`);
  for (const key of ['0', '5', '9', 'a']) assert.equal(press(key, ANSWER), null, key);
});

test('→ pula o cartão, com a resposta escondida ou à mostra', () => {
  assert.deepEqual(press('ArrowRight', QUESTION), { type: 'skip' });
  assert.deepEqual(press('ArrowRight', ANSWER), { type: 'skip' });
});

test('← volta ao cartão anterior, mas só se há o que desfazer', () => {
  assert.deepEqual(press('ArrowLeft', QUESTION), { type: 'back' });
  assert.deepEqual(press('ArrowLeft', ANSWER), { type: 'back' });
  assert.equal(press('ArrowLeft', { ...QUESTION, canGoBack: false }), null);
});

test('qualquer outra tecla não faz nada', () => {
  for (const key of [' ', 'Escape', 'a', 'Tab', 'ArrowUp', 'ArrowDown', 'Backspace']) {
    assert.equal(press(key, ANSWER), null, key);
    assert.equal(press(key, QUESTION), null, key);
  }
});

test('teclas com modificador são de outros atalhos', () => {
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const) {
    for (const key of ['Enter', '1', 'ArrowRight', 'ArrowLeft']) {
      assert.equal(press(key, ANSWER, { [modifier]: true }), null, `${modifier}+${key}`);
    }
  }
});

test('tecla mantida apertada não repete a ação (segurar → não pula a fila inteira)', () => {
  assert.equal(press('ArrowRight', QUESTION, { repeat: true }), null);
  assert.equal(press('3', ANSWER, { repeat: true }), null);
  assert.equal(press('Enter', QUESTION, { repeat: true }), null);
});

test('Enter que fecha uma composição (acento, IME) não conta', () => {
  assert.equal(press('Enter', QUESTION, { isComposing: true }), null);
});

test('quem está digitando fica com todas as teclas: a busca, o editor, listas', () => {
  for (const t of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    for (const key of ['Enter', '1', '3', 'ArrowLeft', 'ArrowRight']) {
      assert.equal(press(key, ANSWER, {}, t), null, `${t.tagName}/${key}`);
      assert.equal(press(key, QUESTION, {}, t), null, `${t.tagName}/${key}`);
    }
  }
});

test('Enter num botão ou link a que o usuário chegou com Tab continua sendo "clicar" nele', () => {
  const tabbed: ShortcutContext = { ...QUESTION, keyboardNavigation: true };
  for (const t of [{ tagName: 'BUTTON' }, { tagName: 'A' }, { tagName: 'SUMMARY' }, { tagName: 'DIV', role: 'button' }]) {
    assert.equal(press('Enter', tabbed, {}, t), null, t.tagName + (t.role ?? ''));
  }
});

test('Enter num botão que ficou focado pelo clique do mouse (o "Pular", o "Ouvir pergunta") mostra a resposta', () => {
  for (const t of [{ tagName: 'BUTTON' }, { tagName: 'A' }, { tagName: 'DIV', role: 'button' }]) {
    assert.deepEqual(press('Enter', QUESTION, {}, t), { type: 'reveal' }, t.tagName);
  }
});

test('Enter em elementos comuns (não botões) vale mesmo depois de um Tab', () => {
  const tabbed: ShortcutContext = { ...QUESTION, keyboardNavigation: true };
  for (const t of [{ tagName: 'DIV' }, { tagName: 'P' }, BODY]) {
    assert.deepEqual(press('Enter', tabbed, {}, t), { type: 'reveal' }, t.tagName);
  }
});

test('1 a 4 e as setas valem com um botão focado: não são teclas de botão', () => {
  const tabbed: ShortcutContext = { ...ANSWER, keyboardNavigation: true };
  assert.deepEqual(press('3', tabbed, {}, { tagName: 'BUTTON' }), { type: 'rate', result: 'bom' });
  assert.deepEqual(press('ArrowRight', tabbed, {}, { tagName: 'BUTTON' }), { type: 'skip' });
  assert.deepEqual(press('ArrowLeft', tabbed, {}, { tagName: 'A' }), { type: 'back' });
});

// ---------- simulado ----------

const EXAM_QUESTION: MockExamShortcutContext = { revealed: false, canGoBack: true, keyboardNavigation: false };
const EXAM_ANSWER: MockExamShortcutContext = { ...EXAM_QUESTION, revealed: true };

function examPress(
  key: string,
  context: MockExamShortcutContext = EXAM_QUESTION,
  extra: Partial<KeyEventLike> = {},
  t: FakeTarget | null = BODY,
) {
  return mockExamShortcut(
    { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, target: t ? target(t) : null, ...extra },
    context,
  );
}

test('simulado: Enter mostra a resposta; 1 marca errei e 2 marca acertei, só com a resposta à mostra', () => {
  assert.deepEqual(examPress('Enter'), { type: 'reveal' });
  assert.equal(examPress('Enter', EXAM_ANSWER), null);
  assert.deepEqual(examPress('1', EXAM_ANSWER), { type: 'answer', correct: false });
  assert.deepEqual(examPress('2', EXAM_ANSWER), { type: 'answer', correct: true });
  assert.equal(examPress('1', EXAM_QUESTION), null, 'antes de ver a resposta não dá para marcar');
  assert.equal(examPress('2', EXAM_QUESTION), null);
  for (const key of ['3', '4', 'ArrowRight', ' ', 'a']) assert.equal(examPress(key, EXAM_ANSWER), null, key);
});

test('simulado: ← desfaz a última resposta, só se há uma', () => {
  assert.deepEqual(examPress('ArrowLeft', EXAM_QUESTION), { type: 'back' });
  assert.equal(examPress('ArrowLeft', { ...EXAM_QUESTION, canGoBack: false }), null);
});

test('simulado: as mesmas proteções do estudo (modificador, repetida, composição, campo de texto, botão por Tab)', () => {
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const) {
    assert.equal(examPress('Enter', EXAM_QUESTION, { [modifier]: true }), null, modifier);
  }
  assert.equal(examPress('2', EXAM_ANSWER, { repeat: true }), null);
  assert.equal(examPress('Enter', EXAM_QUESTION, { isComposing: true }), null);
  assert.equal(examPress('2', EXAM_ANSWER, {}, { tagName: 'INPUT' }), null);
  assert.equal(examPress('Enter', { ...EXAM_QUESTION, keyboardNavigation: true }, {}, { tagName: 'BUTTON' }), null);
  assert.deepEqual(examPress('Enter', EXAM_QUESTION, {}, { tagName: 'BUTTON' }), { type: 'reveal' }, 'botão do mouse');
});

// ---------- múltipla escolha ----------

const PICKING: ChoiceShortcutContext = { optionCount: 5, picked: false, selected: false, canGoBack: true, keyboardNavigation: false };
/** Uma alternativa selecionada, esperando a confirmação. */
const SELECTED: ChoiceShortcutContext = { ...PICKING, selected: true };
const PICKED: ChoiceShortcutContext = { ...PICKING, picked: true, selected: true };

function choicePress(
  key: string,
  context: ChoiceShortcutContext = PICKING,
  extra: Partial<KeyEventLike> = {},
  t: FakeTarget | null = BODY,
) {
  return choiceShortcut(
    { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, target: t ? target(t) : null, ...extra },
    context,
  );
}

test('múltipla escolha: 1 a 5 e A a E selecionam a alternativa; 0 é "não sei"', () => {
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(choicePress(String(i + 1)), { type: 'pick', index: i });
    assert.deepEqual(choicePress('abcde'[i]), { type: 'pick', index: i });
    assert.deepEqual(choicePress('ABCDE'[i]), { type: 'pick', index: i }, 'Caps Lock ligado');
  }
  assert.deepEqual(choicePress('0'), { type: 'dontknow' });
});

test('múltipla escolha: só valem as alternativas que a questão tem', () => {
  const four: ChoiceShortcutContext = { ...PICKING, optionCount: 4 };
  assert.deepEqual(choicePress('4', four), { type: 'pick', index: 3 });
  assert.equal(choicePress('5', four), null);
  assert.equal(choicePress('e', four), null);
  for (const key of ['6', '9', 'f', 'z', ' ', 'Escape', 'ArrowRight']) assert.equal(choicePress(key), null, key);
});

test('múltipla escolha: depois de responder, as alternativas não mudam e Enter segue para a próxima', () => {
  for (const key of ['1', '3', 'a', 'e', '0']) assert.equal(choicePress(key, PICKED), null, key);
  assert.deepEqual(choicePress('Enter', PICKED), { type: 'next' });
  assert.equal(choicePress('Enter', PICKING), null, 'Enter não responde por você');
});

test('múltipla escolha: Enter confirma a alternativa selecionada, e só com seleção', () => {
  assert.deepEqual(choicePress('Enter', SELECTED), { type: 'confirm' });
  assert.equal(choicePress('Enter', PICKING), null, 'sem seleção, Enter não responde');
  assert.deepEqual(choicePress('Enter', PICKED), { type: 'next' }, 'depois de confirmar, Enter segue');
  // Trocar de ideia antes de confirmar é só selecionar outra; 0 continua respondendo "não sei" na hora.
  assert.deepEqual(choicePress('c', SELECTED), { type: 'pick', index: 2 });
  assert.deepEqual(choicePress('0', SELECTED), { type: 'dontknow' });
});

test('múltipla escolha: T tacha a alternativa selecionada, e sem seleção não faz nada', () => {
  assert.deepEqual(choicePress('t', SELECTED), { type: 'cross' });
  assert.deepEqual(choicePress('T', SELECTED), { type: 'cross' }, 'Caps Lock ligado');
  assert.equal(choicePress('t', PICKING), null);
  assert.equal(choicePress('t', PICKED), null, 'depois de responder, nada muda');
  assert.equal(choicePress('t', SELECTED, {}, { tagName: 'INPUT' }), null);
});

test('múltipla escolha: Enter num botão focado por Tab é "clicar" nele; focado pelo mouse, segue', () => {
  const tabbed: ChoiceShortcutContext = { ...PICKED, keyboardNavigation: true };
  assert.equal(choicePress('Enter', tabbed, {}, { tagName: 'BUTTON' }), null);
  const tabbedSelected: ChoiceShortcutContext = { ...SELECTED, keyboardNavigation: true };
  assert.equal(choicePress('Enter', tabbedSelected, {}, { tagName: 'BUTTON' }), null, 'num botão focado por Tab, Enter é clicar nele, não confirmar');
  assert.deepEqual(choicePress('Enter', SELECTED, {}, { tagName: 'BUTTON' }), { type: 'confirm' }, 'botão focado pelo mouse: Enter confirma');
  assert.deepEqual(choicePress('Enter', PICKED, {}, { tagName: 'BUTTON' }), { type: 'next' });
  assert.deepEqual(choicePress('Enter', tabbed, {}, BODY), { type: 'next' });
});

test('múltipla escolha: ← volta a qualquer momento, se há o que desfazer', () => {
  assert.deepEqual(choicePress('ArrowLeft', PICKING), { type: 'back' });
  assert.deepEqual(choicePress('ArrowLeft', PICKED), { type: 'back' });
  assert.equal(choicePress('ArrowLeft', { ...PICKING, canGoBack: false }), null);
});

test('múltipla escolha: as mesmas proteções (modificador, repetida, composição, campo de texto)', () => {
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const) {
    assert.equal(choicePress('1', PICKING, { [modifier]: true }), null, modifier);
    assert.equal(choicePress('Enter', PICKED, { [modifier]: true }), null, modifier);
    assert.equal(choicePress('Enter', SELECTED, { [modifier]: true }), null, modifier);
  }
  assert.equal(choicePress('1', PICKING, { repeat: true }), null);
  assert.equal(choicePress('Enter', PICKED, { isComposing: true }), null);
  assert.equal(choicePress('a', PICKING, {}, { tagName: 'INPUT' }), null);
  assert.equal(choicePress('Enter', PICKED, {}, { tagName: 'TEXTAREA' }), null);
});
