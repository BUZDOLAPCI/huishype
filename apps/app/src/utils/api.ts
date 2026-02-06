import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_API_PORT = '3100';

// Extract the port from a URL string, or return undefined if none is present.
const extractPort = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    return parsed.port || undefined;
  } catch {
    return undefined;
  }
};

// Get the API URL, resolving to the correct host for the current environment:
// - If EXPO_PUBLIC_API_URL is set to a non-localhost address, use it as-is
// - Android emulator: rewrite localhost → 10.0.2.2 (emulator host alias)
// - Real device (Android/iOS): extract dev server LAN IP from Expo's hostUri
// - Fallback: localhost (works for iOS simulator and web)
//
// When an explicit URL is configured (EXPO_PUBLIC_API_URL or extra.apiUrl),
// its port is preserved during host rewriting. The hardcoded default port is
// only used when no URL is configured at all.
const getApiUrl = (): string => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL || '';
  const configUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;
  const url = envUrl || configUrl || '';

  // Determine which port to use: prefer the port from the configured URL,
  // fall back to the default only when no URL is configured.
  const port = (url && extractPort(url)) || DEFAULT_API_PORT;

  // If explicitly configured to a non-loopback address, use it directly
  if (url && !url.includes('localhost') && !url.includes('127.0.0.1')) {
    return url;
  }

  // For native platforms, try to resolve a reachable host
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    // Expo dev server exposes the host machine's LAN IP via hostUri (e.g. "192.168.1.5:8081")
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      const lanIp = hostUri.split(':')[0];
      if (lanIp && lanIp !== 'localhost' && lanIp !== '127.0.0.1') {
        return `http://${lanIp}:${port}`;
      }
    }

    // No LAN IP available — likely Android emulator where hostUri isn't set
    if (Platform.OS === 'android') {
      return `http://10.0.2.2:${port}`;
    }
  }

  // iOS simulator, web, or no detection: localhost works
  return url || `http://localhost:${port}`;
};

export const API_URL = getApiUrl();

// Base fetch wrapper with common configuration
export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'An error occurred' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

// Convenience methods
export const api = {
  get: <T>(endpoint: string, options?: RequestInit) =>
    apiFetch<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, data: unknown, options?: RequestInit) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    }),

  put: <T>(endpoint: string, data: unknown, options?: RequestInit) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: <T>(endpoint: string, options?: RequestInit) =>
    apiFetch<T>(endpoint, { ...options, method: 'DELETE' }),
};
