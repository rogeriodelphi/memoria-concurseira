import { GoogleGenAI, Type, FileState, ApiError, createPartFromUri, createUserContent } from '@google/genai';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';

import { decodeGeminiAudio, type DecodedAudio } from '../tts/audio';
import {
  CHOICES_SYSTEM_PROMPT,
  choicesUserPrompt,
  parseChoicesResponse,
  type ChoiceSource,
  type GeneratedChoice,
} from './choices';
import { LEECH_FIX_SYSTEM_PROMPT, leechFixUserPrompt, parseLeechFixResponse, type LeechFix, type LeechFixSource } from './leechfix';
import { recordUsage, reportProviderOutcome, type ProviderStatus } from './usage';
import { parseVerifyResponse, VERIFY_SYSTEM_PROMPT, verifyUserPrompt, type VerifiedCard, type VerifySource } from './verify';
import {
  parsePastExamResponse,
  pastExamUserPrompt,
  PASTEXAM_SYSTEM_PROMPT,
  type Chunk,
  type ChunkPosition,
  type PastExamHints,
} from './pastexam';

export interface GenerationOptions {
  quantity: 'auto' | number;
  difficulty: 'facil' | 'medio' | 'dificil' | 'misto';
  cardType: 'pergunta_resposta' | 'verdadeiro_falso' | 'multipla_escolha' | 'conceito_definicao' | 'misto';
  depth: 'essencial' | 'normal' | 'avancado';
  focus?: string;
}

export interface GeneratedFlashcard {
  question: string;
  answer: string;
  difficulty: 'facil' | 'medio' | 'dificil';
  sourcePage?: number;
}

export type GenerationSource =
  | { type: 'file'; buffer: Buffer; mimeType: string }
  | { type: 'topic'; topic: string }
  | { type: 'text'; text: string }
  | { type: 'youtube'; url: string };

// gemini-3.6-flash: bom equilíbrio custo/qualidade para extrair flashcards de
// um PDF (gemini-2.5-flash foi descontinuado pela Google). Troque para um
// modelo "pro" se existir um disponível e você quiser mais qualidade em troca
// de custo/latência maiores.
const MODEL = 'gemini-3.6-flash';

const SYSTEM_PROMPT = `Você é especialista em educação, aprendizagem ativa e criação de flashcards.
Analise cuidadosamente o conteúdo fornecido.
Transforme os conhecimentos mais relevantes em flashcards objetivos, claros e úteis.
As perguntas devem testar efetivamente o conhecimento do estudante.
As respostas devem ser baseadas exclusivamente no conteúdo fornecido. Não invente informações.
Evite perguntas redundantes.
Priorize conceitos, definições, classificações, características, regras, exceções, comparações e
informações relevantes para provas.
Sempre que possível, associe o flashcard à página de origem (sourcePage).
Gere conteúdo adequado para revisão espaçada e memorização.
Responda apenas com o JSON pedido, sem texto adicional.`;

// Para tópico, não há "conteúdo fornecido" — a IA usa o próprio conhecimento.
const SYSTEM_PROMPT_TOPIC = `Você é especialista em educação, aprendizagem ativa e criação de flashcards, com
domínio profundo de conteúdo cobrado em concursos públicos brasileiros.
Use seu conhecimento para cobrir o tópico pedido com precisão.
Transforme os conhecimentos mais relevantes em flashcards objetivos, claros e úteis.
As perguntas devem testar efetivamente o conhecimento do estudante.
Evite perguntas redundantes.
Priorize conceitos, definições, classificações, características, regras, exceções, comparações e
informações relevantes para provas.
Gere conteúdo adequado para revisão espaçada e memorização.
Responda apenas com o JSON pedido, sem texto adicional.`;

const FLASHCARDS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    flashcards: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING, description: 'Pergunta objetiva e clara.' },
          answer: { type: Type.STRING, description: 'Resposta baseada exclusivamente no conteúdo.' },
          difficulty: { type: Type.STRING, enum: ['facil', 'medio', 'dificil'] },
          sourcePage: { type: Type.INTEGER, description: 'Página de origem no PDF, se identificável.' },
        },
        required: ['question', 'answer', 'difficulty'],
      },
    },
  },
  required: ['flashcards'],
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

export function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

