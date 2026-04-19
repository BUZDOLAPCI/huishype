import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

const ANONYMOUS_SESSION_ID_KEY = 'huishype_anonymous_session_id';

function createSessionId(): string {
  return Crypto.randomUUID();
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
