import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCurrentOfficialValuationStatus,
  submitOfficialValuationHydration,
  type OfficialValuationCurrentStatus,
  type OfficialValuationHydrateResponse,
} from '../utils/api';
import {
  shouldRequestOfficialValuationHydration,
  type OfficialValuationDisplayInput,
} from '../lib/officialValuationDisplay';

export const OFFICIAL_VALUATION_HYDRATION_TIMEOUT_MS = 20_000;
const OFFICIAL_VALUATION_POLL_INTERVAL_MS = process.env.NODE_ENV === 'test' ? 0 : 2_000;
const OFFICIAL_VALUATION_MAX_POLLS =
  OFFICIAL_VALUATION_HYDRATION_TIMEOUT_MS / 2_000;

type OfficialValuationStatusPayload =
  | OfficialValuationHydrateResponse
  | OfficialValuationCurrentStatus;

export interface VisibleOfficialValuationProperty extends OfficialValuationDisplayInput {
  id: string;
}

export interface OfficialValuationPatch {
  propertyId: string;
  officialValuation: number;
  officialValuationYear: number;
  officialValuationVerified: boolean;
  expectedValuationYear: number;
}

export interface UseVisibleOfficialValuationHydrationOptions {
  properties: Array<VisibleOfficialValuationProperty | null | undefined>;
  enabled?: boolean;
  getAccessToken?: () => Promise<string | null>;
  onValue?: (patch: OfficialValuationPatch) => void;
  onHidden?: (propertyId: string) => void;
}

const activeHydrationSubmissions = new Map<string, Promise<OfficialValuationHydrateResponse>>();

function getExpectedOfficialValuationYear(payload: OfficialValuationStatusPayload): number {
  return 'expectedValuationYear' in payload ? payload.expectedValuationYear : payload.valuationYear;
}

function getCurrentPatch(payload: OfficialValuationStatusPayload): OfficialValuationPatch | null {
  if (
    payload.officialValuation == null ||
    payload.officialValuationYear == null ||
    payload.officialValuationVerified !== true
  ) {
    return null;
  }

  return {
    propertyId: payload.propertyId,
    officialValuation: payload.officialValuation,
    officialValuationYear: payload.officialValuationYear,
    officialValuationVerified: payload.officialValuationVerified,
    expectedValuationYear: getExpectedOfficialValuationYear(payload),
  };
}

function shouldHideWithoutCurrentValue(payload: OfficialValuationStatusPayload): boolean {
  const state = payload.job?.state;
  return state === 'failed';
}