function trackGeminiSuccess(response: GenerateContentResponse, reportStatus: boolean): void {
  const usage = response.usageMetadata;
  const input = usage?.promptTokenCount ?? 0;
  // totalTokenCount já inclui tokens de "raciocínio" do modelo, que
  // candidatesTokenCount sozinho não conta — por isso a saída é derivada do total.
  const total = usage?.totalTokenCount ?? input + (usage?.candidatesTokenCount ?? 0);
  recordUsage('gemini', { input, output: Math.max(total - input, 0), total });
  if (reportStatus) reportProviderOutcome('gemini', 'ok');
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada no servidor (.env).');
  }
  return new GoogleGenAI({ apiKey });
}

const MAX_OVERLOAD_ATTEMPTS = 4;
const OVERLOAD_RETRY_BASE_DELAY_MS = 3000;
const MAX_QUOTA_RETRY_DELAY_MS = 60000;

interface ParsedGeminiError {
  status?: string;
  retryDelaySeconds?: number;
}

// A SDK só expõe `.message` (string) e `.status` (número) em ApiError — o
// `.message` é o corpo cru da resposta de erro do Gemini em JSON, então pra
// pegar o `status` textual ("RESOURCE_EXHAUSTED", "UNAVAILABLE") e o
// `retryDelay` que o próprio Google sugere, precisa reinterpretar esse JSON
// manualmente (best-effort — se o formato mudar, cai no fallback genérico).
function parseGeminiError(err: ApiError): ParsedGeminiError {
  try {
    const parsed = JSON.parse(err.message) as {
      error?: { status?: string; details?: { '@type'?: string; retryDelay?: string }[] };
    };
    const retryInfo = parsed.error?.details?.find((d) => d['@type']?.includes('RetryInfo'));
    const retryDelaySeconds = retryInfo?.retryDelay ? parseFloat(retryInfo.retryDelay) : undefined;
    return { status: parsed.error?.status, retryDelaySeconds };
  } catch {
    return {};
  }
}

export type GeminiFailureKind = 'quota' | 'overloaded' | 'other';

/** Erro do Gemini já em linguagem de usuário, com o tipo da falha para quem precisa decidir o que fazer. */
export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiFailureKind,
    /** Quando o Google diz em quanto tempo a cota volta. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

function friendlyGeminiError(err: ApiError, parsed: ParsedGeminiError): GeminiError {
  if (err.status === 429 || parsed.status === 'RESOURCE_EXHAUSTED') {
    return new GeminiError(
      'Limite de uso gratuito do Gemini atingido no momento (a chave de API está no plano gratuito, com cota ' +
        'bem baixa). Tente de novo em alguns instantes — se persistir, pode ser um limite diário; verifique em ' +
        'https://ai.dev/rate-limit ou considere um plano pago.',
      'quota',
      parsed.retryDelaySeconds,
    );
  }
  if (err.status === 503 || parsed.status === 'UNAVAILABLE') {
    return new GeminiError('O Gemini está com alta demanda no momento. Tente novamente em alguns instantes.', 'overloaded');
  }
  return new GeminiError('Falha ao se comunicar com a IA. Tente novamente.', 'other');
}

/**
 * Conteúdo multimodal (arquivo/YouTube) esbarra bem mais em erro do Gemini
 * do que texto puro — texto sempre passa de primeira. Dois casos distintos:
 *
 * - 503 UNAVAILABLE ("modelo sobrecarregado"): transitório, vale insistir
 *   algumas vezes com backoff crescente.
 * - 429 RESOURCE_EXHAUSTED (cota excedida): é um limite duro — insistir às
 *   cegas não ajuda (pode ser cota diária) e só desperdiça tempo. Só vale a
 *   pena tentar de novo UMA vez, respeitando o `retryDelay` que o próprio
 *   Google devolve no erro; se persistir, desiste e explica o motivo real
 *   em vez de devolver o JSON cru.
 *
 * Os padrões são os de sempre. A leitura em voz alta muda os três: quem espera
 * a voz não pode ficar minutos num retry, e ela não deve mexer no indicador de
 * saúde do Gemini (que reflete os modelos de texto).
 */
interface RetryOptions {
  maxAttempts?: number;
  /** Esperar o tempo que o Google sugere e tentar mais uma vez depois de um 429. */
  waitForQuota?: boolean;
  /** Registrar o resultado no status do provedor (o aviso do menu lateral). */
  reportStatus?: boolean;
}

