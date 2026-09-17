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

// Migração para "favorite" em flashcards — marca manual do usuário pra
// montar um baralho rápido de revisão sem depender de agendamento.
const flashcardsColumnsForFavorite = db.prepare('PRAGMA table_info(flashcards)').all() as unknown as {
  name: string;
}[];
if (!flashcardsColumnsForFavorite.some((c) => c.name === 'favorite')) {
  db.exec('ALTER TABLE flashcards ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
}
