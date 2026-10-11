/**
 * Lógica pura da leitura em voz alta, sem depender do navegador (por isso dá pra
 * testar): limpar o texto que vai ser lido e escolher a melhor voz instalada.
 */

export interface BrowserVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
}

export const SPEECH_RATE = { min: 0.75, max: 1.5, step: 0.05, default: 1 } as const;

export function clampSpeechRate(value: number): number {
  if (!Number.isFinite(value)) return SPEECH_RATE.default;
  return Math.min(SPEECH_RATE.max, Math.max(SPEECH_RATE.min, Math.round(value * 100) / 100));
}

/**
 * A fala usa o texto puro: ler as tags de um cartão em HTML literalmente
 * soletraria a marcação em vez do conteúdo.
 */
export function stripHtmlForSpeech(value: string, format: 'plain' | 'html'): string {
  if (format !== 'html') return value;
  return value
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPortuguese(voice: BrowserVoice): boolean {
  return /^pt([-_]|$)/i.test(voice.lang);
}

/**
 * Nota de uma voz do navegador. Só conta o português, e o do Brasil sempre vem
 * antes do de Portugal (o sotaque errado atrapalha mais do que uma voz menos
 * natural). Dentro de cada um, as vozes "naturais" (neurais, geralmente online)
 * valem bem mais que as locais do sistema, que são as de som robótico.
 */
export function browserVoiceScore(voice: BrowserVoice): number {
  if (!isPortuguese(voice)) return -Infinity;
  let score = /^pt[-_]br$/i.test(voice.lang) ? 1000 : 100;
  if (/natural|neural/i.test(voice.name)) score += 60;
  if (/online/i.test(voice.name)) score += 25;
  if (/google/i.test(voice.name)) score += 30;
  if (!voice.localService) score += 5;
  return score;
}

export function portugueseVoices<T extends BrowserVoice>(voices: T[]): T[] {
  return voices
    .filter(isPortuguese)
    .sort((a, b) => browserVoiceScore(b) - browserVoiceScore(a) || a.name.localeCompare(b.name));
}

/** A voz que o usuário escolheu, se ainda existir; senão a de maior nota; senão nenhuma (o navegador usa a dele). */
export function pickBestBrowserVoice<T extends BrowserVoice>(voices: T[], preferredURI?: string | null): T | null {
  if (preferredURI) {
    const preferred = voices.find((v) => v.voiceURI === preferredURI);
    if (preferred) return preferred;
  }
  return portugueseVoices(voices)[0] ?? null;
}

const SENTENCE_END = /[.!?…:;]["')\]]?$/;

/**
 * O texto de uma lista de bullet points para ler em voz alta: o título e depois cada
 * tópico, todos terminando em pontuação. Sem o ponto final a voz emenda um tópico no
 * outro como se fosse uma frase só; com ele, faz a pausa entre eles.
 */
export function bulletPointsToSpeech(title: string, points: string[]): string {
  return [title, ...points]
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((part) => (SENTENCE_END.test(part) ? part : `${part}.`))
    .join(' ');
}

/** Espaços e quebras de linha viram um espaço só — como o servidor já faz, então a medida e o áudio guardado batem. */
export function tidySpeechText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** O texto de um resumo para ler em voz alta: o título e cada parágrafo, com a pausa de uma frase entre eles. */
export function summaryToSpeech(title: string, content: string): string {
  return bulletPointsToSpeech(title, content.split(/\n+/));
}

/** O que a voz natural aceita de uma vez; o servidor recusa mais que isso (MAX_SPEECH_CHARS, em server/tts/synthesize.ts). */
export const NATURAL_SPEECH_MAX_CHARS = 6000;

// ---------- quando a voz natural fica indisponível ----------

export type NaturalFailureReason = 'quota' | 'overloaded' | 'other';

/** A voz natural fora do ar: por quê e até quando o app nem tenta (lê com a do navegador). */
export interface NaturalOutage {
  reason: NaturalFailureReason;
  /** Instante (ms) em que a voz natural volta a ser tentada. */
  until: number;
  /** O que o Gemini disse sobre quando a cota volta, se disse. */
  retryAfterSeconds?: number;
}

const MINUTE_MS = 60_000;
export const NATURAL_PAUSE_MS = 5 * MINUTE_MS;
const NATURAL_PAUSE_MIN_MS = MINUTE_MS / 2;
export const NATURAL_PAUSE_MAX_MS = 12 * 60 * MINUTE_MS;

/**
 * Por quanto tempo a voz natural fica de lado depois de uma falha. Cota esgotada
 * com horário de volta informado pelo Gemini: até lá (insistir antes só faz esperar à toa),
 * mas nunca mais de 12 h, para um aviso errado não calar a voz por dias. O resto, 5 minutos.
 */
export function naturalPauseMs(reason: NaturalFailureReason, retryAfterSeconds?: number): number {
  if (reason !== 'quota' || !retryAfterSeconds || retryAfterSeconds <= 0) return NATURAL_PAUSE_MS;
  return Math.min(Math.max(retryAfterSeconds * 1000, NATURAL_PAUSE_MIN_MS), NATURAL_PAUSE_MAX_MS);
}

/** "por volta das 21:05" (hoje) ou "amanhã, por volta das 03:10", arredondado para cima de 5 em 5 minutos. */
function approximateTime(until: number, now: number): string {
  const rounded = new Date(Math.ceil(until / (5 * MINUTE_MS)) * 5 * MINUTE_MS);
  const clock = `${String(rounded.getHours()).padStart(2, '0')}:${String(rounded.getMinutes()).padStart(2, '0')}`;
  const today = rounded.toDateString() === new Date(now).toDateString();
  return `${today ? '' : 'amanhã, '}por volta das ${clock}`;
}

/** O motivo da indisponibilidade em uma frase, para o aviso e para as Configurações. */
export function describeNaturalOutage(outage: NaturalOutage, now: number = Date.now()): string {
  switch (outage.reason) {
    case 'quota': {
      const retry = outage.retryAfterSeconds;
      const daily = retry !== undefined && retry >= 3600;
      const head = `O limite ${daily ? 'diário ' : ''}gratuito do Gemini foi atingido.`;
      return retry !== undefined && retry > 0
        ? `${head} A voz natural deve voltar ${approximateTime(outage.until, now)}.`
        : `${head} A voz natural será tentada de novo em alguns minutos.`;
    }
    case 'overloaded':
      return 'O Gemini está sobrecarregado agora. A voz natural será tentada de novo em alguns minutos.';
    default:
      return 'A voz natural não está disponível agora. Ela será tentada de novo em alguns minutos.';
  }
}
