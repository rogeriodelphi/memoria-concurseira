/**
 * "Meus lembretes" do Painel: só uma tabela nova, nada que já existe é alterado. Cada usuário tem os seus; apagar o
 * usuário leva os lembretes junto. (O lembrete de estudo por push é outra coisa: server/reminders.)
 */
export const TODO_SCHEMA = `
  CREATE TABLE IF NOT EXISTS todo_items (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    done_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_todo_items_user ON todo_items(user_id);
`;
