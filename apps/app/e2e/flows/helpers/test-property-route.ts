import { expect, type APIRequestContext } from '@playwright/test';

import { buildPropertyRoute } from '@/src/utils/property-route';
import { getPlaywrightApiUrl } from '../../helpers/runtime';

const API_BASE_URL = getPlaywrightApiUrl();
const REAL_ADDRESS_BBOX = '5.47,51.48,5.49,51.50';

interface CanonicalPropertyRoute {
  id: string;
  route: string;
  address: string | null;
}

export async function getCanonicalTestPropertyRoute(
  request: APIRequestContext,
): Promise<CanonicalPropertyRoute> {
  const response = await request.get(
    `${API_BASE_URL}/properties?limit=1&bbox=${REAL_ADDRESS_BBOX}`,
  );
  expect(response.ok()).toBe(true);

  const data = await response.json();
  expect(data.data.length).toBeGreaterThan(0);

  const property = data.data[0] as {
    id: string;
    address: string | null;
  };

  return {
    id: property.id,
    route: buildPropertyRoute(property),
    address: property.address,
  };
}
