import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';

import { buildFlashcardsPdf, type PdfFlashcard } from './pdf';
import { parseImageDataUri, toPdfBlocks } from './pdfContent';

// PNG de cor sólida gerado na hora: dá imagens de qualquer tamanho sem
// depender de arquivos de teste.
function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits por canal
  header[9] = 2; // RGB
  const rowSize = width * 3 + 1; // +1: o byte de filtro de cada linha
  const raw = Buffer.alloc(rowSize * height, 0x7f);
  for (let y = 0; y < height; y++) raw[y * rowSize] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pngUri = (width = 40, height = 20) => `data:image/png;base64,${makePng(width, height).toString('base64')}`;

const countIn = (buffer: Buffer, pattern: RegExp) => buffer.toString('latin1').match(pattern)?.length ?? 0;
const imageObjects = (pdf: Buffer) => countIn(pdf, /\/Subtype \/Image/g);
const pages = (pdf: Buffer) => countIn(pdf, /\/Type \/Page(?!s)/g);

const card = (question: string, answer: string, format = 'html'): PdfFlashcard => ({
  question,
  answer,
  format,
  difficulty: 'medio',
});

test('texto simples vira um único bloco de texto', () => {
  assert.deepEqual(toPdfBlocks('Olá & <b>mundo</b>', 'plain'), [{ type: 'text', text: 'Olá & <b>mundo</b>' }]);
  assert.deepEqual(toPdfBlocks('   ', 'plain'), []);
});

test('html: quebras de bloco, listas e entidades', () => {
  const blocks = toPdfBlocks('<div>Linha 1</div><div>Linha 2<br>Linha 3</div><ul><li>a</li><li>b</li></ul>', 'html');
  assert.deepEqual(blocks, [{ type: 'text', text: 'Linha 1\nLinha 2\nLinha 3\n• a\n• b' }]);
});

test('html: um "&lt;" digitado pelo usuário não vira "<"', () => {
  // o usuário digitou o texto literal &lt; — guardado como &amp;lt;
  assert.deepEqual(toPdfBlocks('<div>a &amp;lt; b &amp; c &lt; d</div>', 'html'), [
    { type: 'text', text: 'a &lt; b & c < d' },
  ]);
});

test('html: texto e imagens saem na ordem em que aparecem', () => {
  const blocks = toPdfBlocks(`<div>antes</div><div><img src="${pngUri()}"></div><div>depois</div>`, 'html');
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { type: 'text', text: 'antes' });
  assert.equal(blocks[1].type, 'image');
  assert.deepEqual(blocks[2], { type: 'text', text: 'depois' });
});

test('html: imagem sozinha não gera texto vazio', () => {
  const blocks = toPdfBlocks(`<div><img src="${pngUri()}"></div>`, 'html');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'image');
});

test('html: o alinhamento da imagem segue as margens, como na tela', () => {
  const align = (style: string) => {
    const [block] = toPdfBlocks(`<img src="${pngUri()}" style="${style}">`, 'html');
    return block.type === 'image' ? block.align : null;
  };
  assert.equal(align('display:block;margin-left:auto;margin-right:auto'), 'center');
  assert.equal(align('display:block;margin-left:auto;margin-right:0'), 'right');
  assert.equal(align('text-align:center'), 'left'); // o text-align da própria <img> não faz nada
  const [plain] = toPdfBlocks(`<img src="${pngUri()}">`, 'html');
  assert.equal(plain.type === 'image' && plain.align, 'left');
});

test('só PNG e JPEG embutidos são aceitos como imagem', () => {
  const b64 = makePng(4, 4).toString('base64');
  assert.ok(parseImageDataUri(`data:image/png;base64,${b64}`));
  assert.ok(parseImageDataUri(`data:image/jpeg;base64,${b64}`));
  assert.ok(parseImageDataUri(`data:image/jpg;base64,${b64}`));
  assert.equal(parseImageDataUri(`data:image/gif;base64,${b64}`), null);
  assert.equal(parseImageDataUri(`data:image/webp;base64,${b64}`), null);
  assert.equal(parseImageDataUri(`data:image/svg+xml;base64,${b64}`), null);
  assert.equal(parseImageDataUri('https://example.com/a.png'), null);
  assert.equal(parseImageDataUri('data:image/png;base64,'), null);
  assert.equal(parseImageDataUri(''), null);
});

test('o PDF inclui a imagem do cartão', async () => {
  const pdf = await buildFlashcardsPdf('Coleção', [
    card('Pergunta', `<div>Texto da resposta</div><div><img src="${pngUri(120, 80)}"></div>`),
  ]);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(imageObjects(pdf), 1);
});

test('imagem na pergunta, centralizada e à direita', async () => {
  const pdf = await buildFlashcardsPdf('Coleção', [
    card(
      `<img src="${pngUri()}" style="display:block;margin-left:auto;margin-right:auto">`,
      `<img src="${pngUri()}" style="display:block;margin-left:auto;margin-right:0">`,
    ),
  ]);
  assert.equal(imageObjects(pdf), 2);
});

test('imagem fora do que dá para incluir não derruba o PDF', async () => {
  const garbage = `data:image/png;base64,${Buffer.from('isto não é uma imagem').toString('base64')}`;
  const pdf = await buildFlashcardsPdf('Coleção', [
    card(
      'Pergunta',
      [
        `<img src="data:image/gif;base64,${makePng(4, 4).toString('base64')}">`, // formato não suportado
        '<img src="https://example.com/a.png">', // externa: nunca é buscada
        `<img src="${garbage}">`, // PNG corrompido
        `<img src="${pngUri()}">`, // esta entra
      ].join(''),
    ),
  ]);
  assert.equal(imageObjects(pdf), 1);
});

test('cartão em texto simples continua saindo normalmente', async () => {
  const pdf = await buildFlashcardsPdf('Coleção', [card('Pergunta <b>?', 'Resposta & mais', 'plain')]);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(imageObjects(pdf), 0);
});

test('imagens grandes são reduzidas e passam para a página seguinte quando não cabem', async () => {
  const big = pngUri(400, 500); // ~300 x 375 pt
  const rows = [1, 2, 3].map((n) => card(`Pergunta ${n}`, `<img src="${big}">`));
  const pdf = await buildFlashcardsPdf('Coleção', rows);
  assert.equal(imageObjects(pdf), 3);
  assert.ok(pages(pdf) >= 2, `esperava 2+ páginas, veio ${pages(pdf)}`);

  // uma imagem maior que a página inteira também precisa caber
  const huge = await buildFlashcardsPdf('Coleção', [card('P', `<img src="${pngUri(3000, 6000)}">`)]);
  assert.equal(imageObjects(huge), 1);
  assert.equal(pages(huge), 1);
});
