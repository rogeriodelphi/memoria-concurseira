/**
 * Áudio da leitura em voz alta: o Gemini devolve a fala como WAV pronto ou como
 * PCM cru (16 bits, mono), conforme o modelo. Aqui tudo vira PCM para poder
 * juntar trechos de um texto longo e embrulhar de novo num único WAV.
 */

export interface DecodedAudio {
  /** PCM de 16 bits, mono. */
  pcm: Buffer;
  sampleRate: number;
}

const DEFAULT_SAMPLE_RATE = 24_000;

export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // tamanho do bloco fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // bytes por segundo
  header.writeUInt16LE(2, 32); // bytes por amostra
  header.writeUInt16LE(16, 34); // bits por amostra
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function isWav(data: Buffer): boolean {
  return data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE';
}

function decodeWav(data: Buffer): DecodedAudio {
  let sampleRate = DEFAULT_SAMPLE_RATE;
  let format: { channels: number; bits: number; encoding: number } | null = null;

  // Os blocos do WAV vêm em sequência (id de 4 letras + tamanho); o áudio fica no "data".
  let offset = 12;
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= data.length) {
      format = { encoding: data.readUInt16LE(body), channels: data.readUInt16LE(body + 2), bits: data.readUInt16LE(body + 14) };
      sampleRate = data.readUInt32LE(body + 4);
    } else if (id === 'data') {
      if (!format || format.encoding !== 1 || format.channels !== 1 || format.bits !== 16) {
        throw new Error('Formato de áudio inesperado (esperava PCM de 16 bits, mono).');
      }
      // Alguns geradores gravam o tamanho como 0 ou além do fim; vale o que de fato existe.
      const end = size === 0 || body + size > data.length ? data.length : body + size;
      // Tamanho ímpar quebraria o alinhamento das amostras de 16 bits.
      const pcm = data.subarray(body, end - ((end - body) % 2));
      return { pcm: Buffer.from(pcm), sampleRate };
    }
    offset = body + size + (size % 2); // blocos são alinhados em 2 bytes
  }
  throw new Error('O áudio recebido não tem dados.');
}

/** Aceita o WAV completo ou o PCM cru ("audio/L16;codec=pcm;rate=24000"). */
export function decodeGeminiAudio(data: Buffer, mimeType: string | undefined): DecodedAudio {
  if (data.length === 0) throw new Error('O áudio recebido está vazio.');
  if (isWav(data)) return decodeWav(data);
  const rate = Number(/rate=(\d+)/i.exec(mimeType ?? '')?.[1]);
  const pcm = data.subarray(0, data.length - (data.length % 2));
  return { pcm: Buffer.from(pcm), sampleRate: Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_SAMPLE_RATE };
}

export function concatPcm(parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

/**
 * Parte um texto longo em trechos de até `maxChars`, quebrando em fim de frase
 * (e, se uma frase sozinha passa do limite, no último espaço antes dele). Trechos
 * curtos demais viram um só, para a voz não "reiniciar" a cada frase.
 */
export function splitForSpeech(text: string, maxChars = 1500): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.split(/(?<=[.!?…])\s+/);
  const pieces: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence;
    while (rest.length > maxChars) {
      const cut = rest.lastIndexOf(' ', maxChars);
      const at = cut > maxChars * 0.5 ? cut : maxChars;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }

  const chunks: string[] = [];
  for (const piece of pieces) {
    const last = chunks[chunks.length - 1];
    if (last !== undefined && last.length + 1 + piece.length <= maxChars) chunks[chunks.length - 1] = `${last} ${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}