async function generateContentWithRetry(
  client: GoogleGenAI,
  params: GenerateContentParameters,
  options: RetryOptions = {},
): Promise<GenerateContentResponse> {
  const maxAttempts = options.maxAttempts ?? MAX_OVERLOAD_ATTEMPTS;
  const waitForQuota = options.waitForQuota ?? true;
  const reportStatus = options.reportStatus ?? true;
  const report = (status: ProviderStatus) => {
    if (reportStatus) reportProviderOutcome('gemini', status);
  };

  let quotaRetryUsed = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await client.models.generateContent(params);
      trackGeminiSuccess(response, reportStatus);
      return response;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const parsed = parseGeminiError(err);

      if (err.status === 429) {
        if (waitForQuota && !quotaRetryUsed && parsed.retryDelaySeconds) {
          quotaRetryUsed = true;
          const delay = Math.min(parsed.retryDelaySeconds * 1000, MAX_QUOTA_RETRY_DELAY_MS);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        report('quota_exhausted');
        throw friendlyGeminiError(err, parsed);
      }

      const overloaded = err.status === 503;
      if (!overloaded || attempt === maxAttempts) {
        if (overloaded) {
          report('unavailable');
        } else if (err.status === 401 || err.status === 403 || err.message.includes('API_KEY_INVALID')) {
          report('invalid_key');
        }
        throw friendlyGeminiError(err, parsed);
      }
      await new Promise((resolve) => setTimeout(resolve, OVERLOAD_RETRY_BASE_DELAY_MS * attempt));
    }
  }
  // Inalcançável (o loop sempre retorna ou lança), só pra satisfazer o TS.
  throw new Error('Falha ao chamar a IA.');
}

// PDFs, imagens, áudio e vídeo enviados pelo usuário não cabem inline em
// base64 na requisição pra arquivos maiores (a própria API recusa acima de
// ~20MB). A Files API não tem esse teto: o arquivo sobe primeiro, e a
// geração só referencia ele por URI. O arquivo é apagado do lado do Gemini
// ao final, sucesso ou erro — reaproveitado tanto pra gerar flashcards
// quanto pra transcrever, únicos dois consumidores de arquivo bruto.
async function withUploadedFile<T>(
  client: GoogleGenAI,
  buffer: Buffer,
  mimeType: string,
  run: (uri: string, resolvedMimeType: string) => Promise<T>,
): Promise<T> {
  const uploaded = await client.files.upload({
    file: new Blob([Uint8Array.from(buffer)], { type: mimeType }),
    config: { mimeType },
  });

  try {
    let file = uploaded;
    while (file.state === FileState.PROCESSING) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      file = await client.files.get({ name: file.name! });
    }
    if (file.state === FileState.FAILED) {
      throw new Error('O Gemini não conseguiu processar o arquivo enviado.');
    }
    if (!file.uri || !file.mimeType) {
      throw new Error('Falha ao enviar o arquivo para o Gemini.');
    }
    return await run(file.uri, file.mimeType);
  } finally {
    if (uploaded.name) {
      await client.files.delete({ name: uploaded.name }).catch(() => {});
    }
  }
}

export async function generateFlashcardsGemini(
  source: GenerationSource,
  options: GenerationOptions,
): Promise<{ flashcards: GeneratedFlashcard[] }> {
  const client = getClient();

  if (source.type === 'topic') {
    const prompt = [
      `O tópico a ser transformado em flashcards é: "${source.topic}".`,
      sharedInstructions(options),
    ].join('\n');
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT_TOPIC,
        responseMimeType: 'application/json',
        responseSchema: FLASHCARDS_SCHEMA,
      },
    });
    return parseFlashcardsResponse(response.text);
  }

  if (source.type === 'text') {
    const prompt = [
      'O texto abaixo é o conteúdo a ser transformado em flashcards.',
      sharedInstructions(options),
      '',
      '--- TEXTO ---',
      source.text,
    ].join('\n');
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: FLASHCARDS_SCHEMA,
      },
    });
    return parseFlashcardsResponse(response.text);
  }

  if (source.type === 'youtube') {
    const prompt = [
      'O vídeo em anexo é o conteúdo a ser transformado em flashcards. Assista/ouça com atenção antes de gerar.',
      sharedInstructions(options),
    ].join('\n');
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      // Vídeos do YouTube são referenciados direto pela URL — o Gemini busca
      // o conteúdo publicamente, sem precisar passar pela Files API.
      contents: createUserContent([createPartFromUri(source.url, 'video/mp4'), prompt]),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: FLASHCARDS_SCHEMA,
      },
    });
    return parseFlashcardsResponse(response.text);
  }

  // source.type === 'file' — PDFs, imagens, áudio e vídeo enviados pelo usuário.
  const userPrompt = [
    'O arquivo em anexo é o conteúdo a ser transformado em flashcards. Se for um PDF escaneado ou uma imagem,',
    'leia o texto da imagem antes de gerar os flashcards. Se for áudio ou vídeo, ouça/assista com atenção.',
    sharedInstructions(options),
  ].join('\n');

  return withUploadedFile(client, source.buffer, source.mimeType, async (uri, mimeType) => {
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: createUserContent([createPartFromUri(uri, mimeType), userPrompt]),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: FLASHCARDS_SCHEMA,
      },
    });
    return parseFlashcardsResponse(response.text);
  });
}

