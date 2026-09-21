import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';

import JSZip from 'jszip';

import { sanitizeFlashcardHtml } from '../sanitizeHtml';

export class ApkgError extends Error {}

export interface ApkgCard {
  question: string;
  answer: string;
}

export interface ParsedApkg {
  cards: ApkgCard[];
  totalNotes: number;
  empty: number;
  clozeConverted: number;
  images: { embedded: number; skipped: number };
}

const MAX_NOTES = 100_000;
const MAX_DB_BYTES = 500 * 1024 * 1024;
const MAX_MEDIA_LIST_BYTES = 64 * 1024 * 1024;
// Imagens viram base64 dentro do próprio cartão (é assim que o editor também
// as guarda), e a coleção inteira volta em uma única resposta — sem teto, um
// baralho cheio de imagens deixaria a coleção pesada demais pra abrir.
const MAX_IMAGE_BYTES = 200 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

// Node só ganhou zstd nativo a partir da 22.15 — o .apkg no formato mais novo
// do Anki (collection.anki21b) depende disso. Acessado dinamicamente pra que
// numa versão mais antiga só esse formato falhe, não o servidor inteiro.
type ZstdDecompress = (data: Buffer, options?: { maxOutputLength?: number }) => Buffer;
const zstdDecompress = (zlib as unknown as { zstdDecompressSync?: ZstdDecompress }).zstdDecompressSync;

function zstdDecode(data: Buffer, maxOutputLength: number): Buffer {
  if (!zstdDecompress) {
    throw new ApkgError(
      'Este formato de .apkg exige uma versão mais nova do Node.js. No Anki, exporte de novo marcando "Suporte a versões antigas do Anki".',
    );
  }
  return zstdDecompress(data, { maxOutputLength });
}

// Tamanho descompactado declarado no cabeçalho do zip (campo interno do
// JSZip, sem API pública) — usado só pra recusar de antemão entradas
// gigantes sem precisar carregá-las na memória.
function declaredSize(entry: JSZip.JSZipObject): number | null {
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  return typeof size === 'number' ? size : null;
}

function readNoteFields(dbBytes: Buffer): string[] {
  const tmp = path.join(os.tmpdir(), `anki-import-${crypto.randomUUID()}.db`);
  fs.writeFileSync(tmp, dbBytes);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(tmp);
    const rows = db.prepare('SELECT flds FROM notes').all() as unknown as { flds: unknown }[];
    return rows.map((r) => String(r.flds ?? ''));
  } catch {
    throw new ApkgError('Não foi possível ler as notas deste arquivo .apkg.');
  } finally {
    db?.close();
    for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(tmp + suffix, { force: true });
  }
}

// ---- Lista de mídia do formato novo (protobuf) ----------------------------
// message MediaEntries { repeated MediaEntry entries = 1; }
// message MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; optional uint32 legacy_zip_filename = 255; }
// Só o que precisamos (nome + nome do arquivo dentro do zip), sem depender de
// uma biblioteca de protobuf pra ler dois campos.

function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7;
    if (shift > 63) break;
  }
  throw new Error('varint inválido');
}

function skipField(buf: Buffer, pos: number, wire: number): number {
  switch (wire) {
    case 0:
      return readVarint(buf, pos)[1];
    case 1:
      return pos + 8;
    case 2: {
      const [len, start] = readVarint(buf, pos);
      return start + len;
    }
    case 5:
      return pos + 4;
    default:
      throw new Error('wire type não suportado');
  }
}

interface MediaEntry {
  name: string;
  zipEntry?: number;
}

function parseMediaEntry(buf: Buffer): MediaEntry {
  let name = '';
  let zipEntry: number | undefined;
  let pos = 0;
  while (pos < buf.length) {
    const [tag, afterTag] = readVarint(buf, pos);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1 && wire === 2) {
      const [len, start] = readVarint(buf, afterTag);
      name = buf.toString('utf8', start, start + len);
      pos = start + len;
    } else if (field === 255 && wire === 0) {
      const [value, next] = readVarint(buf, afterTag);
      zipEntry = value;
      pos = next;
    } else {
      pos = skipField(buf, afterTag, wire);
    }
  }
  return { name, zipEntry };
}

