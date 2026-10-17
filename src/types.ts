export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export type CollectionStatus = 'sem_documento' | 'processing' | 'completed' | 'error';

export interface CollectionSummary {
  id: string;
  name: string;
  subject: string;
  description: string;
  category: string;
  flashcardCount: number;
  dueCount: number;
  favoriteCount: number;
  status: CollectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionDetail {
  id: string;
  name: string;
  subject: string;
  description: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export type DocumentSourceType = 'file' | 'topic' | 'text' | 'youtube' | 'anki';

export interface DocumentItem {
  id: string;
  collectionId: string;
  filename: string;
  size: number;
  pages: number;
  status: CollectionStatus;
  errorMessage: string | null;
  sourceType: DocumentSourceType;
  createdAt: string;
}

export type Difficulty = 'facil' | 'medio' | 'dificil';
export type FlashcardFormat = 'plain' | 'html';

export interface Flashcard {
  id: string;
  collectionId: string;
  documentId: string | null;
  question: string;
  answer: string;
  format: FlashcardFormat;
  difficulty: Difficulty;
  sourcePage: number | null;
  createdAt: string;
  dueAt: string | null;
  favorite: boolean;
}

export interface DueFlashcard extends Flashcard {
  collectionName: string;
  /** O assunto da coleção (vazio se não tem): com várias coleções de mesmo nome, é o que as distingue. */
  collectionSubject?: string;
}

export interface DuplicateFlashcard extends Flashcard {
  collectionName: string;
  collectionSubject: string;
}

export interface DuplicateGroup {
  flashcards: DuplicateFlashcard[];
}

export type StudyResult = 'errei' | 'dificil' | 'bom' | 'facil';

export interface StatsData {
  totals: {
    collections: number;
    flashcards: number;
    reviews: number;
    streakDays: number;
  };
  byResult: Record<StudyResult, number>;
  dailyActivity: { date: string; count: number }[];
  byCollection: { id: string | null; name: string; reviews: number; accuracyPct: number }[];
}

export interface DashboardData {
  consistency: { date: string; count: number }[];
  efficiencyPct: number | null;
  precisionPct: number | null;
  retentionPct: number | null;
  newCardsPct: number | null;
  today: {
    studied: number;
    distinctCards: number;
    timeMin: number;
    paceSec: number | null;
    cardsPerMin: number | null;
    passRatePct: number | null;
  };
  /** O limite diário de cartões novos na fila de revisão (`null` = sem limite). */
  dailyNewLimit: number | null;
  remaining: {
    /** Os novos que entram na fila de hoje: todos, sem limite; com limite, só os que ainda cabem. */
    new: number;
    /** Novos que ficaram de fora por causa do limite diário (0 sem limite). */
    newWaiting: number;
    learning: number;
    due: number;
    total: number;
    dueTomorrow: number;
    estimatedMin: number | null;
  };
  doneToday: { newLearned: number; relearned: number; reviews: number; again: number };
  matureCards: number;
  totalHours: number;
  pastWeekHours: number;
  totalReviews: number;
  estimatedReviews: number;
  heatmap: {
    today: string;
    days: { date: string; count: number }[];
    years: { year: number; reviews: number; activeDays: number; periodDays: number }[];
    longestStreak: number;
    currentStreak: number;
  };
}

export interface ExamTopicDraft {
  id?: string;
  title: string;
}

export interface ExamDisciplineDraft {
  id?: string;
  name: string;
  questionCount: number | null;
  weight: number | null;
  cutoff: string;
  topics: ExamTopicDraft[];
}

export interface ExamDraft {
  name: string;
  position: string;
  board: string;
  examDate: string | null;
  disciplines: ExamDisciplineDraft[];
}

export interface ExamRollup {
  cards: number;
  newCards: number;
  dueCards: number;
  approvalPct: number | null;
}

export interface ExamOverall extends ExamRollup {
  disciplineCount: number;
  topicCount: number;
  coveredTopics: number;
  coveragePct: number | null;
  weightedByQuestions: boolean;
}

export interface ExamHeader {
  id: string;
  name: string;
  position: string;
  board: string;
  examDate: string | null;
  daysLeft: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExamSummary extends ExamHeader {
  overall: ExamOverall;
}

export interface ExamTopicProgress extends ExamRollup {
  id: string;
  title: string;
  collectionIds: string[];
  hasMaterial: boolean;
}

export interface ExamDisciplineProgress extends ExamRollup {
  id: string;
  name: string;
  questionCount: number | null;
  weight: number | null;
  cutoff: string;
  topicCount: number;
  coveredTopics: number;
  coveragePct: number | null;
  topics: ExamTopicProgress[];
}

export interface ExamCollectionSuggestion {
  collectionId: string;
  score: number;
  strong: boolean;
}

export interface ExamDetail {
  exam: ExamHeader;
  disciplines: ExamDisciplineProgress[];
  overall: ExamOverall;
  /** topicId -> sugestões (só para tópicos ainda sem vínculo). */
  suggestions: Record<string, ExamCollectionSuggestion[]>;
  collections: { id: string; name: string; subject: string; cards: number }[];
}

export interface TtsVoiceOption {
  id: string;
  label: string;
  description: string;
}

export interface TtsInfo {
  /** O servidor tem como gerar a voz natural (chave do Gemini configurada). */
  available: boolean;
  defaultVoice: string;
  voices: TtsVoiceOption[];
}

export interface CollectionStats {
  totals: { flashcards: number; reviews: number; dueCount: number; favoriteCount: number };
  byResult: Record<StudyResult, number>;
  accuracyPct: number;
}

export type Quantity = 'auto' | number;
export type CardType =
  | 'pergunta_resposta'
  | 'verdadeiro_falso'
  | 'multipla_escolha'
  | 'conceito_definicao'
  | 'misto';
export type Depth = 'essencial' | 'normal' | 'avancado';

export interface GenerationOptions {
  quantity: Quantity;
  difficulty: Difficulty | 'misto';
  cardType: CardType;
  depth: Depth;
  focus: string;
}

export type PomodoroMode = 'simples' | 'super';

export interface PomodoroTask {
  id: string;
  mode: PomodoroMode;
  phase: string;
  discipline: string;
  subject: string;
  durationSec: number;
  startedAt: string;
  endedAt: string;
  createdAt: string;
}

export interface MindMapNode {
  title: string;
  children?: MindMapNode[];
}

export interface MindMapSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MindMapDetail {
  id: string;
  title: string;
  root: MindMapNode;
  createdAt: string;
  updatedAt: string;
}

export type SummaryMode = 'padrao' | 'intensivo';

export interface Summary {
  id: string;
  title: string;
  content: string;
  /** 'plain' é o que a IA gera; vira 'html' quando o resumo é editado no editor de texto rico. */
  format: FlashcardFormat;
  mode: SummaryMode;
  createdAt: string;
  updatedAt: string;
}

export interface BulletPoints {
  id: string;
  title: string;
  points: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AnkiImportPreview {
  suggestedName: string;
  totalNotes: number;
  importable: number;
  duplicatesExisting: number;
  duplicatesInFile: number;
  empty: number;
  clozeConverted: number;
  images: { embedded: number; skipped: number };
  duplicateSamples: { question: string; existsIn: string | null }[];
  sample: { question: string; answer: string }[];
}

export interface AnkiImportResult {
  imported: number;
  duplicates: number;
  empty: number;
  collection: { id: string; name: string } | null;
}

export type AiFeature = 'flashcards' | 'summary' | 'bulletpoints' | 'mindmap' | 'transcription' | 'exam' | 'tts';
export type AiProvider = 'gemini' | 'openai' | 'claude';
export type AiProviderStatus =
  | 'ok'
  | 'quota_exhausted'
  | 'no_credits'
  | 'rate_limited'
  | 'invalid_key'
  | 'unavailable';

export interface AiUsageTotals {
  tokens: number;
  requests: number;
}

export interface AiUsage {
  today: AiUsageTotals;
  month: AiUsageTotals;
  budget: number | null;
  remaining: number | null;
  byFeature: (AiUsageTotals & { feature: AiFeature })[];
  byProvider: (AiUsageTotals & { provider: AiProvider })[];
  providers: {
    provider: AiProvider;
    configured: boolean;
    status: AiProviderStatus | null;
    updatedAt: string | null;
  }[];
}

export interface SearchResultItem {
  id: string;
  title: string;
  updatedAt: string;
}

export interface SearchCollectionResult {
  id: string;
  name: string;
  subject: string;
  updatedAt: string;
}

export interface SearchResults {
  collections: SearchCollectionResult[];
  summaries: SearchResultItem[];
  mindMaps: SearchResultItem[];
  bulletPoints: SearchResultItem[];
}

// ---------- Simulados ----------

export interface MockExamSummary {
  id: string;
  name: string;
  cardCount: number;
  attemptCount: number;
  lastAttempt: { finishedAt: string; total: number; correct: number } | null;
  /** Só quando a lista foi pedida para um cartão: ele já está neste simulado? */
  containsCard?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MockExamCard {
  id: string;
  question: string;
  answer: string;
  format: FlashcardFormat;
  collectionId: string;
  collectionName: string;
}

export interface MockExamAttempt {
  id: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  correct: number;
}

export interface MockExamDetail {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cards: MockExamCard[];
  attempts: MockExamAttempt[];
  /** Os cartões que o usuário errou na tentativa mais recente (e que ainda estão no simulado). */
  lastWrongFlashcardIds: string[];
}

export interface MockExamAnswer {
  flashcardId: string;
  correct: boolean;
  durationMs?: number;
}
