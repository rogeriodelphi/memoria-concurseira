import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';

import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/api';
import { questionBankApi } from '../../services/questionBankApi';
import type { QbFacets, QbFilter, QbSavedFilter } from '../../types';
import { chipsFor } from '../../utils/questionBank';
import { Modal } from './Modal';

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** "Salvar filtro": dá um nome ao filtro aplicado. Aparece também a lista, para o caso de querer abrir outro. */
export function SaveFilterModal({
  filter,
  onClose,
  onSaved,
}: {
  filter: QbFilter;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || name.trim().length < 2) return;
    setBusy(true);
    try {
      await questionBankApi.saveFilter(name, filter);
      showToast('Filtro salvo.');
      onSaved();
    } catch (err) {
      showToast(message(err, 'Não foi possível salvar o filtro.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Salvar filtro" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Guarde o filtro aplicado para abri-lo depois em &quot;Meus filtros&quot;.
        </p>
        <div>
          <label className="label-field" htmlFor="sf-name">Nome do filtro</label>
          <input id="sf-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: Direito Administrativo que errei" autoFocus />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy || name.trim().length < 2}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Meus filtros": os filtros salvos, para aplicar ou apagar. */
export function SavedFiltersModal({
  facets,
  onClose,
  onApply,
}: {
  facets: QbFacets | null;
  onClose: () => void;
  onApply: (filter: QbFilter) => void;
}) {
  const { showToast } = useToast();
  const [filters, setFilters] = useState<QbSavedFilter[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    questionBankApi
      .savedFilters()
      .then((r) => setFilters(r.filters))
      .catch(() => setFailed(true));
  }, []);

  async function remove(saved: QbSavedFilter) {
    try {
      await questionBankApi.removeFilter(saved.id);
      setFilters((prev) => prev?.filter((f) => f.id !== saved.id) ?? prev);
    } catch (err) {
      showToast(message(err, 'Não foi possível apagar o filtro.'), 'error');
    }
  }

  return (
    <Modal title="Meus filtros" onClose={onClose}>
      {failed && <p className="text-sm text-red-600">Não foi possível carregar seus filtros.</p>}
      {filters === null && !failed && (
        <p className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 size={14} className="animate-spin" />
          Carregando...
        </p>
      )}
      {filters && filters.length === 0 && (
        <p className="rounded-lg bg-neutral-50 px-3 py-3 text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
          Você ainda não salvou nenhum filtro. Aplique um filtro e use &quot;Salvar filtro&quot;.
        </p>
      )}
      {filters && filters.length > 0 && (
        <ul className="space-y-2">
          {filters.map((saved) => {
            const summary = chipsFor(saved.filter, facets).map((c) => c.label).join(' · ');
            return (
              <li key={saved.id} className="flex items-start gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                <button type="button" onClick={() => onApply(saved.filter)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-semibold text-neutral-900 hover:text-brand-700 dark:text-neutral-100 dark:hover:text-brand-300">
                    {saved.name}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-500 dark:text-neutral-400">{summary || 'Sem critérios'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(saved)}
                  className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  aria-label={`Apagar o filtro ${saved.name}`}
                  title="Apagar"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