const TRANSCRIBE_SYSTEM_PROMPT = `Você transcreve o conteúdo falado de áudio e vídeo para texto.
Transcreva de forma literal, no mesmo idioma em que a pessoa fala no áudio/vídeo — nunca traduza para outro
idioma, mesmo que o áudio original não esteja em português.
Transcreva tudo o que for dito, sem resumir, sem cortar trechos e sem inventar conteúdo.
Pode remover hesitações, vícios de fala ("é", "né", repetições involuntárias) para melhorar a legibilidade, mas
nunca remova conteúdo com informação real.
Não descreva sons, imagens ou cenas — apenas o texto falado.
Não adicione títulos, comentários ou observações suas.
Se houver múltiplos falantes e isso for relevante para o entendimento, indique a troca de falante de forma simples
(ex.: "Falante 1:", "Falante 2:").
Responda apenas com a transcrição, sem texto adicional.`;

export type TranscriptionSource = { type: 'file'; buffer: Buffer; mimeType: string } | { type: 'youtube'; url: string };

export async function transcribeMedia(source: TranscriptionSource): Promise<string> {
  const client = getClient();

  if (source.type === 'youtube') {
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: createUserContent([createPartFromUri(source.url, 'video/mp4'), 'Transcreva este vídeo.']),
      config: { systemInstruction: TRANSCRIBE_SYSTEM_PROMPT },
    });
    const text = (response.text ?? '').trim();
    if (!text) throw new Error('A IA não retornou nenhum texto transcrito.');
    return text;
  }

  return withUploadedFile(client, source.buffer, source.mimeType, async (uri, mimeType) => {
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: createUserContent([createPartFromUri(uri, mimeType), 'Transcreva este arquivo.']),
      config: { systemInstruction: TRANSCRIBE_SYSTEM_PROMPT },
    });
    const text = (response.text ?? '').trim();
    if (!text) throw new Error('A IA não retornou nenhum texto transcrito.');
    return text;
  });
}

export interface MindMapNode {
  title: string;
  children?: MindMapNode[];
}

const MINDMAP_SYSTEM_PROMPT = `Você é especialista em organizar conhecimento em mapas mentais para estudo.
Extraia os conceitos mais importantes do conteúdo fornecido e organize em uma estrutura hierárquica clara:
um tópico central, ramos principais, sub-ramos e, quando fizer sentido, um nível de detalhe final.
Use títulos curtos e objetivos em cada nó (poucas palavras, nunca frases longas).
Não repita o mesmo conceito em ramos diferentes.
Cubra o conteúdo de forma equilibrada — não concentre tudo em um único ramo.
Responda apenas com o JSON pedido, sem texto adicional.`;

const MINDMAP_SYSTEM_PROMPT_TOPIC = `Você é especialista em organizar conhecimento em mapas mentais para estudo,
com domínio profundo de conteúdo cobrado em concursos públicos brasileiros.
Use seu conhecimento para estruturar o tópico pedido em um mapa mental: um tópico central, ramos principais,
sub-ramos e, quando fizer sentido, um nível de detalhe final.
Use títulos curtos e objetivos em cada nó (poucas palavras, nunca frases longas).
Não repita o mesmo conceito em ramos diferentes.
Responda apenas com o JSON pedido, sem texto adicional.`;

const MINDMAP_LEAF_SCHEMA = {
  type: Type.OBJECT,
  properties: { title: { type: Type.STRING, description: 'Título curto do detalhe.' } },
  required: ['title'],
};

const MINDMAP_SUBBRANCH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Título curto do sub-ramo.' },
    children: { type: Type.ARRAY, items: MINDMAP_LEAF_SCHEMA },
  },
  required: ['title'],
};

const MINDMAP_BRANCH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Título curto do ramo principal.' },
    children: { type: Type.ARRAY, items: MINDMAP_SUBBRANCH_SCHEMA },
  },
  required: ['title'],
};

