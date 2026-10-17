import { normalizeForSearch } from './collectionFilter';

/**
 * Uma linha da lista de coleções: uma coleção sozinha, ou uma disciplina — duas ou mais coleções com
 * o mesmo nome (cada uma com o seu assunto).
 */
export type CollectionEntry<T> =
  | { kind: 'single'; item: T }
  | { kind: 'group'; /** o nome normalizado: identifica a disciplina */ key: string; /** como o nome aparece */ name: string; items: T[] };

/**
 * A chave da disciplina: o nome da coleção sem diferenciar maiúsculas, acentos nem espaços repetidos,
 * então "Língua Portuguesa" e "lingua  portuguesa" são a mesma disciplina.
 */
export function disciplineKey(name: string): string {
  return normalizeForSearch(name);
}

/**
 * Como a disciplina aparece: o nome que a maioria das coleções do grupo usa (com os espaços
 * arrumados). Em caso de empate, o da primeira. Assim uma coleção digitada "seguranca da informacao"
 * não dá o nome ao grupo de "Segurança da Informação".
 */
function displayName(members: { name: string }[]): string {
  const counts = new Map<string, number>();
  for (const member of members) {
    const name = member.name.replace(/\s+/g, ' ').trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Junta as coleções de mesmo nome numa disciplina. A lista sai na mesma ordem em que entrou: cada
 * disciplina ocupa o lugar da sua primeira coleção (então qualquer ordenação da lista vale também para
 * os grupos), e dentro dela as coleções mantêm a ordem de entrada. Nome que aparece uma vez só continua
 * sendo uma coleção sozinha.
 */
export function groupByDiscipline<T extends { name: string }>(items: T[]): CollectionEntry<T>[] {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = disciplineKey(item.name);
    const members = byKey.get(key);
    if (members) members.push(item);
    else byKey.set(key, [item]);
  }

  const entries: CollectionEntry<T>[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const key = disciplineKey(item.name);
    if (placed.has(key)) continue;
    placed.add(key);
    const members = byKey.get(key)!;
    entries.push(
      members.length === 1 ? { kind: 'single', item } : { kind: 'group', key, name: displayName(members), items: members },
    );
  }
  return entries;
}

export interface GroupTotals {
  flashcards: number;
  /** Os pendentes de revisão de todas as coleções do grupo (os mesmos "a revisar" que cada coleção mostra). */
  due: number;
  /** A atualização mais recente de qualquer coleção do grupo (ISO). */
  updatedAt: string;
}

export function groupTotals<T extends { flashcardCount: number; dueCount: number; updatedAt: string }>(
  items: T[],
): GroupTotals {
  return {
    flashcards: items.reduce((sum, c) => sum + c.flashcardCount, 0),
    due: items.reduce((sum, c) => sum + c.dueCount, 0),
    updatedAt: items.reduce((latest, c) => (c.updatedAt > latest ? c.updatedAt : latest), ''),
  };
}

// ---------- quais disciplinas estão abertas (lembrado neste navegador) ----------

const EXPANDED_KEY = 'bc-expanded-disciplines';

type SimpleStorage = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): SimpleStorage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined; // acesso bloqueado (janela privada, dados do site desligados)
  }
};

/** As disciplinas que o usuário deixou abertas. Qualquer falha (sem armazenamento, dado corrompido) vira "nenhuma". */
export function loadExpandedGroups(storage: SimpleStorage | undefined = defaultStorage()): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(EXPANDED_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveExpandedGroups(keys: Set<string>, storage: SimpleStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(EXPANDED_KEY, JSON.stringify([...keys]));
  } catch {
    // sem armazenamento: a escolha só vale até recarregar a página
  }
}
