import { describe, expect, it, jest } from '@jest/globals';
import { hydrateOfficialValuationRequestSchema } from './contracts.js';
import {
  getOfficialValuationSourceConfig,
  getOfficialValuationSourceFetchHint,
  isOfficialValuationSourceSupportedForCountry,
} from './registry.js';
import {
  OfficialValuationNotFoundError,
  OfficialValuationRateLimitError,
  OfficialValuationUnsupportedError,
} from './errors.js';
import type { OfficialValuationSourceRequestRuntime } from './source-client.js';
import { createWozSourceClient } from './sources/woz.js';

function response(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    json: async () => body,
  } as Response;
}

describe('official valuation contracts and registry', () => {
  it('requires client-observed valuation and valuationYear to be submitted together', () => {
    const parsed = hydrateOfficialValuationRequestSchema.safeParse({
      source: 'woz',
      valuation: 425_000,
    });

    expect(parsed.success).toBe(false);
  });

  it('keeps WOZ explicitly scoped to NL with client runtime hints', () => {
    expect(isOfficialValuationSourceSupportedForCountry('woz', 'NL')).toBe(true);
    expect(isOfficialValuationSourceSupportedForCountry('woz', 'BE')).toBe(false);
    expect(getOfficialValuationSourceFetchHint('BE')).toBeNull();
    expect(getOfficialValuationSourceFetchHint('NL')).toEqual({
      source: 'woz',
      expectedValuationYear: getOfficialValuationSourceConfig('woz').expectedValuationYear,
      supportsClientFetch: { web: false, native: false },
    });
  });
});

