import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { getAnonymousSessionId } from '../lib/anonymousSession';
import { api } from '../utils/api';

interface ViewResponse {
  viewCount: number;
  uniqueViewers: number;
}

/**
 * Hook to record property views with client-side dedup.
 * Fires at most once per property per session.
 */
const recordView = async (propertyId: string): Promise<ViewResponse> => {
  const sessionId = await getAnonymousSessionId();
  const headers = new Headers();

  if (sessionId) {
    headers.set('x-session-id', sessionId);
  }

  return api.post<ViewResponse>(`/properties/${propertyId}/view`, {}, { headers });
};

export function usePropertyView() {
  const viewedSet = useRef(new Set<string>());

  const mutation = useMutation({
    mutationFn: recordView,
  });

  const recordPropertyView = (propertyId: string) => {
    if (viewedSet.current.has(propertyId)) return;
    viewedSet.current.add(propertyId);
    mutation.mutate(propertyId);
  };

  return { recordPropertyView };
}
