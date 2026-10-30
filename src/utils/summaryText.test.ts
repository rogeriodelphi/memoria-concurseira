import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDocument } from 'htmlparser2';

import type { PNode } from './pasteHtml';
import { summaryTitleFromText, treeToText } from './summaryText';

// O htmlparser2 faz o papel do DOMParser do navegador: o mesmo HTML do editor passa pelo conversor, sem precisar de DOM.
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

const toText = (html: string) =>
  treeToText({ nodeType: 9, nodeName: '#document', nodeValue: null, childNodes: parseDocument(html).children.map(adapt) });

test('cada linha do editor (div) vira uma linha, e a linha em branco é um respiro entre parágrafos', () => {
  assert.equal(toText('<div>Conceito</div><div>Primeira linha</div><div><br></div><div>Segunda</div>'), 'Conceito\nPrimeira linha\n\nSegunda');
});

test('quebras de linha (br) dentro do texto viram quebras de verdade, e respiros seguidos viram um só', () => {
  assert.equal(toText('um<br>dois<br><br><br><br>três'), 'um\ndois\n\ntrês');
});

test('texto sem nenhuma marcação passa como veio, com os espaços e quebras do HTML colapsados', () => {
  assert.equal(toText('  uma   frase\n  quebrada  no HTML '), 'uma frase quebrada no HTML');
  assert.equal(toText('a&nbsp;&nbsp;b'), 'a b');
});

test('negrito (b, strong e o estilo que os botões do editor gravam) vira **texto**', () => {
  assert.equal(toText('<div><b>Conceito</b></div>'), '**Conceito**');
  assert.equal(toText('<div>o <strong>RDP</strong> usa a porta</div>'), 'o **RDP** usa a porta');
  assert.equal(toText('<div>porta <span style="font-weight: bold;">3389</span> em TCP</div>'), 'porta **3389** em TCP');
  assert.equal(toText('<div>tudo <span style="font-weight: 700">forte</span></div>'), 'tudo **forte**');
});

test('o que não é negrito fica sem marca: itálico, sublinhado, cor, realce e o "normal" do Google Docs', () => {
  assert.equal(toText('<div><i>a</i> <u>b</u> <span style="color: rgb(220, 38, 38)">c</span> <span style="background-color: #fef08a">d</span></div>'), 'a b c d');
  assert.equal(toText('<div><b style="font-weight:normal">texto normal</b></div>'), 'texto normal');
});

test('negrito dentro de negrito não vira ****, e os espaços ficam fora dos asteriscos', () => {
  assert.equal(toText('<div><b>um <b>dois</b> três</b></div>'), '**um dois três**');
  assert.equal(toText('<div>antes<b> meio </b>depois</div>'), 'antes **meio** depois');
  assert.equal(toText('<div>a <b>x</b> b <b>y</b> c</div>'), 'a **x** b **y** c');
});

test('um negrito vazio some, e um que atravessa uma quebra de linha perde a marca', () => {
  assert.equal(toText('<div>a<b> </b>b</div>'), 'a b');
  assert.equal(toText('<div><b>linha um<br>linha dois</b></div>'), 'linha um\nlinha dois');
});

test('lista com marcadores vira "- ", a numerada vira "1. ", e a de dentro tem recuo', () => {
  assert.equal(toText('<ul><li>um</li><li>dois</li></ul>'), '- um\n- dois');
  assert.equal(toText('<ol><li>primeiro</li><li>segundo</li><li>terceiro</li></ol>'), '1. primeiro\n2. segundo\n3. terceiro');
  assert.equal(toText('<ul><li>pai<ul><li>filho</li><li>outro</li></ul></li><li>irmão</li></ul>'), '- pai\n  - filho\n  - outro\n- irmão');
  assert.equal(toText('<ol><li>passo<ul><li>detalhe</li></ul></li></ol>'), '1. passo\n  - detalhe');
});

test('item de lista com negrito, item vazio (some) e texto antes e depois da lista', () => {
  assert.equal(toText('<div>Portas:</div><ul><li><b>RDP</b>: 3389</li><li></li><li>SSH: 22</li></ul><div>Fim</div>'), 'Portas:\n- **RDP**: 3389\n- SSH: 22\nFim');
});

test('imagem fica de fora, e só marcação (sem nenhuma palavra) dá texto vazio', () => {
  assert.equal(toText('<div>antes</div><div><img src="data:image/png;base64,AAAA" alt=""></div><div>depois</div>'), 'antes\ndepois');
  assert.equal(toText('<div><br></div><div></div>'), '');
  assert.equal(toText(''), '');
});

test('o texto colado de um chat de IA (o caso da tela de resumos) sai com a estrutura', () => {
  const html =
    '<div><b>Resumo: Terminal Services / RDS</b></div><div><br></div>' +
    '<div><b>Conceito</b></div>' +
    '<div>Terminal Services hoje se chama Remote Desktop Services (RDS). O nome mudou a partir do Windows Server 2008 R2.</div>' +
    '<div><b>Protocolo:</b> RDP, porta 3389 em TCP e UDP.</div>' +
    '<ul><li>Chave: HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server</li></ul>';
  assert.equal(
    toText(html),
    '**Resumo: Terminal Services / RDS**\n\n**Conceito**\n' +
      'Terminal Services hoje se chama Remote Desktop Services (RDS). O nome mudou a partir do Windows Server 2008 R2.\n' +
      '**Protocolo:** RDP, porta 3389 em TCP e UDP.\n' +
      '- Chave: HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server',
  );
});

test('o título de um resumo escrito à mão é a primeira linha, sem negrito nem marcador', () => {
  assert.equal(summaryTitleFromText('**Resumo: Terminal Services / RDS**\n\n**Conceito**\nTexto'), 'Resumo: Terminal Services / RDS');
  assert.equal(summaryTitleFromText('\n\n- item de lista\noutro'), 'item de lista');
  assert.equal(summaryTitleFromText('1. Primeiro passo\n2. Segundo'), 'Primeiro passo');
  assert.equal(summaryTitleFromText('muito   espaço    aqui'), 'muito espaço aqui');
});

test('o título tem tamanho de título: corta na última palavra inteira e marca o corte', () => {
  const long = 'palavra '.repeat(40).trim();
  const title = summaryTitleFromText(long);
  assert.ok(title.length <= 121, `tamanho ${title.length}`);
  assert.ok(title.endsWith('palavra…'), title);
  assert.equal(summaryTitleFromText('x'.repeat(300)).length, 121); // sem espaço para cortar: corta seco
});

test('sem nenhuma linha com texto, o título é "Resumo"', () => {
  assert.equal(summaryTitleFromText(''), 'Resumo');
  assert.equal(summaryTitleFromText('\n  \n'), 'Resumo');
  assert.equal(summaryTitleFromText('****'), 'Resumo');
});
