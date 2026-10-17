import type { DatabaseSync } from 'node:sqlite';

import {
  addCards,
  createMockExam,
  fail,
  listMockExams,
  MAX_CARDS_PER_REQUEST,
  MAX_NAME_CHARS,
  ok,
  type MockExamSummary,
  type Result,
} from './store';

export interface DisciplineMockExam {
  mockExam: MockExamSummary;
  /** Cartões que entraram agora (os que já estavam na lista não contam). */
  added: number;
  /** Era um simulado novo, e não um que já existia e foi atualizado. */
  created: boolean;
}

/** "Redes de Computadores — TRT-4 2026": a disciplina primeiro, para os simulados de um concurso ficarem agrupados por matéria na lista. */
export function disciplineMockExamName(disciplineName: string, examName: string): string {
  const name = `${disciplineName.replace(/\s+/g, ' ').trim()} — ${examName.replace(/\s+/g, ' ').trim()}`;
  return name.length <= MAX_NAME_CHARS ? name : `${name.slice(0, MAX_NAME_CHARS - 1).trimEnd()}…`;
}

/**
 * Cria o simulado de uma disciplina do concurso com os cartões de todas as coleções ligadas aos
 * tópicos dela. É idempotente: chamar de novo (depois de ligar mais coleções, por exemplo) atualiza o
 * mesmo simulado, acrescentando só os cartões que faltam. Nunca remove cartões. Um cartão que o
 * usuário tirou à mão volta na próxima atualização, enquanto sua coleção seguir ligada à disciplina.
 */
export function mockExamFromDiscipline(
  db: DatabaseSync,
  userId: string,
  examId: string,
  disciplineId: string,
): Result<DisciplineMockExam> {
  const exam = db.prepare('SELECT name FROM exams WHERE id = ? AND user_id = ?').get(examId, userId) as unknown as
    | { name: string }
    | undefined;
  if (!exam) return fail(404, 'Concurso não encontrado.');

  const discipline = db
    .prepare('SELECT name FROM exam_disciplines WHERE id = ? AND exam_id = ?')
    .get(disciplineId, examId) as unknown as { name: string } | undefined;
  if (!discipline) return fail(404, 'Disciplina não encontrada.');

  const flashcardIds = (
    db
      .prepare(
        `SELECT DISTINCT f.id
         FROM exam_topics t
         JOIN exam_topic_collections l ON l.topic_id = t.id
         JOIN collections c ON c.id = l.collection_id AND c.user_id = ?
         JOIN flashcards f ON f.collection_id = c.id
         WHERE t.discipline_id = ?
         ORDER BY c.name COLLATE NOCASE, f.rowid`,
      )
      .all(userId, disciplineId) as unknown as { id: string }[]
  ).map((r) => r.id);
  if (flashcardIds.length === 0) {
    return fail(400, 'Nenhuma coleção com cartões está ligada aos tópicos desta disciplina.');
  }

  const name = disciplineMockExamName(discipline.name, exam.name);
  const existing = db
    .prepare('SELECT id FROM mock_exams WHERE user_id = ? AND name = ? COLLATE NOCASE')
    .get(userId, name) as unknown as { id: string } | undefined;

  let mockExamId: string;
  let created = false;
  if (existing) {
    mockExamId = existing.id;
  } else {
    const made = createMockExam(db, userId, name);
    if (!made.ok) return made;
    mockExamId = made.value.id;
    created = true;
  }

  let added = 0;
  for (let i = 0; i < flashcardIds.length; i += MAX_CARDS_PER_REQUEST) {
    const result = addCards(db, userId, mockExamId, flashcardIds.slice(i, i + MAX_CARDS_PER_REQUEST));
    if (!result.ok) return result;
    added += result.value.added;
  }

  const mockExam = listMockExams(db, userId).find((m) => m.id === mockExamId);
  if (!mockExam) return fail(404, 'Simulado não encontrado.');
  return ok({ mockExam, added, created });
}