const MINDMAP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Tópico central do mapa mental.' },
    children: { type: Type.ARRAY, items: MINDMAP_BRANCH_SCHEMA, description: 'Ramos principais.' },
  },
  required: ['title', 'children'],
};

export async function generateMindMapGemini(source: GenerationSource): Promise<MindMapNode> {
  const client = getClient();

  if (source.type === 'topic') {
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: `O tópico central do mapa mental é: "${source.topic}".`,
      config: {
        systemInstruction: MINDMAP_SYSTEM_PROMPT_TOPIC,
        responseMimeType: 'application/json',
        responseSchema: MINDMAP_SCHEMA,
      },
    });
    return parseMindMapResponse(response.text);
  }

  if (source.type === 'text') {
    const prompt = ['O texto abaixo é o conteúdo a organizar em mapa mental.', '', '--- TEXTO ---', source.text].join(
      '\n',
    );
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: MINDMAP_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: MINDMAP_SCHEMA,
      },
    });
    return parseMindMapResponse(response.text);
  }

  if (source.type === 'youtube') {
    const prompt = 'O vídeo em anexo é o conteúdo a organizar em mapa mental. Assista/ouça com atenção antes de gerar.';
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: createUserContent([createPartFromUri(source.url, 'video/mp4'), prompt]),
      config: {
        systemInstruction: MINDMAP_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: MINDMAP_SCHEMA,
      },
    });
    return parseMindMapResponse(response.text);
  }

  const userPrompt =
    'O arquivo em anexo é o conteúdo a organizar em mapa mental. Se for um PDF escaneado ou uma imagem, leia o ' +
    'texto da imagem antes de gerar. Se for áudio ou vídeo, ouça/assista com atenção.';

  return withUploadedFile(client, source.buffer, source.mimeType, async (uri, mimeType) => {
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: createUserContent([createPartFromUri(uri, mimeType), userPrompt]),
      config: {
        systemInstruction: MINDMAP_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: MINDMAP_SCHEMA,
      },
    });
    return parseMindMapResponse(response.text);
  });
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
  if (!rawText) {
    throw new Error('A IA não retornou um mapa mental no formato esperado.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('A IA não retornou um mapa mental no formato esperado.');
  }
  const root = sanitizeMindMapNode(parsed);
  if (!root) {
    throw new Error('A IA não conseguiu gerar um mapa mental a partir deste conteúdo.');
  }
  return root;
}

export type SummaryMode = 'padrao' | 'intensivo';

export interface GeneratedSummary {
  title: string;
  content: string;
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

const SUMMARY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Título curto e descritivo do resumo.' },
    content: { type: Type.STRING, description: 'Texto do resumo, em parágrafos.' },
  },
  required: ['title', 'content'],
};

export async function generateSummaryGemini(text: string, mode: SummaryMode): Promise<GeneratedSummary> {
  const client = getClient();
  const prompt = ['O texto abaixo deve ser resumido.', summaryModeInstruction(mode), '', '--- TEXTO ---', text].join(
    '\n',
  );
  const response = await generateContentWithRetry(client, {
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: SUMMARY_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: SUMMARY_SCHEMA,
    },
  });
  return parseSummaryResponse(response.text);
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

export interface GeneratedBulletPoints {
  title: string;
  points: string[];
}

const BULLETPOINTS_SYSTEM_PROMPT = `Você é especialista em condensar textos densos em bullet points objetivos
para estudo, voltados para concursos públicos brasileiros.
Leia atentamente o texto fornecido e extraia os pontos mais importantes, um por bullet point.
Cada bullet point deve ser uma frase curta, direta e autônoma (faz sentido sozinha, sem depender dos outros).
Não repita a mesma informação em bullet points diferentes. Cubra o conteúdo de forma equilibrada.
Não invente informações que não estejam no texto.
Gere também um título curto e descritivo, que capture o assunto principal.
Responda apenas com o JSON pedido, sem texto adicional.`;

const BULLETPOINTS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Título curto e descritivo dos bullet points.' },
    points: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Lista de bullet points.' },
  },
  required: ['title', 'points'],
};

export async function generateBulletPointsGemini(text: string): Promise<GeneratedBulletPoints> {
  const client = getClient();
  const prompt = ['O texto abaixo deve ser transformado em bullet points.', '', '--- TEXTO ---', text].join('\n');
  const response = await generateContentWithRetry(client, {
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: BULLETPOINTS_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: BULLETPOINTS_SCHEMA,
    },
  });
  return parseBulletPointsResponse(response.text);
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

