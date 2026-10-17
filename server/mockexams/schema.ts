/**
 * Simulados: listas de cartões que o usuário monta para treinar como numa prova, e o
 * histórico de cada vez que ele fez uma. Só tabelas novas — nada que já existe é alterado.
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
    correct      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mock_exam_attempts_exam ON mock_exam_attempts(mock_exam_id);

  CREATE TABLE IF NOT EXISTS mock_exam_answers (
    attempt_id   TEXT NOT NULL REFERENCES mock_exam_attempts(id) ON DELETE CASCADE,
    flashcard_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    correct      INTEGER NOT NULL,
    duration_ms  INTEGER,
    PRIMARY KEY (attempt_id, flashcard_id)
  );
`;
