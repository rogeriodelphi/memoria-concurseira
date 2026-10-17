import Anthropic from '@anthropic-ai/sdk';

import {
  CHOICES_JSON_SCHEMA,
  CHOICES_SYSTEM_PROMPT,
  choicesUserPrompt,
  parseChoicesResponse,
  type ChoiceSource,
  type GeneratedChoice,
} from './choices';
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
} from './openai';
import { recordUsage, reportProviderOutcome, type ProviderStatus } from './usage';

// Sonnet: bom equilíbrio entre qualidade e custo para flashcards, resumos e a
// leitura de editais. Dá pra trocar por um modelo menor (mais barato) ou maior
// definindo ANTHROPIC_MODEL no .env, sem mexer no código.
const DEFAULT_MODEL = 'claude-sonnet-5-5';

export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export function hasClaude(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no servidor (.env).');
  // O SDK já repete sozinho, com espera crescente, em 429, 5xx e "sobrecarregado" (529).
  return new Anthropic({ apiKey, maxRetries: 3 });
}

// ---------- entrada ----------

export const CLAUDE_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type ClaudeImageMime = (typeof CLAUDE_IMAGE_MIMES)[number];

export type ClaudeSource =
  | { type: 'topic'; topic: string }
  | { type: 'text'; text: string }
  | { type: 'pdf_text'; extractedText: string; filename: string }
  | { type: 'image'; base64: string; mimeType: ClaudeImageMime }
  /** PDF sem texto extraível (escaneado): o Claude lê a imagem das páginas. */
  | { type: 'pdf'; base64: string };

export function isClaudeImageMime(mime: string): mime is ClaudeImageMime {
  return (CLAUDE_IMAGE_MIMES as readonly string[]).includes(mime);
}

export function buildUserContent(
  source: ClaudeSource,
  instruction: string,
): string | Anthropic.Messages.ContentBlockParam[] {
  switch (source.type) {
    case 'topic':
      return `${instruction}\n\nTópico: "${source.topic}"`;
    case 'text':
      return `${instruction}\n\n--- TEXTO ---\n${source.text}`;
    case 'pdf_text':
      return `${instruction}\n\n--- CONTEÚDO EXTRAÍDO DO ARQUIVO "${source.filename}" ---\n${source.extractedText}`;
    case 'image':
      return [
        { type: 'image', source: { type: 'base64', media_type: source.mimeType, data: source.base64 } },
        { type: 'text', text: instruction },
      ];
    case 'pdf':
      return [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.base64 } },
        {
          type: 'text',
          text: `${instruction}\nO arquivo em anexo é um PDF, possivelmente escaneado: leia o texto das páginas.`,
        },
      ];
  }
}

// ---------- erros ----------

export interface ClaudeFailure {
  message: string;
  /** O que registrar no status do provedor (o aviso do menu lateral); null = nada a registrar. */
  status: ProviderStatus | null;
}

/**
 * Traduz o erro HTTP da API em algo que o usuário entenda. Saldo esgotado vem
 * como 400 (não 402) com o aviso no texto, então não dá pra confiar só no código.
 */
export function describeClaudeFailure(httpStatus: number | undefined, detail: string): ClaudeFailure {
  if (httpStatus === 400 && /credit balance/i.test(detail)) {
    return {
      status: 'no_credits',
      message:
        'A conta da Anthropic está sem créditos. Adicione créditos em https://console.anthropic.com/settings/billing ' +
        'para usar o Claude (enquanto isso, as gerações continuam pelos outros provedores quando possível).',
    };
  }
  if (httpStatus === 401) {
    return {
      status: 'invalid_key',
      message: 'Chave da Anthropic inválida ou ausente (confira ANTHROPIC_API_KEY no .env do servidor).',
    };
  }
  if (httpStatus === 403) {
    return { status: 'invalid_key', message: 'A chave da Anthropic não tem permissão para usar o Claude nesta operação.' };
  }
  if (httpStatus === 404) {
    return {
      status: null,
      message: 'O modelo do Claude não foi encontrado. Confira ANTHROPIC_MODEL no .env do servidor.',
    };
  }
  if (httpStatus === 429) {
    return {
      status: 'rate_limited',
      message: 'Limite de uso do Claude atingido no momento. Tente de novo em alguns instantes.',
    };
  }
  if (httpStatus === 529 || (typeof httpStatus === 'number' && httpStatus >= 500)) {
    return {
      status: 'unavailable',
      message: 'O Claude está com alta demanda ou instabilidade no momento. Tente novamente em alguns instantes.',
    };
  }
  return { status: null, message: 'Falha ao se comunicar com o Claude. Tente novamente.' };
}

// ---------- chamada ----------

const TOOL_NAME = 'entregar_resultado';

interface StructuredCall {
  system: string;
  content: string | Anthropic.Messages.ContentBlockParam[];
  schema: object;
  maxTokens: number;
}

/**
 * Pede o resultado como argumento de uma "ferramenta" obrigatória: a API
 * devolve o JSON já como objeto, no formato do esquema — o jeito estável de ter
 * saída estruturada. É o mesmo esquema que a OpenAI usa.
 */
