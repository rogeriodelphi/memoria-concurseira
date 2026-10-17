/**
 * Texto pronto para comparar numa pesquisa: sem acentos, sem maiúsculas e com os espaços
 * repetidos reduzidos a um ("Língua  Portuguesa" e "lingua portuguesa" ficam iguais).
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * As coleções cujo nome ou assunto contém o que foi digitado. Cada palavra digitada precisa
 * aparecer em algum dos dois, em qualquer ordem: "regencia portuguesa" acha "Língua
 * Portuguesa — Regência Verbal", com o nome numa palavra e o assunto na outra. Pesquisa vazia
 * devolve a própria lista.
 */
export function filterCollections<T extends { name: string; subject: string }>(items: T[], query: string): T[] {
  const terms = normalizeForSearch(query).split(' ').filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const text = normalizeForSearch(`${item.name} ${item.subject}`);
    return terms.every((term) => text.includes(term));
  });
}
