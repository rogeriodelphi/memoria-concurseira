/**
 * Sugestões para os campos "Disciplina" e "Assunto" do Pomodoro. O tempo registrado só se liga aos cartões e ao
 * edital no Meu desempenho se o texto digitado casar com um nome que já existe (sem diferenciar maiúsculas e
 * acentos): sugerir esses nomes é o jeito de acertar sem obrigar ninguém a escolher de uma lista.
 */
import type { DatabaseSync } from 'node:sqlite';

/** Quantas sugestões cada campo oferece, no máximo. */
export const MAX_SUGGESTIONS = 200;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const key = (text: string) => squash(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Sem repetir (nem por maiúsculas/acentos; fica a primeira grafia), sem vazios, em ordem alfabética, no máximo `max`. */
export function distinctSorted(values: string[], max: number = MAX_SUGGESTIONS): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const text = squash(value);
    if (text && !seen.has(key(text))) seen.set(key(text), text);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, max);
}

export function pomodoroSuggestions(db: DatabaseSync, userId: string): { disciplines: string[]; subjects: string[] } {
  const rows = (sql: string) => (db.prepare(sql).all(userId) as unknown as { v: string }[]).map((r) => r.v);
  return {
    disciplines: distinctSorted([
      // as disciplinas dos concursos primeiro na busca por empate de grafia: entram antes dos nomes de coleção
      ...rows('SELECT d.name AS v FROM exam_disciplines d JOIN exams e ON e.id = d.exam_id WHERE e.user_id = ? ORDER BY e.created_at DESC, d.position'),
      ...rows('SELECT name AS v FROM collections WHERE user_id = ?'),
    ]),
    subjects: distinctSorted(rows("SELECT subject AS v FROM collections WHERE user_id = ? AND subject != ''")),
  };
}
