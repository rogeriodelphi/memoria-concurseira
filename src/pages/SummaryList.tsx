import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileText, Plus, Trash2 } from 'lucide-react';

import { summariesApi } from '../services/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import type { Summary } from '../types';

export function SummaryList() {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const [summaries, setSummaries] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(searchParams.get('open'));

  function load() {
    summariesApi
      .list()
      .then(({ summaries }) => setSummaries(summaries))
      .catch(() => setError('Não foi possível carregar seus resumos.'));
  }

  useEffect(load, []);

  async function handleDelete(id: string) {
    const ok = await confirm({ message: 'Excluir este resumo? Essa ação não pode ser desfeita.', danger: true });
    if (!ok) return;
    try {
      await summariesApi.remove(id);
      setSummaries((prev) => prev?.filter((s) => s.id !== id) ?? prev);
      showToast('Resumo excluído.');
    } catch {
      showToast('Não foi possível excluir o resumo.', 'error');
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/resumos"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Voltar
      </Link>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Meus Resumos</h1>
        <Link to="/resumos/criar" className="btn-primary">
          <Plus size={16} />
          Criar Resumo
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {summaries === null && !error && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>
      )}

      {summaries !== null && summaries.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <FileText size={22} />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Você ainda não criou nenhum resumo.</p>
          <Link to="/resumos/criar" className="btn-primary mt-2">
            <Plus size={16} />
            Criar meu primeiro resumo
          </Link>
        </div>
      )}

      {summaries !== null && summaries.length > 0 && (
        <div className="card divide-y divide-neutral-200 dark:divide-neutral-800">
          {summaries.map((s) => {
            const expanded = expandedId === s.id;
            return (
              <div key={s.id}>
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : s.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronRight
                      size={16}
                      className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${expanded ? 'rotate-90' : ''}`}
                    />
                    <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {s.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    title="Excluir"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {expanded && (
                  <div className="px-4 pb-4 pl-10">
                    <p className="whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">{s.content}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
