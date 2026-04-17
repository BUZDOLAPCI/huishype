/**
 * Flow E2E Test: Map to Property
 *
 * Tests the map interaction flow leading to property selection:
 * - Zoom to property level and see rendered property markers
 * - Click on map at property location to trigger preview card
 * - Preview card shows real address data (not placeholders)
 * - Property layers exist at correct zoom levels
 */

import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { PROPERTY_GHOST_REVEAL_ZOOM } from '@huishype/shared';
import { waitForMapStyleLoaded, waitForMapIdle } from '../visual/helpers/visual-test-helpers';
import { clickOnPropertyMarker } from '../visual/helpers/screenshot-harness';
import { getPlaywrightApiUrl, getPlaywrightArtifactPath } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import { clickRenderedPropertyMarkerById, type WindowWithMapInstance } from '../helpers/map-instance';

const API_BASE_URL = getPlaywrightApiUrl();

// Screenshot output directory
const SCREENSHOT_DIR = getPlaywrightArtifactPath('flows');

// Stable map viewport used by this dataset-backed flow.
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];

// Match the shared ghost-reveal threshold used by the map contract.
const PROPERTY_ZOOM = PROPERTY_GHOST_REVEAL_ZOOM;

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

// Disable tracing to avoid artifact issues
test.use({ trace: 'off' });

async function focusMapOnSeededPropertyArea(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
  await waitForMapStyleLoaded(page, 60000);

  await page.evaluate(({ center, zoom }) => {
    const map = (window as WindowWithMapInstance).__mapInstance;
    if (map) {
      map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
    }
  }, { center: EINDHOVEN_CENTER, zoom: PROPERTY_ZOOM });

  await waitForMapIdle(page, 10000);
  await page.waitForTimeout(3000);
}

