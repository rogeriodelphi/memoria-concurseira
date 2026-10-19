import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDocument } from 'htmlparser2';

import { convertPastedTree, isLinkBlue, isVivid, keepsLineBreaks, marksFromStyle, parseColor, parseInlineStyle, type PNode } from './pasteHtml';

// O htmlparser2 faz o papel do DOMParser do navegador: o mesmo HTML real passa pelo conversor, sem precisar de DOM.
type Raw = ReturnType<typeof parseDocument>['children'][number];

function adapt(node: Raw): PNode {
  if (node.type === 'text') return { nodeType: 3, nodeName: '#text', nodeValue: (node as unknown as { data: string }).data, childNodes: [] };
  if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
    const el = node as unknown as { name: string; attribs: Record<string, string>; children: Raw[] };
    return {
      nodeType: 1,
      nodeName: el.name.toUpperCase(),
      nodeValue: null,
      childNodes: el.children.map(adapt),
      getAttribute: (name) => el.attribs[name] ?? null,
      hasAttribute: (name) => name in el.attribs,
    };
  }
  return { nodeType: 8, nodeName: '#comment', nodeValue: null, childNodes: [] };
}

const convert = (html: string) => convertPastedTree({ nodeType: 9, nodeName: '#document', nodeValue: null, childNodes: parseDocument(html).children.map(adapt) });

test('parseInlineStyle lê as declarações, ignora o que não é declaração e tira o !important', () => {
  assert.deepEqual(parseInlineStyle('Font-Weight: BOLD; color: red !important;; lixo; : x'), { 'font-weight': 'bold', color: 'red' });
  assert.deepEqual(parseInlineStyle(null), {});
  assert.deepEqual(parseInlineStyle(''), {});
});

test('marksFromStyle liga e desliga as marcas pelo estilo', () => {
  assert.deepEqual(marksFromStyle(parseInlineStyle('font-weight: 700; font-style: italic; text-decoration: underline')), { bold: true, italic: true, underline: true });
  assert.deepEqual(marksFromStyle(parseInlineStyle('font-weight: normal; font-style: normal; text-decoration: none')), { bold: false, italic: false, underline: false });
  assert.deepEqual(marksFromStyle(parseInlineStyle('font-weight: 400')), { bold: false });
  assert.deepEqual(marksFromStyle(parseInlineStyle('vertical-align: super')), { sup: true, sub: false });
  assert.deepEqual(marksFromStyle(parseInlineStyle('vertical-align: sub')), { sup: false, sub: true });
  assert.deepEqual(marksFromStyle(parseInlineStyle('color: windowtext')), {});
});

test('parseColor lê hex e rgb(a) e recusa o resto', () => {
  assert.deepEqual(parseColor('#e8761e'), [232, 118, 30]);
  assert.deepEqual(parseColor('#f70'), [255, 119, 0]);
  assert.deepEqual(parseColor('rgb(232, 118, 30)'), [232, 118, 30]);
  assert.deepEqual(parseColor('rgb(232 118 30)'), [232, 118, 30]);
  assert.deepEqual(parseColor('rgba(232, 118, 30, 1)'), [232, 118, 30]);
  assert.equal(parseColor('rgba(232, 118, 30, 0.5)'), null, 'transparência');
  assert.equal(parseColor('rgba(0, 0, 0, 0)'), null, 'transparente');
  assert.equal(parseColor('rgb(300, 0, 0)'), null, 'canal fora de 0-255');
  assert.equal(parseColor('windowtext'), null);
  assert.equal(parseColor('currentcolor'), null);
  assert.equal(parseColor('inherit'), null);
  assert.equal(parseColor('var(--brand)'), null, 'variável sem valor reserva');
  assert.equal(parseColor('#12345'), null);
});

test('parseColor entende nome de cor, hsl, rgb com %, hex com alfa e var() com valor reserva', () => {
  assert.deepEqual(parseColor('orange'), [255, 165, 0]);
  assert.deepEqual(parseColor('darkorange'), [255, 140, 0]);
  assert.deepEqual(parseColor('hsl(28, 80%, 52%)'), [231, 126, 35]);
  assert.deepEqual(parseColor('hsl(28deg 80% 52% / 1)'), [231, 126, 35]);
  assert.equal(parseColor('hsla(28, 80%, 52%, 0.4)'), null, 'transparência');
  assert.deepEqual(parseColor('rgb(100% 50% 0%)'), [255, 128, 0]);
  assert.deepEqual(parseColor('rgb(238 133 35 / 100%)'), [238, 133, 35]);
  assert.equal(parseColor('rgb(238 133 35 / 50%)'), null);
  assert.deepEqual(parseColor('#ee8523ff'), [238, 133, 35]);
  assert.deepEqual(parseColor('#f70f'), [255, 119, 0]);
  assert.equal(parseColor('#ee852380'), null, 'hex com transparência');
  assert.deepEqual(parseColor('var(--brand, #ee8523)'), [238, 133, 35]);
  assert.deepEqual(parseColor('var(--brand, rgb(238, 133, 35))'), [238, 133, 35]);
});

