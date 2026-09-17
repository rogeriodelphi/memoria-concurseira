import { GoogleGenAI, Type, FileState, ApiError, createPartFromUri, createUserContent } from '@google/genai';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';

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

function friendlyGeminiError(err: ApiError, parsed: ParsedGeminiError): Error {
  if (err.status === 429 || parsed.status === 'RESOURCE_EXHAUSTED') {
    return new Error(
      'Limite de uso gratuito do Gemini atingido no momento (a chave de API está no plano gratuito, com cota ' +
        'bem baixa). Tente de novo em alguns instantes — se persistir, pode ser um limite diário; verifique em ' +
        'https://ai.dev/rate-limit ou considere um plano pago.',
    );
  }
  if (err.status === 503 || parsed.status === 'UNAVAILABLE') {
    return new Error('O Gemini está com alta demanda no momento. Tente novamente em alguns instantes.');
  }
  return new Error('Falha ao se comunicar com a IA. Tente novamente.');
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
 */
async function generateContentWithRetry(
  client: GoogleGenAI,
  params: GenerateContentParameters,
): Promise<GenerateContentResponse> {
  let quotaRetryUsed = false;
  for (let attempt = 1; attempt <= MAX_OVERLOAD_ATTEMPTS; attempt++) {
    try {
      return await client.models.generateContent(params);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const parsed = parseGeminiError(err);

      if (err.status === 429) {
        if (!quotaRetryUsed && parsed.retryDelaySeconds) {
          quotaRetryUsed = true;
          const delay = Math.min(parsed.retryDelaySeconds * 1000, MAX_QUOTA_RETRY_DELAY_MS);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw friendlyGeminiError(err, parsed);
      }

      const overloaded = err.status === 503;
      if (!overloaded || attempt === MAX_OVERLOAD_ATTEMPTS) {
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
