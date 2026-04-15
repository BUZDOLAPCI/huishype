import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { router, usePathname } from 'expo-router';

import { toInternalAppHref } from '@/src/utils/property-route';

export type DetailSurfaceRouteKind = 'property' | 'comments' | 'guesses';
export type DetailSurfaceStatus = 'loading' | 'ready';

export interface DetailSurfaceEntry {
  key: string;
  status: DetailSurfaceStatus;
  routeKind: DetailSurfaceRouteKind;
  canonicalPath: string;
  propertyId?: string | null;
  baseHref: string;
  propertyHref: string;
  commentsHref: string;
  guessesHref: string;
  hasPresentingRoute: boolean;
}

interface DetailSurfaceHostContextValue {
  entries: DetailSurfaceEntry[];
  enqueueSynthesisPlan: (plan: Omit<DetailSurfaceSynthesisPlan, 'step'>) => void;
  isSynthesisPendingFor: (href: string) => boolean;
  upsertEntry: (entry: Omit<DetailSurfaceEntry, 'key'> & { key?: string | null }) => string;
  removeEntry: (key: string) => void;
}

type DetailSurfaceSynthesisStep =
  | 'goBase'
  | 'awaitBase'
  | 'goProperty'
  | 'awaitProperty'
  | 'goFinal'
  | 'awaitFinal';

export interface DetailSurfaceSynthesisPlan {
  baseHref: string;
  propertyHref: string;
  finalHref: string;
  step: DetailSurfaceSynthesisStep;
}

const DetailSurfaceHostContext = createContext<DetailSurfaceHostContextValue | null>(
  null,
);

export function DetailSurfaceHostProvider({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const [entries, setEntries] = useState<DetailSurfaceEntry[]>([]);
  const [pendingPlan, setPendingPlan] = useState<DetailSurfaceSynthesisPlan | null>(
    null,
  );
  const nextEntryIdRef = useRef(0);

  const upsertEntry = useCallback(
    (entry: Omit<DetailSurfaceEntry, 'key'> & { key?: string | null }) => {
      const entryKey =
        entry.key?.trim() || `detail-surface-${nextEntryIdRef.current++}`;

      setEntries((currentEntries) => {
        const nextEntry: DetailSurfaceEntry = {
          ...entry,
          key: entryKey,
        };
        const existingIndex = currentEntries.findIndex(
          (currentEntry) => currentEntry.key === entryKey,
        );

        if (existingIndex === -1) {
          return [...currentEntries, nextEntry];
        }

        const nextEntries = [...currentEntries];
        nextEntries[existingIndex] = nextEntry;
        return nextEntries;
      });

      return entryKey;
    },
    [],
  );

  const removeEntry = useCallback((key: string) => {
    setEntries((currentEntries) =>
      currentEntries.filter((entry) => entry.key !== key),
    );
  }, []);

  const enqueueSynthesisPlan = useCallback(
    (plan: Omit<DetailSurfaceSynthesisPlan, 'step'>) => {
      setPendingPlan((currentPlan) => {
        if (
          currentPlan &&
          currentPlan.baseHref === plan.baseHref &&
          currentPlan.propertyHref === plan.propertyHref &&
          currentPlan.finalHref === plan.finalHref
        ) {
          return currentPlan;
        }

        return {
          ...plan,
          step: 'goBase',
        };
      });
    },
    [],
  );

  const isSynthesisPendingFor = useCallback(
    (href: string) => pendingPlan?.finalHref === href,
    [pendingPlan?.finalHref],
  );

  useEffect(() => {
    if (!pendingPlan) {
      return;
    }

    switch (pendingPlan.step) {
      case 'goBase':
        router.replace(toInternalAppHref(pendingPlan.baseHref));
        setPendingPlan((currentPlan) =>
          currentPlan ? { ...currentPlan, step: 'awaitBase' } : currentPlan,
        );
        return;
      case 'awaitBase':
        if (pathname === pendingPlan.baseHref) {
          setPendingPlan((currentPlan) =>
            currentPlan ? { ...currentPlan, step: 'goProperty' } : currentPlan,
          );
        }
        return;
      case 'goProperty':
        router.push(toInternalAppHref(pendingPlan.propertyHref));
        setPendingPlan((currentPlan) =>
          currentPlan
            ? {
                ...currentPlan,
                step:
                  currentPlan.finalHref === currentPlan.propertyHref
                    ? 'awaitFinal'
                    : 'awaitProperty',
              }
            : currentPlan,
        );
        return;
      case 'awaitProperty':
        if (pathname === pendingPlan.propertyHref) {
          setPendingPlan((currentPlan) =>
            currentPlan ? { ...currentPlan, step: 'goFinal' } : currentPlan,
          );
        }
        return;
      case 'goFinal':
        router.push(toInternalAppHref(pendingPlan.finalHref));
        setPendingPlan((currentPlan) =>
          currentPlan ? { ...currentPlan, step: 'awaitFinal' } : currentPlan,
        );
        return;
      case 'awaitFinal':
        if (pathname === pendingPlan.finalHref) {
          setPendingPlan(null);
        }
        return;
      default:
        return;
    }
  }, [pathname, pendingPlan]);

  const value = useMemo(
    () => ({
      entries,
      enqueueSynthesisPlan,
      isSynthesisPendingFor,
      upsertEntry,
      removeEntry,
    }),
    [entries, enqueueSynthesisPlan, isSynthesisPendingFor, removeEntry, upsertEntry],
  );

  return (
    <DetailSurfaceHostContext.Provider value={value}>
      {children}
    </DetailSurfaceHostContext.Provider>
  );
}

function useDetailSurfaceHostContext() {
  const context = useContext(DetailSurfaceHostContext);
  if (!context) {
    throw new Error(
      'useDetailSurfaceHostContext must be used within DetailSurfaceHostProvider',
    );
  }

  return context;
}

export function useDetailSurfaceHostEntries() {
  return useDetailSurfaceHostContext().entries;
}

export function useDetailSurfaceSynthesis() {
  const { enqueueSynthesisPlan, isSynthesisPendingFor } =
    useDetailSurfaceHostContext();

  return {
    enqueueSynthesisPlan,
    isSynthesisPendingFor,
  };
}

export function useRegisterDetailSurfaceEntry(
  entry: Omit<DetailSurfaceEntry, 'key'> | null,
) {
  const { removeEntry, upsertEntry } = useDetailSurfaceHostContext();
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!entry) {
      return;
    }

    if (!keyRef.current) {
      keyRef.current = upsertEntry({ ...entry, key: null });
      return;
    }

    upsertEntry({ ...entry, key: keyRef.current });
  }, [entry, upsertEntry]);

  useEffect(
    () => () => {
      if (!keyRef.current) {
        return;
      }

      removeEntry(keyRef.current);
      keyRef.current = null;
    },
    [removeEntry],
  );
}
