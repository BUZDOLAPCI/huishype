import type { OfficialValuationClientRuntime, OfficialValuationSource } from './contracts.js';

export type OfficialValuationSourceConfig = {
  source: OfficialValuationSource;
  countries: readonly string[];
  authoritativeRank: number;
  expectedValuationYear: number;
  supportsClientFetch: Record<OfficialValuationClientRuntime, boolean>;
  backendRateLimits: {
    concurrency: number;
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  successfulHydrationCooldownMs: number;
  failedHydrationBaseCooldownMs: number;
  failedHydrationMaxCooldownMs: number;
  circuitOpenAfterFailures: number;
  circuitCooldownMs: number;
};

const OFFICIAL_VALUATION_SOURCES: Record<OfficialValuationSource, OfficialValuationSourceConfig> = {
  woz: {
    source: 'woz',
    countries: ['NL'],
    authoritativeRank: 1,
    expectedValuationYear: 2025,
    supportsClientFetch: {
      web: true,
      native: true,
    },
    backendRateLimits: {
      concurrency: 1,
      requestsPerMinute: 30,
      requestsPerDay: 3_000,
    },
    successfulHydrationCooldownMs: 24 * 60 * 60_000,
    failedHydrationBaseCooldownMs: 60 * 60_000,
    failedHydrationMaxCooldownMs: 24 * 60 * 60_000,
    circuitOpenAfterFailures: 5,
    circuitCooldownMs: 15 * 60_000,
  },
};

export function getOfficialValuationSourceConfig(
  source: OfficialValuationSource,
): OfficialValuationSourceConfig {
  return OFFICIAL_VALUATION_SOURCES[source];
}

export function isOfficialValuationSourceSupportedForCountry(
  source: OfficialValuationSource,
  countryCode: string,
): boolean {
  return getOfficialValuationSourceConfig(source).countries.includes(countryCode.toUpperCase());
}

export function getOfficialValuationSourceFetchHint(countryCode: string) {
  const normalizedCountryCode = countryCode.toUpperCase();
  const source = Object.values(OFFICIAL_VALUATION_SOURCES).find((config) =>
    config.countries.includes(normalizedCountryCode),
  );

  if (!source) {
    return null;
  }

  return {
    source: source.source,
    expectedValuationYear: source.expectedValuationYear,
    supportsClientFetch: source.supportsClientFetch,
  };
}

export function getFailedHydrationRetryAt(
  attemptCount: number,
  config: OfficialValuationSourceConfig,
  now = new Date(),
): Date {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 8));
  const delayMs = Math.min(
    config.failedHydrationBaseCooldownMs * 2 ** exponent,
    config.failedHydrationMaxCooldownMs,
  );
  return new Date(now.getTime() + delayMs);
}
