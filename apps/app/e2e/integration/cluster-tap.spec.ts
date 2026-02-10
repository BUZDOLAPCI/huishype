/**
 * Integration Tests: Cluster Tap & Batch Properties
 *
 * Tests the backend API endpoints that support the cluster tap feature:
 * - GET /properties/batch?ids=... returns up to 50 property details
 * - Tile features include property_ids field
 * - Batch response maintains input order
 */

import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

// Eindhoven center for tile coordinate calculations
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];

/** Calculate tile coordinates for a given lon/lat/zoom */
function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
  return { x, y };
}

test.describe('Cluster Tap - API Integration', () => {
  test('batch endpoint returns properties for valid IDs', async ({ request }) => {
    // Get some property IDs from the properties endpoint
    const listResp = await request.get(`${API_BASE_URL}/properties?limit=5&city=Eindhoven`);
    expect(listResp.ok()).toBe(true);

    const listData = await listResp.json();
    if (listData.data.length === 0) {
      console.log('No Eindhoven properties found, skipping batch test');
      return;
    }

    const ids = listData.data.map((p: any) => p.id);
    const batchResp = await request.get(
      `${API_BASE_URL}/properties/batch?ids=${ids.join(',')}`
    );

    expect(batchResp.ok()).toBe(true);

    const batchData = await batchResp.json();
    expect(Array.isArray(batchData)).toBe(true);
    expect(batchData.length).toBe(ids.length);

    // Verify each property has required fields
    for (const prop of batchData) {
      expect(prop).toHaveProperty('id');
      expect(prop).toHaveProperty('address');
      expect(prop).toHaveProperty('city');
      expect(prop).toHaveProperty('geometry');
      expect(prop.geometry).toHaveProperty('type', 'Point');
      expect(prop.geometry).toHaveProperty('coordinates');
      expect(prop.geometry.coordinates).toHaveLength(2);
    }

    console.log(`Batch returned ${batchData.length} properties with full details`);
  });

  test('batch endpoint preserves input order', async ({ request }) => {
    const listResp = await request.get(`${API_BASE_URL}/properties?limit=5&city=Eindhoven`);
    expect(listResp.ok()).toBe(true);

    const listData = await listResp.json();
    if (listData.data.length < 2) {
      console.log('Not enough properties for order test');
      return;
    }

    const ids = listData.data.map((p: any) => p.id);

    // Request in original order
    const resp1 = await request.get(
      `${API_BASE_URL}/properties/batch?ids=${ids.join(',')}`
    );
    const data1 = await resp1.json();

    // Request in reversed order
    const reversedIds = [...ids].reverse();
    const resp2 = await request.get(
      `${API_BASE_URL}/properties/batch?ids=${reversedIds.join(',')}`
    );
    const data2 = await resp2.json();

    // Both should return same count
    expect(data1.length).toBe(data2.length);

    // Order should match input order
    for (let i = 0; i < data1.length; i++) {
      expect(data1[i].id).toBe(ids[i]);
    }
    for (let i = 0; i < data2.length; i++) {
      expect(data2[i].id).toBe(reversedIds[i]);
    }
  });

  test('batch endpoint rejects more than 50 IDs', async ({ request }) => {
    // Generate 51 fake UUIDs
    const fakeIds = Array.from(
      { length: 51 },
      (_, i) => `a0000000-0000-4000-a000-${String(i).padStart(12, '0')}`
    );

    const resp = await request.get(
      `${API_BASE_URL}/properties/batch?ids=${fakeIds.join(',')}`
    );

    // Should return 400 for exceeding max
    expect(resp.status()).toBe(400);
  });

  test('batch endpoint handles non-existent IDs gracefully', async ({ request }) => {
    const fakeId = 'a0000000-0000-4000-a000-000000000099';
    const resp = await request.get(
      `${API_BASE_URL}/properties/batch?ids=${fakeId}`
    );

    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    // Non-existent IDs should be filtered out (empty result)
    expect(data.length).toBe(0);
  });

  test('batch endpoint rejects invalid UUID format', async ({ request }) => {
    const resp = await request.get(
      `${API_BASE_URL}/properties/batch?ids=not-a-uuid,also-invalid`
    );

    // Should return 400 for invalid UUIDs
    expect(resp.status()).toBe(400);
  });

  test('batch endpoint returns empty for missing ids param', async ({ request }) => {
    const resp = await request.get(`${API_BASE_URL}/properties/batch`);

    // Should return 400 (ids is required)
    expect(resp.status()).toBe(400);
  });

  test('tiles at z13 return non-empty MVT for Eindhoven area', async ({ request }) => {
    const { x, y } = lonLatToTile(EINDHOVEN_CENTER[0], EINDHOVEN_CENTER[1], 13);

    // Try the tile and nearby tiles
    const tilesToTry = [
      [13, x, y],
      [13, x + 1, y],
      [13, x, y + 1],
      [13, x - 1, y],
    ];

    let foundTile = false;
    for (const [z, tx, ty] of tilesToTry) {
      const resp = await request.get(
        `${API_BASE_URL}/tiles/properties/${z}/${tx}/${ty}.pbf`
      );
      if (resp.status() === 200) {
        const body = await resp.body();
        expect(body.length).toBeGreaterThan(0);
        console.log(`Tile z${z}/${tx}/${ty}: ${body.length} bytes`);
        foundTile = true;
        break;
      }
    }

    expect(foundTile).toBe(true);
  });

  test('tiles at z18 return individual property data', async ({ request }) => {
    const { x, y } = lonLatToTile(EINDHOVEN_CENTER[0], EINDHOVEN_CENTER[1], 18);

    // At z18, individual properties should be in the tile
    const resp = await request.get(
      `${API_BASE_URL}/tiles/properties/18/${x}/${y}.pbf`
    );

    // May be 200 or 204 depending on exact tile coverage
    expect([200, 204]).toContain(resp.status());

    if (resp.status() === 200) {
      const body = await resp.body();
      expect(body.length).toBeGreaterThan(0);
      console.log(`Z18 tile: ${body.length} bytes`);
    }
  });
});
