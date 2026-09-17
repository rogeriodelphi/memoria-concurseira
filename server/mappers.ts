export interface DocumentRow {
  id: string;
  collection_id: string;
  filename: string;
  size: number;
  pages: number;
  status: string;
  error_message: string | null;
  source_type: string;
  created_at: string;
}

export interface FlashcardRow {
  id: string;
  collection_id: string;
  document_id: string | null;
  question: string;
  answer: string;
  format: string;
  difficulty: string;
  source_page: number | null;
  created_at: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_at: string | null;
  favorite: number;
}

export function mapDocument(row: DocumentRow) {
  return {
    id: row.id,
    collectionId: row.collection_id,
    filename: row.filename,
    size: row.size,
    pages: row.pages,
    status: row.status,
    errorMessage: row.error_message,
    sourceType: row.source_type,
    createdAt: row.created_at,
  };
}

export function mapFlashcard(row: FlashcardRow) {
  return {
    id: row.id,
    collectionId: row.collection_id,
    documentId: row.document_id,
    question: row.question,
    answer: row.answer,
    format: row.format,
    difficulty: row.difficulty,
    sourcePage: row.source_page,
    createdAt: row.created_at,
    dueAt: row.due_at,
    favorite: !!row.favorite,
  };
}

export interface PomodoroTaskRow {
  id: string;
  user_id: string;
  mode: string;
  phase: string;
  discipline: string;
  subject: string;
  duration_sec: number;
  started_at: string;
  ended_at: string;
  created_at: string;
}

export function mapPomodoroTask(row: PomodoroTaskRow) {
  return {
    id: row.id,
    mode: row.mode,
    phase: row.phase,
    discipline: row.discipline,
    subject: row.subject,
    durationSec: row.duration_sec,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export interface MindMapRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function mapMindMapSummary(row: MindMapRow) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapMindMapDetail(row: MindMapRow) {
  return {
    id: row.id,
    title: row.title,
    root: JSON.parse(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SummaryRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

export function mapSummary(row: SummaryRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface BulletPointsRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function mapBulletPoints(row: BulletPointsRow) {
  return {
    id: row.id,
    title: row.title,
    points: JSON.parse(row.content) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
