import OpenAI, { APIError } from 'openai';

import {
  parseSyllabusResponse,
  SYLLABUS_SYSTEM_PROMPT,
  syllabusUserPrompt,
  type GeneratedBulletPoints,
  type GeneratedFlashcard,
  type GeneratedSummary,
  type GeneratedSyllabus,
  type GenerationOptions,
  type MindMapNode,
  type SummaryMode,
} from './gemini';
import {
  CHOICES_JSON_SCHEMA,
  CHOICES_SYSTEM_PROMPT,
  choicesUserPrompt,
  parseChoicesResponse,
  type ChoiceSource,
  type GeneratedChoice,
} from './choices';
import {
  LEECH_FIX_JSON_SCHEMA,
  LEECH_FIX_SYSTEM_PROMPT,
  leechFixUserPrompt,
  parseLeechFixResponse,
  type LeechFix,
  type LeechFixSource,
} from './leechfix';
import { parseTutorResponse, TUTOR_JSON_SCHEMA, TUTOR_SYSTEM_PROMPT, tutorUserPrompt, type TutorReply, type TutorSource } from './tutor';
import { recordUsage, reportProviderOutcome, type ProviderStatus } from './usage';
import { parseVerifyResponse, VERIFY_JSON_SCHEMA, VERIFY_SYSTEM_PROMPT, verifyUserPrompt, type VerifiedCard, type VerifySource } from './verify';
import {
  parsePastExamResponse,
  pastExamUserPrompt,
  PASTEXAM_JSON_SCHEMA,
  PASTEXAM_SYSTEM_PROMPT,
  type Chunk,
  type ChunkPosition,
  type PastExamHints,
} from './pastexam';

// gpt-4o-mini: barato e rápido, com suporte a saída estruturada (JSON
// Schema) e visão (imagem) — suficiente pra tópico/texto/imagem. PDF e
// áudio/vídeo/YouTube não têm equivalente nativo aqui (ver server/ai/router.ts).
const OPENAI_MODEL = 'gpt-4o-mini';

export function hasOpenAI(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada no servidor (.env).');
  }
  return new OpenAI({ apiKey });
}

function isInsufficientQuota(err: APIError): boolean {
  const body = err.error as { code?: string; type?: string } | null | undefined;
  return body?.code === 'insufficient_quota' || body?.type === 'insufficient_quota';
}

function friendlyOpenAIError(err: unknown): Error {
  if (err instanceof APIError) {
    if (err.status === 429 && isInsufficientQuota(err)) {
      return new Error(
        'A conta da OpenAI está sem créditos. Adicione créditos em ' +
          'https://platform.openai.com/settings/organization/billing para usar a OpenAI (enquanto isso, ' +
          'as gerações continuam funcionando pelo Gemini quando possível).',
      );
    }
    if (err.status === 429) {
      return new Error(
        'Limite de uso da OpenAI atingido no momento. Tente de novo em alguns instantes ou verifique seu plano ' +
          'em https://platform.openai.com/usage.',
      );
    }
    if (err.status === 401) {
      return new Error('Chave da OpenAI inválida ou ausente (confira OPENAI_API_KEY no .env do servidor).');
    }
    if (typeof err.status === 'number' && err.status >= 500) {
      return new Error('A OpenAI está com instabilidade no momento. Tente novamente em alguns instantes.');
    }
  }
  return new Error('Falha ao se comunicar com a OpenAI. Tente novamente.');
}

const MAX_ATTEMPTS = 3;

function providerStatusFor(err: APIError): ProviderStatus | null {
  if (err.status === 429) return isInsufficientQuota(err) ? 'no_credits' : 'rate_limited';
  if (err.status === 401) return 'invalid_key';
  if (typeof err.status === 'number' && err.status >= 500) return 'unavailable';
  return null;
}

function trackOpenAISuccess(response: OpenAI.Chat.ChatCompletion): void {
  const usage = response.usage;
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  recordUsage('openai', { input, output, total: usage?.total_tokens ?? input + output });
  reportProviderOutcome('openai', 'ok');
}

