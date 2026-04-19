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
  return doesMapFilterCandidateMatch(
    {
      askingPrice: selectedProperty?.askingPrice ?? previewProperty?.askingPrice ?? null,
      officialValuation:
        selectedProperty?.officialValuation ?? previewProperty?.officialValuation ?? null,
      canonicalFmv:
        typeof selectedProperty?.fmv === 'number'
          ? selectedProperty.fmv
          : selectedProperty?.fmv?.fmv ?? previewProperty?.fmv ?? null,
      marketState: selectedProperty?.marketState ?? previewProperty?.marketState ?? null,
      hasActiveListing:
        selectedProperty?.hasActiveListing ?? previewProperty?.hasActiveListing ?? null,
      socialScore: selectedProperty?.socialScore ?? previewProperty?.socialScore ?? null,
      recentSocialScore:
        selectedProperty?.recentSocialScore ?? previewProperty?.recentSocialScore ?? null,
    },
    filters,
  );
}
