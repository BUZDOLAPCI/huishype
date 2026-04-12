import { type QueryClient } from '@tanstack/react-query';

import type { PropertyDetails } from '@/src/hooks/useProperties';
import { withDerivedPropertyImageData } from '@/src/utils/property-image';

export function primePropertyDetailCache(
  queryClient: QueryClient,
  property: PropertyDetails,
): void {
  queryClient.setQueryData(
    ['properties', 'detail', property.id],
    withDerivedPropertyImageData(property),
  );
}
