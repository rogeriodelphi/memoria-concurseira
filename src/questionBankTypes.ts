// Banco de questões (provas anteriores importadas de PDF). Reexportado por ./types.

export interface QbAlternative {
  letter: string;
  text: string;
}

export interface QbLastAnswer {
  chosen: string;
  correct: boolean;
  answeredAt: string;
}

export interface QbQuestion {
  id: string;
  examId: string;
  examName: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: string;
  number: number;
  support: string;
  statement: string;
  alternatives: QbAlternative[];
  discipline: string;
  subject: string;
  needsFigure: boolean;
  /** O texto lido pela IA não bateu com o do PDF na importação. */
  suspect: boolean;
  annulled: boolean;
  /** Tem gabarito e não foi anulada: só então dá para responder e corrigir. */
  gradable: boolean;
  note: string;
  mine: QbLastAnswer | null;
  /** A alternativa certa: o servidor só a manda depois que a questão foi respondida (ou ao editá-la). */
  answer?: string;
  timesAnswered: number;
  timesCorrect: number;
  notebookCount: number;
}

export type QbStatus = 'resolvidas' | 'nao_resolvidas' | 'acertei' | 'errei';
export type QbOrder = 'prova' | 'importacao' | 'disciplina';

export interface QbFilter {
  status: QbStatus[];
  q: string;
  discipline: string[];
  subject: string[];
  board: string[];
  organ: string[];
  year: number[];
  position: string[];
  level: string[];
  exam: string[];
  notebook: string;
  excludeInNotebooks: boolean;
  excludeAnnulled: boolean;
  excludeNoAnswer: boolean;
  onlyWithNote: boolean;
}

export interface QbFacetOption {
  value: string;
  count: number;
}

export interface QbFacets {
  discipline: QbFacetOption[];
  subject: (QbFacetOption & { discipline: string })[];
  board: QbFacetOption[];
  organ: QbFacetOption[];
  year: QbFacetOption[];
  position: QbFacetOption[];
  level: QbFacetOption[];
  exam: (QbFacetOption & { id: string })[];
}

export interface QbTotals {
  questions: number;
  exams: number;
  answered: number;
  correct: number;
  annulled: number;
  withoutAnswer: number;
}

export interface QbSearchResult {
  questions: QbQuestion[];
  total: number;
  page: number;
  pageSize: number;
}

export interface QbExam {
  id: string;
  name: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: string;
  questionCount: number;
  withAnswerCount: number;
  answeredCount: number;
  correctCount: number;
  createdAt: string;
}

export interface QbHistoryEntry {
  chosen: string;
  correct: boolean;
  answeredAt: string;
  durationMs: number | null;
  inSimulado: boolean;
}

export interface QbAttempt {
  id: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  correct: number;
}

export interface QbNotebook {
  id: string;
  name: string;
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  attemptCount: number;
  lastAttempt: QbAttempt | null;
  containsQuestion?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QbAttemptResult {
  questionId: string;
  chosen: string;
  correct: boolean;
  answer: string;
}

export interface QbSavedFilter {
  id: string;
  name: string;
  filter: QbFilter;
  createdAt: string;
}

export interface QbDraftQuestion {
  number: number;
  support: string;
  statement: string;
  alternatives: QbAlternative[];
  /** A letra do gabarito; vazio = sem gabarito. */
  answer: string;
  annulled: boolean;
  discipline: string;
  subject: string;
  needsFigure: boolean;
  suspect: boolean;
}

export interface QbDraftMeta {
  name: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: string;
}

export interface QbDraft {
  meta: QbDraftMeta;
  questions: QbDraftQuestion[];
  warnings: string[];
}

export interface QbImportJob {
  id: string;
  status: 'running' | 'done' | 'error';
  progress: { stage: string; done: number; total: number };
  draft?: QbDraft;
  error?: string;
}

// ---------- simulados contra a nota de corte ----------

export type QbCutoffStatus = 'above' | 'below' | 'unknown';
export type QbTrend = 'up' | 'down' | 'flat';

export interface QbExamChoice {
  id: string;
  name: string;
  disciplines: number;
  withCutoff: number;
}

export interface QbDisciplineResult {
  label: string;
  total: number;
  correct: number;
  pct: number;
  examDisciplineId: string | null;
  questionCount: number | null;
  weight: number | null;
  cutoffText: string;
  cutoffPct: number | null;
  status: QbCutoffStatus;
  margin: number | null;
  missing: number | null;
  lowSample: boolean;
  /** Os nomes de disciplina que as questões tinham (para o atalho "ver as que errei"). */
  sourceLabels: string[];
}

export interface QbComparison {
  disciplines: QbDisciplineResult[];
  unmatched: QbDisciplineResult[];
  notCovered: { id: string; name: string; cutoffText: string; cutoffPct: number | null }[];
  estimatedPct: number | null;
  verdict: QbCutoffStatus;
}

export interface QbAttemptCutoff {
  attempt: { id: string; finishedAt: string; durationMs: number; total: number; correct: number; notebookName: string };
  exam: { id: string; name: string } | null;
  exams: QbExamChoice[];
  hasBreakdown: boolean;
  comparison: QbComparison | null;
}

export interface QbSeriesPoint {
  attemptId: string;
  finishedAt: string;
  total: number;
  correct: number;
  pct: number;
}

export interface QbOverviewDiscipline {
  id: string;
  name: string;
  questionCount: number | null;
  weight: number | null;
  cutoffText: string;
  cutoffPct: number | null;
  series: QbSeriesPoint[];
  recentCorrect: number;
  recentTotal: number;
  recentPct: number | null;
  trend: QbTrend | null;
  status: QbCutoffStatus;
  margin: number | null;
  lowSample: boolean;
}

export interface QbAttemptLine {
  id: string;
  finishedAt: string;
  notebookName: string;
  total: number;
  correct: number;
  estimatedPct: number | null;
  verdict: QbCutoffStatus;
}

export interface QbCutoffOverview {
  exam: { id: string; name: string } | null;
  exams: QbExamChoice[];
  attemptCount: number;
  disciplines: QbOverviewDiscipline[];
  unmatched: { label: string; total: number; correct: number; pct: number }[];
  attempts: QbAttemptLine[];
}
