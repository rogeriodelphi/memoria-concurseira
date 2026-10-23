import type { DatabaseSync } from 'node:sqlite';

import { notFrozen } from '../collections/frozen';
import { nextExam, type NextExam } from './nextExam';

/**
 * A ordem em que os cartões NOVOS (nunca estudados) entram na fila de revisão. Só importa quando há
 * limite diário: sem limite entram todos, e a ordem não muda nada.
 *
 * - `created` (o padrão, como sempre foi): do mais antigo para o mais novo, para um lote ser estudado
 *   por inteiro antes do seguinte.
 * - `exam`: pelo peso das disciplinas do concurso mais próximo (ver `pickByExamWeight`).
 */
export type NewCardOrder = 'created' | 'exam';

export type OrderResult = { ok: true; value: NewCardOrder } | { ok: false; error: string };

export function parseNewCardOrder(raw: unknown): OrderResult {
  if (raw === 'created' || raw === 'exam') return { ok: true, value: raw };
  return { ok: false, error: 'Ordem inválida: use "created" (ordem de criação) ou "exam" (pelo edital).' };
}

export function getNewCardOrder(db: DatabaseSync, userId: string): NewCardOrder {
  const row = db.prepare('SELECT new_card_order AS value FROM users WHERE id = ?').get(userId) as unknown as
    | { value: string }
    | undefined;
  return row?.value === 'exam' ? 'exam' : 'created';
}

export function setNewCardOrder(db: DatabaseSync, userId: string, raw: unknown): OrderResult {
  const parsed = parseNewCardOrder(raw);
  if (!parsed.ok) return parsed;
  db.prepare('UPDATE users SET new_card_order = ? WHERE id = ?').run(parsed.value, userId);
  return parsed;
}

// ---------- a escolha, pura ----------

export interface NewCardRef {
  id: string;
  /** A disciplina a que o cartão pertence; `null` para cartões que não estão ligados ao edital. */
  group: string | null;
}

/**
 * Escolhe `count` cartões novos mantendo cada disciplina na proporção dos seus pontos (questões vezes
 * peso). A cada escolha entra um cartão da disciplina mais ATRASADA em relação à sua cota:
 * `cota = pontos / total · (cartões já estudados + 1) − cartões já estudados dela`. Isso tem três efeitos:
 *
 * - Com um lote grande, cada disciplina recebe a sua fatia (50 pontos contra 10: cinco cartões para um).
 * - Com um lote pequeno, o resultado de um dia continua o do dia anterior (a conta usa o que já foi
 *   estudado), em vez de recomeçar e dar sempre a mesma disciplina. Nenhuma passa fome.
 * - Uma disciplina que ficou para trás (por ter sido estudada menos) é alcançada primeiro.
 *
 * Disciplinas sem nenhum cartão não entram na conta. Dentro de cada uma, vale a ordem recebida (a de
 * criação). Os cartões sem disciplina só entram depois que os das disciplinas acabam.
 *
 * @param newCards os novos, na ordem de criação
 * @param learnedByGroup quantos cartões já estudados cada disciplina tem
 * @param points os pontos de cada disciplina (a ordem de inserção desempata, a da prova)
 */
export function pickByExamWeight(input: {
  newCards: readonly NewCardRef[];
  learnedByGroup: ReadonlyMap<string, number>;
  points: ReadonlyMap<string, number>;
  count: number;
}): string[] {
  const { newCards, learnedByGroup, points } = input;
  const count = Math.max(0, Math.floor(input.count));

  const queues = new Map<string, string[]>();
  const unlinked: string[] = [];
  for (const card of newCards) {
    if (card.group !== null && (points.get(card.group) ?? 0) > 0) {
      const queue = queues.get(card.group) ?? [];
      queue.push(card.id);
      queues.set(card.group, queue);
    } else {
      unlinked.push(card.id);
    }
  }

  // Só contam as disciplinas que têm algum cartão (novo ou já estudado): é com elas que a prova se reparte.
  const groups = [...points.keys()].filter((g) => (points.get(g) ?? 0) > 0 && ((queues.get(g)?.length ?? 0) > 0 || (learnedByGroup.get(g) ?? 0) > 0));
  const totalPoints = groups.reduce((sum, g) => sum + points.get(g)!, 0);
  const done = new Map(groups.map((g) => [g, learnedByGroup.get(g) ?? 0]));
  let total = [...done.values()].reduce((sum, n) => sum + n, 0);

  const picked: string[] = [];
  while (picked.length < count && totalPoints > 0) {
    let best: string | null = null;
    let bestQuota = -Infinity;
    for (const group of groups) {
      if ((queues.get(group)?.length ?? 0) === 0) continue;
      const quota = (points.get(group)! / totalPoints) * (total + 1) - done.get(group)!;
      const better =
        best === null ||
        quota > bestQuota + 1e-9 ||
        (Math.abs(quota - bestQuota) <= 1e-9 && points.get(group)! > points.get(best)!);
      if (better) {
        best = group;
        bestQuota = quota;
      }
    }
    if (best === null) break;
    picked.push(queues.get(best)!.shift()!);
    done.set(best, done.get(best)! + 1);
    total++;
  }

  for (const id of unlinked) {
    if (picked.length >= count) break;
    picked.push(id);
  }
  return picked;
}

