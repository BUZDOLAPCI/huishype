import type { LocationSearchSuggestion } from '@huishype/shared';
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
