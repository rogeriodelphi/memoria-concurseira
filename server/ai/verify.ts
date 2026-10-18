/**
 * A "segunda opinião" sobre cartões que a IA escreveu sem texto-fonte: outra chamada (de preferência a outro
 * provedor) lê cada cartão e diz se a resposta está correta, duvidosa ou errada. Não prova nada (a IA que
 * confere também pode errar): serve para chamar a atenção para o que merece uma olhada antes de aprovar.
 * O prompt, o esquema e a validação ficam aqui, num módulo neutro, e são os mesmos para OpenAI, Gemini e Claude.
 */

/** Quantos cartões vão numa chamada só: mais que isso e a IA começa a misturar a correspondência. */
export const MAX_VERIFY_PER_CALL = 12;
const MAX_NOTE_CHARS = 400;
const MAX_SOURCE_CHARS = 1500;

export type Verdict = 'ok' | 'duvida' | 'erro';
const VERDICTS: readonly Verdict[] = ['ok', 'duvida', 'erro'];

export interface VerifySource {
  /** Número do cartão nesta chamada (1, 2, 3...): é o que a IA devolve para dizer de qual cartão fala. */
  n: number;
  question: string;
  answer: string;
}

export interface VerifiedCard {
  n: number;
  verdict: Verdict;
  /** Uma frase em português com o motivo (vazia quando o cartão está certo e a IA não tem o que acrescentar). */
  note: string;
}

export const VERIFY_SYSTEM_PROMPT = `Você é revisor técnico de material de estudo para concursos públicos brasileiros.
Recebe cartões de estudo (uma pergunta e a resposta) escritos por uma IA sem consulta a fonte nenhuma. Para cada
cartão, avalie se a RESPOSTA está correta e é precisa, com base no que você sabe:
- "ok": a resposta está correta e precisa.
- "duvida": está incompleta, imprecisa, desatualizada ou ambígua, ou você não tem certeza. Atenção redobrada a número de
  artigo, prazo, valor, percentual, sigla, data e nome de lei, norma ou órgão: se não tiver certeza do detalhe, é "duvida".
- "erro": a resposta está incorreta (ou a pergunta induz a uma resposta errada).
Seja conservador: na dúvida entre "ok" e "duvida", escolha "duvida". Nunca invente uma correção.
Em "note" escreva uma frase curta, em português, com o motivo. Em "duvida" e "erro", diga o que está errado ou incerto e,
só se tiver certeza, qual é o correto. Em "ok", deixe "note" vazio.
Responda com o JSON pedido: um item por cartão, usando o mesmo número "n" do cartão.`;

export const VERIFY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          verdict: { type: 'string', enum: [...VERDICTS] },
          note: { type: 'string' },
        },
        required: ['n', 'verdict', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['checks'],
  additionalProperties: false,
};

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Os cartões numerados e o contexto da prova, como o pedido que vai para a IA. */
export function verifyUserPrompt(sources: VerifySource[], context: string): string {
  const cards = sources
    .map((s) => `[n=${s.n}]\nPergunta: ${truncate(s.question, MAX_SOURCE_CHARS)}\nResposta: ${truncate(s.answer, MAX_SOURCE_CHARS)}`)
    .join('\n\n');
  const where = context.trim() ? `Contexto: ${context.trim()}\n\n` : '';
  return `Confira os cartões abaixo.\n\n${where}${cards}`;
}

/**
 * Valida a resposta da IA contra os cartões pedidos. Devolve só as conferências que servem (número conhecido e
 * sem repetição, veredito válido); as outras ficam de fora e o cartão correspondente fica "sem conferência", em
 * vez de derrubar as demais. Se nenhuma serve, é erro: a cadeia de provedores pode tentar o próximo.
 */
export function parseVerifyResponse(rawText: string | undefined, sources: VerifySource[]): VerifiedCard[] {
  const unusable = 'A IA não retornou a conferência no formato esperado.';
  if (!rawText) throw new Error(unusable);
  let parsed: { checks?: unknown };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(unusable);
  }
  if (!Array.isArray(parsed.checks)) throw new Error(unusable);

  const wanted = new Set(sources.map((s) => s.n));
  const seen = new Set<number>();
  const checks: VerifiedCard[] = [];
  for (const item of parsed.checks as Record<string, unknown>[]) {
    const n = item?.n;
    if (typeof n !== 'number' || !wanted.has(n) || seen.has(n)) continue;
    const verdict = item.verdict;
    if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) continue;
    const note = typeof item.note === 'string' ? item.note.replace(/\s+/g, ' ').trim() : '';
    seen.add(n);
    checks.push({ n, verdict: verdict as Verdict, note: truncate(note, MAX_NOTE_CHARS) });
  }
  if (checks.length === 0) throw new Error(unusable);
  return checks;
}
