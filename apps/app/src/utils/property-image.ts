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

export interface PropertyImageSource {
  /** Primary: listing photo from scraper (Funda/Pararius). */
  listingPhotoUrl?: string | null;
  /** Secondary: country-specific aerial or official image (e.g., PDOK for NL). */
  aerialImageUrl?: string | null;
  /** Country code for determining available fallbacks. */
  countryCode?: CountryCode | string;
}

/**
 * Countries that have aerial imagery available as a fallback.
 * NL: PDOK aerial images (Luchtfoto Actueel).
 * Add more countries as aerial services become available.
 */
const COUNTRIES_WITH_AERIAL: ReadonlySet<string> = new Set(['NL']);

/**
 * Resolve the best available image URL for a property.
 *
 * Returns the highest-priority available URL, or null when none is available
 * (meaning the component should render a branded placeholder).
 */
export function resolvePropertyImage(source: PropertyImageSource): string | null {
  // Priority 1: Listing photo
  if (source.listingPhotoUrl) {
    return source.listingPhotoUrl;
  }

  // Priority 2: Aerial/official image (only for supported countries)
  if (source.aerialImageUrl && source.countryCode && COUNTRIES_WITH_AERIAL.has(source.countryCode)) {
    return source.aerialImageUrl;
  }

  // Priority 3: Branded placeholder — return null, let the component render UI
  return null;
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

/**
 * Resolve image source AND its type (useful for analytics or conditional styling).
 */
export function resolvePropertyImageWithType(source: PropertyImageSource): {
  url: string | null;
  type: ImageSourceType;
} {
  if (source.listingPhotoUrl) {
    return { url: source.listingPhotoUrl, type: 'listing' };
  }

  if (source.aerialImageUrl && source.countryCode && COUNTRIES_WITH_AERIAL.has(source.countryCode)) {
    return { url: source.aerialImageUrl, type: 'aerial' };
  }

  return { url: null, type: 'placeholder' };
}
