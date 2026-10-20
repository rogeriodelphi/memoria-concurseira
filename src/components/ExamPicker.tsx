import { useCallback, useState } from 'react';

import type { ExamOption } from '../types';
import { examOptionLabel, readFocusExam, saveFocusExam } from '../utils/focusExam';

/**
 * O concurso que as telas de prova mostram, e como trocá-lo. Quem tem um concurso só (ou nenhum) não vê nada: o seletor
 * aparece com dois ou mais. A escolha fica guardada neste aparelho e vale para a Meta para a prova, a Reta final e o Meu
 * desempenho; sem escolha, ou com uma que a tela não consegue usar, vale o de data mais próxima.
 */
export function useFocusExam() {
  const [focus, setFocus] = useState<string | undefined>(() => readFocusExam());
  const choose = useCallback((id: string) => {
    saveFocusExam(id);
    setFocus(id);
  }, []);
  return { focus, choose };
}

export function ExamPicker({
  options,
  selectedId,
  onChange,
  className = '',
}: {
  options: ExamOption[];
  /** O concurso que está valendo (o que o servidor usou, que pode não ser o pedido). */
  selectedId: string | null;
  onChange: (id: string) => void;
  className?: string;
}) {
  if (options.length < 2) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <label htmlFor="exam-picker" className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
        Concurso
      </label>
      <select
        id="exam-picker"
        className="input-field !w-auto max-w-full !py-1.5 text-sm"
        value={selectedId ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {selectedId === null && <option value="">—</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {examOptionLabel(option)}
          </option>
        ))}
      </select>
    </div>
  );
}
