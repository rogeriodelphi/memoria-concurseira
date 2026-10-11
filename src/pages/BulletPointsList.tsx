import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ListChecks, Loader2, Plus, Trash2, Volume2, VolumeX } from 'lucide-react';

import { bulletPointsApi } from '../services/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { useSpeech } from '../hooks/useSpeech';
import type { BulletPoints } from '../types';
import { bulletPointsToSpeech } from '../utils/speech';

export function BulletPointsList() {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { speak, stop, speaking, loading, canSpeak } = useSpeech();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<BulletPoints[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(searchParams.get('open'));

  // Fechar ou trocar de item para a leitura: ninguém quer ouvir o que acabou de esconder.
  // (O hook também para tudo ao sair da tela.)
  useEffect(() => {
    stop();
  }, [expandedId, stop]);

  function toggleSpeak(item: BulletPoints) {
    if (speaking === 'text') {
      stop();
      return;
    }
    void speak(bulletPointsToSpeech(item.title, item.points), 'text');
  }

  function load() {
    bulletPointsApi
      .list()
      .then(({ bulletPoints }) => setItems(bulletPoints))
      .catch(() => setError('Não foi possível carregar seus bullet points.'));
  }

  useEffect(load, []);

  async function handleDelete(id: string) {
    const ok = await confirm({ message: 'Excluir estes bullet points? Essa ação não pode ser desfeita.', danger: true });
    if (!ok) return;
    try {
      await bulletPointsApi.remove(id);
      if (expandedId === id) stop(); // o item some da tela: a leitura dele também
      setItems((prev) => prev?.filter((i) => i.id !== id) ?? prev);
      showToast('Bullet points excluído.');
    } catch {
      showToast('Não foi possível excluir os bullet points.', 'error');
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/bullet-points"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Voltar
      </Link>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Meus Bullet points</h1>
        <Link to="/bullet-points/criar" className="btn-primary">
          <Plus size={16} />
          Criar Bullet points
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {items === null && !error && <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>}

      {items !== null && items.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <ListChecks size={22} />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Você ainda não criou nenhum bullet points.</p>
          <Link to="/bullet-points/criar" className="btn-primary mt-2">
            <Plus size={16} />
            Criar meu primeiro bullet points
          </Link>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="card divide-y divide-neutral-200 dark:divide-neutral-800">
          {items.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <div key={item.id}>
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronRight
                      size={16}
                      className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${expanded ? 'rotate-90' : ''}`}
                    />
                    <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {item.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    title="Excluir"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {expanded && (
                  <div className="px-4 pb-4 pl-10">
                    {canSpeak && (
                      <button
                        type="button"
                        onClick={() => toggleSpeak(item)}
                        className="mb-3 flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-brand-600 dark:text-neutral-500 dark:hover:text-brand-400"
                      >
                        {loading === 'text' ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : speaking === 'text' ? (
                          <VolumeX size={14} />
                        ) : (
                          <Volume2 size={14} />
                        )}
                        {loading === 'text' ? 'Preparando voz...' : speaking === 'text' ? 'Parar' : 'Ouvir'}
                      </button>
                    )}
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
                      {item.points.map((point, i) => (
                        <li key={i}>{point}</li>
                      ))}
                    </ul>
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
