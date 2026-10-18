/**
 * O filtro do banco de questões (o painel de "Questões objetivas"): o que o usuário marca, como isso é lido do
 * que o navegador manda e como vira uma consulta SQL. Todo valor entra como parâmetro, nunca no texto do SQL.
 */

export const STATUSES = ['resolvidas', 'nao_resolvidas', 'acertei', 'errei'] as const;
export type Status = (typeof STATUSES)[number];

export const ORDERS = ['prova', 'importacao', 'disciplina'] as const;
export type Order = (typeof ORDERS)[number];

export const PAGE_SIZES = [10, 20, 50] as const;
export const MAX_FILTER_VALUES = 50;
export const MAX_KEYWORD_CHARS = 100;
export const MAX_KEYWORDS = 8;

export interface QuestionFilter {
  /** "Minhas questões": vale qualquer um dos marcados (acertei e errei já são subconjuntos de resolvidas). */
  status: Status[];
  /** Palavras que precisam aparecer no enunciado, nas alternativas, no texto de apoio, na disciplina ou no assunto. */
  q: string;
  discipline: string[];
  subject: string[];
  board: string[];
  organ: string[];
  year: number[];
  position: string[];
  level: string[];
  exam: string[];
  /** Só as questões deste caderno. */
  notebook: string;
  excludeInNotebooks: boolean;
  excludeAnnulled: boolean;
  /** Sem gabarito não dá para responder: o filtro pode deixá-las de fora. */
  excludeNoAnswer: boolean;
  onlyWithNote: boolean;
}

export const EMPTY_FILTER: QuestionFilter = {
  status: [],
  q: '',
  discipline: [],
  subject: [],
  board: [],
  organ: [],
  year: [],
  position: [],
  level: [],
  exam: [],
  notebook: '',
  excludeInNotebooks: false,
  excludeAnnulled: false,
  excludeNoAnswer: false,
  onlyWithNote: false,
};

const strings = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(/\s+/g, ' ').trim().slice(0, 200));
  // Vazio é um valor válido ("sem disciplina"); só não se repete.
  return [...new Set(values)].slice(0, MAX_FILTER_VALUES);
};

/** Lê o filtro vindo de fora, ignorando o que não for reconhecido: nunca falha, e o que sobra é seguro para a consulta. */
export function parseFilter(raw: unknown): QuestionFilter {
  const input = (raw ?? {}) as Record<string, unknown>;
  const status = (Array.isArray(input.status) ? input.status : []).filter((s): s is Status =>
    (STATUSES as readonly unknown[]).includes(s),
  );
  const years = (Array.isArray(input.year) ? input.year : [])
    .map((y) => (typeof y === 'number' ? y : Number(y)))
    .filter((y) => Number.isInteger(y) && y >= 1950 && y <= 2100);
  return {
    status: [...new Set(status)],
    q: typeof input.q === 'string' ? input.q.replace(/\s+/g, ' ').trim().slice(0, MAX_KEYWORD_CHARS) : '',
    discipline: strings(input.discipline),
    subject: strings(input.subject),
    board: strings(input.board),
    organ: strings(input.organ),
    year: [...new Set(years)].slice(0, MAX_FILTER_VALUES),
    position: strings(input.position),
    level: strings(input.level),
    exam: strings(input.exam).filter(Boolean),
    notebook: typeof input.notebook === 'string' ? input.notebook.slice(0, 100) : '',
    excludeInNotebooks: input.excludeInNotebooks === true,
    excludeAnnulled: input.excludeAnnulled === true,
    excludeNoAnswer: input.excludeNoAnswer === true,
    onlyWithNote: input.onlyWithNote === true,
  };
}

