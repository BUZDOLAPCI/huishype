import {
  OfficialValuationNotFoundError,
  OfficialValuationRateLimitError,
  OfficialValuationTemporarySourceError,
  OfficialValuationUnsupportedError,
} from '../errors.js';
import type {
  OfficialValuationSourceRequestRuntime,
  OfficialValuationSourceClient,
  OfficialValuationSourceProperty,
  OfficialValuationSourceResult,
} from '../source-client.js';
import type { OfficialValuationSourceConfig } from '../registry.js';

const WOZ_API_BASE_URL = 'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1';
const PDOK_LOCATIESERVER_BASE_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';

type WozFetch = typeof fetch;

function normalizeDigits(value: string | null): string | null {
  if (!value || !/^\d{1,16}$/.test(value)) {
    return null;
  }
  return value.padStart(16, '0');
}

function getDigits(value: string | null): string | null {
  if (!value || !/^\d{1,16}$/.test(value)) {
    return null;
  }
  return value;
}

function isLikelyBagNummeraanduidingId(value: string | null): boolean {
  const digits = getDigits(value);
  if (!digits) {
    return false;
  }
  return digits.length < 16 || normalizeDigits(digits)?.slice(4, 6) === '20';
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toUpperCase();
}

function collectObjects(value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjects(item, output);
    }
    return output;
  }

  if (value && typeof value === 'object') {
    output.push(value as Record<string, unknown>);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectObjects(nested, output);
    }
  }

  return output;
}

function getStringField(object: Record<string, unknown>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = object[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function extractSourceRecordId(payload: Record<string, unknown>): string | null {
  for (const object of collectObjects(payload)) {
    const value = getStringField(object, ['wozobjectnummer', 'wozObjectnummer', 'wozObjectNummer']);
    if (value) {
      return value;
    }
  }
  return null;
}

function extractBestValuation(
  payload: Record<string, unknown>,
  expectedYear: number,
): Pick<OfficialValuationSourceResult, 'valuation' | 'valuationYear' | 'referenceDate'> | null {
  const candidates: Array<{ valuation: number; valuationYear: number; referenceDate: string | null }> = [];

  for (const object of collectObjects(payload)) {
    const value = object.vastgesteldeWaarde ?? object.waarde ?? object.valuation;
    const peildatum = getStringField(object, ['peildatum', 'referenceDate', 'waardepeildatum']);
    const valuation = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    const valuationYear = peildatum ? Number.parseInt(peildatum.slice(0, 4), 10) : NaN;

    if (Number.isInteger(valuation) && valuation > 0 && Number.isInteger(valuationYear)) {
      candidates.push({
        valuation,
        valuationYear,
        referenceDate: peildatum,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    const aDistance = Math.abs(a.valuationYear - expectedYear);
    const bDistance = Math.abs(b.valuationYear - expectedYear);
    return aDistance - bDistance || b.valuationYear - a.valuationYear;
  });

  return candidates[0];
}

function payloadMatchesProperty(
  payload: Record<string, unknown>,
  property: OfficialValuationSourceProperty,
): boolean {
  const propertyPostcode = normalizeText(property.postalCode);
  const propertyHouseNumber = property.houseNumber;
  const propertyAddition = normalizeText(property.houseNumberAddition);
  const propertyStreet = normalizeText(property.street);
  const propertyCity = normalizeText(property.city);

  for (const object of collectObjects(payload)) {
    const postcode = getStringField(object, ['postcode', 'postCode', 'postalCode']);
    const houseNumber = getStringField(object, ['huisnummer', 'houseNumber']);
    if (!postcode || !houseNumber) {
      continue;
    }

    const addition = getStringField(object, [
      'huisletter',
      'huisnummertoevoeging',
      'toevoeging',
      'houseNumberAddition',
    ]);
    const street = getStringField(object, [
      'straat',
      'straatnaam',
      'street',
      'openbareRuimteNaam',
      'openbareruimtenaam',
    ]);
    const city = getStringField(object, [
      'woonplaats',
      'woonplaatsnaam',
      'plaats',
      'plaatsnaam',
      'city',
    ]);
    const payloadStreet = normalizeText(street);
    const payloadCity = normalizeText(city);
    if (
      normalizeText(postcode) === propertyPostcode &&
      Number.parseInt(houseNumber, 10) === propertyHouseNumber &&
      normalizeText(addition) === propertyAddition &&
      (!payloadStreet || !propertyStreet || payloadStreet === propertyStreet) &&
      (!payloadCity || !propertyCity || payloadCity === propertyCity)
    ) {
      return true;
    }
  }

  return false;
}

function parseRetryAt(response: Response): Date | undefined {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) {
      return new Date(Date.now() + seconds * 1_000);
    }

    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp);
    }
  }

  const reset = response.headers.get('x-rate-limit-reset') ?? response.headers.get('Kadaster-RateLimit-DayLimit-Reset');
  if (!reset) {
    return undefined;
  }

  const resetNumber = /^\d+$/.test(reset) ? Number.parseInt(reset, 10) : NaN;
  if (Number.isFinite(resetNumber)) {
    return new Date(resetNumber > 10_000_000_000 ? resetNumber : resetNumber * 1_000);
  }

  const resetDate = Date.parse(reset);
  return Number.isFinite(resetDate) ? new Date(resetDate) : undefined;
}

