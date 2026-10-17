/** O maior limite diário aceito: acima disso o limite já não limita nada. */
export const MAX_DAILY_NEW_LIMIT = 1000;

export type LimitResult = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * O limite diário de cartões novos vindo de um formulário: um inteiro de 0 a 1000, ou vazio/nulo
 * para "sem limite". Zero é válido (não entra cartão novo nenhum). Números quebrados, negativos
 * e texto são recusados, em vez de arredondados em silêncio.
 */
export function parseDailyNewLimit(raw: unknown): LimitResult {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_DAILY_NEW_LIMIT) {
    return { ok: false, error: `Informe um número inteiro de 0 a ${MAX_DAILY_NEW_LIMIT}, ou deixe em branco para não limitar.` };
  }
  return { ok: true, value: n };
}

/**
 * Quantos cartões novos ainda podem entrar na fila hoje: o limite menos os que já foram
 * estudados pela primeira vez hoje, sem passar de quantos novos existem. Sem limite (`null`),
 * todos os novos.
 */
export function newCardsForToday(newAvailable: number, limit: number | null, newLearnedToday: number): number {
  if (limit === null) return newAvailable;
  return Math.min(newAvailable, Math.max(0, limit - newLearnedToday));
}