function parseMediaEntries(buf: Buffer): MediaEntry[] {
  const entries: MediaEntry[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, afterTag] = readVarint(buf, pos);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1 && wire === 2) {
      const [len, start] = readVarint(buf, afterTag);
      entries.push(parseMediaEntry(buf.subarray(start, start + len)));
      pos = start + len;
    } else {
      pos = skipField(buf, afterTag, wire);
    }
  }
  return entries;
}

// ---- Mídia ---------------------------------------------------------------

interface MediaLoader {
  load(fileName: string): Promise<Buffer | null>;
}

async function createMediaLoader(zip: JSZip, zstd: boolean): Promise<MediaLoader> {
  const entryByName = new Map<string, string>();
  try {
    const listFile = zip.file('media');
    if (listFile) {
      const raw = await listFile.async('nodebuffer');
      if (zstd) {
        parseMediaEntries(zstdDecode(raw, MAX_MEDIA_LIST_BYTES)).forEach((entry, index) => {
          entryByName.set(entry.name, String(entry.zipEntry ?? index));
        });
      } else {
        const map = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        for (const [entryName, fileName] of Object.entries(map)) {
          if (typeof fileName === 'string') entryByName.set(fileName, entryName);
        }
      }
    }
  } catch {
    // Lista de mídia ilegível: segue sem imagens em vez de derrubar a importação.
  }

  const cache = new Map<string, Buffer | null>();
  return {
    async load(fileName) {
      if (cache.has(fileName)) return cache.get(fileName) ?? null;
      let result: Buffer | null = null;
      try {
        const zipEntryName = entryByName.get(fileName);
        const entry = zipEntryName ? zip.file(zipEntryName) : null;
        if (entry) {
          const declared = declaredSize(entry);
          if (zstd || declared === null || declared <= MAX_IMAGE_BYTES) {
            const raw = await entry.async('nodebuffer');
            const data = zstd ? zstdDecode(raw, MAX_IMAGE_BYTES) : raw;
            if (data.length <= MAX_IMAGE_BYTES) result = data;
          }
        }
      } catch {
        result = null;
      }
      cache.set(fileName, result);
      return result;
    },
  };
}

interface ConvertContext {
  media: MediaLoader;
  imageBytes: number;
  embedded: number;
  skipped: number;
}

function candidateFileNames(rawSrc: string): string[] {
  const unescaped = rawSrc.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const names = [unescaped];
  try {
    const decoded = decodeURIComponent(unescaped);
    if (decoded !== unescaped) names.push(decoded);
  } catch {
    // src com "%" solto: usa só o nome como veio.
  }
  return names;
}

async function replaceImageTag(tag: string, ctx: ConvertContext): Promise<string> {
  const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '') : '';

  // Imagem externa (http/https): não importa — o cartão passaria a depender
  // de um servidor de terceiros (que pode sumir ou rastrear quem abre).
  // Imagem já embutida no próprio HTML (data:) passa direto, dentro do teto.
  if (/^data:image\//i.test(src)) {
    if (src.length <= MAX_IMAGE_BYTES * 1.4 && ctx.imageBytes + src.length <= MAX_TOTAL_IMAGE_BYTES) {
      ctx.imageBytes += src.length;
      ctx.embedded++;
      return `<img src="${src}">`;
    }
    ctx.skipped++;
    return '';
  }
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || ctx.imageBytes >= MAX_TOTAL_IMAGE_BYTES) {
    ctx.skipped++;
    return '';
  }

  for (const fileName of candidateFileNames(src)) {
    const mime = IMAGE_MIME[fileName.split('.').pop()?.toLowerCase() ?? ''];
    if (!mime) continue;
    const data = await ctx.media.load(fileName);
    if (!data) continue;
    if (ctx.imageBytes + data.length > MAX_TOTAL_IMAGE_BYTES) break;
    ctx.imageBytes += data.length;
    ctx.embedded++;
    return `<img src="data:${mime};base64,${data.toString('base64')}">`;
  }
  ctx.skipped++;
  return '';
}

async function embedImages(html: string, ctx: ConvertContext): Promise<string> {
  const matches = [...html.matchAll(/<img\b[^>]*>/gi)];
  if (matches.length === 0) return html;
  let out = '';
  let last = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    out += html.slice(last, index) + (await replaceImageTag(match[0], ctx));
    last = index + match[0].length;
  }
  return out + html.slice(last);
}

// ---- Conversão de campos -------------------------------------------------

