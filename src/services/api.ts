import type {
  AiDraft,
  AiDraftGroup,
  DraftVerdict,
  AiUsage,
  AnkiImportPreview,
  AnkiImportResult,
  AttemptMode,
  BulletPoints,
  ChoiceQuestion,
  CollectionDetail,
  CollectionStats,
  CollectionSummary,
  DashboardData,
  DisciplineMockExam,
  DocumentItem,
  DueFlashcard,
  ExamPlan,
  NewCardOrder,
  NewOrderOverview,
  DuplicateGroup,
  ExamDetail,
  ExamDraft,
  ExamSummary,
  Flashcard,
  GenerationOptions,
  LeechList,
  MindMapDetail,
  MindMapSummary,
  MockExamAnswer,
  MockExamAttempt,
  MockExamDetail,
  MockExamSummary,
  PomodoroMode,
  PomodoroTask,
  SearchResults,
  PerformanceData,
  PerformanceQuery,
  StatsData,
  StudyTimeData,
  StudyResult,
  TtsInfo,
  Summary,
  SummaryMode,
  User,
} from '../types';

class ApiError extends Error {
  /** Só a leitura em voz alta preenche: por que falhou e, se for cota, em quantos segundos volta. */
  reason?: 'quota' | 'overloaded' | 'other';
  retryAfterSeconds?: number;
}

export const AI_USAGE_EVENT = 'ai-usage-changed';

// Toda rota que dispara uma chamada de IA (gerar flashcards, resumo, mapa,
// bullet points, transcrever) — depois dela o contador de tokens mudou, então
// quem mostra o uso escuta o evento e recarrega. Também dispara em caso de
// erro, porque uma falha pode ter mudado o status do provedor (ex.: sem crédito).
const AI_GENERATION_PATH = /\/documents\/|\/generate|\/transcribe\/|\/exams\/extract|\/exams\/[^/]+\/topics\/[^/]+\/cards|\/mock-exams\/[^/]+\/choices|\/question-bank\/import/;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      ...init,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      throw new ApiError(data?.error ?? 'Algo deu errado. Tente novamente.');
    }
    return data as T;
  } finally {
    if (init?.method === 'POST' && AI_GENERATION_PATH.test(path)) {
      window.dispatchEvent(new Event(AI_USAGE_EVENT));
    }
  }
}

export { ApiError };

