import type { Flashcard } from '../types';
import { CARD_TEXT_STYLE, type CardTextRole } from '../utils/cardTextStyle';

/**
 * Renderiza o texto de um flashcard respeitando seu formato: HTML
 * sanitizado (produzido pelo editor de texto rico) ou texto simples (gerado
 * pela IA, nunca passou pelo editor). Usado em toda tela que mostra
 * pergunta/resposta — Coleção e Modo de Estudo — pra não repetir essa
 * lógica em cada lugar e arriscar uma esquecer de tratar o HTML.
 */
export function FormattedText({
  value,
  format,
  role,
  className,
}: {
  value: string;
  format: Flashcard['format'];
  role: CardTextRole;
  className: string;
}) {
  const classes = `${className} ${CARD_TEXT_STYLE[role]}`;

  // O editor produz <div style="text-align:..."> pro alinhamento — um bloco
  // desses dentro de um <p> seria HTML inválido (o navegador pode
  // reestruturar de formas diferentes entre engines), por isso o wrapper é
  // <div>, não <p>.
  if (format === 'html') {
    return (
      <div
        className={`${classes} [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_img]:my-1 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md`}
        dangerouslySetInnerHTML={{ __html: value }}
      />
    );
  }
  return <p className={classes}>{value}</p>;
}
