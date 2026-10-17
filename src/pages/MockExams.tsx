import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, ClipboardPlus, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react';

import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, mockExamsApi } from '../services/api';
import type { MockExamSummary } from '../types';
import { percentage } from '../utils/mockExamRun';

const byName = (a: MockExamSummary, b: MockExamSummary) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });

function lastScore(exam: MockExamSummary): string {
  if (!exam.lastAttempt) return 'Ainda não feito';
  const { correct, total, finishedAt } = exam.lastAttempt;
  return `Última vez: ${percentage(correct, total)}% (${correct} de ${total}) em ${new Date(finishedAt).toLocaleDateString('pt-BR')}`;
}

export function MockExams() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [exams, setExams] = useState<MockExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    mockExamsApi
      .list()
      .then(({ mockExams }) => setExams(mockExams))
      .catch(() => setError('Não foi possível carregar seus simulados.'));
  }, []);

  const failureMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (creating || newName.trim().length < 2) return;
    setCreating(true);
    try {
      const { mockExam } = await mockExamsApi.create(newName);
      setExams((prev) => [...(prev ?? []), mockExam].sort(byName));
      setNewName('');
      showToast('Simulado criado.');
    } catch (err) {
      showToast(failureMessage(err, 'Não foi possível criar o simulado.'), 'error');
    } finally {
      setCreating(false);
    }
  }

  async function saveRename(id: string) {
    try {
      const { mockExam } = await mockExamsApi.rename(id, renameDraft);
      setExams((prev) => prev?.map((e) => (e.id === id ? mockExam : e)).sort(byName) ?? prev);
      setRenamingId(null);
    } catch (err) {
      showToast(failureMessage(err, 'Não foi possível renomear o simulado.'), 'error');
    }
  }

  async function remove(exam: MockExamSummary) {
    const ok = await confirm({
      message: `Excluir o simulado "${exam.name}" e o histórico de notas dele? Os cartões não são apagados.`,
      danger: true,
    });
    if (!ok) return;
    try {
      await mockExamsApi.remove(exam.id);
      setExams((prev) => prev?.filter((e) => e.id !== exam.id) ?? prev);
      showToast('Simulado excluído.');
    } catch (err) {
      showToast(failureMessage(err, 'Não foi possível excluir o simulado.'), 'error');
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Simulados</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Separe cartões para treinar como numa prova: você responde, marca se acertou, e no fim vê a nota, o tempo e o que
        errou. Para guardar um cartão aqui, use o botão{' '}
        <ClipboardPlus size={14} className="inline -translate-y-px text-neutral-400" /> &quot;Adicionar ao simulado&quot;
        no estudo ou na lista da coleção.
      </p>

      <form onSubmit={create} className="card mt-6 flex gap-2 p-4">
        <input
          className="input-field min-w-0 flex-1"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={80}
          placeholder="Nome do novo simulado (ex.: Direito Administrativo)"
          aria-label="Nome do novo simulado"
        />
        <button type="submit" className="btn-primary shrink-0" disabled={creating || newName.trim().length < 2}>
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Criar
        </button>
      </form>

      {error && <p className="mt-6 text-sm text-red-600">{error}</p>}
      {exams === null && !error && <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>}

      {exams !== null && exams.length === 0 && (
        <div className="card mt-6 flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <ClipboardCheck size={22} />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Você ainda não tem simulados. Crie o primeiro acima e depois adicione cartões a ele.
          </p>
        </div>
      )}

      {exams !== null && exams.length > 0 && (
        <ul className="mt-6 space-y-3">
          {exams.map((exam) => (
            <li key={exam.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {renamingId === exam.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveRename(exam.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    >
                      <input
                        autoFocus
                        className="input-field min-w-0 flex-1"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        maxLength={80}
                        aria-label="Novo nome do simulado"
                      />
                      <button type="submit" className="btn-primary" disabled={renameDraft.trim().length < 2}>
                        Salvar
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setRenamingId(null)}>
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <Link to={`/simulados/${exam.id}`} className="block">
                      <h2 className="truncate text-base font-semibold text-neutral-900 hover:text-brand-700 dark:text-neutral-100 dark:hover:text-brand-300">
                        {exam.name}
                      </h2>
                      <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                        {exam.cardCount} {exam.cardCount === 1 ? 'cartão' : 'cartões'} · {lastScore(exam)}
                      </p>
                    </Link>
                  )}
                </div>
                {renamingId !== exam.id && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(exam.id);
                        setRenameDraft(exam.name);
                      }}
                      className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                      title="Renomear"
                      aria-label={`Renomear ${exam.name}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(exam)}
                      className="rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      title="Excluir"
                      aria-label={`Excluir ${exam.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {exam.cardCount > 0 ? (
                  <Link to={`/simulados/${exam.id}/fazer`} className="btn-primary">
                    <Play size={16} />
                    Fazer simulado
                  </Link>
                ) : (
                  <span className="text-sm text-neutral-400 dark:text-neutral-500">
                    Adicione cartões a este simulado para poder fazê-lo.
                  </span>
                )}
                <Link to={`/simulados/${exam.id}`} className="btn-secondary">
                  Abrir
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
