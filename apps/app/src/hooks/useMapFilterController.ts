import { useCallback, useMemo, useState } from 'react';
import {
  areMapFiltersEqual,
  createDefaultMapFilters,
  createMapFilterDraftState,
  getOrderedMapFilterCategories,
  normalizeMapFilters,
  parseDraftNumber,
  resetMapFilterCategory,
  sanitizeDraftNumber,
  toggleMapActivityFilter,
  toggleMapStatusPill,
  type MapActivityFilter,
  type MapFilterCategory,
  type MapFilterDraftState,
  type MapFilters,
  type MapPriceMode,
  type MapStatusPillState,
} from '@/src/lib/sharedMapFilters';

export interface UseMapFilterControllerOptions {
  initialAppliedFilters?: MapFilters;
  onAppliedFiltersChange?: (filters: MapFilters) => void;
}

export interface UseMapFilterControllerReturn {
  appliedFilters: MapFilters;
  draftFilters: MapFilterDraftState;
  openCategory: MapFilterCategory | null;
  orderedCategories: MapFilterCategory[];
  replaceAppliedFilters: (filters: MapFilters) => void;
  toggleCategory: (category: MapFilterCategory) => void;
  closeCategoryPanel: () => void;
  dismissCategory: (category: MapFilterCategory) => void;
  updatePriceDraft: (
    mode: MapPriceMode,
    bound: 'from' | 'to',
    value: string,
  ) => void;
  selectPriceSuggestion: (
    mode: MapPriceMode,
    bound: 'from' | 'to',
    value: string,
  ) => void;
  commitPriceDraft: () => void;
  toggleStatusPill: (value: MapStatusPillState) => void;
  toggleActivity: (value: Exclude<MapActivityFilter, 'all'>) => void;
  setActivity: (value: MapActivityFilter) => void;
}

export function useMapFilterController({
  initialAppliedFilters,
  onAppliedFiltersChange,
}: UseMapFilterControllerOptions = {}): UseMapFilterControllerReturn {
  const [appliedFilters, setAppliedFilters] = useState<MapFilters>(() =>
    normalizeMapFilters(initialAppliedFilters ?? createDefaultMapFilters()),
  );
  const [draftFilters, setDraftFilters] = useState<MapFilterDraftState>(() =>
    createMapFilterDraftState(initialAppliedFilters ?? createDefaultMapFilters()),
  );
  const [openCategory, setOpenCategory] = useState<MapFilterCategory | null>(null);

  const orderedCategories = useMemo(
    () => getOrderedMapFilterCategories(appliedFilters),
    [appliedFilters],
  );

  const applyFilters = useCallback(
    (nextFilters: MapFilters) => {
      const normalized = normalizeMapFilters(nextFilters);
      setDraftFilters(createMapFilterDraftState(normalized));
      setAppliedFilters((current: MapFilters) => {
        if (areMapFiltersEqual(current, normalized)) {
          return current;
        }

        onAppliedFiltersChange?.(normalized);
        return normalized;
      });
    },
    [onAppliedFiltersChange],
  );

  const replaceAppliedFilters = useCallback(
    (nextFilters: MapFilters) => {
      const normalized = normalizeMapFilters(nextFilters);
      setAppliedFilters(normalized);
      setDraftFilters(createMapFilterDraftState(normalized));
    },
    [],
  );

  const toggleCategory = useCallback(
    (category: MapFilterCategory) => {
      setOpenCategory((current: MapFilterCategory | null) =>
        current === category ? null : category,
      );
      setDraftFilters(createMapFilterDraftState(appliedFilters));
    },
    [appliedFilters],
  );

  const dismissCategory = useCallback(
    (category: MapFilterCategory) => {
      applyFilters(resetMapFilterCategory(appliedFilters, category));
      setOpenCategory((current: MapFilterCategory | null) =>
        current === category ? null : current,
      );
    },
    [appliedFilters, applyFilters],
  );

  const closeCategoryPanel = useCallback(() => {
    setOpenCategory(null);
  }, []);

  const updatePriceDraft = useCallback(
    (
      mode: MapPriceMode,
      bound: 'from' | 'to',
      value: string,
    ) => {
      const sanitized = sanitizeDraftNumber(value);
      setDraftFilters((current: MapFilterDraftState) => {
        if (mode === 'sale') {
          return {
            ...current,
            salePriceFrom: bound === 'from' ? sanitized : current.salePriceFrom,
            salePriceTo: bound === 'to' ? sanitized : current.salePriceTo,
          };
        }

        return {
          ...current,
          rentPriceFrom: bound === 'from' ? sanitized : current.rentPriceFrom,
          rentPriceTo: bound === 'to' ? sanitized : current.rentPriceTo,
        };
      });
    },
    [],
  );

  const selectPriceSuggestion = useCallback(
    (
      mode: MapPriceMode,
      bound: 'from' | 'to',
      value: string,
    ) => {
      updatePriceDraft(mode, bound, value);
    },
    [updatePriceDraft],
  );

  const commitPriceDraft = useCallback(
    () => {
      applyFilters({
        ...appliedFilters,
        salePriceFrom: parseDraftNumber(draftFilters.salePriceFrom),
        salePriceTo: parseDraftNumber(draftFilters.salePriceTo),
        rentPriceFrom: parseDraftNumber(draftFilters.rentPriceFrom),
        rentPriceTo: parseDraftNumber(draftFilters.rentPriceTo),
      });
    },
    [appliedFilters, applyFilters, draftFilters],
  );

  const toggleStatusPill = useCallback(
    (value: MapStatusPillState) => {
      applyFilters(toggleMapStatusPill(appliedFilters, value));
    },
    [appliedFilters, applyFilters],
  );

  const toggleActivity = useCallback(
    (value: Exclude<MapActivityFilter, 'all'>) => {
      applyFilters(toggleMapActivityFilter(appliedFilters, value));
    },
    [appliedFilters, applyFilters],
  );

  const setActivity = useCallback(
    (value: MapActivityFilter) => {
      applyFilters({
        ...appliedFilters,
        activity: value,
      });
    },
    [appliedFilters, applyFilters],
  );

  return {
    appliedFilters,
    draftFilters,
    openCategory,
    orderedCategories,
    replaceAppliedFilters,
    toggleCategory,
    closeCategoryPanel,
    dismissCategory,
    updatePriceDraft,
    selectPriceSuggestion,
    commitPriceDraft,
    toggleStatusPill,
    toggleActivity,
    setActivity,
  };
}
