/**
 * Os textos e a escolha de tópicos da geração de cartões por IA na página do concurso, sem React.
 * A geração em si é do servidor (server/exams/topicCards.ts); aqui só se decide quais tópicos entram
 * em cada rodada e como o botão e a confirmação explicam isso.
 */

/** Quantos tópicos uma rodada em lote gera: o bastante para render, pouco para não estourar a cota da IA de uma vez. */
export const BATCH_MAX = 20;

/** Cartões pedidos por tópico (o servidor aceita de 5 a 30). */
export const CARDS_PER_TOPIC = 12;

type Gap = { hasMaterial: boolean };

/** Os tópicos que ainda não têm cartão nenhum, na ordem do edital. */
export function topicsWithoutMaterial<T extends Gap>(topics: T[]): T[] {
  return topics.filter((t) => !t.hasMaterial);
}

/** Os próximos tópicos a gerar nesta rodada (no máximo `max`), na ordem do edital. */
export function nextBatch<T extends Gap>(topics: T[], max = BATCH_MAX): T[] {
  return topicsWithoutMaterial(topics).slice(0, max);
}

/** "Gerar cartões dos próximos 20 tópicos sem material (de 111)" ou, quando cabem todos, "dos 8 tópicos". */
export function batchButtonLabel(missing: number, max = BATCH_MAX): string {
  if (missing <= 0) return '';
  if (missing === 1) return 'Gerar cartões do tópico sem material';
  return missing <= max
    ? `Gerar cartões dos ${missing} tópicos sem material`
    : `Gerar cartões dos próximos ${max} tópicos sem material (de ${missing})`;
}

/** O que a confirmação do lote diz: quantos tópicos, quantos cartões cada um e o que acontece com o resultado. */
export function batchConfirmMessage(topicCount: number, disciplineName: string, perTopic = CARDS_PER_TOPIC): string {
  const topics = topicCount === 1 ? '1 tópico' : `${topicCount} tópicos`;
  return (
    `A IA vai criar cerca de ${perTopic} cartões para cada um de ${topics} de "${disciplineName}", um de cada vez ` +
    `(pode levar alguns minutos). Cada tópico ganha uma coleção nova, ligada a ele. Os cartões vêm só do título do ` +
    `tópico, sem texto-fonte, e ficam esperando a sua conferência: só entram na revisão depois de aprovados. Você pode ` +
    `parar a qualquer momento.`
  );
}

/** O mesmo, para um tópico só. */
export function topicConfirmMessage(topicTitle: string, perTopic = CARDS_PER_TOPIC): string {
  return (
    `A IA vai criar cerca de ${perTopic} cartões para "${topicTitle}", numa coleção nova ligada ao tópico. ` +
    `Eles vêm só do título do tópico, sem texto-fonte, e ficam esperando a sua conferência (sobretudo leis, números e ` +
    `datas): só entram na revisão depois de aprovados.`
  );
}
