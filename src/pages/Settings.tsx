import { useEffect } from 'react';
import { Check, Monitor, Moon, MousePointerClick, Sun, Volume2 } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { AiUsagePanel } from '../components/AiUsagePanel';
import { useTheme, type ThemeMode } from '../contexts/ThemeContext';
import { useStudySettings } from '../contexts/StudySettingsContext';
import { paletteSwatchHex, THEME_COLOR_LABELS, THEME_COLORS } from '../theme/palettes';

const MODE_OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Claro', icon: Sun },
  { mode: 'dark', label: 'Escuro', icon: Moon },
  { mode: 'system', label: 'Sistema', icon: Monitor },
];

export function Settings() {
  const { mode, color, setMode, setColor } = useTheme();
  const { autoPlaySpeech, setAutoPlaySpeech } = useStudySettings();
  const { hash } = useLocation();

  // O link "Tokens de IA" do menu lateral aponta pra cá com #uso-ia — o
  // react-router não rola até a âncora sozinho.
  useEffect(() => {
    if (hash === '#uso-ia') document.getElementById('uso-ia')?.scrollIntoView();
  }, [hash]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Configurações</h1>
      <p className="mb-8 text-sm text-neutral-500 dark:text-neutral-400">
        Personalize o app e acompanhe o uso de IA.
      </p>

      <div className="card mb-6 p-6">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Tema</h2>
        <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
          "Sistema" acompanha automaticamente o tema claro/escuro do seu sistema operacional.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {MODE_OPTIONS.map(({ mode: m, label, icon: Icon }) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex flex-col items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                mode === m
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-300'
                  : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Cor de destaque</h2>
        <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
          Usada nos botões, links e destaques em todo o app.
        </p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {THEME_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="flex flex-col items-center gap-1.5"
              title={THEME_COLOR_LABELS[c]}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-white transition-shadow dark:ring-offset-neutral-900 ${
                  color === c ? 'ring-neutral-900 dark:ring-neutral-100' : 'ring-transparent'
                }`}
                style={{ backgroundColor: paletteSwatchHex(c) }}
              >
                {color === c && <Check size={16} className="text-white" />}
              </span>
              <span className="text-xs text-neutral-600 dark:text-neutral-400">{THEME_COLOR_LABELS[c]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card mt-6 p-6">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Leitura em voz alta</h2>
        <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
          No Modo de Estudo, define se a pergunta e a resposta são lidas em voz alta automaticamente ou só quando
          você clicar em "Ouvir".
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setAutoPlaySpeech(false)}
            className={`flex flex-col items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
              !autoPlaySpeech
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-300'
                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            <MousePointerClick size={18} />
            Manual
          </button>
          <button
            onClick={() => setAutoPlaySpeech(true)}
            className={`flex flex-col items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
              autoPlaySpeech
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-300'
                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            <Volume2 size={18} />
            Automática
          </button>
        </div>
      </div>

      <AiUsagePanel />
    </div>
  );
}
