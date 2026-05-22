import React from 'react';
import * as SecureStore from 'expo-secure-store';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform, Pressable, Text } from 'react-native';

import {
  getStoredLanguageCode,
  LANGUAGE_STORAGE_KEY,
  LanguageProvider,
  normalizeLanguageCode,
  setStoredLanguageCode,
  translate,
  useLanguage,
  useT,
  type LanguageCode,
} from '..';

const originalPlatform = Platform.OS;

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

function LanguageProbe() {
  const { language, setLanguage } = useLanguage();
  const t = useT();

  return (
    <>
      <Text testID="language-code">{language}</Text>
      <Text testID="profile-title">{t('profileSettings.header.profile')}</Text>
      <Pressable
        testID="set-dutch"
        onPress={() => {
          void setLanguage('nl');
        }}
      >
        <Text>Set Dutch</Text>
      </Pressable>
    </>
  );
}

describe('i18n foundation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    setPlatform('web');
  });

  afterAll(() => {
    setPlatform(originalPlatform);
  });

  it('normalizes supported language codes and defaults invalid values to English', () => {
    expect(normalizeLanguageCode('en')).toBe('en');
    expect(normalizeLanguageCode('EN-us')).toBe('en');
    expect(normalizeLanguageCode('nl_NL')).toBe('nl');
    expect(normalizeLanguageCode('de')).toBe('en');
    expect(normalizeLanguageCode(null)).toBe('en');
  });

  it('falls back to English and interpolates values', () => {
    expect(
      translate('xx' as LanguageCode, 'test.interpolation', {
        count: 3,
        date: new Date('2026-05-21T12:00:00.000Z'),
        version: '1.2.3',
      })
    ).toBe('3 homes updated on 2026-05-21T12:00:00.000Z for version 1.2.3');
  });

  it('stores and reads the web language from localStorage', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'nl-NL');

    await expect(getStoredLanguageCode()).resolves.toBe('nl');

    await setStoredLanguageCode('en');

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('stores and reads the native language from SecureStore', async () => {
    setPlatform('ios');
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('nl');

    await expect(getStoredLanguageCode()).resolves.toBe('nl');
    await setStoredLanguageCode('en');

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it('loads stored language and persists immediate language updates through the provider', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'nl');

    const { getByTestId } = render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(getByTestId('profile-title').props.children).toBe('Profiel');
    });

    fireEvent.press(getByTestId('set-dutch'));

    expect(getByTestId('language-code').props.children).toBe('nl');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('nl');
  });
});
