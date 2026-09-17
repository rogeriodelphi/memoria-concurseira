import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { PALETTES, type ThemeColor } from '../theme/palettes';

export type ThemeMode = 'light' | 'dark' | 'system';

const MODE_KEY = 'bc-theme-mode';
const COLOR_KEY = 'bc-theme-color';

function readMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function readColor(): ThemeColor {
  const stored = localStorage.getItem(COLOR_KEY);
  return stored && stored in PALETTES ? (stored as ThemeColor) : 'green';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyMode(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', isDark);
}

function applyColor(color: ThemeColor) {
  const scale = PALETTES[color];
  const root = document.documentElement;
  for (const [shade, rgb] of Object.entries(scale)) {
    root.style.setProperty(`--brand-${shade}`, rgb);
  }
}

// Roda uma vez no carregamento do módulo — antes do primeiro render do
// ThemeProvider — para o tema salvo já estar aplicado no primeiro paint,
// em vez de aparecer o padrão (verde/claro) por um instante e só depois trocar.
applyMode(readMode());
applyColor(readColor());

interface ThemeContextValue {
  mode: ThemeMode;
  color: ThemeColor;
  setMode: (mode: ThemeMode) => void;
  setColor: (color: ThemeColor) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [color, setColorState] = useState<ThemeColor>(readColor);

  useEffect(() => {
    applyMode(mode);
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyMode('system');
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [mode]);

  useEffect(() => {
    applyColor(color);
  }, [color]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(MODE_KEY, next);
  }, []);

  const setColor = useCallback((next: ThemeColor) => {
    setColorState(next);
    localStorage.setItem(COLOR_KEY, next);
  }, []);

  return <ThemeContext.Provider value={{ mode, color, setMode, setColor }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme precisa estar dentro de <ThemeProvider>.');
  return ctx;
}
