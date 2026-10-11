/**
 * O acompanhamento de um concurso: para cada tópico e disciplina, quanto já
 * existe de material (cobertura) e como anda o estudo dele. Tudo derivado das
 * coleções vinculadas e do histórico de revisões — nada é digitado à mão.
 */

export interface CollectionStat {
  id: string;
  cards: number;
  /** Nunca estudados (sem data de revisão). */
  newCards: number;
  /** Já estudados e com a revisão vencida. */
  dueCards: number;
  /** Revisões feitas nos últimos 30 dias e quantas delas não foram "Errei". */
  reviews30: number;
  passed30: number;
}

export interface ExamStructure {
  disciplines: {
    id: string;
    name: string;
    questionCount: number | null;
    weight: number | null;
    cutoff: string;
    topics: { id: string; title: string }[];
  }[];
}

/** topicId -> ids das coleções vinculadas. */
export type TopicLinks = Map<string, string[]>;

export interface Rollup {
  cards: number;
  newCards: number;
  dueCards: number;
  /** % de revisões dos últimos 30 dias que não foram "Errei"; null sem revisões. */
  approvalPct: number | null;
}

export interface TopicProgress extends Rollup {
  id: string;
  title: string;
  collectionIds: string[];
  /** Tem ao menos um cartão nas coleções vinculadas. */
  hasMaterial: boolean;
}

export interface DisciplineProgress extends Rollup {
  id: string;
  name: string;
  questionCount: number | null;
  weight: number | null;
  cutoff: string;
  topicCount: number;
  coveredTopics: number;
  /** null quando a disciplina não tem tópicos. */
  coveragePct: number | null;
  topics: TopicProgress[];
}

export interface ExamProgress {
  disciplines: DisciplineProgress[];
  overall: Rollup & {
    disciplineCount: number;
    topicCount: number;
    coveredTopics: number;
    coveragePct: number | null;
    /** A cobertura geral usa o número de questões de cada disciplina como peso. */
    weightedByQuestions: boolean;
  };
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

// Soma sobre coleções distintas: um cartão nunca conta duas vezes só porque a
// coleção foi vinculada a mais de um tópico.
function rollup(collectionIds: Iterable<string>, stats: Map<string, CollectionStat>): Rollup {
  let cards = 0;
  let newCards = 0;
  let dueCards = 0;
  let reviews = 0;
  let passed = 0;
  for (const id of new Set(collectionIds)) {
    const stat = stats.get(id);
    if (!stat) continue;
    cards += stat.cards;
    newCards += stat.newCards;
    dueCards += stat.dueCards;
    reviews += stat.reviews30;
    passed += stat.passed30;
  }
  return { cards, newCards, dueCards, approvalPct: pct(passed, reviews) };
}

export function buildExamProgress(
  structure: ExamStructure,
  links: TopicLinks,
  collectionStats: CollectionStat[],
): ExamProgress {
  const stats = new Map(collectionStats.map((s) => [s.id, s]));

  const disciplines: DisciplineProgress[] = structure.disciplines.map((discipline) => {
    const topics: TopicProgress[] = discipline.topics.map((topic) => {
      const collectionIds = [...new Set(links.get(topic.id) ?? [])].filter((id) => stats.has(id));
      const sums = rollup(collectionIds, stats);
      return { id: topic.id, title: topic.title, collectionIds, hasMaterial: sums.cards > 0, ...sums };
    });

    const coveredTopics = topics.filter((t) => t.hasMaterial).length;
    return {
      id: discipline.id,
      name: discipline.name,
      questionCount: discipline.questionCount,
      weight: discipline.weight,
      cutoff: discipline.cutoff,
      topicCount: topics.length,
      coveredTopics,
      coveragePct: pct(coveredTopics, topics.length),
      topics,
      ...rollup(
        topics.flatMap((t) => t.collectionIds),
        stats,
      ),
    };
  });

  const allTopics = disciplines.flatMap((d) => d.topics);
  const coveredTopics = allTopics.filter((t) => t.hasMaterial).length;

  // Com o número de questões de todas as disciplinas, a cobertura geral pesa
  // cada uma por ele (10 questões valem mais que 3). Sem isso em alguma delas,
  // cai pra contagem simples de tópicos — misturar os dois critérios daria um
  // número sem significado.
  const withTopics = disciplines.filter((d) => d.topicCount > 0);
  const weightedByQuestions = withTopics.length > 0 && withTopics.every((d) => d.questionCount !== null);
  let coveragePct: number | null;
  if (weightedByQuestions) {
    const totalQuestions = withTopics.reduce((sum, d) => sum + (d.questionCount ?? 0), 0);
    const weighted = withTopics.reduce((sum, d) => sum + (d.questionCount ?? 0) * (d.coveredTopics / d.topicCount), 0);
    coveragePct = pct(weighted, totalQuestions);
  } else {
    coveragePct = pct(coveredTopics, allTopics.length);
  }

  return {
    disciplines,
    overall: {
      disciplineCount: disciplines.length,
      topicCount: allTopics.length,
      coveredTopics,
      coveragePct,
      weightedByQuestions,
      ...rollup(
        allTopics.flatMap((t) => t.collectionIds),
        stats,
      ),
    },
  };
}

/**
 * Dias de calendário até a prova (negativo se já passou), contados no dia
 * local. Feito por número do dia em UTC pra o horário de verão não dar 23h/25h.
 */
export function daysUntil(examDate: string | null, now: Date): number | null {
  if (!examDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(examDate);
  if (!match) return null;
  const exam = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((exam - today) / 86_400_000);
}
