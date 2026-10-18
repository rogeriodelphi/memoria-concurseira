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

// ---------- Meu desempenho ----------

/** Os números de um grupo (nome de coleção, assunto) no período. */
export interface PerformanceCounts {
  /** Cartões diferentes estudados. */
  cards: number;
  reviews: number;
  /** Revisões "Bom" ou "Fácil". */
  good: number;
  /** Revisões "Errei" ou "Difícil". */
  bad: number;
  accuracyPct: number;
  /** O acerto do período anterior, de mesma duração; `null` se não há (ou sem revisões nele). */
  previousAccuracyPct: number | null;
}

export interface PerformanceSubject extends PerformanceCounts {
  key: string;
  label: string;
}

export interface PerformanceName extends PerformanceCounts {
  key: string;
  label: string;
  /** As coleções deste nome com cartões estudados (se for uma só, o nome vira link). */
  collectionIds: string[];
  /** Os assuntos dentro deste nome. */
  subjects: PerformanceSubject[];
}

export interface PerformanceSubjectGroup extends PerformanceCounts {
  key: string;
  label: string;
  /** Os nomes de coleção que trazem este assunto. */
  names: string[];
}

export interface PerformanceData {
  /** O período como foi entendido: dias locais, AAAA-MM-DD, os dois inclusive. */
  range: { from: string; to: string };
  /** O período pronto escolhido (0 = desde o início); `null` se é personalizado. */
  days: number | null;
  scope: 'all' | 'exam';
  /** O concurso do "Meu concurso"; `null` se o usuário não tem nenhum. */
  exam: { id: string; name: string } | null;
  totalCards: number;
  totals: {
    cards: number;
    reviews: number;
    good: number;
    bad: number;
    accuracyPct: number | null;
    byResult: Record<StudyResult, number>;
  };
  /** Só os dias com revisão; os dias sem estudo valem zero. */
  daily: { date: string; good: number; bad: number }[];
  byName: PerformanceName[];
  bySubject: PerformanceSubjectGroup[];
  options: { names: { key: string; label: string }[]; subjects: { key: string; label: string }[] };
}

/** O que a página pede ao servidor; ver `GET /api/stats/performance`. */
export interface PerformanceQuery {
  days: number;
  range: { from: string; to: string } | null;
  scope: 'all' | 'exam';
  name: string | null;
  subject: string | null;
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
  /** Tempo médio por revisão nos últimos 30 dias, em segundos. */
  recentPaceSec: number | null;
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
  /** topicId -> quantos cartões da IA esperam conferência (só os tópicos que têm). */
  drafts: Record<string, number>;
}

// ---------- Cartões da IA a conferir ----------

/** A segunda opinião de outra IA sobre um rascunho: ok, com dúvida ou provavelmente errado. */
export type DraftVerdict = 'ok' | 'duvida' | 'erro';

export interface AiDraft {
  id: string;
  question: string;
  answer: string;
  difficulty: string;
  verdict: DraftVerdict | null;
  verdictNote: string | null;
}

export interface AiDraftGroup {
  collection: { id: string; name: string; subject: string };
  /** O tópico do edital para o qual os cartões foram gerados; `null` se ele foi apagado. */
  topic: { id: string; title: string; discipline: string; examId: string; examName: string } | null;
  drafts: AiDraft[];
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

export type AiFeature = 'flashcards' | 'summary' | 'bulletpoints' | 'mindmap' | 'transcription' | 'exam' | 'tts' | 'choices' | 'verify';
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

/** Como a tentativa foi feita: o usuário se avaliando (`self`) ou respondendo questões de múltipla escolha (`choice`). */
export type AttemptMode = 'self' | 'choice';

export interface MockExamAttempt {
  id: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  correct: number;
  mode: AttemptMode;
}

/** As alternativas de um cartão, geradas pela IA: uma correta e de três a quatro erradas. */
export interface ChoiceQuestion {
  flashcardId: string;
  correct: string;
  wrong: string[];
}

/** O simulado criado (ou atualizado) a partir de uma disciplina do concurso. */
export interface DisciplineMockExam {
  mockExam: MockExamSummary;
  /** Cartões que entraram agora. */
  added: number;
  /** Era um simulado novo, e não um que já existia e foi atualizado. */
  created: boolean;
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

// ---------- Meta para a prova ----------

export type PlanVerdict = 'on_track' | 'tight' | 'behind' | 'no_pace' | 'last_days' | 'exam_today';

/** Um jeito de chegar à prova: quantos cartões novos por dia e o que isso custa e cobre (médias até a prova). */
export interface PlanScenario {
  kind: 'current' | 'budget' | 'all';
  newPerDay: number;
  cardsPerDay: number;
  minutesPerDay: number;
  newSeen: number;
  coveragePct: number;
  /** A carga de cada dia até a prova. */
  perDay: number[];
}

export interface ExamPlan {
  exam: { id: string; name: string; examDate: string; daysLeft: number };
  verdict: PlanVerdict;
  finalReviewDays: number;
  newDays: number;
  cards: { new: number; due: number; learned: number };
  currentLimit: number | null;
  pace: {
    windowDays: number;
    reviewsPerDay: number;
    newPerDay: number;
    activeDays: number;
    secPerReview: number | null;
  };
  neededNewPerDay: number | null;
  scenarios: PlanScenario[];
  /** Em que ordem os cartões novos entram na revisão quando há limite diário. */
  newOrder: NewCardOrder;
}

/** 'created': do mais antigo ao mais novo. 'exam': repartidos pelo peso das disciplinas do edital. */
export type NewCardOrder = 'created' | 'exam';

/** Como a ordem pelo edital reparte os cartões novos, disciplina a disciplina. */
export interface NewOrderOverview {
  order: NewCardOrder;
  /** O concurso com data mais próxima, que dá o edital; `null` se não há nenhum com data. */
  exam: { id: string; name: string; examDate: string; daysLeft: number } | null;
  disciplines: {
    id: string;
    name: string;
    questions: number | null;
    weight: number | null;
    /** A fatia da prova, em %. */
    sharePct: number;
    /** A cota na ordem pelo edital (só entre as disciplinas com cartões); `null` se a disciplina não tem cartões. */
    quotaPct: number | null;
    newCards: number;
    learnedCards: number;
    /** Que parte dos cartões já estudados é desta disciplina, em %; `null` se não tem cartões. */
    learnedSharePct: number | null;
  }[];
  /** Cartões novos fora de qualquer coleção ligada ao edital: entram por último. */
  unlinkedNew: number;
}
