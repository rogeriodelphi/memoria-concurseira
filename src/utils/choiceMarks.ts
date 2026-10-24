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

// ---------- por letra (banco de questões) ----------

/**
 * As mesmas marcas, para as alternativas identificadas por letra (A a E), como no banco de questões: a que está marcada
 * como resposta (`picked`, vazia se nenhuma) e as tachadas. Ficam só na tela: a resposta só vale quando o usuário a envia
 * (no caderno, ao "Responder"; no simulado, ao finalizar).
 */
export interface LetterMarks {
  picked: string;
  crossed: ReadonlySet<string>;
}

export const NO_LETTER_MARKS: LetterMarks = { picked: '', crossed: new Set() };

/**
 * Marcar uma alternativa como resposta. Com `toggle` (o simulado), tocar de novo na marcada a desmarca; sem ele (a prática),
 * só troca. Marcar uma tachada a destaca: o usuário mudou de ideia.
 */
export function pickLetter(marks: LetterMarks, letter: string, toggle: boolean): LetterMarks {
  const crossed = new Set(marks.crossed);
  crossed.delete(letter);
  return { picked: toggle && marks.picked === letter ? '' : letter, crossed };
}

/** Tachar (ou destacar) uma alternativa. Tachar a marcada como resposta tira a marca: uma eliminada não pode ser a resposta. */
export function crossLetter(marks: LetterMarks, letter: string): LetterMarks {
  const crossed = new Set(marks.crossed);
  if (crossed.has(letter)) {
    crossed.delete(letter);
    return { picked: marks.picked, crossed };
  }
  crossed.add(letter);
  return { picked: marks.picked === letter ? '' : marks.picked, crossed };
}