async function chatCompletionWithRetry(
  client: OpenAI,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.chat.completions.create(params);
      trackOpenAISuccess(response);
      return response;
    } catch (err) {
      if (!(err instanceof APIError)) throw err;
      // Sem créditos não se resolve tentando de novo — falha rápido em vez
      // de esperar e repetir 3x uma chamada que sempre vai falhar do mesmo jeito.
      const retryable =
        !isInsufficientQuota(err) &&
        (err.status === 429 || (typeof err.status === 'number' && err.status >= 500));
      if (!retryable || attempt === MAX_ATTEMPTS) {
        const outcome = providerStatusFor(err);
        if (outcome) reportProviderOutcome('openai', outcome);
        throw friendlyOpenAIError(err);
      }
      const retryAfterHeader = err.headers?.get?.('retry-after');
      const delayMs = retryAfterHeader ? Math.min(Number(retryAfterHeader) * 1000, 30000) : 2000 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Falha ao chamar a IA.');
}

export type OpenAISource =
  | { type: 'topic'; topic: string }
  | { type: 'text'; text: string }
  | { type: 'image'; base64: string; mimeType: string }
  | { type: 'pdf_text'; extractedText: string; filename: string };

function userContentFor(
  source: OpenAISource,
  instruction: string,
): OpenAI.Chat.ChatCompletionContentPart[] | string {
  if (source.type === 'topic') {
    return `${instruction}\n\nTópico: "${source.topic}"`;
  }
  if (source.type === 'text') {
    return `${instruction}\n\n--- TEXTO ---\n${source.text}`;
  }
  if (source.type === 'pdf_text') {
    return `${instruction}\n\n--- CONTEÚDO EXTRAÍDO DO ARQUIVO "${source.filename}" ---\n${source.extractedText}`;
  }
  return [
    { type: 'text', text: instruction },
    { type: 'image_url', image_url: { url: `data:${source.mimeType};base64,${source.base64}` } },
  ];
}

const FLASHCARDS_SYSTEM_PROMPT = `Você é especialista em educação, aprendizagem ativa e criação de flashcards.
Analise cuidadosamente o conteúdo fornecido (ou use seu próprio conhecimento, se for um tópico).
Transforme os conhecimentos mais relevantes em flashcards objetivos, claros e úteis.
As perguntas devem testar efetivamente o conhecimento do estudante.
Quando houver conteúdo fornecido, as respostas devem se basear nele — não invente informações.
Evite perguntas redundantes.
Priorize conceitos, definições, classificações, características, regras, exceções, comparações e
informações relevantes para provas de concursos públicos brasileiros.
Responda apenas com o JSON pedido, sem texto adicional.`;

const FLASHCARDS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          difficulty: { type: 'string', enum: ['facil', 'medio', 'dificil'] },
        },
        required: ['question', 'answer', 'difficulty'],
        additionalProperties: false,
      },
    },
  },
  required: ['flashcards'],
  additionalProperties: false,
};

function quantityInstruction(quantity: GenerationOptions['quantity']): string {
  if (quantity === 'auto') {
    return 'Gere a quantidade de flashcards que fizer sentido para cobrir bem o conteúdo (tipicamente entre 15 e 60).';
  }
  return `Gere exatamente ${quantity} flashcards.`;
}

function typeInstruction(type: GenerationOptions['cardType']): string {
  switch (type) {
    case 'verdadeiro_falso':
      return 'Formate cada pergunta como uma afirmação a ser julgada verdadeira ou falsa, e a resposta deve confirmar/corrigir a afirmação.';
    case 'multipla_escolha':
      return 'Formate a pergunta incluindo as alternativas (A, B, C, D) no texto da pergunta, e a resposta deve indicar a alternativa correta com justificativa breve.';
    case 'conceito_definicao':
      return 'Formate cada flashcard como "Conceito" na pergunta e "Definição" na resposta.';
    case 'misto':
      return 'Varie entre pergunta e resposta direta, verdadeiro ou falso, múltipla escolha e conceito/definição.';
    default:
      return 'Formate cada flashcard como uma pergunta direta e uma resposta objetiva.';
  }
}

function depthInstruction(depth: GenerationOptions['depth']): string {
  switch (depth) {
    case 'essencial':
      return 'Foque apenas nos pontos essenciais, ideais para uma primeira revisão.';
    case 'avancado':
      return 'Aprofunde em detalhes, exceções e casos específicos, além dos conceitos centrais.';
    default:
      return 'Cubra os conceitos centrais com um nível de detalhe normal, adequado para revisão de concurso.';
  }
}