describe('WOZ source client', () => {
  const config = getOfficialValuationSourceConfig('woz');

  it('does not call Kadaster for non-NL properties', async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    const client = createWozSourceClient(fetchImpl);

    await expect(
      client.fetchCurrentValuation(
        {
          id: 'property-1',
          countryCode: 'BE',
          nationalId: '123',
          street: 'Rue Fixture',
          postalCode: '1000',
          houseNumber: 1,
          houseNumberAddition: null,
          city: 'Brussels',
        },
        config,
      ),
    ).rejects.toBeInstanceOf(OfficialValuationUnsupportedError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches by BAG nummeraanduiding id and extracts the best WOZ valuation', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(
      response(200, {
        wozObject: {
          wozobjectnummer: '123456789',
          postcode: '1234 AB',
          huisnummer: 41,
          straatnaam: 'Fixture Ring',
          woonplaatsnaam: 'Eindhoven',
        },
        wozWaarden: [
          { peildatum: '2024-01-01', vastgesteldeWaarde: 410_000 },
          { peildatum: '2025-01-01', vastgesteldeWaarde: 430_000 },
        ],
      }),
    );
    const client = createWozSourceClient(fetchImpl);

    const result = await client.fetchCurrentValuation(
      {
        id: 'property-1',
        countryCode: 'NL',
        nationalId: '123',
        street: 'Fixture Ring',
        postalCode: '1234AB',
        houseNumber: 41,
        houseNumberAddition: null,
        city: 'Eindhoven',
      },
      config,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding/0000000000000123',
      expect.any(Object),
    );
    expect(result).toMatchObject({
      valuation: 430_000,
      valuationYear: 2025,
      referenceDate: '2025-01-01',
      sourceRecordId: '123456789',
    });
  });

  it('resolves BAG adresseerbaarobject ids through PDOK before fetching WOZ', async () => {
    const fetchImpl = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          response: {
            docs: [
              {
                type: 'adres',
                postcode: '5651HC',
                huisnummer: 9,
                straatnaam: 'Kathodelaan',
                woonplaatsnaam: 'Eindhoven',
                adresseerbaarobject_id: '0772010001055368',
                nummeraanduiding_id: '0772200001055386',
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          wozObject: {
            wozobjectnummer: '77200593020',
            postcode: '5651HC',
            huisnummer: 9,
            straatnaam: 'Kathodelaan',
            woonplaatsnaam: 'Eindhoven',
            adresseerbaarobjectid: 772010001055368,
            nummeraanduidingid: 772200001055386,
          },
          wozWaarden: [{ peildatum: '2025-01-01', vastgesteldeWaarde: 917_000 }],
        }),
      );
    const client = createWozSourceClient(fetchImpl);

    const result = await client.fetchCurrentValuation(
      {
        id: 'property-kathodelaan-9',
        countryCode: 'NL',
        nationalId: '0772010001055368',
        street: 'Kathodelaan',
        postalCode: '5651HC',
        houseNumber: 9,
        houseNumberAddition: null,
        city: 'Eindhoven',
      },
      config,
    );

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=5651HC+9&fq=type%3Aadres&rows=10',
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding/0772200001055386',
    ]);
    expect(result).toMatchObject({
      valuation: 917_000,
      valuationYear: 2025,
      sourceRecordId: '77200593020',
    });
  });

  it('maps Kadaster 429 responses to a retryable rate-limit error', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(
      response(429, {}, { 'retry-after': '60' }),
    );
    const client = createWozSourceClient(fetchImpl);

    await expect(
      client.fetchCurrentValuation(
        {
          id: 'property-1',
          countryCode: 'NL',
          nationalId: '123',
          street: 'Fixture Ring',
          postalCode: '1234AB',
          houseNumber: 41,
          houseNumberAddition: null,
          city: 'Eindhoven',
        },
        config,
      ),
    ).rejects.toBeInstanceOf(OfficialValuationRateLimitError);
  });

  it('maps Kadaster reset headers on 429 responses', async () => {
    const resetAt = new Date(Date.now() + 300_000);
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(
      response(429, {}, { 'kadaster-ratelimit-daylimit-reset': resetAt.toISOString() }),
    );
    const client = createWozSourceClient(fetchImpl);

    await expect(
      client.fetchCurrentValuation(
        {
          id: 'property-1',
          countryCode: 'NL',
          nationalId: '123',
          street: 'Fixture Ring',
          postalCode: '1234AB',
          houseNumber: 41,
          houseNumberAddition: null,
          city: 'Eindhoven',
        },
        config,
      ),
    ).rejects.toMatchObject({
      retryAt: resetAt,
    });
  });

  it('maps temporary Kadaster errors to retryable source errors with status metadata', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(response(503, {}));
    const client = createWozSourceClient(fetchImpl);

    await expect(
      client.fetchCurrentValuation(
        {
          id: 'property-1',
          countryCode: 'NL',
          nationalId: '123',
          street: 'Fixture Ring',
          postalCode: '1234AB',
          houseNumber: 41,
          houseNumberAddition: null,
          city: 'Eindhoven',
        },
        config,
      ),
    ).rejects.toMatchObject({
      code: 'temporary_source_error',
      metadata: { observedStatus: 503 },
    });
  });

  it('rejects WOZ results when returned street does not match the property', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(
      response(200, {
        wozObject: {
          wozobjectnummer: '123456789',
          postcode: '1234 AB',
          huisnummer: 41,
          straatnaam: 'Other Street',
          woonplaatsnaam: 'Eindhoven',
        },
        wozWaarden: [{ peildatum: '2024-01-01', vastgesteldeWaarde: 410_000 }],
      }),
    );
    const client = createWozSourceClient(fetchImpl);

    await expect(
      client.fetchCurrentValuation(
        {
          id: 'property-1',
          countryCode: 'NL',
          nationalId: '123',
          street: 'Fixture Ring',
          postalCode: '1234AB',
          houseNumber: 41,
          houseNumberAddition: null,
          city: 'Eindhoven',
        },
        config,
      ),
    ).rejects.toBeInstanceOf(OfficialValuationNotFoundError);
  });

  it('rejects WOZ results when returned city does not match the property', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(
      response(200, {
        wozObject: {
          wozobjectnummer: '123456789',
          postcode: '1234 AB',
          huisnummer: 41,
          straatnaam: 'Fixture Ring',
          woonplaatsnaam: 'Rotterdam',
        },
        wozWaarden: [{ peildatum: '2024-01-01', vastgesteldeWaarde: 410_000 }],
      }),
    );
    const client = createWozSourceClient(fetchImpl);

    await expect(
      client.fetchCurrentValuation(
        {
          id: 'property-1',
          countryCode: 'NL',
          nationalId: '123',
          street: 'Fixture Ring',
          postalCode: '1234AB',
          houseNumber: 41,
          houseNumberAddition: null,
          city: 'Eindhoven',
        },
        config,
      ),
    ).rejects.toBeInstanceOf(OfficialValuationNotFoundError);
  });

  it('rejects WOZ results when returned addition differs from the property identity', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(
      response(200, {
        wozObject: {
          wozobjectnummer: '123456789',
          postcode: '1234 AB',
          huisnummer: 41,
          huisletter: 'A',
          straatnaam: 'Fixture Ring',
          woonplaatsnaam: 'Eindhoven',
        },
        wozWaarden: [{ peildatum: '2024-01-01', vastgesteldeWaarde: 410_000 }],
      }),
    );
    const client = createWozSourceClient(fetchImpl);

    await expect(
      client.fetchCurrentValuation(
        {
          id: 'property-1',
          countryCode: 'NL',
          nationalId: '123',
          street: 'Fixture Ring',
          postalCode: '1234AB',
          houseNumber: 41,
          houseNumberAddition: null,
          city: 'Eindhoven',
        },
        config,
      ),
    ).rejects.toBeInstanceOf(OfficialValuationNotFoundError);
  });

  it('resolves WOZ through suggest when no BAG nummeraanduiding id is available', async () => {
    const fetchImpl = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { response: { docs: [] } }))
      .mockResolvedValueOnce(response(200, { response: { docs: [] } }))
      .mockResolvedValueOnce(
        response(200, {
          suggesties: [{ nummeraanduidingid: '456' }],
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          wozObject: {
            wozobjectnummer: '123456789',
            postcode: '1234 AB',
            huisnummer: 41,
            straatnaam: 'Fixture Ring',
            woonplaatsnaam: 'Eindhoven',
          },
          wozWaarden: [{ peildatum: '2024-01-01', vastgesteldeWaarde: 410_000 }],
        }),
      );
    const client = createWozSourceClient(fetchImpl);

    const result = await client.fetchCurrentValuation(
      {
        id: 'property-1',
        countryCode: 'NL',
        nationalId: null,
        street: 'Fixture Ring',
        postalCode: '1234AB',
        houseNumber: 41,
        houseNumberAddition: null,
        city: 'Eindhoven',
      },
      config,
    );

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=1234AB+41&fq=type%3Aadres&rows=10',
    );
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=Fixture+Ring+41+1234AB+Eindhoven&fq=type%3Aadres&rows=10',
    );
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/suggest?q=1234AB%2041',
    );
    expect(fetchImpl.mock.calls[3]?.[0]).toBe(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding/0000000000000456',
    );
    expect(result).toMatchObject({
      valuation: 410_000,
      valuationYear: 2024,
    });
  });

  it('falls back to suggest when the preferred BAG nummeraanduiding lookup misses', async () => {
    const fetchImpl = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(response(404, {}))
      .mockResolvedValueOnce(response(200, { response: { docs: [] } }))
      .mockResolvedValueOnce(response(200, { response: { docs: [] } }))
      .mockResolvedValueOnce(
        response(200, {
          suggesties: [{ wozobjectnummer: '123456789' }],
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          wozObject: {
            wozobjectnummer: '123456789',
            postcode: '1234 AB',
            huisnummer: 41,
            straatnaam: 'Fixture Ring',
            woonplaatsnaam: 'Eindhoven',
          },
          wozWaarden: [{ peildatum: '2024-01-01', vastgesteldeWaarde: 410_000 }],
        }),
      );
    const client = createWozSourceClient(fetchImpl);

    const result = await client.fetchCurrentValuation(
      {
        id: 'property-1',
        countryCode: 'NL',
        nationalId: '123',
        street: 'Fixture Ring',
        postalCode: '1234AB',
        houseNumber: 41,
        houseNumberAddition: null,
        city: 'Eindhoven',
      },
      config,
    );

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding/0000000000000123',
      'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=1234AB+41&fq=type%3Aadres&rows=10',
      'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=Fixture+Ring+41+1234AB+Eindhoven&fq=type%3Aadres&rows=10',
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/suggest?q=1234AB%2041',
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/wozobjectnummer/123456789',
    ]);
    expect(result).toMatchObject({
      valuation: 410_000,
      valuationYear: 2024,
    });
  });

  it('uses the backend request runtime for each Kadaster HTTP call', async () => {
    const fetchImpl = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(response(404, {}))
      .mockResolvedValueOnce(response(200, { response: { docs: [] } }))
      .mockResolvedValueOnce(response(200, { response: { docs: [] } }))
      .mockResolvedValueOnce(
        response(200, {
          suggesties: [{ wozobjectnummer: '123456789' }],
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          wozObject: {
            wozobjectnummer: '123456789',
            postcode: '1234 AB',
            huisnummer: 41,
            straatnaam: 'Fixture Ring',
            woonplaatsnaam: 'Eindhoven',
          },
          wozWaarden: [{ peildatum: '2024-01-01', vastgesteldeWaarde: 410_000 }],
        }),
      );
    const runtimeCalls: number[] = [];
    const client = createWozSourceClient(fetchImpl);

    const result = await client.fetchCurrentValuation(
      {
        id: 'property-1',
        countryCode: 'NL',
        nationalId: '123',
        street: 'Fixture Ring',
        postalCode: '1234AB',
        houseNumber: 41,
        houseNumberAddition: null,
        city: 'Eindhoven',
      },
      config,
      {
        async fetchJson(source, request) {
          runtimeCalls.push(runtimeCalls.length + 1);
          expect(source).toBe('woz');
          const kadasterResponse = await request();
          if (kadasterResponse.status === 404) {
            throw new OfficialValuationNotFoundError('WOZ valuation not found for property');
          }
          return (await kadasterResponse.json()) as Record<string, unknown>;
        },
      },
    );

    expect(result).toMatchObject({ valuation: 410_000 });
    expect(runtimeCalls).toEqual([1, 2, 3]);
  });
});

