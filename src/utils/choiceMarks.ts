/**
 * As marcas que o usuário põe nas alternativas de uma questão ANTES de responder: qual está selecionada (a que ele vai
 * confirmar) e quais estão tachadas (as que ele já eliminou). Só existem na tela, durante a questão: nada disso é
 * gravado, e a resposta só conta quando ele confirma.
 */
export interface ChoiceMarks {
  /** A alternativa selecionada, ainda sem confirmar; `null` se nenhuma. */
  selected: number | null;
  /** As alternativas tachadas (eliminadas). */
  crossed: ReadonlySet<number>;
}

/** Nenhuma marca: o começo de cada questão. */
export const NO_MARKS: ChoiceMarks = { selected: null, crossed: new Set() };

/**
 * Clicar numa alternativa a seleciona; clicar na já selecionada tira a seleção. Uma alternativa tachada que o usuário
 * seleciona deixa de ser tachada (ele mudou de ideia).
 */
export function selectOption(marks: ChoiceMarks, index: number): ChoiceMarks {
  if (marks.selected === index) return { ...marks, selected: null };
  const crossed = new Set(marks.crossed);
  crossed.delete(index);
  return { selected: index, crossed };
}

/**
 * Tacha a alternativa; tachar uma já tachada a destaca de novo. Tachar a selecionada tira a seleção: uma alternativa
 * eliminada não pode ser a resposta.
 */
export function toggleCross(marks: ChoiceMarks, index: number): ChoiceMarks {
  const crossed = new Set(marks.crossed);
  if (crossed.has(index)) {
    crossed.delete(index);
    return { selected: marks.selected, crossed };
  }
  crossed.add(index);
  return { selected: marks.selected === index ? null : marks.selected, crossed };
}

/** O atalho de tachar: tacha a alternativa que está selecionada (sem seleção, não faz nada). */
export function crossSelected(marks: ChoiceMarks): ChoiceMarks {
  return marks.selected === null ? marks : toggleCross(marks, marks.selected);
}
