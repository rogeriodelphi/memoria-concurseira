import sanitizeHtml from 'sanitize-html';

const HEX_OR_RGB = [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/];

/**
 * Allow-list bem estreita de propósito: o editor de texto rico só produz um
 * conjunto fixo e conhecido de marcação — qualquer coisa fora disso (script,
 * iframe, atributos como onclick etc.) é de um paste malicioso ou de uma
 * origem que não é o nosso próprio editor, então é removida.
 *
 * Com `styleWithCSS` ligado no editor (necessário pra evitar que o Chrome
 * produza `<font color="...">`, fora da allow-list), praticamente todo
 * comando — negrito, itálico, sublinhado, sobrescrito/subscrito, cor — sai
 * como `<span style="...">` em vez de tag semântica. As tags b/i/u/sup/sub
 * continuam permitidas mesmo assim, como fallback tolerante pra conteúdo
 * colado de outro lugar.
 */
export function sanitizeFlashcardHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['b', 'strong', 'i', 'em', 'u', 'sup', 'sub', 'p', 'div', 'span', 'br', 'ul', 'ol', 'li', 'img'],
    allowedAttributes: {
      '*': ['style'],
      img: ['src', 'alt'],
    },
    // `data:` é bloqueado por padrão pelo sanitize-html (pensado pra href
    // de link, onde um data:text/html seria perigoso) — mas em <img src>
    // o navegador só tenta decodificar como imagem, nunca executa como
    // HTML/script, e é assim que o editor embute as imagens coladas/
    // enviadas (sem precisar de um servidor de arquivos). Restrito só à
    // tag img, então não afeta nenhuma outra tag com atributo de URL.
    allowedSchemesByTag: {
      img: ['data', 'http', 'https'],
    },
    allowedStyles: {
      '*': {
        'text-align': [/^left$/, /^center$/, /^right$/, /^justify$/],
        'font-weight': [/^bold$/, /^normal$/, /^\d{3}$/],
        'font-style': [/^italic$/, /^normal$/],
        'text-decoration-line': [/^underline$/, /^none$/],
        'vertical-align': [/^super$/, /^sub$/, /^baseline$/],
        color: HEX_OR_RGB,
        'background-color': HEX_OR_RGB,
      },
      // Alinhamento de imagem: o editor centraliza/encosta à direita uma <img>
      // (que é um bloco) pelas margens dela. Só esses valores exatos — nada de
      // medidas livres nem de outros `display`.
      img: {
        display: [/^block$/],
        'margin-left': [/^auto$/, /^0(px)?$/],
        'margin-right': [/^auto$/, /^0(px)?$/],
      },
    },
    // Sem isso, sanitize-html troca cada tag desconhecida (ex.: um <script>
    // colado) pelo texto do conteúdo em vez de simplesmente descartá-la —
    // como aqui é conteúdo do próprio editor, descartar é o esperado.
    disallowedTagsMode: 'discard',
  });
}