function getObservedErrorMetadata(response: Response) {
  return {
    observedStatus: response.status,
    observedHeaders: {
      'retry-after': response.headers.get('retry-after'),
      'x-rate-limit-reset': response.headers.get('x-rate-limit-reset'),
      'Kadaster-RateLimit-DayLimit-Reset': response.headers.get('Kadaster-RateLimit-DayLimit-Reset'),
    },
  };
}

async function fetchJson(
  fetchImpl: WozFetch,
  path: string,
  runtime?: OfficialValuationSourceRequestRuntime,
): Promise<Record<string, unknown>> {
  const url = path.startsWith('http') ? path : `${WOZ_API_BASE_URL}${path}`;
  const request = () => fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'HuisHype official valuation verifier',
    },
  });

  if (runtime) {
    return runtime.fetchJson('woz', request);
  }

  const response = await request();

  if (response.status === 429) {
    throw new OfficialValuationRateLimitError(
      'WOZ source rate limited the request',
      parseRetryAt(response),
      getObservedErrorMetadata(response),
    );
  }

  if (response.status === 404) {
    throw new OfficialValuationNotFoundError(
      'WOZ valuation not found for property',
      getObservedErrorMetadata(response),
    );
  }

  if (!response.ok) {
    throw new OfficialValuationTemporarySourceError(
      `WOZ source returned HTTP ${response.status}`,
      getObservedErrorMetadata(response),
    );
  }

  return (await response.json()) as Record<string, unknown>;
}

async function fetchPdokJson(
  fetchImpl: WozFetch,
  url: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'HuisHype official valuation verifier',
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
}

function getFirstStringField(object: Record<string, unknown>, names: readonly string[]): string | null {
  return getStringField(object, names)?.trim() || null;
}

function pdokDocMatchesProperty(
  doc: Record<string, unknown>,
  property: OfficialValuationSourceProperty,
): boolean {
  const docAddressObjectId = getFirstStringField(doc, ['adresseerbaarobject_id']);
  const nationalId = normalizeDigits(property.nationalId);
  if (docAddressObjectId && nationalId && normalizeDigits(docAddressObjectId) === nationalId) {
    return true;
  }

  const postcode = getFirstStringField(doc, ['postcode']);
  const houseNumber = getFirstStringField(doc, ['huisnummer']);
  if (!postcode || !houseNumber) {
    return false;
  }

  const addition =
    getFirstStringField(doc, ['huisletter', 'huisnummertoevoeging', 'toevoeging']) ??
    getFirstStringField(doc, ['huis_nlt'])?.replace(/^\d+\s*/, '') ??
    null;
  const street = getFirstStringField(doc, ['straatnaam']);
  const city = getFirstStringField(doc, ['woonplaatsnaam']);

  return (
    normalizeText(postcode) === normalizeText(property.postalCode) &&
    Number.parseInt(houseNumber, 10) === property.houseNumber &&
    normalizeText(addition) === normalizeText(property.houseNumberAddition) &&
    (!street || normalizeText(street) === normalizeText(property.street)) &&
    (!city || normalizeText(city) === normalizeText(property.city))
  );
}

function extractPdokNummeraanduidingId(
  payload: Record<string, unknown>,
  property: OfficialValuationSourceProperty,
): string | null {
  const docs = (payload.response as { docs?: unknown } | undefined)?.docs;
  if (!Array.isArray(docs)) {
    return null;
  }

  for (const item of docs) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const doc = item as Record<string, unknown>;
    if (getFirstStringField(doc, ['type']) !== 'adres' || !pdokDocMatchesProperty(doc, property)) {
      continue;
    }

    const nummeraanduidingId =
      getFirstStringField(doc, ['nummeraanduiding_id']) ??
      getFirstStringField(doc, ['identificatie'])?.split('-')[1] ??
      getFirstStringField(doc, ['rdf_seealso'])?.match(/nummeraanduiding\/(\d{1,16})$/)?.[1] ??
      null;
    const normalized = normalizeDigits(nummeraanduidingId);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

async function resolvePdokSourcePath(
  fetchImpl: WozFetch,
  property: OfficialValuationSourceProperty,
): Promise<string | null> {
  const addition = property.houseNumberAddition ?? '';
  const queries = [
    `${property.postalCode} ${property.houseNumber}${addition}`,
    `${property.street} ${property.houseNumber}${addition} ${property.postalCode} ${property.city}`,
  ];

  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      fq: 'type:adres',
      rows: '10',
    });
    const payload = await fetchPdokJson(
      fetchImpl,
      `${PDOK_LOCATIESERVER_BASE_URL}/free?${params.toString()}`,
    );
    if (!payload) {
      continue;
    }
    const nummeraanduidingId = extractPdokNummeraanduidingId(payload, property);
    if (nummeraanduidingId) {
      return `/wozwaarde/nummeraanduiding/${nummeraanduidingId}`;
    }
  }

  return null;
}

