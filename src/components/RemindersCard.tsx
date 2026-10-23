import { useEffect, useState, type FormEvent } from 'react';
import { Check, Loader2, Plus, StickyNote, Trash2 } from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import { ApiError, todosApi } from '../services/api';
import type { TodoItem } from '../types';
import { MAX_TODO_TEXT, orderTodos, todoSummary } from '../utils/todos';

/**
 * "Meus lembretes", no Painel: uma lista curta de coisas a não esquecer (a inscrição de um concurso, pedir um documento),
 * que você marca como feitas. É só sua e não mexe em cartões nem na fila de revisão. (O lembrete de estudo por push, nas
 * Configurações, é outra coisa.) Se a leitura falhar, o resto do Painel segue sem ela.
 */
export function RemindersCard() {
  const { showToast } = useToast();
  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    todosApi
      .list()
      .then(({ todos }) => current && setItems(orderTodos(todos)))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, []);

  const fail = (err: unknown, fallback: string) => showToast(err instanceof ApiError ? err.message : fallback, 'error');

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || adding) return;
    setAdding(true);
    try {
      const { todo } = await todosApi.add(value);
      setItems((prev) => orderTodos([...(prev ?? []), todo]));
      setText('');
    } catch (err) {
      fail(err, 'Não foi possível salvar o lembrete.');
    } finally {
      setAdding(false);
    }
  }

  async function toggle(item: TodoItem) {
    setBusyId(item.id);
    try {
      const { todo } = await todosApi.setDone(item.id, !item.done);
      setItems((prev) => orderTodos((prev ?? []).map((t) => (t.id === todo.id ? todo : t))));
    } catch (err) {
      fail(err, 'Não foi possível atualizar o lembrete.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: TodoItem) {
    setBusyId(item.id);
    try {
      await todosApi.remove(item.id);
      setItems((prev) => (prev ?? []).filter((t) => t.id !== item.id));
    } catch (err) {
      fail(err, 'Não foi possível apagar o lembrete.');
    } finally {
      setBusyId(null);
    }
  }

  async function clearDone() {
    try {
      await todosApi.clearDone();
      setItems((prev) => (prev ?? []).filter((t) => !t.done));
    } catch (err) {
      fail(err, 'Não foi possível limpar os lembretes feitos.');
    }
  }

  if (failed) return null;

  const done = items?.filter((t) => t.done).length ?? 0;

  return (
    <section className="card mb-6 p-5" aria-label="Meus lembretes">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          <StickyNote size={16} className="text-brand-600 dark:text-brand-400" />
          Meus lembretes
        </h2>
        {items && items.length > 0 && <span className="text-xs text-neutral-400 dark:text-neutral-500">{todoSummary(items)}</span>}
      </div>

      <form onSubmit={add} className="flex gap-2">
        <input
          type="text"
          className="input-field min-w-0 flex-1"
          placeholder="Adicionar novo lembrete..."
          aria-label="Novo lembrete"
          value={text}
          maxLength={MAX_TODO_TEXT}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn-primary shrink-0 px-3" disabled={!text.trim() || adding} aria-label="Adicionar lembrete" title="Adicionar lembrete">
          {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        </button>
      </form>

      {!items && <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">Carregando...</p>}
      {items && items.length === 0 && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Nenhum lembrete. Escreva acima o que você não pode esquecer (a inscrição de um concurso, por exemplo).</p>
      )}

      {items && items.length > 0 && (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-0.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-800/40"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                aria-label={item.done ? `Desmarcar: ${item.text}` : `Marcar como feito: ${item.text}`}
                disabled={busyId === item.id}
                onClick={() => void toggle(item)}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
                  item.done
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-neutral-300 text-transparent hover:border-brand-500 dark:border-neutral-600'
                }`}
              >
                <Check size={12} strokeWidth={3} />
              </button>
              <span
                className={`min-w-0 flex-1 break-words text-sm ${
                  item.done ? 'text-neutral-400 line-through dark:text-neutral-500' : 'text-neutral-800 dark:text-neutral-200'
                }`}
              >
                {item.text}
              </span>
              <button
                type="button"
                onClick={() => void remove(item)}
                disabled={busyId === item.id}
                aria-label={`Apagar lembrete: ${item.text}`}
                title="Apagar"
                className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-50 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {done > 0 && (
        <button type="button" onClick={() => void clearDone()} className="mt-3 text-xs font-medium text-neutral-500 hover:text-neutral-700 hover:underline dark:text-neutral-400">
          Limpar {done === 1 ? 'o lembrete feito' : `os ${done} lembretes feitos`}
        </button>
      )}
    </section>
  );
}
