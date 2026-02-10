/**
 * usePropertySave Hook
 * Provides save/unsave functionality for properties with optimistic updates.
 *
 * Reads initial isSaved from the property detail query cache
 * (GET /properties/:id response). Auth gating is handled inside the hook.
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';
import { propertyKeys } from './useProperties';
import type { EnrichedProperty } from './usePropertyLike';

export interface UsePropertySaveOptions {
  propertyId: string | null;
  onAuthRequired?: () => void;
}

export interface UsePropertySaveReturn {
  isSaved: boolean;
  toggleSave: () => void;
  isLoading: boolean;
}

async function saveProperty(propertyId: string, userId: string): Promise<{ saved: boolean }> {
  const response = await fetch(`${API_URL}/properties/${propertyId}/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to save property' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

async function unsaveProperty(propertyId: string, userId: string): Promise<{ saved: boolean }> {
  const response = await fetch(`${API_URL}/properties/${propertyId}/save`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to unsave property' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export function usePropertySave({
  propertyId,
  onAuthRequired,
}: UsePropertySaveOptions): UsePropertySaveReturn {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();

  // Subscribe to the property detail query cache reactively
  const queryKey = propertyId ? propertyKeys.detail(propertyId) : ['__noop__'];
  const { data: cachedProperty } = useQuery<EnrichedProperty>({
    queryKey,
    queryFn: () => Promise.reject(new Error('noop')),
    enabled: false, // Never fetch — just subscribe to cache updates from setQueryData
  });

  const isSaved = cachedProperty?.isSaved ?? false;

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: ({ propId, userId }: { propId: string; userId: string }) =>
      saveProperty(propId, userId),
    onMutate: async ({ propId }) => {
      const key = propertyKeys.detail(propId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EnrichedProperty>(key);

      // Optimistic update
      if (previous) {
        queryClient.setQueryData<EnrichedProperty>(key, {
          ...previous,
          isSaved: true,
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

  // Unsave mutation
  const unsaveMutation = useMutation({
    mutationFn: ({ propId, userId }: { propId: string; userId: string }) =>
      unsaveProperty(propId, userId),
    onMutate: async ({ propId }) => {
      const key = propertyKeys.detail(propId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EnrichedProperty>(key);

      // Optimistic update
      if (previous) {
        queryClient.setQueryData<EnrichedProperty>(key, {
          ...previous,
          isSaved: false,
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

  const toggleSave = useCallback(() => {
    if (!propertyId) return;

    // Auth gate
    if (!user) {
      onAuthRequired?.();
      return;
    }

    if (isSaved) {
      unsaveMutation.mutate({ propId: propertyId, userId: user.id });
    } else {
      saveMutation.mutate({ propId: propertyId, userId: user.id });
    }
  }, [propertyId, user, isSaved, onAuthRequired, saveMutation, unsaveMutation]);

  return {
    isSaved,
    toggleSave,
    isLoading: saveMutation.isPending || unsaveMutation.isPending,
  };
}

export default usePropertySave;
