import crypto from 'node:crypto';

import { concatPcm, pcmToWav, splitForSpeech, type DecodedAudio } from './audio';
import type { AudioCache } from './cache';

/** Quem de fato gera a voz de um trecho (o Gemini; nos testes, um falso). */
export type SpeechEngine = (text: string, voice: string) => Promise<DecodedAudio>;

/** Passou disso, a conta não compensa e a leitura demoraria demais. */
export const MAX_SPEECH_CHARS = 6000;

export function cacheKey(model: string, voice: string, text: string): string {
  return crypto.createHash('sha256').update(`${model}\n${voice}\n${text}`).digest('hex');
}

// Duas requisições iguais ao mesmo tempo (pré-carga + clique, duas abas) viram
// uma só chamada ao Gemini; ambas recebem o mesmo áudio.
const inFlight = new Map<string, Promise<Buffer>>();

/**
 * Devolve o WAV da fala, do cache se já foi gerado. Texto longo é gerado em
 * trechos e emendado, para a voz não ficar instável nem estourar o limite do modelo.
 */
export async function synthesizeSpeech(
  text: string,
  voice: string,
  model: string,
  engine: SpeechEngine,
  cache: AudioCache,
): Promise<{ wav: Buffer; fromCache: boolean }> {
  const key = cacheKey(model, voice, text);
  const cached = cache.get(key);
  if (cached) return { wav: cached, fromCache: true };

  let pending = inFlight.get(key);
  if (!pending) {
    pending = generate(text, voice, engine).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const wav = await pending;
  cache.set(key, wav);
  return { wav, fromCache: false };
}

async function generate(text: string, voice: string, engine: SpeechEngine): Promise<Buffer> {
  const chunks = splitForSpeech(text);
  if (chunks.length === 0) throw new Error('Não há texto para ler.');

  const parts: DecodedAudio[] = [];
  for (const chunk of chunks) parts.push(await engine(chunk, voice));

  const sampleRate = parts[0].sampleRate;
  if (parts.some((p) => p.sampleRate !== sampleRate)) throw new Error('A IA devolveu trechos em taxas de áudio diferentes.');
  return pcmToWav(concatPcm(parts.map((p) => p.pcm)), sampleRate);
}