const CLOZE = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
const HAS_CLOZE = /\{\{c\d+::/i;

export function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<img\b[^>]*>/gi, ' [imagem] ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function hasContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;|\s/gi, '').length > 0;
}

async function finalizeField(html: string, ctx: ConvertContext): Promise<string> {
  const withoutSound = html.replace(/\[sound:[^\]]*\]/gi, '');
  const withImages = await embedImages(withoutSound, ctx);
  return sanitizeFlashcardHtml(withImages).trim();
}

/**
 * Lê um .apkg do Anki e devolve os cartões já convertidos pro formato do app
 * (HTML sanitizado pela mesma allow-list do editor de texto rico).
 *
 * Só usa a tabela `notes` — o layout dela é o mesmo em todas as versões do
 * Anki, ao contrário do resto do esquema (que mudou de JSON pra tabelas
 * separadas). Uma nota vira um cartão: o primeiro campo é a pergunta e o
 * segundo a resposta, o que cobre "Básico", "Básico (e invertido)" etc.
 * Notas de lacuna (cloze) viram uma pergunta com "[...]" e a frase completa
 * como resposta.
 */
export async function parseApkg(buffer: Buffer): Promise<ParsedApkg> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ApkgError('O arquivo não é um .apkg válido do Anki.');
  }

  // O Anki pode empacotar a mesma coleção em até três nomes — o mais novo
  // vence. (No formato de compatibilidade, "collection.anki2" é só um aviso
  // pedindo pra atualizar o Anki; os dados reais ficam em "collection.anki21".)
  const candidates = [
    { name: 'collection.anki21b', zstd: true },
    { name: 'collection.anki21', zstd: false },
    { name: 'collection.anki2', zstd: false },
  ];
  const found = candidates.find((c) => zip.file(c.name));
  const entry = found ? zip.file(found.name) : null;
  if (!found || !entry) {
    throw new ApkgError('Não encontrei a coleção do Anki dentro do arquivo. Ele é mesmo um .apkg?');
  }

  const declared = declaredSize(entry);
  if (declared !== null && declared > MAX_DB_BYTES) {
    throw new ApkgError('A coleção dentro do arquivo é grande demais para importar.');
  }
  let dbBytes = await entry.async('nodebuffer');
  if (found.zstd) {
    try {
      dbBytes = zstdDecode(dbBytes, MAX_DB_BYTES);
    } catch (err) {
      if (err instanceof ApkgError) throw err;
      throw new ApkgError('Não foi possível descompactar a coleção deste arquivo .apkg.');
    }
  }

  const notes = readNoteFields(dbBytes);
  if (notes.length > MAX_NOTES) {
    throw new ApkgError(`O arquivo tem cartões demais (limite de ${MAX_NOTES.toLocaleString('pt-BR')} por importação).`);
  }
  if (notes.length === 1 && /please update to the latest anki version/i.test(notes[0])) {
    throw new ApkgError(
      'Este .apkg só contém um aviso de versão. No Anki, exporte de novo marcando "Suporte a versões antigas do Anki".',
    );
  }

  const ctx: ConvertContext = {
    media: await createMediaLoader(zip, found.zstd),
    imageBytes: 0,
    embedded: 0,
    skipped: 0,
  };

  const cards: ApkgCard[] = [];
  let empty = 0;
  let clozeConverted = 0;

  for (const flds of notes) {
    const fields = flds.split('\x1f');
    const front = fields[0] ?? '';
    const back = fields[1] ?? '';
    const isCloze = HAS_CLOZE.test(front);

    let questionRaw = front;
    let answerRaw = back;
    if (isCloze) {
      questionRaw = front.replace(CLOZE, (_match, _text, hint) => (hint ? `[${hint}]` : '[...]'));
      answerRaw = front.replace(CLOZE, (_match, text) => `<b>${text}</b>`) + (hasContent(back) ? `<br><br>${back}` : '');
    }

    const question = await finalizeField(questionRaw, ctx);
    const answer = await finalizeField(answerRaw, ctx);
    if (!hasContent(question) || !hasContent(answer)) {
      empty++;
      continue;
    }
    if (isCloze) clozeConverted++;
    cards.push({ question, answer });
  }

  return {
    cards,
    totalNotes: notes.length,
    empty,
    clozeConverted,
    images: { embedded: ctx.embedded, skipped: ctx.skipped },
  };
}
