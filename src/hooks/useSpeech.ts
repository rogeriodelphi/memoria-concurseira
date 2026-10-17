import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useStudySettings } from '../contexts/StudySettingsContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, ttsApi } from '../services/api';
import type { TtsInfo } from '../types';
import {
  describeNaturalOutage,
  NATURAL_SPEECH_MAX_CHARS,
  naturalPauseMs,
  pickBestBrowserVoice,
  portugueseVoices,
  tidySpeechText,
  type NaturalOutage,
} from '../utils/speech';

/** O que está sendo lido, para o botão certo mostrar "Parar": pergunta ou resposta de um cartão, ou um texto avulso. */
export type SpeechField = 'question' | 'answer' | 'text';

/**
 * Avisa o fim de uma leitura: `true` se a voz leu até o fim, `false` se não deu para ler (sem voz no
 * aparelho, som barrado pelo navegador, erro). Não é chamado se a leitura for interrompida por
 * outra (`speak` de novo, `stop`, sair da tela): quem interrompeu já sabe.
 */
export type SpeechDone = (completed: boolean) => void;

const browserSpeechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

// ---------- o que o servidor oferece ----------

const UNAVAILABLE: TtsInfo = { available: false, defaultVoice: '', voices: [] };
let ttsInfoPromise: Promise<TtsInfo> | null = null;

/** Uma consulta por carregamento da página; se falhar, a próxima tentativa refaz em vez de lembrar do erro. */
export function loadTtsInfo(): Promise<TtsInfo> {
  ttsInfoPromise ??= ttsApi.voices().catch(() => {
    ttsInfoPromise = null;
    return UNAVAILABLE;
  });
  return ttsInfoPromise;
}

export function useTtsInfo(): TtsInfo | null {
  const [info, setInfo] = useState<TtsInfo | null>(null);
  useEffect(() => {
    let active = true;
    loadTtsInfo().then((loaded) => active && setInfo(loaded));
    return () => {
      active = false;
    };
  }, []);
  return info;
}

function resolveVoice(info: TtsInfo, wanted: string): string {
  return info.voices.some((v) => v.id === wanted) ? wanted : info.defaultVoice;
}

// ---------- pausa depois de uma falha ----------
// Quando o Gemini falha (limite diário do plano gratuito, sobrecarga, sem rede), insistir
// em cada cartão faria o usuário esperar segundos antes de cada leitura só para cair na
// voz do navegador. Depois de uma falha a voz natural fica de lado — por alguns minutos,
// ou até a hora em que o Gemini diz que a cota volta — e o motivo fica visível: sem isso
// o usuário escolhe a voz natural, ouve a do navegador e não tem como saber por quê.

let outage: NaturalOutage | null = null;
let outageTimer: ReturnType<typeof setTimeout> | undefined;
let warnedAbout: NaturalOutage | null = null;
const outageListeners = new Set<() => void>();

function setOutage(next: NaturalOutage | null): void {
  outage = next;
  clearTimeout(outageTimer);
  // Quando o prazo acaba, o aviso some sozinho das Configurações.
  if (next) outageTimer = setTimeout(() => setOutage(null), Math.max(next.until - Date.now(), 0));
  outageListeners.forEach((listener) => listener());
}

function naturalIsPaused(): boolean {
  return outage !== null && Date.now() < outage.until;
}

function recordNaturalFailure(err: unknown): void {
  const reason = err instanceof ApiError ? (err.reason ?? 'other') : 'other';
  const retryAfterSeconds = err instanceof ApiError ? err.retryAfterSeconds : undefined;
  const until = Date.now() + naturalPauseMs(reason, retryAfterSeconds);
  // Várias leituras em andamento podem falhar juntas: vale o prazo mais longo, não o último.
  if (outage && outage.until >= until) return;
  setOutage({ reason, until, retryAfterSeconds });
}

/** Quem pede explicitamente (trocar de voz, "Ouvir exemplo") quer tentar de novo agora. */
export function resumeNaturalVoice(): void {
  setOutage(null);
}

/** Por que a voz natural está de lado agora (e até quando); `null` se está tudo certo. */
export function useNaturalVoiceOutage(): NaturalOutage | null {
  return useSyncExternalStore(
    (listener) => {
      outageListeners.add(listener);
      return () => outageListeners.delete(listener);
    },
    () => outage,
  );
}

// ---------- áudio já gerado, na memória desta página ----------
// O servidor guarda cada áudio em disco; aqui só evita pedir de novo (e baixar de
// novo) o que acabou de tocar, e guarda o que foi pré-carregado.

const AUDIO_MEMORY_LIMIT = 40;
const audioUrls = new Map<string, Promise<string>>();

