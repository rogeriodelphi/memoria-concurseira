import assert from 'node:assert/strict';
import test from 'node:test';

import { studyShortcut, type KeyEventLike, type ShortcutContext, type StudyShortcut } from './studyKeys';

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