function sharedInstructions(options: GenerationOptions): string {
  const difficultyInstruction =
    options.difficulty === 'misto'
      ? 'Varie o nível de dificuldade entre fácil, médio e difícil.'
      : `Use predominantemente o nível de dificuldade "${options.difficulty}".`;
  const focusInstruction = options.focus?.trim() ? `Priorize especialmente: ${options.focus.trim()}` : '';
  return [
    quantityInstruction(options.quantity),
    typeInstruction(options.cardType),
    depthInstruction(options.depth),
    difficultyInstruction,
    focusInstruction,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function generateFlashcardsOpenAI(
  source: OpenAISource,
  options: GenerationOptions,
): Promise<{ flashcards: GeneratedFlashcard[] }> {
  const client = getClient();
  const instruction = [
    source.type === 'topic'
      ? 'O tópico abaixo é o assunto a ser transformado em flashcards.'
      : 'O conteúdo abaixo é o material a ser transformado em flashcards.',
    sharedInstructions(options),
  ].join('\n');

  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: FLASHCARDS_SYSTEM_PROMPT },
      { role: 'user', content: userContentFor(source, instruction) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'flashcards', strict: true, schema: FLASHCARDS_JSON_SCHEMA },
    },
  });

  return parseFlashcardsResponse(response.choices[0]?.message?.content ?? undefined);
}

function parseFlashcardsResponse(rawText: string | undefined): { flashcards: GeneratedFlashcard[] } {
  if (!rawText) throw new Error('A IA não retornou flashcards no formato esperado.');
  let parsed: { flashcards?: unknown };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('A IA não retornou flashcards no formato esperado.');
  }
  if (!Array.isArray(parsed.flashcards)) throw new Error('A IA não retornou flashcards no formato esperado.');

  const flashcards: GeneratedFlashcard[] = parsed.flashcards
    .filter(
      (card): card is GeneratedFlashcard =>
        !!card &&
        typeof card === 'object' &&
        typeof (card as GeneratedFlashcard).question === 'string' &&
        typeof (card as GeneratedFlashcard).answer === 'string',
    )
    .map((card) => ({
      question: card.question.trim(),
      answer: card.answer.trim(),
      difficulty: (['facil', 'medio', 'dificil'] as const).includes(card.difficulty) ? card.difficulty : 'medio',
    }))
    .filter((card) => card.question.length > 0 && card.answer.length > 0);

  if (flashcards.length === 0) throw new Error('A IA não conseguiu gerar flashcards a partir deste conteúdo.');
  return { flashcards };
}

const MINDMAP_SYSTEM_PROMPT = `Você é especialista em organizar conhecimento em mapas mentais para estudo.
Extraia os conceitos mais importantes do conteúdo fornecido (ou use seu conhecimento, se for um tópico) e
organize em uma estrutura hierárquica clara: um tópico central, ramos principais, sub-ramos e, quando fizer
sentido, um nível de detalhe final.
Use títulos curtos e objetivos em cada nó (poucas palavras, nunca frases longas).
Não repita o mesmo conceito em ramos diferentes. Cubra o conteúdo de forma equilibrada.
Responda apenas com o JSON pedido, sem texto adicional.`;

const MINDMAP_LEAF_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
  additionalProperties: false,
};
const MINDMAP_SUBBRANCH_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, children: { type: 'array', items: MINDMAP_LEAF_SCHEMA } },
  required: ['title', 'children'],
  additionalProperties: false,
};
const MINDMAP_BRANCH_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, children: { type: 'array', items: MINDMAP_SUBBRANCH_SCHEMA } },
  required: ['title', 'children'],
  additionalProperties: false,
};
const MINDMAP_JSON_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, children: { type: 'array', items: MINDMAP_BRANCH_SCHEMA } },
  required: ['title', 'children'],
  additionalProperties: false,
};

export async function generateMindMapOpenAI(source: OpenAISource): Promise<MindMapNode> {
  const client = getClient();
  const instruction =
    source.type === 'topic'
      ? 'O tópico abaixo é o assunto central do mapa mental.'
      : 'O conteúdo abaixo é o material a organizar em mapa mental.';

  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: MINDMAP_SYSTEM_PROMPT },
      { role: 'user', content: userContentFor(source, instruction) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'mind_map', strict: true, schema: MINDMAP_JSON_SCHEMA },
    },
  });

  return parseMindMapResponse(response.choices[0]?.message?.content ?? undefined);
}

const SUMMARY_SYSTEM_PROMPT = `Você é especialista em transformar textos densos em resumos de estudo claros e
bem organizados para concursos públicos brasileiros.
Leia atentamente o texto fornecido e produza um resumo que preserve todas as informações relevantes,
eliminando repetições e trechos irrelevantes.
Organize o conteúdo em parágrafos curtos e bem encadeados, cobrindo os pontos na mesma ordem em que aparecem
no texto original. Não invente informações que não estejam no texto.
Gere também um título curto e descritivo para o resumo, que capture o assunto principal.
Responda apenas com o JSON pedido, sem texto adicional.`;

