import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchMarkdownError, MAX_MARKDOWN_SECTIONS, parseMatchMarkdown, suggestedCollectionName } from './matchMarkdown';

const FILE = `# Arrastar e soltar: Conceito de gerência de projetos

## 1. Projeto, programa, portfólio e operação
Dificuldade: Fácil

| Termo | Descrição |
|---|---|
| Projeto | Esforço temporário que gera um resultado único |
| Programa | Grupo de projetos relacionados, gerenciados de forma coordenada |
| Operação | Atividade contínua e repetitiva que mantém o negócio funcionando |

## 2. Papéis e estruturas no gerenciamento de projetos
Dificuldade: Médio

| Termo | Descrição |
|---|---|
| Patrocinador | Fornece recursos e apoio e autoriza o projeto |
| PMO (escritório de projetos) | Padroniza processos de governança |

## 3. Áreas de conhecimento
Dificuldade: Difícil

| Termo | Descrição |
|---|---|
| Escopo | Garante que o projeto inclua todo o trabalho necessário |
| Custos | Planeja, estima e controla o orçamento |
`;

const table = (...rows: string[]) => ['| Termo | Descrição |', '|---|---|', ...rows].join('\n');

function only(markdown: string) {
  const parsed = parseMatchMarkdown(markdown);
  return { ...parsed, card: parsed.cards[0], reason: parsed.rejected[0]?.reason };
}

test('lê o formato do arquivo: título sem o prefixo, numeração tirada, dificuldade e pares', () => {
  const parsed = parseMatchMarkdown(FILE);
  assert.equal(parsed.title, 'Conceito de gerência de projetos');
  assert.equal(parsed.sections, 3);
  assert.deepEqual(parsed.rejected, []);
  assert.deepEqual(
    parsed.cards.map((c) => [c.question, c.difficulty]),
    [
      ['Projeto, programa, portfólio e operação', 'facil'],
      ['Papéis e estruturas no gerenciamento de projetos', 'medio'],
      ['Áreas de conhecimento', 'dificil'],
    ],
  );
  assert.equal(
    parsed.cards[0].answer,
    [
      'Projeto::Esforço temporário que gera um resultado único',
      'Programa::Grupo de projetos relacionados, gerenciados de forma coordenada',
      'Operação::Atividade contínua e repetitiva que mantém o negócio funcionando',
    ].join('\n'),
  );
  assert.equal(parsed.cards[1].answer.split('\n')[1], 'PMO (escritório de projetos)::Padroniza processos de governança');
});

test('aceita CRLF, BOM, alinhamento nos traços e título sem o prefixo', () => {
  const crlf = `﻿# Redes\r\n\r\n## Camadas\r\n\r\n| Termo | Descrição |\r\n|:---|---:|\r\n| TCP | Transporte confiável |\r\n| UDP | Transporte sem conexão |\r\n`;
  const parsed = parseMatchMarkdown(crlf);
  assert.equal(parsed.title, 'Redes');
  assert.equal(parsed.rejected.length, 0);
  assert.equal(parsed.cards[0].answer, 'TCP::Transporte confiável\nUDP::Transporte sem conexão');
});

test('barra escrita como "\\|" fica dentro da célula; "::" dentro do termo vira ":"', () => {
  const { card, rejected } = only(`## Operadores\n${table('| a \\| b | lógico OU |', '| C++ std::vector | contêiner |')}`);
  assert.equal(rejected.length, 0);
  assert.equal(card.answer, 'a | b::lógico OU\nC++ std:vector::contêiner');
});

test('a descrição pode ter "::" e vai inteira para o cartão', () => {
  const { card } = only(`## IPv6\n${table('| IPv6 | 128 bits, escrito como a::b |', '| IPv4 | 32 bits |')}`);
  assert.equal(card.answer, 'IPv6::128 bits, escrito como a::b\nIPv4::32 bits');
});

