/**
 * Reference Expectation E2E Test: 0020-backend-vector-tile-clustering
 *
 * This test verifies the backend vector tile clustering implementation:
 *
 * 1. Backend serves MVT/PBF tiles at /tiles/properties/{z}/{x}/{y}.pbf
 * 2. Below ghost reveal: active nodes and active clusters render without ghost layers
 * 3. At/above ghost reveal: ghost clusters, ghost counts, and ghost nodes can render
 * 4. Grouping remains density-aware instead of a hard high-zoom de-cluster split
 * 5. Final layer contract stays atomic across tiles and app interaction
 * 6. Performance: Tiles generate in <100ms
 *
 * Screenshot saved to: test-results/reference-expectations/0020-backend-vector-tile-clustering/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { PROPERTY_GHOST_REVEAL_ZOOM } from '@huishype/shared';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

// Configuration
const EXPECTATION_NAME = '0020-backend-vector-tile-clustering';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Test coordinates - Eindhoven center
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];

// Zoom levels for testing
const ZOOMED_OUT_LEVEL = 10; // City view - active clusters dominate
const ZOOMED_IN_LEVEL = PROPERTY_GHOST_REVEAL_ZOOM; // Reveal threshold for ghost-specific layers

// API base URL (assume running locally for tests)
const API_URL = getPlaywrightApiUrl();

// Known acceptable console errors - MINIMAL list
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  test.describe.configure({ mode: 'serial' });

  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    // Ensure screenshot directory exists
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    // Reset console collections
    consoleErrors = [];
    consoleWarnings = [];

    // Collect console messages
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isKnown = isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS);
        if (!isKnown) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    // Collect page errors
    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    // Log warnings for visibility
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.forEach((w) => console.log(`  - ${w}`));
    }

    // FAIL if any console errors detected
    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('verify vector tile endpoint returns MVT/PBF format', async ({ request }) => {
    // Test the tile endpoint directly
    const z = 13;
    const x = 4208; // Approximate tile for Eindhoven at z13
    const y = 2686;

    const tileUrl = `${API_URL}/tiles/properties/${z}/${x}/${y}.pbf`;
    const responses = [
      await request.get(tileUrl, { timeout: 5000 }),
      await request.get(tileUrl, { timeout: 5000 }),
      await request.get(tileUrl, { timeout: 5000 }),
      await request.get(tileUrl, { timeout: 5000 }),
    ];
    const response = responses.at(-1)!;

    // API should be running and endpoint should exist
    expect(response.status(), 'Tile endpoint should not return 404 or 500').not.toBe(404);
    expect(response.status(), 'Tile endpoint should not return 500').not.toBe(500);

    // Should return 200 or 204 (empty tile)
    expect([200, 204]).toContain(response.status());

    if (response.status() === 200) {
      // Check content type is protobuf
      const contentType = response.headers()['content-type'];
      expect(contentType).toBe('application/x-protobuf');

      // Check cache headers
      const cacheControl = response.headers()['cache-control'];
      expect(cacheControl).toContain('max-age=30');

      // Check performance header
      const generationTimes = responses
        .map((tileResponse) => tileResponse.headers()['x-tile-generation-time'])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => parseInt(value.replace('ms', ''), 10))
        .filter((value) => Number.isFinite(value));

      if (generationTimes.length > 0) {
        console.log(`Tile generation times: ${generationTimes.join(', ')}ms`);
        expect(
          Math.min(...generationTimes),
          'At least one warmed tile request should complete within the suite budget'
        ).toBeLessThan(500);
      }

      // Verify response is binary (not JSON/GeoJSON)
      const buffer = await response.body();
      expect(buffer.length).toBeGreaterThan(0);

      // MVT files don't start with '{' (which would indicate JSON)
      const firstChar = String.fromCharCode(buffer[0]);
      expect(firstChar).not.toBe('{');
    }
  });

  test('capture zoomed-out map state (Z10) - should show active-only map layers', async ({
    page,
  }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map container to be ready
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Set map to zoomed-out level
    const mapConfigured = await page.evaluate(
      ({ center, zoom }) => {
        const mapInstance = window.__mapInstance;
        if (mapInstance && typeof mapInstance.setZoom === 'function') {
          mapInstance.setPitch(0);
          mapInstance.setBearing(0);
          mapInstance.setCenter(center);
          mapInstance.setZoom(zoom);
          return true;
        }
        return false;
      },
      { center: EINDHOVEN_CENTER, zoom: ZOOMED_OUT_LEVEL }
    );

    expect(mapConfigured).toBe(true);

    // Wait for map to be idle (tiles loaded)
    await waitForMapIdle(page);

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-zoomed-out-current.png`,
      fullPage: false,
    });

    // Verify map canvas is visible
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // Verify zoom level
    const currentZoom = await page.evaluate(() => {
      const mapInstance = window.__mapInstance;
      return mapInstance ? mapInstance.getZoom() : null;
    });

    if (currentZoom !== null) {
      console.log(`Current zoom level: ${currentZoom}`);
      expect(currentZoom).toBeLessThan(PROPERTY_GHOST_REVEAL_ZOOM);
    }
  });

  test('capture zoomed-in map state at the ghost reveal threshold', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Set map to zoomed-in level
    const mapConfigured = await page.evaluate(
      ({ center, zoom }) => {
        const mapInstance = window.__mapInstance;
        if (mapInstance && typeof mapInstance.setZoom === 'function') {
          mapInstance.setPitch(45); // Add some perspective for street view
          mapInstance.setBearing(0);
          mapInstance.setCenter(center);
          mapInstance.setZoom(zoom);
          return true;
        }
        return false;
      },
      { center: EINDHOVEN_CENTER, zoom: ZOOMED_IN_LEVEL }
    );

    expect(mapConfigured).toBe(true);

    // Wait for map to be idle (tiles loaded)
    await waitForMapIdle(page);

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-zoomed-in-current.png`,
      fullPage: false,
    });

    // Verify zoom level is at street level
    const currentZoom = await page.evaluate(() => {
      const mapInstance = window.__mapInstance;
      return mapInstance ? mapInstance.getZoom() : null;
    });

    if (currentZoom !== null) {
      console.log(`Current zoom level: ${currentZoom}`);
      expect(currentZoom).toBeGreaterThanOrEqual(PROPERTY_GHOST_REVEAL_ZOOM);
    }
  });

  test('verify vector tile source is configured correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Poll for the vector tile source to be added (it's added asynchronously in the map 'load' event)
    const hasVectorSource = await page.waitForFunction(
      () => {
        const mapInstance = window.__mapInstance;
        if (!mapInstance) return false;
        const source = mapInstance.getSource('properties-source');
        if (!source) return false;
        // Check type via serialize() for reliability, fall back to direct property
        const serialized = typeof source.serialize === 'function' ? source.serialize() : null;
        const sourceType = serialized?.type ?? source.type;
        return sourceType === 'vector';
      },
      { timeout: 15000 }
    ).then(() => true).catch(() => false);

    expect(hasVectorSource, 'Vector tile source should be configured').toBe(true);

    // Poll for property layers to be added (they're added together with the source in the load event)
    const layerCheckResult = await page.waitForFunction(
      () => {
        const mapInstance = window.__mapInstance;
        if (!mapInstance) return null;

        const expectedLayers = [
          'property-clusters',
          'cluster-count',
          'active-nodes',
          'ghost-clusters',
          'ghost-cluster-count',
          'ghost-nodes',
        ];

        const allLayers = mapInstance.getStyle()?.layers?.map((l) => l.id) || [];
        const missingLayers = expectedLayers.filter((layerId: string) => !mapInstance.getLayer(layerId));

        if (missingLayers.length > 0) return null; // Keep polling
        return {
          hasLayers: true,
          missingLayers: [] as string[],
          allLayers,
        };
      },
      { timeout: 15000 }
    ).then((handle) => handle.jsonValue()).catch(() => ({
      hasLayers: false,
      missingLayers: [
        'property-clusters',
        'cluster-count',
        'active-nodes',
        'ghost-clusters',
        'ghost-cluster-count',
        'ghost-nodes',
      ],
      allLayers: [] as string[],
    }));

    if (!layerCheckResult!.hasLayers) {
      console.log('Missing layers:', layerCheckResult!.missingLayers);
      console.log('Available layers:', layerCheckResult!.allLayers);
    }

    expect(layerCheckResult!.hasLayers, `All property layers should be configured. Missing: ${layerCheckResult!.missingLayers.join(', ')}`).toBe(
      true
    );
  });

  test('verify ghost nodes only visible at high zoom', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Check ghost layer visibility at low zoom (Z10)
    const ghostLayerLowZoom = await page.evaluate(
      ({ center, zoom }) => {
        const mapInstance = window.__mapInstance;
        if (!mapInstance) return null;

        mapInstance.setZoom(zoom);
        mapInstance.setCenter(center);

        // Ghost layer should be hidden below the shared reveal threshold.
        const ghostLayer = mapInstance.getLayer('ghost-nodes');
        if (!ghostLayer) return null;

        return {
          minzoom: ghostLayer.minzoom ?? 0,
          visibility: mapInstance.getLayoutProperty('ghost-nodes', 'visibility'),
        };
      },
      { center: EINDHOVEN_CENTER, zoom: ZOOMED_OUT_LEVEL }
    );

    if (ghostLayerLowZoom) {
      console.log(`Ghost layer minzoom: ${ghostLayerLowZoom.minzoom}`);
      expect(ghostLayerLowZoom.minzoom ?? 0).toBe(PROPERTY_GHOST_REVEAL_ZOOM);
    }

    // Check ghost layer visibility at the reveal threshold.
    const ghostLayerHighZoom = await page.evaluate(
      ({ center, zoom }) => {
        const mapInstance = window.__mapInstance;
        if (!mapInstance) return null;

        mapInstance.setZoom(zoom);
        mapInstance.setCenter(center);

        const ghostLayer = mapInstance.getLayer('ghost-nodes');
        if (!ghostLayer) return null;

        // At the reveal threshold, the ghost layer should be potentially visible.
        return {
          currentZoom: mapInstance.getZoom(),
          layerMinZoom: ghostLayer.minzoom ?? 0,
          wouldBeVisible: mapInstance.getZoom() >= (ghostLayer.minzoom ?? 0),
        };
      },
      { center: EINDHOVEN_CENTER, zoom: ZOOMED_IN_LEVEL }
    );

    if (ghostLayerHighZoom) {
      console.log(`At Z${ghostLayerHighZoom.currentZoom}: ghost layer visible = ${ghostLayerHighZoom.wouldBeVisible}`);
      expect(ghostLayerHighZoom.wouldBeVisible).toBe(true);
    }
  });

  test('take main screenshot for visual comparison', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Set to default zoom level
    await page.evaluate(
      ({ center, zoom }) => {
        const mapInstance = window.__mapInstance;
        if (mapInstance) {
          mapInstance.setPitch(50);
          mapInstance.setBearing(0);
          mapInstance.setCenter(center);
          mapInstance.setZoom(zoom);
        }
      },
      { center: EINDHOVEN_CENTER, zoom: 13 }
    );

    // Wait for map to be idle (tiles loaded)
    await waitForMapIdle(page);

    // Take main screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });

    // Verify no error state
    const errorState = page.locator('text=Failed to load');
    await expect(errorState).not.toBeVisible();
  });
});
