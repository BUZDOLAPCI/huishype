import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { config } from '../../config.js';
import {
  buildListingPreviewPlan,
  resolveListingSourceUrl,
  SourceServiceTemporaryError,
} from '../../services/listing-source-resolution.js';

const originalFetch = global.fetch;
let mockFetchFn: jest.Mock<typeof global.fetch>;
type MutableSourceServices = {
  fundaApiKey: string;
  parariusApiKey: string;
};
const sourceServicesConfig = config.sourceServices as MutableSourceServices;
const originalSourceServiceKeys = {
  fundaApiKey: config.sourceServices.fundaApiKey,
  parariusApiKey: config.sourceServices.parariusApiKey,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeAll(() => {
  mockFetchFn = jest.fn() as jest.Mock<typeof global.fetch>;
  global.fetch = mockFetchFn;
});

afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  mockFetchFn.mockReset();
  sourceServicesConfig.fundaApiKey = 'test-funda-source-service-key';
  sourceServicesConfig.parariusApiKey = 'test-pararius-source-service-key';
});

afterAll(() => {
  sourceServicesConfig.fundaApiKey = originalSourceServiceKeys.fundaApiKey;
  sourceServicesConfig.parariusApiKey = originalSourceServiceKeys.parariusApiKey;
});

function expectSourceServiceAuthHeader(callIndex: number, token: string): void {
  const init = mockFetchFn.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  const headers = new Headers(init?.headers);
  expect(headers.get('content-type')).toBe('application/json');
  expect(headers.get('authorization')).toBe(`Bearer ${token}`);
}

