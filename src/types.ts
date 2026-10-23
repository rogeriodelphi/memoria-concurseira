export * from './questionBankTypes';

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

/** A resposta do "professor" a uma pergunta sobre um cartão (veja server/ai/tutor.ts). Os opcionais vêm vazios quando a IA não os preencheu. */
export interface TutorReply {
  answer: string;
  example: string;
  tip: string;
  caution: string;
}

/** Um lembrete de "Meus lembretes", no Painel (veja server/todos/todos.ts). */
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  /** Quando foi marcado como feito; `null` enquanto pendente. */
  doneAt: string | null;
}

export type CollectionStatus = 'sem_documento' | 'processing' | 'completed' | 'error';

export interface CollectionSummary {
  id: string;
  name: string;
  subject: string;
  description: string;
  category: string;
  flashcardCount: number;
  /** Pendentes de revisão; 0 enquanto a coleção está congelada (ela não entra nas revisões nem nos totais). */
  dueCount: number;
  /** Congelada: fora das revisões automáticas, com os cartões intactos. */
  frozen: boolean;
  frozenAt: string | null;
  /** Só congelada: quantos cartões estariam pendentes (voltam à fila ao descongelar). */
  frozenDueCount: number;
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
  frozenAt: string | null;
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

/** Um cartão que o usuário erra sempre (o servidor decide quais: veja server/leeches/leeches.ts). */
export interface Leech {
  flashcard: DueFlashcard;
  /** Quantas das últimas revisões foram "Errei". */
  errors: number;
  /** Quantas revisões entraram na conta. */
  reviews: number;
  /** As últimas revisões, da mais antiga para a mais nova. */
  results: StudyResult[];
  lastReviewedAt: string;
  /** Acertos seguidos desde o último erro. */
  streak: number;
  /** O usuário adiou a revisão deste cartão e o prazo ainda não passou. */
  snoozed: boolean;
  /** Até quando, quando está adiado. */
  snoozedUntil: string | null;
}

/** O que a IA propõe para um cartão sanguessuga (só uma proposta: o usuário decide o que aplicar). */
export interface LeechSuggestion {
  /** Uma frase sobre por que o cartão provavelmente é difícil. */
  diagnosis: string;
  /** Um jeito curto de lembrar a resposta; vazio quando a IA não achou um honesto. */
  macete: string;
  /** Os cartões menores propostos (2 ou mais), ou nenhum quando o cartão já é uma ideia só. */
  split: { question: string; answer: string }[];
}

export interface LeechList {
  minErrors: number;
  /** Quantas das últimas revisões de cada cartão entram na conta. */
  window: number;
  /** Quantos acertos seguidos tiram o cartão da lista. */
  streakToLeave: number;
  /** Quantos cartões atendem a regra (a lista traz os primeiros 100). */
  total: number;
  leeches: Leech[];
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
  /** Cartões diferentes com ao menos uma revisão "Errei" ou "Difícil" no período. */
  missedCards: number;
  /** O acerto do período anterior, de mesma duração; `null` se não há (ou sem revisões nele). */
  previousAccuracyPct: number | null;
  /** Quantas revisões o período anterior teve (0 sem período anterior). */
  previousReviews: number;
}

export interface PerformanceSubject extends PerformanceCounts {
  key: string;
  label: string;
  /** As coleções deste nome com este assunto e cartões estudados. */
  collectionIds: string[];
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
  collectionIds: string[];
}

export interface PerformanceData {
  /** O período como foi entendido: dias locais, AAAA-MM-DD, os dois inclusive. */
  range: { from: string; to: string };
  /** O período pronto escolhido (0 = desde o início); `null` se é personalizado. */
  days: number | null;
  scope: 'all' | 'exam';
  /** O concurso do "Meu concurso"; `null` se o usuário não tem nenhum. */
  exam: { id: string; name: string } | null;
  /** Os concursos que o seletor oferece (todos os do usuário, com ou sem data). */
  exams: ExamOption[];
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

// ---------- Tempo de estudo ----------

export interface StudyTimeSubject {
  key: string;
  label: string;
  sec: number;
}

/** O tempo de um grupo, por fonte: o Pomodoro registrado e o tempo gasto nos cartões (sem contar em dobro). */
export interface StudyTimeRow {
  key: string;
  label: string;
  pomodoroSec: number;
  cardSec: number;
  totalSec: number;
  tasks: number;
  reviews: number;
  accuracyPct: number | null;
  subjects: StudyTimeSubject[];
}

export interface StudyTimeDisciplineRow extends StudyTimeRow {
  /** `null` na linha "Fora do edital". */
  disciplineId: string | null;
  questions: number | null;
  weight: number | null;
  /** A fatia da prova (questões x peso sobre o total), em %; `null` fora do edital. */
  weightPct: number | null;
}

export interface StudyTimeData {
  range: { from: string; to: string };
  scope: 'all' | 'exam';
  exam: { id: string; name: string } | null;
  totals: {
    totalSec: number;
    pomodoroSec: number;
    cardSec: number;
    tasks: number;
    reviews: number;
    /** Revisões cujo tempo não foi medido e entrou estimado. */
    estimatedReviews: number;
    /** Tempo de revisões feitas dentro de um Pomodoro: já está no Pomodoro e não é somado de novo. */
    overlapSec: number;
  };
  byName: StudyTimeRow[];
  /** `null` quando o usuário não tem concurso. */
  byDiscipline: StudyTimeDisciplineRow[] | null;
}

/** O que a página pede ao servidor; ver `GET /api/stats/performance`. */
export interface PerformanceQuery {
  days: number;
  range: { from: string; to: string } | null;
  scope: 'all' | 'exam';
  name: string | null;
  subject: string | null;
  /** O concurso escolhido para "Meu concurso"; sem ele (ou se não vale), o principal. */
  exam?: string | null;
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

/** Um tópico do edital sugerido para uma coleção que ainda não está ligada ao concurso. */
export interface TopicLinkSuggestion {
  topicId: string;
  title: string;
  discipline: string;
  /** De 0,5 a 1. */
  score: number;
  /** Tão parecido que é praticamente o mesmo assunto. */
  strong: boolean;
  /** O tópico já tem outra coleção ligada (ainda pode receber esta). */
  linked: boolean;
}

/** Uma coleção do usuário que não está ligada a nenhum tópico do concurso, com os tópicos que combinam com ela. */
export interface UnlinkedCollection {
  id: string;
  name: string;
  subject: string;
  cards: number;
  newCards: number;
  dueCards: number;
  suggestions: TopicLinkSuggestion[];
  /** Quantos tópicos empatam no topo, quando são mais que o limite de sugestões (a coleção cobre a disciplina inteira). 0 se não há esse empate. */
  tied: number;
}

/** Uma coleção marcada como "não é deste concurso". */
export interface IgnoredCollection {
  id: string;
  name: string;
  subject: string;
  cards: number;
  newCards: number;
  dueCards: number;
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
  /** As coleções que não estão ligadas a nenhum tópico deste concurso (menos as marcadas como "não é deste concurso"). */
  unlinkedCollections: UnlinkedCollection[];
  ignoredCollections: IgnoredCollection[];
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

export type AiFeature = 'flashcards' | 'summary' | 'bulletpoints' | 'mindmap' | 'transcription' | 'exam' | 'tts' | 'choices' | 'verify' | 'questions' | 'leech' | 'tutor';
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

/** Um concurso como opção do seletor de concurso: o nome, o cargo e quantos dias faltam. */
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

/** O cronograma até a prova (veja server/schedule): dia a dia, quais tópicos do edital estudar. */
export interface ScheduleSettings {
  minutesPerDay: number;
  minutesPerTopic: number;
  /** Em que dias da semana o usuário estuda (0 = domingo). */
  weekdays: number[];
}

/** `study`: dia de tópicos novos; `review`: só revisão; `rest`: dia da semana que o usuário não estuda; `exam`: a prova. */
export type ScheduleDayKind = 'study' | 'review' | 'rest' | 'exam';

export interface ScheduleDay {
  /** AAAA-MM-DD. */
  date: string;
  weekday: number;
  kind: ScheduleDayKind;
  /** Os tópicos do dia, na ordem de prioridade (só dias `study` têm). */
  topicIds: string[];
  minutes: number;
}

export type ScheduleVerdict = 'fits' | 'overflow' | 'nothing_left' | 'no_time';

export interface ScheduleSummary {
  daysLeft: number;
  reviewPhaseDays: number;
  studyDays: number;
  reviewDays: number;
  restDays: number;
  topicsTotal: number;
  topicsDone: number;
  topicsPending: number;
  topicsScheduled: number;
  capacityTopics: number;
  /** Os tópicos que não cabem até a prova, na ordem de prioridade. */
  leftOut: string[];
  /** Minutos por dia que fariam tudo caber; `null` se tudo cabe. */
  neededMinutesPerDay: number | null;
  finishDate: string | null;
  freeStudyDays: number;
  verdict: ScheduleVerdict;
}

export interface ScheduleTopic {
  id: string;
  title: string;
  disciplineId: string;
  done: boolean;
  cards: number;
  /** Os cartões já vistos, em %; `null` sem cartões. */
  seenPct: number | null;
  /** As coleções ligadas (sem as congeladas), para abrir o estudo do tópico. */
  collectionIds: string[];
}

export interface ScheduleDiscipline {
  id: string;
  name: string;
  sharePct: number;
  topics: number;
  done: number;
}

export interface Schedule {
  exam: { id: string; name: string; examDate: string; daysLeft: number };
  /** AAAA-MM-DD, hoje. */
  today: string;
  settings: ScheduleSettings;
  /** `false` enquanto o usuário não escolheu nada (valem as escolhas padrão). */
  settingsSaved: boolean;
  disciplines: ScheduleDiscipline[];
  /** Todos os tópicos do edital, na ordem dele. */
  topics: ScheduleTopic[];
  days: ScheduleDay[];
  summary: ScheduleSummary;
}

/** A dívida de revisão (veja server/stats/reviewDebt.ts): os cartões já estudados que venceram antes de hoje e o ritmo da semana. */
export interface ReviewDebt {
  /** Os cartões estudados que venceram antes de hoje (não conta coleção congelada). */
  overdue: number;
  /** Quantos estão atrasados há 1 a 3 dias, 4 a 7, 8 a 14 e mais de 14. */
  lateBy: { upTo3: number; upTo7: number; upTo14: number; over14: number };
  /** Há quantos dias está atrasado o mais antigo; `null` sem atrasados. */
  oldestDays: number | null;
  /** A última semana: revisões feitas, quantas eram a primeira vez de um cartão e quantas de cartão já estudado. */
  week: { days: number; reviews: number; newCards: number; oldCards: number };
  /** Revisões de cartões já estudados por dia, em média na janela. */
  oldPerDay: number;
  /** O cartão novo em % das revisões da semana; `null` sem revisões. */
  newSharePct: number | null;
  /** Dias para zerar o atrasado no ritmo da semana (sem contar o que vence no meio-tempo); `null` sem revisões de cartões antigos. */
  daysToClear: number | null;
  level: 'ok' | 'attention' | 'high';
  /** Quantos cartões a sessão "Pôr em dia" traz agora. */
  batch: number;
  /** O limite diário de cartões novos; `null` = sem limite. */
  dailyNewLimit: number | null;
}

/** Em que fase está a preparação, pelos dias que faltam: mais de 7 (conteúdo), de 7 a 4 (só revisão) e 3 ou menos. */
export type FinalStretchPhase = 'content' | 'review' | 'last';

export interface FinalStretchDiscipline {
  id: string;
  name: string;
  /** A fatia da prova, em %. */
  sharePct: number;
  cards: number;
  newCards: number;
  dueCards: number;
  /** Cartões que o usuário já viu ao menos uma vez, em % dos da disciplina. `null` sem cartões. */
  seenPct: number | null;
  /** O acerto (Bom ou Fácil) dos últimos 30 dias, em %. `null` sem revisões no período. */
  accuracyPct: number | null;
  reviews30: number;
  /** Quanto já está dominado: o visto vezes o acerto (suavizado) vezes a cobertura do edital, em %. `null` sem cartões. */
  masteryPct: number | null;
  /** Os tópicos da disciplina no edital e quantos têm ao menos um cartão (0 e 0 sem tópicos cadastrados). */
  topics: number;
  coveredTopics: number;
  /** Os tópicos com cartão em % dos tópicos da disciplina; `null` sem tópicos cadastrados. */
  coveragePct: number | null;
  /** Quanto da prova ainda está em aberto nesta disciplina (peso × o que falta dominar), em % da prova. */
  gainPct: number;
  /** A posição entre as que têm cartões (1 = a mais urgente); `null` se não tem cartões. */
  rank: number | null;
  hasCards: boolean;
}

/** A reta final do concurso de data mais próxima (veja server/studyplan/finalStretch.ts). */
export interface FinalStretch {
  exam: { id: string; name: string; examDate: string; daysLeft: number } | null;
  phase: FinalStretchPhase | null;
  /** Os concursos que o seletor oferece (os que têm prova de hoje em diante). */
  exams: ExamOption[];
  /** As disciplinas do edital, da mais urgente à menos (as sem cartões por último). */
  disciplines: FinalStretchDiscipline[];
  /** Os ids das mais urgentes com cartões. */
  focus: string[];
  /** A fatia da prova (em %) das disciplinas sem nenhum cartão. */
  uncoveredSharePct: number;
  /** Quantas coleções ligadas a este edital estão congeladas (ficam de fora da prioridade e da fila). */
  frozenCollections: number;
  /** Os tópicos do edital (todas as disciplinas) e quantos têm ao menos um cartão: a cobertura que entra no domínio. */
  topics: number;
  coveredTopics: number;
  queue: {
    total: number;
    due: number;
    new: number;
    /** O limite diário de novos do usuário; `null` = sem limite. */
    limit: number | null;
    /** O teto de cartões de uma sessão, e quantos novos entram por sessão quando não há limite diário. */
    maxCards: number;
    defaultNew: number;
    /** Vencidos e novos do edital que ficaram para outra sessão. */
    waitingDue: number;
    waitingNew: number;
    /** Vencidos e novos que não estão em coleção ligada ao edital (não entram na sessão). */
    outsideDue: number;
    outsideNew: number;
  };
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
