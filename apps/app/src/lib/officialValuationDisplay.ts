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
  officialValuationVerified?: boolean | null;
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

  if (value != null) {
    return {
      state: 'ready',
      value,
      year,
    };
  }

  if (input.officialValuationHydrationHidden) {
    return { state: 'hidden' };
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
  return shouldRequestOfficialValuationHydration(input);
}

export function shouldRequestOfficialValuationHydration(
  input: OfficialValuationDisplayInput,
): boolean {
  if (input.officialValuationHydrationHidden) {
    return false;
  }

  const sourceFetch = input.officialValuationSourceFetch;
  if (sourceFetch?.source !== 'woz' || input.countryCode?.toUpperCase() !== 'NL') {
    return false;
  }

  const value =
    typeof input.officialValuation === 'number' && Number.isFinite(input.officialValuation)
      ? input.officialValuation
      : null;
  const year =
    typeof input.officialValuationYear === 'number' && Number.isFinite(input.officialValuationYear)
      ? input.officialValuationYear
      : null;

  if (value == null || year == null) {
    return true;
  }

  return input.officialValuationVerified === false;
}
