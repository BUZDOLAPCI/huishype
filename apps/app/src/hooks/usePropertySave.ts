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
import { getViewerCacheKey, propertyKeys } from './useProperties';
import { savedPropertyKeys } from './useSavedProperties';
import type { EnrichedProperty } from './usePropertyLike';

export interface UsePropertySaveOptions {
  propertyId: string | null;
  onAuthRequired?: () => void;
}

export interface UsePropertySaveReturn {
  isSaved: boolean;
  toggleSave: () => Promise<void>;
  isLoading: boolean;
}

class PropertySaveMutationError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'PropertySaveMutationError';
    this.status = status;
    this.code = code;
  }
}

interface SaveMutationContext {
  key: ReturnType<typeof propertyKeys.detail>;
  previous?: EnrichedProperty;
  optimistic?: EnrichedProperty;
}

function isRecoverableSaveConflict(error: unknown, nextSaved: boolean): boolean {
  if (!(error instanceof PropertySaveMutationError)) {
    return false;
  }

  if (nextSaved) {
    return error.status === 409 || error.code === 'ALREADY_SAVED';
  }

  return error.status === 404 || error.code === 'NOT_FOUND';
}

function reconcileSavedState(
  queryClient: ReturnType<typeof useQueryClient>,
  propertyId: string,
  viewerKey: string,
  isSaved: boolean,
): void {
  const key = propertyKeys.detail(propertyId, viewerKey);
  const current = queryClient.getQueryData<EnrichedProperty>(key);

  if (!current) {
    return;
  }

  queryClient.setQueryData<EnrichedProperty>(key, {
    ...current,
    isSaved,
  });
}

async function saveProperty(propertyId: string, accessToken: string): Promise<{ saved: boolean }> {
  const response = await fetch(`${API_URL}/properties/${propertyId}/save`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to save property' }));
    throw new PropertySaveMutationError(
      response.status,
      error.message || `HTTP error! status: ${response.status}`,
      error.error,
    );
  }

  return response.json();
}

async function unsaveProperty(propertyId: string, accessToken: string): Promise<{ saved: boolean }> {
  const response = await fetch(`${API_URL}/properties/${propertyId}/save`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to unsave property' }));
    throw new PropertySaveMutationError(
      response.status,
      error.message || `HTTP error! status: ${response.status}`,
      error.error,
    );
  }

  return response.json();
}

export function usePropertySave({
  propertyId,
  onAuthRequired,
}: UsePropertySaveOptions): UsePropertySaveReturn {
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

  const isSaved = cachedProperty?.isSaved ?? false;

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: ({ propId, token }: { propId: string; token: string }) =>
      saveProperty(propId, token),
    onMutate: async ({ propId }) => {
      const key = propertyKeys.detail(propId, viewerKey);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EnrichedProperty>(key);
      const optimistic = previous
        ? {
            ...previous,
            isSaved: true,
          }
        : undefined;

      // Optimistic update
      if (optimistic) {
        queryClient.setQueryData<EnrichedProperty>(key, optimistic);
      }

      return { previous, key, optimistic };
    },
    onError: (error, _vars, context?: SaveMutationContext) => {
      if (!context?.key) {
        return;
      }

      if (context.optimistic && isRecoverableSaveConflict(error, true)) {
        queryClient.setQueryData(context.key, context.optimistic);
        return;
      }

      if (context.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSuccess: (data, { propId }) => {
      reconcileSavedState(queryClient, propId, viewerKey, data.saved);
    },
    onSettled: async (_data, _error, { propId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: propertyKeys.detailBase(propId) }),
        queryClient.invalidateQueries({ queryKey: savedPropertyKeys.all }),
      ]);
    },
  });

  // Unsave mutation
  const unsaveMutation = useMutation({
    mutationFn: ({ propId, token }: { propId: string; token: string }) =>
      unsaveProperty(propId, token),
    onMutate: async ({ propId }) => {
      const key = propertyKeys.detail(propId, viewerKey);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EnrichedProperty>(key);
      const optimistic = previous
        ? {
            ...previous,
            isSaved: false,
          }
        : undefined;

      // Optimistic update
      if (optimistic) {
        queryClient.setQueryData<EnrichedProperty>(key, optimistic);
      }

      return { previous, key, optimistic };
    },
    onError: (error, _vars, context?: SaveMutationContext) => {
      if (!context?.key) {
        return;
      }

      if (context.optimistic && isRecoverableSaveConflict(error, false)) {
        queryClient.setQueryData(context.key, context.optimistic);
        return;
      }

      if (context.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSuccess: (data, { propId }) => {
      reconcileSavedState(queryClient, propId, viewerKey, data.saved);
    },
    onSettled: async (_data, _error, { propId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: propertyKeys.detailBase(propId) }),
        queryClient.invalidateQueries({ queryKey: savedPropertyKeys.all }),
      ]);
    },
  });

  const toggleSave = useCallback(async () => {
    if (!propertyId) return;

    // Auth gate
    if (!user) {
      onAuthRequired?.();
      return;
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      onAuthRequired?.();
      return;
    }

    try {
      if (isSaved) {
        await unsaveMutation.mutateAsync({ propId: propertyId, token: accessToken });
        return;
      }

      await saveMutation.mutateAsync({ propId: propertyId, token: accessToken });
    } catch {
      // Errors are reflected through mutation state and rollback logic.
    }
  }, [
    propertyId,
    user,
    getAccessToken,
    isSaved,
    onAuthRequired,
    saveMutation,
    unsaveMutation,
  ]);

  return {
    isSaved,
    toggleSave,
    isLoading: saveMutation.isPending || unsaveMutation.isPending,
  };
}

export default usePropertySave;
