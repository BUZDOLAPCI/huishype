/**
 * AuthProvider startup token-refresh tests.
 *
 * Covers the loadStoredAuth flow inside the mount useEffect:
 *   1. Expired token -> refreshAuth -> fresh token exposed in context
 *   2. Successful refresh -> timer scheduled via scheduleTokenRefresh
 *   3. Refresh failure -> auth cleared, loading stops
 */

import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'test-google-client-id';

// ---------------------------------------------------------------------------
// Mocks - must be declared before any import that touches the mocked modules
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch;
var mockMakeRedirectUri: jest.Mock;
var mockPromptAsync: jest.Mock;
var mockAuthRequest: jest.Mock;

const mockSecureStore: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore[key] = value;
  }),
  getItemAsync: jest.fn(async (key: string) => mockSecureStore[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete mockSecureStore[key];
  }),
}));

jest.mock('expo-auth-session', () => {
  mockMakeRedirectUri = jest.fn(() => 'https://huishype.test/auth/callback');
  mockPromptAsync = jest.fn();
  mockAuthRequest = jest.fn().mockImplementation((config: unknown) => ({
    config,
    promptAsync: mockPromptAsync,
  }));

  return {
    makeRedirectUri: mockMakeRedirectUri,
    AuthRequest: mockAuthRequest,
    ResponseType: { IdToken: 'id_token' },
  };
});

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid'),
}));

jest.mock('../../utils/api', () => ({
  API_URL: 'http://localhost:3100',
  setApiAccessTokenResolver: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { AuthProvider, useAuthContext } from '../AuthProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORED_USER = {
  id: 'u1',
  email: 'test@example.com',
  displayName: 'Test',
};

/** Seed SecureStore with a full set of auth tokens. */
function seedStorage(overrides: { expiresAt?: string; accessToken?: string } = {}) {
  const defaults = {
    accessToken: 'stale-access-token',
    refreshToken: 'stored-refresh-token',
    user: JSON.stringify(STORED_USER),
    expiresAt: new Date(Date.now() - 60_000).toISOString(), // expired by default
  };
  const values = { ...defaults, ...overrides };

  mockSecureStore['huishype_access_token'] = values.accessToken;
  mockSecureStore['huishype_refresh_token'] = values.refreshToken;
  mockSecureStore['huishype_user'] = values.user;
  mockSecureStore['huishype_token_expiry'] = values.expiresAt;
}

function clearStorage() {
  for (const key of Object.keys(mockSecureStore)) {
    delete mockSecureStore[key];
  }
}

/** Wrapper that renders children inside AuthProvider. */
function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

async function settleAuthBoot() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthProvider startup token refresh', () => {
  beforeEach(() => {
    jest.useRealTimers();
    clearStorage();
    mockFetch.mockReset();
    mockMakeRedirectUri.mockClear();
    mockPromptAsync.mockReset();
    mockAuthRequest.mockClear();
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'test-google-client-id';
  });

  it('refreshes an expired token on boot and exposes the new token in context', async () => {
    seedStorage(); // expired token in storage

    const freshExpiry = new Date(Date.now() + 3_600_000).toISOString();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'fresh-access-token',
        expiresAt: freshExpiry,
      }),
    });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await settleAuthBoot();

    expect(result.current.isLoading).toBe(false);
    // The context should expose the FRESH token returned by the refresh endpoint,
    // not the stale one that was originally in storage.
    expect(result.current.accessToken).toBe('fresh-access-token');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(STORED_USER);

    // Verify the refresh endpoint was called with the stored refresh token
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'stored-refresh-token' }),
      }),
    );
  });

  it('schedules a refresh timer after successful startup refresh', async () => {
    const spySetTimeout = jest.spyOn(global, 'setTimeout');

    seedStorage(); // expired token

    const freshExpiry = new Date(Date.now() + 3_600_000).toISOString();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'fresh-access-token',
        expiresAt: freshExpiry,
      }),
    });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await settleAuthBoot();
    expect(result.current.isLoading).toBe(false);

    // scheduleTokenRefresh should have been called, resulting in a setTimeout.
    // The timer fires 60 s before the expiry. With a 1-hour expiry the delay
    // is ~3 540 000 ms. We verify setTimeout was called with a large positive delay.
    const timerCalls = spySetTimeout.mock.calls.filter(
      ([, delay]) => typeof delay === 'number' && delay > 60_000,
    );
    expect(timerCalls.length).toBeGreaterThanOrEqual(1);

    spySetTimeout.mockRestore();
  });

  it('invalidates property detail queries after restoring an authenticated session', async () => {
    seedStorage({
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      accessToken: 'fresh-access-token',
    });

    const invalidateQueries = jest.spyOn(QueryClient.prototype, 'invalidateQueries');

    renderHook(() => useAuthContext(), { wrapper });
    await settleAuthBoot();

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['properties', 'detail'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['saved-properties'],
    });

    invalidateQueries.mockRestore();
  });

  it('clears auth and stops loading when refresh fails on boot', async () => {
    seedStorage(); // expired token

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'token revoked' }),
    });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await settleAuthBoot();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.accessToken).toBeNull();
    expect(result.current.user).toBeNull();

    // Storage should have been wiped by clearAuthData
    expect(mockSecureStore['huishype_access_token']).toBeUndefined();
    expect(mockSecureStore['huishype_refresh_token']).toBeUndefined();
  });

  it('disables PKCE for Google id_token sign-in requests', async () => {
    mockPromptAsync.mockResolvedValueOnce({ type: 'dismiss' });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await settleAuthBoot();

    await act(async () => {
      await result.current.signInWithGoogle();
    });

    expect(mockMakeRedirectUri).toHaveBeenCalledWith({
      scheme: 'huishype',
      path: 'auth/callback',
    });

    expect(mockAuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: 'https://huishype.test/auth/callback',
        responseType: 'id_token',
        usePKCE: false,
        extraParams: {
          nonce: 'mock-uuid',
        },
      })
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails fast with a clear error when the Google client ID is missing', async () => {
    const originalClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

    try {
      const { result } = renderHook(() => useAuthContext(), { wrapper });
      await settleAuthBoot();

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.signInWithGoogle();
        } catch (error) {
          thrownError = error;
        }
      });

      expect(thrownError).toEqual(
        expect.objectContaining({
          message:
            'Google Sign-In is not configured for this app build. Set EXPO_PUBLIC_GOOGLE_CLIENT_ID in apps/app/.env and restart Expo.',
        })
      );

      expect(mockAuthRequest).not.toHaveBeenCalled();
      expect(mockPromptAsync).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
      if (originalClientId === undefined) {
        delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      } else {
        process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = originalClientId;
      }
    }
  });
});
