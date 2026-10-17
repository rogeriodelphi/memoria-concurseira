/**
 * Lembretes de estudo no celular: as inscrições de push (uma por navegador/aparelho) e um pequeno
 * armazém de configuração do servidor (hoje, só as chaves VAPID, geradas na primeira vez que se usa).
 * Os campos por usuário (`reminder_time`, `reminder_last_sent`) ficam em `users`, adicionados em db.ts.
 *
 * Fica num módulo à parte para o banco do app e os testes usarem exatamente o mesmo esquema.
 */
export const REMINDER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS app_kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;
