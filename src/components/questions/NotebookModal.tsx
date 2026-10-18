import { useState, type FormEvent } from 'react';
import { Loader2, Shuffle } from 'lucide-react';

import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/api';
import { questionBankApi } from '../../services/questionBankApi';
import type { QbFilter, QbNotebook, QbOrder } from '../../types';
import { Modal } from './Modal';

const MAX_QUESTIONS = 300;
const DEFAULT_SIMULADO = 30;

const today = () => new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/**
 * "Gerar Caderno" e "Criar Simulado": guardam as questões do filtro aplicado (só as que têm gabarito) numa lista.
 * O caderno é para praticar com calma; o simulado já começa cronometrado, com a correção só no final.
 */
export function NotebookModal({
  mode,
  filter,
  order,
  total,
  onClose,
  onCreated,
}: {
  mode: 'caderno' | 'simulado';
  filter: QbFilter;
  order: QbOrder;
  /** Quantas questões o filtro encontrou (com ou sem gabarito). */
  total: number;
  onClose: () => void;
  onCreated: (notebook: QbNotebook, mode: 'caderno' | 'simulado') => void;
}) {
  const { showToast } = useToast();
  const isSimulado = mode === 'simulado';
  const [name, setName] = useState(`${isSimulado ? 'Simulado' : 'Caderno'} ${today()}`);
  const [limit, setLimit] = useState(String(Math.min(total, isSimulado ? DEFAULT_SIMULADO : MAX_QUESTIONS)));
  const [shuffle, setShuffle] = useState(isSimulado);
  const [busy, setBusy] = useState(false);

  const count = Number(limit);
  const validCount = Number.isInteger(count) && count >= 1 && count <= MAX_QUESTIONS;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || name.trim().length < 2 || !validCount) return;
    setBusy(true);
    try {
      const { notebook, added, skipped } = await questionBankApi.createNotebook({ name, filter, limit: count, shuffle, order });
      showToast(
        skipped > 0
          ? `${isSimulado ? 'Simulado' : 'Caderno'} criado com ${added} questões. ${skipped} ficaram de fora por não terem gabarito.`
          : `${isSimulado ? 'Simulado' : 'Caderno'} criado com ${added} questões.`,
      );
      onCreated(notebook, mode);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível criar o caderno.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isSimulado ? 'Criar simulado' : 'Gerar caderno'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {isSimulado
            ? 'O simulado usa as questões do filtro aplicado: você responde todas contra o relógio e só vê a correção no final.'
            : 'O caderno guarda as questões do filtro aplicado numa lista, para você praticar quando quiser.'}{' '}
          Entram só as questões com gabarito (o filtro encontrou {total}).
        </p>
        <div>
          <label className="label-field" htmlFor="nb-name">Nome</label>
          <input id="nb-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </div>
        <div>
          <label className="label-field" htmlFor="nb-limit">Quantas questões</label>
          <input
            id="nb-limit"
            className="input-field"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_QUESTIONS}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
          <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">No máximo {MAX_QUESTIONS}.</p>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
          <span>
            <Shuffle size={13} className="mr-1 inline -translate-y-px text-neutral-400" />
            Sortear as questões (em vez de seguir a ordem da lista)
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy || name.trim().length < 2 || !validCount}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {isSimulado ? 'Criar e começar' : 'Criar caderno'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