function extractSuggestedIdentifier(payload: Record<string, unknown>): { kind: 'nummeraanduiding' | 'wozobjectnummer'; id: string } | null {
  for (const object of collectObjects(payload)) {
    const nummeraanduiding = getStringField(object, ['nummeraanduidingid', 'nummeraanduidingId', 'aotid']);
    if (nummeraanduiding) {
      const normalized = normalizeDigits(nummeraanduiding);
      if (normalized) {
        return { kind: 'nummeraanduiding', id: normalized };
      }
    }

    const wozObject = getStringField(object, ['wozobjectnummer', 'wozObjectnummer', 'wozObjectNummer']);
    if (wozObject) {
      return { kind: 'wozobjectnummer', id: wozObject };
    }
  }

  return null;
}

async function resolveSuggestedSourcePath(
  fetchImpl: WozFetch,
  property: OfficialValuationSourceProperty,
  runtime?: OfficialValuationSourceRequestRuntime,
): Promise<string | null> {
  const query = encodeURIComponent(
    `${property.postalCode} ${property.houseNumber}${property.houseNumberAddition ?? ''}`,
  );
  const suggestionPayload = await fetchJson(fetchImpl, `/suggest?q=${query}`, runtime);
  const suggested = extractSuggestedIdentifier(suggestionPayload);
  if (!suggested) {
    return null;
  }

  return suggested.kind === 'nummeraanduiding'
    ? `/wozwaarde/nummeraanduiding/${suggested.id}`
    : `/wozwaarde/wozobjectnummer/${encodeURIComponent(suggested.id)}`;
}

async function fetchValuationForPath(
  fetchImpl: WozFetch,
  sourcePath: string,
  property: OfficialValuationSourceProperty,
  config: OfficialValuationSourceConfig,
  runtime?: OfficialValuationSourceRequestRuntime,
): Promise<OfficialValuationSourceResult | null> {
  const payload = await fetchJson(fetchImpl, sourcePath, runtime);
  if (!payloadMatchesProperty(payload, property)) {
    throw new OfficialValuationNotFoundError('WOZ response did not match the requested property');
  }

  const bestValuation = extractBestValuation(payload, config.expectedValuationYear);
  if (!bestValuation) {
    return null;
  }

  return {
    ...bestValuation,
    sourceRecordId: extractSourceRecordId(payload),
    sourceUrl: `${WOZ_API_BASE_URL}${sourcePath}`,
    rawPayload: payload,
  };
}

export function createWozSourceClient(fetchImpl: WozFetch = fetch): OfficialValuationSourceClient {
  return {
    async fetchCurrentValuation(
      property: OfficialValuationSourceProperty,
      config: OfficialValuationSourceConfig,
      runtime?: OfficialValuationSourceRequestRuntime,
    ): Promise<OfficialValuationSourceResult | null> {
      if (property.countryCode !== 'NL') {
        throw new OfficialValuationUnsupportedError('WOZ is only supported for NL properties');
      }

      let preferredSourcePath: string | null = null;
      const nummeraanduidingId = isLikelyBagNummeraanduidingId(property.nationalId)
        ? normalizeDigits(property.nationalId)
        : null;
      if (nummeraanduidingId) {
        preferredSourcePath = `/wozwaarde/nummeraanduiding/${nummeraanduidingId}`;
        try {
          const preferredResult = await fetchValuationForPath(
            fetchImpl,
            preferredSourcePath,
            property,
            config,
            runtime,
          );
          if (preferredResult) {
            return preferredResult;
          }
        } catch (error) {
          if (!(error instanceof OfficialValuationNotFoundError)) {
            throw error;
          }
        }
      }

      const pdokSourcePath = await resolvePdokSourcePath(fetchImpl, property);
      if (pdokSourcePath && pdokSourcePath !== preferredSourcePath) {
        const pdokResult = await fetchValuationForPath(
          fetchImpl,
          pdokSourcePath,
          property,
          config,
          runtime,
        );
        if (pdokResult) {
          return pdokResult;
        }
      }

      const suggestedSourcePath = await resolveSuggestedSourcePath(fetchImpl, property, runtime);
      if (!suggestedSourcePath) {
        return null;
      }

      if (suggestedSourcePath === preferredSourcePath) {
        return null;
      }

      return fetchValuationForPath(
        fetchImpl,
        suggestedSourcePath,
        property,
        config,
        runtime,
      );
    },
  };
}
