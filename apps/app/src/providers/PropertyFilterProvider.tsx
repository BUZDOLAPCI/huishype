import React, { type ReactNode } from 'react';

import {
  MapFilterControllerContext,
  useLocalMapFilterController,
} from '@/src/hooks/useMapFilterController';
import { MapSearchBiasContext, useLocalMapSearchBias } from '@/src/hooks/useMapSearchBias';

interface PropertyFilterProviderProps {
  children: ReactNode;
}

export function PropertyFilterProvider({ children }: PropertyFilterProviderProps) {
  const controller = useLocalMapFilterController();
  const mapSearchBias = useLocalMapSearchBias();

  return (
    <MapFilterControllerContext.Provider value={controller}>
      <MapSearchBiasContext.Provider value={mapSearchBias}>
        {children}
      </MapSearchBiasContext.Provider>
    </MapFilterControllerContext.Provider>
  );
}
