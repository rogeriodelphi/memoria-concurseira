/** "Meus lembretes": a ordem da lista e o resumo, os mesmos do servidor (server/todos/todos.ts) para a tela acompanhar sem recarregar. */
import type { TodoItem } from '../types';
import { plural } from './performance';

/** O tamanho máximo de um lembrete (o mesmo do servidor). */
export const MAX_TODO_TEXT = 200;

/** Pendentes primeiro, na ordem em que foram escritos; depois os feitos, o último a ser feito primeiro. */
export function orderTodos(items: readonly TodoItem[]): TodoItem[] {
  const pending = items.filter((t) => !t.done).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = items.filter((t) => t.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return [...pending, ...done];
}

/** "2 pendentes", "1 pendente · 3 feitos", ou texto vazio sem lembretes. */
export function todoSummary(items: readonly TodoItem[]): string {
  const done = items.filter((t) => t.done).length;
  const pending = items.length - done;
  const parts: string[] = [];
  if (pending > 0) parts.push(plural(pending, 'pendente', 'pendentes'));
  if (done > 0) parts.push(plural(done, 'feito', 'feitos'));
  return parts.join(' · ');
}
