import { api, resolveProperty, setApiAccessTokenResolver } from '../api';
import { vi } from 'vitest';

describe('resolveProperty', () => {
  const mockFetch = vi.fn();
  const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as any;
    setApiAccessTokenResolver(null);
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
  });

  it('returns null when the backend resolves a different country than requested', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        countryCode: 'NL',
        address: 'Teststraat 42, 1234AB Amsterdam',
        postalCode: '1234AB',
        city: 'Amsterdam',
        coordinates: {
          lon: 4.9,
          lat: 52.37,
        },
        hasListing: false,
        officialValuation: null,
      }),
    });

    const result = await resolveProperty({
      postalCode: '1234AB',
      houseNumber: '42',
      countryCode: 'DE',
      street: 'Teststraat',
      city: 'Amsterdam',
    });

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain('/properties/resolve?');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('countryCode=DE');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('postalCode=1234AB');
  });
});

describe('api browser session transport', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as any;
    setApiAccessTokenResolver(null);
  });

  afterEach(() => {
    setApiAccessTokenResolver(null);
  });

  it('sends cookies and does not inject bearer tokens automatically', async () => {
    setApiAccessTokenResolver(async () => 'resolver-token');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await api.get('/properties/test-property');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/properties/test-property',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.any(Headers),
      }),
    );

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBeNull();
  });

  it('preserves an explicit Authorization header', async () => {
    setApiAccessTokenResolver(async () => 'resolver-token');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await api.get('/properties/test-property', {
      headers: {
        Authorization: 'Bearer explicit-token',
      },
    });

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer explicit-token');
    expect(mockFetch.mock.calls[0]?.[1]?.credentials).toBe('include');
  });
});
