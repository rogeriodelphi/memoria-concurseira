/**
 * Banco de questões do lado do navegador, sem React: o filtro vazio, os "chips" do que está aplicado, a leitura do
 * filtro guardado, a paginação e as frases curtas que o cartão da questão mostra.
 */
import type { QbDraftQuestion, QbFacets, QbFilter, QbQuestion, QbStatus } from '../types';

export const EMPTY_FILTER: QbFilter = {
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
  onlyWithComment: false,
};

export const STATUS_LABEL: Record<QbStatus, string> = {
  resolvidas: 'Resolvidas',
  nao_resolvidas: 'Não resolvidas',
  acertei: 'Acertei',
  errei: 'Errei',
};

export const PAGE_SIZES = [10, 20, 50] as const;

export const ORDER_LABEL = {
  prova: 'Prova mais recente',
  importacao: 'Última importação',
  disciplina: 'Disciplina',
} as const;

/** Os campos de lista do filtro e o nome de cada um na tela. */
export const LIST_FIELDS = [
  { key: 'discipline', label: 'Disciplina' },
  { key: 'subject', label: 'Assunto' },
  { key: 'board', label: 'Banca' },
  { key: 'level', label: 'Nível' },
  { key: 'position', label: 'Cargo' },
  { key: 'year', label: 'Ano' },
  { key: 'organ', label: 'Órgão' },
  { key: 'exam', label: 'Prova' },
] as const;

export type ListFieldKey = (typeof LIST_FIELDS)[number]['key'];

export const FLAG_LABEL = {
  excludeInNotebooks: 'Que já estão em cadernos',
  excludeAnnulled: 'Anuladas',
  excludeNoAnswer: 'Sem gabarito',
  onlyWithNote: 'Só com minhas anotações',
  onlyWithComment: 'Com gabarito comentado',
} as const;

export type FlagKey = keyof typeof FLAG_LABEL;

/** Liga ou desliga um valor numa lista. */
export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Quantos critérios estão ligados (o que o botão "Limpar" desfaz). */
export function activeCount(filter: QbFilter): number {
  return (
    (filter.status.length > 0 ? 1 : 0) +
    (filter.q.trim() ? 1 : 0) +
    LIST_FIELDS.filter((f) => filter[f.key].length > 0).length +
    (filter.notebook ? 1 : 0) +
    (Object.keys(FLAG_LABEL) as FlagKey[]).filter((k) => filter[k]).length
  );
}

export const isEmpty = (filter: QbFilter) => activeCount(filter) === 0;

export interface Chip {
  /** Identifica o chip e diz o que ele remove. */
  id: string;
  label: string;
  /** O filtro sem o critério deste chip. */
  without: (filter: QbFilter) => QbFilter;
}

function examName(facets: QbFacets | null, id: string): string {
  return facets?.exam.find((e) => e.id === id)?.value ?? 'Prova';
}

/** Os "Filtrar por:" — um chip para cada valor aplicado; clicar tira só aquele. */
export function chipsFor(filter: QbFilter, facets: QbFacets | null): Chip[] {
  const chips: Chip[] = [];
  for (const status of filter.status) {
    chips.push({ id: `status:${status}`, label: STATUS_LABEL[status], without: (f) => ({ ...f, status: f.status.filter((s) => s !== status) }) });
  }
  if (filter.q.trim()) chips.push({ id: 'q', label: `“${filter.q.trim()}”`, without: (f) => ({ ...f, q: '' }) });
  for (const field of LIST_FIELDS) {
    for (const value of filter[field.key] as (string | number)[]) {
      const shown = field.key === 'exam' ? examName(facets, String(value)) : value === '' ? 'Não informado' : String(value);
      chips.push({
        id: `${field.key}:${value}`,
        label: `${field.label}: ${shown}`,
        without: (f) => ({ ...f, [field.key]: (f[field.key] as (string | number)[]).filter((v) => v !== value) }),
      });
    }
  }
  if (filter.notebook) chips.push({ id: 'notebook', label: 'Só um caderno', without: (f) => ({ ...f, notebook: '' }) });
  for (const flag of Object.keys(FLAG_LABEL) as FlagKey[]) {
    if (!filter[flag]) continue;
    const prefix = flag === 'onlyWithNote' || flag === 'onlyWithComment' ? '' : 'Excluir: ';
    chips.push({ id: flag, label: `${prefix}${FLAG_LABEL[flag]}`, without: (f) => ({ ...f, [flag]: false }) });
  }
  return chips;
}

