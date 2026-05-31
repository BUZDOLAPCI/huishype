import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { AddressSearchBias } from '@/src/services/address-resolver';

export interface MapSearchBiasContextValue {
  mapSearchBias: AddressSearchBias | null;
  setMapSearchBias: (bias: AddressSearchBias) => void;
}

function areSearchBiasesEqual(
  left: AddressSearchBias | null,
  right: AddressSearchBias
): boolean {
  return (
    left?.lon === right.lon &&
    left?.lat === right.lat &&
    (left?.countryCode ?? null) === (right.countryCode ?? null)
  );
}

export const MapSearchBiasContext = createContext<MapSearchBiasContextValue | null>(null);

const FALLBACK_CONTEXT: MapSearchBiasContextValue = {
  mapSearchBias: null,
  setMapSearchBias: () => {},
};

export function useLocalMapSearchBias(): MapSearchBiasContextValue {
  const [mapSearchBias, setStoredMapSearchBias] = useState<AddressSearchBias | null>(null);

  const setMapSearchBias = useCallback((bias: AddressSearchBias) => {
    setStoredMapSearchBias((current) => {
      if (areSearchBiasesEqual(current, bias)) {
        return current;
      }

      return bias;
    });
  }, []);

  return useMemo(
    () => ({
      mapSearchBias,
      setMapSearchBias,
    }),
    [mapSearchBias, setMapSearchBias]
  );
}

export function useMapSearchBias(): MapSearchBiasContextValue {
  return useContext(MapSearchBiasContext) ?? FALLBACK_CONTEXT;
}