// ---------- o edital no banco ----------

export interface DisciplinePoints {
  id: string;
  name: string;
  questions: number | null;
  weight: number | null;
  points: number;
}

export interface ExamOrderContext {
  exam: NextExam;
  /** As disciplinas na ordem da prova. */
  disciplines: DisciplinePoints[];
  /** A disciplina de cada coleção ligada a algum tópico. Se estiver ligada a mais de uma, vale a de mais pontos. */
  collectionGroup: Map<string, string>;
}

/**
 * Os pontos de cada disciplina: questões vezes peso. Sem número de questões, vale a média das que têm
 * (ou 1, se nenhuma tem); sem peso, 1. Assim uma prova sem nenhum dado repartido reparte por igual.
 */
export function disciplinePoints(
  rows: { id: string; name: string; question_count: number | null; weight: number | null }[],
): DisciplinePoints[] {
  const known = rows.map((r) => r.question_count).filter((n): n is number => n !== null && n > 0);
  const average = known.length > 0 ? known.reduce((sum, n) => sum + n, 0) / known.length : 1;
  return rows.map((r) => {
    const weight = r.weight !== null && r.weight > 0 ? r.weight : 1;
    const questions = r.question_count !== null && r.question_count > 0 ? r.question_count : null;
    return { id: r.id, name: r.name, questions, weight: r.weight, points: (questions ?? average) * weight };
  });
}

/**
 * O edital do concurso mais próximo com data, ou `null` se o usuário não tem nenhum. Com `chosen` (o concurso que uma tela
 * escolheu) vale esse; `null` explícito é "nenhum". Sem o argumento, o mais próximo, como sempre foi.
 */
export function loadExamOrderContext(db: DatabaseSync, userId: string, now: Date, chosen?: NextExam | null): ExamOrderContext | null {
  const exam = chosen === undefined ? nextExam(db, userId, now) : chosen;
  if (!exam) return null;

  const disciplines = disciplinePoints(
    db
      .prepare('SELECT id, name, question_count, weight FROM exam_disciplines WHERE exam_id = ? ORDER BY position, rowid')
      .all(exam.id) as unknown as { id: string; name: string; question_count: number | null; weight: number | null }[],
  );
  const pointsOf = new Map(disciplines.map((d) => [d.id, d.points]));
  const order = new Map(disciplines.map((d, i) => [d.id, i]));

  const links = db
    .prepare(
      `SELECT DISTINCT l.collection_id AS collection_id, d.id AS discipline_id
       FROM exam_topic_collections l
       JOIN exam_topics t ON t.id = l.topic_id
       JOIN exam_disciplines d ON d.id = t.discipline_id
       JOIN collections c ON c.id = l.collection_id
       WHERE d.exam_id = ? AND c.user_id = ?`,
    )
    .all(exam.id, userId) as unknown as { collection_id: string; discipline_id: string }[];

  const collectionGroup = new Map<string, string>();
  for (const link of links) {
    const current = collectionGroup.get(link.collection_id);
    const better =
      current === undefined ||
      pointsOf.get(link.discipline_id)! > pointsOf.get(current)! ||
      (pointsOf.get(link.discipline_id)! === pointsOf.get(current)! && order.get(link.discipline_id)! < order.get(current)!);
    if (better) collectionGroup.set(link.collection_id, link.discipline_id);
  }
  return { exam, disciplines, collectionGroup };
}

interface NewCardRow {
  id: string;
  collection_id: string;
}

/**
 * Os novos do usuário (fora os das coleções congeladas), do mais antigo ao mais novo, e quantos cartões já estudados há
 * por coleção (esses contam também nas congeladas: o que já foi aprendido continua valendo para o equilíbrio).
 */
