/**
 * usePropertyLike Hook
 * Provides like/unlike functionality for properties with optimistic updates.
 *
 * Reads initial isLiked and likeCount from the property detail query cache
 * (GET /properties/:id response). Auth gating is handled inside the hook.
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';
import { getViewerCacheKey, propertyKeys, type Property } from './useProperties';

export interface UsePropertyLikeOptions {
  propertyId: string | null;
  onAuthRequired?: () => void;
}

export interface UsePropertyLikeReturn {
  isLiked: boolean;
  likeCount: number;
  toggleLike: () => void;
  isLoading: boolean;
}

/** Shape of the enriched property returned by GET /properties/:id */
export interface EnrichedProperty extends Property {
  isLiked?: boolean;
  likeCount?: number;
  isSaved?: boolean;
}

class PropertyLikeMutationError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'PropertyLikeMutationError';
    this.status = status;
    this.code = code;
  }
}

interface LikeMutationContext {
  key: ReturnType<typeof propertyKeys.detail>;
  previous?: EnrichedProperty;
  optimistic?: EnrichedProperty;
}

function isRecoverableLikeConflict(error: unknown, nextLiked: boolean): boolean {
  if (!(error instanceof PropertyLikeMutationError)) {
    return false;
  }

  if (nextLiked) {
    return error.status === 409 || error.code === 'ALREADY_LIKED';
  }

  return error.status === 404 || error.code === 'NOT_FOUND';
}

async function likeProperty(propertyId: string, accessToken: string): Promise<{ liked: boolean; likeCount: number }> {
  const response = await fetch(`${API_URL}/properties/${propertyId}/like`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to like property' }));
    throw new PropertyLikeMutationError(
      response.status,
      error.message || `HTTP error! status: ${response.status}`,
      error.error,
    );
  }

  return response.json();
}

async function unlikeProperty(propertyId: string, accessToken: string): Promise<{ liked: boolean; likeCount: number }> {
  const response = await fetch(`${API_URL}/properties/${propertyId}/like`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to unlike property' }));
    throw new PropertyLikeMutationError(
      response.status,
      error.message || `HTTP error! status: ${response.status}`,
      error.error,
    );
  }

  return response.json();
}

export function usePropertyLike({
  propertyId,
  onAuthRequired,
}: UsePropertyLikeOptions): UsePropertyLikeReturn {
  const queryClient = useQueryClient();
  const { user, getAccessToken, isAuthenticated } = useAuthContext();
  const viewerKey = getViewerCacheKey(user, isAuthenticated);

  // Subscribe to the property detail query cache reactively
  const queryKey = propertyId ? propertyKeys.detail(propertyId, viewerKey) : ['__noop__'];
  const { data: cachedProperty } = useQuery<EnrichedProperty>({
    queryKey,
    queryFn: () => Promise.reject(new Error('noop')),
    enabled: false, // Never fetch — just subscribe to cache updates from setQueryData
  });

  const isLiked = cachedProperty?.isLiked ?? false;
  const likeCount = cachedProperty?.likeCount ?? 0;

  // Like mutation
  const likeMutation = useMutation({
    mutationFn: ({ propId, token }: { propId: string; token: string }) =>
      likeProperty(propId, token),
    onMutate: async ({ propId }) => {
      const key = propertyKeys.detail(propId, viewerKey);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EnrichedProperty>(key);
      const optimistic = previous
        ? {
            ...previous,
            isLiked: true,
            likeCount: (previous.likeCount ?? 0) + 1,
          }
        : undefined;

      // Optimistic update
      if (optimistic) {
        queryClient.setQueryData<EnrichedProperty>(key, optimistic);
      }

      return { previous, key, optimistic };
    },
    onError: (error, _vars, context?: LikeMutationContext) => {
      if (!context?.key) {
        return;
      }

      if (context.optimistic && isRecoverableLikeConflict(error, true)) {
        queryClient.setQueryData(context.key, context.optimistic);
        return;
      }

      if (context.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: (_data, _error, { propId }) => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.detailBase(propId) });
    },
  });

  // Unlike mutation
  const unlikeMutation = useMutation({
    mutationFn: ({ propId, token }: { propId: string; token: string }) =>
      unlikeProperty(propId, token),
    onMutate: async ({ propId }) => {
      const key = propertyKeys.detail(propId, viewerKey);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EnrichedProperty>(key);
      const optimistic = previous
        ? {
            ...previous,
            isLiked: false,
            likeCount: Math.max((previous.likeCount ?? 0) - 1, 0),
          }
        : undefined;

      // Optimistic update
      if (optimistic) {
        queryClient.setQueryData<EnrichedProperty>(key, optimistic);
      }

      return { previous, key, optimistic };
    },
    onError: (error, _vars, context?: LikeMutationContext) => {
      if (!context?.key) {
        return;
      }

      if (context.optimistic && isRecoverableLikeConflict(error, false)) {
        queryClient.setQueryData(context.key, context.optimistic);
        return;
      }

      if (context.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: (_data, _error, { propId }) => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.detailBase(propId) });
    },
  });

  const toggleLike = useCallback(() => {
    if (!propertyId) return;

    void (async () => {
      if (!user) {
        onAuthRequired?.();
        return;
      }

      const accessToken = await getAccessToken();
      if (!accessToken) {
        onAuthRequired?.();
        return;
      }

      if (isLiked) {
        unlikeMutation.mutate({ propId: propertyId, token: accessToken });
      } else {
        likeMutation.mutate({ propId: propertyId, token: accessToken });
      }
    })();
  }, [propertyId, user, getAccessToken, isLiked, onAuthRequired, likeMutation, unlikeMutation]);

  return {
    isLiked,
    likeCount,
    toggleLike,
    isLoading: likeMutation.isPending || unlikeMutation.isPending,
  };
}

export default usePropertyLike;
