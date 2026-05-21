import { Platform } from 'react-native';

const REPORT_DEVICE_ID_KEY = 'device_id';

let fallbackDeviceId: string | null = null;
let secureStoreModule: typeof import('expo-secure-store') | null = null;

async function getSecureStore() {
  secureStoreModule ??= await import('expo-secure-store');
  return secureStoreModule;
}

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

function createDeviceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    try {
      return globalThis.crypto.randomUUID();
    } catch {
      return createFallbackUuid();
    }
  }

  return createFallbackUuid();
}

function readWebDeviceId(): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  return localStorage.getItem(REPORT_DEVICE_ID_KEY);
}

function writeWebDeviceId(deviceId: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(REPORT_DEVICE_ID_KEY, deviceId);
}

export async function getReportDeviceId(): Promise<string> {
  if (Platform.OS === 'web') {
    const existingDeviceId = readWebDeviceId();
    if (existingDeviceId) {
      return existingDeviceId;
    }

    const deviceId = createDeviceId();
    writeWebDeviceId(deviceId);
    return deviceId;
  }

  try {
    const SecureStore = await getSecureStore();
    const existingDeviceId = await SecureStore.getItemAsync(REPORT_DEVICE_ID_KEY);
    if (existingDeviceId) {
      return existingDeviceId;
    }

    const deviceId = createDeviceId();
    await SecureStore.setItemAsync(REPORT_DEVICE_ID_KEY, deviceId);
    return deviceId;
  } catch {
    if (!fallbackDeviceId) {
      fallbackDeviceId = createDeviceId();
    }

    return fallbackDeviceId;
  }
}