test('isLinkBlue só pega o azul de link', () => {
  assert.equal(isLinkBlue([0, 0, 238]), true, 'azul padrão do navegador');
  assert.equal(isLinkBlue([37, 99, 235]), true);
  assert.equal(isLinkBlue([0, 116, 204]), true);
  assert.equal(isLinkBlue([238, 133, 35]), false, 'laranja');
  assert.equal(isLinkBlue([220, 38, 38]), false, 'vermelho');
  assert.equal(isLinkBlue([22, 163, 74]), false, 'verde');
  assert.equal(isLinkBlue([128, 128, 128]), false, 'cinza');
});

test('isVivid separa a cor escolhida do preto, cinza e branco do tema', () => {
  assert.equal(isVivid([232, 118, 30]), true, 'laranja');
  assert.equal(isVivid([37, 99, 235]), true, 'azul');
  assert.equal(isVivid([220, 38, 38]), true, 'vermelho');
  for (const neutral of [[0, 0, 0], [255, 255, 255], [55, 65, 81], [31, 41, 55], [128, 128, 128], [51, 51, 51]] as [number, number, number][]) {
    assert.equal(isVivid(neutral), false, neutral.join(','));
  }
});

test('marksFromStyle guarda só a cor viva, já no formato do editor', () => {
  assert.deepEqual(marksFromStyle(parseInlineStyle('color: #E8761E; background-color: rgb(255, 255, 0)')), { color: 'rgb(232, 118, 30)', highlight: 'rgb(255, 255, 0)' });
  assert.deepEqual(marksFromStyle(parseInlineStyle('color: rgb(55, 65, 81); background-color: #fff')), {});
});

test('keepsLineBreaks reconhece os white-space que preservam as quebras', () => {
  for (const value of ['pre', 'pre-wrap', 'pre-line']) assert.equal(keepsLineBreaks({ 'white-space': value }), true, value);
  assert.equal(keepsLineBreaks({ 'white-space': 'normal' }), false);
  assert.equal(keepsLineBreaks({}), false);
});

test('negrito, itálico e sublinhado por tag viram as mesmas tags do editor', () => {
  assert.equal(convert('<p>Isto é <strong>muito</strong> <em>importante</em> e <u>sublinhado</u>.</p>'), 'Isto é <b>muito</b> <i>importante</i> e <u>sublinhado</u>.');
});

test('negrito, itálico, sobrescrito e subscrito por estilo (como o Word e o Google Docs mandam)', () => {
  assert.equal(
    convert('<p>H<span style="vertical-align:sub">2</span>O, x<span style="vertical-align: super">2</span>, <span style="font-weight:700">forte</span> e <span style="font-style:italic">torto</span></p>'),
    'H<sub>2</sub>O, x<sup>2</sup>, <b>forte</b> e <i>torto</i>',
  );
});

test('o Google Docs embrulha tudo num <b font-weight:normal>, que não é negrito', () => {
  const html = '<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700">Título</span></p><p dir="ltr"><span>Corpo</span></p></b>';
  assert.equal(convert(html), '<div><b>Título</b></div><div><br></div><div>Corpo</div>');
});

test('cor, fonte, link e tamanho não vêm: só o texto', () => {
  assert.equal(
    convert('<span style="color:#333;font-family:Arial;font-size:18px;background-color:#fff">Veja <a href="https://x.com/a" style="text-decoration:underline">este link</a> agora</span>'),
    'Veja este link agora',
  );
});

test('a palavra destacada em laranja e negrito mantém a cor e o negrito', () => {
  assert.equal(
    convert('<p>a <strong style="color: rgb(232, 118, 30); font-weight: 700;">disponibilidade</strong> e a <span style="color:#e8761e"><b>resiliência</b></span>.</p>'),
    'a <span style="color: rgb(232, 118, 30)"><b>disponibilidade</b></span> e a <span style="color: rgb(232, 118, 30)"><b>resiliência</b></span>.',
  );
});

test('a cor vale para o que está dentro, sem repetir o <span>', () => {
  assert.equal(convert('<span style="color:#e8761e">um <b>dois</b> <i>três</i></span>'), '<span style="color: rgb(232, 118, 30)">um <b>dois</b> <i>três</i></span>');
});