function loadCards(db: DatabaseSync, userId: string) {
  const newCards = db
    .prepare(
      `SELECT f.id, f.collection_id FROM flashcards f JOIN collections c ON c.id = f.collection_id
       WHERE c.user_id = ? AND f.due_at IS NULL AND ${notFrozen('c.id')} ORDER BY f.created_at ASC, f.rowid ASC`,
    )
    .all(userId) as unknown as NewCardRow[];
  const learned = db
    .prepare(
      `SELECT f.collection_id, COUNT(*) AS n FROM flashcards f JOIN collections c ON c.id = f.collection_id
       WHERE c.user_id = ? AND f.due_at IS NOT NULL GROUP BY f.collection_id`,
    )
    .all(userId) as unknown as { collection_id: string; n: number }[];
  return { newCards, learned };
}

/**
 * Os `count` próximos cartões novos pelo edital, ou `null` se não há concurso com data (e então vale a
 * ordem de criação). Só os ids: quem chama busca os cartões.
 */
export function pickNewCardIdsByExam(db: DatabaseSync, userId: string, now: Date, count: number): string[] | null {
  const context = loadExamOrderContext(db, userId, now);
  if (!context) return null;
  const { newCards, learned } = loadCards(db, userId);

  const learnedByGroup = new Map<string, number>();
  for (const row of learned) {
    const group = context.collectionGroup.get(row.collection_id);
    if (group) learnedByGroup.set(group, (learnedByGroup.get(group) ?? 0) + row.n);
  }
  return pickByExamWeight({
    newCards: newCards.map((card) => ({ id: card.id, group: context.collectionGroup.get(card.collection_id) ?? null })),
    learnedByGroup,
    points: new Map(context.disciplines.map((d) => [d.id, d.points])),
    count,
  });
}

// ---------- o resumo para a tela ----------

export interface NewOrderOverview {
  order: NewCardOrder;
  exam: NextExam | null;
  disciplines: {
    id: string;
    name: string;
    questions: number | null;
    weight: number | null;
    /** A fatia da prova (pontos da disciplina sobre o total), em %. */
    sharePct: number;
    /**
     * A cota que a ordem pelo edital usa: a mesma fatia, mas só entre as disciplinas que têm algum cartão
     * (as sem cartão não têm como entrar). `null` para a disciplina sem nenhum cartão.
     */
    quotaPct: number | null;
    newCards: number;
    learnedCards: number;
    /** Que parte de todos os cartões já estudados (das disciplinas do edital) é desta, em %. `null` sem nenhum estudado. */
    learnedSharePct: number | null;
  }[];
  /** Cartões novos que não estão em nenhuma coleção ligada ao edital (entram por último). */
  unlinkedNew: number;
}

export function loadNewOrderOverview(db: DatabaseSync, userId: string, now: Date = new Date()): NewOrderOverview {
  const order = getNewCardOrder(db, userId);
  const context = loadExamOrderContext(db, userId, now);
  if (!context) return { order, exam: null, disciplines: [], unlinkedNew: 0 };

  const { newCards, learned } = loadCards(db, userId);
  const newBy = new Map<string, number>();
  const learnedBy = new Map<string, number>();
  let unlinkedNew = 0;
  for (const card of newCards) {
    const group = context.collectionGroup.get(card.collection_id);
    if (group) newBy.set(group, (newBy.get(group) ?? 0) + 1);
    else unlinkedNew++;
  }
  for (const row of learned) {
    const group = context.collectionGroup.get(row.collection_id);
    if (group) learnedBy.set(group, (learnedBy.get(group) ?? 0) + row.n);
  }
  const hasCards = (id: string) => (newBy.get(id) ?? 0) + (learnedBy.get(id) ?? 0) > 0;
  const totalPoints = context.disciplines.reduce((sum, d) => sum + d.points, 0);
  const quotaTotal = context.disciplines.filter((d) => hasCards(d.id)).reduce((sum, d) => sum + d.points, 0);
  const learnedTotal = [...learnedBy.values()].reduce((sum, n) => sum + n, 0);
  return {
    order,
    exam: context.exam,
    disciplines: context.disciplines.map((d) => ({
      id: d.id,
      name: d.name,
      questions: d.questions,
      weight: d.weight,
      sharePct: totalPoints > 0 ? Math.round((d.points / totalPoints) * 100) : 0,
      quotaPct: hasCards(d.id) && quotaTotal > 0 ? Math.round((d.points / quotaTotal) * 100) : null,
      newCards: newBy.get(d.id) ?? 0,
      learnedCards: learnedBy.get(d.id) ?? 0,
      learnedSharePct: hasCards(d.id) && learnedTotal > 0 ? Math.round(((learnedBy.get(d.id) ?? 0) / learnedTotal) * 100) : null,
    })),
    unlinkedNew,
  };
}
