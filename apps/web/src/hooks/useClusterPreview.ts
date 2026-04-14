import { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import type { Property } from './useProperties';
import { PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared/config';

const LARGE_CLUSTER_THRESHOLD = PROPERTY_PREVIEW_MEMBER_LIMIT;

export interface UseClusterPreviewReturn {
  clusterProperties: Property[];
  currentClusterIndex: number;
  isClusterPreview: boolean;
  isLoading: boolean;
  openClusterPreview: (propertyIds: string[]) => Promise<void>;
  closeClusterPreview: () => void;
  setCurrentClusterIndex: (index: number) => void;
  handleClusterPropertyPress: (property: Property) => void;
}

export interface UseClusterPreviewOptions {
  /** Called when a property is selected from the cluster preview */
  onPropertySelect?: (property: Property) => void;
}

/**
 * Shared hook for cluster preview functionality.
 * Manages batch-fetching property data and cluster navigation state.
 * Used by both web (index.web.tsx) and native (index.tsx) map screens.
 */
export function useClusterPreview(
  options: UseClusterPreviewOptions = {}
): UseClusterPreviewReturn {
  const { onPropertySelect } = options;
  const [clusterProperties, setClusterProperties] = useState<Property[]>([]);
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0);
  const [isClusterPreview, setIsClusterPreview] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const openClusterPreview = useCallback(async (propertyIds: string[]) => {
    if (propertyIds.length === 0) return;

    setIsLoading(true);
    try {
      const ids = propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT).join(',');
      const properties = await apiFetch<Property[]>(`/properties/batch?ids=${ids}`);
      if (properties.length > 0) {
        setClusterProperties(properties);
        setCurrentClusterIndex(0);
        setIsClusterPreview(true);
      }
    } catch (err) {
      console.warn('[HuisHype] Failed to fetch cluster properties:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const closeClusterPreview = useCallback(() => {
    setIsClusterPreview(false);
    setClusterProperties([]);
    setCurrentClusterIndex(0);
  }, []);

  const handleClusterPropertyPress = useCallback(
    (property: Property) => {
      setIsClusterPreview(false);
      onPropertySelect?.(property);
    },
    [onPropertySelect]
  );

  return {
    clusterProperties,
    currentClusterIndex,
    isClusterPreview,
    isLoading,
    openClusterPreview,
    closeClusterPreview,
    setCurrentClusterIndex,
    handleClusterPropertyPress,
  };
}

export { LARGE_CLUSTER_THRESHOLD };
