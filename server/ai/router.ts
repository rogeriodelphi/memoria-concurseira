import pdfParse from 'pdf-parse';

import { parseProviderOrder, runChain, UNSUPPORTED, type ChainSteps, type ProviderName } from './chain';
import type { ChoiceSource, GeneratedChoice } from './choices';
import type { LeechFix, LeechFixSource } from './leechfix';
import type { TutorReply, TutorSource } from './tutor';
import type { VerifiedCard, VerifySource } from './verify';
import { MAX_EXAM_CHARS, splitIntoChunks, type Chunk, type PastExamHints } from './pastexam';
import {
  extractPastExamClaude,
  extractSyllabusClaude,
  generateBulletPointsClaude,
  generateChoicesClaude,
  suggestLeechFixClaude,
  explainCardClaude,
  generateFlashcardsClaude,
  generateMindMapClaude,
  generateSummaryClaude,
  hasClaude,
  isClaudeImageMime,
  verifyCardsClaude,
  type ClaudeSource,
} from './claude';
import {
  extractPastExamGemini,
  extractSyllabusGemini,
  generateFlashcardsGemini,
  generateMindMapGemini,
  generateSummaryGemini,
  generateBulletPointsGemini,
  generateChoicesGemini,
  suggestLeechFixGemini,
  explainCardGemini,
  hasGemini,
  verifyCardsGemini,
  type GenerationOptions,
  type GenerationSource,
  type GeneratedFlashcard,
  type GeneratedSummary,
  type GeneratedBulletPoints,
  type GeneratedSyllabus,
  type MindMapNode,
  type SummaryMode,
  type SyllabusSource,
} from './gemini';
import {
  extractPastExamOpenAI,
  extractSyllabusOpenAI,
  generateFlashcardsOpenAI,
  generateMindMapOpenAI,
  generateSummaryOpenAI,
  generateBulletPointsOpenAI,
  generateChoicesOpenAI,
  suggestLeechFixOpenAI,
  explainCardOpenAI,
  hasOpenAI,
  verifyCardsOpenAI,
  type OpenAISource,
} from './openai';

export type {
  GenerationOptions,
  GenerationSource,
  GeneratedFlashcard,
  GeneratedSummary,
  GeneratedBulletPoints,
  GeneratedSyllabus,
  MindMapNode,
  SummaryMode,
  SyllabusSource,
};

// Abaixo disso, um PDF é tratado como escaneado (sem texto extraível) — a
// OpenAI não faz OCR de PDF, então nesse caso ela é pulada e quem lê a imagem
// das páginas é o Gemini (Files API) ou o Claude (PDF direto na requisição).
const MIN_PDF_TEXT_LENGTH = 200;

// Limites do Claude para PDF enviado inteiro: tamanho da requisição e número
// de páginas por requisição. Acima disso ele é pulado e o Gemini, que não tem
// esse teto, segue sendo a opção.
const CLAUDE_MAX_PDF_BYTES = 20 * 1024 * 1024;
const CLAUDE_MAX_PDF_PAGES = 100;

// O leitor de PDF do app (pdf-parse, um pdf.js antigo) falha em alguns PDFs; nesse
// caso a contagem de páginas é 0 ("desconhecida"). Pelo tamanho ainda dá pra
// tentar, e se passar do limite a própria API recusa e a cadeia segue para o próximo.
function claudeCanTakePdf(buffer: Buffer, pages: number): boolean {
  return buffer.length <= CLAUDE_MAX_PDF_BYTES && pages <= CLAUDE_MAX_PDF_PAGES;
}