function summaryModeInstruction(mode: SummaryMode): string {
  if (mode === 'intensivo') {
    return 'Modo intensivo: seja mais completo e detalhado, preservando nuances, exemplos e exceções ' +
      'importantes — o resumo pode ser mais longo, desde que continue condensado em relação ao texto original.';
  }
  return 'Modo padrão: seja direto e objetivo, priorizando só os pontos mais importantes, em um resumo enxuto.';
}

const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['title', 'content'],
  additionalProperties: false,
};

export async function generateSummaryOpenAI(text: string, mode: SummaryMode): Promise<GeneratedSummary> {
  const client = getClient();
  const instruction = ['O texto abaixo deve ser resumido.', summaryModeInstruction(mode)].join('\n');

  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: `${instruction}\n\n--- TEXTO ---\n${text}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'summary', strict: true, schema: SUMMARY_JSON_SCHEMA },
    },
  });

  return parseSummaryResponse(response.choices[0]?.message?.content ?? undefined);
}

function parseSummaryResponse(rawText: string | undefined): GeneratedSummary {
  if (!rawText) throw new Error('A IA não retornou um resumo no formato esperado.');
  let parsed: { title?: unknown; content?: unknown };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('A IA não retornou um resumo no formato esperado.');
  }
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
  if (!title || !content) throw new Error('A IA não conseguiu gerar um resumo a partir deste texto.');
  return { title, content };
}

const BULLETPOINTS_SYSTEM_PROMPT = `Você é especialista em condensar textos densos em bullet points objetivos
para estudo, voltados para concursos públicos brasileiros.
Leia atentamente o texto fornecido e extraia os pontos mais importantes, um por bullet point.
Cada bullet point deve ser uma frase curta, direta e autônoma (faz sentido sozinha, sem depender dos outros).
Não repita a mesma informação em bullet points diferentes. Cubra o conteúdo de forma equilibrada.
Não invente informações que não estejam no texto.
Gere também um título curto e descritivo, que capture o assunto principal.
Responda apenas com o JSON pedido, sem texto adicional.`;

const BULLETPOINTS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'points'],
  additionalProperties: false,
};

export async function generateBulletPointsOpenAI(text: string): Promise<GeneratedBulletPoints> {
  const client = getClient();
  const instruction = 'O texto abaixo deve ser transformado em bullet points.';

  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: BULLETPOINTS_SYSTEM_PROMPT },
      { role: 'user', content: `${instruction}\n\n--- TEXTO ---\n${text}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'bullet_points', strict: true, schema: BULLETPOINTS_JSON_SCHEMA },
    },
  });

  return parseBulletPointsResponse(response.choices[0]?.message?.content ?? undefined);
}

function parseBulletPointsResponse(rawText: string | undefined): GeneratedBulletPoints {
  if (!rawText) throw new Error('A IA não retornou bullet points no formato esperado.');
  let parsed: { title?: unknown; points?: unknown };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('A IA não retornou bullet points no formato esperado.');
  }
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const points = Array.isArray(parsed.points)
    ? parsed.points.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim())
    : [];
  if (!title || points.length === 0) {
    throw new Error('A IA não conseguiu gerar bullet points a partir deste texto.');
  }
  return { title, points };
}

export async function generateChoicesOpenAI(sources: ChoiceSource[]): Promise<GeneratedChoice[]> {
  const client = getClient();
  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: CHOICES_SYSTEM_PROMPT },
      { role: 'user', content: choicesUserPrompt(sources) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'choices', strict: true, schema: CHOICES_JSON_SCHEMA },
    },
  });
  return parseChoicesResponse(response.choices[0]?.message?.content ?? undefined, sources);
}

export async function suggestLeechFixOpenAI(source: LeechFixSource): Promise<LeechFix> {
  const client = getClient();
  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: LEECH_FIX_SYSTEM_PROMPT },
      { role: 'user', content: leechFixUserPrompt(source) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'leech_fix', strict: true, schema: LEECH_FIX_JSON_SCHEMA },
    },
  });
  return parseLeechFixResponse(response.choices[0]?.message?.content ?? undefined);
}

