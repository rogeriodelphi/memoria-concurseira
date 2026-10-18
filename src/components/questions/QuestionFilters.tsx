import { useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, Eraser, Filter, History, Search, X } from 'lucide-react';

import type { QbFacets, QbFilter, QbStatus } from '../../types';
import {
  activeCount,
  chipsFor,
  FLAG_LABEL,
  LIST_FIELDS,
  mergeOptions,
  pruneSubjects,
  STATUS_LABEL,
  subjectOptions,
  toggle,
  type Chip,
  type FlagKey,
  type ListFieldKey,
} from '../../utils/questionBank';
import { MultiSelect, type Option } from './MultiSelect';

function Check({ checked, onChange, children }: { checked: boolean; onChange: (next: boolean) => void; children: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-neutral-300 accent-brand-600 dark:border-neutral-600"
      />
      {children}
    </label>
  );
}

const STATUSES = Object.keys(STATUS_LABEL) as QbStatus[];
const EXCLUDES: FlagKey[] = ['excludeInNotebooks', 'excludeAnnulled', 'excludeNoAnswer'];

/**
 * O painel "Questões objetivas": minhas questões, busca por palavra, as listas de escolha (disciplina, assunto,
 * banca, ano...), o que excluir e incluir, os "Filtrar por:" aplicados e os botões. Edita um rascunho; a busca só
 * muda quando o usuário aplica (Filtrar).
 */
export function QuestionFilters({
  draft,
  onDraft,
  applied,
  facets,
  onApply,
  onClear,
  onApplyLast,
  canApplyLast,
  onRemoveChip,
  busy,
}: {
  draft: QbFilter;
  onDraft: (next: QbFilter) => void;
  applied: QbFilter;
  facets: QbFacets | null;
  onApply: () => void;
  onClear: () => void;
  onApplyLast: () => void;
  canApplyLast: boolean;
  onRemoveChip: (chip: Chip) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(true);

  const options = useMemo<Record<ListFieldKey, Option[]>>(() => {
    if (!facets) return { discipline: [], subject: [], board: [], level: [], position: [], year: [], organ: [], exam: [] };
    return {
      discipline: facets.discipline,
      subject: mergeOptions(subjectOptions(facets, draft.discipline)),
      board: facets.board,
      level: facets.level,
      position: facets.position,
      year: facets.year,
      organ: facets.organ,
      exam: facets.exam.map((e) => ({ value: e.id, label: e.value, count: e.count })),
    };
  }, [facets, draft.discipline]);

  const chips = useMemo(() => chipsFor(applied, facets), [applied, facets]);
  const pending = activeCount(draft);

  function setList(key: ListFieldKey, values: string[]) {
    const next: QbFilter = key === 'year' ? { ...draft, year: values.map(Number).filter(Number.isInteger) } : { ...draft, [key]: values };
    onDraft(key === 'discipline' && facets ? pruneSubjects(next, facets) : next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply();
  }

  return (
    <form onSubmit={submit} className="card mb-5 p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left sm:hidden"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          <Filter size={16} />
          Filtros{pending > 0 ? ` (${pending})` : ''}
        </span>
        <ChevronDown size={18} className={`text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <div className={`${open ? 'mt-4 sm:mt-0' : 'hidden'} space-y-5 sm:block`}>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">Minhas questões</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {STATUSES.map((status) => (
              <Check key={status} checked={draft.status.includes(status)} onChange={() => onDraft({ ...draft, status: toggle(draft.status, status) })}>
                {STATUS_LABEL[status]}
              </Check>
            ))}
          </div>
        </fieldset>

        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            className="input-field pl-9"
            placeholder="Buscar por palavra no enunciado, nas alternativas ou no texto de apoio"
            value={draft.q}
            maxLength={100}
            onChange={(e) => onDraft({ ...draft, q: e.target.value })}
            aria-label="Buscar por palavra"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LIST_FIELDS.map((field) => (
            <MultiSelect
              key={field.key}
              label={field.label}
              options={options[field.key]}
              selected={(draft[field.key] as (string | number)[]).map(String)}
              onChange={(values) => setList(field.key, values)}
              disabled={!facets}
            />
          ))}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">Excluir questões</legend>
            <div className="flex flex-col gap-2">
              {EXCLUDES.map((flag) => (
                <Check key={flag} checked={draft[flag]} onChange={(checked) => onDraft({ ...draft, [flag]: checked })}>
                  {FLAG_LABEL[flag]}
                </Check>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">Incluir somente</legend>
            <Check checked={draft.onlyWithNote} onChange={(checked) => onDraft({ ...draft, onlyWithNote: checked })}>
              Questões com minhas anotações
            </Check>
          </fieldset>
        </div>

        {chips.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">Filtrar por</p>
            <ul className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li key={chip.id}>
                  <button
                    type="button"
                    onClick={() => onRemoveChip(chip)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100 dark:bg-brand-950/50 dark:text-brand-200 dark:hover:bg-brand-900/60"
                    title="Tirar este critério"
                  >
                    <span className="truncate">{chip.label}</span>
                    <X size={12} className="shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <button type="button" onClick={onApplyLast} disabled={!canApplyLast || busy} className="btn-secondary py-2">
            <History size={16} />
            Aplicar último filtro
          </button>
          <button type="button" onClick={onClear} disabled={busy || (pending === 0 && chips.length === 0)} className="btn-secondary py-2">
            <Eraser size={16} />
            Limpar
          </button>
          <button type="submit" disabled={busy} className="btn-primary py-2">
            <Filter size={16} />
            Filtrar
          </button>
        </div>
      </div>
    </form>
  );
}
