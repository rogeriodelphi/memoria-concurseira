import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { concatPcm, decodeGeminiAudio, pcmToWav, splitForSpeech } from './audio';
import { AudioCache, cacheMaxBytes, defaultCacheDir } from './cache';
import { cacheKey, synthesizeSpeech, type SpeechEngine } from './synthesize';

const pcmOf = (...samples: number[]) => {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
};

// ---------- áudio ----------

test('WAV: cabeçalho de PCM de 16 bits, mono, na taxa pedida', () => {
  const pcm = pcmOf(1, -2, 300);
  const wav = pcmToWav(pcm, 24000);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(wav.readUInt16LE(20), 1); // PCM
  assert.equal(wav.readUInt16LE(22), 1); // mono
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(28), 48000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});

test('decodificar: o WAV que o Gemini devolve volta ao PCM original, com a taxa', () => {
  const pcm = pcmOf(10, 20, 30, 40);
  const decoded = decodeGeminiAudio(pcmToWav(pcm, 22050), 'audio/wav');
  assert.deepEqual(decoded.pcm, pcm);
  assert.equal(decoded.sampleRate, 22050);
});

test('decodificar: PCM cru usa a taxa do tipo de mídia, ou 24000 se faltar', () => {
  const pcm = pcmOf(1, 2, 3);
  assert.equal(decodeGeminiAudio(pcm, 'audio/L16;codec=pcm;rate=16000').sampleRate, 16000);
  assert.equal(decodeGeminiAudio(pcm, 'audio/L16').sampleRate, 24000);
  assert.equal(decodeGeminiAudio(pcm, undefined).sampleRate, 24000);
  assert.deepEqual(decodeGeminiAudio(pcm, 'audio/L16;rate=24000').pcm, pcm);
});

test('decodificar: ignora blocos extras, tamanho de dados errado e byte sobrando', () => {
  const pcm = pcmOf(5, 6, 7);
  const wav = pcmToWav(pcm, 24000);
  // um bloco "LIST" entre o fmt e o data
  const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('abcd')]);
  const withExtra = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]);
  assert.deepEqual(decodeGeminiAudio(withExtra, 'audio/wav').pcm, pcm);

  // tamanho do "data" gravado como 0 (streaming): vale o que existe
  const streamed = Buffer.from(wav);
  streamed.writeUInt32LE(0, 40);
  assert.deepEqual(decodeGeminiAudio(streamed, 'audio/wav').pcm, pcm);

  // um byte a mais no fim quebraria o alinhamento das amostras
  assert.deepEqual(decodeGeminiAudio(Buffer.concat([pcm, Buffer.from([9])]), 'audio/L16').pcm, pcm);
});

test('decodificar: formato diferente do esperado e áudio vazio viram erro claro', () => {
  const stereo = pcmToWav(pcmOf(1, 2), 24000);
  stereo.writeUInt16LE(2, 22); // estéreo
  assert.throws(() => decodeGeminiAudio(stereo, 'audio/wav'), /Formato de áudio inesperado/);
  assert.throws(() => decodeGeminiAudio(Buffer.alloc(0), 'audio/wav'), /vazio/);
  const noData = pcmToWav(pcmOf(), 24000).subarray(0, 36);
  assert.throws(() => decodeGeminiAudio(noData, 'audio/wav'), /não tem dados/);
});

test('texto: curto segue inteiro, com espaços normalizados', () => {
  assert.deepEqual(splitForSpeech('  Olá,\n  mundo.  '), ['Olá, mundo.']);
  assert.deepEqual(splitForSpeech('   '), []);
});

test('texto: o longo é partido em fim de frase, sem passar do limite, e nada se perde', () => {
  const sentence = 'Esta é uma frase de teste com tamanho razoável para a leitura.';
  const text = Array.from({ length: 20 }, () => sentence).join(' ');
  const chunks = splitForSpeech(text, 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 200, `trecho de ${chunk.length} caracteres`);
    assert.ok(chunk.endsWith('.'), 'cada trecho termina em fim de frase');
  }
  assert.equal(chunks.join(' '), text);
});

