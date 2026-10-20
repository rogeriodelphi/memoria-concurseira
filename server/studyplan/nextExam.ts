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

/**
 * O concurso que uma tela deve mostrar quando o usuário escolheu um (`requestedId`): o escolhido, se for do usuário e ainda
 * tiver data de hoje em diante; senão, o mais próximo (`nextExam`), como sempre foi. Um pedido que não vale (sem data, já
 * passou, de outra conta, texto qualquer) nunca é erro: cai no mais próximo, e a tela mostra qual concurso está valendo.
 */
export function chooseExam(db: DatabaseSync, userId: string, requestedId: unknown, now: Date): NextExam | null {
  if (typeof requestedId === 'string' && requestedId !== '') {
    const row = db.prepare('SELECT id, name, exam_date FROM exams WHERE id = ? AND user_id = ?').get(requestedId, userId) as unknown as
      | { id: string; name: string; exam_date: string | null }
      | undefined;
    if (row?.exam_date) {
      const daysLeft = daysUntil(row.exam_date, now);
      if (daysLeft !== null && daysLeft >= 0) return { id: row.id, name: row.name, examDate: row.exam_date, daysLeft };
    }
  }
  return nextExam(db, userId, now);
}

/** Um concurso como opção de um seletor: o nome, o cargo e quantos dias faltam. */
export interface ExamOption {
  id: string;
  name: string;
  /** O cargo; vazio se não foi informado. */
  position: string;
  /** AAAA-MM-DD, ou `null` se o concurso não tem data. */
  examDate: string | null;
  /** Dias até a prova (negativo se já passou); `null` sem data. */
  daysLeft: number | null;
}

/**
 * Os concursos do usuário para um seletor: primeiro os com prova de hoje em diante, do mais próximo ao mais distante; depois
 * (só com `includeUndated`) os sem data, do criado por último ao primeiro, e os que já passaram, do mais recente ao mais antigo.
 * Por padrão só entram os que uma tela de "prova" consegue usar (data de hoje em diante).
 */
export function listExamOptions(db: DatabaseSync, userId: string, now: Date, options: { includeUndated?: boolean } = {}): ExamOption[] {
  const rows = db
    .prepare('SELECT id, name, position, exam_date, created_at FROM exams WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(userId) as unknown as { id: string; name: string; position: string | null; exam_date: string | null; created_at: string }[];
  const all = rows.map((row, order) => ({
    order,
    option: {
      id: row.id,
      name: row.name,
      position: row.position ?? '',
      examDate: row.exam_date,
      daysLeft: row.exam_date ? daysUntil(row.exam_date, now) : null,
    } satisfies ExamOption,
  }));
  const rank = (o: ExamOption) => (o.daysLeft !== null && o.daysLeft >= 0 ? 0 : o.daysLeft === null ? 1 : 2);
  return all
    .filter((entry) => options.includeUndated || rank(entry.option) === 0)
    .sort((a, b) => {
      const ra = rank(a.option);
      const rb = rank(b.option);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return a.option.daysLeft! - b.option.daysLeft! || a.order - b.order;
      if (ra === 2) return b.option.daysLeft! - a.option.daysLeft! || a.order - b.order; // o que passou há menos tempo primeiro
      return a.order - b.order; // sem data: o criado por último primeiro
    })
    .map((entry) => entry.option);
}
