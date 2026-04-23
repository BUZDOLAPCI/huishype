import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import {
  useFetchPriceGuess,
  useSubmitGuess,
  formatCooldownRemaining,
  guessKeys,
} from '../usePriceGuess';
import { api } from '../../utils/api';

const mockGetAccessToken = jest.fn();

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

// Mock the API module
jest.mock('../../utils/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockApi = api as jest.Mocked<typeof api>;

// Create a wrapper with QueryClientProvider
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe('guessKeys', () => {
  it('generates correct query keys', () => {
    expect(guessKeys.all).toEqual(['guesses']);
    expect(guessKeys.property('property-123')).toEqual(['guesses', 'property-123']);
    expect(guessKeys.viewer('property-123', 'user-456')).toEqual([
      'guesses',
      'property-123',
      'viewer',
      'user-456',
    ]);
    expect(guessKeys.viewer('property-123', null)).toEqual([
      'guesses',
      'property-123',
      'viewer',
      'anonymous',
    ]);
    expect(guessKeys.userGuess('property-123', 'user-456')).toEqual([
      'guesses',
      'property-123',
      'user',
      'user-456',
    ]);
  });
});

describe('FMV confidence from API', () => {
  it('returns confidence from API response', async () => {
    const mockResponse = {
      data: [],
      meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
      fmv: {
        fmv: null,
        confidence: 'low' as const,
        guessCount: 0,
        distribution: null,
        officialValuation: null,
        askingPrice: null,
        divergence: null,
      },
    };

    mockApi.get.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useFetchPriceGuess('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.fmv.confidence).toBe('low');
  });
});

describe('formatCooldownRemaining', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "now" when cooldown has passed', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    expect(formatCooldownRemaining(pastDate)).toBe('now');
  });

  it('formats days correctly', () => {
    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatCooldownRemaining(futureDate)).toBe('3 days');
  });

  it('formats single day correctly', () => {
    const futureDate = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatCooldownRemaining(futureDate)).toBe('1 day');
  });

  it('formats hours when less than a day', () => {
    const futureDate = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    expect(formatCooldownRemaining(futureDate)).toBe('5 hours');
  });

  it('formats single hour correctly', () => {
    const futureDate = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
    expect(formatCooldownRemaining(futureDate)).toBe('1 hour');
  });

  it('formats minutes when less than an hour', () => {
    const futureDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    expect(formatCooldownRemaining(futureDate)).toBe('30 minutes');
  });
});

