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
import { propertyKeys, type Property } from './useProperties';

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

async function likeProperty(propertyId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
  const response = await fetch(`${API_URL}/properties/${propertyId}/like`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to like property' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

async function unlikeProperty(propertyId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
  const response = await fetch(`${API_URL}/properties/${propertyId}/like`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to unlike property' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export function usePropertyLike({
  propertyId,
  onAuthRequired,
}: UsePropertyLikeOptions): UsePropertyLikeReturn {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();

  // Subscribe to the property detail query cache reactively
  const queryKey = propertyId ? propertyKeys.detail(propertyId) : ['__noop__'];
  const { data: cachedProperty } = useQuery<EnrichedProperty>({
    queryKey,
    queryFn: () => Promise.reject(new Error('noop')),
    enabled: false, // Never fetch — just subscribe to cache updates from setQueryData
  });

  const isLiked = cachedProperty?.isLiked ?? false;
  const likeCount = cachedProperty?.likeCount ?? 0;

  // Like mutation
  const likeMutation = useMutation({
    mutationFn: ({ propId, userId }: { propId: string; userId: string }) =>
      likeProperty(propId, userId),
    onMutate: async ({ propId }) => {
      const key = propertyKeys.detail(propId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EnrichedProperty>(key);

      // Optimistic update
      if (previous) {
        queryClient.setQueryData<EnrichedProperty>(key, {
          ...previous,
          isLiked: true,
          likeCount: (previous.likeCount ?? 0) + 1,
        });
      }

      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      // Rollback
      if (context?.previous && context.key) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: (_data, _error, { propId }) => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.detail(propId) });
    },
  });

  // Unlike mutation
  const unlikeMutation = useMutation({
    mutationFn: ({ propId, userId }: { propId: string; userId: string }) =>
      unlikeProperty(propId, userId),
    onMutate: async ({ propId }) => {
      const key = propertyKeys.detail(propId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EnrichedProperty>(key);

      // Optimistic update
      if (previous) {
        queryClient.setQueryData<EnrichedProperty>(key, {
          ...previous,
          isLiked: false,
          likeCount: Math.max((previous.likeCount ?? 0) - 1, 0),
        });
      }

      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      // Rollback
      if (context?.previous && context.key) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: (_data, _error, { propId }) => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.detail(propId) });
    },
  });

  const toggleLike = useCallback(() => {
    if (!propertyId) return;

    // Auth gate
    if (!user) {
      onAuthRequired?.();
      return;
    }

    if (isLiked) {
      unlikeMutation.mutate({ propId: propertyId, userId: user.id });
    } else {
      likeMutation.mutate({ propId: propertyId, userId: user.id });
    }
  }, [propertyId, user, isLiked, onAuthRequired, likeMutation, unlikeMutation]);

  return {
    isLiked,
    likeCount,
    toggleLike,
    isLoading: likeMutation.isPending || unlikeMutation.isPending,
  };
}

export default usePropertyLike;
