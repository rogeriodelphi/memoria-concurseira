import { Plus, Trash2 } from 'lucide-react';

import { MAX_PAIRS, MAX_PART_CHARS, MIN_PAIRS, type MatchPair } from '../utils/matchCard';

/**
 * O formulário de um cartão de arrastar e soltar: o título e as linhas de pares (termo e descrição). Controlado: quem
 * usa guarda o título e as linhas. As linhas podem estar incompletas enquanto se digita; quem valida é o servidor, ao salvar.
 */
interface MatchCardEditorProps {
  title: string;
  rows: MatchPair[];
  onTitleChange: (title: string) => void;
  onRowsChange: (rows: MatchPair[]) => void;
  disabled?: boolean;
}

export function MatchCardEditor({ title, rows, onTitleChange, onRowsChange, disabled = false }: MatchCardEditorProps) {
  function setRow(index: number, patch: Partial<MatchPair>) {
    onRowsChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label-field" htmlFor="match-title">
          Título
        </label>
        <input
          id="match-title"
          type="text"
          className="input-field"
          value={title}
          maxLength={MAX_PART_CHARS}
          disabled={disabled}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Ex.: Protocolos de roteamento dinâmico"
        />
      </div>

      <div>
        <p className="label-field">Pares (termo e descrição)</p>
        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
          Ao estudar, cada descrição vira uma peça que você arrasta até o termo certo. Use de {MIN_PAIRS} a {MAX_PAIRS} pares,
          com termos diferentes.
        </p>
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <input
                type="text"
                className="input-field sm:w-1/3"
                value={row.term}
                maxLength={MAX_PART_CHARS}
                disabled={disabled}
                onChange={(event) => setRow(i, { term: event.target.value })}
                placeholder="Termo"
                aria-label={`Termo ${i + 1}`}
              />
              <input
                type="text"
                className="input-field sm:flex-1"
                value={row.description}
                maxLength={MAX_PART_CHARS}
                disabled={disabled}
                onChange={(event) => setRow(i, { description: event.target.value })}
                placeholder="Descrição"
                aria-label={`Descrição ${i + 1}`}
              />
              <button
                type="button"
                className="tap-area self-end rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 sm:self-auto"
                disabled={disabled || rows.length <= MIN_PAIRS}
                onClick={() => onRowsChange(rows.filter((_, k) => k !== i))}
                title={rows.length <= MIN_PAIRS ? `O cartão precisa de ao menos ${MIN_PAIRS} pares` : 'Remover o par'}
                aria-label={`Remover o par ${i + 1}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn-secondary mt-3"
          disabled={disabled || rows.length >= MAX_PAIRS}
          onClick={() => onRowsChange([...rows, { term: '', description: '' }])}
        >
          <Plus size={16} />
          Adicionar par
        </button>
      </div>
    </div>
  );
}
