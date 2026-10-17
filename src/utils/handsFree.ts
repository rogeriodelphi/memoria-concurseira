/**
 * O modo "mãos livres": a voz lê a pergunta de um cartão, espera o tempo de pensar, lê a resposta,
 * faz uma pausa curta e passa ao cartão seguinte, sem ninguém tocar na tela. Aqui fica só a
 * sequência, sem React nem navegador (por isso dá para testar): quem chama entrega a voz e a espera.
 */

export type HandsFreePhase = 'question' | 'thinking' | 'answer' | 'gap' | 'finished';

/** Os tempos de pensar oferecidos, em segundos. */
export const THINK_SECONDS_OPTIONS = [3, 5, 8, 12] as const;
export const DEFAULT_THINK_SECONDS = 5;

/** Pausa entre o fim de um cartão e o começo do seguinte. */
export const GAP_MS = 1500;

/** Falhas seguidas de leitura (sem nenhuma que dê certo no meio) a partir das quais o modo desiste. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Um valor lido do armazenamento do navegador vira um dos tempos oferecidos, ou o padrão. */
export function normalizeThinkSeconds(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return (THINK_SECONDS_OPTIONS as readonly unknown[]).includes(n) ? (n as number) : DEFAULT_THINK_SECONDS;
}

/**
 * Quanto esperar por uma leitura antes de dar o fim por perdido. Alguns navegadores deixam de avisar
 * que a voz terminou (acontece no Chrome do celular), e sem este limite o modo ficaria parado
 * para sempre. O prazo é folgado: ~15 caracteres por segundo, a 1,5 vez isso, mais 6 s.
 */
export function speechWatchdogMs(text: string, rate: number): number {
  const safeRate = rate > 0 ? rate : 1;
  const estimate = (text.length / 15 / safeRate) * 1000 * 1.5 + 6000;
  return Math.min(Math.max(Math.round(estimate), 8000), 120_000);
}

/** O texto tem algo para ser lido (cartões só com imagem ficam sem texto). */
export function isSpeakable(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim().length > 0;
}

// ---------- cancelamento ----------

export interface CancelToken {
  readonly cancelled: boolean;
  cancel(): void;
  /** Avisa quando cancelar (na hora, se já foi cancelado). */
  onCancel(listener: () => void): void;
}

export function createCancelToken(): CancelToken {
  let cancelled = false;
  const listeners: (() => void)[] = [];
  return {
    get cancelled() {
      return cancelled;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      listeners.splice(0).forEach((listener) => listener());
    },
    onCancel(listener) {
      if (cancelled) listener();
      else listeners.push(listener);
    },
  };
}

/** Espera `ms`; se for cancelado antes, acaba na hora (sem deixar um temporizador para trás). */
export function waitUnlessCancelled(ms: number, token: CancelToken): Promise<void> {
  return new Promise((resolve) => {
    if (token.cancelled) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    token.onCancel(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ---------- a sessão ----------

export interface HandsFreeCardText {
  /** O que será lido (já sem marcação). */
  question: string;
  answer: string;
}

export interface PlaybackIo {
  /** Lê o texto. `true` se terminou de ler; `false` se não deu para ler. */
  speak(text: string, field: 'question' | 'answer'): Promise<boolean>;
  /** Espera; termina antes se a sessão for cancelada. */
  wait(ms: number): Promise<void>;
  /** Prepara uma leitura que vem a seguir (a voz natural gera o áudio antes). */
  prefetch?(text: string): void;
}

export interface PlaybackOptions {
  thinkMs: number;
  gapMs: number;
}

export type PlaybackResult = 'finished' | 'cancelled' | 'unspeakable';

/**
 * Percorre os cartões a partir de `startIndex`. Para cada um: lê a pergunta, espera `thinkMs`, lê a
 * resposta e espera `gapMs`. `onStep` avisa em que cartão e etapa está (e `finished` ao fim).
 *
 * - Cartão sem texto na pergunta (só imagem) é pulado: não há o que ouvir.
 * - Resposta sem texto: a pergunta é lida e o tempo de pensar corre, mas não há resposta a ler.
 * - Depois de `MAX_CONSECUTIVE_FAILURES` leituras seguidas que falham, desiste com `unspeakable`
 *   (o aparelho não consegue falar): continuar só pareceria funcionar.
 * - Cancelar (pausar, trocar de cartão) interrompe na hora, sem mais nenhuma etapa.
 */
export async function playSession(
  cards: readonly HandsFreeCardText[],
  startIndex: number,
  io: PlaybackIo,
  options: PlaybackOptions,
  onStep: (index: number, phase: HandsFreePhase) => void,
  token: CancelToken,
): Promise<PlaybackResult> {
  let failures = 0;

  /** Lê um trecho; devolve `false` se a sessão deve parar (cancelada ou sem voz). */
  async function read(text: string, field: 'question' | 'answer'): Promise<'ok' | 'cancelled' | 'unspeakable'> {
    const ok = await io.speak(text, field);
    if (token.cancelled) return 'cancelled';
    failures = ok ? 0 : failures + 1;
    return failures >= MAX_CONSECUTIVE_FAILURES ? 'unspeakable' : 'ok';
  }

  for (let index = Math.max(0, startIndex); index < cards.length; index++) {
    if (token.cancelled) return 'cancelled';
    const card = cards[index];
    if (!isSpeakable(card.question)) continue;

    onStep(index, 'question');
    // Enquanto a pergunta toca, a voz natural já gera a resposta e a pergunta do próximo cartão.
    if (isSpeakable(card.answer)) io.prefetch?.(card.answer);
    const next = cards[index + 1];
    if (next && isSpeakable(next.question)) io.prefetch?.(next.question);

    const asked = await read(card.question, 'question');
    if (asked !== 'ok') return asked;

    onStep(index, 'thinking');
    await io.wait(options.thinkMs);
    if (token.cancelled) return 'cancelled';

    onStep(index, 'answer');
    if (isSpeakable(card.answer)) {
      const answered = await read(card.answer, 'answer');
      if (answered !== 'ok') return answered;
    }

    onStep(index, 'gap');
    await io.wait(options.gapMs);
  }

  if (token.cancelled) return 'cancelled';
  onStep(cards.length, 'finished');
  return 'finished';
}
