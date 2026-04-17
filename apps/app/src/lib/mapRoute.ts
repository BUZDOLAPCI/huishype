import {
  buildCanonicalCityMapPath,
  buildCanonicalCitySlug,
  buildCanonicalCommentsPath,
  buildCanonicalGuessesPath,
  buildCanonicalMapPreviewPath,
  buildCanonicalPostcodeMapPath,
  buildCanonicalPostcodeSlug,
  buildCanonicalPropertyPath,
  normalizePostalCode,
  parseCanonicalCameraPath,
  resolveCanonicalCountryPrefix,
  validatePostalCode,
  type CanonicalMapCamera,
  type CanonicalPropertyRouteInput,
  type CountryCode,
  type GeocodeSuggestion,
} from '@huishype/shared';
import { apiGeocoder } from '@/src/services/api-geocoder';
import { splitHouseNumber, type ResolvedAddress } from '@/src/services/address-resolver';
import {
  resolveProperty,
  type PropertyResolveResult,
} from '@/src/utils/api';

const DEFAULT_AREA_ZOOM = 14;
const DEFAULT_POSTCODE_ZOOM = 16;
const ADDRESS_TRAILING_HOUSE_PATTERN =
  /^(?<street>.+?)\s+(?<house>\d[\dA-Za-z\s/-]*)$/u;

export type ParsedMapRoute =
  | { kind: 'root'; pathname: '/' }
  | { kind: 'camera'; pathname: string; camera: CanonicalMapCamera }
  | { kind: 'city'; pathname: string; countryCode: CountryCode; citySlug: string }
  | {
      kind: 'postcode';
      pathname: string;
      countryCode: CountryCode;
      citySlug: string;
      postcodeSlug: string;
    }
  | {
      kind: 'preview' | 'property' | 'comments' | 'guesses';
      pathname: string;
      countryCode: CountryCode;
      citySlug: string;
      postcodeSlug: string;
      streetSlug: string;
      houseSegment: string;
    }
  | { kind: 'invalid'; pathname: string; reason: string };

type AddressLeafRoute = Extract<
  ParsedMapRoute,
  { kind: 'preview' | 'property' | 'comments' | 'guesses' }
>;

export type ResolvedMapRoute =
  | { kind: 'root'; canonicalPath: '/' }
  | { kind: 'camera'; canonicalPath: string; camera: CanonicalMapCamera }
  | {
      kind: 'city' | 'postcode';
      canonicalPath: string;
      center: [number, number];
      zoom: number;
      cityName: string;
      countryCode: CountryCode;
    }
  | {
      kind: 'preview' | 'property' | 'comments' | 'guesses';
      canonicalPath: string;
      property: PropertyResolveResult;
      resolvedAddress: ResolvedAddress;
      routeInput: CanonicalPropertyRouteInput;
    }
  | { kind: 'invalid'; canonicalPath: '/'; reason: string };

type LocalPreviewResolvedMapRoute = {
  kind: 'preview';
  canonicalPath: string;
  property: PropertyResolveResult;
  resolvedAddress: ResolvedAddress;
  routeInput: CanonicalPropertyRouteInput;
};

export interface RoutePropertyLike {
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  street?: string | null;
  streetName?: string | null;
  houseNumber?: string | number | null;
  houseNumberAddition?: string | null;
}

const localPreviewRouteCache = new Map<string, LocalPreviewResolvedMapRoute>();

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return trimmed.endsWith('/') && trimmed.length > 1
    ? trimmed.replace(/\/+$/, '')
    : trimmed;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function decodeSegments(pathname: string): string[] | null {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/') {
    return [];
  }

  const decoded = normalizedPath
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeSegment(segment));

  return decoded.every((segment) => typeof segment === 'string')
    ? (decoded as string[])
    : null;
}

function parseHouseSegment(segment: string): {
  houseNumber: string;
  houseNumberAddition: string | null;
} | null {
  const normalized = segment.trim().replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('-').filter(Boolean);
  const houseNumber = parts.shift();
  if (!houseNumber) {
    return null;
  }

  return {
    houseNumber,
    houseNumberAddition: parts.length > 0 ? parts.join('-') : null,
  };
}

function slugToQueryText(slug: string): string {
  return slug.replace(/-/g, ' ');
}

