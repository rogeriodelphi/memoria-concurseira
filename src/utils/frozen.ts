/** Os textos do congelamento de coleções (fora das revisões automáticas, com os cartões intactos). */

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

/** O nome da coleção como as mensagens a chamam: "Nome · assunto", ou só o nome. */
export const collectionLabel = (c: { name: string; subject: string }) => (c.subject ? `${c.name} · ${c.subject}` : c.name);

/** O selo da lista: "Congelada" e, se houver, quantos cartões ficaram esperando. */
export function frozenBadgeText(waiting: number): string {
  return waiting > 0 ? `Congelada · ${waiting.toLocaleString('pt-BR')} em espera` : 'Congelada';
}

export const freezeMessage = (label: string) => `“${label}” congelada: sai das revisões, e os cartões ficam como estão.`;

/** O aviso ao descongelar: quantos cartões voltam às revisões agora. */
export function unfreezeMessage(label: string, returning: number): string {
  return returning > 0
    ? `“${label}” descongelada: ${plural(returning, 'cartão volta', 'cartões voltam')} às revisões.`
    : `“${label}” descongelada.`;
}

/** O aviso da Reta final: as coleções congeladas deste concurso não entram na prioridade nem na fila (e por que isso não é falta de cartões). */
export function retaFrozenNote(count: number): string {
  return `${plural(count, 'coleção congelada deste concurso fica', 'coleções congeladas deste concurso ficam')} de fora da Reta final: ${count === 1 ? 'ela não entra' : 'elas não entram'} na prioridade das disciplinas nem na fila do foco. Descongele para ${count === 1 ? 'incluí-la' : 'incluí-las'} de volta.`;
}

/** O que a página da coleção diz enquanto ela está congelada. */
export function frozenNotice(frozenAt: string): string {
  const since = new Date(frozenAt).toLocaleDateString('pt-BR');
  return `Congelada desde ${since}. Os cartões não entram nas revisões, no Painel, na Meta para a prova nem na Reta final, e nada neles mudou. Você ainda pode estudá-la por aqui.`;
}
