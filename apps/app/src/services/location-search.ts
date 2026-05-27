import type { LocationFilterToken, LocationSearchSuggestion } from '@huishype/shared';
import { serializeLocationFilterToken } from '@/src/lib/sharedMapFilters';
import { API_URL } from '@/src/utils/api';
import type { AddressSearchBias } from './address-resolver';

export async function searchLocations(
  query: string,
  limit = 8,
  options?: AddressSearchBias,
): Promise<LocationSearchSuggestion[]> {
  if (!query || query.length < 2) {
    return [];
  }

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  if (options?.countryCode) {
    params.set('countrycode', options.countryCode);
  }
  if (options?.lon !== undefined) {
    params.set('lon', String(options.lon));
  }
  if (options?.lat !== undefined) {
    params.set('lat', String(options.lat));
  }

  const response = await fetch(`${API_URL}/search/locations?${params.toString()}`);
  if (!response.ok) {
    return [];
  }

  return (await response.json()) as LocationSearchSuggestion[];
}

export async function hydrateLocationFilterTokens(
  areas: readonly LocationFilterToken[],
): Promise<LocationFilterToken[]> {
  const serializedAreas = areas
    .map((area) => serializeLocationFilterToken(area))
    .filter((area): area is string => area != null);

  if (serializedAreas.length === 0) {
    return [];
  }

  const params = new URLSearchParams();
  for (const area of serializedAreas) {
    params.append('area', area);
  }

  const countryCodes = new Set(
    areas
      .map((area) => area.countryCode?.trim().toUpperCase())
      .filter((countryCode): countryCode is string => Boolean(countryCode)),
  );
  for (const countryCode of countryCodes) {
    params.append('countrycode', countryCode);
  }

  const response = await fetch(`${API_URL}/search/location-tokens?${params.toString()}`);
  if (!response.ok) {
    return [...areas];
  }

  const body = await response.json();
  const tokens = Array.isArray(body) ? body : body?.data;
  return Array.isArray(tokens) ? (tokens as LocationFilterToken[]) : [...areas];
}
