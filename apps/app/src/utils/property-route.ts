import {
  appendInternalReturnTo,
  buildCanonicalCommentsPath,
  buildCanonicalGuessesPath,
  buildCanonicalMapPreviewPath,
  buildCanonicalPropertyPath,
  normalizeInternalReturnTo,
  type CanonicalPropertyRouteInput,
} from '@huishype/shared';
import type { Href } from 'expo-router';

const STATIC_ROUTE_PREFIXES = new Set([
  'feed',
  'saved',
  'profile',
  'notifications',
  'leaderboard',
  'auth',
  'user',
  'showcase',
  '_sitemap',
  '+not-found',
]);

export function isStaticAppRoutePath(pathname: string): boolean {
  const firstSegment = pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  return !!firstSegment && STATIC_ROUTE_PREFIXES.has(firstSegment);
}

export interface PropertyRouteAddressLike {
  id?: string | null;
  address?: string | null;
  countryCode?: string | null;
  city?: string | null;
  postalCode?: string | null;
  street?: string | null;
  streetName?: string | null;
  houseNumber?: string | number | null;
  houseNumberAddition?: string | null;
}

const ADDRESS_TRAILING_HOUSE_PATTERN =
  /^(?<street>.+?)\s+(?<house>\d[\dA-Za-z\s/-]*)$/u;

function parseHouseNumber(
  raw: string,
): { houseNumber: string; houseNumberAddition: string | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+)(?:\s*[-/ ]?\s*(.+))?$/u);
  if (!match?.[1]) {
    return null;
  }

  return {
    houseNumber: match[1],
    houseNumberAddition: match[2]?.trim() || null,
  };
}

function requireRouteField(
  value: string | number | null | undefined,
  field: string,
): string | number {
  if (typeof value === 'number') {
    return value;
  }

  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing ${field} for canonical property route`);
  }

  return trimmed;
}

export function toCanonicalPropertyRouteInput(
  property: PropertyRouteAddressLike,
): CanonicalPropertyRouteInput {
  const directStreet = property.streetName?.trim() || property.street?.trim() || '';
  const directHouseNumber =
    property.houseNumber != null ? String(property.houseNumber).trim() : '';
  const directHouseNumberAddition = property.houseNumberAddition?.trim() || undefined;

  if (directStreet && directHouseNumber) {
    return {
      countryCode: property.countryCode ?? undefined,
      city: String(requireRouteField(property.city, 'city')),
      postalCode: String(requireRouteField(property.postalCode, 'postal code')),
      streetName: directStreet,
      houseNumber: directHouseNumber,
      houseNumberAddition: directHouseNumberAddition,
    };
  }

  if (property.address) {
    const addressLine = property.address.trim().split(',', 1)[0]?.trim() ?? '';
    const addressMatch = addressLine.match(ADDRESS_TRAILING_HOUSE_PATTERN);
    if (addressMatch?.groups?.street && addressMatch.groups.house) {
      const parsedHouse = parseHouseNumber(addressMatch.groups.house);
      if (parsedHouse?.houseNumber) {
        return {
          countryCode: property.countryCode ?? undefined,
          city: String(requireRouteField(property.city, 'city')),
          postalCode: String(requireRouteField(property.postalCode, 'postal code')),
          streetName: addressMatch.groups.street.trim(),
          houseNumber: parsedHouse.houseNumber,
          houseNumberAddition:
            property.houseNumberAddition ?? parsedHouse.houseNumberAddition ?? undefined,
        };
      }
    }
  }

  return {
    countryCode: property.countryCode ?? undefined,
    city: String(requireRouteField(property.city, 'city')),
    postalCode: String(requireRouteField(property.postalCode, 'postal code')),
    streetName: String(requireRouteField(property.streetName ?? property.street, 'street')),
    houseNumber: requireRouteField(property.houseNumber, 'house number'),
    houseNumberAddition: property.houseNumberAddition ?? undefined,
  };
}

function buildCanonicalPropertySubRoute(
  property: PropertyRouteAddressLike,
  builder: (input: CanonicalPropertyRouteInput) => string,
  returnTo?: string | string[] | null,
): string {
  return appendInternalReturnTo(
    builder(toCanonicalPropertyRouteInput(property)),
    returnTo,
  );
}

export function buildPropertyRoute(
  property: PropertyRouteAddressLike,
  returnTo?: string | string[] | null,
): string {
  return buildCanonicalPropertySubRoute(
    property,
    buildCanonicalPropertyPath,
    returnTo,
  );
}

export function buildPropertyMapRoute(
  property: PropertyRouteAddressLike,
  returnTo?: string | string[] | null,
): string {
  return buildCanonicalPropertySubRoute(
    property,
    buildCanonicalMapPreviewPath,
    returnTo,
  );
}

export function buildPropertyCommentsRoute(
  property: PropertyRouteAddressLike,
  returnTo?: string | string[] | null,
): string {
  return buildCanonicalPropertySubRoute(
    property,
    buildCanonicalCommentsPath,
    returnTo,
  );
}

export function buildPropertyGuessesRoute(
  property: PropertyRouteAddressLike,
  returnTo?: string | string[] | null,
): string {
  return buildCanonicalPropertySubRoute(
    property,
    buildCanonicalGuessesPath,
    returnTo,
  );
}

export function buildCanonicalRouteHref(
  canonicalPath: string,
  returnTo?: string | string[] | null,
): string {
  return appendInternalReturnTo(canonicalPath, returnTo);
}

export function normalizePropertyReturnTarget(
  value: string | string[] | null | undefined,
): string | null {
  return normalizeInternalReturnTo(value);
}

export function toInternalAppHref(path: string): Href {
  if (path === '/') {
    return '/' as Href;
  }

  return path as Href;
}