function isAreaLevelSuggestion(result: GeocodeSuggestion): boolean {
  return !result.street && !result.houseNumber;
}

function matchesCitySuggestion(
  result: GeocodeSuggestion,
  route: Extract<ParsedMapRoute, { kind: 'city' }>,
): boolean {
  return (
    isAreaLevelSuggestion(result) &&
    !!result.city &&
    buildCanonicalCitySlug(result.city) === route.citySlug &&
    (result.countryCode?.toUpperCase() ?? route.countryCode) === route.countryCode
  );
}

function matchesPostcodeSuggestion(
  result: GeocodeSuggestion,
  route: Extract<ParsedMapRoute, { kind: 'postcode' }>,
): boolean {
  if (!isAreaLevelSuggestion(result) || !result.city || !result.postalCode) {
    return false;
  }

  return (
    buildCanonicalCitySlug(result.city) === route.citySlug &&
    buildCanonicalPostcodeSlug(result.postalCode, route.countryCode) === route.postcodeSlug &&
    (result.countryCode?.toUpperCase() ?? route.countryCode) === route.countryCode
  );
}

function buildCanonicalPathForKind(
  kind: 'preview' | 'property' | 'comments' | 'guesses',
  input: CanonicalPropertyRouteInput,
): string {
  switch (kind) {
    case 'preview':
      return buildCanonicalMapPreviewPath(input);
    case 'comments':
      return buildCanonicalCommentsPath(input);
    case 'guesses':
      return buildCanonicalGuessesPath(input);
    case 'property':
    default:
      return buildCanonicalPropertyPath(input);
  }
}

function buildCanonicalInputFromLeafRoute(
  route: AddressLeafRoute,
  parsedHouse: { houseNumber: string; houseNumberAddition: string | null },
  resolvedProperty?: PropertyResolveResult | null,
): CanonicalPropertyRouteInput {
  return {
    city: resolvedProperty?.city || slugToQueryText(route.citySlug),
    postalCode:
      resolvedProperty?.postalCode ||
      normalizePostalCode(route.postcodeSlug.toUpperCase(), route.countryCode),
    streetName: slugToQueryText(route.streetSlug),
    houseNumber: parsedHouse.houseNumber,
    houseNumberAddition: parsedHouse.houseNumberAddition,
    countryCode: resolvedProperty?.countryCode ?? route.countryCode,
  };
}

function buildSyntheticResolvedAddress(
  property: PropertyResolveResult,
  routeInput: CanonicalPropertyRouteInput,
): ResolvedAddress {
  const houseNumber = String(routeInput.houseNumber).trim();
  const addition = routeInput.houseNumberAddition?.trim() || null;
  const number = addition ? `${houseNumber} ${addition}` : houseNumber;

  return {
    bagId: property.id,
    formattedAddress: property.address,
    lat: property.coordinates.lat,
    lon: property.coordinates.lon,
    details: {
      city: property.city,
      zip: property.postalCode,
      street: routeInput.streetName,
      number,
      houseNumber,
      houseNumberAddition: addition,
      countryCode: property.countryCode ?? routeInput.countryCode ?? 'NL',
    },
  };
}

async function resolveAreaSuggestion(
  query: string,
  matcher: (suggestion: GeocodeSuggestion) => boolean,
  countryCode: CountryCode,
): Promise<GeocodeSuggestion | null> {
  const suggestions = await apiGeocoder.search(query, {
    limit: 8,
    countryCode,
  });

  return suggestions.find(matcher) ?? null;
}

export function registerLocalPreviewRoute(
  pathname: string,
  property: PropertyResolveResult,
  routeInput: CanonicalPropertyRouteInput,
): void {
  const canonicalPath = normalizePathname(pathname);
  localPreviewRouteCache.set(canonicalPath, {
    kind: 'preview',
    canonicalPath,
    property,
    resolvedAddress: buildSyntheticResolvedAddress(property, routeInput),
    routeInput,
  });
}

export function clearLocalPreviewRouteCache(): void {
  localPreviewRouteCache.clear();
}