export async function explainCardOpenAI(source: TutorSource): Promise<TutorReply> {
  const client = getClient();
  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: TUTOR_SYSTEM_PROMPT },
      { role: 'user', content: tutorUserPrompt(source) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'tutor', strict: true, schema: TUTOR_JSON_SCHEMA },
    },
  });
  return parseTutorResponse(response.choices[0]?.message?.content ?? undefined);
}

export async function verifyCardsOpenAI(sources: VerifySource[], context: string): Promise<VerifiedCard[]> {
  const client = getClient();
  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: VERIFY_SYSTEM_PROMPT },
      { role: 'user', content: verifyUserPrompt(sources, context) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'verification', strict: true, schema: VERIFY_JSON_SCHEMA },
    },
  });
  return parseVerifyResponse(response.choices[0]?.message?.content ?? undefined, sources);
}

// O modo estrito da OpenAI exige todos os campos como obrigatórios; "não
// informado" vira null (números) ou string vazia (textos).
const SYLLABUS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    position: { type: 'string' },
    board: { type: 'string' },
    examDate: { type: 'string' },
    disciplines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          questionCount: { type: ['integer', 'null'] },
          weight: { type: ['number', 'null'] },
          cutoff: { type: 'string' },
          topics: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'questionCount', 'weight', 'cutoff', 'topics'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'position', 'board', 'examDate', 'disciplines'],
  additionalProperties: false,
};

export async function extractSyllabusOpenAI(text: string, positionHint: string): Promise<GeneratedSyllabus> {
  const client = getClient();
  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SYLLABUS_SYSTEM_PROMPT },
      { role: 'user', content: `${syllabusUserPrompt(positionHint)}\n\n--- DOCUMENTO ---\n${text}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'syllabus', strict: true, schema: SYLLABUS_JSON_SCHEMA },
    },
  });
  return parseSyllabusResponse(response.choices[0]?.message?.content ?? undefined);
}

/** Um trecho de texto de uma prova (a OpenAI não lê PDF escaneado: esse caso é do Gemini e do Claude). */
export async function extractPastExamOpenAI(text: string, hints: PastExamHints, position: ChunkPosition | null): Promise<Chunk> {
  const client = getClient();
  const response = await chatCompletionWithRetry(client, {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: PASTEXAM_SYSTEM_PROMPT },
      { role: 'user', content: `${pastExamUserPrompt(hints, position)}\n\n--- TEXTO DO PDF ---\n${text}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'past_exam', strict: true, schema: PASTEXAM_JSON_SCHEMA },
    },
  });
  if (response.choices[0]?.finish_reason === 'length') {
    throw new Error('A resposta da OpenAI ficou grande demais e foi cortada.');
  }
  return parsePastExamResponse(response.choices[0]?.message?.content ?? undefined);
}

function sanitizeMindMapNode(node: unknown): MindMapNode | null {
  if (!node || typeof node !== 'object') return null;
  const title = (node as { title?: unknown }).title;
  if (typeof title !== 'string' || !title.trim()) return null;
  const rawChildren = (node as { children?: unknown }).children;
  const children = Array.isArray(rawChildren)
    ? (rawChildren.map(sanitizeMindMapNode).filter(Boolean) as MindMapNode[])
    : [];
  return children.length > 0 ? { title: title.trim(), children } : { title: title.trim() };
}

function parseMindMapResponse(rawText: string | undefined): MindMapNode {
  if (!rawText) throw new Error('A IA não retornou um mapa mental no formato esperado.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('A IA não retornou um mapa mental no formato esperado.');
  }
  const root = sanitizeMindMapNode(parsed);
  if (!root) throw new Error('A IA não conseguiu gerar um mapa mental a partir deste conteúdo.');
  return root;
}

// Prompts, esquemas e validadores que o Claude (server/ai/claude.ts) reaproveita
// tal como estão: o resultado de qualquer provedor passa pela mesma validação.
export {
  BULLETPOINTS_JSON_SCHEMA,
  BULLETPOINTS_SYSTEM_PROMPT,
  FLASHCARDS_JSON_SCHEMA,
  FLASHCARDS_SYSTEM_PROMPT,
  MINDMAP_JSON_SCHEMA,
  MINDMAP_SYSTEM_PROMPT,
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM_PROMPT,
  SYLLABUS_JSON_SCHEMA,
  parseBulletPointsResponse,
  parseFlashcardsResponse,
  parseMindMapResponse,
  parseSummaryResponse,
  sharedInstructions,
  summaryModeInstruction,
};
