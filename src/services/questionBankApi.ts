import type {
  QbAttempt,
  QbAttemptResult,
  QbDraftMeta,
  QbDraftQuestion,
  QbExam,
  QbFacets,
  QbFilter,
  QbHistoryEntry,
  QbImportJob,
  QbNotebook,
  QbOrder,
  QbQuestion,
  QbSavedFilter,
  QbSearchResult,
  QbTotals,
} from '../types';
import { request } from './api';

export const questionBankApi = {
  // As opções de cada campo do filtro (só o que existe no banco do usuário) e os totais.
  overview: () => request<{ facets: QbFacets; totals: QbTotals }>('/question-bank/overview'),
  search: (body: { filter: QbFilter; page: number; pageSize: number; order: QbOrder }) =>
    request<QbSearchResult>('/question-bank/questions/search', { method: 'POST', body: JSON.stringify(body) }),
  question: (id: string) => request<{ question: QbQuestion; history: QbHistoryEntry[] }>(`/question-bank/questions/${id}`),
  updateQuestion: (id: string, patch: Record<string, unknown>) =>
    request<{ question: QbQuestion }>(`/question-bank/questions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeQuestion: (id: string) => request<{ success: true }>(`/question-bank/questions/${id}`, { method: 'DELETE' }),
  answer: (id: string, chosen: string, durationMs?: number) =>
    request<{ correct: boolean; answer: string; chosen: string }>(`/question-bank/questions/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ chosen, durationMs }),
    }),

  // Importar uma prova: o PDF sobe, a leitura segue no servidor e o andamento é consultado até terminar.
  startImport: (
    file: File,
    answerKey: { file: File | null; text: string },
    hints: { board: string; year: string; position: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (answerKey.file) form.append('answerKeyFile', answerKey.file);
    if (answerKey.text.trim()) form.append('answerKeyText', answerKey.text);
    form.append('board', hints.board);
    form.append('year', hints.year);
    form.append('position', hints.position);
    return request<{ job: QbImportJob }>('/question-bank/import', { method: 'POST', body: form });
  },
  importStatus: (jobId: string) => request<{ job: QbImportJob }>(`/question-bank/import/${jobId}`),
  saveExam: (body: QbDraftMeta & { questions: QbDraftQuestion[]; jobId?: string }) =>
    request<{ exam: QbExam }>('/question-bank/exams', { method: 'POST', body: JSON.stringify(body) }),

  exams: () => request<{ exams: QbExam[] }>('/question-bank/exams'),
  updateExam: (id: string, patch: Partial<QbDraftMeta>) =>
    request<{ exam: QbExam }>(`/question-bank/exams/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeExam: (id: string) => request<{ success: true }>(`/question-bank/exams/${id}`, { method: 'DELETE' }),

  // Com `questionId`, cada caderno diz se já tem essa questão.
  notebooks: (questionId?: string) =>
    request<{ notebooks: QbNotebook[] }>(`/question-bank/notebooks${questionId ? `?questionId=${encodeURIComponent(questionId)}` : ''}`),
  createNotebook: (body: {
    name: string;
    filter?: QbFilter;
    questionIds?: string[];
    limit?: number;
    shuffle?: boolean;
    order?: QbOrder;
  }) =>
    request<{ notebook: QbNotebook; added: number; skipped: number }>('/question-bank/notebooks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  notebook: (id: string) =>
    request<{ notebook: QbNotebook; questions: QbQuestion[]; attempts: QbAttempt[] }>(`/question-bank/notebooks/${id}`),
  renameNotebook: (id: string, name: string) =>
    request<{ notebook: QbNotebook }>(`/question-bank/notebooks/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  removeNotebook: (id: string) => request<{ success: true }>(`/question-bank/notebooks/${id}`, { method: 'DELETE' }),
  addToNotebook: (id: string, questionIds: string[]) =>
    request<{ added: number; alreadyInside: number }>(`/question-bank/notebooks/${id}/questions`, {
      method: 'POST',
      body: JSON.stringify({ questionIds }),
    }),
  removeFromNotebook: (id: string, questionId: string) =>
    request<{ success: true }>(`/question-bank/notebooks/${id}/questions/${questionId}`, { method: 'DELETE' }),
  finishSimulado: (id: string, durationMs: number, answers: { questionId: string; chosen: string }[]) =>
    request<{ attempt: QbAttempt; results: QbAttemptResult[] }>(`/question-bank/notebooks/${id}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ durationMs, answers }),
    }),

  savedFilters: () => request<{ filters: QbSavedFilter[] }>('/question-bank/filters'),
  saveFilter: (name: string, filter: QbFilter) =>
    request<{ filter: QbSavedFilter }>('/question-bank/filters', { method: 'POST', body: JSON.stringify({ name, filter }) }),
  removeFilter: (id: string) => request<{ success: true }>(`/question-bank/filters/${id}`, { method: 'DELETE' }),
};