export function parseMapRoutePath(pathname: string): ParsedMapRoute {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/') {
    return { kind: 'root', pathname: '/' };
  }

  const camera = parseCanonicalCameraPath(normalizedPath);
  if (camera) {
    return { kind: 'camera', pathname: normalizedPath, camera };
  }

  const segments = decodeSegments(normalizedPath);
  if (!segments) {
    return { kind: 'invalid', pathname: normalizedPath, reason: 'invalid-encoding' };
  }

  if (segments[0] === 'map') {
    const resolution = resolveCanonicalCountryPrefix(segments.slice(1));
    if (!resolution.isCanonical) {
      return { kind: 'invalid', pathname: normalizedPath, reason: 'non-canonical-country-prefix' };
    }

    if (resolution.remainingSegments.length === 0) {
      return { kind: 'invalid', pathname: normalizedPath, reason: 'map-root-redirect' };
    }

    if (resolution.remainingSegments.length !== 4) {
      return { kind: 'invalid', pathname: normalizedPath, reason: 'invalid-map-route-shape' };
    }

    const [citySlug, postcodeSlug, streetSlug, houseSegment] = resolution.remainingSegments;
    return {
      kind: 'preview',
      pathname: normalizedPath,
      countryCode: resolution.countryCode,
      citySlug,
      postcodeSlug,
      streetSlug,
      houseSegment,
    };
  }

  const resolution = resolveCanonicalCountryPrefix(segments);
  if (!resolution.isCanonical) {
    return { kind: 'invalid', pathname: normalizedPath, reason: 'non-canonical-country-prefix' };
  }

  if (resolution.remainingSegments.length === 1) {
    return {
      kind: 'city',
      pathname: normalizedPath,
      countryCode: resolution.countryCode,
      citySlug: resolution.remainingSegments[0]!,
    };
  }

  if (resolution.remainingSegments.length === 2) {
    return {
      kind: 'postcode',
      pathname: normalizedPath,
      countryCode: resolution.countryCode,
      citySlug: resolution.remainingSegments[0]!,
      postcodeSlug: resolution.remainingSegments[1]!,
    };
  }

  if (resolution.remainingSegments.length === 4) {
    const [citySlug, postcodeSlug, streetSlug, houseSegment] = resolution.remainingSegments;
    return {
      kind: 'property',
      pathname: normalizedPath,
      countryCode: resolution.countryCode,
      citySlug,
      postcodeSlug,
      streetSlug,
      houseSegment,
    };
  }

  if (resolution.remainingSegments.length === 5) {
    const [citySlug, postcodeSlug, streetSlug, houseSegment, leaf] =
      resolution.remainingSegments;
    if (leaf === 'comments' || leaf === 'guesses') {
      return {
        kind: leaf,
        pathname: normalizedPath,
        countryCode: resolution.countryCode,
        citySlug,
        postcodeSlug,
        streetSlug,
        houseSegment,
      };
    }
  }

  return { kind: 'invalid', pathname: normalizedPath, reason: 'unsupported-route-shape' };
}

