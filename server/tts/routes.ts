import express, { type Response } from 'express';

import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { GeminiError, hasGemini, synthesizeSpeechGemini, ttsModel } from '../ai/gemini';
import { withUsageContext } from '../ai/usage';
import { AudioCache, cacheMaxBytes, defaultCacheDir } from './cache';
import { MAX_SPEECH_CHARS, synthesizeSpeech } from './synthesize';

export const ttsRouter = express.Router();
ttsRouter.use(requireAuth);

/**
 * As vozes oferecidas — um subconjunto das que o Gemini tem, as que dá pra
 * descrever com honestidade. O servidor só aceita estas: o nome da voz vai
 * direto para a API, não deve ser um texto qualquer vindo do navegador.
 */
export const VOICES = [
  { id: 'Charon', label: 'Charon', description: 'Informativa' },
  { id: 'Kore', label: 'Kore', description: 'Firme' },
  { id: 'Sulafat', label: 'Sulafat', description: 'Calorosa' },
] as const;

export const DEFAULT_VOICE = 'Charon';

// Criado só na primeira leitura: não deve criar pastas só por o servidor ter subido.
let cache: AudioCache | null = null;
function audioCache(): AudioCache {
  cache ??= new AudioCache(defaultCacheDir(), cacheMaxBytes());
  return cache;
}

ttsRouter.get('/voices', (_req: AuthedRequest, res: Response) => {
  res.json({ success: true, available: hasGemini(), defaultVoice: DEFAULT_VOICE, voices: VOICES });
});

ttsRouter.post('/', async (req: AuthedRequest, res: Response) => {
  if (!hasGemini()) {
    res.status(503).json({ success: false, error: 'A voz natural precisa da chave do Gemini (GEMINI_API_KEY) no servidor.' });
    return;
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) {
    res.status(400).json({ success: false, error: 'Não há texto para ler.' });
    return;
  }
  if (text.length > MAX_SPEECH_CHARS) {
    res.status(400).json({ success: false, error: `O texto passa de ${MAX_SPEECH_CHARS.toLocaleString('pt-BR')} caracteres.` });
    return;
  }
  const requested = typeof req.body?.voice === 'string' ? req.body.voice : DEFAULT_VOICE;
  const voice = VOICES.some((v) => v.id === requested) ? requested : DEFAULT_VOICE;

  try {
    const { wav } = await withUsageContext({ userId: req.userId!, feature: 'tts' }, () =>
      synthesizeSpeech(text, voice, ttsModel(), synthesizeSpeechGemini, audioCache()),
    );
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(wav.length));
    res.send(wav);
  } catch (err) {
    // `reason` deixa a tela dizer o motivo (limite diário, sobrecarga) e por quanto
    // tempo vale a pena nem tentar, em vez de um "não disponível" que não explica nada.
    const gemini = err instanceof GeminiError ? err : null;
    res.status(422).json({
      success: false,
      error: err instanceof Error ? err.message : 'Não foi possível gerar a voz.',
      reason: gemini?.kind ?? 'other',
      retryAfterSeconds: gemini?.retryAfterSeconds ?? null,
    });
  }
});
