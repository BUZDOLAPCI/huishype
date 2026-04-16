import type { GroupPreviewProperty } from '@/src/components/GroupPreviewCard';
import type { PropertyDetails } from '@/src/hooks/useProperties';
import {
  doesMapFilterCandidateMatch,
  type MapFilters,
} from '@/src/lib/sharedMapFilters';

interface SelectionMatchCandidate {
  previewProperty: GroupPreviewProperty | null;
  selectedProperty: PropertyDetails | null;
  filters: MapFilters;
}

export function doesMapSelectionMatchFilters({
  previewProperty,
  selectedProperty,
  filters,
}: SelectionMatchCandidate): boolean {
  const hasListing =
    selectedProperty?.hasListing ??
    (previewProperty?.askingPrice != null ? true : null);

  return doesMapFilterCandidateMatch(
    {
      askingPrice: selectedProperty?.askingPrice ?? previewProperty?.askingPrice ?? null,
      officialValuation:
        selectedProperty?.officialValuation ?? previewProperty?.officialValuation ?? null,
      canonicalFmv:
        typeof selectedProperty?.fmv === 'number'
          ? selectedProperty.fmv
          : selectedProperty?.fmv?.fmv ?? previewProperty?.fmv ?? null,
      hasListing,
    },
    filters,
  );
}
