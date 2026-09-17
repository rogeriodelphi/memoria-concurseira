import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const AUTO_PLAY_KEY = 'bc-study-autoplay-speech';

function readAutoPlay(): boolean {
  return localStorage.getItem(AUTO_PLAY_KEY) === 'true';
}

interface StudySettingsContextValue {
  autoPlaySpeech: boolean;
  setAutoPlaySpeech: (value: boolean) => void;
}

const StudySettingsContext = createContext<StudySettingsContextValue | null>(null);

export function StudySettingsProvider({ children }: { children: ReactNode }) {
  const [autoPlaySpeech, setAutoPlaySpeechState] = useState<boolean>(readAutoPlay);

  const setAutoPlaySpeech = useCallback((value: boolean) => {
    setAutoPlaySpeechState(value);
    localStorage.setItem(AUTO_PLAY_KEY, String(value));
  }, []);

  return (
    <StudySettingsContext.Provider value={{ autoPlaySpeech, setAutoPlaySpeech }}>
      {children}
    </StudySettingsContext.Provider>
  );
}

export function useStudySettings(): StudySettingsContextValue {
  const ctx = useContext(StudySettingsContext);
  if (!ctx) throw new Error('useStudySettings precisa estar dentro de <StudySettingsProvider>.');
  return ctx;
}
