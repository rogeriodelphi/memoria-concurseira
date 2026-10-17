import pdfParse from 'pdf-parse';

import { parseProviderOrder, runChain, UNSUPPORTED, type ChainSteps, type ProviderName } from './chain';
import type { ChoiceSource, GeneratedChoice } from './choices';
import {
  extractSyllabusClaude,
  generateBulletPointsClaude,
  generateChoicesClaude,
  generateFlashcardsClaude,
  generateMindMapClaude,
  generateSummaryClaude,
  hasClaude,
  isClaudeImageMime,
  type ClaudeSource,
} from './claude';
import {
  extractSyllabusGemini,
  generateFlashcardsGemini,
  generateMindMapGemini,
  generateSummaryGemini,
  generateBulletPointsGemini,
  generateChoicesGemini,
  hasGemini,
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
  extractSyllabusOpenAI,
  generateFlashcardsOpenAI,
  generateMindMapOpenAI,
  generateSummaryOpenAI,
  generateBulletPointsOpenAI,
  generateChoicesOpenAI,
  hasOpenAI,
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
function chainFor<T>(task: string, run: { openai: Run<T>; gemini: Run<T>; claude: Run<T> }): Promise<T> {
  const steps: ChainSteps<T> = {
    openai: { available: hasOpenAI(), run: run.openai },
    gemini: { available: hasGemini(), run: run.gemini },
    claude: { available: hasClaude(), run: run.claude },
  };
  // Lida a cada chamada: é só uma variável de ambiente e assim a ordem vale sem reiniciar nada.
  return runChain(parseProviderOrder(process.env.AI_PROVIDER_ORDER), steps, logFallback(task));
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
