/**
 * "Meus lembretes", no Painel: uma lista curta de coisas a não esquecer (inscrição de um concurso, pedir um documento,
 * baixar uma prova), que o usuário marca como feitas. É só dele e não tem relação com os cartões nem com o lembrete de
 * estudo por push (esse é outro assunto: server/reminders). Nada aqui altera um cartão ou a fila de revisão.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** O tamanho máximo de um lembrete e de quantos o usuário pode guardar (feitos ou não). */
export const MAX_TEXT = 200;
export const MAX_ITEMS = 200;

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  /** Quando foi marcado como feito; `null` enquanto pendente. */
  doneAt: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error });

interface TodoRow {
  id: string;
  text: string;
  done: number;
  created_at: string;
  done_at: string | null;
}

const toItem = (row: TodoRow): TodoItem => ({ id: row.id, text: row.text, done: row.done === 1, createdAt: row.created_at, doneAt: row.done_at });

/**
 * Os lembretes do usuário: os pendentes primeiro, na ordem em que foram escritos (o mais antigo em cima), e depois os
 * feitos, o último a ser feito primeiro.
 */
export function listTodos(db: DatabaseSync, userId: string): TodoItem[] {
  const rows = db
    .prepare('SELECT id, text, done, created_at, done_at FROM todo_items WHERE user_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(userId) as unknown as TodoRow[];
  const pending = rows.filter((r) => r.done === 0);
  const done = rows.filter((r) => r.done === 1).sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));
  return [...pending, ...done].map(toItem);
}

/** O texto de um lembrete: aparado e numa linha só; erro se não for texto, vier vazio ou passar do limite. */
export function parseText(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail(400, 'Escreva o lembrete.');
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return fail(400, 'Escreva o lembrete.');
  if (text.length > MAX_TEXT) return fail(400, `O lembrete pode ter até ${MAX_TEXT} caracteres.`);
  return { ok: true, value: text };
}

export function addTodo(db: DatabaseSync, userId: string, rawText: unknown, now: Date = new Date()): Result<{ todo: TodoItem }> {
  const text = parseText(rawText);
  if (!text.ok) return text;
  const count = (db.prepare('SELECT COUNT(*) AS n FROM todo_items WHERE user_id = ?').get(userId) as unknown as { n: number }).n;
  if (count >= MAX_ITEMS) return fail(400, `Você já tem ${MAX_ITEMS} lembretes. Apague alguns para escrever outro.`);
  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  db.prepare('INSERT INTO todo_items (id, user_id, text, done, created_at, done_at) VALUES (?, ?, ?, 0, ?, NULL)').run(id, userId, text.value, createdAt);
  return { ok: true, value: { todo: { id, text: text.value, done: false, createdAt, doneAt: null } } };
}

/** Marca o lembrete como feito (ou volta a pendente). `done` precisa ser verdadeiro ou falso. */
export function setDone(db: DatabaseSync, userId: string, id: string, done: unknown, now: Date = new Date()): Result<{ todo: TodoItem }> {
  if (typeof done !== 'boolean') return fail(400, 'Diga se o lembrete está feito ou não.');
  const existing = db.prepare('SELECT id FROM todo_items WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) return fail(404, 'Lembrete não encontrado.');
  db.prepare('UPDATE todo_items SET done = ?, done_at = ? WHERE id = ? AND user_id = ?').run(done ? 1 : 0, done ? now.toISOString() : null, id, userId);
  const row = db.prepare('SELECT id, text, done, created_at, done_at FROM todo_items WHERE id = ?').get(id) as unknown as TodoRow;
  return { ok: true, value: { todo: toItem(row) } };
}

export function removeTodo(db: DatabaseSync, userId: string, id: string): Result<Record<string, never>> {
  const removed = db.prepare('DELETE FROM todo_items WHERE id = ? AND user_id = ?').run(id, userId);
  if (Number(removed.changes) === 0) return fail(404, 'Lembrete não encontrado.');
  return { ok: true, value: {} };
}

/** Apaga de uma vez os lembretes já feitos (os pendentes ficam). */
export function clearDone(db: DatabaseSync, userId: string): Result<{ removed: number }> {
  const removed = db.prepare('DELETE FROM todo_items WHERE user_id = ? AND done = 1').run(userId);
  return { ok: true, value: { removed: Number(removed.changes) } };
}