const PROVIDER_LABEL: Record<ProviderName, string> = { openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude' };

function logFallback(task: string) {
  return (provider: ProviderName, err: unknown) =>
    console.error(`${PROVIDER_LABEL[provider]} falhou ao ${task}, tentando o próximo provedor:`, err);
}

type Run<T> = (() => Promise<T | typeof UNSUPPORTED>) | null;

/** Cada operação diz o que cada provedor consegue fazer com aquela entrada (null = nada). */
function chainFor<T>(
  task: string,
  run: { openai: Run<T>; gemini: Run<T>; claude: Run<T> },
  order: readonly ProviderName[] = parseProviderOrder(process.env.AI_PROVIDER_ORDER),
): Promise<T> {
  const steps: ChainSteps<T> = {
    openai: { available: hasOpenAI(), run: run.openai },
    gemini: { available: hasGemini(), run: run.gemini },
    claude: { available: hasClaude(), run: run.claude },
  };
  // A ordem é lida a cada chamada (é só uma variável de ambiente), e assim vale sem reiniciar nada.
  return runChain(order, steps, logFallback(task));
}

export interface PdfInfo {
  text: string;
  /** 0 quando o leitor não conseguiu abrir o PDF. */
  pages: number;
}

async function readPdfInfo(buffer: Buffer): Promise<PdfInfo> {
  try {
    const parsed = await pdfParse(buffer);
    return { text: (parsed.text ?? '').trim(), pages: parsed.numpages ?? 0 };
  } catch {
    return { text: '', pages: 0 };
  }
}

/** O que o roteador usa de fora do módulo; os testes trocam a leitura de PDF por uma resposta pronta. */
export interface RouterDeps {
  readPdf: (buffer: Buffer) => Promise<PdfInfo>;
}

const defaultDeps: RouterDeps = { readPdf: readPdfInfo };

/** Lê o PDF uma única vez, mesmo que mais de um provedor precise do texto ou da contagem de páginas. */
function lazyPdfInfo(buffer: Buffer | null, deps: RouterDeps): () => Promise<PdfInfo> {
  let pending: Promise<PdfInfo> | undefined;
  return () => {
    pending ??= buffer ? deps.readPdf(buffer) : Promise.resolve({ text: '', pages: 0 });
    return pending;
  };
}

function pdfInfoOf(source: GenerationSource, deps: RouterDeps): () => Promise<PdfInfo> {
  return lazyPdfInfo(source.type === 'file' ? source.buffer : null, deps);
}

/**
 * Tópico, texto e arquivo (PDF com texto extraível ou imagem) têm
 * equivalente na OpenAI. YouTube e arquivo de áudio/vídeo não — só o
 * Gemini lê esses nativamente, então continuam nele independente de ter
 * chave da OpenAI configurada ou não.
 */
async function toOpenAISource(source: GenerationSource, pdfInfo: () => Promise<PdfInfo>): Promise<OpenAISource | null> {
  if (source.type === 'topic') return { type: 'topic', topic: source.topic };
  if (source.type === 'text') return { type: 'text', text: source.text };
  if (source.type === 'youtube') return null;

  if (source.mimeType.startsWith('image/')) {
    return { type: 'image', base64: source.buffer.toString('base64'), mimeType: source.mimeType };
  }
  if (source.mimeType === 'application/pdf') {
    const { text } = await pdfInfo();
    if (text.length < MIN_PDF_TEXT_LENGTH) return null;
    return { type: 'pdf_text', extractedText: text, filename: 'documento.pdf' };
  }
  return null;
}

/**
 * O Claude lê tópico, texto, imagem (JPEG, PNG, GIF, WebP) e PDF — o de texto
 * extraível vai como texto (mais barato), o escaneado vai inteiro, dentro dos
 * limites de tamanho. Áudio, vídeo e YouTube ele não processa.
 */
async function toClaudeSource(source: GenerationSource, pdfInfo: () => Promise<PdfInfo>): Promise<ClaudeSource | null> {
  if (source.type === 'topic') return { type: 'topic', topic: source.topic };
  if (source.type === 'text') return { type: 'text', text: source.text };
  if (source.type === 'youtube') return null;

  if (source.mimeType.startsWith('image/')) {
    return isClaudeImageMime(source.mimeType)
      ? { type: 'image', base64: source.buffer.toString('base64'), mimeType: source.mimeType }
      : null;
  }
  if (source.mimeType === 'application/pdf') {
    const { text, pages } = await pdfInfo();
    if (text.length >= MIN_PDF_TEXT_LENGTH) return { type: 'pdf_text', extractedText: text, filename: 'documento.pdf' };
    if (claudeCanTakePdf(source.buffer, pages)) return { type: 'pdf', base64: source.buffer.toString('base64') };
  }
  return null;
}

export function generateFlashcards(
  source: GenerationSource,
  options: GenerationOptions,
  deps: RouterDeps = defaultDeps,
): Promise<{ flashcards: GeneratedFlashcard[] }> {
  const pdfInfo = pdfInfoOf(source, deps);
  return chainFor('gerar flashcards', {
    openai: async () => {
      const openaiSource = await toOpenAISource(source, pdfInfo);
      return openaiSource ? generateFlashcardsOpenAI(openaiSource, options) : UNSUPPORTED;
    },
    gemini: () => generateFlashcardsGemini(source, options),
    claude: async () => {
      const claudeSource = await toClaudeSource(source, pdfInfo);
      return claudeSource ? generateFlashcardsClaude(claudeSource, options) : UNSUPPORTED;
    },
  });
}

export function generateMindMap(source: GenerationSource, deps: RouterDeps = defaultDeps): Promise<MindMapNode> {
  const pdfInfo = pdfInfoOf(source, deps);
  return chainFor('gerar mapa mental', {
    openai: async () => {
      const openaiSource = await toOpenAISource(source, pdfInfo);
      return openaiSource ? generateMindMapOpenAI(openaiSource) : UNSUPPORTED;
    },
    gemini: () => generateMindMapGemini(source),
    claude: async () => {
      const claudeSource = await toClaudeSource(source, pdfInfo);
      return claudeSource ? generateMindMapClaude(claudeSource) : UNSUPPORTED;
    },
  });
}

export function generateSummary(text: string, mode: SummaryMode): Promise<GeneratedSummary> {
  return chainFor('gerar resumo', {
    openai: () => generateSummaryOpenAI(text, mode),
    gemini: () => generateSummaryGemini(text, mode),
    claude: () => generateSummaryClaude(text, mode),
  });
}

export function generateBulletPoints(text: string): Promise<GeneratedBulletPoints> {
  return chainFor('gerar bullet points', {
    openai: () => generateBulletPointsOpenAI(text),
    gemini: () => generateBulletPointsGemini(text),
    claude: () => generateBulletPointsClaude(text),
  });
}

/** Alternativas de múltipla escolha para vários cartões de uma vez (uma chamada por lote). */
export function generateChoices(sources: ChoiceSource[]): Promise<GeneratedChoice[]> {
  return chainFor('gerar alternativas', {
    openai: () => generateChoicesOpenAI(sources),
    gemini: () => generateChoicesGemini(sources),
    claude: () => generateChoicesClaude(sources),
  });
}

/** A sugestão (diagnóstico, macete, divisão) para um cartão que o usuário erra sempre: uma chamada por cartão. */
export function suggestLeechFix(source: LeechFixSource): Promise<LeechFix> {
  return chainFor('sugerir como fixar o cartão', {
    openai: () => suggestLeechFixOpenAI(source),
    gemini: () => suggestLeechFixGemini(source),
    claude: () => suggestLeechFixClaude(source),
  });
}

/** A explicação de um cartão pelo "professor": o aluno pergunta e a IA responde, uma chamada por pergunta. */
export function explainCard(source: TutorSource): Promise<TutorReply> {
  return chainFor('explicar o cartão', {
    openai: () => explainCardOpenAI(source),
    gemini: () => explainCardGemini(source),
    claude: () => explainCardClaude(source),
  });
}

/**
 * A ordem dos provedores para conferir cartões: a de `AI_VERIFY_ORDER` se existir; senão, a ordem de geração
 * ao contrário. Assim, com mais de uma chave configurada, quem confere tende a ser outro provedor que não o que
 * escreveu os cartões (uma segunda opinião de verdade). Com uma chave só, o mesmo provedor confere, com outro pedido.
 */
export function verifyProviderOrder(env: NodeJS.ProcessEnv = process.env): ProviderName[] {
  const custom = env.AI_VERIFY_ORDER?.trim();
  return custom ? parseProviderOrder(custom) : [...parseProviderOrder(env.AI_PROVIDER_ORDER)].reverse();
}

/** A segunda opinião sobre cartões escritos por IA (uma chamada por lote). `context` descreve a prova (concurso, cargo, banca). */
export function verifyCards(sources: VerifySource[], context: string): Promise<VerifiedCard[]> {
  return chainFor(
    'conferir cartões',
    {
      openai: () => verifyCardsOpenAI(sources, context),
      gemini: () => verifyCardsGemini(sources, context),
      claude: () => verifyCardsClaude(sources, context),
    },
    verifyProviderOrder(),
  );
}

// Um edital inteiro passa fácil de 100 mil caracteres; acima disto o custo e o
// risco de a IA se perder no meio do texto não compensam — melhor pedir só o
// trecho do conteúdo programático.
export const MAX_SYLLABUS_CHARS = 350_000;

/**
 * Texto (colado ou extraído de um PDF) segue o mesmo caminho das demais
 * gerações. PDF sem texto extraível (escaneado) só o Gemini e o Claude leem,
 * direto da imagem das páginas.
 */
export async function extractSyllabus(
  source: SyllabusSource,
  positionHint: string,
  deps: RouterDeps = defaultDeps,
): Promise<GeneratedSyllabus> {
  let text: string | null = null;
  let pages = 0;
  if (source.type === 'text') {
    text = source.text;
  } else {
    const info = await lazyPdfInfo(source.buffer, deps)();
    pages = info.pages;
    if (info.text.length >= MIN_PDF_TEXT_LENGTH) text = info.text;
  }

  if (text !== null && text.length > MAX_SYLLABUS_CHARS) {
    throw new Error(
      'O edital é longo demais para analisar de uma vez. Cole apenas o trecho do conteúdo programático.',
    );
  }

  const documentText = text;
  const scanned = source.type === 'file' && documentText === null ? source : null;
  const claudeCanReadScanned = scanned !== null && claudeCanTakePdf(scanned.buffer, pages);

  return chainFor('analisar o edital', {
    openai: documentText === null ? null : () => extractSyllabusOpenAI(documentText, positionHint),
    gemini: () => extractSyllabusGemini(documentText === null ? source : { type: 'text', text: documentText }, positionHint),
    claude:
      documentText !== null
        ? () => extractSyllabusClaude({ type: 'text', text: documentText }, positionHint)
        : claudeCanReadScanned && scanned
          ? () => extractSyllabusClaude({ type: 'pdf', base64: scanned.buffer.toString('base64') }, positionHint)
          : null,
  });
}

export interface PastExamReading {
  chunks: Chunk[];
  /** O texto lido do PDF (ou colado); null no PDF escaneado, em que a IA lê a imagem e não há texto para conferir. */
  text: string | null;
}

export interface PastExamReadOptions {
  /** Menos texto que isto num PDF e ele é tratado como escaneado. O gabarito é curto: o limite dele é menor. */
  minTextChars?: number;
  /** Chamado com quantos trechos já foram lidos e quantos são no total (0 de N no começo). */
  onProgress?: (done: number, total: number) => void;
}

/** Quantos trechos vão para a IA ao mesmo tempo: o bastante para encurtar a espera sem estourar o limite por minuto. */
const PAST_EXAM_CONCURRENCY = 2;

/** Roda `fn` em todos os itens, `limit` por vez, mantendo a ordem; no primeiro erro para de começar novos e o repassa. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}

/**
 * Lê uma prova (ou o gabarito dela) e devolve as questões e o gabarito encontrados, trecho a trecho. O texto do PDF
 * é cortado em trechos que se sobrepõem um pouco (uma questão cortada na emenda aparece inteira no trecho seguinte);
 * cada trecho é uma chamada à cadeia de provedores. PDF escaneado vai inteiro, numa chamada só, para o Gemini ou o Claude.
 */
export async function extractPastExam(
  source: SyllabusSource,
  hints: PastExamHints,
  options: PastExamReadOptions = {},
  deps: RouterDeps = defaultDeps,
): Promise<PastExamReading> {
  const minText = options.minTextChars ?? MIN_PDF_TEXT_LENGTH;
  let text: string | null = null;
  let pages = 0;
  if (source.type === 'text') {
    text = source.text.trim();
  } else {
    const info = await lazyPdfInfo(source.buffer, deps)();
    pages = info.pages;
    if (info.text.length >= minText) text = info.text;
  }

  if (text !== null && text.length > MAX_EXAM_CHARS) {
    throw new Error('O PDF é longo demais para uma prova só. Envie apenas a prova (sem apostilas ou outros cadernos).');
  }

  if (text === null) {
    if (source.type !== 'file') throw new Error('Não há texto para ler.');
    const scanned = source;
    const canClaude = claudeCanTakePdf(scanned.buffer, pages);
    options.onProgress?.(0, 1);
    const chunk = await chainFor('ler a prova', {
      openai: null,
      gemini: () => extractPastExamGemini(scanned, hints, null),
      claude: canClaude
        ? () => extractPastExamClaude({ type: 'pdf', base64: scanned.buffer.toString('base64') }, hints, null)
        : null,
    });
    options.onProgress?.(1, 1);
    return { chunks: [chunk], text: null };
  }

  const pieces = splitIntoChunks(text);
  let done = 0;
  options.onProgress?.(0, pieces.length);
  const chunks = await mapLimited(pieces, PAST_EXAM_CONCURRENCY, async (piece, index) => {
    const position = { index, total: pieces.length };
    const chunk = await chainFor('ler a prova', {
      openai: () => extractPastExamOpenAI(piece, hints, position),
      gemini: () => extractPastExamGemini({ type: 'text', text: piece }, hints, position),
      claude: () => extractPastExamClaude({ type: 'text', text: piece }, hints, position),
    });
    options.onProgress?.(++done, pieces.length);
    return chunk;
  });
  return { chunks, text };
}
