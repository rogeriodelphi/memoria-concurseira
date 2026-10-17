import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useStudySettings } from '../contexts/StudySettingsContext';
import type { DueFlashcard } from '../types';
import {
  createCancelToken,
  GAP_MS,
  playSession,
  speechWatchdogMs,
  waitUnlessCancelled,
  type CancelToken,
  type HandsFreePhase,
  type PlaybackIo,
} from '../utils/handsFree';
import { stripHtmlForSpeech } from '../utils/speech';
import { useSpeech } from './useSpeech';

export type HandsFreeStatus = 'idle' | 'playing' | 'paused' | 'finished' | 'unspeakable';

export interface HandsFreePosition {
  /** O cartão da vez (igual ao número de cartões quando a sessão terminou). */
  index: number;
  phase: HandsFreePhase;
}

/**
 * O modo mãos livres sobre a voz do app: a voz das Configurações (natural ou do navegador), lida
 * cartão a cartão, sem tocar na tela. Não avalia nada nem mexe no agendamento dos cartões.
 *
 * Pausar e continuar recomeçam o cartão da vez pela pergunta (é o ponto em que dá para entrar sem
 * perder o fio); próximo, anterior e repetir interrompem a leitura e vão ao cartão pedido.
 */
export function useHandsFree(cards: DueFlashcard[]) {
  const { speak, stop, prefetch, canSpeak } = useSpeech();
  const settings = useStudySettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [status, setStatus] = useState<HandsFreeStatus>('idle');
  const [position, setPosition] = useState<HandsFreePosition>({ index: 0, phase: 'question' });
  const positionRef = useRef(position);
  positionRef.current = position;
  const tokenRef = useRef<CancelToken | null>(null);

  // O texto que a voz lê: o cartão sem marcação (os de imagem ficam sem texto e são pulados).
  const texts = useMemo(
    () =>
      cards.map((card) => ({
        question: stripHtmlForSpeech(card.question, card.format),
        answer: stripHtmlForSpeech(card.answer, card.format),
      })),
    [cards],
  );

  /** Interrompe a sessão em andamento e a voz. */
  const halt = useCallback(() => {
    tokenRef.current?.cancel();
    tokenRef.current = null;
    stop();
  }, [stop]);

  // Sair da tela nunca deixa a leitura continuando.
  useEffect(() => halt, [halt]);

  const playFrom = useCallback(
    (from: number) => {
      halt();
      const token = createCancelToken();
      tokenRef.current = token;
      setStatus('playing');

      const io: PlaybackIo = {
        speak: (text, field) =>
          new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (completed: boolean) => {
              if (settled) return;
              settled = true;
              clearTimeout(watchdog);
              resolve(completed);
            };
            // Alguns navegadores deixam de avisar que a voz terminou: sem isto o modo ficaria parado.
            const watchdog = setTimeout(() => finish(true), speechWatchdogMs(text, settingsRef.current.speechRate));
            token.onCancel(() => finish(false));
            void speak(text, field, finish);
          }),
        wait: (ms) => waitUnlessCancelled(ms, token),
        prefetch,
      };

      // O tempo de pensar vale na hora: mudá-lo no meio da sessão vale já para o próximo cartão.
      const options = {
        get thinkMs() {
          return settingsRef.current.handsFreeThinkSeconds * 1000;
        },
        gapMs: GAP_MS,
      };

      void playSession(
        texts,
        from,
        io,
        options,
        (index, phase) => {
          if (tokenRef.current !== token) return;
          setPosition({ index, phase });
          if (phase === 'finished') setStatus('finished');
        },
        token,
      ).then((result) => {
        if (tokenRef.current === token && result === 'unspeakable') setStatus('unspeakable');
      });
    },
    [halt, speak, prefetch, texts],
  );

  const start = useCallback(() => playFrom(0), [playFrom]);
  const resume = useCallback(() => playFrom(positionRef.current.index), [playFrom]);
  const replay = resume;
  const next = useCallback(() => playFrom(Math.min(positionRef.current.index + 1, texts.length)), [playFrom, texts.length]);
  const previous = useCallback(() => playFrom(Math.max(positionRef.current.index - 1, 0)), [playFrom]);
  const pause = useCallback(() => {
    halt();
    setStatus('paused');
  }, [halt]);

  return { canSpeak, status, position, total: cards.length, start, pause, resume, replay, next, previous };
}
