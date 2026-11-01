/**
 * O texto da confirmação de "Excluir" no modo Selecionar. Diz quantos saem e o que mais some junto (o histórico de
 * revisões e a presença nos simulados vão com o cartão). `hidden` são os selecionados que a busca esconde agora: a
 * exclusão vale para todos os selecionados, e quem confirma precisa saber que alguns não estão à vista.
 */
export function bulkDeleteMessage(count: number, hidden: number): string {
  const one = count === 1;
  const title = one ? 'Excluir 1 flashcard?' : `Excluir ${count} flashcards?`;
  const alsoGone = one
    ? 'Também somem o histórico de revisões dele e a presença dele nos simulados.'
    : 'Também somem o histórico de revisões deles e a presença deles nos simulados.';
  const unseen =
    hidden === 0
      ? ''
      : hidden === 1
        ? ' 1 dos selecionados não aparece na lista por causa da busca, mas será excluído também.'
        : ` ${hidden} dos selecionados não aparecem na lista por causa da busca, mas serão excluídos também.`;
  return `${title} ${alsoGone}${unseen} Essa ação não pode ser desfeita.`;
}

/** O aviso depois de excluir. */
export function bulkDeletedToast(removed: number): string {
  return removed === 1 ? '1 flashcard excluído.' : `${removed} flashcards excluídos.`;
}
