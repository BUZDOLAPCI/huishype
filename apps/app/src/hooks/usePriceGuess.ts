import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../utils/api';

// Types matching the API response
export interface GuessUser {
  id: string;
  username: string;
  displayName: string | null;
  karma: number;
}

export interface PriceGuess {
  id: string;
  propertyId: string;
  userId: string;
  guessedPrice: number;
  createdAt: string;
  updatedAt: string;
  user?: GuessUser;
}

export interface FmvDistribution {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
}

export type FmvConfidence = 'none' | 'low' | 'medium' | 'high';

export interface FmvResponse {
  fmv: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  guessCount: number;
  distribution: FmvDistribution | null;
  wozValue: number | null;
  askingPrice: number | null;
  divergence: number | null;
}

export interface GuessListResponse {
  data: PriceGuess[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  fmv: FmvResponse;
}

export interface PriceGuessData {
  userGuess: PriceGuess | null;
  fmv: FmvResponse;
  canEdit: boolean;
  cooldownEndsAt: string | null;
  guesses: PriceGuess[];
}

export interface SubmitGuessParams {
  propertyId: string;
  guessedPrice: number;
}

export interface SubmitGuessResponse {
  id: string;
  propertyId: string;
  userId: string;
  guessedPrice: number;
  createdAt: string;
  updatedAt: string;
  message: string;
}

export interface CooldownError {
  error: 'COOLDOWN_ACTIVE';
  message: string;
  cooldownEndsAt: string;
}

// Query keys
export const guessKeys = {
  all: ['guesses'] as const,
  property: (propertyId: string) => [...guessKeys.all, propertyId] as const,
  userGuess: (propertyId: string, userId: string) =>
    [...guessKeys.property(propertyId), 'user', userId] as const,
};

// Cooldown period in milliseconds (5 days)
const COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000;

// Helper to check if cooldown has passed
function canEditGuess(guess: PriceGuess): boolean {
  const updatedAt = new Date(guess.updatedAt).getTime();
  const cooldownEnd = updatedAt + COOLDOWN_MS;
  return Date.now() >= cooldownEnd;
}

// Helper to get cooldown end date
function getCooldownEndDate(guess: PriceGuess): string | null {
  const updatedAt = new Date(guess.updatedAt).getTime();
  const cooldownEnd = updatedAt + COOLDOWN_MS;
  if (Date.now() >= cooldownEnd) return null;
  return new Date(cooldownEnd).toISOString();
}

/**
 * Hook to fetch price guess data for a property
 * Returns FMV statistics, user's guess, and cooldown status
 */
export function useFetchPriceGuess(propertyId: string | null, userId?: string | null) {
  return useQuery({
    queryKey: guessKeys.property(propertyId ?? ''),
    queryFn: async (): Promise<PriceGuessData> => {
      if (!propertyId) {
        return {
          userGuess: null,
          fmv: {
            fmv: null,
            confidence: 'none',
            guessCount: 0,
            distribution: null,
            wozValue: null,
            askingPrice: null,
            divergence: null,
          },
          canEdit: true,
          cooldownEndsAt: null,
          guesses: [],
        };
      }

      const response = await api.get<GuessListResponse>(
        `/properties/${propertyId}/guesses?limit=100`
      );

      const { data: guesses, fmv } = response;

      // Find user's guess if userId is provided
      const userGuess = userId
        ? guesses.find(g => g.userId === userId) ?? null
        : null;

      // Check cooldown status
      const canEdit = userGuess ? canEditGuess(userGuess) : true;
      const cooldownEndsAt = userGuess ? getCooldownEndDate(userGuess) : null;

      return {
        userGuess,
        fmv,
        canEdit,
        cooldownEndsAt,
        guesses,
      };
    },
    enabled: !!propertyId,
    staleTime: 30 * 1000, // 30 seconds
    retry: 2,
  });
}

/**
 * Hook to submit or update a price guess
 * Handles cooldown errors and invalidates queries on success
 */
export function useSubmitGuess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ propertyId, guessedPrice }: SubmitGuessParams): Promise<SubmitGuessResponse> => {
      const response = await api.post<SubmitGuessResponse>(
        `/properties/${propertyId}/guesses`,
        { guessedPrice }
      );
      return response;
    },
    onSuccess: (data, variables) => {
      // Invalidate queries to refetch fresh data
      queryClient.invalidateQueries({
        queryKey: guessKeys.property(variables.propertyId),
      });
      // Also invalidate property detail in case FMV changed
      queryClient.invalidateQueries({
        queryKey: ['properties', 'detail', variables.propertyId],
      });
    },
    onError: (error: Error & { cooldownEndsAt?: string }) => {
      // The error handling can be done by the component
      // We just re-throw for the component to handle
      console.error('Submit guess error:', error);
    },
  });
}

/**
 * Format remaining cooldown time as human-readable string
 */
export function formatCooldownRemaining(cooldownEndsAt: string): string {
  const endTime = new Date(cooldownEndsAt).getTime();
  const now = Date.now();
  const remainingMs = endTime - now;

  if (remainingMs <= 0) return 'now';

  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days > 0) {
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