describe('useFetchPriceGuess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty data when propertyId is null', async () => {
    const { result } = renderHook(() => useFetchPriceGuess(null), {
      wrapper: createWrapper(),
    });

    // Query should not be enabled
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches guess data for a property', async () => {
    const mockResponse = {
      data: [
        {
          id: 'guess-1',
          propertyId: 'property-123',
          userId: 'user-1',
          guessedPrice: 350000,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      fmv: {
        fmv: 350000,
        confidence: 'low',
        guessCount: 1,
        distribution: null,
        officialValuation: null,
        askingPrice: null,
        divergence: null,
      },
    };

    mockApi.get.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useFetchPriceGuess('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApi.get).toHaveBeenCalledWith('/properties/property-123/guesses?limit=100');
    expect(result.current.data?.fmv.guessCount).toBe(1);
  });

  it('maps price guess start fields from the API response', async () => {
    const mockResponse = {
      data: [],
      meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
      fmv: {
        fmv: null,
        confidence: 'none' as const,
        guessCount: 0,
        distribution: null,
        officialValuation: null,
        askingPrice: null,
        divergence: null,
      },
      activeListingAskingPrice: 372000,
      priceGuessStart: {
        price: 340000,
        source: 'local_comparable_price_per_m2' as const,
        confidence: 'usable' as const,
        sampleSize: 12,
      },
    };

    mockApi.get.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useFetchPriceGuess('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.activeListingAskingPrice).toBe(372000);
    expect(result.current.data?.priceGuessStart).toEqual({
      price: 340000,
      source: 'local_comparable_price_per_m2',
      confidence: 'usable',
      sampleSize: 12,
    });
  });

  it('identifies user guess when userId matches', async () => {
    const mockResponse = {
      data: [
        {
          id: 'guess-1',
          propertyId: 'property-123',
          userId: 'user-456',
          guessedPrice: 350000,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      fmv: {
        fmv: 350000,
        confidence: 'low',
        guessCount: 1,
        distribution: null,
        officialValuation: null,
        askingPrice: null,
        divergence: null,
      },
    };

    mockApi.get.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(
      () => useFetchPriceGuess('property-123', 'user-456'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.userGuess).toBeTruthy();
    expect(result.current.data?.userGuess?.userId).toBe('user-456');
    expect(result.current.data?.canEdit).toBe(true);
    expect(result.current.data?.cooldownEndsAt).toBeNull();
  });

  it('refetches viewer-derived guess data when the viewer changes', async () => {
    const mockResponse = {
      data: [
        {
          id: 'guess-1',
          propertyId: 'property-123',
          userId: 'user-456',
          guessedPrice: 350000,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      fmv: {
        fmv: 350000,
        confidence: 'low' as const,
        guessCount: 1,
        distribution: null,
        officialValuation: null,
        askingPrice: null,
        divergence: null,
      },
    };

    mockApi.get.mockResolvedValue(mockResponse);

    const { result, rerender } = renderHook(
      ({ userId }: { userId?: string | null }) => useFetchPriceGuess('property-123', userId),
      {
        initialProps: { userId: null },
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.userGuess).toBeNull();

    rerender({ userId: 'user-456' });

    await waitFor(() => {
      expect(result.current.data?.userGuess?.userId).toBe('user-456');
    });

    expect(mockApi.get).toHaveBeenCalledTimes(2);
  });

  it('returns distribution from API fmv response', async () => {
    const mockDistribution = {
      p10: 310000,
      p25: 325000,
      p50: 350000,
      p75: 375000,
      p90: 390000,
      min: 300000,
      max: 400000,
    };

    const mockResponse = {
      data: [
        { id: 'g1', propertyId: 'p1', userId: 'u1', guessedPrice: 300000, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'g2', propertyId: 'p1', userId: 'u2', guessedPrice: 350000, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'g3', propertyId: 'p1', userId: 'u3', guessedPrice: 400000, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      ],
      meta: { page: 1, limit: 100, total: 3, totalPages: 1 },
      fmv: {
        fmv: 350000,
        confidence: 'medium',
        guessCount: 3,
        distribution: mockDistribution,
        officialValuation: null,
        askingPrice: null,
        divergence: null,
      },
    };

    mockApi.get.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useFetchPriceGuess('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.fmv.distribution).toEqual(mockDistribution);
  });
});

describe('useSubmitGuess', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('mock-token');
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('calls api.post with auth headers', async () => {
    const mockResponse = {
      id: 'guess-new',
      propertyId: 'property-123',
      userId: 'user-456',
      guessedPrice: 350000,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      message: 'Guess submitted successfully',
    };

    mockApi.post.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useSubmitGuess(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        propertyId: 'property-123',
        guessedPrice: 350000,
      });
    });

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/properties/property-123/guesses',
        { guessedPrice: 350000 },
        {
          headers: {
            Authorization: 'Bearer mock-token',
          },
        }
      );
    });
  });

  it('throws when no access token is available', async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useSubmitGuess(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          propertyId: 'property-123',
          guessedPrice: 350000,
        })
      ).rejects.toThrow('Authentication required');
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockApi.post).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Submit guess error:',
      expect.objectContaining({
        message: 'Authentication required',
      }),
    );
  });

  it('returns mutation hook with expected methods', () => {
    const { result } = renderHook(() => useSubmitGuess(), {
      wrapper: createWrapper(),
    });

    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
    expect(result.current.isIdle).toBe(true);
  });
});
