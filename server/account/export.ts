import type { DatabaseSync } from 'node:sqlite';

/**
 * A exportação dos dados de UMA conta, num arquivo só. Só entram linhas do usuário pedido, e a senha
 * nunca sai. O app tem cadastro aberto e fica acessível na rede, então não existe (de propósito)
 * uma exportação do banco inteiro: qualquer conta levaria os dados das outras.
 *
 * As linhas saem como estão no banco (colunas em snake_case), sem tradução, para que um importador
 * futuro leia exatamente o que foi gravado.
 */

export const EXPORT_FORMAT = 'base-concurseira-exportacao';
export const EXPORT_VERSION = 1;

interface ExportedTable {
  table: string;
  /** Recebe o id do usuário como único parâmetro e devolve só as linhas dele. */
  sql: string;
}

const EXPORTED: ExportedTable[] = [
  { table: 'collections', sql: 'SELECT * FROM collections WHERE user_id = ? ORDER BY rowid' },
  {
    table: 'documents',
    sql: `SELECT d.* FROM documents d JOIN collections c ON c.id = d.collection_id
          WHERE c.user_id = ? ORDER BY d.rowid`,
  },
  {
    table: 'flashcards',
    sql: `SELECT f.* FROM flashcards f JOIN collections c ON c.id = f.collection_id
          WHERE c.user_id = ? ORDER BY f.rowid`,
  },
  {
    table: 'card_choices',
    sql: `SELECT cc.* FROM card_choices cc
          JOIN flashcards f ON f.id = cc.flashcard_id
          JOIN collections c ON c.id = f.collection_id
          WHERE c.user_id = ? ORDER BY cc.rowid`,
  },
  { table: 'study_sessions', sql: 'SELECT * FROM study_sessions WHERE user_id = ? ORDER BY rowid' },
  { table: 'summaries', sql: 'SELECT * FROM summaries WHERE user_id = ? ORDER BY rowid' },
  { table: 'bullet_points', sql: 'SELECT * FROM bullet_points WHERE user_id = ? ORDER BY rowid' },
  { table: 'mind_maps', sql: 'SELECT * FROM mind_maps WHERE user_id = ? ORDER BY rowid' },
  { table: 'exams', sql: 'SELECT * FROM exams WHERE user_id = ? ORDER BY rowid' },
  {
    table: 'exam_disciplines',
    sql: `SELECT d.* FROM exam_disciplines d JOIN exams e ON e.id = d.exam_id
          WHERE e.user_id = ? ORDER BY d.rowid`,
  },
  {
    table: 'exam_topics',
    sql: `SELECT t.* FROM exam_topics t
          JOIN exam_disciplines d ON d.id = t.discipline_id
          JOIN exams e ON e.id = d.exam_id
          WHERE e.user_id = ? ORDER BY t.rowid`,
  },
  {
    table: 'exam_topic_collections',
    sql: `SELECT l.* FROM exam_topic_collections l
          JOIN exam_topics t ON t.id = l.topic_id
          JOIN exam_disciplines d ON d.id = t.discipline_id
          JOIN exams e ON e.id = d.exam_id
          WHERE e.user_id = ? ORDER BY l.rowid`,
  },
  { table: 'mock_exams', sql: 'SELECT * FROM mock_exams WHERE user_id = ? ORDER BY rowid' },
  {
    table: 'mock_exam_cards',
    sql: `SELECT mc.* FROM mock_exam_cards mc JOIN mock_exams m ON m.id = mc.mock_exam_id
          WHERE m.user_id = ? ORDER BY mc.rowid`,
  },
  { table: 'mock_exam_attempts', sql: 'SELECT * FROM mock_exam_attempts WHERE user_id = ? ORDER BY rowid' },
  {
    table: 'mock_exam_answers',
    sql: `SELECT ma.* FROM mock_exam_answers ma JOIN mock_exam_attempts a ON a.id = ma.attempt_id
          WHERE a.user_id = ? ORDER BY ma.rowid`,
  },
  { table: 'pomodoro_tasks', sql: 'SELECT * FROM pomodoro_tasks WHERE user_id = ? ORDER BY rowid' },
  { table: 'pomodoro_notes', sql: 'SELECT * FROM pomodoro_notes WHERE user_id = ? ORDER BY rowid' },
  { table: 'ai_usage', sql: 'SELECT * FROM ai_usage WHERE user_id = ? ORDER BY rowid' },
];

/**
 * As tabelas que NÃO entram em `tabelas`, e por quê. Toda tabela do banco precisa estar aqui ou em
 * `EXPORTED` (um teste confere): é o que impede uma tabela nova de ficar fora da exportação sem ninguém notar.
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  users: 'vai no campo "usuario", sem a senha',
  ai_provider_status: 'estado do servidor (qual provedor de IA está funcionando); não é dado do usuário',
};

export const EXPORTED_TABLES: readonly string[] = EXPORTED.map((e) => e.table);

export interface AccountExport {
  formato: typeof EXPORT_FORMAT;
  versao: number;
  exportadoEm: string;
  usuario: Record<string, unknown>;
  /** Quantas linhas saíram de cada tabela. */
  contagens: Record<string, number>;
  tabelas: Record<string, Record<string, unknown>[]>;
}

/** O nome sugerido para o arquivo baixado: `base-concurseira-2026-10-17.json`. */
export function exportFilename(now: Date): string {
  return `base-concurseira-${now.toISOString().slice(0, 10)}.json`;
}

/** Os dados da conta `userId`, ou `null` se ela não existe. */
export function buildAccountExport(db: DatabaseSync, userId: string, now: Date = new Date()): AccountExport | null {
  const user = db
    .prepare('SELECT id, name, email, created_at, monthly_token_budget, daily_new_limit FROM users WHERE id = ?')
    .get(userId);
  if (!user) return null;

  const tabelas: AccountExport['tabelas'] = {};
  const contagens: AccountExport['contagens'] = {};
  for (const { table, sql } of EXPORTED) {
    // As linhas do node:sqlite vêm sem protótipo; copiadas, viram objetos comuns.
    const rows = (db.prepare(sql).all(userId) as Record<string, unknown>[]).map((row) => ({ ...row }));
    tabelas[table] = rows;
    contagens[table] = rows.length;
  }

  return {
    formato: EXPORT_FORMAT,
    versao: EXPORT_VERSION,
    exportadoEm: now.toISOString(),
    usuario: { ...user },
    contagens,
    tabelas,
  };
}