test('texto: uma frase sozinha maior que o limite é cortada em espaço, sem perder palavras', () => {
  const words = Array.from({ length: 80 }, (_, i) => `palavra${i}`);
  const text = words.join(' ');
  const chunks = splitForSpeech(text, 100);
  for (const chunk of chunks) assert.ok(chunk.length <= 100);
  assert.deepEqual(chunks.join(' ').split(' '), words);
  // sem nenhum espaço: corta no limite mesmo assim
  const solid = 'x'.repeat(250);
  assert.deepEqual(splitForSpeech(solid, 100).map((c) => c.length), [100, 100, 50]);
});

test('PCM: juntar preserva a ordem', () => {
  assert.deepEqual(concatPcm([pcmOf(1), pcmOf(2, 3)]), pcmOf(1, 2, 3));
});

// ---------- cache ----------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tts-cache-test-'));
}
const key = (n: number) => n.toString(16).padStart(64, '0');

test('cache: guarda, devolve e sobrevive a uma reinicialização', () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 1_000_000);
    assert.equal(cache.get(key(1)), null);
    cache.set(key(1), Buffer.from('audio um'));
    assert.deepEqual(cache.get(key(1)), Buffer.from('audio um'));
    assert.equal(cache.count, 1);
    assert.equal(cache.sizeBytes, 8);

    const reopened = new AudioCache(dir, 1_000_000);
    assert.deepEqual(reopened.get(key(1)), Buffer.from('audio um'));
    assert.equal(reopened.sizeBytes, 8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: passou do limite, apaga o menos usado, não o último que entrou', async () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 30); // cabem 3 arquivos de 10 bytes
    const data = (c: string) => Buffer.alloc(10, c);
    cache.set(key(1), data('a'));
    await new Promise((r) => setTimeout(r, 5));
    cache.set(key(2), data('b'));
    await new Promise((r) => setTimeout(r, 5));
    cache.set(key(3), data('c'));
    await new Promise((r) => setTimeout(r, 5));
    cache.get(key(1)); // a 1 foi usada de novo: agora a mais antiga é a 2

    cache.set(key(4), data('d'));
    assert.equal(cache.get(key(2)), null, 'a menos usada saiu');
    assert.ok(cache.get(key(1)), 'a usada recentemente ficou');
    assert.ok(cache.get(key(3)));
    assert.ok(cache.get(key(4)), 'a que acabou de entrar nunca é apagada');
    assert.ok(cache.sizeBytes <= 30);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: um arquivo maior que o limite não é guardado, e nomes que não são hash são recusados', () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 10);
    cache.set(key(1), Buffer.alloc(11));
    assert.equal(cache.get(key(1)), null);
    assert.equal(cache.count, 0);

    for (const bad of ['../fora', 'abc', key(1) + '/..', '', 'G'.repeat(64)]) {
      cache.set(bad, Buffer.from('x'));
      assert.equal(cache.get(bad), null, `"${bad}" deveria ser recusado`);
    }
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(fs.existsSync(path.join(dir, '..', 'fora.wav')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: arquivo apagado por fora some do índice sem quebrar', () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 1000);
    cache.set(key(1), Buffer.from('x'));
    fs.rmSync(path.join(dir, `${key(1)}.wav`));
    assert.equal(cache.get(key(1)), null);
    assert.equal(cache.count, 0);
    assert.equal(cache.sizeBytes, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: ignora na leitura da pasta o que não é do cache', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'anotacao.txt'), 'não é meu');
    fs.writeFileSync(path.join(dir, 'abc.wav'), 'nome fora do padrão');
    fs.writeFileSync(path.join(dir, `${key(7)}.wav`), 'ok');
    const cache = new AudioCache(dir, 1000);
    assert.equal(cache.count, 1);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['abc.wav', 'anotacao.txt', `${key(7)}.wav`].sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: pasta padrão fica fora do projeto e o tamanho vem do ambiente', () => {
  assert.equal(defaultCacheDir({ TTS_CACHE_DIR: ' D:\\audios ' }), 'D:\\audios');
  assert.match(defaultCacheDir({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }), /BaseConcurseira[\\/]tts-cache$/);
  assert.match(defaultCacheDir({}), /base-concurseira[\\/]tts-cache$/);
  assert.equal(cacheMaxBytes({}), 1024 * 1024 * 1024);
  assert.equal(cacheMaxBytes({ TTS_CACHE_MAX_MB: '50' }), 50 * 1024 * 1024);
  assert.equal(cacheMaxBytes({ TTS_CACHE_MAX_MB: 'lixo' }), 1024 * 1024 * 1024);
  assert.equal(cacheMaxBytes({ TTS_CACHE_MAX_MB: '-3' }), 1024 * 1024 * 1024);
});

// ---------- sintetizador ----------

function fakeEngine(rate = 24000) {
  const calls: { text: string; voice: string }[] = [];
  const engine: SpeechEngine = async (text, voice) => {
    calls.push({ text, voice });
    await new Promise((r) => setTimeout(r, 15));
    return { pcm: pcmOf(text.length), sampleRate: rate };
  };
  return { engine, calls };
}

test('sintetizar: a primeira vez gera, as seguintes vêm do cache sem chamar o modelo', async () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 1_000_000);
    const { engine, calls } = fakeEngine();
    const first = await synthesizeSpeech('Olá, mundo.', 'Charon', 'modelo-x', engine, cache);
    assert.equal(first.fromCache, false);
    assert.equal(first.wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(calls.length, 1);

    const second = await synthesizeSpeech('Olá, mundo.', 'Charon', 'modelo-x', engine, cache);
    assert.equal(second.fromCache, true);
    assert.deepEqual(second.wav, first.wav);
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sintetizar: voz, modelo e texto diferentes não se misturam no cache', async () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 1_000_000);
    const { engine, calls } = fakeEngine();
    await synthesizeSpeech('mesmo texto', 'Charon', 'm1', engine, cache);
    await synthesizeSpeech('mesmo texto', 'Kore', 'm1', engine, cache);
    await synthesizeSpeech('mesmo texto', 'Charon', 'm2', engine, cache);
    await synthesizeSpeech('outro texto', 'Charon', 'm1', engine, cache);
    assert.equal(calls.length, 4);
    assert.equal(new Set([cacheKey('m1', 'Charon', 'a'), cacheKey('m1', 'Kore', 'a'), cacheKey('m2', 'Charon', 'a')]).size, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sintetizar: pedidos iguais ao mesmo tempo viram uma única chamada ao modelo', async () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 1_000_000);
    const { engine, calls } = fakeEngine();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => synthesizeSpeech('pedido repetido', 'Charon', 'm', engine, cache)),
    );
    assert.equal(calls.length, 1);
    for (const r of results) assert.deepEqual(r.wav, results[0].wav);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sintetizar: texto longo é gerado em trechos e emendado num WAV só', async () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 100_000_000);
    const { engine, calls } = fakeEngine();
    const sentence = 'Uma frase de teste que se repete bastante.';
    const text = Array.from({ length: 80 }, () => sentence).join(' '); // ~3.400 caracteres
    const { wav } = await synthesizeSpeech(text, 'Charon', 'm', engine, cache);
    assert.ok(calls.length >= 3, `esperava vários trechos, vieram ${calls.length}`);
    assert.equal(calls.map((c) => c.text).join(' '), text);
    // uma amostra por trecho no fake: o PCM final tem uma por chamada
    assert.equal(wav.readUInt32LE(40), calls.length * 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sintetizar: falha do modelo não deixa nada no cache, e a próxima tentativa refaz', async () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 1_000_000);
    let attempts = 0;
    const flaky: SpeechEngine = async (text) => {
      attempts++;
      if (attempts === 1) throw new Error('alta demanda');
      return { pcm: pcmOf(text.length), sampleRate: 24000 };
    };
    await assert.rejects(synthesizeSpeech('texto', 'Charon', 'm', flaky, cache), /alta demanda/);
    assert.equal(cache.count, 0);
    const retry = await synthesizeSpeech('texto', 'Charon', 'm', flaky, cache);
    assert.equal(retry.fromCache, false);
    assert.equal(cache.count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sintetizar: trechos em taxas de áudio diferentes e texto vazio viram erro', async () => {
  const dir = tmpDir();
  try {
    const cache = new AudioCache(dir, 100_000_000);
    let call = 0;
    const mixed: SpeechEngine = async (text) => ({ pcm: pcmOf(text.length), sampleRate: ++call === 1 ? 24000 : 16000 });
    const long = Array.from({ length: 80 }, () => 'Frase de teste repetida bastante.').join(' ');
    await assert.rejects(synthesizeSpeech(long, 'Charon', 'm', mixed, cache), /taxas de áudio diferentes/);

    const { engine } = fakeEngine();
    await assert.rejects(synthesizeSpeech('   ', 'Charon', 'm', engine, cache), /Não há texto/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
