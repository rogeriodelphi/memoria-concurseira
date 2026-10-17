import type { DatabaseSync } from 'node:sqlite';

import { daysUntil } from '../exams/progress';

export interface NextExam {
  id: string;
  name: string;
  /** AAAA-MM-DD. */
  examDate: string;
  /** Dias do calendário até a prova (0 = hoje). */
  daysLeft: number;
}

/**
 * O concurso do usuário com a data mais próxima que ainda não passou (o de hoje conta); `null` se
 * nenhum tem data futura. É o concurso que a "Meta para a prova" e a ordem dos cartões novos
 * pelo edital usam.
 */
export function nextExam(db: DatabaseSync, userId: string, now: Date): NextExam | null {
  const rows = db
    .prepare('SELECT id, name, exam_date FROM exams WHERE user_id = ? AND exam_date IS NOT NULL')
    .all(userId) as unknown as { id: string; name: string; exam_date: string }[];
  let best: NextExam | null = null;
  for (const row of rows) {
    const daysLeft = daysUntil(row.exam_date, now);
    if (daysLeft === null || daysLeft < 0) continue;
    if (!best || daysLeft < best.daysLeft) best = { id: row.id, name: row.name, examDate: row.exam_date, daysLeft };
  }
  return best;
}
