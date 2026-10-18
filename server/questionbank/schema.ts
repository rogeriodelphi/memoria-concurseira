/**
 * Banco de questões: provas anteriores importadas de PDF, com as questões de múltipla escolha, o gabarito, o
 * histórico de respostas do usuário, os cadernos (listas de questões) e as tentativas de simulado.
 * Só tabelas próprias — nenhuma tabela do resto do app é alterada, e as questões NÃO são cartões: não entram
 * na fila de revisão nem nas estatísticas de cartões.
 *
 * - Apagar uma prova leva junto as questões dela, as respostas a essas questões e o lugar delas nos cadernos.
 * - Apagar um caderno leva junto as tentativas de simulado; as respostas ficam (a questão continua "resolvida"),
 *   só deixam de apontar para a tentativa.
 * - `source_id` é o código da questão no site de origem (ex.: "Q4229308"): uma questão com o mesmo código não entra duas
 *   vezes. `comment` é o gabarito comentado, que só aparece depois de a questão ser respondida.
 * - O gabarito (`answer`) fica vazio quando o PDF não trazia: a questão existe, mas não dá para corrigi-la até o
 *   usuário informar a alternativa certa. `annulled` marca a questão anulada pela banca (não vale resposta).
 * - `suspect` avisa que o texto lido pela IA não bate com o do PDF (possível erro de leitura): é só um aviso.
 * - Os nomes (prova, caderno, filtro) são únicos por usuário, sem diferenciar maiúsculas de minúsculas.
 *
 * Fica num módulo à parte para o banco do app e os testes usarem exatamente o mesmo esquema.
 */
import type { DatabaseSync } from 'node:sqlite';

export const QUESTION_BANK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS qb_exams (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    board      TEXT NOT NULL DEFAULT '',
    organ      TEXT NOT NULL DEFAULT '',
    year       INTEGER,
    position   TEXT NOT NULL DEFAULT '',
    level      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_qb_exams_user_name ON qb_exams(user_id, name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS qb_questions (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exam_id           TEXT NOT NULL REFERENCES qb_exams(id) ON DELETE CASCADE,
    number            INTEGER NOT NULL,
    source_id         TEXT NOT NULL DEFAULT '',
    support           TEXT NOT NULL DEFAULT '',
    statement         TEXT NOT NULL,
    alternatives_json TEXT NOT NULL,
    answer            TEXT NOT NULL DEFAULT '',
    annulled          INTEGER NOT NULL DEFAULT 0,
    comment           TEXT NOT NULL DEFAULT '',
    discipline        TEXT NOT NULL DEFAULT '',
    subject           TEXT NOT NULL DEFAULT '',
    needs_figure      INTEGER NOT NULL DEFAULT 0,
    suspect           INTEGER NOT NULL DEFAULT 0,
    note              TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL,
    UNIQUE (exam_id, number)
  );

  CREATE INDEX IF NOT EXISTS idx_qb_questions_user ON qb_questions(user_id, discipline);

  CREATE TABLE IF NOT EXISTS qb_notebooks (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_qb_notebooks_user_name ON qb_notebooks(user_id, name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS qb_notebook_questions (
    notebook_id TEXT NOT NULL REFERENCES qb_notebooks(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES qb_questions(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (notebook_id, question_id)
  );

  CREATE INDEX IF NOT EXISTS idx_qb_notebook_questions_question ON qb_notebook_questions(question_id);

  CREATE TABLE IF NOT EXISTS qb_attempts (
    id          TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL REFERENCES qb_notebooks(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    finished_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    total       INTEGER NOT NULL,
    correct     INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_qb_attempts_notebook ON qb_attempts(notebook_id);

  CREATE TABLE IF NOT EXISTS qb_answers (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES qb_questions(id) ON DELETE CASCADE,
    attempt_id  TEXT REFERENCES qb_attempts(id) ON DELETE SET NULL,
    chosen      TEXT NOT NULL,
    correct     INTEGER NOT NULL,
    answered_at TEXT NOT NULL,
    duration_ms INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_qb_answers_question ON qb_answers(question_id, answered_at);
  CREATE INDEX IF NOT EXISTS idx_qb_answers_attempt ON qb_answers(attempt_id);

  -- O placar de cada simulado por disciplina, guardado na hora (as em branco não viram resposta, e o caderno
  -- pode mudar depois): é o que se compara com a nota de corte do concurso. Simulados feitos antes desta tabela
  -- existir não têm linhas aqui e só mostram o total.
  CREATE TABLE IF NOT EXISTS qb_attempt_disciplines (
    attempt_id TEXT NOT NULL REFERENCES qb_attempts(id) ON DELETE CASCADE,
    discipline TEXT NOT NULL,
    total      INTEGER NOT NULL,
    correct    INTEGER NOT NULL,
    PRIMARY KEY (attempt_id, discipline)
  );

  CREATE TABLE IF NOT EXISTS qb_saved_filters (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    filter_json TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_qb_saved_filters_user_name ON qb_saved_filters(user_id, name COLLATE NOCASE);
`;

/**
 * Bancos criados antes do código da questão e do gabarito comentado têm qb_questions sem essas colunas (o
 * CREATE TABLE IF NOT EXISTS acima não mexe numa tabela que já existe). Acrescenta-as, vazias, e cria o índice que
 * impede a mesma questão do site de entrar duas vezes. Só acrescenta: nenhuma linha existente muda.
 */
export function upgradeQuestionBankSchema(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(qb_questions)').all() as unknown as { name: string }[];
  const has = (name: string) => columns.some((c) => c.name === name);
  if (!has('source_id')) db.exec("ALTER TABLE qb_questions ADD COLUMN source_id TEXT NOT NULL DEFAULT ''");
  if (!has('comment')) db.exec("ALTER TABLE qb_questions ADD COLUMN comment TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_qb_questions_source ON qb_questions(user_id, source_id) WHERE source_id != ''");
}