export async function resolveMapRoute(pathname: string): Promise<ResolvedMapRoute> {
  const parsed = parseMapRoutePath(pathname);

  if (parsed.kind === 'invalid') {
    return { kind: 'invalid', canonicalPath: '/', reason: parsed.reason };
  }

  if (parsed.kind === 'root') {
    return { kind: 'root', canonicalPath: '/' };
  }

  if (parsed.kind === 'camera') {
    return {
      kind: 'camera',
      canonicalPath: normalizePathname(pathname),
      camera: parsed.camera,
    };
  }

  if (parsed.kind === 'city') {
    const area = await resolveAreaSuggestion(
      slugToQueryText(parsed.citySlug),
      (suggestion) => matchesCitySuggestion(suggestion, parsed),
      parsed.countryCode,
    );

    if (!area?.city) {
      return { kind: 'invalid', canonicalPath: '/', reason: 'unresolvable-city-route' };
    }

    return {
      kind: 'city',
      canonicalPath: buildCanonicalCityMapPath({
        city: area.city,
        countryCode: parsed.countryCode,
      }),
      center: area.coordinates,
      zoom: DEFAULT_AREA_ZOOM,
      cityName: area.city,
      countryCode: parsed.countryCode,
    };
  }

  if (parsed.kind === 'postcode') {
    if (!validatePostalCode(parsed.postcodeSlug, parsed.countryCode)) {
      return { kind: 'invalid', canonicalPath: '/', reason: 'invalid-postcode-format' };
    }

    const postcode = normalizePostalCode(
      parsed.postcodeSlug.toUpperCase(),
      parsed.countryCode,
    );
    const area = await resolveAreaSuggestion(
      `${postcode} ${slugToQueryText(parsed.citySlug)}`,
      (suggestion) => matchesPostcodeSuggestion(suggestion, parsed),
      parsed.countryCode,
    );

    if (!area?.postalCode || !area.city) {
      return { kind: 'invalid', canonicalPath: '/', reason: 'unresolvable-postcode-route' };
    }

    return {
      kind: 'postcode',
      canonicalPath: buildCanonicalPostcodeMapPath({
        city: area.city,
        postalCode: area.postalCode,
        countryCode: parsed.countryCode,
      }),
      center: area.coordinates,
      zoom: DEFAULT_POSTCODE_ZOOM,
      cityName: area.city,
      countryCode: parsed.countryCode,
    };
  }

  const parsedHouse = parseHouseSegment(parsed.houseSegment);
  if (!parsedHouse) {
    return { kind: 'invalid', canonicalPath: '/', reason: 'invalid-house-segment' };
  }

  if (parsed.kind === 'preview') {
    const cachedPreviewRoute = localPreviewRouteCache.get(normalizePathname(pathname));
    if (cachedPreviewRoute) {
      return cachedPreviewRoute;
    }
  }

  const routeInput = buildCanonicalInputFromLeafRoute(parsed, parsedHouse);
  const property = await resolveProperty({
    postalCode: routeInput.postalCode,
    houseNumber: routeInput.houseNumber,
    houseNumberAddition: routeInput.houseNumberAddition,
    countryCode: routeInput.countryCode,
    street: routeInput.streetName,
    city: routeInput.city,
  });

  if (!property) {
    return { kind: 'invalid', canonicalPath: '/', reason: 'property-not-found' };
  }

  const canonicalRouteInput = buildCanonicalInputFromLeafRoute(
    parsed,
    parsedHouse,
    property,
  );
  const resolvedAddress = buildSyntheticResolvedAddress(property, canonicalRouteInput);

  return {
    kind: parsed.kind,
    canonicalPath: buildCanonicalPathForKind(parsed.kind, canonicalRouteInput),
    property,
    resolvedAddress,
    routeInput: canonicalRouteInput,
  };
}

export function extractCanonicalRouteInput(
  value: RoutePropertyLike | null | undefined,
): CanonicalPropertyRouteInput | null {
  if (!value?.city || !value.postalCode) {
    return null;
  }

  const streetName = value.streetName?.trim() || value.street?.trim() || '';
  const houseNumber =
    value.houseNumber != null ? String(value.houseNumber).trim() : '';
  const houseNumberAddition = value.houseNumberAddition?.trim() || null;

  if (streetName && houseNumber) {
    return {
      city: value.city,
      postalCode: value.postalCode,
      streetName,
      houseNumber,
      houseNumberAddition,
      countryCode: value.countryCode ?? 'NL',
    };
  }

  if (value.address) {
    const addressLine = value.address.trim().split(',', 1)[0]?.trim() ?? '';
    const addressMatch = addressLine.match(ADDRESS_TRAILING_HOUSE_PATTERN);
    if (addressMatch?.groups?.street && addressMatch.groups.house) {
      const parsedHouse = splitHouseNumber(addressMatch.groups.house.trim());
      if (parsedHouse.houseNumber) {
        return {
          city: value.city,
          postalCode: value.postalCode,
          streetName: addressMatch.groups.street.trim(),
          houseNumber: parsedHouse.houseNumber,
          houseNumberAddition: parsedHouse.houseNumberAddition,
          countryCode: value.countryCode ?? 'NL',
        };
      }
    }
  }

  return null;
}

export function buildMapPreviewPathname(
  address: string | string[] | null | undefined,
): string | null {
  const segments = Array.isArray(address)
    ? address
    : typeof address === 'string'
      ? [address]
      : [];

  const trimmedSegments = segments
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (trimmedSegments.length === 0) {
    return null;
  }

  return `/map/${trimmedSegments.join('/')}`;
}