test('cor neutra, cor de link e fundo cinza ou de bloco não vêm; o realce vivo de um trecho vem', () => {
  assert.equal(convert('<span style="color:#111827;background-color:#f3f4f6">texto</span>'), 'texto');
  assert.equal(convert('<a href="https://x.com" style="color:rgb(37,99,235);text-decoration:underline">link</a>'), 'link');
  assert.equal(convert('<p style="background-color: rgb(255, 0, 0)">bloco</p>'), 'bloco');
  assert.equal(convert('<span style="background-color: rgb(254, 240, 138)">marcado</span>'), '<span style="background-color: rgb(254, 240, 138)">marcado</span>');
});

test('as outras formas de escrever a cor também chegam: <font color>, nome, hsl, var() com valor reserva', () => {
  const orange = 'color: rgb(238, 133, 35)';
  assert.equal(convert('<font color="#ee8523"><b>falhas</b></font>'), `<span style="${orange}"><b>falhas</b></span>`);
  assert.equal(convert('<font color="#333333" face="Arial" size="3">neutro</font>'), 'neutro');
  assert.equal(convert('<b style="color: darkorange">nome</b>'), '<span style="color: rgb(255, 140, 0)"><b>nome</b></span>');
  assert.equal(convert('<span style="color: hsl(28, 80%, 52%)">hsl</span>'), '<span style="color: rgb(231, 126, 35)">hsl</span>');
  assert.equal(convert('<span style="color: var(--brand, #ee8523)">var</span>'), `<span style="${orange}">var</span>`);
  assert.equal(convert('<span style="color: var(--brand)">sem valor</span>'), 'sem valor');
});

test('o estilo vence o atributo color do <font>', () => {
  assert.equal(convert('<font color="#ee8523" style="color:#16a34a">x</font>'), '<span style="color: rgb(22, 163, 74)">x</span>');
});

test('link: some o sublinhado e o azul de link, mas uma cor de destaque (laranja) fica', () => {
  assert.equal(convert('<a href="#" style="color: rgb(0, 0, 238); text-decoration: underline">azul</a>'), 'azul');
  assert.equal(convert('<a href="#" style="color: rgb(238, 133, 35); text-decoration: underline"><strong>laranja</strong></a>'), '<span style="color: rgb(238, 133, 35)"><b>laranja</b></span>');
});

test('um texto como o do exemplo: negrito sublinhado, termos em laranja, parágrafos e lista', () => {
  const html =
    '<p>O <strong><u>cluster de failover</u></strong> é uma estratégia para garantir a <strong style="color:rgb(232,118,30)">disponibilidade</strong>.</p>' +
    '<p>No caso de clusters ímpares, o modelo é o <strong style="color:rgb(232,118,30)">Node Majority</strong>:</p>' +
    '<ul><li>Cada nó do cluster possui um voto.</li><li>Mais da metade dos votos devem estar presentes.</li></ul>';
  assert.equal(
    convert(html),
    '<div>O <b><u>cluster de failover</u></b> é uma estratégia para garantir a <span style="color: rgb(232, 118, 30)"><b>disponibilidade</b></span>.</div><div><br></div>' +
      '<div>No caso de clusters ímpares, o modelo é o <span style="color: rgb(232, 118, 30)"><b>Node Majority</b></span>:</div><div><br></div>' +
      '<ul><li>Cada nó do cluster possui um voto.</li><li>Mais da metade dos votos devem estar presentes.</li></ul>',
  );
});

test('parágrafos ficam em linhas separadas por um respiro, e o respiro das pontas some', () => {
  assert.equal(convert('<p>Primeiro</p><p>Segundo</p><p>Terceiro</p>'), '<div>Primeiro</div><div><br></div><div>Segundo</div><div><br></div><div>Terceiro</div>');
});

test('uma linha só não leva <div>: colada no meio de uma frase, não parte a linha', () => {
  assert.equal(convert('<span style="color:#111827">só um trecho</span>'), 'só um trecho');
  assert.equal(convert('<p>só um trecho</p>'), 'só um trecho');
});

test('texto corrido mantém um espaço nas pontas (duplo clique no Windows seleciona a palavra e o espaço)', () => {
  assert.equal(convert('<span style="color:#111827">meio </span>'), 'meio ');
  assert.equal(convert(' meio'), ' meio');
  assert.equal(convert('   várias   palavras   '), ' várias palavras ');
  assert.equal(convert('<b>negrito </b>'), '<b>negrito </b>');
  assert.equal(convert('<br>só<br>'), 'só');
  assert.equal(convert('   '), '');
});

test('título vira linha em negrito', () => {
  assert.equal(convert('<h2>Quórum</h2><p>O quórum define o mínimo.</p>'), '<div><b>Quórum</b></div><div><br></div><div>O quórum define o mínimo.</div>');
});

