import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Network, Plus, Trash2 } from 'lucide-react';

import { mindMapsApi } from '../services/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import type { MindMapSummary } from '../types';

export function MindMapList() {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [mindMaps, setMindMaps] = useState<MindMapSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    mindMapsApi
      .list()
      .then(({ mindMaps }) => setMindMaps(mindMaps))
      .catch(() => setError('Não foi possível carregar seus mapas mentais.'));
  }

  useEffect(load, []);

  async function handleDelete(id: string) {
    const ok = await confirm({ message: 'Excluir este mapa mental? Essa ação não pode ser desfeita.', danger: true });
    if (!ok) return;
    try {
      await mindMapsApi.remove(id);
      setMindMaps((prev) => prev?.filter((m) => m.id !== id) ?? prev);
      showToast('Mapa mental excluído.');
    } catch {
      showToast('Não foi possível excluir o mapa mental.', 'error');
    }
  }

  return (
    <div>
      <Link
        to="/mapas-mentais"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Mapas Mentais
      </Link>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Meus Mapas</h1>
        <Link to="/mapas-mentais/criar" className="btn-primary">
          <Plus size={16} />
          Criar Mapa
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {mindMaps === null && !error && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>
      )}

      {mindMaps !== null && mindMaps.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <Network size={22} />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Você ainda não criou nenhum mapa mental.</p>
          <Link to="/mapas-mentais/criar" className="btn-primary mt-2">
            <Plus size={16} />
            Criar meu primeiro mapa
          </Link>
        </div>
      )}

      {mindMaps !== null && mindMaps.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mindMaps.map((m) => (
            <div key={m.id} className="card flex items-start justify-between gap-2 p-4">
              <Link to={`/mapas-mentais/${m.id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900 hover:text-brand-600 dark:text-neutral-100 dark:hover:text-brand-400">
                  {m.title}
                </p>
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  Atualizado em {new Date(m.updatedAt).toLocaleDateString('pt-BR')}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(m.id)}
                className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                title="Excluir"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
