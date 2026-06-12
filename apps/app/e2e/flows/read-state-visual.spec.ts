import { test, expect, type Page } from '@playwright/test';
import { PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM } from '@huishype/shared';
import { waitForMapIdle, waitForMapStyleLoaded } from '../visual/helpers/visual-test-helpers';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import { type WindowWithMapInstance } from '../helpers/map-instance';

const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];
const PUBLIC_SINGLE_LAYER_IDS = ['active-nodes'] as const;
const PUBLIC_READ_STATE_LAYER_IDS = [
  'active-nodes',
  'active-node-fill',
] as const;

test.use({ trace: 'off' });

async function focusReadableSingleNodeArea(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="map-view"]', { timeout: 30_000 });
  await waitForMapStyleLoaded(page, 60_000);

  await page.evaluate(({ center, zoom }) => {
    const map = (window as WindowWithMapInstance).__mapInstance;
    map?.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
  }, { center: EINDHOVEN_CENTER, zoom: PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM + 1 });

  await waitForMapIdle(page, 10_000);
  await page.waitForTimeout(2_000);
}

async function findPublicSingleNode(page: Page) {
  return page.waitForFunction(
    (layerIds) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map || !map.isStyleLoaded()) {
        return null;
      }

      const canvas = map.getCanvas();
      if (!canvas) {
        return null;
      }

      const rect = canvas.getBoundingClientRect();
      for (const layerId of layerIds) {
        if (!map.getLayer(layerId)) {
          continue;
        }

        const features = map.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers: [layerId] },
        ) ?? [];

        for (const feature of features) {
          const properties = feature.properties ?? {};
          if (properties.group_kind !== 'single' || feature.geometry?.type !== 'Point') {
            continue;
          }

          const rawPropertyIds = properties.property_ids as unknown;
          const propertyIds =
            typeof rawPropertyIds === 'string'
              ? rawPropertyIds.split(',').filter(Boolean)
              : Array.isArray(rawPropertyIds)
                ? rawPropertyIds.filter((value: unknown): value is string => typeof value === 'string')
                : [];
          const propertyId =
            typeof properties.id === 'string'
              ? properties.id
              : propertyIds.length === 1
                ? propertyIds[0]
                : null;
          if (!propertyId || propertyIds.length > 1) {
            continue;
          }

          const coordinates = feature.geometry.coordinates;
          if (
            !Array.isArray(coordinates) ||
            coordinates.length < 2 ||
            typeof coordinates[0] !== 'number' ||
            typeof coordinates[1] !== 'number'
          ) {
            continue;
          }

          const point = map.project([coordinates[0], coordinates[1]]);
          return {
            propertyId,
            layerId,
            screenX: rect.left + point.x,
            screenY: rect.top + point.y,
          };
        }
      }

      return null;
    },
    [...PUBLIC_SINGLE_LAYER_IDS],
    { timeout: 30_000, polling: 500 },
  );
}

async function waitForPublicReadStateLayerStyle(page: Page) {
  return page.waitForFunction(
    (publicLayerIds) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map || !map.isStyleLoaded()) {
        return null;
      }

      for (const layerId of publicLayerIds) {
        if (!map.getLayer(layerId)) {
          continue;
        }

        const opacity = map.getPaintProperty(layerId, 'circle-opacity');
        const serializedOpacity = JSON.stringify(opacity);
        if (!serializedOpacity.includes('feature-state') || !serializedOpacity.includes('0.6')) {
          continue;
        }

        return { layerId, opacity };
      }

      return null;
    },
    [...PUBLIC_READ_STATE_LAYER_IDS],
    { timeout: 30_000, polling: 500 },
  );
}

test.describe('Viewed property read-state visuals', () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on('console', (msg) => {
      if (msg.type() !== 'error') {
        return;
      }
      const text = msg.text();
      if (!isAllowedConsoleMessage(text, NETWORK_ALLOWED_CONSOLE_PATTERNS)) {
        consoleErrors.push(text);
      }
    });
  });

  test.afterEach(async () => {
    expect(consoleErrors, `Expected zero console errors, got ${consoleErrors.join('\n')}`).toHaveLength(0);
  });

  test('opening a map preview marks the property read and renders its node at 60 percent opacity', async ({ page }, testInfo) => {
    await focusReadableSingleNodeArea(page);

    const handle = await findPublicSingleNode(page);
    const target = await handle.jsonValue() as {
      propertyId: string;
      layerId: string;
      screenX: number;
      screenY: number;
    };

    const viewResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes(`/properties/${target.propertyId}/view`) &&
        response.status() === 200,
      { timeout: 20_000 },
    );

    await page.mouse.click(target.screenX, target.screenY);
    await expect(page.getByTestId('property-preview-card')).toBeVisible({ timeout: 15_000 });
    await viewResponsePromise;

    const publicFeatureHandle = await waitForPublicReadStateLayerStyle(page);
    const publicFeature = await publicFeatureHandle.jsonValue() as {
      layerId: string;
      opacity: unknown;
    };

    expect(publicFeature.layerId).toMatch(/^active-/);
    expect(JSON.stringify(publicFeature.opacity)).toContain('feature-state');
    expect(JSON.stringify(publicFeature.opacity)).toContain('0.6');

    await page.screenshot({
      path: testInfo.outputPath('viewed-property-read-overlay.png'),
      fullPage: false,
    });
  });
});
