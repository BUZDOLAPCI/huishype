import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

const ANONYMOUS_SESSION_ID_KEY = 'huishype_anonymous_session_id';

function createFallbackUuid(): string {
  const bytes = new Uint8Array(16);
  const browserCrypto = globalThis.crypto;

  if (browserCrypto?.getRandomValues) {
    browserCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] % 16) + 64;
  bytes[8] = (bytes[8] % 64) + 128;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

function createSessionId(): string {
  if (typeof Crypto.randomUUID === 'function') {
    try {
      return Crypto.randomUUID();
    } catch {
      return createFallbackUuid();
    }
  }

  return createFallbackUuid();
}

function readWebSessionId(): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage.getItem(ANONYMOUS_SESSION_ID_KEY);
}

function writeWebSessionId(sessionId: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(ANONYMOUS_SESSION_ID_KEY, sessionId);
}

export async function getAnonymousSessionId(): Promise<string | null> {
  if (Platform.OS === 'web') {
    const existingSessionId = readWebSessionId();
    if (existingSessionId) {
      return existingSessionId;
    }

    const sessionId = createSessionId();
    writeWebSessionId(sessionId);
    return sessionId;
  }

  const existingSessionId = await SecureStore.getItemAsync(ANONYMOUS_SESSION_ID_KEY);
  if (existingSessionId) {
    return existingSessionId;
  }

  const sessionId = createSessionId();
  await SecureStore.setItemAsync(ANONYMOUS_SESSION_ID_KEY, sessionId);
  return sessionId;
}
