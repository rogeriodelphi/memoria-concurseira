/** O que a tela "Lançar tempo estudado" faz com o que o usuário digita: as contas puras, testáveis sozinhas. */

/** Um lançamento vai de 1 minuto a um dia inteiro (o servidor confere o mesmo limite). */
export const MAX_MINUTES = 24 * 60;
/** Antes disso a data é engano de digitação (o servidor confere o mesmo limite). */
export const MIN_DATE = '2000-01-01';

/** Os campos de horas e minutos → minutos no total; `null` se não for um tempo válido (vazio, negativo, texto, zero ou mais de 24 h). */
export function totalMinutes(hours: string, minutes: string): number | null {
  const parse = (text: string) => {
    const t = text.trim();
    if (t === '') return 0;
    return /^\d{1,4}$/.test(t) ? Number(t) : NaN;
  };
  const total = parse(hours) * 60 + parse(minutes);
  return Number.isFinite(total) && total >= 1 && total <= MAX_MINUTES ? total : null;
}

/** `2026-10-25` do dia local de `d` (o dia que o usuário vê no relógio, e não o do UTC). */
export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** O período das estatísticas, ampliado só o necessário para conter `date` (senão o lançamento não apareceria na lista). */
export function rangeIncluding(range: { from: string; to: string }, date: string): { from: string; to: string } {
  return { from: date < range.from ? date : range.from, to: date > range.to ? date : range.to };
}

/** 90 → `1h 30min`; 60 → `1h`; 45 → `45min`. */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return `${h}h${m > 0 ? ` ${m}min` : ''}`;
  return `${m}min`;
}

/** `2026-10-25` → `25/10/2026`. */
export function formatDateKey(key: string): string {
  return key.split('-').reverse().join('/');
}
