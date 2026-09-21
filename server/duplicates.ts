import crypto from 'node:crypto';

// Normaliza pergunta/resposta pra comparação de duplicidade: remove tags
// (um cartão em HTML e o mesmo cartão em texto simples devem contar como
// duplicados), colapsa espaços e ignora maiúsculas/minúsculas. Só quebras de
// bloco (</p>, </div>, </li>, <br>) viram espaço — tags inline (<b>, <span>
// etc.) somem sem deixar espaço, senão "<b>phishing</b>?" normalizaria
// diferente de "phishing?" só por causa do espaço da tag removida colado à
// pontuação.
export function normalizeForDuplicateCheck(value: string): string {
  return value
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// A "chave" de duplicidade é só a resposta, de propósito — a mesma pergunta
// pode legitimamente se repetir (ex.: formulada diferente em cada coleção),
// mas duas respostas idênticas significam conteúdo redundante de verdade,
// mesmo que a pergunta que leva até ela seja outra.
export function duplicateKey(answer: string): string {
  return normalizeForDuplicateCheck(answer);
}

const ENTITY_TEXT: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * Chave usada na importação do Anki. Parte da mesma regra acima, mas o HTML
 * do Anki vem cheio de entidades (`&nbsp;` é onipresente) que não existem no
 * texto simples dos cartões gerados pela IA — sem decodificá-las, o mesmo
 * conteúdo teria chaves diferentes e o duplicado passaria. Vale dos dois
 * lados da comparação (cartão do arquivo e cartão já salvo).
 *
 * Resposta que é só imagem não tem texto pra comparar, então a chave passa a
 * ser o hash do HTML: a mesma imagem reimportada é detectada, e imagens
 * diferentes não viram "duplicadas" só por ambas não terem texto.
 */
export function importAnswerKey(answerHtml: string): string {
  const text = duplicateKey(answerHtml)
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITY_TEXT[entity])
    .replace(/\s+/g, ' ')
    .trim();
  if (text) return text;
  return /<img\b/i.test(answerHtml) ? `img:${crypto.createHash('sha1').update(answerHtml).digest('hex')}` : '';
}
