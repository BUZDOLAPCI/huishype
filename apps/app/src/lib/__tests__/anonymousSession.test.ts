import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { getAnonymousSessionId } from '../anonymousSession';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000000'),
}));

describe('anonymousSession', () => {
  const originalPlatform = Platform.OS;
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const mockedRandomUUID = Crypto.randomUUID as jest.MockedFunction<
    typeof Crypto.randomUUID
  >;

  const setBrowserCrypto = (value: unknown) => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value,
    });
  };

  afterEach(() => {
    Platform.OS = originalPlatform;
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    }
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('creates and persists a web UUID when expo randomUUID is unavailable', async () => {
    Platform.OS = 'web';
    mockedRandomUUID.mockImplementation(() => {
      throw new TypeError('crypto.randomUUID is not a function');
    });
    setBrowserCrypto({
      getRandomValues: <T extends ArrayBufferView>(array: T) => {
        const bytes = array as unknown as Uint8Array;
        bytes.forEach((_, index) => {
          bytes[index] = index;
        });
        return array;
      },
    });

    const sessionId = await getAnonymousSessionId();
    const persistedSessionId = await getAnonymousSessionId();

    expect(sessionId).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(persistedSessionId).toBe(sessionId);
    expect(localStorage.getItem('huishype_anonymous_session_id')).toBe(sessionId);
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
