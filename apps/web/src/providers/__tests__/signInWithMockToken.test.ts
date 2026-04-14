import { describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('signInWithMockToken contract', () => {
  it('exchanges the provided browser credential through the cookie-backed auth endpoint', async () => {
    const mockToken = 'mock-google-browser-dev-gid001';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session: {
          user: {
            id: 'user-1',
            email: 'browser-dev@gmail.com',
            displayName: 'Browser Dev',
          },
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        isNewUser: true,
      }),
    } as Response);

    await fetch('http://localhost:3100/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ idToken: mockToken }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/auth/google',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken: mockToken }),
      }),
    );
  });
});
