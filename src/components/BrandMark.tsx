import { Brain } from 'lucide-react';

export const APP_NAME = 'Memória Concurseira';
export const APP_SLOGAN = 'Aprenda. Revise. Memorize. Conquiste.';

/**
 * O logotipo: um cartão de memorização com um cérebro, e um segundo cartão atrás (o baralho). O
 * ícone do app instalado (public/icons) é o mesmo desenho.
 *
 * `tone="light"` é o cartão claro, para fundos escuros (o menu); `tone="dark"` é o cartão verde,
 * para fundos claros (login, cabeçalho do celular).
 */
export function BrandMark({ size = 32, tone = 'dark' }: { size?: number; tone?: 'light' | 'dark' }) {
  const colors = tone === 'light' ? 'bg-brand-50 text-brand-800' : 'bg-brand-700 text-white';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg ${colors}`}
      style={{
        width: Math.round(size * 1.25),
        height: size,
        // O "cartão de trás" do baralho.
        boxShadow: `${Math.max(2, Math.round(size / 10))}px -${Math.max(2, Math.round(size / 10))}px 0 0 rgb(var(--brand-400) / 0.65)`,
      }}
    >
      <Brain size={Math.round(size * 0.62)} strokeWidth={2} />
    </span>
  );
}
