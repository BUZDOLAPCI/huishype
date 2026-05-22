import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { type TranslationKey } from './dictionaries';
import { getStoredLanguageCode, setStoredLanguageCode } from './storage';
import { DEFAULT_LANGUAGE, translate } from './translate';
import type { InterpolationValues, LanguageCode } from './types';

interface LanguageContextValue {
  language: LanguageCode;
  setLanguage: (languageCode: LanguageCode) => Promise<void>;
  t: (key: TranslationKey, values?: InterpolationValues) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

interface LanguageProviderProps {
  children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const hasUserSelectedLanguageRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    void getStoredLanguageCode().then((storedLanguage) => {
      if (isMounted && !hasUserSelectedLanguageRef.current) {
        setLanguageState(storedLanguage);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const setLanguage = useCallback(async (languageCode: LanguageCode) => {
    hasUserSelectedLanguageRef.current = true;
    setLanguageState(languageCode);
    await setStoredLanguageCode(languageCode);
  }, []);

  const t = useCallback(
    (key: TranslationKey, values?: InterpolationValues) => translate(language, key, values),
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
    }),
    [language, setLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }

  return context;
}

export function useT(): LanguageContextValue['t'] {
  const context = useContext(LanguageContext);

  return useCallback(
    (key: TranslationKey, values?: InterpolationValues) =>
      context?.t(key, values) ?? translate(DEFAULT_LANGUAGE, key, values),
    [context]
  );
}
