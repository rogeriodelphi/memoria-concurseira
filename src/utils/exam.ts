import type { ExamDetail, ExamDraft } from '../types';

export function emptyExamDraft(): ExamDraft {
  return { name: '', position: '', board: '', examDate: null, disciplines: [] };
}

/** Um concurso já salvo, no formato que o editor entende — com os ids, que são o que preserva os vínculos. */
export function examToDraft(detail: ExamDetail): ExamDraft {
  return {
    name: detail.exam.name,
    position: detail.exam.position,
    board: detail.exam.board,
    examDate: detail.exam.examDate,
    disciplines: detail.disciplines.map((d) => ({
      id: d.id,
      name: d.name,
      questionCount: d.questionCount,
      weight: d.weight,
      cutoff: d.cutoff,
      topics: d.topics.map((t) => ({ id: t.id, title: t.title })),
    })),
  };
}

/** AAAA-MM-DD → DD/MM/AAAA, sem passar por Date (que deslocaria o dia pelo fuso). */
export function formatExamDate(iso: string | null): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export function daysLeftLabel(daysLeft: number | null): string | null {
  if (daysLeft === null) return null;
  if (daysLeft === 0) return 'Prova hoje';
  if (daysLeft === 1) return 'Prova amanhã';
  if (daysLeft > 1) return `Prova em ${daysLeft} dias`;
  const ago = -daysLeft;
  return ago === 1 ? 'Prova foi ontem' : `Prova foi há ${ago} dias`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}