/**
 * Lê um filtro guardado (no navegador ou no servidor), ignorando o que não for reconhecido. Garante que o
 * resultado tenha todos os campos, mesmo que o guardado seja de uma versão mais antiga.
 */
export function readFilter(raw: unknown): QbFilter {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  const status = strings(input.status).filter((s): s is QbStatus => s in STATUS_LABEL);
  const years = (Array.isArray(input.year) ? input.year : []).filter((y): y is number => typeof y === 'number' && Number.isInteger(y));
  return {
    status,
    q: typeof input.q === 'string' ? input.q : '',
    discipline: strings(input.discipline),
    subject: strings(input.subject),
    board: strings(input.board),
    organ: strings(input.organ),
    year: years,
    position: strings(input.position),
    level: strings(input.level),
    exam: strings(input.exam),
    notebook: typeof input.notebook === 'string' ? input.notebook : '',
    excludeInNotebooks: input.excludeInNotebooks === true,
    excludeAnnulled: input.excludeAnnulled === true,
    excludeNoAnswer: input.excludeNoAnswer === true,
    onlyWithNote: input.onlyWithNote === true,
    onlyWithComment: input.onlyWithComment === true,
  };
}

const LAST_FILTER_KEY = 'mc-qb-last-filter';

/** O último filtro aplicado, guardado só neste navegador (uma comodidade: sem ele a tela funciona igual). */
export function loadLastFilter(storage: Pick<Storage, 'getItem'> | null = safeStorage()): QbFilter | null {
  try {
    const raw = storage?.getItem(LAST_FILTER_KEY);
    return raw ? readFilter(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLastFilter(filter: QbFilter, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(LAST_FILTER_KEY, JSON.stringify(filter));
  } catch {
    // modo privado ou armazenamento cheio: perder a comodidade é aceitável
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Um filtro que só restringe a uma prova ou a um caderno (os atalhos das outras telas). */
export function filterForExam(examId: string): QbFilter {
  return { ...EMPTY_FILTER, exam: [examId] };
}

export function filterForNotebook(notebookId: string): QbFilter {
  return { ...EMPTY_FILTER, notebook: notebookId };
}

/** Os números de página a mostrar: a primeira, a última e as vizinhas da atual, com `null` onde há salto. */
export function pageWindow(page: number, lastPage: number, around = 1): (number | null)[] {
  const wanted = new Set([1, lastPage, ...Array.from({ length: around * 2 + 1 }, (_, i) => page - around + i)]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= lastPage).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

export const lastPageOf = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

/** "Ano: 2023 · Banca: FGV · Órgão: TJ · Prova: …", só com o que se sabe. */
export function metaParts(q: Pick<QbQuestion, 'year' | 'board' | 'organ' | 'position' | 'examName'>): { label: string; value: string }[] {
  return [
    { label: 'Ano', value: q.year ? String(q.year) : '' },
    { label: 'Banca', value: q.board },
    { label: 'Órgão', value: q.organ },
    { label: 'Cargo', value: q.position },
    { label: 'Prova', value: q.examName },
  ].filter((p) => p.value);
}

/** Como a questão é chamada: pelo código do site ("Q4229308"), se tiver, senão pelo número na prova. */
export const questionLabel = (q: Pick<QbQuestion, 'number' | 'sourceId'>): string => (q.sourceId ? q.sourceId : `Questão ${q.number}`);

/** "Disciplina › Assunto"; só a disciplina se não houver assunto; vazio se não houver nenhum. */
export function breadcrumb(q: Pick<QbQuestion, 'discipline' | 'subject'>): string {
  return [q.discipline, q.subject].filter(Boolean).join(' › ');
}

/** "3 vezes · 67% de acerto". */
export function statsLine(q: Pick<QbQuestion, 'timesAnswered' | 'timesCorrect'>): string {
  if (q.timesAnswered === 0) return 'Você ainda não respondeu esta questão.';
  const pct = Math.round((q.timesCorrect / q.timesAnswered) * 100);
  return `Respondida ${q.timesAnswered} ${q.timesAnswered === 1 ? 'vez' : 'vezes'} · ${pct}% de acerto`;
}

export const percent = (correct: number, total: number): number => (total > 0 ? Math.round((correct / total) * 100) : 0);

/** O que impede de responder a questão agora, ou `null` se pode. */
export function blockedReason(q: Pick<QbQuestion, 'annulled' | 'gradable'>): string | null {
  if (q.annulled) return 'Questão anulada pela banca: não há resposta certa.';
  if (!q.gradable) return 'Esta questão ainda não tem gabarito. Informe a alternativa certa para poder respondê-la.';
  return null;
}

/** Os assuntos a oferecer, só os das disciplinas escolhidas (todos, se nenhuma foi escolhida). */
export function subjectOptions(facets: QbFacets, disciplines: string[]): QbFacets['subject'] {
  if (disciplines.length === 0) return facets.subject;
  const wanted = new Set(disciplines.map((d) => d.toLowerCase()));
  return facets.subject.filter((s) => wanted.has(s.discipline.toLowerCase()));
}

/** Junta as opções de assunto de disciplinas diferentes que têm o mesmo nome de assunto (a lista mostra cada nome uma vez). */
export function mergeOptions(options: { value: string; count: number }[]): { value: string; count: number }[] {
  const merged = new Map<string, { value: string; count: number }>();
  for (const option of options) {
    const key = option.value.toLowerCase();
    const current = merged.get(key);
    if (current) current.count += option.count;
    else merged.set(key, { ...option });
  }
  return [...merged.values()];
}

/**
 * O filtro com a escolha de assunto limpa do que não pertence mais às disciplinas escolhidas: sem isto, trocar de
 * disciplina deixaria um assunto invisível filtrando as questões.
 */
export function pruneSubjects(filter: QbFilter, facets: QbFacets): QbFilter {
  if (filter.discipline.length === 0 || filter.subject.length === 0) return filter;
  const allowed = new Set(subjectOptions(facets, filter.discipline).map((s) => s.value.toLowerCase()));
  const subject = filter.subject.filter((s) => allowed.has(s.toLowerCase()));
  return subject.length === filter.subject.length ? filter : { ...filter, subject };
}

/** O cronômetro do simulado: "05:07", ou "1:05:07" a partir de uma hora. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------- as provas de uma importação ----------

/** O nome de uma prova sem acento, caixa e espaços repetidos: é por ele que as questões se agrupam. */
export function provaKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ProvaGroup {
  key: string;
  name: string;
  board: string;
  organ: string;
  year: number | null;
  count: number;
}

type ProvaFields = Pick<QbDraftQuestion, 'prova' | 'board' | 'organ' | 'year'>;

/**
 * As provas que as questões de uma importação formam: cada questão vale pela sua prova ou, se não tiver, pelo nome da
 * importação. Banca, órgão e ano de um grupo são os da primeira questão que os traz. Uma importação de prova comum é
 * um grupo só.
 */
export function groupProvas(questions: ProvaFields[], fallbackName: string): ProvaGroup[] {
  const groups = new Map<string, ProvaGroup>();
  for (const q of questions) {
    const name = q.prova || fallbackName;
    const key = provaKey(name);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { key, name, board: q.board, organ: q.organ, year: q.year, count: 1 });
    } else {
      group.count++;
      group.board ||= q.board;
      group.organ ||= q.organ;
      group.year ??= q.year;
    }
  }
  return [...groups.values()];
}

/** Uma importação veio de um site de questões (cada questão com a sua prova ou o seu código)? */
export const isFromSite = (questions: Pick<QbDraftQuestion, 'prova' | 'sourceId'>[]): boolean => questions.some((q) => q.prova !== '' || q.sourceId !== '');

/** Muda o nome, a banca, o órgão ou o ano de uma prova em todas as questões dela. */
export function updateProva<T extends ProvaFields>(
  questions: T[],
  key: string,
  fallbackName: string,
  patch: Partial<Pick<ProvaGroup, 'name' | 'board' | 'organ' | 'year'>>,
): T[] {
  return questions.map((q) => {
    if (provaKey(q.prova || fallbackName) !== key) return q;
    return {
      ...q,
      prova: patch.name !== undefined ? patch.name : q.prova,
      board: patch.board !== undefined ? patch.board : q.board,
      organ: patch.organ !== undefined ? patch.organ : q.organ,
      year: patch.year !== undefined ? patch.year : q.year,
    };
  });
}
