export interface OfficialValuationSourceFetchHint {
  source: 'woz';
  expectedValuationYear: number;
  supportsClientFetch?: {
    web: boolean;
    native: boolean;
  };
}

export interface OfficialValuationDisplayInput {
  countryCode?: string | null;
  officialValuation?: number | null;
  officialValuationYear?: number | null;
  officialValuationSourceFetch?: OfficialValuationSourceFetchHint | null;
  officialValuationHydrationHidden?: boolean | null;
}

export type OfficialValuationDisplayState =
  | {
      state: 'ready';
      value: number;
      year: number | null;
    }
  | {
      state: 'loading';
      expectedYear: number | null;
      year: number | null;
    }
  | {
      state: 'hidden';
    };

export function getOfficialValuationDisplayState(
  input: OfficialValuationDisplayInput,
): OfficialValuationDisplayState {
  if (input.officialValuationHydrationHidden) {
    return { state: 'hidden' };
  }

  const value =
    typeof input.officialValuation === 'number' && Number.isFinite(input.officialValuation)
      ? input.officialValuation
      : null;
  const year =
    typeof input.officialValuationYear === 'number' && Number.isFinite(input.officialValuationYear)
      ? input.officialValuationYear
      : null;
  const sourceFetch = input.officialValuationSourceFetch;
  const expectedYear =
    sourceFetch?.source === 'woz' && Number.isFinite(sourceFetch.expectedValuationYear)
      ? sourceFetch.expectedValuationYear
      : null;

  if (value != null && (expectedYear == null || (year != null && year >= expectedYear))) {
    return {
      state: 'ready',
      value,
      year,
    };
  }

  if (sourceFetch?.source === 'woz' && input.countryCode?.toUpperCase() === 'NL') {
    return {
      state: 'loading',
      expectedYear,
      year,
    };
  }

  return { state: 'hidden' };
}

export function isOfficialValuationExpected(input: OfficialValuationDisplayInput): boolean {
  return getOfficialValuationDisplayState(input).state === 'loading';
}
