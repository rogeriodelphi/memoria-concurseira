/**
 * Sugestão para um cartão sanguessuga (um cartão que o usuário erra sempre): por que ele é difícil, um macete e,
 * se trouxer mais de uma ideia, uma divisão em cartões menores. O prompt, o esquema e a validação ficam aqui,
 * num módulo neutro, e são os mesmos para OpenAI, Gemini e Claude. A IA só PROPÕE: nada é gravado sem o usuário
 * aceitar, e a resposta é texto puro (a tela o põe no editor como qualquer texto digitado).
 */

/** Quanto de cada lado do cartão vai para a IA: um cartão enorme não pode estourar o pedido. */
export const MAX_SOURCE_CHARS = 3000;
export const MAX_DIAGNOSIS_CHARS = 300;
/** O mesmo limite do campo "macete" da tela (src/utils/leeches.ts). */
export const MAX_MACETE_CHARS = 300;
/** Em quantos cartões a IA pode propor quebrar (a tela aceita até 6). */
export const MAX_SUGGESTED_PARTS = 4;
const MAX_PART_CHARS = 1500;

export interface LeechFixSource {
  /** O texto puro de cada lado (sem marcação, sem imagens). */
  question: string;
  answer: string;
  /** Onde o cartão está: "Redes de Computadores · Cluster". */
  context: string;
  /** Quantas das últimas revisões foram "Errei". */
  errors: number;
  reviews: number;
}

export interface LeechFix {
  /** Uma frase sobre por que o cartão provavelmente é difícil. */
  diagnosis: string;
  /** Um jeito curto de lembrar; vazio quando não há um honesto. */
  macete: string;
  /** Os cartões menores propostos (2 ou mais), ou nenhum quando o cartão já é uma ideia só. */
  split: { question: string; answer: string }[];
}

export const LEECH_FIX_SYSTEM_PROMPT = `Você é um tutor de estudos para concursos públicos brasileiros. O usuário erra sempre um cartão de revisão (ele marcou "Errei" várias vezes). Ajude a torná-lo fácil de memorizar, SEM acrescentar fatos que o cartão não traz e sem corrigir o conteúdo dele.
Responda com o JSON pedido:
- "diagnosis": uma frase curta dizendo por que este cartão provavelmente é difícil (por exemplo: traz mais de uma ideia; é uma lista longa; a pergunta é vaga ou faz duas perguntas; a resposta é extensa; envolve conceitos parecidos que se confundem).
- "macete": um jeito curto de lembrar a resposta (uma sigla, uma frase-gancho, uma imagem mental ou uma comparação), em até 200 caracteres, usando apenas o que a resposta do cartão diz. Se não houver um macete honesto, deixe vazio: um macete forçado atrapalha mais do que ajuda.
- "split": se o cartão trouxer mais de uma ideia, quebre-o em 2 a ${MAX_SUGGESTED_PARTS} cartões menores, de UMA ideia só, cada um com "question" e "answer" curtos. Cada pergunta precisa fazer sentido sozinha, sem depender dos outros cartões, e as respostas devem vir só do cartão original. Se o cartão já é uma ideia só, devolva a lista vazia.
Regras: português do Brasil; texto puro, sem markdown e sem HTML; não comece o macete com "Macete:"; seja específico, não genérico.`;

export const LEECH_FIX_JSON_SCHEMA = {
  type: 'object',
  properties: {
    diagnosis: { type: 'string' },
    macete: { type: 'string' },
    split: {
      type: 'array',
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, answer: { type: 'string' } },
        required: ['question', 'answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['diagnosis', 'macete', 'split'],
  additionalProperties: false,
};

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** O pedido que vai para a IA: o cartão, onde ele está e o quanto o usuário o erra. */
export function leechFixUserPrompt(source: LeechFixSource): string {
  const where = source.context ? `Coleção: ${source.context}\n` : '';
  return (
    `${where}O usuário errou este cartão ${source.errors} das últimas ${source.reviews} revisões.\n\n` +
    `Pergunta: ${truncate(source.question, MAX_SOURCE_CHARS)}\nResposta: ${truncate(source.answer, MAX_SOURCE_CHARS)}`
  );
}

/**
 * Texto puro, numa linha só: sem marcação, sem o enfeite de markdown (negrito com ** ou __ e crases) e sem espaços
 * repetidos. Um `_`, `*` ou `#` sozinho fica: pode ser texto de verdade ("C#", "snake_case").
 */
function tidy(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const LEADING_MACETE_LABEL = /^macete\s*[:\-–—]\s*/i;

/**
 * Valida a resposta da IA. Devolve só o que serve: o diagnóstico e o macete limpos, e a divisão apenas se tiver
 * 2 ou mais cartões completos (um "cartão dividido em um" não é divisão). Sem macete e sem divisão não há o que
 * propor: é erro, e aí a cadeia de provedores pode tentar o próximo.
 */
export function parseLeechFixResponse(rawText: string | undefined): LeechFix {
  const unusable = 'A IA não trouxe nenhuma sugestão utilizável para este cartão.';
  if (!rawText) throw new Error(unusable);
  let parsed: { diagnosis?: unknown; macete?: unknown; split?: unknown };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(unusable);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(unusable);

  const diagnosis = tidy(parsed.diagnosis, MAX_DIAGNOSIS_CHARS);
  const macete = tidy(parsed.macete, MAX_MACETE_CHARS).replace(LEADING_MACETE_LABEL, '');

  const parts: LeechFix['split'] = [];
  if (Array.isArray(parsed.split)) {
    for (const item of parsed.split as Record<string, unknown>[]) {
      const question = tidy(item?.question, MAX_PART_CHARS);
      const answer = tidy(item?.answer, MAX_PART_CHARS);
      if (question && answer) parts.push({ question, answer });
      if (parts.length === MAX_SUGGESTED_PARTS) break;
    }
  }
  const split = parts.length >= 2 ? parts : [];

  if (!macete && split.length === 0) throw new Error(unusable);
  return { diagnosis, macete, split };
}
