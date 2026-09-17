import type { Flashcard } from '../types';

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function isDue(fc: Flashcard): boolean {
  return !fc.dueAt || new Date(fc.dueAt).getTime() <= Date.now();
}
