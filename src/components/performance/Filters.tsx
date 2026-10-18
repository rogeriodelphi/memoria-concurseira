import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, SlidersHorizontal, X } from 'lucide-react';

import type { PerformanceData, PerformanceQuery } from '../../types';
import { activeFilterCount, formatIsoDay, NO_SUBJECT_KEY, parseDay, PERIOD_PRESETS, rangeLabel } from '../../utils/performance';

const BUTTON =
  'flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800';

/** Uma janelinha que abre abaixo do botão e fecha ao clicar fora ou com Esc. */
function Popover({ label, button, children }: { label: string; button: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {button(open, () => setOpen((v) => !v))}
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** O período personalizado: dois dias (os dois entram inteiros), de até 10 anos, sem datas no futuro. */
function CustomRange({ query, today, onApply, close }: { query: PerformanceQuery; today: string; onApply: (range: { from: string; to: string }) => void; close: () => void }) {
  const [from, setFrom] = useState(query.range?.from ?? today);
  const [to, setTo] = useState(query.range?.to ?? today);
  const start = parseDay(from);
  const end = parseDay(to);
  const error = !start || !end ? 'Escolha as duas datas.' : start.getTime() > end.getTime() ? 'A data inicial é depois da final.' : (end.getTime() - start.getTime()) / 86_400_000 > 3650 ? 'Escolha um período de até 10 anos.' : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (error) return;
        onApply({ from, to });
        close();
      }}
      className="space-y-3"
    >
      <div>
        <label className="label-field" htmlFor="perf-from">De</label>
        <input id="perf-from" type="date" className="input-field" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <label className="label-field" htmlFor="perf-to">Até</label>
        <input id="perf-to" type="date" className="input-field" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={error !== null}>
        Aplicar período
      </button>
    </form>
  );
}

/**
 * A barra de filtros do "Meu desempenho": períodos prontos, período personalizado e "Todos os filtros"
 * (nome da coleção e assunto). As escolhas viram um novo pedido; quem guarda o estado é a página.
 */
export function FilterBar({
  query,
  data,
  onChange,
}: {
  query: PerformanceQuery;
  data: PerformanceData | null;
  onChange: (next: PerformanceQuery) => void;
}) {
  const today = formatIsoDay(new Date());
  const filters = activeFilterCount(query);
  const customLabel = query.range ? rangeLabel(query.range) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Período" className="inline-flex overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
        {PERIOD_PRESETS.map((p) => {
          const active = !query.range && query.days === p.days;
          return (
            <button
              key={p.days}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ ...query, days: p.days, range: null })}
              className={`border-r border-neutral-200 px-3 py-1.5 text-xs font-medium transition-colors last:border-r-0 dark:border-neutral-700 ${
                active ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50' : 'bg-white text-neutral-600 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <Popover
        label="Período personalizado"
        button={(open, toggle) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label="Período personalizado" title="Período personalizado" className={`${BUTTON} ${query.range ? 'border-brand-400 text-brand-700 dark:border-brand-600 dark:text-brand-300' : ''}`}>
            <CalendarDays size={14} />
            {customLabel && <span className="hidden sm:inline">{customLabel}</span>}
          </button>
        )}
      >
        {(close) => <CustomRange query={query} today={today} onApply={(range) => onChange({ ...query, range })} close={close} />}
      </Popover>

      <Popover
        label="Todos os filtros"
        button={(open, toggle) => (
          <button type="button" onClick={toggle} aria-expanded={open} className={`${BUTTON} ${filters > 0 ? 'border-brand-400 text-brand-700 dark:border-brand-600 dark:text-brand-300' : ''}`}>
            <SlidersHorizontal size={14} />
            Todos os filtros{filters > 0 ? ` (${filters})` : ''}
          </button>
        )}
      >
        {(close) => (
          <div className="space-y-3">
            <div>
              <label className="label-field" htmlFor="perf-name">Nome da coleção</label>
              <select id="perf-name" className="input-field" value={query.name ?? ''} onChange={(e) => onChange({ ...query, name: e.target.value || null })}>
                <option value="">Todos</option>
                {data?.options.names.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field" htmlFor="perf-subject">Assunto</label>
              <select id="perf-subject" className="input-field" value={query.subject ?? ''} onChange={(e) => onChange({ ...query, subject: e.target.value || null })}>
                <option value="">Todos</option>
                {data?.options.subjects.map((o) => (
                  <option key={o.key || NO_SUBJECT_KEY} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-between gap-2">
              <button type="button" className="btn-secondary" disabled={filters === 0} onClick={() => onChange({ ...query, name: null, subject: null })}>
                Limpar filtros
              </button>
              <button type="button" className="btn-primary" onClick={close}>
                Pronto
              </button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}

/** Os filtros ligados, como etiquetas que se tiram com um toque. */
export function ActiveFilters({ query, data, onChange }: { query: PerformanceQuery; data: PerformanceData | null; onChange: (next: PerformanceQuery) => void }) {
  const nameLabel = query.name ? (data?.options.names.find((o) => o.key === query.name)?.label ?? query.name) : null;
  const subjectLabel = query.subject ? (data?.options.subjects.find((o) => o.key === query.subject)?.label ?? query.subject) : null;
  if (!nameLabel && !subjectLabel) return null;
  const chip = (text: string, remove: () => void, kind: string) => (
    <span key={kind} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
      {kind}: {text}
      <button type="button" onClick={remove} aria-label={`Tirar o filtro ${kind}: ${text}`} className="rounded-full p-0.5 hover:bg-brand-100 dark:hover:bg-brand-900/50">
        <X size={12} />
      </button>
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {nameLabel && chip(nameLabel, () => onChange({ ...query, name: null }), 'Coleção')}
      {subjectLabel && chip(subjectLabel, () => onChange({ ...query, subject: null }), 'Assunto')}
    </div>
  );
}
