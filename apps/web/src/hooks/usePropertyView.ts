import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { api } from '../utils/api';

interface ViewResponse {
  viewCount: number;
  uniqueViewers: number;
}

const recordView = async (propertyId: string): Promise<ViewResponse> => {
  return api.post<ViewResponse>(`/properties/${propertyId}/view`, {});
};

/**
 * Hook to record property views with client-side dedup.
 * Fires at most once per property per session.
 */
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