test('listas com marcadores e numeradas, e o texto do item fica na linha do marcador', () => {
  assert.equal(convert('<ul><li>Cada nó tem um voto</li><li>Mais da metade <b>vota</b></li></ul>'), '<ul><li>Cada nó tem um voto</li><li>Mais da metade <b>vota</b></li></ul>');
  assert.equal(convert('<ol><li><p>Um</p></li><li><p>Dois</p></li></ol>'), '<ol><li>Um</li><li>Dois</li></ol>');
});

test('lista dentro de lista e lista entre parágrafos', () => {
  assert.equal(
    convert('<p>Regras:</p><ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul><p>Fim</p>'),
    '<div>Regras:</div><div><br></div><ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul><div>Fim</div>',
  );
});

test('item de lista vazio some', () => {
  assert.equal(convert('<ul><li> </li><li>Real</li></ul>'), '<ul><li>Real</li></ul>');
  assert.equal(convert('<ul><li></li></ul>'), '');
});

test('<br> vira quebra de linha, e as de ponta somem', () => {
  assert.equal(convert('<p>linha 1<br>linha 2<br></p>'), 'linha 1<br>linha 2');
});

test('texto com <, > e & sai escapado', () => {
  assert.equal(convert('<p>a &lt; b &amp;&amp; c &gt; d</p>'), 'a &lt; b &amp;&amp; c &gt; d');
  // um "<script>" digitado como texto continua texto
  assert.equal(convert('<p>use &lt;script&gt;alert(1)&lt;/script&gt;</p>'), 'use &lt;script&gt;alert(1)&lt;/script&gt;');
});

test('script, estilo, imagem, botão, comentário e o que está escondido ficam de fora', () => {
  const html =
    '<!--StartFragment--><style>p{color:red}</style><script>alert(1)</script><p>Texto</p><img src="https://x.com/a.png"><button>Clique</button>' +
    '<p style="display:none">oculto</p><p hidden>também</p><svg><text>desenho</text></svg><!--EndFragment-->';
  assert.equal(convert(html), 'Texto');
});

test('espaços e quebras de linha do código-fonte do HTML são colapsados', () => {
  assert.equal(convert('<p>uma\n    frase   com\t\tespaços</p>'), 'uma frase com espaços');
});

test('<pre> e white-space:pre mantêm as quebras de linha (código, VS Code)', () => {
  assert.equal(convert('<pre>linha 1\nlinha 2</pre>'), 'linha 1<br>linha 2');
  assert.equal(convert('<div style="white-space:pre">a\nb</div>'), 'a<br>b');
});

test('tabela: cada linha vira uma linha de texto, com as células separadas por " | "', () => {
  assert.equal(
    convert('<table><thead><tr><th>Modelo</th><th>Quórum</th></tr></thead><tbody><tr><td>Node Majority</td><td>Mais da metade</td></tr></tbody></table>'),
    '<div><b>Modelo</b> | <b>Quórum</b></div><div>Node Majority | Mais da metade</div>',
  );
});

test('marca num bloco inteiro vale para as linhas dele, sem repetir a tag dentro', () => {
  assert.equal(convert('<div style="font-weight:bold"><p>Um</p><p>Dois <b>três</b></p></div>'), '<div><b>Um</b></div><div><br></div><div><b>Dois três</b></div>');
});

test('texto solto entre blocos forma a sua própria linha', () => {
  assert.equal(convert('<div>solto<p>parágrafo</p>depois</div>'), '<div>solto</div><div>parágrafo</div><div><br></div><div>depois</div>');
});

test('sem texto aproveitável devolve vazio (quem cola usa o texto simples)', () => {
  assert.equal(convert(''), '');
  assert.equal(convert('<p>   </p><img src="x">'), '');
  assert.equal(convert('<meta charset="utf-8">'), '');
});

test('a saída só usa as tags que o sanitizador do servidor aceita', () => {
  const html =
    '<article><h1>T</h1><p>a <b>b</b> <i>c</i> <u>d</u> x<sup>2</sup> y<sub>1</sub> <a href="#">l</a> <code>k</code></p><ul><li>i</li></ul><ol><li>j</li></ol>' +
    '<table><tr><td>m</td></tr></table><blockquote>q</blockquote><pre>p\nq</pre></article>';
  const tags = new Set([...convert(html).matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]));
  const allowed = new Set(['b', 'strong', 'i', 'em', 'u', 'sup', 'sub', 'p', 'div', 'span', 'br', 'ul', 'ol', 'li', 'img']);
  for (const tag of tags) assert.ok(allowed.has(tag), `tag fora da lista: ${tag}`);
});