describe('official valuation hydration processor', () => {
  it('keeps hydration success independent from maintenance enqueue failure and releases the source lease', async () => {
    jest.resetModules();

    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const releaseMock = jest.fn(async () => undefined);
    const requestLatestListingsRefreshMock = jest.fn(async () => {
      throw new Error('redis unavailable');
    });
    const safeRequestPropertyTilePyramidBuildMock = jest.fn(async () => null);

    jest.unstable_mockModule('./store.js', () => ({
      claimOfficialValuationHydrationJob: jest.fn(async () => ({
        id: 'hydration-job-1',
        source: 'woz',
        valuationYear: 2025,
        attemptCount: 1,
        property: {
          id: 'property-1',
          countryCode: 'NL',
          nationalId: '123',
          street: 'Fixture Ring',
          postalCode: '1234AB',
          houseNumber: 41,
          houseNumberAddition: null,
          city: 'Eindhoven',
        },
      })),
      markOfficialValuationHydrationFailed: jest.fn(),
      markOfficialValuationHydrationRetryable: jest.fn(),
      markOfficialValuationHydrationSucceeded: jest.fn(async () => ({
        batchId: 'maintenance-batch-1',
        sourceName: 'official-valuation-woz',
        maintenanceRequestedAt: '2026-04-24T00:00:00.000Z',
      })),
      markOfficialValuationSourceFailure: jest.fn(),
      markOfficialValuationSourceRateLimited: jest.fn(),
      markOfficialValuationSourceSuccess: jest.fn(),
      markOfficialValuationSourceTemporaryFailure: jest.fn(),
      releaseOfficialValuationSourceRequest: releaseMock,
      reserveOfficialValuationSourceRequest: jest.fn(async () => ({ allowed: true })),
    }));
    jest.unstable_mockModule('./source-client.js', () => ({
      getOfficialValuationSourceClient: jest.fn(() => ({
        fetchCurrentValuation: jest.fn(
          async (_property, _config, runtime: OfficialValuationSourceRequestRuntime) => {
            await runtime.fetchJson('woz', async () =>
              response(200, {
                ok: true,
              }),
            );
            return {
              valuation: 512_000,
              valuationYear: 2025,
              referenceDate: '2025-01-01',
            };
          },
        ),
      })),
    }));
    jest.unstable_mockModule('../ingest/queue.js', () => ({
      requestLatestListingsRefresh: requestLatestListingsRefreshMock,
    }));
    jest.unstable_mockModule('../property-tile-pyramid.js', () => ({
      safeRequestPropertyTilePyramidBuild: safeRequestPropertyTilePyramidBuildMock,
    }));

    const { processOfficialValuationHydrationJob } = await import('./processor.js');

    await expect(
      processOfficialValuationHydrationJob({ jobId: 'hydration-job-1', logger }),
    ).resolves.toEqual({
      status: 'completed',
      valuation: 512_000,
      valuationYear: 2025,
    });

    expect(requestLatestListingsRefreshMock).toHaveBeenCalledWith({
      requestedBy: 'official-valuation',
      batchId: 'maintenance-batch-1',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'hydration-job-1',
        maintenanceBatchId: 'maintenance-batch-1',
      }),
      'Failed to enqueue latest listings refresh after official valuation hydration',
    );
    expect(safeRequestPropertyTilePyramidBuildMock).toHaveBeenCalledWith(
      { reason: 'official-valuation' },
      logger,
      expect.objectContaining({
        jobId: 'hydration-job-1',
        maintenanceBatchId: 'maintenance-batch-1',
      }),
    );
    expect(releaseMock).toHaveBeenCalledWith('woz');
  });

  it('marks hydration retryable when Kadaster returns 429 through the adaptive request runtime', async () => {
    jest.resetModules();

    const retryAt = new Date(Date.now() + 90_000);
    const markRetryableMock = jest.fn(async () => undefined);
    const markRateLimitedMock = jest.fn(async () => retryAt);
    const releaseMock = jest.fn(async () => undefined);

    jest.unstable_mockModule('./store.js', () => ({
      claimOfficialValuationHydrationJob: jest.fn(async () => ({
        id: 'hydration-job-429',
        source: 'woz',
        valuationYear: 2025,
        attemptCount: 1,
        property: {
          id: 'property-1',
          countryCode: 'NL',
          nationalId: '123',
          street: 'Fixture Ring',
          postalCode: '1234AB',
          houseNumber: 41,
          houseNumberAddition: null,
          city: 'Eindhoven',
        },
      })),
      markOfficialValuationHydrationFailed: jest.fn(),
      markOfficialValuationHydrationRetryable: markRetryableMock,
      markOfficialValuationHydrationSucceeded: jest.fn(),
      markOfficialValuationSourceRateLimited: markRateLimitedMock,
      markOfficialValuationSourceSuccess: jest.fn(),
      markOfficialValuationSourceTemporaryFailure: jest.fn(),
      releaseOfficialValuationSourceRequest: releaseMock,
      reserveOfficialValuationSourceRequest: jest.fn(async () => ({ allowed: true })),
    }));
    jest.unstable_mockModule('./source-client.js', () => ({
      getOfficialValuationSourceClient: jest.fn(() => ({
        fetchCurrentValuation: jest.fn(async (
          _property,
          _config,
          runtime: OfficialValuationSourceRequestRuntime,
        ) =>
          runtime.fetchJson('woz', async () => response(429, {}, { 'retry-after': '90' })),
        ),
      })),
    }));
    jest.unstable_mockModule('../ingest/queue.js', () => ({
      requestLatestListingsRefresh: jest.fn(),
    }));
    jest.unstable_mockModule('../property-tile-pyramid.js', () => ({
      safeRequestPropertyTilePyramidBuild: jest.fn(),
    }));

    const { processOfficialValuationHydrationJob } = await import('./processor.js');

    await expect(processOfficialValuationHydrationJob({ jobId: 'hydration-job-429' })).resolves.toEqual({
      status: 'retryable',
      reason: 'WOZ source rate limited the request',
      nextAttemptAt: retryAt.toISOString(),
    });
    expect(markRateLimitedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'woz',
        observedStatus: 429,
        observedHeaders: expect.objectContaining({ retryAfter: '90' }),
      }),
    );
    expect(markRetryableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'hydration-job-429',
        source: 'woz',
        nextAttemptAt: retryAt,
      }),
    );
    expect(releaseMock).toHaveBeenCalledWith('woz');
  });
});
