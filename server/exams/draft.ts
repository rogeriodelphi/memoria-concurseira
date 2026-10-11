/**
 * A estrutura de um concurso (disciplinas e tópicos) como ela trafega: sai da
 * IA, é editada na tela de revisão e volta pra ser salva. Nos três casos o
 * conteúdo não é confiável — a IA erra e o cliente pode mandar qualquer coisa —,
 * então tudo passa por `normalizeDraft` antes de tocar o banco.
 */

export interface TopicDraft {
  /** Só existe em tópicos já salvos; é o que preserva os vínculos ao editar. */
  id?: string;
  title: string;
}

export interface DisciplineDraft {
  id?: string;
  name: string;
  questionCount: number | null;
  weight: number | null;
  /** Critério mínimo da disciplina, em texto livre (ex.: "mínimo de 50% dos pontos"). */
  cutoff: string;
  topics: TopicDraft[];
}

export interface ExamDraft {
  name: string;
  position: string;
  board: string;
  /** AAAA-MM-DD ou null. */
  examDate: string | null;
  disciplines: DisciplineDraft[];
}

export const LIMITS = {
  disciplines: 60,
  topicsPerDiscipline: 300,
  totalTopics: 1500,
  name: 200,
  meta: 120,
  cutoff: 160,
  topic: 500,
  maxQuestions: 1000,
  maxWeight: 1000,
} as const;

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : undefined;
}

function cleanQuestionCount(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= LIMITS.maxQuestions ? n : null;
}

function cleanWeight(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > LIMITS.maxWeight) return null;
  return Math.round(n * 100) / 100;
}

/** Aceita só uma data de calendário que existe (nada de 2026-02-31). */
export function cleanExamDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid && year >= 2000 && year <= 2100 ? match[0] : null;
}

export interface NormalizedDraft {
  draft: ExamDraft;
  /** Verdadeiro se algum limite de tamanho cortou conteúdo. */
  truncated: boolean;
}

/**
 * Sempre devolve algo utilizável: descarta o que é lixo (nomes vazios,
 * tópicos repetidos) e corta o que passa dos limites. `truncated` avisa quando
 * houve corte — um rascunho da IA aceita isso, mas uma estrutura que o usuário
 * está salvando não deve perder conteúdo em silêncio.
 */
export function normalizeDraft(raw: unknown): NormalizedDraft {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let truncated = false;
  let totalTopics = 0;

  const rawDisciplines = Array.isArray(input.disciplines) ? input.disciplines : [];
  if (rawDisciplines.length > LIMITS.disciplines) truncated = true;

  const disciplines: DisciplineDraft[] = [];
  for (const rawDiscipline of rawDisciplines.slice(0, LIMITS.disciplines)) {
    const d = (rawDiscipline && typeof rawDiscipline === 'object' ? rawDiscipline : {}) as Record<string, unknown>;
    const name = cleanText(d.name, LIMITS.name);
    if (!name) continue;

    const rawTopics = Array.isArray(d.topics) ? d.topics : [];
    const topics: TopicDraft[] = [];
    const seen = new Set<string>();
    for (const rawTopic of rawTopics) {
      const t = (typeof rawTopic === 'string' ? { title: rawTopic } : rawTopic) as Record<string, unknown> | null;
      const title = cleanText(t?.title, LIMITS.topic);
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      if (topics.length >= LIMITS.topicsPerDiscipline || totalTopics >= LIMITS.totalTopics) {
        truncated = true;
        continue;
      }
      seen.add(key);
      totalTopics++;
      topics.push({ id: cleanId(t?.id), title });
    }

    disciplines.push({
      id: cleanId(d.id),
      name,
      questionCount: cleanQuestionCount(d.questionCount),
      weight: cleanWeight(d.weight),
      cutoff: cleanText(d.cutoff, LIMITS.cutoff),
      topics,
    });
  }

  return {
    truncated,
    draft: {
      name: cleanText(input.name, LIMITS.name),
      position: cleanText(input.position, LIMITS.meta),
      board: cleanText(input.board, LIMITS.meta),
      examDate: cleanExamDate(input.examDate),
      disciplines,
    },
  };
}