const CHOICES_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      description: 'Uma questão por cartão.',
      items: {
        type: Type.OBJECT,
        properties: {
          n: { type: Type.INTEGER, description: 'O número do cartão, como no pedido.' },
          correct: { type: Type.STRING, description: 'A alternativa correta.' },
          wrong: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'As alternativas incorretas.' },
        },
        required: ['n', 'correct', 'wrong'],
      },
    },
  },
  required: ['questions'],
};

export async function generateChoicesGemini(sources: ChoiceSource[]): Promise<GeneratedChoice[]> {
  const client = getClient();
  const response = await generateContentWithRetry(client, {
    model: MODEL,
    contents: choicesUserPrompt(sources),
    config: {
      systemInstruction: CHOICES_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: CHOICES_SCHEMA,
    },
  });
  return parseChoicesResponse(response.text, sources);
}

const LEECH_FIX_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    diagnosis: { type: Type.STRING, description: 'Uma frase sobre por que o cartão é difícil.' },
    macete: { type: Type.STRING, description: 'Um jeito curto de lembrar a resposta; vazio se não houver um honesto.' },
    split: {
      type: Type.ARRAY,
      description: 'Cartões menores de uma ideia só; vazio se o cartão já é uma ideia só.',
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING, description: 'A pergunta, que faz sentido sozinha.' },
          answer: { type: Type.STRING, description: 'A resposta, só com o que o cartão original diz.' },
        },
        required: ['question', 'answer'],
      },
    },
  },
  required: ['diagnosis', 'macete', 'split'],
};

export async function suggestLeechFixGemini(source: LeechFixSource): Promise<LeechFix> {
  const client = getClient();
  const response = await generateContentWithRetry(client, {
    model: MODEL,
    contents: leechFixUserPrompt(source),
    config: {
      systemInstruction: LEECH_FIX_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: LEECH_FIX_SCHEMA,
    },
  });
  return parseLeechFixResponse(response.text);
}

const VERIFY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    checks: {
      type: Type.ARRAY,
      description: 'Uma conferência por cartão.',
      items: {
        type: Type.OBJECT,
        properties: {
          n: { type: Type.INTEGER, description: 'O número do cartão, como no pedido.' },
          verdict: { type: Type.STRING, enum: ['ok', 'duvida', 'erro'], description: 'A resposta está correta, duvidosa ou errada.' },
          note: { type: Type.STRING, description: 'O motivo, em uma frase (vazio quando está certo).' },
        },
        required: ['n', 'verdict', 'note'],
      },
    },
  },
  required: ['checks'],
};

export async function verifyCardsGemini(sources: VerifySource[], context: string): Promise<VerifiedCard[]> {
  const client = getClient();
  const response = await generateContentWithRetry(client, {
    model: MODEL,
    contents: verifyUserPrompt(sources, context),
    config: {
      systemInstruction: VERIFY_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: VERIFY_SCHEMA,
    },
  });
  return parseVerifyResponse(response.text, sources);
}

// Modelo de voz do Gemini. Existe uma versão "lite" (gemini-3.8-flash-lite-tts), mais
// barata, que dá pra usar definindo GEMINI_TTS_MODEL no .env.
export function ttsModel(): string {
  return process.env.GEMINI_TTS_MODEL?.trim() || 'gemini-3.8-flash-tts';
}

/**
 * Lê um texto em voz alta. Só o texto vai na requisição, sem instrução de estilo:
 * o modelo lê em voz alta tudo o que recebe, inclusive um "leia em tom natural".
 * O idioma ele reconhece pelo próprio texto.
 */
export async function synthesizeSpeechGemini(text: string, voice: string): Promise<DecodedAudio> {
  const client = getClient();
  const response = await generateContentWithRetry(
    client,
    {
      model: ttsModel(),
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    },
    // Quem ouve está esperando: uma repetição só, sem aguardar cota, e a falha
    // vira rápido a voz do navegador em vez de um silêncio de minutos.
    { maxAttempts: 2, waitForQuota: false, reportStatus: false },
  );
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error('A IA não retornou áudio para este texto.');
  return decodeGeminiAudio(Buffer.from(part.inlineData.data, 'base64'), part.inlineData.mimeType);
}

/** O que a IA devolve do edital, ainda sem validar — quem usa passa por `normalizeDraft`. */
export type GeneratedSyllabus = Record<string, unknown>;

export type SyllabusSource = { type: 'text'; text: string } | { type: 'file'; buffer: Buffer; mimeType: string };

