/**
 * Ordem de tentativa dos provedores de IA. Cada operação monta, para cada
 * provedor, o que ele sabe fazer com aquela entrada; a cadeia tenta na ordem
 * configurada e passa ao próximo quando um falha.
 */

export type ProviderName = 'openai' | 'gemini' | 'claude';

/** A ordem de sempre (OpenAI, se houver chave, depois Gemini) e o Claude só como reserva. */
export const DEFAULT_PROVIDER_ORDER: readonly ProviderName[] = ['openai', 'gemini', 'claude'];

const KNOWN: ReadonlySet<string> = new Set<ProviderName>(['openai', 'gemini', 'claude']);

/**
 * Lê `AI_PROVIDER_ORDER` (ex.: "claude,gemini"). Nomes desconhecidos e repetidos
 * são ignorados; um provedor que não está na lista nunca é usado — é como se
 * desliga um deles sem apagar a chave. Vazio ou só com lixo cai na ordem padrão.
 */
export function parseProviderOrder(raw: string | undefined): ProviderName[] {
  const order: ProviderName[] = [];
  for (const part of (raw ?? '').split(',')) {
    const name = part.trim().toLowerCase();
    if (KNOWN.has(name) && !order.includes(name as ProviderName)) order.push(name as ProviderName);
  }
  return order.length > 0 ? order : [...DEFAULT_PROVIDER_ORDER];
}

/** O provedor não consegue tratar esta entrada (ex.: YouTube no Claude): pula sem contar como falha. */
export const UNSUPPORTED = Symbol('unsupported');

export interface ChainStep<T> {
  /** Tem chave configurada. */
  available: boolean;
  /** Null quando o provedor não suporta esta operação de jeito nenhum. */
  run: (() => Promise<T | typeof UNSUPPORTED>) | null;
}

export type ChainSteps<T> = Record<ProviderName, ChainStep<T>>;

export const NO_PROVIDER_MESSAGE =
  'Nenhum provedor de IA está disponível para esta operação. Configure GEMINI_API_KEY, OPENAI_API_KEY ou ' +
  'ANTHROPIC_API_KEY no .env do servidor (e confira AI_PROVIDER_ORDER, se estiver definido).';

/**
 * Tenta cada provedor na ordem. O primeiro que responde vence. Se todos que
 * tentaram falharam, lança o erro do último — como sempre foi, o Gemini era o
 * último e era a mensagem dele que o usuário via.
 */
export async function runChain<T>(
  order: readonly ProviderName[],
  steps: ChainSteps<T>,
  onFallback?: (provider: ProviderName, error: unknown) => void,
): Promise<T> {
  let lastError: unknown;
  let failed = false;

  for (const provider of order) {
    const step = steps[provider];
    if (!step.available || !step.run) continue;
    try {
      const result = await step.run();
      if (result === UNSUPPORTED) continue;
      return result;
    } catch (err) {
      failed = true;
      lastError = err;
      onFallback?.(provider, err);
    }
  }

  if (failed) throw lastError;
  throw new Error(NO_PROVIDER_MESSAGE);
}
