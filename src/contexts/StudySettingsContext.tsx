import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import { normalizeThinkSeconds } from '../utils/handsFree';
import { clampSpeechRate, SPEECH_RATE } from '../utils/speech';

const AUTO_PLAY_KEY = 'bc-study-autoplay-speech';
const THINK_SECONDS_KEY = 'bc-handsfree-think-seconds';
const ENGINE_KEY = 'bc-speech-engine';
const VOICE_KEY = 'bc-speech-voice';
const RATE_KEY = 'bc-speech-rate';
const BROWSER_VOICE_KEY = 'bc-speech-browser-voice';

export type SpeechEngine = 'natural' | 'browser';

// O app tem que funcionar mesmo com o armazenamento do navegador bloqueado (aba
// anônima, dados desativados): ler e gravar nunca podem derrubar a tela.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

function readAutoPlay(): boolean {
  return read(AUTO_PLAY_KEY) === 'true';
}

// A voz natural é o padrão; ela mesma cai na do navegador quando o servidor não
// consegue gerar (sem chave, sem internet, Gemini sobrecarregado).
function readEngine(): SpeechEngine {
  return read(ENGINE_KEY) === 'browser' ? 'browser' : 'natural';
}

function readRate(): number {
  const raw = read(RATE_KEY);
  return raw === null ? SPEECH_RATE.default : clampSpeechRate(Number(raw));
}

interface StudySettingsContextValue {
  autoPlaySpeech: boolean;
  setAutoPlaySpeech: (value: boolean) => void;
  speechEngine: SpeechEngine;
  setSpeechEngine: (value: SpeechEngine) => void;
  /** Id da voz do Gemini; vazio = a padrão do servidor. */
  geminiVoice: string;
  setGeminiVoice: (value: string) => void;
  speechRate: number;
  setSpeechRate: (value: number) => void;
  /** voiceURI da voz do navegador escolhida; null = a melhor disponível. */
  browserVoiceURI: string | null;
  setBrowserVoiceURI: (value: string | null) => void;
  /** Modo mãos livres: quantos segundos esperar, entre ler a pergunta e ler a resposta. */
  handsFreeThinkSeconds: number;
  setHandsFreeThinkSeconds: (value: number) => void;
}

const StudySettingsContext = createContext<StudySettingsContextValue | null>(null);

export function StudySettingsProvider({ children }: { children: ReactNode }) {
  const [autoPlaySpeech, setAutoPlaySpeechState] = useState<boolean>(readAutoPlay);
  const [speechEngine, setSpeechEngineState] = useState<SpeechEngine>(readEngine);
  const [geminiVoice, setGeminiVoiceState] = useState<string>(() => read(VOICE_KEY) ?? '');
  const [speechRate, setSpeechRateState] = useState<number>(readRate);
  const [browserVoiceURI, setBrowserVoiceURIState] = useState<string | null>(() => read(BROWSER_VOICE_KEY));
  const [handsFreeThinkSeconds, setHandsFreeThinkSecondsState] = useState<number>(() =>
    normalizeThinkSeconds(read(THINK_SECONDS_KEY)),
  );

  const setAutoPlaySpeech = useCallback((value: boolean) => {
    setAutoPlaySpeechState(value);
    write(AUTO_PLAY_KEY, String(value));
  }, []);

  const setSpeechEngine = useCallback((value: SpeechEngine) => {
    setSpeechEngineState(value);
    write(ENGINE_KEY, value);
  }, []);

  const setGeminiVoice = useCallback((value: string) => {
    setGeminiVoiceState(value);
    write(VOICE_KEY, value || null);
  }, []);

  const setSpeechRate = useCallback((value: number) => {
    const next = clampSpeechRate(value);
    setSpeechRateState(next);
    write(RATE_KEY, String(next));
  }, []);

  const setBrowserVoiceURI = useCallback((value: string | null) => {
    setBrowserVoiceURIState(value);
    write(BROWSER_VOICE_KEY, value);
  }, []);

  const setHandsFreeThinkSeconds = useCallback((value: number) => {
    const next = normalizeThinkSeconds(value);
    setHandsFreeThinkSecondsState(next);
    write(THINK_SECONDS_KEY, String(next));
  }, []);

  return (
    <StudySettingsContext.Provider
      value={{
        autoPlaySpeech,
        setAutoPlaySpeech,
        speechEngine,
        setSpeechEngine,
        geminiVoice,
        setGeminiVoice,
        speechRate,
        setSpeechRate,
        browserVoiceURI,
        setBrowserVoiceURI,
        handsFreeThinkSeconds,
        setHandsFreeThinkSeconds,
      }}
    >
      {children}
    </StudySettingsContext.Provider>
  );
}

export function useStudySettings(): StudySettingsContextValue {
  const ctx = useContext(StudySettingsContext);
  if (!ctx) throw new Error('useStudySettings precisa estar dentro de <StudySettingsProvider>.');
  return ctx;
}
