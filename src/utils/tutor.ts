/** O "professor" de um cartão: as partes da conversa que não dependem da tela. As respostas vêm do servidor (server/tutor). */
import type { TutorReply } from '../types';

/** O tamanho máximo de uma pergunta e de quantas trocas anteriores acompanham um seguimento (os mesmos do servidor). */
export const MAX_ASK_CHARS = 400;
export const MAX_HISTORY_TURNS = 3;

/** Os atalhos de pergunta: o rótulo do botão e o que vai para a IA. */
export const QUICK_ASKS: { label: string; ask: string }[] = [
  { label: 'Explique melhor', ask: 'Explique melhor este cartão, com calma.' },
  { label: 'Dê um exemplo', ask: 'Dê um exemplo concreto deste assunto.' },
  { label: 'Crie um macete', ask: 'Crie um macete para eu lembrar a resposta deste cartão.' },
  { label: 'Por que é assim?', ask: 'Por que a resposta do cartão é essa? Explique o raciocínio.' },
];

/** Uma troca da conversa: o que o aluno perguntou e, quando já veio, a resposta (ou o erro que impediu). */
export interface TutorTurn {
  id: number;
  ask: string;
  reply?: TutorReply;
  error?: string;
}

/**
 * As trocas anteriores que acompanham o próximo pedido: só as que já tiveram resposta, as últimas
 * `MAX_HISTORY_TURNS`, com o texto principal da resposta. Uma troca que deu erro não entra (a IA não a respondeu).
 */
export function historyFor(turns: readonly TutorTurn[]): { ask: string; answer: string }[] {
  return turns
    .filter((turn): turn is TutorTurn & { reply: TutorReply } => !!turn.reply)
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ ask: turn.ask, answer: turn.reply.answer }));
}

/** A pergunta escrita: numa linha, aparada e até o limite; `null` se ficou vazia. */
export function cleanAsk(raw: string): string | null {
  const ask = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ASK_CHARS);
  return ask === '' ? null : ask;
}

/** As partes de uma resposta que existem, na ordem em que a tela as mostra (a explicação vem à parte). */
export function replyNotes(reply: TutorReply): { label: string; text: string }[] {
  return [
    { label: 'Exemplo', text: reply.example },
    { label: 'Macete', text: reply.tip },
    { label: 'Atenção', text: reply.caution },
  ].filter((note) => note.text !== '');
}
