export { dictionaries, type Dictionary, type TranslationKey } from './dictionaries';
export { LanguageProvider, useLanguage, useT } from './LanguageProvider';
export {
  getStoredLanguageCode,
  LANGUAGE_STORAGE_KEY,
  setStoredLanguageCode,
} from './storage';
export {
  DEFAULT_LANGUAGE,
  interpolate,
  normalizeLanguageCode,
  translate,
} from './translate';
export type { InterpolationValue, InterpolationValues, LanguageCode } from './types';
