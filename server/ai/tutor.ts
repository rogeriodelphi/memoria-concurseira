/**
 * O "professor" de um cartão: o usuário está estudando, não entendeu (ou quer um exemplo, um macete, o porquê) e pergunta
 * à IA sobre aquele cartão. O prompt, o esquema e a validação ficam aqui, num módulo neutro, e são os mesmos para OpenAI,
 * Gemini e Claude. A IA só RESPONDE: nada é gravado (nem no cartão, nem no agendamento), e a resposta é texto puro.
 *
 * Ao contrário da sugestão para cartões difíceis, o professor pode usar conhecimento geral para explicar (um cartão
 * curto raramente se explica sozinho), mas a resposta do cartão continua sendo a referência do usuário: a IA não corrige
 * o cartão com afirmações, só aponta uma dúvida, e não inventa números, datas, artigos de lei nem jurisprudência.
 */

/** Quanto de cada lado do cartão vai para a IA, e o tamanho da pergunta e do histórico que o servidor aceita. */
export const MAX_SOURCE_CHARS = 3000;
export const MAX_ASK_CHARS = 400;
/** Quantas trocas anteriores (pergunta e resposta) acompanham um pedido de seguimento, e o tamanho de cada resposta delas. */
export const MAX_HISTORY_TURNS = 3;
export const MAX_HISTORY_REPLY_CHARS = 1500;
const MAX_ANSWER_CHARS = 1800;
const MAX_NOTE_CHARS = 400;

/** O que o usuário pede quando só aperta "Explicar". */
export const DEFAULT_ASK = 'Explique este cartão com calma, como um professor, para eu entender e conseguir lembrar.';

export interface TutorTurn {
  ask: string;
  /** O que a IA respondeu (só o texto principal), para o seguimento fazer sentido. */
  answer: string;
}

export interface TutorSource {
  /** O texto puro de cada lado do cartão (sem marcação, sem imagens). */
  question: string;
  answer: string;
  /** Onde o cartão está: "Redes de Computadores · Cluster". */
  context: string;
  /** O que o usuário perguntou agora. */
  ask: string;
  /** As trocas anteriores desta conversa, da mais antiga para a mais nova. */
  history: TutorTurn[];
}

export interface TutorReply {
  /** A explicação, ou a resposta à pergunta do usuário (pode ter parágrafos). */
  answer: string;
  /** Um exemplo concreto e curto; vazio quando não ajuda. */
  example: string;
  /** Um jeito curto de lembrar; vazio quando não há um honesto. */
  tip: string;
  /** Uma pegadinha comum, ou uma dúvida sobre o que o cartão diz; vazio quando não há. */
  caution: string;
}

export const TUTOR_SYSTEM_PROMPT = `Você é um professor paciente que prepara o aluno para concursos públicos brasileiros. O aluno está revisando um cartão e quer entendê-lo melhor. Responda ao que ele pediu, em português do Brasil, com clareza e sem enrolar.
Responda com o JSON pedido:
- "answer": a explicação ou a resposta ao pedido do aluno, em linguagem simples, em até 8 frases, em parágrafos curtos separados por uma linha em branco. Parta do que o cartão diz; explique o porquê e a ideia por trás, não repita o cartão palavra por palavra.
- "example": um exemplo concreto e curto que ilustre a ideia; vazio se um exemplo não ajudar.
- "tip": um jeito curto de lembrar (uma sigla, uma frase-gancho, uma comparação), em até 200 caracteres; vazio se não houver um honesto. Um macete forçado atrapalha mais do que ajuda.
- "caution": uma pegadinha comum de prova sobre este assunto, ou uma dúvida sobre o que o cartão diz; vazio se não houver. Se algo no cartão parecer errado ou incompleto, aponte como DÚVIDA ("vale conferir na fonte se...") e nunca como correção.
Regras: a resposta do cartão é a referência do aluno. Você pode usar conhecimento geral para explicar, mas NÃO invente números, datas, artigos de lei, nomes de normas nem jurisprudência: se não tiver certeza, diga que não tem. Texto puro, sem markdown e sem HTML. Se o pedido do aluno não tiver relação com o cartão, responda em uma frase que você só ajuda com este cartão e deixe o resto vazio.`;

export const TUTOR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    example: { type: 'string' },
    tip: { type: 'string' },
    caution: { type: 'string' },
  },
  required: ['answer', 'example', 'tip', 'caution'],
  additionalProperties: false,
};

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** O pedido que vai para a IA: o cartão, onde ele está, a conversa até aqui e o que o aluno pediu agora. */
export function tutorUserPrompt(source: TutorSource): string {
  const where = source.context ? `Coleção: ${source.context}\n` : '';
  const history = source.history
    .map((turn) => `Aluno: ${truncate(turn.ask, MAX_ASK_CHARS)}\nProfessor: ${truncate(turn.answer, MAX_HISTORY_REPLY_CHARS)}`)
    .join('\n\n');
  return (
    `${where}Pergunta do cartão: ${truncate(source.question, MAX_SOURCE_CHARS)}\nResposta do cartão: ${truncate(source.answer, MAX_SOURCE_CHARS)}\n\n` +
    (history ? `Conversa até aqui:\n${history}\n\n` : '') +
    `Pedido do aluno: ${source.ask || DEFAULT_ASK}`
  );
}

/** Texto puro numa linha só (sem marcação nem o enfeite de markdown). Um `_`, `*` ou `#` sozinho fica: pode ser texto de verdade. */
function tidyLine(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Como `tidyLine`, mas mantém os parágrafos (no máximo uma linha em branco entre eles). */
function tidyParagraphs(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const LEADING_LABEL = /^(macete|exemplo|aten[cç][aã]o|cuidado|pegadinha)\s*[:\-–—]\s*/i;

/**
 * Valida a resposta da IA. Sem a explicação não há o que mostrar: é erro, e aí a cadeia de provedores pode tentar o
 * próximo. Os campos opcionais vêm limpos (sem o rótulo que a tela já põe) e vazios quando a IA não os preencheu.
 */
export function parseTutorResponse(rawText: string | undefined): TutorReply {
  const unusable = 'A IA não trouxe nenhuma explicação utilizável para este cartão.';
  if (!rawText) throw new Error(unusable);
  let parsed: { answer?: unknown; example?: unknown; tip?: unknown; caution?: unknown };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(unusable);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(unusable);

  const answer = tidyParagraphs(parsed.answer, MAX_ANSWER_CHARS);
  if (!answer) throw new Error(unusable);
  return {
    answer,
    example: tidyLine(parsed.example, MAX_NOTE_CHARS).replace(LEADING_LABEL, ''),
    tip: tidyLine(parsed.tip, MAX_NOTE_CHARS).replace(LEADING_LABEL, ''),
    caution: tidyLine(parsed.caution, MAX_NOTE_CHARS).replace(LEADING_LABEL, ''),
  };
}
