import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Pencil, Printer, Trash2, X } from 'lucide-react';

import { mindMapsApi } from '../services/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { MindMapCanvas } from '../components/MindMapCanvas';
import type { MindMapDetail } from '../types';

export function MindMapView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { showToast } = useToast();

  const [mindMap, setMindMap] = useState<MindMapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  useEffect(() => {
    if (!id) return;
    mindMapsApi
      .get(id)
      .then(({ mindMap }) => setMindMap(mindMap))
      .catch(() => setError('Não foi possível carregar este mapa mental.'));
  }, [id]);

  function startEditTitle() {
    if (!mindMap) return;
    setTitleDraft(mindMap.title);
    setEditingTitle(true);
  }

  async function saveTitle() {
    if (!mindMap || !titleDraft.trim()) return;
    setSavingTitle(true);
    try {
      const { mindMap: updated } = await mindMapsApi.rename(mindMap.id, titleDraft.trim());
      setMindMap(updated);
      setEditingTitle(false);
    } catch {
      showToast('Não foi possível salvar o título.', 'error');
    } finally {
      setSavingTitle(false);
    }
  }

  async function handleDelete() {
    if (!mindMap) return;
    const ok = await confirm({ message: 'Excluir este mapa mental? Essa ação não pode ser desfeita.', danger: true });
    if (!ok) return;
    try {
      await mindMapsApi.remove(mindMap.id);
      showToast('Mapa mental excluído.');
      navigate('/mapas-mentais/meus');
    } catch {
      showToast('Não foi possível excluir o mapa mental.', 'error');
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!mindMap) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>;

  return (
    <div>
      <Link
        to="/mapas-mentais/meus"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 print:hidden"
      >
        <ArrowLeft size={16} />
        Meus Mapas
      </Link>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {editingTitle ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              className="input-field"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              maxLength={120}
            />
            <button
              type="button"
              onClick={saveTitle}
              disabled={savingTitle || !titleDraft.trim()}
              className="rounded-lg p-2 text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/40"
              title="Salvar"
            >
              <Check size={18} />
            </button>
            <button
              type="button"
              onClick={() => setEditingTitle(false)}
              className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 dark:text-neutral-500 dark:hover:bg-neutral-800"
              title="Cancelar"
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{mindMap.title}</h1>
            <button
              type="button"
              onClick={startEditTitle}
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 print:hidden"
              title="Renomear"
            >
              <Pencil size={15} />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 print:hidden">
          <button type="button" onClick={() => window.print()} className="btn-secondary">
            <Printer size={16} />
            Imprimir
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="btn-secondary text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            <Trash2 size={16} />
            Excluir
          </button>
        </div>
      </div>

      <div className="card h-[70vh] overflow-auto p-2 print:h-auto print:overflow-visible print:border-none print:p-0 print:shadow-none">
        <MindMapCanvas key={mindMap.id} root={mindMap.root} />
      </div>
    </div>
  );
}
