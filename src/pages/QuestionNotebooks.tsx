import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, Pencil, Play, Trash2 } from 'lucide-react';

import { BankTabs } from '../components/questions/BankTabs';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, } from '../services/api';
import { questionBankApi } from '../services/questionBankApi';
import type { QbNotebook } from '../types';
import { percent } from '../utils/questionBank';

const byName = (a: QbNotebook, b: QbNotebook) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });

export function progressLine(n: QbNotebook): string {
  const parts = [`${n.questionCount} ${n.questionCount === 1 ? 'questão' : 'questões'}`];
  if (n.answeredCount > 0) parts.push(`${n.answeredCount} resolvidas · ${percent(n.correctCount, n.answeredCount)}% de acerto`);
  if (n.lastAttempt) parts.push(`último simulado: ${n.lastAttempt.correct}/${n.lastAttempt.total} em ${new Date(n.lastAttempt.finishedAt).toLocaleDateString('pt-BR')}`);
  return parts.join(' · ');
}

export function QuestionNotebooks() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [notebooks, setNotebooks] = useState<QbNotebook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    questionBankApi
      .notebooks()
      .then((r) => setNotebooks(r.notebooks))
      .catch(() => setError('Não foi possível carregar seus cadernos.'));
  }, []);

  const failure = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

  async function rename(event: FormEvent, id: string) {
    event.preventDefault();
    try {
      const { notebook } = await questionBankApi.renameNotebook(id, draft);
      setNotebooks((prev) => prev?.map((n) => (n.id === id ? { ...n, name: notebook.name } : n)).sort(byName) ?? prev);
      setRenamingId(null);
    } catch (err) {
      showToast(failure(err, 'Não foi possível renomear o caderno.'), 'error');
    }
  }

  async function remove(notebook: QbNotebook) {
    const ok = await confirm({
      message: `Apagar o caderno "${notebook.name}" e o histórico dos simulados dele? As questões e as suas respostas continuam no banco.`,
      danger: true,
    });
    if (!ok) return;
    try {
      await questionBankApi.removeNotebook(notebook.id);
      setNotebooks((prev) => prev?.filter((n) => n.id !== notebook.id) ?? prev);
      showToast('Caderno apagado.');
    } catch (err) {
      showToast(failure(err, 'Não foi possível apagar o caderno.'), 'error');
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Cadernos</h1>
      <p className="mb-5 mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Listas de questões que você montou: pratique com a correção na hora ou faça um simulado cronometrado.
      </p>
      <BankTabs />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notebooks === null && !error && <p className="text-sm text-neutral-400">Carregando...</p>}
      {notebooks && notebooks.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <BookMarked size={24} className="text-neutral-400" />
          <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            Você ainda não tem cadernos. Filtre as questões e use &quot;Gerar caderno&quot; ou &quot;Criar simulado&quot;.
          </p>
          <Link to="/questoes" className="btn-primary">
            Ir para as questões
          </Link>
        </div>
      )}
      {notebooks && notebooks.length > 0 && (
        <ul className="space-y-3">
          {notebooks.map((notebook) => (
            <li key={notebook.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {renamingId === notebook.id ? (
                    <form className="flex gap-2" onSubmit={(e) => void rename(e, notebook.id)} onKeyDown={(e) => e.key === 'Escape' && setRenamingId(null)}>
                      <input autoFocus className="input-field min-w-0 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80} aria-label="Novo nome do caderno" />
                      <button type="submit" className="btn-primary" disabled={draft.trim().length < 2}>
                        Salvar
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setRenamingId(null)}>
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <Link to={`/questoes/cadernos/${notebook.id}`} className="block">
                      <h2 className="truncate text-base font-semibold text-neutral-900 hover:text-brand-700 dark:text-neutral-100 dark:hover:text-brand-300">{notebook.name}</h2>
                      <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{progressLine(notebook)}</p>
                    </Link>
                  )}
                </div>
                {renamingId !== notebook.id && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(notebook.id);
                        setDraft(notebook.name);
                      }}
                      className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                      title="Renomear"
                      aria-label={`Renomear ${notebook.name}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(notebook)}
                      className="rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      title="Apagar"
                      aria-label={`Apagar ${notebook.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to={`/questoes/cadernos/${notebook.id}/resolver?modo=pratica`} className="btn-primary">
                  <Play size={16} />
                  Praticar
                </Link>
                <Link to={`/questoes/cadernos/${notebook.id}/resolver?modo=simulado`} className="btn-secondary">
                  Fazer simulado
                </Link>
                <Link to={`/questoes/cadernos/${notebook.id}`} className="btn-secondary">
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
