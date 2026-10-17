/**
 * Alternativas de múltipla escolha para cartões de estudo. O prompt, o esquema e a validação ficam
 * aqui, num módulo neutro, e são os mesmos para OpenAI, Gemini e Claude: o resultado de qualquer
 * provedor passa pela mesma conferência antes de ser guardado.
 */

/** Uma correta e quatro erradas: o formato de prova com alternativas de A a E. */
export const WRONG_PER_QUESTION = 4;
const MIN_WRONG = 3;
const MAX_OPTION_CHARS = 600;
/** Quanto de cada cartão vai para a IA: um cartão enorme não pode estourar o pedido dos outros. */
const MAX_SOURCE_CHARS = 1500;
/** Quantos cartões vão numa chamada só: mais que isso e a IA começa a errar a correspondência. */
export const MAX_CARDS_PER_CALL = 10;

export interface ChoiceSource {
  /** Número do cartão nesta chamada (1, 2, 3...): é o que a IA devolve para dizer de qual cartão fala. */
  n: number;
  question: string;
  answer: string;
}

export interface GeneratedChoice {
  n: number;
  correct: string;
  wrong: string[];
}

export const CHOICES_SYSTEM_PROMPT = `Você é elaborador de questões de múltipla escolha para concursos públicos brasileiros, no estilo das grandes bancas (CEBRASPE, FGV, FCC, CESGRANRIO, VUNESP).
Para cada cartão de estudo (uma pergunta e a sua resposta correta), crie uma questão objetiva:
- "correct": a alternativa correta. Ela deve expressar fielmente a resposta do cartão. Pode resumi-la e escrevê-la como uma afirmação direta, mas nunca contradizê-la nem acrescentar fatos que o cartão não traz.
- "wrong": exatamente ${WRONG_PER_QUESTION} alternativas incorretas, difíceis de descartar por quem estudou o assunto pela metade:
  • pelo menos duas devem ser "quase certas": copie a estrutura da correta e troque um único elemento (um número, prazo, sigla, sujeito, condição, exceção ou a relação entre dois conceitos);
  • as demais podem usar um conceito vizinho do mesmo tema, que o candidato confundiria com o certo. Se outros cartões deste pedido tratam de conceitos próximos, aproveite-os: uma afirmação verdadeira sobre o outro conceito, mas que não responde a esta pergunta, é uma errada excelente;
  • nenhuma pode ser absurda nem fora do assunto, e nenhuma pode ser, também, uma resposta aceitável para a pergunta: cada uma precisa estar claramente errada em relação à resposta do cartão.
Regras para todas as alternativas:
- Mesma estrutura gramatical, tamanho e nível de detalhe. A correta não pode ser a mais longa, a mais detalhada nem a única com ressalvas ou termos técnicos.
- Termos absolutos ("sempre", "nunca", "apenas", "somente", "exclusivamente") só entram numa alternativa se estiverem também na correta ou no cartão: sozinhos, delatam uma errada.
- Nunca use "todas as anteriores", "nenhuma das anteriores", "ambas" nem variações assim.
- Não repita a pergunta e não comece com letras ou números (nada de "a)" ou "1.").
- Não escreva explicações.
Responda com o JSON pedido: uma questão por cartão, usando o mesmo número "n" do cartão.`;

export const CHOICES_JSON_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          correct: { type: 'string' },
          wrong: { type: 'array', items: { type: 'string' } },
        },
        required: ['n', 'correct', 'wrong'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Os cartões numerados, como o pedido que vai para a IA. */
export function choicesUserPrompt(sources: ChoiceSource[]): string {
  const cards = sources
    .map(
      (s) =>
        `[n=${s.n}]\nPergunta: ${truncate(s.question, MAX_SOURCE_CHARS)}\nResposta: ${truncate(s.answer, MAX_SOURCE_CHARS)}`,
    )
    .join('\n\n');
  return `Crie as questões de múltipla escolha para os cartões abaixo.\n\n${cards}`;
}

/** Para comparar alternativas: sem acentos, maiúsculas, pontuação final nem espaços repetidos. */
function fingerprint(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.;,:!?]+$/, '')
    .trim();
}

// "Todas as anteriores" e parentes: alternativas que entregam a resposta (ou não dizem nada).
const CATCH_ALL =
  /\b(todas|nenhuma|ambas)\s+((as|das|dessas|destas|essas)\s+)?(anteriores|alternativas|acima|opcoes|afirmativas|assertivas)\b/;
// "a) texto", "B. texto", "1) texto": a letra que a IA põe sem pedir
const LEADING_LABEL = /^\s*(\(?[a-eA-E]\)|[a-eA-E][.)]|\d+[.)])\s+/;

function cleanOption(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(LEADING_LABEL, '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_OPTION_CHARS) return null;
  if (CATCH_ALL.test(fingerprint(text))) return null;
  return text;
}

/**
 * Valida a resposta da IA contra os cartões pedidos. Devolve só as questões que servem: número
 * conhecido e sem repetição, alternativa correta e pelo menos três erradas diferentes entre si e da
 * correta (as sobras além de quatro são descartadas). Questões que não servem ficam de fora em vez de
 * derrubar as outras — quem chamou vê quais cartões não voltaram. Se nenhuma serve, é erro: aí a
 * cadeia de provedores pode tentar o próximo.
 */
export function parseChoicesResponse(rawText: string | undefined, sources: ChoiceSource[]): GeneratedChoice[] {
  const unusable = 'A IA não retornou as alternativas no formato esperado.';
  if (!rawText) throw new Error(unusable);
  let parsed: { questions?: unknown };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(unusable);
  }
  if (!Array.isArray(parsed.questions)) throw new Error(unusable);

  const wanted = new Set(sources.map((s) => s.n));
  const seen = new Set<number>();
  const choices: GeneratedChoice[] = [];

  for (const question of parsed.questions as Record<string, unknown>[]) {
    const n = question?.n;
    if (typeof n !== 'number' || !wanted.has(n) || seen.has(n)) continue;
    const correct = cleanOption(question.correct);
    if (!correct || !Array.isArray(question.wrong)) continue;

    const taken = new Set([fingerprint(correct)]);
    const wrong: string[] = [];
    for (const raw of question.wrong) {
      const option = cleanOption(raw);
      if (!option) continue;
      const print = fingerprint(option);
      if (taken.has(print)) continue;
      taken.add(print);
      wrong.push(option);
      if (wrong.length === WRONG_PER_QUESTION) break;
    }
    if (wrong.length < MIN_WRONG) continue;

    seen.add(n);
    choices.push({ n, correct, wrong });
  }

  if (choices.length === 0) throw new Error(unusable);
  return choices;
}
