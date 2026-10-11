import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [nodeMajor, nodeMinor] = process.version.slice(1).split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 5)) {
  throw new Error(
    `Este app precisa do Node 22.5+ para o módulo node:sqlite (versão atual: ${process.version}). ` +
      'Atualize o Node.js e rode novamente.',
  );
}

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collections (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    subject     TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'Outros',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);

  CREATE TABLE IF NOT EXISTS documents (
    id            TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    size          INTEGER NOT NULL,
    pages         INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'queued',
    error_message TEXT,
    source_type   TEXT NOT NULL DEFAULT 'file',
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_id);

  CREATE TABLE IF NOT EXISTS flashcards (
    id            TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    document_id   TEXT REFERENCES documents(id) ON DELETE SET NULL,
    question      TEXT NOT NULL,
    answer        TEXT NOT NULL,
    format        TEXT NOT NULL DEFAULT 'plain',
    difficulty    TEXT NOT NULL DEFAULT 'medio',
    source_page   INTEGER,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_flashcards_collection ON flashcards(collection_id);

  CREATE TABLE IF NOT EXISTS study_sessions (
    id           TEXT PRIMARY KEY,
    flashcard_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    result       TEXT NOT NULL,
    studied_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_study_sessions_flashcard ON study_sessions(flashcard_id);

  CREATE TABLE IF NOT EXISTS pomodoro_tasks (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode          TEXT NOT NULL,
    phase         TEXT NOT NULL DEFAULT '',
    discipline    TEXT NOT NULL DEFAULT '',
    subject       TEXT NOT NULL DEFAULT '',
    duration_sec  INTEGER NOT NULL,
    started_at    TEXT NOT NULL,
    ended_at      TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pomodoro_tasks_user ON pomodoro_tasks(user_id);

  CREATE TABLE IF NOT EXISTS pomodoro_notes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_date  TEXT NOT NULL,
    text       TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, note_date)
  );

  CREATE TABLE IF NOT EXISTS mind_maps (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mind_maps_user ON mind_maps(user_id);

  CREATE TABLE IF NOT EXISTS summaries (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    mode       TEXT NOT NULL DEFAULT 'padrao',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_summaries_user ON summaries(user_id);

  CREATE TABLE IF NOT EXISTS bullet_points (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bullet_points_user ON bullet_points(user_id);

  CREATE TABLE IF NOT EXISTS ai_usage (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,
    feature       TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage(user_id, created_at);

  CREATE TABLE IF NOT EXISTS ai_provider_status (
    provider   TEXT PRIMARY KEY,
    status     TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Migração para bancos criados antes da coluna "subject" existir — o
// CREATE TABLE IF NOT EXISTS acima não adiciona coluna em tabela já
// existente, então isso cobre quem já tinha coleções salvas.
const collectionsColumns = db.prepare('PRAGMA table_info(collections)').all() as unknown as { name: string }[];
if (!collectionsColumns.some((c) => c.name === 'subject')) {
  db.exec("ALTER TABLE collections ADD COLUMN subject TEXT NOT NULL DEFAULT ''");
}

// Migração equivalente para "format" em flashcards — bancos antigos não têm
// essa coluna. Todo flashcard existente é 'plain' (texto simples gerado
// pela IA); só passa a 'html' quando editado pelo editor de texto rico.
const flashcardsColumns = db.prepare('PRAGMA table_info(flashcards)').all() as unknown as { name: string }[];
if (!flashcardsColumns.some((c) => c.name === 'format')) {
  db.exec("ALTER TABLE flashcards ADD COLUMN format TEXT NOT NULL DEFAULT 'plain'");
}

// Migração para "format" em summaries, pelo mesmo motivo dos flashcards: todo
// resumo existente é 'plain' (texto simples da IA) e só passa a 'html' quando
// editado no editor de texto rico.
const summariesColumns = db.prepare('PRAGMA table_info(summaries)').all() as unknown as { name: string }[];
if (!summariesColumns.some((c) => c.name === 'format')) {
  db.exec("ALTER TABLE summaries ADD COLUMN format TEXT NOT NULL DEFAULT 'plain'");
}

// Migração para "source_type" em documents — bancos antigos só conheciam
// upload de arquivo, então todo registro existente é 'file'.
const documentsColumns = db.prepare('PRAGMA table_info(documents)').all() as unknown as { name: string }[];
if (!documentsColumns.some((c) => c.name === 'source_type')) {
  db.exec("ALTER TABLE documents ADD COLUMN source_type TEXT NOT NULL DEFAULT 'file'");
}

// Migração para as colunas de revisão espaçada em flashcards — bancos
// antigos não têm esses campos. due_at NULL significa "nunca estudado",
// tratado como pendente de revisão desde já (não precisa de backfill).
const flashcardsColumnsForSrs = db.prepare('PRAGMA table_info(flashcards)').all() as unknown as { name: string }[];
if (!flashcardsColumnsForSrs.some((c) => c.name === 'ease_factor')) {
  db.exec(`
    ALTER TABLE flashcards ADD COLUMN ease_factor REAL NOT NULL DEFAULT 2.5;
    ALTER TABLE flashcards ADD COLUMN interval_days INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE flashcards ADD COLUMN repetitions INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE flashcards ADD COLUMN due_at TEXT;
  `);
}

// Orçamento mensal de tokens de IA (opcional, só informativo — nunca bloqueia
// geração). NULL = sem orçamento definido.
const usersColumns = db.prepare('PRAGMA table_info(users)').all() as unknown as { name: string }[];
if (!usersColumns.some((c) => c.name === 'monthly_token_budget')) {
  db.exec('ALTER TABLE users ADD COLUMN monthly_token_budget INTEGER');
}

// Migração para "favorite" em flashcards — marca manual do usuário pra
// montar um baralho rápido de revisão sem depender de agendamento.
const flashcardsColumnsForFavorite = db.prepare('PRAGMA table_info(flashcards)').all() as unknown as {
  name: string;
}[];
if (!flashcardsColumnsForFavorite.some((c) => c.name === 'favorite')) {
  db.exec('ALTER TABLE flashcards ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
}

// Tempo gasto em cada revisão, em ms (do cartão aparecer até a avaliação).
// NULL nas revisões anteriores a esta coluna — o painel estima essas pelo
// intervalo até a revisão anterior, então não precisa de backfill.
const studySessionsColumns = db.prepare('PRAGMA table_info(study_sessions)').all() as unknown as { name: string }[];
if (!studySessionsColumns.some((c) => c.name === 'duration_ms')) {
  db.exec('ALTER TABLE study_sessions ADD COLUMN duration_ms INTEGER');
}

// Concursos: o conteúdo programático de um edital (disciplinas e tópicos) e o
// vínculo de cada tópico com as coleções de flashcards do usuário. Só tabelas
// novas — nada que já existe é alterado. Apagar um concurso leva junto suas
// disciplinas, tópicos e vínculos; apagar uma coleção só desfaz o vínculo dela.
db.exec(`
  CREATE TABLE IF NOT EXISTS exams (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   TEXT NOT NULL DEFAULT '',
    board      TEXT NOT NULL DEFAULT '',
    exam_date  TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_exams_user ON exams(user_id);

  CREATE TABLE IF NOT EXISTS exam_disciplines (
    id             TEXT PRIMARY KEY,
    exam_id        TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    question_count INTEGER,
    weight         REAL,
    cutoff         TEXT NOT NULL DEFAULT '',
    position       INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_exam_disciplines_exam ON exam_disciplines(exam_id);

  CREATE TABLE IF NOT EXISTS exam_topics (
    id            TEXT PRIMARY KEY,
    discipline_id TEXT NOT NULL REFERENCES exam_disciplines(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    position      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_exam_topics_discipline ON exam_topics(discipline_id);

  CREATE TABLE IF NOT EXISTS exam_topic_collections (
    topic_id      TEXT NOT NULL REFERENCES exam_topics(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY (topic_id, collection_id)
  );

  CREATE INDEX IF NOT EXISTS idx_exam_topic_collections_collection ON exam_topic_collections(collection_id);
`);
