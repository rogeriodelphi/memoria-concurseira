export type CardTextRole = 'question' | 'answer';

/**
 * Aparência padrão dos campos do cartão: pergunta em negrito e justificada,
 * resposta só justificada. É só CSS herdado — nada é gravado no cartão —, então
 * vale pros cartões que já existem e pros novos, e qualquer formatação que o
 * usuário aplique no editor (alinhar ao centro, tirar o negrito) vira estilo
 * inline no próprio trecho e prevalece sobre este padrão.
 *
 * `w-full` porque na tela de estudo o texto fica num flex com `items-center`,
 * onde o bloco encolheria até o tamanho do conteúdo e não haveria linha cheia
 * pra justificar.
 */
export const CARD_TEXT_STYLE: Record<CardTextRole, string> = {
  question: 'w-full font-bold text-justify',
  answer: 'w-full text-justify',
};
