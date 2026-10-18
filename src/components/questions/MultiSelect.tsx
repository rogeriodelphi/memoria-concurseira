import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface Option {
  value: string;
  /** O texto mostrado; o valor, se faltar. */
  label?: string;
  count?: number;
}

const SEARCH_FROM = 8;

/**
 * Lista suspensa de escolha múltipla (Disciplina, Banca, Ano...): um botão que mostra quantos estão marcados e
 * abre uma lista com caixas de seleção e, quando é longa, um campo de busca. Fecha com Esc ou clicando fora.
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  disabled = false,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // O que está marcado mas não existe mais nas opções (um filtro salvo antigo) continua aparecendo, para poder ser desmarcado.
  const all = useMemo<Option[]>(() => {
    const known = new Set(options.map((o) => o.value));
    return [...selected.filter((s) => !known.has(s)).map((value) => ({ value, count: 0 })), ...options];
  }, [options, selected]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? all.filter((o) => (o.label ?? o.value).toLowerCase().includes(term)) : all;
  }, [all, search]);

  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  const nameOf = (o: Option) => o.label ?? (o.value === '' ? 'Não informado' : o.value);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        className="input-field flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate">
          <span className={selected.length > 0 ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}>
            {label}
          </span>
          {selected.length > 0 && (
            <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800 dark:bg-brand-900/60 dark:text-brand-200">
              {selected.length}
            </span>
          )}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          id={listId}
          className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {all.length >= SEARCH_FROM && (
            <div className="relative mb-2">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                autoFocus
                className="input-field py-1.5 pl-8"
                placeholder={`Buscar em ${label.toLowerCase()}`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={`Buscar em ${label}`}
              />
            </div>
          )}
          {all.length === 0 ? (
            <p className="px-2 py-3 text-sm text-neutral-500 dark:text-neutral-400">Nada para escolher ainda.</p>
          ) : shown.length === 0 ? (
            <p className="px-2 py-3 text-sm text-neutral-500 dark:text-neutral-400">Nenhum resultado.</p>
          ) : (
            <ul className="max-h-60 space-y-0.5 overflow-y-auto" role="listbox" aria-multiselectable="true" aria-label={label}>
              {shown.map((option) => {
                const checked = selected.includes(option.value);
                return (
                  <li key={option.value} role="option" aria-selected={checked}>
                    <button
                      type="button"
                      onClick={() => toggle(option.value)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-neutral-300 dark:border-neutral-600'
                        }`}
                      >
                        {checked && <Check size={12} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{nameOf(option)}</span>
                      {option.count !== undefined && option.count > 0 && (
                        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{option.count}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 w-full rounded-md px-2 py-1.5 text-center text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}
