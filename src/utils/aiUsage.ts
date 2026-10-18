import type { AiFeature, AiProvider, AiProviderStatus } from '../types';

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString('pt-BR')} mil`;
  if (n >= 1_000) return `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString('pt-BR');
}

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  claude: 'Claude',
};

export const FEATURE_LABEL: Record<AiFeature, string> = {
  flashcards: 'Flashcards',
  summary: 'Resumos',
  bulletpoints: 'Bullet points',
  mindmap: 'Mapas mentais',
  transcription: 'Transcrição',
  exam: 'Análise de edital',
  tts: 'Leitura em voz alta',
  choices: 'Alternativas de simulado',
  verify: 'Conferência de cartões',
};

export const STATUS_LABEL: Record<AiProviderStatus, string> = {
  ok: 'Funcionando',
  quota_exhausted: 'Cota esgotada',
  no_credits: 'Sem créditos',
  rate_limited: 'Limite de requisições',
  invalid_key: 'Chave inválida',
  unavailable: 'Instável',
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Um problema registrado há muito tempo provavelmente já não vale mais (a
// cota diária renova, crédito pode ter sido adicionado) — o aviso do menu
// lateral só aparece pra falhas das últimas 24h.
export function isRecent(iso: string | null): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < DAY_MS;
}

export function formatRelativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days === 1 ? '' : 's'}`;
}
