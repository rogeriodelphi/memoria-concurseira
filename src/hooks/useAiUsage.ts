import { useCallback, useEffect, useState } from 'react';

import { AI_USAGE_EVENT, aiUsageApi } from '../services/api';
import type { AiUsage } from '../types';

export function useAiUsage() {
  const [usage, setUsage] = useState<AiUsage | null>(null);

  const refresh = useCallback(() => {
    aiUsageApi
      .get()
      .then(setUsage)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(AI_USAGE_EVENT, refresh);
    return () => window.removeEventListener(AI_USAGE_EVENT, refresh);
  }, [refresh]);

  return { usage };
}
