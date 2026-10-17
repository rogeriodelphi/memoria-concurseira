import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCancelToken,
  DEFAULT_THINK_SECONDS,
  isSpeakable,
  MAX_CONSECUTIVE_FAILURES,
  normalizeThinkSeconds,
  playSession,
  speechWatchdogMs,
  waitUnlessCancelled,
  type CancelToken,
  type HandsFreeCardText,
  type HandsFreePhase,
  type PlaybackIo,
} from './handsFree';

const OPTIONS = { thinkMs: 5000, gapMs: 1500 };

const CARDS: HandsFreeCardText[] = [
  { question: 'P1', answer: 'R1' },
  { question: 'P2', answer: 'R2' },
  { question: 'P3', answer: 'R3' },
];

/** Uma voz e uma espera falsas: gravam o que foi pedido, na ordem, e respondem na hora. */
function fakeIo(options: { speak?: (text: string, count: number) => boolean | 'cancel'; token?: CancelToken } = {}) {
  const log: string[] = [];
  let speaks = 0;
  const io: PlaybackIo = {
    speak: async (text, field) => {
      log.push(`fala ${field}: ${text}`);
      const result = options.speak?.(text, speaks++) ?? true;
      if (result === 'cancel') {
        options.token?.cancel();
        return false;
      }
      return result;
    },
    wait: async (ms) => {
      log.push(`espera ${ms}`);
    },
    prefetch: (text) => {
      log.push(`prepara ${text}`);
    },
  };
  return { io, log };
}

function recordSteps() {
  const steps: string[] = [];
  return { steps, onStep: (index: number, phase: HandsFreePhase) => steps.push(`${index}:${phase}`) };
}

test('sessão: cada cartão é pergunta, tempo de pensar, resposta e pausa, na ordem', async () => {
  const { io, log } = fakeIo();
  const { steps, onStep } = recordSteps();
  const result = await playSession(CARDS.slice(0, 2), 0, io, OPTIONS, onStep, createCancelToken());

  assert.equal(result, 'finished');
  assert.deepEqual(steps, ['0:question', '0:thinking', '0:answer', '0:gap', '1:question', '1:thinking', '1:answer', '1:gap', '2:finished']);
  assert.deepEqual(
    log.filter((l) => !l.startsWith('prepara')),
    ['fala question: P1', 'espera 5000', 'fala answer: R1', 'espera 1500', 'fala question: P2', 'espera 5000', 'fala answer: R2', 'espera 1500'],
  );
});

test('sessão: o tempo de pensar e a pausa vêm das opções', async () => {
  const { io, log } = fakeIo();
  await playSession(CARDS.slice(0, 1), 0, io, { thinkMs: 12_000, gapMs: 300 }, () => {}, createCancelToken());
  assert.deepEqual(log.filter((l) => l.startsWith('espera')), ['espera 12000', 'espera 300']);
});

test('sessão: começa do cartão pedido (e um índice negativo vale o primeiro)', async () => {
  const { io } = fakeIo();
  const { steps, onStep } = recordSteps();
  await playSession(CARDS, 2, io, OPTIONS, onStep, createCancelToken());
  assert.deepEqual(steps, ['2:question', '2:thinking', '2:answer', '2:gap', '3:finished']);

  const second = recordSteps();
  await playSession(CARDS.slice(0, 1), -4, fakeIo().io, OPTIONS, second.onStep, createCancelToken());
  assert.equal(second.steps[0], '0:question');
});

test('sessão: começar depois do fim, ou sem cartões, termina na hora', async () => {
  const { steps, onStep } = recordSteps();
  assert.equal(await playSession(CARDS, 9, fakeIo().io, OPTIONS, onStep, createCancelToken()), 'finished');
  assert.deepEqual(steps, ['3:finished']);

  const empty = recordSteps();
  assert.equal(await playSession([], 0, fakeIo().io, OPTIONS, empty.onStep, createCancelToken()), 'finished');
  assert.deepEqual(empty.steps, ['0:finished']);
});

test('sessão: enquanto a pergunta toca, prepara a resposta e a pergunta do próximo cartão', async () => {
  const { io, log } = fakeIo();
  await playSession(CARDS.slice(0, 2), 0, io, OPTIONS, () => {}, createCancelToken());
  const firstSpeak = log.indexOf('fala question: P1');
  assert.deepEqual(log.slice(0, firstSpeak), ['prepara R1', 'prepara P2'], 'antes de falar a primeira pergunta');
  assert.ok(!log.includes('prepara undefined'));
  // No último cartão não há "próximo" para preparar.
  const lastBlock = log.slice(log.indexOf('fala question: P2') - 1);
  assert.ok(!lastBlock.some((l) => l.startsWith('prepara P3')));
});

test('sessão: cartão sem texto na pergunta (só imagem) é pulado, sem leitura nem espera', async () => {
  const { io, log } = fakeIo();
  const { steps, onStep } = recordSteps();
  const cards = [CARDS[0], { question: '   ', answer: 'R-imagem' }, CARDS[2]];
  await playSession(cards, 0, io, OPTIONS, onStep, createCancelToken());
  assert.deepEqual(steps.filter((s) => s.startsWith('1:')), []);
  assert.ok(!log.some((l) => l.includes('R-imagem')));
  assert.deepEqual(steps.slice(-2), ['2:gap', '3:finished']);
});