export const SYLLABUS_SYSTEM_PROMPT = `Você é especialista em editais de concursos públicos brasileiros.
Você receberá o texto (ou o arquivo) de um edital, ou só do seu conteúdo programático. Extraia a estrutura de
disciplinas e tópicos exatamente como consta no documento.

Regras:
- Use apenas o que está no documento. Não invente, não complete e não "melhore" disciplinas ou tópicos com o seu
  conhecimento, mesmo que pareçam incompletos.
- Liste as disciplinas e os tópicos na mesma ordem do edital.
- Um tópico é um assunto que dá para estudar sozinho. Quando um item lista vários assuntos distintos (separados
  por vírgula, ponto e vírgula ou "e"), crie um tópico para cada um e, se for preciso, comece pelo assunto maior
  para o tópico fazer sentido isolado (por exemplo, "Redes de computadores: DNS"). Mantenha dentro do mesmo tópico
  apenas o que for detalhe ou exemplo dele: texto entre parênteses, "como", "por exemplo" e listas de artigos de uma lei.
- Preserve os nomes como estão no edital. Corrija apenas quebras de linha e hifenização que vieram do PDF.
- Ignore o que não é conteúdo programático (regras de inscrição, datas de recurso, cláusulas gerais).
- Se o documento trouxer conteúdos de vários cargos e nenhum cargo foi pedido, extraia somente o primeiro cargo
  listado e informe o nome dele em "position".
- "questionCount" e "weight": preencha só se o edital informar explicitamente (por exemplo, no quadro de provas);
  caso contrário, use null.
- "cutoff": o desempenho mínimo exigido na disciplina para o candidato não ser eliminado, escrito como mínimo (por
  exemplo, "mínimo de 50% dos pontos"). Se o edital disser que será eliminado quem obtiver menos de 50%, escreva
  "mínimo de 50% dos pontos". Se não houver, uma string vazia.
- "examDate": a data da prova objetiva no formato AAAA-MM-DD, só se estiver explícita; caso contrário, string vazia.
- "name": o nome do concurso (órgão e, se houver, cargo); "board": a banca organizadora. Vazio se não constar.
Responda apenas com o JSON pedido, sem texto adicional.`;

export function syllabusUserPrompt(positionHint: string): string {
  const hint = positionHint.trim();
  return hint
    ? `Extraia as disciplinas e os tópicos do cargo "${hint}". Se o documento tiver vários cargos, ignore os demais.`
    : 'Extraia as disciplinas e os tópicos do documento.';
}

const SYLLABUS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    position: { type: Type.STRING },
    board: { type: Type.STRING },
    examDate: { type: Type.STRING, description: 'AAAA-MM-DD, ou vazio.' },
    disciplines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          questionCount: { type: Type.INTEGER, nullable: true },
          weight: { type: Type.NUMBER, nullable: true },
          cutoff: { type: Type.STRING },
          topics: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['name', 'topics'],
      },
    },
  },
  required: ['disciplines'],
};

export function parseSyllabusResponse(rawText: string | undefined): GeneratedSyllabus {
  const failure = 'A IA não retornou o conteúdo programático no formato esperado.';
  if (!rawText) throw new Error(failure);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(failure);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as GeneratedSyllabus).disciplines)) {
    throw new Error(failure);
  }
  return parsed as GeneratedSyllabus;
}

export async function extractSyllabusGemini(source: SyllabusSource, positionHint: string): Promise<GeneratedSyllabus> {
  const client = getClient();
  const config = {
    systemInstruction: SYLLABUS_SYSTEM_PROMPT,
    responseMimeType: 'application/json',
    responseSchema: SYLLABUS_SCHEMA,
  };

  if (source.type === 'text') {
    const prompt = [syllabusUserPrompt(positionHint), '', '--- DOCUMENTO ---', source.text].join('\n');
    const response = await generateContentWithRetry(client, { model: MODEL, contents: prompt, config });
    return parseSyllabusResponse(response.text);
  }

  // PDF sem texto extraível (escaneado): o Gemini lê a imagem das páginas.
  const prompt = [
    'O arquivo em anexo é um edital (ou o seu conteúdo programático). Se for um PDF escaneado, leia o texto das',
    'páginas antes de extrair.',
    syllabusUserPrompt(positionHint),
  ].join('\n');
  return withUploadedFile(client, source.buffer, source.mimeType, async (uri, mimeType) => {
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: createUserContent([createPartFromUri(uri, mimeType), prompt]),
      config,
    });
    return parseSyllabusResponse(response.text);
  });
}