function shouldDeferWithoutCurrentValue(payload: OfficialValuationStatusPayload): boolean {
  const state = payload.job?.state;
  return state === 'retryable' || state === 'cooldown';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function submitDedupedHydration(
  propertyId: string,
  accessToken?: string | null,
): Promise<OfficialValuationHydrateResponse> {
  const active = activeHydrationSubmissions.get(propertyId);
  if (active) {
    return active;
  }

  const request = submitOfficialValuationHydration(propertyId, accessToken).finally(() => {
    activeHydrationSubmissions.delete(propertyId);
  });
  activeHydrationSubmissions.set(propertyId, request);
  return request;
}

export function useVisibleOfficialValuationHydration({
  properties,
  enabled = true,
  getAccessToken,
  onValue,
  onHidden,
}: UseVisibleOfficialValuationHydrationOptions): Set<string> {
  const [hiddenPropertyIds, setHiddenPropertyIds] = useState<Set<string>>(() => new Set());
  const activePropertyIdsRef = useRef<Set<string>>(new Set());
  const completedPropertyIdsRef = useRef<Set<string>>(new Set());
  const runGenerationRef = useRef(0);
  const getAccessTokenRef = useRef(getAccessToken);
  const onValueRef = useRef(onValue);
  const onHiddenRef = useRef(onHidden);

  useEffect(() => {
    getAccessTokenRef.current = getAccessToken;
    onValueRef.current = onValue;
    onHiddenRef.current = onHidden;
  }, [getAccessToken, onHidden, onValue]);

  const visibleProperties = useMemo(() => {
    const byId = new Map<string, VisibleOfficialValuationProperty>();
    for (const property of properties) {
      if (!property?.id) {
        continue;
      }
      if (shouldRequestOfficialValuationHydration(property)) {
        byId.set(property.id, property);
      }
    }
    return [...byId.values()];
  }, [properties]);

  useEffect(() => {
    if (!enabled) {
      runGenerationRef.current += 1;
      activePropertyIdsRef.current.clear();
      return undefined;
    }

    if (visibleProperties.length === 0) {
      return undefined;
    }

    const generation = runGenerationRef.current;
    const isCancelled = () => generation !== runGenerationRef.current;
    const completeProperty = (propertyId: string) => {
      completedPropertyIdsRef.current.add(propertyId);
    };

    const hideProperty = (propertyId: string) => {
      if (isCancelled()) {
        return;
      }
      completeProperty(propertyId);
      setHiddenPropertyIds((current) => {
        if (current.has(propertyId)) {
          return current;
        }
        const next = new Set(current);
        next.add(propertyId);
        return next;
      });
      onHiddenRef.current?.(propertyId);
    };

    const applyPatch = (patch: OfficialValuationPatch) => {
      if (isCancelled()) {
        return;
      }
      completeProperty(patch.propertyId);
      setHiddenPropertyIds((current) => {
        if (!current.has(patch.propertyId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(patch.propertyId);
        return next;
      });
      onValueRef.current?.(patch);
    };

    for (const property of visibleProperties) {
      if (
        activePropertyIdsRef.current.has(property.id) ||
        completedPropertyIdsRef.current.has(property.id)
      ) {
        continue;
      }

      activePropertyIdsRef.current.add(property.id);
      void (async () => {
        const startedAt = Date.now();
        try {
          const accessToken = await getAccessTokenRef.current?.();
          if (isCancelled()) {
            return;
          }

          let latest: OfficialValuationStatusPayload = await submitDedupedHydration(
            property.id,
            accessToken,
          );
          const initialPatch = getCurrentPatch(latest);
          if (initialPatch) {
            applyPatch(initialPatch);
            return;
          }
          if (latest.status === 'unsupported' || shouldHideWithoutCurrentValue(latest)) {
            hideProperty(property.id);
            return;
          }
          if (shouldDeferWithoutCurrentValue(latest)) {
            return;
          }

          let pollCount = 0;
          while (
            !isCancelled() &&
            Date.now() - startedAt < OFFICIAL_VALUATION_HYDRATION_TIMEOUT_MS &&
            pollCount < OFFICIAL_VALUATION_MAX_POLLS
          ) {
            pollCount += 1;
            const remaining = OFFICIAL_VALUATION_HYDRATION_TIMEOUT_MS - (Date.now() - startedAt);
            await delay(Math.min(OFFICIAL_VALUATION_POLL_INTERVAL_MS, Math.max(remaining, 0)));
            if (isCancelled()) {
              return;
            }

            latest = await fetchCurrentOfficialValuationStatus(property.id, 'woz');
            const patch = getCurrentPatch(latest);
            if (patch) {
              applyPatch(patch);
              return;
            }
            if (shouldHideWithoutCurrentValue(latest)) {
              hideProperty(property.id);
              return;
            }
            if (shouldDeferWithoutCurrentValue(latest)) {
              return;
            }
          }

          hideProperty(property.id);
        } catch (error) {
          console.warn('[HuisHype] official valuation hydration failed:', error);
          hideProperty(property.id);
        } finally {
          activePropertyIdsRef.current.delete(property.id);
        }
      })();
    }

    return undefined;
  }, [enabled, visibleProperties]);

  useEffect(() => {
    const activePropertyIds = activePropertyIdsRef.current;
    return () => {
      runGenerationRef.current += 1;
      activePropertyIds.clear();
    };
  }, []);

  return hiddenPropertyIds;
}
