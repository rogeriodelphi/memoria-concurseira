import pdfParse from 'pdf-parse';

import {
  generateFlashcardsGemini,
  generateMindMapGemini,
  generateSummaryGemini,
  generateBulletPointsGemini,
  type GenerationOptions,
  type GenerationSource,
  type GeneratedFlashcard,
  type GeneratedSummary,
  type GeneratedBulletPoints,
  type MindMapNode,
  type SummaryMode,
} from './gemini';
import {
  generateFlashcardsOpenAI,
  generateMindMapOpenAI,
  generateSummaryOpenAI,
  generateBulletPointsOpenAI,
  hasOpenAI,
  type OpenAISource,
} from './openai';

export type {
  GenerationOptions,
  GenerationSource,
  GeneratedFlashcard,
  GeneratedSummary,
  GeneratedBulletPoints,
  MindMapNode,
  SummaryMode,
};

// Abaixo disso, um PDF é tratado como escaneado (sem texto extraível) — a
// OpenAI não faz OCR de PDF, então nesse caso cai pro Gemini, que lê a
// imagem da página diretamente via Files API.
const MIN_PDF_TEXT_LENGTH = 200;

/**
 * Tópico, texto e arquivo (PDF com texto extraível ou imagem) têm
 * equivalente na OpenAI. YouTube e arquivo de áudio/vídeo não — só o
 * Gemini lê esses nativamente, então continuam nele independente de ter
 * chave da OpenAI configurada ou não.
 */
async function toOpenAISource(source: GenerationSource): Promise<OpenAISource | null> {
  if (source.type === 'topic') return { type: 'topic', topic: source.topic };
  if (source.type === 'text') return { type: 'text', text: source.text };
  if (source.type === 'youtube') return null;

  if (source.mimeType.startsWith('image/')) {
    return { type: 'image', base64: source.buffer.toString('base64'), mimeType: source.mimeType };
  }
  if (source.mimeType === 'application/pdf') {
    const extractedText = await pdfParse(source.buffer)
      .then((parsed) => parsed.text ?? '')
      .catch(() => '');
    if (extractedText.trim().length < MIN_PDF_TEXT_LENGTH) return null;
    return { type: 'pdf_text', extractedText: extractedText.trim(), filename: 'documento.pdf' };
  }
  return null;
}

export async function generateFlashcards(
  source: GenerationSource,
  options: GenerationOptions,
): Promise<{ flashcards: GeneratedFlashcard[] }> {
  if (hasOpenAI()) {
    const openaiSource = await toOpenAISource(source);
    if (openaiSource) {
      try {
        return await generateFlashcardsOpenAI(openaiSource, options);
      } catch (err) {
        console.error('OpenAI falhou ao gerar flashcards, tentando Gemini:', err);
      }
    }
  }
  return generateFlashcardsGemini(source, options);
}

export async function generateMindMap(source: GenerationSource): Promise<MindMapNode> {
  if (hasOpenAI()) {
    const openaiSource = await toOpenAISource(source);
    if (openaiSource) {
      try {
        return await generateMindMapOpenAI(openaiSource);
      } catch (err) {
        console.error('OpenAI falhou ao gerar mapa mental, tentando Gemini:', err);
      }
    }
  }
  return generateMindMapGemini(source);
}

export async function generateSummary(text: string, mode: SummaryMode): Promise<GeneratedSummary> {
  if (hasOpenAI()) {
    try {
      return await generateSummaryOpenAI(text, mode);
    } catch (err) {
      console.error('OpenAI falhou ao gerar resumo, tentando Gemini:', err);
    }
  }
  return generateSummaryGemini(text, mode);
}

export async function generateBulletPoints(text: string): Promise<GeneratedBulletPoints> {
  if (hasOpenAI()) {
    try {
      return await generateBulletPointsOpenAI(text);
    } catch (err) {
      console.error('OpenAI falhou ao gerar bullet points, tentando Gemini:', err);
    }
  }
  return generateBulletPointsGemini(text);
}