async function callStructured(call: StructuredCall): Promise<unknown> {
  const client = getClient();
  try {
    const response = await client.messages.create({
      model: claudeModel(),
      max_tokens: call.maxTokens,
      system: call.system,
      messages: [{ role: 'user', content: call.content }],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Entrega o resultado final exatamente no formato pedido.',
          input_schema: call.schema as Anthropic.Messages.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    });

    const input = response.usage.input_tokens;
    const output = response.usage.output_tokens;
    recordUsage('claude', { input, output, total: input + output });
    reportProviderOutcome('claude', 'ok');

    if (response.stop_reason === 'max_tokens') {
      throw new Error('A resposta do Claude ficou grande demais e foi cortada. Tente pedir menos itens ou um trecho menor.');
    }
    const block = response.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
    if (!block) throw new Error('A IA não retornou o resultado no formato esperado.');
    return block.input;
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const failure = describeClaudeFailure(err.status, err.message);
      if (failure.status) reportProviderOutcome('claude', failure.status);
      throw new Error(failure.message);
    }
    // Erros do SDK que não vêm da API (sem rede, tempo esgotado). Os nossos, de
    // resposta fora do formato, são `Error` comuns e seguem como estão.
    if (err instanceof Anthropic.AnthropicError) {
      throw new Error('Não foi possível conectar ao Claude. Verifique a conexão e tente novamente.');
    }
    throw err;
  }
}

// ---------- operações ----------

export async function generateFlashcardsClaude(
  source: ClaudeSource,
  options: GenerationOptions,
): Promise<{ flashcards: GeneratedFlashcard[] }> {
  const instruction = [
    source.type === 'topic'
      ? 'O tópico abaixo é o assunto a ser transformado em flashcards.'
      : 'O conteúdo abaixo é o material a ser transformado em flashcards.',
    sharedInstructions(options),
  ].join('\n');
  const result = await callStructured({
    system: FLASHCARDS_SYSTEM_PROMPT,
    content: buildUserContent(source, instruction),
    schema: FLASHCARDS_JSON_SCHEMA,
    maxTokens: 16_000,
  });
  return parseFlashcardsResponse(JSON.stringify(result));
}

export async function generateMindMapClaude(source: ClaudeSource): Promise<MindMapNode> {
  const instruction =
    source.type === 'topic'
      ? 'O tópico abaixo é o assunto central do mapa mental.'
      : 'O conteúdo abaixo é o material a organizar em mapa mental.';
  const result = await callStructured({
    system: MINDMAP_SYSTEM_PROMPT,
    content: buildUserContent(source, instruction),
    schema: MINDMAP_JSON_SCHEMA,
    maxTokens: 8_000,
  });
  return parseMindMapResponse(JSON.stringify(result));
}

export async function generateSummaryClaude(text: string, mode: SummaryMode): Promise<GeneratedSummary> {
  const instruction = ['O texto abaixo deve ser resumido.', summaryModeInstruction(mode)].join('\n');
  const result = await callStructured({
    system: SUMMARY_SYSTEM_PROMPT,
    content: `${instruction}\n\n--- TEXTO ---\n${text}`,
    schema: SUMMARY_JSON_SCHEMA,
    maxTokens: 8_000,
  });
  return parseSummaryResponse(JSON.stringify(result));
}

export async function generateBulletPointsClaude(text: string): Promise<GeneratedBulletPoints> {
  const result = await callStructured({
    system: BULLETPOINTS_SYSTEM_PROMPT,
    content: `O texto abaixo deve ser transformado em bullet points.\n\n--- TEXTO ---\n${text}`,
    schema: BULLETPOINTS_JSON_SCHEMA,
    maxTokens: 4_000,
  });
  return parseBulletPointsResponse(JSON.stringify(result));
}

export async function generateChoicesClaude(sources: ChoiceSource[]): Promise<GeneratedChoice[]> {
  const result = await callStructured({
    system: CHOICES_SYSTEM_PROMPT,
    content: choicesUserPrompt(sources),
    schema: CHOICES_JSON_SCHEMA,
    maxTokens: 6_000,
  });
  return parseChoicesResponse(JSON.stringify(result), sources);
}

export type ClaudeSyllabusSource = { type: 'text'; text: string } | { type: 'pdf'; base64: string };

export async function extractSyllabusClaude(
  source: ClaudeSyllabusSource,
  positionHint: string,
): Promise<GeneratedSyllabus> {
  const instruction = syllabusUserPrompt(positionHint);
  const content =
    source.type === 'text'
      ? `${instruction}\n\n--- DOCUMENTO ---\n${source.text}`
      : buildUserContent({ type: 'pdf', base64: source.base64 }, instruction);
  const result = await callStructured({
    system: SYLLABUS_SYSTEM_PROMPT,
    content,
    schema: SYLLABUS_JSON_SCHEMA,
    maxTokens: 16_000,
  });
  return parseSyllabusResponse(JSON.stringify(result));
}
