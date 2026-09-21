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

export type AiFeature = 'flashcards' | 'summary' | 'bulletpoints' | 'mindmap' | 'transcription';
export type AiProvider = 'gemini' | 'openai';
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