export const authApi = {
  register: (name: string, email: string, password: string) =>
    request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ success: true }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),
  updateProfile: (name: string, email: string) =>
    request<{ user: User }>('/auth/me', {
      method: 'PUT',
      body: JSON.stringify({ name, email }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: true }>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

export const collectionsApi = {
  list: () => request<{ collections: CollectionSummary[] }>('/collections'),
  create: (input: { name: string; subject: string; description: string; category: string }) =>
    request<{ collection: CollectionSummary }>('/collections', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  get: (id: string) =>
    request<{ collection: CollectionDetail; documents: DocumentItem[]; flashcards: Flashcard[] }>(
      `/collections/${id}`,
    ),
  update: (id: string, input: { name?: string; subject?: string; description?: string; category?: string }) =>
    request<{ collection: CollectionSummary }>(`/collections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => request<{ success: true }>(`/collections/${id}`, { method: 'DELETE' }),
  stats: (id: string) => request<CollectionStats>(`/collections/${id}/stats`),
};

type GenerationResult = { document: DocumentItem; flashcards: Flashcard[] };

export const documentsApi = {
  fromFile: (collectionId: string, file: File, options: GenerationOptions) => {
    const form = new FormData();
    form.append('file', file);
    form.append('quantity', String(options.quantity));
    form.append('difficulty', options.difficulty);
    form.append('cardType', options.cardType);
    form.append('depth', options.depth);
    form.append('focus', options.focus);
    return request<GenerationResult>(`/collections/${collectionId}/documents/file`, {
      method: 'POST',
      body: form,
    });
  },
  fromTopic: (collectionId: string, topic: string, options: GenerationOptions) =>
    request<GenerationResult>(`/collections/${collectionId}/documents/topic`, {
      method: 'POST',
      body: JSON.stringify({ topic, ...options }),
    }),
  fromText: (collectionId: string, text: string, options: GenerationOptions) =>
    request<GenerationResult>(`/collections/${collectionId}/documents/text`, {
      method: 'POST',
      body: JSON.stringify({ text, ...options }),
    }),
  fromYoutube: (collectionId: string, url: string, options: GenerationOptions) =>
    request<GenerationResult>(`/collections/${collectionId}/documents/youtube`, {
      method: 'POST',
      body: JSON.stringify({ url, ...options }),
    }),
};

export const transcribeApi = {
  fromFile: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ text: string }>('/transcribe/file', { method: 'POST', body: form });
  },
  fromYoutube: (url: string) =>
    request<{ text: string }>('/transcribe/youtube', { method: 'POST', body: JSON.stringify({ url }) }),
};

export const flashcardsApi = {
  create: (collectionId: string, input: { question: string; answer: string; difficulty: string }) =>
    request<{ flashcard: Flashcard }>('/flashcards', {
      method: 'POST',
      body: JSON.stringify({ collectionId, ...input }),
    }),
  update: (
    id: string,
    input: { question?: string; answer?: string; format?: string; difficulty?: string; favorite?: boolean },
  ) =>
    request<{ flashcard: Flashcard }>(`/flashcards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => request<{ success: true }>(`/flashcards/${id}`, { method: 'DELETE' }),
  favorites: () => request<{ flashcards: DueFlashcard[] }>('/flashcards/favorites'),
  study: (id: string, result: StudyResult, durationMs?: number) =>
    request<{ success: true; dueAt: string; sessionId: string }>(`/flashcards/${id}/study`, {
      method: 'POST',
      body: JSON.stringify({ result, durationMs }),
    }),
  // Desfaz a avaliação cujo `sessionId` o `study` devolveu (o cartão volta ao agendamento de antes).
  undoStudy: (id: string, sessionId: string) =>
    request<{ success: true }>(`/flashcards/${id}/study/undo`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  // `waitingNew`: novos que ficaram de fora da fila por causa do limite diário (0 sem limite).
  due: () => request<{ flashcards: DueFlashcard[]; waitingNew: number }>('/flashcards/due'),
  // Só os pendentes das coleções dadas (estudar uma disciplina inteira), sem o limite diário de novos.
  dueForCollections: (collectionIds: string[]) =>
    request<{ flashcards: DueFlashcard[]; waitingNew: number }>(
      `/flashcards/due?collectionIds=${encodeURIComponent(collectionIds.join(','))}`,
    ),
  // Os cartões que o usuário errou (Errei ou Difícil) nas coleções, num período (AAAA-MM-DD, os dois inclusive), vencidos ou não.
  missed: (collectionIds: string[], from: string, to: string) =>
    request<{ flashcards: DueFlashcard[] }>(
      `/flashcards/missed?collectionIds=${encodeURIComponent(collectionIds.join(','))}&from=${from}&to=${to}`,
    ),
  copyToCollection: (flashcardIds: string[], targetCollectionId: string, mode: 'copy' | 'move' = 'copy') =>
    request<{ flashcards: Flashcard[]; count: number; skippedDuplicates: number }>('/flashcards/copy', {
      method: 'POST',
      body: JSON.stringify({ flashcardIds, targetCollectionId, mode }),
    }),
  findDuplicates: () => request<{ groups: DuplicateGroup[]; totalDuplicates: number }>('/flashcards/duplicates'),
};

// Cartões sanguessuga: os que o usuário erra sempre, e o que dá para fazer com eles.
export const leechesApi = {
  list: (minErrors?: number) => request<LeechList>(`/leeches${minErrors ? `?minErrors=${minErrors}` : ''}`),
  // Recomeça a contagem de erros do cartão (só os erros de depois valem).
  reset: (id: string) => request<{ resetAt: string }>(`/leeches/${id}/reset`, { method: 'POST' }),
  // Adia a revisão por 7, 14 ou 30 dias.
  snooze: (id: string, days: 7 | 14 | 30) =>
    request<{ dueAt: string }>(`/leeches/${id}/snooze`, { method: 'POST', body: JSON.stringify({ days }) }),
  // Quebra o cartão em vários menores; apaga o original, ou o mantém (recomeçando a contagem) com `keepOriginal`.
  split: (id: string, input: { cards: { question: string; answer: string }[]; keepOriginal: boolean }) =>
    request<{ created: Flashcard[]; originalDeleted: boolean }>(`/leeches/${id}/split`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

export const ttsApi = {
  voices: () => request<TtsInfo>('/tts/voices'),
  // Devolve o áudio (WAV), não JSON, então não passa pelo `request`. O servidor
  // pode levar alguns segundos na primeira vez e a leitura não deve ficar
  // pendurada à espera: passado o prazo, quem chamou cai na voz do navegador.
  // O prazo cresce com o texto: gerar uma lista inteira leva bem mais que um cartão,
  // e abandonar no meio jogaria fora um áudio que o servidor ainda ia guardar.
  synthesize: async (
    text: string,
    voice: string,
    timeoutMs = 25_000 + Math.min(text.length, 6000) * 25,
  ): Promise<Blob> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const failure = new ApiError(data?.error ?? 'Não foi possível gerar a voz.');
        failure.reason = data?.reason === 'quota' || data?.reason === 'overloaded' ? data.reason : 'other';
        if (typeof data?.retryAfterSeconds === 'number') failure.retryAfterSeconds = data.retryAfterSeconds;
        throw failure;
      }
      return await res.blob();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw new ApiError('A voz natural demorou demais.');
      throw err;
    } finally {
      clearTimeout(timer);
      // gerar a voz gasta tokens do Gemini (quando não estava guardada): o contador de uso muda
      window.dispatchEvent(new Event(AI_USAGE_EVENT));
    }
  },
};

export const examsApi = {
  list: () => request<{ exams: ExamSummary[] }>('/exams'),
  get: (id: string) => request<ExamDetail>(`/exams/${id}`),
  create: (draft: ExamDraft) => request<{ id: string }>('/exams', { method: 'POST', body: JSON.stringify(draft) }),
  update: (id: string, draft: ExamDraft) =>
    request<{ success: true }>(`/exams/${id}`, { method: 'PUT', body: JSON.stringify(draft) }),
  remove: (id: string) => request<{ success: true }>(`/exams/${id}`, { method: 'DELETE' }),
  extractFromText: (text: string, position: string) =>
    request<{ draft: ExamDraft }>('/exams/extract/text', { method: 'POST', body: JSON.stringify({ text, position }) }),
  extractFromFile: (file: File, position: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('position', position);
    return request<{ draft: ExamDraft }>('/exams/extract/file', { method: 'POST', body: form });
  },
  setTopicCollections: (examId: string, topicId: string, collectionIds: string[]) =>
    request<{ success: true }>(`/exams/${examId}/topics/${topicId}/collections`, {
      method: 'PUT',
      body: JSON.stringify({ collectionIds }),
    }),
  // Cria o simulado da disciplina com os cartões das coleções ligadas aos tópicos (ou o atualiza).
  createDisciplineMockExam: (examId: string, disciplineId: string) =>
    request<DisciplineMockExam>(`/exams/${examId}/disciplines/${disciplineId}/mock-exam`, { method: 'POST' }),
  addLinks: (examId: string, links: { topicId: string; collectionIds: string[] }[]) =>
    request<{ added: number }>(`/exams/${examId}/links`, { method: 'POST', body: JSON.stringify({ links }) }),
  // Pede à IA os cartões de um tópico sem material: cria uma coleção nova, já ligada ao tópico.
  generateTopicCards: (examId: string, topicId: string, quantity?: number) =>
    request<{ collection: { id: string; name: string; subject: string }; added: number }>(
      `/exams/${examId}/topics/${topicId}/cards`,
      { method: 'POST', body: JSON.stringify(quantity === undefined ? {} : { quantity }) },
    ),
};

/** Os parâmetros do período, do escopo e dos filtros do Meu desempenho (os mesmos nas duas chamadas). */
function performanceParams(q: PerformanceQuery): string {
  const params = new URLSearchParams();
  if (q.range) {
    params.set('from', q.range.from);
    params.set('to', q.range.to);
  } else {
    params.set('days', String(q.days));
  }
  if (q.scope === 'exam') params.set('scope', 'exam');
  if (q.name) params.set('name', q.name);
  if (q.subject) params.set('subject', q.subject);
  return params.toString();
}

export const statsApi = {
  get: () => request<StatsData>('/stats'),
  dashboard: () => request<DashboardData>('/stats/dashboard'),
  // "Meu desempenho": o estudado num período por nome de coleção e por assunto, com filtros.
  performance: (q: PerformanceQuery) => request<PerformanceData>(`/stats/performance?${performanceParams(q)}`),
  // O tempo de estudo (Pomodoro e cartões) do mesmo período e filtros, por nome e por disciplina do edital.
  studyTime: (q: PerformanceQuery) => request<StudyTimeData>(`/stats/study-time?${performanceParams(q)}`),
};

// O plano de estudo: hoje, o limite diário de cartões novos na fila de revisão (`null` = sem limite).
export const studyPlanApi = {
  get: () => request<{ dailyNewLimit: number | null }>('/study-plan'),
  // A meta para a prova do concurso com data mais próxima (`null` se não há nenhum com data).
  exam: () => request<{ plan: ExamPlan | null }>('/study-plan/exam'),
  setDailyNewLimit: (dailyNewLimit: number | null) =>
    request<{ dailyNewLimit: number | null }>('/study-plan', { method: 'PUT', body: JSON.stringify({ dailyNewLimit }) }),
  // A ordem dos cartões novos (criação ou pelo peso das disciplinas do edital) e como ela reparte os cartões.
  newOrder: () => request<NewOrderOverview>('/study-plan/new-order'),
  setNewOrder: (order: NewCardOrder) =>
    request<{ order: NewCardOrder }>('/study-plan/new-order', { method: 'PUT', body: JSON.stringify({ order }) }),
};

// Lembrete diário de estudo no celular (notificação push): a hora, os aparelhos inscritos e o teste.
export const remindersApi = {
  get: () => request<{ publicKey: string; time: string | null; devices: number }>('/reminders'),
  setTime: (time: string | null) => request<{ time: string | null }>('/reminders', { method: 'PUT', body: JSON.stringify({ time }) }),
  subscribe: (subscription: PushSubscriptionJSON) =>
    request<{ devices: number }>('/reminders/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) }),
  unsubscribe: (endpoint: string) =>
    request<{ devices: number }>('/reminders/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  test: () => request<{ delivered: number }>('/reminders/test', { method: 'POST' }),
};

// Cartões gerados por IA (sem texto-fonte) que esperam a conferência antes de entrar na revisão.
export const aiReviewApi = {
  list: () => request<{ groups: AiDraftGroup[]; total: number }>('/ai-review'),
  count: () => request<{ pending: number }>('/ai-review/count'),
  edit: (id: string, patch: { question?: string; answer?: string }) =>
    request<{ draft: AiDraft }>(`/ai-review/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  // Aprova (vira cartão de estudo) os ids escolhidos, ou todos os de uma coleção.
  approve: (target: { ids: string[] } | { collectionId: string }) =>
    request<{ approved: number; duplicates: number; pending: number }>('/ai-review/approve', { method: 'POST', body: JSON.stringify(target) }),
  discard: (target: { ids: string[] } | { collectionId: string }) =>
    request<{ discarded: number; pending: number }>('/ai-review/discard', { method: 'POST', body: JSON.stringify(target) }),
  // A segunda opinião de outra IA (só um alerta: não aprova nem descarta). Pode parar no meio: vem o que foi feito e o erro.
  check: (target: { ids: string[] } | { collectionId: string }) =>
    request<{ checked: number; unchecked: number; counts: Record<DraftVerdict, number>; error: string | null }>('/ai-review/check', { method: 'POST', body: JSON.stringify(target) }),
};

export const pomodoroApi = {
  logTask: (input: {
    mode: PomodoroMode;
    phase: string;
    discipline: string;
    subject: string;
    durationSec: number;
    startedAt: string;
    endedAt: string;
  }) => request<{ task: PomodoroTask }>('/pomodoro/tasks', { method: 'POST', body: JSON.stringify(input) }),
  listTasks: (from: string, to: string) =>
    request<{ tasks: PomodoroTask[] }>(`/pomodoro/tasks?from=${from}&to=${to}`),
  removeTask: (id: string) => request<{ success: true }>(`/pomodoro/tasks/${id}`, { method: 'DELETE' }),
  // O que sugerir nos campos Disciplina e Assunto (disciplinas dos concursos e nomes/assuntos das coleções).
  suggestions: () => request<{ disciplines: string[]; subjects: string[] }>('/pomodoro/suggestions'),
  getNote: (date: string) => request<{ date: string; text: string }>(`/pomodoro/notes?date=${date}`),
  saveNote: (date: string, text: string) =>
    request<{ date: string; text: string }>('/pomodoro/notes', {
      method: 'PUT',
      body: JSON.stringify({ date, text }),
    }),
};

export const mindMapsApi = {
  list: () => request<{ mindMaps: MindMapSummary[] }>('/mindmaps'),
  get: (id: string) => request<{ mindMap: MindMapDetail }>(`/mindmaps/${id}`),
  remove: (id: string) => request<{ success: true }>(`/mindmaps/${id}`, { method: 'DELETE' }),
  rename: (id: string, title: string) =>
    request<{ mindMap: MindMapDetail }>(`/mindmaps/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  fromTopic: (topic: string, title?: string) =>
    request<{ mindMap: MindMapDetail }>('/mindmaps/generate/topic', {
      method: 'POST',
      body: JSON.stringify({ topic, title }),
    }),
  fromText: (text: string, title?: string) =>
    request<{ mindMap: MindMapDetail }>('/mindmaps/generate/text', {
      method: 'POST',
      body: JSON.stringify({ text, title }),
    }),
  fromYoutube: (url: string, title?: string) =>
    request<{ mindMap: MindMapDetail }>('/mindmaps/generate/youtube', {
      method: 'POST',
      body: JSON.stringify({ url, title }),
    }),
  fromFile: (file: File, title?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    return request<{ mindMap: MindMapDetail }>('/mindmaps/generate/file', { method: 'POST', body: form });
  },
};

export const summariesApi = {
  list: () => request<{ summaries: Summary[] }>('/summaries'),
  generate: (text: string, mode: SummaryMode) =>
    request<{ summary: Summary }>('/summaries/generate', {
      method: 'POST',
      body: JSON.stringify({ text, mode }),
    }),
  update: (id: string, input: { title: string; content: string; format: 'plain' | 'html' }) =>
    request<{ summary: Summary }>(`/summaries/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: string) => request<{ success: true }>(`/summaries/${id}`, { method: 'DELETE' }),
};

export const bulletPointsApi = {
  list: () => request<{ bulletPoints: BulletPoints[] }>('/bulletpoints'),
  generate: (text: string) =>
    request<{ bulletPoints: BulletPoints }>('/bulletpoints/generate', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  remove: (id: string) => request<{ success: true }>(`/bulletpoints/${id}`, { method: 'DELETE' }),
};

export const ankiImportApi = {
  preview: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<AnkiImportPreview>('/anki-import/preview', { method: 'POST', body: form });
  },
  import: (file: File, target: { collectionId: string } | { newCollectionName: string }) => {
    const form = new FormData();
    form.append('file', file);
    if ('collectionId' in target) form.append('collectionId', target.collectionId);
    else form.append('newCollectionName', target.newCollectionName);
    return request<AnkiImportResult>('/anki-import/import', { method: 'POST', body: form });
  },
};

export const aiUsageApi = {
  get: () => request<AiUsage>('/ai-usage'),
  setBudget: async (monthlyTokenBudget: number | null) => {
    const result = await request<{ budget: number | null }>('/ai-usage/budget', {
      method: 'PUT',
      body: JSON.stringify({ monthlyTokenBudget }),
    });
    // O menu lateral e o painel de Configurações mostram o "restante" —
    // ambos precisam recarregar quando o orçamento muda.
    window.dispatchEvent(new Event(AI_USAGE_EVENT));
    return result;
  },
};

export const searchApi = {
  search: (q: string) => request<SearchResults>(`/search?q=${encodeURIComponent(q)}`),
};

async function downloadExport(path: string, filename: string, collectionId: string, flashcardIds?: string[]) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId, flashcardIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data?.error ?? 'Não foi possível exportar.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportAnki(collectionId: string, name: string, flashcardIds?: string[]) {
  return downloadExport('/exports/anki', `${name}.apkg`, collectionId, flashcardIds);
}

export function exportPdf(collectionId: string, name: string, flashcardIds?: string[]) {
  return downloadExport('/exports/pdf', `${name}.pdf`, collectionId, flashcardIds);
}

/** Baixa todos os dados da conta num arquivo JSON. Devolve o nome e o tamanho, para a tela avisar. */
export async function exportAccountData(): Promise<{ filename: string; bytes: number }> {
  const res = await fetch('/api/exports/account', { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data?.error ?? 'Não foi possível exportar os seus dados.');
  }
  const blob = await res.blob();
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'memoria-concurseira.json';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { filename, bytes: blob.size };
}

export const mockExamsApi = {
  // Com `flashcardId`, cada simulado diz se já tem esse cartão (o seletor "Adicionar ao simulado").
  list: (flashcardId?: string) =>
    request<{ mockExams: MockExamSummary[] }>(
      `/mock-exams${flashcardId ? `?flashcardId=${encodeURIComponent(flashcardId)}` : ''}`,
    ),
  create: (name: string) =>
    request<{ mockExam: MockExamSummary }>('/mock-exams', { method: 'POST', body: JSON.stringify({ name }) }),
  get: (id: string) => request<{ mockExam: MockExamDetail }>(`/mock-exams/${id}`),
  rename: (id: string, name: string) =>
    request<{ mockExam: MockExamSummary }>(`/mock-exams/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  remove: (id: string) => request<{ success: true }>(`/mock-exams/${id}`, { method: 'DELETE' }),
  addCards: (id: string, flashcardIds: string[]) =>
    request<{ added: number; alreadyInside: number }>(`/mock-exams/${id}/cards`, {
      method: 'POST',
      body: JSON.stringify({ flashcardIds }),
    }),
  removeCard: (id: string, flashcardId: string) =>
    request<{ success: true }>(`/mock-exams/${id}/cards/${flashcardId}`, { method: 'DELETE' }),
  recordAttempt: (id: string, durationMs: number, answers: MockExamAnswer[], mode: AttemptMode = 'self') =>
    request<{ attempt: MockExamAttempt }>(`/mock-exams/${id}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ durationMs, answers, mode }),
    }),
  // As alternativas de múltipla escolha já guardadas e quais cartões ainda não têm.
  choices: (id: string) =>
    request<{ questions: ChoiceQuestion[]; missing: string[] }>(`/mock-exams/${id}/choices`),
  // Gera (com IA) as alternativas de um lote pequeno de cartões e as guarda.
  prepareChoices: (id: string, flashcardIds: string[]) =>
    request<{ questions: ChoiceQuestion[]; failed: string[] }>(`/mock-exams/${id}/choices`, {
      method: 'POST',
      body: JSON.stringify({ flashcardIds }),
    }),
};
