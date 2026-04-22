import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getAnonymousSessionId } from '../lib/anonymousSession';
import { useAuthContext } from '../providers/AuthProvider';
import { api } from '../utils/api';
import { bumpReadTileSourceVersion } from './readTileSourceInvalidation';

interface ViewResponse {
  viewCount: number;
  uniqueViewers: number;
}

/**
 * Hook to record property views with client-side dedup.
 * Fires at most once per property for the active viewer runtime.
 */
const viewedPropertiesByViewer = new Map<string, Set<string>>();
const pendingPropertyViews = new Set<string>();

function getViewedProperties(viewerKey: string): Set<string> {
  let viewedProperties = viewedPropertiesByViewer.get(viewerKey);
  if (!viewedProperties) {
    viewedProperties = new Set<string>();
    viewedPropertiesByViewer.set(viewerKey, viewedProperties);
  }

  return viewedProperties;
}

function getViewerKey(isAuthenticated: boolean, userId: string | null, sessionId: string | null): string {
  if (isAuthenticated && userId) {
    return `auth:${userId}`;
  }

  return `anon:${sessionId ?? 'missing'}`;
}

export function __resetPropertyViewTrackingForTests(): void {
  viewedPropertiesByViewer.clear();
  pendingPropertyViews.clear();
}

const recordView = async (
  propertyId: string,
  sessionId: string | null,
): Promise<ViewResponse> => {
  const headers = new Headers();

  if (sessionId) {
    headers.set('x-session-id', sessionId);
  }

  return api.post<ViewResponse>(`/properties/${propertyId}/view`, {}, { headers });
};

export function usePropertyView() {
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthContext();

  const mutation = useMutation({
    mutationFn: ({ propertyId, sessionId }: { propertyId: string; sessionId: string | null }) =>
      recordView(propertyId, sessionId),
    onSuccess: () => {
      bumpReadTileSourceVersion(queryClient);
    },
  });

  const recordPropertyView = useCallback((propertyId: string) => {
    void (async () => {
      const sessionId = isAuthenticated ? null : await getAnonymousSessionId();
      const viewerKey = getViewerKey(isAuthenticated, user?.id ?? null, sessionId);
      const viewedProperties = getViewedProperties(viewerKey);
      const pendingKey = `${viewerKey}:${propertyId}`;

      if (viewedProperties.has(propertyId) || pendingPropertyViews.has(pendingKey)) {
        return;
      }

      pendingPropertyViews.add(pendingKey);
      mutation.mutate(
        { propertyId, sessionId },
        {
          onSuccess: () => {
            viewedProperties.add(propertyId);
          },
          onSettled: () => {
            pendingPropertyViews.delete(pendingKey);
          },
        },
      );
    })();
  }, [isAuthenticated, mutation, user?.id]);

  return { recordPropertyView };
}
