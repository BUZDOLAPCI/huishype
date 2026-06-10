/**
 * AuthCallbackScreen Unit Tests
 *
 * Tests the /auth/callback route that handles sign-in link email verification.
 * Verifies loading states, error surfacing, timeout fallback, and navigation.
 */

import React from 'react';
import { render as rtlRender, act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import AuthCallbackScreen from '../auth/callback';
import { LanguageProvider } from '@/src/i18n';
import { useAuthContext } from '@/src/providers/AuthProvider';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;

function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: LanguageProvider });
}

function mockAuth(overrides: Partial<ReturnType<typeof useAuthContext>> = {}) {
  mockUseAuthContext.mockReturnValue({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    accessToken: null,
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    requestEmailLink: jest.fn(),
    verifyEmailToken: jest.fn(),
    signOut: jest.fn(),
    refreshAuth: jest.fn(),
    getAccessToken: jest.fn(),
    ...overrides,
  });
}

describe('AuthCallbackScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows loading state initially', () => {
    mockAuth({ isAuthenticated: false, isLoading: false, authError: null });
    const { getByText } = render(<AuthCallbackScreen />);
    expect(getByText('Verifying your link...')).toBeTruthy();
  });

  it('shows signing in state when loading', () => {
    mockAuth({ isAuthenticated: false, isLoading: true, authError: null });
    const { getByText } = render(<AuthCallbackScreen />);
    expect(getByText('Signing you in...')).toBeTruthy();
  });

  it('redirects to home on success', () => {
    mockAuth({ isAuthenticated: true, isLoading: false, authError: null });
    render(<AuthCallbackScreen />);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('shows error immediately on auth failure', () => {
    mockAuth({
      isAuthenticated: false,
      isLoading: false,
      authError: 'Invalid or expired link',
    });
    const { getByText } = render(<AuthCallbackScreen />);
    expect(getByText('Invalid or expired link')).toBeTruthy();
    expect(getByText('Go to home screen')).toBeTruthy();
  });

  it('shows timeout error when no response after 15s', () => {
    mockAuth({ isAuthenticated: false, isLoading: false, authError: null });
    const { getByText, queryByText } = render(<AuthCallbackScreen />);

    // Initially shows loading, not error
    expect(getByText('Verifying your link...')).toBeTruthy();
    expect(queryByText('Link expired or invalid')).toBeNull();

    // Advance past 15s timeout
    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    expect(getByText('Link expired or invalid')).toBeTruthy();
  });

  it('navigates home when "Go to home screen" pressed', () => {
    mockAuth({
      isAuthenticated: false,
      isLoading: false,
      authError: 'Invalid or expired link',
    });
    const { getByText } = render(<AuthCallbackScreen />);
    fireEvent.press(getByText('Go to home screen'));
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});
