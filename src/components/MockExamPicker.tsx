import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ClipboardList, Loader2, Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useToast } from '../contexts/ToastContext';
import { useModalKeys } from '../hooks/useModalKeys';
import { ApiError, mockExamsApi } from '../services/api';
import type { MockExamSummary } from '../types';

const byName = (a: MockExamSummary, b: MockExamSummary) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });

/**
 * "Adicionar ao simulado": as listas do usuário, cada uma marcada se já tem o cartão (clicar
 * coloca ou tira na hora), e um campo para criar uma lista nova já com o cartão dentro.
 */
export function MockExamPicker({ flashcardId, onClose }: { flashcardId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const [exams, setExams] = useState<MockExamSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Esc fecha; a página por trás não rola; nenhuma tecla chega aos atalhos de estudo por baixo.
  useModalKeys(onClose);

  useEffect(() => {
    mockExamsApi
      .list(flashcardId)
      .then(({ mockExams }) => setExams(mockExams))
      .catch(() => setLoadError(true));
  }, [flashcardId]);

  const failureMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

  async function toggle(exam: MockExamSummary) {
    if (busyId) return;
    setBusyId(exam.id);
    const putIn = !exam.containsCard;
    try {
      if (putIn) await mockExamsApi.addCards(exam.id, [flashcardId]);
      else await mockExamsApi.removeCard(exam.id, flashcardId);
      setExams(
        (prev) =>
          prev?.map((e) =>
            e.id === exam.id ? { ...e, containsCard: putIn, cardCount: e.cardCount + (putIn ? 1 : -1) } : e,
          ) ?? prev,
      );
    } catch (err) {
      showToast(failureMessage(err, 'Não foi possível atualizar o simulado.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function createAndAdd(event: FormEvent) {
    event.preventDefault();
    if (creating || newName.trim().length < 2) return;
    setCreating(true);
    try {
      const { mockExam } = await mockExamsApi.create(newName);
      await mockExamsApi.addCards(mockExam.id, [flashcardId]);
      setExams((prev) => [...(prev ?? []), { ...mockExam, cardCount: 1, containsCard: true }].sort(byName));
      setNewName('');
    } catch (err) {
      showToast(failureMessage(err, 'Não foi possível criar o simulado.'), 'error');
    } finally {
      setCreating(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Adicionar ao simulado"
      onClick={onClose}
    >
      <div className="card flex max-h-[85vh] w-full max-w-sm flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Adicionar ao simulado</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          Marque os simulados que devem ter este cartão. Um cartão pode estar em vários.
        </p>

        <div className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5">
          {loadError && <p className="text-sm text-red-600">Não foi possível carregar seus simulados.</p>}
          {exams === null && !loadError && (
            <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
              <Loader2 size={14} className="animate-spin" />
              Carregando...
            </p>
          )}
          {exams !== null && exams.length === 0 && (
            <p className="rounded-lg bg-neutral-50 px-3 py-3 text-sm text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
              Você ainda não tem simulados. Crie o primeiro logo abaixo.
            </p>
          )}
          {exams !== null && exams.length > 0 && (
            <ul className="space-y-1.5">
              {exams.map((exam) => (
                <li key={exam.id}>
                  <button
                    type="button"
                    onClick={() => void toggle(exam)}
                    disabled={busyId !== null}
                    aria-pressed={!!exam.containsCard}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                      exam.containsCard
                        ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40'
                        : 'border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        exam.containsCard
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-neutral-300 dark:border-neutral-600'
                      }`}
                    >
                      {busyId === exam.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        exam.containsCard && <Check size={14} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                        {exam.name}
                      </span>
                      <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                        {exam.cardCount} {exam.cardCount === 1 ? 'cartão' : 'cartões'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={createAndAdd} className="mt-4 flex gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <input
            className="input-field min-w-0 flex-1"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={80}
            placeholder="Novo simulado (ex.: Redes)"
            aria-label="Nome do novo simulado"
          />
          <button type="submit" className="btn-primary shrink-0" disabled={creating || newName.trim().length < 2}>
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Criar
          </button>
        </form>

        <Link
          to="/simulados"
          className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-brand-600 dark:text-neutral-400 dark:hover:text-brand-400"
        >
          <ClipboardList size={13} />
          Ver meus simulados
        </Link>
      </div>
    </div>,
    document.body,
  );
}