function loadAudio(text: string, voice: string): Promise<string> {
  const key = `${voice}\n${text}`;
  const existing = audioUrls.get(key);
  if (existing) {
    audioUrls.delete(key); // reinsere: mantém a ordem de "usado por último"
    audioUrls.set(key, existing);
    return existing;
  }

  const created = ttsApi.synthesize(text, voice).then((blob) => URL.createObjectURL(blob));
  audioUrls.set(key, created);
  created.catch((err) => {
    if (audioUrls.get(key) === created) audioUrls.delete(key); // não guarda falha: a próxima tentativa refaz
    recordNaturalFailure(err);
  });

  while (audioUrls.size > AUDIO_MEMORY_LIMIT) {
    const [oldestKey, oldest] = audioUrls.entries().next().value as [string, Promise<string>];
    audioUrls.delete(oldestKey);
    oldest.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  return created;
}

// ---------- vozes do navegador ----------

export function useBrowserVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    browserSpeechSupported ? portugueseVoices(window.speechSynthesis.getVoices()) : [],
  );
  useEffect(() => {
    if (!browserSpeechSupported) return;
    const update = () => setVoices(portugueseVoices(window.speechSynthesis.getVoices()));
    update();
    // O Chrome carrega a lista de vozes depois da página.
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

// ---------- a leitura ----------

/**
 * Lê um texto em voz alta com a voz escolhida nas Configurações: a natural (gerada
 * no servidor e guardada) ou a do navegador. Se a natural não está disponível — sem
 * chave, sem internet, Gemini sobrecarregado —, lê com a do navegador em vez de
 * ficar muda, e avisa uma vez.
 */
export function useSpeech() {
  const settings = useStudySettings();
  const { showToast } = useToast();
  const info = useTtsInfo();

  const [speaking, setSpeaking] = useState<SpeechField | null>(null);
  const [loading, setLoading] = useState<SpeechField | null>(null);

  // `speak` é chamado de efeitos que não rodam de novo a cada mudança de configuração.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Cada pedido ganha um número; só o mais recente pode mexer no estado ou tocar.
  const tokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (browserSpeechSupported) window.speechSynthesis.cancel();
  }, []);

  const stop = useCallback(() => {
    tokenRef.current++;
    stopPlayback();
    setSpeaking(null);
    setLoading(null);
  }, [stopPlayback]);

  // Sair da tela nunca deixa voz tocando em segundo plano.
  useEffect(
    () => () => {
      tokenRef.current++;
      stopPlayback();
    },
    [stopPlayback],
  );

  const speakWithBrowser = useCallback((text: string, field: SpeechField, token: number, onDone?: SpeechDone) => {
    if (!browserSpeechSupported) {
      setSpeaking(null);
      onDone?.(false);
      return;
    }
    const { browserVoiceURI, speechRate } = settingsRef.current;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = speechRate;
    const voice = pickBestBrowserVoice(window.speechSynthesis.getVoices(), browserVoiceURI);
    if (voice) utterance.voice = voice;
    const finish = (completed: boolean) => {
      if (tokenRef.current !== token) return;
      setSpeaking(null);
      onDone?.(completed);
    };
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(field);
  }, []);

  const speak = useCallback(
    async (text: string, field: SpeechField, onDone?: SpeechDone) => {
      const clean = tidySpeechText(text);
      if (!clean) {
        onDone?.(false);
        return;
      }
      const token = ++tokenRef.current;
      stopPlayback();
      setSpeaking(field);
      setLoading(null);

      const ttsInfo = await loadTtsInfo();
      if (tokenRef.current !== token) return;

      // Mais do que o servidor aceita não é falha do Gemini: não pausa a voz natural
      // (os próximos textos, curtos, continuam saindo nela), só este é lido pela do navegador.
      const tooLong = clean.length > NATURAL_SPEECH_MAX_CHARS;
      const wantsNatural = settingsRef.current.speechEngine === 'natural' && ttsInfo.available;
      if (wantsNatural && tooLong) {
        showToast('Este texto é longo demais para a voz natural. Lendo com a voz do navegador.', 'error');
        speakWithBrowser(clean, field, token, onDone);
        return;
      }

      if (wantsNatural && !naturalIsPaused()) {
        setLoading(field);
        try {
          const url = await loadAudio(clean, resolveVoice(ttsInfo, settingsRef.current.geminiVoice));
          if (tokenRef.current !== token) return;
          setLoading(null);

          const audio = new Audio(url);
          audio.playbackRate = settingsRef.current.speechRate;
          audioRef.current = audio;
          audio.onended = () => {
            if (tokenRef.current !== token) return;
            audioRef.current = null;
            setSpeaking(null);
            onDone?.(true);
          };
          audio.onerror = () => {
            // áudio ilegível: não deixa o usuário no silêncio
            if (tokenRef.current !== token) return;
            audioRef.current = null;
            speakWithBrowser(clean, field, token, onDone);
          };
          await audio.play();
          return;
        } catch (err) {
          if (tokenRef.current !== token) return;
          setLoading(null);
          audioRef.current = null;
          // O navegador barra som que começa sozinho antes de qualquer clique na página.
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            setSpeaking(null);
            onDone?.(false);
            return;
          }
        }
      }

      // Escolheu a natural e vai ouvir a do navegador: diz por quê, uma vez por pausa
      // (não a cada cartão). Vale também quando a falha veio de uma leitura adiantada.
      if (settingsRef.current.speechEngine === 'natural' && outage && outage !== warnedAbout) {
        warnedAbout = outage;
        showToast(`${describeNaturalOutage(outage)} Lendo com a voz do navegador.`, 'error');
      }

      speakWithBrowser(clean, field, token, onDone);
    },
    [showToast, speakWithBrowser, stopPlayback],
  );

  /** Gera (e guarda) a fala antes de ela ser pedida, para tocar na hora quando chegar a vez. */
  const prefetch = useCallback((text: string) => {
    const clean = tidySpeechText(text);
    if (!clean || clean.length > NATURAL_SPEECH_MAX_CHARS) return;
    void loadTtsInfo().then((ttsInfo) => {
      if (settingsRef.current.speechEngine !== 'natural' || !ttsInfo.available || naturalIsPaused()) return;
      loadAudio(clean, resolveVoice(ttsInfo, settingsRef.current.geminiVoice)).catch(() => {});
    });
  }, []);

  const canSpeak = browserSpeechSupported || (settings.speechEngine === 'natural' && info?.available === true);

  return { speak, stop, prefetch, speaking, loading, canSpeak };
}
