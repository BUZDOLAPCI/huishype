import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';

type QueryCacheEvent = Parameters<ReturnType<QueryClient['getQueryCache']>['subscribe']>[0] extends (
  event: infer TEvent
) => void
  ? TEvent
  : never;

function isRelevantQueryCacheEvent(event: QueryCacheEvent, queryHash: string): boolean {
  return (
    event.query.queryHash === queryHash &&
    (event.type === 'updated' || event.type === 'removed')
  );
}

export function useExactQueryCacheValue<TData>(
  queryClient: QueryClient,
  queryKey: QueryKey | null
): TData | undefined {
  const queryHash = useMemo(() => (queryKey ? hashKey(queryKey) : null), [queryKey]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!queryHash) {
        return () => {};
      }

      return queryClient.getQueryCache().subscribe((event) => {
        if (isRelevantQueryCacheEvent(event, queryHash)) {
          onStoreChange();
        }
      });
    },
    [queryClient, queryHash]
  );

  const getSnapshot = useCallback(
    () => (queryKey ? queryClient.getQueryData<TData>(queryKey) : undefined),
    [queryClient, queryKey]
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
