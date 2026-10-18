/**
 * Cartões gerados por IA que esperam a conferência do usuário. A IA cria os cartões de um tópico do edital
 * só a partir do título dele, sem texto-fonte, e pode errar (leis, números, datas): por isso eles ficam aqui,
 * FORA da tabela de cartões, até o usuário aprovar. Enquanto são rascunhos, nenhuma tela de estudo,
 * contagem, simulado ou estatística os enxerga; ao aprovar, viram cartões comuns na coleção do tópico.
 *
 * Fica num módulo à parte para o banco do app e os testes usarem exatamente o mesmo esquema.
 */
export const AI_REVIEW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_card_drafts (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    document_id   TEXT REFERENCES documents(id) ON DELETE SET NULL,
    topic_id      TEXT REFERENCES exam_topics(id) ON DELETE SET NULL,
    question      TEXT NOT NULL,
    answer        TEXT NOT NULL,
    difficulty    TEXT NOT NULL DEFAULT 'medio',
    source_page   INTEGER,
    -- A segunda opinião de outra IA: 'ok', 'duvida' ou 'erro' (NULL = ainda não conferido) e o motivo.
    verdict       TEXT,
    verdict_note  TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_card_drafts_user ON ai_card_drafts(user_id);
  CREATE INDEX IF NOT EXISTS idx_ai_card_drafts_collection ON ai_card_drafts(collection_id);
  CREATE INDEX IF NOT EXISTS idx_ai_card_drafts_topic ON ai_card_drafts(topic_id);
`;
