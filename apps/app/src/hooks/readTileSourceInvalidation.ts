import type { QueryClient } from '@tanstack/react-query';

export const readTileSourceKeys = {
  version: ['properties', 'read-overlay-version'] as const,
  sourceRoot: ['properties', 'read-overlay-source'] as const,
};

export function bumpReadTileSourceVersion(queryClient: QueryClient): void {
  queryClient.setQueryData<number>(readTileSourceKeys.version, (current) =>
    typeof current === 'number' ? current + 1 : 1,
  );
  void queryClient.invalidateQueries({
    queryKey: readTileSourceKeys.sourceRoot,
    refetchType: 'active',
  });
}