test.describe('Map to Property Flow', () => {
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    consoleWarnings = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('zoom to property level and see markers', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for map style to load
    await waitForMapStyleLoaded(page, 60000);

    // Zoom to property level centered on Eindhoven
    const mapConfigured = await page.evaluate(
      ({ center, zoom }) => {
        const map = (window as WindowWithMapInstance).__mapInstance;
        if (map && typeof map.setZoom === 'function') {
          map.setCenter(center);
          map.setZoom(zoom);
          return true;
        }
        return false;
      },
      { center: EINDHOVEN_CENTER, zoom: PROPERTY_ZOOM }
    );
    expect(mapConfigured, 'Map instance should be available for JS control').toBe(true);

    // Wait for tiles to load after zoom change
    await waitForMapIdle(page, 10000);
    await page.waitForTimeout(2000);

    // Verify zoom level
    const actualZoom = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return map?.getZoom?.() ?? 0;
    });
    expect(actualZoom).toBeGreaterThanOrEqual(17);

    // Wait for property features to render
    await page.waitForFunction(
      () => {
        const map = (window as WindowWithMapInstance).__mapInstance;
        if (!map || !map.isStyleLoaded()) return false;
        const canvas = map.getCanvas();
        if (!canvas) return false;

        const layerIds = ['ghost-nodes', 'active-nodes', 'property-clusters', 'ghost-clusters']
          .filter((l) => map.getLayer(l));
        if (layerIds.length === 0) return false;

        try {
          const features = map.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: layerIds }
          );
          return (features?.length || 0) > 0;
        } catch {
          return false;
        }
      },
      { timeout: 30000 }
    );

    await page.screenshot({ path: `${SCREENSHOT_DIR}/map-zoomed-markers.png` });

    // Query for rendered features count
    const featureCounts = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return { ghost: 0, active: 0, clusters: 0 };
      const canvas = map.getCanvas();

      let ghost = 0, active = 0, clusters = 0;
      try {
        if (map.getLayer('ghost-nodes')) {
          ghost = (map.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['ghost-nodes'] }
          ) || []).length;
        }
      } catch { /* ignore */ }
      try {
        if (map.getLayer('active-nodes')) {
          active = (map.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['active-nodes'] }
          ) || []).length;
        }
      } catch { /* ignore */ }
      try {
        if (map.getLayer('property-clusters')) {
          clusters = (map.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['property-clusters'] }
          ) || []).length;
        }
      } catch { /* ignore */ }

      return { ghost, active, clusters };
    });

    console.log(`Feature counts at z${PROPERTY_ZOOM}:`, featureCounts);

    // At the ghost-reveal threshold in Eindhoven, property features should render.
    const totalFeatures = featureCounts.ghost + featureCounts.active;
    expect(totalFeatures, `Should have rendered property features at z${PROPERTY_ZOOM}+`).toBeGreaterThan(0);
  });

  test('property layers exist in map style', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page, 60000);

    // Zoom to property level to trigger layer loading
    await page.evaluate(({ center, zoom }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (map) {
        map.setCenter(center);
        map.setZoom(zoom);
      }
    }, { center: EINDHOVEN_CENTER, zoom: PROPERTY_ZOOM });

    await waitForMapIdle(page, 10000);
    await page.waitForTimeout(2000);

    // Check that the expected property layers exist
    const layerInfo = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return null;
      const style = map.getStyle();
      const layers = style?.layers || [];

      const propertyLayers = layers.filter((l: { id?: string }) =>
        l.id === 'ghost-nodes' ||
        l.id === 'active-nodes' ||
        l.id === 'property-clusters' ||
        l.id === 'ghost-clusters' ||
        l.id === 'cluster-count' ||
        l.id === 'ghost-cluster-count'
      );

      return {
        totalLayers: layers.length,
        propertyLayerIds: propertyLayers.map((l: { id?: string }) => l.id),
        sources: Object.keys(style?.sources || {}),
      };
    });

    console.log('Layer info:', layerInfo);

    expect(layerInfo).not.toBeNull();
    expect(layerInfo!.propertyLayerIds).toContain('ghost-nodes');
    expect(layerInfo!.propertyLayerIds).toContain('active-nodes');
    expect(layerInfo!.sources).toContain('properties-source');
  });

  test('click on property marker shows preview card', async ({ page }) => {
    await focusMapOnSeededPropertyArea(page);
    const clickResult = await clickOnPropertyMarker(page);

    console.log('Feature to click:', clickResult);
    expect(clickResult.success, 'Should find and click a property feature').toBe(true);

    // Wait for the preview card to appear (API fetch + render)
    await page.waitForSelector('[data-testid="group-preview-card"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="selected-marker"]', { timeout: 5000 });
    await waitForMapIdle(page, 10000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/map-click-preview.png` });

    // Verify preview card has real property data
    const previewCard = page.locator('[data-testid="group-preview-card"]');
    await expect(previewCard).toBeVisible();

    const cardText = await previewCard.textContent() || '';
    // Card should contain an address (not empty, not a BAG ID)
    expect(cardText.length).toBeGreaterThan(5);
    expect(cardText).not.toMatch(/^0\d{15}$/);

    // Verify the selected marker (pulsing dot) is visible
    const selectedMarker = page.locator('[data-testid="selected-marker"]');
    await expect(selectedMarker).toBeVisible();

    const markerAlignment = await selectedMarker.evaluate((element) => {
      const pulse = element.querySelector('.selected-marker-pulse');
      const dot = element.querySelector('.selected-marker-dot');

      if (!(pulse instanceof HTMLElement) || !(dot instanceof HTMLElement)) {
        return null;
      }

      const pulseRect = pulse.getBoundingClientRect();
      const dotRect = dot.getBoundingClientRect();

      return {
        deltaX: Math.abs(
          pulseRect.left + pulseRect.width / 2 - (dotRect.left + dotRect.width / 2)
        ),
        deltaY: Math.abs(
          pulseRect.top + pulseRect.height / 2 - (dotRect.top + dotRect.height / 2)
        ),
      };
    });

    expect(
      markerAlignment,
      'Selected marker should include both pulse and dot elements'
    ).not.toBeNull();
    expect(
      markerAlignment!.deltaX,
      'Selected marker pulse should stay horizontally centered on the selected node'
    ).toBeLessThan(1);
    expect(
      markerAlignment!.deltaY,
      'Selected marker pulse should stay vertically centered on the selected node'
    ).toBeLessThan(1);

    const markerViewportPosition = await page.evaluate(() => {
      const marker = document.querySelector('[data-testid="selected-marker"]');
      const mapView = document.querySelector('[data-testid="map-view"]');

      if (!(marker instanceof HTMLElement) || !(mapView instanceof HTMLElement)) {
        return null;
      }

      const markerRect = marker.getBoundingClientRect();
      const mapRect = mapView.getBoundingClientRect();
      const markerCenterX = markerRect.left + markerRect.width / 2;
      const markerCenterY = markerRect.top + markerRect.height / 2;

      return {
        xRatio: (markerCenterX - mapRect.left) / mapRect.width,
        yRatio: (markerCenterY - mapRect.top) / mapRect.height,
      };
    });

    expect(
      markerViewportPosition,
      'Selected marker should have a measurable viewport position'
    ).not.toBeNull();
    expect(
      markerViewportPosition!.xRatio,
      'Selected marker should be horizontally centered after selection'
    ).toBeGreaterThan(0.45);
    expect(markerViewportPosition!.xRatio).toBeLessThan(0.55);
    expect(
      markerViewportPosition!.yRatio,
      'Selected marker should sit around 70% from the bottom after selection'
    ).toBeGreaterThan(0.22);
    expect(markerViewportPosition!.yRatio).toBeLessThan(0.38);

    const previewAlignment = await page.evaluate(() => {
      const marker = document.querySelector('[data-testid="selected-marker"]');
      const previewCard = document.querySelector('[data-testid="group-preview-card"]');

      if (!(marker instanceof HTMLElement) || !(previewCard instanceof HTMLElement)) {
        return null;
      }

      const markerRect = marker.getBoundingClientRect();
      const previewRect = previewCard.getBoundingClientRect();

      return {
        deltaX: Math.abs(
          markerRect.left + markerRect.width / 2 - (previewRect.left + previewRect.width / 2)
        ),
      };
    });

    expect(
      previewAlignment,
      'Preview card should have a measurable horizontal alignment with the selected marker'
    ).not.toBeNull();
    expect(
      previewAlignment!.deltaX,
      'Preview card should stay horizontally centered over the selected marker'
    ).toBeLessThan(8);

    const previewArrowAlignment = await page.evaluate(() => {
      const marker = document.querySelector('[data-testid="selected-marker"]');
      const arrowDown = document.querySelector('[data-testid="group-preview-arrow-down"]');
      const arrowUp = document.querySelector('[data-testid="group-preview-arrow-up"]');
      const arrow =
        arrowDown instanceof HTMLElement
          ? arrowDown
          : arrowUp instanceof HTMLElement
            ? arrowUp
            : null;

      if (!(marker instanceof HTMLElement) || !(arrow instanceof HTMLElement)) {
        return null;
      }

      const pulse = marker.querySelector('.selected-marker-pulse');
      if (!(pulse instanceof HTMLElement)) {
        return null;
      }

      const markerRect = marker.getBoundingClientRect();
      const pulseRect = pulse.getBoundingClientRect();
      const arrowRect = arrow.getBoundingClientRect();
      const markerCenterX = markerRect.left + markerRect.width / 2;
      const arrowTipX = arrowRect.left + arrowRect.width / 2;
      const isArrowDown = arrow === arrowDown;
      const arrowTipY = isArrowDown ? arrowRect.bottom : arrowRect.top;
      const pulseEdgeY = isArrowDown ? pulseRect.top : pulseRect.bottom;

      return {
        deltaX: Math.abs(markerCenterX - arrowTipX),
        verticalGap: Math.abs(pulseEdgeY - arrowTipY),
      };
    });

    expect(
      previewArrowAlignment,
      'Preview arrow should have measurable alignment with the selected marker'
    ).not.toBeNull();
    expect(
      previewArrowAlignment!.deltaX,
      'Preview arrow tip should stay horizontally centered over the selected marker'
    ).toBeLessThan(4);
    expect(
      previewArrowAlignment!.verticalGap,
      'Preview arrow tip should leave a visible gap from the selected marker pulse'
    ).toBeGreaterThan(6);

    // Verify the preview card persists (not immediately dismissed)
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="group-preview-card"]')).toBeVisible();
  });

  test('clicking the same property reopens the preview after closing it', async ({ page }) => {
    await focusMapOnSeededPropertyArea(page);
    const firstClick = await clickOnPropertyMarker(page);

    console.log('Feature to reopen:', firstClick);
    expect(firstClick.success, 'Should find and click a property feature').toBe(true);

    const previewCard = page.locator('[data-testid="group-preview-card"]');
    const closeButton = page.locator(
      '[data-testid="group-preview-close-button"], [data-testid="property-preview-close-button"]'
    );

    await expect(previewCard).toBeVisible({ timeout: 10000 });

    const initialText = ((await previewCard.textContent()) || '').trim();
    expect(initialText.length).toBeGreaterThan(5);
    const propertyId = firstClick.propertyId;
    if (!propertyId) {
      throw new Error('Expected clicked marker to provide a propertyId');
    }

    await closeButton.click({ force: true });
    await expect(previewCard).toHaveCount(0);

    const reopenResult = await clickRenderedPropertyMarkerById(page, propertyId);
    expect(reopenResult.success).toBe(true);
    await expect(previewCard).toBeVisible({ timeout: 10000 });
    const reopenedText = ((await previewCard.textContent()) || '').trim();
    expect(reopenedText).toBe(initialText);
  });

  test('API properties endpoint returns data for Eindhoven', async ({ request }) => {
    // Verify the API has Eindhoven properties (prerequisite for map tests)
    // Spatial queries can be slow under load, so use a generous timeout
    const response = await request.get(
      `${API_BASE_URL}/properties?lat=51.4416&lon=5.4697&radius=2000&limit=10`,
      { timeout: 60000 }
    );
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty('data');
    expect(data.data.length).toBeGreaterThan(0);

    // Verify properties have addresses
    const firstProperty = data.data[0];
    expect(firstProperty).toHaveProperty('address');
    expect(firstProperty).toHaveProperty('city');
    expect(firstProperty.address).toBeTruthy();

    console.log(
      `API returned ${data.data.length} properties near Eindhoven center. ` +
      `First: ${firstProperty.address}, ${firstProperty.city}`
    );
  });
});