describe('buildListingPreviewPlan', () => {
  const property = {
    id: 'a0000000-0000-4000-a000-000000000001',
    countryCode: 'NL',
    street: 'Beeldbuisring',
    postalCode: '5651HA',
    houseNumber: 61,
    houseNumberAddition: null,
    city: 'Eindhoven',
    latitude: 51.4416,
    longitude: 5.4697,
  };

  it('returns a validated no-watch plan for a matched Funda listing', async () => {
    mockFetchFn
      .mockResolvedValueOnce(jsonResponse({
        supported: true,
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-beeldbuisring-61/89779872/',
        canonicalUrl: 'https://www.funda.nl/detail/89779872/',
        sourceListingId: '89779872',
        sourceListingIdKind: 'tiny_id',
        aliases: [
          { kind: 'tiny_id', value: '89779872' },
          { kind: 'detail_id', value: '89779872' },
        ],
        listingPath: '/detail/89779872/',
        reasonCode: null,
      }))
      .mockResolvedValueOnce(jsonResponse({
        state: 'matched',
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-beeldbuisring-61/89779872/',
        canonicalUrl: 'https://www.funda.nl/detail/89779872/',
        sourceListingId: '89779872',
        sourceListingIdKind: 'tiny_id',
        aliases: [
          { kind: 'tiny_id', value: '89779872' },
          { kind: 'detail_id', value: '89779872' },
        ],
        sourceStatus: 'available',
        matchedPropertyEvidence: {
          propertyId: property.id,
          matchKind: 'source_exact',
        },
        price: 475000,
        currency: 'EUR',
        title: 'Validated listing',
      }));

    const plan = await buildListingPreviewPlan({
      rawUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-beeldbuisring-61/89779872/',
      property,
      display: {
        title: 'Fallback title',
        priceType: 'sale',
      },
    });

    expect(plan).toMatchObject({
      sourceName: 'funda',
      canonicalUrl: 'https://www.funda.nl/detail/89779872/',
      sourceListingId: '89779872',
      validationState: 'valid',
      matchState: 'matched',
      watchState: 'not_required',
      reasonCode: 'source_identity_match',
      askingPrice: 475000,
      currency: 'EUR',
      title: 'Validated listing',
      submittedPropertyId: property.id,
      matchedPropertyId: property.id,
      propertyMatchKind: 'source_exact',
      sourceStatus: 'available',
    });
    expectSourceServiceAuthHeader(0, 'test-funda-source-service-key');
    expectSourceServiceAuthHeader(1, 'test-funda-source-service-key');
  });

  it('returns a provisional backed-service plan when the source-service API key is missing', async () => {
    sourceServicesConfig.fundaApiKey = '';

    await expect(resolveListingSourceUrl(
      'https://www.funda.nl/detail/koop/eindhoven/huis-beeldbuisring-61/89779872/',
      'funda',
    )).rejects.toThrow(SourceServiceTemporaryError);
    await expect(resolveListingSourceUrl(
      'https://www.funda.nl/detail/koop/eindhoven/huis-beeldbuisring-61/89779872/',
      'funda',
    )).rejects.toThrow('FUNDA_SOURCE_SERVICE_API_KEY');

    const plan = await buildListingPreviewPlan({
      rawUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-beeldbuisring-61/89779872/',
      property,
      display: {
        title: 'Fallback title',
        priceType: 'sale',
      },
    });

    expect(plan).toMatchObject({
      sourceName: 'funda',
      canonicalUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-beeldbuisring-61/89779872/',
      sourceListingId: null,
      validationState: 'provisional',
      matchState: 'unverified',
      watchState: 'will_enqueue',
      reasonCode: 'mirror_unavailable',
      title: 'Fallback title',
    });
    expect(mockFetchFn).not.toHaveBeenCalled();
  });

  it('returns an unsupported response for Pararius id-style URLs', async () => {
    mockFetchFn.mockResolvedValueOnce(jsonResponse({
      supported: false,
      sourceName: 'pararius',
      rawUrl: 'https://www.pararius.com/87a48057',
      reasonCode: 'id_only_unsupported',
    }));

    const plan = await buildListingPreviewPlan({
      rawUrl: 'https://www.pararius.com/87a48057',
      property,
    });

    expect(plan).toMatchObject({
      sourceName: 'pararius',
      canonicalUrl: 'https://www.pararius.com/87a48057',
      sourceListingId: null,
      validationState: 'provisional',
      matchState: 'unsupported',
      watchState: 'unsupported',
      reasonCode: 'source_not_supported',
    });
    expect(mockFetchFn).toHaveBeenCalledTimes(1);
    expectSourceServiceAuthHeader(0, 'test-pararius-source-service-key');
  });

  it('accepts source-service validation addresses with a null house number', async () => {
    mockFetchFn
      .mockResolvedValueOnce(jsonResponse({
        supported: true,
        sourceName: 'pararius',
        rawUrl: 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        canonicalUrl: 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        sourceListingId: '/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        sourceListingIdKind: 'canonical_path',
        aliases: [
          { kind: 'url_path', value: '/apartment-for-rent/eindhoven/87a48057/kathodelaan' },
        ],
        listingPath: '/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        reasonCode: null,
      }))
      .mockResolvedValueOnce(jsonResponse({
        state: 'invalid',
        reasonCode: 'address_mismatch',
        sourceName: 'pararius',
        rawUrl: 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        canonicalUrl: 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        sourceListingId: '/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        sourceListingIdKind: 'canonical_path',
        aliases: [
          { kind: 'url_path', value: '/apartment-for-rent/eindhoven/87a48057/kathodelaan' },
        ],
        sourceStatus: 'invalid',
        address: {
          countryCode: 'NL',
          street: 'Kathodelaan',
          postalCode: '5651GW',
          houseNumber: null,
          houseNumberAddition: null,
          city: 'Eindhoven',
          latitude: null,
          longitude: null,
        },
        matchedPropertyEvidence: {
          propertyId: null,
          matchKind: 'source_mismatch',
        },
      }));

    const plan = await buildListingPreviewPlan({
      rawUrl: 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan',
      property,
    });

    expect(plan).toMatchObject({
      validationState: 'invalid',
      matchState: 'mismatch',
      reasonCode: 'address_mismatch',
      propertyMatchKind: 'source_mismatch',
      sourceStatus: 'invalid',
      address: {
        street: 'Kathodelaan',
        houseNumber: null,
      },
    });
  });

  it('returns a provisional plan with a watch when validation fails temporarily', async () => {
    mockFetchFn
      .mockResolvedValueOnce(jsonResponse({
        supported: true,
        sourceName: 'pararius',
        rawUrl: 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        canonicalUrl: 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        sourceListingId: '/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        sourceListingIdKind: 'canonical_path',
        aliases: [
          { kind: 'url_path', value: '/apartment-for-rent/eindhoven/87a48057/kathodelaan' },
        ],
        listingPath: '/apartment-for-rent/eindhoven/87a48057/kathodelaan',
        reasonCode: null,
      }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const plan = await buildListingPreviewPlan({
      rawUrl: 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan',
      property,
    });

    expect(plan).toMatchObject({
      sourceName: 'pararius',
      canonicalUrl: 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan',
      sourceListingId: '/apartment-for-rent/eindhoven/87a48057/kathodelaan',
      validationState: 'provisional',
      matchState: 'unverified',
      watchState: 'will_enqueue',
      reasonCode: 'mirror_unavailable',
      sourceStatus: 'unknown',
    });
    expectSourceServiceAuthHeader(0, 'test-pararius-source-service-key');
    expectSourceServiceAuthHeader(1, 'test-pararius-source-service-key');
  });
});