test('uma seção que não serve fica de fora com o motivo, e as outras entram', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => `| termo ${i} | descrição ${i} |`);
  const parsed = parseMatchMarkdown(
    [
      `## Bom\n${table('| A | a |', '| B | b |')}`,
      `## Um par só\n${table('| A | a |')}`,
      `## Treze pares\n${table(...rows(13))}`,
      `## Repetido\n${table('| Redes | a |', '| redes | b |')}`,
      `## Descrição vazia\n${table('| A | a |', '| B |  |')}`,
      `## Três colunas\n${table('| A | a | x |', '| B | b | y |')}`,
      `## Sem tabela\nSó um texto.`,
      `## Duas tabelas\n${table('| A | a |', '| B | b |')}\n\ntexto\n\n${table('| C | c |', '| D | d |')}`,
      `## \n${table('| A | a |', '| B | b |')}`,
    ].join('\n\n'),
  );
  assert.deepEqual(parsed.cards.map((c) => c.question), ['Bom']);
  assert.equal(parsed.sections, 9);
  assert.deepEqual(
    parsed.rejected.map((r) => [r.title, r.reason]),
    [
      ['Um par só', 'Informe ao menos 2 pares (termo e descrição).'],
      ['Treze pares', 'Use no máximo 12 pares por cartão.'],
      ['Repetido', 'O termo "redes" aparece mais de uma vez.'],
      ['Descrição vazia', 'Cada par precisa ter um termo e uma descrição.'],
      ['Três colunas', 'Uma linha da tabela tem 3 colunas em vez de 2 ("A | a | x"). Para uma barra dentro do texto, escreva \\|.'],
      ['Sem tabela', 'Não há uma tabela "Termo | Descrição" nesta seção.'],
      ['Duas tabelas', 'Há mais de uma tabela nesta seção; use uma só por cartão.'],
      ['(sem título)', 'Informe o título do cartão.'],
    ],
  );
});

test('sem a linha de traços, só o cabeçalho "Termo" é descartado', () => {
  const withHeader = only('## A\n| Termo | Descrição |\n| X | x |\n| Y | y |');
  assert.equal(withHeader.card.answer, 'X::x\nY::y');
  const noHeader = only('## A\n| X | x |\n| Y | y |');
  assert.equal(noHeader.card.answer, 'X::x\nY::y');
});

test('dificuldade: aceita com ou sem acento e maiúsculas; ausente ou desconhecida vira médio', () => {
  const difficultyOf = (line: string) => only(`## A\n${line}\n${table('| X | x |', '| Y | y |')}`).card.difficulty;
  assert.equal(difficultyOf('dificuldade: FACIL'), 'facil');
  assert.equal(difficultyOf('Dificuldade:Difícil'), 'dificil');
  assert.equal(difficultyOf('Dificuldade: Médio'), 'medio');
  assert.equal(difficultyOf('Dificuldade: Extrema'), 'medio');
  assert.equal(difficultyOf(''), 'medio');
});

test('texto solto, subtítulos "###" e "#" dentro de bloco de código não viram cartão nem título', () => {
  const parsed = parseMatchMarkdown(
    ['Introdução solta.', '', '## A', 'Uma observação.', '### Detalhe', '```', '# não é título', '```', table('| X | x |', '| Y | y |')].join('\n'),
  );
  assert.equal(parsed.title, '');
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].question, 'A');
});

test('arquivo sem nenhuma seção "##" é recusado inteiro, com a explicação do formato', () => {
  assert.throws(() => parseMatchMarkdown('# Só um título\n\ntexto'), (err: unknown) => err instanceof MatchMarkdownError && /## /.test(err.message));
  assert.throws(() => parseMatchMarkdown(''), MatchMarkdownError);
});

test('arquivo com seções demais é recusado', () => {
  const many = Array.from({ length: MAX_MARKDOWN_SECTIONS + 1 }, (_, i) => `## C${i}`).join('\n');
  assert.throws(() => parseMatchMarkdown(many), (err: unknown) => err instanceof MatchMarkdownError && /máximo/.test(err.message));
});

test('o nome sugerido da coleção: título do arquivo ou o nome do arquivo', () => {
  assert.equal(suggestedCollectionName('Conceito de gerência', 'x.md'), 'Conceito de gerência');
  assert.equal(suggestedCollectionName('', 'arrastar_conceito_gerencia.md'), 'Arrastar conceito gerencia');
  assert.equal(suggestedCollectionName('', '.md'), 'Arrastar e soltar');
  assert.equal(suggestedCollectionName('x'.repeat(200), 'a.md').length, 120);
});
