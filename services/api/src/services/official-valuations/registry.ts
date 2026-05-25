import type { OfficialValuationClientRuntime, OfficialValuationSource } from './contracts.js';

export type OfficialValuationSourceConfig = {
  source: OfficialValuationSource;
  countries: readonly string[];
  authoritativeRank: number;
  expectedValuationYear: number;
  supportsClientFetch: Record<OfficialValuationClientRuntime, boolean>;
  backendAdaptiveRateLimits: {
    initialRequestsPerMinute: number;
    minRequestsPerMinute: number;
    maxRequestsPerMinute: number;
    requestsPerMinuteIncreaseStep: number;
    cleanResponsesBeforeIncrease: number;
    initialConcurrency: number;
    maxConcurrency: number;
    cleanWindowsBeforeConcurrencyIncrease: number;
    rateLimitBackoffFactor: number;
    temporaryErrorBackoffFactor: number;
    rateLimitFallbackThrottleMs: number;
    temporaryErrorThrottleMs: number;
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
      web: false,
      native: false,
    },
    backendAdaptiveRateLimits: {
      initialRequestsPerMinute: 60,
      minRequestsPerMinute: 10,
      maxRequestsPerMinute: 300,
      requestsPerMinuteIncreaseStep: 10,
      cleanResponsesBeforeIncrease: 25,
      initialConcurrency: 1,
      maxConcurrency: 3,
      cleanWindowsBeforeConcurrencyIncrease: 2,
      rateLimitBackoffFactor: 0.5,
      temporaryErrorBackoffFactor: 0.8,
      rateLimitFallbackThrottleMs: 15 * 60_000,
      temporaryErrorThrottleMs: 60_000,
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
