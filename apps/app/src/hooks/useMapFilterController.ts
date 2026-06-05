import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  areMapFiltersEqual,
  createDefaultMapFilters,
  getOrderedMapFilterCategories,
  normalizeMapFilters,
  resetMapFilterCategory,
  toggleMapActivityFilter,
  toggleMapStatusPill,
  type MapActivityFilter,
  type MapFilterCategory,
  type MapFilters,
  type MapStatusPillState,
} from '@/src/lib/sharedMapFilters';

export interface UseMapFilterControllerOptions {
  initialAppliedFilters?: MapFilters;
  onAppliedFiltersChange?: (filters: MapFilters) => void;
}

export interface UseMapFilterControllerReturn {
  appliedFilters: MapFilters;
  orderedCategories: MapFilterCategory[];
  commitAppliedFilters: (filters: MapFilters) => void;
  replaceAppliedFilters: (filters: MapFilters) => void;
  resetCategory: (category: MapFilterCategory) => void;
  toggleStatusPill: (value: MapStatusPillState) => void;
  toggleActivity: (value: Exclude<MapActivityFilter, 'all'>) => void;
  setActivity: (value: MapActivityFilter) => void;
}

export const MapFilterControllerContext = createContext<UseMapFilterControllerReturn | null>(null);

export function useLocalMapFilterController({
  initialAppliedFilters,
  onAppliedFiltersChange,
}: UseMapFilterControllerOptions = {}): UseMapFilterControllerReturn {
  const [appliedFilters, setAppliedFilters] = useState<MapFilters>(() =>
    normalizeMapFilters(initialAppliedFilters ?? createDefaultMapFilters())
  );

  const orderedCategories = useMemo(
    () => getOrderedMapFilterCategories(appliedFilters),
    [appliedFilters]
  );

  const commitAppliedFilters = useCallback(
    (nextFilters: MapFilters) => {
      const normalized = normalizeMapFilters(nextFilters);
      setAppliedFilters((current: MapFilters) => {
        if (areMapFiltersEqual(current, normalized)) {
          return current;
        }

        onAppliedFiltersChange?.(normalized);
        return normalized;
      });
    },
    [onAppliedFiltersChange]
  );

  const replaceAppliedFilters = useCallback((nextFilters: MapFilters) => {
    const normalized = normalizeMapFilters(nextFilters);
    setAppliedFilters(normalized);
  }, []);

  const resetCategory = useCallback(
    (category: MapFilterCategory) => {
      commitAppliedFilters(resetMapFilterCategory(appliedFilters, category));
    },
    [appliedFilters, commitAppliedFilters]
  );

  const toggleStatusPill = useCallback(
    (value: MapStatusPillState) => {
      commitAppliedFilters(toggleMapStatusPill(appliedFilters, value));
    },
    [appliedFilters, commitAppliedFilters]
  );

  const toggleActivity = useCallback(
    (value: Exclude<MapActivityFilter, 'all'>) => {
      commitAppliedFilters(toggleMapActivityFilter(appliedFilters, value));
    },
    [appliedFilters, commitAppliedFilters]
  );

  const setActivity = useCallback(
    (value: MapActivityFilter) => {
      commitAppliedFilters({
        ...appliedFilters,
        activity: value,
      });
    },
    [appliedFilters, commitAppliedFilters]
  );

  return useMemo(
    () => ({
      appliedFilters,
      orderedCategories,
      commitAppliedFilters,
      replaceAppliedFilters,
      resetCategory,
      toggleStatusPill,
      toggleActivity,
      setActivity,
    }),
    [
      appliedFilters,
      orderedCategories,
      commitAppliedFilters,
      replaceAppliedFilters,
      resetCategory,
      setActivity,
      toggleActivity,
      toggleStatusPill,
    ]
  );
}

export function useMapFilterController(
  options: UseMapFilterControllerOptions = {}
): UseMapFilterControllerReturn {
  const sharedController = useContext(MapFilterControllerContext);
  const localController = useLocalMapFilterController(options);
  const appliedSharedInitialRef = useRef(false);
  const initialAppliedFilters = options.initialAppliedFilters;
  const onAppliedFiltersChange = options.onAppliedFiltersChange;

  useEffect(() => {
    if (!sharedController || !initialAppliedFilters || appliedSharedInitialRef.current) {
      return;
    }

    appliedSharedInitialRef.current = true;
    sharedController.replaceAppliedFilters(initialAppliedFilters);
  }, [initialAppliedFilters, sharedController]);

  const sharedCommitAppliedFilters = useCallback(
    (nextFilters: MapFilters) => {
      if (!sharedController) {
        return;
      }

      const normalized = normalizeMapFilters(nextFilters);
      const changed = !areMapFiltersEqual(sharedController.appliedFilters, normalized);
      sharedController.commitAppliedFilters(normalized);
      if (changed) {
        onAppliedFiltersChange?.(normalized);
      }
    },
    [onAppliedFiltersChange, sharedController]
  );

  const sharedResetCategory = useCallback(
    (category: MapFilterCategory) => {
      if (!sharedController) {
        return;
      }

      sharedCommitAppliedFilters(resetMapFilterCategory(sharedController.appliedFilters, category));
    },
    [sharedCommitAppliedFilters, sharedController]
  );

  const sharedToggleStatusPill = useCallback(
    (value: MapStatusPillState) => {
      if (!sharedController) {
        return;
      }

      sharedCommitAppliedFilters(toggleMapStatusPill(sharedController.appliedFilters, value));
    },
    [sharedCommitAppliedFilters, sharedController]
  );

  const sharedToggleActivity = useCallback(
    (value: Exclude<MapActivityFilter, 'all'>) => {
      if (!sharedController) {
        return;
      }

      sharedCommitAppliedFilters(toggleMapActivityFilter(sharedController.appliedFilters, value));
    },
    [sharedCommitAppliedFilters, sharedController]
  );

  const sharedSetActivity = useCallback(
    (value: MapActivityFilter) => {
      if (!sharedController) {
        return;
      }

      sharedCommitAppliedFilters({
        ...sharedController.appliedFilters,
        activity: value,
      });
    },
    [sharedCommitAppliedFilters, sharedController]
  );

  const returnedSharedController = useMemo<UseMapFilterControllerReturn | null>(() => {
    if (!sharedController) {
      return null;
    }

    if (!onAppliedFiltersChange) {
      return sharedController;
    }

    return {
      ...sharedController,
      commitAppliedFilters: sharedCommitAppliedFilters,
      resetCategory: sharedResetCategory,
      toggleStatusPill: sharedToggleStatusPill,
      toggleActivity: sharedToggleActivity,
      setActivity: sharedSetActivity,
    };
  }, [
    onAppliedFiltersChange,
    sharedCommitAppliedFilters,
    sharedController,
    sharedResetCategory,
    sharedSetActivity,
    sharedToggleActivity,
    sharedToggleStatusPill,
  ]);

  return returnedSharedController ?? localController;
}
