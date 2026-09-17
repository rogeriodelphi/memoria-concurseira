export type ThemeColor = 'green' | 'blue' | 'purple' | 'rose' | 'amber' | 'teal';

export const THEME_COLORS: ThemeColor[] = ['green', 'blue', 'purple', 'rose', 'amber', 'teal'];

export const THEME_COLOR_LABELS: Record<ThemeColor, string> = {
  green: 'Verde',
  blue: 'Azul',
  purple: 'Roxo',
  rose: 'Rosa',
  amber: 'Âmbar',
  teal: 'Turquesa',
};

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Shade = (typeof SHADES)[number];

type Scale = Record<Shade, string>;

/**
 * Curva de saturação/luminosidade compartilhada por todas as cores geradas
 * (todas menos "verde", que é a paleta original com valores fixos) — mesma
 * "forma" de escala para qualquer matiz, só o hue muda.
 */
const SHADE_CURVE: Record<Shade, { s: number; l: number }> = {
  50: { s: 55, l: 97 },
  100: { s: 55, l: 92 },
  200: { s: 52, l: 83 },
  300: { s: 50, l: 72 },
  400: { s: 52, l: 58 },
  500: { s: 58, l: 47 },
  600: { s: 62, l: 38 },
  700: { s: 64, l: 31 },
  800: { s: 66, l: 25 },
  900: { s: 68, l: 20 },
  950: { s: 70, l: 11 },
};

function hslToRgbTriplet(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(255 * f(0));
  const g = Math.round(255 * f(8));
  const b = Math.round(255 * f(4));
  return `${r} ${g} ${b}`;
}

function generateScale(hue: number): Scale {
  const scale = {} as Scale;
  for (const shade of SHADES) {
    const { s, l } = SHADE_CURVE[shade];
    scale[shade] = hslToRgbTriplet(hue, s, l);
  }
  return scale;
}

// Paleta original do produto — valores exatos (não gerados) para preservar
// a identidade visual atual como padrão.
const GREEN_SCALE: Scale = {
  50: '240 250 243',
  100: '219 243 226',
  200: '184 230 200',
  300: '138 211 164',
  400: '87 184 122',
  500: '51 156 92',
  600: '35 125 72',
  700: '28 99 59',
  800: '25 79 49',
  900: '21 65 42',
  950: '9 36 23',
};

export const PALETTES: Record<ThemeColor, Scale> = {
  green: GREEN_SCALE,
  blue: generateScale(217),
  purple: generateScale(262),
  rose: generateScale(346),
  amber: generateScale(38),
  teal: generateScale(175),
};

/** Aproximação do swatch (tom 500) em hex, só para os botões de seleção de cor. */
export function paletteSwatchHex(color: ThemeColor): string {
  const [r, g, b] = PALETTES[color][500].split(' ').map(Number);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
