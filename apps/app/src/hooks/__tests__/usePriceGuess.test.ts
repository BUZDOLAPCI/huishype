import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import {
  useFetchPriceGuess,
  useSubmitGuess,
  getFMVConfidence,
  formatCooldownRemaining,
  guessKeys,
} from '../usePriceGuess';
import { api } from '../../utils/api';

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
    expect(guessKeys.userGuess('property-123', 'user-456')).toEqual([
      'guesses',
      'property-123',
      'user',
      'user-456',
    ]);
  });
});

describe('getFMVConfidence', () => {
  it('returns low confidence for less than 3 guesses', () => {
    expect(getFMVConfidence(0)).toBe('low');
    expect(getFMVConfidence(1)).toBe('low');
    expect(getFMVConfidence(2)).toBe('low');
  });

  it('returns medium confidence for 3-9 guesses', () => {
    expect(getFMVConfidence(3)).toBe('medium');
    expect(getFMVConfidence(5)).toBe('medium');
    expect(getFMVConfidence(9)).toBe('medium');
  });

  it('returns high confidence for 10+ guesses', () => {
    expect(getFMVConfidence(10)).toBe('high');
    expect(getFMVConfidence(50)).toBe('high');
    expect(getFMVConfidence(100)).toBe('high');
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
      stats: {
        averageGuess: 350000,
        medianGuess: 350000,
        totalGuesses: 1,
        estimatedFMV: 350000,
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
    expect(result.current.data?.stats.totalGuesses).toBe(1);
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
      stats: {
        averageGuess: 350000,
        medianGuess: 350000,
        totalGuesses: 1,
        estimatedFMV: 350000,
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
  });

  it('calculates distribution from guesses', async () => {
    const mockResponse = {
      data: [
        { id: 'g1', propertyId: 'p1', userId: 'u1', guessedPrice: 300000, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'g2', propertyId: 'p1', userId: 'u2', guessedPrice: 350000, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 'g3', propertyId: 'p1', userId: 'u3', guessedPrice: 400000, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      ],
      meta: { page: 1, limit: 100, total: 3, totalPages: 1 },
      stats: {
        averageGuess: 350000,
        medianGuess: 350000,
        totalGuesses: 3,
        estimatedFMV: 350000,
      },
    };

    mockApi.get.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useFetchPriceGuess('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.distribution).toEqual({
      min: 300000,
      max: 400000,
      median: 350000,
    });
  });
});

describe('useSubmitGuess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls api.post with correct parameters', async () => {
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
        { guessedPrice: 350000 }
      );
    });
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