/** Quantos critérios o filtro tem ligados (o que o botão "Limpar" desfaz). */
export function activeCount(filter: QuestionFilter): number {
  return (
    (filter.status.length > 0 ? 1 : 0) +
    (filter.q ? 1 : 0) +
    [filter.discipline, filter.subject, filter.board, filter.organ, filter.year, filter.position, filter.level, filter.exam].filter(
      (list) => list.length > 0,
    ).length +
    (filter.notebook ? 1 : 0) +
    [filter.excludeInNotebooks, filter.excludeAnnulled, filter.excludeNoAnswer, filter.onlyWithNote].filter(Boolean).length
  );
}

/**
 * A consulta das questões de `filter` (apelidos: q = qb_questions, e = qb_exams, la = a última resposta de q).
 * O `FROM` já traz os joins; `where` começa em "WHERE" e `params` na ordem em que os `?` aparecem.
 */
export const QUESTION_FROM = `
  FROM qb_questions q
  JOIN qb_exams e ON e.id = q.exam_id
  LEFT JOIN qb_answers la ON la.id = (
    SELECT a.id FROM qb_answers a WHERE a.question_id = q.id ORDER BY a.answered_at DESC, a.rowid DESC LIMIT 1
  )`;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export function buildWhere(userId: string, filter: QuestionFilter): { where: string; params: (string | number)[] } {
  const clauses = ['q.user_id = ?'];
  const params: (string | number)[] = [userId];

  const inList = (column: string, values: (string | number)[], nocase: boolean) => {
    if (values.length === 0) return;
    clauses.push(`${column} ${nocase ? 'COLLATE NOCASE ' : ''}IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  };
  inList('q.discipline', filter.discipline, true);
  inList('q.subject', filter.subject, true);
  inList('e.board', filter.board, true);
  inList('e.organ', filter.organ, true);
  inList('e.year', filter.year, false);
  inList('e.position', filter.position, true);
  inList('e.level', filter.level, true);
  inList('q.exam_id', filter.exam, false);

  if (filter.status.length > 0) {
    const parts = filter.status.map((s) => {
      switch (s) {
        case 'resolvidas':
          return 'la.id IS NOT NULL';
        case 'nao_resolvidas':
          return 'la.id IS NULL';
        case 'acertei':
          return '(la.correct = 1 AND q.annulled = 0)';
        case 'errei':
          return '(la.correct = 0 AND q.annulled = 0)';
      }
    });
    clauses.push(`(${parts.join(' OR ')})`);
  }

  for (const word of filter.q.split(' ').filter(Boolean).slice(0, MAX_KEYWORDS)) {
    clauses.push(
      `(q.statement LIKE ? ESCAPE '\\' OR q.support LIKE ? ESCAPE '\\' OR q.alternatives_json LIKE ? ESCAPE '\\'` +
        ` OR q.discipline LIKE ? ESCAPE '\\' OR q.subject LIKE ? ESCAPE '\\')`,
    );
    const like = `%${escapeLike(word)}%`;
    params.push(like, like, like, like, like);
  }

  if (filter.notebook) {
    clauses.push('EXISTS (SELECT 1 FROM qb_notebook_questions nq WHERE nq.question_id = q.id AND nq.notebook_id = ?)');
    params.push(filter.notebook);
  }
  if (filter.excludeInNotebooks) {
    clauses.push('NOT EXISTS (SELECT 1 FROM qb_notebook_questions nq WHERE nq.question_id = q.id)');
  }
  if (filter.excludeAnnulled) clauses.push('q.annulled = 0');
  if (filter.excludeNoAnswer) clauses.push("(q.answer != '' OR q.annulled = 1)");
  if (filter.onlyWithNote) clauses.push("q.note != ''");

  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

const ORDER_SQL: Record<Order, string> = {
  prova: '(e.year IS NULL), e.year DESC, e.name COLLATE NOCASE, q.number',
  importacao: 'e.created_at DESC, e.name COLLATE NOCASE, q.number',
  disciplina: 'q.discipline COLLATE NOCASE, q.subject COLLATE NOCASE, (e.year IS NULL), e.year DESC, q.number',
};

export function orderSql(order: unknown): string {
  return ORDER_SQL[(ORDERS as readonly unknown[]).includes(order) ? (order as Order) : 'prova'];
}
