import assert from 'node:assert/strict';
import test from 'node:test';

import { bulkDeletedToast, bulkDeleteMessage } from './bulkDelete';

test('confirmação: diz quantos saem, o que vai junto e que não dá para desfazer', () => {
  assert.equal(
    bulkDeleteMessage(12, 0),
    'Excluir 12 flashcards? Também somem o histórico de revisões deles e a presença deles nos simulados. Essa ação não pode ser desfeita.',
  );
});

test('confirmação: no singular o texto concorda', () => {
  assert.equal(
    bulkDeleteMessage(1, 0),
    'Excluir 1 flashcard? Também somem o histórico de revisões dele e a presença dele nos simulados. Essa ação não pode ser desfeita.',
  );
});

test('confirmação: avisa quando a busca esconde parte dos selecionados', () => {
  assert.match(bulkDeleteMessage(5, 1), /1 dos selecionados não aparece na lista por causa da busca, mas será excluído também\./);
  assert.match(bulkDeleteMessage(5, 3), /3 dos selecionados não aparecem na lista por causa da busca, mas serão excluídos também\./);
  assert.doesNotMatch(bulkDeleteMessage(5, 0), /busca/);
  // o aviso vem antes do "não pode ser desfeita", que continua sendo a última frase
  assert.match(bulkDeleteMessage(5, 3), /excluídos também\. Essa ação não pode ser desfeita\.$/);
});

test('aviso depois de excluir', () => {
  assert.equal(bulkDeletedToast(1), '1 flashcard excluído.');
  assert.equal(bulkDeletedToast(30), '30 flashcards excluídos.');
});
