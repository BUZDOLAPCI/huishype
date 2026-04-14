import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const navigateMock = vi.fn();
const verifyEmailTokenMock = vi.fn(() => Promise.resolve());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [new URLSearchParams('emailToken=callback-token&source=email'), vi.fn()],
  };
});

vi.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: false,
    isLoading: false,
    authError: null,
    verifyEmailToken: verifyEmailTokenMock,
  }),
}));

import { AuthCallbackRoute } from './AuthCallbackRoute';

describe('AuthCallbackRoute', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    verifyEmailTokenMock.mockReset();
    verifyEmailTokenMock.mockImplementation(() => Promise.resolve());
  });

  it('verifies an email token from the browser callback and keeps the user on the callback screen', async () => {
    const { getByText } = render(<AuthCallbackRoute />);

    await waitFor(() => {
      expect(verifyEmailTokenMock).toHaveBeenCalledWith('callback-token');
    });

    expect(getByText('Verifying your link...')).toBeTruthy();
    expect(getByText('emailToken=callback-token · source=email')).toBeTruthy();

    fireEvent.click(getByText('Return home'));

    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
  });
});
