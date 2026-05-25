import {
  getOfficialValuationDisplayState,
  shouldRequestOfficialValuationHydration,
} from '../officialValuationDisplay';

describe('official valuation display', () => {
  const sourceFetch = {
    source: 'woz' as const,
    expectedValuationYear: 2025,
    supportsClientFetch: {
      web: false,
      native: false,
    },
  };

  it('displays a server-provided WOZ value even when the valuation reference year is older than the expected WOZ year', () => {
    expect(
      getOfficialValuationDisplayState({
        countryCode: 'NL',
        officialValuation: 455000,
        officialValuationYear: 2024,
        officialValuationVerified: true,
        officialValuationSourceFetch: sourceFetch,
      }),
    ).toEqual({
      state: 'ready',
      value: 455000,
      year: 2024,
    });
  });

  it('does not let a previous hydration hide suppress a later cached value', () => {
    expect(
      getOfficialValuationDisplayState({
        countryCode: 'NL',
        officialValuation: 455000,
        officialValuationYear: 2024,
        officialValuationVerified: true,
        officialValuationSourceFetch: sourceFetch,
        officialValuationHydrationHidden: true,
      }),
    ).toMatchObject({
      state: 'ready',
      value: 455000,
    });
  });

  it('requests hydration for stale unverified WOZ values without hiding the current fallback value', () => {
    const input = {
      countryCode: 'NL',
      officialValuation: 410000,
      officialValuationYear: 2023,
      officialValuationVerified: false,
      officialValuationSourceFetch: sourceFetch,
    };

    expect(getOfficialValuationDisplayState(input)).toMatchObject({
      state: 'ready',
      value: 410000,
      year: 2023,
    });
    expect(shouldRequestOfficialValuationHydration(input)).toBe(true);
  });
});
