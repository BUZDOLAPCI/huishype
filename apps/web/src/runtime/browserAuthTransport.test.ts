import { describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../utils/api';

const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

describe('browser auth transport', () => {
  it('always sends credentials include for browser fetches', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiFetch('/auth/me');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/auth/me',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });
});
