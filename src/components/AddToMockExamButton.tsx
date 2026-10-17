import { useState } from 'react';
import { ClipboardPlus } from 'lucide-react';

import { MockExamPicker } from './MockExamPicker';

/**
 * O botão "Adicionar ao simulado" de um cartão: abre o seletor com as listas do usuário.
 * `className` deixa cada tela dar ao botão o mesmo visual dos outros ícones da sua barra.
 */
export function AddToMockExamButton({
  flashcardId,
  className,
  size = 17,
}: {
  flashcardId: string;
  className: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        title="Adicionar ao simulado"
        aria-label="Adicionar ao simulado"
      >
        <ClipboardPlus size={size} />
      </button>
      {open && <MockExamPicker flashcardId={flashcardId} onClose={() => setOpen(false)} />}
    </>
  );
}
