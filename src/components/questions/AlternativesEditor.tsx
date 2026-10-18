import { Plus, Trash2 } from 'lucide-react';

import type { QbAlternative } from '../../types';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
export const MAX_ALTERNATIVES = 5;
export const MIN_ALTERNATIVES = 2;

/** Questão de Certo/Errado: as letras são C e E e não mudam. */
export const isTrueFalse = (alternatives: QbAlternative[]) =>
  alternatives.length === 2 && alternatives[0].letter === 'C' && alternatives[1].letter === 'E';

/** As letras voltam a ser A, B, C... na ordem em que as alternativas ficaram (menos no Certo/Errado). */
export const relabel = (alternatives: QbAlternative[]): QbAlternative[] =>
  isTrueFalse(alternatives) ? alternatives : alternatives.map((a, i) => ({ ...a, letter: LETTERS[i] }));

/** A edição das alternativas de uma questão: texto de cada uma, acrescentar e remover (as letras se ajustam). */
export function AlternativesEditor({
  alternatives,
  onChange,
  rows = 2,
}: {
  alternatives: QbAlternative[];
  onChange: (next: QbAlternative[]) => void;
  rows?: number;
}) {
  const fixed = isTrueFalse(alternatives);
  const edit = (index: number, text: string) => onChange(alternatives.map((a, i) => (i === index ? { ...a, text } : a)));
  const add = () => alternatives.length < MAX_ALTERNATIVES && onChange(relabel([...alternatives, { letter: '', text: '' }]));
  const remove = (index: number) => alternatives.length > MIN_ALTERNATIVES && onChange(relabel(alternatives.filter((_, i) => i !== index)));

  return (
    <div>
      <ul className="space-y-2">
        {alternatives.map((alt, index) => (
          <li key={index} className="flex items-start gap-2">
            <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {alt.letter}
            </span>
            <textarea
              className="input-field min-w-0 flex-1 resize-y py-2"
              rows={rows}
              value={alt.text}
              onChange={(e) => edit(index, e.target.value)}
              maxLength={2000}
              aria-label={`Texto da alternativa ${alt.letter}`}
            />
            {!fixed && alternatives.length > MIN_ALTERNATIVES && (
              <button
                type="button"
                onClick={() => remove(index)}
                className="mt-1.5 rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                aria-label={`Remover a alternativa ${alt.letter}`}
              >
                <Trash2 size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!fixed && alternatives.length < MAX_ALTERNATIVES && (
        <button type="button" onClick={add} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
          <Plus size={13} />
          Adicionar alternativa
        </button>
      )}
    </div>
  );
}