// Provas anteriores: o trecho do PDF (ou o PDF escaneado inteiro) vira questões e gabarito. Mesmo conteúdo do
// PASTEXAM_JSON_SCHEMA, no formato do Gemini (o nível fica como texto livre; a validação normaliza).
const PASTEXAM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    exam: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        board: { type: Type.STRING },
        organ: { type: Type.STRING },
        year: { type: Type.INTEGER },
        position: { type: Type.STRING },
        level: { type: Type.STRING, description: 'Fundamental, Médio, Técnico, Superior ou vazio.' },
      },
      required: ['name', 'board', 'organ', 'year', 'position', 'level'],
    },
    supports: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { id: { type: Type.INTEGER }, text: { type: Type.STRING } },
        required: ['id', 'text'],
      },
    },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          number: { type: Type.INTEGER },
          sourceId: { type: Type.STRING, description: 'O código da questão no site (ex.: Q4229308); vazio numa prova comum.' },
          supportId: { type: Type.INTEGER },
          statement: { type: Type.STRING },
          alternatives: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { letter: { type: Type.STRING }, text: { type: Type.STRING } },
              required: ['letter', 'text'],
            },
          },
          answer: { type: Type.STRING, description: 'A letra certa, só se estiver escrita junto da questão; senão vazio.' },
          comment: { type: Type.STRING, description: 'O gabarito comentado, por inteiro; vazio se não houver.' },
          year: { type: Type.INTEGER, description: 'O ano da prova desta questão; 0 se não houver.' },
          board: { type: Type.STRING },
          organ: { type: Type.STRING },
          prova: { type: Type.STRING },
          discipline: { type: Type.STRING },
          subject: { type: Type.STRING },
          needsFigure: { type: Type.BOOLEAN },
          complete: { type: Type.BOOLEAN },
        },
        required: [
          'number',
          'sourceId',
          'supportId',
          'statement',
          'alternatives',
          'answer',
          'comment',
          'year',
          'board',
          'organ',
          'prova',
          'discipline',
          'subject',
          'needsFigure',
          'complete',
        ],
      },
    },
    answerKey: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { number: { type: Type.INTEGER }, answer: { type: Type.STRING } },
        required: ['number', 'answer'],
      },
    },
  },
  required: ['exam', 'supports', 'questions', 'answerKey'],
};

export async function extractPastExamGemini(
  source: SyllabusSource,
  hints: PastExamHints,
  position: ChunkPosition | null,
): Promise<Chunk> {
  const client = getClient();
  const config = {
    systemInstruction: PASTEXAM_SYSTEM_PROMPT,
    responseMimeType: 'application/json',
    responseSchema: PASTEXAM_SCHEMA,
  };
  const instruction = pastExamUserPrompt(hints, position);

  if (source.type === 'text') {
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: [instruction, '', '--- TEXTO DO PDF ---', source.text].join('\n'),
      config,
    });
    return parsePastExamResponse(response.text);
  }

  // PDF sem texto extraível (escaneado): o Gemini lê a imagem das páginas, todas de uma vez.
  const prompt = ['O arquivo em anexo é uma prova de concurso (ou o gabarito dela); leia o texto das páginas.', instruction].join('\n');
  return withUploadedFile(client, source.buffer, source.mimeType, async (uri, mimeType) => {
    const response = await generateContentWithRetry(client, {
      model: MODEL,
      contents: createUserContent([createPartFromUri(uri, mimeType), prompt]),
      config,
    });
    return parsePastExamResponse(response.text);
  });
}

function parseFlashcardsResponse(rawText: string | undefined): { flashcards: GeneratedFlashcard[] } {
  if (!rawText) {
    throw new Error('A IA não retornou flashcards no formato esperado.');
  }

  let parsed: { flashcards?: unknown };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('A IA não retornou flashcards no formato esperado.');
  }

  if (!Array.isArray(parsed.flashcards)) {
    throw new Error('A IA não retornou flashcards no formato esperado.');
  }

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
      difficulty: (['facil', 'medio', 'dificil'] as const).includes(card.difficulty)
        ? card.difficulty
        : 'medio',
      sourcePage: typeof card.sourcePage === 'number' ? card.sourcePage : undefined,
    }))
    .filter((card) => card.question.length > 0 && card.answer.length > 0);

  if (flashcards.length === 0) {
    throw new Error('A IA não conseguiu gerar flashcards a partir deste conteúdo.');
  }

  return { flashcards };
}
