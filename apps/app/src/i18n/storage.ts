import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { DEFAULT_LANGUAGE, normalizeLanguageCode } from './translate';
import type { LanguageCode } from './types';

export const LANGUAGE_STORAGE_KEY = 'huishype_language';

function getWebLocalStorage(): Storage | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  return localStorage;
}

export async function getStoredLanguageCode(): Promise<LanguageCode> {
  const storedValue =
    Platform.OS === 'web'
      ? getWebLocalStorage()?.getItem(LANGUAGE_STORAGE_KEY)
      : await SecureStore.getItemAsync(LANGUAGE_STORAGE_KEY);

  return storedValue ? normalizeLanguageCode(storedValue) : DEFAULT_LANGUAGE;
}

export async function setStoredLanguageCode(languageCode: LanguageCode): Promise<void> {
  const normalizedLanguageCode = normalizeLanguageCode(languageCode);

  if (Platform.OS === 'web') {
    getWebLocalStorage()?.setItem(LANGUAGE_STORAGE_KEY, normalizedLanguageCode);
    return;
  }

  await SecureStore.setItemAsync(LANGUAGE_STORAGE_KEY, normalizedLanguageCode);
}
