import type { DatabaseSync } from 'node:sqlite';

/**
 * Simulados: listas de cartões que o usuário monta para treinar como numa prova, e o
 * histórico de cada vez que ele fez uma. Só tabelas próprias — nenhuma tabela do resto do app é alterada.
 *
 * - Apagar um cartão o tira das listas; apagar uma lista leva junto os cartões dela (não os
 *   cartões em si) e o histórico de tentativas.
 * - Uma tentativa guarda o placar (`total`/`correct`) na própria linha, então o histórico
 *   sobrevive mesmo que cartões sejam apagados depois; só o detalhe por cartão some.
 * - O nome da lista é único por usuário, sem diferenciar maiúsculas de minúsculas.
 *
 * Fica num módulo à parte para o banco do app e os testes usarem exatamente o mesmo esquema.
 */
export const MOCK_EXAM_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mock_exams (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_mock_exams_user_name ON mock_exams(user_id, name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS mock_exam_cards (
    mock_exam_id TEXT NOT NULL REFERENCES mock_exams(id) ON DELETE CASCADE,
    flashcard_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    added_at     TEXT NOT NULL,
    PRIMARY KEY (mock_exam_id, flashcard_id)
  );

  CREATE INDEX IF NOT EXISTS idx_mock_exam_cards_flashcard ON mock_exam_cards(flashcard_id);

  CREATE TABLE IF NOT EXISTS mock_exam_attempts (
    id           TEXT PRIMARY KEY,
    mock_exam_id TEXT NOT NULL REFERENCES mock_exams(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    finished_at  TEXT NOT NULL,
    duration_ms  INTEGER NOT NULL,
    total        INTEGER NOT NULL,
    correct      INTEGER NOT NULL,
    mode         TEXT NOT NULL DEFAULT 'self'
  );

  CREATE INDEX IF NOT EXISTS idx_mock_exam_attempts_exam ON mock_exam_attempts(mock_exam_id);

  CREATE TABLE IF NOT EXISTS mock_exam_answers (
    attempt_id   TEXT NOT NULL REFERENCES mock_exam_attempts(id) ON DELETE CASCADE,
    flashcard_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    correct      INTEGER NOT NULL,
    duration_ms  INTEGER,
    PRIMARY KEY (attempt_id, flashcard_id)
  );

  -- Alternativas de múltipla escolha geradas pela IA, uma vez por cartão. source_hash é a
  -- impressão digital do texto do cartão no momento em que foram geradas: se o cartão for editado,
  -- o hash deixa de bater e as alternativas velhas não são mais usadas (são geradas de novo).
  CREATE TABLE IF NOT EXISTS card_choices (
    flashcard_id TEXT PRIMARY KEY REFERENCES flashcards(id) ON DELETE CASCADE,
    source_hash  TEXT NOT NULL,
    correct      TEXT NOT NULL,
    wrong_json   TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
`;

/**
 * Bancos criados antes das alternativas têm mock_exam_attempts sem a coluna mode (o
 * CREATE TABLE IF NOT EXISTS acima não mexe numa tabela que já existe). Acrescenta-a, com o valor
 * "self" (autoavaliado) para as tentativas antigas, que foram todas assim.
 */
export function upgradeMockExamSchema(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(mock_exam_attempts)').all() as unknown as { name: string }[];
  if (!columns.some((c) => c.name === 'mode')) {
    db.exec("ALTER TABLE mock_exam_attempts ADD COLUMN mode TEXT NOT NULL DEFAULT 'self'");
  }
}
