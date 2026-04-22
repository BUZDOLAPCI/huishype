/**
 * Shared image fallback rules for property-centric surfaces.
 *
 * Priority:
 *   1. Listing photo (from Funda/Pararius scraper)
 *   2. Country-specific aerial/official fallback (e.g., PDOK for NL)
 *   3. Branded warm placeholder (returns null — component renders placeholder UI)
 *
 * Usage:
 *   const imageUrl = resolvePropertyImage({
 *     listingPhotoUrl: listing?.photoUrl,
 *     aerialImageUrl: property.aerialImageUrl,
 *     countryCode: property.countryCode,
 *   });
 *
 *   if (imageUrl) {
 *     <Image source={{ uri: imageUrl }} />
 *   } else {
 *     <PropertyImagePlaceholder />
 *   }
 */

import type { CountryCode } from '@huishype/shared';
import { getPropertyAerialImageFromGeometry } from '../lib/propertyThumbnail';

export interface PropertyImageGeometry {
  type: 'Point';
  coordinates: [number, number];
}

export interface PropertyImageSource {
  /** Primary: listing photo from scraper (Funda/Pararius). */
  listingPhotoUrl?: string | null;
  /** Secondary: country-specific aerial or official image (e.g., PDOK for NL). */
  aerialImageUrl?: string | null;
  /** Country code for determining available fallbacks. */
  countryCode?: CountryCode | string;
}

export interface PropertyImageRecord extends PropertyImageSource {
  /** Back-compat name used across app property payloads for listing thumbnails. */
  thumbnailUrl?: string | null;
  geometry?: PropertyImageGeometry | null;
  imageryGeometry?: PropertyImageGeometry | null;
}

/**
 * Countries that have aerial imagery available as a fallback.
 * NL: PDOK aerial images (Luchtfoto Actueel).
 * Add more countries as aerial services become available.
 */
const COUNTRIES_WITH_AERIAL: ReadonlySet<string> = new Set(['NL']);
const INVALID_PROPERTY_IMAGE_HOSTS: ReadonlySet<string> = new Set(['placeholder.test']);
const INVALID_PROPERTY_IMAGE_HOST_SUFFIXES = [
  '.example.com',
  '.example.org',
  '.example.net',
] as const;

function isInvalidPropertyImageHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (INVALID_PROPERTY_IMAGE_HOSTS.has(normalized)) {
    return true;
  }

  if (
    normalized === 'example.com' ||
    normalized === 'example.org' ||
    normalized === 'example.net'
  ) {
    return true;
  }

  return INVALID_PROPERTY_IMAGE_HOST_SUFFIXES.some((suffix) =>
    normalized.endsWith(suffix),
  );
}

function normalizePropertyImageUrl(url?: string | null): string | null {
  const trimmed = url?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    if (isInvalidPropertyImageHost(parsed.hostname)) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Resolve the best available image URL for a property.
 *
 * Returns the highest-priority available URL, or null when none is available
 * (meaning the component should render a branded placeholder).
 */
export function resolvePropertyImage(source: PropertyImageSource): string | null {
  const listingPhotoUrl = normalizePropertyImageUrl(source.listingPhotoUrl);
  const aerialImageUrl = normalizePropertyImageUrl(source.aerialImageUrl);

  // Priority 1: Listing photo
  if (listingPhotoUrl) {
    return listingPhotoUrl;
  }

  // Priority 2: Aerial/official image (only for supported countries)
  if (aerialImageUrl && source.countryCode && COUNTRIES_WITH_AERIAL.has(source.countryCode)) {
    return aerialImageUrl;
  }

  // Priority 3: Branded placeholder — return null, let the component render UI
  return null;
}

export function derivePropertyAerialImageUrl(
  source: Pick<PropertyImageRecord, 'aerialImageUrl' | 'imageryGeometry' | 'geometry' | 'countryCode'>,
): string | null {
  return (
    source.aerialImageUrl ??
    getPropertyAerialImageFromGeometry(
      source.imageryGeometry ?? source.geometry ?? null,
      source.countryCode as CountryCode,
    )
  );
}

export function toPropertyImageSource(
  source: PropertyImageRecord,
): PropertyImageSource {
  return {
    listingPhotoUrl: source.listingPhotoUrl ?? source.thumbnailUrl ?? null,
    aerialImageUrl: derivePropertyAerialImageUrl(source),
    countryCode: source.countryCode,
  };
}

export function withDerivedPropertyImageData<T extends PropertyImageRecord>(
  property: T,
): T & { aerialImageUrl: string | null } {
  const aerialImageUrl = derivePropertyAerialImageUrl(property);

  if (property.aerialImageUrl === aerialImageUrl) {
    return property as T & { aerialImageUrl: string | null };
  }

  return {
    ...property,
    aerialImageUrl,
  };
}

/**
 * Check whether a country supports aerial image fallback.
 */
export function hasAerialImageSupport(countryCode?: string): boolean {
  if (!countryCode) return false;
  return COUNTRIES_WITH_AERIAL.has(countryCode);
}

/**
 * Image source type for diagnostics and analytics.
 */
export type ImageSourceType = 'listing' | 'aerial' | 'placeholder';

export interface ResolvedPropertyImageSource {
  url: string;
  type: Exclude<ImageSourceType, 'placeholder'>;
}

/**
 * Resolve the ordered list of candidate image sources for a property.
 *
 * Priority:
 *   1. Listing photo
 *   2. Country-supported aerial/official image
 */
export function getPropertyImageCandidates(
  source: PropertyImageSource,
): ResolvedPropertyImageSource[] {
  const candidates: ResolvedPropertyImageSource[] = [];
  const listingPhotoUrl = normalizePropertyImageUrl(source.listingPhotoUrl);
  const aerialImageUrl = normalizePropertyImageUrl(source.aerialImageUrl);

  if (listingPhotoUrl) {
    candidates.push({ url: listingPhotoUrl, type: 'listing' });
  }

  if (aerialImageUrl && source.countryCode && COUNTRIES_WITH_AERIAL.has(source.countryCode)) {
    candidates.push({ url: aerialImageUrl, type: 'aerial' });
  }

  return candidates;
}

/**
 * Resolve image source AND its type (useful for analytics or conditional styling).
 */
export function resolvePropertyImageWithType(source: PropertyImageSource): {
  url: string | null;
  type: ImageSourceType;
} {
  const [bestCandidate] = getPropertyImageCandidates(source);
  if (bestCandidate) {
    return bestCandidate;
  }

  return { url: null, type: 'placeholder' };
}
