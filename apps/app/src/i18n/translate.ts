import { dictionaries, type TranslationKey } from './dictionaries';
import type { InterpolationValue, InterpolationValues, LanguageCode } from './types';

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

function formatInterpolationValue(value: InterpolationValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

export function normalizeLanguageCode(value: unknown): LanguageCode {
  if (typeof value !== 'string') {
    return DEFAULT_LANGUAGE;
  }

  const normalized = value.trim().toLowerCase().replace('_', '-');
  const [baseLanguage] = normalized.split('-');

  if (baseLanguage === 'nl') {
    return 'nl';
  }

  if (baseLanguage === 'en') {
    return 'en';
  }

  return DEFAULT_LANGUAGE;
}

export function interpolate(template: string, values: InterpolationValues = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : formatInterpolationValue(value);
  });
}

export function translate(
  languageCode: LanguageCode,
  key: TranslationKey,
  values?: InterpolationValues
): string {
  const dictionary = dictionaries[languageCode] ?? dictionaries[DEFAULT_LANGUAGE];
  const template = dictionary[key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key;

  return interpolate(template, values);
}
