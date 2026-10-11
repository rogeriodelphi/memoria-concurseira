import { Globe, Loader2, Sparkles, Volume2, VolumeX } from 'lucide-react';

import { useStudySettings, type SpeechEngine } from '../contexts/StudySettingsContext';
import { resumeNaturalVoice, useBrowserVoices, useNaturalVoiceOutage, useSpeech, useTtsInfo } from '../hooks/useSpeech';
import { describeNaturalOutage, SPEECH_RATE } from '../utils/speech';

const SAMPLE = 'Esta é a voz que vai ler as suas perguntas e respostas. Escolha a que for mais confortável para estudar.';

const optionClass = (active: boolean) =>
  `flex flex-col items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
    active
      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-300'
      : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
  }`;

function formatRate(rate: number): string {
  return `${rate.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

export function VoiceSettings() {
  const {
    speechEngine,
    setSpeechEngine,
    geminiVoice,
    setGeminiVoice,
    speechRate,
    setSpeechRate,
    browserVoiceURI,
    setBrowserVoiceURI,
  } = useStudySettings();
  const info = useTtsInfo();
  const outage = useNaturalVoiceOutage();
  const browserVoices = useBrowserVoices();
  const { speak, stop, speaking, loading } = useSpeech();

  const naturalAvailable = info?.available === true;
  const selectedVoice = info?.voices.some((v) => v.id === geminiVoice) ? geminiVoice : (info?.defaultVoice ?? '');

  // Trocar de voz no meio de uma leitura: para, em vez de misturar duas vozes.
  function chooseEngine(engine: SpeechEngine) {
    stop();
    resumeNaturalVoice();
    setSpeechEngine(engine);
  }

  function toggleSample() {
    if (speaking) {
      stop();
      return;
    }
    resumeNaturalVoice(); // quem pede o exemplo quer saber se a voz natural funciona agora
    void speak(SAMPLE, 'question');
  }

  return (
    <div className="mt-6 border-t border-neutral-100 pt-5 dark:border-neutral-800">
      <h3 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Voz</h3>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        A voz natural é gerada por IA e soa bem mais humana. Se ela não estiver disponível, o app lê com a voz do navegador em
        vez de ficar mudo.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => chooseEngine('natural')} className={optionClass(speechEngine === 'natural')}>
          <Sparkles size={18} />
          Natural (IA)
        </button>
        <button type="button" onClick={() => chooseEngine('browser')} className={optionClass(speechEngine === 'browser')}>
          <Globe size={18} />
          Do navegador
        </button>
      </div>

      {speechEngine === 'natural' && (
        <div className="mt-4">
          {info === null && <p className="text-xs text-neutral-400 dark:text-neutral-500">Verificando...</p>}
          {info !== null && !naturalAvailable && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              A voz natural precisa da chave do Gemini no servidor (GEMINI_API_KEY). Enquanto isso, o app usa a voz do
              navegador.
            </p>
          )}
          {naturalAvailable && outage && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            >
              {describeNaturalOutage(outage)} Enquanto isso, o app lê com a voz do navegador. &quot;Ouvir exemplo&quot; tenta a
              voz natural de novo.
            </p>
          )}
          {naturalAvailable && info && (
            <>
              <label className="label-field" htmlFor="gemini-voice">
                Voz
              </label>
              <select
                id="gemini-voice"
                className="input-field"
                value={selectedVoice}
                onChange={(e) => {
                  stop();
                  setGeminiVoice(e.target.value);
                }}
              >
                {info.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} — {v.description}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                Cada cartão é gerado uma vez e fica guardado: ouvir de novo é instantâneo. A primeira vez leva alguns
                segundos e usa tokens do Gemini (aparecem em Uso de IA).
              </p>
            </>
          )}
        </div>
      )}

      {speechEngine === 'browser' && (
        <div className="mt-4">
          {browserVoices.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Nenhuma voz em português foi encontrada neste navegador.
            </p>
          ) : (
            <>
              <label className="label-field" htmlFor="browser-voice">
                Voz
              </label>
              <select
                id="browser-voice"
                className="input-field"
                value={browserVoiceURI ?? ''}
                onChange={(e) => {
                  stop();
                  setBrowserVoiceURI(e.target.value || null);
                }}
              >
                <option value="">Automática (a melhor disponível)</option>
                {browserVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                    {v.localService ? '' : ' · online'}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                As vozes variam de navegador para navegador. No Microsoft Edge existem vozes &quot;Natural&quot; gratuitas bem
                melhores que as do sistema.
              </p>
            </>
          )}
        </div>
      )}

      <div className="mt-5">
        <label className="label-field" htmlFor="speech-rate">
          Velocidade: {formatRate(speechRate)}
        </label>
        <input
          id="speech-rate"
          type="range"
          min={SPEECH_RATE.min}
          max={SPEECH_RATE.max}
          step={SPEECH_RATE.step}
          value={speechRate}
          onChange={(e) => setSpeechRate(Number(e.target.value))}
          className="w-full accent-brand-600"
        />
      </div>

      <button type="button" className="btn-secondary mt-4" onClick={toggleSample}>
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Preparando voz...
          </>
        ) : speaking ? (
          <>
            <VolumeX size={16} />
            Parar
          </>
        ) : (
          <>
            <Volume2 size={16} />
            Ouvir exemplo
          </>
        )}
      </button>
    </div>
  );
}
