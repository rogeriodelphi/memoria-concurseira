/**
 * Coleções ainda sem ligação a um concurso: as partes sem tela. As sugestões vêm do servidor (server/exams/unlinked.ts);
 * aqui ficam os textos e a busca de tópicos para o usuário escolher um à mão.
 */
import type { IgnoredCollection, TopicLinkSuggestion, UnlinkedCollection } from '../types';
import { plural } from './performance';

/** Quantas coleções soltas aparecem de início; o resto fica atrás de "mostrar as outras". */
export const INITIAL_ROWS = 12;
/** Acima de quantos tópicos a lista de escolha ganha uma caixa de busca. */
export const SEARCH_THRESHOLD = 30;
/** Quantos tópicos a lista de escolha mostra de uma vez, no máximo (a busca afunila o resto). */
export const MAX_OPTIONS = 60;

/** "157 cartões · 120 novos · 5 vencidos"; sem cartões: "sem cartões". */
export function collectionSize(c: Pick<UnlinkedCollection | IgnoredCollection, 'cards' | 'newCards' | 'dueCards'>): string {
  if (c.cards === 0) return 'sem cartões';
  const parts = [plural(c.cards, 'cartão', 'cartões')];
  if (c.newCards > 0) parts.push(plural(c.newCards, 'novo', 'novos'));
  if (c.dueCards > 0) parts.push(plural(c.dueCards, 'vencido', 'vencidos'));
  return parts.join(' · ');
}

/** Quão parecido o tópico é do assunto da coleção, em palavras. */
export function matchLabel(s: Pick<TopicLinkSuggestion, 'strong'>): string {
  return s.strong ? 'quase igual' : 'provável';
}

/** O texto de uma coleção que casa com muitos tópicos ao mesmo tempo. */
export function tiedMessage(tied: number): string {
  return `Parece tratar da disciplina inteira: casa com ${tied.toLocaleString('pt-BR')} tópicos. Escolha o tópico certo.`;
}

/** Quantas coleções e cartões o resumo do painel menciona. */
export function unlinkedSummary(collections: readonly UnlinkedCollection[]): string {
  const cards = collections.reduce((sum, c) => sum + c.cards, 0);
  return `${plural(collections.length, 'coleção', 'coleções')} · ${plural(cards, 'cartão', 'cartões')}`;
}

export interface TopicOption {
  id: string;
  title: string;
  discipline: string;
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Os tópicos que contêm todas as palavras da busca (sem acento nem caixa). Busca vazia: todos. */
export function filterTopics(topics: readonly TopicOption[], query: string): TopicOption[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...topics];
  return topics.filter((t) => {
    const haystack = normalize(`${t.title} ${t.discipline}`);
    return words.every((w) => haystack.includes(w));
  });
}

/** Agrupa por disciplina, na ordem em que aparecem (a do edital). */
export function groupTopics(topics: readonly TopicOption[]): { discipline: string; topics: TopicOption[] }[] {
  const groups: { discipline: string; topics: TopicOption[] }[] = [];
  for (const topic of topics) {
    const last = groups[groups.length - 1];
    if (last && last.discipline === topic.discipline) last.topics.push(topic);
    else groups.push({ discipline: topic.discipline, topics: [topic] });
  }
  return groups;
}