test('sessão: resposta sem texto: lê a pergunta e dá o tempo de pensar, mas não lê resposta', async () => {
  const { io, log } = fakeIo();
  const { steps, onStep } = recordSteps();
  await playSession([{ question: 'P', answer: '' }], 0, io, OPTIONS, onStep, createCancelToken());
  assert.deepEqual(steps, ['0:question', '0:thinking', '0:answer', '0:gap', '1:finished']);
  assert.deepEqual(log.filter((l) => l.startsWith('fala')), ['fala question: P']);
});

test('sessão: cancelar no meio da leitura interrompe na hora, sem mais nenhuma etapa', async () => {
  const token = createCancelToken();
  const { io, log } = fakeIo({ token, speak: (text) => (text === 'R1' ? 'cancel' : true) });
  const { steps, onStep } = recordSteps();
  const result = await playSession(CARDS, 0, io, OPTIONS, onStep, token);

  assert.equal(result, 'cancelled');
  assert.deepEqual(steps, ['0:question', '0:thinking', '0:answer'], 'parou na resposta, sem pausa nem cartão 2');
  assert.ok(!log.includes('fala question: P2'));
});

test('sessão: cancelar durante uma espera interrompe antes da próxima etapa', async () => {
  const token = createCancelToken();
  const log: string[] = [];
  const io: PlaybackIo = {
    speak: async (text) => (log.push(`fala ${text}`), true),
    wait: async () => {
      log.push('espera');
      token.cancel(); // o usuário pausou durante o tempo de pensar
    },
  };
  const result = await playSession(CARDS, 0, io, OPTIONS, () => {}, token);
  assert.equal(result, 'cancelled');
  assert.deepEqual(log, ['fala P1', 'espera'], 'a resposta não chegou a ser lida');
});

test('sessão: já cancelada, não faz nada', async () => {
  const token = createCancelToken();
  token.cancel();
  const { io, log } = fakeIo();
  assert.equal(await playSession(CARDS, 0, io, OPTIONS, () => {}, token), 'cancelled');
  assert.deepEqual(log, []);
});

test('sessão: depois de falhas seguidas de leitura, desiste em vez de fingir que funciona', async () => {
  const { io, log } = fakeIo({ speak: () => false });
  const { steps, onStep } = recordSteps();
  const result = await playSession(CARDS, 0, io, OPTIONS, onStep, createCancelToken());

  assert.equal(result, 'unspeakable');
  assert.equal(log.filter((l) => l.startsWith('fala')).length, MAX_CONSECUTIVE_FAILURES);
  assert.ok(!steps.includes('3:finished'));
});

test('sessão: uma leitura que dá certo zera a contagem de falhas', async () => {
  // falha, falha, ok, falha, falha, ok...: nunca chega a três seguidas
  const { io } = fakeIo({ speak: (_text, count) => count % 3 === 2 });
  const result = await playSession(CARDS, 0, io, OPTIONS, () => {}, createCancelToken());
  assert.equal(result, 'finished');
});

test('cancelamento: avisa quem pediu, uma vez; e quem pede depois de cancelado é avisado na hora', () => {
  const token = createCancelToken();
  let calls = 0;
  token.onCancel(() => calls++);
  assert.equal(token.cancelled, false);
  token.cancel();
  token.cancel();
  assert.equal(token.cancelled, true);
  assert.equal(calls, 1);

  let late = 0;
  token.onCancel(() => late++);
  assert.equal(late, 1);
});

test('espera: acaba sozinha no prazo, e cancelar a encerra antes', async () => {
  const started = Date.now();
  await waitUnlessCancelled(30, createCancelToken());
  assert.ok(Date.now() - started >= 25, 'esperou o prazo');

  const token = createCancelToken();
  const waiting = waitUnlessCancelled(60_000, token);
  token.cancel();
  await waiting; // se não encerrasse, o teste ficaria preso por um minuto
  await waitUnlessCancelled(60_000, token); // já cancelado: volta na hora
});

test('tempo de pensar: só vale um dos oferecidos; qualquer outra coisa vira o padrão', () => {
  for (const ok of [3, 5, 8, 12]) assert.equal(normalizeThinkSeconds(ok), ok);
  assert.equal(normalizeThinkSeconds('8'), 8, 'vindo do armazenamento, como texto');
  for (const bad of [null, undefined, '', 'x', 4, 0, -5, 99, NaN, {}]) assert.equal(normalizeThinkSeconds(bad), DEFAULT_THINK_SECONDS, String(bad));
});

test('limite de espera da voz: cresce com o texto, diminui com a velocidade, e tem piso e teto', () => {
  assert.equal(speechWatchdogMs('oi', 1), 8000, 'piso');
  assert.ok(speechWatchdogMs('a'.repeat(300), 1) > speechWatchdogMs('a'.repeat(100), 1));
  assert.ok(speechWatchdogMs('a'.repeat(300), 1.5) < speechWatchdogMs('a'.repeat(300), 1));
  assert.equal(speechWatchdogMs('a'.repeat(1_000_000), 1), 120_000, 'teto');
  assert.equal(speechWatchdogMs('a'.repeat(300), 0), speechWatchdogMs('a'.repeat(300), 1), 'velocidade inválida vale 1');
});

test('texto "lível": espaços e quebras sozinhos não contam', () => {
  assert.equal(isSpeakable('  \n\t '), false);
  assert.equal(isSpeakable(''), false);
  assert.equal(isSpeakable(' DNS '), true);
});
